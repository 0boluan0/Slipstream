const { contextBridge, ipcRenderer } = require('electron');

const actions = new Set(['ready', 'close', 'toggle-top', 'translate', 'explain', 'retake', 'settings',
  'lookup', 'dismiss-lookup', 'collapse', 'fit', 'copy', 'review', 'save-term', 'library', 'recognize-formulas']);
contextBridge.exposeInMainWorld('readingPin', {
  act(action, payload) {
    if (!actions.has(action)) return Promise.reject(new Error('Unsupported card action'));
    return ipcRenderer.invoke('reading-pin:action', action, payload);
  },
  subscribe(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('reading-pin:state', listener);
    return () => ipcRenderer.removeListener('reading-pin:state', listener);
  },
});
