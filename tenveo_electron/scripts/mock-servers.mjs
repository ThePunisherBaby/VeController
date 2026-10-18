// Levanta los simuladores del PC500 y de OBS para trabajar sin el equipo.
// Variables opcionales: MOCK_PC500_PORT (18089), MOCK_OBS_PORT (14455),
// MOCK_OBS_PASSWORD (sin contraseña) y MOCK_HOST (127.0.0.1).

import { startMockObs } from '../dev/mock-obs.js';
import { startMockPc500 } from '../dev/mock-pc500.js';

const host = process.env.MOCK_HOST || '127.0.0.1';
const pc500 = await startMockPc500({ host, port: Number(process.env.MOCK_PC500_PORT || 18089) });
const obs = await startMockObs({
  host,
  port: Number(process.env.MOCK_OBS_PORT || 14455),
  password: process.env.MOCK_OBS_PASSWORD || null,
});

console.log(`PC500 simulado: ws://${host}:${pc500.port}`);
console.log(`OBS simulado:   ws://${host}:${obs.port}${process.env.MOCK_OBS_PASSWORD ? ' (con contraseña)' : ''}`);
console.log('');
console.log('App de Electron contra los simuladores:');
console.log(`  TENVEO_ETHERNET_IP=127.0.0.1 TENVEO_PC500_PORT=${pc500.port} TENVEO_OBS_PORT=${obs.port} TENVEO_DISABLE_ADB=1 npm start`);
console.log('Versión web contra los simuladores (en otra terminal: npm run web):');
console.log(`  http://localhost:8765/?pc500=ws://127.0.0.1:${pc500.port}&obs=127.0.0.1:${obs.port}`);
console.log('');
console.log('Presiona Ctrl+C para detener.');

const shutdown = async () => {
  await Promise.allSettled([pc500.close(), obs.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
