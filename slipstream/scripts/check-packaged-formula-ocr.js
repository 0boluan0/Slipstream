'use strict';
// Run with a stock Electron of the architecture being checked. Loads the
// candidate's actual ASAR modules, native libraries, models and Swift binary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { mathRanges } = require('../src/shared/reading-math.cjs');
const candidate = process.argv[2];
if (!candidate || !path.isAbsolute(candidate)) throw new Error('Pass an absolute candidate .app path');
const resources = path.join(candidate, 'Contents', 'Resources');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-packaged-formula-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
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
  for (const name of ['attention-equation', 'adam-algorithm', 'dml-equations']) {
    const started = Date.now();
    const result = await service.performReadingOCR(path.resolve(__dirname, '../../docs/usability/2026-09-18/formula-ocr', `${name}.png`));
    assert.equal(result.formulaOcr.status, 'done');
    const tex = mathRanges(result.text).map((item) => item.tex.replace(/\s+/g, '')).join(' ');
    if (name === 'attention-equation') assert(tex.includes('\\frac{QK^{T}}{\\sqrt{d_{k}}}'));
    if (name === 'adam-algorithm') { assert(tex.includes('\\widehat{m}_{t}')); assert(tex.includes('\\beta_{2}^{t}')); }
    if (name === 'dml-equations') { assert(tex.includes('\\theta_{0}')); assert.match(tex, /E.*U/); }
    cases.push({ name, count: result.formulaOcr.count, elapsedMs: Date.now() - started });
  }
  console.log(JSON.stringify({ version: pkg.version, architecture: process.arch, cases, network: 'blocked', source: 'packaged ASAR, models, native runtime and Swift OCR' }));
}).then(async () => { await service?.cleanup(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0); })
  .catch(async (error) => { console.error(error); await service?.cleanup(); fs.rmSync(work, { recursive: true, force: true }); app.exit(1); });
