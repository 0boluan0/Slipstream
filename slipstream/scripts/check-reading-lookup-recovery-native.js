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
  const beforeTextReview = new Set(BrowserWindow.getAllWindows());
  assert(manager.openText(text).success);
  const textReviewCard = BrowserWindow.getAllWindows().find(window => !beforeTextReview.has(window));
  await until(async () => (await state(textReviewCard)).phase === 'done', 'fresh text correction card');
  await act(textReviewCard, 'review');
  await act(textReviewCard, 'translate', { revision: (await state(textReviewCard)).revision, text: 'Invalid \\(x^2' });
  await until(async () => (await state(textReviewCard)).notice.includes('未正确闭合'), 'text correction validation');
  assert.equal((await state(textReviewCard)).sourceText, text, 'invalid draft does not replace accepted text');
  await textReviewCard.webContents.executeJavaScript('document.getElementById("review-cancel").click()');
  await until(async () => (await state(textReviewCard)).phase === 'done', 'discard text correction');
  await act(textReviewCard, 'review');
  const changedText = text + ' The variance exists.';
  await act(textReviewCard, 'translate', { revision: (await state(textReviewCard)).revision, text: changedText });
  await until(async () => (await state(textReviewCard)).phase === 'done', 'confirm text correction');
  assert.equal((await state(textReviewCard)).sourceText, changedText);
  assert.equal((await state(textReviewCard)).correctionText, null);
  manager.invalidateProcessing(); settings = { ...settings, activeModel: 'after-text-correction' }; await pause(30);
  await act(textReviewCard, 'review');
  assert.equal(await textReviewCard.webContents.executeJavaScript('document.getElementById("source-editor").value'), changedText,
    'later configuration and correction do not restore the old accepted draft');
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
  let failImageText = true, failImageRead = false, holdImageText = false, pendingImageText, pendingImageSignal, edgeImage = false, imageUncertain = [];
  const imageSource = 'The squared norm $x^2$ is nonnegative.';
  let imageTranslation = '平方范数 $x^2$ 非负。';
  const fixedImageReader = createImageReader(async (_s, _b, model, _prompt, content, _l, _selection, signal) => {
    imageStages.push({ stage: Array.isArray(content) ? 'image' : 'text', model });
    if (Array.isArray(content)) {
      if (failImageRead) throw new Error('fixed-image-read-timeout');
      return JSON.stringify({ source: imageSource, uncertain: imageUncertain });
    }
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
  failImageText = true;
  await manager.capture();
  const correctedImage = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(correctedImage)).phase === 'error', 'correctable text failure');
  const correctionStart = imageStages.length;
  const click = (window, id) => window.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
  const edit = (window, value) => window.webContents.executeJavaScript(`document.getElementById("source-editor").value=${JSON.stringify(value)}; document.getElementById("source-editor").dispatchEvent(new Event("input"))`);
  const draft = window => window.webContents.executeJavaScript('document.getElementById("source-editor").value');
  await click(correctedImage, 'tab-image'); await click(correctedImage, 'edit-source');
  await until(async () => (await state(correctedImage)).phase === 'review', 'explicit correction');
  assert.equal(await draft(correctedImage), imageSource);
  assert.equal((await state(correctedImage)).sourceText, '', 'opening correction does not accept the draft');
  const correctedSource = imageSource.replace('x^2', 'y^2');
  await edit(correctedImage, correctedSource);
  await click(correctedImage, 'review-image'); await click(correctedImage, 'tab-translation');
  assert.equal(await draft(correctedImage), correctedSource);
  await click(correctedImage, 'review-cancel');
  await until(async () => (await state(correctedImage)).phase === 'error', 'discard correction');
  assert.equal((await state(correctedImage)).sourceText, '');
  assert.equal(imageStages.length, correctionStart, 'opening, tab changes and discard send no requests');
  await click(correctedImage, 'tab-image'); await click(correctedImage, 'edit-source');
  await until(async () => (await state(correctedImage)).phase === 'review', 'reopen correction');
  assert.equal(await draft(correctedImage), imageSource, 'explicit discard drops the unsubmitted draft');
  await edit(correctedImage, 'The value \\(y^2'); await click(correctedImage, 'confirm');
  await until(async () => (await state(correctedImage)).notice.includes('未正确闭合'), 'invalid corrected formula');
  assert.equal((await state(correctedImage)).sourceText, ''); assert.equal(imageStages.length, correctionStart);
  await edit(correctedImage, correctedSource);
  for (const replacement of [{ setupMode: 'translation-only', activeBackend: 'free_translate' }, { setupMode: 'pending' }]) {
    manager.invalidateProcessing(); settings = { ...settings, ...replacement };
    await pause(30);
    assert.equal((await state(correctedImage)).phase, 'review');
    assert.equal(await draft(correctedImage), correctedSource, 'saving settings retains the unsubmitted draft');
    await click(correctedImage, 'confirm'); await pause(20);
    assert.equal(imageStages.length, correctionStart, 'unsupported configuration does not send correction');
    assert.equal((await state(correctedImage)).phase, 'review');
    assert.match((await state(correctedImage)).notice, /配置|专业阅读/u);
  }
  manager.invalidateProcessing(); settings = { ...settings, setupMode: 'full', activeBackend: 'custom', activeModel: 'correction-new' };
  await pause(30); failImageText = false;
  await click(correctedImage, 'confirm');
  await until(async () => (await state(correctedImage)).phase === 'error', 'changed formula output rejected');
  assert.equal((await state(correctedImage)).sourceText, correctedSource);
  assert.equal((await state(correctedImage)).translation, '');
  assert.match((await state(correctedImage)).notice, /公式/u);
  assert(imageStages.slice(correctionStart).every(call => call.stage === 'text' && call.model === 'correction-new'));
  imageTranslation = '平方范数 $y^2$ 非负。';
  const beforeCorrectedRetry = imageStages.length;
  await click(correctedImage, 'retry');
  await until(async () => (await state(correctedImage)).phase === 'done', 'retry confirmed correction');
  assert.equal((await state(correctedImage)).sourceText, correctedSource);
  assert.equal((await state(correctedImage)).translation, imageTranslation);
  assert.deepEqual(imageStages.slice(beforeCorrectedRetry).map(call => call.stage), ['text']);
  const originalCorrectionDestination = (await state(correctedImage)).destination;
  await click(correctedImage, 'tab-image'); await click(correctedImage, 'edit-source');
  await until(async () => (await state(correctedImage)).phase === 'review', 'done correction');
  manager.invalidateProcessing(); settings = { ...settings, activeBackend: 'openai' }; await pause(30);
  await click(correctedImage, 'review-cancel');
  await until(async () => (await state(correctedImage)).phase === 'done', 'discard to completed result');
  assert.equal((await state(correctedImage)).destination, originalCorrectionDestination);
  assert.match((await state(correctedImage)).lookupDestination, /OpenAI/u);
  correctedImage.close();
  failImageRead = true;
  await manager.capture(); const emptyImage = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(emptyImage)).phase === 'error', 'no transcription');
  const beforeEmptyEdit = imageStages.length;
  await click(emptyImage, 'tab-image'); await click(emptyImage, 'edit-source');
  assert.equal((await state(emptyImage)).phase, 'error');
  assert.equal(await emptyImage.webContents.executeJavaScript('document.getElementById("recovery").hidden'), false);
  assert.equal(imageStages.length, beforeEmptyEdit); emptyImage.close();
  failImageRead = false; imageTranslation = '平方范数 $x^2$ 非负。';
  edgeImage = true; imageUncertain = []; failImageText = true;
  const beforeEdgeReview = imageStages.length;
  await manager.capture();
  const edgeReviewImage = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(edgeReviewImage)).phase === 'error', 'edge image text failure before correction');
  const edgeFailure = await state(edgeReviewImage);
  assert.equal(edgeFailure.sourceText, '');
  assert.equal(edgeFailure.imageTextReady, false, 'an edge warning still prevents automatic transcription reuse');
  assert.deepEqual(imageStages.slice(beforeEdgeReview).map(call => call.stage), ['image', 'text']);
  await click(edgeReviewImage, 'tab-image'); await click(edgeReviewImage, 'edit-source');
  assert.equal((await state(edgeReviewImage)).phase, 'review', 'explicit correction can inspect validated edge transcription');
  assert.equal(await draft(edgeReviewImage), imageSource);
  assert.equal((await state(edgeReviewImage)).sourceText, '', 'inspection does not accept the draft');
  assert.equal((await state(edgeReviewImage)).imageTextReady, false);
  assert.match((await state(edgeReviewImage)).notice, /选区右边可能截断/u);
  assert.equal(await edgeReviewImage.webContents.executeJavaScript('document.getElementById("notice").hidden'), false);
  assert.match(await edgeReviewImage.webContents.executeJavaScript('document.getElementById("notice").textContent'), /选区右边可能截断/u);
  const edgeReviewViewport = await edgeReviewImage.webContents.executeJavaScript(`(() => {
    const notice = document.getElementById('notice').getBoundingClientRect();
    const scroll = document.getElementById('scroll-area').getBoundingClientRect();
    return { noticeTop: notice.top, noticeBottom: notice.bottom, scrollTop: scroll.top, scrollBottom: scroll.bottom,
      intersects: notice.height > 0 && notice.width > 0
        && notice.bottom > Math.max(scroll.top, 0) && notice.top < Math.min(scroll.bottom, window.innerHeight)
        && notice.right > Math.max(scroll.left, 0) && notice.left < Math.min(scroll.right, window.innerWidth),
      editorFocused: document.activeElement === document.getElementById('source-editor') };
  })()`);
  assert(edgeReviewViewport.intersects, `edge warning stays in the correction viewport: ${JSON.stringify(edgeReviewViewport)}`);
  assert(edgeReviewViewport.editorFocused, 'the source editor receives focus without scrolling the warning away');
  await edit(edgeReviewImage, ''); await click(edgeReviewImage, 'confirm');
  assert.equal((await state(edgeReviewImage)).phase, 'review');
  assert.equal(await draft(edgeReviewImage), '');
  assert.match((await state(edgeReviewImage)).notice, /请保留 1–/u);
  assert.match((await state(edgeReviewImage)).notice, /选区右边可能截断/u,
    'invalid correction preserves the edge warning');
  assert.equal(imageStages.length, beforeEdgeReview + 2, 'empty correction sends no requests');
  await click(edgeReviewImage, 'review-cancel');
  await until(async () => (await state(edgeReviewImage)).phase === 'error', 'discard edge correction');
  assert.equal((await state(edgeReviewImage)).notice, edgeFailure.notice, 'discard returns the original failure');
  assert.equal((await state(edgeReviewImage)).sourceText, '');
  assert.equal((await state(edgeReviewImage)).imageTextReady, false);
  assert.equal(imageStages.length, beforeEdgeReview + 2, 'inspecting and discarding edge text sends no requests');
  await click(edgeReviewImage, 'tab-image'); await click(edgeReviewImage, 'edit-source');
  assert.equal((await state(edgeReviewImage)).phase, 'review');
  assert.equal(await draft(edgeReviewImage), imageSource);
  failImageText = false;
  await click(edgeReviewImage, 'confirm');
  await until(async () => (await state(edgeReviewImage)).phase === 'done', 'explicitly confirmed edge text');
  assert.deepEqual(imageStages.slice(beforeEdgeReview).map(call => call.stage), ['image', 'text', 'text'],
    'only confirmation sends one guarded text request without reading the image again');
  assert.equal((await state(edgeReviewImage)).sourceText, imageSource);
  assert.equal((await state(edgeReviewImage)).translation, imageTranslation);
  assert.equal((await state(edgeReviewImage)).correctionText, null);
  assert.equal((await state(edgeReviewImage)).imageTextReady, true, 'explicit confirmation enables retry of the accepted correction');
  assert.equal((await state(edgeReviewImage)).formulaStatus, 'uncertain');
  assert.match((await state(edgeReviewImage)).notice, /选区右边可能截断/u);
  assert.equal((await state(edgeReviewImage)).image, edgeFailure.image, 'original image remains available');
  await click(edgeReviewImage, 'tab-image');
  assert.equal(await edgeReviewImage.webContents.executeJavaScript('document.getElementById("tab-image").getAttribute("aria-selected")'), 'true');
  edgeReviewImage.close();
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
    const warning = (await state(guardedImage)).notice;
    await click(guardedImage, 'tab-image'); await click(guardedImage, 'edit-source');
    await until(async () => (await state(guardedImage)).phase === 'review', 'correct uncertain source');
    await click(guardedImage, 'confirm');
    await until(async () => (await state(guardedImage)).phase === 'done', 'confirmed uncertain source');
    assert.equal((await state(guardedImage)).notice, warning, 'manual confirmation retains original image uncertainty');
    assert.equal((await state(guardedImage)).formulaStatus, 'uncertain');
    assert.equal(imageStages.at(-1).stage, 'text');
    guardedImage.close();
  }
  manager.dispose();
  const lateFinal = deferred(); let finalSignal;
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen, getSettings: () => settings,
    getMainWindow: () => null, requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => {
      const file = path.join(work, 'early-image.png');
      fs.writeFileSync(file, nativeImage.createFromBitmap(Buffer.alloc(120 * 80 * 4, 255), { width: 120, height: 80 }).toPNG());
      return file;
    }, readScreenshot: async ({ signal, onTranslation }) => {
      finalSignal = signal;
      onTranslation({ text: imageSource, translation: imageTranslation, terms: [], termsStatus: 'reviewing', uncertain: [] });
      return lateFinal.promise;
    }, processReadingText: async () => { throw new Error('unexpected-text-path'); },
  });
  const earlyCapture = manager.capture();
  await until(() => Boolean(finalSignal), 'early image translation');
  const earlyImage = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(earlyImage)).phase === 'done', 'early translation published');
  await click(earlyImage, 'tab-image'); await click(earlyImage, 'edit-source');
  await until(async () => (await state(earlyImage)).phase === 'review', 'edit before final term response');
  assert(finalSignal.aborted, 'editing revokes the previous main request');
  await edit(earlyImage, correctedSource);
  lateFinal.resolve({ text: imageSource, translation: 'old final', terms: [], uncertain: [] }); await earlyCapture;
  assert.equal((await state(earlyImage)).phase, 'review');
  assert.equal(await draft(earlyImage), correctedSource, 'late term final cannot replace a draft');
  await click(earlyImage, 'review-cancel');
  await until(async () => (await state(earlyImage)).phase === 'done', 'discard after late final');
  assert.equal((await state(earlyImage)).translation, imageTranslation);
  assert.equal((await state(earlyImage)).segments[0].termsStatus, 'unavailable');
  assert.match(await earlyImage.webContents.executeJavaScript('document.getElementById("translation").textContent'), /展开原文选词查询/u);
  assert(BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  console.log('Lookup settings recovery passed: real card buttons, destination before retry, preserved text, cache invalidation, invalid setup, stale selection, late lookup/translation suppression, and explicit edge-source review with guarded text confirmation. Providers were fixed local fixtures; no API calls or visible windows.');
  cleanup(); app.exit(0);
}).catch(error => { console.error(error); cleanup(); app.exit(1); });
setTimeout(() => { console.error('Lookup recovery check exceeded 45 seconds.'); cleanup(); app.exit(1); }, 45000).unref();
