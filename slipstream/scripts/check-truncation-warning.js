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
  const fs = require('node:fs');
  const path = require('node:path');
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

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/components/FloatingPanel.jsx'), 'utf8');
  assert.match(
    mainSource,
    /IPC_CHANNELS\.CLIPBOARD_READ[\s\S]*?return createClipboardPayload\(clipboard\.readText\(\)\);/,
    'manual clipboard reads must return text plus truncation metadata',
  );
  assert.match(
    rendererSource,
    /if \(clipboardEvent\.truncated\)[\s\S]*?return undefined;/,
    'truncated clipboard events must not start automatic analysis',
  );
  assert.match(
    rendererSource,
    /if \(isSourceTooLong[\s\S]*?return;/,
    'the renderer must block analysis when only a prefix of the source is available',
  );
  console.log('truncation payload check passed');
}

main().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exit(1);
});
