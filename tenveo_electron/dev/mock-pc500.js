// Simulador del Tenveo PC500 por WebSocket, para pruebas y desarrollo sin el equipo.
// La lógica vive en src/core/simulators.js; aquí solo se publica en un puerto.

import { WebSocketServer } from 'ws';
import { createPc500Simulator } from '../src/core/simulators.js';

export async function startMockPc500({ port = 0, host = '127.0.0.1', autoDelayMs = 600 } = {}) {
  const simulator = createPc500Simulator({ autoDelayMs });
  const wss = new WebSocketServer({ port, host });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  wss.on('connection', (ws) => {
    const session = simulator.connect((text) => {
      if (ws.readyState === 1) ws.send(text);
    });
    ws.on('message', (raw) => session.receive(String(raw)));
    ws.on('close', () => session.close());
  });

  return {
    port: wss.address().port,
    state: simulator.state,
    received: simulator.received,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
