'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const katex = require('katex');
const { mathRanges } = require('../src/shared/reading-math.cjs');
const { createLocalFormulaOcr, characterCandidates, removePriorLineInk } = require('../src/main/local-formula-ocr');
const { createReadingPins, suspiciousRegularizerSubscript } = require('../src/main/reading-pins');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-local-formula-check-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const { createFormulaFixtures } = require('./formula-ocr-fixtures.cjs');
const compact = (value) => value.replace(/\s+/g, '');
const results = [];
let manager, service;
// This authored image suite includes disputed-row rereads. The watchdog is
// a suite limit, not a product recognition deadline.
setTimeout(() => { console.error('Local formula OCR exceeded 240 seconds'); app.exit(1); }, 240000).unref();

async function fixture(name, html, { width = 900, height = 360,
  bodyStyle = 'padding:30px;font:24px/1.6 Georgia;background:white;color:black' } = {}) {
  const win = new BrowserWindow({ width, height, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const css = pathToFileURL(path.join(path.dirname(require.resolve('katex/package.json')), 'dist/katex.min.css')).href;
  const file = path.join(work, `${name}.html`);
  fs.writeFileSync(file, `<html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><body style="${bodyStyle}">${html}</body></html>`);
  await win.loadFile(file);
  await win.webContents.executeJavaScript('document.fonts.ready');
  const imagePath = path.join(work, `${name}.png`);
  fs.writeFileSync(imagePath, (await win.webContents.capturePage()).toPNG());
  win.destroy(); return imagePath;
}

app.whenReady().then(async () => {
  const pixelsOnly = process.argv.includes('--pixels-only');
  if (pixelsOnly) app.dock?.hide();
  // Only an outside glyph's clipped tail may disappear. A real accent and a
  // stroke crossing into the body of the formula must remain byte-for-byte.
  const geometry = { width: 160, height: 110 }, rectangle = { x: 20, y: 50, width: 120, height: 50 };
  const ink = Buffer.alloc(geometry.width * geometry.height * 4, 255);
  const drawInk = (left, top, width, height) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
      const at = (y * geometry.width + x) * 4;
      ink.fill(0, at, at + 3);
    }
  };
  drawInk(70, 25, 3, 28); // A previous line contributes its bottom three rows.
  drawInk(100, 60, 12, 2); // A detached mathematical accent.
  drawInk(40, 50, 16, 2); // An accent exactly on the detector's top boundary.
  drawInk(85, 45, 3, 42); // A tall mathematical stroke crosses the boundary.
  const geometryImage = nativeImage.createFromBitmap(ink, geometry);
  const cleanedGeometry = removePriorLineInk(geometryImage, { x: 20, y: 50, w: 120, h: 50 });
  assert(cleanedGeometry, 'a preceding line tail must be detected in the original pixels');
  const expectedGeometry = geometryImage.crop(rectangle).toBitmap();
  for (let y = 0; y < 3; y++) for (let x = 50; x < 53; x++) {
    expectedGeometry.fill(255, (y * 120 + x) * 4, (y * 120 + x) * 4 + 4);
  }
  assert.deepEqual(cleanedGeometry.toBitmap(), expectedGeometry,
    'removing a preceding-line tail must preserve every other source pixel');
  assert.equal(removePriorLineInk(cleanedGeometry, { x: 0, y: 0, w: 120, h: 50 }), null,
    'a screenshot edge supplies no evidence of an outside glyph');
  const formulaFixtures = await createFormulaFixtures(work);
  const captureFixture = formulaFixtures.find(item => item.name === 'fraction').file;
  require('./prepare-ocr-test')(captureFixture);
  // The OCR path must work without credentials and without any HTTP request.
  const denyNetwork = () => { throw new Error('OCR attempted network access'); };
  global.fetch = denyNetwork;
  require('node:http').request = denyNetwork;
  require('node:https').request = denyNetwork;
  service = require('../src/main/ocr-service');
  const math = (latex, displayMode = false) => katex.renderToString(latex, { displayMode, throwOnError: true });
  const weakAccent = await fixture('weak-inline-accent',
    `<div>Suppose that a classifier assigns estimated probabilities to every class: ${math('\\hat{f}(x)\\in[0,1]^K')}. We reserve a small calibration sample.</div>`
    + `<div>These samples contain unseen images and class labels ${math('(X_1,Y_1),\\ldots,(X_n,Y_n)')}. Using ${math('\\hat{f}')} and calibration data, we construct a prediction set.</div>`
    + `<div>${math('1-\\alpha\\leq\\mathbb{P}(Y_{test}\\in C(X_{test}))\\leq1-\\alpha+\\frac{1}{n+1}', true)}</div>`
    + '<div>The resulting marginal coverage is an average property over random test points. See Figure 1 for examples.</div>',
    { width: 920, height: 282, bodyStyle: 'margin:0;padding:8px 46px;font:18px/1.32 Georgia,serif;background:white;color:#111' });
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
  const symbolLine = '7, and then apply fast linear learning methods to approximate a kernel.';
  const sourceSymbol = { text: symbolLine, confidence: 1,
    boundingBox: { x: .03, y: .68, w: .8, h: .18 },
    characters: Array.from(symbolLine, (letter, index) => ({ text: letter,
      boundingBox: index === 0 ? { x: .04, y: .7, w: .02, h: .14 }
        : { x: 0, y: 0, w: 0, h: 0 } })) };
  const alternativeSymbol = { ...sourceSymbol, text: `z${symbolLine.slice(1)}` };
  const thirdRead = async () => ({ blocks: [{ text: 'z, and then apply fast linear', confidence: 1 }] });
  const recheckedSymbol = await service.recheckLineInitialZ(weakAccent,
    { blocks: [sourceSymbol] }, { blocks: [alternativeSymbol] }, work, { recognize: thirdRead });
  assert.equal(recheckedSymbol.blocks[0].text, alternativeSymbol.text,
    'a cropped third reading and aligned padded line may resolve an initial 7/z ambiguity');
  assert.deepEqual(recheckedSymbol.verifiedGlyphConflicts, [{ source: '7', alternative: 'z' }],
    'the resolved mathematical glyph still asks for source review');
  assert.equal((await service.recheckLineInitialZ(weakAccent, { blocks: [sourceSymbol] },
    { blocks: [{ ...alternativeSymbol, boundingBox: { ...alternativeSymbol.boundingBox, y: .2 } }] },
    work, { recognize: thirdRead })).blocks[0].text, symbolLine,
  'a padded candidate on another printed row cannot change a symbol');
  assert.equal((await service.recheckLineInitialZ(weakAccent, { blocks: [sourceSymbol] },
    { blocks: [alternativeSymbol] }, work,
    { recognize: async () => ({ blocks: [{ text: symbolLine, confidence: 1 }] }) })).blocks[0].text,
  symbolLine, 'the local pixel reading must also agree before changing a symbol');
  const shortReference = await fixture('short-equation-reference',
    '<div>The patch embedding is defined in Eq. 1, and the following layers reuse that representation.</div>',
    { width: 1050, height: 125,
      bodyStyle: 'margin:0;padding:15px 30px;font:23px/1.4 Georgia,serif;background:white;color:#111' });
  const shortReferenceTruth = await service.performOCR(shortReference, { characters: true });
  const eqRow = shortReferenceTruth.blocks.find((block) => /Eq\. 1\b/u.test(block.text));
  assert(eqRow?.characters?.length === Array.from(eqRow.text).length,
    'the abbreviated equation reference must have character-located source pixels');
  const eqIndex = Array.from(eqRow.text.slice(0, eqRow.text.indexOf('Eq. 1') + 'Eq. 1'.length)).length - 1;
  const mistakenEq = { ...eqRow, text: eqRow.text.replace('Eq. 1', 'Eq. I'),
    characters: eqRow.characters.map((char, index) => index === eqIndex ? { ...char, text: 'I' } : char) };
  const checkedEq = await service.recheckReferenceOne(shortReference,
    { blocks: [mistakenEq] }, shortReferenceTruth, work);
  assert.match(checkedEq.blocks[0].text, /Eq\. 1\b/u,
    'a local pixel reading must resolve the common Eq. I/Eq. 1 disagreement');
  const paddedWithDifferentTail = { blocks: [{ ...eqRow,
    text: eqRow.text.replace('representation.', 'representation') }] };
  assert.match((await service.recheckReferenceOne(shortReference,
    { blocks: [mistakenEq] }, paddedWithDifferentTail, work)).blocks[0].text, /Eq\. 1\b/u,
  'a distant OCR difference on the same row must not hide a locally corroborated reference');
  assert.equal((await service.recheckReferenceOne(shortReference,
    { blocks: [mistakenEq] }, { blocks: [] }, work)).blocks[0].text, mistakenEq.text,
  'an abbreviated reference without an independent same-row reading remains unchanged');
  const unresolvedEq = await service.recheckReferenceOne(shortReference,
    { blocks: [mistakenEq] }, shortReferenceTruth, work,
    { recognize: async () => ({ text: 'Eq. I', confidence: 1 }) });
  assert.equal(unresolvedEq.blocks[0].text, mistakenEq.text,
    'a failed crop confirmation must not silently replace a possibly Roman numeral');
  assert.deepEqual(unresolvedEq.referenceReviewConflicts,
    [{ source: 'Eq. I', alternative: 'Eq. 1' }],
    'a same-row reference disagreement must remain visible when the third reading is inconclusive');
  const unprimedDefinition = await fixture('unprimed-channel-definition',
    '<div>In this image, C is the number of channels, and the patch width is fixed.</div>',
    { width: 990, height: 125,
      bodyStyle: 'margin:0;padding:15px 30px;font:23px/1.4 Georgia,serif;background:white;color:#111' });
  const definitionTruth = await service.performOCR(unprimedDefinition, { characters: true });
  const channelRow = definitionTruth.blocks.find((block) => /\bC'? is the number of channels\b/u.test(block.text));
  assert(channelRow, `printed channel OCR: ${JSON.stringify(definitionTruth.blocks.map((block) => block.text))}`);
  assert(channelRow.characters?.length === Array.from(channelRow.text).length,
    'the printed unprimed channel definition must have character-located pixels');
  const naturallyPrimed = channelRow.text.includes("C' is");
  if (naturallyPrimed) assert(channelRow.alternatives?.includes(channelRow.text.replace("C' is", 'C is')),
    'a mistaken primed reading needs the unprimed source-pixel candidate for review');
  else assert.deepEqual(service.findPrimeDefinitionConflicts({ blocks: [channelRow] }), [],
    'a correct unprimed definition does not need a prime warning');
  // Vision versions may now read this source correctly. Retain a separate
  // injected competing-reading check instead of requiring the OCR to fail.
  const disputedChannel = naturallyPrimed ? channelRow : { ...channelRow,
    text: channelRow.text.replace('C is', "C' is"), alternatives: [channelRow.text] };
  const primeCheck = service.findPrimeDefinitionConflicts({ blocks: [disputedChannel] });
  assert.deepEqual(primeCheck,
    [{ source: "C'", alternative: 'C' }],
    'a competing Vision reading of a printed variable definition must be surfaced without rewriting it');
  assert.equal(disputedChannel.text.includes("C' is"), true,
    'a disputed prime remains in the source until the reader checks the image');
  assert.deepEqual(service.findPrimeDefinitionConflicts({ blocks: [disputedChannel] },
    'In this image, $C$ is the number of channels.'), [],
  'a prime warning must disappear when the rendered result no longer contains that primed definition');
  const eigenvalueZero = await fixture('prose-eigenvalue-zero',
    '<div>Assume that f is an eigenvector with eigenvalue 0. Then we know that its quadratic form vanishes.</div>',
    { width: 950, height: 125, bodyStyle: 'margin:0;padding:14px 24px;font:23px/1.5 Menlo,monospace;background:white;color:#111' });
  const zeroTruth = await service.performOCR(eigenvalueZero, { characters: true });
  const zeroRow = zeroTruth.blocks.find((block) => /eigenvalue 0\. Then/u.test(block.text));
  assert(zeroRow, `authored zero OCR rows: ${JSON.stringify(zeroTruth.blocks.map((block) => block.text))}`);
  assert(zeroRow?.characters?.length === Array.from(zeroRow.text).length,
    'the authored zero must have character-located source pixels');
  const zeroIndex = Array.from(zeroRow.text.slice(0,
    zeroRow.text.indexOf('eigenvalue 0') + 'eigenvalue '.length)).length;
  const mistakenRow = { ...zeroRow, text: zeroRow.text.slice(0, zeroIndex) + 'O' + zeroRow.text.slice(zeroIndex + 1),
    characters: zeroRow.characters.map((char, i) => i === zeroIndex ? { ...char, text: 'O' } : char) };
  const mistakenZero = { blocks: [mistakenRow] };
  const correctedZero = await service.recheckAmbiguousProseZero(eigenvalueZero, mistakenZero,
    { blocks: [zeroRow] }, work);
  assert.match(correctedZero.blocks[0].text, /eigenvalue 0\. Then/u,
    'two source-pixel crops must restore the numeric eigenvalue after masked OCR disagreement');
  assert.deepEqual(correctedZero.verifiedGlyphConflicts, [{ source: 'O', alternative: '0' }],
    'the image-backed correction must remain visible for reader review');
  assert.equal((await service.recheckAmbiguousProseZero(eigenvalueZero, mistakenZero,
    { blocks: [] }, work)).blocks[0].text, mistakenRow.text,
  'a crop cannot change prose without a same-location masked candidate');
  assert.equal((await service.recheckAmbiguousProseZero(eigenvalueZero, mistakenZero,
    { blocks: [zeroRow] }, work, { recognize: async () => ({ text: 'eigenvalue O. Then', confidence: 1 }) })).blocks[0].text,
  mistakenRow.text, 'a competing source-pixel reading cannot silently change the digit');
  results.push({ case: 'weak-inline-accent-wide-excerpt', ...weakAccentResult.formulaOcr,
    text: weakAccentResult.text });
  const wideAlgorithm = await fixture('wide-numbered-algorithm',
    `<div style="border-top:1px solid;border-bottom:1px solid;padding:10px 0 14px">
      <div><b>Algorithm 5.1</b> Orthogonalization procedure</div>
      <div>given vectors ${math('a_1,\\ldots,a_k')}</div>
      <div>for ${math('i=1,\\ldots,k')},</div>
      <div>1. Remove projections. ${math('\\tilde q_i=a_i-(q_1^Ta_i)q_1-\\cdots-(q_{i-1}^Ta_i)q_{i-1}')}</div>
      <div>2. Stop if ${math('\\tilde q_i=0')}.</div>
      <div>3. Normalize. ${math('q_i=\\tilde q_i/\\Vert\\tilde q_i\\Vert')}</div>
    </div>`,
    { width: 1492, height: 402,
      bodyStyle: 'margin:0;padding:18px 68px;font:26px/1.45 Georgia,serif;background:white;color:#111' });
  const wideAlgorithmResult = await service.performReadingOCR(wideAlgorithm);
  assert.match(wideAlgorithmResult.text, /\\tilde\s*\{?\s*q\s*\}?\s*_\s*\{?\s*i/u,
    'a wide algorithm excerpt must preserve the marked orthogonalized vector');
  assert.match(wideAlgorithmResult.text, /\\(?:Vert|\|)\s*\\tilde/u,
    'the normalization denominator must remain a norm of the marked vector');
  const algorithmMath = mathRanges(wideAlgorithmResult.text).map(({ tex }) => tex);
  assert(algorithmMath.some((tex) => /\\tilde/u.test(tex) && /-\s*\(/u.test(tex)),
    'orthogonalization must subtract a projection from the marked vector');
  assert(algorithmMath.some((tex) => /\\tilde/u.test(tex) && /=\s*0/u.test(tex)),
    'the zero-vector stop condition must remain mathematical notation');
  assert.doesNotMatch(wideAlgorithmResult.text, /ği|qFai/u,
    'Vision-only substitutes must not replace the mathematical expressions');
  results.push({ case: 'wide-numbered-algorithm', ...wideAlgorithmResult.formulaOcr,
    text: wideAlgorithmResult.text });
  const wideProse = await fixture('wide-numbered-prose',
    '<div><b>Section 5.1</b> Reading instructions</div>'
    + '<div>First, read the definitions and compare each sentence with its source.</div>'
    + '<div>Second, keep a short note about the central idea for later review.</div>'
    + '<div>Third, revisit the original page whenever the explanation is unclear.</div>',
    { width: 1492, height: 402,
      bodyStyle: 'margin:0;padding:18px 68px;font:26px/1.45 Georgia,serif;background:white;color:#111' });
  const wideProseResult = await service.performReadingOCR(wideProse);
  assert.equal(wideProseResult.formulaOcr.count, 0,
    'the wide-crop fallback must not turn numbered prose into mathematics');
  results.push({ case: 'wide-numbered-prose', ...wideProseResult.formulaOcr });
  const articleBesideMath = await fixture('definition-prose-article',
    `<div>A list of vectors is linearly dependent if</div>
      <div style="text-align:center">${math('\\beta_1a_1+\\cdots+\\beta_ka_k=0', true)}</div>
      <div>In other words, we can form the zero vector as a linear combination of the vectors, with coefficients that are not all zero.</div>`,
    { width: 1692, height: 422,
      bodyStyle: 'margin:0;padding:18px 28px;font:26px/1.45 Georgia,serif;background:white;color:#111' });
  const articleResult = await service.performReadingOCR(articleBesideMath);
  assert.match(articleResult.text, /zero vector as a linear combination/u,
    'an ordinary article beside a mathematical definition must remain prose');
  assert.doesNotMatch(articleResult.text, /\\(?:varepsilon|epsilon)/u,
    'single-glyph math recheck must not turn an English article into epsilon');
  results.push({ case: 'definition-prose-article', ...articleResult.formulaOcr,
    text: articleResult.text });
  const tupleSource = 'S4 models are defined with four parameters (4, A, B, C), which define a transformation.';
  const tupleCharacters = (source) => Array.from(source, (letter, index) => ({ text: letter,
    boundingBox: letter === ' ' ? { x: 0, y: 1, w: 0, h: 0 }
      : { x: .02 + index * .005, y: .5, w: .005, h: .05 } }));
  const tupleCandidates = characterCandidates({ blocks: [{ text: tupleSource,
    characters: tupleCharacters(tupleSource) }] }, { width: 1400, height: 700 }, []);
  assert.deepEqual(tupleCandidates.filter((candidate) => candidate.tupleLetters)
    .map((candidate) => candidate.tupleLetters), [['A', 'B', 'C']],
  'a suspected Delta in a named parameter tuple must be rechecked as a complete formula');
  const placeholderText = 'Unlike the kernel lifting $, z is low-dimensional.';
  const placeholderCharacters = Array.from(placeholderText, (letter) => ({ text: letter,
    boundingBox: letter === '$' ? { x: .25, y: .7, w: 39 / 1542, h: 44 / 282 }
      : { x: 0, y: 0, w: 0, h: 0 } }));
  assert(characterCandidates({ blocks: [{ text: placeholderText, characters: placeholderCharacters }] },
    { width: 1542, height: 282 }, []).some((candidate) => candidate.priority === -1),
  'a slightly tall currency-shaped Vision placeholder must reach three-crop math recheck');
  const omegaLookalike = 'when w is drawn from p.';
  const omegaCharacters = Array.from(omegaLookalike, (letter, index) => ({ text: letter,
    boundingBox: letter === 'w' ? { x: (index === 0 ? 500 : 854) / 1562, y: 6 / 62,
      w: 23 / 1562, h: 44 / 62 } : { x: 0, y: 0, w: 0, h: 0 } }));
  assert.equal(characterCandidates({ blocks: [{ text: omegaLookalike, characters: omegaCharacters }] },
    { width: 1562, height: 62 }, []).filter((candidate) => candidate.sourceGlyph === 'w').length, 1,
  'a standalone w in a tight one-line screenshot reaches pixel recheck, but the w in when does not');
  const plainTuple = tupleSource.replace('parameters', 'examples');
  assert.equal(characterCandidates({ blocks: [{ text: plainTuple,
    characters: tupleCharacters(plainTuple) }] }, { width: 1400, height: 700 }, [])
    .filter((candidate) => candidate.tupleLetters).length, 0,
  'an ordinary numeric tuple must not be promoted into Delta without parameter context');
  const authoredTuple = await fixture('parameter-tuple-delta',
    `<div>Concretely, S4 models are defined with four parameters ${math('(\\Delta,\\boldsymbol{A},\\boldsymbol{B},\\boldsymbol{C})')}, which define a sequence-to-sequence transformation.</div>`,
    { width: 1140, height: 145, bodyStyle: 'margin:0;padding:15px 28px;font:23px/1.4 Georgia,serif;background:white;color:#111' });
  const authoredTupleResult = await service.performReadingOCR(authoredTuple);
  assert.match(authoredTupleResult.text, /four parameters \$[^$]*\\Delta[^$]*\$|four parameters \(Δ,/u,
    'the reading text must keep Delta in the stated S4 parameter tuple');
  results.push({ case: 'authored-parameter-tuple-delta', ...authoredTupleResult.formulaOcr,
    text: authoredTupleResult.text });
  const numericTuple = await fixture('parameter-tuple-numeric-control',
    `<div>For this example, the four parameters (4, A, B, C) define a sequence-to-sequence transformation.</div>`,
    { width: 1140, height: 125, bodyStyle: 'margin:0;padding:15px 28px;font:23px/1.4 Georgia,serif;background:white;color:#111' });
  const numericTupleResult = await service.performReadingOCR(numericTuple);
  assert.match(numericTupleResult.text, /four parameters\s+\(4, A, B, C\)/u,
    'a genuine numeric first tuple member must remain 4');
  assert.doesNotMatch(numericTupleResult.text, /\\Delta/u,
    'the parameter-tuple recheck must not invent Delta on a printed numeral');
  results.push({ case: 'authored-parameter-tuple-numeric-control', ...numericTupleResult.formulaOcr,
    text: numericTupleResult.text });
  const plainLetter = await fixture('wide-plain-letter',
    '<div>A classifier f assigns a probability to each possible class. The calibration sample contains images and labels.</div>'
    + '<div>Using f and the calibration data, we construct a prediction set for a new observation.</div>'
    + '<div>The argument below explains why this set has marginal coverage over repeated samples.</div>',
    { width: 920, height: 282, bodyStyle: 'margin:0;padding:8px 46px;font:18px/1.32 Georgia,serif;background:white;color:#111' });
  const plainLetterResult = await service.performReadingOCR(plainLetter);
  assert.doesNotMatch(plainLetterResult.text, /\\hat\s*\{?f/u,
    'wide prose with a plain f must not acquire a mathematical accent');
  results.push({ case: 'wide-plain-letter-no-accent', ...plainLetterResult.formulaOcr,
    text: plainLetterResult.text });
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
  const plainDimensions = await fixture('plain-matrix-dimensions',
    `<div>Let ${math('W_0\\in\\mathbb{R}^{d\\times k}')} be the original matrix. Its update uses ${math('B\\in\\mathbb{R}^{d\\times r}')} and ${math('A\\in\\mathbb{R}^{r\\times k}')}.</div>`,
    { width: 1040, height: 175, bodyStyle: 'margin:0;padding:16px 28px;font:22px/1.45 Georgia,serif;background:white;color:#111' });
  const plainDimensionsResult = await service.performReadingOCR(plainDimensions);
  const dimensionRanges = mathRanges(plainDimensionsResult.text);
  assert(dimensionRanges.length >= 1, 'self-authored matrix dimensions must reach formula review');
  for (const range of dimensionRanges.filter((item) => /\\(?:breve|vec|hat|tilde|bar)\s*\{?\s*k/u.test(item.tex))) {
    assert(plainDimensionsResult.formulaOcr.uncertainStarts.includes(range.start),
      'an invented accent on a plain dimension must never pass without a review marker');
  }
  results.push({ case: 'authored-plain-matrix-dimensions', ...plainDimensionsResult.formulaOcr,
    text: plainDimensionsResult.text });
  for (const { name, file } of formulaFixtures) {
    const result = await service.performReadingOCR(file);
    assert.equal(result.formulaOcr.status, 'done', name);
    const tex = compact(result.text);
    if (name === 'fraction') { assert.match(tex, /\\(?:c)?frac/); assert.match(tex, /\\sqrt/); }
    if (name === 'accent') { assert.match(tex, /\\(?:widehat|hat)\{(?:\\boldsymbol\{)?m\}/); assert.match(tex, /\\beta/); }
    if (name === 'expectation') { assert.match(tex, /\\theta/); assert.match(tex, /U/); }
    for (const item of mathRanges(result.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false, displayMode: item.display });
    results.push({ case: name, ...result.formulaOcr, text: result.text });
  }
  const authoredMismatch = await fixture('authored-regularizer-mismatch', katex.renderToString(
    String.raw`\begin{aligned}E &= \frac{1}{2}\sum_i (R_i - Y_i)^2 \\ &+ \frac{\lambda_Y}{2}\sum_i\parallel Y_i\parallel^2 + \frac{\lambda_Y}{2}\sum_j\parallel V_j\parallel^2 + \frac{\lambda_W}{2}\sum_k\parallel W_k\parallel^2\end{aligned}`,
    { displayMode: true, throwOnError: true }),
  { width: 830, height: 280, bodyStyle: 'margin:0;padding:36px;background:white' });
  const mismatchResult = await service.performReadingOCR(authoredMismatch);
  assert.deepEqual(suspiciousRegularizerSubscript(mismatchResult.text),
    { coefficient: 'Y', variable: 'V' },
    'an intentionally printed coefficient mismatch must not be silently normalized by the focused recheck');
  results.push({ case: 'authored-regularizer-mismatch-control', ...mismatchResult.formulaOcr,
    text: mismatchResult.text });
  const matrix = await fixture('matrix', '<p>A symmetric matrix and a sample mean:</p>' + katex.renderToString(
    String.raw`A=\begin{pmatrix}a&b\\b&c\end{pmatrix},\qquad \bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`, { displayMode: true }));
  const matrixResult = await service.performReadingOCR(matrix);
  const matrixTex = compact(matrixResult.text);
  assert.match(matrixTex.replace(/\{([abc])\}/g, '$1'), /\\begin\{[pb]?matrix\}a&b\\\\b&c/);
  assert.match(matrixTex, /\\frac\{1\}\{n\}/);
  for (const item of mathRanges(matrixResult.text)) katex.renderToString(item.tex, { throwOnError: true, trust: false, displayMode: item.display });
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
  for (const [name, latex, expected] of [
    ['overline', String.raw`q=\overline{(y\mid x)}`, /^q=\\(?:overline|bar)\{\{?\(y\\midx\)\}?\}$/u],
    ['widehat', String.raw`q=\widehat{(y\mid x)}`, /^q=\\(?:widehat|hat)\{\(y\\midx\)\}$/u],
    ['bar-symbol', String.raw`q=\bar{y}(y\mid x)`, /^q=\\bar\{y\}\(y\\midx\)$/u],
  ]) {
    const image = await fixture(`real-conditional-accent-${name}`,
      '<div>The printed accent is part of this mathematical definition.</div>'
      + `<div>In this example, ${math(latex)} denotes a transformed value.</div>`,
      { width: 920, height: 180, bodyStyle: 'margin:0;padding:16px 28px;font:24px/1.4 Georgia;background:white;color:black' });
    const result = await service.performReadingOCR(image);
    assert.equal(mathRanges(result.text).length, 1, 'the accented expression must stay intact');
    assert.match(compact(mathRanges(result.text)[0].tex), expected,
      'real printed accents must survive the conditional-accent recheck');
    results.push({ case: `real-conditional-accent-${name}`, ...result.formulaOcr, text: result.text });
  }

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
  const pending = service.performReadingOCR(captureFixture, { signal: during.signal });
  setTimeout(() => during.abort(), 25);
  await assert.rejects(pending, (error) => error.isCancellation);

  if (pixelsOnly) {
    fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ scope: 'offline pixels and cancellation; no reading-window acceptance', passed: results.map((item) => item.case), evidence: work }));
    return;
  }

  // Exercise the actual capture -> local OCR -> review -> rendered math path.
  // Only the OS selection is substituted with a rendered, authored formula.
  let providerCalls = 0;
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    getSettings: () => ({ setupMode: 'translation-only', activeBackend: 'free_translate' }), getMainWindow: () => null,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => { const capture = path.join(work, 'capture.png'); fs.copyFileSync(captureFixture, capture); return capture; },
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
  assert(await pin.webContents.executeJavaScript('document.querySelectorAll("#source-preview .katex").length >= 1'));
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
