'use strict';
// Opt-in integration check for the local preview identity. Only authored source
// below is submitted. Settings are read/decrypted in memory; no keys are logged.
const { app, BrowserWindow, ipcMain, screen, safeStorage, dialog, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.run = function run() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-live-reading-'));
  const outputArg = process.argv.find((arg) => arg.startsWith('--reading-check-output='));
  if (!outputArg || !path.isAbsolute(outputArg.split('=').slice(1).join('='))) throw new Error('Specify an absolute check-output directory.');
  const output = outputArg.slice('--reading-check-output='.length);
  const report = { date: new Date().toISOString(), capture: 'Authored source rendered to PNG in an Electron window; native system selection is checked separately.', cases: [], readingCalls: [] };
  let stage = 'startup';
  let manager;
  let library;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(predicate, label) {
    const end = Date.now() + 150000;
    while (Date.now() < end) { if (await predicate()) return; await pause(150); }
    throw new Error(`Timed out: ${label}`);
  }
  function saveReport() { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'live-reading.json'), JSON.stringify(report, null, 2) + '\n'); }
  app.whenReady().then(async () => {
    stage = 'decrypt-active-credential';
    const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'slipstream-settings.json'), 'utf8'));
    if (raw.activeBackend !== 'deepseek' || !raw.deepseekApiKey?.startsWith('enc:')) throw new Error('Configured DeepSeek credential required');
    const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: raw.activeModel,
      deepseekApiKey: safeStorage.decryptString(Buffer.from(raw.deepseekApiKey.slice(4), 'base64')) };
    const { processReadingText, recognizeReadingFormulas } = require('./llm-service');
    report.provider = settings.activeBackend; report.model = settings.activeModel;
    if (process.argv.includes('--reading-check-terms')) {
      stage = 'term-selection';
      const passed = await require('./reading-term-check').run({ processReadingText, settings, report, saveReport });
      fs.rmSync(work, { recursive: true, force: true });
      app.exit(passed ? 0 : 1);
      return;
    }
    for (const sample of [
      { term: 'conditional expectation', source: 'Let Y denote future demand and X the information available today. The conditional expectation E[Y | X] is a random variable determined by X. It differs from the unconditional expectation E[Y], which is a single average over all possible values of X.' },
      { term: 'confounder', source: 'A confounder is a variable that influences both a treatment and an outcome. An association between treatment and outcome may therefore persist even when the treatment has no causal effect.' },
    ]) {
      stage = `translate-${sample.term}`;
      const start = Date.now();
      const result = await processReadingText({ text: sample.source, withTerms: true, settingsSnapshot: settings, signal: AbortSignal.timeout(90000) });
      const translationMs = Date.now() - start;
      stage = `explain-${sample.term}`;
      const lookupStart = Date.now();
      const explained = await processReadingText({ text: sample.source, kind: 'lookup', selection: sample.term, settingsSnapshot: settings, signal: AbortSignal.timeout(90000) });
      report.cases.push({ ...sample, ...result, ...explained, translationMs, lookupMs: Date.now() - lookupStart });
      saveReport(); console.log(`Completed real concept: ${sample.term}.`);
    }
    stage = 'render-formula-source';
    const katex = require('katex');
    const source = String.raw`Conditional expectation can be expressed using a conditional density:

$$\mathbb{E}[Y\mid X=x]=\int_{-\infty}^{\infty}y f_{Y\mid X}(y\mid x)\,\mathrm{d}y.$$

The sample mean and a symmetric matrix are:

$$\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i,\qquad A=\begin{pmatrix}a & b\\b & c\end{pmatrix}.$$`;
    report.formulaSource = source;
    const formulas = require('../shared/reading-math.cjs').mathRanges(source);
    const css = pathToFileURL(path.join(path.dirname(require.resolve('katex/package.json')), 'dist/katex.min.css')).href;
    const html = `<html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><body style="margin:44px;font:22px/1.65 Georgia;background:white;color:#17241f"><h1 style="font-size:28px">Conditional expectation</h1><p>Conditional expectation can be expressed using a conditional density:</p>${katex.renderToString(formulas[0].tex, { displayMode: true })}<p>The sample mean and a symmetric matrix are:</p>${katex.renderToString(formulas[1].tex, { displayMode: true })}</body></html>`;
    const sourceWindow = new BrowserWindow({ width: 1020, height: 560, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const sourceFile = path.join(work, 'source.html'); fs.writeFileSync(sourceFile, html); await sourceWindow.loadFile(sourceFile);
    await sourceWindow.webContents.executeJavaScript('document.fonts.ready');
    const image = path.join(output, 'live-formula-source.png'); fs.writeFileSync(image, (await sourceWindow.webContents.capturePage()).toPNG()); sourceWindow.destroy();
    const store = require('./term-card-store').createTermCardStore(path.join(work, 'cards'));
    manager = require('./reading-pins').createReadingPins({ BrowserWindow, ipcMain, screen, getSettings: () => settings, getMainWindow: () => null,
      requestCapturePermission: async () => ({ granted: true }),
      captureRegion: async () => { const file = path.join(work, 'capture.png'); fs.copyFileSync(image, file); return file; },
      performOCR: async (...args) => { const ocr = await require('./ocr-service').performOCR(...args); report.localOcr = ocr; saveReport(); return ocr; },
      processReadingText: async (options) => { const start = Date.now(); const result = await processReadingText(options); report.readingCalls.push({ kind: options.kind, source: options.text, selection: options.selection, ...result, elapsedMs: Date.now() - start }); saveReport(); return result; },
      recognizeReadingFormulas: async (options) => { const start = Date.now(); const result = await recognizeReadingFormulas(options); report.formulaTranscription = { ...result, elapsedMs: Date.now() - start }; saveReport(); return result; },
      saveTermCard: (input) => store.save(input),
    });
    stage = 'local-ocr'; await manager.capture();
    const pin = BrowserWindow.getAllWindows()[0];
    const js = (code) => pin.webContents.executeJavaScript(code);
    const state = () => js('window.readingPin.act("ready").then(r=>r.state)');
    await until(async () => (await state()).phase !== 'ocr', 'OCR');
    report.ocrPhase = (await state()).phase; saveReport();
    stage = 'formula-vision';
    if (report.ocrPhase !== 'review') throw new Error('Expected formula OCR review');
    await js('document.getElementById("recognize-formulas").click()');
    await until(async () => ['done', 'error'].includes((await state()).formulaStatus), 'formula recognition');
    if ((await state()).formulaStatus === 'error') { report.formulaError = (await state()).formulaNotice; throw new Error('Formula recognition failed'); }
    await js('document.getElementById("formula-preview").open=true');
    fs.writeFileSync(path.join(output, 'live-formula-review.png'), (await pin.webContents.capturePage()).toPNG());
    stage = 'formula-translation'; await js('document.getElementById("confirm").click()');
    await until(async () => ['done', 'partial', 'error'].includes((await state()).phase), 'translation');
    if ((await state()).phase !== 'done') { report.readingError = (await state()).notice; throw new Error('Formula translation failed'); }
    const snapshot = await state();
    const target = snapshot.segments.flatMap((segment) => (segment.terms || []).map((term) => ({ ...term, segmentId: segment.id }))).find((term) => term.quote.toLowerCase() === 'conditional expectation');
    if (!target) throw new Error('Expected anchored conditional expectation');
    stage = 'formula-concept';
    await js(`window.readingPin.act('lookup', ${JSON.stringify({ revision: snapshot.revision, segmentId: target.segmentId, start: target.start, end: target.end })})`);
    await until(async () => ['done', 'error'].includes((await state()).lookupStatus), 'formula lookup');
    if ((await state()).lookupStatus !== 'done') throw new Error('Concept lookup failed');
    await pin.webContents.executeJavaScript('document.fonts.ready');
    fs.writeFileSync(path.join(output, 'live-formula-pin.png'), (await pin.webContents.capturePage()).toPNG());
    stage = 'save-and-reopen';
    await js('document.getElementById("save-term").click()');
    await until(async () => (await state()).saveStatus === 'saved', 'save');
    manager.clear();
    const freshStore = require('./term-card-store').createTermCardStore(store.directory);
    const saved = (await freshStore.list()).cards[0];
    fs.copyFileSync(await freshStore.filePath(saved.id), path.join(output, 'live-conditional-expectation.md'));
    library = require('./term-library').createTermLibrary({ BrowserWindow, ipcMain, shell, dialog, store: freshStore });
    library.open(saved.id);
    const card = BrowserWindow.getAllWindows()[0];
    await until(() => card.webContents.executeJavaScript('document.getElementById("term")?.textContent.toLowerCase() === "conditional expectation"'), 'reopened saved concept');
    await card.webContents.executeJavaScript('document.fonts.ready');
    fs.writeFileSync(path.join(output, 'live-formula-library.png'), (await card.webContents.capturePage()).toPNG());
    report.savedAndReopened = true; report.completed = true; saveReport();
    console.log('Live reading check passed: real concepts, formula OCR, translation, term explanation, Markdown save and fresh-store reopen.');
    library.dispose(); manager.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
  }).catch((error) => {
    report.failure = { stage, type: error.name || 'Error', status: Number(error.status) || null }; saveReport();
    console.error(`Live reading check failed at ${stage} (${report.failure.type}; status ${report.failure.status || 'unavailable'}).`);
    library?.dispose(); manager?.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(1);
  });
  app.on('window-all-closed', () => {});
};
