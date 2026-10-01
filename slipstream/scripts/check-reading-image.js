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
  console.log('image reading transport, cancellation, formula integrity and term review checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
