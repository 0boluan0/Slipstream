'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
const { createTermCardStore } = require('../src/main/term-card-store');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-check-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const preview = process.argv.includes('--preview');
const screenshotIndex = process.argv.indexOf('--screenshot');
const screenshotPath = screenshotIndex >= 0 ? path.resolve(process.argv[screenshotIndex + 1]) : null;
if (!preview) setTimeout(() => { console.error('Reading card runtime check exceeded 90 seconds.'); app.exit(1); }, 90000).unref();
const english = 'Correlation does not imply causation.\nAn observed association between two variables may be explained by a common cause.\nThe estimate is conditional on the observed data.';
const chinese = '相关关系并不意味着因果关系。两个变量之间观察到的关联，可能由一个共同原因来解释。这个估计是在给定已观测数据的条件下得到的。';
const cards = () => BrowserWindow.getAllWindows().filter((window) => window.getTitle() === 'Slipstream · 阅读卡片');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
const stateOf = (window) => window.webContents.executeJavaScript('window.readingPin.act("ready").then(r => r.state)');
async function action(window, name, payload) {
  return window.webContents.executeJavaScript(`window.readingPin.act(${JSON.stringify(name)}, ${JSON.stringify(payload) || 'undefined'})`);
}
const phaseIs = (window, phase) => async () => !window.isDestroyed() && (await stateOf(window)).phase === phase;

let manager;
const termStore = createTermCardStore(path.join(work, 'term-cards'));
app.whenReady().then(async () => {
  const sourceWindow = new BrowserWindow({ width: 860, height: 320, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await sourceWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:32px;font:24px/1.65 Georgia;background:white;color:#17241f">${english.replace(/\n/g, '<br>')}</body></html>`)}`);
  const fixture = path.join(work, 'source.png');
  fs.writeFileSync(fixture, (await sourceWindow.webContents.capturePage()).toPNG());
  sourceWindow.destroy();
  const cutBitmap = Buffer.alloc(300 * 100 * 4, 255);
  for (let y = 0; y < 4; y++) for (let x = 30; x < 42; x++) {
    const offset = (y * 300 + x) * 4;
    cutBitmap.fill(0, offset, offset + 3);
  }
  const cutFixture = path.join(work, 'top-cut.png');
  fs.writeFileSync(cutFixture, nativeImage.createFromBitmap(cutBitmap, { width: 300, height: 100 }).toPNG());
  const denseTopBitmap = Buffer.alloc(300 * 100 * 4, 255);
  for (let y = 0; y < 3; y++) for (let x = 30; x < 102; x++) {
    const offset = (y * 300 + x) * 4;
    denseTopBitmap.fill(0, offset, offset + 3);
  }
  const denseTopFixture = path.join(work, 'dense-top-cut.png');
  fs.writeFileSync(denseTopFixture, nativeImage.createFromBitmap(denseTopBitmap, { width: 300, height: 100 }).toPNG());
  function edgeFixture(edge) {
    const bitmap = Buffer.alloc(300 * 100 * 4, 255);
    for (let strip = 0; strip < 4; strip++) for (let position = 30; position < 44; position++) {
      const x = edge === 'left' ? strip : edge === 'right' ? 299 - strip : position;
      const y = edge === 'bottom' ? 99 - strip : position;
      const offset = (y * 300 + x) * 4;
      bitmap.fill(0, offset, offset + 3);
    }
    const file = path.join(work, `${edge}-cut.png`);
    fs.writeFileSync(file, nativeImage.createFromBitmap(bitmap, { width: 300, height: 100 }).toPNG());
    return file;
  }
  const rightCutFixture = edgeFixture('right');
  const leftCutFixture = edgeFixture('left');
  const bottomCutFixture = edgeFixture('bottom');
  const mainWindow = new BrowserWindow({ width: 400, height: 300, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await mainWindow.loadURL('about:blank');
  mainWindow.showInactive();
  let low = false;
  let fail = false;
  let cancel = false;
  let holdSelection = false;
  let selectionStarted = false;
  let selectionAbortObserved = false;
  let holdOcr = false;
  let ocrStarted = false;
  let ocrAbortObserved = false;
  let held = false;
  let resolveHeld;
  let heldSignal;
  let realOcrDone = false;
  let providerCalls = 0;
  let selectionCount = 0;
  let settings = { setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' };
  let copied = '';
  let ocrOverride = null;
  let failMatching = '';
  let noTerms = false;
  let ocrClipped = false;
  let ocrLeftClipped = false;
  let ocrTopClipped = false;
  let ocrTopPadded = false;
  let imageTopCut = false;
  let imageDenseTopCut = false;
  let imageBottomCut = false;
  let ocrLeftPadded = false;
  let ocrRightPadded = false;
  let ocrBottomClipped = false;
  let ocrBottomShortBlock = false;
  let formulaOcrOverride = null;
  let holdReview = false, resolveReview, reviewSignal;
  const provider = createReadingProcessor(async (...args) => {
    providerCalls += 1;
    if (held) {
      heldSignal = args[7];
      return new Promise((resolve) => { resolveHeld = resolve; });
    }
    if (fail) throw new Error('fixture-provider-failure');
    if (failMatching && args[6].includes(failMatching)) throw new Error('fixture-paragraph-failure');
    const input = JSON.parse(args[4]);
    if (input.candidates) {
      if (holdReview) { reviewSignal = args[7]; return new Promise((resolve) => { resolveReview = resolve; }); }
      return JSON.stringify({ keep: input.candidates.map((_quote, index) => index) });
    }
    if (input.selection) return JSON.stringify({ quote: input.selection,
      meaning: input.selection === 'causation'
        ? '因果关系意味着改变一个因素，会引起另一个因素的变化。仅仅观察到两者一起变化，还不足以说明存在这种关系。'
        : '相关关系描述两个变量在统计上一起变化的程度；它本身不能说明一个变量导致了另一个变量。',
      note: '这段提到共同原因：两个变量可以受到同一个因素影响，因此一起变化，却没有直接的因果关系。',
      ...(input.selection === 'Correlation' ? { basis: 'contextual',
        sourceQuote: input.excerpt.slice(input.excerpt.indexOf('Correlation'), input.excerpt.indexOf('Correlation') + 90) } : {}) });
    if (args[3].includes('"translation"')) return JSON.stringify({ translation: chinese,
      terms: noTerms ? [] : [{ quote: 'Correlation', label: '相关关系', role: 'core' }, { quote: 'causation', label: '因果关系', role: 'core' }] });
    return args[8] ? JSON.stringify({ terms: [{ quote: 'Correlation', explanation: '指变量一起变化的统计关系；这里没有据此断定因果。' }], sentences: [] }) : chinese;
  });
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    copyText: (text) => { copied = text; },
    saveTermCard: (input) => termStore.save(input),
    getSettings: () => settings, getMainWindow: () => mainWindow,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async (_file, { signal } = {}) => {
      assert(cards().every((window) => !window.isVisible()), 'existing cards must be hidden while selecting');
      assert(!mainWindow.isVisible(), 'main workspace must be hidden while selecting');
      if (holdSelection) {
        selectionStarted = true;
        return new Promise((_resolve, reject) => {
          const fail = () => { selectionAbortObserved = true; const error = new Error('cancel'); error.isCancellation = true; reject(error); };
          if (signal?.aborted) fail();
          else signal?.addEventListener('abort', fail, { once: true });
        });
      }
      if (cancel) { const error = new Error('cancel'); error.isCancellation = true; throw error; }
      const file = path.join(work, `capture-${++selectionCount}.png`);
      fs.copyFileSync(imageDenseTopCut ? denseTopFixture : imageTopCut ? cutFixture : imageBottomCut ? bottomCutFixture
        : ocrClipped ? rightCutFixture : ocrLeftClipped ? leftCutFixture : fixture, file);
      return file;
    },
    performOCR: async (file, options) => {
      if (holdOcr) {
        ocrStarted = true;
        return new Promise((_resolve, reject) => {
          const fail = () => { ocrAbortObserved = true; const error = new Error('cancel'); error.isCancellation = true; reject(error); };
          if (options.signal?.aborted) fail();
          else options.signal?.addEventListener('abort', fail, { once: true });
        });
      }
      if (ocrOverride) return { text: ocrOverride, confidence: .99, formulaOcr: formulaOcrOverride || undefined, blocks: ocrClipped
        ? ocrOverride.split('\n').map((text, index) => ({ text, confidence: .99,
          boundingBox: { x: .1, y: .7 - index * .1, w: .895, h: .06 } }))
        : ocrLeftClipped ? ocrOverride.split('\n').map((text, index) => ({ text, confidence: .99,
          boundingBox: { x: .005, y: .7 - index * .1, w: .8, h: .06 } }))
        : ocrLeftPadded ? ocrOverride.split('\n').map((text, index) => ({ text, confidence: .99,
          boundingBox: { x: .005, y: .7 - index * .1, w: .8, h: .06 } }))
        : ocrRightPadded ? ocrOverride.split('\n').map((text, index) => ({ text, confidence: .99,
          boundingBox: { x: .1, y: .7 - index * .1, w: .895, h: .06 } }))
        : ocrTopClipped ? [{ text: ocrOverride, confidence: .99,
          boundingBox: { x: .08, y: .94, w: .8, h: .06 } }]
        : ocrTopPadded ? [{ text: ocrOverride, confidence: .99,
          boundingBox: { x: .08, y: .91, w: .8, h: .06 } }]
        : ocrBottomClipped ? [{ text: ocrOverride, confidence: .99,
          boundingBox: { x: .08, y: .0163, w: .8, h: .08 } }]
        : ocrBottomShortBlock ? [{ text: 'the final hidden vector', confidence: .99,
          boundingBox: { x: .08, y: .2, w: .8, h: .08 } },
          { text: 'as', confidence: .99, boundingBox: { x: .08, y: .019, w: .1, h: .05 } }]
        : [{ text: ocrOverride, confidence: .99 }] };
      if (!realOcrDone) {
        const result = await require('../src/main/ocr-service').performOCR(file, options);
        assert.match(result.text, /Correlation/);
        assert(result.confidence >= .5);
        realOcrDone = true;
        return result;
      }
      return { text: english, confidence: low ? .3 : .99,
        blocks: [{ text: english, confidence: low ? .3 : .99 }] };
    },
    processReadingText: provider,
    onError: (message) => { throw new Error(message); },
  });
  const firstCapture = await manager.capture();
  assert(firstCapture.pinned);
  assert(!mainWindow.isVisible(), 'successful capture must leave the main workspace hidden');
  const first = cards()[0];
  await until(phaseIs(first, 'done'), 'first translated card');
  assert.equal(providerCalls, 2, 'translation plus deletion-only term review');
  assert.equal((await stateOf(first)).translation, chinese);
  console.log('ok - native card with real Apple Vision OCR and a deterministic translation');
  assert(first.isAlwaysOnTop());
  assert.equal(await first.webContents.executeJavaScript('typeof window.api'), 'undefined', 'card must not inherit the main app IPC API');
  assert.equal(await first.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await first.webContents.executeJavaScript('fetch("https://example.com").then(()=>false,()=>true)'), true, 'renderer network must be blocked');
  await assert.rejects(action(first, 'translate', { revision: 'wrong' }));
  await assert.rejects(action(first, 'settings:get'));
  await action(first, 'explain', { revision: (await stateOf(first)).revision });
  await until(async () => Boolean((await stateOf(first)).explanations), 'source-grounded explanations');
  assert.equal((await stateOf(first)).explanations.terms.length, 1);
  console.log('ok - narrow IPC, blocked renderer network and source-matching explanations');
  await first.webContents.executeJavaScript('document.querySelector(".term-chip").focus(); document.querySelector(".term-chip").click()');
  await until(async () => (await stateOf(first)).lookupStatus === 'done', 'one-click concept explanation');
  assert.equal((await stateOf(first)).lookup.quote, 'Correlation');
  assert.match((await stateOf(first)).lookup.meaning, /一起变化/);
  assert.equal((await stateOf(first)).lookup.basis, 'contextual');
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-basis").textContent'), '根据本段用法解释');
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-evidence").hidden'), false);
  await first.webContents.executeJavaScript('document.querySelector("#lookup-evidence summary").click()');
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-evidence").open'), true);
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-evidence-quote").textContent'),
    (await stateOf(first)).lookup.sourceQuote, 'the disclosure must display the exact source-backed excerpt');
  await first.webContents.executeJavaScript('document.getElementById("lookup-close").click()');
  await until(() => first.webContents.executeJavaScript('document.activeElement.classList.contains("term-chip")'), 'return focus to the concept button');
  await first.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  const cachedCalls = providerCalls;
  await first.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  await pause(50);
  assert.equal(providerCalls, cachedCalls, 'reopening the same term must use this card cache');
  await assert.rejects(action(first, 'lookup', { revision: (await stateOf(first)).revision, segmentId: 0, start: -1, end: 8 }));
  assert.equal(providerCalls, cachedCalls, 'invalid selection must not reach provider');
  held = true;
  void action(first, 'lookup', { revision: (await stateOf(first)).revision, segmentId: 0,
    start: (await stateOf(first)).segments[0].source.indexOf('causation'),
    end: (await stateOf(first)).segments[0].source.indexOf('causation') + 9 });
  await until(() => Boolean(resolveHeld), 'pending second concept');
  const staleLookup = resolveHeld;
  await first.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  assert(heldSignal.aborted, 'a newer concept selection must cancel the prior request');
  staleLookup(JSON.stringify({ quote: 'causation', meaning: '旧解释', note: '' }));
  await pause(50);
  assert.equal((await stateOf(first)).lookup.quote, 'Correlation');
  held = false;
  resolveHeld = null;
  assert.equal((await termStore.list()).cards.length, 0, 'viewing a definition must not automatically save a card');
  await first.webContents.executeJavaScript('document.getElementById("save-term").click()');
  await until(async () => (await stateOf(first)).saveStatus === 'saved', 'explicit local concept save');
  assert.equal((await termStore.list()).cards.length, 1);
  assert.equal(copied, '', 'no automatic clipboard writes');
  await action(first, 'copy');
  assert.equal(copied, chinese);
  const expandedHeight = first.getBounds().height;
  await action(first, 'collapse');
  assert.equal(first.getBounds().height, 46);
  await action(first, 'collapse');
  assert.equal(first.getBounds().height, expandedHeight);
  await first.webContents.executeJavaScript('document.getElementById("tab-parallel").click()');
  assert(await first.webContents.executeJavaScript('!document.querySelector(".source-paragraph").hidden'));
  await first.webContents.executeJavaScript('document.getElementById("larger").click()');
  assert.equal(await first.webContents.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--reading-size")'), '17px');
  console.log('ok - concept chips, contextual lookup cache, validated selection, explicit copy, collapse, bilingual view and font size');
  await first.webContents.executeJavaScript('document.getElementById("tab-image").click()');
  await until(async () => first.webContents.executeJavaScript('document.getElementById("source-image").naturalWidth > 0'), 'local screenshot display');
  if (screenshotPath) {
    first.setSize(460, 680);
    await first.webContents.executeJavaScript('document.getElementById("tab-translation").click()');
    await pause(100);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, (await first.webContents.capturePage()).toPNG());
  }
  if (preview) {
    console.log('Reading card preview ready (fictional source; deterministic provider).');
    return;
  }
  await first.webContents.executeJavaScript(`document.getElementById('tab-parallel').click();
    const p = document.querySelector('.source-paragraph');
    const start = p.textContent.indexOf('causation');
    const range = document.createRange(); range.setStart(p.firstChild, start); range.setEnd(p.firstChild, start + 9);
    getSelection().removeAllRanges(); getSelection().addRange(range);`);
  await until(async () => first.webContents.executeJavaScript('!document.getElementById("selection-bar").hidden'), 'manual English selection affordance');
  await first.webContents.executeJavaScript('document.getElementById("lookup-selection").click()');
  await until(async () => (await stateOf(first)).lookupStatus === 'done' && (await stateOf(first)).lookup.quote === 'causation', 'selected phrase explanation');
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-evidence").hidden'), true,
    'the previous concept must not leave its evidence visible on another lookup');
  assert.equal(await first.webContents.executeJavaScript('document.getElementById("lookup-evidence").open'), false,
    'a new lookup must reset the previous evidence disclosure');
  await action(first, 'dismiss-lookup');
  console.log('ok - manual selection maps browser text offsets to the exact original phrase');
  first.setSize(280, 220);
  first.webContents.setZoomFactor(2);
  await pause(120);
  assert(await first.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), 'card must not overflow horizontally at 200%');
  first.webContents.setZoomFactor(1);
  await action(first, 'toggle-top');
  assert(!first.isAlwaysOnTop());
  await action(first, 'toggle-top');
  assert(first.isAlwaysOnTop());
  const originalBounds = first.getBounds();
  first.setPosition(originalBounds.x + 20, originalBounds.y + 20);
  assert.equal(first.getBounds().x, originalBounds.x + 20);
  console.log('ok - 200% layout, native size, position and topmost controls');
  low = true;
  const callsBeforeReview = providerCalls;
  await manager.capture();
  const second = cards().find((window) => window !== first);
  await until(phaseIs(second, 'review'), 'low confidence review');
  assert.equal(providerCalls, callsBeforeReview, 'low OCR confidence must not send text');
  assert.equal((await stateOf(first)).translation, chinese);
  await second.webContents.executeJavaScript('document.getElementById("review-image").click()');
  assert(await second.webContents.executeJavaScript('!document.getElementById("edit-source").disabled'),
    'the screenshot correction action must be available during OCR review');
  await second.webContents.executeJavaScript('document.getElementById("edit-source").click()');
  await until(() => second.webContents.executeJavaScript('document.getElementById("source-correction").open && document.activeElement.id === "source-editor"'), 'screenshot correction editor');
  await action(second, 'translate', { revision: (await stateOf(second)).revision, text: english });
  await until(phaseIs(second, 'done'), 'reviewed translation');
  void action(first, 'close').catch(() => {});
  await until(() => first.isDestroyed(), 'close first card');
  assert(first.isDestroyed());
  assert(!second.isDestroyed());
  console.log('ok - independent cards and zero provider calls before OCR review');
  cancel = true;
  mainWindow.showInactive();
  await manager.capture();
  assert.equal(cards().length, 1, 'cancelled selector must not create a card');
  assert(second.isVisible(), 'cancel must restore existing cards');
  assert(mainWindow.isVisible(), 'cancel must restore the previously visible main workspace');
  cancel = false;
  holdSelection = true;
  selectionStarted = false;
  selectionAbortObserved = false;
  const pendingSelection = manager.capture({ owner: 7001 });
  await until(() => selectionStarted, 'waiting native selector fixture');
  const cancelledSelection = manager.cancelCapture(7001);
  assert(cancelledSelection && typeof cancelledSelection.then === 'function', 'main-owned capture must expose settlement');
  assert.equal(await cancelledSelection.then(() => true), true);
  assert.deepEqual(await pendingSelection, { success: false, cancelled: true });
  assert(selectionAbortObserved, 'cancel must reach the active selector');
  assert.equal(manager.cancelCapture(7001), null, 'settled capture must release its owner');
  assert(second.isVisible(), 'cancel must restore existing cards after an in-flight selector');
  assert(mainWindow.isVisible(), 'cancel must restore the main workspace after an in-flight selector');
  holdSelection = false;
  holdOcr = true;
  ocrStarted = false;
  ocrAbortObserved = false;
  const pendingOcr = manager.capture({ owner: 7002 });
  await until(() => ocrStarted, 'waiting local OCR fixture');
  const cancelledOcr = manager.cancelCapture(7002);
  assert(cancelledOcr && typeof cancelledOcr.then === 'function', 'OCR capture must expose settlement');
  await cancelledOcr;
  assert.deepEqual(await pendingOcr, { success: false, cancelled: true });
  assert(ocrAbortObserved, 'cancel must reach local OCR');
  assert.equal(cards().length, 1, 'cancelled OCR must remove its incomplete card');
  assert.equal(manager.cancelCapture(7002), null);
  holdOcr = false;
  low = false;
  held = true;
  await manager.capture();
  const third = cards().find((window) => window !== second);
  await until(() => Boolean(resolveHeld), 'held translation');
  const lateResolve = resolveHeld;
  void action(third, 'close').catch(() => {});
  await until(() => third.isDestroyed(), 'close in-flight card');
  assert(heldSignal.aborted, 'closing must abort this card request');
  lateResolve(chinese);
  await pause(100);
  assert.equal(cards().length, 1, 'late completion must not resurrect a card');
  console.log('ok - cancelled selection and closed-card late-result suppression');
  resolveHeld = null;
  await manager.capture();
  const fourth = cards().find((window) => window !== second);
  await until(() => Boolean(resolveHeld), 'second held request');
  const staleResolve = resolveHeld;
  manager.invalidateProcessing();
  settings = { ...settings, activeBackend: 'free_translate', activeModel: 'google-translate' };
  await until(async () => (await stateOf(fourth)).destination.includes('Google'), 'updated processing destination');
  assert(heldSignal.aborted);
  staleResolve(chinese);
  await pause(50);
  assert.equal((await stateOf(fourth)).phase, 'review');
  assert.equal((await stateOf(fourth)).translation, '');
  assert.equal((await stateOf(second)).translation, chinese, 'completed cards retain their result across settings changes');
  held = false;
  fail = true;
  await action(fourth, 'translate', { revision: (await stateOf(fourth)).revision });
  await until(phaseIs(fourth, 'error'), 'provider failure recovery');
  fail = false;
  await action(fourth, 'translate', { revision: (await stateOf(fourth)).revision });
  await until(phaseIs(fourth, 'done'), 'provider retry');
  fourth.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await until(() => fourth.isDestroyed(), 'Escape closes only the focused card');
  assert(!second.isDestroyed());
  manager.clear();
  assert.equal(cards().length, 0);
  assert.equal((await createTermCardStore(termStore.directory).list()).cards.length, 1, 'closing all screenshot cards must retain saved concepts');
  settings = { setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' };
  ocrOverride = 'First paragraph about correlation.\n\nSecond paragraph about causation.';
  failMatching = 'Second paragraph';
  await manager.capture();
  const partial = cards()[0];
  await until(phaseIs(partial, 'partial'), 'partially translated document');
  assert.equal((await stateOf(partial)).segments[0].status, 'done');
  const beforeRetry = providerCalls;
  failMatching = '';
  await action(partial, 'translate', { revision: (await stateOf(partial)).revision, retryFailed: true });
  await until(phaseIs(partial, 'done'), 'retry only the failed paragraph');
  assert.equal(providerCalls, beforeRetry + 1);
  manager.clear();
  noTerms = true;
  ocrOverride = '框选一段，译文贴在屏幕旁 Option+Shift+S';
  const beforeOwnUi = providerCalls;
  await manager.capture();
  const ownUi = cards()[0];
  await until(phaseIs(ownUi, 'review'), 'self UI screenshot review');
  assert.match((await stateOf(ownUi)).notice, /选区似乎包含 Slipstream 窗口/);
  assert.equal(providerCalls, beforeOwnUi, 'capturing Slipstream chrome must not automatically transmit OCR text');
  manager.clear();
  ocrClipped = true;
  ocrOverride = 'Given an ensemble of classifiers and a training set\nThe margin measures the extent of the correct vote';
  const beforeClipped = providerCalls;
  await manager.capture();
  const clipped = cards()[0];
  await until(phaseIs(clipped, 'review'), 'right-edge cropped prose review');
  assert.match((await stateOf(clipped)).notice, /右侧可能截断/);
  assert.equal(providerCalls, beforeClipped, 'cropped prose must stay local until reviewed');
  manager.clear();
  ocrClipped = false;
  ocrLeftClipped = true;
  ocrOverride = 'ode feature inputs enter a shared transformation\nhe first operation applies the weight matrix to each node';
  const beforeLeft = providerCalls;
  await manager.capture();
  const left = cards()[0];
  await until(phaseIs(left, 'review'), 'left-edge cropped prose review');
  assert.match((await stateOf(left)).notice, /左侧可能截断/);
  assert.equal(providerCalls, beforeLeft, 'left-cropped prose must stay local until reviewed');
  manager.clear();
  ocrLeftClipped = false;
  ocrLeftPadded = true;
  ocrOverride = 'Both complete lines have room at the left edge.\nTheir content is fully visible.';
  const beforePaddedLeft = providerCalls;
  await manager.capture();
  const paddedLeft = cards()[0];
  await until(phaseIs(paddedLeft, 'done'), 'complete prose near the left edge');
  assert.equal(providerCalls, beforePaddedLeft + 1, 'white pixels at the left edge overrule a near-edge OCR box');
  manager.clear();
  ocrLeftPadded = false;
  ocrRightPadded = true;
  ocrOverride = 'Both complete lines have room at the right edge.\nTheir content is fully visible.';
  const beforePaddedRight = providerCalls;
  await manager.capture();
  const paddedRight = cards()[0];
  await until(phaseIs(paddedRight, 'done'), 'complete prose near the right edge');
  assert.equal(providerCalls, beforePaddedRight + 1, 'white pixels at the right edge overrule a near-edge OCR box');
  manager.clear();
  ocrRightPadded = false;
  ocrTopClipped = true;
  ocrOverride = 'A complete first line sits near the crop boundary but remains fully legible.';
  const beforeTop = providerCalls;
  await manager.capture();
  const top = cards()[0];
  await until(phaseIs(top, 'done'), 'complete prose near the top edge');
  assert.equal(providerCalls, beforeTop + 1, 'white source pixels overrule an overextended top OCR box');
  manager.clear();
  ocrTopClipped = false;
  ocrTopPadded = true;
  ocrOverride = 'We propose a complete description for each dataset. Its limits should also be recorded.';
  const beforePaddedTop = providerCalls;
  await manager.capture();
  const paddedTop = cards()[0];
  await until(phaseIs(paddedTop, 'done'), 'complete prose with a small top margin');
  assert.equal(providerCalls, beforePaddedTop + 1, 'complete first line with a small margin should continue');
  manager.clear();
  ocrTopPadded = false;
  imageTopCut = true;
  ocrOverride = 'In the electronics industry, a component has a datasheet describing its limits.';
  const beforePixelCut = providerCalls;
  await manager.capture();
  const pixelCut = cards()[0];
  await until(phaseIs(pixelCut, 'review'), 'source line cut off before OCR');
  assert.match((await stateOf(pixelCut)).notice, /顶部可能截断/);
  assert.equal(providerCalls, beforePixelCut, 'pixels crossing the top edge must pause before translation');
  manager.clear();
  imageTopCut = false;
  imageDenseTopCut = true;
  ocrOverride = 'The source line is dense enough that OCR may miss its cut glyphs.';
  const beforeDenseTop = providerCalls;
  await manager.capture();
  const denseTop = cards()[0];
  await until(phaseIs(denseTop, 'review'), 'dense printed line cut by the selection top');
  assert.match((await stateOf(denseTop)).notice, /顶部可能截断/);
  assert.equal(providerCalls, beforeDenseTop, 'a dense edge must stay local even when OCR reports a complete sentence');
  manager.clear();
  imageDenseTopCut = false;
  imageBottomCut = true;
  ocrOverride = 'The OCR ends with a complete sentence while source glyphs are cut below it.';
  const beforePixelBottom = providerCalls;
  await manager.capture();
  const pixelBottom = cards()[0];
  await until(phaseIs(pixelBottom, 'review'), 'source line cut off below the OCR');
  assert.match((await stateOf(pixelBottom)).notice, /底部可能截断/);
  assert.equal(providerCalls, beforePixelBottom, 'bottom-edge source ink must pause before translation');
  manager.clear();
  imageBottomCut = false;
  ocrBottomClipped = true;
  ocrOverride = 'We want to differentiate and optimize the lower bound with respect to both the variational';
  const beforeBottom = providerCalls;
  await manager.capture();
  const bottom = cards()[0];
  await until(phaseIs(bottom, 'review'), 'bottom-edge cropped prose review');
  assert.match((await stateOf(bottom)).notice, /底部可能截断/);
  assert.equal(providerCalls, beforeBottom, 'bottom-edge cropped prose must stay local until reviewed');
  manager.clear();
  ocrBottomClipped = false;
  ocrBottomShortBlock = true;
  ocrOverride = 'the final hidden vector for the token as $T_i \\in \\mathbb{R}^H$';
  const beforeShortBottom = providerCalls;
  await manager.capture();
  const shortBottom = cards()[0];
  await until(phaseIs(shortBottom, 'review'), 'short edge line after math must trigger review');
  assert.match((await stateOf(shortBottom)).notice, /底部可能截断/);
  assert.equal(providerCalls, beforeShortBottom);
  manager.clear();
  ocrBottomShortBlock = false;
  ocrOverride = 'The first token is [CLS]. The separator is [SEP 1 in the OCR text.';
  const beforeBrokenBrackets = providerCalls;
  await manager.capture();
  const brokenBrackets = cards()[0];
  await until(phaseIs(brokenBrackets, 'review'), 'broken special-token bracket must trigger review');
  assert.match((await stateOf(brokenBrackets)).notice, /方括号可能漏识别/);
  assert.equal(providerCalls, beforeBrokenBrackets);
  manager.clear();
  ocrOverride = 'The span of {1,x) is unchanged after removing 2x.';
  const beforeBrokenBraces = providerCalls;
  await manager.capture();
  const brokenBraces = cards()[0];
  await until(phaseIs(brokenBraces, 'review'), 'broken set braces must trigger review');
  assert.match((await stateOf(brokenBraces)).notice, /花括号可能漏识别/);
  assert.equal(providerCalls, beforeBrokenBraces);
  manager.clear();
  ocrOverride = 'The axioms are $v+w$, $w+v$, $rv$, $r(w+v)$, $(r+s)v$, $r(sv)$, $0+v$, and $v+(-v)$.';
  formulaOcrOverride = { status: 'done', count: 8, uncertain: 5, uncertainStarts: [] };
  const beforeDense = providerCalls;
  await manager.capture();
  const dense = cards()[0];
  await until(phaseIs(dense, 'review'), 'dense formula capture must wait for review');
  assert.match((await stateOf(dense)).formulaNotice, /滚到屏幕中部、四周留白.*重新框选一两条公式/);
  assert.equal(providerCalls, beforeDense);
  manager.clear();
  formulaOcrOverride = null;
  ocrOverride = 'Two tosses give outcomes where "h" denotes "heads" and "" denotes "tails".';
  const beforeMissingQuote = providerCalls;
  await manager.capture();
  const missingQuote = cards()[0];
  await until(phaseIs(missingQuote, 'review'), 'missing quoted character review');
  assert.match((await stateOf(missingQuote)).notice, /引号之间可能漏识别/);
  assert.equal(providerCalls, beforeMissingQuote, 'an empty OCR quote must be checked before translation');
  manager.clear();
  ocrOverride = 'AI models are used in high-stakes Al applications.';
  const beforeAmbiguousAi = providerCalls;
  await manager.capture();
  const ambiguousAi = cards()[0];
  await until(phaseIs(ambiguousAi, 'review'), 'AI/Al glyph ambiguity review');
  assert.match((await stateOf(ambiguousAi)).notice, /AI 和 Al.*核对/);
  assert.equal(providerCalls, beforeAmbiguousAi, 'ambiguous acronym glyphs must stay local until reviewed');
  manager.clear();
  ocrOverride = 'The next section describes the results.';
  const beforePlain = providerCalls;
  await manager.capture();
  const plain = cards()[0];
  await until(phaseIs(plain, 'done'), 'translation without automatic suggestions');
  assert.equal(providerCalls, beforePlain + 1, 'empty suggestions must not trigger more provider calls');
  assert.deepEqual((await stateOf(plain)).segments[0].terms, []);
  assert(await plain.webContents.executeJavaScript('document.querySelectorAll(".term-chip").length === 0 && [...document.querySelectorAll(".term-list")].every(node => node.hidden)'), 'empty suggestions must hide the entire term row');
  const plainState = await stateOf(plain);
  const start = ocrOverride.indexOf('results');
  await action(plain, 'lookup', { revision: plainState.revision, segmentId: plainState.segments[0].id, start, end: start + 'results'.length });
  await until(async () => (await stateOf(plain)).lookupStatus === 'done', 'manual lookup without suggestions');
  assert.equal((await stateOf(plain)).lookup.quote, 'results');
  assert.equal(providerCalls, beforePlain + 2, 'only manual selection should request an explanation');
  manager.clear();
  console.log('ok - no automatic terms leaves a clean translation and preserves manual lookup');
  noTerms = false;
  holdReview = true;
  manager.openText(english);
  const reviewing = cards()[0];
  await until(() => Boolean(resolveReview), 'held concept review');
  const early = await stateOf(reviewing);
  assert.equal(early.translation, chinese, 'a pending recommendation review must not delay the translation');
  assert.equal(early.segments[0].termsStatus, 'reviewing');
  assert.deepEqual(early.segments[0].terms, []);
  copied = '';
  assert(await reviewing.webContents.executeJavaScript('!document.getElementById("copy").disabled'));
  await action(reviewing, 'copy');
  assert.equal(copied, chinese, 'a complete translation can be copied while optional suggestions are pending');
  assert(await reviewing.webContents.executeJavaScript('document.querySelector(".translation-paragraph").textContent.length > 0'));
  await action(reviewing, 'lookup', { revision: early.revision, segmentId: 0, start: 0, end: 'Correlation'.length });
  assert.equal((await stateOf(reviewing)).lookupStatus, 'done', 'manual lookup remains usable while suggestions are being reviewed');
  resolveReview('not a valid review');
  await until(phaseIs(reviewing, 'done'), 'review failure still completes translation');
  assert.equal((await stateOf(reviewing)).translation, chinese);
  assert(await reviewing.webContents.executeJavaScript('!document.querySelector(".terms-notice").hidden'));
  manager.clear();
  resolveReview = null;
  manager.openText(english);
  const abandonedReview = cards()[0];
  await until(() => Boolean(resolveReview), 'second concept review');
  const finishAbandoned = resolveReview;
  void action(abandonedReview, 'close').catch(() => {});
  await until(() => abandonedReview.isDestroyed(), 'close during concept review');
  assert(reviewSignal.aborted);
  finishAbandoned('{"keep":[0]}');
  await pause(60);
  assert.equal(cards().length, 0, 'a late review cannot reopen a closed pin');
  console.log('ok - translation arrives before term review; review failure and cancellation preserve reading behavior');
  assert(!fs.readdirSync(work).some((file) => /^capture-.*\.png$/.test(file)), 'temporary captures must be removed');
  console.log('Reading cards native checks passed: real Apple Vision OCR, rendered local source, independent cards, resize/move/pin, low-confidence gate, provider retry, cancellation, late-result suppression, settings changes, sandbox and close cleanup. Translation responses were deterministic fixtures; native screen selection and live translation were not exercised by this test.');
  manager.dispose();
  mainWindow.destroy();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  manager?.dispose();
  app.exit(1);
});
app.on('window-all-closed', () => {});
app.on('will-quit', () => fs.rmSync(work, { recursive: true, force: true }));
