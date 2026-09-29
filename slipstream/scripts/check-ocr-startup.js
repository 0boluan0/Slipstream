'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-ocr-startup-'));
const servicePath = require.resolve('../src/main/ocr-service');
const originalLoad = Module._load;
const calls = [];
const flush = () => new Promise(resolve => setImmediate(resolve));
Module._load = function load(request, parent, isMain) {
  if (parent?.filename === servicePath) {
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => work } };
    if (request === './local-formula-ocr') return { createLocalFormulaOcr: () => ({ cleanup() {} }) };
    if (request === 'child_process') return { execFile(file, args, options, callback) {
      const call = { file, args, options, callback, killed: false };
      calls.push(call);
      return { kill() {
        call.killed = true;
        queueMicrotask(() => callback(Object.assign(new Error('cancelled'), { killed: true }), '', ''));
      } };
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[servicePath];
const ocr = require(servicePath);
Module._load = originalLoad;
const finish = (call, text = '') => call.callback(null, JSON.stringify({ text, confidence: 1, blocks: [] }), '');

(async () => {
  const preparing = ocr.prepareOCR();
  const cancelled = new AbortController();
  const stages = [];
  const first = ocr.performOCR('/first.png', { signal: cancelled.signal });
  const second = ocr.performOCR('/second.png', { onProgress: stage => stages.push(stage) });
  assert.equal(calls.length, 1, 'launch preparation and simultaneous captures must share one initialization');
  assert.equal(calls[0].args[1], '--warm-up', 'preparation must not read any user screenshot');
  assert.equal(calls[0].options.timeout, 60000, 'cold Vision model compilation must survive the observed 28-second startup');
  cancelled.abort();
  await assert.rejects(first, error => error.isCancellation === true);
  assert.equal(calls[0].killed, false, 'closing one waiting card must not cancel another card or background preparation');
  finish(calls[0]);
  await preparing;
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[1], '/second.png');
  assert.equal(calls[1].options.timeout, 15000, 'ordinary recognition must keep its existing bounded deadline');
  assert.deepEqual(stages, ['initializing', 'recognizing']);
  finish(calls[1], 'ready');
  assert.equal((await second).text, 'ready');
  await ocr.prepareOCR();
  assert.equal(calls.length, 2, 'successful preparation is reused');

  const active = new AbortController();
  const third = ocr.performOCR('/third.png', { signal: active.signal });
  await flush();
  assert.equal(calls[2].args[1], '/third.png');
  active.abort();
  await assert.rejects(third, error => error.isCancellation === true);
  assert.equal(calls[2].killed, true, 'cancelling recognition kills the owned OCR process');

  ocr.cleanup();
  const failed = ocr.prepareOCR();
  calls[3].callback(Object.assign(new Error('initialization timed out'), { killed: true }), '', '');
  await assert.rejects(failed, error => error.code === 'ocr-initialization-failed');
  const retry = ocr.performOCR('/retry.png');
  assert.equal(calls[4].args[1], '--warm-up', 'failed preparation remains retryable');
  finish(calls[4]);
  await flush();
  finish(calls[5], 'recovered');
  assert.equal((await retry).text, 'recovered');

  ocr.cleanup();
  const quitting = ocr.prepareOCR();
  ocr.cleanup();
  await assert.rejects(quitting, error => error.isCancellation === true);
  assert.equal(calls[6].killed, true, 'application shutdown must end the preparation process');
  console.log('OCR startup passed: bounded shared preparation, immediate card cancellation, normal recognition deadline, retry and shutdown. Subprocess responses are controlled fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  ocr.cleanup();
  delete require.cache[servicePath];
  fs.rmSync(work, { recursive: true, force: true });
});
