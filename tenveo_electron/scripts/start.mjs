// Abre la app con Electron desde el código fuente (npm start).
// Quita ELECTRON_RUN_AS_NODE, una variable que VS Code y otras herramientas
// dejan puesta y que haría correr Electron como si fuera Node.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [projectDir, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
