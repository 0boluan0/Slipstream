'use strict';

// Keep occurrence offsets on the original source; normalization is only for card identity.
const normalizeSelection = text => text.normalize('NFC').trim().replace(/\s+/gu, ' ');

function validatedSelectionRange(source, selection, range) {
  if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end <= range.start || range.end > source.length
    || source.slice(range.start, range.end) !== selection) return null;
  return { start: range.start, end: range.end };
}

function repeatedSelection(source, selection) {
  const text = normalizeSelection(source), quote = normalizeSelection(selection);
  const first = text.indexOf(quote);
  return Boolean(quote && first >= 0 && text.indexOf(quote, first + 1) >= 0);
}

function selectionRangeForSegments(source, segments, selection) {
  let cursor = 0;
  for (const segment of segments) {
    const start = source.indexOf(segment.source, cursor);
    if (start < 0) return null;
    if (segment.id === selection.segmentId) return validatedSelectionRange(source,
      segment.source.slice(selection.start, selection.end),
      { start: start + selection.start, end: start + selection.end });
    cursor = start + segment.source.length;
  }
  return null;
}

module.exports = { normalizeSelection, validatedSelectionRange, repeatedSelection, selectionRangeForSegments };
