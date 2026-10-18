import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSwitcherState } from '../src/core/pc500-protocol.js';
import { createObsState } from '../src/core/obs-service.js';
import { StudioController, findSceneForCamera, normalizeSettings } from '../src/core/studio-controller.js';

class FakeService {
  constructor(state) {
    this.state = state;
    this.calls = [];
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  record(name, ...args) {
    this.calls.push([name, ...args]);
    return true;
  }
}

class FakeTenveo extends FakeService {
  constructor() {
    super(createSwitcherState());
  }
  start() { return this.record('start'); }
  stop() { return this.record('stop'); }
  retry() { return this.record('retry'); }
  setEthernetIp(ip) { return this.record('setEthernetIp', ip); }
  selectPreview(cam) { return this.record('selectPreview', cam); }
  switchLive(cam) { return this.record('switchLive', cam); }
  cut() { return this.record('cut'); }
  auto() { return this.record('auto'); }
  ftb() { return this.record('ftb'); }
  setTbar(pos) { return this.record('setTbar', pos); }
  setVolume(ch, db) { return this.record('setVolume', ch, db); }
  toggleMute(ch) { return this.record('toggleMute', ch); }
}

class FakeObs extends FakeService {
  constructor() {
    super({ ...createObsState(), status: 'connected', scenes: ['Cam 1', 'Cam 2', 'Slides'] });
  }
  get isConnected() { return this.state.status === 'connected'; }
  configure(config) { return this.record('configure', config); }
  start() { return this.record('start'); }
  stop() { return this.record('stop'); }
  retry() { return this.record('retry'); }
  setScene(name) { return this.record('setScene', name); }
  toggleStream() { return this.record('toggleStream'); }
  toggleRecord() { return this.record('toggleRecord'); }
  toggleVirtualCam() { return this.record('toggleVirtualCam'); }
}

function setup(options = {}) {
  const tenveo = new FakeTenveo();
  const obs = new FakeObs();
  const saved = [];
  const controller = new StudioController({
    tenveo,
    obs,
    persist: (settings, password) => saved.push([settings, password]),
    ...options,
  });
  controller.start();
  return { tenveo, obs, controller, saved };
}

test('con SYNC OBS, cambiar la cámara al aire cambia la escena', () => {
  const { tenveo, obs } = setup();
  tenveo.set({ pgm: '2' });
  assert.deepEqual(obs.calls.at(-1), ['setScene', 'Cam 2']);
});

test('sin SYNC OBS no se toca la escena', () => {
  const { tenveo, obs, controller } = setup();
  controller.dispatch('toggleObsSync');
  tenveo.set({ pgm: '2' });
  assert.equal(obs.calls.some(([name]) => name === 'setScene'), false);
});

test('un cambio que no es de PGM no cambia la escena', () => {
  const { tenveo, obs } = setup();
  tenveo.set({ pvw: '3' });
  assert.equal(obs.calls.some(([name]) => name === 'setScene'), false);
});

test('busca escenas por cam N, camN o camera N', () => {
  const scenes = ['Escena Cam 3', 'cam4 cerrada', 'Camera 1 general', 'Slides'];
  assert.equal(findSceneForCamera(scenes, '3'), 'Escena Cam 3');
  assert.equal(findSceneForCamera(scenes, '4'), 'cam4 cerrada');
  assert.equal(findSceneForCamera(scenes, '1'), 'Camera 1 general');
  assert.equal(findSceneForCamera(scenes, 'aux'), null);
});

test('solo acepta comandos y valores conocidos', () => {
  const { controller, tenveo } = setup();
  assert.throws(() => controller.dispatch('borrarTodo'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('constructor'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('__proto__'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('selectPreview', '9'), /Cámara desconocida/);
  assert.throws(() => controller.dispatch('setVolume', 'xx', -6), /Canal desconocido/);
  controller.dispatch('switchLive', 'aux');
  controller.dispatch('toggleMute', 'mic1');
  assert.deepEqual(tenveo.calls.slice(-2), [['switchLive', 'aux'], ['toggleMute', 'mic1']]);
});

test('guarda la configuración y reconecta', () => {
  const { controller, tenveo, obs, saved } = setup();
  const settings = controller.dispatch('saveSettings', {
    ethernetIp: ' 192.168.1.188 ',
    obsHost: '127.0.0.1',
    obsPort: '4456',
    obsPassword: 'secreto',
  });
  assert.equal(settings.ethernetIp, '192.168.1.188');
  assert.equal(settings.obsPort, 4456);
  assert.equal(settings.hasObsPassword, true);
  assert.deepEqual(saved.at(-1), [{ ethernetIp: '192.168.1.188', obsHost: '127.0.0.1', obsPort: 4456, syncWithObs: true }, 'secreto']);
  assert.deepEqual(tenveo.calls.find(([n, ip]) => n === 'setEthernetIp' && ip === '192.168.1.188'), ['setEthernetIp', '192.168.1.188']);
  assert.deepEqual(obs.calls.filter(([n]) => n === 'configure').at(-1), ['configure', { host: '127.0.0.1', port: 4456, password: 'secreto' }]);

  // Contraseña vacía: queda la que estaba.
  controller.dispatch('saveSettings', { obsPassword: '' });
  assert.equal(saved.at(-1)[1], undefined);
  assert.equal(controller.snapshot().settings.hasObsPassword, true);

  // Quitar la contraseña.
  controller.dispatch('saveSettings', { clearObsPassword: true });
  assert.equal(saved.at(-1)[1], '');
  assert.equal(controller.snapshot().settings.hasObsPassword, false);
});

test('rechaza IP y puertos inválidos', () => {
  const { controller } = setup();
  assert.throws(() => controller.dispatch('saveSettings', { ethernetIp: 'http://x/' }), /IP no válida/);
  assert.throws(() => controller.dispatch('saveSettings', { obsPort: 70000 }), /Puerto de OBS no válido/);
  assert.throws(() => controller.dispatch('saveSettings', { obsHost: 'a b' }), /Dirección de OBS no válida/);
});

test('normaliza una configuración guardada', () => {
  assert.deepEqual(normalizeSettings({ ethernetIp: 'mal/ip', obsHost: '', obsPort: 'abc', syncWithObs: 'si' }), {
    ethernetIp: '',
    obsHost: '127.0.0.1',
    obsPort: 4455,
    syncWithObs: true,
  });
  assert.deepEqual(normalizeSettings({ ethernetIp: '10.0.0.5', obsHost: 'mac-estudio.local', obsPort: 4444, syncWithObs: false }), {
    ethernetIp: '10.0.0.5',
    obsHost: 'mac-estudio.local',
    obsPort: 4444,
    syncWithObs: false,
  });
});

test('la foto del estado no incluye los datos crudos del equipo', () => {
  const { controller, tenveo } = setup();
  tenveo.set({ raw: { mucho: 'ruido' } });
  assert.equal('raw' in controller.snapshot().switcher, false);
});
