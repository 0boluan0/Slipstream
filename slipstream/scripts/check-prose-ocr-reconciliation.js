'use strict';

const assert = require('node:assert/strict');
const { reconcileProseOcr } = require('../src/main/prose-ocr-reconciliation');

const rawLines = [
  'We find that a standard pruning technique naturally uncovers subnetworks whose',
  'initializations made them capable of training effectively. Based on these results, we',
  'articulate the lottery ticket hypothesis: dense, randomly-initialized',
  'retworks contain subnetworks (winning tickets) that-when trained in isolation-',
  'reach test accuracy comparable to the original network in a similar number of',
  'iterations. The winning tickets we find have won the initialization lottery: their',
  'connections have initial weights that make training particularly effective.',
];
const paddedLines = [
  rawLines[0], rawLines[1],
  'articulate the lottery ticket hypothesis: dense, randomly-initialized, feed-forward',
  'networks contain subnetworks (winning tickets) that—when trained in isolation—',
  ...rawLines.slice(4),
];
const block = (text, index, confidence = 1, shift = 0) => ({
  text, confidence,
  boundingBox: { x: .07, y: .82 - index * .12 + shift, w: .86, h: .1 },
  characters: Array.from(text, (letter) => ({ text: letter })),
});
const result = (lines, confidence = 1, shift = 0) => ({
  text: lines.join('\n'), confidence,
  blocks: lines.map((line, i) => block(line, i, confidence, shift)),
});

const recovered = reconcileProseOcr(result(rawLines), result(paddedLines));
assert.equal(recovered.proseComparison?.disagree, true);
assert.equal(recovered.proseComparison?.recovered, true);
assert.match(recovered.text, /randomly-initialized, feed-forward\nnetworks contain/u);
assert.match(recovered.text, /that—when trained in isolation—\nreach/u);
assert.equal(recovered.blocks[3].characters[0].text, 'n', 'recovered text and character geometry stay together');

const same = reconcileProseOcr(result(paddedLines), result(paddedLines));
assert.equal(same.proseComparison?.disagree, false);
assert.equal(same.text, paddedLines.join('\n'));

const numerical = paddedLines.slice();
numerical[4] = numerical[4].replace('similar number', 'similar 10 number');
const changedNumber = reconcileProseOcr(result(rawLines), result(numerical));
assert.equal(changedNumber.proseComparison?.disagree, true);
assert.equal(changedNumber.proseComparison?.recovered, false);
assert.equal(changedNumber.text, rawLines.join('\n'), 'a numerical disagreement stays unresolved');

const shifted = reconcileProseOcr(result(rawLines), result(paddedLines, 1, .2));
assert.equal(shifted.proseComparison?.recovered, false);
assert.equal(shifted.text, rawLines.join('\n'), 'another page position cannot replace source lines');

const uncertain = reconcileProseOcr(result(rawLines), result(paddedLines, .5));
assert.equal(uncertain.proseComparison?.recovered, false);
assert.equal(uncertain.proseComparison?.disagree, true);

console.log('Prose OCR disagreements pause review; only a longer, aligned and fully confident second reading supplies a reviewable candidate.');
