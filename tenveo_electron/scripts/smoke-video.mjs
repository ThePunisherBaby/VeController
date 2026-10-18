// Prueba de humo del video, de punta a punta y como con el equipo real:
//   1. Un servidor RTMP hace de servidor interno del PC500 y el simulador del
//      equipo tiene sus dos destinos de STREAM en ese servidor.
//   2. La app pulsa "Encender STREAM" y un emisor de prueba publica una carta de
//      ajuste en H.264 solo mientras STREAM está encendido.
//   3. La app la toma por la red, la muestra en el monitor PGM, guarda una
//      captura y apaga STREAM al terminar.
//
// Uso: npm run smoke:video [-- ruta/de/la/captura.png]
// Con TENVEO_SMOKE_APP se prueba una app empaquetada en vez del código fuente.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockObs } from '../dev/mock-obs.js';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const out = path.resolve(outArg || path.join(os.tmpdir(), `tenveo-video-${Date.now()}.png`));
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-video-data-'));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// El PC500 simulado está en 127.0.0.1: sus destinos de STREAM apuntan a
// rtmp://127.0.0.1:1935/live/, que aquí es el servidor RTMP de prueba.
const pc500 = await startMockPc500({ ip: '127.0.0.1' });
const obs = await startMockObs();
const rtmpPort = await freePort();
const key = 'live2';
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

const require = createRequire(import.meta.url);
const NodeMediaServer = require('node-media-server');
require('node-media-server/src/core/logger.js').level = 'error';
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-video-srs-'));
const deviceServer = new NodeMediaServer({
  bind: '127.0.0.1',
  rtmp: { port: rtmpPort },
  record: { auto: false },
  store: { path: storeDir },
  webadmin: { enable: false },
});
await deviceServer.run();

const pipe = (child, tag) => {
  child.stdout.on('data', (chunk) => process.stdout.write(`${tag} ${chunk}`));
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (!/gl_display|gl_initializer|viz_main_impl/.test(text)) process.stderr.write(`${tag} ${text}`);
  });
};

const packaged = process.env.TENVEO_SMOKE_APP;
const appCommand = packaged ? path.join(packaged, 'Contents', 'MacOS', path.basename(packaged, '.app')) : electronPath;
const appProcess = spawn(appCommand, packaged ? [] : [projectDir], {
  env: {
    ...baseEnv,
    TENVEO_ETHERNET_IP: '127.0.0.1',
    TENVEO_PC500_PORT: String(pc500.port),
    TENVEO_OBS_HOST: '127.0.0.1',
    TENVEO_OBS_PORT: String(obs.port),
    TENVEO_DISABLE_ADB: '1',
    TENVEO_USER_DATA: userData,
    TENVEO_DEVICE_RTMP_PORT: String(rtmpPort),
    TENVEO_SMOKE_CLICKS: '[data-action="tab"][data-tab="device"]|[data-action="start-device-stream"]',
    TENVEO_SMOKE_STOP_STREAM: '1',
    TENVEO_SMOKE_SHOT: out,
    TENVEO_SMOKE_WAIT_VIDEO: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
pipe(appProcess, '[app]');

let publisher = null;
const startPublisher = () => {
  publisher = spawn(electronPath, [path.join(projectDir, 'dev', 'video-publisher.mjs')], {
    env: { ...baseEnv, PUBLISH_URL: `rtmp://127.0.0.1:${rtmpPort}/live/${key}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe(publisher, '[emisor]');
};
const stopPublisher = () => {
  publisher?.kill();
  publisher = null;
};

// El emisor sigue a STREAM, como el codificador del PC500.
let streamPresses = 0;
const followStream = setInterval(() => {
  streamPresses = pc500.received.filter((message) => message.stream === 1).length;
  if (pc500.state.buttons.stream && !publisher) startPublisher();
  if (!pc500.state.buttons.stream && publisher) stopPublisher();
}, 100);

const timeout = setTimeout(() => appProcess.kill('SIGKILL'), 90000);
const code = await new Promise((resolve) => appProcess.on('exit', (exitCode) => resolve(exitCode)));
clearTimeout(timeout);
clearInterval(followStream);
stopPublisher();

let snapshot = null;
try {
  snapshot = JSON.parse(await fs.readFile(out.replace(/\.png$/i, '.json'), 'utf8'));
} catch {
  // Sin captura: la app no terminó la prueba.
}

const monitor = snapshot?.monitor;
const checks = [
  ['la app terminó sin errores', code === 0],
  ['el receptor quedó recibiendo', snapshot?.extras?.video?.state === 'receiving'],
  ['el monitor PGM dibujó el video', Number(monitor?.drawn) > 10],
  ['la imagen es de 640 x 360', monitor?.width === 640 && monitor?.height === 360],
  ['leyó el destino 2 del servidor interno', snapshot?.extras?.video?.source === `rtmp://127.0.0.1:${rtmpPort}/live/live2`],
  ['la app encendió y apagó STREAM', streamPresses === 2],
  ['STREAM quedó apagado', pc500.state.buttons.stream === false],
];

await Promise.allSettled([pc500.close(), obs.close(), deviceServer.stop()]);
await fs.rm(userData, { recursive: true, force: true });
await fs.rm(storeDir, { recursive: true, force: true });

for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
const failed = checks.some(([, ok]) => !ok);
console.log(failed ? `Prueba de video FALLÓ (código ${code})` : `Prueba de video OK. Captura: ${out}`);
process.exit(failed ? 1 : 0);
