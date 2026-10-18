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
//   TENVEO_VIDEO_KEY      clave que espera el servidor RTMP de la app (modo push)
//   TENVEO_RTMP_PORT      puerto del servidor RTMP de la app
//   TENVEO_RTMP_HOST      dirección donde escucha (por defecto todas; 127.0.0.1 en pruebas)
//   TENVEO_DEVICE_RTMP_PORT  puerto del servidor RTMP del PC500 por IPv4 (pruebas; 1935)
//   TENVEO_SMOKE_SHOT     guarda una captura PNG de la ventana y cierra la app
//   TENVEO_SMOKE_CLICKS   selectores CSS separados por "|" para pulsar antes de la captura
//   TENVEO_SMOKE_WAIT_VIDEO=1  espera a que el monitor PGM muestre video antes de la captura
//   TENVEO_SMOKE_VIDEO_TIMEOUT_MS  cuánto esperar ese video (por defecto 15000)
//   TENVEO_SMOKE_STOP_STREAM=1 al terminar, apaga STREAM si ningún destino sale a internet
//   TENVEO_ETHERNET_IP, TENVEO_CONNECTION_MODE  IP del PC500 y modo de conexión al arrancar

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell, systemPreferences } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ObsService } from '../core/obs-service.js';
import { deviceVideoPlan, isIPv4, streamDestinations } from '../core/pc500-protocol.js';
import { StudioController } from '../core/studio-controller.js';
import { TenveoService, hostForUrl, isLinkLocal } from '../core/tenveo-service.js';
import { AdbBridge, RTMP_FORWARD_PORT } from './adb-bridge.js';
import { addressFacing, discoverPc500, localIPv4Networks } from './lan-discovery.js';
import { LowLatencyWebSocket } from './net-websocket.js';
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

let mainWindow = null;
let controller = null;
let tenveo = null;
let adb = null;
let receiver = null;
let discovering = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// La IPv4 que el PC500 tiene configurada: la que usa él para transmitir.
function deviceOwnIp() {
  const { switcher, settings } = controller.snapshot();
  if (isIPv4(switcher.device?.ip)) return switcher.device.ip;
  return isIPv4(settings.ethernetIp) ? settings.ethernetIp : '';
}

// Una IP libre de la misma red que el PC500, para sugerirla en la Mac.
function suggestMacIp(deviceIp) {
  const parts = String(deviceIp).split('.').map(Number);
  if (parts.length !== 4) return '';
  parts[3] = parts[3] === 50 ? 51 : 50;
  return parts.join('.');
}

let networksCache = { at: 0, list: [] };
function macNetworks() {
  if (Date.now() - networksCache.at > 5000) networksCache = { at: Date.now(), list: localIPv4Networks() };
  return networksCache.list;
}

function macFacing(deviceIp) {
  return isIPv4(deviceIp) ? addressFacing(deviceIp, macNetworks()) : null;
}

// Cómo llega la app al servidor RTMP del PC500, que escucha solo por IPv4: por
// el reenvío de adb (USB o red) o por la IPv4 del equipo si la Mac está en su red.
function deviceRtmpRoute() {
  const { extras } = controller.snapshot();
  if (extras.adb?.rtmpForwarded) return { host: '127.0.0.1', port: RTMP_FORWARD_PORT, via: extras.adb.rtmpVia };
  const ip = deviceOwnIp();
  if (!ip) return null;
  return { host: ip, port: Number(env.TENVEO_DEVICE_RTMP_PORT) || 1935, via: macFacing(ip) ? 'lan' : 'ip' };
}

// Por un cable de red sin IPv4 en común, el video solo llega por adb en red.
function syncAdbTarget() {
  if (!adb) return;
  const { switcher, settings } = controller.snapshot();
  const needed =
    settings.videoSource === 'pull' && switcher.connection === 'ethernet' && settings.ethernetIp && !macFacing(deviceOwnIp());
  adb.setNetworkTarget(needed ? settings.ethernetIp : '');
}

// Un destino de STREAM que apunta al servidor RTMP de esta Mac (modo push).
function isMacServer(server) {
  const match = /^rtmp:\/\/([^/:]+)(?::(\d+))?\/live\/?$/i.exec(String(server).trim());
  if (!match) return false;
  const port = Number(match[2] || 1935);
  const own = new Set(['127.0.0.1', ...macNetworks().map((n) => n.address)]);
  return own.has(match[1]) && port === (receiver?.rtmpPort || controller.snapshot().settings.rtmpPort);
}

// Usa el estado completo del servicio: la foto del controlador no trae los
// datos crudos del equipo, donde están los destinos de STREAM.
function videoPlan() {
  return deviceVideoPlan(tenveo.state, { isLocal: isMacServer });
}

// Lo que la ventana necesita para explicar el video: ruta, destino que se lee
// y si se puede encender o apagar STREAM sin tocar una plataforma externa.
let lastDeviceVideo = '';
function syncDeviceVideo() {
  const { switcher } = controller.snapshot();
  const connected = switcher.connection === 'usb' || switcher.connection === 'ethernet';
  const ip = deviceOwnIp();
  const facing = macFacing(ip);
  const plan = videoPlan();
  const route = deviceRtmpRoute();
  const info = {
    connected,
    deviceIp: ip,
    macAddress: facing ?? '',
    sameSubnet: Boolean(facing),
    suggestion: ip && !facing ? suggestMacIp(ip) : '',
    route: route?.via ?? '',
    ...plan,
  };
  const key = JSON.stringify(info);
  if (key === lastDeviceVideo) return;
  lastDeviceVideo = key;
  controller.setExtra('deviceVideo', info);
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
    const route = deviceRtmpRoute();
    const { key } = videoPlan();
    if (!route || !key) return { mode: 'off', waiting: route ? 'key' : 'route' };
    return {
      mode: 'pull',
      url: `rtmp://${hostForUrl(route.host)}:${route.port}/live/${key}`,
      tcUrl: `rtmp://${deviceOwnIp() || '127.0.0.1'}:1935/live`,
    };
  }
  return { mode: 'off' };
}

function syncVideo() {
  if (!receiver) return;
  const config = videoConfig();
  const key = JSON.stringify(config);
  if (key === lastVideoConfig) return;
  lastVideoConfig = key;
  const { waiting, ...receiverConfig } = config;
  videoQueue = videoQueue
    .then(() => receiver.configure(receiverConfig))
    .then(() => {
      // Sin ruta o sin destino que leer no hay receptor: la ventana lo explica
      // con extras.deviceVideo.
      if (waiting) controller.setExtra('video', { ...receiver.status, mode: 'pull', state: 'waiting', error: '' });
    })
    .catch((error) => console.error('[Video]', error));
}

// Enciende STREAM para ver el video en la Mac. Solo si ningún destino es una
// plataforma externa: con STREAM el equipo transmite a sus dos destinos.
async function startDeviceStream() {
  const { settings } = controller.snapshot();
  if (!tenveo.isConnected) return { ok: false, error: 'Conecta primero el PC500.' };
  if (settings.videoSource !== 'pull' && settings.videoSource !== 'push') {
    return { ok: false, error: 'Elige primero el video por red.' };
  }
  const plan = videoPlan();
  if (settings.videoSource === 'pull' && !plan.key) {
    return { ok: false, error: 'Ningún destino de STREAM usa el servidor interno del PC500. En su panel, elige "Default" como servidor de uno de los destinos.' };
  }
  const toMac = streamDestinations(tenveo.state).some((d) => isMacServer(d.server) && d.key === settings.videoKey);
  if (settings.videoSource === 'push' && !toMac) {
    return { ok: false, error: 'Ningún destino de STREAM apunta a esta Mac. Ponle en el panel del PC500 el servidor y la clave que se muestran abajo.' };
  }
  if (plan.streaming) return { ok: true, result: { started: false, key: plan.key } };
  if (!plan.canStart) {
    const target = plan.external[0] ? ` también transmite a ${plan.external[0]}` : ' no tiene destinos';
    return { ok: false, error: `No se enciende STREAM desde aquí: el PC500${target}. El video aparecerá cuando salgas al aire.` };
  }
  tenveo.pressButton('stream');
  return { ok: true, result: { started: true, key: plan.key } };
}

// Apaga STREAM solo si no hay una plataforma externa al aire.
function stopDeviceStream() {
  const plan = videoPlan();
  if (!plan.streaming) return { ok: true, result: false };
  if (!plan.canStop) return { ok: false, error: `STREAM está al aire en ${plan.external[0]}. Apágalo desde el panel del PC500 si quieres cortar la transmisión.` };
  tenveo.pressButton('stream');
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

// Los navegadores no abren direcciones IPv6 de enlace local (fe80::…%en0).
function originalPanelUrl() {
  const snapshot = controller.snapshot();
  const ip = snapshot.settings.ethernetIp;
  const usable = ip && !isLinkLocal(ip);
  if (snapshot.switcher.connection === 'ethernet' && usable) return `http://${hostForUrl(ip)}/`;
  if (snapshot.extras.adb?.panelForwarded) return 'http://127.0.0.1:8080/';
  const own = deviceOwnIp();
  if (own && macFacing(own)) return `http://${own}/`;
  if (usable) return `http://${hostForUrl(ip)}/`;
  return null;
}

async function openOriginalPanel() {
  const url = originalPanelUrl();
  if (!url) {
    const ip = controller.snapshot().settings.ethernetIp;
    if (isLinkLocal(ip)) {
      const own = deviceOwnIp();
      const suggestion = own ? ` o pon en el Ethernet de la Mac una IP como ${suggestMacIp(own)}` : '';
      return { ok: false, error: `El navegador no abre el panel por el cable directo (IPv6). Conecta el USB${suggestion}.` };
    }
    return { ok: false, error: 'Conecta el PC500 por USB o escribe su IP Ethernet.' };
  }
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
      const videoTimeout = Number(env.TENVEO_SMOKE_VIDEO_TIMEOUT_MS || 15000);
      while (!playing && Date.now() - videoStart < videoTimeout) {
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
    if (env.TENVEO_SMOKE_STOP_STREAM === '1') {
      // Prueba con el equipo real: deja la transmisión como estaba.
      const stopped = stopDeviceStream();
      const text = stopped.ok ? (stopped.result ? 'sí' : 'no estaba encendida') : stopped.error;
      console.log(`[smoke] STREAM apagado: ${text}`);
      await delay(1500);
    }
    // app.exit no pasa por before-quit: se limpia aquí (reenvíos de adb incluidos).
    await Promise.allSettled([adb?.stop(), receiver?.close()]);
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
  if (env.TENVEO_ETHERNET_IP) {
    settings.ethernetIp = env.TENVEO_ETHERNET_IP;
    settings.ethernetIpSource = 'manual';
  }
  if (env.TENVEO_CONNECTION_MODE) settings.connectionMode = env.TENVEO_CONNECTION_MODE;
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
  controller.onChange(syncDeviceVideo);
  controller.onChange(syncAdbTarget);
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
