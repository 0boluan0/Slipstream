'use strict';

const { referenceKey } = require('./reading-references');

const cases = [
  { name: 'explicit-definitions', expected: ['x_i', 'n', '\\lambda'], source: 'Let $x_i \\in \\mathbb{R}^d$ denote the feature vector of the i-th training example. Let $n$ be the number of training examples. The regularization strength is denoted by $\\lambda$.' },
  { name: 'equation-without-definitions', expected: [], source: 'We minimize $$L(\\theta) = \\sum_i \\ell(f_\\theta(x_i), y_i) + \\lambda R(\\theta).$$ The optimization details are given in the next section.' },
  { name: 'ordinary-prose', expected: [], source: 'The next section presents the results. We then discuss the limitations and conclude the paper.' },
  { name: 'same-symbol-different-sections', expected: ['K', 'K'], source: 'In Section 2, $K$ denotes the number of mixture components. In Section 3, we reuse $K$ to denote a kernel matrix.' },
  { name: 'case-sensitive-notation', expected: ['X', 'x'], source: 'Let $X$ be a random variable and let $x$ denote a fixed observed value of that variable.' },
  { name: 'subscripts-and-accents', expected: ['\\beta_0', '\\hat{\\beta}'], source: 'The intercept is denoted by $\\beta_0$. We write $\\hat{\\beta}$ for the estimated coefficient vector.' },
];

exports.run = async function run({ processReadingText, settings, report, saveReport }) {
  report.capture = 'Authored notation excerpts only; no screen or document capture.';
  report.cases = [];
  for (const sample of cases) {
    const started = Date.now();
    const result = await processReadingText({ text: sample.source, withTerms: true, withReferences: true,
      settingsSnapshot: settings, signal: AbortSignal.timeout(60000) });
    const keys = result.references.map((entry) => referenceKey(entry.symbol)).sort();
    const expected = sample.expected.map(referenceKey).sort();
    const passed = JSON.stringify(keys) === JSON.stringify(expected);
    report.cases.push({ ...sample, result, elapsedMs: Date.now() - started, passed });
    saveReport();
    console.log(`${passed ? 'PASS' : 'FAIL'} ${sample.name}: ${keys.length} grounded definitions.`);
  }
  report.completed = true;
  report.passed = report.cases.every((sample) => sample.passed);
  saveReport();
  return report.passed;
};
