// Simulador del PC500, sin red de por medio.
// Los usan las pruebas, los simuladores por WebSocket de dev/ y el modo demo
// de la versión web (?demo). El del PC500 imita el protocolo del panel web
// original; no es el firmware real.

import { PANEL_BUTTONS } from './pc500-protocol.js';

const CAMS = ['1', '2', '3', '4', 'aux'];
const PANEL_BUTTON_IDS = new Set(PANEL_BUTTONS.map((b) => b.id));
const VOLUME_CHANNELS = ['pgm', 'hp', 'in1', 'in2', 'in3', 'in4', 'in5', 'mic1', 'mic2'];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function parse(text) {
  try {
    const data = JSON.parse(String(text));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// --- PC500 ---

export function createPc500Simulator({ autoDelayMs = 600, ip = '192.168.1.188' } = {}) {
  const state = {
    pgm: '1',
    pvw: '2',
    cut: false,
    auto: false,
    ftb: false,
    putter: 0,
    putterEnd: 0,
    vol: { pgm: -6, hp: -10, in1: -12, in2: -8, in3: -20, in4: -60, in5: -60, mic1: -3, mic2: -60 },
    on: { pgm: 1, mic1: 1, mic2: 0 },
    mode: { in1: 1, in2: 1, in3: 2, in4: 0, in5: 0 },
    buttons: {},
    // Como el equipo de fábrica: los dos destinos van a su servidor interno.
    streams: { '1-server': `rtmp://${ip}:1935/live/`, '1-key': 'live1', '2-server': `rtmp://${ip}:1935/live/`, '2-key': 'live2' },
  };
  const received = [];
  const sessions = new Set();

  const camClass = (cam) => (cam === state.pgm ? 'active-red' : cam === state.pvw ? 'active-green' : 'none-white');
  const busState = () => Object.fromEntries(CAMS.map((cam) => [`pvw-${cam}`, camClass(cam)]));
  const flags = () => ({
    cut: state.cut ? 'active-red' : 'none-white',
    auto: state.auto ? 'active-white' : 'none-white',
    ftb: state.ftb ? 'active-red' : 'none-red',
  });
  const buttonClass = (id) => {
    if (id === 'stream') return state.buttons.stream ? 'active-green' : 'none-green';
    return state.buttons[id] ? (id === 'rec' ? 'active-red' : 'active-green') : 'none-white';
  };
  const fullState = () => ({
    system_version: 'SIMULADOR PC500',
    sys_ip: ip,
    stream_fps_index: 1,
    stream_bitrate: 4000,
    stream_time: state.buttons.stream ? '00:00:01' : '00:00:00',
    ...Object.fromEntries(Object.entries(state.streams).map(([slotField, value]) => [`stream-${slotField}`, value])),
    ...Object.fromEntries([...PANEL_BUTTON_IDS].map((id) => [id, buttonClass(id)])),
    ...busState(),
    ...flags(),
    ...Object.fromEntries(VOLUME_CHANNELS.map((ch) => [`audio_${ch}_vol`, state.vol[ch]])),
    ...Object.fromEntries(Object.entries(state.on).map(([ch, v]) => [`audio_${ch}_on`, v])),
    ...Object.fromEntries(Object.entries(state.mode).map(([ch, v]) => [`audio_${ch}_mode`, v])),
    audio_mic1_mode: 1,
  });

  const broadcast = (data) => {
    const text = JSON.stringify(data);
    for (const session of sessions) session.send(text);
  };
  const take = () => {
    [state.pgm, state.pvw] = [state.pvw, state.pgm];
    broadcast(busState());
  };

  function handle(key, value) {
    if (PANEL_BUTTON_IDS.has(key) && value === 1) {
      state.buttons[key] = !state.buttons[key];
      const update = { [key]: buttonClass(key) };
      if (key === 'stream') update.stream_time = state.buttons.stream ? '00:00:01' : '00:00:00';
      broadcast(update);
      return;
    }
    const stream = /^stream-([12])-(server|key)$/.exec(key);
    if (stream && typeof value === 'string') {
      state.streams[`${stream[1]}-${stream[2]}`] = value;
      return;
    }
    if (key.startsWith('pvw-')) {
      const cam = key.slice(4);
      if (CAMS.includes(cam) && value === 1) {
        state.pvw = cam;
        broadcast(busState());
      }
      return;
    }
    if (key === 'cut' && value === 1) {
      take();
      state.cut = true;
      broadcast(flags());
      setTimeout(() => {
        state.cut = false;
        broadcast(flags());
      }, 150);
      return;
    }
    if (key === 'auto' && value === 1) {
      state.auto = true;
      broadcast(flags());
      setTimeout(() => {
        take();
        state.auto = false;
        broadcast(flags());
      }, autoDelayMs);
      return;
    }
    if (key === 'ftb' && value === 1) {
      state.ftb = !state.ftb;
      broadcast(flags());
      return;
    }
    if (key === 'putter' && Number.isFinite(value)) {
      // Como una T-Bar real: llegar al otro extremo completa la transición.
      const v = clamp(Math.round(value), 0, 255);
      state.putter = v;
      if (v === 255 && state.putterEnd === 0) {
        state.putterEnd = 255;
        take();
      } else if (v === 0 && state.putterEnd === 255) {
        state.putterEnd = 0;
        take();
      }
      return;
    }
    let m = /^audio_([a-z0-9]+)_vol$/.exec(key);
    if (m && VOLUME_CHANNELS.includes(m[1]) && Number.isFinite(value)) {
      state.vol[m[1]] = clamp(value, -60, 0);
      broadcast({ [key]: state.vol[m[1]] });
      return;
    }
    m = /^audio_(pgm|mic1|mic2)_on$/.exec(key);
    if (m && (value === 0 || value === 1)) {
      state.on[m[1]] = value;
      broadcast({ [key]: value });
      return;
    }
    m = /^audio_(in[1-5])_mode$/.exec(key);
    if (m && [0, 1, 2].includes(value)) {
      state.mode[m[1]] = value;
      broadcast({ [key]: value });
    }
  }

  return {
    state,
    received,
    // send(texto) entrega un mensaje al cliente. Devuelve la sesión del cliente.
    connect(send) {
      const session = { send };
      sessions.add(session);
      send(JSON.stringify(fullState()));
      return {
        receive(text) {
          const data = parse(text);
          if (!data) return;
          received.push(data);
          for (const [key, value] of Object.entries(data)) handle(key, value);
        },
        close() {
          sessions.delete(session);
        },
      };
    },
  };
}
