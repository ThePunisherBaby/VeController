// Protocolo JSON del Tenveo PC500 (WebSocket, puerto 8089).
//
// Cada clave del protocolo es el id de un control del panel web original del
// equipo (pc.html, index.js y websocketUtil.js en la raíz del repositorio):
//   - Botones: el panel envía {"<id>": 1} y recibe {"<id>": "<clase CSS>"},
//     por ejemplo "active-red" (al aire) o "active-green" (en preview).
//   - Sliders: el panel envía {"<id>": <número>}.
// Este módulo no hace I/O: solo interpreta mensajes y arma comandos.

export const CAMERAS = Object.freeze([
  Object.freeze({ id: '1', name: 'CAM 1', sub: 'HDMI 1', label: 'CAMERA 1 (HDMI 1)' }),
  Object.freeze({ id: '2', name: 'CAM 2', sub: 'HDMI 2', label: 'CAMERA 2 (HDMI 2)' }),
  Object.freeze({ id: '3', name: 'CAM 3', sub: 'SDI 1', label: 'CAMERA 3 (SDI 1)' }),
  Object.freeze({ id: '4', name: 'CAM 4', sub: 'SDI 2', label: 'CAMERA 4 (SDI 2)' }),
  Object.freeze({ id: 'aux', name: 'AUX', sub: 'MEDIA / NDI', label: 'AUX (MEDIA / NDI)' }),
]);

// El panel original limita el volumen a -60..0 dB en todos los canales.
export const VOLUME_MIN_DB = -60;
export const VOLUME_MAX_DB = 0;

// Posición de la T-Bar: el slider "putter" del panel va de 0 a 255.
export const PUTTER_MAX = 255;

// Modos de las entradas IN, en el orden en que el panel los recorre.
export const INPUT_MODES = Object.freeze(['OFF', 'ON', 'AFV']);

// switchType "on": interruptor audio_<id>_on (1 encendido, 0 apagado).
// switchType "mode": modo audio_<id>_mode (0 OFF, 1 ON, 2 AFV).
export const AUDIO_CHANNELS = Object.freeze([
  Object.freeze({ id: 'in1', name: 'IN 1', switchType: 'mode', defaultDb: -6 }),
  Object.freeze({ id: 'in2', name: 'IN 2', switchType: 'mode', defaultDb: -6 }),
  Object.freeze({ id: 'in3', name: 'IN 3', switchType: 'mode', defaultDb: -6 }),
  Object.freeze({ id: 'in4', name: 'IN 4', switchType: 'mode', defaultDb: -6 }),
  Object.freeze({ id: 'mic1', name: 'MIC 1', switchType: 'on', defaultDb: 0 }),
  Object.freeze({ id: 'pgm', name: 'PGM OUT', switchType: 'on', defaultDb: -6, master: true }),
]);

// Resto de botones del panel principal (layout_window en pc.html). Todos se
// envían como {"<id>": 1} y el equipo responde con la clase de su luz.
export const PANEL_BUTTONS = Object.freeze([
  Object.freeze({ id: 'set_1', label: 'SET 1', group: 'keyer' }),
  Object.freeze({ id: 'pip1', label: 'PIP 1', sub: 'PVW', group: 'keyer' }),
  Object.freeze({ id: 'pip1-on-air', label: 'PIP 1', sub: 'PGM', group: 'keyer' }),
  Object.freeze({ id: 'dsk', label: 'DSK', group: 'keyer' }),
  Object.freeze({ id: 'chroma', label: 'CHROMA', group: 'keyer' }),
  Object.freeze({ id: 'luma', label: 'LUMA', group: 'keyer' }),
  Object.freeze({ id: 'on_air', label: 'ON AIR', group: 'keyer' }),
  Object.freeze({ id: 'set_2', label: 'SET 2', group: 'keyer' }),
  Object.freeze({ id: 'pip2', label: 'PIP 2', sub: 'PVW', group: 'keyer' }),
  Object.freeze({ id: 'pip2-on-air', label: 'PIP 2', sub: 'PGM', group: 'keyer' }),
  Object.freeze({ id: 'logo1', label: 'LOGO 1', group: 'keyer' }),
  Object.freeze({ id: 'logo2', label: 'LOGO 2', group: 'keyer' }),
  Object.freeze({ id: 'left', label: '◀', group: 'keyer' }),
  Object.freeze({ id: 'right', label: '▶', group: 'keyer' }),
  // El panel original tiene STREAM 2 siempre desactivado: con STREAM el equipo
  // transmite a sus dos destinos a la vez.
  Object.freeze({ id: 'stream', label: 'STREAM', group: 'device' }),
  Object.freeze({ id: 'rec', label: 'REC', group: 'device' }),
  Object.freeze({ id: 'still', label: 'FREEZE', group: 'device' }),
  Object.freeze({ id: 'shot', label: 'SHOT', group: 'device' }),
  Object.freeze({ id: 'mode', label: 'MODE', group: 'device' }),
  Object.freeze({ id: 'lock', label: 'LOCK', group: 'device' }),
  Object.freeze({ id: 'mute', label: 'MUTE', group: 'device' }),
  Object.freeze({ id: 'user1', label: 'USER 1', group: 'device' }),
  Object.freeze({ id: 'user2', label: 'USER 2', group: 'device' }),
]);

const CAMERA_IDS = new Set(CAMERAS.map((c) => c.id));
const CHANNELS_BY_ID = new Map(AUDIO_CHANNELS.map((c) => [c.id, c]));
const PANEL_BUTTON_IDS = new Set(PANEL_BUTTONS.map((b) => b.id));
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isPanelButton(id) {
  return PANEL_BUTTON_IDS.has(String(id));
}

export function isIPv4(value) {
  return typeof value === 'string' && IPV4.test(value);
}

// true si el servidor de un STREAM es el RTMP interno del propio PC500 (la
// opción "por defecto" del panel, rtmp://<IP del equipo>:1935/live/).
// Transmitir ahí no sale a internet: solo deja el video listo para leerlo.
export function deviceStreamServer(server, deviceIp) {
  const match = /^rtmp:\/\/([^/:]+)(?::(\d+))?\/live\/?$/i.exec(String(server ?? '').trim());
  if (!match) return false;
  const [, host, port] = match;
  if (port && port !== '1935') return false;
  return (Boolean(deviceIp) && host === deviceIp) || host === '127.0.0.1' || host === 'localhost';
}

// Los dos destinos de STREAM tal como los tiene guardados el equipo.
export function streamDestinations(state) {
  return [1, 2].map((slot) => ({
    slot,
    server: String(state.raw?.[`stream-${slot}-server`] ?? '').trim(),
    key: String(state.raw?.[`stream-${slot}-key`] ?? '').trim(),
  }));
}

export function isStreaming(state) {
  const time = state.device?.streamTime;
  return buttonLight(state.buttons?.stream).on || Boolean(time && time !== '00:00:00');
}

// Qué destino de STREAM se puede leer desde la Mac y si se puede encender
// STREAM sin salir al aire. Con STREAM el equipo transmite a sus dos destinos,
// así que solo se enciende si ninguno es una plataforma externa. isLocal dice
// si un servidor es local además del interno (por ejemplo, el de esta Mac).
export function deviceVideoPlan(state, { isLocal = () => false } = {}) {
  const ip = state.device?.ip;
  const destinations = streamDestinations(state).filter((d) => d.server);
  const internal = [...destinations].reverse().find((d) => d.key && deviceStreamServer(d.server, ip));
  const external = destinations.filter((d) => !deviceStreamServer(d.server, ip) && !isLocal(d.server, d.key));
  const streaming = isStreaming(state);
  return {
    key: internal?.key ?? '',
    slot: internal?.slot ?? 0,
    streaming,
    external: external.map((d) => d.server),
    canStart: !streaming && destinations.length > 0 && external.length === 0,
    canStop: streaming && external.length === 0,
  };
}

// Luz de un botón a partir de la clase CSS que manda el equipo. Como en el
// panel original, solo cuentan active-* y flash-*: el equipo también guarda los
// {"<id>": 1} que recibe y los devuelve tal cual, y eso no es una luz.
export function buttonLight(value) {
  if (typeof value !== 'string') return { on: false, color: null, flash: false };
  const match = /^(active|flash)-(\w+)/.exec(value);
  if (!match) return { on: false, color: null, flash: false };
  return { on: true, color: match[2], flash: match[1] === 'flash' };
}

export function isCamera(id) {
  return CAMERA_IDS.has(String(id));
}

export function getChannel(id) {
  return CHANNELS_BY_ID.get(String(id)) ?? null;
}

export function cameraLabel(id) {
  const cam = CAMERAS.find((c) => c.id === String(id));
  return cam ? cam.label : `CAMERA ${id}`;
}

export function clampDb(db) {
  const n = Math.round(Number(db));
  if (!Number.isFinite(n)) return VOLUME_MIN_DB;
  return Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, n));
}

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function createSwitcherState() {
  return {
    connection: 'disconnected', // disconnected | connecting | ethernet
    endpoint: '',
    lastError: null,
    pgm: '', // '' mientras el equipo no diga qué cámara está al aire
    pvw: '',
    tally: {}, // id de cámara -> luz que informa el equipo (pvw-N)
    ftb: false,
    auto: false,
    cut: false,
    tbar: 0, // 0 arriba, 1 abajo
    volumes: { pgm: -6, in1: -6, in2: -6, in3: -6, in4: -6, mic1: 0, mic2: 0 },
    channelModes: {}, // id -> "OFF" | "ON" | "AFV"; sin dato se asume "ON"
    buttons: {}, // id de PANEL_BUTTONS -> clase de su luz
    device: { ip: '', version: '', streamTime: '', recordTime: '' },
    latencyMs: null, // ida y vuelta medida con ping, si el equipo responde
    raw: {},
  };
}

// Un control está encendido cuando su clase empieza con active- o flash-. Un 1
// es un comando que el equipo guardó tal cual (por ejemplo después de un CUT).
export function isActiveValue(value) {
  return typeof value === 'string' && /^(active|flash)/.test(value);
}

export function channelMode(state, id) {
  return state.channelModes[id] ?? 'ON';
}

export function isChannelMuted(state, id) {
  return channelMode(state, id) === 'OFF';
}

const VOL_KEY = /^audio_([a-z0-9]+)_vol$/;
const ON_KEY = /^audio_([a-z0-9]+)_on$/;
// Solo las entradas IN usan OFF/ON/AFV. audio_mic1_mode es otra cosa
// (Line in / Mic), por eso no entra en esta expresión.
const INPUT_MODE_KEY = /^audio_(in[1-5])_mode$/;

// Devuelve un estado nuevo con los datos que mandó el equipo.
export function applyDeviceUpdate(state, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return state;

  const raw = { ...state.raw, ...data };
  const volumes = { ...state.volumes };
  const channelModes = { ...state.channelModes };
  const buttons = { ...state.buttons };
  const device = { ...state.device };
  const tally = { ...state.tally };
  let { pgm, pvw } = state;

  for (const [key, value] of Object.entries(data)) {
    if (PANEL_BUTTON_IDS.has(key)) {
      buttons[key] = value;
      continue;
    }
    if (key === 'sys_ip') {
      if (isIPv4(value)) device.ip = value;
      continue;
    }
    if (key === 'system_version' || key === 'stream_time' || key === 'record_time') {
      const field = { system_version: 'version', stream_time: 'streamTime', record_time: 'recordTime' }[key];
      if (typeof value === 'string' || typeof value === 'number') device[field] = String(value);
      continue;
    }
    if (key.startsWith('pvw-')) {
      if (typeof value !== 'string') continue; // un 1 guardado no es una luz
      const cam = key.slice(4);
      tally[cam] = value;
      if (value.startsWith('active')) {
        if (value.includes('red')) pgm = cam;
        else if (value.includes('green')) pvw = cam;
      }
      continue;
    }

    let m = VOL_KEY.exec(key);
    if (m) {
      if (typeof value === 'number' && Number.isFinite(value)) volumes[m[1]] = value;
      continue;
    }

    m = ON_KEY.exec(key);
    if (m) {
      if (value === 0 || value === 1) channelModes[m[1]] = value === 1 ? 'ON' : 'OFF';
      continue;
    }

    m = INPUT_MODE_KEY.exec(key);
    if (m && Number.isInteger(value) && INPUT_MODES[value]) {
      channelModes[m[1]] = INPUT_MODES[value];
    }
  }

  // Si la cámara al aire (o en Preview) se apagó y no se sabe cuál la
  // reemplazó, se busca otra encendida; si no hay, queda sin dato.
  const lit = (color) => CAMERAS.find((c) => (tally[c.id] ?? '').startsWith('active') && tally[c.id].includes(color))?.id ?? '';
  if (pgm && tally[pgm] && !tally[pgm].startsWith('active')) pgm = lit('red');
  if (pvw && tally[pvw] && !tally[pvw].startsWith('active')) pvw = lit('green');

  return {
    ...state,
    raw,
    pgm,
    pvw,
    tally,
    volumes,
    channelModes,
    buttons,
    device,
    ftb: isActiveValue(raw.ftb),
    auto: isActiveValue(raw.auto),
    cut: isActiveValue(raw.cut),
  };
}

// --- Comandos hacia el equipo ---

export function cmdSelectPreview(cam) {
  if (!isCamera(cam)) throw new RangeError(`Cámara desconocida: ${cam}`);
  return { [`pvw-${cam}`]: 1 };
}

export function cmdCut() {
  return { cut: 1 };
}

export function cmdAuto() {
  return { auto: 1 };
}

export function cmdFtb() {
  return { ftb: 1 };
}

export function cmdVolume(channelId, db) {
  if (!getChannel(channelId)) throw new RangeError(`Canal desconocido: ${channelId}`);
  return { [`audio_${channelId}_vol`]: clampDb(db) };
}

// Enciende o apaga un canal con el mismo control que usa el panel original.
export function cmdChannelOn(channelId, on) {
  const channel = getChannel(channelId);
  if (!channel) throw new RangeError(`Canal desconocido: ${channelId}`);
  if (channel.switchType === 'on') return { [`audio_${channelId}_on`]: on ? 1 : 0 };
  return { [`audio_${channelId}_mode`]: on ? INPUT_MODES.indexOf('ON') : INPUT_MODES.indexOf('OFF') };
}

export function cmdTbar(position) {
  return { putter: Math.round(clamp01(position) * PUTTER_MAX) };
}

export function cmdButton(id) {
  if (!isPanelButton(id)) throw new RangeError(`Botón desconocido: ${id}`);
  return { [id]: 1 };
}
