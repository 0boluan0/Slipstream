export function createTranslationOnlyPreview({
  sourceText,
  translation,
  sourceId = 'preview-translation-source',
  provider = 'free_translate',
  model = 'google-translate',
  generatedAt = '2026-07-27T00:00:00.000Z',
} = {}) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new Error('sourceText must be a non-empty string');
  }
  if (typeof translation !== 'string' || !translation.trim()) {
    throw new Error('translation must be a non-empty string');
  }

  return {
    schemaVersion: 'action-brief.v1',
    status: 'translation_only',
    source: {
      id: sourceId,
      sha256: null,
      length: sourceText.length,
      offsetUnit: 'utf16',
      language: 'en',
    },
    targetLanguage: 'zh',
    translation: {
      text: translation,
      provenance: {
        kind: 'inference',
        confidence: null,
        note: '这是未经过 ActionBrief 结构化分析的翻译结果。',
        evidence: [],
        citations: [],
      },
    },
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    warnings: [
      {
        code: 'ACTION_FIELDS_NOT_ANALYZED',
        message: '此结果仅包含翻译；术语、流程背景、截止日期、材料和下一步均未分析。',
      },
      {
        code: 'OFFICIAL_VERIFICATION_NOT_RUN',
        message: '此结果未执行官方来源核验，不应据此确认政策、资格或当前要求。',
      },
    ],
    analysisProvenance: {
      responseKind: 'translation_only',
      provider,
      model,
      processingTimeMs: null,
      processingLocation: 'online',
      promptVersion: null,
      generatedAt,
    },
  };
}
