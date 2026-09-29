'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

if (process.platform !== 'darwin') { console.log('Apple Vision prose-order pixel check skipped.'); process.exit(0); }

const input = path.join(__dirname, 'fixtures', 'authored-softmax-formula-prose.png');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-prose-order-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Prose-order OCR timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  require('./prepare-ocr-test')(input);
  const { performOCR, performReadingOCR, recheckMergedProseAboveFormula } =
    require('../src/main/ocr-service');
  const padded = await performOCR(input, { characters: true, padEdges: true });
  assert.match(padded.blocks[0].text, /^A classifier converts raw scores into class probabilities/u);
  assert.match(padded.blocks[1].text, /^compares the logit/u);
  const source = { blocks: [{ text: 'Classifier words from two printed lines are scrambled together.',
    confidence: .3, boundingBox: { x: .015, y: 1 - 87 / 218,
      w: .95, h: 65 / 218 } }] };
  const formula = [{ x: 395, y: 108, w: 310, h: 80, display: true,
    latex: 'q_i=\\frac{\\exp(z_i/T)}{\\sum_j\\exp(z_j/T)}' }];
  const size = { width: 1110, height: 218 };
  const temporary = fs.mkdtempSync(path.join(profile, 'prose-'));
  const repaired = await recheckMergedProseAboveFormula(input, source, padded,
    formula, size, temporary);
  assert.equal(repaired.recovered, 1);
  assert.equal(repaired.unresolved, 0);
  assert.match(repaired.ocr.text, /^A classifier converts raw scores into class probabilities/u);
  assert.match(repaired.ocr.text, /\ncompares the logit/u);
  assert.equal(repaired.ocr.blocks.length, 2);
  const disagreement = { ...padded, blocks: [{ ...padded.blocks[0],
    text: 'A distant rocket crossed the northern sky before returning to the station.' },
  ...padded.blocks.slice(1)] };
  const rejected = await recheckMergedProseAboveFormula(input, source, disagreement,
    formula, size, temporary);
  assert.equal(rejected.recovered, 0);
  assert.equal(rejected.unresolved, 1);
  assert.equal(rejected.ocr, source, 'uncorroborated text must not replace the source');
  const ordinary = await recheckMergedProseAboveFormula(input, { blocks: [
    { ...source.blocks[0], confidence: 1 }] }, padded, formula, size, temporary);
  assert.equal(ordinary.recovered, 0, 'normal high-confidence rows need no extra read');

  const complete = await performReadingOCR(input);
  assert.match(complete.text, /^A classifier converts raw scores into class probabilities/u);
  assert.match(complete.text, /\ncompares the logit, \$z\s*_\s*\{\s*i\s*\}\$/u);
  assert.match(complete.text, /\\exp\b/u);
  assert.match(complete.text, /\\sum\s*_\s*\{/u);
  console.log('Authored formula/prose pixels retain reading order; bounded reread and disagreement controls passed.');
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
