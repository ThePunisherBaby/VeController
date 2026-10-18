// Interfaz de la consola. No abre conexiones: dibuja el estado que recibe y
// manda comandos al núcleo (en Electron, por IPC; en el navegador, directo).

import {
  AUDIO_CHANNELS,
  CAMERAS,
  VOLUME_MAX_DB,
  VOLUME_MIN_DB,
  cameraLabel,
  channelMode,
  clamp01,
} from '../../core/pc500-protocol.js';
import { connectBackend } from './backend.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

const els = {
  hw: $('hw-status'),
  hwText: $('hw-text'),
  demoTag: $('demo-tag'),
  sync: $('sync-toggle'),
  obsStream: $('obs-stream'),
  obsRecord: $('obs-record'),
  obsVcam: $('obs-vcam'),
  pvwLabel: $('pvw-label'),
  pgmLabel: $('pgm-label'),
  pgmMonitor: $('pgm-monitor'),
  busPgm: $('bus-pgm'),
  busPvw: $('bus-pvw'),
  cut: $('btn-cut'),
  auto: $('btn-auto'),
  ftb: $('btn-ftb'),
  tbar: $('tbar'),
  tbarTrack: $('tbar-track'),
  tbarHandle: $('tbar-handle'),
  tbarValue: $('tbar-value'),
  mixer: $('mixer'),
  obsLink: $('obs-link'),
  scenes: $('scenes'),
  dialog: $('settings-dialog'),
  form: $('settings-form'),
  fieldIp: $('field-ip'),
  fieldObsHost: $('field-obs-host'),
  fieldObsPort: $('field-obs-port'),
  fieldObsPass: $('field-obs-pass'),
  fieldObsClear: $('field-obs-clear'),
  fieldObsClearRow: $('field-obs-clear-row'),
  adbText: $('adb-text'),
  settingsError: $('settings-error'),
  toast: $('toast'),
};

const backend = await connectBackend();
document.documentElement.dataset.platform = backend.kind;

let snapshot = null;
let renderQueued = false;

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

function icon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// --- Buses de cámaras ---

function buildBus(container, action) {
  for (const cam of CAMERAS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tally';
    button.dataset.action = action;
    button.dataset.cam = cam.id;
    const label = document.createElement('span');
    label.className = 'tally-label';
    label.textContent = cam.name;
    const sub = document.createElement('span');
    sub.className = 'tally-sub';
    sub.textContent = cam.sub;
    button.append(label, sub);
    container.append(button);
  }
}

// --- Mezclador de audio ---

const strips = new Map();
const pendingVolumes = new Map();
let volumeFrame = 0;

function paintStrip(parts, db) {
  const level = clamp01((db - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB));
  const percent = `${(level * 100).toFixed(1)}%`;
  parts.db.textContent = db <= VOLUME_MIN_DB ? '-∞' : `${Math.round(db)} dB`;
  parts.vu.style.setProperty('--level', percent);
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
      <div class="strip-db">-6 dB</div>
      <div class="strip-body">
        <div class="vu"><div class="vu-fill"></div></div>
        <input class="fader" type="range" min="${VOLUME_MIN_DB}" max="${VOLUME_MAX_DB}" step="1">
      </div>
      <div class="strip-mode" hidden>AFV</div>
      <button class="mute" type="button" data-action="mute" aria-pressed="false">MUTE</button>`;

    const parts = {
      db: strip.querySelector('.strip-db'),
      vu: strip.querySelector('.vu-fill'),
      fader: strip.querySelector('.fader'),
      mode: strip.querySelector('.strip-mode'),
      mute: strip.querySelector('.mute'),
      dragging: false,
    };
    strip.querySelector('.strip-name').textContent = channel.name;
    parts.fader.setAttribute('aria-label', `Volumen ${channel.name}`);
    parts.mute.dataset.channel = channel.id;

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
  els.tbarHandle.style.transform = `translateY(${(pos * tbarTravel()).toFixed(1)}px)`;
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

  window.addEventListener('resize', () => paintTbar(tbarState.pos));
}

// --- Estado del puente USB ---

function adbSummary(adb) {
  if (snapshot?.extras?.demo) return 'Modo demo: no se usa el puente USB.';
  if (backend.kind === 'browser') {
    return 'Modo navegador: el puente USB lo abre start_app.sh --web o tenveo_bridge.py.';
  }
  if (!adb) return '';
  switch (adb.state) {
    case 'disabled':
      return 'Puente ADB desactivado.';
    case 'idle':
    case 'starting':
      return 'Buscando adb…';
    case 'waiting':
      return 'adb listo. Esperando el PC500 por USB.';
    case 'forwarded':
      return `USB activo con ${adb.model || adb.serial}. WebSocket en 127.0.0.1:8089${adb.panelForwarded ? ' y panel web en 127.0.0.1:8080' : ''}.`;
    default:
      return adb.message || '';
  }
}

// --- OBS ---

function renderObsLink(obs) {
  const linked = obs.status === 'connected';
  const problem = !linked && Boolean(obs.lastError);
  els.obsLink.textContent = linked ? 'LINKED' : problem ? (obs.authRequired ? 'CONTRASEÑA' : 'REVISAR') : 'OFFLINE';
  els.obsLink.classList.toggle('is-linked', linked);
  els.obsLink.classList.toggle('is-warn', problem);
  els.obsLink.title = obs.lastError || (linked ? `OBS en ${obs.endpoint}` : '');
}

let scenesKey = '';
function renderScenes(obs) {
  const linked = obs.status === 'connected';
  const key = JSON.stringify([linked, obs.scenes, obs.programScene, obs.lastError]);
  if (key === scenesKey) return;
  scenesKey = key;
  els.scenes.replaceChildren();

  if (!linked || obs.scenes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'scenes-empty';
    empty.textContent = linked
      ? 'OBS no tiene escenas.'
      : obs.lastError || 'OBS sin conexión. Abre OBS y activa Herramientas > Configuración del servidor WebSocket.';
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
    const label = document.createElement('span');
    label.className = 'scene-name';
    label.textContent = name;
    button.append(icon(current ? 'i-radio-on' : 'i-radio-off'), label);
    els.scenes.append(button);
  }
}

// --- Dibujo general ---

function setActive(element, active) {
  element.classList.toggle('is-active', Boolean(active));
}

function render() {
  renderQueued = false;
  if (!snapshot) return;
  const { switcher: sw, obs, settings, extras } = snapshot;
  const connected = sw.connection === 'usb' || sw.connection === 'ethernet';

  els.hw.classList.toggle('is-connected', connected);
  els.hwText.textContent = connected ? `PC500: ${sw.endpoint}` : 'BUSCANDO PC500 (USB / LAN)...';
  els.hw.title = adbSummary(extras?.adb);
  els.demoTag.hidden = !extras?.demo;

  els.sync.setAttribute('aria-pressed', String(Boolean(settings.syncWithObs)));
  setActive(els.obsStream, obs.streaming);
  setActive(els.obsRecord, obs.recording);
  setActive(els.obsVcam, obs.virtualCam);
  const obsTitle = obs.status === 'connected' ? '' : 'OBS sin conexión';
  for (const button of [els.obsStream, els.obsRecord, els.obsVcam]) button.title = obsTitle;

  els.pvwLabel.textContent = cameraLabel(sw.pvw);
  els.pgmLabel.textContent = cameraLabel(sw.pgm);
  els.pgmMonitor.classList.toggle('is-black', Boolean(sw.ftb));

  for (const button of els.busPgm.children) button.classList.toggle('is-program', button.dataset.cam === sw.pgm);
  for (const button of els.busPvw.children) button.classList.toggle('is-preview', button.dataset.cam === sw.pvw);

  els.cut.classList.toggle('is-program', Boolean(sw.cut));
  els.auto.classList.toggle('is-amber', Boolean(sw.auto));
  els.ftb.classList.toggle('is-ftb', Boolean(sw.ftb));

  if (!tbarState.dragging && tbarState.pending === null) paintTbar(clamp01(sw.tbar));

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

  renderObsLink(obs);
  renderScenes(obs);
  if (els.dialog.open) els.adbText.textContent = adbSummary(extras?.adb);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

// --- Diálogo de conexión ---

function showFormError(message) {
  els.settingsError.textContent = message;
  els.settingsError.hidden = !message;
}

function openSettings() {
  if (!snapshot) return;
  const { settings, extras } = snapshot;
  els.fieldIp.value = settings.ethernetIp || '';
  els.fieldObsHost.value = settings.obsHost || '';
  els.fieldObsPort.value = String(settings.obsPort || '');
  els.fieldObsPass.value = '';
  els.fieldObsPass.placeholder = settings.hasObsPassword ? 'Guardada. Escribe otra para cambiarla.' : 'Sin contraseña';
  els.fieldObsClear.checked = false;
  els.fieldObsClearRow.hidden = !settings.hasObsPassword;
  els.adbText.textContent = adbSummary(extras?.adb);
  showFormError('');
  els.dialog.showModal();
  els.fieldIp.focus();
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

// --- Eventos ---

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  switch (action) {
    case 'pgm-select':
      send('switchLive', target.dataset.cam);
      break;
    case 'pvw-select':
      send('selectPreview', target.dataset.cam);
      break;
    case 'cut':
      send('cut');
      break;
    case 'auto':
      send('auto');
      break;
    case 'ftb':
      send('ftb');
      break;
    case 'toggle-sync':
      send('toggleObsSync');
      break;
    case 'obs-stream':
      send('obsToggleStream');
      break;
    case 'obs-record':
      send('obsToggleRecord');
      break;
    case 'obs-vcam':
      send('obsToggleVirtualCam');
      break;
    case 'obs-scene':
      send('obsSetScene', target.dataset.scene);
      break;
    case 'mute':
      send('toggleMute', target.dataset.channel);
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'close-settings':
      els.dialog.close();
      break;
    case 'auto-usb':
      send('retryHardware');
      els.dialog.close();
      break;
    case 'open-panel':
      openOriginalPanel();
      break;
    default:
      break;
  }
}

// --- Arranque ---

buildBus(els.busPgm, 'pgm-select');
buildBus(els.busPvw, 'pvw-select');
buildMixer();
setupTbar();
document.addEventListener('click', onClick);
els.form.addEventListener('submit', saveSettings);

backend.onState((next) => {
  snapshot = next;
  scheduleRender();
});
snapshot = await backend.getState();
render();
document.documentElement.dataset.ready = 'true';
