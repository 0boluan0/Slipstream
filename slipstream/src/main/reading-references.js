'use strict';

const { mathRanges } = require('../shared/reading-math.cjs');

const { referenceKey, isNotation } = require('../shared/reading-notation.cjs');

function referenceCandidateKey(entry) {
  const identity = [referenceKey(entry.symbol), entry.origin];
  if (entry.origin === 'excerpt') return JSON.stringify([...identity, entry.evidence]);
  return JSON.stringify([...identity, entry.evidence, entry.source, entry.scope, entry.meaning]);
}

function evidenceDefinesSymbol(entry) {
  if (entry.origin !== 'excerpt') return false;
  let occurrences = referenceOccurrences(entry.evidence, entry.symbol);
  const functionHead = referenceKey(entry.symbol).match(/^([A-Za-z]{1,4})\s*\(/u)?.[1];
  if (!occurrences.length && functionHead) occurrences = referenceOccurrences(entry.evidence, functionHead);
  return occurrences.some(({ start, end }) => {
    const before = entry.evidence.slice(0, start).replace(/[\s$]+$/u, '');
    const after = entry.evidence.slice(end).replace(/^[\s$]+/u, '');
    if (/^(?::=|=|\\coloneqq\b)/u.test(after)) return true;
    if (!/^(?:be|is|are|denotes?|means?|represents?|refers?\s+to|stands?\s+for|as)\b/iu.test(after)) return false;
    return /\b(?:let|where|define|denote|call|write|refer\s+to)$/iu.test(before)
      || /(?:^|[.!?;]\s*)$/u.test(before);
  });
}

function preferExplicitReferenceCandidates(candidates) {
  const explicit = new Set(candidates.filter(evidenceDefinesSymbol).map((entry) => referenceKey(entry.symbol)));
  const selected = [];
  for (const entry of candidates) {
    if (explicit.has(referenceKey(entry.symbol)) && !evidenceDefinesSymbol(entry)) continue;
    const source = entry.source?.replace(/\s+/gu, ' ').trim();
    const duplicate = selected.some((earlier) => {
      if (referenceKey(earlier.symbol) !== referenceKey(entry.symbol)) return false;
      const priorSource = earlier.source?.replace(/\s+/gu, ' ').trim();
      const samePassage = earlier.evidence === entry.evidence
        || (source && priorSource && (source.includes(priorSource) || priorSource.includes(source)));
      return samePassage && !(evidenceDefinesSymbol(earlier) && evidenceDefinesSymbol(entry)
        && earlier.evidence !== entry.evidence);
    });
    if (!duplicate) selected.push(entry);
  }
  return selected;
}

function referenceCandidateCovered(candidate, saved) {
  if (referenceCandidateKey(candidate) === referenceCandidateKey(saved)) return true;
  if (candidate.origin === 'excerpt' && referenceKey(candidate.symbol) === referenceKey(saved.symbol)
    && !evidenceDefinesSymbol(candidate)) {
    // Merely using a saved symbol in another paragraph is not a new
    // definition. Keep proposals that explicitly rebind it for this section.
    return true;
  }
  if (candidate.origin !== 'excerpt'
    || candidate.evidence.replace(/\s+/gu, ' ') !== saved.evidence.replace(/\s+/gu, ' ')) return false;
  // Editing a proposed definition changes its origin to manual. The same
  // source-backed suggestion must disappear after the reader saves that edit.
  if (saved.origin === 'manual' && referenceKey(candidate.symbol) === referenceKey(saved.symbol)) return true;
  if (saved.origin !== 'excerpt') return false;
  const head = referenceKey(candidate.symbol);
  if (!/^[A-Za-z]{1,4}$/u.test(head)) return false;
  return new RegExp(`^${head}\\s*\\(`, 'u').test(saved.symbol.trim());
}

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
  // Formula OCR may separate the letters of a named mathematical function:
  // Breiman's mg(X,Y) becomes `m g (X,Y)`, and PE^{\ast} becomes
  // `P E ^ { \ast }`. Match only the exact atom inside a math span; a bare
  // letter-spaced name must be followed by a function argument.
  const atom = key.match(/^([A-Za-z]{2,4})(?:([_^])(?:\{(\\[A-Za-z]+|[A-Za-z0-9]+)\}|(\\[A-Za-z]+|[A-Za-z0-9]+)))?$/u);
  if (atom) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const letters = [...atom[1]].map(escape).join('\\s+');
    const tail = atom[2] ? `\\s*${escape(atom[2])}\\s*(?:\\{\\s*${escape(atom[3] || atom[4])}\\s*\\}|${escape(atom[3] || atom[4])})`
      : '(?=\\s*\\()';
    const spaced = new RegExp(`(?<![\\p{L}\\\\])${letters}${tail}(?![\\p{L}])`, 'gu');
    for (const range of mathRanges(source)) {
      const contentStart = source.indexOf(range.tex, range.start);
      if (contentStart < 0 || contentStart >= range.end) continue;
      for (const match of range.tex.matchAll(spaced)) {
        const start = contentStart + match.index;
        if (!operatorLabels.some((label) => start >= label.start && start < label.end)) add(start, start + match[0].length);
      }
    }
  }
  if (!isNotation(symbol) && !/[\\$^_{}]/u.test(symbol)) {
    let start = source.indexOf(symbol);
    while (start >= 0) {
      const end = start + symbol.length;
      // A plain function name such as sim must not match the distinct TeX
      // relation \sim. The token pass above already compares command names
      // with their backslash intact.
      if (source[start - 1] !== '\\' && !/[\p{L}\p{N}_]/u.test(source[start - 1] || '')
        && !/[\p{L}\p{N}_]/u.test(source[end] || '')) add(start, end);
      start = source.indexOf(symbol, start + 1);
    }
  }
  return results.sort((a, b) => a.start - b.start || b.end - a.end);
}

function sourceEvidence(source, quoted) {
  const evidence = quoted.trim();
  const variants = [evidence];
  // Models sometimes move a sentence-ending period across the closing math
  // delimiter while copying PDF OCR. The equation itself must stay identical.
  const periodMoved = evidence.replace(/(\.)(\$\$|\$)$/u, '$2$1');
  if (periodMoved !== evidence) variants.push(periodMoved);
  // A model may collapse PDF line breaks while quoting a real definition.
  // Accept only whitespace changes and retain the source's exact spelling.
  for (const variant of variants) {
    if (source.includes(variant)) return variant;
    const pattern = variant.split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
    const match = source.match(new RegExp(pattern, 'u'))?.[0];
    if (match) return match;
  }
  return null;
}

function exampleValueCandidate(symbol, meaning, evidence) {
  // Model output can turn parameters of one worked example into definitions
  // reused for the entire paper. Numeric assignments in an explicitly local
  // case are better left for the reader to save with a manual scope.
  return isNotation(symbol)
    && /(?:取值|数值|设(?:定)?|等于|固定|为|是|[=＝])\s*(?:为|是|等于|[=＝])?\s*[-−+]?\d+(?:\.\d+)?/u.test(meaning)
    && /\b(?:example|for instance|suppose|consider|in this case|special case|standard normal distribution|with mean|with standard deviation|with variance|if|when)\b/iu.test(evidence);
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
    if (exampleValueCandidate(symbol, item.meaning, evidence)) return [];
    const key = `${referenceKey(symbol)}\n${evidence}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ symbol, meaning: item.meaning.trim(), evidence, source, origin: 'excerpt', scope: '' }];
  });
}

module.exports = { referenceKey, referenceCandidateKey, referenceCandidateCovered, evidenceDefinesSymbol,
  preferExplicitReferenceCandidates,
  referenceOccurrences, referenceSymbol, isNotation, parseReferenceCandidates };
