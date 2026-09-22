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
  assert.equal(referenceKey(String.raw`\mathcal F`), referenceKey(String.raw`\mathcal { F }`));
  assert.equal(referenceKey(String.raw`\bf x`), referenceKey(String.raw`\mathbf{x}`));
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
  // Real MMD OCR spells the operator as separated letters. Its p is not a
  // distribution variable and must not surface that paper's p definition.
  const operatorSource = String.raw`$\operatorname* { s u p }_{f\in\mathcal{F}} f(x)$`;
  assert.equal(referenceOccurrences(operatorSource, 'p').length, 0, 'an operator label must not become a saved-variable hit');
  assert.equal(referenceOccurrences(operatorSource, 'f').length, 2, 'operator bounds and arguments still contain real variables');
  assert.equal(referenceOccurrences(operatorSource, '\\mathcal{F}').length, 1);
  const labelledOperator = String.raw`$\operatorname{\text{s u p}}_{p} g(p)$`;
  const pHits = referenceOccurrences(labelledOperator, 'p');
  assert.equal(pHits.length, 2, 'nested operator typography must not add a third variable');
  assert.deepEqual(pHits.map(({ start, end }) => labelledOperator.slice(start, end)), ['p', 'p']);
  const pExpression = String.raw`$\operatorname{p}+p$`;
  assert.deepEqual(referenceOccurrences(pExpression, 'p'), [{ start: pExpression.lastIndexOf('p'), end: pExpression.lastIndexOf('p') + 1 }], 'the real variable keeps its original offset');

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
  // Captured in the installed preview while reading VI section 2.1. The model
  // returned the whole declaration, including the OCR's harmless TeX spaces.
  const assignmentSource = String.raw`Let $\mathbf { x } = \boldsymbol { x } _ { 1: n }$ be a set of observed variables.`;
  const assignmentDefinition = { symbol: String.raw`\mathbf { x } = \boldsymbol { x } _ { 1: n }`,
    meaning: '一组观测变量', evidence: assignmentSource, source: assignmentSource, origin: 'excerpt', scope: '' };
  const assignmentProcessor = createReadingProcessor(async () => JSON.stringify({ references: [assignmentDefinition] }));
  const assignment = await assignmentProcessor({ text: assignmentSource, kind: 'references', settingsSnapshot: settings });
  assert.equal(referenceOccurrences(String.raw`We condition on $\mathbf{x}$.`, assignment.references[0].symbol).length, 1,
    'a saved declaration must match its variable in a later excerpt');
  assert.equal(referenceKey(assignment.references[0].symbol), String.raw`\mathbf{x}`);
  assert.equal(referenceKey(String.raw`\mathbf { x } _ { i }`), referenceKey(String.raw`\mathbf{x}_i`));
  assert(isNotation(String.raw`\mathbf { x } _ { i }`));
  assert.notEqual(referenceKey(String.raw`\mathbf { x }`), referenceKey('x'));
  assert.notEqual(referenceKey(String.raw`\mathbf { X }`), referenceKey(String.raw`\mathbf{x}`));
  assert.equal(referenceOccurrences(String.raw`The data $\mathbf{x}$ and $\mathbf { x }$ agree.`, String.raw`\mathbf{x}`).length, 2);
  const residualSource = 'we explicitly let these layers approximate a residual function ${ \\mathcal F } ( { \\bf x } ) \\,: = \\, { \\mathcal H } ( { \\bf x } ) \\, - \\, { \\bf x }$.';
  assert.equal(referenceOccurrences(residualSource, String.raw`\mathcal F`).length, 1,
    'the actual ResNet OCR spelling of the explicitly defined function must anchor its name');
  assert.equal(referenceOccurrences(residualSource, String.raw`\mathbf{x}`).length, 3,
    'the old TeX boldface spelling keeps the same variable identity');
  assert.equal(referenceOccurrences(residualSource, String.raw`\mathcal H`).length, 1);
  assert.equal(referenceOccurrences(residualSource, String.raw`\mathcal G`).length, 0,
    'anchoring a definition must not guess a different function');
  const residualProcessor = createReadingProcessor(async (_settings, _backend, _model, prompt) => {
    assert.match(prompt, /explicit definition with :=/);
    return JSON.stringify({ references: [{ symbol: String.raw`\mathcal F`,
      meaning: '残差函数；对输入 x 定义为 H(x)−x。', evidence: residualSource }] });
  });
  assert.equal((await residualProcessor({ text: residualSource, kind: 'references', settingsSnapshot: settings })).references.length, 1,
    'an explicitly defined styled function is retained instead of being filtered after model extraction');
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
    const oldData = JSON.parse(await fs.readFile(file, 'utf8'));
    const legacy = { ...assignmentDefinition, id: '47d85bad-bf42-4ec5-b55d-0811a96b22a2', revision: 1 };
    oldData.papers.find((paper) => paper.id === a.id).entries.push(legacy,
      { ...legacy, id: '9ef9e0a2-53d8-46c6-b32e-099c3eb82167', origin: 'manual' });
    const oldText = JSON.stringify(oldData, null, 2) + '\n';
    await fs.writeFile(file, oldText);
    const loaded = (await fresh.read()).papers.find((paper) => paper.id === a.id).entries;
    assert.equal(referenceOccurrences(String.raw`Given $\mathbf{x}$.`, loaded.find((entry) => entry.id === legacy.id).symbol).length, 1,
      'existing excerpt definitions remain usable after an upgrade');
    assert.equal(loaded.find((entry) => entry.id === '9ef9e0a2-53d8-46c6-b32e-099c3eb82167').symbol,
      assignmentDefinition.symbol, 'a manually chosen expression keeps its identity');
    assert.equal(await fs.readFile(file, 'utf8'), oldText, 'opening old definitions must not write to the user file');
    await fs.writeFile(file, '{broken');
    await assert.rejects(store.create('不能覆盖损坏文件'));
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally { await fs.rm(work, { recursive: true, force: true }); }
  console.log('Reading reference checks passed: notation identity, grounded extraction, zero suggestions, persistence, isolation, conflict protection and recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
