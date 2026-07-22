const assert = require('node:assert/strict');
const Module = require('node:module');

const constants = require('../src/shared/constants.cjs');
const { splitTextIntoChunks, splitTextByUtf8Bytes, mergeChunkResults } = require('../src/main/llm-service');

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`not ok - ${name}: ${error.message}`);
  }
}

function hasLoneSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

async function main() {
  await check('IPC validation rejects unsafe settings and oversized requests', () => {
    const {
      validateSetting,
      validateProcessOptions,
      isTrustedRendererUrl,
      validateExternalUrl,
      validateShortcut,
    } = require('../src/main/validation');

    assert.deepEqual(validateSetting('clipboardMonitoring', false), ['clipboardMonitoring', false]);
    assert.throws(() => validateSetting('notASetting', true));
    assert.throws(() => validateSetting('customEndpointUrl', 'http://example.com/v1'));
    assert.deepEqual(
      validateSetting('customEndpointUrl', 'http://127.0.0.1:8000/v1'),
      ['customEndpointUrl', 'http://127.0.0.1:8000/v1']
    );
    assert.equal(validateProcessOptions({ text: 'hello', source: 'manual' }).text, 'hello');
    assert.throws(() => validateProcessOptions({ text: 'x'.repeat(constants.DEFAULTS.MAX_TEXT_LENGTH + 1) }));
    assert.equal(isTrustedRendererUrl('http://localhost:5173/', true), true);
    assert.equal(isTrustedRendererUrl('http://localhost:5174/', true), false);
    assert.equal(isTrustedRendererUrl('https://example.com/', false), false);
    assert.equal(validateShortcut(' CommandOrControl + Shift + X '), 'CommandOrControl + Shift + X');
    assert.throws(() => validateShortcut('+'));
    assert.equal(validateExternalUrl('https://www.gov.uk/view-prove-immigration-status'), 'https://www.gov.uk/view-prove-immigration-status');
    assert.throws(() => validateExternalUrl('http://example.com'));
    assert.throws(() => validateExternalUrl('https://127.0.0.1/private'));
    assert.throws(() => validateExternalUrl('https://settings.local/private'));
    assert.deepEqual(validateSetting('verificationPolicy', 'ask'), ['verificationPolicy', 'ask']);
    assert.deepEqual(validateSetting('resultOrder', 'translation-first'), ['resultOrder', 'translation-first']);
    assert.throws(() => validateSetting('verificationPolicy', 'always'));
    const capture = validateProcessOptions({
      text: 'A clear scan',
      source: 'ocr',
      capture: { confidence: 2, blocks: [{ text: 'A clear scan', boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }] },
    }).capture;
    assert.equal(capture.confidence, 1);
    assert.deepEqual(capture.blocks[0].bbox, [0.1, 0.2, 0.3, 0.4]);
  });

  await check('latest request wins without running queued stale work', async () => {
    const { createRequestCoordinator } = await import('../src/renderer/hooks/requestCoordinator.mjs');
    const coordinator = createRequestCoordinator();
    const first = coordinator.schedule({ text: 'first' });
    assert.ok(first);
    assert.equal(coordinator.schedule({ text: 'second' }), null);
    const afterFirst = coordinator.complete(first);
    assert.equal(afterFirst.apply, false);
    assert.equal(afterFirst.next.payload.text, 'second');
    const afterSecond = coordinator.complete(afterFirst.next);
    assert.equal(afterSecond.apply, true);
    assert.equal(afterSecond.next, null);

    const stale = coordinator.schedule({ text: 'stale' });
    coordinator.invalidate();
    assert.equal(coordinator.complete(stale).apply, false);
  });

  await check('clipboard monitoring is opt-in', () => {
    assert.equal(constants.DEFAULTS.CLIPBOARD_MONITORING, false);
  });

  await check('capture envelopes preserve source offsets and OCR provenance', () => {
    const { createCaptureEnvelope } = require('../src/main/capture-envelope');
    const envelope = createCaptureEnvelope({
      text: 'Please submit a passport scan.\nReply when complete.',
      sourceKind: 'ocr',
      capture: {
        confidence: 0.92,
        blocks: [
          { id: 'ocr-1', text: 'Please submit a passport scan.', bbox: [0, 0, 1, 0.4] },
          { id: 'ocr-2', text: 'Reply when complete.', bbox: [0, 0.5, 1, 0.4] },
        ],
      },
    });
    assert.equal(envelope.rawText.slice(envelope.ocr.blocks[1].start, envelope.ocr.blocks[1].end), 'Reply when complete.');
    assert.match(envelope.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(envelope.sourceKind, 'ocr');
  });

  await check('Anthropic defaults use active model IDs', () => {
    assert.deepEqual(constants.MODEL_IDS.anthropic, [
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
  });

  await check('long-text chunks never contain lone UTF-16 surrogates', () => {
    const chunks = splitTextIntoChunks(`${'a'.repeat(3499)}😀b`, 3500);
    assert.equal(chunks.join(''), `${'a'.repeat(3499)}😀b`);
    assert.equal(chunks.some(hasLoneSurrogate), false);
  });

  await check('free translation chunks stay within provider UTF-8 byte limits', () => {
    const source = `${'中'.repeat(240)}😀${'a'.repeat(40)}`;
    const chunks = splitTextByUtf8Bytes(source, 450);
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.some((chunk) => Buffer.byteLength(chunk, 'utf8') > 450), false);
    assert.equal(chunks.some(hasLoneSurrogate), false);
  });

  await check('auto-direction merge can emit English headings', () => {
    const merged = mergeChunkResults([
      '1. **English Translation**\n\nHello\n\n2. **Proper Noun / Term Explanations**\n\nNone',
    ], 'auto', 'en');
    assert.match(merged, /^1\. \*\*English Translation\*\*/);
  });

  await check('app-authored clipboard writes are ignored once', () => {
    let clipboardText = 'initial';
    let poll = null;
    const originalLoad = Module._load;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;

    try {
      Module._load = (request, parent, isMain) => {
        if (request === 'electron') {
          return { clipboard: { readText: () => clipboardText } };
        }
        return originalLoad(request, parent, isMain);
      };
      global.setInterval = (callback) => {
        poll = callback;
        return 1;
      };
      global.clearInterval = () => {};
      delete require.cache[require.resolve('../src/main/clipboard-monitor')];
      const ClipboardMonitor = require('../src/main/clipboard-monitor');
      const monitor = new ClipboardMonitor();
      const events = [];
      monitor.startMonitoring((payload) => events.push(payload));

      assert.equal(typeof monitor.suppressNextText, 'function');
      monitor.suppressNextText('copied result');
      clipboardText = 'copied result';
      poll();
      assert.equal(events.length, 0);

      clipboardText = 'external text';
      poll();
      assert.equal(events.length, 1);
      assert.equal(events[0].text, 'external text');
    } finally {
      Module._load = originalLoad;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
      delete require.cache[require.resolve('../src/main/clipboard-monitor')];
    }
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} core regression check(s) failed.`);
    process.exit(1);
  }

  console.log('\ncore regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
