// Busca el PC500 en la red local.
//
// Dos caminos a la vez:
//   - IPv4: recorre la subred de cada interfaz de la Mac (como máximo una /24).
//   - IPv6 de enlace local: un ping a todos los equipos del enlace (ff02::1)
//     encuentra un PC500 conectado directo por cable aunque su IPv4 sea de
//     otra red, que es lo normal sin router de por medio.
// Para cada dirección se prueba el puerto 8089 y se confirma que el primer
// mensaje del WebSocket tenga claves del PC500.
//
// macOS 15 pide permiso de "red local" la primera vez. Si se niega, la
// búsqueda no encuentra nada.

import { execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import WebSocket from 'ws';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

export function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function localIPv4Networks(interfaces = os.networkInterfaces()) {
  const networks = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      const family = info.family === 4 ? 'IPv4' : info.family;
      if (family !== 'IPv4' || info.internal || !IPV4.test(info.address)) continue;
      networks.push({ name, address: info.address, netmask: info.netmask });
    }
  }
  return networks;
}

// Interfaces con IPv6 de enlace local (en0, en1…), sin la de loopback.
export function linkLocalInterfaces(interfaces = os.networkInterfaces()) {
  const result = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      const family = info.family === 6 ? 'IPv6' : info.family;
      if (family === 'IPv6' && !info.internal && /^fe80:/i.test(info.address)) {
        result.push({ name, address: info.address.split('%')[0] });
      }
    }
  }
  return result;
}

// Direcciones de la subred, sin la propia, la de red ni la de broadcast.
// Una red más grande que /24 se limita a la /24 que contiene la dirección.
export function subnetHosts(address, netmask) {
  const own = ipToInt(address);
  let mask = ipToInt(netmask);
  if (mask < 0xffffff00) mask = 0xffffff00;
  const network = (own & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hosts = [];
  for (let host = network + 1; host < broadcast; host += 1) {
    if (host !== own) hosts.push(intToIp(host));
  }
  return hosts;
}

// La dirección de la Mac que está en la misma subred IPv4 que otra máquina,
// o null si la Mac no está en esa red.
export function addressFacing(remoteIp, networks = localIPv4Networks()) {
  if (!IPV4.test(String(remoteIp))) return null;
  const remote = ipToInt(remoteIp);
  for (const n of networks) {
    const mask = ipToInt(n.netmask);
    if (((ipToInt(n.address) & mask) >>> 0) === ((remote & mask) >>> 0)) return n.address;
  }
  return null;
}

export function looksLikePc500(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return keys.some((k) => k.startsWith('pvw-') || k === 'system_version' || k === 'sys_ip' || k.startsWith('audio_'));
}

// Lee las respuestas de "ping6 ff02::1": cada equipo del enlace contesta con
// su dirección fe80::…%interfaz.
export function parsePing6Replies(stdout, iface, ownAddresses = []) {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const found = new Set();
  for (const match of String(stdout).matchAll(/from (fe80:[0-9a-f:]+)(?:%[\w.-]+)?/gi)) {
    const address = match[1].toLowerCase();
    if (!own.has(address)) found.add(`${address}%${iface}`);
  }
  return [...found];
}

function runPing6(iface) {
  const isMac = process.platform === 'darwin';
  const command = isMac ? 'ping6' : 'ping';
  const args = isMac ? ['-c', '2', '-I', iface, 'ff02::1'] : ['-6', '-c', '2', '-I', iface, 'ff02::1'];
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (_error, stdout) => resolve(String(stdout ?? '')));
  });
}

export async function linkLocalNeighbors({ interfaces = os.networkInterfaces(), ping = runPing6 } = {}) {
  const ifaces = linkLocalInterfaces(interfaces);
  const own = ifaces.map((i) => i.address);
  const byName = [...new Set(ifaces.map((i) => i.name))];
  const replies = await Promise.all(byName.map(async (name) => parsePing6Replies(await ping(name), name, own)));
  return [...new Set(replies.flat())];
}

function tcpOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function probePc500(host, { port = 8089, timeoutMs = 700 } = {}) {
  if (!(await tcpOpen(host, port, timeoutMs))) return null;
  return new Promise((resolve) => {
    let ws;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.terminate();
      } catch {
        // Ya estaba cerrado.
      }
      resolve(result);
    };
    const timer = setTimeout(() => done(null), timeoutMs * 3);
    try {
      // El socket se abre a mano: así sirve igual para IPv4 y para IPv6 con zona.
      ws = new WebSocket(`ws://pc500.local:${port}/`, {
        handshakeTimeout: timeoutMs * 2,
        perMessageDeflate: false,
        createConnection: () => net.connect({ host, port }),
      });
    } catch {
      done(null);
      return;
    }
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (looksLikePc500(data)) {
          done({
            host,
            port,
            linkLocal: /^fe80:/i.test(host),
            version: typeof data.system_version === 'string' ? data.system_version : '',
            reportedIp: IPV4.test(String(data.sys_ip)) ? data.sys_ip : '',
          });
        }
      } catch {
        // No es JSON: no es un PC500.
      }
    };
    ws.onerror = () => done(null);
    ws.onclose = () => done(null);
  });
}

export async function discoverPc500({
  port = 8089,
  timeoutMs = 700,
  concurrency = 64,
  extraHosts = [],
  networks = localIPv4Networks(),
  includeLinkLocal = true,
  neighbors = linkLocalNeighbors,
  onProgress = () => {},
  probe = probePc500,
} = {}) {
  const hosts = new Set(extraHosts.filter((h) => IPV4.test(String(h)) || /^fe80:[0-9a-f:]+%[\w.-]+$/i.test(String(h))));
  if (includeLinkLocal) for (const host of await neighbors()) hosts.add(host);
  for (const n of networks) for (const host of subnetHosts(n.address, n.netmask)) hosts.add(host);
  const list = [...hosts];
  const found = [];
  let next = 0;
  let checked = 0;

  const worker = async () => {
    while (next < list.length) {
      const host = list[next++];
      const result = await probe(host, { port, timeoutMs });
      checked += 1;
      onProgress(checked, list.length);
      if (result) found.push(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));

  // Un mismo equipo puede aparecer por IPv4 y por IPv6: queda primero la IPv4.
  const byReported = new Map();
  for (const device of found) {
    const key = device.reportedIp || device.host;
    const current = byReported.get(key);
    if (!current || (current.linkLocal && !device.linkLocal)) byReported.set(key, device);
  }
  return [...byReported.values()].sort((a, b) => Number(a.linkLocal) - Number(b.linkLocal) || a.host.localeCompare(b.host));
}
