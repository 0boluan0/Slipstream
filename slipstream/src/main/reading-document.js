'use strict';

const { mathRanges } = require('../shared/reading-math.cjs');

// Vision emits visual lines. Join wrapped prose while retaining paragraph gaps;
// keep the untouched capture available for checking notation and reading order.
function readingTextFromOcr(ocr) {
  if (ocr.document) return ocr.document;
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

function isIsolatedNumericRow(text) {
  // Figure axes can look like a paragraph after OCR, including duplicated
  // labels. Keep the source and screenshot available without presenting the
  // unverified numbers as translated prose.
  return /^(?:[-−+]?\d+(?:\.\d+)?\s+){5,}[-−+]?\d+(?:\.\d+)?$/u.test(text.trim());
}

function deduplicateReadingTerms(segments) {
  const termKey = (quote, label) => JSON.stringify([quote.trim().toLowerCase(), label.trim()]);
  const terms = segments.flatMap((segment) => segment.terms || []);
  const sense = (label, acronym) => {
    const trimmed = label.trim();
    const suffix = trimmed.match(/^(.*?)\s*[（(]\s*([A-Z][A-Z0-9-]{1,15})\s*[)）]$/u);
    return suffix?.[2] === acronym && suffix[1].trim() ? suffix[1].trim() : trimmed;
  };
  const expansions = new Map();
  // Use only an expansion actually quoted from this card. Keep different
  // Chinese senses and ambiguous acronyms distinct; do not infer synonyms.
  for (const segment of segments) for (const term of segment.terms || []) {
    const expansion = term.quote.trim().match(/^(.+?)\s*\(([A-Z][A-Z0-9-]{1,15})\)$/u);
    if (!expansion || !segment.source.includes(term.quote)) continue;
    const full = expansion[1].trim();
    if (!/[A-Za-z].*\s.*[A-Za-z]/u.test(full)) continue;
    const acronym = expansion[2], label = sense(term.label, acronym);
    const target = termKey(full, label);
    const spellings = new Set([term.quote, full, acronym].map((spelling) => spelling.trim().toLowerCase()));
    for (const candidate of terms) {
      if (!spellings.has(candidate.quote.trim().toLowerCase()) || sense(candidate.label, acronym) !== label) continue;
      const key = termKey(candidate.quote, candidate.label);
      if (!expansions.has(key)) expansions.set(key, new Set());
      expansions.get(key).add(target);
    }
  }
  const seen = new Set();
  return segments.map((segment) => !segment.terms ? segment : { ...segment,
    terms: segment.terms.filter((term) => {
      const rawKey = termKey(term.quote, term.label), aliases = expansions.get(rawKey);
      const key = aliases?.size === 1 ? [...aliases][0] : rawKey;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }) });
}

module.exports = { readingTextFromOcr, readingSegments, isIsolatedNumericRow, deduplicateReadingTerms };
