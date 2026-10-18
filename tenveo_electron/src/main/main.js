// Proceso principal de Tenveo Studio.
//
// Aquí viven las conexiones: WebSocket del PC500, WebSocket de OBS, el puente
// ADB, la búsqueda en la red local y el receptor de video. La ventana solo
// dibuja la consola y manda comandos por IPC.
//
// Variables de entorno para desarrollo y pruebas:
//   TENVEO_USB_URL        WebSocket del PC500 por USB (por defecto ws://127.0.0.1:8089)
//   TENVEO_OBS_HOST, TENVEO_OBS_PORT, TENVEO_OBS_PASSWORD
//   TENVEO_DISABLE_ADB=1  no usar adb
//   TENVEO_USER_DATA      carpeta de datos alternativa
//   TENVEO_VIDEO          fuente de video al arrancar (off, push, pull, usb)
//   TENVEO_VIDEO_KEY      clave del stream de video
//   TENVEO_RTMP_PORT      puerto del servidor RTMP de la app
//   TENVEO_RTMP_HOST      dirección donde escucha (por defecto todas; 127.0.0.1 en pruebas)
//   TENVEO_SMOKE_SHOT     guarda una captura PNG de la ventana y cierra la app
//   TENVEO_SMOKE_CLICKS   selectores CSS separados por "|" para pulsar antes de la captura
//   TENVEO_SMOKE_WAIT_VIDEO=1  espera a que el monitor PGM muestre video antes de la captura

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell, systemPreferences } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { ObsService } from '../core/obs-service.js';
import { VIDEO_STREAM_SLOT, isIPv4, streamButtonForSlot } from '../core/pc500-protocol.js';
import { StudioController } from '../core/studio-controller.js';
import { TenveoService } from '../core/tenveo-service.js';
import { AdbBridge } from './adb-bridge.js';
import { addressFacing, discoverPc500 } from './lan-discovery.js';
import { SettingsStore } from './settings-store.js';
import { VideoReceiver } from './video-receiver.js';

const env = process.env;
const SRC_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROJECT_DIR = path.resolve(SRC_DIR, '..');
const SCHEME = 'app';
const HOST = 'tenveo';
const APP_PREFIX = `${SCHEME}://${HOST}/`;
const START_URL = `${APP_PREFIX}renderer/index.html`;
const SERVED_DIRS = new Set(['renderer', 'core']);
const DEFAULT_DEVICE_IP = '192.168.1.188';

if (env.TENVEO_USER_DATA) app.setPath('userData', env.TENVEO_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// WebSocket del proceso principal: con ping para el latido y sin compresión,
// que en mensajes tan chicos solo suma latencia.
class LowLatencyWebSocket extends WebSocket {
  constructor(url) {
    super(url, { perMessageDeflate: false, handshakeTimeout: 3000 });
  }
}

let mainWindow = null;
let controller = null;
let tenveo = null;
let adb = null;
let receiver = null;
let discovering = false;

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

function isAppUrl(value) {
  return typeof value === 'string' && value.startsWith(APP_PREFIX);
}

function isTrustedSender(event) {
  return isAppUrl(event.senderFrame?.url);
}

function deviceIp() {
  const { switcher, settings } = controller.snapshot();
  if (isIPv4(switcher.device?.ip)) return switcher.device.ip;
  return isIPv4(settings.ethernetIp) ? settings.ethernetIp : '';
}

// --- Video por red ---

let videoQueue = Promise.resolve();
let lastVideoConfig = '';

function videoConfig() {
  const { settings } = controller.snapshot();
  if (settings.videoSource === 'push') {
    return { mode: 'push', key: settings.videoKey, rtmpPort: settings.rtmpPort, rtmpHost: env.TENVEO_RTMP_HOST || '0.0.0.0' };
  }
  if (settings.videoSource === 'pull') {
    const ip = deviceIp();
    if (!ip) return { mode: 'off', missingIp: true };
    return { mode: 'pull', url: `rtmp://${ip}:1935/live/${settings.videoKey}` };
  }
  return { mode: 'off' };
}

function syncVideo() {
  if (!receiver) return;
  const config = videoConfig();
  const key = JSON.stringify(config);
  if (key === lastVideoConfig) return;
  lastVideoConfig = key;
  const { missingIp, ...receiverConfig } = config;
  videoQueue = videoQueue
    .then(() => receiver.configure(receiverConfig))
    .then(() => {
      if (missingIp) {
        controller.setExtra('video', {
          ...receiver.status,
          mode: 'pull',
          state: 'error',
          error: 'Falta la IP del PC500. Conéctalo una vez por USB o escribe su IP.',
        });
      }
    })
    .catch((error) => console.error('[Video]', error));
}

// Configura el canal 2 del PC500 para mandar video a esta Mac y lo enciende.
async function startDeviceStream() {
  const { settings } = controller.snapshot();
  if (!tenveo.isConnected) return { ok: false, error: 'Conecta primero el PC500.' };
  const ip = deviceIp();
  let server;
  if (settings.videoSource === 'push') {
    const macIp = addressFacing(ip);
    if (!macIp) return { ok: false, error: 'La Mac no tiene una IP de red local.' };
    server = `rtmp://${macIp}:${receiver.rtmpPort || settings.rtmpPort}/live`;
  } else if (settings.videoSource === 'pull') {
    if (!ip) return { ok: false, error: 'Falta la IP del PC500. Conéctalo una vez por USB o escribe su IP.' };
    // Igual que el panel original cuando el canal usa el servidor del equipo.
    server = `rtmp://${ip}:1935/live/`;
  } else {
    return { ok: false, error: 'Elige primero recibir o leer el video por red.' };
  }

  tenveo.setStreamTarget(VIDEO_STREAM_SLOT, server, settings.videoKey);
  const button = streamButtonForSlot(VIDEO_STREAM_SLOT);
  if (tenveo.isButtonOn(button)) {
    // Ya transmitía: se reinicia para que tome el destino nuevo.
    tenveo.pressButton(button);
    await delay(1500);
  }
  tenveo.pressButton(button);
  return { ok: true, result: { server, key: settings.videoKey, slot: VIDEO_STREAM_SLOT } };
}

function stopDeviceStream() {
  const button = streamButtonForSlot(VIDEO_STREAM_SLOT);
  if (!tenveo.isButtonOn(button)) return { ok: true, result: false };
  tenveo.pressButton(button);
  return { ok: true, result: true };
}

// --- Red local ---

async function discoverDevices() {
  if (discovering) return { ok: false, error: 'Ya se está buscando en la red.' };
  discovering = true;
  const { settings, switcher } = controller.snapshot();
  controller.setExtra('discovery', { state: 'searching', checked: 0, total: 0, found: [] });
  let lastReport = 0;
  try {
    const found = await discoverPc500({
      extraHosts: [settings.ethernetIp, switcher.device?.ip, DEFAULT_DEVICE_IP],
      onProgress: (checked, total) => {
        const now = Date.now();
        if (now - lastReport < 150 && checked < total) return;
        lastReport = now;
        controller.setExtra('discovery', { state: 'searching', checked, total, found: [] });
      },
    });
    controller.setExtra('discovery', { state: 'done', checked: 0, total: 0, found });
    return { ok: true, result: found };
  } catch (error) {
    controller.setExtra('discovery', { state: 'error', checked: 0, total: 0, found: [], error: error.message });
    return { ok: false, error: `No se pudo buscar en la red: ${error.message}` };
  } finally {
    discovering = false;
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

async function requestCameraAccess() {
  if (process.platform !== 'darwin') return { ok: true, result: true };
  const status = systemPreferences.getMediaAccessStatus('camera');
  if (status === 'granted') return { ok: true, result: true };
  if (status === 'denied' || status === 'restricted') {
    return { ok: false, error: 'macOS no deja usar la cámara. Actívala en Ajustes del Sistema > Privacidad y seguridad > Cámara.' };
  }
  const granted = await systemPreferences.askForMediaAccess('camera');
  return granted ? { ok: true, result: true } : { ok: false, error: 'No se dio permiso para usar la cámara.' };
}

// --- IPC y estado ---

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

const MAIN_COMMANDS = {
  openOriginalPanel,
  discoverDevices,
  startDeviceStream,
  stopDeviceStream: async () => stopDeviceStream(),
  requestCameraAccess,
};

function registerIpc() {
  ipcMain.handle('tenveo:get-state', (event) => {
    if (!isTrustedSender(event)) throw new Error('Origen no permitido');
    return controller.snapshot();
  });

  ipcMain.handle('tenveo:command', async (event, type, args) => {
    if (!isTrustedSender(event)) throw new Error('Origen no permitido');
    const list = Array.isArray(args) ? args : [];
    try {
      if (Object.hasOwn(MAIN_COMMANDS, type)) return await MAIN_COMMANDS[type](...list);
      const result = controller.dispatch(String(type), ...list);
      return { ok: true, result: result ?? null };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
}

// Solo la propia ventana puede pedir la cámara, y solo video.
function registerPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const fromApp = isAppUrl(details.requestingUrl || webContents.getURL());
    const videoOnly = (details.mediaTypes ?? []).length > 0 && details.mediaTypes.every((t) => t === 'video');
    callback(fromApp && permission === 'media' && videoOnly);
  });
  ses.setPermissionCheckHandler((_webContents, permission, origin) => permission === 'media' && isAppUrl(`${origin}/`));
}

function createWindow() {
  const smoke = Boolean(env.TENVEO_SMOKE_SHOT);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#0b0c0f',
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
    if (!isAppUrl(url)) event.preventDefault();
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
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message}`);
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

    if (env.TENVEO_SMOKE_WAIT_VIDEO === '1') {
      const videoStart = Date.now();
      let playing = false;
      while (!playing && Date.now() - videoStart < 15000) {
        playing = await win.webContents.executeJavaScript(
          `(() => { const v = document.getElementById('pgm-video'); return Boolean(v && v.readyState >= 2 && v.videoWidth > 0 && v.currentTime > 0.3); })()`,
        );
        if (!playing) await delay(200);
      }
      console.log(`[smoke] video en el monitor PGM: ${playing ? 'sí' : 'no'}`);
      await delay(600);
    }
    await delay(800);

    const image = await win.webContents.capturePage();
    await fs.writeFile(out, image.toPNG());
    const videoInfo = await win.webContents.executeJavaScript(
      `(() => { const v = document.getElementById('pgm-video'); return v ? { readyState: v.readyState, width: v.videoWidth, height: v.videoHeight, time: v.currentTime } : null; })()`,
    );
    await fs.writeFile(out.replace(/\.png$/i, '.json'), JSON.stringify({ ...controller.snapshot(), videoElement: videoInfo }, null, 2));
    const { width, height } = image.getSize();
    console.log(`[smoke] captura ${width}x${height} en ${out}`);
    await receiver?.close();
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
  registerPermissions();

  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  const saved = await store.load();
  const settings = { ...saved.settings };
  if (env.TENVEO_OBS_HOST) settings.obsHost = env.TENVEO_OBS_HOST;
  if (env.TENVEO_OBS_PORT) settings.obsPort = Number(env.TENVEO_OBS_PORT);
  if (env.TENVEO_VIDEO) settings.videoSource = env.TENVEO_VIDEO;
  if (env.TENVEO_VIDEO_KEY) settings.videoKey = env.TENVEO_VIDEO_KEY;
  if (env.TENVEO_RTMP_PORT) settings.rtmpPort = Number(env.TENVEO_RTMP_PORT);
  const obsPassword = env.TENVEO_OBS_PASSWORD ?? saved.obsPassword;

  const tenveoOptions = { WebSocketImpl: LowLatencyWebSocket };
  if (env.TENVEO_USB_URL) tenveoOptions.usbUrl = env.TENVEO_USB_URL;
  tenveo = new TenveoService(tenveoOptions);

  receiver = new VideoReceiver();
  controller = new StudioController({
    tenveo,
    obs: new ObsService({ WebSocketImpl: LowLatencyWebSocket }),
    settings,
    obsPassword,
    persist: (next, password) => {
      store.save(next, password).catch((error) => console.error('[Settings] No se pudo guardar:', error));
    },
    extras: {
      platform: 'electron',
      version: app.getVersion(),
      adb: { state: env.TENVEO_DISABLE_ADB === '1' ? 'disabled' : 'starting', message: '' },
      video: receiver.status,
      discovery: { state: 'idle', checked: 0, total: 0, found: [] },
    },
  });
  receiver.on('status', (status) => controller.setExtra('video', status));
  controller.onChange(schedulePush);
  controller.onChange(syncVideo);
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
  syncVideo();
  mainWindow = createWindow();
  if (env.TENVEO_SMOKE_SHOT) runSmoke(mainWindow);
}

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Quita los reenvíos de adb y cierra el receptor de video, con un límite de tiempo.
  const cleanup = Promise.allSettled([adb?.stop(), receiver?.close()]);
  Promise.race([cleanup, delay(2500)]).finally(() => {
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
