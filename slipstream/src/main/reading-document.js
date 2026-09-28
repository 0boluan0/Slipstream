'use strict';

const fs = require('node:fs');
const { mathRanges } = require('../shared/reading-math.cjs');

let englishWords;
function knownEnglishWord(word, exact = false) {
  if (!englishWords) {
    // This is a local, optional macOS word list. With no dictionary, leave
    // uncertain OCR spelling untouched for the reader to compare with pixels.
    try { englishWords = new Set(fs.readFileSync('/usr/share/dict/words', 'utf8').toLowerCase().split(/\s+/u)); }
    catch { englishWords = new Set(); }
  }
  if (englishWords.has(word)) return true;
  if (exact) return false;
  if (word.endsWith('ies')) return englishWords.has(`${word.slice(0, -3)}y`);
  if (word.endsWith('ing')) return englishWords.has(word.slice(0, -3)) || englishWords.has(`${word.slice(0, -3)}e`);
  if (word.endsWith('ed')) return englishWords.has(word.slice(0, -2)) || englishWords.has(word.slice(0, -1));
  if (word.endsWith('es')) return englishWords.has(word.slice(0, -2)) || englishWords.has(word.slice(0, -1));
  return word.endsWith('s') && englishWords.has(word.slice(0, -1));
}

function shouldJoinSplitWord(first, second, isWord, spellJoinCandidates) {
  const joined = (first + second).toLowerCase();
  const productivePrefix = /^(?:pre|post|non|anti|self)$/iu.test(first);
  // Keep ordinary compounds such as pre-trained. A short, unrecognized
  // continuation of a known whole word is different: pre- / dict is predict.
  if (productivePrefix && !(second.length <= 4
    && !isWord(second.toLowerCase(), true) && isWord(joined, true))) return false;
  return spellJoinCandidates.has(joined)
      || (!(first.length >= 4 && second.length >= 4
        && isWord(first.toLowerCase(), true) && isWord(second.toLowerCase(), true))
        && isWord(joined));
}

function joinProseLine(previous, next, isWord, spellJoinCandidates) {
  const end = /([A-Za-z]{2,})-$/u.exec(previous);
  const start = /^([a-z]{2,})(?![A-Za-z])/u.exec(next);
  if (end && start) {
    if (shouldJoinSplitWord(end[1], start[1], isWord, spellJoinCandidates)) {
      return previous.slice(0, -1) + next;
    }
    return previous + next;
  }
  return `${previous} ${next}`;
}

// Formula-rich captures retain visual row breaks so their TeX stays aligned.
// Repair only corroborated prose splits, and report removed characters so
// formula review markers keep pointing at the same expression.
function joinVisualHyphenation(text, candidates = [], isWord = knownEnglishWord) {
  const spellJoinCandidates = new Set((Array.isArray(candidates) ? candidates : [])
    .filter((word) => typeof word === 'string').map((word) => word.toLowerCase()));
  const math = mathRanges(text);
  const removedAt = [];
  const reviewedJoins = [];
  const joined = text.replace(/\b([A-Za-z]{2,})-\n([a-z]{2,})(?![A-Za-z])/gu, (match, first, second, at) => {
    if (math.some((range) => at < range.end && at + match.length > range.start)) return match;
    const knownJoin = shouldJoinSplitWord(first, second, isWord, spellJoinCandidates);
    const following = text.slice(at + match.length);
    // Academic surnames may be absent from both local dictionaries. A capitalized
    // unknown stem followed by possessive -s and a named result is a likely
    // printed line wrap; expose the inference for source review.
    const possessive = /^(['’]s)\s+(?:inequality|theorem|lemma|bound|law|identity|method|test|algorithm|estimator|distribution)\b/iu.exec(following);
    const eponymJoin = !knownJoin && /^[A-Z][a-z]{3,}$/u.test(first)
      && !isWord(first.toLowerCase(), true) && Boolean(possessive);
    if (!knownJoin && !eponymJoin) return match;
    if (eponymJoin) reviewedJoins.push({
      source: first + '-' + second + possessive[1],
      alternative: first + second + possessive[1],
    });
    removedAt.push(at + first.length);
    return first + second;
  });
  return { text: joined, removedAt, reviewedJoins };
}

function isCodeAnchor(text) {
  return /^\s*(?:for\s+.+\s+in\s+.+:\s*|(?:def|class)\s+\w+.*:\s*|>>>\s*.+)$/u.test(text);
}

function isCodeAssignment(text) {
  return /^\s*[A-Za-z_]\w*(?:\[[^\]]+\])?\s*=\s*\S.*$/u.test(text)
    || /^\s*\d+\s*=\s*\{\s*\}\s*$/u.test(text);
}

// Vision emits visual lines. Join wrapped prose while retaining paragraph gaps;
// keep the untouched capture available for checking notation and reading order.
function readingTextFromOcr(ocr, isWord = knownEnglishWord) {
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
  const spellJoinCandidates = new Set(Array.isArray(ocr.spellJoinCandidates)
    ? ocr.spellJoinCandidates.filter((word) => typeof word === 'string') : []);
  const prompt = (value) => /^>>>\s*\S/u.test(value.trim());
  const output = (value) => /^(?:[-+]?\d+(?:\.\d+)?|[A-Za-z_]\w*\s*\(.*\)|\{.*\}|\[.*\]|True|False|None)$/u.test(value.trim());
  const codeRows = new Set();
  const codeLayout = new Map();
  for (let index = 0; index < lines.length; index++) {
    if (prompt(lines[index].text)) codeRows.add(index);
    else if (index && prompt(lines[index - 1].text) && output(lines[index].text)) codeRows.add(index);
  }
  // Without a detected formula there is no math/prose merge to preserve
  // Python rows. A loop header anchors nearby assignments in Vision's
  // independent line boxes, including a partly read one-character RHS.
  for (let index = 0; index < lines.length; index++) {
    if (!isCodeAnchor(lines[index].text)) continue;
    codeRows.add(index);
    const anchor = lines[index].boundingBox;
    const layout = { origin: anchor.x, characterWidth: anchor.w / Math.max(1, lines[index].text.length) };
    codeLayout.set(index, layout);
    for (const direction of [-1, 1]) {
      let previous = lines[index];
      for (let at = index + direction; at >= 0 && at < lines.length; at += direction) {
        const row = lines[at], box = row.boundingBox, before = previous.boundingBox;
        const gap = Math.abs(box.y + box.h / 2 - before.y - before.h / 2);
        const aligned = box.x >= anchor.x - before.h && box.x <= anchor.x + before.h * 2.5;
        if (!isCodeAssignment(row.text) || gap > Math.max(box.h, before.h) * 1.6 || !aligned) break;
        codeRows.add(at);
        codeLayout.set(at, layout);
        previous = row;
      }
    }
  }
  let paragraph = '';
  let previous, previousCode = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], code = codeRows.has(index);
    const layout = codeLayout.get(index);
    const indentation = layout ? Math.max(0, Math.min(8,
      Math.round((line.boundingBox.x - layout.origin) / Math.max(layout.characterWidth, .001)))) : 0;
    const text = ' '.repeat(indentation) + line.text.trim();
    if (!text) continue;
    const a = previous?.boundingBox;
    const b = line.boundingBox;
    const newParagraph = a && (code !== previousCode
      || a.y - (b.y + b.h) > Math.max(a.h, b.h) * .8
      || Math.abs(a.h - b.h) > Math.min(a.h, b.h) * .8
      || b.y > a.y + a.h);
    if (newParagraph && paragraph) { paragraphs.push(paragraph); paragraph = ''; }
    paragraph = paragraph ? code ? `${paragraph}\n${text}`
      : joinProseLine(paragraph, text, isWord, spellJoinCandidates) : text;
    previous = line;
    previousCode = code;
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
  return pieces.map((source, index) => ({ id: index, source, code: isCodeOnly(source),
    translation: '', status: 'pending' }));
}

function isIsolatedNumericRow(text) {
  // Figure axes can look like a paragraph after OCR, including duplicated
  // labels. Keep the source and screenshot available without presenting the
  // unverified numbers as translated prose.
  return /^(?:[-−+]?\d+(?:\.\d+)?\s+){5,}[-−+]?\d+(?:\.\d+)?$/u.test(text.trim());
}

function isCodeOnly(text) {
  const lines = text.trim().split(/\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length && lines[0].startsWith('>>>')
    && lines.every((line, index) => /^>>>\s*\S/u.test(line)
      || index === lines.length - 1 && /^(?:[-+]?\d+(?:\.\d+)?|[A-Za-z_]\w*\s*\(.*\)|\{.*\}|\[.*\]|True|False|None)$/u.test(line))) return true;
  // Paper pseudocode often has assignments and comments but no for/def line.
  // Keep a mostly-code selection intact rather than asking the language model
  // to translate identifiers and silently alter an already uncertain OCR read.
  const assignments = lines.filter((line) => /^[A-Za-z_]\w*\s*=\s*\S/u.test(line));
  const calls = assignments.filter((line) => /\b[A-Za-z_]\w*\s*\(/u.test(line));
  const comments = lines.filter((line) => /^#\s*\S/u.test(line));
  if (assignments.length >= 3 && calls.length >= 2
    && (comments.length >= 1 || assignments.length >= 5)
    && (assignments.length + comments.length) / lines.length >= .7) return true;
  return lines.length >= 2 && lines.some((line) => /^for\s+.+\s+in\s+.+:\s*$/u.test(line))
    && lines.every((line) => isCodeAnchor(line) || isCodeAssignment(line));
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

module.exports = { readingTextFromOcr, joinVisualHyphenation, readingSegments, isIsolatedNumericRow,
  isCodeOnly, isCodeAnchor, isCodeAssignment, deduplicateReadingTerms };
