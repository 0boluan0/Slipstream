'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass the native academic prose screenshot PNG');
const mode = process.argv[3] || 'abstract';
if (!['abstract', 'formula', 'spelling'].includes(mode)) throw new Error('Expected abstract, formula, or spelling mode');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-hyphen-ocr-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Native OCR timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  const result = await require('../src/main/ocr-service').performReadingOCR(path.resolve(input));
  const document = require('../src/main/reading-document').readingTextFromOcr(result);
  console.log(JSON.stringify({ spellJoinCandidates: result.spellJoinCandidates,
    proseComparison: result.proseComparison, proseSpellingConflicts: document.proseSpellingConflicts,
    text: document.text }, null, 2));
  if (mode === 'abstract') {
    assert(result.spellJoinCandidates.includes('quantile'),
      'the local English spell checker recognizes quantile despite the legacy word list omission');
    assert.match(document.text, /weighted quantile sketch/u);
    assert.match(document.text, /end-to-end tree boosting system/u);
    assert.match(document.text, /data compression and sharding/u);
    assert.doesNotMatch(document.text, /quan-tile/u);
  } else if (mode === 'formula') {
    assert(result.formulaOcr, 'the formula-rich image must take the math OCR path');
    assert.match(document.text, /tree ensemble model/u);
    assert.match(document.text, /represents the structure/u);
    assert.doesNotMatch(document.text, /ensem-\nble|rep-\nresents/u);
    assert.match(document.text, /\\sum/u, 'the equation must remain TeX');
    const mathStarts = new Set(require('../src/shared/reading-math.cjs').mathRanges(document.text).map(({ start }) => start));
    assert(result.formulaOcr.uncertainStarts.every((start) => mathStarts.has(start)),
      'every formula review marker must still point to a TeX span after prose joins');
  } else {
    assert(result.formulaOcr, 'the leaf-weight image must take the math OCR path');
    assert(document.proseSpellingConflicts.some((pair) => pair.source === 'leat' && pair.alternative === 'leaf'),
      'a confident but conflicting prose spelling must be surfaced for manual source review');
    assert.match(document.text, /leat weights/u, 'the conflicting source must remain available for comparison');
  }
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
