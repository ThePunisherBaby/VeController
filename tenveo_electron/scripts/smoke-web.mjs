// Prueba de humo de la versión web: levanta los simuladores y el servidor web,
// abre la página como un navegador común, pulsa botones y revisa los comandos.
// Uso: npm run smoke:web [-- ruta/de/la/captura.png]
// Con SMOKE_WEB_DEMO=1 prueba el modo demo (?demo), sin simuladores por red.

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
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), `tenveo-web-${Date.now()}.png`));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const pc500 = await startMockPc500({ autoDelayMs: 300 });
const obs = await startMockObs();
const webPort = await freePort();
const web = spawn(process.execPath, [path.join(projectDir, 'scripts', 'serve-web.mjs'), '--port', String(webPort)], {
  stdio: 'ignore',
});

let up = false;
for (let i = 0; i < 50 && !up; i += 1) {
  try {
    up = (await fetch(`http://127.0.0.1:${webPort}/renderer/index.html`)).ok;
  } catch {
    await delay(100);
  }
}

const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;
const demo = process.env.SMOKE_WEB_DEMO === '1';
const url = demo
  ? `http://127.0.0.1:${webPort}/?demo`
  : `http://127.0.0.1:${webPort}/?pc500=ws://127.0.0.1:${pc500.port}&obs=127.0.0.1:${obs.port}`;
const child = spawn(electronPath, [path.join(projectDir, 'dev', 'web-capture.mjs')], {
  env: {
    ...baseEnv,
    WEB_CAPTURE_URL: url,
    WEB_CAPTURE_OUT: out,
    WEB_CAPTURE_CLICKS: ['[data-action="pvw-select"][data-cam="4"]', '[data-action="auto"]'].join('|'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
const code = await new Promise((resolve) => child.on('exit', (exitCode) => resolve(exitCode)));
clearTimeout(timeout);

let summary = null;
try {
  summary = JSON.parse(await fs.readFile(out.replace(/\.png$/i, '.json'), 'utf8'));
} catch {
  // Sin resumen: la página no terminó la prueba.
}

const checks = [
  ['el servidor web respondió', up],
  ['la página terminó sin errores', code === 0],
  ['corrió en modo navegador', summary?.platform === 'browser'],
  ['se conectó al PC500 por red', /^Red/.test(summary?.hardware ?? '')],
  ['se conectó a OBS', summary?.obs === 'Conectado'],
  ['CAM 4 quedó al aire', summary?.pgm === 'CAM 4 · SDI 2'],
  ['SYNC OBS marcó la escena Cam 4', summary?.currentScene === 'Cam 4'],
];
if (demo) {
  checks.push(
    ['usó los simuladores de la página', /simulador/.test(summary?.hardwareTitle ?? '')],
    ['muestra la etiqueta DEMO', summary?.demoTag === true],
    ['no tocó los simuladores por red', pc500.received.length === 0],
  );
} else {
  checks.push(
    ['el PC500 recibió PVW 4', pc500.received.some((m) => m['pvw-4'] === 1)],
    ['el PC500 recibió AUTO', pc500.received.some((m) => m.auto === 1)],
    ['OBS recibió la escena Cam 4', obs.state.program === 'Cam 4'],
    ['sin etiqueta DEMO', summary?.demoTag === false],
  );
}

web.kill();
await Promise.allSettled([pc500.close(), obs.close()]);

for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
const failed = checks.some(([, ok]) => !ok);
console.log(failed ? `Prueba web FALLÓ (código ${code})` : `Prueba web OK. Captura: ${out}`);
process.exit(failed ? 1 : 0);
