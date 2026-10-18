// Cliente de OBS WebSocket v5 (por defecto ws://127.0.0.1:4455).
// Saludo: Hello (op 0), Identify (op 1) e Identified (op 2). Si OBS tiene
// contraseña, el Identify lleva la respuesta calculada con obsAuthString.

import { Emitter } from './emitter.js';
import { obsAuthString } from './obs-auth.js';

const OP = Object.freeze({
  HELLO: 0,
  IDENTIFY: 1,
  IDENTIFIED: 2,
  EVENT: 5,
  REQUEST: 6,
  REQUEST_RESPONSE: 7,
});

// General (1 << 0), Scenes (1 << 2) y Outputs (1 << 6).
export const EVENT_SUBSCRIPTIONS = (1 << 0) | (1 << 2) | (1 << 6);

const AUTH_FAILED = 4009;
const OPEN = 1;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4455;

export function createObsState() {
  return {
    status: 'disconnected', // disconnected | connecting | connected
    endpoint: '',
    streaming: false,
    recording: false,
    virtualCam: false,
    streamTimecode: '00:00:00',
    recordTimecode: '00:00:00',
    scenes: [],
    programScene: '',
    authRequired: false,
    lastError: null,
  };
}

function safeClose(ws) {
  try {
    ws.close();
  } catch {
    // El socket ya estaba cerrado.
  }
}

function hostForUrl(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function sceneNames(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map((s) => s?.sceneName).filter((name) => typeof name === 'string');
}

export class ObsService {
  #options;
  #WebSocket;
  #ws = null;
  #state = createObsState();
  #emitter = new Emitter();
  #retryTimer = null;
  #running = false;
  #requestId = 0;
  #host = DEFAULT_HOST;
  #port = DEFAULT_PORT;
  #password = '';

  constructor(options = {}) {
    this.#options = { retryMs: 5000, connectTimeoutMs: 3000, ...options };
    this.#WebSocket = options.WebSocketImpl ?? globalThis.WebSocket;
    this.configure(options);
  }

  get state() {
    return this.#state;
  }

  get isConnected() {
    return this.#state.status === 'connected';
  }

  get config() {
    return { host: this.#host, port: this.#port, hasPassword: this.#password.length > 0 };
  }

  onChange(listener) {
    return this.#emitter.subscribe(listener);
  }

  // Cambia host, puerto o contraseña. Si algo cambió, reconecta.
  configure({ host, port, password } = {}) {
    let changed = false;
    if (host !== undefined) {
      const next = String(host ?? '').trim() || DEFAULT_HOST;
      if (next !== this.#host) {
        this.#host = next;
        changed = true;
      }
    }
    if (port !== undefined) {
      const n = Number(port);
      const next = Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
      if (next !== this.#port) {
        this.#port = next;
        changed = true;
      }
    }
    if (password !== undefined) {
      const next = String(password ?? '');
      if (next !== this.#password) {
        this.#password = next;
        changed = true;
      }
    }
    if (changed && this.#running) this.#reconnect();
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#connect();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) safeClose(ws);
    this.#update({ status: 'disconnected' });
  }

  retry() {
    if (!this.#running) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    if (!this.#ws) this.#connect();
  }

  #reconnect() {
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) safeClose(ws);
    this.#update({ status: 'disconnected', lastError: null });
    this.#connect();
  }

  #connect() {
    if (!this.#running || this.#ws) return;
    const endpoint = `${this.#host}:${this.#port}`;
    this.#update({ status: 'connecting', endpoint });

    let ws;
    try {
      ws = new this.#WebSocket(`ws://${hostForUrl(this.#host)}:${this.#port}`);
    } catch (error) {
      this.#update({ status: 'disconnected', lastError: `Dirección de OBS no válida: ${endpoint}` });
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;

    // Si no termina el saludo a tiempo, se cierra y se reintenta.
    const timer = setTimeout(() => {
      if (this.#ws === ws && !this.isConnected) safeClose(ws);
    }, this.#options.connectTimeoutMs);

    ws.onmessage = (event) => {
      if (this.#ws === ws) this.#onMessage(ws, event.data);
    };
    ws.onerror = () => {};
    ws.onclose = (event) => {
      clearTimeout(timer);
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#onClosed(event?.code);
    };
  }

  #onClosed(code) {
    if (!this.#running) {
      this.#update({ status: 'disconnected' });
      return;
    }
    let lastError = null;
    if (code === AUTH_FAILED) {
      lastError = this.#password
        ? 'La contraseña de OBS no es correcta.'
        : 'OBS pide contraseña. Escríbela en la configuración.';
    }
    this.#update({ status: 'disconnected', lastError });
    this.#scheduleRetry();
  }

  #scheduleRetry() {
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connect();
    }, this.#options.retryMs);
  }

  async #onMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const d = msg?.d ?? {};
    switch (msg?.op) {
      case OP.HELLO:
        await this.#identify(ws, d);
        break;
      case OP.IDENTIFIED:
        this.#update({ status: 'connected', lastError: null });
        this.#queryInitialStatus();
        break;
      case OP.EVENT:
        this.#handleEvent(d.eventType, d.eventData ?? {});
        break;
      case OP.REQUEST_RESPONSE:
        this.#handleResponse(d.requestType, d.requestStatus, d.responseData ?? {});
        break;
      default:
        break;
    }
  }

  async #identify(ws, hello) {
    const payload = { rpcVersion: 1, eventSubscriptions: EVENT_SUBSCRIPTIONS };
    const auth = hello?.authentication;
    this.#update({ authRequired: Boolean(auth) });
    if (auth && this.#password) {
      payload.authentication = await obsAuthString(this.#password, auth.salt, auth.challenge);
    }
    // Sin contraseña, OBS cierra con el código 4009 y se muestra el aviso.
    if (this.#ws !== ws) return;
    this.#sendRaw(ws, { op: OP.IDENTIFY, d: payload });
  }

  #queryInitialStatus() {
    for (const type of ['GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus', 'GetSceneList']) {
      this.request(type);
    }
  }

  #handleEvent(type, data) {
    switch (type) {
      case 'StreamStateChanged':
        this.#update({ streaming: Boolean(data.outputActive) });
        break;
      case 'RecordStateChanged':
        this.#update({ recording: Boolean(data.outputActive) });
        break;
      case 'VirtualcamStateChanged':
        this.#update({ virtualCam: Boolean(data.outputActive) });
        break;
      case 'CurrentProgramSceneChanged':
        this.#update({ programScene: String(data.sceneName ?? '') });
        break;
      case 'SceneListChanged':
        this.#update({ scenes: sceneNames(data.scenes) });
        break;
      default:
        break;
    }
  }

  #handleResponse(type, status, data) {
    if (status && status.result === false) return;
    switch (type) {
      case 'GetStreamStatus':
        this.#update({
          streaming: Boolean(data.outputActive),
          streamTimecode: String(data.outputTimecode ?? '00:00:00'),
        });
        break;
      case 'GetRecordStatus':
        this.#update({
          recording: Boolean(data.outputActive),
          recordTimecode: String(data.outputTimecode ?? '00:00:00'),
        });
        break;
      case 'GetVirtualCamStatus':
        this.#update({ virtualCam: Boolean(data.outputActive) });
        break;
      case 'GetSceneList':
        this.#update({
          scenes: sceneNames(data.scenes),
          programScene: String(data.currentProgramSceneName ?? ''),
        });
        break;
      default:
        break;
    }
  }

  #sendRaw(ws, message) {
    if (ws.readyState !== OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  #update(patch) {
    this.#state = { ...this.#state, ...patch };
    this.#emitter.emit(this.#state);
  }

  // --- Acciones ---

  request(requestType, requestData) {
    const ws = this.#ws;
    if (!ws || !this.isConnected) return false;
    const d = { requestType, requestId: String(++this.#requestId) };
    if (requestData !== undefined) d.requestData = requestData;
    return this.#sendRaw(ws, { op: OP.REQUEST, d });
  }

  toggleStream() {
    return this.request('ToggleStream');
  }

  toggleRecord() {
    return this.request('ToggleRecord');
  }

  toggleVirtualCam() {
    return this.request('ToggleVirtualCam');
  }

  setScene(sceneName) {
    return this.request('SetCurrentProgramScene', { sceneName: String(sceneName) });
  }
}
