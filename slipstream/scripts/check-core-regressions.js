const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const constants = require('../src/shared/constants.cjs');
const {
  FREE_TRANSLATE_TASK_TIMEOUT_MS,
  mergeChunkResults,
  processFreeTranslate,
  processText,
  resolveFreeTranslateLanguages,
  splitTextByUtf8Bytes,
  splitTextIntoChunks,
} = require('../src/main/llm-service');

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
  assert.equal(constants.DEFAULTS.CLIPBOARD_SHORTCUT, 'Alt+C');
  assert.equal(constants.DEFAULTS.SCREENSHOT_SHORTCUT, 'Alt+Shift+S');
  assert.doesNotMatch(constants.DEFAULTS.SCREENSHOT_SHORTCUT, /^F(?:[1-9]|1\d|2[0-4])$/);

  await check('IPC validation rejects unsafe settings and oversized requests', () => {
    const {
      validateSetting,
      validateProcessOptions,
      validateVerificationOptions,
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
    assert.equal(validateProcessOptions({ text: 'hello', source: 'sample' }).source, 'sample');
    assert.deepEqual(
      validateProcessOptions({ text: 'hello', source: 'manual', truncated: true, originalLength: 12 }),
      { text: 'hello', source: 'manual', capture: null, truncated: true, originalLength: 12, verificationApproved: false },
    );
    assert.throws(() => validateProcessOptions({ text: 'hello', truncated: true, originalLength: 5 }));
    assert.throws(() => validateProcessOptions({ text: 'x'.repeat(constants.DEFAULTS.MAX_TEXT_LENGTH + 1) }));
    const approvalId = 'a'.repeat(64);
    assert.deepEqual(validateVerificationOptions({
      sourceText: 'hello',
      brief: { schemaVersion: 'action-brief.v1' },
      approvalId,
    }), {
      sourceText: 'hello',
      brief: { schemaVersion: 'action-brief.v1' },
      approvalId,
    });
    assert.throws(() => validateVerificationOptions({ sourceText: 'hello', brief: {}, approvalId: 'bad' }));
    assert.equal(isTrustedRendererUrl('http://localhost:5173/', true), true);
    assert.equal(isTrustedRendererUrl('http://localhost:5174/', true), false);
    assert.equal(isTrustedRendererUrl('https://example.com/', false), false);
    assert.equal(validateShortcut(' CommandOrControl + Shift + X '), 'Command+Shift+X');
    assert.equal(validateShortcut(' Option + C '), 'Alt+C');
    assert.equal(validateShortcut('F24'), 'F24');
    assert.throws(() => validateShortcut('+'));
    assert.throws(() => validateShortcut('Option'), /shortcut-invalid:modifier-only/);
    assert.throws(() => validateShortcut('C'), /shortcut-invalid:unsafe-unmodified/);
    assert.throws(() => validateShortcut('F25'), /shortcut-invalid:unsupported-key/);
    assert.equal(validateExternalUrl('https://www.gov.uk/view-prove-immigration-status'), 'https://www.gov.uk/view-prove-immigration-status');
    assert.throws(() => validateExternalUrl('http://example.com'));
    assert.throws(() => validateExternalUrl('https://127.0.0.1/private'));
    assert.throws(() => validateExternalUrl('https://settings.local/private'));
    assert.throws(() => validateExternalUrl('https://intranet/private'));
    assert.throws(() => validateExternalUrl('https://example.com:8443/private'));
    assert.deepEqual(validateSetting('verificationPolicy', 'ask'), ['verificationPolicy', 'ask']);
    assert.deepEqual(validateSetting('resultOrder', 'translation-first'), ['resultOrder', 'translation-first']);
    assert.throws(() => validateSetting('verificationPolicy', 'always'));
    const capture = validateProcessOptions({
      text: 'A clear scan',
      source: 'ocr',
      capture: { confidence: 2, blocks: [{ text: 'A clear scan', boundingBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }] },
    }).capture;
    assert.equal(capture.confidence, null);
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

  await check('processing-setting changes abort stale work without relabeling old failures', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
    assert.match(source, /LLM_PROCESSING_SETTING_KEYS = new Set\([\s\S]*?'customPrompt'[\s\S]*?'verificationPolicy'/);
    assert.match(source, /LLM_PROCESSING_SETTING_KEYS\.has\(key\)[\s\S]*?llmAbortController\?\.abort\(\)/);
    assert.match(source, /key === 'verificationPolicy'[\s\S]*?verificationAbortController\?\.abort\(\)/);
    assert.match(source, /let requestBackend = store\.getSettings\('activeBackend'\)[\s\S]*?requestBackend = settings\.activeBackend[\s\S]*?classifyProcessingError\(error, requestBackend\)/);
    assert.doesNotMatch(source, /classifyProcessingError\(error, store\.getSettings\('activeBackend'\)\)/);
  });

  await check('only the compact capture window stays above other apps', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
    assert.match(source, /alwaysOnTop:\s*uiFixtureMode\.enabled \|\| !storageReady \? false : !needsSetup/);
    assert.match(source, /skipTaskbar:\s*!uiFixtureMode\.enabled && storageReady/,
      'a storage-recovery window must remain discoverable without a tray');
    assert.match(source, /currentWindowMode = mode;\s*mainWindow\.setBounds\(nextBounds, true\);\s*mainWindow\.setAlwaysOnTop\(mode === 'capture'\)/,
      'resize an onscreen macOS window before raising it to the floating layer');
    assert.match(source, /if \(targetMode === 'capture'\) mainWindow\.setBounds\(captureWindowBounds, true\);\s*mainWindow\.setAlwaysOnTop\(targetMode === 'capture'\)/,
      'storage recovery must restore capture bounds before raising the window');
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

  await check('Anthropic joins text blocks that follow thinking blocks', async () => {
    const originalLoad = Module._load;
    let requestCount = 0;
    class FakeAnthropic {
      constructor(options) {
        assert.equal(options.apiKey, 'fixture-key');
        assert.equal(options.maxRetries, 0, 'Slipstream must own Anthropic retries');
        this.messages = {
          create: async () => {
            requestCount += 1;
            return requestCount === 1
              ? {
                  content: [
                    { type: 'thinking', thinking: 'private reasoning' },
                    { type: 'text', text: 'first' },
                    { type: 'text', text: 'second' },
                  ],
                  stop_reason: 'end_turn',
                }
              : {
                  content: [{ type: 'thinking', thinking: 'PRIVATE_ANTHROPIC_BLOCK_NEVER_EXPOSE' }],
                  stop_reason: 'end_turn',
                };
          },
        };
      }
    }
    Module._load = function load(request, parent, isMain) {
      if (request === '@anthropic-ai/sdk') return FakeAnthropic;
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const response = await processText({
        text: 'Please explain the fictional notice.',
        backend: 'anthropic',
        model: 'claude-sonnet-4-6',
        languageHint: 'en',
        ignoreCustomPrompt: true,
        settingsSnapshot: { anthropicApiKey: 'fixture-key' },
      });
      assert.equal(response.result, 'first\nsecond');
      await assert.rejects(
        processText({
          text: 'Please explain another fictional notice.',
          backend: 'anthropic',
          model: 'claude-sonnet-4-6',
          languageHint: 'en',
          ignoreCustomPrompt: true,
          settingsSnapshot: { anthropicApiKey: 'fixture-key' },
        }),
        (error) => {
          assert.equal(error?.code, 'anthropic-invalid-response');
          assert.equal(error?.message, 'Anthropic 返回了无效响应');
          assert.equal(String(error?.stack).includes('PRIVATE_ANTHROPIC_BLOCK_NEVER_EXPOSE'), false);
          return true;
        },
      );
    } finally {
      Module._load = originalLoad;
    }
  });

  await check('Ollama requests bound the context window', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/llm-service.js'), 'utf8');
    assert.match(source, /options:\s*\{\s*num_ctx:\s*16384,/);
    assert.deepEqual(constants.MODEL_IDS.ollama, ['qwen2.5', 'mistral-small'],
      'new users should only see Ollama models suited to Chinese structured output');
  });

  await check('OpenAI SDK retries are disabled', async () => {
    const originalLoad = Module._load;
    class FakeOpenAI {
      constructor(options) {
        assert.equal(options.apiKey, 'fixture-key');
        assert.equal(options.maxRetries, 0, 'Slipstream must own OpenAI retries');
        this.chat = {
          completions: {
            create: async () => ({
              choices: [{ finish_reason: 'stop', message: { content: '{"fixture":true}' } }],
            }),
          },
        };
      }
    }
    Module._load = function load(request, parent, isMain) {
      if (request === 'openai') return FakeOpenAI;
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const response = await processText({
        text: 'Please submit the fictional form.',
        backend: 'openai',
        model: 'gpt-4o',
        languageHint: 'en',
        ignoreCustomPrompt: true,
        settingsSnapshot: { openaiApiKey: 'fixture-key' },
      });
      assert.equal(response.result, '{"fixture":true}');
    } finally {
      Module._load = originalLoad;
    }
  });

  await check('OpenAI HTTP 500 and APIConnectionError cause codes use the outer retry', async () => {
    const originalLoad = Module._load;
    const originalSetTimeout = global.setTimeout;
    let requestCount = 0;
    class FakeOpenAI {
      constructor(options) {
        assert.equal(options.maxRetries, 0);
        this.chat = {
          completions: {
            create: async () => {
              requestCount += 1;
              if (requestCount === 1) {
                const error = new Error('Temporary provider failure.');
                error.status = 500;
                throw error;
              }
              if (requestCount === 2) {
                const cause = new Error('socket reset');
                cause.code = 'ECONNRESET';
                const error = new Error('Connection error.');
                error.name = 'APIConnectionError';
                error.cause = cause;
                throw error;
              }
              return {
                choices: [{ finish_reason: 'stop', message: { content: '{"retried":true}' } }],
              };
            },
          },
        };
      }
    }
    Module._load = function load(request, parent, isMain) {
      if (request === 'openai') return FakeOpenAI;
      return originalLoad.call(this, request, parent, isMain);
    };
    global.setTimeout = (callback, delay, ...args) => originalSetTimeout(
      callback,
      delay === 1000 ? 1 : delay,
      ...args,
    );
    try {
      const response = await processText({
        text: 'Please explain the fictional notice.',
        backend: 'openai',
        model: 'gpt-4o',
        languageHint: 'en',
        ignoreCustomPrompt: true,
        settingsSnapshot: { openaiApiKey: 'fixture-key' },
      });
      assert.equal(response.result, '{"retried":true}');
      assert.equal(requestCount, 3);
    } finally {
      Module._load = originalLoad;
      global.setTimeout = originalSetTimeout;
    }
  });

  await check('cancellation or timeout during retry backoff never starts another provider attempt', async () => {
    const originalLoad = Module._load;
    const originalSetTimeout = global.setTimeout;
    let requestCount = 0;
    let shortenModelTimeout = false;
    class FakeOpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: async () => {
              requestCount += 1;
              const error = new Error('fixture transient failure');
              error.status = 529;
              throw error;
            },
          },
        };
      }
    }
    Module._load = function load(request, parent, isMain) {
      if (request === 'openai') return FakeOpenAI;
      return originalLoad.call(this, request, parent, isMain);
    };
    global.setTimeout = (callback, delay, ...args) => originalSetTimeout(
      callback,
      shortenModelTimeout && delay === 60000
        ? 5
        : [1000, 2000, 4000].includes(delay) ? 20 : delay,
      ...args,
    );
    try {
      const controller = new AbortController();
      const pending = processText({
        text: 'Please explain the fictional notice.',
        backend: 'openai',
        model: 'gpt-4o',
        languageHint: 'en',
        ignoreCustomPrompt: true,
        settingsSnapshot: { openaiApiKey: 'fixture-key' },
        signal: controller.signal,
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requestCount, 1);
      controller.abort();
      await assert.rejects(pending, (error) => error?.name === 'AbortError');
      await new Promise((resolve) => originalSetTimeout(resolve, 80));
      assert.equal(requestCount, 1,
        'an aborted backoff must not wake up and contact the provider again');

      requestCount = 0;
      shortenModelTimeout = true;
      await assert.rejects(
        processText({
          text: 'Please explain the fictional notice.',
          backend: 'openai',
          model: 'gpt-4o',
          languageHint: 'en',
          ignoreCustomPrompt: true,
          settingsSnapshot: { openaiApiKey: 'fixture-key' },
        }),
        (error) => error?.message === '模型响应超时',
      );
      await new Promise((resolve) => originalSetTimeout(resolve, 80));
      assert.equal(requestCount, 1,
        'a timed-out backoff must not wake up and contact the provider again');
    } finally {
      Module._load = originalLoad;
      global.setTimeout = originalSetTimeout;
    }
  });

  await check('DeepSeek V4 action briefs disable default thinking', async () => {
    const originalLoad = Module._load;
    let request;
    class FakeOpenAI {
      constructor(options) {
        assert.equal(options.apiKey, 'fixture-key');
        assert.equal(options.baseURL, 'https://api.deepseek.com');
        assert.equal(options.maxRetries, 0, 'Slipstream must own DeepSeek retries');
        this.chat = {
          completions: {
            create: async (payload) => {
              request = payload;
              return { choices: [{ finish_reason: 'stop', message: { content: '{"fixture":true}' } }] };
            },
          },
        };
      }
    }

    Module._load = function load(request, parent, isMain) {
      if (request === 'openai') return FakeOpenAI;
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const result = await processText({
        text: 'Please submit the fictional form.',
        backend: 'deepseek',
        model: 'deepseek-v4-flash',
        languageHint: 'en',
        ignoreCustomPrompt: true,
        settingsSnapshot: { deepseekApiKey: 'fixture-key' },
      });

      assert.equal(result.result, '{"fixture":true}');
      assert.equal(request.model, 'deepseek-v4-flash');
      assert.deepEqual(request.thinking, { type: 'disabled' });
      assert.deepEqual(request.response_format, { type: 'json_object' });
      assert.equal(request.temperature, 0);
    } finally {
      Module._load = originalLoad;
    }
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

  await check('free translation fallback uses a concrete MyMemory language pair', async () => {
    assert.deepEqual(resolveFreeTranslateLanguages('Please reply by Friday.', 'auto'), {
      googleSourceLang: 'auto',
      fallbackSourceLang: 'en',
      targetLang: 'zh-CN',
    });
    assert.deepEqual(resolveFreeTranslateLanguages('请在星期五之前回复。', 'auto'), {
      googleSourceLang: 'auto',
      fallbackSourceLang: 'zh-CN',
      targetLang: 'en',
    });

    const originalFetch = global.fetch;
    const requestUrls = [];
    try {
      global.fetch = async (url) => {
        requestUrls.push(url);
        if (url.startsWith('https://translate.googleapis.com/')) {
          return { ok: false, status: 503 };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            responseStatus: 200,
            responseData: { translatedText: '请在星期五之前回复。' },
          }),
        };
      };

      const translated = await processFreeTranslate('Please reply by Friday.', 'auto');
      assert.match(translated, /^请在星期五之前回复。/);
      assert.equal(requestUrls.length, 2);
      const fallbackUrl = new URL(requestUrls[1]);
      assert.equal(fallbackUrl.hostname, 'api.mymemory.translated.net');
      assert.equal(fallbackUrl.searchParams.get('langpair'), 'en|zh-CN');
      assert.notEqual(fallbackUrl.searchParams.get('langpair'), 'auto|zh-CN');
    } finally {
      global.fetch = originalFetch;
    }
  });

  await check('free translation has one bounded whole-task deadline', async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const requestUrls = [];
    let resolveHungFetch;
    let hungFetchSignal;

    try {
      global.setTimeout = (callback, delay, ...args) => originalSetTimeout(
        callback,
        delay === FREE_TRANSLATE_TASK_TIMEOUT_MS ? 20 : delay,
        ...args,
      );
      global.fetch = async (url, options = {}) => {
        requestUrls.push(url);
        if (requestUrls.length === 1) {
          return {
            ok: true,
            json: async () => [[['first chunk']]],
          };
        }

        hungFetchSignal = options.signal;
        return new Promise((resolve) => {
          resolveHungFetch = resolve;
        });
      };

      const startedAt = Date.now();
      await assert.rejects(
        processFreeTranslate('a'.repeat(901), 'en'),
        (error) => {
          assert.equal(error.message, '模型响应超时');
          return true;
        },
      );
      assert.ok(Date.now() - startedAt < 500, 'the whole-task deadline must settle promptly');
      assert.equal(requestUrls.length, 2, 'translation must stop before starting a later chunk');
      assert.equal(hungFetchSignal?.aborted, true, 'the active provider request must be aborted');

      resolveHungFetch?.({
        ok: true,
        json: async () => [[['late chunk']]],
      });
      await new Promise((resolve) => originalSetTimeout(resolve, 10));
      assert.equal(requestUrls.length, 2, 'a late provider result must not resume chunk processing');
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
    }
  });

  await check('free translation preserves cancellation and cleans parent listeners', async () => {
    const originalFetch = global.fetch;
    try {
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount += 1;
        return {
          ok: true,
          json: async () => [[['translated']]],
        };
      };

      const alreadyCancelled = new AbortController();
      alreadyCancelled.abort();
      await assert.rejects(
        processFreeTranslate('cancelled before start', 'en', alreadyCancelled.signal),
        (error) => {
          assert.equal(error.name, 'AbortError');
          return true;
        },
      );
      assert.equal(fetchCount, 0, 'an already-cancelled task must not contact a provider');

      let addedListener;
      let addCount = 0;
      let removeCount = 0;
      const observableParentSignal = {
        aborted: false,
        reason: undefined,
        addEventListener(eventName, listener) {
          assert.equal(eventName, 'abort');
          addCount += 1;
          addedListener = listener;
        },
        removeEventListener(eventName, listener) {
          assert.equal(eventName, 'abort');
          assert.equal(listener, addedListener);
          removeCount += 1;
        },
      };
      await processFreeTranslate('listener cleanup', 'en', observableParentSignal);
      assert.equal(addCount, 1);
      assert.equal(removeCount, 1, 'the parent listener must be removed after success');

      const activeCancellation = new AbortController();
      let activeFetchSignal;
      global.fetch = async (url, options = {}) => new Promise((resolve, reject) => {
        activeFetchSignal = options.signal;
        const abortError = new Error('provider request aborted');
        abortError.name = 'AbortError';
        options.signal.addEventListener('abort', () => reject(abortError), { once: true });
      });

      const activeTask = processFreeTranslate('cancel while active', 'en', activeCancellation.signal);
      await new Promise((resolve) => setImmediate(resolve));
      activeCancellation.abort();
      await assert.rejects(activeTask, (error) => {
        assert.equal(error.name, 'AbortError');
        return true;
      });
      assert.equal(activeFetchSignal?.aborted, true);
    } finally {
      global.fetch = originalFetch;
    }
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
