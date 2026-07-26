const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const registeredCallbacks = new Map();
const events = [];
let clipboardText = '';

Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return {
      clipboard: { readText: () => clipboardText },
      globalShortcut: {
        register: (shortcut, callback) => {
          registeredCallbacks.set(shortcut, callback);
          return true;
        },
        unregisterAll: () => {},
      },
    };
  }
  if (request === './screenshot-service') {
    return {
      getTempDir: () => '/tmp',
      captureSelectedRegion: async () => '/tmp/legacy-capture.png',
    };
  }
  if (request === './ocr-service') {
    return { performOCR: async () => ({ text: 'legacy OCR path', confidence: 1, blocks: [] }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { DEFAULTS, IPC_CHANNELS } = require('../src/shared/constants.cjs');
  const { createClipboardPayload, registerShortcuts } = require('../src/main/global-shortcut');
  const surrogateBoundary = createClipboardPayload(`${'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH - 1)}😀tail`);
  assert.equal(surrogateBoundary.truncated, true);
  assert.equal(surrogateBoundary.originalLength, DEFAULTS.MAX_TEXT_LENGTH + 5);
  assert.doesNotMatch(surrogateBoundary.text, /[\uD800-\uDBFF]$/,
    'truncation must not leave a lone high surrogate');
  registerShortcuts({
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => events.push({ channel, payload }) },
    show: () => events.push({ action: 'show' }),
    focus: () => events.push({ action: 'focus' }),
  }, { screenshotShortcut: 'F2', clipboardShortcut: 'Alt+C' });

  const screenshotCallback = registeredCallbacks.get('F2');
  assert(screenshotCallback, 'F2 callback was not registered');
  await screenshotCallback();
  assert.deepEqual(events.slice(-3), [
    { action: 'show' },
    { action: 'focus' },
    { channel: IPC_CHANNELS.SCREENSHOT_REQUESTED, payload: { source: 'shortcut' } },
  ], 'F2 must delegate to the renderer so button and shortcut share one capture task');

  clipboardText = 'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH + 7);
  const clipboardCallback = registeredCallbacks.get('Alt+C');
  await clipboardCallback();
  assert.deepEqual(events.at(-1), {
    channel: IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
    payload: {
      text: 'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH),
      source: 'shortcut',
      truncated: true,
      originalLength: DEFAULTS.MAX_TEXT_LENGTH + 7,
    },
  }, 'clipboard shortcut must disclose truncation metadata');
  console.log('screenshot shortcut check passed');
}

main().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
