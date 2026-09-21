'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const katex = require('katex');
const { mathRanges } = require('../src/shared/reading-math.cjs');
const { createLocalFormulaOcr } = require('../src/main/local-formula-ocr');
const { createReadingPins } = require('../src/main/reading-pins');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-local-formula-check-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const fixtures = path.resolve(__dirname, '../../docs/usability/2026-09-18/formula-ocr');
const compact = (value) => value.replace(/\s+/g, '');
const results = [];
let manager, service;
setTimeout(() => { console.error('Local formula OCR exceeded 180 seconds'); app.exit(1); }, 180000).unref();

async function fixture(name, html) {
  const win = new BrowserWindow({ width: 900, height: 360, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const css = pathToFileURL(path.join(path.dirname(require.resolve('katex/package.json')), 'dist/katex.min.css')).href;
  const file = path.join(work, `${name}.html`);
  fs.writeFileSync(file, `<html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><body style="padding:30px;font:24px/1.6 Georgia;background:white;color:black">${html}</body></html>`);
  await win.loadFile(file);
  await win.webContents.executeJavaScript('document.fonts.ready');
  const imagePath = path.join(work, `${name}.png`);
  fs.writeFileSync(imagePath, (await win.webContents.capturePage()).toPNG());
  win.destroy(); return imagePath;
}

app.whenReady().then(async () => {
  // Release apps contain a compiled Swift helper. Build the development helper
  // before timing OCR: a clean CI host can need >15 seconds to compile Vision.
  execFileSync('/bin/bash', [path.join(__dirname, 'ocr-swift-runner.sh'), path.join(fixtures, 'attention-equation.png')], {
    env: require('../src/main/ocr-environment').createOcrEnvironment(path.join(app.getPath('userData'), 'ocr-cache')),
    timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The OCR path must work without credentials and without any HTTP request.
  const denyNetwork = () => { throw new Error('OCR attempted network access'); };
  global.fetch = denyNetwork;
  require('node:http').request = denyNetwork;
  require('node:https').request = denyNetwork;
  service = require('../src/main/ocr-service');
  for (const name of ['adam-algorithm', 'attention-equation', 'dml-paragraph']) {
    const started = Date.now();
    const result = await service.performReadingOCR(path.join(fixtures, `${name}.png`));
    assert.equal(result.formulaOcr.status, 'done');
    const formulas = mathRanges(result.text).map((item) => compact(item.tex));
    for (const item of mathRanges(result.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false });
    if (name === 'adam-algorithm') {
      assert.match(compact(result.text), /Require:\$\\alpha\$:/);
      assert.match(compact(result.text), /parameters\$\\theta\$/);
      assert(!result.text.includes('\\mathrm { I n i t i a l i z e }'), 'prose must stay outside the formula');
      assert(formulas.some((tex) => tex.includes('\\widehat{m}_{t}') && tex.includes('\\beta_{1}^{t}')));
      assert(formulas.some((tex) => tex.includes('\\widehat{v}_{t}') && tex.includes('\\beta_{2}^{t}')));
      assert(formulas.some((tex) => tex.includes('\\sqrt{\\widehat{v}_{t}}')));
      assert.match(result.text, /first moment estimate/);
    } else if (name === 'attention-equation') {
      assert(formulas.some((tex) => tex.includes('\\frac{QK^{T}}{\\sqrt{d_{k}}}')));
      assert.match(result.text.replace(/\$/g, ''), /matrices K and V\. We compute\nthe matrix of outputs as:/);
      assert.match(result.text, /into a matrix \$Q\$\. The keys/);
    } else {
      assert.match(result.text, /root-\s*\$?N\$?\s+consistent/);
      assert(formulas.includes('\\theta_{0}'));
      assert(formulas.includes('\\eta_{0}'));
      assert.match(result.text, /nuisance/);
    }
    results.push({ case: name, elapsedMs: Date.now() - started, ...result.formulaOcr, text: result.text });
    console.log(`${name}: formula structure and prose placement passed`);
  }
  for (const name of ['dml-equations', 'adam-updates']) {
    const result = await service.performReadingOCR(path.join(fixtures, `${name}.png`));
    assert.equal(result.formulaOcr.status, 'done');
    const tex = mathRanges(result.text).map((item) => compact(item.tex)).join(' ');
    if (name === 'dml-equations') {
      assert(tex.includes('\\theta_{0}')); assert.match(tex, /E.*U/); assert.match(tex, /E.*V/);
    } else { assert(tex.includes('\\widehat{m}_{t}')); assert(tex.includes('\\beta_{2}^{t}')); }
    for (const item of mathRanges(result.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false });
    results.push({ case: name, ...result.formulaOcr, text: result.text });
  }
  const nativeAdam = path.resolve(fixtures, '../../2026-09-21/ocr-iteration/adam-screen.png');
  const scaledAdam = path.join(work, 'adam-scaled.png');
  const adamImage = require('electron').nativeImage.createFromPath(path.join(fixtures, 'adam-algorithm.png'));
  fs.writeFileSync(scaledAdam, adamImage.resize({ width: Math.round(adamImage.getSize().width * 1.75), quality: 'best' }).toPNG());
  for (const [name, imagePath] of [['adam-native-screen', nativeAdam], ['adam-scaled', scaledAdam]]) {
    const result = await service.performReadingOCR(imagePath);
    const tex = compact(result.text);
    assert.match(tex, /Require:\$\\alpha\$:/, `${name}: preserve the standalone stepsize symbol`);
    assert.match(tex, /parameters\$\\theta\$/, `${name}: preserve the standalone parameter symbol`);
    assert(!result.text.includes('\\dot'), `${name}: a neighboring line must not add a dot to the denominator`);
    assert(!result.text.includes('::'), `${name}: punctuation must occur once`);
    assert.match(result.text, /Initialize 1st moment vector/, `${name}: prose ordinals must reach the translator`);
    assert.match(result.text, /Initialize 2nd moment vector/);
    assert(tex.includes('\\widehat{m}_{t}') && tex.includes('\\widehat{v}_{t}'));
    assert(tex.includes('\\sqrt{\\widehat{v}_{t}}'));
    results.push({ case: name, ...result.formulaOcr, text: result.text });
  }
  const matrix = await fixture('matrix', '<p>A symmetric matrix and a sample mean:</p>' + katex.renderToString(
    String.raw`A=\begin{pmatrix}a&b\\b&c\end{pmatrix},\qquad \bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`, { displayMode: true }));
  const matrixResult = await service.performReadingOCR(matrix);
  const matrixTex = compact(matrixResult.text);
  assert.match(matrixTex.replace(/\{([abc])\}/g, '$1'), /\\begin\{[pb]?matrix\}a&b\\\\b&c/);
  assert.match(matrixTex, /\\frac\{1\}\{n\}/);
  for (const item of mathRanges(matrixResult.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false });
  results.push({ case: 'authored-matrix', ...matrixResult.formulaOcr, text: matrixResult.text });
  const derivatives = await fixture('derivatives', '<p>Time derivatives:</p>' + katex.renderToString(
    String.raw`\dot{x}(t)=v(t),\qquad \ddot{x}(t)=a(t)`, { displayMode: true }));
  const derivativeResult = await service.performReadingOCR(derivatives);
  assert.match(compact(derivativeResult.text), /\\dot\{x\}/, 'genuine derivative dots must survive cropping');
  assert.match(compact(derivativeResult.text), /\\ddot\{x\}/);
  results.push({ case: 'authored-derivatives', ...derivativeResult.formulaOcr, text: derivativeResult.text });
  const prose = await fixture('prose', '<p>Correlation does not imply causation.</p><p>The meeting starts on Friday. Bring the blue notebook.</p>');
  const proseResult = await service.performReadingOCR(prose);
  assert.equal(proseResult.formulaOcr.count, 0, 'ordinary prose must not acquire invented formulas');
  assert.match(proseResult.text, /Correlation does not imply causation/);
  results.push({ case: 'authored-prose', ...proseResult.formulaOcr });
  const ordinary = await fixture('ordinary-symbol-lookalikes', '<p>I read a paper and tested a model.</p><p>We report the 1st and 2nd estimates from 2024.</p>');
  const ordinaryResult = await service.performReadingOCR(ordinary);
  assert.equal(ordinaryResult.formulaOcr.count, 0, 'articles, pronouns, ordinals and years must not acquire formulas');
  assert.match(ordinaryResult.text, /I read a paper/);
  results.push({ case: 'authored-ordinary-symbol-lookalikes', ...ordinaryResult.formulaOcr, text: ordinaryResult.text });

  const missing = createLocalFormulaOcr(path.join(work, 'missing-models'));
  await assert.rejects(missing.recognize(prose), { code: 'ENOENT' });
  await missing.cleanup();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.performReadingOCR(prose, { signal: controller.signal }), (error) => error.isCancellation);
  const during = new AbortController();
  const pending = service.performReadingOCR(path.join(fixtures, 'adam-algorithm.png'), { signal: during.signal });
  setTimeout(() => during.abort(), 25);
  await assert.rejects(pending, (error) => error.isCancellation);

  // Exercise the actual capture -> local OCR -> review -> rendered math path.
  // Only the OS selection is substituted with an actual paper image.
  let providerCalls = 0;
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    getSettings: () => ({ setupMode: 'translation-only', activeBackend: 'free_translate' }), getMainWindow: () => null,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => { const capture = path.join(work, 'capture.png'); fs.copyFileSync(path.join(fixtures, 'attention-equation.png'), capture); return capture; },
    performOCR: service.performReadingOCR,
    processReadingText: async () => { providerCalls++; throw new Error('Unconfirmed formula reached translator'); },
    copyText() {}, saveTermCard() {},
  });
  const captureResult = await manager.capture();
  assert.equal(captureResult.pinned, true);
  const pin = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Slipstream · 阅读卡片');
  assert(pin, 'capture must create its reading window');
  let state;
  for (let i = 0; i < 100; i++) {
    try { state = await pin.webContents.executeJavaScript('window.readingPin.act("ready").then(r=>r.state)'); }
    catch (error) { if (i === 99) throw error; }
    if (state?.phase === 'review') break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert(state, 'reading card IPC must return state');
  assert.equal(state.phase, 'review'); assert.equal(state.formulaStatus, 'local'); assert.equal(state.imageSent, false);
  assert.equal(providerCalls, 0);
  await pin.webContents.executeJavaScript('document.fonts.ready');
  assert(await pin.webContents.executeJavaScript('document.querySelectorAll("#source-preview .katex").length >= 2'));
  assert(await pin.webContents.executeJavaScript('document.getElementById("formula-preview").open && !document.getElementById("source-correction").open'));
  await pin.webContents.executeJavaScript('document.querySelector("#source-preview > [role=button]").click()');
  const selectedFormula = await pin.webContents.executeJavaScript(`(() => {
    const editor = document.getElementById('source-editor');
    return editor.value.slice(editor.selectionStart, editor.selectionEnd);
  })()`);
  assert.equal(selectedFormula, mathRanges(state.sourceText)[0].tex, 'clicking a formula selects only that formula for correction');
  assert(await pin.webContents.executeJavaScript('document.getElementById("source-correction").open && !document.getElementById("correction-reference").hidden && document.getElementById("correction-image").naturalWidth > 0'), 'original screenshot stays beside the correction editor');
  fs.writeFileSync(path.join(work, 'local-formula-review.png'), (await pin.webContents.capturePage()).toPNG());
  await pin.webContents.executeJavaScript(`(() => {
    const editor = document.getElementById('source-editor');
    editor.setRangeText('Q_0', editor.selectionStart, editor.selectionEnd, 'select');
    editor.dispatchEvent(new Event('input'));
    document.getElementById('review-image').click();
    document.getElementById('edit-source').click();
  })()`);
  assert(await pin.webContents.executeJavaScript('document.getElementById("source-editor").value.includes("$Q_0$")'), 'switching between screenshot and review retains the correction draft');
  assert.equal(providerCalls, 0, 'editing and comparing must not send source text');
  fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.map((item) => ({ case: item.case, status: item.status, count: item.count, elapsedMs: item.elapsedMs, milliseconds: item.milliseconds })), evidence: work }));
}).then(async () => { manager?.dispose(); await service?.cleanup(); app.exit(0); })
  .catch(async (error) => { console.error(error); manager?.dispose(); await service?.cleanup(); app.exit(1); });
