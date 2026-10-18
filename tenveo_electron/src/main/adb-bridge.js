// Video del PC500 por adb en red.
//
// El servidor de video del PC500 (RTMP en el 1935) escucha solo por IPv4. Por
// un cable directo, la Mac solo le habla por IPv6 de enlace local, así que la
// app se conecta al adb del equipo por red (puerto 5555) y reenvía su 1935 al
// 19350 de esta Mac. Al salir quita el reenvío y se desconecta.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// El servidor RTMP del equipo queda en el 19350 de esta Mac.
export const RTMP_FORWARD_PORT = 19350;

export const ADB_NETWORK_PORT = 5555;

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

// Corre adb con un límite de tiempo que se cumple siempre. Es pública para
// poder probarla.
export function runFile(file, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      settle(value);
    };
    const child = execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) finish(reject, new Error(String(stderr || error.message).trim()));
      else finish(resolve, { stdout: String(stdout), stderr: String(stderr) });
    });
    // Un adb trabado dentro del sistema puede no terminar nunca, ni con SIGKILL:
    // el puente no se queda esperándolo.
    const guard = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ya había terminado.
      }
      finish(reject, new Error('adb no respondió'));
    }, timeoutMs + 1000);
  });
}

export class AdbBridge extends EventEmitter {
  #adbPath;
  #findOptions;
  #finder;
  #run;
  #pollMs;
  #refreshEvery;
  #timer = null;
  #running = false;
  #ticks = 0;
  #target = '';
  #forwarded = null;
  #owned = null;
  #retryAt = 0;
  #lastServerRestart = 0;
  #hung = 0; // veces seguidas que adb no respondió
  #status = { state: 'idle', adbPath: null, rtmpForwarded: false, message: '' };

  constructor({ adbPath = null, findOptions = {}, finder = findAdb, run = runFile, pollMs = 3000, refreshEvery = 5 } = {}) {
    super();
    this.#adbPath = adbPath;
    this.#findOptions = findOptions;
    this.#finder = finder;
    this.#run = run;
    this.#pollMs = pollMs;
    this.#refreshEvery = refreshEvery;
  }

  get status() {
    return this.#status;
  }

  // Dirección del PC500 (IPv4 o IPv6 de enlace local), o '' para no usar adb.
  // Se aplica en la próxima revisión.
  setNetworkTarget(host) {
    this.#target = host ? adbNetworkSerial(host) : '';
  }

  async start() {
    if (this.#running) return;
    this.#running = true;
    this.#setStatus({ state: 'starting', message: 'Buscando adb…' });
    if (!this.#adbPath) this.#adbPath = await this.#finder(this.#findOptions);
    if (!this.#running) return;
    if (!this.#adbPath) {
      this.#setStatus({ state: 'no-adb', message: 'No se encontró adb. Instálalo con: brew install android-platform-tools' });
      return;
    }
    this.#setStatus({ state: 'off', message: '' });
    await this.#loop();
  }

  async stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    await this.#release();
    this.#setStatus({ state: 'stopped', message: '' });
  }

  // Revisa una vez. Es pública para poder probarla.
  async tick() {
    this.#ticks += 1;
    const wanted = this.#target;
    const stale = (serial) => serial && serial !== wanted;
    if (stale(this.#forwarded) || stale(this.#owned)) await this.#release();
    if (!wanted) {
      if (this.#status.state !== 'off') this.#setStatus({ state: 'off', message: '' });
      return;
    }

    const { stdout } = await this.#run(this.#adbPath, ['devices', '-l']);
    if (!this.#running) return;
    let device = parseAdbDevices(stdout).find((d) => d.serial === wanted);
    if (device?.state !== 'device') {
      this.#forwarded = null;
      // Tras un fallo se espera unas vueltas antes de volver a intentar.
      if (this.#ticks < this.#retryAt) return;
      this.#setStatus({ state: 'connecting', message: 'Conectando con el video del PC500…' });
      const fail = (state, message) => {
        this.#retryAt = this.#ticks + 5;
        this.#setStatus({ state, message });
      };
      try {
        let { stdout: answer } = await this.#run(this.#adbPath, ['connect', wanted], 8000);
        // Si el cable o el PC500 se reiniciaron, el servidor de adb puede quedar
        // con la ruta vieja ("No route to host"): se reinicia y se prueba otra vez.
        if (/no route to host|network is unreachable/i.test(answer) && Date.now() - this.#lastServerRestart > 60000) {
          this.#lastServerRestart = Date.now();
          await this.#run(this.#adbPath, ['kill-server']).catch(() => {});
          ({ stdout: answer } = await this.#run(this.#adbPath, ['connect', wanted], 8000));
        }
        if (!/connected to/i.test(answer)) throw new Error(answer.trim() || 'sin respuesta');
        // Si ya estaba conectado lo dejó otro programa: al salir no se desconecta.
        if (!/already connected/i.test(answer)) this.#owned = wanted;
        const { stdout: list } = await this.#run(this.#adbPath, ['devices', '-l']);
        device = parseAdbDevices(list).find((d) => d.serial === wanted);
      } catch (error) {
        fail('error', `No se pudo abrir el video por adb en red: ${error.message}`);
        return;
      }
      if (device?.state !== 'device') {
        if (device?.state === 'unauthorized') fail('unauthorized', 'El PC500 pide autorizar adb por red.');
        else fail('error', 'El PC500 no aceptó adb por red.');
        return;
      }
    }
    if (!this.#running) return;
    const refresh = this.#ticks % this.#refreshEvery === 0;
    if (this.#forwarded === wanted && !refresh) return;
    try {
      await this.#run(this.#adbPath, ['-s', wanted, 'forward', `tcp:${RTMP_FORWARD_PORT}`, 'tcp:1935']);
      this.#forwarded = wanted;
      this.#setStatus({ state: 'ready', message: 'Video por adb en red' });
    } catch (error) {
      this.#forwarded = null;
      this.#setStatus({ state: 'error', message: `No se pudo reenviar el video por adb en red: ${error.message}` });
    }
  }

  async #release() {
    const forwarded = this.#forwarded;
    const owned = this.#owned;
    this.#forwarded = null;
    this.#owned = null;
    this.#retryAt = 0;
    // Con adb trabado, cada comando quedaría colgado: no se intenta limpiar.
    if (!this.#adbPath || this.#hung > 0) return;
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
    let wait = this.#pollMs;
    try {
      await this.tick();
      this.#hung = 0;
    } catch (error) {
      const message = String(error?.message ?? error);
      if (/no respondió/.test(message)) {
        // adb trabado dentro del sistema: cada intento deja otro proceso
        // colgado, así que se espera cada vez más (hasta 5 minutos).
        this.#hung += 1;
        wait = Math.min(300000, this.#pollMs * 10 * 2 ** (this.#hung - 1));
        if (this.#running) {
          this.#forwarded = null;
          this.#setStatus({
            state: 'error',
            message: 'adb no responde (se quedó trabado en esta Mac; se arregla al reiniciarla). Para el video por cable directo, pon en la Mac una IP de la red del PC500.',
          });
        }
      } else if (this.#running) {
        this.#setStatus({ state: 'error', message });
      }
    }
    if (this.#running) this.#timer = setTimeout(() => this.#loop(), wait);
  }

  // Cuánto espera el puente antes de la próxima revisión (para las pruebas).
  get nextWaitMs() {
    return this.#hung ? Math.min(300000, this.#pollMs * 10 * 2 ** (this.#hung - 1)) : this.#pollMs;
  }

  #setStatus(patch) {
    const next = { ...this.#status, ...patch, adbPath: this.#adbPath, rtmpForwarded: this.#forwarded !== null };
    if (JSON.stringify(next) === JSON.stringify(this.#status)) return;
    this.#status = next;
    this.emit('status', next);
  }
}
