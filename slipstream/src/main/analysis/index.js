const { buildActionBriefPrompt: buildPrompt } = require('./prompt');
const {
  createFallbackBrief: createTranslationFallback,
  createLegacyBrief,
} = require('./fallback');
const { createInvalidBrief, normalizeActionBriefCandidate } = require('./normalize');
const { looksLikeAttemptedJson, parseStrictJsonOutput } = require('./parse');

function analyzeModelOutput({
  sourceText,
  rawOutput,
  provider = null,
  model = null,
  processingTimeMs = null,
  officialSources = [],
  sourceId = null,
  generatedAt,
} = {}) {
  assertSourceText(sourceText);
  const parsed = parseStrictJsonOutput(rawOutput);
  if (parsed.candidate) {
    return toJsonSafe(normalizeActionBriefCandidate(parsed.candidate, {
      sourceText,
      provider,
      model,
      processingTimeMs,
      officialSources,
      sourceId,
      generatedAt,
      parserWarnings: parsed.warnings,
    }));
  }

  if (looksLikeAttemptedJson(rawOutput) || typeof rawOutput !== 'string' || !rawOutput.trim()) {
    return toJsonSafe(createInvalidBrief({
      sourceText,
      provider,
      model,
      processingTimeMs,
      sourceId,
      generatedAt,
      code: parsed.error || 'MODEL_OUTPUT_INVALID',
      message: describeParseError(parsed.error),
    }));
  }

  // Compatibility is deliberately narrow: legacy text can recover translation and
  // source-grounded terms, but never deadlines, materials, actions, or verification.
  return toJsonSafe(createLegacyBrief({
    sourceText,
    rawOutput,
    provider,
    model,
    processingTimeMs,
    sourceId,
    generatedAt,
  }));
}

function createFallbackBrief({
  sourceText,
  translation,
  provider = 'free_translate',
  model = null,
  processingTimeMs = null,
  sourceId = null,
  generatedAt,
  responseKind = 'translation_only',
} = {}) {
  return toJsonSafe(createTranslationFallback({
    sourceText,
    translation,
    provider,
    model,
    processingTimeMs,
    sourceId,
    generatedAt,
    responseKind,
  }));
}

function buildActionBriefPrompt(sourceText) {
  return toJsonSafe(buildPrompt(sourceText));
}

function describeParseError(code) {
  const messages = {
    MODEL_OUTPUT_EMPTY: '模型没有返回内容，未生成行动简报。',
    MODEL_OUTPUT_INVALID_JSON: '模型返回的内容不是严格 JSON，未提取任何行动项。',
    MODEL_OUTPUT_NOT_STRING_OR_OBJECT: '模型输出类型无效，未提取任何行动项。',
    MODEL_OUTPUT_ROOT_NOT_OBJECT: '模型 JSON 顶层不是对象，未提取任何行动项。',
    MODEL_OUTPUT_TOO_LARGE: '模型输出超过安全长度限制，未提取任何行动项。',
  };
  return messages[code] || '模型输出无法验证，未提取任何行动项。';
}

function assertSourceText(sourceText) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new Error('sourceText must be a non-empty string');
  }
}

function toJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  analyzeModelOutput,
  buildActionBriefPrompt,
  createFallbackBrief,
};
