import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { TenveoService, hostForUrl, isLinkLocal, isValidHost } from '../src/core/tenveo-service.js';
import { LowLatencyWebSocket, parseZonedUrl } from '../src/main/net-websocket.js';
import { parseRtmpUrl } from '../src/main/video-receiver.js';
import { waitFor } from './helpers.js';

test('acepta IPv6 de enlace local con su interfaz', () => {
  assert.equal(isValidHost('fe80::10bf:b2ff:feee:6e2d%en0'), true);
  assert.equal(isValidHost('192.168.0.177'), true);
  assert.equal(isValidHost('fe80::1%en0 '), false);
  assert.equal(isValidHost('http://x'), false);
  assert.equal(isLinkLocal('fe80::1%en0'), true);
  assert.equal(isLinkLocal('192.168.0.177'), false);
});

test('escribe la IPv6 con corchetes y la zona como %25 en la URL', () => {
  assert.equal(hostForUrl('fe80::1%en0'), '[fe80::1%25en0]');
  assert.equal(hostForUrl('::1'), '[::1]');
  assert.equal(hostForUrl('192.168.0.177'), '192.168.0.177');
});

test('lee la zona de una URL de WebSocket', () => {
  assert.deepEqual(parseZonedUrl('ws://[fe80::10bf:b2ff:feee:6e2d%25en0]:8089'), {
    host: 'fe80::10bf:b2ff:feee:6e2d%en0',
    port: 8089,
    path: '/',
  });
  assert.equal(parseZonedUrl('ws://127.0.0.1:8089'), null);
  assert.equal(parseZonedUrl('ws://[::1]:8089'), null);
});

test('lee IPv6 con y sin zona en una URL RTMP', () => {
  assert.deepEqual(parseRtmpUrl('rtmp://[fe80::1%25en0]:1935/live/live2'), {
    host: 'fe80::1%en0',
    port: 1935,
    app: 'live',
    streamName: 'live2',
    query: {},
  });
  assert.equal(parseRtmpUrl('rtmp://[::1]/live/k').host, '::1');
  assert.equal(parseRtmpUrl('rtmp://[::1]/live/k').port, 1935);
  assert.equal(parseRtmpUrl('rtmp://192.168.0.177:1935/live/live2').host, '192.168.0.177');
});

// En macOS, lo0 tiene la dirección de enlace local fe80::1. En otros sistemas
// esta prueba se salta.
const loopbackLinkLocal = Object.entries(os.networkInterfaces()).find(([, list]) =>
  (list ?? []).some((info) => info.internal && /^fe80::1$/i.test(info.address.split('%')[0])),
);

test('se conecta al PC500 por IPv6 de enlace local', { skip: !loopbackLinkLocal && 'sin fe80::1 en loopback' }, async (t) => {
  const [iface] = loopbackLinkLocal;
  const server = new WebSocketServer({ port: 0, host: '::' });
  await new Promise((resolve) => server.once('listening', resolve));
  server.on('connection', (ws) => ws.send(JSON.stringify({ 'pvw-2': 'active-red', system_version: 'PC500' })));
  const service = new TenveoService({
    ethernetPort: server.address().port,
    WebSocketImpl: LowLatencyWebSocket,
    heartbeatMs: 100,
  });
  t.after(async () => {
    service.stop();
    await new Promise((resolve) => server.close(resolve));
  });
  service.setEthernetIp(`fe80::1%${iface}`);
  service.start();
  const state = await waitFor(service, (s) => s.connection === 'ethernet' && s.pgm === '2' && typeof s.latencyMs === 'number');
  assert.equal(state.device.version, 'PC500');
  assert.equal(state.endpoint, `Red (fe80::1%${iface}:${server.address().port})`);
});
