// Busca el PC500 en la red local.
//
// Recorre la subred de cada interfaz de la Mac (como máximo una /24 por
// interfaz) con varias conexiones a la vez. Para cada dirección hace primero
// una conexión TCP rápida al puerto 8089 y, si responde, abre el WebSocket y
// revisa que el primer mensaje tenga claves del PC500.
//
// macOS 15 pide permiso de "red local" la primera vez que la app se conecta a
// otra máquina de la red. Si se niega, la búsqueda no encuentra nada.

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

// Elige la dirección de la Mac que está en la misma subred que otra máquina.
export function addressFacing(remoteIp, networks = localIPv4Networks()) {
  if (IPV4.test(String(remoteIp))) {
    const remote = ipToInt(remoteIp);
    for (const n of networks) {
      const mask = ipToInt(n.netmask);
      if (((ipToInt(n.address) & mask) >>> 0) === ((remote & mask) >>> 0)) return n.address;
    }
  }
  return networks[0]?.address ?? null;
}

export function looksLikePc500(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return keys.some((k) => k.startsWith('pvw-') || k === 'system_version' || k === 'sys_ip' || k.startsWith('audio_'));
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

export async function probePc500(host, { port = 8089, timeoutMs = 700, WebSocketImpl = WebSocket } = {}) {
  if (!(await tcpOpen(host, port, timeoutMs))) return null;
  return new Promise((resolve) => {
    let ws;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (typeof ws?.terminate === 'function') ws.terminate();
        else ws?.close();
      } catch {
        // Ya estaba cerrado.
      }
      resolve(result);
    };
    const timer = setTimeout(() => done(null), timeoutMs * 3);
    try {
      ws = new WebSocketImpl(`ws://${host}:${port}`, { handshakeTimeout: timeoutMs * 2, perMessageDeflate: false });
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
  onProgress = () => {},
  probe = probePc500,
} = {}) {
  const hosts = new Set(extraHosts.filter((h) => IPV4.test(String(h))));
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
  return found.sort((a, b) => ipToInt(a.host) - ipToInt(b.host));
}
