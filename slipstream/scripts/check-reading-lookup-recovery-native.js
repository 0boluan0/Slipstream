'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createImageReader } = require('../src/main/reading-image');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-lookup-recovery-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await pause(20); }
  throw new Error(`Timed out: ${label}`);
}
const act = (window, action, payload) => window.webContents.executeJavaScript(`window.readingPin.act(${JSON.stringify(action)}, ${JSON.stringify(payload) || 'undefined'})`);
const state = async window => (await act(window, 'ready')).state;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = 'A conditional expectation is determined by the conditioning variable.';
const translation = '条件期望由所给定的变量决定。';
const term = 'conditional expectation';
let manager;
function cleanup() {
  manager?.dispose();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  fs.rmSync(work, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  app.dock?.hide();
  function OffscreenWindow(options) {
    const window = new BrowserWindow({ ...options, show: false });
    window.show = window.showInactive = window.focus = () => {};
    return window;
  }
  let settings = { setupMode: 'full', activeBackend: 'custom', activeModel: 'old', customEndpointUrl: 'http://127.0.0.1:11434/v1' };
  let behavior = 'unauthorized', openedSettings = 0, heldLookup, heldTranslation, lookupSignal, translationSignal, heldLocal, localStarted;
  const calls = [];
  const lookupResult = model => ({ lookup: { quote: term, meaning: `使用${model}配置返回的解释。`, note: '', contextual: true } });
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen, getSettings: () => settings,
    getMainWindow: () => null, captureSupported: false,
    onOpenSettings: () => { openedSettings += 1; },
    findTermCard: async () => { if (heldLocal) { localStarted = true; return heldLocal.promise; } return null; },
    classifyError: () => '请在设置中重新保存并测试凭据。',
    processReadingText: async options => {
      calls.push({ kind: options.kind, model: options.settingsSnapshot.activeModel });
      if (options.kind === 'translate') {
        if (heldTranslation) {
          translationSignal = options.signal;
          options.onTranslation({ translation });
          return heldTranslation.promise;
        }
        return { translation, terms: [{ quote: term, label: '条件期望', start: options.text.indexOf(term),
          end: options.text.indexOf(term) + term.length }], termsStatus: 'ready' };
      }
      lookupSignal = options.signal;
      if (behavior === 'unauthorized') throw Object.assign(new Error('fixture unauthorized'), { status: 401 });
      if (heldLookup) return heldLookup.promise;
      return lookupResult(options.settingsSnapshot.activeModel);
    },
  });
  assert(manager.openText(text).success);
  const reader = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(reader)).phase === 'done', 'translation');
  await reader.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  await until(async () => (await state(reader)).lookupStatus === 'error', '401 lookup');
  assert(!(await state(reader)).lookupDestination, 'ordinary queries do not add a duplicate processing location');
  assert.equal(await reader.webContents.executeJavaScript('document.getElementById("lookup-settings").hidden'), false);
  await reader.webContents.executeJavaScript('document.getElementById("lookup-settings").click()');
  assert.equal(openedSettings, 1);
  const callsBeforeSave = calls.length;
  manager.invalidateProcessing(); // Main invalidates before synchronously persisting settings.
  settings = { ...settings, activeBackend: 'openai', activeModel: 'new' };
  behavior = 'success';
  await until(async () => (await state(reader)).lookupDestination?.includes('OpenAI'), 'new destination before retry');
  assert.match((await state(reader)).destination, /本机兼容服务/u, 'the original processing location remains available');
  assert.equal(calls.length, callsBeforeSave, 'saving configuration never starts a request');
  await reader.webContents.executeJavaScript('document.getElementById("lookup-retry").click()');
  await until(async () => (await state(reader)).lookupStatus === 'done', 'same selection retry');
  assert.equal((await state(reader)).lookup.meaning, lookupResult('new').lookup.meaning);
  assert.equal((await state(reader)).sourceText, text);
  assert.equal((await state(reader)).translation, translation);
  assert.equal(calls.filter(call => call.kind === 'translate').length, 1);

  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'held' };
  heldLookup = deferred();
  const payload = current => ({ revision: current.revision, segmentId: 0, start: text.indexOf(term), end: text.indexOf(term) + term.length });
  const stalePayload = payload(await state(reader));
  const oldLookup = act(reader, 'lookup', stalePayload);
  await until(() => calls.at(-1)?.model === 'held', 'held lookup');
  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'latest' };
  assert(lookupSignal.aborted);
  const lateLookup = heldLookup; heldLookup = null;
  await act(reader, 'lookup', payload(await state(reader)));
  lateLookup.resolve(lookupResult('stale')); await oldLookup;
  assert.equal((await state(reader)).lookup.meaning, lookupResult('latest').lookup.meaning);

  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'local-old' };
  heldLocal = deferred();
  const oldLocal = act(reader, 'lookup', payload(await state(reader)));
  await until(() => localStarted, 'held local card lookup');
  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'local-new' };
  const lateLocal = heldLocal; heldLocal = null;
  await act(reader, 'lookup', payload(await state(reader)));
  lateLocal.resolve({ id: 'old-local', meaning: '不得复活的旧本地解释。', context: '' }); await oldLocal;
  assert.equal((await state(reader)).lookup.meaning, lookupResult('local-new').lookup.meaning);

  const oldPayload = payload(await state(reader));
  await act(reader, 'lookup', oldPayload);
  const cachedCalls = calls.length;
  assert.equal(calls.at(-1).model, 'local-new');
  manager.invalidateProcessing(); settings = { ...settings, setupMode: 'pending' };
  await act(reader, 'lookup', payload(await state(reader)));
  assert.equal(calls.length, cachedCalls, 'invalid setup never sends a lookup');
  assert.match((await state(reader)).lookupNotice, /设置/u);
  manager.invalidateProcessing(); settings = { ...settings, setupMode: 'translation-only', activeBackend: 'free_translate' };
  await until(async () => !(await state(reader)).explainSupported, 'basic mode capability before retry');
  assert.match((await state(reader)).lookupDestination, /Google/u);

  heldTranslation = deferred();
  assert(manager.openText(`${text} A second paragraph.`).success);
  const pending = BrowserWindow.getAllWindows().find(window => window !== reader);
  await until(() => Boolean(translationSignal), 'held translation');
  manager.invalidateProcessing(); settings = { ...settings, activeBackend: 'openai', activeModel: 'after-translation' };
  assert(translationSignal.aborted);
  heldTranslation.resolve({ translation: '不得复活的晚到译文。', terms: [] });
  await pause(40);
  assert.equal((await state(pending)).translation, translation);
  assert.equal((await state(pending)).phase, 'review');
  const beforeStaleSelection = calls.length;
  await act(reader, 'lookup', stalePayload);
  assert.equal(calls.length, beforeStaleSelection, 'selection from an earlier revision remains rejected');
  manager.dispose();
  settings = { setupMode: 'full', activeBackend: 'custom', activeModel: 'image-old',
    customEndpointUrl: 'http://127.0.0.1:11434/v1', screenshotReadingMode: 'image' };
  const heldImage = deferred(); let imageSignal;
  const imageResult = { text, translation, terms: [], uncertain: [] };
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen, getSettings: () => settings, getMainWindow: () => null,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => {
      const file = path.join(work, 'fixed-image.png');
      fs.writeFileSync(file, nativeImage.createFromBitmap(Buffer.alloc(120 * 80 * 4, 255), { width: 120, height: 80 }).toPNG());
      return file;
    },
    readScreenshot: async ({ signal, onTranslation }) => {
      imageSignal = signal; onTranslation(imageResult); return heldImage.promise;
    },
    processReadingText: async options => options.kind === 'lookup'
      ? lookupResult(options.settingsSnapshot.activeModel) : { translation, terms: [] },
  });
  const imageCapture = manager.capture();
  await until(() => Boolean(imageSignal), 'early image result');
  const imageCard = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(imageCard)).phase === 'done', 'early image translation visible');
  const originalImage = (await state(imageCard)).image;
  const originalDestination = (await state(imageCard)).destination;
  manager.invalidateProcessing(); settings = { ...settings, activeBackend: 'openai', activeModel: 'image-new' };
  assert(imageSignal.aborted);
  await until(async () => (await state(imageCard)).lookupDestination?.includes('OpenAI'), 'future image-card lookup location');
  assert.equal((await state(imageCard)).destination, originalDestination);
  assert.doesNotMatch((await state(imageCard)).lookupDestination, /图片|截图/u, 'lookup location must only describe sending text');
  await act(imageCard, 'lookup', payload(await state(imageCard)));
  heldImage.resolve({ ...imageResult, translation: '不得覆盖的图片晚到译文。' }); await imageCapture;
  assert.equal((await state(imageCard)).lookup.meaning, lookupResult('image-new').lookup.meaning);
  assert.equal((await state(imageCard)).translation, translation);
  assert.equal((await state(imageCard)).image, originalImage);
  await act(imageCard, 'translate', { revision: (await state(imageCard)).revision });
  await until(async () => (await state(imageCard)).phase === 'done', 'explicit new translation');
  assert.equal((await state(imageCard)).lookupDestination, '', 'new translation clears an obsolete future-query label');
  manager.dispose();
  const imageStages = [];
  let failImageText = true, holdImageText = false, pendingImageText, pendingImageSignal, edgeImage = false, imageUncertain = [];
  const imageSource = 'The squared norm $x^2$ is nonnegative.';
  const imageTranslation = '平方范数 $x^2$ 非负。';
  const fixedImageReader = createImageReader(async (_s, _b, model, _prompt, content, _l, _selection, signal) => {
    imageStages.push({ stage: Array.isArray(content) ? 'image' : 'text', model });
    if (Array.isArray(content)) return JSON.stringify({ source: imageSource, uncertain: imageUncertain });
    if (failImageText) throw new Error('fixed-image-text-timeout');
    if (holdImageText) { pendingImageSignal = signal; pendingImageText = deferred(); return pendingImageText.promise; }
    return JSON.stringify({ translation: imageTranslation, terms: [], references: [] });
  });
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen, getSettings: () => settings,
    getMainWindow: () => null, requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => {
      const file = path.join(work, 'retry-image.png');
      const pixels = Buffer.alloc(120 * 80 * 4, 255);
      if (edgeImage) for (let y = 30; y < 40; y += 1) for (let x = 117; x < 120; x += 1) pixels.fill(0, (y * 120 + x) * 4, (y * 120 + x) * 4 + 3);
      fs.writeFileSync(file, nativeImage.createFromBitmap(pixels, { width: 120, height: 80 }).toPNG());
      return file;
    }, readScreenshot: fixedImageReader, processReadingText: async () => { throw new Error('unexpected-unprotected-text-path'); },
  });
  await manager.capture();
  const retryImage = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(retryImage)).phase === 'error', 'image text failure');
  const retainedImage = (await state(retryImage)).image;
  assert.equal((await state(retryImage)).sourceText, '', 'transcription is not published as finished reading');
  assert.equal((await state(retryImage)).imageTextReady, true);
  assert.equal(await retryImage.webContents.executeJavaScript('document.getElementById("retry").textContent'), '重试这段文字');
  failImageText = false; holdImageText = true;
  await retryImage.webContents.executeJavaScript('document.getElementById("retry").click()');
  await until(() => Boolean(pendingImageText), 'text-only retry waiting');
  assert.deepEqual(imageStages.map(call => call.stage), ['image', 'text', 'text']);
  assert.equal((await state(retryImage)).phase, 'translating');
  assert.match(await retryImage.webContents.executeJavaScript('document.getElementById("status").textContent'), /翻译/u);
  assert.match((await state(retryImage)).notice, /只重试翻译/u);
  const oldText = pendingImageText; pendingImageText = null;
  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'image-changed' };
  await until(async () => (await state(retryImage)).phase === 'error', 'new settings keep visible image retry');
  assert(pendingImageSignal.aborted);
  assert.equal((await state(retryImage)).imageTextReady, false);
  assert.equal(await retryImage.webContents.executeJavaScript('document.getElementById("retry").textContent'), '重新读这张图');
  assert.equal(await retryImage.webContents.executeJavaScript('document.getElementById("recovery").hidden'), false);
  oldText.resolve(JSON.stringify({ translation: '不得覆盖的新旧回复', terms: [] })); await pause(30);
  assert.equal((await state(retryImage)).sourceText, '');
  holdImageText = false;
  await retryImage.webContents.executeJavaScript('document.getElementById("retry").click()');
  await until(async () => (await state(retryImage)).phase === 'done', 'new settings re-read image');
  assert.deepEqual(imageStages.map(call => call.stage), ['image', 'text', 'text', 'image', 'text']);
  assert(imageStages.slice(-2).every(call => call.model === 'image-changed'));
  assert.equal((await state(retryImage)).image, retainedImage);
  assert.equal((await state(retryImage)).sourceText, imageSource);
  assert.equal((await state(retryImage)).translation, imageTranslation);
  retryImage.close();
  for (const uncertain of [[], ['右侧文字截断']]) {
    edgeImage = !uncertain.length; imageUncertain = uncertain; failImageText = true;
    const before = imageStages.length;
    await manager.capture();
    const guardedImage = BrowserWindow.getAllWindows()[0];
    await until(async () => (await state(guardedImage)).phase === 'error', 'guarded image text failure');
    assert.equal((await state(guardedImage)).imageTextReady, false, 'uncertain or edge-cut transcription cannot be reused');
    failImageText = false;
    await guardedImage.webContents.executeJavaScript('document.getElementById("retry").click()');
    await until(async () => (await state(guardedImage)).phase === 'done', 'guarded image retry');
    assert.deepEqual(imageStages.slice(before).map(call => call.stage), ['image', 'text', 'image', 'text']);
    assert.equal((await state(guardedImage)).imageTextReady, false);
    assert.match((await state(guardedImage)).notice, edgeImage ? /选区右边可能截断/u : /右侧文字截断/u,
      'same-image retry retains the original edge or transcription warning');
    guardedImage.close();
  }
  assert(BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  console.log('Lookup settings recovery passed: real card buttons, destination before retry, preserved text, cache invalidation, invalid setup, stale selection and late lookup/translation suppression. Providers were fixed local fixtures; no API calls or visible windows.');
  cleanup(); app.exit(0);
}).catch(error => { console.error(error); cleanup(); app.exit(1); });
setTimeout(() => { console.error('Lookup recovery check exceeded 45 seconds.'); cleanup(); app.exit(1); }, 45000).unref();
