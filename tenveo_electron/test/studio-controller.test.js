import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObsState } from '../src/core/obs-service.js';
import { createSwitcherState } from '../src/core/pc500-protocol.js';
import {
  DEFAULT_SETTINGS,
  StudioController,
  findSceneForCamera,
  normalizeSettings,
} from '../src/core/studio-controller.js';

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
  setMode(mode) { return this.record('setMode', mode); }
  setEthernetIp(ip) { return this.record('setEthernetIp', ip); }
  selectPreview(cam) { return this.record('selectPreview', cam); }
  switchLive(cam) { return this.record('switchLive', cam); }
  cut() { return this.record('cut'); }
  auto() { return this.record('auto'); }
  ftb() { return this.record('ftb'); }
  setTbar(pos) { return this.record('setTbar', pos); }
  setVolume(ch, db) { return this.record('setVolume', ch, db); }
  toggleMute(ch) { return this.record('toggleMute', ch); }
  pressButton(id) { return this.record('pressButton', id); }
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
  assert.throws(() => controller.dispatch('pressButton', 'sys_ip'), /Botón desconocido/);
  assert.throws(() => controller.dispatch('setConnectionMode', 'wifi'), /Modo de conexión desconocido/);
  assert.throws(() => controller.dispatch('setVideoSource', 'ndi'), /Fuente de video desconocida/);
  controller.dispatch('switchLive', 'aux');
  controller.dispatch('toggleMute', 'mic1');
  controller.dispatch('pressButton', 'stream_2');
  assert.deepEqual(tenveo.calls.slice(-3), [['switchLive', 'aux'], ['toggleMute', 'mic1'], ['pressButton', 'stream_2']]);
});

test('crea y guarda una clave de video desde el primer arranque', () => {
  const { controller, saved } = setup();
  const key = controller.snapshot().settings.videoKey;
  assert.match(key, /^tenveo[a-z0-9]{1,8}$/);
  assert.equal(saved[0][0].videoKey, key);
  const again = setup({ settings: { videoKey: 'mia_123' } });
  assert.equal(again.controller.snapshot().settings.videoKey, 'mia_123');
  assert.equal(again.saved.length, 0);
});

test('cambia y guarda el modo de conexión y la fuente de video', () => {
  const { controller, tenveo, saved } = setup();
  controller.dispatch('setConnectionMode', 'network');
  assert.deepEqual(tenveo.calls.at(-1), ['setMode', 'network']);
  assert.equal(saved.at(-1)[0].connectionMode, 'network');
  controller.dispatch('setVideoSource', 'usb', 'camara-123');
  assert.equal(saved.at(-1)[0].videoSource, 'usb');
  assert.equal(saved.at(-1)[0].videoDeviceId, 'camara-123');
});

test('aprende la IP que informa el equipo por USB', () => {
  const { controller, tenveo } = setup();
  tenveo.set({ connection: 'usb', device: { ...tenveo.state.device, ip: '192.168.1.50' } });
  assert.equal(controller.snapshot().settings.ethernetIp, '192.168.1.50');
  assert.equal(controller.snapshot().settings.ethernetIpSource, 'auto');
  assert.deepEqual(tenveo.calls.at(-1), ['setEthernetIp', '192.168.1.50']);

  // Si el equipo cambia de IP, la aprendida se actualiza.
  tenveo.set({ device: { ...tenveo.state.device, ip: '192.168.1.60' } });
  assert.equal(controller.snapshot().settings.ethernetIp, '192.168.1.60');
});

test('nunca pisa una IP escrita a mano ni aprende por Ethernet', () => {
  const manual = setup({ settings: { ethernetIp: '10.0.0.9', ethernetIpSource: 'manual' } });
  manual.tenveo.set({ connection: 'usb', device: { ...manual.tenveo.state.device, ip: '192.168.1.50' } });
  assert.equal(manual.controller.snapshot().settings.ethernetIp, '10.0.0.9');

  const lan = setup();
  lan.tenveo.set({ connection: 'ethernet', device: { ...lan.tenveo.state.device, ip: '192.168.1.50' } });
  assert.equal(lan.controller.snapshot().settings.ethernetIp, '');
});

test('guarda la configuración y reconecta', () => {
  const { controller, tenveo, obs, saved } = setup();
  const settings = controller.dispatch('saveSettings', {
    ethernetIp: ' 192.168.1.188 ',
    connectionMode: 'auto',
    obsHost: '127.0.0.1',
    obsPort: '4456',
    obsPassword: 'secreto',
    videoSource: 'push',
    rtmpPort: '1936',
  });
  assert.equal(settings.ethernetIp, '192.168.1.188');
  assert.equal(settings.ethernetIpSource, 'manual');
  assert.equal(settings.obsPort, 4456);
  assert.equal(settings.videoSource, 'push');
  assert.equal(settings.rtmpPort, 1936);
  assert.equal(settings.hasObsPassword, true);
  const [lastSettings, lastPassword] = saved.at(-1);
  assert.equal(lastSettings.ethernetIp, '192.168.1.188');
  assert.equal(lastPassword, 'secreto');
  assert.ok(tenveo.calls.some(([n, ip]) => n === 'setEthernetIp' && ip === '192.168.1.188'));
  assert.deepEqual(obs.calls.filter(([n]) => n === 'configure').at(-1), ['configure', { host: '127.0.0.1', port: 4456, password: 'secreto' }]);

  controller.dispatch('saveSettings', { obsPassword: '' });
  assert.equal(saved.at(-1)[1], undefined);
  assert.equal(controller.snapshot().settings.hasObsPassword, true);

  controller.dispatch('saveSettings', { clearObsPassword: true });
  assert.equal(saved.at(-1)[1], '');
  assert.equal(controller.snapshot().settings.hasObsPassword, false);
});

test('rechaza valores inválidos al guardar', () => {
  const { controller } = setup();
  assert.throws(() => controller.dispatch('saveSettings', { ethernetIp: 'http://x/' }), /IP no válida/);
  assert.throws(() => controller.dispatch('saveSettings', { obsPort: 70000 }), /Puerto de OBS no válido/);
  assert.throws(() => controller.dispatch('saveSettings', { obsHost: 'a b' }), /Dirección de OBS no válida/);
  assert.throws(() => controller.dispatch('saveSettings', { connectionMode: 'bluetooth' }), /Modo de conexión no válido/);
  assert.throws(() => controller.dispatch('saveSettings', { videoSource: 'ndi' }), /Fuente de video no válida/);
  assert.throws(() => controller.dispatch('saveSettings', { rtmpPort: 0 }), /Puerto RTMP no válido/);
});

test('normaliza una configuración guardada', () => {
  const bad = normalizeSettings({
    ethernetIp: 'mal/ip',
    obsHost: '',
    obsPort: 'abc',
    syncWithObs: 'si',
    connectionMode: 'x',
    videoSource: 'ndi',
    videoKey: 'con espacios',
    rtmpPort: 99999,
  });
  assert.deepEqual(bad, { ...DEFAULT_SETTINGS });

  const good = normalizeSettings({
    ethernetIp: '10.0.0.5',
    ethernetIpSource: 'auto',
    connectionMode: 'network',
    obsHost: 'mac-estudio.local',
    obsPort: 4444,
    syncWithObs: false,
    videoSource: 'pull',
    videoDeviceId: 'abc',
    videoKey: 'clave_1',
    rtmpPort: 1936,
  });
  assert.equal(good.connectionMode, 'network');
  assert.equal(good.videoSource, 'pull');
  assert.equal(good.videoKey, 'clave_1');
  assert.equal(good.rtmpPort, 1936);
  assert.equal(good.ethernetIpSource, 'auto');
});

test('la foto del estado no incluye los datos crudos del equipo', () => {
  const { controller, tenveo } = setup();
  tenveo.set({ raw: { mucho: 'ruido' } });
  assert.equal('raw' in controller.snapshot().switcher, false);
});
