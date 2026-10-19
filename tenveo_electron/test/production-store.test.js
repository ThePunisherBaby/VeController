import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createProduction, createSource } from '../src/core/production.js';
import { ProductionStore } from '../src/main/production-store.js';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-produccion-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('sin archivo arranca con una producción nueva, y guarda solo lo válido', async (t) => {
  const dir = await tempDir(t);
  const store = new ProductionStore(dir);
  const fresh = await store.load();
  assert.equal(fresh.scenes[0].sources[0].type, 'pc500');

  const doc = createProduction();
  doc.scenes[0].name = 'Misa';
  doc.scenes[0].sources.push({ type: 'virus', name: 'x' });
  const { clean, done } = store.save(doc);
  await done;
  assert.equal(clean.scenes[0].sources.length, 1);
  const loaded = await store.load();
  assert.equal(loaded.scenes[0].name, 'Misa');
  assert.equal((await fs.stat(path.join(dir, 'production.json'))).mode & 0o777, 0o600);
});

test('un archivo dañado se trata como producción nueva', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, 'production.json'), '{ no es json');
  const loaded = await new ProductionStore(dir).load();
  assert.equal(loaded.scenes.length, 1);
});

test('copia una imagen con el nombre de su huella, una sola vez', async (t) => {
  const dir = await tempDir(t);
  const store = new ProductionStore(dir);
  const original = path.join(dir, 'Logo Iglesia.PNG');
  await fs.writeFile(original, 'contenido de prueba');
  const first = await store.importMedia(original, 'image');
  assert.match(first.media, /^[a-f0-9]{32}\.png$/);
  assert.equal(first.kind, 'image');
  assert.equal(first.fileName, 'Logo Iglesia.PNG');
  const second = await store.importMedia(original, 'image');
  assert.equal(second.media, first.media);
  assert.equal(await fs.readFile(store.resolveMedia(first.media), 'utf8'), 'contenido de prueba');
  // La escena sigue funcionando aunque se borre el original.
  await fs.rm(original);
  assert.equal(await fs.readFile(store.resolveMedia(first.media), 'utf8'), 'contenido de prueba');
  // Y una fuente de imagen acepta ese nombre.
  const source = createSource('image', { width: 1920, height: 1080 }, { settings: { media: first.media } });
  assert.equal(source.settings.media, first.media);
});

test('rechaza tipos de archivo ajenos y nombres que no son de media/', async (t) => {
  const dir = await tempDir(t);
  const store = new ProductionStore(dir);
  const script = path.join(dir, 'programa.sh');
  await fs.writeFile(script, 'echo hola');
  await assert.rejects(store.importMedia(script), /no se puede usar/);
  const image = path.join(dir, 'foto.png');
  await fs.writeFile(image, 'x');
  await assert.rejects(store.importMedia(image, 'video'), /no se puede usar/);
  assert.equal(store.resolveMedia('../settings.json'), null);
  assert.equal(store.resolveMedia('abc.png'), null);
  assert.equal(store.resolveMedia('0123456789abcdef0123456789abcdef.exe'), null);
  assert.ok(store.resolveMedia('0123456789abcdef0123456789abcdef.mp4').endsWith(path.join('media', '0123456789abcdef0123456789abcdef.mp4')));
});
