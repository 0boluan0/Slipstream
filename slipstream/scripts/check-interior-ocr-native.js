'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass the native paragraph screenshot PNG');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-interior-ocr-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Interior OCR timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  const result = await require('../src/main/ocr-service').performReadingOCR(path.resolve(input));
  console.log(JSON.stringify({ formulaOcr: result.formulaOcr,
    interiorRecovered: result.document?.interiorRecovered,
    interiorUnresolved: result.document?.interiorUnresolved, text: result.text }, null, 2));
  assert.match(result.text, /winning tickets, since those that we find have won the initialization lottery with a/u);
  assert.match(result.text, /combination of weights and connections capable of learning\. When their parameters are randomly/u);
  assert(result.text.indexOf('winning tickets, since') < result.text.indexOf('combination of weights'));
  assert(result.text.indexOf('combination of weights') < result.text.indexOf('reinitialized'));
  assert.equal(result.document.interiorRecovered, 2, 'both omitted lines need source-pixel rechecks');
  assert.equal(result.document.interiorUnresolved, 0);
  assert.equal(result.formulaOcr.count, 3, 'the local math recognizer still supplies the notation');
  console.log('Native paragraph OCR retains locally verified interior prose and mathematical notation.');
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
