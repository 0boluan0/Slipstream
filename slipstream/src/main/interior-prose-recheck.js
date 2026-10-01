'use strict';

function rect(block) {
  const box = block?.boundingBox;
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)
    || box.w <= 0 || box.h <= 0) return null;
  return { left: box.x, right: box.x + box.w,
    top: 1 - box.y - box.h, bottom: 1 - box.y,
    center: 1 - box.y - box.h / 2, height: box.h };
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    / Math.min(a.right - a.left, b.right - b.left);
}

function proseTokens(value) {
  return (String(value || '').toLowerCase().match(/\p{L}{3,}/gu) || []);
}

function orderedAgreement(a, b) {
  const left = proseTokens(a), right = proseTokens(b);
  if (left.length < 4 || right.length < 4) return 0;
  const lengths = Array.from({ length: right.length + 1 }, () => 0);
  for (const term of left) {
    let previous = 0;
    for (let i = 1; i <= right.length; i++) {
      const current = lengths[i];
      lengths[i] = term === right[i - 1] ? previous + 1 : Math.max(lengths[i], lengths[i - 1]);
      previous = current;
    }
  }
  return lengths[right.length] / Math.max(left.length, right.length);
}

function missingInteriorRows(original, padded) {
  const source = (original?.blocks || []).map((block) => ({ block, box: rect(block) }))
    .filter(({ box }) => box);
  if (source.length < 2) return [];
  return (padded?.blocks || []).filter((candidate) => {
    const box = rect(candidate);
    if (!box || candidate.confidence < .9 || candidate.text.length < 25
      || proseTokens(candidate.text).length < 4 || box.height > .25) return false;
    const sameColumn = source.filter(({ box: anchor }) => horizontalOverlap(box, anchor) >= .4);
    if (sameColumn.some(({ box: anchor }) =>
      Math.abs(box.center - anchor.center) < Math.max(.012, Math.min(box.height, anchor.height) * .8))) return false;
    return sameColumn.some(({ box: anchor }) => anchor.center < box.center - .012)
      && sameColumn.some(({ box: anchor }) => anchor.center > box.center + .012);
  }).sort((a, b) => rect(a).center - rect(b).center);
}

module.exports = { missingInteriorRows, orderedAgreement, rect };
