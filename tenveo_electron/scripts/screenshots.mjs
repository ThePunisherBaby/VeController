// Capturas de la interfaz en sus estados principales, para revisar el diseño:
// cada pestaña con video en el monitor PGM, el diálogo de ajustes, sin conexión,
// la ventana en su tamaño mínimo y en pantallas grandes, la apariencia clara,
// las preferencias de accesibilidad (más contraste, transparencia reducida) y
// la vista Producción con el video del PC500, un logo y un texto.
// Usa el simulador del PC500, un servidor RTMP de prueba y el emisor de
// prueba, como npm run smoke:video.
//
// Uso: node scripts/screenshots.mjs [carpeta] [--solo 7,8]   (por defecto, una carpeta temporal)
// Con TENVEO_SMOKE_APP se captura una app empaquetada; con SHOTS_VERBOSE=1 se
// ve lo que escribe la app.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
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
const LIGHT = 'input[name="appearance"][value="light"]';
const CONTRAST = 'prefers-contrast:more';
const SOLID = 'prefers-reduced-transparency:reduce';
// Una producción de ejemplo: el programa del PC500, un logo arriba a la
// derecha y un rótulo abajo a la izquierda, con una segunda escena.
const LOGO = path.join(projectDir, 'build', 'icon.png');
const studio = (after = '') => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const s = tenveoStudio;
  document.getElementById('view-studio').click();
  await wait(300);
  const logo = await window.tenveo.send('importMediaPath', ${JSON.stringify(LOGO)});
  await s.addImported(logo.result);
  s.set('name', 'Logo');
  s.set('transform.width', 150);
  s.set('transform.x', 1920 - 64 - 150);
  s.set('transform.y', 56);
  await s.addSource('text');
  document.activeElement?.blur?.();
  s.set('settings.text', 'Domingo de alabanza\\nServicio de las 10:00');
  s.set('settings.size', 46);
  s.set('settings.align', 'left');
  s.set('settings.backgroundOpacity', 0.62);
  s.set('name', 'Rótulo');
  const t = s.doc.scenes[0].sources.at(-1).transform;
  s.set('transform.x', 72);
  s.set('transform.y', 1080 - 72 - t.height);
  const first = s.doc.scenes[0].id;
  s.addScene(false);
  s.goLive(first);
  ${after}
  await wait(600);
})()`;
const STATES = [
  { name: '1-audio', clicks: [VIDEO, '[data-action="tab"][data-tab="audio"]'], video: true },
  { name: '2-escenas', clicks: ['[data-action="tab"][data-tab="scenes"]'], video: true, eval: studio(`document.getElementById('view-console').click();`) },
  { name: '3-equipo', clicks: ['[data-action="tab"][data-tab="device"]'], video: true },
  { name: '4-ajustes', clicks: ['[data-action="open-settings"]'], video: true },
  { name: '5-minimo', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, size: '1180x740' },
  { name: '6-sin-conexion', clicks: [], video: false, offline: true },
  { name: '7-1920', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, size: '1920x1080' },
  { name: '8-pantalla-5k', clicks: ['[data-action="tab"][data-tab="device"]'], video: true, size: '2560x1415' },
  { name: '9-claro', clicks: [LIGHT, '[data-action="tab"][data-tab="audio"]'], video: true },
  { name: '10-claro-equipo', clicks: [LIGHT, '[data-action="tab"][data-tab="device"]'], video: true },
  { name: '11-claro-ajustes', clicks: [LIGHT, '[data-action="open-settings"]'], video: true },
  { name: '12-contraste', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, media: CONTRAST },
  { name: '13-contraste-claro', clicks: [LIGHT, '[data-action="tab"][data-tab="scenes"]'], video: true, media: CONTRAST },
  { name: '14-transparencia-reducida', clicks: ['[data-action="open-settings"]'], video: true, media: SOLID },
  { name: '15-isla', clicks: ['[data-action="tab"][data-tab="audio"]'], video: true, eval: `tenveoIsland.show('STREAM encendido: el video llega en un momento.', 'success')` },
  { name: '16-isla-clara', clicks: [LIGHT], video: true, eval: `tenveoIsland.show('Otra app está usando la cámara. Ciérrala y vuelve a intentarlo.', 'error')` },
  { name: '17-produccion', clicks: [VIDEO], video: true, eval: studio(`s.select(s.doc.scenes[0].sources.at(-1).id);`) },
  { name: '18-produccion-salida', clicks: [VIDEO], video: true, eval: studio() },
  { name: '19-produccion-clara', clicks: [VIDEO, LIGHT], video: true, eval: studio(`s.select(s.doc.scenes[0].sources.at(-2).id);`) },
  { name: '20-produccion-chroma', clicks: [VIDEO], video: true, eval: studio(`s.select(s.doc.scenes[0].sources[0].id); s.set('chroma.enabled', true);`) },
  { name: '21-produccion-minimo', clicks: [VIDEO], video: true, size: '1180x740', eval: studio(`s.select(s.doc.scenes[0].sources.at(-1).id);`) },
  { name: '22-produccion-5k', clicks: [VIDEO], video: true, size: '2560x1415', eval: studio(`s.select(s.doc.scenes[0].sources.at(-1).id);`) },
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
      TENVEO_DISABLE_ADB: '1',
      TENVEO_USER_DATA: userData,
      TENVEO_DEVICE_RTMP_PORT: String(rtmpPort),
      TENVEO_SMOKE_SHOT: shot,
      TENVEO_SMOKE_CLICKS: state.clicks.join('|'),
      TENVEO_SMOKE_WAIT_MS: state.offline ? '2500' : '8000',
      ...(state.video ? { TENVEO_SMOKE_WAIT_VIDEO: '1' } : {}),
      ...(state.size ? { TENVEO_SMOKE_SIZE: state.size } : {}),
      ...(state.media ? { TENVEO_SMOKE_MEDIA: state.media } : {}),
      ...(state.eval ? { TENVEO_SMOKE_EVAL: state.eval } : {}),
      ...state.env,
    },
    stdio: process.env.SHOTS_VERBOSE === '1' ? 'inherit' : 'ignore',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timer);
  await fs.rm(userData, { recursive: true, force: true });
  console.log(`${code === 0 ? '✔' : '✖'} ${shot}`);
}

clearInterval(follow);
publisher?.kill('SIGKILL');
await Promise.allSettled([pc500.close(), deviceServer.stop()]);
await fs.rm(storeDir, { recursive: true, force: true });
process.exit(0);
