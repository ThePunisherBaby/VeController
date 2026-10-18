import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockPc500 } from '../dev/mock-pc500.js';
import { TenveoService } from '../src/core/tenveo-service.js';
import { sleep, until, waitFor } from './helpers.js';

// Puerto 1: nadie escucha ahí, así que la ruta USB falla rápido.
const CLOSED_USB = 'ws://127.0.0.1:1';

test('se conecta por USB y lee el estado inicial', async (t) => {
  const mock = await startMockPc500();
  const service = new TenveoService({ usbUrl: `ws://127.0.0.1:${mock.port}`, retryMs: 100 });
  t.after(async () => {
    service.stop();
    await mock.close();
  });

  service.start();
  const state = await waitFor(service, (s) => s.connection === 'usb' && s.volumes.in1 === -12);
  assert.equal(state.endpoint, `USB (Bridge: 127.0.0.1:${mock.port})`);
  assert.equal(state.pgm, '1');
  assert.equal(state.pvw, '2');
  assert.equal(state.channelModes.in3, 'AFV');
  assert.equal(state.channelModes.in4, 'OFF');
});

test('manda los comandos y sigue los cambios del equipo', async (t) => {
  const mock = await startMockPc500({ autoDelayMs: 50 });
  const service = new TenveoService({ usbUrl: `ws://127.0.0.1:${mock.port}`, retryMs: 100, switchLiveDelayMs: 20 });
  t.after(async () => {
    service.stop();
    await mock.close();
  });
  service.start();
  await waitFor(service, (s) => s.connection === 'usb');

  assert.equal(service.selectPreview('3'), true);
  await waitFor(service, (s) => s.pvw === '3');
  assert.deepEqual(mock.received.at(-1), { 'pvw-3': 1 });

  service.cut();
  await waitFor(service, (s) => s.pgm === '3' && s.pvw === '1');

  service.switchLive('4');
  await waitFor(service, (s) => s.pgm === '4');
  assert.deepEqual(mock.received.slice(-2), [{ 'pvw-4': 1 }, { cut: 1 }]);

  service.auto();
  await waitFor(service, (s) => s.pgm === '3');

  service.setVolume('pgm', -20);
  assert.equal(service.state.volumes.pgm, -20);
  await until(() => mock.state.vol.pgm === -20);

  // El botón cambia al instante; el equipo recibe el mismo control del panel.
  service.toggleMute('in1');
  assert.equal(service.state.channelModes.in1, 'OFF');
  await until(() => mock.state.mode.in1 === 0);
  assert.deepEqual(mock.received.at(-1), { audio_in1_mode: 0 });

  service.toggleMute('pgm');
  assert.equal(service.state.channelModes.pgm, 'OFF');
  await until(() => mock.state.on.pgm === 0);
  assert.deepEqual(mock.received.at(-1), { audio_pgm_on: 0 });

  service.toggleMute('pgm');
  await until(() => mock.state.on.pgm === 1);
  assert.equal(service.state.channelModes.pgm, 'ON');

  // T-Bar de punta a punta: el simulador completa la transición.
  const before = service.state.pgm;
  service.setTbar(0.4);
  service.setTbar(1);
  await waitFor(service, (s) => s.pgm !== before);
  assert.deepEqual(mock.received.at(-1), { putter: 255 });
  assert.equal(service.state.tbar, 1);
});

test('si se cae la conexión Ethernet, vuelve a conectar con la misma IP', async (t) => {
  let mock = await startMockPc500();
  const { port } = mock;
  const service = new TenveoService({ usbUrl: CLOSED_USB, ethernetPort: port, retryMs: 100, connectTimeoutMs: 500 });
  t.after(async () => {
    service.stop();
    await mock.close();
  });

  service.setEthernetIp('127.0.0.1');
  service.start();
  await waitFor(service, (s) => s.connection === 'ethernet');

  await mock.close();
  await waitFor(service, (s) => s.connection !== 'ethernet');
  await sleep(250);
  mock = await startMockPc500({ port });

  const state = await waitFor(service, (s) => s.connection === 'ethernet', 5000);
  assert.equal(state.endpoint, `Ethernet LAN (127.0.0.1:${port})`);
});

test('una IP no válida se rechaza sin romper el ciclo', async (t) => {
  const service = new TenveoService({ usbUrl: CLOSED_USB, retryMs: 100, connectTimeoutMs: 300 });
  t.after(() => service.stop());
  service.setEthernetIp('http://192.168.1.10/');
  service.start();
  const state = await waitFor(service, (s) => s.lastError !== null);
  assert.match(state.lastError, /IP no válida/);
});

test('sin conexión, los comandos devuelven false', () => {
  const service = new TenveoService({ usbUrl: CLOSED_USB });
  assert.equal(service.cut(), false);
  assert.equal(service.selectPreview('2'), false);
  assert.equal(service.setVolume('in1', -10), false);
  assert.equal(service.state.volumes.in1, -10);
});
