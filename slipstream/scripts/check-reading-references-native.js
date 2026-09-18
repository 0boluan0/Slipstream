'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { createReadingProcessor } = require('../src/main/reading-service');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reference-native-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = outputArg ? path.resolve(outputArg.slice('--output='.length)) : null;
const preview = process.argv.includes('--preview');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await predicate()) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
const js = (window, code) => window.webContents.executeJavaScript(code);
const snapshot = (window) => js(window, 'window.readingPin.act("ready").then(r => r.state)');
const act = (window, action, payload) => js(window, `window.readingPin.act(${JSON.stringify(action)}, ${JSON.stringify(payload) || 'undefined'})`);
const windows = (title) => BrowserWindow.getAllWindows().filter((window) => window.getTitle() === title);
const referenceWindow = () => windows('Slipstream · 本文速查').at(-1);
const source = 'Let $x_i$ denote the feature vector of sample i. Let $\\lambda$ denote the regularization strength.';
const usage = 'We minimize $$L(\\theta) = \\sum_i \\ell(f_\\theta(x_i), y_i) + \\lambda R(\\theta).$$ The quantity $q$ is used below.';
const conflictingSource = 'In this section, let $\\lambda$ denote an eigenvalue.';
const definitions = [
  { symbol: 'x_i', meaning: '第 i 个样本的特征向量。', evidence: source.split('. ')[0] + '.' },
  { symbol: '\\lambda', meaning: '正则化项的权重，用来控制正则化强度。', evidence: source.split('. ')[1] },
];
const store = createReadingReferenceStore(path.join(work, 'references'));
let manager;
let providerCalls = 0;
let copied = '';
let savedConcepts = 0;
let settings = { setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' };
const errors = [];
const provider = createReadingProcessor(async (...args) => {
  providerCalls += 1;
  const input = JSON.parse(args[4]);
  if (input.selection) return JSON.stringify({ quote: input.selection, meaning: '普通术语解释。', note: '' });
  return JSON.stringify({ translation: input.excerpt === source
    ? '令 $x_i$ 表示第 i 个样本的特征向量。令 $\\lambda$ 表示正则化强度。'
    : '我们最小化以下目标函数：\n$$L(\\theta) = \\sum_i \\ell(f_\\theta(x_i), y_i) + \\lambda R(\\theta).$$\n下文使用量 $q$。',
  terms: [], references: input.excerpt === source ? definitions : input.excerpt === conflictingSource
    ? [{ symbol: '\\lambda', meaning: '本节中的特征值。', evidence: conflictingSource }] : [] });
});
function createManager() {
  return createReadingPins({ BrowserWindow, ipcMain, screen, referenceStore: store,
    getSettings: () => settings, getMainWindow: () => null, processReadingText: provider,
    saveTermCard: async () => { savedConcepts += 1; return { card: { id: 'fixture' } }; },
    copyText: (value) => { copied = value; }, onError: (message) => errors.push(message), captureSupported: false });
}
async function openText(text) {
  const existing = new Set(windows('Slipstream · 阅读卡片'));
  assert(manager.openText(text).success);
  const window = windows('Slipstream · 阅读卡片').find((item) => !existing.has(item));
  await until(async () => (await snapshot(window)).phase === 'done', 'translation');
  return window;
}
async function lookup(window, quote) {
  const state = await snapshot(window);
  const segment = state.segments.find((item) => item.source.includes(quote));
  const start = segment.source.indexOf(quote);
  await act(window, 'lookup', { revision: state.revision, segmentId: segment.id, start, end: start + quote.length });
  return (await snapshot(window)).lookup;
}
async function screenshot(window, name) {
  if (!output) return;
  await js(window, 'document.fonts.ready');
  await pause(100);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
}
if (!preview) setTimeout(() => { console.error('Reference runtime check timed out.'); app.exit(1); }, 90000).unref();

app.whenReady().then(async () => {
  manager = createManager();
  await manager.openReferences();
  let reference = referenceWindow();
  await until(async () => (await snapshot(reference)).referenceOnly, 'reference window');
  await js(reference, 'document.getElementById("paper-create").click()');
  await until(async () => (await snapshot(reference)).paperId, 'new paper');
  const paperA = (await snapshot(reference)).paperId;
  await js(reference, 'document.getElementById("paper-title").value = "正则化 · 阅读速查"; document.getElementById("paper-rename").click()');
  await until(async () => (await snapshot(reference)).references.paper.title === '正则化 · 阅读速查', 'paper rename');
  const definitionPin = await openText(source);
  assert.equal((await snapshot(definitionPin)).paperId, paperA);
  await until(async () => (await snapshot(reference)).references.candidates.length === 2, 'definition candidates');
  assert.equal((await store.read()).papers[0].entries.length, 0, 'suggestions are not saved automatically');
  await screenshot(reference, '01-definition-candidates.png');
  await js(reference, 'document.getElementById("reference-accept-all").click()');
  await until(async () => (await snapshot(reference)).references.paper.entries.length === 2, 'one-click retain definitions');
  console.log('ok - create paper, propose definitions and explicitly retain them');
  assert.equal(savedConcepts, 0, 'paper definitions do not pollute the concept library');
  definitionPin.close();
  const reading = await openText(usage);
  const calls = providerCalls;
  const local = await lookup(reading, '\\lambda');
  assert(local.reference && local.meaning.includes('正则化'));
  assert.equal(providerCalls, calls, 'saved definitions are retrieved locally without an LLM request');
  assert.equal(await js(reading, 'document.querySelectorAll(".reference-hit-list button").length'), 2);
  const unknown = await lookup(reading, 'q');
  assert(unknown.reference && unknown.definitions.length === 0);
  assert.equal(providerCalls, calls, 'unknown symbols are not guessed by a provider');
  assert(await js(reading, 'document.getElementById("lookup-references").textContent.includes("尚未留下")'));
  await lookup(reading, '\\lambda');
  const entry = (await snapshot(reference)).references.paper.entries.find((item) => item.symbol === '\\lambda');
  await act(reference, 'reference-copy', { paperId: paperA, id: entry.id });
  assert(copied.includes('\\lambda'));
  assert.equal(savedConcepts, 0);
  reading.setSize(460, 700);
  reference.setSize(430, 650);
  await screenshot(reading, '02-local-definition.png');
  await screenshot(reference, '03-paper-reference.png');
  console.log('ok - local retrieval, exact symbols, missing definition and LaTeX copy');
  const conflictingPin = await openText(conflictingSource);
  const pending = await lookup(conflictingPin, '\\lambda');
  assert.equal(pending.definitions.length, 2, 'a newly captured definition must not silently inherit an older meaning');
  assert(pending.definitions[0].pending);
  conflictingPin.close();

  // Edit through actual form controls; a subsequent capture must see the correction.
  await js(reference, `document.querySelector('[data-reference-id="${entry.id}"] .reference-actions button').click()`);
  await js(reference, 'document.getElementById("reference-meaning").value = "正则化权重，已结合本篇原文核对。"; document.getElementById("reference-editor").requestSubmit()');
  await until(async () => (await snapshot(reference)).references.paper.entries.some((item) => item.meaning.includes('已结合')), 'edit definition');
  assert((await lookup(reading, '\\lambda')).meaning.includes('已结合'));
  await act(reference, 'reference-save', { paperId: paperA,
    entry: { symbol: 'λ', meaning: '附录中表示另一个标量。', scope: '附录', evidence: '', source: '', origin: 'manual' } });
  assert.equal((await lookup(reading, '\\lambda')).definitions.length, 2, 'conflicting definitions remain visible');
  assert(await js(reading, 'document.getElementById("lookup-references").textContent.includes("多处定义")'));
  assert.equal((await snapshot(reference)).references.paper.entries.filter((item) => item.sameSymbolCount === 2).length, 2);
  console.log('ok - edit and retain conflicting definitions');

  await act(reference, 'paper-create', { title: '论文 B' });
  const paperB = (await snapshot(reference)).paperId;
  await act(reference, 'reference-save', { paperId: paperB,
    entry: { symbol: '\\lambda', meaning: '本文的特征值。', scope: '', evidence: '', source: '', origin: 'manual' } });
  assert.equal((await snapshot(reading)).paperId, paperA, 'changing the active paper cannot relabel existing captures');
  const readingB = await openText(usage);
  assert.equal((await lookup(readingB, '\\lambda')).meaning, '本文的特征值。');
  assert.equal((await lookup(reading, '\\lambda')).definitions.length, 2);
  await js(reference, 'document.getElementById("reference-search").value = "λ"; document.getElementById("reference-search").dispatchEvent(new Event("input"))');
  assert.equal(await js(reference, 'document.querySelectorAll("#reference-entries .reference-entry").length'), 1, 'Unicode search finds a LaTeX symbol');
  assert.equal(await act(reference, 'reference-save', { paperId: paperA, entry: {} }), false, 'stale-paper writes must be rejected');

  for (const window of [readingB, reference]) {
    window.setSize(280, 440);
    window.webContents.setZoomFactor(2);
    await pause(80);
    assert(await js(window, 'document.documentElement.scrollWidth <= innerWidth'), '200% narrow layout must not overflow');
    window.webContents.setZoomFactor(1);
  }
  manager.dispose();
  console.log('ok - cross-paper isolation and narrow layout; recreating the reading manager');
  manager = createManager();
  await manager.openReferences();
  reference = referenceWindow();
  await until(async () => (await snapshot(reference)).references.paper?.id === paperB, 'resume active paper from disk');
  assert.equal((await snapshot(reference)).references.paper.entries[0].meaning, '本文的特征值。');
  await act(reference, 'paper-remove', { paperId: paperB, confirm: true });
  assert.equal((await snapshot(reference)).paperId, null);
  await act(reference, 'paper-undo');
  assert.equal((await snapshot(reference)).paperId, paperB);
  await act(reference, 'paper-select', { paperId: paperA });
  settings = { ...settings, activeBackend: 'free_translate', setupMode: 'translation-only' };
  manager.invalidateProcessing();
  const resumed = await openText(usage);
  const before = providerCalls;
  assert.equal((await lookup(resumed, '\\lambda')).definitions.length, 2, 'saved references work in basic translation mode too');
  assert.equal(providerCalls, before);
  assert.deepEqual(errors, []);
  console.log('Native references passed: create, automatic proposals, explicit save, local lookup, unknown symbols, editing, conflicts, paper isolation, restart, deletion undo and 200% layout.');
  if (preview) {
    reference.setSize(430, 650);
    resumed.setSize(460, 700);
    console.log('Interactive preview uses authored material and deterministic provider responses.');
    return;
  }
  manager.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  manager?.dispose();
  app.exit(1);
});
