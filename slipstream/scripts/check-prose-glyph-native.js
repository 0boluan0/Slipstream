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
  const wrong = padded.blocks[0].text.replace(' T ', " I' ").replace(' T ', ' I ');
  assert.notEqual(wrong, padded.blocks[0].text);
  const source = { ...padded, text: [wrong, ...padded.blocks.slice(1).map((block) => block.text)].join('\n'),
    blocks: [{ ...padded.blocks[0], text: wrong }, ...padded.blocks.slice(1)] };
  const repaired = await recheckIsolatedProseGlyphs(imagePath, source, padded);
  assert.equal(repaired.recovered, 1, 'a whole-line crop must independently confirm the padded glyphs');
  assert.equal(repaired.ocr.blocks[0].text, padded.blocks[0].text);
  assert.deepEqual(repaired.conflicts.map(({ source: from, alternative, verified }) =>
    ({ source: from, alternative, verified })), [{ source: "I'、I", alternative: 'T', verified: true }]);
  const wrongPadded = { ...padded, blocks: [{ ...padded.blocks[0],
    text: padded.blocks[0].text.replaceAll(' T ', ' B ') }, ...padded.blocks.slice(1)] };
  const rejected = await recheckIsolatedProseGlyphs(imagePath, source, wrongPadded);
  assert.equal(rejected.recovered, 0, 'the crop must reject an incorrect padded candidate');
  assert.equal(rejected.ocr, source, 'an unsupported alternative leaves the source intact');
  assert.equal(rejected.conflicts[0].verified, false);
  const wrongTokens = padded.blocks[0].text.replace(' T ', ' B ').replace('normally', 'nornally');
  const tokenSource = { ...padded, blocks: [{ ...padded.blocks[0], text: wrongTokens }, ...padded.blocks.slice(1)] };
  const tokenRepair = await recheckProseTokens(imagePath, tokenSource, padded, profile);
  assert.equal(tokenRepair.verifiedProseRows, 1,
    'a source-pixel line reread must confirm both the letter and spelling before replacing either');
  assert.equal(tokenRepair.blocks[0].text, padded.blocks[0].text);
  assert.deepEqual(tokenRepair.proseTokenConflicts,
    [{ source: 'B', alternative: 'T', symbol: true, verified: true },
      { source: 'nornally', alternative: 'normally', symbol: false, verified: true }]);
  for (const local of [null, { blocks: [{ text: wrongTokens, confidence: 1 }] },
    { blocks: [{ text: padded.blocks[0].text, confidence: .5 }] },
    { blocks: [{ text: padded.blocks[0].text + ' Added words.', confidence: 1 }] }]) {
    const refused = await recheckProseTokens(imagePath, tokenSource, padded, profile,
      { recognize: async () => local });
    assert.equal(refused.blocks[0].text, wrongTokens,
      'an inconclusive, conflicting, weak or partial-match crop cannot silently change prose');
    assert(refused.proseTokenConflicts.every((conflict) => conflict.verified === false));
  }
  await assert.rejects(recheckProseTokens(imagePath, tokenSource, padded, profile,
    { recognize: async () => { throw Object.assign(new Error('cancel'), { isCancellation: true }); } }),
  (error) => error.isCancellation, 'source rereads must propagate cancellation');
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><style>body{margin:12px 24px;font:26px/42px "Times New Roman";background:white;color:black}</style>'
    + 'We minimize the average loss in (1) over all training examples.<br>Separate observations follow below.'));
  const referenceImage = path.join(profile, 'authored-parenthesized-reference.png');
  fs.writeFileSync(referenceImage, (await window.webContents.capturePage()).toPNG());
  const referenceOcr = await performOCR(referenceImage, { characters: true });
  const referenceRow = referenceOcr.blocks.find((block) => block.text.includes('(1)'));
  assert(referenceRow?.characters?.length === [...referenceRow.text].length);
  const refAt = referenceRow.text.indexOf('(1)');
  const mistakenReference = { ...referenceRow, text: referenceRow.text.replace('(1)', '(I)'),
    characters: referenceRow.characters.map((char, i) => i === refAt + 1 ? { ...char, text: 'I' } : char) };
  const checkedReference = await recheckReferenceOne(referenceImage,
    { blocks: [mistakenReference] }, referenceOcr, profile);
  assert.equal(checkedReference.blocks[0].text, referenceRow.text,
    'a parenthesized I/1 disagreement needs an agreeing local pixel reading');
  const cutReference = { ...referenceRow, text: referenceRow.text.slice(0, refAt + 2),
    characters: referenceRow.characters.slice(0, refAt + 2) };
  const checkedCut = await recheckReferenceOne(referenceImage,
    { blocks: [cutReference] }, { blocks: [] }, profile, { supportingOcr: referenceOcr });
  assert.equal(checkedCut.blocks[0].text, referenceRow.text.slice(0, refAt + 3),
    'a split OCR block may recover its closing parenthesis only from agreeing source pixels');
  assert.equal(checkedCut.blocks[0].characters.map((char) => char.text).join(''), checkedCut.blocks[0].text);
  for (const alternative of [{ blocks: [] }, { blocks: [{ ...referenceRow,
    text: referenceRow.text.replace('(1)', '(I)') }] }, { blocks: [{ ...referenceRow,
    characters: referenceRow.characters.map((char) => ({ ...char,
      boundingBox: { ...char.boundingBox, x: char.boundingBox.x + .2 } })) }] }]) {
    assert.equal((await recheckReferenceOne(referenceImage, { blocks: [mistakenReference] }, alternative, profile))
      .blocks[0].text, mistakenReference.text, 'a Roman numeral cannot change without a differing reading at the same pixels');
  }
  const unconfirmedReference = await recheckReferenceOne(referenceImage,
    { blocks: [mistakenReference] }, referenceOcr, profile,
    { recognize: async () => ({ text: 'loss in (I)', confidence: 1 }) });
  assert.equal(unconfirmedReference.blocks[0].text, mistakenReference.text);
  assert.deepEqual(unconfirmedReference.referenceReviewConflicts, [{ source: '(I)', alternative: '(1)' }],
    'a conflicting local reading must retain the source and expose the disagreement');
  window.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('Authored isolated-symbol pixels: crop-confirmed correction and unsupported-candidate rejection passed.');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
