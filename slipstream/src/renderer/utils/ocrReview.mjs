import { OCR_REVIEW_CONFIDENCE_THRESHOLD } from '../../shared/constants.js';

export const OCR_REVIEW_REASONS = Object.freeze({
  MISSING_CAPTURE: 'missing-capture',
  MISSING_OVERALL_CONFIDENCE: 'missing-overall-confidence',
  LOW_OVERALL_CONFIDENCE: 'low-overall-confidence',
  MISSING_BLOCKS: 'missing-blocks',
  MISSING_BLOCK_CONFIDENCE: 'missing-block-confidence',
  LOW_BLOCK_CONFIDENCE: 'low-block-confidence',
});

const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  custom: '自定义服务',
  deepseek: 'DeepSeek',
  free_translate: 'Google Translate / MyMemory',
  ollama: 'Ollama',
  openai: 'OpenAI',
});

const MEANINGFUL_OCR_TEXT = /[\p{L}\p{N}]/u;
const MAX_OCR_REVIEW_BLOCK_TEXT_LENGTH = 2_000;

function normalizedConfidence(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function isCapture(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function meaningfulBlocks(capture) {
  if (!Array.isArray(capture?.blocks)) return [];
  return capture.blocks.slice(0, 500).filter((block) => (
    block
    && typeof block === 'object'
    && !Array.isArray(block)
    && typeof block.text === 'string'
    && MEANINGFUL_OCR_TEXT.test(
      block.text.slice(0, MAX_OCR_REVIEW_BLOCK_TEXT_LENGTH).trim(),
    )
  ));
}

export function assessOcrReview(source, capture) {
  if (source !== 'ocr') {
    return Object.freeze({
      required: false,
      reasons: Object.freeze([]),
      confidence: null,
      meaningfulBlockCount: 0,
      lowBlockCount: 0,
      missingBlockConfidenceCount: 0,
    });
  }

  const reasons = [];
  const captureAvailable = isCapture(capture);
  if (!captureAvailable) reasons.push(OCR_REVIEW_REASONS.MISSING_CAPTURE);

  const confidence = normalizedConfidence(captureAvailable ? capture.confidence : null);
  if (confidence === null) {
    reasons.push(OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE);
  } else if (confidence < OCR_REVIEW_CONFIDENCE_THRESHOLD) {
    reasons.push(OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);
  }

  const blocks = captureAvailable ? meaningfulBlocks(capture) : [];
  const blockMetadataTruncated = captureAvailable
    && Array.isArray(capture.blocks)
    && capture.blocks.length > 500;
  let lowBlockCount = 0;
  let missingBlockConfidenceCount = 0;
  if (blocks.length === 0) {
    reasons.push(OCR_REVIEW_REASONS.MISSING_BLOCKS);
  } else {
    for (const block of blocks) {
      const blockConfidence = normalizedConfidence(block.confidence);
      if (blockConfidence === null) missingBlockConfidenceCount += 1;
      else if (blockConfidence < OCR_REVIEW_CONFIDENCE_THRESHOLD) lowBlockCount += 1;
    }
    if (missingBlockConfidenceCount > 0) {
      reasons.push(OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE);
    }
    if (lowBlockCount > 0) reasons.push(OCR_REVIEW_REASONS.LOW_BLOCK_CONFIDENCE);
  }
  if (
    blockMetadataTruncated
    && !reasons.includes(OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE)
  ) {
    reasons.push(OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE);
  }

  return Object.freeze({
    required: reasons.length > 0,
    reasons: Object.freeze(reasons),
    confidence,
    meaningfulBlockCount: blocks.length,
    lowBlockCount,
    missingBlockConfidenceCount,
  });
}

export function requiresOcrReview(source, capture) {
  return assessOcrReview(source, capture).required;
}

function processingProviderLabel(provider, processingLocation) {
  if (provider === 'custom' && processingLocation === 'local-loopback') {
    return '本机兼容服务';
  }
  if (provider === 'custom' && processingLocation === 'online') {
    return '远程自定义服务';
  }
  return PROVIDER_LABELS[provider] || null;
}

function providerRecipient(providerLabel) {
  return /^[\u3400-\u9fff]/u.test(providerLabel)
    ? `给${providerLabel}`
    : `给 ${providerLabel}`;
}

function transferDetail(processingLocation, processingProvider) {
  const providerLabel = processingProviderLabel(processingProvider, processingLocation);
  if (processingLocation === 'online') {
    if (processingProvider === 'free_translate') {
      return '完整原文尚未发送给 Google Translate 或备用 MyMemory。';
    }
    return providerLabel
      ? `完整原文尚未发送${providerRecipient(providerLabel)}。`
      : '完整原文尚未发送给所选在线服务。';
  }
  if (processingLocation === 'local-loopback') {
    return '完整原文尚未发送到这台 Mac 上的兼容服务；该服务自身是否再联网、转发或留存取决于它的配置。';
  }
  if (processingLocation === 'local') {
    return providerLabel
      ? `完整原文尚未交给这台 Mac 上的 ${providerLabel}。`
      : '完整原文尚未交给这台 Mac 上的本机模型。';
  }
  return '完整原文尚未发送；处理位置或服务尚未确认。';
}

function confidenceDetail(assessment) {
  if (assessment.confidence === null) {
    return '本机 OCR 没有返回这段文字的平均把握。';
  }
  const percentage = Math.round(assessment.confidence * 100);
  const threshold = Math.round(OCR_REVIEW_CONFIDENCE_THRESHOLD * 100);
  return assessment.reasons.includes(OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE)
    ? `本机 OCR 对这段文字的平均把握约为 ${percentage}%，低于 ${threshold}% 的核对门槛。`
    : `本机 OCR 对这段文字的平均把握约为 ${percentage}%，但逐块信息仍需核对。`;
}

function blockDetail(assessment) {
  if (assessment.reasons.includes(OCR_REVIEW_REASONS.MISSING_BLOCKS)) {
    return '没有收到可逐块核对的 OCR 文字。';
  }
  const details = [];
  if (assessment.missingBlockConfidenceCount > 0) {
    details.push(`${assessment.missingBlockConfidenceCount} 个文字块没有把握指标`);
  }
  if (assessment.lowBlockCount > 0) {
    details.push(`${assessment.lowBlockCount} 个文字块的把握低于 ${Math.round(OCR_REVIEW_CONFIDENCE_THRESHOLD * 100)}%`);
  }
  return details.length > 0 ? `其中${details.join('，')}。` : '';
}

export function describeOcrReview({
  source,
  capture,
  processingLocation,
  processingProvider,
} = {}) {
  const assessment = assessOcrReview(source, capture);
  if (!assessment.required) return null;

  return Object.freeze({
    title: '先核对截图文字',
    detail: [
      confidenceDetail(assessment),
      blockDetail(assessment),
      transferDetail(processingLocation, processingProvider),
    ].filter(Boolean).join(''),
    guidance: '请重点检查日期、金额、姓名、编号和否定词；可直接修改下方原文，或确认无误后继续。',
    confidence: assessment.confidence,
    reasons: assessment.reasons,
    meaningfulBlockCount: assessment.meaningfulBlockCount,
    lowBlockCount: assessment.lowBlockCount,
    missingBlockConfidenceCount: assessment.missingBlockConfidenceCount,
  });
}

export async function sha256OcrReviewSource(sourceText) {
  if (typeof sourceText !== 'string') {
    throw new TypeError('OCR review source text must be a string');
  }
  if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== 'function') {
    throw new Error('Web Crypto SHA-256 is unavailable');
  }
  const encoded = new globalThis.TextEncoder().encode(sourceText);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createOcrReviewConfirmation(
  sourceText,
  { settings, processingLocation } = {},
) {
  const {
    ocrReviewDestinationForSettings,
    serializeOcrReviewDestination,
  } = await import('../../shared/ocr-review-destination.mjs');
  const destination = ocrReviewDestinationForSettings(settings, processingLocation);
  const destinationSerialization = serializeOcrReviewDestination(destination);
  const [sourceSha256, destinationSha256] = await Promise.all([
    sha256OcrReviewSource(sourceText),
    sha256OcrReviewSource(destinationSerialization),
  ]);
  return Object.freeze({
    confirmed: true,
    sourceSha256,
    destinationSha256,
  });
}
