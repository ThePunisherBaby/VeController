// Une el servicio del PC500 con el de OBS (equivale al SwitcherProvider de la
// app de Flutter). Recibe los comandos de la interfaz, guarda la configuración
// y, con SYNC OBS activo, cambia la escena de OBS cuando cambia la cámara al aire.

import { Emitter } from './emitter.js';
import { getChannel, isCamera, isPanelButton } from './pc500-protocol.js';
import { isValidHost } from './tenveo-service.js';

// Todo va por red: la IP del PC500 (o su IPv6 de enlace local por cable
// directo) y la conexión con OBS. El video siempre lo toma la app del
// servidor interno del PC500.
export const DEFAULT_SETTINGS = Object.freeze({
  ethernetIp: '',
  obsHost: '127.0.0.1',
  obsPort: 4455,
  syncWithObs: true,
});

function isPort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536;
}

// Acepta solo valores válidos de una configuración guardada. Las opciones de
// versiones anteriores (modos USB, fuentes de video) se descartan.
export function normalizeSettings(input = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof input.ethernetIp === 'string') {
    const ip = input.ethernetIp.trim();
    if (ip === '' || isValidHost(ip)) settings.ethernetIp = ip;
  }
  if (typeof input.obsHost === 'string' && isValidHost(input.obsHost.trim())) {
    settings.obsHost = input.obsHost.trim();
  }
  if (isPort(input.obsPort)) settings.obsPort = Number(input.obsPort);
  if (typeof input.syncWithObs === 'boolean') settings.syncWithObs = input.syncWithObs;
  return settings;
}

// Busca una escena de OBS cuyo nombre contenga "cam N", "camN" o "camera N".
export function findSceneForCamera(scenes, cam) {
  const id = String(cam).toLowerCase();
  return (
    scenes.find((scene) => {
      const name = scene.toLowerCase();
      return name.includes(`cam ${id}`) || name.includes(`cam${id}`) || name.includes(`camera ${id}`);
    }) ?? null
  );
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

export class StudioController {
  #tenveo;
  #obs;
  #emitter = new Emitter();
  #settings;
  #obsPassword;
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
    toggleObsSync: () => this.#updateSettings({ syncWithObs: !this.#settings.syncWithObs }),
    obsToggleStream: () => this.#obs.toggleStream(),
    obsToggleRecord: () => this.#obs.toggleRecord(),
    obsToggleVirtualCam: () => this.#obs.toggleVirtualCam(),
    obsSetScene: (sceneName) => this.#obs.setScene(String(sceneName)),
    saveSettings: (input) => this.saveSettings(input),
    retryHardware: () => this.#tenveo.retry(),
    retryObs: () => this.#obs.retry(),
  };

  constructor({ tenveo, obs, settings = {}, obsPassword = '', persist = () => {}, extras = {} }) {
    this.#tenveo = tenveo;
    this.#obs = obs;
    this.#settings = normalizeSettings(settings);
    this.#obsPassword = String(obsPassword ?? '');
    this.#persist = persist;
    this.#extras = { ...extras };
  }

  get settings() {
    return { ...this.#settings };
  }

  get obsPassword() {
    return this.#obsPassword;
  }

  start() {
    let lastPgm = this.#tenveo.state.pgm;
    this.#unsubscribers.push(
      this.#tenveo.onChange((state) => {
        const pgmChanged = state.pgm !== lastPgm;
        lastPgm = state.pgm;
        // Sin dato de qué cámara está al aire no se toca OBS.
        if (pgmChanged && state.pgm && this.#settings.syncWithObs && this.#obs.isConnected) {
          this.syncObsScene(state.pgm);
        }
        this.#notify();
      }),
    );
    this.#unsubscribers.push(this.#obs.onChange(() => this.#notify()));

    this.#tenveo.setEthernetIp(this.#settings.ethernetIp);
    this.#tenveo.start();
    this.#obs.configure({
      host: this.#settings.obsHost,
      port: this.#settings.obsPort,
      password: this.#obsPassword,
    });
    this.#obs.start();
  }

  stop() {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    this.#tenveo.stop();
    this.#obs.stop();
  }

  onChange(listener) {
    return this.#emitter.subscribe(listener);
  }

  // Datos extra que no vienen de los servicios, como el estado del puente ADB.
  setExtra(key, value) {
    this.#extras = { ...this.#extras, [key]: value };
    this.#notify();
  }

  snapshot() {
    const { raw, ...switcher } = this.#tenveo.state;
    return {
      switcher,
      obs: this.#obs.state,
      settings: { ...this.#settings, hasObsPassword: this.#obsPassword.length > 0 },
      extras: this.#extras,
    };
  }

  dispatch(type, ...args) {
    const handler = Object.hasOwn(this.#commands, type) ? this.#commands[type] : null;
    if (!handler) throw new Error(`Comando desconocido: ${type}`);
    return handler(...args);
  }

  syncObsScene(cam) {
    const match = findSceneForCamera(this.#obs.state.scenes, cam);
    if (match) this.#obs.setScene(match);
    return match;
  }

  // Guarda la configuración del diálogo y reconecta lo que haga falta.
  // obsPassword vacío deja la contraseña como estaba; clearObsPassword la borra.
  saveSettings({ ethernetIp, obsHost, obsPort, obsPassword, clearObsPassword } = {}) {
    const next = { ...this.#settings };

    if (ethernetIp !== undefined) {
      const ip = String(ethernetIp ?? '').trim();
      if (ip && !isValidHost(ip)) throw new Error(`IP no válida: ${ip}`);
      next.ethernetIp = ip;
    }
    if (obsHost !== undefined) {
      const host = String(obsHost ?? '').trim() || DEFAULT_SETTINGS.obsHost;
      if (!isValidHost(host)) throw new Error(`Dirección de OBS no válida: ${host}`);
      next.obsHost = host;
    }
    if (obsPort !== undefined) {
      const port = Number(obsPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Puerto de OBS no válido: ${obsPort}`);
      next.obsPort = port;
    }

    let passwordChanged = false;
    if (clearObsPassword) {
      passwordChanged = this.#obsPassword !== '';
      this.#obsPassword = '';
    } else if (typeof obsPassword === 'string' && obsPassword.length > 0) {
      passwordChanged = obsPassword !== this.#obsPassword;
      this.#obsPassword = obsPassword;
    }

    this.#settings = next;
    this.#persist(this.#settings, passwordChanged ? this.#obsPassword : undefined);

    this.#tenveo.setEthernetIp(next.ethernetIp);
    this.#tenveo.retry();
    this.#obs.configure({ host: next.obsHost, port: next.obsPort, password: this.#obsPassword });
    this.#obs.retry();
    this.#notify();
    return this.snapshot().settings;
  }

  #updateSettings(patch) {
    this.#settings = { ...this.#settings, ...patch };
    this.#persist(this.#settings, undefined);
    this.#notify();
    return this.snapshot().settings;
  }

  #notify() {
    this.#emitter.emit(this.snapshot());
  }
}
