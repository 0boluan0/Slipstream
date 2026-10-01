'use strict';
// Run with a stock Electron of the architecture being checked. Loads the
// candidate's actual ASAR modules, native libraries, models and Swift binary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { mathRanges } = require('../src/shared/reading-math.cjs');
const { createFormulaFixtures } = require('./formula-ocr-fixtures.cjs');
const candidate = process.argv[2];
if (!candidate || !path.isAbsolute(candidate)) throw new Error('Pass an absolute candidate .app path');
const resources = path.join(candidate, 'Contents', 'Resources');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-packaged-formula-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
Object.defineProperty(app, 'isPackaged', { value: true });
Object.defineProperty(process, 'resourcesPath', { value: resources });
setTimeout(() => { console.error('Packaged formula check timed out'); app.exit(1); }, 90000).unref();
let service;
app.whenReady().then(async () => {
  const deny = () => { throw new Error('Packaged local OCR attempted a network request'); };
  global.fetch = deny; require('node:http').request = deny; require('node:https').request = deny;
  service = require(path.join(resources, 'app.asar', 'src/main/ocr-service.js'));
  const pkg = require(path.join(resources, 'app.asar/package.json'));
  assert.equal(pkg.version, require('../package.json').version);
  const cases = [];
  for (const { name, file } of await createFormulaFixtures(work)) {
    const started = Date.now();
    const result = await service.performReadingOCR(file);
    assert.equal(result.formulaOcr.status, 'done');
    const tex = mathRanges(result.text).map((item) => item.tex.replace(/\s+/g, '')).join(' ');
    if (name === 'fraction') { assert.match(tex, /\\(?:c)?frac/); assert.match(tex, /\\sqrt/); }
    if (name === 'accent') { assert.match(tex, /\\(?:widehat|hat)\{(?:\\boldsymbol\{)?m\}/); assert.match(tex, /\\beta/); }
    if (name === 'expectation') { assert.match(tex, /\\theta/); assert.match(tex, /U/); }
    cases.push({ name, count: result.formulaOcr.count, elapsedMs: Date.now() - started });
  }
  console.log(JSON.stringify({ version: pkg.version, architecture: process.arch, cases, network: 'blocked', source: 'packaged ASAR, models, native runtime and Swift OCR' }));
}).then(async () => { await service?.cleanup(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0); })
  .catch(async (error) => { console.error(error); await service?.cleanup(); fs.rmSync(work, { recursive: true, force: true }); app.exit(1); });
