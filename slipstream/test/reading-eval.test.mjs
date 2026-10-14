import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BUNDLE_FORMAT, loadEvalFile, runEvalSuites, sealEval, summarizeEval, unsealEval } = require('../src/main/reading-eval.js');
const evalDirectory = new URL('../eval/dev/', import.meta.url);

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-eval-test-'));
}

test('every development case file loads and validates', () => {
  const files = fs.readdirSync(evalDirectory).filter((name) => name.endsWith('.json'));
  assert.deepEqual(files.sort(), ['lookups.json', 'references.json', 'terms.json', 'translations.json']);
  for (const name of files) {
    const loaded = loadEvalFile(new URL(name, evalDirectory));
    assert.equal(loaded.visibility, 'dev');
    assert.equal(loaded.sealed, false);
    assert.ok(loaded.suites[0].cases.length > 0, name);
  }
});

test('a sealed bundle opens only with its key and rejects tampering', () => {
  const directory = temporaryDirectory();
  const bundle = { format: BUNDLE_FORMAT, suites: [{ suite: 'lookup', cases: [
    { id: 'ho-1', selection: 'basis', source: 'A basis spans the space.', criteria: 'private rubric' }] }] };
  const keyFile = path.join(directory, 'key');
  fs.writeFileSync(keyFile, 'k'.repeat(43));
  const sealedFile = path.join(directory, 'cases.sealed.json');
  const envelope = sealEval(JSON.stringify(bundle), 'k'.repeat(43));
  fs.writeFileSync(sealedFile, JSON.stringify(envelope));

  assert.doesNotMatch(fs.readFileSync(sealedFile, 'utf8'), /basis|private rubric/u, 'no case text is stored in the clear');
  const loaded = loadEvalFile(sealedFile, { keyFile });
  assert.equal(loaded.visibility, 'held-out');
  assert.equal(loaded.suites[0].cases[0].criteria, 'private rubric');

  assert.throws(() => loadEvalFile(sealedFile), /eval-key-required/);
  assert.throws(() => unsealEval(envelope, 'x'.repeat(43)), /eval-wrong-key-or-damaged/);
  const tampered = { ...envelope, ciphertext: Buffer.from('changed').toString('base64') };
  assert.throws(() => unsealEval(tampered, 'k'.repeat(43)), /eval-wrong-key-or-damaged/);
  assert.throws(() => sealEval('{}', 'short'), /eval-passphrase-too-short/);
});

test('malformed cases are rejected before any request', () => {
  const directory = temporaryDirectory();
  const write = (value) => {
    const file = path.join(directory, `${Math.random()}.json`);
    fs.writeFileSync(file, JSON.stringify({ format: 'slipstream-eval/1', ...value }));
    return file;
  };
  assert.throws(() => loadEvalFile(write({ suite: 'lookup', cases: [{ id: 'a', selection: 'missing', source: 'Text.' }] })),
    /eval-invalid-case:a/, 'a lookup selection must occur in its source');
  assert.throws(() => loadEvalFile(write({ suite: 'terms', cases: [{ id: 'a', source: 'x' }, { id: 'a', source: 'y', empty: true }] })),
    /eval-invalid-case/, 'terms need an expectation and unique ids');
  assert.throws(() => loadEvalFile(write({ suite: 'unknown', cases: [{ id: 'a', source: 'x' }] })), /eval-invalid-suite/);
});

test('only the source and selection reach the reading service', async () => {
  const requests = [];
  const processReadingText = async (options) => {
    requests.push(options);
    if (options.kind === 'lookup') return { lookup: { quote: options.selection, meaning: '张成整个空间的一组向量。', note: '' } };
    return { translation: '一组基张成整个空间。', terms: [], references: [] };
  };
  const records = await runEvalSuites({ processReadingText, settings: { activeBackend: 'custom' }, suites: [
    { suite: 'lookup', cases: [{ id: 'basis', selection: 'basis', source: 'A basis spans the space.', criteria: 'SECRET-RUBRIC', mustMatch: ['张成'] }] },
    { suite: 'translation', cases: [{ id: 'span', source: 'A basis spans the space.', criteria: 'SECRET-RUBRIC', mustNotMatch: ['覆盖'] }] },
  ] });
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(requests.map((request) => ({ ...request, signal: undefined }))), /SECRET-RUBRIC/u);
  assert.deepEqual(records.map((record) => [record.id, record.automaticPass, record.semanticStatus]),
    [['basis', true, 'needs-review'], ['span', true, 'needs-review']]);
});

test('term and notation suites are scored automatically', async () => {
  const source = 'A collider is influenced by an exposure and an outcome.';
  const processReadingText = async ({ withReferences }) => withReferences
    ? { translation: '', terms: [], references: [{ symbol: 'x_i' }] }
    : { translation: '', terms: [{ quote: 'collider', start: 2, end: 10 }, { quote: 'outcome', start: 47, end: 54 }] };
  const records = await runEvalSuites({ processReadingText, settings: {}, suites: [
    { suite: 'terms', cases: [{ id: 'collider', source, required: 'collider', excluded: ['outcome'] }] },
    { suite: 'references', cases: [{ id: 'symbol', source: 'Let $x_i$ denote a point.', expected: ['x_i'] }] },
  ] });
  const terms = records.find((record) => record.suite === 'terms');
  assert.equal(terms.automaticPass, false, 'an excluded supporting word fails the case');
  assert.deepEqual(terms.checks.map((entry) => entry.passed), [true, true, false]);
  assert.equal(records.find((record) => record.suite === 'references').automaticPass, true);
});

test('a failed request is recorded with a safe error code and does not stop the run', async () => {
  let calls = 0;
  const processReadingText = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('reading-invalid-output'), { status: 502 });
    return { translation: '译文', terms: [] };
  };
  const records = await runEvalSuites({ processReadingText, settings: {}, suites: [{ suite: 'translation', cases: [
    { id: 'first', source: 'One.' }, { id: 'second', source: 'Two.' }] }] });
  assert.deepEqual(records[0].failure, { code: 'reading-invalid-output', status: 502 });
  assert.equal(records[1].automaticPass, true);
  assert.equal(summarizeEval(records).failures, 1);
});

test('image cases render the authored source and read it through the image path', async () => {
  const rendered = [];
  const records = await runEvalSuites({ settings: {}, repetitions: 2,
    renderImage: async (source) => { rendered.push(source); return 'data:image/png;base64,AAAA'; },
    readScreenshot: async ({ image, onTranslation }) => {
      assert.equal(image, 'data:image/png;base64,AAAA');
      onTranslation?.();
      return { text: 'Let $A$ be invertible.', translation: '设 $A$ 可逆。', uncertain: [], terms: [] };
    },
    suites: [{ suite: 'image', cases: [{ id: 'formula', source: 'Let $A$ be invertible.', sourceMustMatch: ['\\$A\\$'], mustMatch: ['可逆'] }] }] });
  assert.equal(rendered.length, 2, 'each repetition reads a fresh render');
  assert.ok(records.every((record) => record.automaticPass));
  const summary = summarizeEval(records);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.bySuite, { image: { total: 2, automaticPass: 2 } });
});
