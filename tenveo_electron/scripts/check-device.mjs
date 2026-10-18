// Diagnóstico de un PC500 real con el mismo código de red de la app.
//
// Uso:
//   node scripts/check-device.mjs <ip-o-fe80::…%en0>
//   node scripts/check-device.mjs <dirección> --prueba-preview 5
//   node scripts/check-device.mjs <dirección> --prueba-video 10
//   node scripts/check-device.mjs <dirección> --prueba-video 10 --rtmp 127.0.0.1:19350 [--clave live2]
//
// Sin opciones solo lee: conexión, latencia y estado. Con --prueba-preview N
// pone otra cámara en Preview y la devuelve a la original N veces, midiendo
// cuánto tarda el equipo en confirmar cada comando. El Preview no sale al aire
// y la prueba deja la cámara que estaba.
//
// Con --prueba-video S lee S segundos del video del servidor RTMP interno del
// PC500. Si STREAM 1 está apagado y apunta a ese servidor interno, lo enciende
// para la prueba y lo apaga al terminar. Si apunta a otro servidor (YouTube,
// etc.) no lo toca, porque encenderlo saldría al aire. --rtmp lee el video por
// otra ruta, por ejemplo un reenvío de adb al puerto 1935 del equipo.

import http from 'node:http';
import { TenveoService, hostForUrl } from '../src/core/tenveo-service.js';
import { CAMERAS, channelMode, deviceStreamServer } from '../src/core/pc500-protocol.js';
import { LowLatencyWebSocket } from '../src/main/net-websocket.js';
import { VideoReceiver } from '../src/main/video-receiver.js';
import AMF from '../src/main/vendor/node-media-server/protocol/amf.js';

const host = process.argv[2];
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? Number(process.argv[index + 1] || fallback) : 0;
};
const rounds = option('--prueba-preview', 3);
const videoSeconds = option('--prueba-video', 10);
const textOption = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? String(process.argv[index + 1] ?? '') : '';
};
const rtmpRoute = textOption('--rtmp');
const keyOverride = textOption('--clave');
if (!host) {
  console.log('Uso: node scripts/check-device.mjs <dirección> [--prueba-preview N] [--prueba-video S]');
  process.exit(1);
}

const service = new TenveoService({ WebSocketImpl: LowLatencyWebSocket, heartbeatMs: 500 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = (predicate, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    if (predicate(service.state)) return resolve(service.state);
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('El equipo no respondió a tiempo'));
    }, timeoutMs);
    const unsubscribe = service.onChange((state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      }
    });
  });

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { muestras: values.length, mediana: pick(0.5), p90: pick(0.9), max: sorted.at(-1) };
};

async function waitUntil(check, timeoutMs, stepMs = 200) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await check()) return performance.now() - start;
    await delay(stepMs);
  }
  return null;
}

async function previewTest() {
  const label = (id) => CAMERAS.find((c) => c.id === id)?.name ?? id;
  const original = service.state.pvw;
  const other = CAMERAS.map((c) => c.id).find((id) => id !== original && id !== service.state.pgm);
  const times = [];
  for (let i = 0; i < rounds; i += 1) {
    for (const target of [other, original]) {
      const sent = performance.now();
      service.selectPreview(target);
      await waitFor((s) => s.pvw === target, 3000);
      times.push(performance.now() - sent);
      await delay(150);
    }
  }
  const s = stats(times.map((t) => Math.round(t * 10) / 10));
  console.log(`Prueba de mando: ${times.length} cambios de Preview confirmados por el equipo`);
  console.log(`  comando → confirmación: mediana ${s.mediana} ms · p90 ${s.p90} ms · máx ${s.max} ms`);
  console.log(`  Preview devuelto a ${label(service.state.pvw)} (estaba en ${label(original)})`);
}

// Mide lo que llega del servidor RTMP del PC500, tal como lo recibe la app.
function watchVideo(receiver) {
  const info = { firstVideoMs: null, firstKeyMs: null, frames: 0, keyframes: 0, bytes: 0, audio: 0, firstDts: null, lastDts: null, codec: '', meta: null, arrivals: [] };
  const started = performance.now();
  const relay = receiver.relay;
  const push = relay.push.bind(relay);
  relay.push = (packet) => {
    if (packet.codec_type === 9) {
      if (packet.flags === 2) info.codec = { 7: 'H.264', 12: 'H.265' }[packet.codec_id] ?? `códec ${packet.codec_id}`;
      if (packet.flags === 3 || packet.flags === 4) {
        info.firstVideoMs ??= performance.now() - started;
        if (packet.flags === 3) {
          info.keyframes += 1;
          info.firstKeyMs ??= performance.now() - started;
        }
        info.frames += 1;
        info.bytes += packet.size;
        info.firstDts ??= packet.dts;
        info.lastDts = packet.dts;
        info.arrivals.push({ at: performance.now(), dts: packet.dts });
      }
    } else if (packet.codec_type === 8 && packet.flags === 1) {
      info.audio += 1;
    } else if (packet.codec_type === 18) {
      try {
        info.meta = AMF.decodeAmf0Data(packet.data).dataObj ?? info.meta;
      } catch {
        // Metadatos ilegibles: no son necesarios para ver el video.
      }
    }
    push(packet);
  };
  return info;
}

// Lee el FLV local como lo haría la ventana de la app.
function readPlayUrl(url) {
  const result = { bytes: 0, signature: '' };
  const req = http.get(url, (res) => {
    res.on('data', (chunk) => {
      if (!result.signature) result.signature = chunk.subarray(0, 3).toString('latin1');
      result.bytes += chunk.length;
    });
  });
  req.on('error', () => {});
  return { result, close: () => req.destroy() };
}

async function videoTest(address) {
  // Dónde se lee el RTMP: directo en el equipo o por la ruta que se indique.
  const [rtmpHost, rtmpPort] = rtmpRoute ? [rtmpRoute.replace(/:\d+$/, ''), Number(/:(\d+)$/.exec(rtmpRoute)?.[1] || 1935)] : [address, 1935];
  const raw = service.state.raw;
  const ownIp = service.state.device.ip;
  const server = String(raw['stream-1-server'] ?? '');
  const key = keyOverride || String(raw['stream-1-key'] ?? '');
  console.log(`STREAM 1 del equipo: ${server || '—'} · clave ${raw['stream-1-key'] || '—'}${keyOverride ? ` (se lee la clave ${keyOverride})` : ''}`);
  if (!deviceStreamServer(server, ownIp) || !key) {
    console.log('  apunta a un servidor externo: la prueba no lo enciende para no salir al aire.');
    return;
  }

  const streaming = () => service.state.device.streamTime && service.state.device.streamTime !== '00:00:00';
  const wasOn = service.isButtonOn('stream') || streaming();
  const pressed = performance.now();
  if (!wasOn) {
    console.log('  STREAM 1 apagado: se enciende para la prueba (va al servidor interno del equipo).');
    service.pressButton('stream');
  } else {
    console.log('  STREAM 1 ya estaba encendido: se lee sin tocarlo.');
  }

  const receiver = new VideoReceiver();
  let player = null;
  try {
    const live = await waitUntil(() => service.isButtonOn('stream'), 5000, 50);
    console.log(live === null ? '  el equipo no confirmó STREAM 1 encendido.' : `  el equipo confirmó STREAM 1 encendido a los ${Math.round(performance.now() - pressed)} ms`);

    const url = `rtmp://${hostForUrl(rtmpHost)}:${rtmpPort}/live/${key}`;
    console.log(`  leyendo ${url}`);
    const info = watchVideo(receiver);
    await receiver.configure({ mode: 'pull', url, tcUrl: `rtmp://${ownIp}:1935/live` });
    player = readPlayUrl(receiver.playUrl);
    const gotKey = await waitUntil(() => info.keyframes > 0, 20000, 100);
    if (gotKey === null) {
      console.log(`  no llegó video en 20 s (${receiver.status.error || receiver.status.state}).`);
      return;
    }
    console.log(`  primer cuadro clave a los ${Math.round(performance.now() - pressed)} ms de pulsar (${Math.round(info.firstKeyMs)} ms desde que la app empezó a leer)`);
    const before = { frames: info.frames, bytes: info.bytes, dts: info.lastDts, keyframes: info.keyframes, audio: info.audio };
    await delay(videoSeconds * 1000);
    const seconds = (info.lastDts - before.dts) / 1000;
    const fps = (info.frames - before.frames) / seconds;
    const mbps = ((info.bytes - before.bytes) * 8) / seconds / 1e6;
    const gop = (info.frames - before.frames) / Math.max(1, info.keyframes - before.keyframes);
    const meta = info.meta ?? {};
    const size = meta.width && meta.height ? `${meta.width}x${meta.height}` : 'sin dato';
    console.log(`  video: ${info.codec || '—'} · ${size} · ${fps.toFixed(1)} cuadros/s · ${mbps.toFixed(2)} Mbit/s · cuadro clave cada ${gop.toFixed(0)} cuadros`);
    console.log(`  audio: ${info.audio - before.audio > 0 ? `${info.audio - before.audio} paquetes en ${seconds.toFixed(1)} s` : 'no trae'}`);
    // Cómo llegan los cuadros: si el servidor los junta y los manda a ráfagas,
    // el monitor tiene que esperar el largo de una ráfaga para no saltar.
    const recent = info.arrivals.slice(-Math.round(videoSeconds * 50));
    const offsets = recent.map((a) => a.at - a.dts);
    const min = Math.min(...offsets);
    const spread = offsets.map((o) => o - min).sort((a, b) => a - b);
    const gaps = recent.slice(1).map((a, i) => a.at - recent[i].at);
    const bursts = gaps.filter((g) => g > 50);
    console.log(
      `  llegada: dispersión p50 ${spread[Math.floor(spread.length * 0.5)].toFixed(0)} ms · p95 ${spread[Math.floor(spread.length * 0.95)].toFixed(0)} ms · ` +
        `${bursts.length} pausas de más de 50 ms (mediana ${bursts.length ? bursts.sort((a, b) => a - b)[Math.floor(bursts.length / 2)].toFixed(0) : 0} ms)`,
    );
    if (Object.keys(meta).length) console.log('  metadatos del equipo:', JSON.stringify(meta));
    console.log(`  FLV local para la ventana: ${player.result.signature === 'FLV' ? 'ok' : 'sin datos'} · ${(player.result.bytes / 1e6).toFixed(2)} MB leídos`);
  } finally {
    player?.close();
    await receiver.close();
    if (!wasOn && service.isButtonOn('stream')) {
      service.pressButton('stream');
      const offMs = await waitUntil(() => !service.isButtonOn('stream') && !streaming(), 10000, 100);
      console.log(
        offMs === null
          ? '  ATENCIÓN: el equipo sigue con STREAM 1 encendido; apágalo desde el panel.'
          : `  STREAM 1 apagado otra vez (confirmado a los ${Math.round(offMs)} ms).`,
      );
    }
  }
}

try {
  const started = performance.now();
  service.setEthernetIp(host);
  service.start();
  const state = await waitFor((s) => s.connection === 'ethernet' && Object.keys(s.raw).length > 0, 8000);
  const connectMs = performance.now() - started;

  const latencies = [];
  const unsubscribe = service.onChange((s) => {
    if (Number.isFinite(s.latencyMs)) latencies.push(s.latencyMs);
  });
  await delay(3000);
  unsubscribe();

  const label = (id) => CAMERAS.find((c) => c.id === id)?.name ?? id;
  console.log(`Conectado a ${state.endpoint} en ${connectMs.toFixed(0)} ms`);
  console.log(`Equipo: ${state.device.version || '—'} · IP propia ${state.device.ip || '—'}`);
  console.log(`Latencia (ping): ${latencies.length ? `${stats(latencies).mediana} ms de mediana` : 'el equipo no contesta pings'}`);
  console.log(`Al aire: ${label(state.pgm)} · Preview: ${label(state.pvw)}`);
  console.log(
    'Audio:',
    ['pgm', 'in1', 'in2', 'in3', 'in4', 'mic1'].map((ch) => `${ch} ${state.volumes[ch]} dB ${channelMode(state, ch)}`).join(' · '),
  );

  if (rounds > 0) await previewTest();
  if (videoSeconds > 0) await videoTest(host);
  service.stop();
  process.exit(0);
} catch (error) {
  console.error('Falló:', error.message);
  service.stop();
  process.exit(1);
}
