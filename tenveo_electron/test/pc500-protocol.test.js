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

// --- Botones del panel, datos del equipo y transmisión ---

import {
  buttonLight,
  cmdButton,
  deviceStreamServer,
  deviceVideoPlan,
  isIPv4,
  isPanelButton,
  isStreaming,
  streamDestinations,
} from '../src/core/pc500-protocol.js';

test('guarda la luz de los botones del panel y los datos del equipo', () => {
  const state = applyDeviceUpdate(createSwitcherState(), {
    stream: 'active-green',
    dsk: 'flash-green',
    logo1: 'none-white',
    sys_ip: '192.168.1.188',
    system_version: 'V1.2.3',
    stream_time: '00:01:05',
    record_time: 12,
  });
  assert.equal(state.buttons.stream, 'active-green');
  assert.deepEqual(buttonLight(state.buttons.stream), { on: true, color: 'green', flash: false });
  assert.deepEqual(buttonLight(state.buttons.dsk), { on: true, color: 'green', flash: true });
  assert.equal(buttonLight(state.buttons.logo1).on, false);
  assert.deepEqual(state.device, { ip: '192.168.1.188', version: 'V1.2.3', streamTime: '00:01:05', recordTime: '12' });
});

test('un {id: 1} que el equipo devuelve tal cual no enciende la luz', () => {
  // El PC500 guarda los comandos que recibe y se los manda a quien se conecta.
  assert.equal(buttonLight(1).on, false);
  assert.equal(buttonLight(true).on, false);
  assert.equal(buttonLight('none-green').on, false);
});

test('una IP mal formada del equipo se ignora', () => {
  const state = applyDeviceUpdate(createSwitcherState(), { sys_ip: '999.1.1.1' });
  assert.equal(state.device.ip, '');
  assert.equal(isIPv4('10.0.0.1'), true);
  assert.equal(isIPv4('10.0.0'), false);
});

test('los botones del panel se mandan como {id: 1} y solo los conocidos', () => {
  assert.deepEqual(cmdButton('pip1-on-air'), { 'pip1-on-air': 1 });
  assert.deepEqual(cmdButton('stream'), { stream: 1 });
  // STREAM 2 está siempre desactivado en el panel original.
  assert.throws(() => cmdButton('stream_2'), RangeError);
  assert.throws(() => cmdButton('sys_ip'), RangeError);
  assert.equal(isPanelButton('rec'), true);
  assert.equal(isPanelButton('pvw-1'), false);
});

// Estado como lo manda el PC500 real: los dos destinos en su servidor interno.
function deviceWith(update) {
  return applyDeviceUpdate(createSwitcherState(), {
    sys_ip: '192.168.0.177',
    stream: 'none-green',
    stream_time: '00:00:00',
    'stream-1-server': 'rtmp://192.168.0.177:1935/live/',
    'stream-1-key': 'live1',
    'stream-2-server': 'rtmp://192.168.0.177:1935/live/',
    'stream-2-key': 'live2',
    ...update,
  });
}

test('reconoce el servidor RTMP interno del equipo', () => {
  assert.equal(deviceStreamServer('rtmp://192.168.0.177:1935/live/', '192.168.0.177'), true);
  assert.equal(deviceStreamServer('rtmp://192.168.0.177/live', '192.168.0.177'), true);
  assert.equal(deviceStreamServer('rtmp://127.0.0.1:1935/live/', ''), true);
  assert.equal(deviceStreamServer('rtmp://a.rtmp.youtube.com/live2', '192.168.0.177'), false);
  assert.equal(deviceStreamServer('rtmp://192.168.0.177:1936/live/', '192.168.0.177'), false);
  assert.equal(deviceStreamServer('rtmp://192.168.0.50:1935/live/', '192.168.0.177'), false);
  assert.equal(deviceStreamServer('', '192.168.0.177'), false);
});

test('lee los destinos de STREAM y si está transmitiendo', () => {
  const state = deviceWith({});
  assert.deepEqual(streamDestinations(state), [
    { slot: 1, server: 'rtmp://192.168.0.177:1935/live/', key: 'live1' },
    { slot: 2, server: 'rtmp://192.168.0.177:1935/live/', key: 'live2' },
  ]);
  assert.equal(isStreaming(state), false);
  assert.equal(isStreaming(deviceWith({ stream: 'active-green' })), true);
  // Aunque la luz no haya llegado, el contador corriendo dice que transmite.
  assert.equal(isStreaming(deviceWith({ stream: 1, stream_time: '00:00:07' })), true);
});

test('con los dos destinos en el equipo se puede encender y apagar STREAM', () => {
  const plan = deviceVideoPlan(deviceWith({}));
  // Se lee el destino 2: el 1 queda para la plataforma del usuario.
  assert.equal(plan.key, 'live2');
  assert.equal(plan.slot, 2);
  assert.equal(plan.canStart, true);
  assert.equal(plan.canStop, false);
  const live = deviceVideoPlan(deviceWith({ stream: 'active-green' }));
  assert.equal(live.canStart, false);
  assert.equal(live.canStop, true);
});

test('nunca enciende ni apaga STREAM si un destino sale a internet', () => {
  const youtube = { 'stream-1-server': 'rtmp://a.rtmp.youtube.com/live2', 'stream-1-key': 'abcd-1234' };
  const off = deviceVideoPlan(deviceWith(youtube));
  assert.equal(off.key, 'live2');
  assert.equal(off.canStart, false);
  assert.deepEqual(off.external, ['rtmp://a.rtmp.youtube.com/live2']);
  const onAir = deviceVideoPlan(deviceWith({ ...youtube, stream: 'active-green' }));
  assert.equal(onAir.canStop, false);
  // Sin destino interno no hay nada que leer.
  const none = deviceVideoPlan(deviceWith({ ...youtube, 'stream-2-server': 'rtmp://live.twitch.tv/app' }));
  assert.equal(none.key, '');
  assert.equal(none.canStart, false);
});

test('un destino hacia esta Mac cuenta como local', () => {
  const toMac = { 'stream-1-server': 'rtmp://192.168.0.50:1935/live', 'stream-1-key': 'tenveo' };
  assert.equal(deviceVideoPlan(deviceWith(toMac)).canStart, false);
  const isLocal = (server) => server.startsWith('rtmp://192.168.0.50:1935/');
  assert.equal(deviceVideoPlan(deviceWith(toMac), { isLocal }).canStart, true);
});
