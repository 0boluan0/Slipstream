'use strict';

// Real storage and renderer, isolated authored input and a fixed provider.
// Every window remains hidden; this is not desktop acceptance evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createTermCardStore } = require('../src/main/term-card-store');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-saved-lookup-'));
app.setPath('userData', path.join(work, 'profile'));
app.on('window-all-closed', () => {});
let manager;
setTimeout(() => { console.error('Saved-card lookup exceeded 20 seconds'); app.exit(1); }, 20000).unref();
const js = (window, code) => window.webContents.executeJavaScript(code);
const state = (window) => js(window, 'window.readingPin.act("ready").then(result => result.state)');
async function until(predicate) {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Saved-card state did not settle');
}
app.whenReady().then(async () => {
  app.dock?.hide();
  function OffscreenWindow(options) {
    const window = new BrowserWindow({ ...options, show: false });
    window.show = window.showInactive = window.focus = () => {};
    return window;
  }
  const store = createTermCardStore(path.join(work, 'cards'));
  const source = 'The evidence is the marginal density of these observations.';
  const initial = await store.save({ term: 'evidence', label: '证据', meaning: '待读者修改的旧解释。',
    context: '', source, kind: 'concept' });
  const correction = '这里的 evidence 是观测数据的边缘密度，不是连续观测恰好取该值的概率。';
  let saved = await store.edit(initial.card.id, { ...initial.card, meaning: correction, notes: '已核对原文，保留我的笔记。' }, initial.card.revision);
  let lookupCalls = 0, opened, failRead = false, holdRead = false, releaseRead;
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen,
    getMainWindow: () => null, captureSupported: false,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' }),
    findTermCard: async (input) => {
      if (failRead) throw new Error('Fixture local read failed');
      if (holdRead) return new Promise((resolve) => { releaseRead = () => resolve(saved); });
      return store.findMatching(input);
    },
    saveTermCard: (input) => store.save(input), onOpenLibrary: (id) => { opened = id; },
    processReadingText: async ({ text, kind, selection }) => {
      if (kind === 'lookup') { lookupCalls++; return { lookup: { quote: selection, meaning: '本次模型生成的解释。', note: '', contextual: true } }; }
      const start = text.indexOf('evidence');
      return { translation: '这一段的译文。', terms: [{ quote: 'evidence', label: '证据', start, end: start + 8 }] };
    },
  });
  async function open(text) {
    manager.clear(); manager.openText(text);
    const window = BrowserWindow.getAllWindows()[0];
    await until(async () => (await state(window)).phase === 'done');
    return window;
  }
  async function lookup(window) {
    await js(window, 'document.querySelector(".term-chip").click()');
    await until(async () => (await state(window)).lookupStatus === 'done');
    return state(window);
  }
  let window = await open(source);
  let current = await lookup(window);
  assert.equal(current.lookup.meaning, correction, 'the reader-corrected card must be reused for exactly the same source');
  assert.equal(lookupCalls, 0, 'a saved explanation needs no provider request');
  assert.equal(await js(window, 'document.getElementById("lookup-title").textContent'), '已存卡片 · 本地解释');
  assert.equal(await js(window, 'document.getElementById("save-term").textContent'), '打开卡片');
  await js(window, 'document.getElementById("save-term").click()');
  await until(() => opened === saved.id);
  saved = await store.edit(saved.id, { ...saved, meaning: '再次修正后的本地解释。' }, saved.revision);
  await js(window, 'document.getElementById("lookup-close").click()');
  assert.equal((await lookup(window)).lookup.meaning, saved.meaning, 'an edit after lookup must supersede the in-memory explanation');
  window = await open('The evidence in this second context has another meaning.');
  current = await lookup(window);
  assert.equal(current.lookup.meaning, '本次模型生成的解释。', 'the same term in another source must not inherit an old context');
  assert.equal(lookupCalls, 1);
  assert(!current.lookup.localCard);
  failRead = true;
  window = await open(source);
  current = await lookup(window);
  assert.equal(lookupCalls, 2);
  assert.match(current.lookupNotice, /本地卡片.*未能读取/);
  assert(!current.lookup.localCard, 'read failure must not label model output as a local card');
  failRead = false; holdRead = true;
  window = await open(source);
  await js(window, 'document.querySelector(".term-chip").click()');
  await until(() => Boolean(releaseRead));
  await js(window, 'document.getElementById("lookup-close").click()');
  releaseRead();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await state(window)).lookup, null, 'a late disk result must not reopen a dismissed explanation');
  assert.equal(lookupCalls, 2, 'a cancelled disk lookup must not fall through to the provider');
  const finalCards = (await store.list()).cards;
  assert.equal(finalCards.length, 1);
  assert.equal(finalCards[0].notes, '已核对原文，保留我的笔记。');
  assert.equal(finalCards[0].source, source);
  assert(BrowserWindow.getAllWindows().every((item) => !item.isVisible()));
  console.log('Saved-card lookup passed: corrected meaning, no provider request, fresh edit, exact source, read-failure notice, cancellation and preserved notes; no visible windows.');
  manager.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch((error) => { console.error(error); manager?.dispose(); app.exit(1); });
