// Prueba de humo del video por red, de punta a punta:
//   1. Abre Tenveo Studio en modo "el PC500 transmite a esta Mac".
//   2. Un emisor de prueba publica por RTMP una carta de ajuste en H.264,
//      igual que el PC500 cuando transmite.
//   3. La app recibe el stream, lo reproduce en el monitor PGM y guarda una captura.
//
// Con --pull prueba el modo por defecto, como con el equipo real: un servidor
// RTMP hace de servidor interno del PC500, la app pulsa "Encender STREAM", el
// emisor publica solo mientras STREAM está encendido y, al terminar, la app
// apaga STREAM.
//
// Uso: npm run smoke:video [-- --pull] [-- ruta/de/la/captura.png]
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
const pull = process.argv.includes('--pull');
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

// En --pull el PC500 simulado está en 127.0.0.1: sus destinos de STREAM apuntan
// a rtmp://127.0.0.1:1935/live/, que aquí es el servidor RTMP de prueba.
const pc500 = await startMockPc500(pull ? { ip: '127.0.0.1' } : {});
const obs = await startMockObs();
const rtmpPort = await freePort();
const key = pull ? 'live2' : 'prueba_video';
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

let deviceServer = null;
let storeDir = null;
if (pull) {
  const require = createRequire(import.meta.url);
  const NodeMediaServer = require('node-media-server');
  require('node-media-server/src/core/logger.js').level = 'error';
  storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-video-srs-'));
  deviceServer = new NodeMediaServer({
    bind: '127.0.0.1',
    rtmp: { port: rtmpPort },
    record: { auto: false },
    store: { path: storeDir },
    webadmin: { enable: false },
  });
  await deviceServer.run();
}

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
    TENVEO_USB_URL: `ws://127.0.0.1:${pc500.port}`,
    TENVEO_OBS_HOST: '127.0.0.1',
    TENVEO_OBS_PORT: String(obs.port),
    TENVEO_DISABLE_ADB: '1',
    TENVEO_USER_DATA: userData,
    ...(pull
      ? {
          TENVEO_VIDEO: 'pull',
          TENVEO_DEVICE_RTMP_PORT: String(rtmpPort),
          TENVEO_SMOKE_CLICKS: '[data-action="tab"][data-tab="device"]|[data-action="start-device-stream"]',
          TENVEO_SMOKE_STOP_STREAM: '1',
        }
      : {
          TENVEO_VIDEO: 'push',
          TENVEO_VIDEO_KEY: key,
          TENVEO_RTMP_PORT: String(rtmpPort),
          TENVEO_RTMP_HOST: '127.0.0.1',
          TENVEO_SMOKE_CLICKS: '[data-action="tab"][data-tab="device"]',
        }),
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

// En --pull el emisor sigue a STREAM, como el codificador del PC500.
let streamPresses = 0;
const followStream = pull
  ? setInterval(() => {
      streamPresses = pc500.received.filter((message) => message.stream === 1).length;
      if (pc500.state.buttons.stream && !publisher) startPublisher();
      if (!pc500.state.buttons.stream && publisher) stopPublisher();
    }, 100)
  : null;
if (!pull) startPublisher();

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

const element = snapshot?.videoElement;
const checks = [
  ['la app terminó sin errores', code === 0],
  ['el receptor quedó recibiendo', snapshot?.extras?.video?.state === 'receiving'],
  ['el monitor PGM tiene imagen', Boolean(element && element.readyState >= 2)],
  ['la imagen es de 640 x 360', element?.width === 640 && element?.height === 360],
  ['el video avanza', Number(element?.time) > 0.3],
];
if (pull) {
  checks.push(
    ['leyó el destino 2 del servidor interno', snapshot?.extras?.video?.source === `rtmp://127.0.0.1:${rtmpPort}/live/live2`],
    ['la app encendió y apagó STREAM', streamPresses === 2],
    ['STREAM quedó apagado', pc500.state.buttons.stream === false],
  );
}

await Promise.allSettled([pc500.close(), obs.close(), deviceServer?.stop()]);
await fs.rm(userData, { recursive: true, force: true });
if (storeDir) await fs.rm(storeDir, { recursive: true, force: true });

for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
const failed = checks.some(([, ok]) => !ok);
console.log(failed ? `Prueba de video FALLÓ (código ${code})` : `Prueba de video OK. Captura: ${out}`);
process.exit(failed ? 1 : 0);
