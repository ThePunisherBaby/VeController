// Mide la fluidez de la app con video de verdad: latencia de punta a punta,
// cuadros perdidos, tirones de la ventana, respuesta a un clic y CPU.
//
// Arma lo mismo que el modo por defecto con el PC500: un simulador del equipo,
// un servidor RTMP que hace de servidor interno y un emisor de prueba que
// publica solo mientras STREAM está encendido. El emisor estampa la hora en
// cada cuadro y la ventana la lee del video que muestra, así la latencia es la
// de toda la cadena (codificar, RTMP, receptor, reproductor y pantalla).
//
// La app se abre con la ventana visible, como la usa una persona, y se maneja
// desde afuera con el protocolo de depuración de Chromium: así se mide igual
// una versión empaquetada anterior y la actual.
//
// Uso:
//   node scripts/bench-video.mjs                         app desde el código fuente
//   node scripts/bench-video.mjs --app "/ruta/Tenveo Studio.app"
//   node scripts/bench-video.mjs --segundos 20 --perfil 1080p60 --json salida.json
//   node scripts/bench-video.mjs --registro    muestra lo que escriben la app y el emisor
//   node scripts/bench-video.mjs --ajustes     mide con el diálogo de ajustes abierto sobre el video
//   node scripts/bench-video.mjs --produccion  mide la vista Producción: el video pasa por el
//       compositor y la latencia se lee de la salida compuesta
//   node scripts/bench-video.mjs --equipo fe80::…%en0
//       con el PC500 real: enciende STREAM (solo si sus destinos son el servidor
//       interno), mide cuadros, tirones y CPU, y apaga STREAM. No cambia el
//       Preview ni mide la latencia (el video real no lleva la hora estampada).

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import WebSocket from 'ws';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, fallback = '') => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const appBundle = arg('--app');
const seconds = Number(arg('--segundos', '15'));
const jsonOut = arg('--json');
const verbose = process.argv.includes('--registro');
const withSettings = process.argv.includes('--ajustes');
const studioView = process.argv.includes('--produccion');
const device = arg('--equipo');
const output = verbose ? 'inherit' : 'ignore';
const PROFILES = {
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000, gop: 120 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, gop: 60 },
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 3_000_000, gop: 60 },
};
const profileName = arg('--perfil', '1080p60');
const profile = PROFILES[profileName];
if (!profile) {
  console.log(`Perfil desconocido. Opciones: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function until(check, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Todavía no está listo.
    }
    await delay(stepMs);
  }
  return null;
}

// --- CPU por proceso (tiempo de CPU acumulado de la app y sus procesos hijos) ---

function parseCpuTime(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function cpuByType(rootPid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), time: parseCpuTime(match[3]), command: match[4] } : null;
    })
    .filter(Boolean);
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const totals = { principal: 0, gpu: 0, ventana: 0, otros: 0 };
  const root = rows.find((row) => row.pid === rootPid);
  const stack = root ? [root] : [];
  while (stack.length) {
    const row = stack.pop();
    const type = row.pid === rootPid ? 'principal' : /--type=gpu-process/.test(row.command) ? 'gpu' : /--type=renderer/.test(row.command) ? 'ventana' : 'otros';
    totals[type] += row.time;
    stack.push(...(children.get(row.pid) ?? []));
  }
  return totals;
}

// --- Protocolo de depuración de Chromium ---

async function connectPage(port) {
  const target = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((t) => t.type === 'page' && t.url.startsWith('app://'));
  }, 30000, 300);
  if (!target) throw new Error('No apareció la ventana de la app');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let nextId = 1;
  const pending = new Map();
  ws.on('message', (data) => {
    const message = JSON.parse(String(data));
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) handler.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
    else handler.resolve(message.result?.result?.value);
  });
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  return { evaluate, close: () => ws.close() };
}

// Corre en la ventana: mide durante `ms` milisegundos mientras el video se ve.
// La 1.2.0 reproducía con un <video> (mpegts.js); la actual dibuja en un canvas
// desde un worker, que informa sus cuadros y la latencia al dibujar.
const MEASURE = `async (ms, stamped) => {
  const v = document.getElementById('pgm-video');
  const worker = !v;
  if (worker) {
    globalThis.tenveoPgmDebug(stamped);
    globalThis.tenveoPgmLatency = [];
    await new Promise((resolve) => setTimeout(resolve, 600));
    globalThis.tenveoPgmLatency = [];
  }
  const s0 = worker ? { ...globalThis.tenveoPgmStats } : null;
  const q0 = worker ? null : v.getVideoPlaybackQuality();
  const frames = [];
  let running = true;
  let last = 0;
  const tick = (t) => {
    if (last) frames.push(t - last);
    last = t;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let longCount = 0;
  let longTotal = 0;
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longCount += 1;
        longTotal += entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  const block = worker ? 0 : Math.floor(v.videoWidth / 48);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, 32 * block);
  canvas.height = Math.max(1, block);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const latency = [];
  const buffer = [];
  const timer = setInterval(() => {
    if (worker) {
      buffer.push((globalThis.tenveoPgmStats?.delayMs ?? 0) / 1000);
      return;
    }
    if (v.buffered.length) buffer.push(v.buffered.end(v.buffered.length - 1) - v.currentTime);
    if (!stamped) return;
    ctx.drawImage(v, 0, 0, 32 * block, block, 0, 0, 32 * block, block);
    const data = ctx.getImageData(0, 0, 32 * block, block).data;
    let stamp = 0;
    for (let bit = 0; bit < 32; bit += 1) {
      const x = Math.floor(bit * block + block / 2);
      const i = (Math.floor(block / 2) * 32 * block + x) * 4;
      stamp = stamp * 2 + ((data[i] + data[i + 1] + data[i + 2]) / 3 > 128 ? 1 : 0);
    }
    const ms = ((Date.now() % 2 ** 32) - stamp + 2 ** 32) % 2 ** 32;
    if (ms < 30000) latency.push(ms);
  }, 250);
  await new Promise((resolve) => setTimeout(resolve, ms));
  running = false;
  clearInterval(timer);
  observer?.disconnect();
  if (worker) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const s1 = globalThis.tenveoPgmStats;
    globalThis.tenveoPgmDebug(false);
    return {
      latency: globalThis.tenveoPgmLatency.splice(0),
      buffer,
      frames,
      longCount,
      longTotal,
      decoded: s1.decoded - s0.decoded,
      dropped: s1.skipped - s0.skipped,
      size: [s1.width, s1.height],
    };
  }
  const q1 = v.getVideoPlaybackQuality();
  return {
    latency,
    buffer,
    frames,
    longCount,
    longTotal,
    decoded: q1.totalVideoFrames - q0.totalVideoFrames,
    dropped: q1.droppedVideoFrames - q0.droppedVideoFrames,
    size: [v.videoWidth, v.videoHeight],
  };
}`;

// Corre en la ventana, en la vista Producción: el monitor PGM no dibuja y el
// video llega al compositor. La hora estampada se lee de la salida compuesta
// (el programa del PC500 está a pantalla completa en la escena).
const MEASURE_STUDIO = `async (ms) => {
  const s0 = { ...globalThis.tenveoPgmStats };
  const frames = [];
  let running = true;
  let last = 0;
  const tick = (t) => {
    if (last) frames.push(t - last);
    last = t;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let longCount = 0;
  let longTotal = 0;
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longCount += 1;
        longTotal += entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  const k = 1920 / (globalThis.tenveoPgmStats?.width || 1920);
  const block = Math.floor((globalThis.tenveoPgmStats?.width || 1920) / 48);
  const points = Array.from({ length: 32 }, (_, bit) => ({ x: (bit * block + block / 2) * k, y: (block / 2) * k }));
  const latency = [];
  const fps = [];
  const timer = setInterval(async () => {
    fps.push(globalThis.tenveoProductionStats?.fps ?? 0);
    const pixels = await tenveoStudio.probe(points);
    let stamp = 0;
    for (const p of pixels) stamp = stamp * 2 + ((p[0] + p[1] + p[2]) / 3 > 128 ? 1 : 0);
    const delta = ((Date.now() % 2 ** 32) - stamp + 2 ** 32) % 2 ** 32;
    if (delta < 30000) latency.push(delta);
  }, 250);
  await new Promise((resolve) => setTimeout(resolve, ms));
  running = false;
  clearInterval(timer);
  observer?.disconnect();
  const s1 = globalThis.tenveoPgmStats;
  return {
    latency,
    buffer: [],
    frames,
    longCount,
    longTotal,
    decoded: s1.decoded - s0.decoded,
    dropped: s1.skipped - s0.skipped,
    size: [s1.width, s1.height],
    compositorFps: fps,
    forwarded: s1.forwarded - s0.forwarded,
    compositor: globalThis.tenveoProductionStats ?? null,
  };
}`;

// Corre en la ventana: pulsa cámaras en Preview y mide hasta que se pintan.
const CLICKS = `async (rounds) => {
  const times = [];
  for (let i = 0; i < rounds; i += 1) {
    const key = document.querySelector('[data-action="pvw-select"][data-cam="' + (i % 2 ? '3' : '4') + '"]');
    const started = performance.now();
    key.click();
    await new Promise((resolve) => {
      const check = () => (key.classList.contains('is-preview') ? requestAnimationFrame(() => resolve()) : requestAnimationFrame(check));
      requestAnimationFrame(check);
    });
    times.push(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return times;
}`;

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: values.length, mediana: pick(0.5), p95: pick(0.95), max: sorted.at(-1), media: values.reduce((a, b) => a + b, 0) / values.length };
}

// --- Principal ---

const require = createRequire(import.meta.url);
const NodeMediaServer = require('node-media-server');
require('node-media-server/src/core/logger.js').level = 'error';

const [rtmpPort, debugPort] = [await freePort(), await freePort()];
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-bench-srs-'));
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-bench-data-'));
let deviceServer = null;
let pc500 = null;
if (!device) {
  deviceServer = new NodeMediaServer({ bind: '127.0.0.1', rtmp: { port: rtmpPort }, record: { auto: false }, store: { path: storeDir }, webadmin: { enable: false } });
  await deviceServer.run();
  pc500 = await startMockPc500({ ip: '127.0.0.1' });
}
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

const appCommand = appBundle ? path.join(appBundle, 'Contents', 'MacOS', path.basename(appBundle, '.app')) : electronPath;
const appArgs = [...(appBundle ? [] : [projectDir]), `--remote-debugging-port=${debugPort}`];
const appProcess = spawn(appCommand, appArgs, {
  env: device
    ? { ...baseEnv, TENVEO_ETHERNET_IP: device, TENVEO_OBS_HOST: '127.0.0.1', TENVEO_OBS_PORT: '1', TENVEO_USER_DATA: userData }
    : {
        ...baseEnv,
        // La 1.2.0 entiende TENVEO_USB_URL y TENVEO_VIDEO; la actual, la IP y el
        // puerto. Hasta la 1.5.0 la app buscaba OBS: el puerto 1 lo deja apagado.
        TENVEO_USB_URL: `ws://127.0.0.1:${pc500.port}`,
        TENVEO_VIDEO: 'pull',
        TENVEO_ETHERNET_IP: '127.0.0.1',
        TENVEO_PC500_PORT: String(pc500.port),
        TENVEO_OBS_HOST: '127.0.0.1',
        TENVEO_OBS_PORT: '1',
        TENVEO_DISABLE_ADB: '1',
        TENVEO_USER_DATA: userData,
        TENVEO_DEVICE_RTMP_PORT: String(rtmpPort),
      },
  stdio: ['ignore', output, output],
});

let publisher = null;
const follow = setInterval(() => {
  if (pc500?.state.buttons.stream && !publisher) {
    publisher = spawn(electronPath, [path.join(projectDir, 'dev', 'video-publisher.mjs')], {
      env: {
        ...baseEnv,
        PUBLISH_URL: `rtmp://127.0.0.1:${rtmpPort}/live/live2`,
        PUBLISH_WIDTH: String(profile.width),
        PUBLISH_HEIGHT: String(profile.height),
        PUBLISH_FPS: String(profile.fps),
        PUBLISH_BITRATE: String(profile.bitrate),
        PUBLISH_GOP: String(profile.gop),
      },
      stdio: ['ignore', output, output],
    });
  }
}, 100);

let result = null;
let failure = null;
let streamStarted = false;
let pageRef = null;
try {
  const page = await connectPage(debugPort);
  pageRef = page;
  const version = await page.evaluate(`document.title`);
  const enabled = await until(() => page.evaluate(`!document.querySelector('[data-action="start-device-stream"]').disabled`), 20000);
  if (!enabled) throw new Error('El botón Encender STREAM no se activó (con el equipo real, ¿un destino sale a internet?)');
  await page.evaluate(`document.querySelector('[data-action="start-device-stream"]').click()`);
  streamStarted = true;
  const playing = await until(
    () =>
      page.evaluate(
        `(() => { const v = document.getElementById('pgm-video'); if (v) return v.readyState >= 2 && v.currentTime > 1 && !v.hidden; const s = globalThis.tenveoPgmStats; return Boolean(s && s.drawn > 60 && !document.getElementById('pgm-canvas').hidden); })()`,
      ),
    40000,
  );
  if (!playing) {
    const why = await page.evaluate(
      `(() => { const v = document.getElementById('pgm-video'); return JSON.stringify({ video: v && { oculto: v.hidden, readyState: v.readyState, tiempo: v.currentTime, error: v.error && v.error.message }, monitor: globalThis.tenveoPgmStats ?? null, estado: document.getElementById('video-status').textContent, aviso: document.getElementById('pgm-hint')?.textContent }); })()`,
    );
    throw new Error(`El video no llegó al monitor PGM: ${why}`);
  }
  await delay(3000);
  if (studioView) {
    await page.evaluate(`document.getElementById('view-studio').click()`);
    await delay(3000);
  }
  if (withSettings) {
    await page.evaluate(`document.querySelector('[data-action="open-settings"]').click()`);
    await delay(1000);
  }

  const cpuStart = cpuByType(appProcess.pid);
  const wallStart = Date.now();
  const measured = await page.evaluate(studioView ? `(${MEASURE_STUDIO})(${seconds * 1000})` : `(${MEASURE})(${seconds * 1000}, ${!device})`);
  if (studioView) await page.evaluate(`document.getElementById('view-console').click()`);
  const wall = (Date.now() - wallStart) / 1000;
  const cpuEnd = cpuByType(appProcess.pid);
  // Con el equipo real no se toca el Preview.
  const clicks = device ? [] : await page.evaluate(`(${CLICKS})(20)`);
  if (device) {
    await page.evaluate(`document.querySelector('[data-action="stop-device-stream"]').click()`);
    await delay(2000);
    streamStarted = false;
  }
  page.close();

  const cpu = Object.fromEntries(Object.keys(cpuEnd).map((type) => [type, ((cpuEnd[type] - cpuStart[type]) / wall) * 100]));
  const frames = measured.frames;
  result = {
    app: `${appBundle || 'código fuente'}${device ? ` · PC500 real (${device})` : ''}`,
    titulo: version,
    perfil: { nombre: profileName, ...profile },
    segundos: wall,
    latenciaMs: stats(measured.latency),
    bufferS: stats(measured.buffer),
    cuadros: { decodificados: measured.decoded, perdidos: measured.dropped, perdidosPct: measured.decoded ? (measured.dropped / measured.decoded) * 100 : null, tamano: measured.size },
    ventana: {
      fps: frames.length / (frames.reduce((a, b) => a + b, 0) / 1000 || wall),
      intervaloMs: stats(frames),
      tironesPct: frames.length ? (frames.filter((f) => f > 25).length / frames.length) * 100 : null,
      tareasLargas: measured.longCount,
      tareasLargasMs: measured.longTotal,
    },
    clicMs: stats(clicks),
    compositorFps: measured.compositorFps ? { ...stats(measured.compositorFps), min: Math.min(...measured.compositorFps) } : null,
    reenviados: measured.forwarded ?? null,
    compositor: measured.compositor ?? null,
    cpuPct: { ...cpu, total: Object.values(cpu).reduce((a, b) => a + b, 0) },
  };
} catch (error) {
  failure = error;
}

clearInterval(follow);
publisher?.kill('SIGKILL');
if (device && streamStarted && pageRef) {
  // Si algo falló a mitad de camino, STREAM se apaga igual antes de cerrar.
  await pageRef.evaluate(`document.querySelector('[data-action="stop-device-stream"]').click()`).catch(() => {});
  await delay(2000);
}
appProcess.kill('SIGTERM');
await delay(1500);
appProcess.kill('SIGKILL');
await Promise.allSettled([pc500?.close(), deviceServer?.stop()]);
await fs.rm(storeDir, { recursive: true, force: true });
await fs.rm(userData, { recursive: true, force: true });

if (failure) {
  console.error('Falló:', failure.message);
  process.exit(1);
}
const r = result;
const fmt = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits));
console.log(`App: ${r.app}`);
console.log(`Video: ${r.perfil.nombre} (${r.cuadros.tamano.join('x')}), ${fmt(r.segundos)} s medidos${withSettings ? ', con Ajustes abierto' : ''}${studioView ? ', en la vista Producción' : ''}`);
console.log(`Latencia de punta a punta: mediana ${fmt(r.latenciaMs?.mediana, 0)} ms · p95 ${fmt(r.latenciaMs?.p95, 0)} ms · máx ${fmt(r.latenciaMs?.max, 0)} ms`);
console.log(`Búfer del reproductor (o espera del monitor): mediana ${fmt(r.bufferS?.mediana, 2)} s · máx ${fmt(r.bufferS?.max, 2)} s`);
console.log(`Cuadros: ${r.cuadros.decodificados} decodificados · ${r.cuadros.perdidos} perdidos (${fmt(r.cuadros.perdidosPct)} %)`);
console.log(`Ventana: ${fmt(r.ventana.fps)} cuadros/s · intervalo p95 ${fmt(r.ventana.intervaloMs?.p95)} ms · tirones ${fmt(r.ventana.tironesPct)} % · tareas largas ${r.ventana.tareasLargas} (${fmt(r.ventana.tareasLargasMs, 0)} ms)`);
console.log(`Clic → Preview pintado: mediana ${fmt(r.clicMs?.mediana)} ms · p95 ${fmt(r.clicMs?.p95)} ms`);
if (r.compositorFps) console.log(`Compositor: mediana ${fmt(r.compositorFps.mediana, 0)} cuadros/s · mínimo ${fmt(r.compositorFps.min, 0)} · cuadros del PC500 recibidos ${r.reenviados} · ${JSON.stringify(r.compositor)}`);
console.log(`CPU (% de un núcleo): total ${fmt(r.cpuPct.total, 0)} · principal ${fmt(r.cpuPct.principal, 0)} · GPU ${fmt(r.cpuPct.gpu, 0)} · ventana ${fmt(r.cpuPct.ventana, 0)} · otros ${fmt(r.cpuPct.otros, 0)}`);
if (jsonOut) await fs.writeFile(jsonOut, `${JSON.stringify(r, null, 2)}\n`);
process.exit(0);
