const { assertActionBrief } = require('../../shared/action-brief.cjs');
const { resolveEvidenceQuotes } = require('./evidence');
const { createBaseBrief, inferSourceLanguage } = require('./normalize');

const FREE_TRANSLATE_FOOTER = '\n\n---\n免费翻译仅提供翻译；配置 LLM API Key 后可获得术语解释。';

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
  assertInputs(sourceText, translation);
  const sourceLanguage = inferSourceLanguage(sourceText);
  const cleanTranslation = stripKnownFooter(translation);
  const brief = createBaseBrief({
    status: 'translation_only',
    sourceText,
    sourceId,
    sourceLanguage,
    targetLanguage: sourceLanguage === 'zh' ? 'en' : 'zh',
    provider,
    model,
    processingTimeMs,
    generatedAt,
    responseKind,
  });
  brief.translation = {
    text: cleanTranslation,
    provenance: {
      kind: 'inference',
      confidence: null,
      note: '这是未经过 ActionBrief 结构化分析的翻译结果。',
      evidence: [],
      citations: [],
    },
  };
  brief.warnings = [
    {
      code: 'ACTION_FIELDS_NOT_ANALYZED',
      message: '此结果仅包含翻译；术语、流程背景、截止日期、材料和下一步均未分析。',
    },
    {
      code: 'OFFICIAL_VERIFICATION_NOT_RUN',
      message: '此结果未执行官方来源核验，不应据此确认政策、资格或当前要求。',
    },
  ];
  return assertActionBrief(brief, { sourceText });
}

function createLegacyBrief({
  sourceText,
  rawOutput,
  provider = null,
  model = null,
  processingTimeMs = null,
  sourceId = null,
  generatedAt,
} = {}) {
  assertInputs(sourceText, rawOutput);
  const parsed = parseLegacySections(rawOutput);
  if (!parsed.hasSections) {
    return createFallbackBrief({
      sourceText,
      translation: rawOutput,
      provider,
      model,
      processingTimeMs,
      sourceId,
      generatedAt,
      responseKind: 'legacy_unstructured',
    });
  }

  const sourceLanguage = inferSourceLanguage(sourceText);
  const brief = createBaseBrief({
    status: 'partial',
    sourceText,
    sourceId,
    sourceLanguage,
    targetLanguage: sourceLanguage === 'zh' ? 'en' : 'zh',
    provider,
    model,
    processingTimeMs,
    generatedAt,
    responseKind: 'legacy_two_section',
  });
  brief.translation = {
    text: parsed.translation,
    provenance: {
      kind: 'inference',
      confidence: null,
      note: '从旧版两段式字符串中恢复；未通过严格 JSON 合同。',
      evidence: [],
      citations: [],
    },
  };

  const droppedTerms = [];
  const seen = new Set();
  for (const term of parsed.terms.slice(0, 50)) {
    const evidence = resolveEvidenceQuotes(sourceText, [term.surface]);
    const key = term.surface.toLocaleLowerCase();
    if (!evidence.length) {
      droppedTerms.push(term.surface);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    brief.terms.push({
      id: `term-${brief.terms.length + 1}`,
      surface: term.surface,
      kind: /^[A-Z0-9][A-Z0-9._/-]{1,20}$/.test(term.surface)
        ? 'abbreviation'
        : 'specialist_term',
      explanation: term.explanation,
      provenance: {
        kind: 'inference',
        confidence: null,
        note: '术语在原文中出现，但解释来自未结构化的旧版模型输出。',
        evidence,
        citations: [],
      },
    });
  }

  brief.warnings = [
    {
      code: 'LEGACY_UNSTRUCTURED_RESPONSE',
      message: '模型返回了旧版两段式字符串；仅恢复翻译和可在原文定位的术语。',
    },
    {
      code: 'ACTION_FIELDS_NOT_ANALYZED',
      message: '截止日期、材料、下一步和流程背景未从旧版字符串中推断，以避免产生不可追溯行动。',
    },
    {
      code: 'OFFICIAL_VERIFICATION_NOT_RUN',
      message: '旧版输出没有可信官方来源，所有官方核验均视为未执行。',
    },
  ];
  if (droppedTerms.length) {
    brief.warnings.push({
      code: 'UNSUPPORTED_LEGACY_TERMS_DROPPED',
      message: `以下旧版术语未在原文中找到，已丢弃：${droppedTerms.slice(0, 10).join('、')}`,
    });
  }
  if (!brief.terms.length) brief.status = 'translation_only';
  return assertActionBrief(brief, { sourceText });
}

function parseLegacySections(rawOutput) {
  const clean = stripKnownFooter(rawOutput).trim();
  const marker = clean.match(
    /\n?\s*2[.、]\s*(?:\*\*)?(?:专有名词[^\n]*|Proper Noun[^\n]*|Term Explanations[^\n]*)(?:\*\*)?[：:]?/i,
  );
  if (!marker) return { hasSections: false, translation: clean, terms: [] };

  const translation = clean
    .slice(0, marker.index)
    .replace(/^\s*1[.、]\s*(?:\*\*)?[^：:\n]*(?:\*\*)?[：:]?\s*/i, '')
    .trim();
  const termsText = clean.slice(marker.index + marker[0].length).replace(/^[：:\s]*/, '').trim();
  const terms = termsText
    .split(/\n+/)
    .map(parseLegacyTermLine)
    .filter(Boolean);
  return {
    hasSections: Boolean(translation),
    translation: translation || clean,
    terms,
  };
}

function parseLegacyTermLine(line) {
  const clean = line
    .trim()
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.、]\s*/, '');
  if (!clean || /^(无|none|n\/a|没有)[。.?\s]*$/i.test(clean)) return null;
  const separator = clean.match(/\s*[：:]\s*/);
  if (!separator || separator.index === 0) return null;
  const surface = clean
    .slice(0, separator.index)
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^`|`$/g, '')
    .trim();
  const explanation = clean.slice(separator.index + separator[0].length).trim();
  if (!surface || !explanation || surface.length > 500 || explanation.length > 5000) return null;
  return { surface, explanation };
}

function stripKnownFooter(value) {
  const trimmed = value.trim();
  return trimmed.endsWith(FREE_TRANSLATE_FOOTER.trim())
    ? trimmed.slice(0, -FREE_TRANSLATE_FOOTER.trim().length).trim()
    : trimmed;
}

function assertInputs(sourceText, output) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new Error('sourceText must be a non-empty string');
  }
  if (typeof output !== 'string' || !output.trim()) {
    throw new Error('translation/rawOutput must be a non-empty string');
  }
}

module.exports = {
  createFallbackBrief,
  createLegacyBrief,
  parseLegacySections,
};
