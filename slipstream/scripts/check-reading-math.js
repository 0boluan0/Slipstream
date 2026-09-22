'use strict';
const assert = require('node:assert/strict');
const { mathRanges, needsMathReview, isMathOnly } = require('../src/shared/reading-math.cjs');
const { readingSegments } = require('../src/main/reading-document');
const { createFormulaRecognizer, FORMULA_MODEL } = require('../src/main/formula-recognition');
const { createReadingProcessor } = require('../src/main/reading-service');
const { mergeFormulaDocument } = require('../src/main/formula-document');

async function main() {
  const size = { width: 100, height: 100 };
  const word = (text, x, w) => ({ text, characters: [...text].map((char) => ({ text: char,
    boundingBox: { x: x / 100, y: .7, w: w / 100, h: .2 } })) });
  const formula = { x: 10, y: 10, w: 18, h: 20, latex: 'x', display: false };
  const original = { blocks: [word('x:', 10, 24), word('label', 45, 30)] };
  const masked = { blocks: [word(':', 29, 5), word('label', 45, 30)] };
  assert.equal(mergeFormulaDocument(masked, [formula], size, original).text, '$x$: label',
    'the same punctuation recovered from an original word and masked OCR must appear once');
  const periodSource = { blocks: [word('x.', 10, 24), word('label', 45, 30)] };
  assert.equal(mergeFormulaDocument({ blocks: [word('•', 29, 5)] }, [formula], size, periodSource).text, '$x$. label',
    'masked OCR may call the same source period a bullet; preserve the original punctuation once');
  const numbered = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true }], size,
    { blocks: [word('(2)', 80, 15)] });
  assert.match(numbered.text, /\\tag\{2\}/, 'a right-aligned number belongs to its display equation');
  assert(!mergeFormulaDocument({ blocks: [] }, [formula], size,
    { blocks: [word('(2)', 80, 15)] }).text.includes('\\tag'), 'inline math must not absorb a nearby list label');
  assert(!mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true }], size,
    { blocks: [word('(2)', 0, 5)] }).text.includes('\\tag'), 'a number before the formula is not a right-aligned equation tag');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [formula], size,
    { blocks: [word('x.', 10, 24), word('•', 36, 5), word('label', 45, 30)] }).text, '$x$. • label',
  'a separate source bullet must survive punctuation deduplication');
  const edgeSize = { width: 1000, height: 100 };
  const edgeWord = (text, x, w) => ({ ...word(text, x / 10, w / 10),
    characters: [...text].map((char) => ({ text: char, boundingBox: { x: x / 1000, y: .7, w: w / 1000, h: .2 } })) });
  assert.equal(mergeFormulaDocument({ blocks: [] }, [], edgeSize,
    { blocks: [edgeWord('t', 30, 10)] }, { blocks: [edgeWord('Let', 10, 30)] }).text, 'Let',
  'padding can restore a missing prefix at the same source location');
  for (const alternate of [edgeWord('t', 30, 10), edgeWord('Net', 70, 30), edgeWord('Loss', 10, 30)]) {
    assert.equal(mergeFormulaDocument({ blocks: [] }, [], edgeSize,
      { blocks: [edgeWord('Let', 10, 30)] }, { blocks: [alternate] }).text, 'Let',
    'a second OCR layout cannot shorten, move or substitute the original word');
  }
  for (const [tex, expected] of [
    [String.raw`1 ^ { \mathrm { s t } }`, '1st'],
    [String.raw`2 ^ { \text { n d } }`, '2nd'],
    [String.raw`x ^ { s t }`, String.raw`$x ^ { s t }$`],
    [String.raw`\dot{x}`, String.raw`$\dot{x}$`],
  ]) {
    assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...formula, latex: tex }], size).text, expected);
  }
  const source = String.raw`Conditional expectation is $\mathbb{E}[Y\mid X=x]$.

$$\mathbb{E}[Y\mid X=x]=\int_{-\infty}^{\infty}y f_{Y\mid X}(y\mid x)\,\mathrm{d}y.$$

The sample mean is \(\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i\).`;
  assert.equal(mathRanges(source).length, 3);
  assert(isMathOnly(String.raw`$$\frac{1}{n}\sum_{i=1}^n x_i$$`));
  assert(!isMathOnly('The mean is $x$.'));
  assert.equal(mathRanges(String.raw`Price \$5 and \$10. The value is $x_1^2$.`).length, 1);
  assert.equal(mathRanges('Price $5 and $10.').length, 0);
  assert.equal(mathRanges('`$x$` and ```\n$$x$$\n```').length, 0);
  assert.equal(mathRanges('Unclosed $x_1').length, 0);
  assert(needsMathReview('E[Y | X] = y'));
  assert(needsMathReview('∫ f(x) dx'));
  assert(!needsMathReview('Correlation does not imply causation.'));
  const longFormula = '$$\\begin{aligned}\n' + 'x_i &= y_i + z_i \\\\\n\n'.repeat(150) + '\\end{aligned}$$';
  const longSource = 'Opening prose.\n\n' + longFormula + '\n\nClosing prose.';
  assert(readingSegments(longSource).some((segment) => segment.source === longFormula), 'never split inside display math, even at blank lines or size boundaries');
  const translated = '条件期望为 $\\mathbb{E}[Y\\mid X=x]$。';
  const processor = createReadingProcessor(async () => JSON.stringify({ translation: translated, terms: [] }));
  assert.equal((await processor({ text: source, withTerms: true, settingsSnapshot: { activeBackend: 'deepseek' } })).translation, translated);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=';
  const calls = [];
  const recognize = createFormulaRecognizer(async (...args) => { calls.push(args); return JSON.stringify({ text: source, uncertain: ['积分上限需要对照原图'] }); });
  const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash', deepseekApiKey: 'fixture-key' };
  const result = await recognize({ image, settingsSnapshot: settings });
  assert.equal(result.text, source);
  assert.equal(calls[0][2], FORMULA_MODEL);
  assert.equal(calls[0][4][1].image_url.url, image);
  assert.equal(settings.activeModel, 'deepseek-v4-flash', 'formula request must not change the configured text model');
  await assert.rejects(recognize({ image: 'https://example.com/image.png', settingsSnapshot: settings }));
  await assert.rejects(recognize({ image, settingsSnapshot: { ...settings, activeBackend: 'custom' } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recognize({ image, settingsSnapshot: settings, signal: controller.signal }));
  assert.equal(calls.length, 1, 'invalid or cancelled requests must not upload');
  const invalid = createFormulaRecognizer(async () => '{"text":"partial", "uncertain":"none"}');
  await assert.rejects(invalid({ image, settingsSnapshot: settings }), /formula-invalid-output/);
  const escapedWrongly = createFormulaRecognizer(async () => JSON.stringify({ text: 'Formula $\frac{a}{b}$', uncertain: [] }));
  await assert.rejects(escapedWrongly({ image, settingsSnapshot: settings }), /formula-invalid-output/, 'a JSON form-feed must not silently replace a LaTeX backslash');
  console.log('Math checks passed: delimiters, currency/code, intact equations across splitting, LaTeX output, explicit vision backend, bounded input and cancellation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
