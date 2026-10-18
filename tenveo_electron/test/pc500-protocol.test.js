import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyDeviceUpdate,
  cameraLabel,
  channelMode,
  cmdChannelOn,
  cmdSelectPreview,
  cmdTbar,
  cmdVolume,
  createSwitcherState,
  isActiveValue,
  isChannelMuted,
} from '../src/core/pc500-protocol.js';

test('lee PGM y PVW desde las clases de los botones', () => {
  const state = applyDeviceUpdate(createSwitcherState(), {
    'pvw-1': 'none-white',
    'pvw-3': 'active-red',
    'pvw-4': 'active-green',
  });
  assert.equal(state.pgm, '3');
  assert.equal(state.pvw, '4');
});

test('un botón que parpadea no cambia PGM ni PVW', () => {
  const state = applyDeviceUpdate(createSwitcherState(), { 'pvw-3': 'flash-red' });
  assert.equal(state.pgm, '1');
});

test('lee volúmenes, interruptores y modos de audio', () => {
  const state = applyDeviceUpdate(createSwitcherState(), {
    audio_pgm_vol: -12.5,
    audio_in1_vol: -30,
    audio_pgm_on: 0,
    audio_mic1_on: 1,
    audio_in2_mode: 0,
    audio_in3_mode: 2,
  });
  assert.equal(state.volumes.pgm, -12.5);
  assert.equal(state.volumes.in1, -30);
  assert.equal(isChannelMuted(state, 'pgm'), true);
  assert.equal(channelMode(state, 'mic1'), 'ON');
  assert.equal(isChannelMuted(state, 'in2'), true);
  assert.equal(channelMode(state, 'in3'), 'AFV');
  assert.equal(channelMode(state, 'in4'), 'ON');
});

test('audio_mic1_mode es Line in o Mic, no apaga el micrófono', () => {
  const state = applyDeviceUpdate(createSwitcherState(), { audio_mic1_mode: 0 });
  assert.equal(isChannelMuted(state, 'mic1'), false);
});

test('detecta CUT, AUTO y FTB encendidos', () => {
  const on = applyDeviceUpdate(createSwitcherState(), { ftb: 'active-red', auto: 'active-white', cut: 1 });
  assert.equal(on.ftb, true);
  assert.equal(on.auto, true);
  assert.equal(on.cut, true);
  const off = applyDeviceUpdate(on, { ftb: 'none-red', auto: 'none-white', cut: 0 });
  assert.equal(off.ftb, false);
  assert.equal(off.auto, false);
  assert.equal(off.cut, false);
  assert.equal(isActiveValue('flash-yellow'), true);
  assert.equal(isActiveValue('none-red'), false);
});

test('ignora mensajes que no son objetos', () => {
  const base = createSwitcherState();
  assert.equal(applyDeviceUpdate(base, null), base);
  assert.equal(applyDeviceUpdate(base, [1, 2]), base);
  assert.equal(applyDeviceUpdate(base, 'texto'), base);
});

test('arma los comandos con las claves del panel original', () => {
  assert.deepEqual(cmdSelectPreview('aux'), { 'pvw-aux': 1 });
  assert.throws(() => cmdSelectPreview('9'), RangeError);
  assert.deepEqual(cmdVolume('pgm', 6), { audio_pgm_vol: 0 });
  assert.deepEqual(cmdVolume('in1', -80), { audio_in1_vol: -60 });
  assert.deepEqual(cmdVolume('mic1', -12.4), { audio_mic1_vol: -12 });
  assert.throws(() => cmdVolume('hp9', -6), RangeError);
  assert.deepEqual(cmdChannelOn('pgm', false), { audio_pgm_on: 0 });
  assert.deepEqual(cmdChannelOn('mic1', true), { audio_mic1_on: 1 });
  assert.deepEqual(cmdChannelOn('in4', false), { audio_in4_mode: 0 });
  assert.deepEqual(cmdChannelOn('in4', true), { audio_in4_mode: 1 });
});

test('la T-Bar va de 0 a 255', () => {
  assert.deepEqual(cmdTbar(0), { putter: 0 });
  assert.deepEqual(cmdTbar(0.5), { putter: 128 });
  assert.deepEqual(cmdTbar(1), { putter: 255 });
  assert.deepEqual(cmdTbar(3), { putter: 255 });
  assert.deepEqual(cmdTbar(-1), { putter: 0 });
  assert.deepEqual(cmdTbar('basura'), { putter: 0 });
});

test('nombres de cámaras', () => {
  assert.equal(cameraLabel('1'), 'CAMERA 1 (HDMI 1)');
  assert.equal(cameraLabel('aux'), 'AUX (MEDIA / NDI)');
  assert.equal(cameraLabel('7'), 'CAMERA 7');
});
