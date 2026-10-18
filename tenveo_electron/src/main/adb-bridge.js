// Puente USB con el PC500 por ADB (reemplaza a tenveo_bridge.py dentro de la app).
//
// Cada pocos segundos revisa "adb devices". Cuando aparece el equipo, reenvía
// su WebSocket (8089), su panel web (80) y su servidor RTMP (1935) a esta Mac.
// Al salir quita los reenvíos que creó.
//
// El PC500 también acepta adb por red (puerto 5555). Sin USB, si se le indica
// la dirección del equipo, el puente se conecta por red y reenvía solo el RTMP:
// el servidor de video del PC500 escucha solo por IPv4, y así llega igual por
// un cable directo (IPv6 de enlace local) sin configurar la red de la Mac.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// El servidor RTMP del equipo se reenvía al 19350, no al 1935, para no chocar
// con el servidor RTMP de la propia app.
export const RTMP_FORWARD_PORT = 19350;

export const ADB_NETWORK_PORT = 5555;

export const DEFAULT_FORWARDS = Object.freeze([
  Object.freeze({ name: 'websocket', local: 'tcp:8089', remote: 'tcp:8089', required: true }),
  Object.freeze({ name: 'panel', local: 'tcp:8080', remote: 'tcp:80', required: false }),
  Object.freeze({ name: 'rtmp', local: `tcp:${RTMP_FORWARD_PORT}`, remote: 'tcp:1935', required: false }),
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

// Los equipos conectados por red aparecen como host:puerto (o por mDNS).
export function isNetworkSerial(serial) {
  return /:\d+$/.test(String(serial)) || String(serial).includes('._adb');
}

export function adbNetworkSerial(host) {
  return String(host).includes(':') ? `[${host}]:${ADB_NETWORK_PORT}` : `${host}:${ADB_NETWORK_PORT}`;
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
  #usbRtmp = false;
  #networkTarget = '';
  #networkSerial = null;
  #networkOwned = null;
  #networkRetryAt = 0;
  #status = {
    state: 'idle',
    adbPath: null,
    serial: '',
    model: '',
    panelForwarded: false,
    rtmpForwarded: false,
    rtmpVia: '',
    network: { state: 'off', message: '' },
    message: '',
  };

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

  // Dirección del PC500 para llegar por adb en red, o '' para no usarlo. Se
  // aplica en la próxima revisión.
  setNetworkTarget(host) {
    this.#networkTarget = host ? adbNetworkSerial(host) : '';
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
    this.#usbRtmp = false;
    if (this.#adbPath && serial) {
      for (const forward of this.#forwards) {
        try {
          await this.#run(this.#adbPath, ['-s', serial, 'forward', '--remove', forward.local]);
        } catch {
          // El reenvío ya no existía.
        }
      }
    }
    await this.#releaseNetwork();
    this.#setStatus({ state: 'stopped', serial: '', model: '', panelForwarded: false, network: { state: 'off', message: '' }, message: '' });
  }

  // Revisa los equipos una vez. Es pública para poder probarla.
  async tick() {
    this.#ticks += 1;
    const { stdout } = await this.#run(this.#adbPath, ['devices', '-l']);
    if (!this.#running) return;
    const devices = parseAdbDevices(stdout);
    const usbDevices = devices.filter((d) => !isNetworkSerial(d.serial));
    const target = pickDevice(usbDevices);
    const refresh = this.#ticks % this.#refreshEvery === 0;

    // Con USB no hace falta la red: el USB ya reenvía el RTMP.
    await this.#syncNetwork(target ? '' : this.#networkTarget, devices, refresh);
    if (!this.#running) return;

    if (!target) {
      this.#forwardedSerial = null;
      this.#usbRtmp = false;
      const unauthorized = usbDevices.find((d) => d.state === 'unauthorized');
      const offline = usbDevices.find((d) => d.state === 'offline');
      if (unauthorized) {
        this.#setStatus({ state: 'unauthorized', serial: unauthorized.serial, model: '', panelForwarded: false, message: 'El equipo pide autorizar la conexión USB.' });
      } else if (offline) {
        this.#setStatus({ state: 'offline', serial: offline.serial, model: '', panelForwarded: false, message: 'El equipo aparece desconectado en adb.' });
      } else {
        this.#setStatus({ state: 'waiting', serial: '', model: '', panelForwarded: false, message: 'Esperando el PC500 por USB…' });
      }
      return;
    }

    if (this.#forwardedSerial === target.serial && !refresh) return;

    let panelForwarded = false;
    let rtmpForwarded = false;
    for (const forward of this.#forwards) {
      try {
        await this.#run(this.#adbPath, ['-s', target.serial, 'forward', forward.local, forward.remote]);
        if (forward.name === 'panel') panelForwarded = true;
        if (forward.name === 'rtmp') rtmpForwarded = true;
      } catch (error) {
        if (forward.required) {
          this.#forwardedSerial = null;
          throw new Error(`No se pudo reenviar ${forward.local}: ${error.message}`);
        }
      }
      if (!this.#running) return;
    }

    this.#forwardedSerial = target.serial;
    this.#usbRtmp = rtmpForwarded;
    this.#setStatus({
      state: 'forwarded',
      serial: target.serial,
      model: target.model,
      panelForwarded,
      message: `USB activo con ${target.model || target.serial}`,
    });
  }

  // Conecta adb por red con el equipo pedido y reenvía su RTMP.
  async #syncNetwork(wanted, devices, refresh) {
    const stale = (serial) => serial && serial !== wanted;
    if (stale(this.#networkSerial) || stale(this.#networkOwned)) await this.#releaseNetwork();
    if (!wanted) {
      if (this.#status.network.state !== 'off') this.#setStatus({ network: { state: 'off', message: '' } });
      return;
    }
    let device = devices.find((d) => d.serial === wanted);
    if (device?.state !== 'device') {
      this.#networkSerial = null;
      // Tras un fallo se espera unas vueltas antes de volver a intentar.
      if (this.#ticks < this.#networkRetryAt) return;
      this.#setStatus({ network: { state: 'connecting', message: 'Conectando adb por red con el PC500…' } });
      const fail = (state, message) => {
        this.#networkRetryAt = this.#ticks + 5;
        this.#setStatus({ network: { state, message } });
      };
      try {
        const { stdout } = await this.#run(this.#adbPath, ['connect', wanted], 8000);
        if (!/connected to/i.test(stdout)) throw new Error(stdout.trim() || 'sin respuesta');
        // Si ya estaba conectado lo dejó otro programa: al salir no se desconecta.
        if (!/already connected/i.test(stdout)) this.#networkOwned = wanted;
        const { stdout: list } = await this.#run(this.#adbPath, ['devices', '-l']);
        device = parseAdbDevices(list).find((d) => d.serial === wanted);
      } catch (error) {
        fail('error', `No se pudo usar adb por red: ${error.message}`);
        return;
      }
      if (device?.state !== 'device') {
        if (device?.state === 'unauthorized') fail('unauthorized', 'El PC500 pide autorizar adb por red.');
        else fail('error', 'El PC500 no aceptó adb por red.');
        return;
      }
    }
    if (this.#networkSerial === wanted && !refresh) return;
    try {
      await this.#run(this.#adbPath, ['-s', wanted, 'forward', `tcp:${RTMP_FORWARD_PORT}`, 'tcp:1935']);
      this.#networkSerial = wanted;
      this.#setStatus({ network: { state: 'ready', message: 'Video por adb en red' } });
    } catch (error) {
      this.#networkSerial = null;
      this.#setStatus({ network: { state: 'error', message: `No se pudo reenviar el video por adb en red: ${error.message}` } });
    }
  }

  async #releaseNetwork() {
    const forwarded = this.#networkSerial;
    const owned = this.#networkOwned;
    this.#networkSerial = null;
    this.#networkOwned = null;
    this.#networkRetryAt = 0;
    if (!this.#adbPath) return;
    if (forwarded) {
      try {
        await this.#run(this.#adbPath, ['-s', forwarded, 'forward', '--remove', `tcp:${RTMP_FORWARD_PORT}`]);
      } catch {
        // El reenvío ya no existía.
      }
    }
    if (owned) {
      try {
        await this.#run(this.#adbPath, ['disconnect', owned]);
      } catch {
        // Ya estaba desconectado.
      }
    }
    this.#setStatus({});
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
    // El RTMP del equipo llega por USB si lo hay, si no por adb en red.
    next.rtmpVia = this.#usbRtmp ? 'usb' : this.#networkSerial ? 'network' : '';
    next.rtmpForwarded = next.rtmpVia !== '';
    if (JSON.stringify(next) === JSON.stringify(this.#status)) return;
    this.#status = next;
    this.emit('status', next);
  }
}
