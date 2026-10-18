// Mide la comunicación con el PC500: la versión anterior (código del commit
// indicado, por defecto 12382e4, Tenveo Studio 1.0.0) contra la actual, con el
// mismo simulador y las mismas pruebas.
//
// Uso:
//   node scripts/bench-network.mjs
//   node scripts/bench-network.mjs --equipo fe80::…%en0   también con el PC500 real
//   node scripts/bench-network.mjs --json resultados.json
//
// Con el equipo real solo se cambia el Preview (no sale al aire) y se deja la
// cámara que estaba.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMockPc500 } from '../dev/mock-pc500.js';
import { CAMERAS } from '../src/core/pc500-protocol.js';
import { TenveoService } from '../src/core/tenveo-service.js';
import { LowLatencyWebSocket } from '../src/main/net-websocket.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : '';
};
const commit = arg('--commit') || '12382e4';
const device = arg('--equipo');
const jsonOut = arg('--json');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Código de la versión anterior, sacado de git ---

async function loadOldService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-bench-'));
  const git = (...args) => execFileSync('git', ['-C', projectDir, ...args], { encoding: 'utf8' }).trim();
  const top = git('rev-parse', '--show-toplevel');
  const prefix = git('rev-parse', '--show-prefix');
  const tar = execFileSync('git', ['-C', top, 'archive', `${commit}:${prefix}src/core`], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  const module = await import(pathToFileURL(path.join(dir, 'tenveo-service.js')).href);
  return { OldService: module.TenveoService, dir };
}

// Como en cada versión de la app: la anterior usaba el WebSocket de Node (y su
// ruta USB apuntada a la dirección) y la actual usa LowLatencyWebSocket por red.
function currentService(url, extra = {}) {
  const { hostname, port } = new URL(url);
  const service = new TenveoService({ ethernetPort: Number(port), WebSocketImpl: LowLatencyWebSocket, ...extra });
  service.setEthernetIp(hostname);
  return service;
}

const versions = (OldService) => [
  { name: 'anterior', create: (url, extra = {}) => new OldService({ usbUrl: url, ...extra }) },
  { name: 'actual', create: currentService },
];

// --- Utilidades ---

const connected = (s) => s.connection === 'usb' || s.connection === 'ethernet';

function waitFor(service, predicate, timeoutMs) {
  return new Promise((resolve) => {
    if (predicate(service.state)) return resolve(true);
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = service.onChange((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: values.length, mediana: pick(0.5), p90: pick(0.9), p99: pick(0.99), max: sorted.at(-1) };
}

const ms = (value) => (value === null || value === undefined ? '—' : value < 10 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`);

// Proxy TCP entre la app y el equipo, para simular cortes.
//   freeze(): las conexiones abiertas dejan de pasar datos sin cerrarse, como
//             un cable desenchufado o un equipo apagado de golpe.
//   setDown(true): rechaza conexiones nuevas (equipo reiniciando).
async function startProxy(host, port) {
  const pairs = new Set();
  let down = false;
  const server = net.createServer((client) => {
    if (down) {
      client.destroy();
      return;
    }
    const upstream = net.connect({ host, port });
    const pair = { client, upstream, frozen: false };
    pairs.add(pair);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    client.on('data', (data) => {
      if (!pair.frozen) upstream.write(data);
    });
    upstream.on('data', (data) => {
      if (!pair.frozen) client.write(data);
    });
    const end = () => {
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on('close', end);
    upstream.on('close', end);
    client.on('error', () => {});
    upstream.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    freeze: () => {
      for (const pair of pairs) pair.frozen = true;
    },
    drop: () => {
      for (const pair of [...pairs]) pair.client.resetAndDestroy();
    },
    setDown: (value) => {
      down = value;
    },
    close: () => {
      for (const pair of [...pairs]) pair.client.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// --- Pruebas ---

async function connectTime(version, url, rounds = 15) {
  const times = [];
  for (let i = 0; i < rounds; i += 1) {
    const service = version.create(url);
    const started = performance.now();
    service.start();
    const ok = await waitFor(service, (s) => connected(s) && Boolean(s.pgm), 5000);
    if (ok) times.push(performance.now() - started);
    service.stop();
    await delay(30);
  }
  return stats(times);
}

async function commandLatency(service, rounds) {
  const original = service.state.pvw;
  const other = CAMERAS.map((c) => c.id).find((id) => id !== original && id !== service.state.pgm);
  const times = [];
  for (let i = 0; i < rounds; i += 1) {
    const target = i % 2 === 0 ? other : original;
    const sent = performance.now();
    service.selectPreview(target);
    if (await waitFor(service, (s) => s.pvw === target, 3000)) times.push(performance.now() - sent);
  }
  if (service.state.pvw !== original) {
    service.selectPreview(original);
    await waitFor(service, (s) => s.pvw === original, 3000);
  }
  return { ...stats(times), restored: service.state.pvw === original };
}

// Cable cortado sin aviso: ¿cuánto tarda la app en darse cuenta y volver?
async function deadLink(version, mockPort, capMs = 20000) {
  const proxy = await startProxy('127.0.0.1', mockPort);
  const service = version.create(proxy.url);
  service.start();
  await waitFor(service, connected, 5000);
  await delay(1500);
  const cut = performance.now();
  proxy.freeze();
  const noticed = await waitFor(service, (s) => !connected(s), capMs);
  const noticedMs = noticed ? performance.now() - cut : null;
  // Las conexiones nuevas sí pasan: el equipo "volvió" en otra conexión.
  const back = noticed ? await waitFor(service, connected, capMs) : false;
  const backMs = back ? performance.now() - cut : null;
  service.stop();
  await proxy.close();
  return { noticedMs, backMs, capMs };
}

// Equipo reiniciado: corta la conexión, rechaza conexiones un rato y vuelve.
// Cortes de distinta duración, desde un servicio que reinicia en medio segundo
// hasta un equipo que tarda varios segundos.
const DOWN_MS = [500, 1200, 2700, 3300, 4800, 6400];

async function restart(version, mockPort) {
  const proxy = await startProxy('127.0.0.1', mockPort);
  const service = version.create(proxy.url);
  service.start();
  await waitFor(service, connected, 5000);
  const times = [];
  for (const downMs of DOWN_MS) {
    proxy.setDown(true);
    proxy.drop();
    await waitFor(service, (s) => !connected(s), 3000);
    await delay(downMs);
    proxy.setDown(false);
    const back = performance.now();
    if (await waitFor(service, connected, 15000)) times.push(performance.now() - back);
  }
  service.stop();
  await proxy.close();
  return stats(times);
}

// --- Equipo real ---

async function realDevice(OldService, address) {
  const result = { address };
  // La versión anterior no acepta la dirección del cable directo.
  const old = new OldService({ usbUrl: 'ws://127.0.0.1:1', ethernetPort: 8089, retryMs: 60000 });
  old.start();
  old.setEthernetIp(address);
  await waitFor(old, (s) => connected(s) || Boolean(s.lastError), 6000);
  result.oldDirect = connected(old.state) ? 'conectó' : old.state.lastError || 'no conectó';
  old.stop();

  // Las dos versiones por un proxy local, para comparar el mando en igualdad.
  const proxy = await startProxy(address, 8089);
  for (const version of versions(OldService)) {
    const service = version.create(proxy.url);
    service.start();
    if (await waitFor(service, (s) => connected(s) && Boolean(s.pvw), 8000)) {
      await delay(500);
      result[version.name] = await commandLatency(service, 20);
    } else {
      result[version.name] = null;
    }
    service.stop();
    await delay(300);
  }
  await proxy.close();

  // La actual, directa por IPv6 de enlace local, como la usa la app.
  const direct = new TenveoService({ WebSocketImpl: LowLatencyWebSocket, heartbeatMs: 500 });
  const started = performance.now();
  direct.setEthernetIp(address);
  direct.start();
  if (await waitFor(direct, (s) => connected(s) && Boolean(s.pvw), 8000)) {
    result.directConnectMs = performance.now() - started;
    const pings = [];
    const unsubscribe = direct.onChange((s) => Number.isFinite(s.latencyMs) && pings.push(s.latencyMs));
    await delay(3000);
    unsubscribe();
    result.directPing = stats(pings);
    result.direct = await commandLatency(direct, 20);
  }
  direct.stop();
  return result;
}

// --- Principal ---

const { OldService, dir } = await loadOldService();
const mock = await startMockPc500();
const url = `ws://127.0.0.1:${mock.port}`;
const results = { commit, fecha: new Date().toISOString(), simulador: {} };

for (const version of versions(OldService)) {
  console.log(`Midiendo la versión ${version.name}…`);
  const service = version.create(url);
  service.start();
  await waitFor(service, (s) => connected(s) && Boolean(s.pvw), 5000);
  await delay(300);
  const command = await commandLatency(service, 300);
  service.stop();
  results.simulador[version.name] = {
    conexion: await connectTime(version, url),
    mando: command,
    corteSinAviso: await deadLink(version, mock.port),
    reinicio: await restart(version, mock.port),
  };
}
if (device) {
  console.log('Midiendo con el PC500 real…');
  results.equipo = await realDevice(OldService, device);
}
await mock.close();
await fs.rm(dir, { recursive: true, force: true });

const [a, b] = ['anterior', 'actual'].map((name) => results.simulador[name]);
const deadText = (d) => (d.noticedMs === null ? `no se entera (> ${d.capMs / 1000} s)` : ms(d.noticedMs));
const backText = (d) => (d.backMs === null ? 'no vuelve' : ms(d.backMs));
const rows = [
  ['Conexión hasta tener el estado (mediana)', ms(a.conexion?.mediana), ms(b.conexion?.mediana)],
  ['Mando → confirmación (mediana)', ms(a.mando?.mediana), ms(b.mando?.mediana)],
  ['Mando → confirmación (p99)', ms(a.mando?.p99), ms(b.mando?.p99)],
  ['Cable cortado sin aviso: se da cuenta en', deadText(a.corteSinAviso), deadText(b.corteSinAviso)],
  ['Cable cortado sin aviso: vuelve a estar conectado en', backText(a.corteSinAviso), backText(b.corteSinAviso)],
  ['Equipo reiniciado: reconecta tras volver (mediana)', ms(a.reinicio?.mediana), ms(b.reinicio?.mediana)],
  ['Equipo reiniciado: reconecta tras volver (peor caso)', ms(a.reinicio?.max), ms(b.reinicio?.max)],
];
if (results.equipo) {
  const e = results.equipo;
  rows.push(
    ['PC500 real por cable directo (IPv6)', e.oldDirect, e.directConnectMs ? `conecta en ${ms(e.directConnectMs)}` : 'no conectó'],
    ['PC500 real: mando → confirmación por proxy (mediana)', ms(e.anterior?.mediana), ms(e.actual?.mediana)],
    ['PC500 real: mando → confirmación directo (mediana / p90)', '—', e.direct ? `${ms(e.direct.mediana)} / ${ms(e.direct.p90)}` : '—'],
    ['PC500 real: ping (mediana)', 'no mide', ms(e.directPing?.mediana)],
  );
}
const width = Math.max(...rows.map((r) => r[0].length));
console.log(`\n${'Prueba'.padEnd(width)} | Anterior (${commit}) | Actual`);
for (const [name, before, after] of rows) console.log(`${name.padEnd(width)} | ${before} | ${after}`);
if (jsonOut) await fs.writeFile(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
process.exit(0);
