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
    if (input.selection) return JSON.stringify({ quote: input.selection, meaning: '相对于目标参数，需要估计的其他参数。', note: '' });
    return JSON.stringify({ translation: '样本量为 $N$，误差量级为 $1/\\sqrt{N}$。'.repeat(20),
      terms: input.excerpt.includes('root-N consistency') ? [{quote:'root-N consistency', label:'$\\sqrt{N}$ 一致性'}] : [],
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
  manager.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  if (failures.length) throw new Error(`${failures.length} usability regressions: ${failures.join('; ')}`);
  console.log('Reading usability regression checks passed (deterministic provider).');
  app.exit(0);
}).catch((error) => { console.error(error); manager?.dispose(); app.exit(1); });
