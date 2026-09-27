'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Pass a local captured PNG');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-formal-ocr-'));
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Formal OCR timed out'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  app.dock?.hide();
  const result = await require('../src/main/ocr-service').performReadingOCR(path.resolve(input));
  console.log(JSON.stringify({ formulaOcr: result.formulaOcr, text: result.text.slice(0, 900) }, null, 2));
  assert.match(result.text, /f reaches\s+minimum validation loss \$l\$ at iteration \$j\$/u);
  assert.doesNotMatch(result.text, /\\iota|\bJ reaches\b|mınımum/u);
  assert.match(result.text, /\\exists[^$]*m/u);
  assert.match(result.text, /j\s*\^\s*\{\s*\\prime\s*\}\s*\\leq\s*j/u);
  assert.match(result.text, /a\s*\^\s*\{\s*\\prime\s*\}\s*\\geq\s*a/u);
  assert(result.document.rowRecovered >= 2, 'both doubtful prose rows need corroboration and review');
  assert(result.formulaOcr.uncertainStarts.includes(result.text.indexOf('$l$')),
    'the corrected Latin/Greek ambiguity must be marked for review');
  console.log('Formal OCR keeps loss notation and comparison directions.');
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
