'use strict';

// Regression checks for the 2026-09-18 real-paper audit. Provider output here is
// deterministic; this checks interactions, not translation or OCR quality.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { createReadingProcessor } = require('../src/main/reading-service');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-usability-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (window, code) => window.webContents.executeJavaScript(code);
const snapshot = (window) => js(window, 'window.readingPin.act("ready").then(r => r.state)');
async function until(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await pause(30); }
  throw new Error(`Timed out: ${label}`);
}
let manager;
const failures = [];
async function check(label, test) {
  try { await test(); console.log(`ok - ${label}`); }
  catch (error) { failures.push(label); console.error(`FAIL - ${label}: ${error.message}`); }
}
setTimeout(() => { console.error('Usability check timed out.'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  const store = createReadingReferenceStore(path.join(work, 'references'));
  const paper = await store.create('Adam · regression');
  const provider = createReadingProcessor(async (...args) => {
    const input = JSON.parse(args[4]);
    if (input.excerpt === 'A field in algebra.' || input.excerpt === 'A field in physics.') return JSON.stringify({ translation: '当前段落的概念。', terms: [{ quote: 'field', label: input.excerpt.includes('algebra') ? '域' : '场', role: 'core' }], references: [] });
    if (input.selection) return JSON.stringify({ quote: input.selection, meaning: input.selection === 'nuisance parameter' ? '相对于目标参数，需要估计的其他参数。' : '这是与原文相关的概念解释，用于检验长解释的滚动与空间。'.repeat(14), note: input.selection === 'nuisance parameter' ? '' : '这里说明这个概念如何出现在当前段落。' });
    return JSON.stringify({ translation: input.excerpt.startsWith('A collider') ? '碰撞变量同时受到两个变量的影响。对它进行条件化可能引入选择偏倚。' : '样本量为 $N$，误差量级为 $1/\\sqrt{N}$。'.repeat(20),
      terms: input.excerpt.includes('root-N consistency') ? [{quote:'root-N consistency', label:'$\\sqrt{N}$ 一致性', role: 'core'}] : [],
      references: input.excerpt.includes('epsilon') ? [{ symbol: 'epsilon', meaning: '稳定常数。', evidence: 'Let epsilon denote a stability constant.' }] : [] });
  });
  manager = createReadingPins({ BrowserWindow, ipcMain, screen, referenceStore: store,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' }),
    getMainWindow: () => null, processReadingText: provider, captureSupported: false });
  // Give a real existing window focus, as when the reader presses 本文速查.
  manager.openText('Let epsilon denote a stability constant. We discuss root-N consistency.');
  const reading = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Slipstream · 阅读卡片');
  await until(async () => (await snapshot(reading)).phase === 'done', 'candidate card');
  await check('term buttons render mathematical labels', async () => assert(await js(reading, 'Boolean(document.querySelector(".term-chip .katex"))')));
  manager.openText('We discuss root-N consistency.\n\nWe discuss root-N consistency in a second paragraph.');
  const repeated = BrowserWindow.getAllWindows().find((window) => window !== reading);
  await until(async () => (await snapshot(repeated)).phase === 'done', 'repeated concept');
  await check('the same concept appears only once across paragraphs of one card', async () => {
    assert.equal(await js(repeated, 'document.querySelectorAll(".term-chip").length'), 1);
    assert.equal((await snapshot(repeated)).segments.length, 2, 'deduplication must preserve both original paragraphs');
  });
  repeated.close();
  manager.openText('A field in algebra.\n\nA field in physics.');
  const meanings = BrowserWindow.getAllWindows().find((window) => window !== reading);
  await until(async () => (await snapshot(meanings)).phase === 'done', 'different senses of one word');
  await check('different Chinese concept names keep separate buttons for the same English word', async () => {
    assert.equal(await js(meanings, 'document.querySelectorAll(".term-chip").length'), 2);
  });
  meanings.close();
  reading.show();
  reading.focus();
  await manager.openReferences(paper.id);
  const reference = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Slipstream · 本文速查');
  await until(async () => (await snapshot(reference)).referenceOnly && reference.isVisible(), 'reference visible');
  await pause(150);
  await check('first explicit open focuses the reference window', () => assert(reference.isFocused()));
  assert(await js(reference, `window.readingPin.act('reference-save', {paperId: ${JSON.stringify(paper.id)}, entry: {symbol: 'β1', meaning: '一阶矩的衰减率。', origin: 'manual', scope: '', evidence: '', source: ''}})`));
  await until(async () => js(reference, 'document.querySelectorAll("#reference-entries .reference-entry").length === 1'), 'saved entry rendered');
  for (const query of ['β1', 'β₁', '\\beta_1']) {
    await js(reference, `document.getElementById('reference-search').value = ${JSON.stringify(query)}; document.getElementById('reference-search').dispatchEvent(new Event('input'))`);
    await check(`search ${query} finds saved β1`, async () => assert.equal(await js(reference, 'document.querySelectorAll("#reference-entries .reference-entry").length'), 1));
  }
  await check('unrelated pending candidates do not obscure search results', async () => assert(await js(reference, 'document.getElementById("reference-candidates").hidden')));
  await js(reference, 'document.getElementById("reference-search").value = "稳定"; document.getElementById("reference-search").dispatchEvent(new Event("input"))');
  assert(await js(reference, '!document.getElementById("reference-candidates").hidden && document.getElementById("reference-empty").hidden && document.getElementById("reference-accept-all").hidden'));
  await js(reference, 'document.getElementById("reference-search").value = ""; document.getElementById("reference-search").dispatchEvent(new Event("input"))');
  assert(await js(reference, '!document.getElementById("reference-accept-all").hidden && document.getElementById("reference-entries").getBoundingClientRect().top < document.getElementById("reference-candidates").getBoundingClientRect().top'));
  console.log('ok - matching candidates remain searchable; saved entries appear first');

  const longSource = 'nuisance parameter is defined relative to the parameter of interest. ' + 'We estimate the remaining quantities from the available observations. '.repeat(35);
  manager.openText(longSource);
  const longPin = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Slipstream · 阅读卡片' && window !== reading);
  await until(async () => (await snapshot(longPin)).phase === 'done', 'long paragraph');
  longPin.setSize(460, 540);
  await js(longPin, `document.querySelector('.segment-tools button').click();
    const paragraph = document.querySelector('.source-paragraph');
    const range = document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 18);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.getElementById('scroll-area').scrollTop = 0;`);
  await until(async () => js(longPin, '!document.getElementById("selection-bar").hidden'), 'selection action');
  await check('selected phrase action is visible without scrolling a long card', async () => {
    const bounds = await js(longPin, `(() => { const button = document.getElementById('lookup-selection');
      const r = button.getBoundingClientRect(); const footer = document.querySelector('footer').getBoundingClientRect();
      return {top:r.top, bottom:r.bottom, footer:footer.top, visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === button}; })()`);
    assert(bounds.top >= 0 && bounds.bottom <= bounds.footer && bounds.visible, JSON.stringify(bounds));
  });
  await check('selection action remains visible when zoomed to 150%', async () => {
    longPin.webContents.setZoomFactor(1.5);
    await pause(80);
    const visible = await js(longPin, `(() => { const button = document.getElementById('lookup-selection'); const r = button.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === button; })()`);
    longPin.webContents.setZoomFactor(1);
    assert(visible);
  });
  await js(longPin, 'document.getElementById("lookup-selection").click()');
  await until(async () => (await snapshot(longPin)).lookupStatus === 'done', 'manual explanation');
  assert.equal((await snapshot(longPin)).lookup.quote, 'nuisance parameter');
  console.log('ok - selection still sends the exact phrase');
  await check('short inline math has no scrollbar gutter', async () => {
    const gutter = await js(longPin, 'Math.max(...Array.from(document.querySelectorAll(".translation-paragraph .math-inline"), el => el.offsetHeight - el.clientHeight))');
    assert.equal(gutter, 0);
  });
  await check('long inline math remains horizontally scrollable', async () => {
    assert(await js(longPin, `(() => { const host = document.getElementById('lookup-meaning');
      window.renderReadingMath(host, '$' + 'x+'.repeat(100) + 'y$'); const formula = host.querySelector('.math-inline');
      formula.scrollLeft = 80; return formula.scrollWidth > formula.clientWidth && formula.scrollLeft > 0; })()`));
  });
  manager.openText('A collider is influenced by two variables. Conditioning can introduce selection bias.');
  const compact = BrowserWindow.getAllWindows().find((window) => window !== reading && window !== longPin && window !== reference);
  await until(async () => (await snapshot(compact)).phase === 'done' && compact.getBounds().height < 500, 'compact translation');
  const compactHeight = compact.getBounds().height;
  const compactArea = screen.getDisplayMatching(compact.getBounds()).workArea;
  const compactY = compactArea.y + compactArea.height - compactHeight;
  compact.setPosition(compact.getBounds().x, compactY);
  const select = async (quote) => {
    const current = await snapshot(compact);
    const start = current.sourceText.indexOf(quote);
    await js(compact, `window.readingPin.act('lookup', ${JSON.stringify({ revision: current.revision, segmentId: 0, start, end: start + quote.length })})`);
    await until(async () => (await snapshot(compact)).lookupStatus === 'done', 'lookup completed');
  };
  await select('collider');
  await check('opening an explanation expands an automatically fitted small card', () => {
    const area = screen.getDisplayMatching(compact.getBounds()).workArea;
    assert(compact.getBounds().height >= Math.min(640, area.height));
  });
  await check('reading font controls also enlarge explanations and contextual notes', async () => {
    const size = () => js(compact, `[getComputedStyle(document.getElementById('lookup-meaning')).fontSize, getComputedStyle(document.getElementById('lookup-note')).fontSize].map(parseFloat)`);
    const before = await size();
    await js(compact, 'document.getElementById("larger").click()');
    const after = await size();
    assert(after.every((value, i) => value > before[i]));
  });
  await js(compact, 'document.getElementById("lookup-panel").scrollTop = 150');
  assert(await js(compact, 'document.getElementById("lookup-panel").scrollTop > 0'));
  await select('selection bias');
  await check('a different concept starts at the beginning of its explanation', async () => {
    assert.equal(await js(compact, 'document.getElementById("lookup-panel").scrollTop'), 0);
  });
  await js(compact, 'document.getElementById("lookup-close").click()');
  await check('closing the explanation restores the compact reading height', () => assert.equal(compact.getBounds().height, compactHeight));
  assert.equal(compact.getBounds().y, compactY, 'closing should restore the original position after an automatic screen-edge adjustment');
  await select('collider');
  compact.setPosition(compact.getBounds().x, compactArea.y);
  await js(compact, 'document.getElementById("lookup-close").click()');
  assert.equal(compact.getBounds().y, compactArea.y, 'closing must preserve a position the reader moved to');
  compact.emit('will-resize', {}, compact.getBounds());
  compact.setSize(460, 410);
  await select('collider');
  await check('an explicitly resized card keeps the reader chosen size', () => assert.equal(compact.getBounds().height, 410));
  await js(compact, 'document.getElementById("lookup-close").click()');
  assert.equal(compact.getBounds().height, 410);
  manager.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  if (failures.length) throw new Error(`${failures.length} usability regressions: ${failures.join('; ')}`);
  console.log('Reading usability regression checks passed (deterministic provider).');
  app.exit(0);
}).catch((error) => { console.error(error); manager?.dispose(); app.exit(1); });
