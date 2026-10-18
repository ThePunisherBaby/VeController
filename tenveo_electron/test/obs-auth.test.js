import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { obsAuthString } from '../src/core/obs-auth.js';

const reference = (password, salt, challenge) => {
  const hash = (text) => crypto.createHash('sha256').update(text).digest('base64');
  return hash(hash(password + salt) + challenge);
};

test('coincide con el ejemplo de la documentación de OBS WebSocket', async () => {
  const auth = await obsAuthString(
    'supersecretpassword',
    'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=',
    '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=',
  );
  assert.equal(auth, '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
});

test('coincide con el cálculo de referencia de Node', async () => {
  const cases = [
    ['', 'a', 'b'],
    ['contraseña con ñ y acentos á', 'sal', 'reto'],
    ['x'.repeat(200), crypto.randomBytes(32).toString('base64'), crypto.randomBytes(32).toString('base64')],
  ];
  for (const [password, salt, challenge] of cases) {
    assert.equal(await obsAuthString(password, salt, challenge), reference(password, salt, challenge));
  }
});
