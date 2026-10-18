// Proceso principal de Electron usado como navegador común: abre una URL sin
// el puente seguro, pulsa botones, guarda una captura y escribe un resumen en
// JSON. Lo usa scripts/smoke-web.mjs para probar la versión web.

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';

const url = process.env.WEB_CAPTURE_URL;
const out = process.env.WEB_CAPTURE_OUT;
const clicks = String(process.env.WEB_CAPTURE_CLICKS || '').split('|').filter(Boolean);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const READY = `(() => {
  const root = document.documentElement;
  return root.dataset.ready === 'true'
    && root.dataset.platform === 'browser'
    && document.getElementById('hw-status').classList.contains('is-connected')
    && document.getElementById('obs-link').textContent === 'LINKED';
})()`;

const SUMMARY = `(() => ({
  platform: document.documentElement.dataset.platform,
  hardware: document.getElementById('hw-text').textContent,
  obs: document.getElementById('obs-link').textContent,
  pgm: document.getElementById('pgm-label').textContent,
  pvw: document.getElementById('pvw-label').textContent,
  scenes: [...document.querySelectorAll('#scenes .scene')].map((b) => b.textContent.trim()),
  currentScene: document.querySelector('#scenes .scene.is-current')?.textContent.trim() ?? null,
  demoTag: !document.getElementById('demo-tag').hidden,
}))()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#101216',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[web:${event.level ?? level}] ${event.message ?? message}`);
  });

  try {
    await win.loadURL(url);
    let ready = false;
    for (let i = 0; i < 80 && !ready; i += 1) {
      ready = await win.webContents.executeJavaScript(READY);
      if (!ready) await delay(150);
    }
    for (const selector of clicks) {
      const ok = await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
      );
      console.log(`[web-capture] click ${selector}: ${ok ? 'ok' : 'no encontrado'}`);
      await delay(500);
    }
    await delay(900);
    const summary = await win.webContents.executeJavaScript(SUMMARY);
    const image = await win.webContents.capturePage();
    await fs.writeFile(out, image.toPNG());
    await fs.writeFile(out.replace(/\.png$/i, '.json'), JSON.stringify({ ready, ...summary }, null, 2));
    app.exit(ready ? 0 : 3);
  } catch (error) {
    console.error('[web-capture] falló:', error);
    app.exit(1);
  }
});
