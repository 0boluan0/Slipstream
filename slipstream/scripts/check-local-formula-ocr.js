"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { mathRanges } = require('../src/shared/reading-math.cjs');
const { createFormulaFixtures } = require('./formula-ocr-fixtures.cjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-formula-unit-'));
app.setPath('userData', path.join(work, 'profile')); app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Formula OCR unit check timed out'); app.exit(1); }, 120000).unref();
let service;
app.whenReady().then(async () => {
  service = require('../src/main/ocr-service');
  for (const { name, file } of await createFormulaFixtures(work)) {
    const result = await service.performReadingOCR(file);
    assert.equal(result.formulaOcr.status, 'done', name);
    const tex = mathRanges(result.text).map(x => x.tex.replace(/\s+/g, '')).join(' ');
    if (name === 'fraction') { assert.match(tex, /\\(?:c)?frac/); assert.match(tex, /\\sqrt/); }
    if (name === 'accent') { assert.match(tex, /\\(?:widehat|hat)\{(?:\\boldsymbol\{)?m\}/); assert.match(tex, /\\beta/); }
    if (name === 'expectation') { assert.match(tex, /\\theta/); assert.match(tex, /U/); }
  }
  console.log('Authored formula OCR unit checks passed.');
}).then(async () => { await service?.cleanup(); fs.rmSync(work, { recursive:true, force:true }); app.exit(0); })
  .catch(async error => { console.error(error); await service?.cleanup(); fs.rmSync(work, { recursive:true, force:true }); app.exit(1); });
