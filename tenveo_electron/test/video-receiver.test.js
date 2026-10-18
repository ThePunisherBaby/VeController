import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import AMF from '../src/main/vendor/node-media-server/protocol/amf.js';
import RtmpClient from '../src/main/vendor/node-media-server/protocol/rtmp_client.js';
import { FlvRelay, VideoReceiver, videoInfoFromPacket } from '../src/main/video-receiver.js';
import { sleep, until } from './helpers.js';

const require = createRequire(import.meta.url);

// Paquetes sintéticos con la forma de H.264 y AAC dentro de FLV.
const VIDEO_HEADER = [0x17, 0x00, 0, 0, 0, 0x01, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x42, 0xc0, 0x1f, 0x01, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80];
const KEYFRAME = [0x17, 0x01, 0, 0, 0, 0, 0, 0, 5, 0x65, 0x88, 0x84, 0x00, 0x33];
const INTERFRAME = [0x27, 0x01, 0, 0, 0, 0, 0, 0, 4, 0x41, 0x9a, 0x22, 0x11];
const AUDIO_HEADER = [0xaf, 0x00, 0x12, 0x10];
const AUDIO_FRAME = [0xaf, 0x01, 0x21, 0x10, 0x04];
// Metadatos como los del PC500 real (SRS): 1080p a 60 cuadros con audio AAC.
const META = [...AMF.amf0Encode(['onMetaData', { width: 1920, height: 1080, framerate: 60, videocodecid: 7, audiocodecid: 10 }])];
const ON_STATUS = [...AMF.amf0Encode(['onStatus', { code: 'NetStream.Data.Start' }])];

function packet(codecType, dts, bytes, flags = 0) {
  const data = Buffer.from(bytes);
  return { codec_type: codecType, codec_id: 0, dts, pts: dts, size: data.length, data, flags, duration: 0, offset: 0 };
}

const STREAM = [
  packet(9, 0, VIDEO_HEADER),
  packet(8, 0, AUDIO_HEADER),
  packet(9, 0, KEYFRAME),
  packet(8, 20, AUDIO_FRAME),
  packet(9, 33, INTERFRAME),
];

async function publish(url, packets = STREAM) {
  const client = new RtmpClient();
  await client.connect(url);
  await client.sendConnect();
  await client.sendCreateStream();
  await client.sendPublish(client.urlInfo.streamName);
  for (const p of packets) client.sendPacket(p);
  return client;
}

// Lee el FLV del reproductor local hasta tener los bytes pedidos.
async function readFlv(url, minBytes, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const chunks = [];
  let total = 0;
  try {
    const response = await fetch(url, { signal: controller.signal });
    assert.equal(response.headers.get('content-type'), 'video/x-flv');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const reader = response.body.getReader();
    while (total < minBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    controller.abort();
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks);
}

function parseFlv(buffer) {
  assert.equal(buffer.subarray(0, 3).toString(), 'FLV');
  const tags = [];
  let offset = 13;
  while (offset + 11 <= buffer.length) {
    const type = buffer[offset];
    const size = buffer.readUIntBE(offset + 1, 3);
    if (offset + 11 + size + 4 > buffer.length) break;
    tags.push({ type, data: [...buffer.subarray(offset + 11, offset + 11 + size)] });
    offset += 11 + size + 4;
  }
  return tags;
}

const flvSize = (packets) => 13 + packets.reduce((sum, p) => sum + 11 + p.size + 4, 0);

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('el relevo FLV entrega cabeceras y el último GOP a quien llega tarde', () => {
  const relay = new FlvRelay();
  relay.push(packet(18, 0, META, 5));
  relay.push(packet(9, 0, VIDEO_HEADER, 2));
  relay.push(packet(8, 0, AUDIO_HEADER, 0));
  relay.push(packet(9, 0, KEYFRAME, 3));
  relay.push(packet(9, 33, INTERFRAME, 4));
  relay.push(packet(9, 66, KEYFRAME, 3));
  relay.push(packet(8, 70, AUDIO_FRAME, 1));

  const received = [];
  let ended = false;
  relay.subscribe({ write: (tag) => received.push(tag), end: () => { ended = true; } });
  // Cabecera FLV, metadatos, audio, video y el GOP desde el último cuadro clave.
  assert.equal(received.length, 6);
  assert.equal(received[0].subarray(0, 3).toString(), 'FLV');
  assert.deepEqual([...received.slice(1).map((tag) => tag[0])], [18, 8, 9, 9, 8]);
  assert.equal(relay.hasVideo, true);

  relay.push(packet(9, 100, INTERFRAME, 4));
  assert.equal(received.length, 7);
  // Otros mensajes de datos se reparten, pero no reemplazan a los metadatos.
  relay.push(packet(18, 110, ON_STATUS, 5));
  const late = [];
  relay.subscribe({ write: (tag) => late.push(tag), end: () => {} });
  assert.deepEqual([...late[1].subarray(11, 11 + META.length)], META);
  relay.reset();
  assert.equal(ended, true);
  assert.equal(relay.hasVideo, false);
  assert.equal(relay.subscriberCount, 0);
});

test('lee resolución y cuadros por segundo de los metadatos', () => {
  assert.deepEqual(videoInfoFromPacket(packet(18, 0, META, 5)), { width: 1920, height: 1080, fps: 60, audio: true });
  assert.equal(videoInfoFromPacket(packet(18, 0, ON_STATUS, 5)), null);
  assert.equal(videoInfoFromPacket(packet(9, 0, KEYFRAME, 3)), null);
});

test('lee el servidor RTMP del equipo', async (t) => {
  const NodeMediaServer = require('node-media-server');
  const nmsLogger = require('node-media-server/src/core/logger.js');
  const port = await freePort();
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-nms-'));
  const nms = new NodeMediaServer({
    bind: '127.0.0.1',
    rtmp: { port },
    record: { auto: false },
    store: { path: storeDir },
    webadmin: { enable: false },
  });
  nmsLogger.level = 'error';
  await nms.run();

  const receiver = new VideoReceiver();
  t.after(async () => {
    await receiver.close();
    await nms.stop();
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  // Hace de PC500: publica en su propio servidor RTMP.
  const source = await publish(`rtmp://127.0.0.1:${port}/live/pc500`);
  t.after(() => source.disconnect());
  let dts = 66;
  const keepAlive = setInterval(() => {
    dts += 33;
    source.sendPacket(packet(9, dts, INTERFRAME));
  }, 50);
  t.after(() => clearInterval(keepAlive));

  const status = await receiver.configure({ mode: 'pull', url: `rtmp://127.0.0.1:${port}/live/pc500` });
  assert.equal(status.mode, 'pull');
  await until(() => receiver.status.state === 'receiving', 5000);
  await until(() => receiver.relay.hasVideo, 5000);

  const tags = parseFlv(await readFlv(receiver.status.playUrl, flvSize(STREAM.slice(0, 3))));
  const video = tags.filter((tag) => tag.type === 9).map((tag) => tag.data);
  assert.deepEqual(video[0], VIDEO_HEADER);
  assert.deepEqual(video[1], KEYFRAME);
});

test('espera con STREAM apagado, detecta el corte y vuelve solo', async (t) => {
  const NodeMediaServer = require('node-media-server');
  const nmsLogger = require('node-media-server/src/core/logger.js');
  const port = await freePort();
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-nms-'));
  const nms = new NodeMediaServer({
    bind: '127.0.0.1',
    rtmp: { port },
    record: { auto: false },
    store: { path: storeDir },
    webadmin: { enable: false },
  });
  nmsLogger.level = 'error';
  await nms.run();
  const receiver = new VideoReceiver({ stallMs: 800 });
  const timers = new Set();
  t.after(async () => {
    for (const timer of timers) clearInterval(timer);
    await receiver.close();
    await nms.stop();
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  // Como el PC500: su servidor acepta al lector aunque STREAM esté apagado.
  await receiver.configure({ mode: 'pull', url: `rtmp://127.0.0.1:${port}/live/live2` });
  await until(() => receiver.status.state === 'waiting', 5000);

  const startStream = async () => {
    const source = await publish(`rtmp://127.0.0.1:${port}/live/live2`, []);
    source.sendMetaData({ width: 1920, height: 1080, framerate: 60 });
    for (const p of STREAM) source.sendPacket(p);
    let dts = 66;
    const timer = setInterval(() => {
      dts += 33;
      source.sendPacket(packet(9, dts, INTERFRAME));
    }, 50);
    timers.add(timer);
    return () => {
      clearInterval(timer);
      source.disconnect();
    };
  };

  let stopStream = await startStream();
  await until(() => receiver.status.state === 'receiving' && receiver.relay.hasVideo, 5000);
  await until(() => receiver.status.info?.width === 1920, 5000);
  assert.equal(receiver.status.info.fps, 60);

  // STREAM apagado: la conexión sigue, pero sin paquetes es "esperando".
  stopStream();
  await until(() => receiver.status.state === 'waiting', 6000);
  assert.equal(receiver.relay.hasVideo, false);
  assert.equal(receiver.status.info, null);

  stopStream = await startStream();
  await until(() => receiver.status.state === 'receiving' && receiver.relay.hasVideo, 8000);
  stopStream();
});

test('apagar el receptor corta el video y deja de intentar', async () => {
  const receiver = new VideoReceiver();
  await receiver.configure({ mode: 'pull', url: 'rtmp://127.0.0.1:1/live/live2' });
  assert.equal(receiver.status.mode, 'pull');
  const url = receiver.status.playUrl;
  await receiver.stop();
  assert.equal(receiver.status.state, 'off');
  assert.equal(receiver.status.playUrl, '');
  await receiver.close();
  await assert.rejects(fetch(url));
});
