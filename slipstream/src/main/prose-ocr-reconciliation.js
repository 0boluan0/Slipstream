'use strict';

function normalizedText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function sameNumbers(left, right) {
  const numbers = (value) => normalizedText(value).match(/\d+(?:[.,]\d+)*/gu) || [];
  return JSON.stringify(numbers(left)) === JSON.stringify(numbers(right));
}

function aligned(left, right) {
  const a = left?.boundingBox, b = right?.boundingBox;
  if (!a || !b || ![a.x, a.y, a.h, b.x, b.y, b.h].every(Number.isFinite)
    || a.h <= 0 || b.h <= 0) return false;
  return Math.abs(a.x - b.x) <= .04
    && Math.abs(a.y + a.h / 2 - b.y - b.h / 2) <= Math.min(a.h, b.h) * .75;
}

function expandedLowConfidenceRow(source, alternative) {
  const extra = alternative.length - source.length;
  if (source.length < 5 || extra < 1 || extra > 2) return false;
  const uncertain = source.map((block, index) => block.confidence < .8 ? index : -1)
    .filter((index) => index >= 0);
  if (uncertain.length !== 1) return false;
  const row = uncertain[0], merged = source[row], box = merged.boundingBox;
  if (!box || ![box.x, box.y, box.h].every(Number.isFinite) || box.h <= 0) return false;
  const replacements = alternative.slice(row, row + extra + 1);
  const originalWords = normalizedText(merged.text).toLowerCase().match(/\p{L}+/gu) || [];
  const replacementWords = normalizedText(replacements[0]?.text).toLowerCase().match(/\p{L}+/gu) || [];
  if (originalWords.length < 2 || originalWords[0] !== replacementWords[0]
    || originalWords[1] !== replacementWords[1]) return false;
  if (box.h < Math.max(...replacements.map((block) => block.boundingBox?.h || Infinity)) * 1.5) return false;
  if (!replacements.every((block) => {
    const candidate = block.boundingBox;
    const center = candidate?.y + candidate?.h / 2;
    return Number.isFinite(center) && Math.abs(candidate.x - box.x) <= .04
      && center >= box.y - .015 && center <= box.y + box.h + .015;
  })) return false;
  return source.every((block, index) => {
    if (index === row) return true;
    const candidate = alternative[index + (index > row ? extra : 0)];
    return normalizedText(block.text) === normalizedText(candidate?.text)
      && aligned(block, candidate);
  });
}

// A short italic variable can change between full-image and padded Vision
// layouts even when both assign the entire sentence confidence 1. Only a
// repeated, isolated capital glyph with otherwise identical words is eligible
// for a local pixel recheck; this function does not choose either reading.
function isolatedGlyphDisagreements(original, padded) {
  const source = original?.blocks, alternative = padded?.blocks;
  if (!Array.isArray(source) || !Array.isArray(alternative)
    || source.length !== alternative.length) return [];
  return source.flatMap((block, index) => {
    const candidate = alternative[index];
    if (block.confidence < .9 || candidate.confidence < .9 || !aligned(block, candidate)
      || !sameNumbers(block.text, candidate.text)) return [];
    const words = normalizedText(block.text).split(' ');
    const replacements = normalizedText(candidate.text).split(' ');
    if (words.length < 8 || words.length !== replacements.length) return [];
    const differences = words.map((word, at) => word === replacements[at] ? -1 : at)
      .filter((at) => at >= 0);
    if (differences.length !== 2) return [];
    const sourceGlyphs = [], targetGlyphs = [];
    for (const at of differences) {
      const from = /^([A-Z])(['’]?)([,.;:!?]?)$/u.exec(words[at]);
      const to = /^([A-Z])([,.;:!?]?)$/u.exec(replacements[at]);
      if (!from || !to || from[1] === to[1] || from[3] !== to[2]) return [];
      sourceGlyphs.push(from[1]); targetGlyphs.push(to[1]);
    }
    if (new Set(sourceGlyphs).size !== 1 || new Set(targetGlyphs).size !== 1) return [];
    return [{ index, source: differences.map((at) => words[at]).join('、'),
      alternative: targetGlyphs[0], text: candidate.text }];
  });
}

function reconcileProseOcr(original, padded) {
  const source = original?.blocks, alternative = padded?.blocks;
  if (!Array.isArray(source) || !Array.isArray(alternative) || !alternative.length) {
    return { ...original, proseComparison: { disagree: false, recovered: false } };
  }
  if (normalizedText(original.text) === normalizedText(padded.text)) {
    return { ...original, proseComparison: { disagree: false, recovered: false } };
  }

  const sameRows = source.length === alternative.length;
  const changed = sameRows
    ? source.filter((block, index) => normalizedText(block.text) !== normalizedText(alternative[index].text)).length
    : Infinity;
  const canUsePadded = ((sameRows && source.length >= 4 && changed <= 2
    && source.length - changed >= Math.ceil(source.length * .6)
    && source.every((block, index) => aligned(block, alternative[index])))
    || expandedLowConfidenceRow(source, alternative))
    && alternative.every((block) => Number.isFinite(block.confidence) && block.confidence >= .9)
    && normalizedText(padded.text).length >= normalizedText(original.text).length + 8
    && sameNumbers(original.text, padded.text);
  const chosen = canUsePadded ? padded : original;
  return { ...chosen, proseComparison: { disagree: true, recovered: canUsePadded } };
}

module.exports = { reconcileProseOcr, isolatedGlyphDisagreements };
