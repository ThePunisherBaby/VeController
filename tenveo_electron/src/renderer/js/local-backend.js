// Modo navegador: el núcleo corre en la página y se conecta directo por WebSocket.
// El puente USB lo hace un proceso aparte (start_app.sh --web o tenveo_bridge.py).
// La configuración se guarda en el navegador. La contraseña de OBS solo dura la sesión.
//
// Para desarrollo se pueden cambiar las direcciones con la URL:
//   ?pc500=ws://127.0.0.1:18089&obs=127.0.0.1:14455
// Con ?demo la consola usa simuladores del PC500 y de OBS dentro de la página,
// sin red. Sirve para probarla desde cualquier dispositivo o un Codespace.

import { ObsService } from '../../core/obs-service.js';
import { createSimulatedWebSocket } from '../../core/simulated-websocket.js';
import { createObsSimulator, createPc500Simulator } from '../../core/simulators.js';
import { StudioController } from '../../core/studio-controller.js';
import { TenveoService } from '../../core/tenveo-service.js';

const STORAGE_KEY = 'tenveo-studio.settings';

function readSettings() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Almacenamiento bloqueado: la configuración dura solo esta sesión.
  }
}

export function createLocalBackend() {
  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
  const settings = demo ? {} : readSettings();

  const tenveoOptions = {};
  const obsOptions = {};
  if (demo) {
    tenveoOptions.usbUrl = 'ws://simulador:8089';
    tenveoOptions.WebSocketImpl = createSimulatedWebSocket(createPc500Simulator());
    obsOptions.WebSocketImpl = createSimulatedWebSocket(createObsSimulator());
    settings.obsHost = 'simulador';
  } else {
    const pc500 = params.get('pc500');
    if (pc500 && /^wss?:\/\//.test(pc500)) tenveoOptions.usbUrl = pc500;
    const obsParam = params.get('obs');
    if (obsParam) {
      const [host, port] = obsParam.split(':');
      if (host) settings.obsHost = host;
      if (port) settings.obsPort = Number(port);
    }
  }

  const controller = new StudioController({
    tenveo: new TenveoService(tenveoOptions),
    obs: new ObsService(obsOptions),
    settings,
    // En el modo demo no se guarda nada, para no pisar la configuración real.
    persist: demo ? () => {} : (next) => writeSettings(next),
    extras: { platform: 'browser', demo, adb: { state: 'browser', message: '' } },
  });
  controller.start();

  return {
    kind: 'browser',
    getState: async () => controller.snapshot(),
    send: async (type, ...args) => {
      try {
        return { ok: true, result: controller.dispatch(type, ...args) ?? null };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    onState: (callback) => controller.onChange(callback),
  };
}
