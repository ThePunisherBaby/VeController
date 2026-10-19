// Une el servicio del PC500 con la interfaz (equivale al SwitcherProvider de la
// app de Flutter): recibe los comandos, guarda la configuración y avisa de cada
// cambio de estado.

import { Emitter } from './emitter.js';
import { getChannel, isCamera, isPanelButton } from './pc500-protocol.js';
import { isValidHost } from './tenveo-service.js';

// Todo va por red: la IP del PC500 (o su IPv6 de enlace local por cable
// directo). El video siempre lo toma la app del servidor interno del PC500.
// La apariencia sigue al sistema salvo que se fije.
export const APPEARANCES = Object.freeze(['system', 'dark', 'light']);

export const DEFAULT_SETTINGS = Object.freeze({
  ethernetIp: '',
  appearance: 'system',
});

// Acepta solo valores válidos de una configuración guardada. Las opciones de
// versiones anteriores (modos USB, fuentes de video, OBS) se descartan.
export function normalizeSettings(input = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof input.ethernetIp === 'string') {
    const ip = input.ethernetIp.trim();
    if (ip === '' || isValidHost(ip)) settings.ethernetIp = ip;
  }
  if (APPEARANCES.includes(input.appearance)) settings.appearance = input.appearance;
  return settings;
}

function requireCamera(cam) {
  if (!isCamera(cam)) throw new RangeError(`Cámara desconocida: ${cam}`);
  return String(cam);
}

function requireChannel(channel) {
  if (!getChannel(channel)) throw new RangeError(`Canal desconocido: ${channel}`);
  return String(channel);
}

function requireButton(id) {
  if (!isPanelButton(id)) throw new RangeError(`Botón desconocido: ${id}`);
  return String(id);
}

function requireAppearance(value) {
  if (!APPEARANCES.includes(value)) throw new RangeError(`Apariencia desconocida: ${value}`);
  return value;
}

export class StudioController {
  #tenveo;
  #emitter = new Emitter();
  #settings;
  #persist;
  #extras;
  #unsubscribers = [];

  #commands = {
    selectPreview: (cam) => this.#tenveo.selectPreview(requireCamera(cam)),
    switchLive: (cam) => this.#tenveo.switchLive(requireCamera(cam)),
    cut: () => this.#tenveo.cut(),
    auto: () => this.#tenveo.auto(),
    ftb: () => this.#tenveo.ftb(),
    setTbar: (position) => this.#tenveo.setTbar(position),
    setVolume: (channel, db) => this.#tenveo.setVolume(requireChannel(channel), db),
    toggleMute: (channel) => this.#tenveo.toggleMute(requireChannel(channel)),
    pressButton: (id) => this.#tenveo.pressButton(requireButton(id)),
    setAppearance: (value) => this.#updateSettings({ appearance: requireAppearance(value) }),
    saveSettings: (input) => this.saveSettings(input),
    retryHardware: () => this.#tenveo.retry(),
  };

  constructor({ tenveo, settings = {}, persist = () => {}, extras = {} }) {
    this.#tenveo = tenveo;
    this.#settings = normalizeSettings(settings);
    this.#persist = persist;
    this.#extras = { ...extras };
  }

  get settings() {
    return { ...this.#settings };
  }

  start() {
    this.#unsubscribers.push(this.#tenveo.onChange(() => this.#notify()));
    this.#tenveo.setEthernetIp(this.#settings.ethernetIp);
    this.#tenveo.start();
  }

  stop() {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    this.#tenveo.stop();
  }

  onChange(listener) {
    return this.#emitter.subscribe(listener);
  }

  // Datos extra que no vienen del PC500, como el estado del puente adb o el video.
  setExtra(key, value) {
    this.#extras = { ...this.#extras, [key]: value };
    this.#notify();
  }

  snapshot() {
    const { raw, ...switcher } = this.#tenveo.state;
    return {
      switcher,
      settings: { ...this.#settings },
      extras: this.#extras,
    };
  }

  dispatch(type, ...args) {
    const handler = Object.hasOwn(this.#commands, type) ? this.#commands[type] : null;
    if (!handler) throw new Error(`Comando desconocido: ${type}`);
    return handler(...args);
  }

  // Guarda la configuración del diálogo y reconecta con el PC500.
  saveSettings({ ethernetIp } = {}) {
    const next = { ...this.#settings };
    if (ethernetIp !== undefined) {
      const ip = String(ethernetIp ?? '').trim();
      if (ip && !isValidHost(ip)) throw new Error(`IP no válida: ${ip}`);
      next.ethernetIp = ip;
    }
    this.#settings = next;
    this.#persist(this.#settings);
    this.#tenveo.setEthernetIp(next.ethernetIp);
    this.#tenveo.retry();
    this.#notify();
    return this.snapshot().settings;
  }

  #updateSettings(patch) {
    this.#settings = { ...this.#settings, ...patch };
    this.#persist(this.#settings);
    this.#notify();
    return this.snapshot().settings;
  }

  #notify() {
    this.#emitter.emit(this.snapshot());
  }
}
