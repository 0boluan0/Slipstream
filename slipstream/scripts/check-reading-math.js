'use strict';
const assert = require('node:assert/strict');
const { mathRanges, firstInvalidMathDelimiter, needsMathReview, isMathOnly, firstBareFontCommand } = require('../src/shared/reading-math.cjs');
const { readingTextFromOcr, readingSegments, joinVisualHyphenation } = require('../src/main/reading-document');
const { createFormulaRecognizer, FORMULA_MODEL } = require('../src/main/formula-recognition');
const { characterCandidates, confirmedConditionalAccent, completeGlyphBox } = require('../src/main/local-formula-ocr');
const { createReadingProcessor } = require('../src/main/reading-service');
const { mergeFormulaDocument, repairUnpairedEvaluationBars, conditionalAccentCandidate } = require('../src/main/formula-document');
const { missingInteriorRows, orderedAgreement } = require('../src/main/interior-prose-recheck');

async function main() {
  const glyphPixels = Buffer.alloc(40 * 24 * 4, 255);
  for (let y = 5; y <= 18; y++) for (let x = 13; x <= 24; x++) {
    const at = (y * 40 + x) * 4; glyphPixels.fill(0, at, at + 3);
  }
  const cutGlyph = { x: 12, y: 3, w: 11, h: 18 };
  assert.deepEqual(completeGlyphBox(glyphPixels, { width: 40, height: 24 }, cutGlyph),
    { ...cutGlyph, w: 14, extendedGlyph: true },
    'a glyph side cut through ink must extend to its first blank source column');
  const intactGlyph = { ...cutGlyph, w: 14 };
  assert.equal(completeGlyphBox(glyphPixels, { width: 40, height: 24 }, intactGlyph), intactGlyph,
    'a blank gutter must not be crossed to include neighboring ink');
  const badlyCutGlyph = { ...cutGlyph, w: 3 };
  assert.equal(completeGlyphBox(glyphPixels, { width: 40, height: 24 }, badlyCutGlyph), badlyCutGlyph,
    'a large missing stroke cannot be recovered through unbounded crop growth');
  const letterOcr = (text) => ({ blocks: [{ text, characters: Array.from(text, (glyph, index) => ({
    text: glyph, boundingBox: { x: .02 + index * .014, y: .5,
      w: glyph === ' ' ? 0 : .012, h: glyph === ' ' ? 0 : .12 },
  })) }] });
  const articleLine = 'We form the zero vector as a linear combination.';
  const articleIndex = articleLine.indexOf('as a ') + 3;
  assert(!characterCandidates(letterOcr(articleLine), { width: 1000, height: 200 }, [])
    .some((candidate) => candidate.x === Math.floor((.02 + articleIndex * .014) * 1000)),
  'a source article before a prose noun must not be sent to single-glyph formula recognition');
  const variableLine = 'Let a denote the scale.';
  const variableIndex = variableLine.indexOf(' a ') + 1;
  assert(characterCandidates(letterOcr(variableLine), { width: 1000, height: 200 }, [])
    .some((candidate) => candidate.x === Math.floor((.02 + variableIndex * .014) * 1000)),
  'a source letter used as a mathematical subject remains eligible for formula recheck');
  for (const [line, symbol] of [['The family A contains events.', 'A'], ['The vector a contains entries.', 'a']]) {
    const index = line.indexOf(` ${symbol} `) + 1;
    assert(characterCandidates(letterOcr(line), { width: 1000, height: 200 }, [])
      .some((candidate) => candidate.x === Math.floor((.02 + index * .014) * 1000)),
    'a mathematical object before a subject verb must remain eligible for symbol recheck');
  }
  const size = { width: 100, height: 100 };
  const word = (text, x, w) => ({ text, characters: [...text].map((char) => ({ text: char,
    boundingBox: { x: x / 100, y: .7, w: w / 100, h: .2 } })) });
  const formula = { x: 10, y: 10, w: 18, h: 20, latex: 'x', display: false };
  const original = { blocks: [word('x:', 10, 24), word('label', 45, 30)] };
  const masked = { blocks: [word(':', 29, 5), word('label', 45, 30)] };
  const positionedFormula = mergeFormulaDocument(masked, [formula], size, original);
  assert.equal(positionedFormula.text, '$x$: label',
    'the same punctuation recovered from an original word and masked OCR must appear once');
  assert.deepEqual(positionedFormula.formulaRegions, [{ start: 0, x: .1, y: .1, w: .18, h: .2 }],
    'the rendered formula keeps its source-pixel rectangle for one-click review');
  const missingFontSlash = mergeFormulaDocument({ blocks: [] }, [{ ...formula,
    latex: '( mathbf  z  _ { L } ^ { 0 } )', confidence: .95 }], size, { blocks: [] });
  assert.equal(missingFontSlash.text, String.raw`$( \mathbf  z  _ { L } ^ { 0 } )$`,
    'a lost LaTeX command slash must not print the command name as mathematical letters');
  assert.deepEqual(missingFontSlash.uncertainFormulaStarts, [0],
    'a repaired font command must still ask the reader to check the source pixels');
  const expFormula = { x: 10, y: 20, w: 80, h: 55, display: true,
    latex: 'q = \\frac { e x p (z/T) } { e x p (w/T) }' };
  const expRows = [{ text: 'exp(z/T)', confidence: .5,
    boundingBox: { x: .28, y: .55, w: .24, h: .14 } },
  { text: 'exp(w/T)', confidence: .5,
    boundingBox: { x: .28, y: .31, w: .24, h: .14 } }];
  const expSource = { blocks: expRows }, expEdge = { blocks: [expRows[0]] };
  const confirmedExp = mergeFormulaDocument({ blocks: [] }, [expFormula], size, expSource, expEdge);
  assert.equal((confirmedExp.text.match(/\\exp\b/gu) || []).length, 2,
    'two source-pixel exp observations and a second OCR layout preserve the operator');
  assert(confirmedExp.uncertainFormulaCount >= 1, 'the operator repair remains reviewable');
  const paddedOnlyExp = mergeFormulaDocument({ blocks: [] }, [expFormula], size,
    { blocks: [] }, { blocks: expRows });
  assert.equal((paddedOnlyExp.text.match(/\\exp\b/gu) || []).length, 2,
    'a complete separate padded reading can recover both operators when source OCR omits them');
  const partialExp = mergeFormulaDocument({ blocks: [] }, [expFormula], size,
    { blocks: [] }, expEdge);
  assert.doesNotMatch(partialExp.text, /\\exp\b/u,
    'one padded operator cannot justify changing both formula occurrences');
  assert.equal(partialExp.spacedOperatorUnresolved, 1);
  assert.equal(partialExp.uncertainFormulaCount, 1,
    'an unconfirmed spaced operator must be visibly marked for review');
  const partialBarFormula = { x: 200, y: 20, w: 550, h: 40, display: false, confidence: .95,
    latex: String.raw`(y_{1},y_{2})\sim\pi^{\mathrm{SFT}}\bar{(y}\mid x)` };
  const plainConditional = { text: 'produce pairs of answers (y1,y2) ~ SFT (y | x).', confidence: 1,
    boundingBox: { x: .1, y: .4, w: .8, h: .3 } };
  const parenthesisSize = { width: 1000, height: 100 };
  const unconfirmedConditional = mergeFormulaDocument({ blocks: [] }, [partialBarFormula],
    parenthesisSize, { blocks: [plainConditional] }, { blocks: [plainConditional] });
  assert.match(unconfirmedConditional.text, /\\bar\{\(y\}/u,
    'plain-text OCR must not remove an accent without formula-pixel agreement');
  assert.equal(unconfirmedConditional.uncertainFormulaCount, 1,
    'an unresolved partial-parenthesis accent must be visibly marked for review');
  const plainMath = String.raw`(y_{1},y_{2})\sim\pi^{\mathrm{SFT}}(y\mid x)`;
  const readings = [{ latex: plainMath, confidence: .96 }, { latex: plainMath, confidence: .98 }];
  for (const accent of ['bar', 'tilde', 'widehat']) {
    const doubtful = partialBarFormula.latex.replace('bar', accent);
    const confirmed = confirmedConditionalAccent(doubtful, readings);
    assert.equal(confirmed?.latex, plainMath,
      'two agreeing formula-pixel readings may recover the exact unaccented expression');
    const corrected = mergeFormulaDocument({ blocks: [] }, [{ ...partialBarFormula,
      ...confirmed, reviewAccent: true }], parenthesisSize, { blocks: [] });
    assert.equal(corrected.text, `$${plainMath}$`);
    assert.equal(corrected.uncertainFormulaCount, 1,
      'a pixel-corroborated formula repair still asks for source review');
    const complete = plainMath.replace(String.raw`(y\mid x)`, `\\${accent}{(y\\mid x)}`);
    assert.equal(confirmedConditionalAccent(complete, readings)?.latex, plainMath,
      'the same source contamination can be decoded as a complete conditional accent');
    const unchanged = mergeFormulaDocument({ blocks: [] }, [{ ...partialBarFormula, latex: complete }],
      parenthesisSize, { blocks: [plainConditional] }, { blocks: [plainConditional] });
    assert.equal(unchanged.text, `$${complete}$.`,
      'even complete conditional accents stay intact without new pixel readings');
    assert.equal(unchanged.uncertainFormulaCount, 1);
    assert.equal(confirmedConditionalAccent(complete,
      [{ latex: complete, confidence: .99 }, { latex: complete, confidence: .99 }]), null,
    'rereading a genuine accent never authorizes its removal');
  }
  assert.equal(confirmedConditionalAccent(partialBarFormula.latex, [readings[0]]), null);
  assert.equal(confirmedConditionalAccent(partialBarFormula.latex,
    [readings[0], { latex: plainMath.replace('y_{2}', 'y_{3}'), confidence: .99 }]), null,
  'agreement must cover all mathematical symbols, not only the disputed accent');
  for (const confidence of [.89, NaN, undefined]) {
    assert.equal(confirmedConditionalAccent(partialBarFormula.latex,
      [readings[0], { latex: plainMath, confidence }]), null);
  }
  for (const legitimate of [String.raw`\bar{y}(y\mid x)`,
    String.raw`\tilde{y}`, String.raw`\hat{f}(x)`]) {
    assert.equal(conditionalAccentCandidate(legitimate), null,
      'ordinary accented symbols are never candidates for this repair');
    assert.equal(confirmedConditionalAccent(legitimate, readings), null);
  }
  const nativeSpacing = String.raw`( y _ { 1 }, y _ { 2 } ) \, \sim \, \pi ^ { \mathrm { S F T } } \bar { ( y } \, \mid \, x )`;
  assert.equal(confirmedConditionalAccent(nativeSpacing, readings)?.latex, plainMath,
    'harmless OCR spacing does not prevent whole-expression pixel agreement');
  const namedExp = { ...expFormula,
    latex: 'q = \\frac { \\operatorname { e x p } (z/T) } { \\sum_j \\operatorname { e x p } (w/T) }' };
  const confirmedNamedExp = mergeFormulaDocument({ blocks: [] }, [namedExp], size,
    { blocks: [] }, { blocks: expRows });
  assert.equal((confirmedNamedExp.text.match(/\\exp\b/gu) || []).length, 2,
    'a spaced operatorname confirmed by source pixels becomes the actual exp function');
  assert.equal(confirmedNamedExp.spacedOperatorUnresolved, 0);
  const unconfirmedExp = mergeFormulaDocument({ blocks: [] }, [expFormula], size, expSource);
  assert.doesNotMatch(unconfirmedExp.text, /\\exp\b/u,
    'a spaced math token without independent corroboration stays unchanged');
  assert.equal(firstBareFontCommand(String.raw`State $( mathbf z_L^0 )$ is used.`), 'mathbf');
  assert.equal(firstBareFontCommand(String.raw`State $( \mathbf z_L^0 )$ is used.`), '');
  assert.equal(firstBareFontCommand('The word mathbf is ordinary prose.'), '');
  assert.equal(firstInvalidMathDelimiter('The expression $$x=1$ ends here.'), '$$');
  assert.equal(firstInvalidMathDelimiter(String.raw`The expression \(x=1 is incomplete.`), String.raw`\(`);
  assert.equal(firstInvalidMathDelimiter('The expression $$ $$ is empty.'), '$$');
  assert.equal(firstInvalidMathDelimiter('A $5 fee and `$$code` are plain text.'), '');
  assert.equal(firstInvalidMathDelimiter(String.raw`The expression \(x=1\) is valid.`), '');
  for (const colon of [String.raw`\colon`, String.raw`\mathbf { : }`, String.raw`\mathsf { : }`]) {
    const mathColon = { ...formula, latex: String.raw`r,s\in\mathbb R` + colon };
    assert.equal(mergeFormulaDocument({ blocks: [word(':', 29, 5)] }, [mathColon], size,
      { blocks: [word('r,s∈R:', 10, 24)] }).text, String.raw`$r,s\in\mathbb R$:`,
    'a colon decoded inside TeX and outside the formula mask must appear once as prose punctuation');
  }
  const placedWord = (text, x, y, w, h) => ({ text, confidence: 1,
    characters: [{ text, boundingBox: { x: x / 100, y: (100 - y - h) / 100, w: w / 100, h: h / 100 } }] });
  const codeBlock = (text, x, y, w) => ({ ...placedWord(text, x, y, w, 8),
    boundingBox: { x: x / 100, y: (92 - y) / 100, w: w / 100, h: .08 } });
  const textbookCode = { blocks: [
    codeBlock('n = hist.Total ()', 10, 20, 36), codeBlock('0 = {}', 10, 32, 16),
    codeBlock('for x, freq in hist. Items ():', 10, 44, 52),
    codeBlock('d[x] = freq / n', 15, 56, 36),
  ] };
  const codeAsMath = [
    { x: 10, y: 20, w: 36, h: 8, latex: String.raw`\mathbf{n}=\mathbf{hist.Total}()`, display: true },
    { x: 10, y: 32, w: 16, h: 8, latex: String.raw`\textbf{d}=\{\}`, display: true },
    { x: 15, y: 56, w: 36, h: 8, latex: String.raw`d[x]=freq/n`, display: true },
  ];
  const preservedCode = mergeFormulaDocument({ blocks: [] }, codeAsMath, size, textbookCode);
  assert.equal(preservedCode.formulaCount, 0,
    'a Python loop and its adjacent assignments must stay code when layout mislabels them as display math');
  const partlyReadCode = { blocks: textbookCode.blocks.map((block, index) =>
    index === 1 ? { ...block, text: 'd = {' } : block) };
  assert.equal(mergeFormulaDocument({ blocks: [] }, codeAsMath, size, partlyReadCode).formulaCount, 0,
    'an OCR-clipped one-character assignment must not break the nearby Python code block');
  const plainCode = readingTextFromOcr(partlyReadCode).text;
  assert.match(plainCode, /n = hist\.Total \(\)\nd = \{\nfor x, freq in hist\. Items \(\):\n\s{3,4}d\[x\] = freq \/ n/u,
    'ordinary OCR must preserve Python source rows when the formula detector finds no mathematics');
  assert.equal(readingSegments(plainCode)[0].code, true,
    'the preserved source must bypass model translation as one code segment');
  assert.match(preservedCode.text, /n = hist\.Total \(\)[\s\S]*for x, freq in hist\. Items \(\):[\s\S]*d\[x\] = freq \/ n/u);
  assert.equal(mathRanges(preservedCode.text).length, 0,
    'formula substitution must not fabricate TeX in a photographed code block');
  assert.equal(readingSegments(`Explanation.\n\n${preservedCode.text}\n\nNext paragraph.`)
    .filter((segment) => segment.code).length, 1,
  'the preserved code block must become one untranslated reading segment');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [codeAsMath[2]], size,
    { blocks: [textbookCode.blocks[3]] }).formulaCount, 1,
  'an isolated indexed equation without code context must remain eligible as mathematics');
  const promptBlock = (text, y) => ({ text, boundingBox: { x: .1, y, w: .8, h: .07 } });
  const replExample = readingTextFromOcr({ blocks: [
    promptBlock('>>> import thinkstats2', .8),
    promptBlock('>>> pmf = thinkstats2.Pmf([1, 2, 2, 3, 5])', .72),
    promptBlock('>>> pmf', .64),
    promptBlock('Pmf({1: 0.2, 2: 0.4, 3: 0.2, 5: 0.2})', .56),
    promptBlock('The Pmf is normalized so total probability is 1.', .42),
  ] }).text;
  assert.match(replExample, />>> import thinkstats2\n>>> pmf = thinkstats2\.Pmf\(\[1, 2, 2, 3, 5\]\)\n>>> pmf\nPmf\(\{1: 0\.2, 2: 0\.4, 3: 0\.2, 5: 0\.2\}\)\n\nThe Pmf is normalized/u,
    'a photographed Python REPL example must retain commands, output and its paragraph boundary');
  assert.deepEqual(readingSegments(replExample).map((segment) => segment.code), [true, false],
    'the REPL example must display as code and bypass prose translation');
  const paperCode = [
    '# compute two feature representations',
    'left = encode_left(x)',
    'right = encode_right(y)',
    '# normalize both before comparison',
    'left = unit_length(left)',
    'right = unit_length(right)',
    'score = dot(left, right)',
    'labels = arange(n)',
    'loss = cross_entropy(score, labels)',
  ].join('\n');
  assert.equal(readingSegments(paperCode)[0].code, true,
    'assignment-rich paper pseudocode without a loop must retain exact source instead of entering prose translation');
  assert.equal(readingSegments(`${paperCode}\n\nThis section explains the comparison.`)[1].code, false,
    'a following ordinary paragraph must still be translated');
  assert.equal(readingSegments([
    'The model uses a score for each pair.',
    'The text defines x = an image and y = a caption.',
    'Its objective is discussed below.',
  ].join('\n'))[0].code, false,
  'a prose explanation with assignments must not be hidden as code');
  const adjacentRows = { blocks: [placedWord('In', 10, 10, 20, 30), placedWord('prose', 45, 10, 40, 30),
    placedWord('x', 10, 32, 20, 25), placedWord('follows', 45, 32, 45, 25)] };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ x: 10, y: 28, w: 20, h: 28,
    latex: 'x', display: false }], size, adjacentRows).text, 'In prose\n$x$ follows',
  'a formula box grazing the previous text line cannot erase a source word');
  const tallLineSize = { width: 1112, height: 220 };
  const tallLines = { blocks: [
    { text: 'First complete printed line stays first.', confidence: 1,
      boundingBox: { x: .023, y: .718, w: .944, h: .182 } },
    { text: 'Second complete printed line stays second.', confidence: 1,
      boundingBox: { x: .020, y: .645, w: .926, h: .182 } },
  ] };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [], tallLineSize, tallLines).text,
    'First complete printed line stays first.\nSecond complete printed line stays second.',
    'overlapping Vision boxes for different full-width lines must not interleave their text');
  const sameLineFragments = { blocks: [
    { text: 'A phrase', confidence: 1, boundingBox: { x: .02, y: .72, w: .2, h: .18 } },
    { text: 'continues here.', confidence: 1, boundingBox: { x: .24, y: .68, w: .3, h: .18 } },
  ] };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [], tallLineSize, sameLineFragments).text,
    'A phrase continues here.', 'side-by-side observations on one printed line still join');
  const lineWords = { blocks: [placedWord('An ensem-', 10, 5, 60, 10),
    placedWord('ble uses', 10, 22, 60, 10), placedWord('x', 10, 40, 10, 10)] };
  const joinedFormulaDocument = mergeFormulaDocument({ blocks: [] },
    [{ x: 10, y: 40, w: 10, h: 10, latex: 'x', display: false, confidence: .4 }], size, lineWords);
  assert.equal(joinedFormulaDocument.text, 'An ensemble uses\n$x$',
    'formula-rich OCR must join a confirmed English visual split outside TeX');
  assert.deepEqual(joinedFormulaDocument.uncertainFormulaStarts,
    [mathRanges(joinedFormulaDocument.text)[0].start], 'a prose join must shift the later formula review marker');
  const wrappedSize = { width: 1562, height: 276 };
  const wrappedParts = [
    { x: 1183, y: 90, w: 268, h: 44, latex: String.raw`E[z_\omega(x)'z_\omega(y)] =`, display: false, confidence: .95 },
    { x: 45, y: 136, w: 110, h: 41, latex: 'k(x,y)', display: false, confidence: .95 },
    { x: 1096, y: 135, w: 357, h: 41, latex: String.raw`z_\omega(x)=\sqrt{2}\cos(\omega'x+`, display: false, confidence: .95 },
    { x: 44, y: 175, w: 31, h: 40, latex: 'b)', display: false, confidence: .95 },
  ];
  const wrapped = mergeFormulaDocument({ blocks: [] }, wrappedParts, wrappedSize, { blocks: [] });
  assert.equal(wrapped.wrappedFormulaRepairs, 2,
    'a line-end equality and an open cosine both continue into the first math fragment of the next printed row');
  assert.equal(wrapped.formulaCount, 2, 'the two complete expressions replace four misleading math fragments');
  assert.equal(wrapped.uncertainFormulaStarts.length, 2, 'a stitched equation still requires source review');
  assert.match(wrapped.text, /\$E\[z_\\omega\(x\)'z_\\omega\(y\)\] = k\(x,y\)\$/u);
  assert.match(wrapped.text, /\$z_\\omega\(x\)=\\sqrt\{2\}\\cos\(\\omega'x\+ b\)\$/u);
  const separateEquations = mergeFormulaDocument({ blocks: [] }, [
    { ...wrappedParts[0], latex: String.raw`E[z_\omega(x)]` }, wrappedParts[1],
  ], wrappedSize, { blocks: [] });
  assert.equal(separateEquations.wrappedFormulaRepairs, 0,
    'an equation ending without a continuation operator must stay separate');
  const gridSize = { width: 1000, height: 400 };
  const gridFormula = (x, y, h, latex) => ({ x, y, w: 180, h, latex, display: true, confidence: .95 });
  const gridFormulas = [
    gridFormula(80, 130, 40, 'a_1'), gridFormula(400, 115, 60, 'a_2'),
    gridFormula(720, 100, 80, 'a_3'), gridFormula(80, 210, 40, 'b_1'),
    gridFormula(400, 210, 40, 'b_2'), gridFormula(720, 210, 40, 'b_3'),
  ];
  const gridLabels = gridFormulas.map((formula, index) => {
    const label = '(' + (index % 3 + 1) + (index < 3 ? 'a' : 'b') + ')';
    const box = { x: (formula.x + formula.w + 10) / gridSize.width,
      y: 1 - (formula.y + formula.h / 2 + 10) / gridSize.height,
      w: 45 / gridSize.width, h: 20 / gridSize.height };
    return { text: label, confidence: 1, boundingBox: box,
      characters: [{ text: label, boundingBox: box }] };
  });
  const grid = mergeFormulaDocument({ blocks: [] }, gridFormulas, gridSize, { blocks: gridLabels });
  assert.deepEqual([...grid.text.matchAll(/\\tag\{([1-3][ab])\}/gu)].map((match) => match[1]),
    ['1a', '1b', '2a', '2b', '3a', '3b'],
    'side-by-side numbered equation pairs must read down each column before moving right');
  assert.equal(grid.layoutReview, true, 'a reordered equation grid still asks the reader to compare the source layout');
  const incompleteGrid = mergeFormulaDocument({ blocks: [] }, gridFormulas, gridSize,
    { blocks: gridLabels.slice(0, -1) });
  assert.deepEqual([...incompleteGrid.text.matchAll(/\\tag\{([1-3][ab])\}/gu)].map((match) => match[1]),
    ['3a', '2a', '1a', '1b', '2b'],
    'a grid missing one printed equation label cannot be reordered by inferred structure');
  const unnumberedGrid = mergeFormulaDocument({ blocks: [] }, gridFormulas, gridSize, { blocks: [] });
  assert.deepEqual([...unnumberedGrid.text.matchAll(/\$\$([ab]_[1-3])\$\$/gu)].map((match) => match[1]),
    ['a_3', 'a_2', 'a_1', 'b_1', 'b_2', 'b_3'],
    'without source equation labels, a visual grid must not be silently reordered');
  const specialistJoin = joinVisualHyphenation('A quan-\ntile sketch and an end-\nto-end method.', ['quantile'],
    (term) => new Set(['end', 'to']).has(term));
  assert.equal(specialistJoin.text, 'A quantile sketch and an end-\nto-end method.',
    'the formula path must accept spelling corroboration while retaining a real compound');
  const eponymJoin = joinVisualHyphenation("Hoeffd-\ning's inequality is useful.");
  assert.equal(eponymJoin.text, "Hoeffding's inequality is useful.");
  assert.deepEqual(eponymJoin.reviewedJoins,
    [{ source: "Hoeffd-ing's", alternative: "Hoeffding's" }],
    'an unknown surname split before a named result is joined but flagged for source review');
  assert.equal(joinVisualHyphenation("Upper-\nbound's theorem is different.").text,
    "Upper-\nbound's theorem is different.",
  'a known first half of a hyphenated term is not silently converted to a surname');
  assert.equal(joinVisualHyphenation("Hoeffd-\ning's argument is here.").text,
    "Hoeffd-\ning's argument is here.",
  'an unknown possessive without a named result is left intact');
  const spellingBlock = (text) => ({ ...placedWord(text, 10, 10, 80, 10),
    boundingBox: { x: .1, y: .8, w: .8, h: .1 } });
  const spellingSource = { blocks: [spellingBlock('Each tree has leat weights here')] };
  const spellingAlternative = { blocks: [spellingBlock('Each tree has leaf weights here')] };
  const spellingDocument = mergeFormulaDocument({ blocks: [] }, [], size, spellingSource, spellingAlternative);
  assert.deepEqual(spellingDocument.proseSpellingConflicts,
    [{ key: 'leat/leaf', source: 'leat', alternative: 'leaf' }],
    'one-letter disagreement in the same printed prose row must be shown for review');
  assert.match(spellingDocument.text, /leat weights/u,
    'two conflicting OCR readings cannot silently rewrite the source');
  const acronymSource = { blocks: [spellingBlock('The classification head is implemented by a MILP with one hidden layer')] };
  const acronymAlternative = { blocks: [spellingBlock('The classification head is implemented by a MLP with one hidden layer')] };
  const acronymDocument = mergeFormulaDocument({ blocks: [] }, [], size,
    acronymSource, acronymAlternative);
  assert.deepEqual(acronymDocument.proseSpellingConflicts,
    [{ key: 'milp/mlp', source: 'MILP', alternative: 'MLP' }],
    'a one-letter disagreement in a technical acronym must request review');
  assert.match(acronymDocument.text, /a MILP with one hidden layer/u,
    'a conflicting alternate acronym cannot silently rewrite the source');
  const candidateAcronym = mergeFormulaDocument({ blocks: [] }, [], size,
    { blocks: [{ ...acronymSource.blocks[0], alternatives: [acronymAlternative.blocks[0].text] }] });
  assert.deepEqual(candidateAcronym.proseSpellingConflicts, acronymDocument.proseSpellingConflicts,
    'a second Vision candidate from the same printed row must expose the acronym disagreement');
  assert.deepEqual(mergeFormulaDocument({ blocks: [] }, [], size, acronymSource,
    { blocks: [spellingBlock('The classification head is implemented by a MILP with one hidden layer')] })
    .proseSpellingConflicts, [], 'matching acronym readings must not ask for review');
  const corroboratedAcronym = mergeFormulaDocument({ blocks: [] }, [], size,
    { blocks: [{ ...acronymSource.blocks[0], alternatives: [acronymAlternative.blocks[0].text] }] },
    { blocks: [spellingBlock('The classification head is implemented by a MILP with one hidden layer')] });
  assert.deepEqual(corroboratedAcronym.proseSpellingConflicts, [],
    'a lower-ranked acronym candidate must not override two matching full-image readings');
  const symbolLine = (value, y = 15) => {
    let x = 5;
    const characters = [];
    for (const token of value.split(/(\s+)/u)) {
      if (!token.trim()) { characters.push({ text: token, boundingBox: { x: 0, y: 0, w: 0, h: 0 } }); x += 2; continue; }
      const box = { x: x / 100, y: (100 - y - 10) / 100, w: (token.length * 1.4 + 1) / 100, h: .1 };
      for (const character of token) characters.push({ text: character, boundingBox: box });
      x += token.length * 1.4 + 3;
    }
    return { text: value, confidence: 1, boundingBox: { x: .05, y: (100 - y - 10) / 100, w: .9, h: .1 }, characters };
  };
  const tokenBlock = (text, x, width) => {
    const boundingBox = { x: x / 100, y: .7, w: width / 100, h: .1 };
    return { text, confidence: 1, boundingBox,
      characters: [...text].map((glyph) => ({ text: glyph, boundingBox })) };
  };
  const splitSourceRow = { blocks: [tokenBlock('where x denotes a vector in real space.', 1, 42),
    tokenBlock(', which acts as the normalized alternative for layer', 42, 54)] };
  const splitMaskedRow = { blocks: [tokenBlock('where', 1, 7),
    tokenBlock(', which acts as the normalized alternative for layer', 42, 54)] };
  const splitPaddedRow = { blocks: [tokenBlock(
    'where x denotes a vector in real space, which acts as the normalized alternative for layer', 1, 95)] };
  const splitDocument = mergeFormulaDocument(splitMaskedRow, [], size, splitSourceRow, splitPaddedRow);
  assert.equal((splitDocument.text.match(/which acts as the normalized alternative/gu) || []).length, 1,
    'an adjacent OCR block must not be borrowed into the left block and then repeated at its own position');
  const overlapLeft = 'Training the function f with an objective (1)';
  const overlapRight = 'is described as the weighted average loss over finite observations';
  const overlapSource = { blocks: [tokenBlock(overlapLeft, 1, 42), tokenBlock(overlapRight, 45, 50)] };
  const overlappingMasked = { blocks: [tokenBlock(overlapLeft.replace(' f ', ' '), 1, 42),
    tokenBlock(`with an objective (1) ${overlapRight}`, 27, 68)] };
  const overlapPadded = { blocks: [tokenBlock(`${overlapLeft} ${overlapRight}`, 1, 94)] };
  assert.equal(mergeFormulaDocument(overlappingMasked, [], size, overlapSource, overlapPadded).text,
    `${overlapLeft} ${overlapRight}`,
    'a partially overlapping masked block must not replace a source fragment with its neighboring clause');
  const ravSource = symbolLine('The statistic is estimated from rav inputs');
  const rawPadded = symbolLine('The statistic is estimated from raw inputs');
  const rawMasked = symbolLine('The statistic is estimated from raw inputs');
  const splitAt = rawPadded.text.indexOf('from');
  const ravDocument = mergeFormulaDocument({ blocks: [rawMasked] }, [], size,
    { blocks: [ravSource] }, { blocks: [
      { ...rawPadded, text: rawPadded.text.slice(0, splitAt), characters: rawPadded.characters.slice(0, splitAt) },
      { ...rawPadded, text: rawPadded.text.slice(splitAt), characters: rawPadded.characters.slice(splitAt) },
    ] });
  assert.match(ravDocument.text, /estimated from raw inputs/u,
    'two aligned OCR readings must repair a one-letter prose error despite different row splits');
  assert.ok(ravDocument.proseSpellingConflicts.some((pair) => pair.key === 'rav/raw'),
    'a consensus spelling repair must still be visible for reader review');
  assert.ok(ravDocument.rowRecovered > 0, 'a repaired prose word must pause the translation for review');
  const shiftedMasked = { ...rawMasked, characters: rawMasked.characters.map((glyph) => ({ ...glyph,
    boundingBox: { ...glyph.boundingBox, x: glyph.boundingBox.x + .2 } })) };
  const unalignedWord = mergeFormulaDocument({ blocks: [shiftedMasked] }, [], size,
    { blocks: [ravSource] }, { blocks: [rawPadded] });
  assert.match(unalignedWord.text, /estimated from rav inputs/u,
    'agreement at another image position cannot silently change a source word');
  const heading = tokenBlock('Discretization.', 5, 20);
  const corroboratedJoin = tokenBlock('Discretization. The first stage transforms parameters.', 5, 88);
  for (const prefix of ['_', '_ ']) {
    const joinedSentence = tokenBlock(`${prefix}The first stage transforms parameters.`, 26, 67);
    const repairedHeading = mergeFormulaDocument({ blocks: [] }, [], size,
      { blocks: [heading, joinedSentence] }, { blocks: [corroboratedJoin] });
    assert.equal(repairedHeading.text, 'Discretization. The first stage transforms parameters.',
      'a padded OCR row must remove a spurious underscore joining a printed heading to the next sentence');
    assert.equal(repairedHeading.rowRecovered, 1, 'the source-pixel disagreement remains visible for review');
    assert.equal(mergeFormulaDocument({ blocks: [] }, [], size,
      { blocks: [heading, joinedSentence] }, { blocks: [] }).text,
    `Discretization. ${prefix}The first stage transforms parameters.`,
    'one Vision layout alone cannot silently remove a printed underscore');
  }
  assert.equal(mergeFormulaDocument({ blocks: [] }, [], size,
    { blocks: [heading, tokenBlock('x_The first stage transforms parameters.', 26, 67)] },
    { blocks: [corroboratedJoin] }).text,
  'Discretization. x_The first stage transforms parameters.',
  'a subscript-like interior underscore must remain unchanged');
  const matrixI = symbolLine('The matrix I satisfies the following properties');
  const matrixL = symbolLine('The matrix L satisfies the following properties');
  const correctedSymbol = mergeFormulaDocument({ blocks: [matrixL] }, [], size,
    { blocks: [matrixI] }, { blocks: [matrixL] });
  assert.match(correctedSymbol.text, /The matrix L satisfies/u,
    'two agreeing OCR layouts at the same printed glyph must correct a one-letter mathematical subject');
  assert.equal(correctedSymbol.rowRecovered, 1,
    'a corrected mathematical subject must require reader review before translation');
  assert.deepEqual(correctedSymbol.proseSymbolConflicts,
    [{ source: 'I', alternative: 'L' }], 'the source disagreement must be explained in review');
  const numericZero = symbolLine('The eigenvalue 0 is simple');
  const correctedDigit = mergeFormulaDocument({ blocks: [numericZero] }, [], size,
    { blocks: [numericZero], verifiedGlyphConflicts: [{ source: 'O', alternative: '0' }] });
  assert.match(correctedDigit.text, /eigenvalue 0 is/u);
  assert.equal(correctedDigit.rowRecovered, 1,
    'a pixel-confirmed O/0 correction must pause for reader review');
  assert.deepEqual(correctedDigit.proseSymbolConflicts, [{ source: 'O', alternative: '0' }],
    'the printed O/0 disagreement must reach the review card');
  const digitProse = symbolLine('This 1s often unacceptable for large datasets.');
  const letterProse = symbolLine('This is often unacceptable for large datasets.');
  const correctedProse = mergeFormulaDocument({ blocks: [letterProse] }, [], size,
    { blocks: [digitProse] }, { blocks: [letterProse] });
  assert.match(correctedProse.text, /This is often unacceptable/u,
    'two aligned readings of the same printed word may repair an isolated 1/i confusion');
  assert.equal(correctedProse.rowRecovered, 1, 'a repaired prose digit must still require reader review');
  assert.match(mergeFormulaDocument({ blocks: [digitProse] }, [], size,
    { blocks: [digitProse] }, { blocks: [letterProse] }).text, /This 1s often/u,
  'one alternative reading cannot silently rewrite a numeric-looking word');
  const actualDimension = symbolLine('The 1D model uses fewer parameters.');
  const mistakenDimension = symbolLine('The ID model uses fewer parameters.');
  assert.match(mergeFormulaDocument({ blocks: [mistakenDimension] }, [], size,
    { blocks: [actualDimension] }, { blocks: [mistakenDimension] }).text, /The 1D model/u,
  'a numeric dimension must not turn into a prose acronym');
  const unconfirmedSymbol = mergeFormulaDocument({ blocks: [matrixI] }, [], size,
    { blocks: [matrixI] }, { blocks: [matrixL] });
  assert.match(unconfirmedSymbol.text, /The matrix I satisfies/u,
    'a single alternative read cannot silently change a symbol');
  const displacedSymbol = mergeFormulaDocument({ blocks: [symbolLine(matrixL.text, 40)] }, [], size,
    { blocks: [matrixI] }, { blocks: [matrixL] });
  assert.match(displacedSymbol.text, /The matrix I satisfies/u,
    'agreement at another printed location cannot change a symbol');
  const uncertain = mergeFormulaDocument(masked, [{ ...formula, confidence: .4 }], size, original);
  assert.deepEqual(uncertain.uncertainFormulaStarts, [mathRanges(uncertain.text)[0].start],
    'a low-confidence formula identifies its actual location in the source shown for review');
  const borderline = mergeFormulaDocument(masked, [{ ...formula, confidence: .66 }], size, original);
  assert.deepEqual(borderline.uncertainFormulaStarts, [mathRanges(borderline.text)[0].start],
    'small formula details need review even when the model assigns moderate confidence');
  assert.deepEqual(mergeFormulaDocument(masked, [{ ...formula, confidence: .9 }], size, original).uncertainFormulaStarts, []);
  const latinAsGreek = mergeFormulaDocument({ blocks: [] }, [{ ...formula, latex: '\\nu', confidence: .95 }],
    size, { blocks: [word('V', 10, 18)] });
  assert.equal(latinAsGreek.uncertainFormulaCount, 1,
    'a confident Greek nu must be reviewed when independent OCR sees Latin V in that exact box');
  const vectorAsGreek = mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: '\\vec{\\upsilon}+\\vec{\\upsilon}\\in V', confidence: .95 }],
    size, { blocks: [word('v+w∈V', 10, 18)] });
  assert.equal(vectorAsGreek.uncertainFormulaCount, 1,
    'confident Greek vector glyphs must be reviewed when independent OCR sees Latin v/w');
  const repeatedVector = mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: '\\vec{\\nu}\\in V', confidence: .95 },
      { ...formula, x: 55, latex: '\\vec{w}\\in V', confidence: .95 }],
    size, { blocks: [] });
  assert.equal(repeatedVector.uncertainFormulaCount, 1,
    'a confusable Greek vector is reviewable when the same selection also has Latin vector notation');
  assert.equal(mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: '\\vec{\\omicron}\\in V', confidence: .95 }],
    size, { blocks: [word('0∈V', 10, 18)] }).uncertainFormulaCount, 1,
  'a confident Greek omicron must be reviewed when independent OCR sees a zero');
  const zeroVector = mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: '\\vec{\\omicron}\\in V', confidence: .95 }],
    size, { blocks: [word('there is a zero vector 0∈V', 10, 25)] });
  assert.equal(zeroVector.text, '$\\vec{0}\\in V$',
    'a zero-vector declaration and independent zero glyph correct an omicron decode');
  assert.equal(zeroVector.uncertainFormulaCount, 1,
    'a context-corrected vector glyph still asks for image review');
  const lossSymbol = mergeFormulaDocument({ blocks: [] }, [{ ...formula, latex: '\\iota', confidence: .95 }],
    size, { blocks: [word('l', 10, 18)] }, { blocks: [word('l', 10, 18)] });
  assert.equal(lossSymbol.text, '$l$', 'two image OCR layouts reading Latin l must correct an iota decode');
  assert.equal(lossSymbol.uncertainFormulaCount, 1, 'a corrected Latin/Greek ambiguity still needs reader review');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...formula, latex: '\\iota', confidence: .95 }],
    size, { blocks: [word('l', 10, 18)] }, { blocks: [word('ι', 10, 18)] }).text, '$\\iota$',
  'one Latin reading cannot override a conflicting Greek reading');
  assert.equal(mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: String.raw`\vec { \omicron } \in V`, confidence: .95 }],
    size, { blocks: [word('there is a zero vector 0∈V', 10, 25)] }).text,
  String.raw`$\vec { 0 } \in V$`,
  'spaces emitted by the real decoder must not prevent the zero-vector correction');
  assert.equal(mergeFormulaDocument({ blocks: [] },
    [{ ...formula, latex: '\\vec{\\nu}\\in V', confidence: .95 }],
    size, { blocks: [word('ν∈V', 10, 18)] }).uncertainFormulaCount, 0,
  'an agreeing Greek reading must not get a Latin-conflict marker');
  const barred = { ...formula, confidence: .9,
    latex: String.raw`\bar { \boldsymbol { z } _ { i } } = g ( h_i )` };
  const paddedPlain = { blocks: [{ ...word('zi = g(hi)', 10, 40), confidence: 1,
    boundingBox: { x: .1, y: .7, w: .4, h: .2 } }] };
  const accentConflict = mergeFormulaDocument({ blocks: [] }, [barred], size, { blocks: [] }, paddedPlain);
  assert.equal(accentConflict.uncertainFormulaCount, 1);
  assert.deepEqual(accentConflict.uncertainFormulaStarts, [mathRanges(accentConflict.text)[0].start],
    'a high-confidence barred symbol needs review when a second OCR pass reads the unbarred relation');
  assert.deepEqual(mergeFormulaDocument({ blocks: [] }, [barred], size, { blocks: [] },
    { blocks: [{ ...paddedPlain.blocks[0], text: 'z̄i = g(hi)' }] }).uncertainFormulaStarts, [],
  'an OCR pass that also sees an accent does not create a new review marker');
  const splitBracketAccent = { x: 10, y: 10, w: 80, h: 20, display: false, confidence: .9,
    latex: String.raw`\operatorname* { P r } \widetilde { [ | \mathbf z ( \mathbf x ) - k ( \mathbf x ) | } \geq \epsilon \widehat { ] } \leq 2` };
  const plainBracketSource = { blocks: [{
    ...placedWord('Pr [|z(x)-k(x)| ≥ e] ≤ 2', 10, 10, 80, 20),
    boundingBox: { x: .1, y: .7, w: .8, h: .2 },
  }] };
  const bracketRepair = mergeFormulaDocument({ blocks: [] }, [splitBracketAccent], size, plainBracketSource);
  assert.match(bracketRepair.text, /\[\s*\|[^\n]+\|\s+\\geq\s+\\epsilon\s+\]\s+\\leq\s+2/u,
    'independently visible plain probability brackets replace split spurious accents');
  assert(!/\\(?:widetilde|widehat)/u.test(bracketRepair.text));
  assert.equal(bracketRepair.uncertainFormulaCount, 1, 'the bracket repair still requires image review');
  assert.match(mergeFormulaDocument({ blocks: [] }, [splitBracketAccent], size, { blocks: [] }).text,
    /\\widetilde/u, 'without source corroboration, the recognizer expression must remain unchanged');
  assert.match(mergeFormulaDocument({ blocks: [] }, [{
    ...splitBracketAccent, latex: String.raw`\widetilde{[A]} \leq 2` }], size, plainBracketSource).text,
  /\\widetilde/u, 'an accent over an entire complete bracketed object is not the split-bracket error');
  const indexed = { ...formula, x: 10, y: 10, w: 18, h: 20, latex: 'x_i' };
  const footnoteMerged = mergeFormulaDocument({ blocks: [] }, [{ ...formula,
    latex: String.raw`\langle \vec\beta_1,\ldots\rangle. ^{*}`, confidence: .99 }], size);
  assert.equal(footnoteMerged.uncertainFormulaCount, 1,
    'a footnote star swallowed after formula punctuation must be visibly flagged');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [indexed], size,
    { blocks: [word('x_i;', 10, 18)] }).text, '$x_i$',
  'a semicolon hallucinated inside an indexed formula box is not sentence punctuation');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [indexed], size,
    { blocks: [word('x_i;', 10, 24)] }).text, '$x_i$;',
  'a separately visible semicolon beyond the math region is preserved');
  const power = { ...formula, latex: 'x^{2}' };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [power], size,
    { blocks: [word('x?', 10, 18)] }).text, '$x^{2}$',
  'an exponent misread as a question mark inside its math box is not appended');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [power], size,
    { blocks: [word('x?', 10, 24)] }).text, '$x^{2}$?',
  'a visible question mark beyond the formula remains prose punctuation');
  const periodSource = { blocks: [word('x.', 10, 24), word('label', 45, 30)] };
  assert.equal(mergeFormulaDocument({ blocks: [word('•', 29, 5)] }, [formula], size, periodSource).text, '$x$. label',
    'masked OCR may call the same source period a bullet; preserve the original punctuation once');
  const ambiguousPeriod = { ...formula, latex: 'a_{j-1}' };
  const bulletSource = { blocks: [word('aj-1•', 10, 24), word('label', 45, 30)] };
  const paddedPeriod = { blocks: [{ ...word('a1,...,ai-1.', 8, 30), confidence: 1 }] };
  const recoveredPeriod = mergeFormulaDocument({ blocks: [word('•', 29, 5)] },
    [ambiguousPeriod], size, bulletSource, paddedPeriod);
  assert.equal(recoveredPeriod.text, '$a_{j-1}$. label',
    'aligned padded punctuation restores a sentence period without borrowing its mistaken formula letter');
  assert.equal(recoveredPeriod.uncertainFormulaCount, 1,
    'a period recovered from disagreeing OCR passes still requires formula review');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [ambiguousPeriod], size, bulletSource,
    { blocks: [{ ...word('b1,...,bi-1.', 8, 30), confidence: 1 }] }).text, '$a_{j-1}$ label',
  'an unrelated padded formula cannot supply a sentence period');
  const numbered = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true }], size,
    { blocks: [word('(2)', 80, 15)] });
  assert.match(numbered.text, /\\tag\{2\}/, 'a right-aligned number belongs to its display equation');
  assert(!mergeFormulaDocument({ blocks: [] }, [formula], size,
    { blocks: [word('(2)', 80, 15)] }).text.includes('\\tag'), 'inline math must not absorb a nearby list label');
  assert(!mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true }], size,
    { blocks: [word('(2)', 0, 5)] }).text.includes('\\tag'), 'a number before the formula is not a right-aligned equation tag');
  const pairedNormal = { x: 10, y: 10, w: 80, h: 20, display: true, confidence: .4,
    latex: String.raw`N ( \mu = 0, \sigma = 1 ) \quad \mathrm { a n d } \quad N ( \mu = 1 9, \sigma = 4 )` };
  const pairedSource = { blocks: [{ text: 'N(mu = 0, sigma = 1) and N(mu = 19, sigma = 4)', confidence: 1,
    boundingBox: { x: .1, y: .7, w: .8, h: .2 } }] };
  const pairedDocument = mergeFormulaDocument({ blocks: [] }, [pairedNormal], size, pairedSource);
  assert.equal(pairedDocument.text,
    String.raw`$N ( \mu = 0, \sigma = 1 )$ and $N ( \mu = 1 9, \sigma = 4 )$`,
    'a source-confirmed conjunction between two expressions remains translatable prose');
  assert.equal(pairedDocument.formulaCount, 2);
  assert.deepEqual(pairedDocument.uncertainFormulaStarts,
    mathRanges(pairedDocument.text).map((range) => range.start),
    'both expressions in a low-confidence region remain independently reviewable');
  assert.match(mergeFormulaDocument({ blocks: [] }, [pairedNormal], size).text, /\\mathrm.*a n d/,
    'without source confirmation the recognizer must not restructure a mathematical region');
  const regularizer = { x: 10, y: 10, w: 80, h: 20, display: true, confidence: .95,
    latex: String.raw`\mathrm { w h e r e } \ \Omega ( f ) = \gamma T + \frac { 1 } { 2 } \lambda { \| w \| } ^ { 2 }` };
  const whereSource = { blocks: [{ text: 'where Ω(f) = γT + ½λ||w||²', confidence: 1,
    boundingBox: { x: .1, y: .7, w: .8, h: .2 } }] };
  const whereDocument = mergeFormulaDocument({ blocks: [] }, [regularizer], size, whereSource);
  assert.equal(whereDocument.text,
    String.raw`where $\Omega ( f ) = \gamma T + \frac { 1 } { 2 } \lambda { \| w \| } ^ { 2 }$`,
    'a source-confirmed where stays prose while the regularizer remains an intact math span');
  assert.equal(whereDocument.formulaCount, 1);
  const missingWhere = mergeFormulaDocument({ blocks: [] }, [regularizer], size);
  assert.equal(missingWhere.text, whereDocument.text,
    'an exact where before an equation remains readable when Vision omits that whole row');
  assert.equal(missingWhere.uncertainFormulaCount, 1,
    'a connector without independent text corroboration requires math review');
  assert.match(mergeFormulaDocument({ blocks: [] }, [regularizer], size,
    { blocks: [{ ...whereSource.blocks[0], text: 'somewhere Ω(f) = γT', confidence: 1 }] }).text,
  /\\mathrm.*w h e r e/u, 'a different source word cannot confirm a prose connector');
  const lossContext = { x: 10, y: 40, w: 55, h: 20, display: true, confidence: .95,
    latex: String.raw`\mathcal L=\sum_i l(\hat y_i,y_i)` };
  const lossSentence = 'Here I is a differentiable convex loss function that measures predictions.';
  const lossBlock = { text: lossSentence, confidence: 1,
    boundingBox: { x: .1, y: .1, w: .8, h: .2 } };
  const lossRestored = mergeFormulaDocument({ blocks: [] }, [lossContext], size,
    { blocks: [lossBlock] }, { blocks: [{ ...lossBlock, text: lossSentence.replace('Here I is', 'Here l is') }] });
  assert.match(lossRestored.text, /Here l is a differentiable convex loss function/u);
  assert.equal(lossRestored.rowRecovered, 1,
    'two OCR layouts and the loss equation restore an ambiguous serif l with review');
  assert.match(mergeFormulaDocument({ blocks: [] }, [lossContext], size,
    { blocks: [lossBlock] }).text, /Here I is a differentiable/u,
  'one OCR reading cannot silently change a mathematical letter');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [formula], size,
    { blocks: [word('x.', 10, 24), word('•', 36, 5), word('label', 45, 30)] }).text, '$x$. • label',
  'a separate source bullet must survive punctuation deduplication');
  const relation = { ...formula, w: 26, latex: 'p = q' };
  const relationWords = [word('p', 10, 5), word('=', 20, 5), word('q,', 29, 13)]
    .map(block => ({ ...block, confidence: 1 }));
  const trailingText = { blocks: [word('next', 70, 25)] };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [relation], size, trailingText,
    { blocks: relationWords }).text, '$p = q$, next',
  'an agreeing secondary OCR span preserves punctuation lost with a repaired source row');
  for (const alternatives of [
    relationWords.map(block => ({ ...block, confidence: .5 })),
    [{ ...word('p', 10, 5), confidence: 1 }, { ...word('=', 20, 5), confidence: 1 }, { ...word('r,', 29, 13), confidence: 1 }],
    relationWords.slice(-1),
    [{ ...word('p=q,', 70, 25), confidence: 1 }],
  ]) assert.equal(mergeFormulaDocument({ blocks: [] }, [relation], size, trailingText,
    { blocks: alternatives }).text, '$p = q$ next',
  'uncertain, different, partial or displaced secondary text cannot supply punctuation');
  assert.equal(mergeFormulaDocument({ blocks: [word(',', 38, 4)] }, [relation], size,
    { blocks: [word('p=q', 10, 30), ...trailingText.blocks] }, { blocks: relationWords }).text, '$p = q$, next',
  'secondary punctuation and a masked punctuation fragment appear only once');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [relation], size,
    { blocks: [word(',', 38, 4), ...trailingText.blocks] }, { blocks: relationWords }).text, '$p = q$, next',
  'a retained source comma must not be duplicated by the secondary OCR');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [relation], size,
    { blocks: [word('p=q;', 10, 32), ...trailingText.blocks] }, { blocks: relationWords }).text, '$p = q$; next',
  'existing original punctuation has precedence over a different secondary reading');
  const alignedComma = { ...formula, display: true,
    latex: String.raw`\begin{aligned} { \mathrm{ECE}=\sum_{m=1}^{M}\frac{|B_m|}{n}|\operatorname{acc}(B_m)-\operatorname{conf}(B_m)|, } \\ \end{aligned}` };
  const alignedDocument = mergeFormulaDocument({ blocks: [] }, [alignedComma], size,
    { blocks: [word('ECE,', 10, 27)] });
  assert.equal(alignedDocument.text.match(/,/gu)?.length, 1,
    'a display equation comma read by both recognizers appears only once');
  assert.match(alignedDocument.text, /\\end\{aligned\}\$\$,/u,
    'sentence punctuation follows rather than enters the aligned equation');
  const orphanBar = String.raw`\begin{aligned} f &= \left.\frac{dL}{d\epsilon}\right|_{\epsilon=0} \\ &= \frac{d\theta}{d\epsilon}\right|_{\epsilon=0} \end{aligned}`;
  const repairedBar = repairUnpairedEvaluationBars(orphanBar);
  assert.match(repairedBar, /\\left\.\\frac\{dL\}\{d\\epsilon\}\\right\|/u,
    'the correctly paired first row stays exactly as recognized');
  assert.match(repairedBar, /\\frac\{d\\theta\}\{d\\epsilon\}\\big\|/u,
    'a lone evaluation bar in the next row retains its visible meaning');
  assert.doesNotThrow(() => require('katex').renderToString(repairedBar, { throwOnError: true, displayMode: true }),
    'the displayed multi-row derivative must render as math');
  const repairedDocument = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: orphanBar, confidence: .99 }], size);
  assert.match(repairedDocument.text,
    /\\big\|_\{\\epsilon=0\}/u,
    'formula OCR repair reaches the text actually shown to the reader');
  assert.equal(repairedDocument.uncertainFormulaCount, 1,
    'a syntactically repaired formula remains marked for human source comparison');
  const missingCaseDelimiter = String.raw`a _ { i } ^ { T } a _ { j } = \left\{ \begin{array} { l l } { 1 } & { i = j } \\ { 0 } & { i \neq j. } \\ \end{array} \right`;
  const caseDocument = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: missingCaseDelimiter, confidence: .99 }], size);
  assert.match(caseDocument.text, /\\end\{array\}\s*\\right\.\$\$/u,
    'an OCR case brace missing its invisible right delimiter must render as mathematics');
  assert.doesNotThrow(() => require('katex').renderToString(mathRanges(caseDocument.text)[0].tex,
    { throwOnError: true, displayMode: true }),
  'the case equation shown to the reader must parse as display mathematics');
  assert.equal(caseDocument.uncertainFormulaCount, 1,
    'a repaired case delimiter still needs comparison to the original image');
  assert.equal(caseDocument.caseDelimiterRepairs, 1);
  assert.equal(caseDocument.unrenderableFormulaCount, 0);
  const completeCase = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: `${missingCaseDelimiter}.`, confidence: .99 }], size);
  assert.equal(completeCase.uncertainFormulaCount, 0,
    'a valid left-only case brace must not receive a false review marker');
  assert.equal(completeCase.caseDelimiterRepairs, 0,
    'the invisible delimiter period must not be mistaken for sentence punctuation');
  assert.match(completeCase.text, /\\end\{array\}\s*\\right\.\$\$$/u);
  const punctuatedCase = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: `${missingCaseDelimiter.replace('j.', 'j')}..`, confidence: .99 }], size);
  assert.match(punctuatedCase.text, /\\right\.\$\$\.$/u,
    'sentence punctuation after an invisible delimiter stays outside the formula');
  assert.equal(punctuatedCase.caseDelimiterRepairs, 0);
  const caseWithVisionPeriod = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: `${missingCaseDelimiter}.`, confidence: .99 }], size,
  { blocks: [word('j.', 10, 18)] });
  assert.match(caseWithVisionPeriod.text, /\\end\{array\}\s*\\right\.\$\$$/u,
    'Vision punctuation already inside the final case row must not appear again after the equation');
  const caseWithoutInternalPeriod = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: missingCaseDelimiter.replace('j.', 'j') + '.', confidence: .99 }], size,
  { blocks: [word('j.', 10, 18)] });
  assert.match(caseWithoutInternalPeriod.text, /\\right\.\$\$\.$/u,
    'a source period absent from the case row must still survive outside the display');
  const unrenderable = mergeFormulaDocument({ blocks: [] }, [{ ...formula, display: true,
    latex: String.raw`\frac{a}{`, confidence: .99 }], size);
  assert.equal(unrenderable.uncertainFormulaCount, 1,
    'an unrepaired malformed formula must never appear as confident, unreviewed source');
  assert.equal(unrenderable.unrenderableFormulaCount, 1);
  const edgeSize = { width: 1000, height: 100 };
  const edgeWord = (text, x, w) => ({ ...word(text, x / 10, w / 10),
    characters: [...text].map((char) => ({ text: char, boundingBox: { x: x / 1000, y: .7, w: w / 1000, h: .2 } })) });
  assert.equal(mergeFormulaDocument({ blocks: [] }, [], edgeSize,
    { blocks: [edgeWord('t', 30, 10)] }, { blocks: [edgeWord('Let', 10, 30)] }).text, 'Let',
  'padding can restore a missing prefix at the same source location');
  for (const alternate of [edgeWord('t', 30, 10), edgeWord('Net', 70, 30), edgeWord('Loss', 10, 30)]) {
    assert.equal(mergeFormulaDocument({ blocks: [] }, [], edgeSize,
      { blocks: [edgeWord('Let', 10, 30)] }, { blocks: [alternate] }).text, 'Let',
    'a second OCR layout cannot shorten, move or substitute the original word');
  }
  const row = (text, y) => ({ text, confidence: 1, boundingBox: { x: .05, y, w: .9, h: .1 },
    characters: [{ text, boundingBox: { x: .05, y, w: .9, h: .1 } }] });
  const missingTop = mergeFormulaDocument({ blocks: [] }, [], { width: 1000, height: 200 },
    { blocks: [row('Third source line remains authoritative.', .4)] },
    { blocks: [row('First source line recovered at top.', .78), row('Second source line recovered at top.', .59),
      row('Different reading of third line ignored.', .4)] });
  assert.equal(missingTop.text, 'First source line recovered at top.\nSecond source line recovered at top.\nThird source line remains authoritative.',
    'a padded pass may restore missing top rows without replacing existing source rows');
  assert(missingTop.edgeRecovered, 'a recovered edge requires explicit reader review');
  const beforeGap = row('A full source line before the gap.', .75);
  const missingMiddle = row('A complete middle line survives the local image recheck.', .58);
  const afterGap = row('A full source line after the gap.', .41);
  assert.deepEqual(missingInteriorRows({ blocks: [beforeGap, afterGap] },
    { blocks: [beforeGap, missingMiddle, afterGap] }), [missingMiddle],
  'only a substantial padded row missing between two source anchors needs a local recheck');
  assert.equal(missingInteriorRows({ blocks: [beforeGap, afterGap] },
    { blocks: [{ ...missingMiddle, confidence: .5 }] }).length, 0,
  'a doubtful padded row is not enough to propose missing prose');
  const otherColumn = { ...missingMiddle, boundingBox: { x: .65, y: .58, w: .3, h: .1 } };
  const leftColumn = (text, y) => ({ ...row(text, y), boundingBox: { x: .05, y, w: .4, h: .1 } });
  assert.equal(missingInteriorRows({ blocks: [leftColumn(beforeGap.text, .75), leftColumn(afterGap.text, .41)] },
    { blocks: [otherColumn] }).length, 0, 'a row in another column cannot fill this column\'s gap');
  assert(orderedAgreement('f(x;mOlo), winning tickets since the initialization lottery was won',
    'f (x; m O lo), winning tickets since the initialization lottery was won') >= .85,
  'local OCR can confirm prose while the formula glyphs differ');
  assert(orderedAgreement('winning tickets since the initialization lottery was won',
    'winning masks alter every connection before the network was trained') < .85,
  'unrelated local OCR does not confirm a padded row');
  const repairedInterior = mergeFormulaDocument({ blocks: [] }, [], { width: 1000, height: 200 },
    { blocks: [beforeGap, afterGap] }, { blocks: [beforeGap, missingMiddle, afterGap] }, [missingMiddle]);
  assert.equal(repairedInterior.text, [beforeGap, missingMiddle, afterGap].map((block) => block.text).join('\n'),
  'a locally verified middle line is inserted in visual reading order');
  assert.equal(repairedInterior.interiorRecovered, 1, 'middle-line recovery remains visible for review');
  const cnpSize = { width: 860, height: 494 };
  const cnpRow = (text, x, y, w, h) => ({ text, confidence: 1,
    boundingBox: { x: x / cnpSize.width, y: 1 - (y + h) / cnpSize.height,
      w: w / cnpSize.width, h: h / cnpSize.height } });
  const cnpLead = cnpRow('P defines a joint distribution over the ran-', 12, 306, 830, 35);
  const cnpTail = cnpRow(', and therefore a conditional', 445, 345, 395, 40);
  const cnpMissing = cnpRow('dom variables', 12, 345, 203, 30);
  const cnpFormula = { x: 220, y: 345, w: 220, h: 45, latex: 'f(x)', display: false, confidence: .95 };
  const cnpOriginal = { blocks: [cnpLead, cnpTail], spellJoinCandidates: ['random'] };
  const cnpPadded = { blocks: [cnpRow('dom variables {f(x)}', 12, 345, 428, 45)] };
  const cnpRecovered = mergeFormulaDocument({ blocks: [cnpMissing] }, [cnpFormula],
    cnpSize, cnpOriginal, cnpPadded);
  assert.match(cnpRecovered.text, /random variables \$f\(x\)\$, and therefore/u,
    'two aligned OCR layouts restore prose omitted beside an inline formula');
  assert.equal(cnpRecovered.rowRecovered, 1, 'restored prose must pause translation for source review');
  const cnpUnconfirmed = mergeFormulaDocument({ blocks: [cnpMissing] }, [cnpFormula],
    cnpSize, cnpOriginal, { blocks: [cnpRow('different words {f(x)}', 12, 345, 428, 45)] });
  assert.doesNotMatch(cnpUnconfirmed.text, /dom variables/u,
    'masked OCR alone cannot invent words that the padded image read differently');
  const cnpAlreadyPresent = mergeFormulaDocument({ blocks: [cnpMissing] }, [cnpFormula],
    cnpSize, { blocks: [cnpLead, cnpMissing, cnpTail], spellJoinCandidates: ['random'] }, cnpPadded);
  assert.equal((cnpAlreadyPresent.text.match(/random variables/gu) || []).length, 1,
    'words already present in the source layout must not be duplicated');
  const highConfidenceRow = (text, y) => ({ ...placedWord(text, 5, y, 90, 15),
    boundingBox: { x: .05, y: (100 - y - 15) / 100, w: .9, h: .15 } });
  const trueRows = [highConfidenceRow('Academic reading begins with an intact introduction.', 10),
    highConfidenceRow('Normalization statistics use units from one case.', 35),
    highConfidenceRow('Later discussion defines recurrent network parameters.', 60)];
  const misplacedRows = { blocks: [highConfidenceRow('Academic reading begins with an intact', 35),
    highConfidenceRow('Normalization statistics use units from one case.', 60)] };
  const recoveredRows = mergeFormulaDocument({ blocks: trueRows }, [], size, misplacedRows, { blocks: trueRows });
  assert.equal(recoveredRows.text, trueRows.map((block) => block.text).join('\n'),
  'two agreeing OCR layouts repair confident prose assigned to the wrong printed rows');
  assert.equal(recoveredRows.rowRecovered, 2, 'the review card must report repaired row conflicts');
  for (const [tex, expected] of [
    [String.raw`1 ^ { \mathrm { s t } }`, '1st'],
    [String.raw`2 ^ { \text { n d } }`, '2nd'],
    [String.raw`x ^ { s t }`, String.raw`$x ^ { s t }$`],
    [String.raw`\dot{x}`, String.raw`$\dot{x}$`],
  ]) {
    assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...formula, latex: tex }], size).text, expected);
  }
  const superscriptWord = { ...formula, score: .2, latex: 'b i a s e d ^ { 2 }' };
  const uncertainSuperscript = mergeFormulaDocument({ blocks: [] }, [{ ...superscriptWord, confidence: .4 }], size,
    { blocks: [word('biased', 10, 18), word('estimate', 45, 30)] });
  assert.deepEqual(uncertainSuperscript.uncertainFormulaStarts,
    [mathRanges(uncertainSuperscript.text)[0].start],
    'a footnote attached to prose marks the superscript, not the English word');
  for (const score of [.2, .44, .9]) assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...superscriptWord, score }], size,
    { blocks: [word('biased', 10, 18), word('estimate', 45, 30)] }).text, 'biased$^{2}$ estimate',
  'a source-confirmed word keeps translatable prose and its superscript regardless of layout confidence');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [superscriptWord], size,
    { blocks: [word('unbiased', 10, 18), word('estimate', 45, 30)] }).text, 'unbiased estimate',
  'a disagreement must not replace the source word or attach an unsupported marker');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...superscriptWord, w: 32, latex: 'A \\; b i a s e d ^ { 12 } ,' }], size,
    { blocks: [word('A', 10, 5), word('biased,', 20, 22), word('estimate', 60, 30)] }).text, 'A biased$^{12}$, estimate',
  'an adjacent article, multi-digit superscript and source punctuation survive as one prose span');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...superscriptWord, display: true }], size).text,
    '$$b i a s e d ^ { 2 }$$', 'display mathematics must not become prose');
  const styledFootnote = { ...superscriptWord, latex: String.raw`\mathrm { f u n c t i o n s } ^ { 2 }` };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [styledFootnote], size,
    { blocks: [word('functions²', 10, 18), word('then', 45, 30)] }).text,
  'functions$^{2}$ then', 'a Vision-confirmed plural footnote stays translatable despite roman math styling');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...styledFootnote, latex: styledFootnote.latex + ',' }], size,
    { blocks: [word('functions?,', 10, 18), word('then', 45, 30)] }).text,
  'functions$^{2}$, then', 'a spurious Vision question mark before a comma cannot erase an independently read footnote');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...styledFootnote, latex: styledFootnote.latex + ',' }], size,
    { blocks: [word("functions',", 10, 18), word('then', 45, 30)] },
    { blocks: [{ ...word('functions?,', 10, 18), confidence: 1 }] }).text,
  'functions$^{2}$, then', 'a same-position alternate reading confirms a footnote mistaken for an apostrophe');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [styledFootnote], size,
    { blocks: [word("functions',", 10, 18), word('then', 45, 30)] },
    { blocks: [word("functions',", 10, 18)] }).text,
  "functions', then", 'an undisputed printed apostrophe must not be rewritten as a footnote');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [styledFootnote], size,
    { blocks: [word('functions', 10, 18), word('then', 45, 30)] }).text,
  'functions$^{2}$ then', 'a separate footnote marker is preserved when Vision reads only its prose word');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [styledFootnote], size,
    { blocks: [word('function', 10, 18), word('then', 45, 30)] }).text,
  'function then', 'a different Vision word cannot be silently replaced by formula recognition');
  const abbreviationFormula = { ...formula, w: 50,
    latex: String.raw`i. e., \, \mathcal { H } ( \mathbf { x } ) - \mathbf { x }` };
  const abbreviationSource = { blocks: [word('i.e.,', 10, 20), word('H(x)', 34, 22), word('next', 75, 20)] };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [abbreviationFormula], size, abbreviationSource).text,
    String.raw`i.e., $\mathcal { H } ( \mathbf { x } ) - \mathbf { x }$ next`,
    'a Vision-confirmed i.e. prefix stays prose while the following formula remains TeX');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [abbreviationFormula], size,
    { blocks: [word('e.g.,', 10, 20), word('H(x)', 34, 22), word('next', 75, 20)] }).text,
    String.raw`$i. e., \, \mathcal { H } ( \mathbf { x } ) - \mathbf { x }$ next`,
    'a conflicting source reading cannot rewrite the mathematical span');
  const etcFormula = { ...formula, latex: 'e t c . )', confidence: .47 };
  assert.equal(mergeFormulaDocument({ blocks: [] }, [etcFormula], size,
    { blocks: [word('etc.).', 10, 18), word('next', 45, 30)] }).text, 'etc.). next',
  'a Vision-confirmed prose abbreviation must not become a mathematical product');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [etcFormula], size).text, '$e t c. )$',
    'without independent prose confirmation, keep the formula candidate for review');
  assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...formula, score: .8, latex: 'a b c d ^ { 2 }' }], size,
    { blocks: [word('abcd', 10, 18)] }).text, '$a b c d ^ { 2 }$',
  'an isolated product is not a footnote-bearing prose word');
  for (const score of [.2, .7]) {
    for (const tex of ['x ^ { 2 }', 'x y ^ { 2 }', 'x y z ^ { 2 }', String.raw`\mathrm{rate}^{2}`, 'loss_{i}^{2}', 'a+bcd^{2}']) {
      assert.equal(mergeFormulaDocument({ blocks: [] }, [{ ...formula, score, latex: tex }], size).text,
        `$${tex}$`, 'ordinary powers, products, operators, named quantities and subscripts retain mathematical structure');
    }
  }
  const line = (text, y, h, confidence = 1, x = .05, w = .9) =>
    ({ text, confidence, boundingBox: { x, y, w, h } });
  const mergedLines = { blocks: [line('Unreadable merged row', .2, .5, .5)] };
  const separatedLines = { blocks: [line('First readable source line', .5, .2), line('Second readable source line', .2, .2)] };
  const weakSentence = line('J reaches mınımum valıdatıon loss at iteration', .2, .2, .5);
  const paddedSentence = line('f reaches minimum validation loss at iteration', .2, .2);
  const maskedSentence = line('f reaches minimum validation loss at iteration', .2, .2);
  const repairedSentence = mergeFormulaDocument({ blocks: [maskedSentence] }, [], size,
    { blocks: [weakSentence] }, { blocks: [paddedSentence] });
  assert.equal(repairedSentence.text, paddedSentence.text,
    'a low-confidence row can use padded OCR when formula-masked pixels confirm its prose');
  assert.equal(repairedSentence.rowRecovered, 1, 'a corrected source row stays visible in review');
  assert.equal(mergeFormulaDocument({ blocks: [line('unrelated prose from the next column', .2, .2)] }, [], size,
    { blocks: [weakSentence] }, { blocks: [paddedSentence] }).text, weakSentence.text,
  'an uncorroborated padded sentence must not replace the source');
  assert.equal(mergeFormulaDocument({ blocks: [maskedSentence] }, [], size,
    { blocks: [weakSentence] }, { blocks: [line(paddedSentence.text, .05, .2)] }).text, weakSentence.text,
  'a different printed row cannot supply a replacement');
  assert.equal(mergeFormulaDocument(separatedLines, [], size, mergedLines).text,
    'First readable source line\nSecond readable source line',
    'confident separate rows can recover a low-confidence observation that merged multiple source lines');
  for (const alternative of [
    { blocks: [line('Only one replacement line', .2, .2)] },
    { blocks: separatedLines.blocks.map(b => ({ ...b, confidence: .5 })) },
    { blocks: [line('First side by side fragment', .2, .2, 1, .05, .4), line('Second side by side fragment', .2, .2, 1, .55, .4)] },
  ]) assert.equal(mergeFormulaDocument(alternative, [], size, mergedLines).text, 'Unreadable merged row',
    'a missing row, uncertain text or fragments on the same baseline cannot replace the original');
  assert.equal(mergeFormulaDocument(separatedLines, [], size,
    { blocks: [line('Keep a confident source observation', .2, .5)] }).text, 'Keep a confident source observation');
  assert.match(mergeFormulaDocument(separatedLines,
    [{ x: 10, y: 30, w: 70, h: 50, latex: 'x^2', display: true }], size, mergedLines).text, /\$\$x\^2\$\$/,
  'multiple rows belonging to display mathematics remain under the formula recognizer');
  const source = String.raw`Conditional expectation is $\mathbb{E}[Y\mid X=x]$.

$$\mathbb{E}[Y\mid X=x]=\int_{-\infty}^{\infty}y f_{Y\mid X}(y\mid x)\,\mathrm{d}y.$$

The sample mean is \(\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i\).`;
  assert.equal(mathRanges(source).length, 3);
  assert(isMathOnly(String.raw`$$\frac{1}{n}\sum_{i=1}^n x_i$$`));
  assert(!isMathOnly('The mean is $x$.'));
  assert.equal(mathRanges(String.raw`Price \$5 and \$10. The value is $x_1^2$.`).length, 1);
  assert.equal(mathRanges('Price $5 and $10.').length, 0);
  assert.deepEqual(mathRanges('Removing $2x$ still leaves a spanning set.').map(({ tex }) => tex), ['2x'],
    'a scalar coefficient times a variable must render as mathematics');
  assert.equal(mathRanges('范数不超过 $1$，概率为 $0.5$。').length, 2, 'explicitly delimited constants are mathematics');
  assert.equal(mathRanges('Prices $5$10 are adjacent amounts.').length, 0, 'a second price marker is not a closing math delimiter');
  assert.equal(mathRanges('`$x$` and ```\n$$x$$\n```').length, 0);
  assert.equal(mathRanges('Unclosed $x_1').length, 0);
  assert(needsMathReview('E[Y | X] = y'));
  assert(needsMathReview('∫ f(x) dx'));
  assert(!needsMathReview('Correlation does not imply causation.'));
  const longFormula = '$$\\begin{aligned}\n' + 'x_i &= y_i + z_i \\\\\n\n'.repeat(150) + '\\end{aligned}$$';
  const longSource = 'Opening prose.\n\n' + longFormula + '\n\nClosing prose.';
  assert(readingSegments(longSource).some((segment) => segment.source === longFormula), 'never split inside display math, even at blank lines or size boundaries');
  const translated = '条件期望为 $\\mathbb{E}[Y\\mid X=x]$。';
  const processor = createReadingProcessor(async () => JSON.stringify({ translation: translated, terms: [] }));
  assert.equal((await processor({ text: source, withTerms: true, settingsSnapshot: { activeBackend: 'deepseek' } })).translation, translated);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=';
  const calls = [];
  const recognize = createFormulaRecognizer(async (...args) => { calls.push(args); return JSON.stringify({ text: source, uncertain: ['积分上限需要对照原图'] }); });
  const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash', deepseekApiKey: 'fixture-key' };
  const result = await recognize({ image, settingsSnapshot: settings });
  assert.equal(result.text, source);
  assert.equal(calls[0][2], FORMULA_MODEL);
  assert.equal(calls[0][4][1].image_url.url, image);
  assert.equal(settings.activeModel, 'deepseek-v4-flash', 'formula request must not change the configured text model');
  await assert.rejects(recognize({ image: 'https://example.com/image.png', settingsSnapshot: settings }));
  await assert.rejects(recognize({ image, settingsSnapshot: { ...settings, activeBackend: 'custom' } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recognize({ image, settingsSnapshot: settings, signal: controller.signal }));
  assert.equal(calls.length, 1, 'invalid or cancelled requests must not upload');
  const invalid = createFormulaRecognizer(async () => '{"text":"partial", "uncertain":"none"}');
  await assert.rejects(invalid({ image, settingsSnapshot: settings }), /formula-invalid-output/);
  const escapedWrongly = createFormulaRecognizer(async () => JSON.stringify({ text: 'Formula $\frac{a}{b}$', uncertain: [] }));
  await assert.rejects(escapedWrongly({ image, settingsSnapshot: settings }), /formula-invalid-output/, 'a JSON form-feed must not silently replace a LaTeX backslash');
  console.log('Math checks passed: delimiters, currency/code, intact equations across splitting, LaTeX output, explicit vision backend, bounded input and cancellation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
