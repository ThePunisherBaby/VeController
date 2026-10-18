// Prueba de humo de las interacciones de la interfaz, con la ventana visible y
// eventos de verdad (protocolo de depuración de Chromium):
//   - la T-Bar sigue al puntero 1:1 aunque se eleve, manda su posición al
//     PC500 y se queda donde se suelta;
//   - las pestañas se recorren con las flechas (patrón ARIA);
//   - Ajustes nace del botón que lo abrió, Esc lo cierra y la apariencia se
//     aplica al instante;
//   - la tecla 3 pone CAM 3 en Preview y lo anuncia con aria-pressed.
// Usa los simuladores del PC500 y de OBS: no toca ningún equipo real.
//
// Uso: npm run smoke:ui
// Con TENVEO_SMOKE_APP se prueba una app empaquetada en vez del código fuente.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import WebSocket from 'ws';
import { startMockObs } from '../dev/mock-obs.js';
import { startMockPc500 } from '../dev/mock-pc500.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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

async function until(test, timeoutMs, everyMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await test().catch(() => null);
    if (value) return value;
    await delay(everyMs);
  }
  return null;
}

const pc500 = await startMockPc500({ ip: '127.0.0.1' });
const obs = await startMockObs();
const debugPort = await freePort();
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-ui-data-'));
const packaged = process.env.TENVEO_SMOKE_APP;
const command = packaged ? path.join(packaged, 'Contents', 'MacOS', path.basename(packaged, '.app')) : electronPath;
const { ELECTRON_RUN_AS_NODE, ...baseEnv } = process.env;
const app = spawn(command, [...(packaged ? [] : [projectDir]), `--remote-debugging-port=${debugPort}`], {
  env: {
    ...baseEnv,
    TENVEO_ETHERNET_IP: '127.0.0.1',
    TENVEO_PC500_PORT: String(pc500.port),
    TENVEO_OBS_HOST: '127.0.0.1',
    TENVEO_OBS_PORT: String(obs.port),
    TENVEO_DISABLE_ADB: '1',
    TENVEO_USER_DATA: userData,
  },
  stdio: 'ignore',
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` (${detail})` : ''}`);
};

try {
  const target = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
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
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const mouse = (type, x, y) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const key = async (keyName, code, keyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode });
  };

  const ready = await until(
    () => evaluate(`document.documentElement.dataset.ready === 'true' && document.documentElement.dataset.connected === 'true'`),
    20000,
  );
  check('la app se conectó al simulador', ready);
  // El primer dibujo ubica la T-Bar; se arrastra después.
  await delay(800);

  // --- T-Bar ---
  const box = await evaluate(
    `(() => { const r = document.getElementById('tbar-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await mouse('mousePressed', box.x, box.y);
  for (let dy = 10; dy <= 100; dy += 10) {
    await mouse('mouseMoved', box.x, box.y + dy);
    await delay(16);
  }
  await delay(500);
  const during = await evaluate(
    `(() => { const h = document.getElementById('tbar-handle'); const r = h.getBoundingClientRect(); return { dragging: document.getElementById('tbar').classList.contains('is-dragging'), scale: getComputedStyle(h).scale, translate: h.style.translate, center: r.y + r.height / 2 }; })()`,
  );
  check('al arrastrarla, la manija se eleva', during.dragging && Number(during.scale) > 1.05, `escala ${during.scale}`);
  check('la manija sigue al puntero 1:1 aunque esté elevada', Math.abs(during.center - (box.y + 100)) < 2, `${during.center.toFixed(1)} px, esperado ${(box.y + 100).toFixed(1)}`);
  await mouse('mouseReleased', box.x, box.y + 100);
  await delay(700);
  const after = await evaluate(
    `(() => { const t = document.getElementById('tbar-track'), h = document.getElementById('tbar-handle'); return { translate: h.style.translate, value: Number(t.getAttribute('aria-valuenow')), travel: t.clientHeight - h.offsetHeight - 6 }; })()`,
  );
  const putters = pc500.received.filter((m) => 'putter' in m).map((m) => m.putter);
  const expected = Math.round((100 / after.travel) * 100);
  check('el PC500 recibió la posición de la T-Bar', putters.length > 0 && Math.abs(putters.at(-1) - (100 / after.travel) * 255) <= 1, `putter ${putters.at(-1)}`);
  check('al soltarla se queda donde quedó', after.translate === during.translate && Math.abs(after.value - expected) <= 1, `${after.value} %`);

  // --- Pestañas con las flechas ---
  await evaluate(`document.getElementById('tab-audio').focus()`);
  await key('ArrowRight', 'ArrowRight', 39);
  await delay(300);
  const tabs = await evaluate(
    `(() => ({ selected: document.querySelector('.tab[aria-selected="true"]').dataset.tab, focus: document.activeElement.id, order: [...document.querySelectorAll('.tab')].map((t) => t.tabIndex).join(','), panel: !document.getElementById('panel-obs').hidden }))()`,
  );
  check('la flecha derecha pasa a la pestaña OBS', tabs.selected === 'obs' && tabs.focus === 'tab-obs' && tabs.panel);
  check('solo la pestaña elegida queda en el orden del tabulador', tabs.order === '-1,0,-1', tabs.order);

  // --- Ajustes y apariencia ---
  await evaluate(`document.querySelector('.icon-btn[data-action="open-settings"]').click()`);
  await delay(900);
  const dialog = await evaluate(
    `(() => { const d = document.getElementById('settings-dialog'); return { open: d.open, origin: d.style.transformOrigin, opacity: getComputedStyle(d).opacity }; })()`,
  );
  check('Ajustes nace del botón que lo abrió', dialog.open && /px/.test(dialog.origin) && Number(dialog.opacity) === 1, dialog.origin);
  await evaluate(`document.querySelector('input[name="appearance"][value="light"]').click()`);
  await delay(600);
  const light = await evaluate(
    `(() => ({ appearance: document.documentElement.dataset.appearance, background: getComputedStyle(document.body).backgroundColor }))()`,
  );
  check('la apariencia Clara se aplica al instante', light.appearance === 'light' && light.background === 'rgb(242, 242, 247)', light.background);
  await evaluate(`document.querySelector('input[name="appearance"][value="system"]').click()`);
  await key('Escape', 'Escape', 27);
  await delay(900);
  const closed = await evaluate(
    `(() => ({ open: document.getElementById('settings-dialog').open, display: getComputedStyle(document.getElementById('settings-dialog')).display, appearance: document.documentElement.dataset.appearance }))()`,
  );
  check('Esc cierra Ajustes al terminar su animación', !closed.open && closed.display === 'none');
  check('Automática vuelve a seguir al sistema', closed.appearance === 'system');

  // --- Atajo de Preview ---
  await key('3', 'Digit3', 51, '3');
  await delay(400);
  const pressed = await evaluate(`[...document.querySelectorAll('#bus-pvw .key')].map((k) => k.getAttribute('aria-pressed')).join(',')`);
  check('la tecla 3 pone CAM 3 en Preview y lo anuncia', pressed === 'false,false,true,false,false', pressed);
  ws.close();
} catch (error) {
  check(`sin errores: ${error.message}`, false);
} finally {
  app.kill('SIGTERM');
  await delay(1500);
  app.kill('SIGKILL');
  await Promise.allSettled([pc500.close(), obs.close()]);
  await fs.rm(userData, { recursive: true, force: true });
}

const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? 'Prueba de la interfaz OK.' : 'Prueba de la interfaz con fallas.');
process.exit(ok ? 0 : 1);
