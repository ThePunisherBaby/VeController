// Prueba de humo del video por red, de punta a punta:
//   1. Abre Tenveo Studio en modo "el PC500 transmite a esta Mac".
//   2. Un emisor de prueba publica por RTMP una carta de ajuste en H.264,
//      igual que el PC500 cuando transmite.
//   3. La app recibe el stream, lo reproduce en el monitor PGM y guarda una captura.
// Uso: npm run smoke:video [-- ruta/de/la/captura.png]
// Con TENVEO_SMOKE_APP se prueba una app empaquetada en vez del código fuente.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockObs } from '../dev/mock-obs.js';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), `tenveo-video-${Date.now()}.png`));
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

const pc500 = await startMockPc500();
const obs = await startMockObs();
const rtmpPort = await freePort();
const key = 'prueba_video';
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

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
    TENVEO_VIDEO: 'push',
    TENVEO_VIDEO_KEY: key,
    TENVEO_RTMP_PORT: String(rtmpPort),
    TENVEO_RTMP_HOST: '127.0.0.1',
    TENVEO_SMOKE_SHOT: out,
    TENVEO_SMOKE_CLICKS: '[data-action="tab"][data-tab="device"]',
    TENVEO_SMOKE_WAIT_VIDEO: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
pipe(appProcess, '[app]');

const publisher = spawn(electronPath, [path.join(projectDir, 'dev', 'video-publisher.mjs')], {
  env: { ...baseEnv, PUBLISH_URL: `rtmp://127.0.0.1:${rtmpPort}/live/${key}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
pipe(publisher, '[emisor]');

const timeout = setTimeout(() => appProcess.kill('SIGKILL'), 90000);
const code = await new Promise((resolve) => appProcess.on('exit', (exitCode) => resolve(exitCode)));
clearTimeout(timeout);
publisher.kill();

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

await Promise.allSettled([pc500.close(), obs.close()]);
await fs.rm(userData, { recursive: true, force: true });

for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
const failed = checks.some(([, ok]) => !ok);
console.log(failed ? `Prueba de video FALLÓ (código ${code})` : `Prueba de video OK. Captura: ${out}`);
process.exit(failed ? 1 : 0);
