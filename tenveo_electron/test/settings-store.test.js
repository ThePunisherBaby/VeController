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

test('guarda la configuración con la contraseña cifrada', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, fakeSafeStorage);
  await store.save({ ethernetIp: '192.168.1.188', obsHost: '127.0.0.1', obsPort: 4455, syncWithObs: false }, 'secreto');

  const text = await fs.readFile(file, 'utf8');
  assert.equal(text.includes('"secreto"'), false);
  assert.equal(JSON.parse(text).obsPasswordEncrypted, Buffer.from('cifrado:secreto').toString('base64'));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

  const loaded = await store.load();
  assert.equal(loaded.obsPassword, 'secreto');
  assert.deepEqual(loaded.settings, { ethernetIp: '192.168.1.188', obsHost: '127.0.0.1', obsPort: 4455, syncWithObs: false });
});

test('guardar sin contraseña conserva la anterior, y vacía la borra', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, fakeSafeStorage);
  await store.save({ ethernetIp: '' }, 'secreto');
  await store.save({ ethernetIp: '10.0.0.2' }, undefined);
  assert.equal((await store.load()).obsPassword, 'secreto');
  await store.save({ ethernetIp: '10.0.0.2' }, '');
  assert.equal((await store.load()).obsPassword, '');
});

test('sin cifrado disponible no escribe la contraseña', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, { isEncryptionAvailable: () => false });
  await store.save({ ethernetIp: '' }, 'secreto');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).obsPasswordEncrypted, '');
});

test('un archivo dañado se trata como configuración vacía', async (t) => {
  const file = await tempFile(t);
  await fs.writeFile(file, '{ esto no es json');
  const store = new SettingsStore(file, fakeSafeStorage);
  assert.deepEqual(await store.load(), { settings: {}, obsPassword: '' });
});
