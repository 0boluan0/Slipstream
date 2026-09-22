'use strict';

function proseSuperscript(latex) {
  // A weak inline region can include a prose word and its footnote marker.
  // Keep commands, operators, short products and subscripts as mathematics.
  const compact = latex.replace(/\s+/g, '').replace(/\\(?:qquad|quad|[,;])/g, ' ');
  const match = compact.match(/^((?:[A-Za-z]+ )*[A-Za-z][a-z]{3,})\^\{(\d{1,3})\}([,.;:!?]?)$/);
  return match ? { text: match[1], superscript: match[2] } : null;
}

// Keep the original prose as the reading-order anchor. Masking can make Vision
// merge adjacent lines or hallucinate short fragments, so it is only a fallback
// for a prose word that shares a bounding box with a recognized formula.
function mergeFormulaDocument(masked, formulas, size, original, edgeProse) {
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
        else { word = { ...box, text: char.text }; result.push(word); }
      }
      if (!line.characters?.length && line.boundingBox) result.push({ ...pixelBox(line.boundingBox), text: line.text });
    }
    return result;
  }
  const intersects = (a, b) => {
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return area > Math.min(a.w * a.h, b.w * b.h) * .3
      && Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < Math.max(a.h, b.h) * .6;
  };
  const originalWords = words(original || masked);
  const proseAnnotations = new Map();
  formulas = formulas.filter((formula) => {
    const annotated = !formula.display && formula.score < .3 ? proseSuperscript(formula.latex) : null;
    if (!annotated) return true;
    // The math model may recover a superscript, but cannot rewrite prose.
    // Require the original text recognizer to agree on every word in its box.
    const source = originalWords.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x)
      .map((word) => word.text).join(' ').replace(/[,.;:!?]$/, '');
    if (source !== annotated.text) return false;
    proseAnnotations.set(formula, annotated);
    return true;
  });
  const edgeWords = words(edgeProse);
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
  for (const formula of formulas) {
    let latex = formula.latex.trim(), punctuation = '';
    if (/[,.;:!?]$/.test(latex)) { punctuation = latex.at(-1); latex = latex.slice(0, -1).trim(); }
    else {
      const last = removed.filter((word) => intersects(formula, word)).sort((a, b) => a.x - b.x).at(-1);
      if (last && /[,.;:!?]$/.test(last.text)) punctuation = last.text.at(-1);
    }
    // Superscripted prose ordinals belong to the sentence, so translation can
    // turn "1st moment" into Chinese instead of protecting it as mathematics.
    const ordinal = latex.replace(/\s+/g, '').match(/^(\d+)\^\{\\(?:mathrm|text)\{(st|nd|rd|th)\}\}$/);
    const annotated = proseAnnotations.get(formula);
    const equationLabel = equationLabels.get(formula);
    if (equationLabel && !/\\tag\s*\{/.test(latex)) latex += ` \\tag{${equationLabel.label}}`;
    items.push({ ...formula, math: !ordinal, punctuation,
      text: (ordinal ? ordinal[1] + ordinal[2] : annotated ? `${annotated.text}$^{${annotated.superscript}}$`
        : formula.display ? `$$${latex}$$` : `$${latex}$`) + punctuation });
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
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.items.length; i++) {
      const a = row.items[i - 1], b = row.items[i];
      if (!a.math && !b.math && b.x - a.x - a.w > size.width * .08) layoutReview = true;
    }
    const line = row.items.map((item) => item.text.trim()).filter(Boolean).join(' ').replace(/\s+([,.;:!?])/g, '$1');
    const paragraph = previous && (row.display || previous.display
      || row.center - previous.center > Math.max(row.height, previous.height) * 2);
    text += (text ? paragraph ? '\n\n' : '\n' : '') + line;
    previous = row;
  }
  const mathematical = items.filter((item) => item.math);
  return { text, layoutReview, formulaCount: mathematical.length,
    uncertainFormulaCount: mathematical.filter((item) => item.confidence < .6).length };
}

module.exports = { mergeFormulaDocument, proseSuperscript };
