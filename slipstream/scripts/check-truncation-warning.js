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
  const { getSourceLimitState, sourceLimitWarning } = await import('../src/renderer/utils/sourceLimit.mjs');
  const normalized = normalizeClipboardPayload({
    text: 'x'.repeat(DEFAULTS.MAX_TEXT_LENGTH),
    source: 'monitor',
    truncated: true,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH + 3,
  });
  assert.strictEqual(normalized.truncated, true);
  assert.strictEqual(normalized.originalLength, DEFAULTS.MAX_TEXT_LENGTH + 3);

  const manualOverflow = getSourceLimitState({
    textLength: DEFAULTS.MAX_TEXT_LENGTH + 73,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH + 73,
    truncated: false,
    sourceType: 'manual',
    limit: DEFAULTS.MAX_TEXT_LENGTH,
  });
  assert.strictEqual(manualOverflow.kind, 'full-over-limit');
  assert.strictEqual(manualOverflow.overflowLength, 73);
  assert.strictEqual(manualOverflow.missingLength, 0);
  assert.strictEqual(manualOverflow.recovery, 'select-overflow');
  assert.match(manualOverflow.title, /完整原文仍保留/);
  assert.match(manualOverflow.detail, /保留了全部 10,073 个字符/);
  assert.match(manualOverflow.detail, /尚未发送或分析/);

  const clipboardPrefix = getSourceLimitState({
    textLength: DEFAULTS.MAX_TEXT_LENGTH,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH + 137,
    truncated: true,
    sourceType: 'clipboard',
    limit: DEFAULTS.MAX_TEXT_LENGTH,
  });
  assert.strictEqual(clipboardPrefix.kind, 'prefix-only');
  assert.strictEqual(clipboardPrefix.missingLength, 137);
  assert.strictEqual(clipboardPrefix.recovery, 'manual-paste');
  assert.match(clipboardPrefix.countLabel, /已载入 10,000 \/ 原文 10,137/);
  assert.match(clipboardPrefix.detail, /后面的 137 个字符不在输入框中/);
  assert.match(sourceLimitWarning(clipboardPrefix), /没有开始分析/);

  const screenshotPrefix = getSourceLimitState({
    textLength: DEFAULTS.MAX_TEXT_LENGTH,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH + 20,
    truncated: true,
    sourceType: 'ocr',
    limit: DEFAULTS.MAX_TEXT_LENGTH,
  });
  assert.strictEqual(screenshotPrefix.recovery, 'recapture');
  assert.match(screenshotPrefix.detail, /重新框选较小、内容完整的区域/);

  const atLimit = getSourceLimitState({
    textLength: DEFAULTS.MAX_TEXT_LENGTH,
    originalLength: DEFAULTS.MAX_TEXT_LENGTH,
    truncated: false,
    sourceType: 'manual',
    limit: DEFAULTS.MAX_TEXT_LENGTH,
  });
  assert.strictEqual(atLimit.kind, 'within-limit');
  assert.strictEqual(atLimit.blocked, false);

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
  const demoIpcSource = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/hooks/useIpc.js'), 'utf8');
  assert.match(
    mainSource,
    /IPC_CHANNELS\.CLIPBOARD_READ[\s\S]*?return createClipboardPayload\(clipboard\.readText\(\)\);/,
    'manual clipboard reads must return text plus truncation metadata',
  );
  assert.match(
    rendererSource,
    /if \(payload\.truncated\)[\s\S]*?setWindowMode\('capture'\);[\s\S]*?return true;[\s\S]*?debounceRef\.current/,
    'truncated clipboard events must not start automatic analysis',
  );
  assert.match(
    rendererSource,
    /const limitState = getSourceLimitState\([\s\S]*?if \(limitState\.blocked\)[\s\S]*?return;/,
    'the renderer must block analysis when only a prefix of the source is available',
  );
  assert.match(
    rendererSource,
    /onChange=\{\(event\)[\s\S]*?setSourceMeta\(\{\s*truncated: false,\s*originalLength: nextText\.length/,
    'manual over-limit input must remain marked as a complete retained source',
  );
  assert.match(
    rendererSource,
    /aria-describedby=\{sourceDescriptionIds\}[\s\S]*?id="source-limit-message"[\s\S]*?role="alert"/,
    'the source textarea must be associated with an alert that explains the limit state',
  );
  assert.match(rendererSource, /定位超出部分/);
  assert.match(rendererSource, /选择当前前缀并手动粘贴全文/);
  assert.match(rendererSource, /重新框选较小区域/);
  assert.match(
    rendererSource,
    /setSelectionRange\(DEFAULTS\.MAX_TEXT_LENGTH, inputText\.length\)/,
    'manual recovery must select only the overflow',
  );
  assert.match(
    rendererSource,
    /setSelectionRange\(0, inputText\.length\)/,
    'clipboard recovery must select the retained prefix for replacement',
  );
  assert.match(
    demoIpcSource,
    /demoClipboardReadCode === 'long'[\s\S]*?truncated: true,[\s\S]*?originalLength/,
    'the deterministic preview must cover prefix-only clipboard recovery',
  );
  console.log('truncation payload check passed');
}

main().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exit(1);
});
