// Simulador de OBS WebSocket v5 por WebSocket, para pruebas y desarrollo sin OBS.
// La lógica vive en src/core/simulators.js; aquí solo se publica en un puerto.

import { WebSocketServer } from 'ws';
import { createObsSimulator } from '../src/core/simulators.js';

export async function startMockObs({ port = 0, host = '127.0.0.1', password = null, scenes } = {}) {
  const simulator = createObsSimulator({ password, scenes });
  const wss = new WebSocketServer({ port, host });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  wss.on('connection', (ws) => {
    const session = simulator.connect(
      (text) => {
        if (ws.readyState === 1) ws.send(text);
      },
      (code, reason) => ws.close(code, reason),
    );
    ws.on('message', (raw) => session.receive(String(raw)));
    ws.on('close', () => session.close());
  });

  return {
    port: wss.address().port,
    state: simulator.state,
    requests: simulator.requests,
    emit: simulator.emit,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
