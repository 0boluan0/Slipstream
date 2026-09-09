'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
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
  const mainWindow = new BrowserWindow({ width: 400, height: 300, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await mainWindow.loadURL('about:blank');
  mainWindow.showInactive();
  let low = false;
  let fail = false;
  let cancel = false;
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
  const provider = createReadingProcessor(async (...args) => {
    providerCalls += 1;
    if (held) {
      heldSignal = args[7];
      return new Promise((resolve) => { resolveHeld = resolve; });
    }
    if (fail) throw new Error('fixture-provider-failure');
    if (failMatching && args[6].includes(failMatching)) throw new Error('fixture-paragraph-failure');
    const input = JSON.parse(args[4]);
    if (input.selection) return JSON.stringify({ quote: input.selection,
      meaning: input.selection === 'causation'
        ? '因果关系意味着改变一个因素，会引起另一个因素的变化。仅仅观察到两者一起变化，还不足以说明存在这种关系。'
        : '相关关系描述两个变量在统计上一起变化的程度；它本身不能说明一个变量导致了另一个变量。',
      note: '这段提到共同原因：两个变量可以受到同一个因素影响，因此一起变化，却没有直接的因果关系。' });
    if (args[3].includes('"translation"')) return JSON.stringify({ translation: chinese,
      terms: noTerms ? [] : [{ quote: 'Correlation', label: '相关关系' }, { quote: 'causation', label: '因果关系' }] });
    return args[8] ? JSON.stringify({ terms: [{ quote: 'Correlation', explanation: '指变量一起变化的统计关系；这里没有据此断定因果。' }], sentences: [] }) : chinese;
  });
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    copyText: (text) => { copied = text; },
    saveTermCard: (input) => termStore.save(input),
    getSettings: () => settings, getMainWindow: () => mainWindow,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => {
      assert(cards().every((window) => !window.isVisible()), 'existing cards must be hidden while selecting');
      assert(!mainWindow.isVisible(), 'main workspace must be hidden while selecting');
      if (cancel) { const error = new Error('cancel'); error.isCancellation = true; throw error; }
      const file = path.join(work, `capture-${++selectionCount}.png`);
      fs.copyFileSync(fixture, file);
      return file;
    },
    performOCR: async (file, options) => {
      if (ocrOverride) return { text: ocrOverride, confidence: .99, blocks: [{ text: ocrOverride, confidence: .99 }] };
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
  assert.equal(providerCalls, 1);
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
  await first.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  await until(async () => (await stateOf(first)).lookupStatus === 'done', 'one-click concept explanation');
  assert.equal((await stateOf(first)).lookup.quote, 'Correlation');
  assert.match((await stateOf(first)).lookup.meaning, /一起变化/);
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
