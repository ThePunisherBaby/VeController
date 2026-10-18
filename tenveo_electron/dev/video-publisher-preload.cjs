// Puente del emisor de prueba: manda cada cuadro codificado al proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('publisher', {
  send: (chunk) => ipcRenderer.send('publisher:chunk', chunk),
  error: (message) => ipcRenderer.send('publisher:error', String(message)),
});
