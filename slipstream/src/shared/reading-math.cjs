'use strict';

// Shared by the local renderer and paragraph splitter. Delimiters are retained
// in source/storage; only display nodes are replaced with mathematical layout.
(function expose(root) {
  function escaped(text, index) {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count += 1;
    return count % 2 === 1;
  }
  function mathRanges(text) {
    const ranges = [];
    for (let i = 0; i < text.length; i += 1) {
      if (escaped(text, i)) continue;
      if (text[i] === '`') {
        const marker = text.startsWith('```', i) ? '```' : '`';
        const end = text.indexOf(marker, i + marker.length);
        i = end < 0 ? text.length : end + marker.length - 1;
        continue;
      }
      const pair = text.startsWith('$$', i) ? ['$$', '$$', true]
        : text.startsWith('\\[', i) ? ['\\[', '\\]', true]
          : text.startsWith('\\(', i) ? ['\\(', '\\)', false]
            : text[i] === '$' && !/\s/u.test(text[i + 1] || ' ') ? ['$', '$', false] : null;
      if (!pair) continue;
      let end = text.indexOf(pair[1], i + pair[0].length);
      while (end >= 0 && escaped(text, end)) end = text.indexOf(pair[1], end + pair[1].length);
      if (end < 0) continue;
      const tex = text.slice(i + pair[0].length, end);
      const number = /^\d+(?:[.,]\d+)?$/u.test(tex);
      const coefficient = /^\d+(?:[.,]\d+)?[A-Za-z]$/u.test(tex);
      if (!tex.trim() || (pair[0] === '$' && (/\n|\s$/u.test(tex)
        || (/^\d/u.test(tex) && !number && !coefficient && !/[\\_^=+*/<>|{}]/u.test(tex))
        || (number && /\d/u.test(text[end + 1] || ''))))) continue;
      ranges.push({ start: i, end: end + pair[1].length, tex, display: pair[2] });
      i = end + pair[1].length - 1;
    }
    return ranges;
  }
  function firstInvalidMathDelimiter(text) {
    for (let i = 0; i < text.length; i += 1) {
      if (escaped(text, i)) continue;
      if (text[i] === '`') {
        const marker = text.startsWith('```', i) ? '```' : '`';
        const end = text.indexOf(marker, i + marker.length);
        i = end < 0 ? text.length : end + marker.length - 1;
        continue;
      }
      const pair = text.startsWith('$$', i) ? ['$$', '$$']
        : text.startsWith('\\[', i) ? ['\\[', '\\]']
          : text.startsWith('\\(', i) ? ['\\(', '\\)'] : null;
      if (!pair) continue;
      let end = text.indexOf(pair[1], i + pair[0].length);
      while (end >= 0 && escaped(text, end)) end = text.indexOf(pair[1], end + pair[1].length);
      if (end < 0 || !text.slice(i + pair[0].length, end).trim()) return pair[0];
      i = end + pair[1].length - 1;
    }
    return '';
  }
  function needsMathReview(text) {
    return mathRanges(text).length > 0 || /[∑∫∂∇√∞≠≤≥∈∉⊂⊆∪∩₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]/u.test(text)
      || /\b(?:E|P|Var|Cov)\s*[[(]|\b[A-Za-zα-ωΑ-Ω]\s*[_^=]|\\(?:frac|sum|int|sqrt|begin)\b/u.test(text);
  }
  function isMathOnly(text) {
    const ranges = mathRanges(text);
    if (!ranges.length) return false;
    let prose = '';
    let offset = 0;
    for (const range of ranges) { prose += text.slice(offset, range.start); offset = range.end; }
    return /^[\s.,;:，。；：]*$/u.test(prose + text.slice(offset));
  }
  function bareFontCommand(tex) {
    return /(?<![\\A-Za-z])(boldsymbol|mathbf|mathbb|mathcal|mathscr|mathsf|mathtt|mathit|mathrm)\b(?=\s*(?:\{|[A-Za-z\\]))/u.exec(tex)?.[1] || '';
  }
  function firstBareFontCommand(text) {
    for (const range of mathRanges(text)) {
      const command = bareFontCommand(range.tex);
      if (command) return command;
    }
    return '';
  }
  function repairBareFontCommands(tex) {
    return tex.replace(/(?<![\\A-Za-z])(?:boldsymbol|mathbf|mathbb|mathcal|mathscr|mathsf|mathtt|mathit|mathrm)\b(?=\s*(?:\{|[A-Za-z\\]))/gu,
      (command) => `\\${command}`);
  }
  const api = { mathRanges, firstInvalidMathDelimiter, needsMathReview, isMathOnly,
    firstBareFontCommand, repairBareFontCommands };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.readingMath = api;
})(globalThis);
