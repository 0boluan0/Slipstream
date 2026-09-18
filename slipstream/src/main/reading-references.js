'use strict';

const { mathRanges } = require('../shared/reading-math.cjs');

const { referenceKey, isNotation } = require('../shared/reading-notation.cjs');

function referenceOccurrences(source, symbol) {
  const key = referenceKey(symbol);
  if (!key) return [];
  const results = [];
  const add = (start, end) => {
    if (!results.some((hit) => hit.start < end && hit.end > start)) results.push({ start, end });
  };
  // Whole tokens protect against matching x inside x_i or an ordinary word.
  const tokens = /(?:\\(?:mathbf|boldsymbol|mathbb|mathcal|mathrm|hat|bar|tilde|vec)\s*\{[^{}]+\}|\\[A-Za-z]+|[\p{L}\p{N}]+)(?:(?:\s*[_^]\s*(?:\{[^{}]+\}|\\[A-Za-z]+|[A-Za-z0-9]))|[₀₁₂₃₄₅₆₇₈₉ᵢⱼₙₖ]+)*/gu;
  for (const token of source.matchAll(tokens)) {
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

function parseReferenceCandidates(items, source) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.slice(0, 16).flatMap((item) => {
    if (!item || typeof item.symbol !== 'string' || !item.symbol.trim() || item.symbol.length > 120
      || typeof item.meaning !== 'string' || !item.meaning.trim() || item.meaning.length > 1500
      || typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 3000
      || !source.includes(item.evidence) || !referenceOccurrences(item.evidence, item.symbol).length
      || /[\b\f\r\t\v]/u.test(item.symbol + item.meaning + item.evidence)) return [];
    let symbol = item.symbol.trim();
    const range = mathRanges(symbol).find((item) => item.start === 0 && item.end === symbol.length);
    const membership = (range?.tex || symbol).match(/^(.+?)\s*(?:\\in\b|∈)\s*.+$/u);
    // A model may quote the whole domain declaration. Keep its explicitly named
    // variable as the lookup key so x_i can be found again without the domain.
    if (membership && isNotation(membership[1].trim())) symbol = membership[1].trim();
    const key = `${referenceKey(symbol)}\n${item.evidence}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ symbol, meaning: item.meaning.trim(), evidence: item.evidence, source, origin: 'excerpt', scope: '' }];
  });
}

module.exports = { referenceKey, referenceOccurrences, isNotation, parseReferenceCandidates };
