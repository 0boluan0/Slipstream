const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed IPC channels
const ALLOWED_INVOKE_CHANNELS = [
  'settings:get', 'settings:set',
  'llm:process',
  'screenshot:capture',
  'window:hide', 'window:show',
];

const ALLOWED_ON_CHANNELS = [
  'clipboard:text-changed',
  'ocr:result', 'ocr:error',
  'llm:result', 'llm:error',
  'settings:loaded',
];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    console.warn(`[preload] Blocked invoke on channel "${channel}"`);
    return Promise.reject(new Error(`IPC channel "${channel}" not allowed`));
  },
  on: (channel, callback) => {
    if (ALLOWED_ON_CHANNELS.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    console.warn(`[preload] Blocked on listener for channel "${channel}"`);
    return () => {};
  },
});
