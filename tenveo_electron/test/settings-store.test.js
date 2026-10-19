import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SettingsStore } from '../src/main/settings-store.js';

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`cifrado:${text}`),
  decryptString: (buffer) => buffer.toString().replace(/^cifrado:/, ''),
};

async function tempFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}

test('guarda la configuración con los secretos cifrados', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, fakeSafeStorage);
  await store.save({ ethernetIp: '192.168.1.188', appearance: 'dark' }, { streamKey: 'secreto' });

  const text = await fs.readFile(file, 'utf8');
  assert.equal(text.includes('"secreto"'), false);
  assert.equal(JSON.parse(text).secretsEncrypted, Buffer.from('cifrado:{"streamKey":"secreto"}').toString('base64'));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

  const loaded = await store.load();
  assert.deepEqual(loaded.secrets, { streamKey: 'secreto' });
  assert.deepEqual(loaded.settings, { ethernetIp: '192.168.1.188', appearance: 'dark' });
});

test('guardar sin secretos conserva los anteriores, y vacíos los borra', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, fakeSafeStorage);
  await store.save({ ethernetIp: '' }, { streamKey: 'secreto' });
  await store.save({ ethernetIp: '10.0.0.2' }, undefined);
  assert.deepEqual((await store.load()).secrets, { streamKey: 'secreto' });
  await store.save({ ethernetIp: '10.0.0.2' }, {});
  assert.deepEqual((await store.load()).secrets, {});
});

test('sin cifrado disponible no escribe los secretos', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, { isEncryptionAvailable: () => false });
  await store.save({ ethernetIp: '' }, { streamKey: 'secreto' });
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).secretsEncrypted, '');
});

test('descarta la contraseña de OBS de versiones anteriores', async (t) => {
  const file = await tempFile(t);
  await fs.writeFile(file, JSON.stringify({ ethernetIp: '10.0.0.5', obsHost: 'x', obsPasswordEncrypted: 'abc' }));
  const store = new SettingsStore(file, fakeSafeStorage);
  const loaded = await store.load();
  assert.equal('obsPasswordEncrypted' in loaded.settings, false);
  assert.deepEqual(loaded.secrets, {});
});

test('un archivo dañado se trata como configuración vacía', async (t) => {
  const file = await tempFile(t);
  await fs.writeFile(file, '{ esto no es json');
  const store = new SettingsStore(file, fakeSafeStorage);
  assert.deepEqual(await store.load(), { settings: {}, secrets: {} });
});
