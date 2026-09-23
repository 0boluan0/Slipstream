'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
setTimeout(() => { console.error('Local formula OCR exceeded 480 seconds'); app.exit(1); }, 480000).unref();

// Pixel-stable, self-authored screenshots keep OCR assertions independent of
// runner fonts, display scale and hidden BrowserWindow first-paint timing.
const authored = (name) => path.join(fixtures, `authored-${name}.png`);

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
    for (const item of mathRanges(result.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false, displayMode: item.display });
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
    for (const item of mathRanges(result.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false, displayMode: item.display });
    results.push({ case: name, ...result.formulaOcr, text: result.text });
    console.log(`${name}: formula structure passed`);
  }
  const scaledAdam = path.join(work, 'adam-scaled.png');
  const adamImage = require('electron').nativeImage.createFromPath(path.join(fixtures, 'adam-algorithm.png'));
  fs.writeFileSync(scaledAdam, adamImage.resize({ width: Math.round(adamImage.getSize().width * 1.75), quality: 'best' }).toPNG());
  for (const [name, imagePath] of [['adam-scaled', scaledAdam]]) {
    const result = await service.performReadingOCR(imagePath);
    assert.equal(result.formulaOcr.status, 'done', `${name}: local formula OCR must complete`);
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
    console.log(`${name}: scaled formula structure passed`);
  }
  const weakAccent = authored('weak-inline-accent');
  const weakAccentResult = await service.performReadingOCR(weakAccent);
  assert.match(weakAccentResult.text, /Using\s+\$\\hat\{f\}\$\s+and/, 'a weak isolated accent in a wide screenshot must not silently become a plain letter');
  const accentText = await service.performOCR(weakAccent, { characters: true });
  const figureRow = accentText.blocks.find((block) => /Figure 1\b/u.test(block.text));
  assert(figureRow?.characters?.length, 'authored cross-reference is available as character-located OCR');
  const numeralIndex = Array.from(figureRow.text.slice(0, figureRow.text.indexOf('Figure 1') + 'Figure 1'.length)).length - 1;
  const ambiguousRow = { ...figureRow, text: figureRow.text.replace('Figure 1', 'Figure I'),
    characters: figureRow.characters.map((char, i) => i === numeralIndex ? { ...char, text: 'I' } : char) };
  const ambiguous = { blocks: [ambiguousRow] };
  const rechecked = await service.recheckReferenceOne(weakAccent, ambiguous, accentText, work);
  assert.match(rechecked.blocks[0].text, /Figure 1\b/u,
    'a tight third OCR crop resolves an I/1 disagreement at the same source location');
  assert.equal((await service.recheckReferenceOne(weakAccent, ambiguous, { blocks: [] }, work)).blocks[0].text,
    ambiguousRow.text, 'a secondary reading without location-matched support cannot change a Roman numeral');
  results.push({ case: 'weak-inline-accent-wide-excerpt', ...weakAccentResult.formulaOcr,
    text: weakAccentResult.text });
  console.log('weak-inline-accent-wide-excerpt: passed');
  const plainLetter = authored('wide-plain-letter');
  const plainLetterResult = await service.performReadingOCR(plainLetter);
  assert.doesNotMatch(plainLetterResult.text, /\\hat\s*\{?f/u,
    'wide prose with a plain f must not acquire a mathematical accent');
  results.push({ case: 'wide-plain-letter-no-accent', ...plainLetterResult.formulaOcr,
    text: plainLetterResult.text });
  console.log('wide-plain-letter-no-accent: passed');
  const edgeLine = 'During adaptation, use a pre-trainec';
  const edgeBox = { x: .82, y: .5, w: .1, h: .12 };
  const edgeRow = { text: edgeLine, confidence: 1,
    boundingBox: { x: .04, y: .5, w: .9, h: .12 },
    characters: Array.from(edgeLine, (letter) => ({ text: letter, boundingBox: edgeBox })) };
  const edgeAlternative = { blocks: [{ ...edgeRow, text: 'During adaptation, use a pre-trained' }] };
  const edgeOriginal = { blocks: [edgeRow] };
  const confirmedWord = await service.recheckRightEdgeWord(plainLetter, edgeOriginal, edgeAlternative, work,
    { recognize: async () => ({ text: 'use a pre-trained', confidence: 1 }) });
  assert.equal(confirmedWord.blocks[0].text, 'During adaptation, use a pre-trained',
    'a third local crop can repair one disputed final letter of an edge word');
  assert.equal(confirmedWord.blocks[0].characters.at(-1).text, 'd',
    'the corrected character must also reach layout-based prose assembly');
  const unconfirmedWord = await service.recheckRightEdgeWord(plainLetter, edgeOriginal, edgeAlternative, work,
    { recognize: async () => ({ text: 'use a pre-trainec', confidence: 1 }) });
  assert.equal(unconfirmedWord.blocks[0].text, edgeLine,
    'two competing line reads cannot change a word without third-pass confirmation');
  const unrelatedRow = { blocks: [{ ...edgeRow, text: 'Another sentence ends with pre-trained' }] };
  assert.equal((await service.recheckRightEdgeWord(plainLetter, edgeOriginal, unrelatedRow, work,
    { recognize: async () => ({ text: 'pre-trained', confidence: 1 }) })).blocks[0].text, edgeLine,
    'a different line cannot supply a substitute word');
  const shiftedRow = { blocks: [{ ...edgeRow, text: 'During adaptation, use a pre-trained',
    boundingBox: { x: .5, y: .5, w: .4, h: .12 } }] };
  assert.equal((await service.recheckRightEdgeWord(plainLetter, edgeOriginal, shiftedRow, work,
    { recognize: async () => ({ text: 'pre-trained', confidence: 1 }) })).blocks[0].text, edgeLine,
    'a different column cannot supply a substitute word');
  const plainDimensions = authored('plain-matrix-dimensions');
  const plainDimensionsResult = await service.performReadingOCR(plainDimensions);
  const dimensionRanges = mathRanges(plainDimensionsResult.text);
  assert(dimensionRanges.length >= 1, 'self-authored matrix dimensions must reach formula review');
  for (const range of dimensionRanges.filter((item) => /\\(?:breve|vec|hat|tilde|bar)\s*\{?\s*k/u.test(item.tex))) {
    assert(plainDimensionsResult.formulaOcr.uncertainStarts.includes(range.start),
      'an invented accent on a plain dimension must never pass without a review marker');
  }
  results.push({ case: 'authored-plain-matrix-dimensions', ...plainDimensionsResult.formulaOcr,
    text: plainDimensionsResult.text });
  console.log('authored-plain-matrix-dimensions: passed');
  const matrix = authored('matrix');
  const matrixResult = await service.performReadingOCR(matrix);
  const matrixTex = compact(matrixResult.text);
  assert.match(matrixTex.replace(/\{([abc])\}/g, '$1'), /\\begin\{[pb]?matrix\}a&b\\\\b&c/);
  assert.match(matrixTex, /\\frac\{1\}\{n\}/);
  for (const item of mathRanges(matrixResult.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false, displayMode: item.display });
  results.push({ case: 'authored-matrix', ...matrixResult.formulaOcr, text: matrixResult.text });
  console.log('authored-matrix: passed');
  const derivatives = authored('derivatives');
  const derivativeResult = await service.performReadingOCR(derivatives);
  assert.match(compact(derivativeResult.text), /\\dot\{x\}/, 'genuine derivative dots must survive cropping');
  assert.match(compact(derivativeResult.text), /\\ddot\{x\}/);
  results.push({ case: 'authored-derivatives', ...derivativeResult.formulaOcr, text: derivativeResult.text });
  console.log('authored-derivatives: passed');
  const prose = authored('prose');
  const proseResult = await service.performReadingOCR(prose);
  assert.equal(proseResult.formulaOcr.count, 0, 'ordinary prose must not acquire invented formulas');
  assert.match(proseResult.text, /Correlation does not imply causation/);
  results.push({ case: 'authored-prose', ...proseResult.formulaOcr });
  console.log('authored-prose: passed');
  const ordinary = authored('ordinary-symbol-lookalikes');
  const ordinaryResult = await service.performReadingOCR(ordinary);
  assert.equal(ordinaryResult.formulaOcr.count, 0, 'articles, pronouns, ordinals and years must not acquire formulas');
  assert.match(ordinaryResult.text, /I read a paper/);
  results.push({ case: 'authored-ordinary-symbol-lookalikes', ...ordinaryResult.formulaOcr, text: ordinaryResult.text });
  console.log('authored-ordinary-symbol-lookalikes: passed');
  const symbolLookalikes = await service.performReadingOCR(path.join(fixtures, 'authored-symbol-lookalikes.png'));
  assert.match(symbolLookalikes.text, /The sample space \$\\Omega\$/,
    'an isolated Greek heading must survive a complete screenshot OCR pass');
  assert.match(symbolLookalikes.text, /For this invented example, \$\\Omega\$ contains/,
    'a Greek glyph misread as an ampersand by prose OCR must be rechecked at its pixels');
  assert.match(symbolLookalikes.text, /The event space \$\\mathcal\{A\}\$/,
    'a calligraphic heading must keep its font distinction from a plain A');
  assert.match(symbolLookalikes.text, /The family \$\\mathcal\{A\}\$ contains/);
  assert.match(symbolLookalikes.text, /The plain set S is a different label/);
  assert.match(symbolLookalikes.text, /A is an ordinary matrix/,
    'ordinary Latin lookalikes must remain prose');
  const ambiguousDelta = mathRanges(symbolLookalikes.text).find((item) => item.tex.includes('\\varDelta'));
  assert(ambiguousDelta && symbolLookalikes.formulaOcr.uncertainStarts.includes(ambiguousDelta.start),
    'a full-formula A/Delta disagreement with source OCR must require visual review');
  results.push({ case: 'authored-greek-calligraphic-and-plain-lookalikes', ...symbolLookalikes.formulaOcr,
    text: symbolLookalikes.text });
  console.log('authored-greek-calligraphic-and-plain-lookalikes: passed');
  const smallerLookalikes = await service.performReadingOCR(path.join(fixtures, 'authored-symbol-lookalikes-650.png'));
  assert.match(smallerLookalikes.text, /The sample space \$\\Omega\$/,
    'a smaller screenshot must retain the Greek symbol in its heading');
  if (!/For this invented example, \$\\Omega\$ contains/u.test(smallerLookalikes.text)) {
    const observed = await service.performOCR(path.join(fixtures, 'authored-symbol-lookalikes-650.png'), { characters: true });
    const glyphs = observed.blocks.filter((block) => /invented/u.test(block.text)).map((block) => ({
      text: block.text,
      characters: Array.from(block.text).flatMap((letter, index) => /^[SΩ€&$]$/u.test(letter)
        ? [{ index, letter, box: block.characters?.[index]?.boundingBox }] : []),
    }));
    console.error(`Small Greek glyph diagnostic: ${JSON.stringify({ glyphs, formulaOcr: smallerLookalikes.formulaOcr })}`);
  }
  assert.match(smallerLookalikes.text, /For this invented example, \$\\Omega\$ contains/,
    'blank pixels around a small Greek character must not turn a crop recheck into a false subscript');
  assert.match(smallerLookalikes.text, /The plain set S is a different label/,
    'tightening a symbol crop must not turn an ordinary S into Omega');
  assert.match(smallerLookalikes.text, /The separate matrix A stays plain/,
    'tightening a symbol crop must not turn an ordinary A into a calligraphic A');
  results.push({ case: 'authored-small-glyphs-and-plain-lookalikes', ...smallerLookalikes.formulaOcr,
    text: smallerLookalikes.text });
  const splitReader = createLocalFormulaOcr(path.resolve(__dirname, '../formula-models'));
  try {
    const image = path.join(fixtures, 'authored-symbol-lookalikes-650.png');
    const detected = await splitReader.recognize(image);
    // The source image prints one Omega at these pixels. Simulate Vision's
    // observed failure of returning S2 with both characters in one glyph box.
    const glyph = { x: 272 / 650, y: 1 - 83 / 358, w: 18 / 650, h: 25 / 358 };
    const split = await splitReader.recheckCharacters(image, { blocks: [{ text: 'S2', characters: [
      { text: 'S', boundingBox: glyph }, { text: '2', boundingBox: glyph },
    ] }] }, detected);
    assert(split.formulas.some((formula) => formula.latex === '\\Omega'
      && Math.abs(formula.x - 272) < 4 && Math.abs(formula.y - 58) < 4),
    'two OCR characters occupying one printed math glyph must be checked against source pixels');
    // A macOS CI Vision build called this same Omega '$' and supplied only
    // the middle 12 of its roughly 18 printed pixels.
    const narrowBox = { x: 273 / 650, y: 1 - 84 / 358, w: 12 / 650, h: 30 / 358 };
    const narrow = await splitReader.recheckCharacters(image, { blocks: [{ text: '$', characters: [
      { text: '$', boundingBox: narrowBox },
    ] }] }, detected);
    assert(narrow.formulas.some((formula) => formula.latex === '\\Omega'
      && Math.abs(formula.x - 270) < 4 && Math.abs(formula.y - 54) < 4),
    'a narrow OCR placeholder box must recover the complete printed math glyph');
  } finally { await splitReader.cleanup(); }

  for (const result of results) {
    const starts = new Set(mathRanges(result.text || '').map((range) => range.start));
    if (result.count) assert(Array.isArray(result.uncertainStarts), `${result.case}: formula markers must be present`);
    const uncertainStarts = result.uncertainStarts || [];
    assert.equal(uncertainStarts.length, result.uncertain || 0,
      `${result.case}: every uncertain formula needs a review marker`);
    for (const start of uncertainStarts) assert(starts.has(start),
      `${result.case}: an uncertain marker must point to a formula in the displayed source`);
  }

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
  let preview;
  for (let i = 0; i < 50; i++) {
    preview = await pin.webContents.executeJavaScript(`(() => ({
      rendered: document.querySelectorAll('#source-preview .katex').length,
      formulaCount: window.readingMath.mathRanges(document.getElementById('source-editor').value).length,
      katexLoaded: Boolean(window.katex),
      preview: document.getElementById('source-preview').textContent.slice(0, 160),
    }))()`);
    if (preview.rendered >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert(preview.rendered >= 2, `Formula preview failed: ${JSON.stringify(preview)}`);
  assert(await pin.webContents.executeJavaScript('document.getElementById("formula-preview").open && !document.getElementById("source-correction").open'));
  await pin.webContents.executeJavaScript('document.querySelector("#source-preview > [role=button]").click()');
  const selectedFormula = await pin.webContents.executeJavaScript(`(() => {
    const editor = document.getElementById('source-editor');
    return editor.value.slice(editor.selectionStart, editor.selectionEnd);
  })()`);
  assert.equal(selectedFormula, mathRanges(state.sourceText)[0].tex, 'clicking a formula selects only that formula for correction');
  assert(await pin.webContents.executeJavaScript('document.getElementById("source-correction").open && !document.getElementById("correction-reference").hidden && document.getElementById("correction-image").naturalWidth > 0'), 'original screenshot stays beside the correction editor');
  assert(await pin.webContents.executeJavaScript(`(() => {
    const image = document.getElementById('correction-reference').getBoundingClientRect();
    const editor = document.getElementById('source-editor').getBoundingClientRect();
    const footer = document.querySelector('footer').getBoundingClientRect();
    return image.bottom <= editor.top && editor.top >= image.top && editor.top + 45 < footer.top;
  })()`), 'the reference screenshot must not cover the selected formula in the editor');
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
