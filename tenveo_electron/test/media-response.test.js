import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mediaResponse, parseRange } from '../src/main/media-response.js';

test('entiende los tramos que pide un video', () => {
  assert.deepEqual(parseRange(undefined, 1000), { start: 0, end: 999, partial: false });
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999, partial: true });
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199, partial: true });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999, partial: true });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999, partial: true });
  assert.equal(parseRange('bytes=1000-', 1000), null);
  // Lo que no entiende devuelve el archivo entero.
  assert.deepEqual(parseRange('bytes=0-1,5-9', 1000), { start: 0, end: 999, partial: false });
  assert.deepEqual(parseRange('items=0-9', 1000), { start: 0, end: 999, partial: false });
});

test('sirve un tramo con 206 y el archivo entero con 200', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-media-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '0123456789abcdef0123456789abcdef.mp4');
  await fs.writeFile(file, 'abcdefghijklmnopqrstuvwxyz');

  const part = await mediaResponse(file, 'bytes=2-5');
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/26');
  assert.equal(part.headers.get('content-type'), 'video/mp4');
  assert.equal(await part.text(), 'cdef');

  const whole = await mediaResponse(file, null);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), '26');
  assert.equal(await whole.text(), 'abcdefghijklmnopqrstuvwxyz');

  assert.equal((await mediaResponse(file, 'bytes=99-')).status, 416);
  assert.equal((await mediaResponse(path.join(dir, 'no-existe.mp4'))).status, 404);
});
