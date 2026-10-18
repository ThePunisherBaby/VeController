// Conexión WebSocket con el Tenveo PC500.
//
// Prueba primero el puente USB (adb forward a 127.0.0.1:8089) y después la IP
// Ethernet, si hay una configurada. Si la conexión se cae, vuelve a intentar
// sin olvidar la IP Ethernet.

import { Emitter } from './emitter.js';
import {
  applyDeviceUpdate,
  clamp01,
  cmdAuto,
  cmdChannelOn,
  cmdCut,
  cmdFtb,
  cmdSelectPreview,
  cmdTbar,
  cmdVolume,
  createSwitcherState,
  isChannelMuted,
} from './pc500-protocol.js';

const DEFAULTS = Object.freeze({
  usbUrl: 'ws://127.0.0.1:8089',
  ethernetPort: 8089,
  retryMs: 4000,
  connectTimeoutMs: 2000,
  switchLiveDelayMs: 150,
});

const OPEN = 1;
const HOST_PATTERN = /^[A-Za-z0-9.\-:]+$/;

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
  #connecting = false;
  #running = false;
  #ethernetIp = '';

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
    return this.#state.connection === 'usb' || this.#state.connection === 'ethernet';
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
    const ws = this.#ws;
    this.#ws = null;
    if (ws) safeClose(ws);
    this.#update({ connection: 'disconnected', endpoint: '' });
  }

  // Guarda la IP Ethernet. Si ya hay conexión por USB, se mantiene USB.
  setEthernetIp(ip) {
    const next = String(ip ?? '').trim();
    const changed = next !== this.#ethernetIp;
    this.#ethernetIp = next;
    if (!this.#running) return;
    if (changed && this.#state.connection === 'ethernet') {
      // Cambió la IP de la conexión actual: reconectar con la nueva.
      const ws = this.#ws;
      this.#ws = null;
      if (ws) safeClose(ws);
      this.#update({ connection: 'disconnected', endpoint: '' });
      this.retry();
    } else if (!this.isConnected) {
      this.retry();
    }
  }

  // Intenta conectar ya, sin esperar el próximo reintento.
  retry() {
    if (!this.#running) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#connectLoop();
  }

  async #connectLoop() {
    if (!this.#running || this.#connecting || this.isConnected) return;
    this.#connecting = true;
    this.#update({ connection: 'connecting' });

    const usb = new URL(this.#options.usbUrl);
    let ok = await this.#tryConnect(this.#options.usbUrl, 'usb', `USB (Bridge: ${usb.host})`);

    const ip = this.#ethernetIp;
    if (!ok && ip && this.#running) {
      if (isValidHost(ip)) {
        const port = this.#options.ethernetPort;
        ok = await this.#tryConnect(`ws://${hostForUrl(ip)}:${port}`, 'ethernet', `Ethernet LAN (${ip}:${port})`);
      } else {
        this.#update({ lastError: `IP no válida: ${ip}` });
      }
    }

    this.#connecting = false;
    if (!this.#running) return;
    if (!ok) {
      this.#update({ connection: 'disconnected', endpoint: '' });
      this.#scheduleRetry();
    }
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
    ws.onmessage = (event) => this.#onMessage(event.data);
    ws.onerror = () => {};
    ws.onclose = () => this.#onDisconnected(ws);
    this.#update({ connection: type, endpoint: label, lastError: null });
  }

  #onMessage(data) {
    if (typeof data !== 'string') return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const next = applyDeviceUpdate(this.#state, parsed);
    if (next !== this.#state) this.#set(next);
  }

  #onDisconnected(ws) {
    if (ws !== this.#ws) return;
    this.#ws = null;
    if (!this.#running) return;
    this.#update({ connection: 'disconnected', endpoint: '' });
    // Primer intento inmediato. Si falla, el ciclo programa los siguientes.
    queueMicrotask(() => this.#connectLoop());
  }

  #scheduleRetry() {
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connectLoop();
    }, this.#options.retryMs);
  }

  #update(patch) {
    this.#set({ ...this.#state, ...patch });
  }

  #set(next) {
    this.#state = next;
    this.#emitter.emit(next);
  }

  // --- Comandos ---

  send(command) {
    const ws = this.#ws;
    if (!ws || !this.isConnected || ws.readyState !== OPEN) return false;
    ws.send(JSON.stringify(command));
    return true;
  }

  selectPreview(cam) {
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

  setVolume(channelId, db) {
    const command = cmdVolume(channelId, db);
    const value = command[`audio_${channelId}_vol`];
    this.#update({ volumes: { ...this.#state.volumes, [channelId]: value } });
    return this.send(command);
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
    return this.send(cmdTbar(pos));
  }
}
