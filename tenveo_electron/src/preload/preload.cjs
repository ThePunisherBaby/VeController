// Puente seguro entre la ventana y el proceso principal.
// La ventana no tiene acceso a Node: solo ve estas cuatro funciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'tenveo',
  Object.freeze({
    platform: 'electron',
    getState: () => ipcRenderer.invoke('tenveo:get-state'),
    send: (type, ...args) => ipcRenderer.invoke('tenveo:command', String(type), args),
    onState: (callback) => {
      const handler = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on('tenveo:state', handler);
      return () => ipcRenderer.removeListener('tenveo:state', handler);
    },
  }),
);
