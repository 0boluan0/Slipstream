const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['list', 'edit', 'open-folder', 'open-file', 'reveal-file']);
contextBridge.exposeInMainWorld('termLibrary', {
  act(action, payload) {
    if (!actions.has(action)) return Promise.reject(new Error('Unsupported action'));
    return ipcRenderer.invoke('term-library:action', action, payload);
  },
  onRefresh(callback) { ipcRenderer.on('term-library:refresh', (_event, id) => callback(id)); },
});
