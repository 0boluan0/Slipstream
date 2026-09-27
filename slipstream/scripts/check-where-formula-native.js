'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass the native formula screenshot PNG');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-where-ocr-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Native OCR timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  const result = await require('../src/main/ocr-service').performReadingOCR(path.resolve(input));
  console.log(JSON.stringify({ formulaOcr: result.formulaOcr,
    rowRecovered: result.document?.rowRecovered, text: result.text }, null, 2));
  assert.match(result.text, /where \$\\Omega\s*\(\s*f\s*\)/u,
    'Vision-confirmed prose where remains outside the regularizer math');
  assert.doesNotMatch(result.text, /\\mathrm\s*\{\s*w\s*h\s*e\s*r\s*e/u);
  assert.match(result.text, /\\frac\s*\{\s*1\s*\}\s*\{\s*2\s*\}/u);
  assert.doesNotMatch(result.text, /\}\$\?\nHere/u,
    'the exponent must not acquire a Vision-hallucinated question mark');
  assert.match(result.text, /Here l is a differentiable convex loss function/u,
    'the loss symbol agrees with a second OCR layout and the displayed equation');
  assert(result.document.rowRecovered >= 1, 'the loss-letter correction remains reviewable');
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
