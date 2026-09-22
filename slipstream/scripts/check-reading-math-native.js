'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const katex = require('katex');
const { createReadingPins } = require('../src/main/reading-pins');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createTermLibrary } = require('../src/main/term-library');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-math-check-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const output = process.env.SLIPSTREAM_MATH_EVIDENCE_DIR;
const sourceOnly = process.argv.includes('--source-only');
const source = String.raw`Conditional expectation can be expressed using a conditional density:

$$\mathbb{E}[Y\mid X=x]=\int_{-\infty}^{\infty} y f_{Y\mid X}(y\mid x)\,\mathrm{d}y.$$

The sample mean and a symmetric matrix are:

$$\bar{x}=\frac{1}{n}\sum_{i=1}^{n} x_i,\qquad A=\begin{pmatrix}a & b\\b & c\end{pmatrix}.$$`;
const translation = String.raw`条件期望可用条件密度表示：

$$\mathbb{E}[Y\mid X=x]=\int_{-\infty}^{\infty} y f_{Y\mid X}(y\mid x)\,\mathrm{d}y.$$

样本均值和对称矩阵为：

$$\bar{x}=\frac{1}{n}\sum_{i=1}^{n} x_i,\qquad A=\begin{pmatrix}a & b\\b & c\end{pmatrix}.$$`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, label) {
  const end = Date.now() + 20000;
  let lastError;
  while (Date.now() < end) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await pause(40);
  }
  throw new Error(`Timed out: ${label}${lastError ? `; ${lastError.message}` : ''}`);
}
let manager;
let library;
app.whenReady().then(async () => {
  if (output) fs.mkdirSync(output, { recursive: true });
  const sourceWindow = new BrowserWindow({ width: 1020, height: 560, show: sourceOnly,
    title: 'Slipstream · 公式测试原文', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  const css = pathToFileURL(path.join(path.dirname(require.resolve('katex/package.json')), 'dist/katex.min.css')).href;
  const equations = require('../src/shared/reading-math.cjs').mathRanges(source);
  const html = `<html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><body style="margin:44px;font:22px/1.65 Georgia;color:#17241f;background:white"><div style="font:12px system-ui;color:#536955">SLIPSTREAM · 自拟公式测试材料</div><h1 style="font-size:28px">Conditional expectation</h1><p>Conditional expectation can be expressed using a conditional density:</p>${katex.renderToString(equations[0].tex, { displayMode: true })}<p>The sample mean and a symmetric matrix are:</p>${katex.renderToString(equations[1].tex, { displayMode: true })}</body></html>`;
  const sourceHtml = path.join(work, 'source.html'); fs.writeFileSync(sourceHtml, html);
  await sourceWindow.loadFile(sourceHtml);
  await sourceWindow.webContents.executeJavaScript('document.fonts.ready');
  const fixture = path.join(work, 'source.png');
  fs.writeFileSync(fixture, (await sourceWindow.webContents.capturePage()).toPNG());
  if (output) { fs.copyFileSync(fixture, path.join(output, 'reading-math-source.png')); fs.writeFileSync(path.join(output, 'reading-math-source.txt'), source); }
  const ocr = await require('../src/main/ocr-service').performOCR(fixture);
  console.log(JSON.stringify({ localOcr: ocr.text, confidence: ocr.confidence }));
  if (output) fs.writeFileSync(path.join(output, 'reading-math-local-ocr.json'), JSON.stringify(ocr, null, 2));
  if (sourceOnly) { sourceWindow.on('closed', () => app.quit()); return; }
  sourceWindow.destroy();
  const store = createTermCardStore(path.join(work, 'cards'));
  let translations = 0;
  let formulaCalls = 0;
  let copied;
  let held;
  let heldSignal;
  let hold = false;
  let emptyOcr = false;
  let localReviewOcr = false;
  const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'fixture', deepseekApiKey: 'fixture-key' };
  manager = createReadingPins({ BrowserWindow, ipcMain, screen, getSettings: () => settings, getMainWindow: () => null,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => { const file = path.join(work, `capture-${Date.now()}.png`); fs.copyFileSync(fixture, file); return file; },
    performOCR: async () => localReviewOcr
      ? { text: source, document: { text: source, layoutReview: false }, confidence: .99, blocks: [],
        formulaOcr: { status: 'done', count: 2, uncertain: 1, uncertainStarts: [source.indexOf('$$')] } }
      : { text: emptyOcr ? '' : 'Conditional expectation E[Y | X] = y', confidence: .99, blocks: [] },
    processReadingText: async ({ kind, selection }) => {
      translations += 1;
      if (kind === 'lookup') return { lookup: { quote: selection, meaning: String.raw`条件期望 $\mathbb{E}[Y\mid X=x]$ 是给定 $X=x$ 时 $Y$ 的平均值。`, note: String.raw`这里用条件密度 $f_{Y\mid X}(y\mid x)$ 对 $y$ 加权积分。`, contextual: true } };
      return { translation, terms: [{ quote: 'Conditional expectation', label: '条件期望', start: 0, end: 23 }] };
    },
    recognizeReadingFormulas: async ({ signal }) => {
      formulaCalls += 1;
      if (hold) { heldSignal = signal; return new Promise((resolve) => { held = resolve; }); }
      return { text: source, uncertain: [] };
    },
    copyText: (text) => { copied = text; }, saveTermCard: (input) => store.save(input),
  });
  await manager.capture();
  const pin = BrowserWindow.getAllWindows()[0];
  const js = (code) => pin.webContents.executeJavaScript(code);
  const state = () => js('window.readingPin.act("ready").then(r=>r.state)');
  await until(async () => (await state()).phase === 'review', 'high-confidence mathematical OCR review');
  assert.equal(translations, 0); assert.equal(formulaCalls, 0, 'math detection must not upload the screenshot');
  assert.equal(await js('window.readingPin.act("recognize-formulas", {revision:0})'), false);
  await js('document.getElementById("review-image").click()');
  assert(await js('document.getElementById("review").hidden && !document.getElementById("original").hidden'), 'screenshot tab must show the image directly during review');
  await js('document.getElementById("recognize-formulas").click()');
  await until(async () => (await state()).formulaStatus === 'done', 'formula transcription');
  assert.equal((await state()).phase, 'review'); assert.equal(translations, 0, 'vision result must be reviewed before translation');
  await until(() => js('document.querySelectorAll("#source-preview .katex").length === 2'), 'local equation preview');
  await js('document.getElementById("confirm").click()');
  await until(async () => (await state()).phase === 'done', 'LaTeX translation');
  await js('document.getElementById("tab-parallel").click()');
  assert.equal(await js('document.querySelectorAll(".source-paragraph .katex").length'), 2, 'the original formulas must be readable in the parallel view');
  const selectionSource = String.raw`The mean $\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i$ is a sample statistic. Its scale is $1$.`;
  manager.openText(selectionSource);
  const selectionPin = BrowserWindow.getAllWindows().find(window => window !== pin);
  const selectionJs = code => selectionPin.webContents.executeJavaScript(code);
  await until(() => selectionJs('window.readingPin.act("ready").then(r=>r.state.phase === "done")'), 'math source for selection');
  await selectionJs('document.getElementById("tab-parallel").click()');
  assert.equal(await selectionJs('document.querySelectorAll(".source-paragraph .katex").length'), 2);
  await selectionJs(`(() => {
    const paragraph = document.querySelector('.source-paragraph');
    const node = [...paragraph.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes('sample statistic'));
    const range = document.createRange(), start = node.textContent.indexOf('sample statistic');
    range.setStart(node, start); range.setEnd(node, start + 'sample statistic'.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  })()`);
  await until(() => selectionJs('!document.getElementById("selection-bar").hidden'), 'select prose after a rendered formula');
  await selectionJs('document.getElementById("lookup-selection").click()');
  await until(() => selectionJs('window.readingPin.act("ready").then(r=>r.state.lookupStatus === "done")'), 'exact source selection');
  assert.equal(await selectionJs('window.readingPin.act("ready").then(r=>r.state.lookup.quote)'), 'sample statistic', 'rendered math must not shift subsequent source offsets');
  const acrossMath = await selectionJs(`(() => {
    const paragraph = document.querySelector('.source-paragraph'), math = paragraph.querySelector('.katex-html');
    const range = document.createRange(); range.setStart(paragraph.firstChild, 4); range.setEnd(math.firstChild, 1);
    return window.readingMathSelection(paragraph, range);
  })()`);
  assert.equal(acrossMath.text, selectionSource.slice(4, selectionSource.indexOf('$ is') + 1), 'a selection ending inside a formula includes its complete original LaTeX');
  assert.equal(await selectionJs(`(() => {
    const paragraph = document.querySelector('.source-paragraph'), range = document.createRange();
    range.selectNodeContents(paragraph); return window.readingMathSelection(paragraph, range).text;
  })()`), selectionSource, 'whole-source selection preserves raw LaTeX exactly once');
  assert.equal(await selectionJs(`(() => {
    const paragraph = document.querySelector('.source-paragraph'), range = document.createRange();
    range.selectNodeContents(paragraph.querySelector('.katex-html')); range.collapse(true);
    return window.readingMathSelection(paragraph, range);
  })()`), null, 'a caret inside mathematics is not a selected formula');
  selectionPin.close();
  assert(await js('document.querySelectorAll("#translation .katex").length >= 2'));
  assert(await js('document.querySelector("#translation math") !== null'), 'math must expose accessible MathML');
  await js('document.getElementById("copy").click()'); assert.match(copied, /\\frac\{1\}\{n\}/);
  await js('document.querySelector(".term-chip").click()');
  await until(async () => (await state()).lookupStatus === 'done', 'term with equations');
  assert(await js('document.querySelectorAll("#lookup-meaning .katex").length === 3'));
  await js('document.getElementById("save-term").click()');
  await until(async () => (await state()).saveStatus === 'saved', 'math persisted');
  const saved = (await store.list()).cards[0];
  assert.match(fs.readFileSync(await store.filePath(saved.id), 'utf8'), /\\begin\{pmatrix\}/);
  // Malformed LaTeX remains readable; arbitrary markup stays inert.
  const unsafe = String.raw`<img src="https://example.com" onerror="alert(1)"> $\notARealCommand{x}$ $\href{https://example.com}{link}$`;
  await js(`window.renderReadingMath(document.getElementById('lookup-note'), ${JSON.stringify(unsafe)})`);
  assert.equal(await js('document.querySelectorAll("#lookup-note img, #lookup-note a").length'), 0);
  assert.match(await js('document.getElementById("lookup-note").textContent'), /notARealCommand/);
  await pin.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>render(r.state))');
  if (output) fs.writeFileSync(path.join(output, 'reading-math-pin.png'), (await pin.webContents.capturePage()).toPNG());
  library = createTermLibrary({ BrowserWindow, ipcMain, shell, dialog, store });
  library.open(saved.id);
  const card = BrowserWindow.getAllWindows().find((win) => win !== pin);
  await until(() => card.webContents.executeJavaScript('document.querySelectorAll("#meaning-reading .katex").length === 3'), 'math card reopened');
  assert(await card.webContents.executeJavaScript('document.querySelectorAll("#source .katex").length === 2'));
  if (output) fs.writeFileSync(path.join(output, 'reading-math-library.png'), (await card.webContents.capturePage()).toPNG());
  library.dispose(); library = null;
  hold = true;
  await js('document.getElementById("tab-image").click();document.getElementById("recognize-formulas").click()');
  await until(() => Boolean(held), 'pending formula request');
  manager.invalidateProcessing(); assert(heldSignal.aborted);
  held({ text: 'stale formula result', uncertain: [] }); await pause(60);
  assert.notEqual((await state()).sourceText, 'stale formula result');
  hold = false; localReviewOcr = true;
  await manager.capture();
  const markedPin = BrowserWindow.getAllWindows().find((window) => window !== pin && window.getTitle() === 'Slipstream · 阅读卡片');
  assert(markedPin, 'local OCR capture must open a reading card');
  await until(() => markedPin.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>r.state.phase === "review")').catch(() => false), 'local formula review');
  assert.equal(await markedPin.webContents.executeJavaScript('document.querySelectorAll("#source-preview .math-needs-review").length'), 1,
    'the uncertain formula must be marked at its real source position');
  assert.equal(await markedPin.webContents.executeJavaScript('getComputedStyle(document.querySelector("#source-preview .math-needs-review")).outlineStyle'), 'dashed');
  assert.match(await markedPin.webContents.executeJavaScript('document.querySelector("#source-preview .math-needs-review").getAttribute("aria-label")'), /需核对并校正公式/);
  assert.match(await markedPin.webContents.executeJavaScript('document.getElementById("formula-notice").textContent'), /已在公式预览标出/);
  await markedPin.webContents.executeJavaScript('document.getElementById("source-editor").value += " corrected"; document.getElementById("source-editor").dispatchEvent(new Event("input"))');
  assert.equal(await markedPin.webContents.executeJavaScript('document.querySelectorAll("#source-preview .math-needs-review").length'), 0,
    'editing the source invalidates OCR offsets instead of highlighting another symbol');
  assert.doesNotMatch(await markedPin.webContents.executeJavaScript('document.getElementById("formula-notice").textContent'), /已在公式预览标出/);
  await markedPin.webContents.executeJavaScript('document.getElementById("confirm").click()');
  await until(() => markedPin.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>r.state.phase === "done")'), 'edited source translation');
  await markedPin.webContents.executeJavaScript('document.getElementById("edit-source").click()');
  await until(() => markedPin.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>r.state.phase === "review")'), 'edited source review');
  assert.equal(await markedPin.webContents.executeJavaScript('document.querySelectorAll("#source-preview .math-needs-review").length'), 0,
    'reopening an edited source must not reuse the original OCR positions');
  markedPin.close();
  localReviewOcr = false; emptyOcr = true;
  await manager.capture();
  const formulaOnly = BrowserWindow.getAllWindows().find((window) => window !== pin && window.getTitle() === 'Slipstream · 阅读卡片');
  await until(() => formulaOnly.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>r.state.phase === "error")').catch(() => false), 'empty local OCR');
  assert(await formulaOnly.webContents.executeJavaScript('!document.getElementById("formula-tools").hidden && !document.getElementById("recognize-formulas").hidden'), 'formula recognition must remain available when local OCR sees no text');
  manager.dispose();
  assert.equal((await require('../src/main/term-card-store').createTermCardStore(store.directory).list()).cards[0].meaning, saved.meaning);
  console.log('Native math checks passed: OCR review, explicit image send, formula preview, translation, accessible math, raw-LaTeX copy, term explanation, Markdown reopen, untrusted markup and stale-result cancellation.');
  fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch((error) => { console.error(error); library?.dispose(); manager?.dispose(); app.exit(1); });
app.on('window-all-closed', () => {});
if (!sourceOnly) setTimeout(() => { console.error('Math native test timed out'); app.exit(1); }, 90000).unref();
