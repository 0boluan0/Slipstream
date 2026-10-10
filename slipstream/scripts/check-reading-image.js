'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createImageReader, sameMath, validateReadingImage } = require('../src/main/reading-image');
const image = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../src/shared/reading-setup.png')).toString('base64')}`;
const settingsSnapshot = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'deepseek-flash' };
const valid = { source: 'The gradient is $g_t = \\nabla f(\\theta_{t-1})$.',
  translation: '梯度是 $g_t = \\nabla f(\\theta_{t-1})$。', terms: [], references: [], uncertain: [] };

async function run() {
  for (const [a, b] of [
    ['$x_i$', '$x_j$'], ['$x+y$', '$x-y$'], ['$x^2$', '$x^3$'],
    ['$\\mathbf{x}$', '$x$'], ['$\\sum_{i=1}^n x_i$', '$\\sum_{i=0}^n x_i$'],
    ['$\\text{softmax}(x)$', '$\\text{sigmoid}(x)$'],
    ['$x=\\text{training}$', '$x=\\text{validation}$'],
  ]) assert.equal(sameMath(a, b), false, `changed mathematical content: ${a}`);
  assert.equal(sameMath('Initialize $1^{st}$ moment, $m_0=0$.', '初始化第 1 矩，$m_0=0$。'), true);
  assert.equal(sameMath('The $28^{th}$ conference.', '第 $28$ 届会议。'), true);
  assert.equal(sameMath('The $28^{th}$ conference.', '第 $29$ 届会议。'), false);
  assert.equal(sameMath('$X\\to$\n$\\{0,1\\}$', '$X\\to\\{0,1\\}$'), true);
  assert.equal(sameMath('The value is $x$\n\n$$u+v$$', '数值是 $x$。\n\n$$u+v$$'), true,
    'independent display formulas remain separate when prose moves');
  assert.equal(sameMath('$x_i \\text{ are raw input vectors}$', '$x_i \\text{ 是原始输入向量}$'), true);
  assert.equal(sameMath('$x$ then $y$.', '$y$，然后 $x$。'), true);
  const separateLabels = 'Probability $q$    $a$';
  assert.equal(sameMath(separateLabels, '以概率$q$出现，权重$a$'), true,
    'independent adjacent labels remain intact when translated prose separates them');
  for (const translation of ['以概率$q$出现，权重$b$', '以概率$q$出现',
    '以概率$q$出现，权重$a$，另有$a$', '以概率$q$出现，权重$a$，另有$z$']) {
    assert.equal(sameMath(separateLabels, translation), false, 'label identity and multiplicity remain exact');
  }
  assert.equal(sameMath('$q$ $q$ $a$', '$q$ 和 $a$'), false, 'repeated source labels cannot disappear');
  assert.equal(sameMath('$x+y$ $a$', '$x-y$ 和 $a$'), false, 'prose changes cannot hide a sign change');
  let labelStep = 0;
  const labelResult = await createImageReader(async () => ++labelStep === 1
    ? JSON.stringify({ source: separateLabels, uncertain: [] })
    : JSON.stringify({ translation: '以概率[[SLIPSTREAM_MATH_0]]出现，权重[[SLIPSTREAM_MATH_1]]', terms: [] }))({ image, settingsSnapshot });
  assert.equal(labelResult.translation, '以概率$q$出现，权重$a$');
  assert.equal(labelStep, 2, 'intact adjacent labels need no additional translation request');
  assert.throws(() => validateReadingImage('data:image/png;base64,aGVsbG8='), /reading-invalid-image/u);
  let calls = 0;
  const read = createImageReader(async (_settings, backend, model, _prompt, content) => {
    calls += 1;
    assert.equal(backend, settingsSnapshot.activeBackend); assert.equal(model, settingsSnapshot.activeModel);
    if (calls === 1) {
      assert.equal(content[1].image_url.url, image);
      return JSON.stringify({ source: valid.source, uncertain: [] });
    }
    assert.equal(typeof content, 'string', 'translation uses the transcribed local text');
    assert.ok(content.includes(valid.source.replaceAll('\\', '\\\\')));
    return JSON.stringify(valid);
  });
  await assert.rejects(read({ image, settingsSnapshot: { ...settingsSnapshot, setupMode: 'unconfigured' } }), /unavailable/u);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(read({ image, settingsSnapshot, signal: cancelled.signal }), /cancelled/u);
  assert.equal(calls, 0);
  assert.equal((await read({ image, settingsSnapshot })).translation, valid.translation);
  assert.equal(calls, 2, 'one image transcription then one text translation');
  const equationOnly = { source: '$$Y = D\\theta_0 + U$$', translation: '$$Y = D\\theta_0 + U$$',
    uncertain: [], terms: [{ quote: 'D\\theta_0', label: '处理效应', role: 'core' }],
    references: [{ symbol: 'U', meaning: '结构误差项', evidence: 'Y = D\\theta_0 + U' }] };
  const equations = await createImageReader(async () => JSON.stringify(equationOnly))({ image, settingsSnapshot });
  assert.deepEqual(equations.references, [], 'bare equations do not state these semantic definitions');
  assert.deepEqual(equations.terms, []);
  for (const changed of [
    { ...valid, translation: valid.translation.replace('t-1', 't+1') },
    { ...valid, source: '$$x+1', translation: '$$x+1' },
    { ...valid, translation: '' }, { ...valid, uncertain: 'none' },
  ]) await assert.rejects(createImageReader(async () => JSON.stringify(changed))({ image, settingsSnapshot }));
  const late = new AbortController();
  await assert.rejects(createImageReader(async () => { late.abort(); return JSON.stringify(valid); })({ image, settingsSnapshot, signal: late.signal }), /cancelled/u);
  let step = 0, firstShown = false;
  const terms = [{ quote: 'gradient', label: '梯度', role: 'core' }, { quote: 'moment', label: '矩', role: 'core' }];
  const withTerms = { ...valid, source: valid.source + ' A moment is used.', terms };
  const reviewed = await createImageReader(async () => ++step <= 2 ? JSON.stringify(withTerms) : '{"keep":[0]}')({
    image, settingsSnapshot, onTranslation: result => { firstShown = true; assert.equal(step, 2); assert.deepEqual(result.terms, []); assert.equal(result.text, withTerms.source); },
  });
  assert.equal(firstShown, true); assert.equal(reviewed.terms.length, 1); assert.equal(reviewed.terms[0].quote, 'gradient');
  step = 0;
  const unavailable = await createImageReader(async () => ++step <= 2 ? JSON.stringify(withTerms) : '{"keep":[99]}')({ image, settingsSnapshot });
  assert.equal(unavailable.translation, valid.translation); assert.deepEqual(unavailable.terms, []);
  step = 0; firstShown = false;
  await assert.rejects(createImageReader(async () => {
    step += 1;
    return step === 1 ? JSON.stringify(withTerms) : step === 2
      ? JSON.stringify({ ...withTerms, translation: valid.translation.replace('t-1', 't+1') }) : '{"keep":[0]}';
  })({ image, settingsSnapshot, onTranslation: () => { firstShown = true; } }), /reading-image-math-mismatch/u);
  assert.equal(firstShown, false, 'mismatched formulas never reach the early result callback');
  step = 0;
  const duringTranslation = new AbortController();
  await assert.rejects(createImageReader(async () => {
    if (++step === 2) duringTranslation.abort();
    return JSON.stringify(valid);
  })({ image, settingsSnapshot, signal: duringTranslation.signal }), /reading-cancelled/u);
  assert.equal(step, 2);
  const usage = () => {}, stages = []; step = 0;
  await createImageReader(async (...args) => {
    assert.equal(args[9].onUsage, usage, 'both requests report usage to the caller');
    step += 1; return JSON.stringify(valid);
  })({ image, settingsSnapshot, onUsage: usage, onResponse: (_raw, info) => stages.push(info.stage) });
  assert.deepEqual(stages, ['transcription', 'text']); assert.equal(step, 2);
  const labeledSource = String.raw`The relation is $$\text{posterior}=\frac{\text{likelihood}\times\text{prior}}{\text{marginal likelihood}}$$.`;
  step = 0;
  const protectedResult = await createImageReader(async (_s, _b, _m, _p, content) => {
    if (++step === 1) return JSON.stringify({ source: labeledSource, uncertain: [] });
    const input = JSON.parse(content);
    assert.equal(input.excerpt, labeledSource, 'term evidence retains the actual source');
    assert.equal(input.translationExcerpt, 'The relation is [[SLIPSTREAM_MATH_0]].');
    return JSON.stringify({ translation: '该关系为 [[SLIPSTREAM_MATH_0]]。', terms: [], references: [] });
  })({ image, settingsSnapshot });
  assert.equal(protectedResult.translation, labeledSource.replace('The relation is ', '该关系为 ').replace(/\.$/u, '。'),
    'labeled formulas stay intact while surrounding prose is translated');
  for (const translation of ['关系为。', '[[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_0]]',
    '[[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_99]]', '$$\\text{后验}=1$$']) {
    step = 0;
    await assert.rejects(createImageReader(async () => ++step === 1
      ? JSON.stringify({ source: labeledSource, uncertain: [] })
      : JSON.stringify({ translation, terms: [], references: [] }))({ image, settingsSnapshot }), /reading-image-math-mismatch/u,
    'missing, duplicated, invented tokens and regenerated equations stay blocked');
  }
  const recoverySource = 'Let $r=a+b$ denote the residual. The scale is $s=a-b$.';
  const recoveredTranslation = '令 [[SLIPSTREAM_MATH_0]] 表示残差。尺度为 [[SLIPSTREAM_MATH_1]]。';
  const restoredTranslation = '令 $r=a+b$ 表示残差。尺度为 $s=a-b$。';
  const recoveryTerms = [{ quote: 'residual', label: '残差', role: 'core' }, { quote: 'scale', label: '尺度', role: 'core' }];
  const recoveryReferences = [{ symbol: 'r', meaning: '残差', evidence: 'Let $r=a+b$ denote the residual.' }];
  for (const translation of [
    '[[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_1]]',
    '[[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_1]] [[SLIPSTREAM_MATH_2]]',
    '[[SLIPSTREAM_MATH_1]]',
  ]) {
    step = 0; firstShown = false;
    const responseStages = [], usageCalls = [];
    const onUsage = value => usageCalls.push(value);
    const recovered = await createImageReader(async (_s, _b, _m, prompt, content, _l, _selection, _signal, _structured, options) => {
      step += 1;
      assert.equal(options.onUsage, onUsage);
      options.onUsage({ step });
      if (step === 1) return JSON.stringify({ source: recoverySource, uncertain: [] });
      if (step === 2) return JSON.stringify({ translation, terms: recoveryTerms, references: recoveryReferences });
      if (step === 3) {
        assert.deepEqual(JSON.parse(content), { excerpt: 'Let [[SLIPSTREAM_MATH_0]] denote the residual. The scale is [[SLIPSTREAM_MATH_1]].' });
        assert.match(prompt, /opaque, indivisible mathematical expression/u);
        assert.equal(options.timeoutMs, 12000); assert.equal(options.retries, 1);
        return JSON.stringify({ translation: recoveredTranslation, terms: [], references: [] });
      }
      assert.equal(step, 4, 'one recovery followed only by the existing term review');
      return '{"keep":[0,1]}';
    })({ image, settingsSnapshot, onUsage, onResponse: (_raw, info) => responseStages.push(info.stage),
      onTranslation: value => { firstShown = true; assert.equal(step, 3); assert.equal(value.translation, restoredTranslation); } });
    assert.equal(recovered.translation, restoredTranslation); assert.equal(firstShown, true);
    assert.deepEqual(recovered.terms.map(term => term.quote), ['residual', 'scale']);
    assert.equal(recovered.references[0].symbol, 'r', 'recovery cannot replace original source-grounded references');
    assert.deepEqual(responseStages, ['transcription', 'text', 'text', 'text']);
    assert.equal(usageCalls.length, 4);
  }
  for (const repaired of [
    null, 'x'.repeat(45001), '{"keep":[0]}', 'not JSON', JSON.stringify({ translation: 1 }), JSON.stringify({ translation: '' }),
    JSON.stringify({ translation: 'x'.repeat(40001) }), JSON.stringify({ translation: '\t' + recoveredTranslation }),
    JSON.stringify({ translation: recoveredTranslation }) + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。',
    JSON.stringify({ translation: '[[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_0]] [[SLIPSTREAM_MATH_1]]' }),
    JSON.stringify({ translation: '[[SLIPSTREAM_MATH_1]] [[SLIPSTREAM_MATH_0]]' }),
    JSON.stringify({ translation: '令 $r=a-b$ 表示残差。尺度为 $s=a-b$。' }),
    JSON.stringify({ translation: recoveredTranslation + ' $z=1$' }),
  ]) {
    step = 0; firstShown = false;
    await assert.rejects(createImageReader(async () => {
      step += 1;
      if (step === 1) return JSON.stringify({ source: recoverySource, uncertain: [] });
      if (step === 2) return JSON.stringify({ translation: '[[SLIPSTREAM_MATH_1]]', terms: recoveryTerms });
      assert.equal(step, 3, 'a failed recovery cannot retry again'); return repaired;
    })({ image, settingsSnapshot, onTranslation: () => { firstShown = true; } }), /reading-image-math-mismatch/u);
    assert.equal(step, 3); assert.equal(firstShown, false);
  }
  step = 0;
  const duringRecovery = new AbortController();
  await assert.rejects(createImageReader(async () => {
    if (++step === 1) return JSON.stringify({ source: recoverySource, uncertain: [] });
    if (step === 2) return JSON.stringify({ translation: '[[SLIPSTREAM_MATH_1]]', terms: [] });
    duringRecovery.abort(); return JSON.stringify({ translation: recoveredTranslation });
  })({ image, settingsSnapshot, signal: duringRecovery.signal }), /reading-cancelled/u);
  assert.equal(step, 3);
  step = 0;
  const recoveryNetworkError = new Error('provider-unavailable');
  await assert.rejects(createImageReader(async () => {
    if (++step === 1) return JSON.stringify({ source: recoverySource, uncertain: [] });
    if (step === 2) return JSON.stringify({ translation: '[[SLIPSTREAM_MATH_1]]', terms: [] });
    throw recoveryNetworkError;
  })({ image, settingsSnapshot }), error => error === recoveryNetworkError);
  assert.equal(step, 3, 'network failure stays actionable without more attempts');
  step = 0; firstShown = false;
  await assert.rejects(createImageReader(async () => {
    if (++step === 1) return JSON.stringify({ source: recoverySource, uncertain: [] });
    if (step === 2) return JSON.stringify({ translation: recoveredTranslation + ' $z=1$', terms: recoveryTerms });
    assert.equal(step, 3, 'extra raw math is blocked by image validation, not sent for recovery');
    return '{"keep":[0,1]}';
  })({ image, settingsSnapshot, onTranslation: () => { firstShown = true; } }), /reading-image-math-mismatch/u);
  assert.equal(firstShown, false);
  console.log('image reading transport, cancellation, formula integrity and term review checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
