'use strict';

// Keep the original prose as the reading-order anchor. Masking can make Vision
// merge adjacent lines or hallucinate short fragments, so it is only a fallback
// for a prose word that shares a bounding box with a recognized formula.
function mergeFormulaDocument(masked, formulas, size, original) {
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
  const sourceWords = words(original || masked), removed = sourceWords.filter((word) => formulas.some((f) => intersects(f, word)));
  const items = sourceWords.filter((word) => !removed.includes(word));
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
    items.push({ ...formula, math: !ordinal, punctuation,
      text: (ordinal ? ordinal[1] + ordinal[2] : formula.display ? `$$${latex}$$` : `$${latex}$`) + punctuation });
  }
  for (const word of words(masked)) {
    if (formulas.some((f) => intersects(f, word)) || items.some((item) => intersects(item, word))) continue;
    // Vision can put "x:" in one box, then recover the same colon beyond the
    // formula mask. It has already been retained from that removed source word.
    if (items.some((item) => item.punctuation === word.text
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

module.exports = { mergeFormulaDocument };
