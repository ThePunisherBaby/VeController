import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockObs } from '../dev/mock-obs.js';
import { ObsService } from '../src/core/obs-service.js';
import { waitFor } from './helpers.js';

test('se conecta con contraseña y carga escenas y estados', async (t) => {
  const mock = await startMockObs({ password: 'secreto' });
  const obs = new ObsService({ host: '127.0.0.1', port: mock.port, password: 'secreto', retryMs: 100 });
  t.after(async () => {
    obs.stop();
    await mock.close();
  });

  obs.start();
  const state = await waitFor(obs, (s) => s.status === 'connected' && s.scenes.length === 5);
  assert.equal(state.programScene, 'Cam 1');
  assert.equal(state.authRequired, true);
  assert.equal(state.endpoint, `127.0.0.1:${mock.port}`);

  obs.setScene('Cam 3');
  await waitFor(obs, (s) => s.programScene === 'Cam 3');
  obs.toggleStream();
  await waitFor(obs, (s) => s.streaming === true);
  obs.toggleRecord();
  await waitFor(obs, (s) => s.recording === true);
  obs.toggleVirtualCam();
  await waitFor(obs, (s) => s.virtualCam === true);

  mock.emit('SceneListChanged', { scenes: [{ sceneName: 'Nueva' }, { sceneName: 'Cam 3' }] });
  await waitFor(obs, (s) => s.scenes.length === 2 && s.scenes[0] === 'Nueva');

  const scene = mock.requests.find((r) => r.requestType === 'SetCurrentProgramScene');
  assert.deepEqual(scene.requestData, { sceneName: 'Cam 3' });
});

test('avisa si la contraseña es incorrecta', async (t) => {
  const mock = await startMockObs({ password: 'secreto' });
  const obs = new ObsService({ host: '127.0.0.1', port: mock.port, password: 'otra', retryMs: 5000 });
  t.after(async () => {
    obs.stop();
    await mock.close();
  });
  obs.start();
  const state = await waitFor(obs, (s) => s.lastError !== null);
  assert.equal(state.lastError, 'La contraseña de OBS no es correcta.');
  assert.notEqual(state.status, 'connected');
});

test('avisa si OBS pide contraseña y no hay una guardada', async (t) => {
  const mock = await startMockObs({ password: 'secreto' });
  const obs = new ObsService({ host: '127.0.0.1', port: mock.port, retryMs: 5000 });
  t.after(async () => {
    obs.stop();
    await mock.close();
  });
  obs.start();
  const state = await waitFor(obs, (s) => s.lastError !== null);
  assert.match(state.lastError, /OBS pide contraseña/);
});

test('sin contraseña en OBS se conecta directo', async (t) => {
  const mock = await startMockObs();
  const obs = new ObsService({ host: '127.0.0.1', port: mock.port, retryMs: 100 });
  t.after(async () => {
    obs.stop();
    await mock.close();
  });
  obs.start();
  const state = await waitFor(obs, (s) => s.status === 'connected');
  assert.equal(state.authRequired, false);
});

test('configure() reconecta con el nuevo puerto', async (t) => {
  const first = await startMockObs();
  const second = await startMockObs({ scenes: ['Otra'] });
  const obs = new ObsService({ host: '127.0.0.1', port: first.port, retryMs: 100 });
  t.after(async () => {
    obs.stop();
    await first.close();
    await second.close();
  });
  obs.start();
  await waitFor(obs, (s) => s.status === 'connected' && s.scenes.length === 5);
  obs.configure({ port: second.port });
  const state = await waitFor(obs, (s) => s.status === 'connected' && s.scenes.length === 1);
  assert.equal(state.endpoint, `127.0.0.1:${second.port}`);
});

test('sin conexión, las acciones devuelven false', () => {
  const obs = new ObsService({ port: 1 });
  assert.equal(obs.toggleStream(), false);
  assert.equal(obs.setScene('Cam 1'), false);
});
