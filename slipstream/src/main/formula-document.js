'use strict';
const { mathRanges } = require('../shared/reading-math.cjs');
const FORMULA_REVIEW_CONFIDENCE = .7;

function proseSuperscript(latex) {
  // An inline region can include a prose word and its footnote marker.
  // Keep commands, operators, short products and subscripts as mathematics.
  const compact = latex.replace(/\s+/g, '').replace(/\\(?:qquad|quad|[,;])/g, ' ');
  const match = compact.match(/^((?:[A-Za-z]+ )*[A-Za-z][a-z]{3,})\^\{(\d{1,3})\}([,.;:!?]?)$/)
    // MFR can style a long plural English word as roman mathematics. Only a
    // matching Vision word and adjacent prose below can turn it back to text.
    || compact.match(/^\\(?:mathrm|text)\{([a-z]{6,}s)\}\^\{(\d{1,3})\}([,.;:!?]?)$/);
  return match ? { text: match[1], superscript: match[2] } : null;
}

function repairUnpairedEvaluationBars(latex) {
  // MFR can omit the invisible \left. before the second evaluation bar of
  // a multi-row derivation. A lone \right| is invalid TeX; \big| renders the
  // same visible bar without inventing any mathematical content. Delimiters
  // must balance within each aligned row, so reset at a row break.
  return latex.split(/(\\\\)/u).map((row) => {
    let depth = 0;
    return row.replace(/\\(?:left|right)\s*(?:\\[A-Za-z]+|[^\s])/gu, (delimiter) => {
      if (/^\\left\b/u.test(delimiter)) { depth += 1; return delimiter; }
      if (depth > 0) { depth -= 1; return delimiter; }
      return /^\\right\s*\|/u.test(delimiter) ? delimiter.replace(/\\right/u, '\\big') : delimiter;
    });
  }).join('');
}

// Keep the original prose as the reading-order anchor. Masking can make Vision
// merge adjacent lines or hallucinate fragments; replace a doubtful source row
// only when the masked and padded layouts independently agree at its location.
function mergeFormulaDocument(masked, formulas, size, original, edgeProse, verifiedInterior = []) {
  const pixelBox = (box) => ({ x: box.x * size.width, y: (1 - box.y - box.h) * size.height,
    w: box.w * size.width, h: box.h * size.height });
  function words(ocr) {
    const result = [];
    for (const line of ocr?.blocks || []) {
      let word;
      for (const char of line.characters || []) {
        const box = pixelBox(char.boundingBox);
        if (!box.w || !box.h || !char.text.trim()) { word = null; continue; }
        if (word && ['x', 'y', 'w', 'h'].every((key) => word[key] === box[key])) word.text += char.text;
        else { word = { ...box, text: char.text, confidence: line.confidence }; result.push(word); }
      }
      if (!line.characters?.length && line.boundingBox) result.push({ ...pixelBox(line.boundingBox), text: line.text, confidence: line.confidence });
    }
    return result;
  }
  const intersects = (a, b) => {
    const vertical = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * vertical;
    // Vision's word boxes may reach into the next printed line. A formula
    // detector touching that fringe must not erase a source word above it.
    return area > Math.min(a.w * a.h, b.w * b.h) * .3
      && vertical > Math.min(a.h, b.h) * .5
      && Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < Math.max(a.h, b.h) * .6;
  };
  // Vision sometimes combines two visible prose rows into one low-confidence
  // observation. Use the masked pass only when it resolves that same rectangle
  // into complete, confident, vertically separate rows. Keep normal source
  // observations as anchors; a different spelling alone is not a replacement.
  const sourceBlocks = (original || masked)?.blocks || [];
  const firstSource = sourceBlocks.filter((block) => block.boundingBox)
    .map((block) => pixelBox(block.boundingBox))
    .sort((a, b) => a.y - b.y)[0];
  // Vision can omit complete lines at the top of a tight screenshot while the
  // padded pass sees them. Admit only confident, substantial rows clearly
  // above the first source observation; never replace an existing source row.
  const recoveredLeading = firstSource ? (edgeProse?.blocks || []).filter((block) => {
    if (block.confidence < .9 || !block.boundingBox || block.text.trim().length < 25
      || (block.text.match(/\p{L}{3,}/gu) || []).length < 4) return false;
    const row = pixelBox(block.boundingBox);
    return row.y + row.h / 2 < firstSource.y + firstSource.h / 2 - Math.min(row.h, firstSource.h) * .7;
  }).sort((a, b) => pixelBox(a.boundingBox).y - pixelBox(b.boundingBox).y).slice(0, 4) : [];
  // In a dense PDF, Vision can report a perfectly confident sentence at the
  // coordinates of another row. Require two independent OCR layouts to agree
  // on the prose at those coordinates before replacing that source row.
  const proseTokens = (value) => new Set((value.toLowerCase().match(/\p{L}{3,}/gu) || []));
  const tokenCoverage = (a, b) => {
    const terms = proseTokens(a), reference = proseTokens(b);
    return terms.size ? [...terms].filter((term) => reference.has(term)).length / terms.size : 0;
  };
  function samePrintedRow(block, candidate) {
    if (!block.boundingBox || !candidate.boundingBox || candidate.confidence < .9) return false;
    const box = pixelBox(block.boundingBox), row = pixelBox(candidate.boundingBox);
    return Math.abs(row.y + row.h / 2 - box.y - box.h / 2) < Math.min(row.h, box.h) * .55
      && row.x + row.w > box.x && row.x < box.x + box.w;
  }
  function confirmedSourceRow(block) {
    if (!block.boundingBox || block.confidence < .9 || block.text.length < 30) return null;
    const maskedRows = (masked?.blocks || []).filter((candidate) => samePrintedRow(block, candidate)
      && proseTokens(candidate.text).size);
    const maskedText = maskedRows.sort((a, b) => pixelBox(a.boundingBox).x - pixelBox(b.boundingBox).x)
      .map((candidate) => candidate.text).join(' ');
    if (proseTokens(maskedText).size < 4 || tokenCoverage(maskedText, block.text) >= .45) return null;
    const confirmed = (edgeProse?.blocks || []).some((candidate) => samePrintedRow(block, candidate)
      && tokenCoverage(maskedText, candidate.text) >= .7);
    return confirmed ? maskedRows : null;
  }
  function confirmedLowConfidenceRow(block) {
    // A padded pass alone can corrupt mathematics. Require the formula-masked
    // pixels to corroborate its prose before using it for a doubtful row.
    if (!block.boundingBox || block.confidence > .5 || block.text.length < 30) return null;
    const paddedRows = (edgeProse?.blocks || []).filter((candidate) => samePrintedRow(block, candidate)
      && candidate.text.length >= 25);
    if (paddedRows.length !== 1) return null;
    const padded = paddedRows[0];
    const maskedRows = (masked?.blocks || []).filter((candidate) => samePrintedRow(block, candidate)
      && proseTokens(candidate.text).size);
    const maskedText = maskedRows.sort((a, b) => pixelBox(a.boundingBox).x - pixelBox(b.boundingBox).x)
      .map((candidate) => candidate.text).join(' ');
    if (proseTokens(maskedText).size < 4 || tokenCoverage(maskedText, padded.text) < .8
      || tokenCoverage(block.text, padded.text) < .55 || padded.text === block.text) return null;
    return padded;
  }
  function confirmedLossLetterRow(block) {
    // Serif italic l can look like capital I to Vision. A padded reading of
    // the same complete sentence and the displayed loss equation must agree
    // before changing that one character; retain the normal row-review flag.
    if (!block.boundingBox || block.confidence < .9
      || !/\bHere I is a differentiable convex loss function\b/u.test(block.text)
      || !formulas.some(({ latex }) => /(?:^|[\s=])l\s*\(/u.test(latex))) return null;
    const corrected = block.text.replace('Here I is', 'Here l is');
    return (edgeProse?.blocks || []).find((candidate) => samePrintedRow(block, candidate)
      && candidate.text === corrected) || null;
  }
  let rowRecovered = verifiedInterior.length;
  const repairedRows = new Set();
  const anchored = [...recoveredLeading, ...verifiedInterior, ...sourceBlocks].flatMap((block) => {
    const lossLetter = confirmedLossLetterRow(block);
    if (lossLetter) { rowRecovered++; return [lossLetter]; }
    const confirmed = confirmedSourceRow(block);
    if (confirmed) {
      rowRecovered++;
      const unseen = confirmed.filter((candidate) => !repairedRows.has(candidate));
      unseen.forEach((candidate) => repairedRows.add(candidate));
      return unseen;
    }
    if (!(block.confidence <= .5) || !block.boundingBox) return [block];
    const box = pixelBox(block.boundingBox);
    if (formulas.some((f) => f.display && intersects(f, box))) return [block];
    const corroborated = confirmedLowConfidenceRow(block);
    if (corroborated) { rowRecovered++; return [corroborated]; }
    const rows = (masked?.blocks || []).filter((candidate) => {
      if (!(candidate.confidence >= .9) || !candidate.boundingBox
        || (candidate.text.match(/\p{L}{3,}/gu) || []).length < 3) return false;
      const row = pixelBox(candidate.boundingBox);
      return row.h < box.h * .7 && row.x >= box.x - box.h * .2
        && row.x + row.w <= box.x + box.w + box.h * .2
        && row.y >= box.y - row.h * .2 && row.y + row.h <= box.y + box.h + row.h * .2;
    }).sort((a, b) => pixelBox(a.boundingBox).y - pixelBox(b.boundingBox).y);
    if (rows.length < 2) return [block];
    const boxes = rows.map((row) => pixelBox(row.boundingBox));
    if (boxes.some((row, i) => i && row.y < boxes[i - 1].y + boxes[i - 1].h * .8)
      || boxes.at(-1).y + boxes.at(-1).h - boxes[0].y < box.h * .8) return [block];
    return rows;
  });
  const originalWords = words({ blocks: anchored });
  // Formula confidence measures the decoder's own certainty, not agreement
  // with the image's independent text reading. In textbook vector notation
  // Latin v/w can look like Greek nu/upsilon; do not silently trust that swap
  // when Vision read the Latin letter in the same formula rectangle.
  const independentWords = words(original);
  const edgeWords = words(edgeProse);
  function corroboratedIotaAsLatin(formula, latex) {
    // The character recheck can read an italic loss variable l as Greek iota.
    // Two independently laid-out Latin readings justify l, still with review.
    if (latex.replace(/\s+/gu, '') !== '\\iota') return false;
    const observed = (candidates) => candidates.filter((word) => intersects(formula, word))
      .sort((a, b) => a.x - b.x).map((word) => word.text).join('').trim();
    return observed(independentWords) === 'l' && observed(edgeWords) === 'l';
  }
  function latinGreekConflict(formula, latex) {
    if (!/\\(?:nu|upsilon|omicron)\b/u.test(latex)) return false;
    const observed = independentWords.filter((word) => intersects(formula, word))
      .sort((a, b) => a.x - b.x).map((word) => word.text).join('').replace(/\s+/gu, '');
    const compact = latex.replace(/\s+/gu, '');
    if (/^\\nu[,.;:!?]?$/u.test(compact)) return /^[Vv]$/u.test(observed);
    if (/\\vec(?:\{|\\(?:boldsymbol|mathbf|mathrm)\{)*\\omicron\b/u.test(compact)) return /[0O]/u.test(observed);
    return /\\vec(?:\{|\\(?:boldsymbol|mathbf|mathrm)\{)*\\(?:nu|upsilon)\b/u.test(compact)
      && (/[vwW]/u.test(observed) || latinVectorInSelection);
  }
  function corroboratedZeroVector(formula, latex) {
    const compact = latex.replace(/\s+/gu, '');
    if ((compact.match(/\\omicron\b/gu) || []).length !== 1
      || !/\\vec(?:\{|\\(?:boldsymbol|mathbf|mathrm)\{)*\\omicron\b/u.test(compact)) return false;
    const observed = independentWords.filter((word) => intersects(formula, word))
      .map((word) => word.text).join('');
    return /0/u.test(observed) && sourceBlocks.some((block) => /\bzero vector\b/iu.test(block.text)
      && words({ blocks: [block] }).some((word) => intersects(formula, word)));
  }
  const proseAnnotations = new Map();
  formulas = formulas.filter((formula) => {
    const compact = formula.latex.replace(/\s+/gu, '');
    if (!formula.display && /^(?:etc|e\.g|i\.e)\.\)?$/iu.test(compact)) {
      const observed = originalWords.filter((word) => intersects(formula, word))
        .sort((a, b) => a.x - b.x).map((word) => word.text).join('').replace(/\s+/gu, '');
      // MFR can treat an ordinary abbreviation at the end of a parenthesis
      // as a letter product. Keep Vision's punctuation when both agree.
      if (observed === compact || observed === compact + '.') return false;
    }
    const annotated = !formula.display ? proseSuperscript(formula.latex) : null;
    if (!annotated) return true;
    // The math model may recover a superscript, but cannot rewrite prose.
    // Require the original text recognizer to agree on every word in its box.
    const observed = originalWords.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x)
      .map((word) => word.text).join(' ');
    let source = observed.replace(/[,.;:!?]$/, '');
    // Vision can read a tiny footnote 2 as '?' immediately before the
    // sentence comma. The math recognizer must independently see that 2.
    if (observed.endsWith('?,') && source.endsWith('?')) source = source.slice(0, -1);
    source = source.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu, (digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit));
    if (source !== annotated.text && source !== annotated.text + annotated.superscript) return false;
    if (!originalWords.some((word) => !intersects(formula, word) && /^[A-Za-z]{3,}/.test(word.text)
      && Math.abs(word.y + word.h / 2 - formula.y - formula.h / 2) < Math.max(word.h, formula.h) * .6)) return true;
    proseAnnotations.set(formula, annotated);
    return true;
  });
  const sourceWords = originalWords.map((word) => {
    if (word.x > size.width * .06 || !/^\p{L}+$/u.test(word.text)
      || formulas.some((f) => intersects(f, word))) return word;
    // Recover only missing leading letters backed by the same image region.
    // Never substitute another word, shorten one, or move text across a formula.
    return edgeWords.find((candidate) => /^\p{L}+$/u.test(candidate.text)
      && candidate.text.length > word.text.length && candidate.text.endsWith(word.text)
      && candidate.x < word.x - 1 && intersects(candidate, word)
      && Math.abs(candidate.x + candidate.w - word.x - word.w) < Math.max(candidate.h, word.h) * .2
      && !formulas.some((f) => intersects(f, candidate))) || word;
  });
  const removed = sourceWords.filter((word) => formulas.some((f) => intersects(f, word)));
  // A formula's baseline can sit above/below its right-aligned number. Keep
  // the number with the display equation instead of making a prose paragraph.
  const equationLabels = new Map();
  for (const word of sourceWords.filter((word) => !removed.includes(word))) {
    const label = word.text.match(/^\(([A-Za-z]?\d+(?:[.-]\d+)*[a-z]?)\)$/);
    if (!label) continue;
    const formula = formulas.filter((f) => f.display && !equationLabels.has(f)
      && word.x >= f.x + f.w && Math.abs(word.y + word.h / 2 - f.y - f.h / 2) < f.h * .45)
      .sort((a, b) => Math.abs(word.y + word.h / 2 - a.y - a.h / 2)
        - Math.abs(word.y + word.h / 2 - b.y - b.h / 2))[0];
    if (formula) equationLabels.set(formula, { word, label: label[1] });
  }
  const labelledWords = new Set([...equationLabels.values()].map(({ word }) => word));
  const items = sourceWords.filter((word) => !removed.includes(word) && !labelledWords.has(word));
  function uncorroboratedBar(formula, latex) {
    // A high-scoring formula decoder can hallucinate a tiny bar. The padded
    // text pass is not strong enough to rewrite TeX, but an unbarred leading
    // symbol on the same printed row is enough to ask the reader to check it.
    const compact = latex.replace(/\\(?:boldsymbol|mathbf|mathit|mathrm)\b/gu, '').replace(/[{}\s]/gu, '');
    const symbol = compact.match(/^\\bar([A-Za-z])_([A-Za-z0-9])=/u);
    if (!symbol) return false;
    const plain = new RegExp(`^${symbol[1]}\\s*${symbol[2]}\\s*=`, 'u');
    return (edgeProse?.blocks || []).some((block) => block.boundingBox
      && intersects(formula, pixelBox(block.boundingBox)) && plain.test(block.text.trim()));
  }
  function footnoteInsideFormula(latex) {
    // A sentence-ending period followed by a raised star is a footnote
    // marker, not part of the preceding mathematical expression.
    return /\.\s*\^\s*\{\s*(?:\*|\\ast)\s*\}\s*$/u.test(latex);
  }
  const latinVectorInSelection = formulas.some(({ latex }) =>
    /\\vec\{?(?:\\(?:boldsymbol|mathbf|mathrm)\{?)?[vw]\b/u.test(latex.replace(/\s+/gu, '')));
  for (const formula of formulas) {
    let latex = repairUnpairedEvaluationBars(formula.latex.trim()), punctuation = '';
    const repairedEvaluationBar = latex !== formula.latex.trim();
    const correctedZero = corroboratedZeroVector(formula, latex);
    if (correctedZero) latex = latex.replace(/\\omicron\b/u, '0');
    const correctedIota = corroboratedIotaAsLatin(formula, latex);
    if (correctedIota) latex = 'l';
    const encodedColon = !formula.display && latex.match(/(?:\\colon|\\(?:mathbf|mathsf|mathrm|mathtt)\s*\{\s*:\s*\})\s*$/u);
    if (encodedColon) {
      // The math decoder sometimes includes the sentence colon in TeX while
      // masked Vision also reads that same glyph just outside the math box.
      punctuation = ':';
      latex = latex.slice(0, encodedColon.index).trim();
    } else if (/[,.;:!?]$/.test(latex)) { punctuation = latex.at(-1); latex = latex.slice(0, -1).trim(); }
    else {
      const last = removed.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x).at(-1);
      if (last && /[,.;:!?]$/.test(last.text)) {
        // Vision can read a subscript as a semicolon or a raised exponent as
        // a question mark inside the formula's own box. A real separator
        // should extend past the math region when MFR did not include it.
        const mark = last.text.at(-1);
        if (!/[;:?]/u.test(mark) || last.x + last.w > formula.x + formula.w + 2) punctuation = mark;
      }
    }
    // MFR often puts sentence punctuation inside the last row of an aligned
    // display. Keep it once after the TeX environment, as with inline math.
    const alignedEnd = latex.match(/([,.;:!?])(\s*\}\s*\\\\\s*\\end\{aligned\}(?:\s*\\tag\{[^{}]+\})?\s*)$/u);
    if (alignedEnd) {
      latex = latex.slice(0, alignedEnd.index) + alignedEnd[2];
      if (!punctuation) punctuation = alignedEnd[1];
    }
    if (!punctuation && !formula.display) {
      // A repaired masked row may have lost the punctuation beside its math.
      // The existing padded pass can supply it only when the whole formula
      // agrees literally at the same location. Never borrow its prose spelling.
      const matches = edgeWords.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x);
      const alternative = matches.map((word) => word.text).join('').replace(/\s+/g, '');
      if (matches.length && matches.every((word) => word.confidence >= .9) && /[,.;:!?]$/.test(alternative)
        && alternative.slice(0, -1) === latex.replace(/\s+/g, '')
        && !items.some((word) => word.text.trim() === alternative.at(-1) && intersects(word, matches.at(-1)))) {
        punctuation = alternative.at(-1);
      }
    }
    // Superscripted prose ordinals belong to the sentence, so translation can
    // turn "1st moment" into Chinese instead of protecting it as mathematics.
    const ordinal = latex.replace(/\s+/g, '').match(/^(\d+)\^\{\\(?:mathrm|text)\{(st|nd|rd|th)\}\}$/);
    const annotated = proseAnnotations.get(formula);
    const equationLabel = equationLabels.get(formula);
    let prosePrefix = '';
    // MFR sometimes encloses the prose connector "where" with the equation
    // beneath it. Keep its exact reading as prose. Vision may omit this whole
    // math row; without corroboration, mark the formula for reader review.
    const wherePrefix = latex.match(/^\\(?:mathrm|text)\s*\{\s*w\s*h\s*e\s*r\s*e\s*\}\s*(?:\\(?:[,;]|\s)\s*)?([\s\S]+)$/iu);
    const sourceWhere = wherePrefix && [...sourceBlocks, ...(edgeProse?.blocks || [])].some((block) => block.confidence >= .9
      && /^\s*where\b/iu.test(block.text) && block.boundingBox
      && intersects(formula, pixelBox(block.boundingBox)));
    const contraryWhere = wherePrefix && sourceBlocks.some((block) => block.confidence >= .9
      && /^\s*[A-Za-z]{4,}\b/u.test(block.text) && !/^\s*where\b/iu.test(block.text)
      && block.boundingBox && intersects(formula, pixelBox(block.boundingBox)));
    const separatedWhere = Boolean(wherePrefix && /=/u.test(wherePrefix[1]) && !contraryWhere);
    if (separatedWhere) { prosePrefix = 'where '; latex = wherePrefix[1].trim(); }
    if (!formula.display && !annotated) {
      const abbreviation = latex.match(/^i\s*\.\s*e\s*\.\s*,\s*(?:\\[,;]\s*)?([\s\S]+)$/iu);
      const observed = removed.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x)
        .map((word) => word.text).join(' ').trim();
      if (abbreviation && /^i\s*\.\s*e\s*\.\s*,/iu.test(observed)) {
        prosePrefix = 'i.e., ';
        latex = abbreviation[1].trim();
      }
    }
    // A detector can enclose two expressions and the English word between
    // them. Only move that word out of TeX when Vision independently reads it
    // in the same source region; otherwise leave the recognizer's math intact.
    const joined = formula.display && !equationLabel && sourceBlocks.some((block) =>
      block.boundingBox && /\band\b/iu.test(block.text) && intersects(formula, pixelBox(block.boundingBox)))
      ? latex.match(/^([\s\S]+?)\s*\\(?:quad|qquad)\s*\\(?:mathrm|text)\s*\{\s*a\s*n\s*d\s*\}\s*\\(?:quad|qquad)\s*([\s\S]+)$/iu)
      : null;
    if (equationLabel && !/\\tag\s*\{/.test(latex)) latex += ` \\tag{${equationLabel.label}}`;
    items.push({ ...formula, display: separatedWhere ? false : formula.display, math: !ordinal, punctuation,
      reviewRecognition: repairedEvaluationBar || correctedIota || formula.reviewAccent || formula.reviewSymbol || formula.reviewEdge || uncorroboratedBar(formula, latex)
        || footnoteInsideFormula(latex) || correctedZero || latinGreekConflict(formula, latex)
        || separatedWhere && !sourceWhere,
      text: prosePrefix + (ordinal ? ordinal[1] + ordinal[2] : annotated ? `${annotated.text}$^{${annotated.superscript}}$`
        : joined ? `$${joined[1].trim()}$ and $${joined[2].trim()}$`
          : formula.display && !separatedWhere ? `$$${latex}$$` : `$${latex}$`) + punctuation });
  }
  for (const word of words(masked)) {
    if (formulas.some((f) => intersects(f, word)) || items.some((item) => intersects(item, word))) continue;
    // Vision can put "x:" in one box, then recover the same colon beyond the
    // formula mask. It has already been retained from that removed source word.
    if (items.some((item) => item.punctuation && /^[,.;:!?•·]+$/.test(word.text)
      && removed.some((lost) => intersects(lost, item) && intersects(lost, word)))) continue;
    // Only fill a genuine removed-word gap; never append unrelated masked OCR.
    if (removed.some((lost) => intersects(lost, word) && word.h < lost.h * 1.4)) items.push(word);
  }
  const rows = [];
  for (const item of items.sort((a, b) => a.y + a.h / 2 - b.y - b.h / 2 || a.x - b.x)) {
    const row = !item.display && rows.findLast((r) => !r.display
      && Math.abs(r.center - item.y - item.h / 2) < Math.min(r.height, item.h) * .6);
    if (row) { row.items.push(item); row.height = Math.max(row.height, item.h); }
    else rows.push({ items: [item], center: item.y + item.h / 2, height: item.h, display: item.display });
  }
  let text = '', previous, layoutReview = false;
  const uncertainFormulaStarts = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.items.length; i++) {
      const a = row.items[i - 1], b = row.items[i];
      if (!a.math && !b.math && b.x - a.x - a.w > size.width * .08) layoutReview = true;
    }
    const fragments = row.items.map((item) => ({ item, text: item.text.trim() })).filter(({ text: value }) => value);
    const line = fragments.map(({ text: value }) => value).join(' ').replace(/\s+([,.;:!?])/g, '$1');
    const paragraph = previous && (row.display || previous.display
      || row.center - previous.center > Math.max(row.height, previous.height) * 2);
    const separator = text ? paragraph ? '\n\n' : '\n' : '';
    let cursor = 0;
    for (const fragment of fragments) {
      const normalized = fragment.text.replace(/\s+([,.;:!?])/g, '$1');
      const at = line.indexOf(normalized, cursor);
      if (at < 0) continue;
      // A source-confirmed footnote can be attached to prose (biased$^{2}$).
      // The marker belongs on the math delimiter, not on the English word.
      if (fragment.item.math && (fragment.item.confidence < FORMULA_REVIEW_CONFIDENCE || fragment.item.reviewRecognition)) for (const range of mathRanges(normalized)) {
        uncertainFormulaStarts.push(text.length + separator.length + at + range.start);
      }
      cursor = at + normalized.length;
    }
    text += separator + line;
    previous = row;
  }
  const mathematical = items.filter((item) => item.math);
  return { text, layoutReview, edgeRecovered: recoveredLeading.length > 0,
    interiorRecovered: verifiedInterior.length, rowRecovered,
    formulaCount: mathematical.reduce((count, item) => count + mathRanges(item.text).length, 0),
    uncertainFormulaCount: mathematical.filter((item) => item.confidence < FORMULA_REVIEW_CONFIDENCE || item.reviewRecognition)
      .reduce((count, item) => count + mathRanges(item.text).length, 0),
    uncertainFormulaStarts };
}

module.exports = { mergeFormulaDocument, proseSuperscript, repairUnpairedEvaluationBars };
