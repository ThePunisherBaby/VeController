import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdbBridge, adbCandidates, parseAdbDevices, pickDevice } from '../src/main/adb-bridge.js';

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
  assert.deepEqual(calls, ['devices -l', '-s SER1 forward tcp:8089 tcp:8089', '-s SER1 forward tcp:8080 tcp:80']);
  assert.equal(bridge.status.state, 'forwarded');
  assert.equal(bridge.status.panelForwarded, true);
  await bridge.stop();
  assert.deepEqual(calls.slice(3), ['-s SER1 forward --remove tcp:8089', '-s SER1 forward --remove tcp:8080']);
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
