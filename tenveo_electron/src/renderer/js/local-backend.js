// Modo navegador: el núcleo corre en la página y se conecta directo por WebSocket.
// La configuración se guarda en el navegador.
//
// Para desarrollo se puede cambiar la dirección del PC500 con la URL:
//   ?pc500=ws://127.0.0.1:18089
// Con ?demo la consola usa un simulador del PC500 dentro de la página, sin red.
// Sirve para probarla desde cualquier dispositivo o un Codespace.

import { createSimulatedWebSocket } from '../../core/simulated-websocket.js';
import { createPc500Simulator } from '../../core/simulators.js';
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
  if (demo) {
    tenveoOptions.WebSocketImpl = createSimulatedWebSocket(createPc500Simulator());
    settings.ethernetIp = 'simulador';
  } else {
    // ?pc500=ws://<IP>:<puerto> fija el equipo (lo usan las pruebas).
    const pc500 = params.get('pc500');
    if (pc500 && /^wss?:\/\//.test(pc500)) {
      const url = new URL(pc500);
      settings.ethernetIp = url.hostname.replace(/^\[|\]$/g, '');
      if (url.port) tenveoOptions.ethernetPort = Number(url.port);
    }
  }

  const controller = new StudioController({
    tenveo: new TenveoService(tenveoOptions),
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
