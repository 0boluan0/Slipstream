'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['ready', 'visible', 'select', 'cancel']);
contextBridge.exposeInMainWorld('captureOverlay', {
  act(action, value) {
    if (!actions.has(action)) return Promise.reject(new Error('Unsupported capture action'));
    return ipcRenderer.invoke('capture-overlay:action', action, value);
  },
});
