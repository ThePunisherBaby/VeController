import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { startMockPc500 } from '../dev/mock-pc500.js';
import {
  addressFacing,
  discoverPc500,
  intToIp,
  ipToInt,
  localIPv4Networks,
  looksLikePc500,
  probePc500,
  subnetHosts,
} from '../src/main/lan-discovery.js';

test('convierte direcciones IPv4', () => {
  assert.equal(ipToInt('192.168.1.10'), 0xc0a8010a);
  assert.equal(intToIp(0xc0a8010a), '192.168.1.10');
});

test('calcula las direcciones de una subred', () => {
  const hosts = subnetHosts('192.168.1.10', '255.255.255.0');
  assert.equal(hosts.length, 253);
  assert.equal(hosts[0], '192.168.1.1');
  assert.equal(hosts.at(-1), '192.168.1.254');
  assert.equal(hosts.includes('192.168.1.10'), false);

  // Una red /16 se limita a la /24 que contiene la dirección.
  assert.equal(subnetHosts('10.4.7.20', '255.255.0.0').length, 253);
  // Una /30 tiene dos direcciones útiles: la propia y una más.
  assert.deepEqual(subnetHosts('10.0.0.1', '255.255.255.252'), ['10.0.0.2']);
});

test('elige la dirección de la Mac de la misma subred', () => {
  const networks = [
    { name: 'en0', address: '10.0.0.5', netmask: '255.255.255.0' },
    { name: 'en1', address: '192.168.1.20', netmask: '255.255.255.0' },
  ];
  assert.equal(addressFacing('192.168.1.188', networks), '192.168.1.20');
  // Sin red en común no hay dirección que sugerir.
  assert.equal(addressFacing('172.16.0.9', networks), null);
  assert.equal(addressFacing('', []), null);
});

test('lista solo interfaces IPv4 externas', () => {
  const networks = localIPv4Networks({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    en0: [
      { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false },
      { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false },
    ],
  });
  assert.deepEqual(networks, [{ name: 'en0', address: '192.168.1.20', netmask: '255.255.255.0' }]);
});

test('reconoce los mensajes del PC500', () => {
  assert.equal(looksLikePc500({ 'pvw-1': 'active-red' }), true);
  assert.equal(looksLikePc500({ system_version: 'V1' }), true);
  assert.equal(looksLikePc500({ hola: 1 }), false);
  assert.equal(looksLikePc500([1]), false);
});

test('confirma un PC500 y descarta otros servidores', async (t) => {
  const mock = await startMockPc500({ ip: '192.168.1.188' });
  const other = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => other.once('listening', resolve));
  other.on('connection', (ws) => ws.send(JSON.stringify({ servicio: 'otra cosa' })));
  t.after(async () => {
    await mock.close();
    await new Promise((resolve) => other.close(resolve));
  });

  const found = await probePc500('127.0.0.1', { port: mock.port, timeoutMs: 500 });
  assert.deepEqual(found, { host: '127.0.0.1', port: mock.port, linkLocal: false, version: 'SIMULADOR PC500', reportedIp: '192.168.1.188' });
  assert.equal(await probePc500('127.0.0.1', { port: other.address().port, timeoutMs: 300 }), null);
  assert.equal(await probePc500('127.0.0.1', { port: 1, timeoutMs: 300 }), null);
});

test('la búsqueda recorre las direcciones en paralelo', async (t) => {
  const mock = await startMockPc500();
  t.after(() => mock.close());
  let progress = 0;
  const found = await discoverPc500({
    port: mock.port,
    timeoutMs: 300,
    networks: [],
    // Sin vecinos reales: la prueba depende solo del simulador.
    includeLinkLocal: false,
    extraHosts: ['127.0.0.1', 'no-es-ip'],
    onProgress: (done) => {
      progress = done;
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].host, '127.0.0.1');
  assert.equal(progress, 1);
});

// --- IPv6 de enlace local: PC500 conectado directo por cable ---

import { linkLocalInterfaces, linkLocalNeighbors, parsePing6Replies } from '../src/main/lan-discovery.js';

const PING6_OUTPUT = `PING6(56=40+8+8 bytes) fe80::4f0:d5c5:a936:217a%en0 --> ff02::1%en0
16 bytes from fe80::10bf:b2ff:feee:6e2d%en0, icmp_seq=0 hlim=64 time=1.754 ms
16 bytes from fe80::4f0:d5c5:a936:217a%en0, icmp_seq=0 hlim=64 time=0.149 ms
16 bytes from fe80::10bf:b2ff:feee:6e2d%en0, icmp_seq=1 hlim=64 time=0.671 ms
`;

test('lee los equipos que contestan al ping IPv6 y descarta la propia Mac', () => {
  assert.deepEqual(parsePing6Replies(PING6_OUTPUT, 'en0', ['fe80::4f0:d5c5:a936:217a']), ['fe80::10bf:b2ff:feee:6e2d%en0']);
  assert.deepEqual(parsePing6Replies('', 'en0'), []);
});

test('busca vecinos IPv6 en cada interfaz con enlace local', async () => {
  const interfaces = {
    lo0: [{ family: 'IPv6', address: 'fe80::1', internal: true }],
    en0: [{ family: 'IPv6', address: 'fe80::4f0:d5c5:a936:217a', internal: false }],
    en1: [{ family: 'IPv4', address: '10.0.0.74', internal: false }],
  };
  assert.deepEqual(linkLocalInterfaces(interfaces), [{ name: 'en0', address: 'fe80::4f0:d5c5:a936:217a' }]);
  const pinged = [];
  const found = await linkLocalNeighbors({
    interfaces,
    ping: async (iface) => {
      pinged.push(iface);
      return PING6_OUTPUT;
    },
  });
  assert.deepEqual(pinged, ['en0']);
  assert.deepEqual(found, ['fe80::10bf:b2ff:feee:6e2d%en0']);
});

test('la búsqueda suma los vecinos IPv6 y prefiere la IPv4 del mismo equipo', async () => {
  const seen = [];
  const found = await discoverPc500({
    networks: [],
    extraHosts: ['192.168.0.177'],
    neighbors: async () => ['fe80::10bf:b2ff:feee:6e2d%en0'],
    probe: async (host) => {
      seen.push(host);
      return { host, port: 8089, linkLocal: host.startsWith('fe80'), version: 'PC500', reportedIp: '192.168.0.177' };
    },
  });
  assert.deepEqual(seen.sort(), ['192.168.0.177', 'fe80::10bf:b2ff:feee:6e2d%en0']);
  assert.equal(found.length, 1);
  assert.equal(found[0].host, '192.168.0.177');

  const onlyCable = await discoverPc500({
    networks: [],
    neighbors: async () => ['fe80::10bf:b2ff:feee:6e2d%en0'],
    probe: async (host) => ({ host, port: 8089, linkLocal: true, version: 'PC500', reportedIp: '192.168.0.177' }),
  });
  assert.equal(onlyCable[0].linkLocal, true);
});
