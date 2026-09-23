'use strict';

const assert = require('node:assert/strict');
const { createReadingProcessor } = require('../src/main/reading-service');
const { testProviderReadiness } = require('../src/main/provider-readiness');
const { READING_SETUP_SOURCE, readingSetupSample } = require('../src/shared/reading-setup.mjs');

const settings = { activeBackend: 'deepseek', activeModel: 'test-model', customPrompt: 'PRIVATE_USER_INSTRUCTIONS' };
const connected = async () => ({ status: 'connected', code: 'ok' });
const translation = { translation: '混杂变量同时影响处理与结果，因此关联并不意味着因果效应。', terms: [] };
const lookup = { quote: 'confounder', contextual: true, meaning: '同时影响处理与结果的变量。', note: '本段说明仅有统计关联不足以确立因果效应。' };
const validReading = async options => options.kind === 'lookup' ? { lookup } : translation;
const check = dependencies => testProviderReadiness(settings, {
  testProviderConnection: connected, processReadingText: validReading, ...dependencies,
});

async function main() {
  const calls = [];
  let legacyCalls = 0;
  const processReadingText = createReadingProcessor(async (...args) => {
    const input = JSON.parse(args[4]);
    calls.push({ input, prompt: args[3] });
    return JSON.stringify(input.selection ? {
      quote: input.selection,
      meaning: '混杂变量是同时影响处理与结果的变量，可能使二者看起来有关联。',
      note: '本段指出，仅观察到关联不足以证明处理对结果具有因果效应。',
    } : {
      translation: '在这个自拟示例中，混杂变量同时影响处理与结果。令 $X$ 表示处理，$Y$ 表示结果。仅凭二者之间的关联，不能确立因果效应。',
      terms: [],
    });
  });
  const result = await testProviderReadiness(settings, {
    testProviderConnection: connected,
    processReadingText,
    processText: async () => { legacyCalls += 1; throw new Error('Email analysis is unavailable'); },
  });
  assert.equal(result.status, 'connected', 'a model that can translate and explain a reading excerpt must pass setup even without email-action analysis');
  assert.equal(legacyCalls, 0, 'reading setup must not request email-action analysis');
  assert.equal(calls.length, 2, 'setup must exercise translation and an on-demand term explanation');
  assert.equal(calls[1].input.selection, 'confounder');
  assert.equal(calls[0].input.excerpt, calls[1].input.excerpt);
  assert.equal(calls[0].input.excerpt, READING_SETUP_SOURCE);
  assert(!JSON.stringify(calls).includes(settings.customPrompt), 'setup must not send the user\'s custom instructions');
  assert(result.sample.translation && result.sample.meaning, 'return the actual result for the user to inspect');

  let generationCalls = 0;
  assert.deepEqual(await check({
    testProviderConnection: async () => ({ status: 'failed', code: 'unauthorized' }),
    processReadingText: async () => { generationCalls += 1; },
  }), { status: 'failed', code: 'unauthorized' });
  assert.equal(generationCalls, 0, 'rejected credentials must not trigger generation');
  assert.equal((await check({ testProviderConnection: async () => ({ status: 'inconclusive', code: 'unsupported' }) })).status,
    'connected', 'a compatible service can work without a model-list endpoint');
  assert.equal((await check({ testProviderConnection: async () => ({ status: 'failed', code: 'model-not-found' }) })).status,
    'connected', 'a model alias missing from metadata must be accepted when real reading generation succeeds');
  assert.deepEqual(await check({
    testProviderConnection: async () => ({ status: 'failed', code: 'model-not-found' }),
    processReadingText: async () => { throw Object.assign(new Error('model not found'), { code: 'model_not_found' }); },
  }), { status: 'failed', code: 'model-not-found' }, 'a genuinely unavailable model still fails its generation request');

  for (const [label, backend] of [
    ['broken JSON', async () => 'not JSON'],
    ['wrong selected term', async (...args) => JSON.stringify(JSON.parse(args[4]).selection ? { ...lookup, quote: 'invented' } : translation)],
    ['English-only translation', async (...args) => JSON.stringify(JSON.parse(args[4]).selection ? lookup : { ...translation, translation: READING_SETUP_SOURCE })],
    ['English-only explanation', async (...args) => JSON.stringify(JSON.parse(args[4]).selection ? { ...lookup, meaning: 'A confounder influences both variables.' } : translation)],
    ['oversized setup result', async (...args) => JSON.stringify(JSON.parse(args[4]).selection ? lookup : { ...translation, translation: '译文'.repeat(2100) })],
  ]) {
    assert.deepEqual(await check({ processReadingText: createReadingProcessor(backend) }),
      { status: 'failed', code: 'structured-output-invalid' }, label);
  }
  for (const [status, code] of [[401, 'unauthorized'], [429, 'rate-limited'], [503, 'service-unavailable']]) {
    assert.deepEqual(await check({ processReadingText: async () => { throw Object.assign(new Error('PRIVATE_RESPONSE'), { status }); } }),
      { status: 'failed', code }, 'provider failures stay actionable without exposing the response');
  }

  const between = new AbortController();
  let betweenCalls = 0;
  assert.deepEqual(await check({ signal: between.signal, processReadingText: async () => {
    betweenCalls += 1; between.abort(); return translation;
  } }), { status: 'failed', code: 'cancelled' });
  assert.equal(betweenCalls, 1, 'cancelling after translation must prevent the term request');

  const preCancelled = new AbortController(); preCancelled.abort();
  assert.deepEqual(await check({ signal: preCancelled.signal, testProviderConnection: () => { throw new Error('must not start'); } }),
    { status: 'failed', code: 'cancelled' });
  const during = new AbortController();
  assert.deepEqual(await check({ signal: during.signal, processReadingText: async options => {
    if (options.kind === 'translate') return translation;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      during.abort();
    });
  } }), { status: 'failed', code: 'cancelled' }, 'cancellation must reach the active term request');

  assert.deepEqual(await check({ timeoutMs: 10, processReadingText: async options => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) }), { status: 'failed', code: 'timeout' }, 'the entire trial has one bounded deadline');

  const delayedCancellation = new AbortController();
  assert.deepEqual(await check({ timeoutMs: 10, signal: delayedCancellation.signal,
    processReadingText: async () => {
      delayedCancellation.abort();
      await new Promise(resolve => setTimeout(resolve, 25));
      return translation;
    },
  }), { status: 'failed', code: 'cancelled' }, 'a slow cancellation acknowledgement must not later be relabelled as timeout');

  const preview = { translation: translation.translation, meaning: lookup.meaning, note: '' };
  assert.deepEqual(readingSetupSample({ ...preview, apiKey: 'PRIVATE_KEY', settings }), preview,
    'the renderer preview accepts only the three bounded text fields');
  assert.equal(readingSetupSample({ ...preview, meaning: '<script>PRIVATE</script>' }), null);
  assert.equal(readingSetupSample({ ...preview, note: '\u0000' }), null);
  console.log('Reading setup passed: real reading contract, zero terms, preview boundaries, provider failures, cancellation and timeout.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
