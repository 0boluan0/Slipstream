'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { referenceKey, referenceOccurrences, isNotation } = require('../src/main/reading-references');
const { createReadingProcessor } = require('../src/main/reading-service');
const { matchesReferenceSearch } = require('../src/shared/reading-notation.cjs');

async function main() {
  assert.equal(referenceKey('$x_{i}$'), referenceKey('x_i'));
  assert.equal(referenceKey('xᵢ'), referenceKey('x_i'));
  assert.equal(referenceKey('λ'), referenceKey('\\lambda'));
  assert.notEqual(referenceKey('\\lambda R'), referenceKey('\\lambdaR'));
  for (const symbol of ['β1', 'β₁', '\\beta_1']) {
    for (const query of ['β1', 'β₁', '\\beta_1']) assert(matchesReferenceSearch({ symbol }, query));
  }
  assert.notEqual(referenceKey('β1'), referenceKey('β₁'), 'forgiving search must not merge stored identities');
  for (const symbol of ['X', 'x_i', 'x^2', '\\hat{x}', '\\mathbf{x}']) assert(!matchesReferenceSearch({ symbol }, 'x'));
  assert(!matchesReferenceSearch({ symbol: 'X1' }, 'x1'));
  assert(matchesReferenceSearch({ symbol: 'β1', meaning: '一阶矩的衰减率。' }, '衰减'));
  for (const symbol of ['X', 'x_i', 'x^2', '\\mathbf{x}', '\\hat{x}', '\\mathbb{X}']) assert.notEqual(referenceKey(symbol), referenceKey('x'));
  assert(isNotation('\\lambda'));
  assert(!isNotation('likelihood'));
  assert.equal(referenceOccurrences('extra x_i x^2 \\hat{x} \\mathbf{x} X', 'x').length, 0);
  assert.equal(referenceOccurrences('We use $x_{i}$ and xᵢ.', 'x_i').length, 2);
  assert.equal(referenceOccurrences('The value λ is positive.', '\\lambda').length, 1);
  assert.equal(referenceOccurrences('Our ELBO estimate is unbiased.', 'ELBO').length, 1);
  assert.equal(referenceOccurrences('x_{ij}', 'x_i').length, 0);

  const source = 'Let $x_i$ denote the feature vector of sample i. Let $\\lambda$ denote the regularization strength.';
  const definition = { symbol: 'x_i', meaning: '第 i 个样本的特征向量。', evidence: source.split('. ')[0] + '.', source, origin: 'excerpt', scope: '' };
  let calls = 0;
  const processor = createReadingProcessor(async (...args) => {
    calls += 1;
    assert.match(args[3], /Do not infer a symbol meaning from convention/);
    return JSON.stringify({ translation: '令 $x_i$ 表示第 i 个样本的特征向量。', terms: [], references: [definition,
      { ...definition, symbol: 'q', evidence: 'q is the posterior.' },
      { ...definition, symbol: 'y_i' }, { ...definition, evidence: 'invented' }, definition] });
  });
  const settings = { activeBackend: 'custom', activeModel: 'fixture' };
  const translated = await processor({ text: source, withTerms: true, withReferences: true, settingsSnapshot: settings });
  assert.equal(calls, 1, 'definitions share the translation request');
  assert.deepEqual(translated.references, [definition], 'unanchored or duplicate definitions cannot become suggestions');
  assert.equal((await processor({ text: source, kind: 'references', settingsSnapshot: settings })).references.length, 1);
  const domainSource = 'Let $x_i \\in \\mathbb{R}^d$ denote the feature vector.';
  const domainProcessor = createReadingProcessor(async () => JSON.stringify({ references: [{ symbol: '$x_i \\in \\mathbb{R}^d$', meaning: 'd 维特征向量。', evidence: domainSource }] }));
  const domain = await domainProcessor({ text: domainSource, kind: 'references', settingsSnapshot: settings });
  assert.equal(domain.references[0].symbol, 'x_i', 'domain declarations must not become part of a variable name');
  assert.equal(referenceOccurrences('The vector $x_i$ is observed.', domain.references[0].symbol).length, 1);
  const empty = createReadingProcessor(async () => JSON.stringify({ translation: '下一节讨论实验。', terms: [], references: [] }));
  assert.deepEqual((await empty({ text: 'The next section discusses experiments.', withReferences: true, settingsSnapshot: settings })).references, []);
  await assert.rejects(processor({ text: source, kind: 'references', settingsSnapshot: { activeBackend: 'free_translate' } }), /reading-model-required/);

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slipstream-reference-store-'));
  try {
    const directory = path.join(work, 'references');
    const store = createReadingReferenceStore(directory);
    assert.deepEqual((await store.read()).papers, []);
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' }, 'reading without saving leaves no history file');
    const a = await store.create('论文 A');
    const b = await store.create('论文 B');
    await store.select(a.id);
    const saved = await store.add(a.id, definition);
    const duplicate = await store.add(a.id, { ...definition, meaning: '重新措辞' });
    assert.equal(duplicate.id, saved.id, 'the same source definition should not accumulate copies');
    const conflict = { ...definition, origin: 'manual', scope: '附录', meaning: '附录中重新定义的标量。' };
    await store.add(a.id, conflict);
    await store.add(b.id, { ...definition, origin: 'manual', meaning: '论文 B 的另一种含义。' });
    const fresh = createReadingReferenceStore(directory);
    const data = await fresh.read();
    assert.equal(data.activePaperId, a.id);
    assert.equal(data.papers.find((paper) => paper.id === a.id).entries.length, 2);
    assert.equal(data.papers.find((paper) => paper.id === b.id).entries.length, 1);
    const edit = { ...definition, origin: 'manual', meaning: '经过核对的特征向量。' };
    const results = await Promise.allSettled([store.edit(a.id, saved.id, edit, 1), store.edit(a.id, saved.id, { ...edit, meaning: '过期的修改' }, 1)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'stale editors must not overwrite newer definitions');
    await assert.rejects(store.add(a.id, { ...definition, evidence: 'fabricated' }));
    const removed = await store.removePaper(a.id);
    assert.equal((await store.read()).activePaperId, null);
    await assert.rejects(store.add(a.id, definition), /reference-paper-not-found/);
    await store.restorePaper(removed);
    assert.equal((await fresh.read()).activePaperId, a.id);
    const file = path.join(directory, 'references.json');
    await fs.writeFile(file, '{broken');
    await assert.rejects(store.create('不能覆盖损坏文件'));
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally { await fs.rm(work, { recursive: true, force: true }); }
  console.log('Reading reference checks passed: notation identity, grounded extraction, zero suggestions, persistence, isolation, conflict protection and recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
