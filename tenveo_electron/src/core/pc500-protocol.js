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

const CAMERA_IDS = new Set(CAMERAS.map((c) => c.id));
const CHANNELS_BY_ID = new Map(AUDIO_CHANNELS.map((c) => [c.id, c]));

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
  let { pgm, pvw } = state;

  for (const [key, value] of Object.entries(data)) {
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
