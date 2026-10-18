// Interfaz de la consola. No abre conexiones: dibuja el estado que recibe y
// manda comandos al núcleo (en Electron, por IPC; en el navegador, directo).

import {
  AUDIO_CHANNELS,
  CAMERAS,
  PANEL_BUTTONS,
  VOLUME_MAX_DB,
  VOLUME_MIN_DB,
  buttonLight,
  channelMode,
  clamp01,
} from '../../core/pc500-protocol.js';
import { connectBackend } from './backend.js';
import { createPgmVideo } from './video.js';

const $ = (id) => document.getElementById(id);

const els = {
  hw: $('hw-status'),
  hwText: $('hw-text'),
  hwLatency: $('hw-latency'),
  obsPill: $('obs-pill'),
  obsPillText: $('obs-pill-text'),
  demoTag: $('demo-tag'),
  sync: $('sync-toggle'),
  obsStream: $('obs-stream'),
  obsRecord: $('obs-record'),
  obsVcam: $('obs-vcam'),
  pvwCam: $('pvw-cam'),
  pvwSub: $('pvw-sub'),
  pvwLabel: $('pvw-label'),
  pgmCam: $('pgm-cam'),
  pgmSub: $('pgm-sub'),
  pgmLabel: $('pgm-label'),
  pgmBlack: $('pgm-black'),
  busPgm: $('bus-pgm'),
  busPvw: $('bus-pvw'),
  keyersA: $('keyers-a'),
  keyersB: $('keyers-b'),
  cut: $('btn-cut'),
  auto: $('btn-auto'),
  ftb: $('btn-ftb'),
  tbar: $('tbar'),
  tbarTrack: $('tbar-track'),
  tbarFill: $('tbar-fill'),
  tbarHandle: $('tbar-handle'),
  tbarValue: $('tbar-value'),
  mixer: $('mixer'),
  obsLink: $('obs-link'),
  scenes: $('scenes'),
  factConnection: $('fact-connection'),
  factLatency: $('fact-latency'),
  factIp: $('fact-ip'),
  factVersion: $('fact-version'),
  deviceMain: $('device-main'),
  deviceMore: $('device-more'),
  streamTime: $('stream-time'),
  recordTime: $('record-time'),
  videoSource: $('video-source'),
  cameraField: $('camera-field'),
  videoCamera: $('video-camera'),
  videoStatus: $('video-status'),
  videoActions: $('video-actions'),
  videoManual: $('video-manual'),
  videoServer: $('video-server'),
  videoKey: $('video-key'),
  dialog: $('settings-dialog'),
  form: $('settings-form'),
  connMode: $('conn-mode'),
  fieldIp: $('field-ip'),
  ipHint: $('ip-hint'),
  discoverBtn: $('discover-btn'),
  discovery: $('discovery'),
  adbText: $('adb-text'),
  fieldObsHost: $('field-obs-host'),
  fieldObsPort: $('field-obs-port'),
  fieldObsPass: $('field-obs-pass'),
  fieldObsClear: $('field-obs-clear'),
  fieldObsClearRow: $('field-obs-clear-row'),
  settingsError: $('settings-error'),
  toast: $('toast'),
};

const backend = await connectBackend();
document.documentElement.dataset.platform = backend.kind;

let snapshot = null;
let renderQueued = false;

const camById = new Map(CAMERAS.map((c) => [c.id, c]));
const camLabel = (id) => {
  const cam = camById.get(String(id));
  return cam ? `${cam.name} · ${cam.sub}` : `CAM ${id}`;
};

// --- Comandos y avisos ---

let toastTimer = 0;
function showToast(message) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4500);
}

async function send(type, ...args) {
  try {
    const response = await backend.send(type, ...args);
    if (response && response.ok === false) showToast(response.error);
    return response;
  } catch (error) {
    const message = String(error?.message ?? error);
    showToast(message);
    return { ok: false, error: message };
  }
}

function makeKey({ label, sub, action, data }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key';
  button.dataset.action = action;
  Object.assign(button.dataset, data);
  button.append(label);
  if (sub) {
    const small = document.createElement('span');
    small.className = 'key-sub';
    small.textContent = sub;
    button.append(small);
  }
  return button;
}

// --- Construcción ---

function buildBus(container, action) {
  for (const cam of CAMERAS) {
    container.append(makeKey({ label: cam.name, sub: cam.sub, action, data: { cam: cam.id } }));
  }
}

const panelKeys = new Map();
function buildPanelButtons() {
  // Las capas van en dos filas, como en el panel del equipo: SET 1 abre la
  // primera y SET 2 la segunda.
  const mainIds = new Set(['stream', 'stream_2', 'rec', 'still', 'shot']);
  let keyerRow = els.keyersA;
  for (const button of PANEL_BUTTONS) {
    if (button.id === 'set_2') keyerRow = els.keyersB;
    const container = button.group === 'keyer' ? keyerRow : mainIds.has(button.id) ? els.deviceMain : els.deviceMore;
    const key = makeKey({ label: button.label, sub: button.sub, action: 'press-button', data: { button: button.id } });
    panelKeys.set(button.id, key);
    container.append(key);
  }
}

const strips = new Map();
const pendingVolumes = new Map();
let volumeFrame = 0;

function paintStrip(parts, db) {
  const level = clamp01((db - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB));
  const percent = `${(level * 100).toFixed(1)}%`;
  parts.db.textContent = db <= VOLUME_MIN_DB ? '−∞' : `${Math.round(db)}`;
  parts.meter.style.setProperty('--level', percent);
  parts.fader.style.setProperty('--fill', percent);
}

function flushVolumes() {
  cancelAnimationFrame(volumeFrame);
  volumeFrame = 0;
  for (const [channel, db] of pendingVolumes) send('setVolume', channel, db);
  pendingVolumes.clear();
}

function queueVolume(channel, db) {
  pendingVolumes.set(channel, db);
  if (!volumeFrame) volumeFrame = requestAnimationFrame(flushVolumes);
}

function buildMixer() {
  for (const channel of AUDIO_CHANNELS) {
    const strip = document.createElement('div');
    strip.className = channel.master ? 'strip strip--master' : 'strip';
    strip.innerHTML = `
      <div class="strip-name"></div>
      <div class="strip-db">-6</div>
      <div class="strip-body">
        <div class="meter"><div class="meter-fill"></div></div>
        <input class="fader" type="range" min="${VOLUME_MIN_DB}" max="${VOLUME_MAX_DB}" step="1">
      </div>
      <div class="strip-mode" hidden>AFV</div>
      <button class="mute" type="button" data-action="mute" aria-pressed="false">M</button>`;

    const parts = {
      db: strip.querySelector('.strip-db'),
      meter: strip.querySelector('.meter-fill'),
      fader: strip.querySelector('.fader'),
      mode: strip.querySelector('.strip-mode'),
      mute: strip.querySelector('.mute'),
      dragging: false,
    };
    strip.querySelector('.strip-name').textContent = channel.name;
    parts.fader.setAttribute('aria-label', `Volumen ${channel.name}`);
    parts.mute.dataset.channel = channel.id;
    parts.mute.title = `Silenciar ${channel.name}`;

    const release = () => {
      parts.dragging = false;
    };
    parts.fader.addEventListener('pointerdown', () => {
      parts.dragging = true;
    });
    parts.fader.addEventListener('pointerup', release);
    parts.fader.addEventListener('pointercancel', release);
    parts.fader.addEventListener('blur', release);
    parts.fader.addEventListener('input', () => {
      const db = Number(parts.fader.value);
      paintStrip(parts, db);
      queueVolume(channel.id, db);
    });
    parts.fader.addEventListener('change', () => {
      release();
      flushVolumes();
    });

    strips.set(channel.id, parts);
    els.mixer.append(strip);
  }
}

// --- T-Bar ---

const tbarState = { pos: 0, dragging: false, pointerId: null, startY: 0, startPos: 0, frame: 0, pending: null };

function tbarTravel() {
  return Math.max(1, els.tbarTrack.clientHeight - els.tbarHandle.offsetHeight);
}

function paintTbar(pos) {
  tbarState.pos = pos;
  const travel = tbarTravel();
  els.tbarHandle.style.transform = `translateY(${(pos * travel).toFixed(1)}px)`;
  els.tbarFill.style.height = `${Math.max(0, pos * travel - 6).toFixed(1)}px`;
  const percent = Math.round(pos * 100);
  els.tbarValue.textContent = `${percent}%`;
  els.tbarTrack.setAttribute('aria-valuenow', String(percent));
  els.tbar.classList.toggle('is-mid', pos > 0 && pos < 1);
}

function flushTbar() {
  cancelAnimationFrame(tbarState.frame);
  tbarState.frame = 0;
  if (tbarState.pending === null) return;
  const pos = tbarState.pending;
  tbarState.pending = null;
  send('setTbar', pos);
}

function queueTbar(pos) {
  tbarState.pending = pos;
  if (!tbarState.frame) tbarState.frame = requestAnimationFrame(flushTbar);
}

function setupTbar() {
  // La T-Bar solo se mueve arrastrando la manija, para no hacer saltos al aire.
  els.tbarHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    tbarState.dragging = true;
    tbarState.pointerId = event.pointerId;
    tbarState.startY = event.clientY;
    tbarState.startPos = tbarState.pos;
    els.tbarHandle.setPointerCapture(event.pointerId);
    els.tbar.classList.add('is-dragging');
  });

  els.tbarHandle.addEventListener('pointermove', (event) => {
    if (!tbarState.dragging || event.pointerId !== tbarState.pointerId) return;
    const pos = clamp01(tbarState.startPos + (event.clientY - tbarState.startY) / tbarTravel());
    if (pos === tbarState.pos) return;
    paintTbar(pos);
    queueTbar(pos);
  });

  const endDrag = (event) => {
    if (!tbarState.dragging || event.pointerId !== tbarState.pointerId) return;
    tbarState.dragging = false;
    tbarState.pointerId = null;
    els.tbar.classList.remove('is-dragging');
    flushTbar();
  };
  els.tbarHandle.addEventListener('pointerup', endDrag);
  els.tbarHandle.addEventListener('pointercancel', endDrag);
  els.tbarHandle.addEventListener('lostpointercapture', endDrag);

  const steps = { ArrowDown: 0.05, ArrowUp: -0.05, PageDown: 0.25, PageUp: -0.25 };
  els.tbarTrack.addEventListener('keydown', (event) => {
    let pos = null;
    if (Object.hasOwn(steps, event.key)) pos = clamp01(tbarState.pos + steps[event.key]);
    else if (event.key === 'Home') pos = 0;
    else if (event.key === 'End') pos = 1;
    if (pos === null) return;
    event.preventDefault();
    paintTbar(pos);
    queueTbar(pos);
  });

  new ResizeObserver(() => paintTbar(tbarState.pos)).observe(els.tbarTrack);
}

// --- Video ---

const pgmVideo = createPgmVideo({
  video: $('pgm-video'),
  placeholder: $('pgm-placeholder'),
  hint: $('pgm-hint'),
  badge: $('video-badge'),
  backend,
  onCameras: () => refreshCameras(),
});

async function refreshCameras() {
  const cameras = await pgmVideo.listCameras();
  const selected = snapshot?.settings.videoDeviceId ?? '';
  els.videoCamera.replaceChildren();
  const auto = new Option('Elegir sola', '');
  els.videoCamera.append(auto);
  cameras.forEach((camera, index) => {
    els.videoCamera.append(new Option(camera.label || `Cámara ${index + 1}`, camera.deviceId));
  });
  els.videoCamera.value = cameras.some((c) => c.deviceId === selected) ? selected : '';
}

// --- Estado del puente USB ---

function adbSummary(adb) {
  if (snapshot?.extras?.demo) return 'Modo demo: no se usa el puente USB.';
  if (backend.kind === 'browser') return 'Modo navegador: el puente USB lo abre start_app.sh --web o tenveo_bridge.py.';
  if (!adb) return '';
  switch (adb.state) {
    case 'disabled':
      return 'Puente USB desactivado.';
    case 'idle':
    case 'starting':
      return 'Puente USB: buscando adb…';
    case 'waiting':
      return 'Puente USB listo. Esperando el PC500 por USB.';
    case 'forwarded':
      return `Puente USB activo con ${adb.model || adb.serial}.`;
    default:
      return adb.message ? `Puente USB: ${adb.message}` : '';
  }
}

// --- Dibujo ---

function setActive(element, active) {
  element.classList.toggle('is-active', Boolean(active));
}

function connectionText(sw) {
  if (sw.connection === 'usb') return 'USB';
  if (sw.connection === 'ethernet') return `Red · ${snapshot.settings.ethernetIp}`;
  return sw.lastError && /IP/.test(sw.lastError) ? 'Sin IP' : 'Buscando…';
}

function renderTopbar(sw, obs, settings, extras) {
  const connected = sw.connection === 'usb' || sw.connection === 'ethernet';
  els.hw.classList.toggle('is-on', connected);
  els.hwText.textContent = connectionText(sw);
  els.hwLatency.textContent = connected && Number.isFinite(sw.latencyMs) ? `${sw.latencyMs} ms` : '';
  els.hw.title = [connected ? sw.endpoint : sw.lastError, adbSummary(extras?.adb)].filter(Boolean).join('\n');
  els.demoTag.hidden = !extras?.demo;

  const linked = obs.status === 'connected';
  const problem = !linked && Boolean(obs.lastError);
  els.obsPill.classList.toggle('is-on', linked);
  els.obsPill.classList.toggle('is-warn', problem);
  els.obsPillText.textContent = linked ? 'Conectado' : problem ? 'Revisar' : 'Sin conexión';
  els.obsPill.title = obs.lastError || (linked ? `OBS en ${obs.endpoint}` : 'Abre OBS y activa su servidor WebSocket.');

  els.sync.setAttribute('aria-pressed', String(Boolean(settings.syncWithObs)));
  setActive(els.obsStream, obs.streaming);
  setActive(els.obsRecord, obs.recording);
  setActive(els.obsVcam, obs.virtualCam);
}

function renderStage(sw) {
  const pvw = camById.get(sw.pvw);
  const pgm = camById.get(sw.pgm);
  els.pvwCam.textContent = pvw?.name ?? `CAM ${sw.pvw}`;
  els.pvwSub.textContent = pvw?.sub ?? '';
  els.pvwLabel.textContent = camLabel(sw.pvw);
  els.pgmCam.textContent = pgm?.name ?? `CAM ${sw.pgm}`;
  els.pgmSub.textContent = pgm?.sub ?? '';
  els.pgmLabel.textContent = camLabel(sw.pgm);
  els.pgmBlack.hidden = !sw.ftb;

  for (const key of els.busPgm.children) key.classList.toggle('is-program', key.dataset.cam === sw.pgm);
  for (const key of els.busPvw.children) key.classList.toggle('is-preview', key.dataset.cam === sw.pvw);

  for (const [id, key] of panelKeys) {
    const light = buttonLight(sw.buttons?.[id]);
    key.classList.remove('light-red', 'light-green', 'light-yellow', 'light-white', 'light-blue');
    if (light.on) key.classList.add(`light-${['red', 'green', 'yellow', 'blue'].includes(light.color) ? light.color : 'white'}`);
    key.classList.toggle('is-flashing', light.flash);
  }

  els.cut.classList.toggle('is-program', Boolean(sw.cut));
  els.auto.classList.toggle('is-amber', Boolean(sw.auto));
  els.ftb.classList.toggle('is-ftb', Boolean(sw.ftb));
  if (!tbarState.dragging && tbarState.pending === null) paintTbar(clamp01(sw.tbar));
}

function renderMixer(sw) {
  for (const channel of AUDIO_CHANNELS) {
    const parts = strips.get(channel.id);
    const db = Number(sw.volumes?.[channel.id] ?? channel.defaultDb);
    if (!parts.dragging && !pendingVolumes.has(channel.id)) {
      parts.fader.value = String(Math.round(db));
      paintStrip(parts, db);
    }
    const mode = channelMode(sw, channel.id);
    parts.mute.classList.toggle('is-muted', mode === 'OFF');
    parts.mute.setAttribute('aria-pressed', String(mode === 'OFF'));
    parts.mode.hidden = mode !== 'AFV';
  }
}

let scenesKey = '';
function renderObs(obs) {
  const linked = obs.status === 'connected';
  const problem = !linked && Boolean(obs.lastError);
  els.obsLink.textContent = linked ? 'Conectado' : problem ? 'Revisar' : 'Sin conexión';
  els.obsLink.classList.toggle('is-on', linked);
  els.obsLink.classList.toggle('is-warn', problem);
  els.obsLink.title = obs.lastError || (linked ? `OBS en ${obs.endpoint}` : '');

  const key = JSON.stringify([linked, obs.scenes, obs.programScene, obs.lastError]);
  if (key === scenesKey) return;
  scenesKey = key;
  els.scenes.replaceChildren();
  if (!linked || obs.scenes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = linked
      ? 'OBS no tiene escenas.'
      : obs.lastError || 'Abre OBS y activa Herramientas > Configuración del servidor WebSocket.';
    els.scenes.append(empty);
    return;
  }
  for (const name of obs.scenes) {
    const current = name === obs.programScene;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = current ? 'scene is-current' : 'scene';
    button.dataset.action = 'obs-scene';
    button.dataset.scene = name;
    const dot = document.createElement('span');
    dot.className = 'scene-dot';
    const label = document.createElement('span');
    label.className = 'scene-name';
    label.textContent = name;
    button.append(dot, label);
    els.scenes.append(button);
  }
}

function videoStatusText(settings, video) {
  const source = settings.videoSource;
  if (source === 'off') return { text: 'Sin video en el monitor PGM.', tone: '' };
  if (source === 'usb') return { text: 'Muestra la salida de video USB del PC500.', tone: '' };
  if (!video || video.state === 'off') return { text: 'Preparando…', tone: '' };
  if (video.state === 'error') return { text: video.error, tone: 'is-warn' };
  if (video.state === 'receiving') {
    return { text: source === 'push' ? `Recibiendo video desde ${video.source || 'el PC500'}.` : 'Leyendo el video del PC500.', tone: 'is-on' };
  }
  if (source === 'push') return { text: 'Esperando que el PC500 transmita a esta Mac.', tone: '' };
  return { text: video.error || 'Conectando con el servidor RTMP del PC500…', tone: video.error ? 'is-warn' : '' };
}

function renderDevice(sw, settings, extras) {
  const connected = sw.connection === 'usb' || sw.connection === 'ethernet';
  els.factConnection.textContent = connected ? sw.endpoint : 'Sin conexión';
  els.factLatency.textContent = connected && Number.isFinite(sw.latencyMs) ? `${sw.latencyMs} ms` : '—';
  els.factIp.textContent = sw.device?.ip || settings.ethernetIp || '—';
  els.factVersion.textContent = sw.device?.version || '—';
  els.streamTime.textContent = sw.device?.streamTime || '—';
  els.recordTime.textContent = sw.device?.recordTime || '—';

  if (document.activeElement !== els.videoSource) els.videoSource.value = settings.videoSource;
  els.cameraField.hidden = settings.videoSource !== 'usb';
  const network = settings.videoSource === 'push' || settings.videoSource === 'pull';
  const canControl = network && backend.kind === 'electron';
  els.videoActions.hidden = !canControl;
  const video = extras?.video;
  const status = videoStatusText(settings, video);
  els.videoStatus.textContent = status.text;
  els.videoStatus.className = `status-line ${status.tone}`.trim();

  let server = '';
  if (settings.videoSource === 'push' && video?.rtmpUrls?.length) server = video.rtmpUrls.join('  o  ');
  if (settings.videoSource === 'pull') server = `rtmp://${sw.device?.ip || settings.ethernetIp || '<IP del PC500>'}:1935/live/`;
  els.videoManual.hidden = !canControl || !server;
  els.videoServer.textContent = server;
  els.videoKey.textContent = settings.videoKey;
}

function renderDialog(sw, settings, extras) {
  if (!els.dialog.open) return;
  for (const button of els.connMode.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-checked', String(button.dataset.mode === settings.connectionMode));
  }
  els.adbText.textContent = adbSummary(extras?.adb);
  els.ipHint.textContent =
    settings.ethernetIpSource === 'auto' && settings.ethernetIp
      ? `IP informada por el equipo: ${settings.ethernetIp}. Sirve para seguir por red si se desconecta el USB.`
      : '';
  renderDiscovery(extras?.discovery);
}

function renderDiscovery(discovery) {
  els.discoverBtn.hidden = backend.kind !== 'electron';
  if (!discovery || discovery.state === 'idle') {
    els.discovery.hidden = true;
    return;
  }
  els.discovery.hidden = false;
  els.discovery.replaceChildren();
  els.discoverBtn.disabled = discovery.state === 'searching';
  if (discovery.state === 'searching') {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = discovery.total ? `Buscando en la red… ${discovery.checked} de ${discovery.total}` : 'Buscando en la red…';
    els.discovery.append(p);
    return;
  }
  if (!discovery.found?.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = discovery.error || 'No se encontró ningún PC500. Revisa que esté en la misma red, y si macOS preguntó por la red local, acepta el permiso.';
    els.discovery.append(p);
    return;
  }
  for (const device of discovery.found) {
    const row = document.createElement('div');
    row.className = 'discovery-item';
    const ip = document.createElement('code');
    ip.textContent = device.host;
    const info = document.createElement('span');
    info.textContent = device.version || 'PC500';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn btn--small';
    use.dataset.action = 'use-ip';
    use.dataset.ip = device.host;
    use.textContent = 'Usar';
    row.append(ip, info, use);
    els.discovery.append(row);
  }
}

function render() {
  renderQueued = false;
  if (!snapshot) return;
  const { switcher: sw, obs, settings, extras } = snapshot;
  renderTopbar(sw, obs, settings, extras);
  renderStage(sw);
  renderMixer(sw);
  renderObs(obs);
  renderDevice(sw, settings, extras);
  renderDialog(sw, settings, extras);
  pgmVideo.update(snapshot);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

// --- Pestañas ---

const TAB_KEY = 'tenveo-studio.tab';
function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.dataset.panel !== name;
  try {
    localStorage.setItem(TAB_KEY, name);
  } catch {
    // Sin almacenamiento: la pestaña no se recuerda.
  }
}

// --- Diálogo de conexión ---

function showFormError(message) {
  els.settingsError.textContent = message;
  els.settingsError.hidden = !message;
}

function openSettings() {
  if (!snapshot) return;
  const { settings } = snapshot;
  els.fieldIp.value = settings.ethernetIp || '';
  els.fieldObsHost.value = settings.obsHost || '';
  els.fieldObsPort.value = String(settings.obsPort || '');
  els.fieldObsPass.value = '';
  els.fieldObsPass.placeholder = settings.hasObsPassword ? 'Guardada. Escribe otra para cambiarla.' : 'Sin contraseña';
  els.fieldObsClear.checked = false;
  els.fieldObsClearRow.hidden = !settings.hasObsPassword;
  showFormError('');
  els.dialog.showModal();
  render();
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const response = await backend.send('saveSettings', {
      ethernetIp: els.fieldIp.value,
      obsHost: els.fieldObsHost.value,
      obsPort: els.fieldObsPort.value || 4455,
      obsPassword: els.fieldObsPass.value,
      clearObsPassword: els.fieldObsClear.checked,
    });
    if (response?.ok === false) {
      showFormError(response.error);
      return;
    }
    els.dialog.close();
  } catch (error) {
    showFormError(String(error?.message ?? error));
  }
}

async function openOriginalPanel() {
  if (backend.kind === 'browser') {
    const ip = (snapshot?.settings.ethernetIp || '').trim();
    const host = ip.includes(':') ? `[${ip}]` : ip;
    window.open(ip ? `http://${host}/` : 'http://127.0.0.1:8080/', '_blank', 'noopener');
    return;
  }
  const response = await backend.send('openOriginalPanel');
  if (response?.ok === false) showFormError(response.error);
}

async function useDiscoveredIp(ip) {
  els.fieldIp.value = ip;
  const response = await send('saveSettings', { ethernetIp: ip });
  if (response?.ok) showToast(`Conectando con el PC500 en ${ip}`);
}

// --- Eventos ---

const ACTIONS = {
  'pgm-select': (t) => send('switchLive', t.dataset.cam),
  'pvw-select': (t) => send('selectPreview', t.dataset.cam),
  cut: () => send('cut'),
  auto: () => send('auto'),
  ftb: () => send('ftb'),
  'press-button': (t) => send('pressButton', t.dataset.button),
  'toggle-sync': () => send('toggleObsSync'),
  'obs-stream': () => send('obsToggleStream'),
  'obs-record': () => send('obsToggleRecord'),
  'obs-vcam': () => send('obsToggleVirtualCam'),
  'obs-scene': (t) => send('obsSetScene', t.dataset.scene),
  mute: (t) => send('toggleMute', t.dataset.channel),
  tab: (t) => selectTab(t.dataset.tab),
  'open-settings': () => openSettings(),
  'close-settings': () => els.dialog.close(),
  'auto-usb': () => send('retryHardware'),
  'open-panel': () => openOriginalPanel(),
  'conn-mode': (t) => send('setConnectionMode', t.dataset.mode),
  discover: () => send('discoverDevices'),
  'use-ip': (t) => useDiscoveredIp(t.dataset.ip),
  'start-device-stream': async () => {
    const response = await send('startDeviceStream');
    if (response?.ok) showToast(`El PC500 transmite a ${response.result.server} (canal ${response.result.slot}).`);
  },
  'stop-device-stream': () => send('stopDeviceStream'),
};

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const handler = ACTIONS[target.dataset.action];
  if (handler) handler(target);
}

// Teclas 1 a 5: cámara en Preview. CUT y AUTO no tienen atajo a propósito:
// una tecla pulsada por error no debe cambiar lo que está al aire.
function onKeyDown(event) {
  if (els.dialog.open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, select, textarea')) return;
  const cam = { 1: '1', 2: '2', 3: '3', 4: '4', 5: 'aux' }[event.key];
  if (cam) send('selectPreview', cam);
}

// --- Arranque ---

buildBus(els.busPgm, 'pgm-select');
buildBus(els.busPvw, 'pvw-select');
buildPanelButtons();
buildMixer();
setupTbar();
document.addEventListener('click', onClick);
document.addEventListener('keydown', onKeyDown);
els.form.addEventListener('submit', saveSettings);
els.videoSource.addEventListener('change', async () => {
  const source = els.videoSource.value;
  await send('setVideoSource', source, source === 'usb' ? els.videoCamera.value : undefined);
  if (source === 'usb') refreshCameras();
});
els.videoCamera.addEventListener('change', () => send('setVideoSource', 'usb', els.videoCamera.value));

try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved && document.querySelector(`.tab[data-tab="${saved}"]`)) selectTab(saved);
} catch {
  // Sin almacenamiento: queda la primera pestaña.
}

backend.onState((next) => {
  snapshot = next;
  scheduleRender();
});
snapshot = await backend.getState();
render();
if (snapshot.settings.videoSource === 'usb') refreshCameras();
document.documentElement.dataset.ready = 'true';
