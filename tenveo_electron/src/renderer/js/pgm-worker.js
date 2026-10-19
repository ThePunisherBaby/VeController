// Monitor PGM de baja latencia (worker).
//
// Lee el FLV que entrega el proceso principal, decodifica el H.264 con
// WebCodecs (por la GPU si se puede) y dibuja cada cuadro en el canvas en
// cuanto le toca. No hay MSE ni búferes de segundos: los cuadros esperan solo
// lo necesario para absorber la llegada irregular de la red.
//
// El búfer se ajusta solo: se mide cuándo llega cada cuadro respecto de su
// marca de tiempo; el más rápido de los últimos segundos marca la referencia
// y la espera cubre la dispersión del resto. Por una red pareja queda en unos
// pocos milisegundos; si el servidor manda el video a ráfagas, crece lo justo
// para que la imagen no salte.
//
// El estudio de producción usa el mismo video sin decodificarlo dos veces: si
// lo pide, recibe una copia de cada cuadro por un MessagePort. Cuando el
// monitor no está a la vista (vista Producción) no se dibuja aquí.

const WINDOW_MS = 2000; // muestras que se usan para medir la llegada
const WARMUP_MS = 800; // al conectar llega de golpe el último GOP guardado
const MAX_DELAY_MS = 500;
const LATE_MS = 40; // un cuadro con más atraso se decodifica pero no se dibuja
const MAX_PENDING = 600;

let canvas = null;
let ctx = null;
let session = 0;
let abort = null;
let decoder = null;
let decoderConfig = '';
let lastAvcc = null; // última configuración, para rearmar el decodificador
let decoderErrors = 0;
let waitingKey = true;
let pending = []; // cuadros codificados que esperan su turno: { chunk, dts }
let inFlight = 0; // cuadros enviados al decodificador que todavía no salieron
let samples = []; // { at, offset } con offset = llegada - dts
let offsetMin = 0;
let startedAt = 0;
let delay = 0;
let firstFrame = false;
let debug = false;
let stats = null;
let statsTimer = 0;
let tap = null; // puerto hacia el compositor de producción
let tapOn = false;
let drawOn = true;

function resetStats() {
  stats = { received: 0, decoded: 0, drawn: 0, forwarded: 0, skipped: 0, delayMs: 0, latency: [], width: 0, height: 0, decoderErrors: 0, lastError: '', software: false };
}
resetStats();

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'canvas') {
    canvas = message.canvas;
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  } else if (message.type === 'start') {
    start(message.url);
  } else if (message.type === 'stop') {
    stop();
  } else if (message.type === 'debug') {
    debug = Boolean(message.on);
    stats.latency = [];
  } else if (message.type === 'tap') {
    tap = message.port;
  } else if (message.type === 'tap-on') {
    tapOn = Boolean(message.on);
  } else if (message.type === 'draw') {
    drawOn = Boolean(message.on);
  }
};

function stop() {
  // El compositor deja de mostrar el último cuadro: ya no hay señal.
  if (tapOn && firstFrame) tap?.postMessage({ type: 'end', key: 'pc500' });
  session += 1;
  abort?.abort();
  abort = null;
  clearInterval(statsTimer);
  statsTimer = 0;
  if (decoder && decoder.state !== 'closed') decoder.close();
  decoder = null;
  decoderConfig = '';
  lastAvcc = null;
  decoderErrors = 0;
  pending = [];
  inFlight = 0;
  samples = [];
  waitingKey = true;
  firstFrame = false;
}

function start(url) {
  stop();
  const current = session;
  abort = new AbortController();
  startedAt = performance.now();
  delay = 0;
  resetStats();
  statsTimer = setInterval(() => {
    self.postMessage({ type: 'stats', stats: { ...stats, latency: stats.latency.splice(0) } });
  }, 500);
  read(url, current).catch((error) => {
    if (current === session && error?.name !== 'AbortError') self.postMessage({ type: 'error', message: String(error?.message ?? error) });
  });
  schedule(current);
}

// --- FLV ---

async function read(url, current) {
  const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
  const reader = response.body.getReader();
  let rest = new Uint8Array(0);
  let headerSkipped = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done || current !== session) return;
    const buffer = new Uint8Array(rest.length + value.length);
    buffer.set(rest);
    buffer.set(value, rest.length);
    let offset = 0;
    if (!headerSkipped) {
      // Cabecera FLV (9 bytes) y tamaño del tag anterior (4).
      if (buffer.length < 13) {
        rest = buffer;
        continue;
      }
      offset = 13;
      headerSkipped = true;
    }
    while (buffer.length - offset >= 11) {
      const size = (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
      if (buffer.length - offset < 11 + size + 4) break;
      if ((buffer[offset] & 0x1f) === 9) {
        const dts = (((buffer[offset + 7] << 24) >>> 0) + ((buffer[offset + 4] << 16) | (buffer[offset + 5] << 8) | buffer[offset + 6])) >>> 0;
        onVideoTag(buffer.subarray(offset + 11, offset + 11 + size), dts);
      }
      offset += 11 + size + 4;
    }
    rest = buffer.slice(offset);
  }
}

function onVideoTag(body, dts) {
  if (body.length < 5 || (body[0] & 0x0f) !== 7) return; // solo H.264 (AVC)
  if (body[1] === 0) {
    configure(body.subarray(5));
    waitingKey = true;
    return;
  }
  if (body[1] !== 1) return;
  const key = body[0] >> 4 === 1;
  if (waitingKey && !key) return;
  // Si el decodificador falló, se rearma con la última configuración en el
  // próximo cuadro clave (el servidor no vuelve a mandarla hasta otro STREAM).
  if (key && (!decoder || decoder.state === 'closed') && lastAvcc) configure(lastAvcc);
  waitingKey = false;
  const now = performance.now();
  const cts = (((body[2] << 16) | (body[3] << 8) | body[4]) << 8) >> 8; // con signo, 24 bits
  stats.received += 1;
  sample(now, dts);
  pending.push({ dts, chunk: new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (dts + cts) * 1000, data: body.subarray(5) }) });
  if (pending.length > MAX_PENDING) {
    // El video quedó muy atrás: se descarta hasta el próximo cuadro clave.
    pending = [];
    waitingKey = true;
  }
  feed(now);
}

function configure(avcc) {
  const codec = `avc1.${[avcc[1], avcc[2], avcc[3]].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const description = avcc.slice();
  const id = `${codec}:${description.join(',')}`;
  if (id === decoderConfig && decoder?.state === 'configured') return;
  if (decoder && decoder.state !== 'closed') decoder.close();
  lastAvcc = description;
  decoderConfig = id;
  inFlight = 0;
  pending = [];
  const current = session;
  // El decodificador queda cerrado: se rearma en el próximo cuadro clave. Si
  // la GPU falla dos veces, se pasa a decodificar por software.
  const fail = (instance, error) => {
    if (current !== session || decoder !== instance) return;
    decoderErrors += 1;
    stats.decoderErrors = decoderErrors;
    stats.lastError = String(error?.message ?? error);
    decoder = null;
    decoderConfig = '';
    waitingKey = true;
    inFlight = 0;
    pending = [];
    self.postMessage({ type: 'error', message: `El decodificador falló (${decoderErrors}): ${stats.lastError}` });
  };
  const instance = new VideoDecoder({
    output: (frame) => onFrame(frame, current),
    error: (error) => fail(instance, error),
  });
  decoder = instance;
  stats.software = decoderErrors >= 2;
  try {
    instance.configure({ codec, description, optimizeForLatency: true, hardwareAcceleration: stats.software ? 'prefer-software' : 'no-preference' });
  } catch (error) {
    fail(instance, error);
  }
}

// --- Cuándo toca cada cuadro ---

function sample(now, dts) {
  samples.push({ at: now, offset: now - dts });
  while (samples.length && now - samples[0].at > WINDOW_MS) samples.shift();
  const live = samples.filter((s) => s.at - startedAt > WARMUP_MS);
  const all = live.length >= 10 ? live : samples;
  let min = Infinity;
  for (const s of samples) min = Math.min(min, s.offset);
  const offsets = all.map((s) => s.offset - min).sort((a, b) => a - b);
  const target = Math.min(MAX_DELAY_MS, (offsets[Math.floor(offsets.length * 0.95)] ?? 0) + 4);
  // Sube enseguida para no saltar; baja despacio para no oscilar.
  delay = target > delay ? target : delay - (delay - target) * 0.02;
  stats.delayMs = Math.round(delay);
  offsetMin = min;
}

const dueAt = (ms) => ms + offsetMin + delay;

function feed(now) {
  if (!decoder || decoder.state !== 'configured') return;
  while (pending.length && dueAt(pending[0].dts) <= now) {
    const { chunk } = pending.shift();
    try {
      decoder.decode(chunk);
      inFlight += 1;
    } catch {
      waitingKey = true;
      pending = [];
      return;
    }
  }
}

// Se alimenta al decodificador en cada cuadro de la pantalla. Con la ventana
// oculta no hay cuadros de pantalla: lo hace un temporizador, así el video
// sigue llegando al estudio de producción.
function schedule(current) {
  if (current !== session) return;
  feed(performance.now());
  let raf = 0;
  let timer = 0;
  const next = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    schedule(current);
  };
  raf = requestAnimationFrame(next);
  timer = setTimeout(next, 20);
}

function onFrame(frame, current) {
  if (current !== session || !ctx) {
    frame.close();
    return;
  }
  stats.decoded += 1;
  inFlight = Math.max(0, inFlight - 1);
  // Si viene atrasado y detrás ya hay otro decodificándose, no se dibuja: el
  // siguiente lo reemplaza enseguida (así se alcanza el vivo tras un salto).
  const late = performance.now() - dueAt(frame.timestamp / 1000) > LATE_MS && inFlight > 0;
  if (late) {
    stats.skipped += 1;
    frame.close();
    return;
  }
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  stats.width = width;
  stats.height = height;
  if (tapOn && tap) {
    const copy = frame.clone();
    tap.postMessage({ type: 'frame', key: 'pc500', frame: copy }, [copy]);
    stats.forwarded += 1;
  }
  if (drawOn) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(frame, 0, 0, width, height);
    stats.drawn += 1;
    if (debug && stats.drawn % 6 === 0) readStamp(width);
  }
  frame.close();
  if (!firstFrame) {
    firstFrame = true;
    self.postMessage({ type: 'first-frame', width, height });
  }
}

// Diagnóstico: el emisor de prueba estampa la hora en 32 bloques arriba a la
// izquierda. Se lee lo recién dibujado para medir la latencia de punta a punta.
function readStamp(width) {
  const block = Math.floor(width / 48);
  if (block < 4) return;
  const data = ctx.getImageData(0, 0, 32 * block, block).data;
  let stamp = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    const i = (Math.floor(block / 2) * 32 * block + Math.floor(bit * block + block / 2)) * 4;
    stamp = stamp * 2 + ((data[i] + data[i + 1] + data[i + 2]) / 3 > 128 ? 1 : 0);
  }
  const ms = ((Date.now() % 2 ** 32) - stamp + 2 ** 32) % 2 ** 32;
  if (ms < 30000) stats.latency.push(ms);
}
