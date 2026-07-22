const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
let registeredCallback;
let usedNativeCapture = false;
let usedElectronOverlay = false;

Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return {
      clipboard: { readText: () => '' },
      globalShortcut: {
        register: (shortcut, callback) => {
          if (shortcut === 'F2') registeredCallback = callback;
          return true;
        },
        unregisterAll: () => {},
      },
    };
  }
  if (request === './screenshot-service') {
    return {
      getTempDir: () => '/tmp',
      captureRegion: async () => {
        usedNativeCapture = true;
      },
      captureSelectedRegion: async () => {
        usedElectronOverlay = true;
      },
    };
  }
  if (request === './ocr-service') {
    return { performOCR: async () => ({ text: '', confidence: 1 }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { registerShortcuts } = require('../src/main/global-shortcut');
  registerShortcuts({
    isDestroyed: () => false,
    webContents: { send: () => {} },
    show: () => {},
    focus: () => {},
  }, { screenshotShortcut: 'F2', clipboardShortcut: 'Alt+C' });

  assert(registeredCallback, 'F2 callback was not registered');
  await registeredCallback();
  assert.strictEqual(usedElectronOverlay, true);
  assert.strictEqual(usedNativeCapture, false);
  console.log('screenshot shortcut check passed');
}

main().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
