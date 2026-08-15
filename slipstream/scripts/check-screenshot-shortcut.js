const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const registeredCallbacks = new Map();
const events = [];
let clipboardText = '';
let rejectedShortcut = '';
let throwingShortcut = '';

Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return {
      clipboard: { readText: () => clipboardText },
      globalShortcut: {
        register: (shortcut, callback) => {
          if (shortcut === throwingShortcut) throw new Error('invalid accelerator');
          if (shortcut === rejectedShortcut) return false;
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
  assert.equal(DEFAULTS.SCREENSHOT_SHORTCUT, 'Alt+Shift+S');
  assert.match(DEFAULTS.SCREENSHOT_SHORTCUT, /(?:^|\+)(?:Alt|Command|Control)(?:\+|$)/);
  assert.doesNotMatch(DEFAULTS.SCREENSHOT_SHORTCUT, /^F(?:[1-9]|1\d|2[0-4])$/);
  assert.throws(() => registerShortcuts(null), /Capture dispatcher is required/,
    'shortcut registration must fail closed without the main-owned capture dispatcher');

  const defaultRegistration = registerShortcuts(() => {});
  assert.equal(defaultRegistration.clipboard.accelerator, DEFAULTS.CLIPBOARD_SHORTCUT);
  assert.equal(defaultRegistration.screenshot.accelerator, DEFAULTS.SCREENSHOT_SHORTCUT);
  assert(registeredCallbacks.has(DEFAULTS.SCREENSHOT_SHORTCUT), 'recommended screenshot default was not registered');
  const surrogateBoundary = createClipboardPayload(`${'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH - 1)}😀tail`);
  assert.equal(surrogateBoundary.truncated, true);
  assert.equal(surrogateBoundary.originalLength, DEFAULTS.MAX_TEXT_LENGTH + 5);
  assert.doesNotMatch(surrogateBoundary.text, /[\uD800-\uDBFF]$/,
    'truncation must not leave a lone high surrogate');
  const registration = registerShortcuts(
    (event) => events.push(event),
    { screenshotShortcut: 'F2', clipboardShortcut: 'Alt+C' },
  );
  assert.equal(registration.allRegistered, true);
  assert.equal(registration.clipboard.registered, true);
  assert.equal(registration.screenshot.registered, true);

  const screenshotCallback = registeredCallbacks.get('F2');
  assert(screenshotCallback, 'a saved legacy F2 shortcut must still be registered without migration');
  await screenshotCallback();
  assert.deepEqual(events.slice(-1), [
    { channel: IPC_CHANNELS.SCREENSHOT_REQUESTED, payload: { source: 'shortcut' } },
  ], 'a saved F2 must delegate to the renderer so button and shortcut share one capture task');

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

  clipboardText = '   ';
  await clipboardCallback();
  assert.deepEqual(events.at(-1), {
    channel: IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
    payload: {
      text: '',
      source: 'shortcut',
      error: '剪贴板里没有可解释的文本',
    },
  }, 'an empty clipboard shortcut must enter the same readiness-aware dispatcher');

  rejectedShortcut = 'F3';
  const partialRegistration = registerShortcuts(
    () => {},
    { screenshotShortcut: 'F3', clipboardShortcut: 'Alt+Shift+C' },
  );
  assert.equal(partialRegistration.allRegistered, false);
  assert.equal(partialRegistration.clipboard.registered, true);
  assert.equal(partialRegistration.screenshot.registered, false);
  assert.equal(partialRegistration.screenshot.accelerator, 'F3');
  assert.equal(partialRegistration.screenshot.reason, 'conflict');

  throwingShortcut = 'Bad';
  const invalidRegistration = registerShortcuts(
    () => {},
    { screenshotShortcut: 'Bad', clipboardShortcut: 'Alt+Shift+C' },
  );
  assert.equal(invalidRegistration.screenshot.registered, false,
    'invalid accelerators must become status instead of escaping as an exception');
  assert.equal(invalidRegistration.screenshot.reason, 'invalid');
  console.log('screenshot shortcut check passed');
}

main().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
