const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed IPC channels
const ALLOWED_INVOKE_CHANNELS = [
  'settings:get',
  'settings:set',
  'settings:recovery-reset',
  'shortcut:status-get',
  'support:diagnostics-get',
  'terms:get',
  'terms:save',
  'terms:delete',
  'terms:export',
  'terms:import-preview',
  'terms:import-commit',
  'user-data-reset:prepare',
  'user-data-reset:abort',
  'user-data:clear',
  'clipboard:write',
  'clipboard:read',
  'llm:process',
  'llm:cancel',
  'provider:connection-test',
  'provider:connection-cancel',
  'verification:run',
  'app:quit-listener-ready',
  'app:quit-decision',
  'app:settings-listener-ready',
  'app:settings-request-handled',
  'app:session-risk-update',
  'clipboard:pending-status',
  'app:renderer-recovery-status-get',
  'app:clipboard-residue-risk-ack',
  'capture:listener-ready',
  'screenshot:capture',
  'window:set-mode',
  'window:hide',
  'system:open-screen-recording-settings',
  'external:open',
];

const ALLOWED_ON_CHANNELS = [
  'clipboard:text-changed',
  'ocr:error',
  'screenshot:requested',
  'settings:loaded',
  'shortcut:status-changed',
  'app:quit-requested',
  'app:settings-requested',
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
