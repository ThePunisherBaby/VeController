import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulatedWebSocket } from '../src/core/simulated-websocket.js';
import { createPc500Simulator } from '../src/core/simulators.js';
import { TenveoService } from '../src/core/tenveo-service.js';
import { until, waitFor } from './helpers.js';

test('modo demo: el servicio del PC500 funciona con el simulador sin red', async (t) => {
  const simulator = createPc500Simulator({ autoDelayMs: 20 });
  const service = new TenveoService({ WebSocketImpl: createSimulatedWebSocket(simulator), switchLiveDelayMs: 10 });
  t.after(() => service.stop());

  service.setEthernetIp('simulador');
  service.start();
  const state = await waitFor(service, (s) => s.connection === 'ethernet' && s.volumes.in2 === -8);
  assert.equal(state.endpoint, 'Red (simulador:8089)');

  service.switchLive('aux');
  await waitFor(service, (s) => s.pgm === 'aux');
  service.toggleMute('mic1');
  await until(() => simulator.state.on.mic1 === 0);
  assert.deepEqual(simulator.received.slice(-3), [{ 'pvw-aux': 1 }, { cut: 1 }, { audio_mic1_on: 0 }]);
});

test('el WebSocket simulado abre antes de entregar mensajes y avisa al cerrar', async () => {
  const events = [];
  const Socket = createSimulatedWebSocket(createPc500Simulator());
  const socket = new Socket('ws://simulador:8089');
  await new Promise((resolve) => {
    socket.onopen = () => events.push('open');
    socket.onmessage = () => {
      events.push('message');
      socket.close();
    };
    socket.onclose = (event) => {
      events.push(`close:${event.code}`);
      resolve();
    };
  });
  assert.deepEqual(events, ['open', 'message', 'close:1000']);
  assert.throws(() => socket.send('{}'), /no está abierto/);
});
