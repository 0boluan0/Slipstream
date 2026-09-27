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
  const canUsePadded = sameRows && source.length >= 4 && changed <= 2
    && source.length - changed >= Math.ceil(source.length * .6)
    && source.every((block, index) => aligned(block, alternative[index]))
    && alternative.every((block) => Number.isFinite(block.confidence) && block.confidence >= .9)
    && normalizedText(padded.text).length >= normalizedText(original.text).length + 8
    && sameNumbers(original.text, padded.text);
  const chosen = canUsePadded ? padded : original;
  return { ...chosen, proseComparison: { disagree: true, recovered: canUsePadded } };
}

module.exports = { reconcileProseOcr };
