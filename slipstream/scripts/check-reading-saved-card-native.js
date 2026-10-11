'use strict';

// Real storage and renderer, isolated authored input and a fixed provider.
// Every window remains hidden; this is not desktop acceptance evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
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
  let lookupCalls = 0, opened, failRead = false, holdRead = false, releaseRead, lookupProcessor;
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen,
    getMainWindow: () => null, captureSupported: false,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' }),
    findTermCard: async (input) => {
      if (failRead) throw new Error('Fixture local read failed');
      if (holdRead) return new Promise((resolve) => { releaseRead = () => resolve(saved); });
      return store.findMatching(input);
    },
    saveTermCard: (input) => store.save(input), onOpenLibrary: (id) => { opened = id; },
    processReadingText: async options => {
      const { text, kind, selection } = options;
      if (kind === 'lookup') {
        lookupCalls++;
        return lookupProcessor ? lookupProcessor(options)
          : { lookup: { quote: selection, meaning: '本次模型生成的解释。', note: '', contextual: true } };
      }
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
  // A source ending mid-sentence still yields a concept, while old translation cards remain untouched.
  holdRead = false;
  const incompleteSource = 'The evidence depends on';
  const oldTranslation = await store.save({ term: 'evidence', label: '证据', meaning: '旧基础翻译。',
    context: '', source: incompleteSource, kind: 'translation' });
  const retained = await store.edit(oldTranslation.card.id,
    { ...oldTranslation.card, notes: '旧卡笔记保留。', links: [saved.id] }, oldTranslation.card.revision);
  const oldFile = await store.filePath(retained.id), oldBytes = fs.readFileSync(oldFile);
  lookupProcessor = createReadingProcessor(async () => JSON.stringify({ quote: 'evidence',
    meaning: '支持判断的信息。', note: '', basis: 'general', sourceQuote: '', kind: 'translation' }));
  window = await open(incompleteSource);
  current = await lookup(window);
  assert.equal(current.lookup.kind, 'concept');
  assert.equal(current.lookup.contextual, false, 'the existing incomplete-context warning remains independent of type');
  assert.match(current.lookup.note, /下一行/u);
  assert.equal(await js(window, 'document.getElementById("lookup-title").textContent'), '术语与词句解释');
  assert.equal(await js(window, 'document.getElementById("lookup-basis").hidden'), false);
  assert.equal(await js(window, 'document.getElementById("meaning-label").hidden'), false);
  assert.equal(await js(window, 'document.getElementById("lookup-settings").hidden'), true);
  await js(window, 'document.getElementById("save-term").click()');
  await until(async () => (await state(window)).saveStatus === 'saved');
  const concept = await store.findMatching({ term: 'evidence', source: incompleteSource, kind: 'concept' });
  assert(concept && concept.id !== retained.id, 'a new concept does not overwrite a same-source translation');
  assert.equal(concept.source, incompleteSource);
  assert.equal(concept.context, current.lookup.note);
  const beforeReopen = lookupCalls;
  window = await open(incompleteSource);
  current = await lookup(window);
  assert.equal(current.lookup.kind, 'concept');
  assert.equal(current.savedCardId, concept.id);
  assert.equal(lookupCalls, beforeReopen, 'the saved incomplete-context concept is reused without another lookup');
  assert.equal(await js(window, 'document.getElementById("lookup-title").textContent'), '已存卡片 · 本地解释');
  assert.deepEqual(fs.readFileSync(oldFile), oldBytes, 'old translation bytes, id, notes and links are never migrated');
  const repeatedSource = 'The evidence supports a legal claim.\n\nIn this model the evidence is a marginal density.';
  const oldUnscoped = (await store.save({ term: 'evidence', label: '', meaning: '旧卡没有记录具体位置。',
    context: '', source: repeatedSource, kind: 'concept' })).card;
  const unscopedFile = await store.filePath(oldUnscoped.id), unscopedBytes = fs.readFileSync(unscopedFile);
  const occurrenceRequests = [];
  lookupProcessor = createReadingProcessor(async (...args) => {
    const message = JSON.parse(args[4]); occurrenceRequests.push(message.selectedOccurrence);
    return JSON.stringify({ quote: 'evidence', meaning: message.selectedOccurrence.start === repeatedSource.indexOf('evidence')
      ? '支持法律主张的信息。' : '此模型中观测数据的边缘密度。', note: '', basis: 'general', sourceQuote: '',
    selectionRange: { start: 0, end: 1 } });
  });
  async function occurrenceLookup(reader, segmentId) {
    const currentState = await state(reader), segment = currentState.segments[segmentId];
    await js(reader, `window.readingPin.act('lookup', ${JSON.stringify({ revision: currentState.revision,
      segmentId, start: segment.source.indexOf('evidence'), end: segment.source.indexOf('evidence') + 8 })})`);
    return state(reader);
  }
  window = await open(repeatedSource);
  current = await occurrenceLookup(window, 0);
  assert.equal(current.lookup.meaning, '支持法律主张的信息。', 'an old unscoped repeated term is not silently reused');
  await js(window, 'window.readingPin.act("save-term")');
  const firstOccurrenceId = (await state(window)).savedCardId;
  current = await occurrenceLookup(window, 1);
  assert.equal(current.lookup.meaning, '此模型中观测数据的边缘密度。');
  assert(!current.lookup.localCard, 'another occurrence must not inherit the first saved explanation');
  assert.equal(occurrenceRequests.length, 2);
  assert.deepEqual(occurrenceRequests.map(({ start, end }) => ({ start, end })),
    [repeatedSource.indexOf('evidence'), repeatedSource.lastIndexOf('evidence')].map(start => ({ start, end: start + 8 })));
  await js(window, 'window.readingPin.act("save-term")');
  const secondOccurrenceId = (await state(window)).savedCardId;
  assert.notEqual(secondOccurrenceId, firstOccurrenceId);
  window = await open(repeatedSource);
  assert.equal((await occurrenceLookup(window, 0)).savedCardId, firstOccurrenceId);
  assert.equal((await occurrenceLookup(window, 1)).savedCardId, secondOccurrenceId);
  assert.equal(occurrenceRequests.length, 2, 'reopening either exact occurrence reuses its own card');
  assert.deepEqual(fs.readFileSync(unscopedFile), unscopedBytes);
  const identicalSource = 'The evidence is uncertain.\n\nThe evidence is uncertain.';
  window = await open(identicalSource);
  current = await occurrenceLookup(window, 1);
  assert.equal(current.lookup.selectionRange.start, identicalSource.lastIndexOf('evidence'),
    'two identical source segments must still resolve to different global positions');
  assert(BrowserWindow.getAllWindows().every((item) => !item.isVisible()));
  console.log('Saved-card lookup passed: corrected meaning, no provider request, fresh edit, exact source, read-failure notice, cancellation and preserved notes; no visible windows.');
  manager.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch((error) => { console.error(error); manager?.dispose(); app.exit(1); });
