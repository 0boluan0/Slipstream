const assert = require('assert');
const Module = require('module');
const { DEFAULTS } = require('../src/shared/constants.cjs');

let clipboardText = '';
const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return { clipboard: { readText: () => clipboardText } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const ClipboardMonitor = require('../src/main/clipboard-monitor');

async function main() {
  const { normalizeClipboardPayload } = await import('../src/renderer/hooks/clipboardPayload.mjs');
  const normalized = normalizeClipboardPayload({
    text: 'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH),
    source: 'monitor',
    truncated: true,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH + 3,
  });
  assert.strictEqual(normalized.truncated, true);
  assert.strictEqual(normalized.originalLength, DEFAULTS.MAX_TEXT_LENGTH + 3);

  const monitor = new ClipboardMonitor();
  const payloads = [];

  monitor.startMonitoring((payload) => payloads.push(payload));
  clipboardText = 'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH + 3);

  await new Promise((resolve) => setTimeout(resolve, DEFAULTS.CLIPBOARD_POLL_INTERVAL + 50));
  monitor.stopMonitoring();
  Module._load = originalLoad;

  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(payloads[0].text.length, DEFAULTS.MAX_TEXT_LENGTH);
  assert.strictEqual(payloads[0].truncated, true);
  assert.strictEqual(payloads[0].originalLength, DEFAULTS.MAX_TEXT_LENGTH + 3);
  console.log('truncation payload check passed');
}

main().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exit(1);
});
