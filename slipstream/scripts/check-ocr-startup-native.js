'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { writeVisionOcrFixture, validateVisionOcrResult } = require('./vision-ocr-fixture');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-ocr-cold-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
let service;
setTimeout(() => { console.error('Cold OCR check exceeded 120 seconds'); app.exit(1); }, 120000).unref();
app.whenReady().then(async () => {
  app.dock?.hide();
  // Compile the development helper without starting Vision. Installed builds
  // already contain this binary, but their first Vision model cache is cold.
  require('./prepare-ocr-test')('--front-window');
  const { imagePath } = writeVisionOcrFixture(work);
  service = require('../src/main/ocr-service');
  const start = Date.now();
  const controller = new AbortController();
  const cancelled = service.performOCR(imagePath, { signal: controller.signal });
  const stages = [];
  const reading = service.performOCR(imagePath, { onProgress: stage => stages.push(stage) });
  controller.abort();
  await assert.rejects(cancelled, error => error.isCancellation === true);
  const cancellationMs = Date.now() - start;
  assert(cancellationMs < 1000, 'closing a card must not wait for cold Vision initialization');
  validateVisionOcrResult(await reading, { minimumConfidence: .5 });
  const firstMs = Date.now() - start;
  assert.deepEqual(stages, ['initializing', 'recognizing']);
  const nextStart = Date.now();
  validateVisionOcrResult(await service.performOCR(imagePath), { minimumConfidence: .5 });
  console.log(JSON.stringify({ status: 'passed', firstMs, nextMs: Date.now() - nextStart, cancellationMs,
    evidence: 'Real Apple Vision, fresh private cache, compile-only setup, authored fixture; no native screen capture.' }));
  service.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch(error => {
  console.error(error);
  service?.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(1);
});
