// Copia adb a vendor/platform-tools para incluirlo en la app empaquetada.
// Lo busca en TENVEO_ADB, ANDROID_HOME, ANDROID_SDK_ROOT, las rutas comunes y el PATH.
// Si no lo encuentra, la app empaquetada buscará adb en la Mac al abrirse.
// vendor/ no se sube al repositorio.

import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adbCandidates } from '../src/main/adb-bridge.js';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const targetDir = path.join(projectDir, 'vendor', 'platform-tools');

async function findSource() {
  for (const candidate of adbCandidates({ env: process.env })) {
    try {
      await fs.access(candidate, constants.X_OK);
      const real = await fs.realpath(candidate);
      if ((await fs.stat(real)).isFile()) return real;
    } catch {
      // Sigue con la siguiente ruta.
    }
  }
  return null;
}

await fs.mkdir(targetDir, { recursive: true });
const source = await findSource();
if (!source) {
  console.warn('[prepare-adb] No se encontró adb. La app buscará adb en la Mac al abrirse.');
  console.warn('[prepare-adb] Para incluirlo: brew install android-platform-tools');
  process.exit(0);
}

await fs.copyFile(source, path.join(targetDir, 'adb'));
await fs.chmod(path.join(targetDir, 'adb'), 0o755);
const notice = path.join(path.dirname(source), 'NOTICE.txt');
try {
  await fs.copyFile(notice, path.join(targetDir, 'NOTICE.txt'));
} catch {
  // Algunas instalaciones no traen el aviso de licencia.
}
console.log(`[prepare-adb] adb copiado desde ${source}`);
