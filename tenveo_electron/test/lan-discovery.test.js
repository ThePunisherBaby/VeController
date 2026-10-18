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
  assert.equal(addressFacing('172.16.0.9', networks), '10.0.0.5');
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
  assert.deepEqual(found, { host: '127.0.0.1', port: mock.port, version: 'SIMULADOR PC500', reportedIp: '192.168.1.188' });
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
    extraHosts: ['127.0.0.1', 'no-es-ip'],
    onProgress: (done) => {
      progress = done;
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].host, '127.0.0.1');
  assert.equal(progress, 1);
});
