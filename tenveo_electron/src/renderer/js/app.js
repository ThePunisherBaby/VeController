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
import { SpringValue, fromDurationBounce } from './springs.js';
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
  videoStatus: $('video-status'),
  videoActions: $('video-actions'),
  startStream: $('start-stream'),
  stopStream: $('stop-stream'),
  dialog: $('settings-dialog'),
  form: $('settings-form'),
  fieldIp: $('field-ip'),
  discoverBtn: $('discover-btn'),
  discovery: $('discovery'),
  adbText: $('adb-text'),
  fieldObsHost: $('field-obs-host'),
  fieldObsPort: $('field-obs-port'),
  fieldObsPass: $('field-obs-pass'),
  fieldObsClear: $('field-obs-clear'),
  fieldObsClearRow: $('field-obs-clear-row'),
  settingsError: $('settings-error'),
  appearance: document.querySelectorAll('input[name="appearance"]'),
  tabs: document.querySelector('.tabs'),
  toast: $('toast'),
};

const root = document.documentElement;
const backend = await connectBackend();
root.dataset.platform = backend.kind;
// En la Mac la barra de la app hace de barra de título y deja lugar a los semáforos.
root.dataset.os = /Mac/.test(navigator.platform) ? 'mac' : 'other';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let snapshot = null;
let renderQueued = false;

// Cada actualización vuelve a dibujar todo, pero solo toca el DOM donde algo
// cambió: escribir un texto igual también obliga al navegador a recalcular.
function setText(element, text) {
  const value = String(text);
  if (element.textContent !== value) element.textContent = value;
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

// El estado encendido también se anuncia a VoiceOver.
function setPressed(element, pressed) {
  const value = String(Boolean(pressed));
  if (element.getAttribute('aria-pressed') !== value) element.setAttribute('aria-pressed', value);
}

function setRootData(name, value) {
  if (root.dataset[name] !== value) root.dataset[name] = value;
}

const camById = new Map(CAMERAS.map((c) => [c.id, c]));
// Sin dato del equipo (por ejemplo, recién conectado) no se inventa una cámara.
const camLabel = (id) => {
  if (!id) return 'Sin dato del equipo';
  const cam = camById.get(String(id));
  return cam ? `${cam.name} · ${cam.sub}` : `CAM ${id}`;
};
const camName = (id) => (id ? (camById.get(String(id))?.name ?? `CAM ${id}`) : '');

// --- Comandos y avisos ---

// El aviso entra desde arriba con un spring y sale por el mismo camino (CSS).
let toastTimer = 0;
function showToast(message) {
  if (!message) return;
  els.toast.hidden = false;
  els.toast.dataset.state = 'open';
  els.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.dataset.state = 'closed';
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
  const mainIds = new Set(['stream', 'rec', 'still', 'shot']);
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
  setText(parts.db, db <= VOLUME_MIN_DB ? '−∞' : `${Math.round(db)}`);
  if (parts.percent === percent) return;
  parts.percent = percent;
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

const tbarState = { pos: -1, travel: 0, dragging: false, pointerId: null, startY: 0, startPos: 0, frame: 0, pending: null, releasedAt: -Infinity };
// Tras soltarla, la T-Bar se queda donde la dejó el usuario hasta que el equipo
// lo confirme: un estado viejo que llega por IPC no la hace volver atrás.
const TBAR_SETTLE_MS = 400;

// La manija se mueve 1:1 con el puntero. Cuando la posición cambia sin
// arrastrarla (por ejemplo, al reconectar), va con un spring que se puede
// redirigir sin saltos.
const TBAR_SPRING = fromDurationBounce(0.3, 0);
const tbarSpring = { value: null, frame: 0 };

function tbarTravel() {
  // La manija está a 3 px de cada borde del riel.
  return Math.max(1, els.tbarTrack.clientHeight - els.tbarHandle.offsetHeight - 6);
}

function paintTbar(pos, force = false) {
  const travel = tbarTravel();
  if (!force && pos === tbarState.pos && travel === tbarState.travel) return;
  tbarState.pos = pos;
  tbarState.travel = travel;
  // translate y no transform: así la escala de "elevarse" no corre la manija.
  els.tbarHandle.style.translate = `0 ${(pos * travel).toFixed(1)}px`;
  els.tbarFill.style.height = `${Math.max(0, pos * travel).toFixed(1)}px`;
  const percent = Math.round(clamp01(pos) * 100);
  setText(els.tbarValue, `${percent}%`);
  els.tbarTrack.setAttribute('aria-valuenow', String(percent));
  els.tbar.classList.toggle('is-mid', percent > 0 && percent < 100);
}

function stopTbarSpring() {
  cancelAnimationFrame(tbarSpring.frame);
  tbarSpring.frame = 0;
}

function stepTbarSpring(ms) {
  const now = ms / 1000;
  const spring = tbarSpring.value;
  if (spring.isSettled(now)) {
    tbarSpring.frame = 0;
    paintTbar(spring.target);
    return;
  }
  paintTbar(spring.sample(now).value);
  tbarSpring.frame = requestAnimationFrame(stepTbarSpring);
}

function animateTbarTo(pos) {
  const spring = tbarSpring.value;
  if (spring && spring.target === pos && (tbarSpring.frame || tbarState.pos === pos)) return;
  if (tbarState.pos < 0 || reducedMotion.matches) {
    stopTbarSpring();
    tbarSpring.value = new SpringValue(pos, TBAR_SPRING);
    paintTbar(pos);
    return;
  }
  const now = performance.now() / 1000;
  if (!spring || !tbarSpring.frame) {
    tbarSpring.value = new SpringValue(tbarState.pos, TBAR_SPRING);
    tbarSpring.value.set(tbarState.pos, now);
  }
  tbarSpring.value.retarget(pos, now);
  if (!tbarSpring.frame) tbarSpring.frame = requestAnimationFrame(stepTbarSpring);
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
    stopTbarSpring();
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
    tbarState.releasedAt = performance.now();
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
    stopTbarSpring();
    tbarState.releasedAt = performance.now();
    paintTbar(pos);
    queueTbar(pos);
  });

  new ResizeObserver(() => paintTbar(Math.max(0, tbarState.pos), true)).observe(els.tbarTrack);
}

// --- Video ---

const pgmVideo = createPgmVideo({
  canvas: $('pgm-canvas'),
  placeholder: $('pgm-placeholder'),
  hint: $('pgm-hint'),
  badge: $('video-badge'),
});

// --- Ruta del video ---

// Por un cable directo el video llega por adb en red; en la misma red IPv4,
// directo. Solo hace falta contarlo cuando algo falla o se está conectando.
function videoRouteSummary(adb) {
  if (snapshot?.extras?.demo) return 'Modo demo: equipo y OBS simulados.';
  if (backend.kind === 'browser') return 'Modo navegador: el video del PC500 solo se ve en la app de escritorio.';
  if (!adb || adb.state === 'off' || adb.state === 'stopped' || adb.state === 'disabled') return '';
  if (adb.state === 'ready') return 'Video por el cable de red (adb).';
  return adb.message;
}

// --- Dibujo ---

function setActive(element, active) {
  element.classList.toggle('is-active', Boolean(active));
  setPressed(element, active);
}

const isIPv6 = (host) => String(host).includes(':');

function connectionText(sw) {
  if (sw.connection === 'ethernet') {
    const ip = snapshot.settings.ethernetIp;
    return isIPv6(ip) ? 'Red · directo' : `Red · ${ip}`;
  }
  return sw.lastError && /IP/.test(sw.lastError) ? 'Sin IP' : 'Buscando…';
}

function renderTopbar(sw, obs, settings, extras) {
  const connected = sw.connection === 'ethernet';
  els.hw.classList.toggle('is-on', connected);
  setRootData('connected', String(connected));
  setRootData('appearance', settings.appearance || 'system');
  setRootData('fullscreen', String(Boolean(extras?.window?.fullscreen)));
  setText(els.hwText, connectionText(sw));
  setText(els.hwLatency, connected && Number.isFinite(sw.latencyMs) ? `${sw.latencyMs} ms` : '');
  els.hw.title = [connected ? sw.endpoint : sw.lastError, videoRouteSummary(extras?.adb)].filter(Boolean).join('\n');
  setHidden(els.demoTag, !extras?.demo);

  const linked = obs.status === 'connected';
  const problem = !linked && Boolean(obs.lastError);
  els.obsPill.classList.toggle('is-on', linked);
  els.obsPill.classList.toggle('is-warn', problem);
  setText(els.obsPillText, linked ? 'Conectado' : problem ? 'Revisar' : 'Sin conexión');
  els.obsPill.title = obs.lastError || (linked ? `OBS en ${obs.endpoint}` : 'Abre OBS y activa su servidor WebSocket.');

  els.sync.setAttribute('aria-pressed', String(Boolean(settings.syncWithObs)));
  setActive(els.obsStream, obs.streaming);
  setActive(els.obsRecord, obs.recording);
  setActive(els.obsVcam, obs.virtualCam);
}

// Preview elegido en la app que el equipo todavía no confirmó: la tecla se
// marca en el mismo cuadro del clic y el equipo lo confirma unos ms después.
let pendingPreview = null;

function shownPreview(sw) {
  if (pendingPreview && (pendingPreview.cam === sw.pvw || performance.now() - pendingPreview.at > 800)) pendingPreview = null;
  return pendingPreview?.cam ?? sw.pvw;
}

function paintPreviewKeys(cam) {
  for (const key of els.busPvw.children) {
    key.classList.toggle('is-preview', key.dataset.cam === cam);
    setPressed(key, key.dataset.cam === cam);
  }
}

function selectPreview(cam) {
  pendingPreview = { cam: String(cam), at: performance.now() };
  paintPreviewKeys(pendingPreview.cam);
  send('selectPreview', cam);
}

function renderStage(sw) {
  const pvwId = shownPreview(sw);
  const pvw = camById.get(pvwId);
  const pgm = camById.get(sw.pgm);
  setText(els.pvwCam, camName(pvwId));
  setHidden(els.pvwCam, !pvwId);
  setText(els.pvwSub, pvw?.sub ?? '');
  setText(els.pvwLabel, camLabel(pvwId));
  setText(els.pgmCam, camName(sw.pgm));
  setHidden(els.pgmCam, !sw.pgm);
  setText(els.pgmSub, pgm?.sub ?? '');
  setText(els.pgmLabel, camLabel(sw.pgm));
  setHidden(els.pgmBlack, !sw.ftb);

  for (const key of els.busPgm.children) {
    key.classList.toggle('is-program', key.dataset.cam === sw.pgm);
    setPressed(key, key.dataset.cam === sw.pgm);
  }
  paintPreviewKeys(pvwId);

  for (const [id, key] of panelKeys) {
    const light = buttonLight(sw.buttons?.[id]);
    const lightClass = light.on ? `light-${['red', 'green', 'yellow', 'blue'].includes(light.color) ? light.color : 'white'}` : '';
    if (key.dataset.light !== lightClass) {
      if (key.dataset.light) key.classList.remove(key.dataset.light);
      if (lightClass) key.classList.add(lightClass);
      key.dataset.light = lightClass;
    }
    key.classList.toggle('is-flashing', light.flash);
    setPressed(key, light.on);
  }

  els.cut.classList.toggle('is-program', Boolean(sw.cut));
  els.auto.classList.toggle('is-amber', Boolean(sw.auto));
  els.ftb.classList.toggle('is-ftb', Boolean(sw.ftb));
  const settling = performance.now() - tbarState.releasedAt < TBAR_SETTLE_MS;
  if (!tbarState.dragging && tbarState.pending === null && !settling) animateTbarTo(clamp01(sw.tbar));
}

function renderMixer(sw) {
  for (const channel of AUDIO_CHANNELS) {
    const parts = strips.get(channel.id);
    const db = Number(sw.volumes?.[channel.id] ?? channel.defaultDb);
    if (!parts.dragging && !pendingVolumes.has(channel.id)) {
      const value = String(Math.round(db));
      if (parts.fader.value !== value) parts.fader.value = value;
      paintStrip(parts, db);
    }
    const mode = channelMode(sw, channel.id);
    if (parts.lastMode !== mode) {
      parts.lastMode = mode;
      parts.mute.classList.toggle('is-muted', mode === 'OFF');
      parts.mute.setAttribute('aria-pressed', String(mode === 'OFF'));
      parts.mode.hidden = mode !== 'AFV';
    }
  }
}

let scenesKey = '';
function renderObs(obs) {
  const linked = obs.status === 'connected';
  const problem = !linked && Boolean(obs.lastError);
  setText(els.obsLink, linked ? 'Conectado' : problem ? 'Revisar' : 'Sin conexión');
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

function videoStatusText(video, dv, adb) {
  if (backend.kind !== 'electron') return { text: 'El video del PC500 se ve en la app de escritorio.', tone: '' };
  if (video?.state === 'receiving') {
    const info = video.info;
    const size = info?.width && info?.height ? ` · ${info.width}×${info.height}${info.fps ? ` · ${info.fps} fps` : ''}` : '';
    return { text: `En vivo${size}`, tone: 'is-on' };
  }
  if (!dv?.connected) return { text: 'Conecta el PC500 para ver su video.', tone: '' };
  if (!dv.key) return { text: 'Ningún destino de STREAM usa el servidor interno del PC500. En su panel, elige "Default" en uno de los destinos.', tone: 'is-warn' };
  if (!dv.route) return { text: 'Falta la IP del PC500: búscalo en la red.', tone: 'is-warn' };
  if (dv.route === 'ip') {
    if (adb?.state === 'connecting') return { text: 'Abriendo el video por el cable de red…', tone: '' };
    const why = adb?.state === 'error' || adb?.state === 'unauthorized' || adb?.state === 'no-adb' ? `${adb.message} ` : '';
    return { text: `${why}La Mac no llega al video del PC500 (${dv.deviceIp}). Pon en el Ethernet de la Mac la IP ${dv.suggestion} con máscara 255.255.255.0.`, tone: 'is-warn' };
  }
  if (!dv.streaming) {
    if (dv.canStart) return { text: 'STREAM está apagado. Enciéndelo para ver el video aquí: va al servidor interno del PC500 y no sale al aire.', tone: '' };
    return { text: 'El video aparecerá aquí cuando enciendas STREAM para salir al aire.', tone: '' };
  }
  if (video?.error) return { text: video.error, tone: 'is-warn' };
  return { text: 'Esperando la imagen del PC500…', tone: '' };
}

function renderDevice(sw, settings, extras) {
  const connected = sw.connection === 'ethernet';
  setText(els.factConnection, connected ? sw.endpoint : 'Sin conexión');
  setText(els.factLatency, connected && Number.isFinite(sw.latencyMs) ? `${sw.latencyMs} ms` : '—');
  setText(els.factIp, sw.device?.ip || (isIPv6(settings.ethernetIp) ? 'IPv6 directo' : settings.ethernetIp) || '—');
  setText(els.factVersion, sw.device?.version || '—');
  setText(els.streamTime, sw.device?.streamTime || '—');
  setText(els.recordTime, sw.device?.recordTime || '—');

  const dv = extras?.deviceVideo;
  setHidden(els.videoActions, backend.kind !== 'electron');
  els.startStream.disabled = !(dv?.connected && dv.canStart);
  els.stopStream.disabled = !(dv?.connected && dv.canStop);
  const status = videoStatusText(extras?.video, dv, extras?.adb);
  setText(els.videoStatus, status.text);
  const className = `status-line ${status.tone}`.trim();
  if (els.videoStatus.className !== className) els.videoStatus.className = className;
}

function renderDialog(sw, settings, extras) {
  for (const input of els.appearance) {
    const checked = input.value === (settings.appearance || 'system');
    if (input.checked !== checked) input.checked = checked;
  }
  if (!els.dialog.open) return;
  setText(els.adbText, videoRouteSummary(extras?.adb));
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
    ip.textContent = device.linkLocal ? 'Cable directo' : device.host;
    ip.title = device.host;
    const info = document.createElement('span');
    info.textContent = [device.version || 'PC500', device.reportedIp && `IP ${device.reportedIp}`].filter(Boolean).join(' · ');
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
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    // Solo la pestaña elegida entra en el orden del tabulador; las flechas mueven entre ellas.
    tab.tabIndex = selected ? 0 : -1;
  }
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

// El diálogo nace del botón que lo abrió: su escala parte de ese punto.
function openSettings(trigger) {
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
  if (trigger) {
    const from = trigger.getBoundingClientRect();
    const to = els.dialog.getBoundingClientRect();
    const x = from.left + from.width / 2 - to.left;
    const y = from.top + from.height / 2 - to.top;
    els.dialog.style.transformOrigin = `${x.toFixed(0)}px ${y.toFixed(0)}px`;
  }
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
    if (ip) window.open(`http://${host}/`, '_blank', 'noopener');
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
  'pvw-select': (t) => selectPreview(t.dataset.cam),
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
  'open-settings': (t) => openSettings(t),
  'close-settings': () => els.dialog.close(),
  reconnect: () => send('retryHardware'),
  'open-panel': () => openOriginalPanel(),
  discover: () => send('discoverDevices'),
  'use-ip': (t) => useDiscoveredIp(t.dataset.ip),
  'start-device-stream': async () => {
    const response = await send('startDeviceStream');
    if (response?.ok) showToast(response.result.started ? 'STREAM encendido: el video llega en un momento.' : 'STREAM ya estaba encendido.');
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
const TAB_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };

function moveTab(event) {
  const tabs = [...els.tabs.querySelectorAll('.tab')];
  const index = tabs.indexOf(event.target);
  const step = TAB_KEYS[event.key];
  const next = Number.isFinite(step) ? (index + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
  event.preventDefault();
  selectTab(tabs[next].dataset.tab);
  tabs[next].focus();
}

function onKeyDown(event) {
  if (els.dialog.open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('.tab') && Object.hasOwn(TAB_KEYS, event.key)) {
    moveTab(event);
    return;
  }
  if (event.target.closest('input, select, textarea')) return;
  const cam = { 1: '1', 2: '2', 3: '3', 4: '4', 5: 'aux' }[event.key];
  if (cam) selectPreview(cam);
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
// El vidrio se ilumina desde el punto donde se presiona.
document.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target.closest('.capsule-btn, .icon-btn, button.status, .close-btn');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--glow-x', `${(event.clientX - rect.left).toFixed(0)}px`);
    target.style.setProperty('--glow-y', `${(event.clientY - rect.top).toFixed(0)}px`);
  },
  { passive: true },
);
// La apariencia se aplica al instante, como en los ajustes de macOS.
for (const input of els.appearance) input.addEventListener('change', () => send('setAppearance', input.value));

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
document.documentElement.dataset.ready = 'true';
