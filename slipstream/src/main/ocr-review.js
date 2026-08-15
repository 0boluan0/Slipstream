'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { OCR_REVIEW_CONFIDENCE_THRESHOLD } = require('../shared/constants.cjs');
const {
  serializeOcrReviewDestination,
} = require('../shared/ocr-review-destination.cjs');

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const MEANINGFUL_TEXT_PATTERN = /[\p{L}\p{N}]/u;
const MAX_OCR_REVIEW_BLOCKS = 500;
const MAX_OCR_REVIEW_BLOCK_TEXT_LENGTH = 2_000;
const OCR_REVIEW_BLOCKS_TRUNCATED_PROPERTY = 'ocrReviewBlocksTruncated';
const DEFAULT_PENDING_OCR_REVIEW_TTL_MS = 5 * 60 * 1_000;

const OCR_REVIEW_REASONS = Object.freeze({
  MISSING_CAPTURE: 'missing-capture',
  MISSING_OVERALL_CONFIDENCE: 'missing-overall-confidence',
  LOW_OVERALL_CONFIDENCE: 'low-overall-confidence',
  MISSING_BLOCKS: 'missing-blocks',
  MISSING_BLOCK_CONFIDENCE: 'missing-block-confidence',
  LOW_BLOCK_CONFIDENCE: 'low-block-confidence',
});

function createSourceSha256(sourceText) {
  if (typeof sourceText !== 'string') {
    throw new TypeError('OCR review source must be a string');
  }
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

function createDestinationSha256(destination) {
  return createHash('sha256')
    .update(serializeOcrReviewDestination(destination), 'utf8')
    .digest('hex');
}

function isSourceSha256(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

function sameSha256(left, right) {
  if (!isSourceSha256(left) || !isSourceSha256(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function isMeaningfulOcrBlock(block) {
  return Boolean(block)
    && typeof block === 'object'
    && !Array.isArray(block)
    && typeof block.text === 'string'
    && MEANINGFUL_TEXT_PATTERN.test(
      block.text.slice(0, MAX_OCR_REVIEW_BLOCK_TEXT_LENGTH).trim(),
    );
}

function normalizeConfidence(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function assessOcrReview({ source, text, capture } = {}) {
  const sourceSha256 = createSourceSha256(text);
  if (source !== 'ocr') {
    return Object.freeze({
      required: false,
      sourceSha256,
      reasons: Object.freeze([]),
    });
  }

  const reasons = [];
  const capturePresent = Boolean(capture && typeof capture === 'object' && !Array.isArray(capture));
  if (!capturePresent) reasons.push(OCR_REVIEW_REASONS.MISSING_CAPTURE);

  const overallConfidence = normalizeConfidence(capturePresent ? capture.confidence : null);
  if (overallConfidence === null) {
    reasons.push(OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE);
  } else if (overallConfidence < OCR_REVIEW_CONFIDENCE_THRESHOLD) {
    reasons.push(OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);
  }

  const candidateBlocks = capturePresent && Array.isArray(capture.blocks) ? capture.blocks : [];
  const blocksTruncated = candidateBlocks.length > MAX_OCR_REVIEW_BLOCKS
    || capture?.[OCR_REVIEW_BLOCKS_TRUNCATED_PROPERTY] === true;
  const blocks = candidateBlocks
    .slice(0, MAX_OCR_REVIEW_BLOCKS)
    .filter(isMeaningfulOcrBlock);
  if (blocks.length === 0) reasons.push(OCR_REVIEW_REASONS.MISSING_BLOCKS);

  // If upstream validation had to truncate the list, the unseen confidence
  // values cannot be treated as high-confidence evidence.
  let hasMissingBlockConfidence = blocksTruncated;
  let hasLowBlockConfidence = false;
  for (const block of blocks) {
    const blockConfidence = normalizeConfidence(block.confidence);
    if (blockConfidence === null) {
      hasMissingBlockConfidence = true;
    } else if (blockConfidence < OCR_REVIEW_CONFIDENCE_THRESHOLD) {
      hasLowBlockConfidence = true;
    }
  }
  if (hasMissingBlockConfidence) {
    reasons.push(OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE);
  }
  if (hasLowBlockConfidence) reasons.push(OCR_REVIEW_REASONS.LOW_BLOCK_CONFIDENCE);

  return Object.freeze({
    required: reasons.length > 0,
    sourceSha256,
    reasons: Object.freeze(reasons),
  });
}

function isOcrReviewConfirmed(assessment, confirmation, destinationSha256) {
  if (!assessment || typeof assessment !== 'object' || assessment.required !== true) return true;
  if (
    !confirmation
    || typeof confirmation !== 'object'
    || Array.isArray(confirmation)
    || confirmation.confirmed !== true
    || !isSourceSha256(assessment.sourceSha256)
    || !isSourceSha256(confirmation.sourceSha256)
    || !isSourceSha256(destinationSha256)
    || !isSourceSha256(confirmation.destinationSha256)
  ) {
    return false;
  }
  const keys = Object.keys(confirmation).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'confirmed'
    || keys[1] !== 'destinationSha256'
    || keys[2] !== 'sourceSha256'
  ) {
    return false;
  }
  const sourceMatches = sameSha256(assessment.sourceSha256, confirmation.sourceSha256);
  const destinationMatches = sameSha256(destinationSha256, confirmation.destinationSha256);
  return sourceMatches && destinationMatches;
}

function createPendingOcrReviewRegistry({
  ttlMs = DEFAULT_PENDING_OCR_REVIEW_TTL_MS,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60 * 60 * 1_000) {
    throw new Error('invalid pending OCR review TTL');
  }
  if (typeof now !== 'function') throw new Error('invalid pending OCR review clock');
  const records = new Map();

  function validSenderId(senderId) {
    return Number.isSafeInteger(senderId) && senderId > 0;
  }

  function snapshot(record) {
    if (!record) return null;
    return Object.freeze({
      senderId: record.senderId,
      assessment: record.assessment,
      expiresAt: record.expiresAt,
    });
  }

  function currentRecord(senderId) {
    if (!validSenderId(senderId)) return null;
    const record = records.get(senderId) || null;
    if (record && record.expiresAt <= now()) {
      records.delete(senderId);
      return null;
    }
    return record;
  }

  function record({ senderId, assessment } = {}) {
    if (
      !validSenderId(senderId)
      || !assessment
      || assessment.required !== true
      || !isSourceSha256(assessment.sourceSha256)
      || !Array.isArray(assessment.reasons)
    ) {
      throw new Error('invalid pending OCR review');
    }
    const safeAssessment = Object.freeze({
      required: true,
      sourceSha256: assessment.sourceSha256,
      reasons: Object.freeze(assessment.reasons.filter((reason) => (
        Object.values(OCR_REVIEW_REASONS).includes(reason)
      ))),
    });
    const pending = {
      senderId,
      assessment: safeAssessment,
      expiresAt: now() + ttlMs,
    };
    records.set(senderId, pending);
    return Object.freeze({ status: 'recorded', ...snapshot(pending) });
  }

  function match({ senderId, sourceText } = {}) {
    const pending = currentRecord(senderId);
    if (!pending) return Object.freeze({ status: 'empty' });
    if (
      typeof sourceText !== 'string'
      || !sameSha256(pending.assessment.sourceSha256, createSourceSha256(sourceText))
    ) {
      return Object.freeze({ status: 'mismatch' });
    }
    return Object.freeze({ status: 'matched', ...snapshot(pending) });
  }

  function consume({ senderId, sourceText } = {}) {
    const matched = match({ senderId, sourceText });
    if (matched.status !== 'matched') return matched;
    records.delete(senderId);
    return Object.freeze({ ...matched, status: 'consumed' });
  }

  function clearSender(senderId) {
    return validSenderId(senderId) && records.delete(senderId);
  }

  function clear() {
    records.clear();
  }

  return Object.freeze({ clear, clearSender, consume, match, record });
}

module.exports = {
  MAX_OCR_REVIEW_BLOCKS,
  MAX_OCR_REVIEW_BLOCK_TEXT_LENGTH,
  OCR_REVIEW_BLOCKS_TRUNCATED_PROPERTY,
  OCR_REVIEW_REASONS,
  assessOcrReview,
  createDestinationSha256,
  createPendingOcrReviewRegistry,
  createSourceSha256,
  isMeaningfulOcrBlock,
  isOcrReviewConfirmed,
  isSourceSha256,
};
