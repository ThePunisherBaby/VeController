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
  Object.freeze({ id: 'stream', label: 'STREAM 1', group: 'device' }),
  Object.freeze({ id: 'stream_2', label: 'STREAM 2', group: 'device' }),
  Object.freeze({ id: 'rec', label: 'REC', group: 'device' }),
  Object.freeze({ id: 'still', label: 'FREEZE', group: 'device' }),
  Object.freeze({ id: 'shot', label: 'SHOT', group: 'device' }),
  Object.freeze({ id: 'mode', label: 'MODE', group: 'device' }),
  Object.freeze({ id: 'lock', label: 'LOCK', group: 'device' }),
  Object.freeze({ id: 'mute', label: 'MUTE', group: 'device' }),
  Object.freeze({ id: 'user1', label: 'USER 1', group: 'device' }),
  Object.freeze({ id: 'user2', label: 'USER 2', group: 'device' }),
]);

// Canal de transmisión del PC500 que la app usa para mandar video a la Mac.
// El canal 1 queda libre para YouTube u otra plataforma.
export const VIDEO_STREAM_SLOT = 2;
const STREAM_BUTTON_BY_SLOT = Object.freeze({ 1: 'stream', 2: 'stream_2' });

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

export function streamButtonForSlot(slot) {
  const id = STREAM_BUTTON_BY_SLOT[slot];
  if (!id) throw new RangeError(`Canal de transmisión desconocido: ${slot}`);
  return id;
}

// Luz de un botón a partir de la clase CSS que manda el equipo.
export function buttonLight(value) {
  if (value === 1 || value === true) return { on: true, color: 'white', flash: false };
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
    connection: 'disconnected', // disconnected | connecting | usb | ethernet
    endpoint: '',
    lastError: null,
    pgm: '1',
    pvw: '2',
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

// Un botón del panel está encendido cuando su clase empieza con active- o
// flash-, o cuando el equipo manda 1.
export function isActiveValue(value) {
  if (value === 1 || value === true) return true;
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
      if (typeof value === 'string' && value.includes('active')) {
        const cam = key.slice(4);
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

  return {
    ...state,
    raw,
    pgm,
    pvw,
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

// Destino de un canal de transmisión, igual que el botón "stream-N" de la
// pestaña de sistema del panel. Conserva los fps y la tasa de bits actuales.
export function cmdStreamTarget(slot, server, key, raw = {}) {
  streamButtonForSlot(slot);
  if (!/^rtmps?:\/\/[^\s]+$/.test(String(server))) throw new RangeError(`Servidor RTMP no válido: ${server}`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(key))) throw new RangeError(`Clave de transmisión no válida: ${key}`);
  const command = { [`stream-${slot}-server`]: String(server), [`stream-${slot}-key`]: String(key) };
  if (Number.isFinite(raw.stream_fps_index)) command.stream_fps_index = raw.stream_fps_index;
  if (Number.isFinite(raw.stream_bitrate)) command.stream_bitrate = raw.stream_bitrate;
  return command;
}
