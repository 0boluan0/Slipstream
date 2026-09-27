'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass the native academic prose screenshot PNG');
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
    proseComparison: result.proseComparison, text: document.text }, null, 2));
  assert(result.spellJoinCandidates.includes('quantile'),
    'the local English spell checker recognizes quantile despite the legacy word list omission');
  assert.match(document.text, /weighted quantile sketch/u);
  assert.match(document.text, /end-to-end tree boosting system/u);
  assert.match(document.text, /data compression and sharding/u);
  assert.doesNotMatch(document.text, /quan-tile/u);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
