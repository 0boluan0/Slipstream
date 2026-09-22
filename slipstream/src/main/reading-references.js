'use strict';

const { mathRanges } = require('../shared/reading-math.cjs');

const { referenceKey, isNotation } = require('../shared/reading-notation.cjs');

function referenceSymbol(value) {
  const symbol = value.trim();
  const range = mathRanges(symbol).find((item) => item.start === 0 && item.end === symbol.length);
  const declaration = (range?.tex || symbol).match(/^(.+?)\s*(?:\\in\b|∈|=)\s*.+$/u);
  // Use the explicitly named variable, retaining its declaration as evidence.
  // Only excerpt-derived names use this rule; user-authored expressions do not.
  return declaration && isNotation(declaration[1].trim()) ? declaration[1].trim() : symbol;
}

function referenceOccurrences(source, symbol) {
  const key = referenceKey(symbol);
  if (!key) return [];
  const results = [];
  const add = (start, end) => {
    if (!results.some((hit) => hit.start < end && hit.end > start)) results.push({ start, end });
  };
  // OCR may spell an operator as `\operatorname* { s u p }`. Its label is
  // text, while its subscript can still contain actual variables. Retain
  // source offsets and skip only the balanced label, including nested styles.
  const operatorLabels = [];
  for (const label of source.matchAll(/\\operatorname\*?\s*\{/gu)) {
    let depth = 1;
    for (let end = label.index + label[0].length; end < source.length; end += 1) {
      if (source[end] === '\\') { end += 1; continue; }
      if (source[end] === '{') depth += 1;
      if (source[end] === '}' && --depth === 0) {
        operatorLabels.push({ start: label.index, end: end + 1 });
        break;
      }
    }
  }
  // Whole tokens protect against matching x inside x_i or an ordinary word.
  const tokens = /(?:\\(?:mathbf|boldsymbol|mathbb|mathcal|mathrm|hat|bar|tilde|vec)\s*(?:\{[^{}]+\}|[A-Za-z])|\\bf\s+[A-Za-z]|\\[A-Za-z]+|[\p{L}\p{N}]+)(?:(?:\s*[_^]\s*(?:\{[^{}]+\}|\\[A-Za-z]+|[A-Za-z0-9]))|[₀₁₂₃₄₅₆₇₈₉ᵢⱼₙₖ]+)*/gu;
  for (const token of source.matchAll(tokens)) {
    if (operatorLabels.some((label) => token.index >= label.start && token.index < label.end)) continue;
    if (referenceKey(token[0]) === key) add(token.index, token.index + token[0].length);
  }
  for (const range of mathRanges(source)) {
    if (referenceKey(range.tex) === key) add(range.start, range.end);
  }
  if (!isNotation(symbol) && !/[\\$^_{}]/u.test(symbol)) {
    let start = source.indexOf(symbol);
    while (start >= 0) {
      const end = start + symbol.length;
      if (!/[\p{L}\p{N}_]/u.test(source[start - 1] || '') && !/[\p{L}\p{N}_]/u.test(source[end] || '')) add(start, end);
      start = source.indexOf(symbol, start + 1);
    }
  }
  return results.sort((a, b) => a.start - b.start || b.end - a.end);
}

function sourceEvidence(source, quoted) {
  const evidence = quoted.trim();
  if (source.includes(evidence)) return evidence;
  // A model may collapse PDF line breaks while quoting a real definition.
  // Accept only whitespace changes and retain the source's exact spelling.
  const pattern = evidence.split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
  return source.match(new RegExp(pattern, 'u'))?.[0] || null;
}

function parseReferenceCandidates(items, source) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.slice(0, 16).flatMap((item) => {
    if (!item || typeof item.symbol !== 'string' || !item.symbol.trim() || item.symbol.length > 120
      || typeof item.meaning !== 'string' || !item.meaning.trim() || item.meaning.length > 1500
      || typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 3000
      || /[\b\f\r\t\v]/u.test(item.symbol + item.meaning + item.evidence)) return [];
    const evidence = sourceEvidence(source, item.evidence);
    if (!evidence || !referenceOccurrences(evidence, item.symbol).length) return [];
    const symbol = referenceSymbol(item.symbol);
    const key = `${referenceKey(symbol)}\n${evidence}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ symbol, meaning: item.meaning.trim(), evidence, source, origin: 'excerpt', scope: '' }];
  });
}

module.exports = { referenceKey, referenceOccurrences, referenceSymbol, isNotation, parseReferenceCandidates };
