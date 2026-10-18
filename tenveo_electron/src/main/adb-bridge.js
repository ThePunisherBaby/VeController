// Puente USB con el PC500 por ADB (reemplaza a tenveo_bridge.py dentro de la app).
//
// Cada pocos segundos revisa "adb devices". Cuando aparece el equipo, reenvía
// su WebSocket (8089) y su panel web (80) a esta Mac. Al salir quita los
// reenvíos que creó.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_FORWARDS = Object.freeze([
  Object.freeze({ name: 'websocket', local: 'tcp:8089', remote: 'tcp:8089', required: true }),
  Object.freeze({ name: 'panel', local: 'tcp:8080', remote: 'tcp:80', required: false }),
]);

// Interpreta la salida de "adb devices -l".
export function parseAdbDevices(stdout) {
  const devices = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('List of devices') || text.startsWith('*')) continue;
    const match = /^(\S+)\s+(\S+)(.*)$/.exec(text);
    if (!match) continue;
    const [, serial, state, rest] = match;
    const props = {};
    for (const prop of rest.matchAll(/([a-z_]+):(\S+)/g)) props[prop[1]] = prop[2];
    devices.push({ serial, state, model: props.model ?? '', product: props.product ?? '' });
  }
  return devices;
}

// Prefiere un equipo real conectado antes que un emulador de Android.
export function pickDevice(devices) {
  const ready = devices.filter((d) => d.state === 'device');
  return ready.find((d) => !d.serial.startsWith('emulator-')) ?? ready[0] ?? null;
}

export function adbCandidates({ env = process.env, resourcesPath = null, vendorDir = null, home = os.homedir() } = {}) {
  const list = [];
  if (env.TENVEO_ADB) list.push(env.TENVEO_ADB);
  if (resourcesPath) list.push(path.join(resourcesPath, 'platform-tools', 'adb'));
  if (vendorDir) list.push(path.join(vendorDir, 'platform-tools', 'adb'));
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (env[key]) list.push(path.join(env[key], 'platform-tools', 'adb'));
  }
  list.push(
    path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  );
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
    if (dir) list.push(path.join(dir, 'adb'));
  }
  return [...new Set(list)];
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Una app abierta desde el Finder no hereda el PATH de la terminal, así que
// también se le pregunta al shell de inicio del usuario.
export function findAdbInLoginShell({ shell = process.env.SHELL || '/bin/zsh', timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'command -v adb'], { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const found = String(stdout)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .reverse()
        .find((l) => l.startsWith('/') && l.endsWith('/adb'));
      resolve(found && isExecutable(found) ? found : null);
    });
  });
}

export async function findAdb(options = {}) {
  for (const candidate of adbCandidates(options)) {
    if (isExecutable(candidate)) return candidate;
  }
  return findAdbInLoginShell(options);
}

function runFile(file, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim()));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export class AdbBridge extends EventEmitter {
  #adbPath;
  #findOptions;
  #finder;
  #run;
  #pollMs;
  #refreshEvery;
  #forwards;
  #timer = null;
  #running = false;
  #ticks = 0;
  #forwardedSerial = null;
  #status = { state: 'idle', adbPath: null, serial: '', model: '', panelForwarded: false, message: '' };

  constructor({
    adbPath = null,
    findOptions = {},
    finder = findAdb,
    run = runFile,
    pollMs = 3000,
    refreshEvery = 5,
    forwards = DEFAULT_FORWARDS,
  } = {}) {
    super();
    this.#adbPath = adbPath;
    this.#findOptions = findOptions;
    this.#finder = finder;
    this.#run = run;
    this.#pollMs = pollMs;
    this.#refreshEvery = refreshEvery;
    this.#forwards = forwards;
  }

  get status() {
    return this.#status;
  }

  async start() {
    if (this.#running) return;
    this.#running = true;
    this.#setStatus({ state: 'starting', message: 'Buscando adb…' });
    if (!this.#adbPath) this.#adbPath = await this.#finder(this.#findOptions);
    if (!this.#running) return;
    if (!this.#adbPath) {
      this.#setStatus({
        state: 'no-adb',
        message: 'No se encontró adb. Instálalo con: brew install android-platform-tools',
      });
      return;
    }
    await this.#loop();
  }

  async stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    const serial = this.#forwardedSerial;
    this.#forwardedSerial = null;
    if (this.#adbPath && serial) {
      for (const forward of this.#forwards) {
        try {
          await this.#run(this.#adbPath, ['-s', serial, 'forward', '--remove', forward.local]);
        } catch {
          // El reenvío ya no existía.
        }
      }
    }
    this.#setStatus({ state: 'stopped', serial: '', model: '', panelForwarded: false, message: '' });
  }

  // Revisa los equipos una vez. Es pública para poder probarla.
  async tick() {
    this.#ticks += 1;
    const { stdout } = await this.#run(this.#adbPath, ['devices', '-l']);
    if (!this.#running) return;
    const devices = parseAdbDevices(stdout);
    const target = pickDevice(devices);

    if (!target) {
      this.#forwardedSerial = null;
      const unauthorized = devices.find((d) => d.state === 'unauthorized');
      const offline = devices.find((d) => d.state === 'offline');
      if (unauthorized) {
        this.#setStatus({ state: 'unauthorized', serial: unauthorized.serial, model: '', panelForwarded: false, message: 'El equipo pide autorizar la conexión USB.' });
      } else if (offline) {
        this.#setStatus({ state: 'offline', serial: offline.serial, model: '', panelForwarded: false, message: 'El equipo aparece desconectado en adb.' });
      } else {
        this.#setStatus({ state: 'waiting', serial: '', model: '', panelForwarded: false, message: 'Esperando el PC500 por USB…' });
      }
      return;
    }

    const refresh = this.#ticks % this.#refreshEvery === 0;
    if (this.#forwardedSerial === target.serial && !refresh) return;

    let panelForwarded = false;
    for (const forward of this.#forwards) {
      try {
        await this.#run(this.#adbPath, ['-s', target.serial, 'forward', forward.local, forward.remote]);
        if (forward.name === 'panel') panelForwarded = true;
      } catch (error) {
        if (forward.required) {
          this.#forwardedSerial = null;
          throw new Error(`No se pudo reenviar ${forward.local}: ${error.message}`);
        }
      }
      if (!this.#running) return;
    }

    this.#forwardedSerial = target.serial;
    this.#setStatus({
      state: 'forwarded',
      serial: target.serial,
      model: target.model,
      panelForwarded,
      message: `USB activo con ${target.model || target.serial}`,
    });
  }

  async #loop() {
    if (!this.#running) return;
    try {
      await this.tick();
    } catch (error) {
      if (this.#running) this.#setStatus({ state: 'error', panelForwarded: false, message: String(error?.message ?? error) });
    }
    if (this.#running) this.#timer = setTimeout(() => this.#loop(), this.#pollMs);
  }

  #setStatus(patch) {
    const next = { ...this.#status, ...patch, adbPath: this.#adbPath };
    if (JSON.stringify(next) === JSON.stringify(this.#status)) return;
    this.#status = next;
    this.emit('status', next);
  }
}
