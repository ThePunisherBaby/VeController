// Proceso principal de Tenveo Studio.
//
// Todo va por red: el WebSocket del PC500 (IPv4 o IPv6 de enlace local por
// cable directo), la búsqueda en la red local y el video,
// que la app toma del servidor interno del PC500 (directo o por adb en red).
// La ventana dibuja la consola y el estudio de producción y manda comandos por
// IPC. Aquí se guardan las escenas y sus imágenes y videos, y se dan los
// permisos de cámara y de captura de pantalla, solo a la propia ventana.
//
// Variables de entorno para desarrollo y pruebas:
//   TENVEO_ETHERNET_IP    IP del PC500 al arrancar (también fe80::…%en0)
//   TENVEO_PC500_PORT     puerto del WebSocket del PC500 (por defecto 8089)
//   TENVEO_DISABLE_ADB=1  no usar adb en red para el video
//   TENVEO_USER_DATA      carpeta de datos alternativa
//   TENVEO_DEVICE_RTMP_PORT  puerto del servidor RTMP del PC500 por IPv4 (pruebas; 1935)
//   TENVEO_SMOKE_SHOT     guarda una captura PNG de la ventana y cierra la app
//   TENVEO_SMOKE_CLICKS   selectores CSS separados por "|" para pulsar antes de la captura
//   TENVEO_SMOKE_WAIT_VIDEO=1  espera a que el monitor PGM muestre video antes de la captura
//   TENVEO_SMOKE_VIDEO_TIMEOUT_MS  cuánto esperar ese video (por defecto 15000)
//   TENVEO_SMOKE_STOP_STREAM=1 al terminar, apaga STREAM si ningún destino sale a internet
//   TENVEO_SMOKE_SIZE     tamaño de la ventana en las capturas, por ejemplo 1180x740
//   TENVEO_SMOKE_MEDIA    preferencias del sistema simuladas en las capturas, por ejemplo
//                         prefers-contrast:more,prefers-reduced-transparency:reduce
//   TENVEO_SMOKE_EVAL     código que corre en la ventana después de los clics (capturas)
//   TENVEO_HIDE_WINDOW=1  la ventana no se muestra (pruebas que no deben molestar en la pantalla)
//   TENVEO_FAKE_MEDIA=1   cámara falsa de Chromium en vez de las de la Mac (pruebas; no pide permiso)

import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  systemPreferences,
} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deviceVideoPlan, isIPv4 } from '../core/pc500-protocol.js';
import { StudioController } from '../core/studio-controller.js';
import { TenveoService, hostForUrl, isLinkLocal } from '../core/tenveo-service.js';
import { AdbBridge, RTMP_FORWARD_PORT } from './adb-bridge.js';
import { addressFacing, discoverPc500, localIPv4Networks } from './lan-discovery.js';
import { mediaResponse } from './media-response.js';
import { LowLatencyWebSocket } from './net-websocket.js';
import { MEDIA_FILTERS, ProductionStore } from './production-store.js';
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

// Una app de transmisión no se frena en segundo plano. Medido: con la ventana
// tapada, oculta o minimizada, Chromium pausa los videos sin audio y deja de
// dibujar. Así el video del PC500 y el compositor siguen igual.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-media-suspend');
if (env.TENVEO_FAKE_MEDIA === '1') app.commandLine.appendSwitch('use-fake-device-for-media-stream');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow = null;
let controller = null;
let tenveo = null;
let adb = null;
let receiver = null;
let production = null;
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
// el reenvío de adb en red o por la IPv4 del equipo si la Mac está en su red.
function deviceRtmpRoute() {
  const { extras } = controller.snapshot();
  if (extras.adb?.rtmpForwarded) return { host: '127.0.0.1', port: RTMP_FORWARD_PORT, via: 'adb' };
  const ip = deviceOwnIp();
  if (!ip) return null;
  return { host: ip, port: Number(env.TENVEO_DEVICE_RTMP_PORT) || 1935, via: macFacing(ip) ? 'lan' : 'ip' };
}

// Por un cable de red sin IPv4 en común, el video solo llega por adb en red.
function syncAdbTarget() {
  if (!adb) return;
  const { switcher, settings } = controller.snapshot();
  const needed = switcher.connection === 'ethernet' && settings.ethernetIp && !macFacing(deviceOwnIp());
  adb.setNetworkTarget(needed ? settings.ethernetIp : '');
}

// Usa el estado completo del servicio: la foto del controlador no trae los
// datos crudos del equipo, donde están los destinos de STREAM.
function videoPlan() {
  return deviceVideoPlan(tenveo.state);
}

// Lo que la ventana necesita para explicar el video: ruta, destino que se lee
// y si se puede encender o apagar STREAM sin tocar una plataforma externa.
let lastDeviceVideo = '';
function syncDeviceVideo() {
  const { switcher } = controller.snapshot();
  const connected = switcher.connection === 'ethernet';
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
  const route = deviceRtmpRoute();
  const { key } = videoPlan();
  if (!route || !key) return { mode: 'off', waiting: route ? 'key' : 'route' };
  return {
    mode: 'pull',
    url: `rtmp://${hostForUrl(route.host)}:${route.port}/live/${key}`,
    tcUrl: `rtmp://${deviceOwnIp() || '127.0.0.1'}:1935/live`,
  };
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
  if (!tenveo.isConnected) return { ok: false, error: 'Conecta primero el PC500.' };
  const plan = videoPlan();
  if (!plan.key) {
    return { ok: false, error: 'Ningún destino de STREAM usa el servidor interno del PC500. En su panel, elige "Default" como servidor de uno de los destinos.' };
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

async function discoverDevices({ auto = false } = {}) {
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
    // Búsqueda automática: si aparece un PC500 en otra dirección, se usa.
    const current = controller.snapshot().settings.ethernetIp;
    if (auto && found.length && !tenveo.isConnected && !found.some((d) => d.host === current)) {
      controller.dispatch('saveSettings', { ethernetIp: found[0].host });
    }
    return { ok: true, result: found };
  } catch (error) {
    controller.setExtra('discovery', { state: 'error', checked: 0, total: 0, found: [], error: error.message });
    return { ok: false, error: `No se pudo buscar en la red: ${error.message}` };
  } finally {
    discovering = false;
  }
}

// Sin IP guardada, o si el PC500 no responde hace rato, se lo busca solo en la
// red (también por cable directo). Como mucho una vez por minuto.
let disconnectedSince = Date.now();
let lastAutoDiscovery = 0;
function watchConnection() {
  if (tenveo.isConnected) {
    disconnectedSince = Date.now();
    return;
  }
  const noIp = !controller.snapshot().settings.ethernetIp;
  const lost = Date.now() - disconnectedSince > 20000;
  if ((noIp || lost) && !discovering && Date.now() - lastAutoDiscovery > 60000) {
    lastAutoDiscovery = Date.now();
    discoverDevices({ auto: true }).catch(() => {});
  }
}

// Los navegadores no abren direcciones IPv6 de enlace local (fe80::…%en0).
function originalPanelUrl() {
  const ip = controller.snapshot().settings.ethernetIp;
  if (ip && !isLinkLocal(ip)) return `http://${hostForUrl(ip)}/`;
  const own = deviceOwnIp();
  if (own && macFacing(own)) return `http://${own}/`;
  return null;
}

async function openOriginalPanel() {
  const url = originalPanelUrl();
  if (!url) {
    const ip = controller.snapshot().settings.ethernetIp;
    if (isLinkLocal(ip)) {
      const own = deviceOwnIp();
      const suggestion = own ? ` Para abrirlo, pon en el Ethernet de la Mac una IP como ${suggestMacIp(own)}.` : '';
      return { ok: false, error: `El navegador no abre el panel por el cable directo (IPv6).${suggestion}` };
    }
    return { ok: false, error: 'Busca primero el PC500 en la red.' };
  }
  await shell.openExternal(url);
  return { ok: true, result: url };
}

// --- Estudio de producción ---

async function getProduction() {
  return { ok: true, result: await production.load() };
}

async function saveProduction(doc) {
  const { done } = production.save(doc);
  await done;
  return { ok: true, result: true };
}

// Imagen… o Video… del menú Agregar: el archivo se copia a la carpeta de la app.
async function importMedia(kind) {
  if (!Object.hasOwn(MEDIA_FILTERS, kind)) return { ok: false, error: 'Tipo de archivo desconocido.' };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'image' ? 'Elegir una imagen' : 'Elegir un video',
    buttonLabel: 'Agregar',
    properties: ['openFile'],
    filters: MEDIA_FILTERS[kind],
  });
  if (canceled || !filePaths[0]) return { ok: true, result: null };
  return { ok: true, result: await production.importMedia(filePaths[0], kind) };
}

// Un archivo arrastrado desde el Finder a la salida.
async function importMediaPath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return { ok: false, error: 'Ese archivo no se puede usar.' };
  return { ok: true, result: await production.importMedia(file) };
}

// Pantallas y ventanas para el selector, con miniaturas. La propia ventana no
// aparece: capturarla mostraría la salida dentro de sí misma.
async function listCaptureSources() {
  const status = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
  const own = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : '';
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  const list = sources
    .filter((source) => source.id !== own)
    .map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : '',
    }));
  return { ok: true, result: { status, sources: list } };
}

// Permiso de macOS para la cámara o la pantalla. La cámara se puede pedir; la
// pantalla solo se habilita en Ajustes del Sistema.
const PRIVACY_PANES = { camera: 'Privacy_Camera', microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture' };

async function mediaAccess(kind, ask = false) {
  if (!Object.hasOwn(PRIVACY_PANES, kind)) return { ok: false, error: 'Permiso desconocido.' };
  if (process.platform !== 'darwin') return { ok: true, result: 'granted' };
  let status = systemPreferences.getMediaAccessStatus(kind);
  if (ask === true && status === 'not-determined' && kind !== 'screen') {
    status = (await systemPreferences.askForMediaAccess(kind)) ? 'granted' : 'denied';
  }
  return { ok: true, result: status };
}

async function openPrivacySettings(kind) {
  if (!Object.hasOwn(PRIVACY_PANES, kind)) return { ok: false, error: 'Permiso desconocido.' };
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PRIVACY_PANES[kind]}`);
  return { ok: true, result: true };
}

// Menú contextual nativo (clic derecho, o el botón Agregar). Devuelve el id
// del ítem elegido, o null si se cerró sin elegir.
function menuTemplate(items, depth, choose) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map((item) => {
    if (item?.type === 'separator') return { type: 'separator' };
    const entry = { label: String(item?.label ?? '').slice(0, 80), enabled: item?.enabled !== false };
    if (Array.isArray(item?.submenu) && depth < 2) entry.submenu = menuTemplate(item.submenu, depth + 1, choose);
    else {
      if (typeof item?.checked === 'boolean') {
        entry.type = 'checkbox';
        entry.checked = item.checked;
      }
      entry.click = () => choose(String(item?.id ?? ''));
    }
    return entry;
  });
}

function popupMenu({ items, x, y } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const choose = (id) => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, result: id });
    };
    const menu = Menu.buildFromTemplate(menuTemplate(items, 0, choose));
    // La ventana manda píxeles CSS; con zoom, la Mac los quiere en puntos.
    const zoom = mainWindow?.webContents.getZoomFactor() ?? 1;
    const at = Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x * zoom), y: Math.round(y * zoom) } : {};
    // El clic llega justo después de cerrarse el menú: se le da un instante.
    menu.popup({ window: mainWindow, ...at, callback: () => setTimeout(() => choose(null), 60) });
  });
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
  discoverDevices: () => discoverDevices(),
  startDeviceStream,
  stopDeviceStream: async () => stopDeviceStream(),
  getProduction,
  saveProduction,
  importMedia,
  importMediaPath,
  listCaptureSources,
  mediaAccess,
  openPrivacySettings,
  popupMenu,
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

// Solo la propia ventana puede usar la cámara y capturar la pantalla (fuentes
// del estudio). Todo lo demás se rechaza: micrófono, ubicación, avisos, etc.
function fromAppWindow(webContents, url) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents && String(url ?? '').startsWith(`${SCHEME}://${HOST}`));
}

function registerPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const video = permission === 'media' && (details.mediaTypes ?? []).length > 0 && details.mediaTypes.every((type) => type === 'video');
    callback(video && fromAppWindow(webContents, details.requestingUrl));
  });
  ses.setPermissionCheckHandler((webContents, permission, origin, details) => {
    return permission === 'media' && details?.mediaType !== 'audio' && fromAppWindow(webContents, origin);
  });
}

// Menú de la Mac en español, como el de una app nativa: Ajustes… con ⌘,,
// Edición para los campos de texto, zoom y pantalla completa, y la ventana
// Acerca de con la versión. Las herramientas de desarrollo solo sin empaquetar.
function buildMenu() {
  const name = 'Tenveo Studio';
  app.setAboutPanelOptions({
    applicationName: name,
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Consola y estudio de producción para el switcher Tenveo PC500.',
  });
  const send = (action) => () => mainWindow?.webContents.send('tenveo:menu', action);
  const template = [
    {
      label: name,
      submenu: [
        { role: 'about', label: `Acerca de ${name}` },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'Command+,', click: send('open-settings') },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${name}` },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: `Salir de ${name}` },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Visualización',
      submenu: [
        { label: 'Consola', accelerator: 'Command+1', click: send('view-console') },
        { label: 'Producción', accelerator: 'Command+2', click: send('view-studio') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reducir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged
          ? []
          : [{ type: 'separator' }, { role: 'reload', label: 'Volver a cargar' }, { role: 'toggleDevTools', label: 'Herramientas para desarrolladores' }]),
      ],
    },
    {
      label: 'Ventana',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' },
      ],
    },
    {
      label: 'Ayuda',
      role: 'help',
      submenu: [
        { label: `Documentación de ${name}`, click: () => shell.openExternal('https://github.com/ThePunisherBaby/VeController#readme') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// El fondo de la ventana es el de la interfaz, así no hay destellos al abrir
// ni al cambiar de apariencia.
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#000000' : '#f2f2f7');

// La apariencia elegida en Ajustes (system, dark o light) también pinta lo
// nativo: los semáforos, las barras de desplazamiento y los menús.
let appliedAppearance = '';
function syncAppearance() {
  const { appearance } = controller.snapshot().settings;
  if (appearance === appliedAppearance) return;
  appliedAppearance = appearance;
  nativeTheme.themeSource = appearance;
  mainWindow?.setBackgroundColor(windowBackground());
}

function createWindow() {
  const smoke = Boolean(env.TENVEO_SMOKE_SHOT);
  const [smokeWidth, smokeHeight] = String(env.TENVEO_SMOKE_SIZE || '').split('x').map(Number);
  const win = new BrowserWindow({
    width: smoke && smokeWidth ? smokeWidth : 1440,
    height: smoke && smokeHeight ? smokeHeight : 900,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: windowBackground(),
    // La barra de la app hace de barra de título: los semáforos quedan dentro,
    // centrados en sus 52 px de alto.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    title: 'Tenveo Studio',
    show: false,
    webPreferences: {
      preload: path.join(SRC_DIR, 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Ver los interruptores del principio: nada se frena en segundo plano.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  if (!smoke && env.TENVEO_HIDE_WINDOW !== '1') win.once('ready-to-show', () => win.show());
  // En pantalla completa no hay semáforos: la barra recupera ese espacio. Con
  // la ventana minimizada u oculta, la ventana deja de dibujar lo que no se ve.
  const windowState = { fullscreen: false, hidden: false };
  const setWindow = (patch) => {
    Object.assign(windowState, patch);
    controller.setExtra('window', { ...windowState });
  };
  win.on('enter-full-screen', () => setWindow({ fullscreen: true }));
  win.on('leave-full-screen', () => setWindow({ fullscreen: false }));
  win.on('minimize', () => setWindow({ hidden: true }));
  win.on('restore', () => setWindow({ hidden: false }));
  win.on('hide', () => setWindow({ hidden: true }));
  win.on('show', () => setWindow({ hidden: false }));
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
    if (env.TENVEO_SMOKE_MEDIA) {
      // Más contraste, transparencia reducida, etc., como si estuvieran activos en macOS.
      const features = env.TENVEO_SMOKE_MEDIA.split(',').map((pair) => {
        const [name, value] = pair.split(':');
        return { name: name.trim(), value: String(value ?? '').trim() };
      });
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
    }
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      const s = controller.snapshot();
      if (s.switcher.connection === 'ethernet') break;
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

    if (env.TENVEO_SMOKE_EVAL) {
      await win.webContents.executeJavaScript(env.TENVEO_SMOKE_EVAL);
      await delay(1200);
    }

    if (env.TENVEO_SMOKE_WAIT_VIDEO === '1') {
      const videoStart = Date.now();
      let playing = false;
      const videoTimeout = Number(env.TENVEO_SMOKE_VIDEO_TIMEOUT_MS || 15000);
      while (!playing && Date.now() - videoStart < videoTimeout) {
        // En Producción el monitor PGM no dibuja: cuentan los cuadros que pasa al estudio.
        playing = await win.webContents.executeJavaScript(
          `(() => { const s = globalThis.tenveoPgmStats; return Boolean(s && (s.drawn > 10 || s.forwarded > 10) && !document.getElementById('pgm-canvas').hidden); })()`,
        );
        if (!playing) await delay(200);
      }
      console.log(`[smoke] video en el monitor PGM: ${playing ? 'sí' : 'no'}`);
      await delay(600);
    }
    await delay(800);

    const image = await win.webContents.capturePage();
    await fs.writeFile(out, image.toPNG());
    const monitor = await win.webContents.executeJavaScript(`globalThis.tenveoPgmStats ?? null`);
    await fs.writeFile(out.replace(/\.png$/i, '.json'), JSON.stringify({ ...controller.snapshot(), monitor }, null, 2));
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

  production = new ProductionStore(app.getPath('userData'));
  protocol.handle(SCHEME, (request) => {
    // Imágenes y videos de la producción: app://tenveo/media/<huella>.<ext>
    const url = new URL(request.url);
    if (url.host === HOST && url.pathname.startsWith('/media/')) {
      const media = production.resolveMedia(decodeURIComponent(url.pathname.slice('/media/'.length)));
      return media ? mediaResponse(media, request.headers.get('range')) : new Response('No encontrado', { status: 404 });
    }
    const file = resolveAppFile(request.url);
    if (!file) return new Response('No encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerPermissions();

  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  const saved = await store.load();
  const settings = { ...saved.settings };
  if (env.TENVEO_ETHERNET_IP) settings.ethernetIp = env.TENVEO_ETHERNET_IP;

  const tenveoOptions = { WebSocketImpl: LowLatencyWebSocket };
  if (env.TENVEO_PC500_PORT) tenveoOptions.ethernetPort = Number(env.TENVEO_PC500_PORT);
  tenveo = new TenveoService(tenveoOptions);

  receiver = new VideoReceiver();
  controller = new StudioController({
    tenveo,
    settings,
    persist: (next) => {
      store.save(next).catch((error) => console.error('[Settings] No se pudo guardar:', error));
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
  controller.onChange(syncAppearance);
  syncAppearance();
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackground()));
  buildMenu();
  // Empaquetada, el ícono va en la app; desde el código fuente se pone en el Dock.
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(path.join(PROJECT_DIR, 'build', 'icon.png'));
  registerIpc();

  if (env.TENVEO_DISABLE_ADB !== '1') {
    adb = new AdbBridge({
      findOptions: {
        resourcesPath: app.isPackaged ? process.resourcesPath : null,
        vendorDir: path.join(PROJECT_DIR, 'vendor'),
      },
    });
    adb.on('status', (status) => controller.setExtra('adb', status));
    adb.start().catch((error) => console.error('[ADB]', error));
  }

  controller.start();
  syncVideo();
  if (!env.TENVEO_SMOKE_SHOT) {
    watchConnection();
    setInterval(watchConnection, 5000).unref();
  }
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
