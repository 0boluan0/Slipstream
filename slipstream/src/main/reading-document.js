'use strict';

const { mathRanges } = require('../shared/reading-math.cjs');

// Vision emits visual lines. Join wrapped prose while retaining paragraph gaps;
// keep the untouched capture available for checking notation and reading order.
function readingTextFromOcr(ocr) {
  const lines = ocr.blocks;
  if (!Array.isArray(lines) || !lines.length || lines.some((line) =>
    typeof line.text !== 'string' || !line.boundingBox
    || !['x', 'y', 'w', 'h'].every((key) => Number.isFinite(line.boundingBox[key])))) {
    return { text: ocr.text, layoutReview: false };
  }
  const layoutReview = lines.some((line, index) => lines.slice(index + 1).some((next) => {
    const a = line.boundingBox;
    const b = next.boundingBox;
    return Math.abs(a.y - b.y) < Math.min(a.h, b.h) * .45
      && (a.x + a.w + .06 < b.x || b.x + b.w + .06 < a.x);
  }));
  // Multiple columns and tables need a human reading-order check.
  if (layoutReview) return { text: ocr.text, layoutReview };
  const paragraphs = [];
  let paragraph = '';
  let previous;
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const a = previous?.boundingBox;
    const b = line.boundingBox;
    const newParagraph = a && (a.y - (b.y + b.h) > Math.max(a.h, b.h) * 1.1
      || Math.abs(a.h - b.h) > Math.min(a.h, b.h) * .8
      || b.y > a.y + a.h);
    if (newParagraph && paragraph) { paragraphs.push(paragraph); paragraph = ''; }
    paragraph += (paragraph ? ' ' : '') + text;
    previous = line;
  }
  if (paragraph) paragraphs.push(paragraph);
  return { text: paragraphs.join('\n\n'), layoutReview: false };
}

function readingSegments(text) {
  const pieces = [];
  const ranges = mathRanges(text);
  const insideMath = (position) => ranges.some((range) => range.start < position && range.end > position);
  const breaks = [...text.matchAll(/\n\s*\n/gu)].filter((match) => !insideMath(match.index));
  const paragraphs = [];
  let start = 0;
  for (const match of breaks) {
    paragraphs.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  paragraphs.push(text.slice(start));
  for (const paragraph of paragraphs.map((part) => part.trim()).filter(Boolean)) {
    let remaining = paragraph;
    while (remaining.length > 1800) {
      const prefix = remaining.slice(0, 1800);
      const sentence = [...prefix.matchAll(/[.!?。！？][\s]+/gu)].at(-1);
      const boundary = sentence && sentence.index > 600 ? sentence.index + 1 : prefix.lastIndexOf(' ');
      let cut = boundary > 600 ? boundary : 1800;
      const formula = mathRanges(remaining).find((range) => range.start < cut && range.end > cut);
      if (formula) cut = formula.start > 0 ? formula.start : formula.end;
      pieces.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining) pieces.push(remaining);
  }
  return pieces.map((source, index) => ({ id: index, source, translation: '', status: 'pending' }));
}

module.exports = { readingTextFromOcr, readingSegments };
