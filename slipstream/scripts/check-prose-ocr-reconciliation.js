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

// Vision can combine two printed rows into one low-confidence, tall observation.
// Padding split the same pixels into two complete rows in a native PDF capture.
const surrounding = ['Abstract', 'The method starts from a small input space.',
  'The output can be processed with a linear model.',
  'We compare two feature families in experiments.',
  'Their behavior depends on the selected kernel.',
  'The final estimates are reported below.'];
const sourceRows = surrounding.map((line, index) => block(line, index));
sourceRows[3] = {
  ...block('We compare cheat dia machine teaming al.', 3, .5),
  boundingBox: { x: .07, y: .46, w: .86, h: .22 },
};
const completeRows = [
  ...surrounding.slice(0, 3).map((line, index) => block(line, index)),
  { ...block('We compare two feature families in experiments.', 3),
    boundingBox: { x: .07, y: .57, w: .86, h: .09 } },
  { ...block('We compare their accuracy across several tasks.', 4),
    boundingBox: { x: .07, y: .48, w: .86, h: .09 } },
  ...surrounding.slice(4).map((line, index) => block(line, index + 4)),
];
const fromBlocks = (blocks) => ({ text: blocks.map((entry) => entry.text).join('\n'), blocks });
const expanded = reconcileProseOcr(fromBlocks(sourceRows), fromBlocks(completeRows));
assert.equal(expanded.proseComparison?.recovered, true);
assert.match(expanded.text, /We compare two feature families in experiments\.\nWe compare their accuracy/u);
assert.equal(expanded.blocks.length, 7);

const confidentMerge = sourceRows.map((entry, index) => index === 3 ? { ...entry, confidence: 1 } : entry);
assert.equal(reconcileProseOcr(fromBlocks(confidentMerge), fromBlocks(completeRows)).proseComparison.recovered,
  false, 'a confident source line cannot be silently expanded');
const movedExtra = completeRows.map((entry, index) => index === 4
  ? { ...entry, boundingBox: { ...entry.boundingBox, y: .05 } } : entry);
assert.equal(reconcileProseOcr(fromBlocks(sourceRows), fromBlocks(movedExtra)).proseComparison.recovered,
  false, 'the additional row must occupy the original merged observation');
const changedNeighbor = completeRows.map((entry, index) => index === 1
  ? { ...entry, text: 'Unrelated output can be processed with a linear model.' } : entry);
assert.equal(reconcileProseOcr(fromBlocks(sourceRows), fromBlocks(changedNeighbor)).proseComparison.recovered,
  false, 'other lines must agree exactly');
const uncertainExtra = completeRows.map((entry, index) => index === 4
  ? { ...entry, confidence: .5 } : entry);
assert.equal(reconcileProseOcr(fromBlocks(sourceRows), fromBlocks(uncertainExtra)).proseComparison.recovered,
  false, 'both replacement rows must be confident');

console.log('Prose OCR disagreements pause review; fully supported longer rows can supply a reviewable candidate.');
