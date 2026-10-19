// Prueba de humo de las interacciones de la interfaz, con eventos de verdad
// (protocolo de depuración de Chromium). La ventana no se muestra, para no
// molestar a quien usa la Mac; con SMOKE_UI_VISIBLE=1 se ve:
//   - la T-Bar sigue al puntero 1:1 aunque se eleve, manda su posición al
//     PC500 y se queda donde se suelta;
//   - las pestañas se recorren con las flechas (patrón ARIA);
//   - Ajustes nace del botón que lo abrió, Esc lo cierra y la apariencia se
//     aplica al instante;
//   - la tecla 3 pone CAM 3 en Preview y lo anuncia con aria-pressed;
//   - la isla se transforma en un aviso y un clic la devuelve a su estado;
//   - Producción: agregar fuentes, escribir un texto, moverlo con imán,
//     cambiar su tamaño con la proporción, ⌘Z, chroma key (se leen píxeles de
//     la salida), cambiar de escena, la pestaña Escenas de la consola, el
//     guardado en production.json, una cámara (la falsa de Chromium, que no
//     pide permiso) y un video (un WebM que se graba antes de la prueba).
// Usa el simulador del PC500: no toca ningún equipo real.
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
const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-ui-media-'));
const testVideo = path.join(mediaDir, 'Prueba de video.webm');
await new Promise((resolve) => {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  spawn(electronPath, [path.join(projectDir, 'dev', 'make-test-video.mjs'), testVideo], { env, stdio: 'ignore' }).on('exit', resolve);
});
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
    TENVEO_DISABLE_ADB: '1',
    TENVEO_USER_DATA: userData,
    TENVEO_FAKE_MEDIA: '1',
    ...(process.env.SMOKE_UI_VISIBLE === '1' ? {} : { TENVEO_HIDE_WINDOW: '1' }),
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
  const key = async (keyName, code, keyCode, text, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
  };
  // Arrastre con el mouse en pasos, como una mano.
  const dragBy = async (x, y, dx, dy, { hold = false } = {}) => {
    await mouse('mousePressed', x, y);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps);
      await delay(16);
    }
    if (!hold) await mouse('mouseReleased', x + dx, y + dy);
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

  // Más allá del extremo resiste como una banda elástica, sin pasar de 255, y
  // al soltarla vuelve al extremo.
  const handleY = () =>
    evaluate(`(() => { const r = document.getElementById('tbar-handle').getBoundingClientRect(); return r.y + r.height / 2; })()`);
  const fromY = await handleY();
  const pull = after.travel + 90;
  await mouse('mousePressed', box.x, fromY);
  for (let dy = 20; dy <= pull; dy += 20) {
    await mouse('mouseMoved', box.x, fromY + dy);
    await delay(16);
  }
  await mouse('mouseMoved', box.x, fromY + pull);
  await delay(300);
  const stretched = await evaluate(
    `(() => { const t = document.getElementById('tbar-track'), h = document.getElementById('tbar-handle'); return { shift: parseFloat(h.style.translate.split(' ')[1]), value: Number(t.getAttribute('aria-valuenow')) }; })()`,
  );
  check('pasado el extremo la manija se estira con resistencia', stretched.shift > after.travel + 4 && stretched.shift < after.travel + 36 && stretched.value === 100, `${(stretched.shift - after.travel).toFixed(1)} px de más`);
  check('el PC500 nunca recibe más de 255', Math.max(...pc500.received.filter((m) => 'putter' in m).map((m) => m.putter)) === 255);
  await mouse('mouseReleased', box.x, fromY + pull);
  await delay(1200);
  const settled = await evaluate(`parseFloat(document.getElementById('tbar-handle').style.translate.split(' ')[1])`);
  check('al soltarla vuelve al extremo', Math.abs(settled - after.travel) < 0.5, `${settled.toFixed(1)} px de ${after.travel}`);

  // --- Pestañas con las flechas ---
  await evaluate(`document.getElementById('tab-audio').focus()`);
  await key('ArrowRight', 'ArrowRight', 39);
  await delay(300);
  const tabs = await evaluate(
    `(() => ({ selected: document.querySelector('.tabs .tab[aria-selected="true"]').dataset.tab, focus: document.activeElement.id, order: [...document.querySelectorAll('.tabs .tab')].map((t) => t.tabIndex).join(','), panel: !document.getElementById('panel-scenes').hidden }))()`,
  );
  check('la flecha derecha pasa a la pestaña Escenas', tabs.selected === 'scenes' && tabs.focus === 'tab-scenes' && tabs.panel);
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

  // --- La isla ---
  const compact = await evaluate(`document.getElementById('island').getBoundingClientRect().height`);
  await evaluate(`tenveoIsland.show('Prueba de la isla: el aviso sale de la barra.', 'success')`);
  await delay(1000);
  const open = await evaluate(
    `(() => { const i = document.getElementById('island'); return { mode: i.dataset.mode, height: i.getBoundingClientRect().height, radius: parseFloat(i.style.borderRadius), message: Number(getComputedStyle(document.getElementById('island-message')).opacity), status: Number(getComputedStyle(document.getElementById('island-status')).opacity), text: document.getElementById('island-text').textContent }; })()`,
  );
  check('la isla se transforma en el aviso', open.mode === 'message' && open.height > compact + 6 && open.message === 1 && open.status === 0, `${compact} → ${open.height.toFixed(1)} px`);
  check('el radio de la isla sale de su alto', Math.abs(open.radius - Math.min(22, open.height / 2)) < 0.6, `${open.radius} px`);
  await evaluate(`document.getElementById('island-message').click()`);
  await delay(1000);
  const back = await evaluate(
    `(() => { const i = document.getElementById('island'); return { mode: i.dataset.mode, height: i.getBoundingClientRect().height, status: Number(getComputedStyle(document.getElementById('island-status')).opacity) }; })()`,
  );
  check('un clic en el aviso devuelve la isla a su estado', back.mode === 'status' && Math.abs(back.height - compact) < 1 && back.status === 1, `${back.height.toFixed(1)} px`);

  // --- Producción ---
  await evaluate(`document.getElementById('view-studio').click()`);
  await delay(700);
  const studio = await evaluate(
    `(() => ({ view: document.documentElement.dataset.view, studio: !document.getElementById('studio-view').hidden, console: document.getElementById('console-view').hidden, scenes: document.querySelectorAll('#scene-list .list-item').length, sources: [...document.querySelectorAll('#source-list .item-name')].map((n) => n.textContent).join() }))()`,
  );
  check('Producción abre el estudio con una escena y el programa del PC500', studio.view === 'studio' && studio.studio && studio.console && studio.scenes === 1 && studio.sources === 'Programa del PC500', studio.sources);

  // Un fondo de color y un texto, que queda elegido con su campo listo para escribir.
  await evaluate(`tenveoStudio.addSource('color')`);
  await evaluate(`tenveoStudio.addSource('text')`);
  await delay(400);
  await send('Input.insertText', { text: 'Bienvenidos' });
  await delay(400);
  const typed = await evaluate(
    `(() => { const s = tenveoStudio.doc.scenes[0].sources.at(-1); return { type: s.type, text: s.settings.text, selected: tenveoStudio.selectedId === s.id, pane: !document.getElementById('pane-source').hidden, order: tenveoStudio.doc.scenes[0].sources.map((x) => x.type).join() }; })()`,
  );
  check('el color va al fondo y el texto nuevo queda elegido', typed.order === 'color,pc500,text' && typed.selected && typed.pane, typed.order);
  check('lo escrito en Propiedades cambia el texto', typed.text === 'Bienvenidos', typed.text);

  // Caja verde detrás del texto, desde Propiedades.
  await evaluate(`(() => {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#pane-source [data-field="settings.background"]', '#00ff00');
    set('#pane-source [data-field="settings.backgroundOpacity"]', '100');
  })()`);
  await delay(300);

  const geometry = () =>
    evaluate(`(() => {
      const r = document.getElementById('output').getBoundingClientRect();
      const s = tenveoStudio.doc.scenes.find((x) => x.id === tenveoStudio.doc.liveScene).sources.at(-1);
      const k = r.width / 1920;
      const t = s.transform;
      return { k, t: { ...t }, cx: r.left + (t.x + t.width / 2) * k, cy: r.top + (t.y + t.height / 2) * k, se: { x: r.left + (t.x + t.width) * k, y: r.top + (t.y + t.height) * k } };
    })()`);

  // Mover: sigue al mouse.
  const g0 = await geometry();
  await dragBy(g0.cx, g0.cy, 200, 100);
  await delay(300);
  const g1 = await geometry();
  check('arrastrar mueve la fuente con el mouse', Math.abs(g1.t.x - g0.t.x - 200 / g0.k) <= 1.5 && Math.abs(g1.t.y - g0.t.y - 100 / g0.k) <= 1.5, `${(g1.t.x - g0.t.x).toFixed(0)}, ${(g1.t.y - g0.t.y).toFixed(0)} px`);

  // Volver cerca del centro: el imán la centra justo y muestra las guías.
  await dragBy(g1.cx, g1.cy, -200 + 3, -100 - 2, { hold: true });
  await delay(200);
  const guides = await evaluate(`[...document.querySelectorAll('.guide')].filter((g) => !g.hidden).length`);
  await mouse('mouseReleased', g1.cx - 197, g1.cy - 102);
  await delay(300);
  const g2 = await geometry();
  // Con posiciones enteras, una caja de ancho impar queda a medio píxel del centro.
  const centered = Math.abs(g2.t.x + g2.t.width / 2 - 960) <= 0.5 && Math.abs(g2.t.y + g2.t.height / 2 - 540) <= 0.5;
  check('el imán la centra en la salida y muestra las guías', centered && guides === 2, `centro ${g2.t.x + g2.t.width / 2}, ${g2.t.y + g2.t.height / 2}; ${guides} guías`);

  // Cambiar el tamaño desde la esquina: mantiene la proporción.
  await dragBy(g2.se.x, g2.se.y, 120, 10);
  await delay(300);
  const g3 = await geometry();
  const ratio0 = g2.t.width / g2.t.height;
  const ratio1 = g3.t.width / g3.t.height;
  check('la esquina cambia el tamaño manteniendo la proporción', g3.t.width > g2.t.width + 100 && Math.abs(ratio1 - ratio0) < 0.02, `${g2.t.width}×${g2.t.height} → ${g3.t.width}×${g3.t.height}`);

  // ⌘Z deshace el cambio de tamaño.
  await key('z', 'KeyZ', 90, '', 4);
  await delay(300);
  const g4 = await geometry();
  check('⌘Z deshace el último cambio', g4.t.width === g2.t.width && g4.t.x === g2.t.x, `${g4.t.width}×${g4.t.height}`);
  await key('z', 'KeyZ', 90, '', 4 | 8);
  await delay(300);
  const g5 = await geometry();
  check('⇧⌘Z lo rehace', g5.t.width === g3.t.width, `${g5.t.width}×${g5.t.height}`);

  // Chroma key: se leen píxeles de la salida. La caja verde se ve verde; con el
  // chroma encendido desaparece y se ve el fondo azul.
  const near = (pixel, rgb, tolerance = 12) => pixel && rgb.every((v, i) => Math.abs(pixel[i] - v) <= tolerance);
  const inBox = { x: g5.t.x + g5.t.width / 2, y: g5.t.y + g5.t.height * 0.05 };
  const unkeyed = await evaluate(`tenveoStudio.probe([${JSON.stringify(inBox)}, { x: 60, y: 60 }])`);
  check('la salida dibuja la caja verde sobre el fondo azul', near(unkeyed?.[0], [0, 255, 0]) && near(unkeyed?.[1], [30, 110, 244]), JSON.stringify(unkeyed));
  await evaluate(`document.querySelector('#pane-source [data-field="chroma.enabled"]').click()`);
  await delay(300);
  const keyed = await evaluate(`tenveoStudio.probe([${JSON.stringify(inBox)}])`);
  check('con chroma key el verde desaparece', near(keyed?.[0], [30, 110, 244]), JSON.stringify(keyed));

  // Escena nueva con el botón +: entra con su nombre listo para escribir.
  await evaluate(`document.querySelector('[data-action="scene-add"]').click()`);
  await delay(400);
  await send('Input.insertText', { text: 'Cámara sola' });
  await key('Enter', 'Enter', 13);
  await delay(700);
  const added = await evaluate(
    `(() => { const d = tenveoStudio.doc; return { names: d.scenes.map((s) => s.name).join(), live: d.scenes.findIndex((s) => s.id === d.liveScene) }; })()`,
  );
  const black = await evaluate(`tenveoStudio.probe([{ x: 60, y: 60 }])`);
  check('la escena nueva se nombra y pasa a la salida', added.names === 'Escena 1,Cámara sola' && added.live === 1 && near(black?.[0], [0, 0, 0]), `${added.names}; ${JSON.stringify(black)}`);

  // Un clic en la primera escena la devuelve a la salida (con fundido).
  await evaluate(`document.querySelector('#scene-list .list-item').click()`);
  await delay(700);
  const back1 = await evaluate(`tenveoStudio.probe([{ x: 60, y: 60 }])`);
  check('un clic en otra escena la pone en la salida', near(back1?.[0], [30, 110, 244]), JSON.stringify(back1));

  // La pestaña Escenas de la consola cambia de escena sin dejar la consola.
  await evaluate(`document.getElementById('view-console').click()`);
  await delay(600);
  await evaluate(`document.querySelectorAll('#console-scenes .scene')[1].click()`);
  await delay(400);
  const consoleScenes = await evaluate(
    `(() => ({ rows: document.querySelectorAll('#console-scenes .scene').length, current: document.querySelector('#console-scenes .scene.is-current')?.textContent, live: tenveoStudio.doc.liveScene === tenveoStudio.doc.scenes[1].id }))()`,
  );
  check('la pestaña Escenas de la consola cambia la escena de la salida', consoleScenes.rows === 2 && consoleScenes.current === 'Cámara sola' && consoleScenes.live, consoleScenes.current);
  await delay(1300);
  const idle = await evaluate(`tenveoStudio.stats()`);
  check('con la consola a la vista el compositor no dibuja', idle && idle.active === false && idle.fps === 0, JSON.stringify(idle));

  // Lo guardado en production.json.
  await delay(400);
  const saved = JSON.parse(await fs.readFile(path.join(userData, 'production.json'), 'utf8'));
  const savedText = saved.scenes[0].sources.find((source) => source.type === 'text');
  check('la producción quedó guardada', saved.scenes.length === 2 && savedText?.settings.text === 'Bienvenidos' && savedText.chroma.enabled === true && saved.liveScene === saved.scenes[1].id);

  // Una cámara: la falsa de Chromium. Abre, llega su imagen y se ajusta a su tamaño real.
  await evaluate(`document.getElementById('view-studio').click()`);
  await delay(500);
  const cameraId = await evaluate(`navigator.mediaDevices.enumerateDevices().then((list) => list.find((d) => d.kind === 'videoinput')?.deviceId ?? '')`);
  await evaluate(`tenveoStudio.addSource('camera', ${JSON.stringify(cameraId)})`);
  const cameraLive = await until(
    () => evaluate(`tenveoStudio.status('camera:' + ${JSON.stringify(cameraId)})?.state === 'live'`),
    8000,
    300,
  );
  await delay(500);
  const camera = cameraLive
    ? await evaluate(`(() => { const s = tenveoStudio.doc.scenes.find((x) => x.id === tenveoStudio.doc.liveScene).sources.at(-1); return { natural: s.natural, transform: s.transform }; })()`)
    : null;
  const cameraAspect = camera && Math.abs(camera.transform.width / camera.transform.height - camera.natural.width / camera.natural.height) < 0.01;
  check('una cámara abre y su imagen llega a la salida', Boolean(cameraId) && Boolean(camera) && cameraAspect, camera ? `${camera.natural.width}×${camera.natural.height} → ${camera.transform.width}×${camera.transform.height}` : 'sin imagen');

  // Un video: se copia a la carpeta de la app, se reproduce y sus cuadros llegan al compositor.
  const imported = await evaluate(`window.tenveo.send('importMediaPath', ${JSON.stringify(testVideo)}).then(async (r) => { await tenveoStudio.addImported(r.result); return r.result; })`);
  const video = await until(
    () =>
      evaluate(`(() => {
        const status = tenveoStudio.status('video:' + ${JSON.stringify(imported?.media ?? '')});
        const s = tenveoStudio.doc.scenes.find((x) => x.id === tenveoStudio.doc.liveScene).sources.at(-1);
        return status?.state === 'live' ? { natural: s.natural, name: s.name, loop: s.settings.loop } : null;
      })()`),
    8000,
    300,
  );
  await delay(600);
  const bar = await evaluate(`tenveoStudio.probe([{ x: 120, y: 60 }])`);
  check('un video se copia, se reproduce y se ve en la salida', imported?.kind === 'video' && video?.natural.width === 640 && video.name === 'Prueba de video' && video.loop && near(bar?.[0], [192, 192, 192], 24), `${JSON.stringify(video)} ${JSON.stringify(bar)}`);
  const copied = await fs.readdir(path.join(userData, 'media'));
  check('el video quedó en la carpeta de la app con el nombre de su huella', copied.some((name) => /^[a-f0-9]{32}\.webm$/.test(name)), copied.join());
  ws.close();
} catch (error) {
  check(`sin errores: ${error.message}`, false);
} finally {
  app.kill('SIGTERM');
  await delay(1500);
  app.kill('SIGKILL');
  await Promise.allSettled([pc500.close()]);
  await fs.rm(userData, { recursive: true, force: true });
  await fs.rm(mediaDir, { recursive: true, force: true });
}

const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? 'Prueba de la interfaz OK.' : 'Prueba de la interfaz con fallas.');
process.exit(ok ? 0 : 1);
