// Interfaz de la consola. No abre conexiones: dibuja el estado que recibe y
// manda comandos al núcleo (en Electron, por IPC; en el navegador, directo).
// En la app de escritorio también está la vista Producción (production-view.js).

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
import { createIsland } from './island.js';
import { SpringValue, fromDurationBounce, rubberBand } from './springs.js';
import { createPgmVideo } from './video.js';

const $ = (id) => document.getElementById(id);

const els = {
  hw: $('hw-status'),
  hwText: $('hw-text'),
  hwLatency: $('hw-latency'),
  demoTag: $('demo-tag'),
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
  discoverRow: $('discover-row'),
  discovery: $('discovery'),
  adbText: $('adb-text'),
  settingsError: $('settings-error'),
  appearance: document.querySelectorAll('input[name="appearance"]'),
  tabs: document.querySelector('.tabs'),
  views: $('views'),
  consoleView: $('console-view'),
  studioView: $('studio-view'),
  consoleScenes: $('console-scenes'),
  tabScenes: $('tab-scenes'),
};

const root = document.documentElement;
const backend = await connectBackend();
root.dataset.platform = backend.kind;
// En la Mac la barra de la app hace de barra de título y deja lugar a los semáforos.
root.dataset.os = /Mac/.test(navigator.platform) ? 'mac' : 'other';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// La isla de la barra: el estado del PC500 y los avisos que salen de ella.
const island = createIsland({
  island: $('island'),
  status: $('island-status'),
  message: $('island-message'),
  text: $('island-text'),
  icon: $('island-icon'),
  reducedMotion,
});
// Para las pruebas y para revisar el morph en cámara lenta (tenveoTimeScale).
globalThis.tenveoIsland = island;

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

// Los avisos salen de la isla: info, success o error elige el ícono.
function showToast(message, kind = 'info') {
  island.show(message, kind);
}

// Rodillo de dígitos, como numericText: solo rueda el dígito que cambió.
function setRollingText(element, text) {
  const value = String(text);
  const previous = element.dataset.value;
  if (previous === value) return;
  element.dataset.value = value;
  if (previous === undefined || reducedMotion.matches || previous.length !== value.length) {
    element.textContent = value;
    return;
  }
  const digits = [...value].map((char, i) => {
    const span = document.createElement('span');
    span.className = char !== previous[i] && /\d/.test(char) ? 'roll roll-in' : 'roll';
    span.textContent = char;
    return span;
  });
  element.replaceChildren(...digits);
}

async function send(type, ...args) {
  try {
    const response = await backend.send(type, ...args);
    if (response && response.ok === false) showToast(response.error, 'error');
    return response;
  } catch (error) {
    const message = String(error?.message ?? error);
    showToast(message, 'error');
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
// Pasado un extremo, la manija resiste como una banda elástica y al soltarla
// vuelve con la velocidad que traía. Es solo visual: el valor enviado al
// equipo nunca pasa de 0 a 255.
const TBAR_STRETCH = 36;
const TBAR_RETURN = fromDurationBounce(0.5, 0);
const tbarBand = { overshoot: 0, velocity: 0, at: 0, frame: 0 };

function tbarTravel() {
  // La manija está a 3 px de cada borde del riel.
  return Math.max(1, els.tbarTrack.clientHeight - els.tbarHandle.offsetHeight - 6);
}

function paintTbar(pos, force = false, overshoot = 0) {
  const travel = tbarTravel();
  if (!force && pos === tbarState.pos && travel === tbarState.travel && overshoot === tbarBand.overshoot) return;
  tbarState.pos = pos;
  tbarState.travel = travel;
  tbarBand.overshoot = overshoot;
  // translate y no transform: así la escala de "elevarse" no corre la manija.
  els.tbarHandle.style.translate = `0 ${(pos * travel + overshoot).toFixed(1)}px`;
  els.tbarFill.style.height = `${Math.max(0, pos * travel).toFixed(1)}px`;
  const percent = Math.round(clamp01(pos) * 100);
  setText(els.tbarValue, `${percent}%`);
  els.tbarTrack.setAttribute('aria-valuenow', String(percent));
  els.tbar.classList.toggle('is-mid', percent > 0 && percent < 100);
}

function stopTbarSpring() {
  cancelAnimationFrame(tbarSpring.frame);
  cancelAnimationFrame(tbarBand.frame);
  tbarSpring.frame = 0;
  tbarBand.frame = 0;
}

// Devuelve la manija desde la banda elástica hasta el extremo, con su velocidad.
function releaseTbarBand() {
  if (!tbarBand.overshoot) return;
  if (reducedMotion.matches) {
    paintTbar(tbarState.pos, true, 0);
    return;
  }
  const start = performance.now() / 1000;
  const spring = new SpringValue(tbarBand.overshoot, TBAR_RETURN);
  spring.set(tbarBand.overshoot, start);
  spring.retarget(0, start, TBAR_RETURN, tbarBand.velocity);
  const step = (ms) => {
    const now = ms / 1000;
    if (spring.isSettled(now, 0.2, 2)) {
      tbarBand.frame = 0;
      paintTbar(tbarState.pos, true, 0);
      return;
    }
    paintTbar(tbarState.pos, true, spring.sample(now).value);
    tbarBand.frame = requestAnimationFrame(step);
  };
  tbarBand.frame = requestAnimationFrame(step);
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
    const travel = tbarTravel();
    const raw = tbarState.startPos + (event.clientY - tbarState.startY) / travel;
    const pos = clamp01(raw);
    const beyond = (raw - pos) * travel;
    const overshoot = beyond ? Math.sign(beyond) * rubberBand(Math.abs(beyond), TBAR_STRETCH) : 0;
    const dt = (event.timeStamp - tbarBand.at) / 1000;
    if (dt > 0) tbarBand.velocity = (overshoot - tbarBand.overshoot) / dt;
    tbarBand.at = event.timeStamp;
    const changed = pos !== tbarState.pos;
    paintTbar(pos, false, overshoot);
    if (changed) queueTbar(pos);
  });

  const endDrag = (event) => {
    if (!tbarState.dragging || event.pointerId !== tbarState.pointerId) return;
    tbarState.dragging = false;
    tbarState.pointerId = null;
    tbarState.releasedAt = performance.now();
    els.tbar.classList.remove('is-dragging');
    flushTbar();
    releaseTbarBand();
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
  if (snapshot?.extras?.demo) return 'Modo demo: el PC500 es un simulador.';
  if (backend.kind === 'browser') return 'Modo navegador: el video del PC500 solo se ve en la app de escritorio.';
  if (!adb || adb.state === 'off' || adb.state === 'stopped' || adb.state === 'disabled') return '';
  if (adb.state === 'ready') return 'Video por el cable de red (adb).';
  return adb.message;
}

// --- Dibujo ---

const isIPv6 = (host) => String(host).includes(':');

function connectionText(sw) {
  if (sw.connection === 'ethernet') {
    const ip = snapshot.settings.ethernetIp;
    return isIPv6(ip) ? 'Red · directo' : `Red · ${ip}`;
  }
  return sw.lastError && /IP/.test(sw.lastError) ? 'Sin IP' : 'Buscando…';
}

function renderTopbar(sw, settings, extras) {
  const connected = sw.connection === 'ethernet';
  els.hw.classList.toggle('is-on', connected);
  setRootData('connected', String(connected));
  setRootData('appearance', settings.appearance || 'system');
  setRootData('fullscreen', String(Boolean(extras?.window?.fullscreen)));
  setText(els.hwText, connectionText(sw));
  // La latencia cambia cada segundo: sin rodillo, para no animar la barra sin parar.
  setText(els.hwLatency, connected && Number.isFinite(sw.latencyMs) ? `${sw.latencyMs} ms` : '');
  els.hw.title = [connected ? sw.endpoint : sw.lastError, videoRouteSummary(extras?.adb)].filter(Boolean).join('\n');
  setHidden(els.demoTag, !extras?.demo);
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
  setRollingText(els.streamTime, sw.device?.streamTime || '—');
  setRollingText(els.recordTime, sw.device?.recordTime || '—');

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
  setHidden(els.discoverRow, backend.kind !== 'electron');
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
  const { switcher: sw, settings, extras } = snapshot;
  if (Boolean(extras?.window?.hidden) !== windowHidden) {
    windowHidden = Boolean(extras?.window?.hidden);
    applyVisibility();
  }
  renderTopbar(sw, settings, extras);
  renderStage(sw);
  renderMixer(sw);
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
const VIEW_KEY = 'tenveo-studio.view';

// Control segmentado: solo el segmento elegido entra en el orden del
// tabulador; las flechas mueven entre ellos (patrón de pestañas de ARIA).
function markSegments(container, attribute, name) {
  for (const tab of container.querySelectorAll('.tab')) {
    const selected = tab.dataset[attribute] === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  // El pulgar se desliza hasta el segmento elegido entre los que se ven.
  const visible = [...container.querySelectorAll('.tab')].filter((tab) => !tab.hidden);
  container.style.setProperty('--segments', String(visible.length));
  container.style.setProperty('--segment', String(Math.max(0, visible.findIndex((tab) => tab.dataset[attribute] === name))));
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: no se recuerda.
  }
}

function selectTab(name) {
  markSegments(els.tabs, 'tab', name);
  for (const panel of document.querySelectorAll('.sidebar .panel')) panel.hidden = panel.dataset.panel !== name;
  remember(TAB_KEY, name);
}

// --- Vistas: Consola y Producción ---

let studio = null;
let currentView = 'console';

function selectView(name) {
  if (!studio) name = 'console';
  currentView = name;
  markSegments(els.views, 'view', name);
  setHidden(els.consoleView, name !== 'console');
  setHidden(els.studioView, name !== 'studio');
  setRootData('view', name);
  applyVisibility();
  remember(VIEW_KEY, name);
}

// El monitor PGM y el estudio solo dibujan si se ven: ni en la otra vista ni
// con la ventana minimizada u oculta. El video se sigue recibiendo igual.
let windowHidden = false;
function applyVisibility() {
  pgmVideo.setDrawing(currentView === 'console' && !windowHidden);
  studio?.show(currentView === 'studio' && !windowHidden);
}

// La pestaña Escenas de la consola: cambiar de escena sin dejar la consola.
function renderConsoleScenes() {
  if (!studio) return;
  const live = studio.liveScene();
  const rows = studio.scenes().map((scene) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = scene.id === live ? 'scene is-current' : 'scene';
    button.dataset.action = 'scene-live';
    button.dataset.id = scene.id;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(scene.id === live));
    const dot = document.createElement('span');
    dot.className = 'scene-dot';
    const name = document.createElement('span');
    name.className = 'scene-name';
    name.textContent = scene.name;
    button.append(dot, name);
    return button;
  });
  els.consoleScenes.replaceChildren(...rows);
}

// Qué le falta al programa del PC500 para verse en la salida.
function describePc500() {
  const dv = snapshot?.extras?.deviceVideo;
  if (!dv?.connected) return 'Esperando el PC500…';
  if (!dv.streaming) return 'STREAM apagado: enciéndelo en la consola, pestaña Equipo';
  return 'Esperando el video del PC500…';
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
    const response = await backend.send('saveSettings', { ethernetIp: els.fieldIp.value });
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
  if (response?.ok) showToast(`Conectando con el PC500 en ${ip}`, 'info');
}

// --- Eventos ---

const ACTIONS = {
  'pgm-select': (t) => send('switchLive', t.dataset.cam),
  'pvw-select': (t) => selectPreview(t.dataset.cam),
  cut: () => send('cut'),
  auto: () => send('auto'),
  ftb: () => send('ftb'),
  'press-button': (t) => send('pressButton', t.dataset.button),
  mute: (t) => send('toggleMute', t.dataset.channel),
  tab: (t) => selectTab(t.dataset.tab),
  view: (t) => selectView(t.dataset.view),
  'scene-live': (t) => studio?.goLive(t.dataset.id),
  'open-settings': (t) => openSettings(t),
  'close-settings': () => els.dialog.close(),
  reconnect: () => send('retryHardware'),
  'open-panel': () => openOriginalPanel(),
  discover: () => send('discoverDevices'),
  'use-ip': (t) => useDiscoveredIp(t.dataset.ip),
  'start-device-stream': async () => {
    const response = await send('startDeviceStream');
    if (response?.ok) showToast(response.result.started ? 'STREAM encendido: el video llega en un momento.' : 'STREAM ya estaba encendido.', 'success');
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
  const group = event.target.closest('.segmented');
  const tabs = [...group.querySelectorAll('.tab')].filter((tab) => !tab.hidden);
  const index = tabs.indexOf(event.target);
  const step = TAB_KEYS[event.key];
  const next = Number.isFinite(step) ? (index + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
  event.preventDefault();
  if (group === els.views) selectView(tabs[next].dataset.view);
  else selectTab(tabs[next].dataset.tab);
  tabs[next].focus();
}

function onKeyDown(event) {
  if (els.dialog.open) return;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  if (plain && event.target.closest('.segmented .tab') && Object.hasOwn(TAB_KEYS, event.key)) {
    moveTab(event);
    return;
  }
  // En Producción el teclado es del estudio: mover, borrar, deshacer…
  if (currentView === 'studio') {
    studio?.onKeyDown(event);
    return;
  }
  if (!plain || event.target.closest('input, select, textarea')) return;
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
// La apariencia se aplica al instante, como en los ajustes de macOS.
for (const input of els.appearance) input.addEventListener('change', () => send('setAppearance', input.value));
// Menú de la Mac: Ajustes… (⌘,), y Consola (⌘1) y Producción (⌘2) en Visualización.
backend.onMenu?.((action) => {
  if (action === 'open-settings' && !els.dialog.open) openSettings(document.querySelector('.icon-btn[data-action="open-settings"]'));
  else if (action === 'view-console') selectView('console');
  else if (action === 'view-studio') selectView('studio');
});

// El estudio de producción es de la app de escritorio: usa el video del PC500,
// las cámaras de la Mac y archivos propios.
if (backend.kind === 'electron') {
  try {
    const { createStudio } = await import('./production-view.js');
    studio = await createStudio({ backend, pgm: pgmVideo, toast: showToast, describePc500 });
    studio.onChange(renderConsoleScenes);
    renderConsoleScenes();
  } catch (error) {
    console.error('[Producción]', error);
    showToast(`No se pudo abrir el estudio de producción: ${error.message}`, 'error');
  }
}
setHidden(els.views, !studio);
setHidden(els.tabScenes, !studio);

let savedTab = '';
let savedView = '';
try {
  savedTab = localStorage.getItem(TAB_KEY) ?? '';
  savedView = localStorage.getItem(VIEW_KEY) ?? '';
} catch {
  // Sin almacenamiento: queda la primera pestaña y la consola.
}
const tabOk = savedTab && document.querySelector(`.sidebar .tab[data-tab="${savedTab}"]:not([hidden])`);
selectTab(tabOk ? savedTab : 'audio');
selectView(savedView === 'studio' ? 'studio' : 'console');

backend.onState((next) => {
  snapshot = next;
  scheduleRender();
  // Lo que se ve del PC500 en la salida depende de STREAM y de la conexión.
  studio?.refresh();
});
snapshot = await backend.getState();
render();
document.documentElement.dataset.ready = 'true';
