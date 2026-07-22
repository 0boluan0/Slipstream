const crypto = require('crypto');

function createCaptureEnvelope({ text, sourceKind = 'manual', capture = null, truncated = false, originalLength = null }) {
  const rawText = String(text || '');
  const blocks = mapBlocksToOffsets(rawText, Array.isArray(capture?.blocks) ? capture.blocks : []);
  return {
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    sourceKind,
    rawText,
    sourceHash: crypto.createHash('sha256').update(rawText, 'utf8').digest('hex'),
    truncated: Boolean(truncated),
    originalLength: Number.isSafeInteger(originalLength) ? originalLength : rawText.length,
    ocr: sourceKind === 'ocr'
      ? {
        confidence: Number.isFinite(capture?.confidence) ? capture.confidence : null,
        blocks,
      }
      : null,
  };
}

function mapBlocksToOffsets(sourceText, blocks) {
  let cursor = 0;
  return blocks.map((block) => {
    const quote = String(block?.text || '');
    let start = quote ? sourceText.indexOf(quote, cursor) : -1;
    if (start < 0 && quote) start = sourceText.indexOf(quote);
    const end = start >= 0 ? start + quote.length : null;
    if (end !== null) cursor = end;
    return { ...block, start: start >= 0 ? start : null, end };
  });
}

module.exports = { createCaptureEnvelope, mapBlocksToOffsets };
