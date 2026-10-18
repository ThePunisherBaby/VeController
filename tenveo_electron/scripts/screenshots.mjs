// Capturas de la interfaz en sus estados principales, para revisar el diseño:
// cada pestaña con video en el monitor PGM, el diálogo de ajustes, sin conexión
// y la ventana en su tamaño mínimo. Usa los simuladores del PC500 y de OBS, un
// servidor RTMP de prueba y el emisor de prueba, como npm run smoke:video.
//
// Uso: node scripts/screenshots.mjs [carpeta] [--solo 7,8]   (por defecto, una carpeta temporal)
// Con TENVEO_SMOKE_APP se captura una app empaquetada.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockObs } from '../dev/mock-obs.js';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const soloIndex = process.argv.indexOf('--solo');
const only = soloIndex > -1 ? String(process.argv[soloIndex + 1] ?? '').split(',') : null;
const folder = process.argv.slice(2).find((arg, i, list) => !arg.startsWith('--') && list[i - 1] !== '--solo');
const outDir = path.resolve(folder || (await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-capturas-'))));
await fs.mkdir(outDir, { recursive: true });

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const require = createRequire(import.meta.url);
const NodeMediaServer = require('node-media-server');
require('node-media-server/src/core/logger.js').level = 'error';

const pc500 = await startMockPc500({ ip: '127.0.0.1' });
const obs = await startMockObs();
const rtmpPort = await freePort();
const closedPort = await freePort();
const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-capturas-srs-'));
const deviceServer = new NodeMediaServer({ bind: '127.0.0.1', rtmp: { port: rtmpPort }, record: { auto: false }, store: { path: storeDir }, webadmin: { enable: false } });
await deviceServer.run();
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

// El emisor sigue a STREAM, como el codificador del PC500.
let publisher = null;
const follow = setInterval(() => {
  if (pc500.state.buttons.stream && !publisher) {
    publisher = spawn(electronPath, [path.join(projectDir, 'dev', 'video-publisher.mjs')], {
      env: { ...baseEnv, PUBLISH_URL: `rtmp://127.0.0.1:${rtmpPort}/live/live2`, PUBLISH_WIDTH: '1280', PUBLISH_HEIGHT: '720' },
      stdio: 'ignore',
    });
  }
}, 100);

const packaged = process.env.TENVEO_SMOKE_APP;
const appCommand = packaged ? path.join(packaged, 'Contents', 'MacOS', path.basename(packaged, '.app')) : electronPath;

const VIDEO = '[data-action="start-device-stream"]';
const STATES = [
  { name: '1-audio', clicks: [VIDEO, '[data-action="tab"][data-tab="audio"]'], video: true },
  { name: '2-obs', clicks: ['[data-action="tab"][data-tab="obs"]'], video: true },
  { name: '3-equipo', clicks: ['[data-action="tab"][data-tab="device"]'], video: true },
  { name: '4-ajustes', clicks: ['[data-action="open-settings"]'], video: true },
  { name: '5-minimo', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, size: '1180x740' },
  { name: '6-sin-conexion', clicks: [], video: false, offline: true },
  { name: '7-1920', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, size: '1920x1080' },
  { name: '8-pantalla-5k', clicks: ['[data-action="tab"][data-tab="device"]'], video: true, size: '2560x1415' },
];

for (const state of STATES) {
  if (only && !only.some((prefix) => state.name.startsWith(prefix))) continue;
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-capturas-data-'));
  const shot = path.join(outDir, `${state.name}.png`);
  const child = spawn(appCommand, packaged ? [] : [projectDir], {
    env: {
      ...baseEnv,
      TENVEO_ETHERNET_IP: '127.0.0.1',
      TENVEO_PC500_PORT: String(state.offline ? closedPort : pc500.port),
      TENVEO_OBS_HOST: '127.0.0.1',
      TENVEO_OBS_PORT: String(state.offline ? closedPort : obs.port),
      TENVEO_DISABLE_ADB: '1',
      TENVEO_USER_DATA: userData,
      TENVEO_DEVICE_RTMP_PORT: String(rtmpPort),
      TENVEO_SMOKE_SHOT: shot,
      TENVEO_SMOKE_CLICKS: state.clicks.join('|'),
      TENVEO_SMOKE_WAIT_MS: state.offline ? '2500' : '8000',
      ...(state.video ? { TENVEO_SMOKE_WAIT_VIDEO: '1' } : {}),
      ...(state.size ? { TENVEO_SMOKE_SIZE: state.size } : {}),
    },
    stdio: 'ignore',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timer);
  await fs.rm(userData, { recursive: true, force: true });
  console.log(`${code === 0 ? '✔' : '✖'} ${shot}`);
}

clearInterval(follow);
publisher?.kill('SIGKILL');
await Promise.allSettled([pc500.close(), obs.close(), deviceServer.stop()]);
await fs.rm(storeDir, { recursive: true, force: true });
process.exit(0);
