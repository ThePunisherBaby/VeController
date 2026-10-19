// Puente seguro entre la ventana y el proceso principal.
// La ventana no tiene acceso a Node: solo ve estas funciones.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    // Órdenes del menú de la Mac, por ejemplo Ajustes… (⌘,).
    onMenu: (callback) => {
      const handler = (_event, action) => callback(String(action));
      ipcRenderer.on('tenveo:menu', handler);
      return () => ipcRenderer.removeListener('tenveo:menu', handler);
    },
    // La ruta de un archivo arrastrado desde el Finder (imágenes y videos).
    pathForFile: (file) => webUtils.getPathForFile(file),
  }),
);
