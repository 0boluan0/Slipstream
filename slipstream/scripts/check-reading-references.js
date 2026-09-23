'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { referenceKey, referenceCandidateKey, referenceCandidateCovered, evidenceDefinesSymbol,
  preferExplicitReferenceCandidates, referenceOccurrences, isNotation, parseReferenceCandidates } = require('../src/main/reading-references');
const { createReadingProcessor } = require('../src/main/reading-service');
const { matchesReferenceSearch } = require('../src/shared/reading-notation.cjs');
const { captureSource, paperForCapture, titleForCapture } = require('../src/main/reading-capture-source');

async function main() {
  const calibrationWindow = captureSource({ bundleId: 'com.apple.Preview', title: 'calibration.pdf' });
  const simclrWindow = captureSource({ bundleId: 'com.apple.Preview', title: 'simclr.pdf' });
  assert(calibrationWindow && simclrWindow && calibrationWindow.key !== simclrWindow.key);
  assert.equal(captureSource({ bundleId: 'com.apple.Preview', title: 'Slipstream · 阅读卡片' }), null);
  assert.equal(titleForCapture(simclrWindow), 'simclr');
  assert.equal(paperForCapture({ activePaperId: 'old', papers: [{ id: 'old', sourceKey: calibrationWindow.key }] }, simclrWindow), null,
    'a new document cannot inherit the previous paper by active selection');
  assert.equal(paperForCapture({ activePaperId: 'old', papers: [{ id: 'old', sourceKey: calibrationWindow.key }] }, null), null,
    'an unidentifiable screenshot must not reuse the prior paper');
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
  assert.equal(referenceOccurrences(String.raw`$(t \sim \mathcal T)$`, 'sim').length, 0,
    'a saved similarity function cannot match the unrelated TeX sampling relation');
  assert.equal(referenceOccurrences(String.raw`$\operatorname{sim}(u,v)$`, 'sim').length, 1,
    'the same function name remains findable when typeset as a named operator');
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
    assert.match(args[3], /numerical value used only in an example/);
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
  const lineBrokenResidual = residualSource.replace('we explicitly', 'we\nexplicitly');
  const modelResidual = { symbol: String.raw`\mathcal { F }`, meaning: '残差函数，定义为 H(x)−x。', evidence: residualSource };
  const restored = parseReferenceCandidates([modelResidual], lineBrokenResidual);
  assert.equal(restored.length, 1, 'a model quote that collapses a PDF line break still anchors the explicit definition');
  assert.equal(restored[0].evidence, lineBrokenResidual, 'stored evidence retains the exact source line break');
  assert.deepEqual(parseReferenceCandidates([{ ...modelResidual, evidence: residualSource.replace('residual', 'original') }], lineBrokenResidual), [],
    'whitespace tolerance cannot admit a changed definition');
  const residualProcessor = createReadingProcessor(async (_settings, _backend, _model, prompt) => {
    assert.match(prompt, /explicit definition with :=/);
    return JSON.stringify({ references: [{ symbol: String.raw`\mathcal F`,
      meaning: '残差函数；对输入 x 定义为 H(x)−x。', evidence: residualSource }] });
  });
  assert.equal((await residualProcessor({ text: residualSource, kind: 'references', settingsSnapshot: settings })).references.length, 1,
    'an explicitly defined styled function is retained instead of being filtered after model extraction');
  // Captured from the native Preview crop of Breiman's Random Forests, p. 4.
  // The model returned all three explicit definitions, but local grounding
  // previously discarded the two named formula atoms.
  const forestSource = String.raw`define the
margin function as

$$m g ( { \bf X }, \! Y ) = a v _ { k } I ( h _ { k } ( { \bf X } ) \! = \! Y ) \! - \! \operatorname * { m a x } _ { j \neq Y } a v _ { k } I ( h _ { k } ( { \bf X } ) \! = \! j ) \,$$.

where I(•) is the indicator function. The generalization error is given by

$$P E ^ { \ast } = P _ { \mathbf { X }, Y } ( m g ( \mathbf { X }, Y ) < 0 )$$`;
  const forestCandidates = parseReferenceCandidates([
    { symbol: 'mg', meaning: '间隔函数', evidence: forestSource.slice(0, forestSource.indexOf('\n\nwhere')).replace('\\,$$.', () => String.raw`\,.$$`) },
    { symbol: 'I', meaning: '指示函数', evidence: 'where I(•) is the indicator function.' },
    { symbol: String.raw`PE^{\ast}`, meaning: '泛化误差', evidence: forestSource.slice(forestSource.indexOf('The generalization error')) },
  ], forestSource);
  assert.deepEqual(forestCandidates.map(({ symbol }) => symbol), ['mg', 'I', String.raw`PE^{\ast}`]);
  assert(forestCandidates.every(({ evidence }) => forestSource.includes(evidence)), 'repaired quotes retain exact source bytes');
  assert.equal(referenceOccurrences(forestSource, 'mg').length, 2, 'OCR-spaced function name remains clickable in both formulas');
  assert.equal(referenceOccurrences(forestSource, String.raw`PE^{\ast}`).length, 1, 'OCR-spaced name with an exponent remains clickable');
  assert.equal(referenceOccurrences(String.raw`$m g + x$`, 'mg').length, 0, 'a letter-spaced product is not a named function call');
  assert.deepEqual(parseReferenceCandidates([{ symbol: 'mg', meaning: '间隔函数',
    evidence: forestCandidates[0].evidence.replace('j )', 'z )') }], forestSource), [],
  'math punctuation tolerance cannot change the defining equation');
  const notationEvidence = 'If a normal distribution has mean $\\mu$ and standard deviation $\\sigma$, we may write the distribution\nas $N ( \\mu, \\sigma )$.';
  const specialEvidence = 'The normal distribution with mean $\\mu = 0$ and standard deviation\n$\\sigma = 1$ is called the standard normal distribution.';
  const textbookSource = `${notationEvidence} The two distributions are examples.\n\n${specialEvidence}`;
  const textbook = parseReferenceCandidates([
    { symbol: String.raw`N ( \mu, \sigma )`, meaning: '均值为 μ、标准差为 σ 的正态分布的记法', evidence: notationEvidence },
    { symbol: String.raw`\mu`, meaning: '标准正态分布的均值，取值为 0', evidence: specialEvidence },
    { symbol: String.raw`\sigma`, meaning: '标准正态分布的标准差，取值为 1', evidence: specialEvidence },
  ], textbookSource);
  assert.deepEqual(textbook.map((item) => item.symbol), [String.raw`N ( \mu, \sigma )`],
    'values assigned only for a special-case distribution must not become reusable parameter definitions');
  assert(referenceCandidateCovered({ ...textbook[0], symbol: 'N' }, textbook[0]),
    'a bare function head from the same sentence adds nothing after the full notation was saved');
  assert(!referenceCandidateCovered(textbook[0], { ...textbook[0], symbol: 'N' }),
    'the full notation must still be available when only its bare head was saved');
  const editedCandidate = { ...textbook[0], origin: 'manual', meaning: '读者校正后的解释' };
  assert(referenceCandidateCovered(textbook[0], editedCandidate),
    'a saved manual correction must hide the same source-backed suggestion');
  assert(!referenceCandidateCovered({ ...textbook[0], evidence: 'In this section, let $N$ denote the sample count.' }, editedCandidate),
    'an explicitly different source definition may reuse the same symbol');
  const phiSaved = { symbol: String.raw`\phi`, origin: 'excerpt', evidence: 'Let $\\phi$ denote an element transformation.' };
  assert(referenceCandidateCovered({ ...phiSaved, evidence: 'Each element is transformed to a representation $\\phi(x_m)$.' }, phiSaved),
    'reusing a saved symbol in an architecture bullet must not suggest a second definition');
  assert(!referenceCandidateCovered({ ...phiSaved, evidence: 'In this section, let $\\phi$ denote the inverse map.' }, phiSaved),
    'an explicit local redefinition remains available for review');
  const binDefinition = { symbol: 'B_m', origin: 'excerpt', evidence: 'Let $B_m$ be the set of indices of samples in the interval.' };
  const binUsage = { ...binDefinition, evidence: 'We define the average confidence within bin $B_m$ as a mean.' };
  assert(evidenceDefinesSymbol(binDefinition));
  assert(!evidenceDefinesSymbol(binUsage), 'defining confidence within a bin does not redefine the bin');
  assert(referenceCandidateCovered(binUsage, binDefinition), 'a saved bin definition covers a later incidental use');
  assert.deepEqual(preferExplicitReferenceCandidates([binUsage, binDefinition]), [binDefinition],
    'show the source definition once rather than a duplicate use of the same symbol');
  const textbookExcerpt = 'The sample space is usually denoted by $\\Omega$. The event space contains subsets of $\\Omega$.';
  const textbookDefinition = { symbol: '\\Omega', origin: 'excerpt', evidence: 'The sample space is usually denoted by $\\Omega$.',
    source: 'The sample space is usually denoted by $\\Omega$.' };
  const textbookReuse = { ...textbookDefinition, evidence: 'The event space contains subsets of $\\Omega$.', source: textbookExcerpt };
  assert.deepEqual(preferExplicitReferenceCandidates([textbookDefinition, textbookReuse]), [textbookDefinition],
    'translation and later extraction from overlapping passages must not offer the same symbol twice');
  const redefinitionSource = 'Let $x$ denote the observed value. In this section, let $x$ denote its estimate.';
  const observedX = { symbol: 'x', origin: 'excerpt', evidence: 'Let $x$ denote the observed value.', source: redefinitionSource };
  const estimatedX = { ...observedX, evidence: 'In this section, let $x$ denote its estimate.' };
  assert.deepEqual(preferExplicitReferenceCandidates([observedX, estimatedX]), [observedX, estimatedX],
    'two explicit local definitions of one symbol must remain separately reviewable');
  assert(!referenceCandidateCovered({ ...binDefinition, evidence: 'In this section, let $B_m$ be the set of incorrectly classified samples.' }, binDefinition),
    'a genuine local redefinition of the bin remains available');
  const fixedSetting = 'Let $\\lambda = 0.1$ denote the regularization strength throughout the study.';
  assert.equal(parseReferenceCandidates([{ symbol: String.raw`\lambda`, meaning: '全篇固定的正则化系数，取值为 0.1',
    evidence: fixedSetting }], fixedSetting).length, 1,
  'a value explicitly fixed for the whole reading remains available');
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
    await store.select(a.id, calibrationWindow.key);
    assert.equal(paperForCapture(await store.read(), calibrationWindow), a.id);
    assert.equal(paperForCapture(await store.read(), simclrWindow), null);
    await store.select(b.id, calibrationWindow.key);
    assert.equal(paperForCapture(await store.read(), calibrationWindow), b.id, 'one window belongs to one paper');
    assert.equal((await store.read()).papers.find((paper) => paper.id === a.id).sourceKey, undefined);
    await store.select(a.id, calibrationWindow.key);
    await assert.rejects(store.select(b.id, 'bad-key'), /reference-invalid-source/);
    assert.equal((await store.read()).activePaperId, a.id, 'invalid source must not change selection');
    const saved = await store.add(a.id, definition);
    const duplicate = await store.add(a.id, { ...definition, meaning: '重新措辞' });
    assert.equal(duplicate.id, saved.id, 'the same source definition should not accumulate copies');
    const otherCrop = { ...definition, source: `Context before. ${source} Context after.` };
    assert.equal(referenceCandidateKey(otherCrop), referenceCandidateKey(saved),
      'the same quoted definition must be hidden after it is saved from a different crop');
    assert.equal((await store.add(a.id, otherCrop)).id, saved.id,
      'repeating the same definition from an overlapping screenshot must not save another copy');
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
