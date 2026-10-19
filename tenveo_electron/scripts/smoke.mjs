// Prueba de humo: abre la app de Electron contra el simulador del PC500, pulsa
// botones como lo haría una persona, guarda una captura de la ventana y revisa
// que el PC500 recibió los comandos y que el estudio guardó su escena nueva.
// Uso: npm run smoke [-- ruta/de/la/captura.png]
// Con TENVEO_SMOKE_APP se prueba una app empaquetada en vez del código fuente.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), `tenveo-smoke-${Date.now()}.png`));
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-smoke-data-'));
const pc500 = await startMockPc500({ autoDelayMs: 300 });

const clicks = [
  '[data-action="pvw-select"][data-cam="3"]',
  '[data-action="cut"]',
  '[data-action="mute"][data-channel="in2"]',
  '[data-action="view"][data-view="studio"]',
  '[data-action="scene-add"]',
  // Clics extra para revisar otras vistas, por ejemplo '[data-action="open-settings"]'.
  ...String(process.env.SMOKE_EXTRA_CLICKS || '').split('|').filter(Boolean),
].join('|');

const app = process.env.TENVEO_SMOKE_APP;
const command = app ? path.join(app, 'Contents', 'MacOS', path.basename(app, '.app')) : electronPath;
const args = app ? [] : [projectDir];

// VS Code deja puesta ELECTRON_RUN_AS_NODE, que haría correr la app como Node.
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;

const child = spawn(command, args, {
  env: {
    ...baseEnv,
    TENVEO_ETHERNET_IP: '127.0.0.1',
    TENVEO_PC500_PORT: String(pc500.port),
    TENVEO_DISABLE_ADB: '1',
    TENVEO_USER_DATA: userData,
    TENVEO_SMOKE_SHOT: out,
    TENVEO_SMOKE_CLICKS: clicks,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
const code = await new Promise((resolve) => child.on('exit', (exitCode) => resolve(exitCode)));
clearTimeout(timeout);

let snapshot = null;
try {
  snapshot = JSON.parse(await fs.readFile(out.replace(/\.png$/i, '.json'), 'utf8'));
} catch {
  // Sin captura: la app no llegó a terminar la prueba.
}
let production = null;
try {
  production = JSON.parse(await fs.readFile(path.join(userData, 'production.json'), 'utf8'));
} catch {
  // Sin producción guardada.
}

const checks = [
  ['la app terminó sin errores', code === 0],
  ['quedó conectada al PC500 simulado', snapshot?.switcher.connection === 'ethernet'],
  ['el PC500 recibió PVW 3', pc500.received.some((m) => m['pvw-3'] === 1)],
  ['el PC500 recibió CUT', pc500.received.some((m) => m.cut === 1)],
  ['CAM 3 quedó al aire', snapshot?.switcher.pgm === '3'],
  ['el PC500 recibió el silencio de IN 2', pc500.received.some((m) => m.audio_in2_mode === 0)],
  ['ya no hay OBS en el estado', snapshot && !('obs' in snapshot)],
  ['el estudio guardó la escena nueva, en la salida', production?.scenes.length === 2 && production.liveScene === production.scenes[1].id],
];

await Promise.allSettled([pc500.close()]);
await fs.rm(userData, { recursive: true, force: true });

for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
const failed = checks.some(([, ok]) => !ok);
console.log(failed ? `Prueba de humo FALLÓ (código ${code})` : `Prueba de humo OK. Captura: ${out}`);
process.exit(failed ? 1 : 0);
