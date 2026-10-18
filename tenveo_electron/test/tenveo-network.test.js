import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { startMockPc500 } from '../dev/mock-pc500.js';
import { TenveoService } from '../src/core/tenveo-service.js';
import { until, waitFor } from './helpers.js';

test('mide la latencia con ping cuando la conexión lo permite', async (t) => {
  const mock = await startMockPc500();
  const service = new TenveoService({ usbUrl: `ws://127.0.0.1:${mock.port}`, WebSocketImpl: WebSocket, heartbeatMs: 100 });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.start();
  const state = await waitFor(service, (s) => s.connection === 'usb' && typeof s.latencyMs === 'number');
  assert.ok(state.latencyMs >= 0 && state.latencyMs < 1000);
});

test('detecta una conexión muerta y reconecta sola', async (t) => {
  const mock = await startMockPc500();
  const service = new TenveoService({
    usbUrl: `ws://127.0.0.1:${mock.port}`,
    WebSocketImpl: WebSocket,
    heartbeatMs: 100,
    heartbeatTimeoutMs: 400,
  });
  const errors = [];
  service.onChange((s) => {
    if (s.lastError) errors.push(s.lastError);
  });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.start();
  await waitFor(service, (s) => s.connection === 'usb' && typeof s.latencyMs === 'number');

  // El simulador deja de leer: como un cable desenchufado sin aviso.
  const [frozen] = mock.clients();
  frozen._socket.pause();
  await waitFor(service, (s) => s.connection !== 'usb', 3000);
  assert.ok(errors.some((e) => /dejó de responder/.test(e)));

  await waitFor(service, (s) => s.connection === 'usb', 3000);
  assert.equal(mock.clients().length >= 2, true);
});

test('un servidor que no contesta pings no pierde la conexión', async (t) => {
  const mock = await startMockPc500();
  // Este WebSocket finge tener ping pero nunca recibe pong.
  class NoPongWebSocket extends WebSocket {
    ping() {}
  }
  const service = new TenveoService({
    usbUrl: `ws://127.0.0.1:${mock.port}`,
    WebSocketImpl: NoPongWebSocket,
    heartbeatMs: 50,
    heartbeatTimeoutMs: 150,
  });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.start();
  await waitFor(service, (s) => s.connection === 'usb');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(service.state.connection, 'usb');
  assert.equal(service.state.latencyMs, null);
});

class SlowNetworkSocket {
  static last = null;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    SlowNetworkSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

test('con la red saturada manda solo el último valor y respeta el orden', async (t) => {
  const service = new TenveoService({ usbUrl: 'ws://lento:8089', WebSocketImpl: SlowNetworkSocket, flushMs: 10 });
  t.after(() => service.stop());
  service.start();
  await waitFor(service, (s) => s.connection === 'usb');
  const socket = SlowNetworkSocket.last;

  socket.bufferedAmount = 100_000;
  service.setTbar(0.1);
  service.setTbar(0.5);
  service.setTbar(0.9);
  assert.deepEqual(socket.sent, []);

  // Un botón saca primero lo pendiente: nunca llega un CUT antes que la T-Bar.
  service.cut();
  assert.deepEqual(socket.sent, [{ putter: 230 }, { cut: 1 }]);

  service.setVolume('in1', -10);
  service.setVolume('in1', -20);
  service.setVolume('pgm', -3);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(socket.sent.length, 2);

  socket.bufferedAmount = 0;
  await until(() => socket.sent.length === 4);
  assert.deepEqual(socket.sent.slice(2), [{ audio_in1_vol: -20 }, { audio_pgm_vol: -3 }]);
});

test('los modos de conexión eligen la ruta', async (t) => {
  const mock = await startMockPc500();
  const service = new TenveoService({
    usbUrl: `ws://127.0.0.1:${mock.port}`,
    ethernetPort: mock.port,
    mode: 'network',
    retryMs: 100,
  });
  t.after(async () => {
    service.stop();
    await mock.close();
  });

  service.start();
  const waiting = await waitFor(service, (s) => s.lastError !== null);
  assert.match(waiting.lastError, /IP del PC500/);
  assert.equal(service.state.connection === 'usb', false);

  service.setMode('auto');
  await waitFor(service, (s) => s.connection === 'usb');

  service.setEthernetIp('127.0.0.1');
  service.setMode('network');
  const lan = await waitFor(service, (s) => s.connection === 'ethernet');
  assert.equal(lan.endpoint, `Ethernet LAN (127.0.0.1:${mock.port})`);
  assert.throws(() => service.setMode('wifi'), RangeError);
});

test('los botones del panel llegan al equipo y vuelve su luz', async (t) => {
  const mock = await startMockPc500();
  const service = new TenveoService({ usbUrl: `ws://127.0.0.1:${mock.port}` });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.start();
  await waitFor(service, (s) => s.connection === 'usb' && s.device.ip === '192.168.1.188');
  assert.equal(service.state.device.version, 'SIMULADOR PC500');

  // Como el equipo real: STREAM verde y el contador corriendo.
  service.pressButton('stream');
  await waitFor(service, () => service.isButtonOn('stream') && service.state.device.streamTime !== '00:00:00');
  assert.equal(service.state.buttons.stream, 'active-green');
  service.pressButton('dsk');
  await waitFor(service, () => service.isButtonOn('dsk'));
  service.pressButton('stream');
  await waitFor(service, () => !service.isButtonOn('stream') && service.state.device.streamTime === '00:00:00');
  assert.equal(service.state.raw['stream-2-key'], 'live2');
});

test('un cambio de modo en el instante en que conecta no deja la conexión muerta', async (t) => {
  const mock = await startMockPc500();
  // Reintento largo: si el pedido se perdiera, la prueba se quedaría sin conexión.
  const service = new TenveoService({ usbUrl: `ws://127.0.0.1:${mock.port}`, ethernetPort: mock.port, retryMs: 60000 });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.setEthernetIp('127.0.0.1');
  let switched = false;
  service.onChange((s) => {
    if (s.connection === 'usb' && !switched) {
      switched = true;
      service.setMode('network');
    }
  });
  service.start();
  const state = await waitFor(service, (s) => s.connection === 'ethernet', 2000);
  assert.equal(state.endpoint, `Ethernet LAN (127.0.0.1:${mock.port})`);
});
