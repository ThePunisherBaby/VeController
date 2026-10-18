import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdbBridge, adbCandidates, adbNetworkSerial, isNetworkSerial, parseAdbDevices, pickDevice } from '../src/main/adb-bridge.js';

const DEVICES = `List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:2
RV1126XYZ              device usb:1-1 product:rv1126 model:PC500 device:rv1126 transport_id:3
ABC123                 unauthorized usb:1-2 transport_id:4

`;

function fakeRun(devicesOutput, { failOn = null } = {}) {
  const calls = [];
  const run = async (_file, args) => {
    const line = args.join(' ');
    calls.push(line);
    if (failOn && line.includes(failOn)) throw new Error('cannot bind listener: Address already in use');
    if (args[0] === 'devices') return { stdout: devicesOutput, stderr: '' };
    return { stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('interpreta la salida de adb devices -l', () => {
  const devices = parseAdbDevices(DEVICES);
  assert.equal(devices.length, 3);
  assert.deepEqual(devices[1], { serial: 'RV1126XYZ', state: 'device', model: 'PC500', product: 'rv1126' });
  assert.equal(devices[2].state, 'unauthorized');
});

test('prefiere el equipo real antes que un emulador', () => {
  assert.equal(pickDevice(parseAdbDevices(DEVICES)).serial, 'RV1126XYZ');
  assert.equal(pickDevice(parseAdbDevices('List of devices attached\nemulator-5554\tdevice\n')).serial, 'emulator-5554');
  assert.equal(pickDevice([]), null);
});

test('ignora los avisos del servidor de adb', () => {
  const out = '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n';
  assert.deepEqual(parseAdbDevices(out), []);
});

test('reenvía los puertos del equipo y los quita al detenerse', async () => {
  const { run, calls } = fakeRun('List of devices attached\nSER1\tdevice\n');
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.deepEqual(calls, [
    'devices -l',
    '-s SER1 forward tcp:8089 tcp:8089',
    '-s SER1 forward tcp:8080 tcp:80',
    '-s SER1 forward tcp:19350 tcp:1935',
  ]);
  assert.equal(bridge.status.state, 'forwarded');
  assert.equal(bridge.status.panelForwarded, true);
  assert.equal(bridge.status.rtmpForwarded, true);
  await bridge.stop();
  assert.deepEqual(calls.slice(4), [
    '-s SER1 forward --remove tcp:8089',
    '-s SER1 forward --remove tcp:8080',
    '-s SER1 forward --remove tcp:19350',
  ]);
  assert.equal(bridge.status.state, 'stopped');
});

test('si el puerto del panel está ocupado, el WebSocket sigue funcionando', async () => {
  const { run } = fakeRun('List of devices attached\nSER1\tdevice\n', { failOn: 'tcp:8080' });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.equal(bridge.status.state, 'forwarded');
  assert.equal(bridge.status.panelForwarded, false);
  await bridge.stop();
});

test('si falla el reenvío del WebSocket, avisa del error', async () => {
  const { run } = fakeRun('List of devices attached\nSER1\tdevice\n', { failOn: 'tcp:8089' });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.equal(bridge.status.state, 'error');
  assert.match(bridge.status.message, /tcp:8089/);
  await bridge.stop();
});

test('avisa si el equipo pide autorización', async () => {
  const { run } = fakeRun('List of devices attached\nSER1\tunauthorized\n');
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.equal(bridge.status.state, 'unauthorized');
  await bridge.stop();
});

test('sin equipo queda esperando y no quita nada al salir', async () => {
  const { run, calls } = fakeRun('List of devices attached\n\n');
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.equal(bridge.status.state, 'waiting');
  await bridge.stop();
  assert.deepEqual(calls, ['devices -l']);
});

test('sin adb avisa cómo instalarlo', async () => {
  const bridge = new AdbBridge({ finder: async () => null });
  await bridge.start();
  assert.equal(bridge.status.state, 'no-adb');
  assert.match(bridge.status.message, /brew install android-platform-tools/);
  await bridge.stop();
});

test('busca primero la copia de adb incluida en la app', () => {
  const list = adbCandidates({
    env: { PATH: '/usr/bin:/opt/sdk/platform-tools', ANDROID_HOME: '/sdk' },
    resourcesPath: '/App/Contents/Resources',
    vendorDir: '/proyecto/vendor',
    home: '/Users/alguien',
  });
  assert.equal(list[0], '/App/Contents/Resources/platform-tools/adb');
  assert.equal(list[1], '/proyecto/vendor/platform-tools/adb');
  assert.ok(list.includes('/sdk/platform-tools/adb'));
  assert.ok(list.includes('/opt/sdk/platform-tools/adb'));
  assert.equal(new Set(list).size, list.length);
});

// --- adb por red: cable directo sin IPv4 en común ---

const LINK_LOCAL = 'fe80::10bf:b2ff:feee:6e2d%en0';
const NET_SERIAL = '[fe80::10bf:b2ff:feee:6e2d%en0]:5555';

// Un adb falso que recuerda qué equipos están conectados por red.
function fakeNetworkAdb({ connectOutput = null, alreadyConnected = false } = {}) {
  const calls = [];
  const connected = new Set(alreadyConnected ? [NET_SERIAL] : []);
  let usb = '';
  const run = async (_file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'devices') {
      const lines = [usb ? `${usb}\tdevice` : '', ...[...connected].map((serial) => `${serial}\tdevice`)].filter(Boolean);
      return { stdout: `List of devices attached\n${lines.join('\n')}\n`, stderr: '' };
    }
    if (args[0] === 'connect') {
      if (connectOutput) return { stdout: connectOutput, stderr: '' };
      const already = connected.has(args[1]);
      connected.add(args[1]);
      return { stdout: `${already ? 'already connected' : 'connected'} to ${args[1]}\n`, stderr: '' };
    }
    if (args[0] === 'disconnect') connected.delete(args[1]);
    return { stdout: '', stderr: '' };
  };
  return { run, calls, plugUsb: (serial) => { usb = serial; } };
}

test('reconoce los equipos conectados por red', () => {
  assert.equal(isNetworkSerial(NET_SERIAL), true);
  assert.equal(isNetworkSerial('192.168.0.177:5555'), true);
  assert.equal(isNetworkSerial('adb-R58M._adb-tls-connect._tcp'), true);
  assert.equal(isNetworkSerial('RV1126XYZ'), false);
  assert.equal(isNetworkSerial('emulator-5554'), false);
  assert.equal(adbNetworkSerial(LINK_LOCAL), NET_SERIAL);
  assert.equal(adbNetworkSerial('192.168.0.177'), '192.168.0.177:5555');
});

test('sin USB, conecta adb por red y reenvía solo el RTMP del equipo', async () => {
  const { run, calls } = fakeNetworkAdb();
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.deepEqual(calls, ['devices -l', `connect ${NET_SERIAL}`, 'devices -l', `-s ${NET_SERIAL} forward tcp:19350 tcp:1935`]);
  assert.equal(bridge.status.state, 'waiting');
  assert.equal(bridge.status.rtmpForwarded, true);
  assert.equal(bridge.status.rtmpVia, 'network');
  assert.equal(bridge.status.network.state, 'ready');

  await bridge.stop();
  // Quita el reenvío y desconecta lo que conectó.
  assert.deepEqual(calls.slice(4), [`-s ${NET_SERIAL} forward --remove tcp:19350`, `disconnect ${NET_SERIAL}`]);
  assert.equal(bridge.status.rtmpForwarded, false);
});

test('el equipo por red no se toma como USB ni recibe el WebSocket', async () => {
  const { run, calls } = fakeNetworkAdb({ alreadyConnected: true });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  // Sin destino de red pedido no se toca el equipo conectado por otro programa.
  assert.deepEqual(calls, ['devices -l']);
  assert.equal(bridge.status.state, 'waiting');
  assert.equal(bridge.status.rtmpForwarded, false);

  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.tick();
  assert.deepEqual(calls.slice(1), ['devices -l', `-s ${NET_SERIAL} forward tcp:19350 tcp:1935`]);
  await bridge.stop();
  // Lo había conectado otro programa: se quita el reenvío pero no se desconecta.
  assert.deepEqual(calls.slice(3), [`-s ${NET_SERIAL} forward --remove tcp:19350`]);
});

test('al enchufar el USB, el USB lleva el video y la red se suelta', async () => {
  const adb = fakeNetworkAdb();
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run: adb.run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.equal(bridge.status.rtmpVia, 'network');

  adb.plugUsb('SER1');
  await bridge.tick();
  assert.equal(bridge.status.state, 'forwarded');
  assert.equal(bridge.status.rtmpVia, 'usb');
  assert.equal(bridge.status.network.state, 'off');
  // La red se suelta antes de reenviar por USB: el puerto 19350 local queda libre.
  assert.deepEqual(adb.calls.slice(4, 7), ['devices -l', `-s ${NET_SERIAL} forward --remove tcp:19350`, `disconnect ${NET_SERIAL}`]);
  assert.ok(adb.calls.slice(7).includes('-s SER1 forward tcp:19350 tcp:1935'));
  await bridge.stop();
});

test('si adb por red falla, avisa y espera antes de reintentar', async () => {
  const { run, calls } = fakeNetworkAdb({ connectOutput: 'failed to connect to [fe80::1%en0]:5555: Connection refused\n' });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget('fe80::1%en0');
  await bridge.start();
  assert.equal(bridge.status.network.state, 'error');
  assert.match(bridge.status.network.message, /Connection refused/);
  assert.equal(bridge.status.rtmpForwarded, false);
  const connects = () => calls.filter((line) => line.startsWith('connect')).length;
  assert.equal(connects(), 1);
  await bridge.tick();
  await bridge.tick();
  assert.equal(connects(), 1);
  await bridge.stop();
});
