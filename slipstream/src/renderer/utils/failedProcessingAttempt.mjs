export const FAILED_PROCESSING_ATTEMPT_NOTICE =
  '当前显示的是上一份有效结果。刚才未成功处理的原文只在当前会话内存中保留，未写入历史；可以直接重试，或先查看并修正。';

const MAX_PROCESSING_CONFIG_SIGNATURE_LENGTH = 100_000;

function normalizeSource(value) {
  return typeof value === 'string' && value.trim() && value.length <= 40
    ? value
    : 'manual';
}

function cloneCapture(capture) {
  if (!capture || typeof capture !== 'object') return null;
  return {
    confidence: Number.isFinite(capture.confidence) ? capture.confidence : null,
    blocks: Array.isArray(capture.blocks)
      ? capture.blocks.map((block) => {
          if (!block || typeof block !== 'object') return block;
          return {
            ...block,
            ...(block.boundingBox && typeof block.boundingBox === 'object'
              ? { boundingBox: { ...block.boundingBox } }
              : {}),
          };
        })
      : [],
  };
}

function cloneOcrReviewConfirmation(ocrReview) {
  if (
    !ocrReview
    || typeof ocrReview !== 'object'
    || Array.isArray(ocrReview)
    || ocrReview.confirmed !== true
    || typeof ocrReview.sourceSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(ocrReview.sourceSha256)
    || typeof ocrReview.destinationSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(ocrReview.destinationSha256)
  ) return null;
  const keys = Object.keys(ocrReview).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'confirmed'
    || keys[1] !== 'destinationSha256'
    || keys[2] !== 'sourceSha256'
  ) return null;
  return {
    confirmed: true,
    sourceSha256: ocrReview.sourceSha256,
    destinationSha256: ocrReview.destinationSha256,
  };
}

export function isValidOcrReviewConfirmation(ocrReview) {
  return cloneOcrReviewConfirmation(ocrReview) !== null;
}

function cloneProcessingConfigSignature(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PROCESSING_CONFIG_SIGNATURE_LENGTH
    ? value
    : null;
}

function cloneProcessingConfigRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function visibleResultSource(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  return String(snapshot.processedSourceText || snapshot.inputText || '');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function captureIdentity(capture) {
  return JSON.stringify(stableValue(cloneCapture(capture)));
}

function ocrReviewIdentity(ocrReview) {
  return JSON.stringify(cloneOcrReviewConfirmation(ocrReview));
}

/**
 * Keep a failed replacement source separate from the last valid result. The
 * returned object is intentionally renderer-memory-only and contains no
 * provider response, credential, history identifier, or persistence receipt.
 */
export function createFailedProcessingAttempt(payload = {}, lastGood = null) {
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!text.trim() || text === visibleResultSource(lastGood)) return null;

  const options = payload.options && typeof payload.options === 'object'
    ? payload.options
    : {};
  const originalLength = Number.isSafeInteger(options.originalLength)
    && options.originalLength >= text.length
    ? options.originalLength
    : text.length;
  const source = normalizeSource(options.source);
  const candidateOcrReview = source === 'ocr'
    ? cloneOcrReviewConfirmation(options.ocrReview)
    : null;
  const processingConfigSignature = candidateOcrReview
    ? cloneProcessingConfigSignature(options.processingConfigSignature)
    : null;
  const processingConfigRevision = candidateOcrReview
    ? cloneProcessingConfigRevision(options.processingConfigRevision)
    : null;
  const ocrReview = processingConfigSignature && processingConfigRevision !== null
    ? candidateOcrReview
    : null;

  return {
    text,
    source,
    capture: cloneCapture(options.capture),
    ...(ocrReview ? { ocrReview, processingConfigSignature, processingConfigRevision } : {}),
    truncated: Boolean(options.truncated),
    originalLength,
  };
}

export function failedProcessingAttemptOptions(attempt, { retryOfLastGood = true } = {}) {
  if (!attempt || typeof attempt.text !== 'string' || !attempt.text.trim()) return null;
  const source = normalizeSource(attempt.source);
  const candidateOcrReview = source === 'ocr'
    ? cloneOcrReviewConfirmation(attempt.ocrReview)
    : null;
  const processingConfigSignature = candidateOcrReview
    ? cloneProcessingConfigSignature(attempt.processingConfigSignature)
    : null;
  const processingConfigRevision = candidateOcrReview
    ? cloneProcessingConfigRevision(attempt.processingConfigRevision)
    : null;
  const ocrReview = processingConfigSignature && processingConfigRevision !== null
    ? candidateOcrReview
    : null;
  return {
    source,
    capture: cloneCapture(attempt.capture),
    ...(ocrReview ? { ocrReview, processingConfigSignature, processingConfigRevision } : {}),
    truncated: Boolean(attempt.truncated),
    originalLength: Number.isSafeInteger(attempt.originalLength)
      && attempt.originalLength >= attempt.text.length
      ? attempt.originalLength
      : attempt.text.length,
    retryOfLastGood: retryOfLastGood === true,
  };
}

export function prepareFailedProcessingAttemptRetry(attempt, draft = null) {
  const retainedOptions = failedProcessingAttemptOptions(attempt);
  if (!retainedOptions) return null;

  const draftBelongsToAttempt = Boolean(
    draft
    && draft.baseSourceText === attempt.text
    && typeof draft.text === 'string',
  );
  const text = draftBelongsToAttempt ? draft.text : attempt.text;
  if (!text.trim()) return null;

  const modified = draftBelongsToAttempt && text !== attempt.text;
  return {
    text,
    modified,
    options: modified
        ? {
          source: 'manual',
          capture: null,
          truncated: false,
          originalLength: text.length,
          retryOfLastGood: true,
        }
      : retainedOptions,
  };
}

export function failedProcessingAttemptMatches(attempt, text, options = {}) {
  const normalized = failedProcessingAttemptOptions(attempt);
  if (!normalized || typeof text !== 'string') return false;
  return attempt.text === text
    && normalized.source === normalizeSource(options.source)
    && captureIdentity(normalized.capture) === captureIdentity(options.capture)
    && ocrReviewIdentity(normalized.ocrReview) === ocrReviewIdentity(
      normalized.source === 'ocr'
        ? options.ocrReview
        : null,
    )
    && normalized.processingConfigSignature === (
      normalized.ocrReview
        ? cloneProcessingConfigSignature(options.processingConfigSignature)
        : undefined
    )
    && normalized.processingConfigRevision === (
      normalized.ocrReview
        ? cloneProcessingConfigRevision(options.processingConfigRevision)
        : undefined
    )
    && normalized.truncated === Boolean(options.truncated)
    && normalized.originalLength === (
      Number.isSafeInteger(options.originalLength) && options.originalLength >= text.length
        ? options.originalLength
        : text.length
    );
}

export function appendFailedProcessingAttemptNotice(message = '', attempt = null) {
  const current = typeof message === 'string' ? message.trim() : '';
  if (!attempt || current.includes(FAILED_PROCESSING_ATTEMPT_NOTICE)) return current;
  return [current, FAILED_PROCESSING_ATTEMPT_NOTICE].filter(Boolean).join(' ');
}

export function removeFailedProcessingAttemptNotice(message = '') {
  return String(message || '')
    .replace(FAILED_PROCESSING_ATTEMPT_NOTICE, '')
    .replace(/\s+/g, ' ')
    .trim();
}
