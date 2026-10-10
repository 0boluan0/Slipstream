'use strict';

const assert = require('node:assert/strict');
const { createReadingProcessor } = require('../src/main/reading-service');
const { testProviderReadiness } = require('../src/main/provider-readiness');
const { READING_SETUP_SOURCE, readingSetupSample } = require('../src/shared/reading-setup.mjs');

const settings = { activeBackend: 'deepseek', activeModel: 'test-model', customPrompt: 'PRIVATE_USER_INSTRUCTIONS' };
const connected = async () => ({ status: 'connected', code: 'ok' });
const translation = { translation: '非零向量 $v$ 满足 $Av = 2v$，因此它是特征值为 $2$ 的特征向量。', terms: [] };
const lookup = { quote: 'eigenvector', contextual: true, meaning: '被矩阵作用后等于自身某个标量倍数的非零向量。', note: '本段以 $Av = 2v$ 说明对应特征值是 $2$。' };
const validReading = async options => options.kind === 'lookup' ? { lookup } : translation;
const check = dependencies => testProviderReadiness(settings, {
  requireImage: false, testProviderConnection: connected, processReadingText: validReading, ...dependencies,
});

async function main() {
  const calls = [];
  let legacyCalls = 0;
  const processReadingText = createReadingProcessor(async (...args) => {
    const input = JSON.parse(args[4]);
    calls.push({ input, prompt: args[3] });
    return JSON.stringify(input.selection ? {
      quote: input.selection,
      meaning: '特征向量是被矩阵作用后等于自身某个标量倍数的非零向量。',
      note: '本段用 $Av = 2v$ 说明对应特征值为 $2$。',
    } : {
      translation: translation.translation,
      terms: [],
    });
  });
  const result = await testProviderReadiness(settings, {
    requireImage: false,
    testProviderConnection: connected,
    processReadingText,
    processText: async () => { legacyCalls += 1; throw new Error('Email analysis is unavailable'); },
  });
  assert.equal(result.status, 'connected', 'a model that can translate and explain a reading excerpt must pass setup even without email-action analysis');
  assert.equal(legacyCalls, 0, 'reading setup must not request email-action analysis');
  assert.equal(calls.length, 2, 'setup must exercise translation and an on-demand term explanation');
  assert.equal(calls[1].input.selection, 'eigenvector');
  assert.equal(calls[0].input.excerpt, calls[1].input.excerpt);
  assert.equal(calls[0].input.excerpt, READING_SETUP_SOURCE);
  assert(!JSON.stringify(calls).includes(settings.customPrompt), 'setup must not send the user\'s custom instructions');
  assert(result.sample.translation && result.sample.meaning, 'return the actual result for the user to inspect');

  for (const [formula, accepted] of [
    ['$Av = 2v$', true], [String.raw`$A\,v = 2\,v$`, true],
    ['$Av = 3v$', false], ['$A = 2v$', false],
  ]) {
    const imageTrial = await check({ requireImage: true,
      readScreenshot: async () => ({ ...translation, uncertain: [],
        text: READING_SETUP_SOURCE.replace('$Av = 2v$', formula) }),
    });
    assert.equal(imageTrial.status, accepted ? 'connected' : 'failed',
      'image trial accepts TeX spacing but checks the visible mathematical example');
    if (!accepted) assert.equal(imageTrial.code, 'image-not-supported');
  }

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
    ['English-only explanation', async (...args) => JSON.stringify(JSON.parse(args[4]).selection ? { ...lookup, meaning: 'An eigenvector is a nonzero vector.' } : translation)],
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
