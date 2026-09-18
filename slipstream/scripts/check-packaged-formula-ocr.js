"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { createFormulaFixtures } = require('./formula-ocr-fixtures.cjs');
const candidate = process.argv[2];
if (!candidate || !path.isAbsolute(candidate)) throw new Error('Pass an absolute candidate .app path');
const resources = path.join(candidate, 'Contents', 'Resources');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-packaged-formula-unit-'));
app.setPath('userData', path.join(work, 'profile')); app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
Object.defineProperty(app,'isPackaged',{ value:true }); Object.defineProperty(process,'resourcesPath',{ value:resources });
setTimeout(() => { console.error('Packaged formula unit check timed out'); app.exit(1); },120000).unref();
let service;
app.whenReady().then(async () => {
  const deny = () => { throw new Error('Local OCR attempted a network request'); };
  global.fetch=deny; require('node:http').request=deny; require('node:https').request=deny;
  service=require(path.join(resources,'app.asar','src/main/ocr-service.js'));
  assert.equal(require(path.join(resources,'app.asar/package.json')).version,require('../package.json').version);
  for (const { name,file } of await createFormulaFixtures(work)) {
    const result=await service.performReadingOCR(file); assert.equal(result.formulaOcr.status,'done',name);
    assert(result.formulaOcr.count > 0,name);
  }
  console.log('Packaged authored formula OCR unit checks passed.');
}).then(async()=>{ await service?.cleanup(); fs.rmSync(work,{recursive:true,force:true}); app.exit(0); })
.catch(async error=>{ console.error(error); await service?.cleanup(); fs.rmSync(work,{recursive:true,force:true}); app.exit(1); });
