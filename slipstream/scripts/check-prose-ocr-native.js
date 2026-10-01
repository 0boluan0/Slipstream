'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass a local captured PNG');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-prose-ocr-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Prose OCR timed out'); app.exit(1); }, 30000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  const result = await require('../src/main/ocr-service').performReadingOCR(path.resolve(input));
  assert.equal(result.formulaOcr?.count, 0, 'the paragraph is ordinary prose');
  assert.equal(result.proseComparison?.disagree, true, 'independent layouts must expose their disagreement');
  assert.equal(result.proseComparison?.recovered, true, 'the fuller, aligned reading must become the review candidate');
  assert.match(result.text, /randomly-initialized, feed-forward\nnetworks contain/u);
  assert.match(result.text, /that—when trained in isolation—\nreach/u);
  console.log('Real captured prose: padded Vision candidate recovered missing words and requires review.');
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
