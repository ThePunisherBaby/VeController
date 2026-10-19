import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSwitcherState } from '../src/core/pc500-protocol.js';
import { DEFAULT_SETTINGS, StudioController, normalizeSettings } from '../src/core/studio-controller.js';

class FakeTenveo {
  constructor() {
    this.state = createSwitcherState();
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
  pressButton(id) { return this.record('pressButton', id); }
}

function setup(options = {}) {
  const tenveo = new FakeTenveo();
  const saved = [];
  const controller = new StudioController({ tenveo, persist: (settings) => saved.push(settings), ...options });
  controller.start();
  return { tenveo, controller, saved };
}

test('avisa de cada cambio del PC500 con una foto del estado', () => {
  const { tenveo, controller } = setup();
  const seen = [];
  controller.onChange((snapshot) => seen.push(snapshot.switcher.pgm));
  tenveo.set({ pgm: '2' });
  tenveo.set({ pgm: '3' });
  assert.deepEqual(seen, ['2', '3']);
});

test('solo acepta comandos y valores conocidos', () => {
  const { controller, tenveo } = setup();
  assert.throws(() => controller.dispatch('borrarTodo'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('constructor'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('__proto__'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('selectPreview', '9'), /Cámara desconocida/);
  assert.throws(() => controller.dispatch('setVolume', 'xx', -6), /Canal desconocido/);
  assert.throws(() => controller.dispatch('pressButton', 'sys_ip'), /Botón desconocido/);
  // Ya no hay modos USB, fuentes de video ni OBS.
  assert.throws(() => controller.dispatch('setConnectionMode', 'usb'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('obsToggleStream'), /Comando desconocido/);
  assert.throws(() => controller.dispatch('toggleObsSync'), /Comando desconocido/);
  controller.dispatch('switchLive', 'aux');
  controller.dispatch('toggleMute', 'mic1');
  controller.dispatch('pressButton', 'stream');
  assert.deepEqual(tenveo.calls.slice(-3), [['switchLive', 'aux'], ['toggleMute', 'mic1'], ['pressButton', 'stream']]);
});

test('arranca conectando a la IP guardada, sin escribir nada', () => {
  const { tenveo, saved } = setup({ settings: { ethernetIp: 'fe80::1%en0' } });
  assert.ok(tenveo.calls.some(([n, ip]) => n === 'setEthernetIp' && ip === 'fe80::1%en0'));
  assert.equal(saved.length, 0);
});

test('guarda la configuración y reconecta', () => {
  const { controller, tenveo, saved } = setup();
  const settings = controller.dispatch('saveSettings', { ethernetIp: ' 192.168.1.188 ' });
  assert.equal(settings.ethernetIp, '192.168.1.188');
  assert.equal(saved.at(-1).ethernetIp, '192.168.1.188');
  assert.ok(tenveo.calls.some(([n, ip]) => n === 'setEthernetIp' && ip === '192.168.1.188'));
  assert.ok(tenveo.calls.some(([n]) => n === 'retry'));
});

test('rechaza una IP inválida al guardar', () => {
  const { controller } = setup();
  assert.throws(() => controller.dispatch('saveSettings', { ethernetIp: 'http://x/' }), /IP no válida/);
});

test('normaliza una configuración guardada y descarta las opciones viejas', () => {
  assert.deepEqual(normalizeSettings({ ethernetIp: 'mal/ip', appearance: 'azul' }), { ...DEFAULT_SETTINGS });

  // Una configuración de la 1.5.0, con OBS, y otra de la 1.2.0, con modos USB.
  const old = normalizeSettings({
    ethernetIp: 'fe80::10bf:b2ff:feee:6e2d%en0',
    connectionMode: 'usb',
    obsHost: 'mac-estudio.local',
    obsPort: 4444,
    syncWithObs: false,
    videoSource: 'usb',
    appearance: 'light',
  });
  assert.deepEqual(old, { ethernetIp: 'fe80::10bf:b2ff:feee:6e2d%en0', appearance: 'light' });
});

test('la apariencia sigue al sistema y se puede fijar en oscura o clara', () => {
  const { controller, saved } = setup();
  assert.equal(controller.snapshot().settings.appearance, 'system');

  controller.dispatch('setAppearance', 'light');
  assert.equal(controller.snapshot().settings.appearance, 'light');
  assert.equal(saved.at(-1).appearance, 'light');

  assert.throws(() => controller.dispatch('setAppearance', 'sepia'), /Apariencia desconocida/);
  assert.equal(controller.snapshot().settings.appearance, 'light');
});

test('la foto del estado no incluye los datos crudos del equipo ni OBS', () => {
  const { controller, tenveo } = setup();
  tenveo.set({ raw: { mucho: 'ruido' } });
  const snapshot = controller.snapshot();
  assert.equal('raw' in snapshot.switcher, false);
  assert.equal('obs' in snapshot, false);
});
