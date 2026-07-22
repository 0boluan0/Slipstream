const { isPlainObject } = require('../../shared/action-brief.cjs');

const MAX_RAW_OUTPUT_LENGTH = 250000;

function parseStrictJsonOutput(rawOutput) {
  if (isPlainObject(rawOutput)) return { candidate: rawOutput, warnings: [] };
  if (typeof rawOutput !== 'string') {
    return { candidate: null, error: 'MODEL_OUTPUT_NOT_STRING_OR_OBJECT', warnings: [] };
  }
  if (rawOutput.length > MAX_RAW_OUTPUT_LENGTH) {
    return { candidate: null, error: 'MODEL_OUTPUT_TOO_LARGE', warnings: [] };
  }

  const trimmed = rawOutput.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { candidate: null, error: 'MODEL_OUTPUT_EMPTY', warnings: [] };

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  try {
    const candidate = JSON.parse(jsonText);
    if (!isPlainObject(candidate)) {
      return { candidate: null, error: 'MODEL_OUTPUT_ROOT_NOT_OBJECT', warnings: [] };
    }
    return {
      candidate,
      warnings: fenced
        ? [{
          code: 'NON_STRICT_JSON_WRAPPER',
          message: '模型使用了 JSON 代码围栏；内容已解析，但不符合严格输出合同。',
        }]
        : [],
    };
  } catch {
    return { candidate: null, error: 'MODEL_OUTPUT_INVALID_JSON', warnings: [] };
  }
}

function looksLikeAttemptedJson(rawOutput) {
  if (typeof rawOutput !== 'string') return false;
  const trimmed = rawOutput.replace(/^\uFEFF/, '').trim();
  return trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('```') ||
    /"schemaVersion"\s*:/.test(trimmed);
}

module.exports = {
  looksLikeAttemptedJson,
  parseStrictJsonOutput,
};
