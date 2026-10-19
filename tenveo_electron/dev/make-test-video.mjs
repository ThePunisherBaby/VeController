// Graba un video de prueba (WebM, VP9, 640×360, 2 s) con el codificador de
// Chromium: barras de color y un cuadrado que se mueve. Lo usa smoke:ui para
// probar las fuentes de video del estudio sin ffmpeg.
// Uso: electron dev/make-test-video.mjs <salida.webm>

import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve(process.argv.at(-1));

const PAGE = `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start(250);
  const colors = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const start = performance.now();
  while (performance.now() - start < 2000) {
    const t = (performance.now() - start) / 2000;
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect((i * 640) / 7, 0, 640 / 7 + 1, 360);
    });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(40 + t * 480, 140, 80, 80);
    await new Promise((resolve) => setTimeout(resolve, 33));
  }
  recorder.stop();
  await new Promise((resolve) => (recorder.onstop = resolve));
  const data = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
  window.recorded.save(new Uint8Array(data));
})();
</script>`;

app.whenReady().then(async () => {
  const preload = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-video-')), 'preload.cjs');
  await fs.writeFile(
    preload,
    `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recorded', { save: (data) => ipcRenderer.send('recorded', data) });`,
  );
  ipcMain.once('recorded', async (_event, data) => {
    await fs.writeFile(out, Buffer.from(data));
    await fs.rm(path.dirname(preload), { recursive: true, force: true });
    console.log(`[video de prueba] ${out} (${data.length} bytes)`);
    app.exit(0);
  });
  const win = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: false, backgroundThrottling: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  setTimeout(() => app.exit(1), 20000);
});
