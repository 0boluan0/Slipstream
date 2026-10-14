// Static contract: evaluation cases must not leak into product prompts or
// validators. If an eval passage is copied into a prompt, later scores measure
// memorized fixes, not reading quality. This reads product source on purpose;
// it only checks that eval text is absent, never how the code is written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHINGLE = 7;
// Opt-in QA harnesses may carry their own authored samples; they are not
// part of any prompt or validator.
const QA_HARNESS = new Set(['src/main/reading-live-check.js', 'src/main/reading-screenshot-check.js']);

export function words(text) {
  return text.toLowerCase().replace(/\\[a-z]+/gu, ' ').match(/[\p{L}\p{N}]+/gu) || [];
}

export function shingles(text, size = SHINGLE) {
  const tokens = words(text);
  const result = new Set();
  for (let index = 0; index + size <= tokens.length; index += 1) result.add(tokens.slice(index, index + size).join(' '));
  return result;
}

function evalTexts() {
  const directory = path.join(root, 'eval', 'dev');
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).flatMap((name) => {
    const { cases } = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    return cases.flatMap((item) => [item.source, item.criteria].filter(Boolean).map((text) => ({ id: `${name}#${item.id}`, text })));
  });
}

function productFiles(directory = path.join(root, 'src')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return productFiles(file);
    const relative = path.relative(root, file).split(path.sep).join('/');
    return /\.(?:c?js|mjs|jsx)$/u.test(entry.name) && !QA_HARNESS.has(relative) ? [{ relative, file }] : [];
  });
}

test('shingles ignore case, punctuation and TeX command names', () => {
  assert.deepEqual([...shingles('Given a batch of $N$ (image, text) pairs!', 3)].slice(0, 2), ['given a batch', 'a batch of']);
  assert.deepEqual(words(String.raw`$\mathcal F(x)$`), ['f', 'x']);
});

test('no development eval passage or rubric appears in product code', () => {
  const index = new Map();
  for (const { id, text } of evalTexts()) for (const shingle of shingles(text)) index.set(shingle, id);
  const leaks = [];
  for (const { relative, file } of productFiles()) {
    for (const shingle of shingles(fs.readFileSync(file, 'utf8'))) {
      if (index.has(shingle)) leaks.push(`${relative} ⟵ ${index.get(shingle)}: "${shingle}"`);
    }
  }
  assert.deepEqual(leaks, [], 'Move the example out of the product prompt or use an authored example that is not in eval/.');
});
