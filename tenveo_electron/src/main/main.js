// Proceso principal de Tenveo Studio.
//
// Aquí viven las conexiones: WebSocket del PC500, WebSocket de OBS y el puente
// ADB. La ventana solo dibuja la consola y manda comandos por IPC.
//
// Variables de entorno para desarrollo y pruebas:
//   TENVEO_USB_URL        WebSocket del PC500 por USB (por defecto ws://127.0.0.1:8089)
//   TENVEO_OBS_HOST, TENVEO_OBS_PORT, TENVEO_OBS_PASSWORD
//   TENVEO_DISABLE_ADB=1  no usar adb
//   TENVEO_USER_DATA      carpeta de datos alternativa
//   TENVEO_SMOKE_SHOT     guarda una captura PNG de la ventana y cierra la app
//   TENVEO_SMOKE_CLICKS   selectores CSS separados por "|" para pulsar antes de la captura

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ObsService } from '../core/obs-service.js';
import { StudioController } from '../core/studio-controller.js';
import { TenveoService } from '../core/tenveo-service.js';
import { AdbBridge } from './adb-bridge.js';
import { SettingsStore } from './settings-store.js';

const env = process.env;
const SRC_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROJECT_DIR = path.resolve(SRC_DIR, '..');
const SCHEME = 'app';
const HOST = 'tenveo';
const START_URL = `${SCHEME}://${HOST}/renderer/index.html`;
const SERVED_DIRS = new Set(['renderer', 'core']);

if (env.TENVEO_USER_DATA) app.setPath('userData', env.TENVEO_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;
let controller = null;
let adb = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostForUrl(host) {
  return host.includes(':') ? `[${host}]` : host;
}

// Solo se sirven las carpetas renderer y core, nunca main ni preload.
function resolveAppFile(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== HOST) return null;
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!SERVED_DIRS.has(relative.split('/')[0])) return null;
  const file = path.resolve(SRC_DIR, relative);
  return file.startsWith(SRC_DIR + path.sep) ? file : null;
}

function isTrustedSender(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === `${SCHEME}:` && url.host === HOST;
  } catch {
    return false;
  }
}

function originalPanelUrl() {
  const snapshot = controller.snapshot();
  const ip = snapshot.settings.ethernetIp;
  if (snapshot.switcher.connection === 'ethernet' && ip) return `http://${hostForUrl(ip)}/`;
  if (snapshot.extras.adb?.panelForwarded) return 'http://127.0.0.1:8080/';
  if (ip) return `http://${hostForUrl(ip)}/`;
  return null;
}

async function openOriginalPanel() {
  const url = originalPanelUrl();
  if (!url) return { ok: false, error: 'Conecta el PC500 por USB o escribe su IP Ethernet.' };
  await shell.openExternal(url);
  return { ok: true, result: url };
}

let pushScheduled = false;
function schedulePush() {
  if (pushScheduled) return;
  pushScheduled = true;
  setImmediate(() => {
    pushScheduled = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tenveo:state', controller.snapshot());
    }
  });
}

function registerIpc() {
  ipcMain.handle('tenveo:get-state', (event) => {
    if (!isTrustedSender(event)) throw new Error('Origen no permitido');
    return controller.snapshot();
  });

  ipcMain.handle('tenveo:command', async (event, type, args) => {
    if (!isTrustedSender(event)) throw new Error('Origen no permitido');
    const list = Array.isArray(args) ? args : [];
    try {
      if (type === 'openOriginalPanel') return await openOriginalPanel();
      const result = controller.dispatch(String(type), ...list);
      return { ok: true, result: result ?? null };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
}

function createWindow() {
  const smoke = Boolean(env.TENVEO_SMOKE_SHOT);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#101216',
    title: 'Tenveo Studio',
    show: false,
    webPreferences: {
      preload: path.join(SRC_DIR, 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) event.preventDefault();
  });
  if (!smoke) win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });
  win.loadURL(START_URL);
  return win;
}

async function runSmoke(win) {
  const out = env.TENVEO_SMOKE_SHOT;
  const waitMs = Number(env.TENVEO_SMOKE_WAIT_MS || 8000);
  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[renderer:${event.level ?? level}] ${event.message ?? message}`);
  });
  win.webContents.on('preload-error', (_event, file, error) => console.error(`[preload] ${file}: ${error}`));
  win.webContents.on('render-process-gone', (_event, details) => console.error('[renderer] terminó:', details.reason));

  try {
    if (win.webContents.isLoading()) {
      await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    }
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      const s = controller.snapshot();
      const hardware = s.switcher.connection === 'usb' || s.switcher.connection === 'ethernet';
      const obs = s.obs.status === 'connected' && s.obs.scenes.length > 0;
      if (hardware && obs) break;
      await delay(150);
    }
    await delay(500);

    const clicks = String(env.TENVEO_SMOKE_CLICKS || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const selector of clicks) {
      const ok = await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
      );
      console.log(`[smoke] click ${selector}: ${ok ? 'ok' : 'no encontrado'}`);
      await delay(500);
    }
    await delay(800);

    const image = await win.webContents.capturePage();
    await fs.writeFile(out, image.toPNG());
    await fs.writeFile(out.replace(/\.png$/i, '.json'), JSON.stringify(controller.snapshot(), null, 2));
    const { width, height } = image.getSize();
    console.log(`[smoke] captura ${width}x${height} en ${out}`);
    app.exit(width > 0 && height > 0 ? 0 : 2);
  } catch (error) {
    console.error('[smoke] falló:', error);
    app.exit(1);
  }
}

async function bootstrap() {
  await app.whenReady();

  protocol.handle(SCHEME, (request) => {
    const file = resolveAppFile(request.url);
    if (!file) return new Response('No encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  const saved = await store.load();
  const settings = { ...saved.settings };
  if (env.TENVEO_OBS_HOST) settings.obsHost = env.TENVEO_OBS_HOST;
  if (env.TENVEO_OBS_PORT) settings.obsPort = Number(env.TENVEO_OBS_PORT);
  const obsPassword = env.TENVEO_OBS_PASSWORD ?? saved.obsPassword;

  const tenveoOptions = {};
  if (env.TENVEO_USB_URL) tenveoOptions.usbUrl = env.TENVEO_USB_URL;

  controller = new StudioController({
    tenveo: new TenveoService(tenveoOptions),
    obs: new ObsService(),
    settings,
    obsPassword,
    persist: (next, password) => {
      store.save(next, password).catch((error) => console.error('[Settings] No se pudo guardar:', error));
    },
    extras: {
      platform: 'electron',
      version: app.getVersion(),
      adb: { state: env.TENVEO_DISABLE_ADB === '1' ? 'disabled' : 'starting', message: '' },
    },
  });
  controller.onChange(schedulePush);
  registerIpc();

  if (env.TENVEO_DISABLE_ADB !== '1') {
    adb = new AdbBridge({
      findOptions: {
        resourcesPath: app.isPackaged ? process.resourcesPath : null,
        vendorDir: path.join(PROJECT_DIR, 'vendor'),
      },
    });
    adb.on('status', (status) => {
      controller.setExtra('adb', status);
      // En cuanto el puente queda listo, se intenta conectar sin esperar.
      if (status.state === 'forwarded') controller.dispatch('retryHardware');
    });
    adb.start().catch((error) => console.error('[ADB]', error));
  }

  controller.start();
  mainWindow = createWindow();
  if (env.TENVEO_SMOKE_SHOT) runSmoke(mainWindow);
}

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  if (!adb) {
    controller?.stop();
    return;
  }
  // Quita los reenvíos de adb antes de salir, con un límite de tiempo.
  event.preventDefault();
  Promise.race([adb.stop(), delay(2500)]).finally(() => {
    controller?.stop();
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  bootstrap().catch((error) => {
    console.error('[Tenveo Studio] Error al iniciar:', error);
    app.exit(1);
  });
}
