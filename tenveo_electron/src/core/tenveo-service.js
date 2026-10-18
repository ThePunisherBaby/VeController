// Conexión WebSocket con el Tenveo PC500, solo por red: ws://<IP>:8089, con
// IPv4 o con IPv6 de enlace local (cable directo). Si la conexión se cae,
// vuelve a intentar sin olvidar la IP.
//
// Optimizaciones de red:
//   - Latido con ping de WebSocket (si la implementación lo permite, como en
//     el proceso principal con la librería ws): mide la latencia y detecta una
//     conexión muerta en segundos en vez de esperar al sistema operativo.
//   - Controles continuos (T-Bar y volúmenes): si la red va lenta, se manda
//     solo el último valor y nunca se acumula un atraso.

import { Emitter } from './emitter.js';
import {
  applyDeviceUpdate,
  buttonLight,
  clamp01,
  cmdAuto,
  cmdButton,
  cmdChannelOn,
  cmdCut,
  cmdFtb,
  cmdSelectPreview,
  cmdTbar,
  cmdVolume,
  createSwitcherState,
  isChannelMuted,
} from './pc500-protocol.js';

// En vivo importa enterarse rápido de un corte: ping cada segundo, conexión
// muerta tras 4 s sin respuesta y reintentos cada vez más espaciados, desde
// 250 ms hasta 2 s, para volver enseguida tras un corte breve.
const DEFAULTS = Object.freeze({
  ethernetPort: 8089,
  firstRetryMs: 250,
  retryMs: 2000,
  connectTimeoutMs: 2000,
  switchLiveDelayMs: 150,
  heartbeatMs: 1000,
  heartbeatTimeoutMs: 4000,
  maxBufferedBytes: 8 * 1024,
  flushMs: 16,
});

const OPEN = 1;
// IPv4, nombre de equipo o IPv6. Una IPv6 de enlace local lleva su interfaz
// (fe80::1%en0): así se llega a un PC500 conectado directo por cable aunque
// su IPv4 sea de otra red.
const HOST_PATTERN = /^[A-Za-z0-9.\-:]+(%[A-Za-z0-9_.-]+)?$/;

function safeClose(ws) {
  try {
    ws.close();
  } catch {
    // El socket ya estaba cerrado.
  }
}

// En una URL, la IPv6 va entre corchetes y el % de la zona se escribe %25.
export function hostForUrl(host) {
  return host.includes(':') ? `[${host.replace('%', '%25')}]` : host;
}

export function isLinkLocal(host) {
  return typeof host === 'string' && /^fe80:/i.test(host);
}

export function isValidHost(host) {
  return typeof host === 'string' && HOST_PATTERN.test(host);
}

export class TenveoService {
  #options;
  #WebSocket;
  #ws = null;
  #state = createSwitcherState();
  #emitter = new Emitter();
  #retryTimer = null;
  #retryDelay = 0;
  #connecting = false;
  #retryRequested = false;
  #running = false;
  #ethernetIp = '';
  #heartbeat = null;
  #lastMessageAt = 0;
  #pendingLatest = new Map();
  #flushTimer = null;

  constructor(options = {}) {
    this.#options = { ...DEFAULTS, ...options };
    this.#WebSocket = options.WebSocketImpl ?? globalThis.WebSocket;
  }

  get state() {
    return this.#state;
  }

  get ethernetIp() {
    return this.#ethernetIp;
  }

  get isConnected() {
    return this.#state.connection === 'ethernet';
  }

  onChange(listener) {
    return this.#emitter.subscribe(listener);
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#connectLoop();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#dropSocket();
    this.#update({ connection: 'disconnected', endpoint: '', latencyMs: null });
  }

  // Guarda la IP del PC500 y reconecta si cambió.
  setEthernetIp(ip) {
    const next = String(ip ?? '').trim();
    const changed = next !== this.#ethernetIp;
    this.#ethernetIp = next;
    if (!this.#running) return;
    if (changed && this.#state.connection === 'ethernet') this.#reconnectNow();
    else if (!this.isConnected) this.retry();
  }

  // Intenta conectar ya, sin esperar el próximo reintento. Si hay un intento
  // en curso, se repite apenas termine: un cambio de IP en ese instante no
  // debe perderse.
  retry() {
    if (!this.#running) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    if (this.#connecting) {
      this.#retryRequested = true;
      return;
    }
    this.#connectLoop();
  }

  #reconnectNow() {
    this.#dropSocket();
    this.#update({ connection: 'disconnected', endpoint: '', latencyMs: null });
    this.retry();
  }

  #dropSocket() {
    this.#stopHeartbeat();
    clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    this.#pendingLatest.clear();
    const ws = this.#ws;
    this.#ws = null;
    if (ws) safeClose(ws);
  }

  async #connectLoop() {
    if (!this.#running || this.#connecting || this.isConnected) return;
    this.#connecting = true;
    this.#retryRequested = false;
    this.#update({ connection: 'connecting' });

    const ip = this.#ethernetIp;
    if (!ip) {
      this.#update({ lastError: 'Falta la IP del PC500: búscalo en la red.' });
    } else if (isValidHost(ip)) {
      const port = this.#options.ethernetPort;
      await this.#tryConnect(`ws://${hostForUrl(ip)}:${port}`, 'ethernet', `Red (${ip}:${port})`);
    } else {
      this.#update({ lastError: `IP no válida: ${ip}` });
    }

    this.#connecting = false;
    // Se decide con el estado real: la conexión pudo cambiar mientras se esperaba.
    if (!this.#running) return;
    if (this.isConnected) {
      // La IP cambió mientras se conectaba: se reconecta a la nueva.
      if (this.#retryRequested && ip !== this.#ethernetIp) this.#reconnectNow();
      this.#retryRequested = false;
      return;
    }
    if (this.#retryRequested) {
      this.#retryRequested = false;
      queueMicrotask(() => this.#connectLoop());
      return;
    }
    this.#update({ connection: 'disconnected', endpoint: '' });
    this.#scheduleRetry();
  }

  #tryConnect(url, type, label) {
    return new Promise((resolve) => {
      let ws;
      try {
        ws = new this.#WebSocket(url);
      } catch {
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        finish(false);
        safeClose(ws);
      }, this.#options.connectTimeoutMs);

      ws.onopen = () => {
        if (settled || !this.#running) {
          finish(false);
          safeClose(ws);
          return;
        }
        this.#attach(ws, type, label);
        finish(true);
      };
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
    });
  }

  #attach(ws, type, label) {
    this.#ws = ws;
    this.#retryDelay = 0;
    this.#lastMessageAt = Date.now();
    ws.onmessage = (event) => this.#onMessage(event.data);
    ws.onerror = () => {};
    ws.onclose = () => this.#onDisconnected(ws);
    this.#update({ connection: type, endpoint: label, lastError: null, latencyMs: null });
    this.#startHeartbeat(ws);
  }

  // Solo si la implementación de WebSocket permite mandar ping (librería ws).
  #startHeartbeat(ws) {
    if (typeof ws.ping !== 'function' || typeof ws.on !== 'function') return;
    let sentAt = 0;
    let lastPong = 0;
    let average = null;
    ws.on('pong', () => {
      const now = Date.now();
      lastPong = now;
      if (sentAt) {
        const rtt = now - sentAt;
        average = average === null ? rtt : average * 0.7 + rtt * 0.3;
        this.#update({ latencyMs: Math.round(average) });
      }
    });

    const beat = () => {
      if (ws !== this.#ws) return;
      // El corte solo se activa si el equipo ya respondió algún ping: así un
      // servidor que no contesta pings nunca pierde una conexión sana.
      const quietFor = Date.now() - Math.max(lastPong, this.#lastMessageAt);
      if (lastPong && quietFor > this.#options.heartbeatTimeoutMs) {
        this.#update({ lastError: 'El PC500 dejó de responder. Reconectando…' });
        if (typeof ws.terminate === 'function') ws.terminate();
        else safeClose(ws);
        return;
      }
      sentAt = Date.now();
      try {
        ws.ping();
      } catch {
        // Si el socket se cerró, el evento close se encarga.
      }
    };
    beat();
    this.#heartbeat = setInterval(beat, this.#options.heartbeatMs);
  }

  #stopHeartbeat() {
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #onMessage(data) {
    this.#lastMessageAt = Date.now();
    const text = typeof data === 'string' ? data : data instanceof Uint8Array ? new TextDecoder().decode(data) : null;
    if (text === null) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const next = applyDeviceUpdate(this.#state, parsed);
    if (next !== this.#state) this.#set(next);
  }

  #onDisconnected(ws) {
    if (ws !== this.#ws) return;
    this.#stopHeartbeat();
    this.#pendingLatest.clear();
    this.#ws = null;
    if (!this.#running) return;
    this.#update({ connection: 'disconnected', endpoint: '', latencyMs: null });
    // Primer intento inmediato. Si falla, el ciclo programa los siguientes.
    queueMicrotask(() => this.retry());
  }

  #scheduleRetry() {
    clearTimeout(this.#retryTimer);
    const { firstRetryMs, retryMs } = this.#options;
    this.#retryDelay = this.#retryDelay ? Math.min(retryMs, this.#retryDelay * 2) : Math.min(firstRetryMs, retryMs);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connectLoop();
    }, this.#retryDelay);
  }

  #update(patch) {
    this.#set({ ...this.#state, ...patch });
  }

  #set(next) {
    this.#state = next;
    this.#emitter.emit(next);
  }

  // --- Envío ---

  #socketReady() {
    const ws = this.#ws;
    return ws && this.isConnected && ws.readyState === OPEN ? ws : null;
  }

  #congested(ws) {
    return (ws.bufferedAmount ?? 0) > this.#options.maxBufferedBytes;
  }

  // Comando puntual (botones). Antes manda lo pendiente para respetar el orden.
  send(command) {
    const ws = this.#socketReady();
    if (!ws) return false;
    this.#flushLatest(true);
    ws.send(JSON.stringify(command));
    return true;
  }

  // Control continuo: si hay congestión, guarda solo el último valor por clave.
  #sendLatest(key, command) {
    const ws = this.#socketReady();
    if (!ws) return false;
    if (this.#pendingLatest.size === 0 && !this.#congested(ws)) {
      ws.send(JSON.stringify(command));
      return true;
    }
    this.#pendingLatest.delete(key);
    this.#pendingLatest.set(key, command);
    this.#scheduleFlush();
    return true;
  }

  #scheduleFlush() {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flushLatest(false);
    }, this.#options.flushMs);
  }

  #flushLatest(force) {
    if (this.#pendingLatest.size === 0) return;
    const ws = this.#socketReady();
    if (!ws) {
      this.#pendingLatest.clear();
      return;
    }
    if (!force && this.#congested(ws)) {
      this.#scheduleFlush();
      return;
    }
    for (const command of this.#pendingLatest.values()) ws.send(JSON.stringify(command));
    this.#pendingLatest.clear();
  }

  // --- Comandos ---

  // Si la cámara ya está en Preview no se manda nada: el equipo guardaría el
  // comando y taparía su luz para quien se conecte después.
  selectPreview(cam) {
    if (this.isConnected && String(cam) === this.#state.pvw) return true;
    return this.send(cmdSelectPreview(cam));
  }

  cut() {
    return this.send(cmdCut());
  }

  auto() {
    return this.send(cmdAuto());
  }

  ftb() {
    return this.send(cmdFtb());
  }

  // Cámara directo al aire: la pone en Preview y hace CUT.
  switchLive(cam) {
    const ok = this.selectPreview(cam);
    if (ok) setTimeout(() => this.cut(), this.#options.switchLiveDelayMs);
    return ok;
  }

  pressButton(id) {
    return this.send(cmdButton(id));
  }

  isButtonOn(id) {
    return buttonLight(this.#state.buttons[id]).on;
  }

  setVolume(channelId, db) {
    const command = cmdVolume(channelId, db);
    const key = `audio_${channelId}_vol`;
    this.#update({ volumes: { ...this.#state.volumes, [channelId]: command[key] } });
    return this.#sendLatest(key, command);
  }

  setChannelOn(channelId, on) {
    const command = cmdChannelOn(channelId, on);
    this.#update({ channelModes: { ...this.#state.channelModes, [channelId]: on ? 'ON' : 'OFF' } });
    return this.send(command);
  }

  toggleMute(channelId) {
    return this.setChannelOn(channelId, isChannelMuted(this.#state, channelId));
  }

  // Posición de la T-Bar, de 0 a 1. Se envía como "putter" de 0 a 255.
  setTbar(position) {
    const pos = clamp01(position);
    this.#update({ tbar: pos });
    return this.#sendLatest('putter', cmdTbar(pos));
  }
}
