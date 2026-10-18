// Simuladores del PC500 y de OBS, sin red de por medio.
// Los usan las pruebas, los simuladores por WebSocket de dev/ y el modo demo
// de la versión web (?demo). El del PC500 imita el protocolo del panel web
// original; no es el firmware real.

import { obsAuthString } from './obs-auth.js';
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
    streams: {},
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
  const buttonClass = (id) => (state.buttons[id] ? (id === 'stream' || id === 'stream_2' || id === 'rec' ? 'active-red' : 'active-green') : 'none-white');
  const fullState = () => ({
    system_version: 'SIMULADOR PC500',
    sys_ip: ip,
    stream_fps_index: 1,
    stream_bitrate: 4000,
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
      broadcast({ [key]: buttonClass(key) });
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

// --- OBS WebSocket v5 ---

function randomBase64(length = 16) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createObsSimulator({ password = null, scenes = ['Cam 1', 'Cam 2', 'Cam 3', 'Cam 4', 'Slides'] } = {}) {
  const state = { streaming: false, recording: false, virtualCam: false, program: scenes[0] ?? '', scenes: [...scenes] };
  const requests = [];
  const sessions = new Set();

  const broadcast = (message) => {
    const text = JSON.stringify(message);
    for (const session of sessions) {
      if (session.identified) session.send(text);
    }
  };
  const emit = (eventType, eventData) => broadcast({ op: 5, d: { eventType, eventIntent: 0, eventData } });
  const later = (fn) => setTimeout(fn, 5);

  function respond(session, d) {
    const { requestType, requestId, requestData = {} } = d;
    let responseData = {};
    let requestStatus = { result: true, code: 100 };
    switch (requestType) {
      case 'GetStreamStatus':
        responseData = { outputActive: state.streaming, outputTimecode: '00:00:00.000' };
        break;
      case 'GetRecordStatus':
        responseData = { outputActive: state.recording, outputTimecode: '00:00:00.000' };
        break;
      case 'GetVirtualCamStatus':
        responseData = { outputActive: state.virtualCam };
        break;
      case 'GetSceneList':
        responseData = {
          currentProgramSceneName: state.program,
          scenes: state.scenes.map((sceneName, sceneIndex) => ({ sceneIndex, sceneName })),
        };
        break;
      case 'ToggleStream':
        state.streaming = !state.streaming;
        responseData = { outputActive: state.streaming };
        later(() => emit('StreamStateChanged', { outputActive: state.streaming }));
        break;
      case 'ToggleRecord':
        state.recording = !state.recording;
        later(() => emit('RecordStateChanged', { outputActive: state.recording }));
        break;
      case 'ToggleVirtualCam':
        state.virtualCam = !state.virtualCam;
        responseData = { outputActive: state.virtualCam };
        later(() => emit('VirtualcamStateChanged', { outputActive: state.virtualCam }));
        break;
      case 'SetCurrentProgramScene':
        if (state.scenes.includes(requestData.sceneName)) {
          state.program = requestData.sceneName;
          later(() => emit('CurrentProgramSceneChanged', { sceneName: state.program }));
        } else {
          requestStatus = { result: false, code: 600, comment: 'No source was found.' };
        }
        break;
      default:
        requestStatus = { result: false, code: 204, comment: 'Unknown request type.' };
        break;
    }
    session.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus, responseData } }));
  }

  return {
    state,
    requests,
    emit,
    // send(texto) entrega un mensaje; close(código, motivo) cierra la conexión.
    connect(send, close = () => {}) {
      const session = { send, identified: false, salt: randomBase64(), challenge: randomBase64() };
      sessions.add(session);
      const hello = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
      if (password) hello.authentication = { challenge: session.challenge, salt: session.salt };
      send(JSON.stringify({ op: 0, d: hello }));
      return {
        async receive(text) {
          const message = parse(text);
          if (!message) return;
          if (message.op === 1) {
            if (password) {
              const expected = await obsAuthString(password, session.salt, session.challenge);
              if (message.d?.authentication !== expected) {
                sessions.delete(session);
                close(4009, 'Authentication failed.');
                return;
              }
            }
            session.identified = true;
            send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
            return;
          }
          if (message.op === 6 && session.identified) {
            requests.push(message.d);
            respond(session, message.d);
          }
        },
        close() {
          sessions.delete(session);
        },
      };
    },
  };
}
