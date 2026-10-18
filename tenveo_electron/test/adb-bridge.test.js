import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdbBridge, adbCandidates, adbNetworkSerial, isNetworkSerial, parseAdbDevices, runFile } from '../src/main/adb-bridge.js';

const DEVICES = `List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:2
RV1126XYZ              device usb:1-1 product:rv1126 model:PC500 device:rv1126 transport_id:3
ABC123                 unauthorized usb:1-2 transport_id:4

`;

test('interpreta la salida de adb devices -l', () => {
  const devices = parseAdbDevices(DEVICES);
  assert.equal(devices.length, 3);
  assert.deepEqual(devices[1], { serial: 'RV1126XYZ', state: 'device', model: 'PC500', product: 'rv1126' });
  assert.equal(devices[2].state, 'unauthorized');
});

test('ignora los avisos del servidor de adb', () => {
  const out = '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n';
  assert.deepEqual(parseAdbDevices(out), []);
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

// --- adb por red: el video del PC500 por un cable directo ---

const LINK_LOCAL = 'fe80::10bf:b2ff:feee:6e2d%en0';
const NET_SERIAL = '[fe80::10bf:b2ff:feee:6e2d%en0]:5555';

// Un adb falso que recuerda qué equipos están conectados por red.
function fakeNetworkAdb({ connectOutput = null, alreadyConnected = false } = {}) {
  const calls = [];
  const connected = new Set(alreadyConnected ? [NET_SERIAL] : []);
  const run = async (_file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'devices') {
      const lines = [...connected].map((serial) => `${serial}\tdevice`);
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
  return { run, calls };
}

test('reconoce los equipos conectados por red', () => {
  assert.equal(isNetworkSerial(NET_SERIAL), true);
  assert.equal(isNetworkSerial('192.168.0.177:5555'), true);
  assert.equal(isNetworkSerial('adb-R58M._adb-tls-connect._tcp'), true);
  assert.equal(isNetworkSerial('RV1126XYZ'), false);
  assert.equal(adbNetworkSerial(LINK_LOCAL), NET_SERIAL);
  assert.equal(adbNetworkSerial('192.168.0.177'), '192.168.0.177:5555');
});

test('sin destino no toca adb', async () => {
  const { run, calls } = fakeNetworkAdb({ alreadyConnected: true });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  await bridge.start();
  assert.deepEqual(calls, []);
  assert.equal(bridge.status.state, 'off');
  assert.equal(bridge.status.rtmpForwarded, false);
  await bridge.stop();
  assert.deepEqual(calls, []);
});

test('conecta adb por red y reenvía el video del equipo', async () => {
  const { run, calls } = fakeNetworkAdb();
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.deepEqual(calls, ['devices -l', `connect ${NET_SERIAL}`, 'devices -l', `-s ${NET_SERIAL} forward tcp:19350 tcp:1935`]);
  assert.equal(bridge.status.state, 'ready');
  assert.equal(bridge.status.rtmpForwarded, true);

  await bridge.stop();
  // Quita el reenvío y desconecta lo que conectó.
  assert.deepEqual(calls.slice(4), [`-s ${NET_SERIAL} forward --remove tcp:19350`, `disconnect ${NET_SERIAL}`]);
  assert.equal(bridge.status.rtmpForwarded, false);
});

test('si otro programa ya lo había conectado, al salir no lo desconecta', async () => {
  const { run, calls } = fakeNetworkAdb({ alreadyConnected: true });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.deepEqual(calls, ['devices -l', `-s ${NET_SERIAL} forward tcp:19350 tcp:1935`]);
  await bridge.stop();
  assert.deepEqual(calls.slice(2), [`-s ${NET_SERIAL} forward --remove tcp:19350`]);
});

test('al quitar el destino suelta el reenvío', async () => {
  const { run, calls } = fakeNetworkAdb();
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  bridge.setNetworkTarget('');
  await bridge.tick();
  assert.deepEqual(calls.slice(4), [`-s ${NET_SERIAL} forward --remove tcp:19350`, `disconnect ${NET_SERIAL}`]);
  assert.equal(bridge.status.state, 'off');
  assert.equal(bridge.status.rtmpForwarded, false);
  await bridge.stop();
});

test('si adb por red falla, avisa y espera antes de reintentar', async () => {
  const { run, calls } = fakeNetworkAdb({ connectOutput: 'failed to connect to [fe80::1%en0]:5555: Connection refused\n' });
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget('fe80::1%en0');
  await bridge.start();
  assert.equal(bridge.status.state, 'error');
  assert.match(bridge.status.message, /Connection refused/);
  assert.equal(bridge.status.rtmpForwarded, false);
  const connects = () => calls.filter((line) => line.startsWith('connect')).length;
  assert.equal(connects(), 1);
  await bridge.tick();
  await bridge.tick();
  assert.equal(connects(), 1);
  await bridge.stop();
});

test('si adb quedó con la ruta vieja, reinicia su servidor y vuelve a probar', async () => {
  const calls = [];
  let restarted = false;
  const run = async (_file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'kill-server') restarted = true;
    if (args[0] === 'connect') {
      return { stdout: restarted ? `connected to ${args[1]}\n` : `failed to connect to '${args[1]}': No route to host\n`, stderr: '' };
    }
    if (args[0] === 'devices') {
      return { stdout: `List of devices attached\n${restarted ? `${NET_SERIAL}\tdevice\n` : ''}`, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 60000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.deepEqual(calls.slice(0, 4), ['devices -l', `connect ${NET_SERIAL}`, 'kill-server', `connect ${NET_SERIAL}`]);
  assert.equal(bridge.status.state, 'ready');
  await bridge.stop();
});

test('un adb trabado no deja esperando al puente', async () => {
  // Un proceso que no termina cuando se le pide, como un adb trabado dentro
  // del sistema: execFile esperaría a que termine solo.
  const started = Date.now();
  await assert.rejects(runFile('/bin/sh', ['-c', "trap '' TERM; sleep 4"], 300), /adb no respondió/);
  assert.ok(Date.now() - started < 2500);
});

test('si adb queda trabado, espera cada vez más entre intentos y no intenta limpiar', async () => {
  const calls = [];
  const run = async (_file, args) => {
    calls.push(args.join(' '));
    throw new Error('adb no respondió');
  };
  const bridge = new AdbBridge({ adbPath: '/fake/adb', run, pollMs: 1000 });
  bridge.setNetworkTarget(LINK_LOCAL);
  await bridge.start();
  assert.equal(bridge.status.state, 'error');
  assert.match(bridge.status.message, /adb no responde/);
  // 10 veces el intervalo normal la primera vez, y crece.
  assert.equal(bridge.nextWaitMs, 10000);
  await bridge.stop();
  // Con adb trabado no se lanzan más comandos para limpiar.
  assert.deepEqual(calls, ['devices -l']);
});
