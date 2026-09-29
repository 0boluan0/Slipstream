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
  assert.equal(sameMath('$x_i \\text{ are raw input vectors}$', '$x_i \\text{ 是原始输入向量}$'), true);
  assert.equal(sameMath('$x$ then $y$.', '$y$，然后 $x$。'), true);
  assert.throws(() => validateReadingImage('data:image/png;base64,aGVsbG8='), /reading-invalid-image/u);
  let calls = 0;
  const read = createImageReader(async (_settings, backend, model, _prompt, content) => {
    calls += 1;
    assert.equal(backend, settingsSnapshot.activeBackend); assert.equal(model, settingsSnapshot.activeModel);
    assert.equal(content[1].image_url.url, image);
    return JSON.stringify(valid);
  });
  await assert.rejects(read({ image, settingsSnapshot: { ...settingsSnapshot, setupMode: 'unconfigured' } }), /unavailable/u);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(read({ image, settingsSnapshot, signal: cancelled.signal }), /cancelled/u);
  assert.equal(calls, 0);
  assert.equal((await read({ image, settingsSnapshot })).translation, valid.translation);
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
  const reviewed = await createImageReader(async () => ++step === 1 ? JSON.stringify(withTerms) : '{"keep":[0]}')({
    image, settingsSnapshot, onTranslation: result => { firstShown = true; assert.equal(step, 1); assert.deepEqual(result.terms, []); },
  });
  assert.equal(firstShown, true); assert.equal(reviewed.terms.length, 1); assert.equal(reviewed.terms[0].quote, 'gradient');
  step = 0;
  const unavailable = await createImageReader(async () => ++step === 1 ? JSON.stringify(withTerms) : '{"keep":[99]}')({ image, settingsSnapshot });
  assert.equal(unavailable.translation, valid.translation); assert.deepEqual(unavailable.terms, []);
  console.log('image reading transport, cancellation, formula integrity and term review checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
