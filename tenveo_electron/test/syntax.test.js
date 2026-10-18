import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// El proceso principal y el preload no se cargan en las otras pruebas: un error
// de sintaxis ahí solo aparecería al abrir la app.
const DIRS = ['src/main', 'src/preload', 'src/core', 'src/renderer/js', 'scripts', 'dev'];

async function sources(dir) {
  const entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') files.push(...(await sources(relative)));
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

test('todos los archivos de la app se pueden leer sin errores de sintaxis', async () => {
  const files = (await Promise.all(DIRS.map(sources))).flat();
  assert.ok(files.includes(path.join('src', 'main', 'main.js')));
  const failures = [];
  await Promise.all(
    files.map(async (file) => {
      try {
        await promisify(execFile)(process.execPath, ['--check', path.join(ROOT, file)]);
      } catch (error) {
        failures.push(`${file}: ${String(error.stderr).split('\n').find((line) => /Error/.test(line)) ?? error.message}`);
      }
    }),
  );
  assert.deepEqual(failures, []);
});
