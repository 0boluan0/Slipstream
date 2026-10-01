'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

if (process.platform !== 'darwin') { console.log('Apple Vision glyph pixel check skipped.'); process.exit(0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-prose-glyph-'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(profile, 'profile'));
app.setPath('sessionData', path.join(profile, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Prose-glyph OCR timed out'); app.exit(1); }, 45000).unref();

// Native crop recognition can remain inconclusive across macOS versions. Keep
// the correction contract deterministic, and report native corroboration apart.
function cropResponse(value, calls = []) {
  return async file => {
    const png = fs.readFileSync(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the checker receives source-pixel PNG crops');
    calls.push(path.basename(file));
    return structuredClone(value);
  };
}
const withStrongRows = value => ({ ...value, blocks: value.blocks.map(block => ({ ...block, confidence: 1 })) });
function reportNative(name, result, readText, sourceText, expectedText, crops) {
  const actual = readText(result), corroborated = actual === expectedText;
  assert(actual === sourceText || corroborated, `${name}: a native reread must not invent a third result`);
  console.log(JSON.stringify({ nativeOcrCorroboration: { case: name,
    wholeImageBaselinePassed: true, outcome: corroborated ? 'corroborated' : 'unresolved', crops } }));
  return corroborated;
}


app.whenReady().then(async () => {
  app.dock?.hide();
  const window = new BrowserWindow({ width: 1112, height: 100, show: false,
    useContentSize: true, webPreferences: { sandbox: true } });
  const html = '<!doctype html><meta charset="utf-8"><style>'
    + 'html,body{width:1112px;height:100px;margin:0;background:#fff;color:#111;overflow:hidden}'
    + '.prose{position:absolute;left:24px;top:5px;font:26px/47px "Times New Roman",serif;white-space:nowrap}'
    + '</style><div class="prose">where T is a temperature normally set to 1. A higher T softens the outputs.<br>'
    + 'Class probabilities remain normalized.</div>';
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const imagePath = path.join(profile, 'authored-temperature.png');
  fs.writeFileSync(imagePath, (await window.webContents.capturePage()).toPNG());
  require('./prepare-ocr-test')(imagePath);
  const { performOCR, recheckIsolatedProseGlyphs, recheckProseTokens, recheckReferenceOne } = require('../src/main/ocr-service');
  const padded = await performOCR(imagePath, { characters: true, padEdges: true });
  assert.match(padded.blocks[0]?.text || '', /\bT\b.*\bT\b/u,
    'the local authored image must expose both printed variables');
  assert.match(padded.blocks[0].text, /temperature normally set to 1\. A higher T softens the outputs/u,
    'the authored baseline must retain the prose and printed digit');
  const strongPadded = withStrongRows(padded);
  const nativeCrops = [];
  const recognizeNative = async (file, options) => {
    const result = await performOCR(file, options);
    nativeCrops.push({ crop: path.basename(file), readings: (result.blocks?.length ? result.blocks : [result])
      .map(({ text, confidence }) => ({ text, confidence })) });
    return result;
  };
  const wrong = padded.blocks[0].text.replace(' T ', " I' ").replace(' T ', ' I ');
  assert.notEqual(wrong, padded.blocks[0].text);
  const source = { ...padded, text: [wrong, ...padded.blocks.slice(1).map((block) => block.text)].join('\n'),
    blocks: [{ ...padded.blocks[0], text: wrong }, ...padded.blocks.slice(1)] };
  const strongSource = withStrongRows(source), glyphCrops = [];
  const repaired = await recheckIsolatedProseGlyphs(imagePath, strongSource, strongPadded,
    { recognize: cropResponse({ blocks: [{ text: padded.blocks[0].text, confidence: 1 }] }, glyphCrops) });
  assert.equal(glyphCrops.length, 1, 'the deterministic glyph correction must consult its pixel crop');
  assert.equal(repaired.recovered, 1, 'an agreeing high-confidence crop confirms the padded glyphs');
  assert.equal(repaired.ocr.blocks[0].text, padded.blocks[0].text);
  assert.deepEqual(repaired.conflicts.map(({ source: from, alternative, verified }) =>
    ({ source: from, alternative, verified })), [{ source: "I'、I", alternative: 'T', verified: true }]);
  for (const local of [null, { blocks: [{ text: wrong, confidence: 1 }] },
    { blocks: [{ text: padded.blocks[0].text, confidence: .5 }] },
    { blocks: [{ text: padded.blocks[0].text + ' Added words.', confidence: 1 }] }]) {
    const rejected = await recheckIsolatedProseGlyphs(imagePath, strongSource, strongPadded,
      { recognize: cropResponse(local) });
    assert.equal(rejected.recovered, 0, 'inconclusive, conflicting, weak and partial-match glyph crops cannot correct prose');
    assert.equal(rejected.ocr, strongSource);
    assert(rejected.conflicts.every(conflict => conflict.verified === false));
  }
  const nativeGlyph = await recheckIsolatedProseGlyphs(imagePath, source, padded, { recognize: recognizeNative });
  const glyphAgreed = reportNative('isolated-temperature-glyphs', nativeGlyph, value => value.ocr.blocks[0].text,
    wrong, padded.blocks[0].text, nativeCrops.splice(0));
  assert.equal(nativeGlyph.recovered, glyphAgreed ? 1 : 0);
  assert(nativeGlyph.conflicts.every(conflict => conflict.verified === glyphAgreed));
  if (!glyphAgreed) assert.deepEqual(nativeGlyph.ocr, source, 'an unresolved native crop preserves the source');
  const wrongPadded = { ...strongPadded, blocks: [{ ...strongPadded.blocks[0],
    text: padded.blocks[0].text.replaceAll(' T ', ' B ') }, ...strongPadded.blocks.slice(1)] };
  const rejected = await recheckIsolatedProseGlyphs(imagePath, strongSource, wrongPadded,
    { recognize: cropResponse({ blocks: [{ text: padded.blocks[0].text, confidence: 1 }] }) });
  assert.equal(rejected.recovered, 0, 'an agreeing reading of the real text rejects an incorrect padded candidate');
  assert.equal(rejected.ocr, strongSource);
  assert.equal(rejected.conflicts[0].verified, false);
  const wrongTokens = padded.blocks[0].text.replace(' T ', ' B ').replace('normally', 'nornally');
  const tokenSource = { ...padded, blocks: [{ ...padded.blocks[0], text: wrongTokens }, ...padded.blocks.slice(1)] };
  const strongTokenSource = withStrongRows(tokenSource), tokenCrops = [];
  const tokenRepair = await recheckProseTokens(imagePath, strongTokenSource, strongPadded, profile,
    { recognize: cropResponse({ blocks: [{ text: padded.blocks[0].text, confidence: 1 }] }, tokenCrops) });
  assert.equal(tokenCrops.length, 1, 'the deterministic token correction must consult its pixel crop');
  assert.equal(tokenRepair.verifiedProseRows, 1,
    'a source-pixel line reread must confirm both the letter and spelling before replacing either');
  assert.equal(tokenRepair.blocks[0].text, padded.blocks[0].text);
  assert.deepEqual(tokenRepair.proseTokenConflicts,
    [{ source: 'B', alternative: 'T', symbol: true, verified: true },
      { source: 'nornally', alternative: 'normally', symbol: false, verified: true }]);
  for (const local of [null, { blocks: [{ text: wrongTokens, confidence: 1 }] },
    { blocks: [{ text: padded.blocks[0].text, confidence: .5 }] },
    { blocks: [{ text: padded.blocks[0].text + ' Added words.', confidence: 1 }] }]) {
    const refused = await recheckProseTokens(imagePath, strongTokenSource, strongPadded, profile,
      { recognize: cropResponse(local) });
    assert.equal(refused.blocks[0].text, wrongTokens,
      'an inconclusive, conflicting, weak or partial-match crop cannot silently change prose');
    assert(refused.proseTokenConflicts.every((conflict) => conflict.verified === false));
  }
  await assert.rejects(recheckProseTokens(imagePath, strongTokenSource, strongPadded, profile,
    { recognize: async () => { throw Object.assign(new Error('cancel'), { isCancellation: true }); } }),
  (error) => error.isCancellation, 'source rereads must propagate cancellation');
  const nativeTokens = await recheckProseTokens(imagePath, tokenSource, padded, profile, { recognize: recognizeNative });
  const tokensAgreed = reportNative('temperature-prose-tokens', nativeTokens, value => value.blocks[0].text,
    wrongTokens, padded.blocks[0].text, nativeCrops.splice(0));
  assert.equal(nativeTokens.verifiedProseRows || 0, tokensAgreed ? 1 : 0);
  assert((nativeTokens.proseTokenConflicts || []).every(conflict => conflict.verified === tokensAgreed));
  if (!tokensAgreed) assert.deepEqual(nativeTokens.blocks, tokenSource.blocks);
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><style>body{margin:12px 24px;font:26px/42px "Times New Roman";background:white;color:black}</style>'
    + 'We minimize the average loss in (1) over all training examples.<br>Separate observations follow below.'));
  const referenceImage = path.join(profile, 'authored-parenthesized-reference.png');
  fs.writeFileSync(referenceImage, (await window.webContents.capturePage()).toPNG());
  const referenceOcr = await performOCR(referenceImage, { characters: true });
  const referenceRow = referenceOcr.blocks.find((block) => block.text.includes('(1)'));
  assert.equal(referenceRow?.text, 'We minimize the average loss in (1) over all training examples.',
    'the whole authored reference image must preserve its printed digit and surrounding prose');
  assert(referenceRow?.characters?.length === [...referenceRow.text].length);
  const strongReference = withStrongRows(referenceOcr);
  const refAt = referenceRow.text.indexOf('(1)');
  const mistakenReference = { ...referenceRow, text: referenceRow.text.replace('(1)', '(I)'),
    characters: referenceRow.characters.map((char, i) => i === refAt + 1 ? { ...char, text: 'I' } : char) };
  const referenceSource = { blocks: [mistakenReference] }, referenceCrops = [];
  const checkedReference = await recheckReferenceOne(referenceImage,
    referenceSource, strongReference, profile,
    { recognize: cropResponse({ text: 'loss in (1)', confidence: 1 }, referenceCrops) });
  assert.equal(referenceCrops.length, 1);
  assert.equal(checkedReference.blocks[0].text, referenceRow.text,
    'an agreeing high-confidence pixel reading permits parenthesized I/1 correction');
  assert.deepEqual(checkedReference.verifiedGlyphConflicts, [{ source: '(I)', alternative: '(1)' }]);
  const nativeReference = await recheckReferenceOne(referenceImage, referenceSource, referenceOcr, profile,
    { recognize: recognizeNative });
  const referenceAgreed = reportNative('parenthesized-reference', nativeReference, value => value.blocks[0].text,
    mistakenReference.text, referenceRow.text, nativeCrops.splice(0));
  assert.deepEqual(nativeReference.verifiedGlyphConflicts || [], referenceAgreed ? [{ source: '(I)', alternative: '(1)' }] : []);
  if (!referenceAgreed) assert.deepEqual(nativeReference.blocks, referenceSource.blocks);
  const cutReference = { ...referenceRow, text: referenceRow.text.slice(0, refAt + 2),
    characters: referenceRow.characters.slice(0, refAt + 2) };
  const cutSource = { blocks: [cutReference] }, cutCrops = [];
  const checkedCut = await recheckReferenceOne(referenceImage,
    cutSource, { blocks: [] }, profile, { supportingOcr: strongReference,
      recognize: cropResponse({ text: 'loss in (1)', confidence: 1 }, cutCrops) });
  assert.equal(cutCrops.length, 1);
  assert.equal(checkedCut.blocks[0].text, referenceRow.text.slice(0, refAt + 3),
    'a split OCR block may recover its closing parenthesis only from agreeing source pixels');
  assert.equal(checkedCut.blocks[0].characters.map((char) => char.text).join(''), checkedCut.blocks[0].text);
  const nativeCut = await recheckReferenceOne(referenceImage, cutSource, { blocks: [] }, profile,
    { supportingOcr: referenceOcr, recognize: recognizeNative });
  const cutAgreed = reportNative('split-reference-parenthesis', nativeCut, value => value.blocks[0].text,
    cutReference.text, referenceRow.text.slice(0, refAt + 3), nativeCrops.splice(0));
  assert.deepEqual(nativeCut.verifiedGlyphConflicts || [], cutAgreed ? [{ source: '(1', alternative: '(1)' }] : []);
  assert.equal(nativeCut.blocks[0].characters.map(char => char.text).join(''), nativeCut.blocks[0].text);
  if (!cutAgreed) assert.deepEqual(nativeCut.blocks, cutSource.blocks);
  for (const alternative of [{ blocks: [] }, { blocks: [{ ...referenceRow,
    text: referenceRow.text.replace('(1)', '(I)') }] }, { blocks: [{ ...referenceRow,
    characters: referenceRow.characters.map((char) => ({ ...char,
      boundingBox: { ...char.boundingBox, x: char.boundingBox.x + .2 } })) }] }]) {
    assert.equal((await recheckReferenceOne(referenceImage, { blocks: [mistakenReference] }, alternative, profile))
      .blocks[0].text, mistakenReference.text, 'a Roman numeral cannot change without a differing reading at the same pixels');
  }
  for (const [original, pair, options] of [
    [referenceSource, { source: '(I)', alternative: '(1)' }, {}],
    [cutSource, { source: '(1', alternative: '(1)' }, { supportingOcr: strongReference }],
  ]) {
    for (const local of [null, { text: 'loss in (I)', confidence: 1 },
      { text: 'loss in (1)', confidence: .5 }, { text: 'loss in (1) added words', confidence: 1 }]) {
      const unconfirmedReference = await recheckReferenceOne(referenceImage, original,
        original === cutSource ? { blocks: [] } : strongReference, profile,
        { ...options, recognize: cropResponse(local) });
      assert.deepEqual(unconfirmedReference.blocks, original.blocks,
        'weak, conflicting and partial reference crop readings must preserve the entire source');
      assert.deepEqual(unconfirmedReference.verifiedGlyphConflicts, []);
      assert.deepEqual(unconfirmedReference.referenceReviewConflicts, [pair],
        'an unconfirmed local reading exposes its disagreement');
    }
  }
  window.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('Authored whole-image baselines and deterministic source-pixel correction contracts passed. Native crop corroboration outcomes are reported separately above; unresolved outcomes are not semantic quality passes.');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
