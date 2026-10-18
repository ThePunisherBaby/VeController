// Elige con qué habla la interfaz.
//   Electron: con el proceso principal, por el puente seguro window.tenveo.
//   Navegador: con el mismo núcleo, corriendo dentro de la página.
// Ambos devuelven { ok, result } o { ok: false, error } en send().

export async function connectBackend() {
  const bridge = window.tenveo;
  if (bridge && bridge.platform === 'electron') {
    return {
      kind: 'electron',
      getState: () => bridge.getState(),
      send: (type, ...args) => bridge.send(type, ...args),
      onState: (callback) => bridge.onState(callback),
      onMenu: (callback) => bridge.onMenu?.(callback),
    };
  }
  const { createLocalBackend } = await import('./local-backend.js');
  return createLocalBackend();
}
