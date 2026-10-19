// Levanta el simulador del PC500 para trabajar sin el equipo.
// Variables opcionales: MOCK_PC500_PORT (18089) y MOCK_HOST (127.0.0.1).

import { startMockPc500 } from '../dev/mock-pc500.js';

const host = process.env.MOCK_HOST || '127.0.0.1';
const pc500 = await startMockPc500({ host, port: Number(process.env.MOCK_PC500_PORT || 18089) });

console.log(`PC500 simulado: ws://${host}:${pc500.port}`);
console.log('');
console.log('App de Electron contra el simulador:');
console.log(`  TENVEO_ETHERNET_IP=127.0.0.1 TENVEO_PC500_PORT=${pc500.port} TENVEO_DISABLE_ADB=1 npm start`);
console.log('Versión web contra el simulador (en otra terminal: npm run web):');
console.log(`  http://localhost:8765/?pc500=ws://127.0.0.1:${pc500.port}`);
console.log('');
console.log('Presiona Ctrl+C para detener.');

const shutdown = async () => {
  await Promise.allSettled([pc500.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
