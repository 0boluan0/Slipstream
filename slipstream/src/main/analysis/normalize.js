const { createHash } = require('node:crypto');

const {
  ACTION_BRIEF_CANDIDATE_VERSION,
  CONTEXT_KINDS,
  MATERIAL_REQUIREMENTS,
  PROVENANCE_KINDS,
  SOURCE_LANGUAGES,
  STEP_ACTORS,
  STEP_URGENCIES,
  TARGET_LANGUAGES,
  TERM_KINDS,
  assertActionBrief,
  createEmptyActionBrief,
  isPlainObject,
  isSafeLookupUrl,
  validateActionBrief,
} = require('../../shared/action-brief.cjs');
const {
  collectCandidateQuotes,
  normalizeOfficialSources,
  resolveEvidenceQuotes,
  resolveOfficialCitations,
} = require('./evidence');

const ARRAY_LIMITS = Object.freeze({
  terms: 50,
  contexts: 20,
  deadlines: 50,
  materials: 50,
  nextSteps: 50,
  verifications: 30,
  warnings: 30,
});

function normalizeActionBriefCandidate(candidate, options) {
  const {
    sourceText,
    provider = null,
    model = null,
    processingTimeMs = null,
    officialSources = [],
    sourceId = null,
    generatedAt,
    parserWarnings = [],
  } = options || {};

  assertSourceText(sourceText);
  if (!candidate || candidate.schemaVersion !== ACTION_BRIEF_CANDIDATE_VERSION) {
    return createInvalidBrief({
      sourceText,
      provider,
      model,
      processingTimeMs,
      sourceId,
      generatedAt,
      code: 'UNSUPPORTED_CANDIDATE_SCHEMA',
      message: `模型必须返回 ${ACTION_BRIEF_CANDIDATE_VERSION}。`,
    });
  }

  const warnings = createWarningCollector(parserWarnings);
  const officialSourcesById = normalizeOfficialSources(officialSources);
  const sourceLanguage = resolveSourceLanguage(sourceText, candidate.sourceLanguage);
  const targetLanguage = TARGET_LANGUAGES.includes(candidate.targetLanguage)
    ? candidate.targetLanguage
    : sourceLanguage === 'zh' ? 'en' : 'zh';
  const brief = createBaseBrief({
    status: 'complete',
    sourceText,
    sourceId,
    sourceLanguage,
    targetLanguage,
    provider,
    model,
    processingTimeMs,
    generatedAt,
    responseKind: 'structured',
  });

  brief.translation = normalizeContentBlock(candidate.translation, {
    sourceText,
    officialSourcesById,
    defaultKind: 'inference',
    requireEvidence: false,
    warnings,
    path: 'translation',
  });
  brief.explanation = normalizeContentBlock(candidate.explanation, {
    sourceText,
    officialSourcesById,
    defaultKind: 'inference',
    requireEvidence: false,
    warnings,
    path: 'explanation',
  });

  brief.terms = normalizeTerms(candidate.terms, {
    sourceText,
    officialSourcesById,
    warnings,
  });
  brief.contexts = normalizeContexts(candidate.contexts, {
    sourceText,
    officialSourcesById,
    warnings,
  });
  const normalizedDeadlines = normalizeDeadlines(candidate.deadlines, {
    sourceText,
    officialSourcesById,
    warnings,
  });
  brief.deadlines = normalizedDeadlines.items;
  brief.materials = normalizeMaterials(candidate.materials, {
    sourceText,
    officialSourcesById,
    warnings,
  });
  brief.nextSteps = normalizeNextSteps(candidate.nextSteps, {
    sourceText,
    officialSourcesById,
    warnings,
    deadlineIdsByCandidateIndex: normalizedDeadlines.idsByCandidateIndex,
  });
  brief.verifications = normalizeVerifications(candidate.verifications, {
    sourceText,
    officialSourcesById,
    warnings,
  });
  addCandidateWarnings(candidate.warnings, warnings);

  brief.warnings = warnings.values();
  brief.status = resolveBriefStatus(brief, warnings.isPartial());

  const validation = validateActionBrief(brief, { sourceText });
  if (!validation.valid) {
    return createInvalidBrief({
      sourceText,
      provider,
      model,
      processingTimeMs,
      sourceId,
      generatedAt,
      code: 'NORMALIZED_BRIEF_INVALID',
      message: `结构化结果未通过服务端校验：${validation.errors.join('; ')}`,
    });
  }
  return brief;
}

function normalizeTerms(value, context) {
  const items = [];
  const seen = new Set();
  forEachCandidate(value, 'terms', context.warnings, (candidate) => {
    const surface = boundedString(candidate?.surface, 500);
    const explanation = boundedString(candidate?.explanation, 5000);
    if (!surface || !explanation) {
      context.warnings.add('INVALID_TERM_DROPPED', '缺少术语原文或解释的条目已丢弃。');
      return;
    }
    const key = surface.toLocaleLowerCase();
    if (seen.has(key)) return;
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'inference',
      requireEvidence: true,
      fallbackQuotes: [surface],
      path: `term:${surface}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_TERM_DROPPED', `术语“${surface}”未在原文或官方来源中找到，已丢弃。`);
      return;
    }
    seen.add(key);
    items.push({
      id: `term-${items.length + 1}`,
      surface,
      kind: TERM_KINDS.includes(candidate?.kind) ? candidate.kind : 'other',
      explanation,
      provenance,
    });
  });
  return items;
}

function normalizeContexts(value, context) {
  const items = [];
  const seen = new Set();
  forEachCandidate(value, 'contexts', context.warnings, (candidate) => {
    const label = boundedString(candidate?.label, 500);
    const explanation = boundedString(candidate?.explanation, 5000);
    if (!label || !explanation || !CONTEXT_KINDS.includes(candidate?.kind)) {
      context.warnings.add('INVALID_CONTEXT_DROPPED', '无效的文化或流程背景条目已丢弃。');
      return;
    }
    const key = `${candidate.kind}:${label.toLocaleLowerCase()}`;
    if (seen.has(key)) return;
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'inference',
      requireEvidence: true,
      fallbackQuotes: [],
      path: `context:${label}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_CONTEXT_DROPPED', `背景“${label}”没有可追溯依据，已丢弃。`);
      return;
    }
    seen.add(key);
    items.push({
      id: `context-${items.length + 1}`,
      label,
      kind: candidate.kind,
      explanation,
      provenance,
    });
  });
  return items;
}

function normalizeDeadlines(value, context) {
  const items = [];
  const idsByCandidateIndex = [];
  forEachCandidate(value, 'deadlines', context.warnings, (candidate, candidateIndex) => {
    const whenText = boundedString(candidate?.whenText, 1000);
    if (!whenText) {
      context.warnings.add('INVALID_DEADLINE_DROPPED', '缺少原文日期文字的截止日期已丢弃。');
      return;
    }
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'original',
      requireEvidence: true,
      fallbackQuotes: [whenText],
      path: `deadline:${whenText}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_DEADLINE_DROPPED', `截止日期“${whenText}”没有可追溯依据，已丢弃。`);
      return;
    }
    const normalizedAt = normalizeIsoInstant(candidate?.normalizedAt);
    if (candidate?.normalizedAt && !normalizedAt) {
      context.warnings.add(
        'UNSAFE_NORMALIZED_DEADLINE_DROPPED',
        `无法安全标准化截止日期“${whenText}”，已保留原文并清空标准时间。`,
      );
    }
    const id = `deadline-${items.length + 1}`;
    idsByCandidateIndex[candidateIndex] = id;
    items.push({
      id,
      whenText,
      normalizedAt,
      timezone: nullableBoundedString(candidate?.timezone, 100),
      condition: nullableBoundedString(candidate?.condition, 1000),
      provenance,
    });
  });
  return { items, idsByCandidateIndex };
}

function normalizeMaterials(value, context) {
  const items = [];
  const seen = new Set();
  forEachCandidate(value, 'materials', context.warnings, (candidate) => {
    const name = boundedString(candidate?.name, 500);
    if (!name) {
      context.warnings.add('INVALID_MATERIAL_DROPPED', '缺少材料名称的条目已丢弃。');
      return;
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return;
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'original',
      requireEvidence: true,
      // A material name alone does not prove that it is required.
      fallbackQuotes: [],
      path: `material:${name}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_MATERIAL_DROPPED', `材料“${name}”没有原文要求依据，已丢弃。`);
      return;
    }
    seen.add(key);
    items.push({
      id: `material-${items.length + 1}`,
      name,
      requirement: MATERIAL_REQUIREMENTS.includes(candidate?.requirement)
        ? candidate.requirement
        : 'unknown',
      details: nullableBoundedString(candidate?.details, 2000),
      provenance,
    });
  });
  return items;
}

function normalizeNextSteps(value, context) {
  const items = [];
  const seen = new Set();
  forEachCandidate(value, 'nextSteps', context.warnings, (candidate) => {
    const action = boundedString(candidate?.action, 2000);
    if (!action) {
      context.warnings.add('INVALID_NEXT_STEP_DROPPED', '缺少动作说明的下一步已丢弃。');
      return;
    }
    const key = action.toLocaleLowerCase();
    if (seen.has(key)) return;
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'inference',
      requireEvidence: true,
      fallbackQuotes: [],
      path: `next-step:${action}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_NEXT_STEP_DROPPED', `下一步“${action}”没有原文依据，已丢弃。`);
      return;
    }
    const deadlineIndex = Number.isSafeInteger(candidate?.deadlineIndex)
      ? candidate.deadlineIndex
      : null;
    const deadlineId = deadlineIndex === null
      ? null
      : context.deadlineIdsByCandidateIndex[deadlineIndex] || null;
    if (deadlineIndex !== null && !deadlineId) {
      context.warnings.add('INVALID_DEADLINE_REFERENCE', `下一步“${action}”引用了无效的截止日期。`);
    }
    seen.add(key);
    items.push({
      id: `step-${items.length + 1}`,
      action,
      actor: STEP_ACTORS.includes(candidate?.actor) ? candidate.actor : 'unknown',
      urgency: STEP_URGENCIES.includes(candidate?.urgency) ? candidate.urgency : 'unknown',
      mandatory: typeof candidate?.mandatory === 'boolean' ? candidate.mandatory : null,
      deadlineId,
      provenance,
    });
  });
  return items;
}

function normalizeVerifications(value, context) {
  const items = [];
  const seen = new Set();
  forEachCandidate(value, 'verifications', context.warnings, (candidate) => {
    const claim = boundedString(candidate?.claim, 2000);
    const reason = boundedString(candidate?.reason, 2000);
    if (!claim || !reason) {
      context.warnings.add('INVALID_VERIFICATION_DROPPED', '缺少 claim 或 reason 的核验项已丢弃。');
      return;
    }
    const key = claim.toLocaleLowerCase();
    if (seen.has(key)) return;
    const provenance = normalizeProvenance(candidate, {
      ...context,
      defaultKind: 'pending',
      requireEvidence: true,
      fallbackQuotes: [],
      path: `verification:${claim}`,
    });
    if (!isGrounded(provenance)) {
      context.warnings.add('UNSUPPORTED_VERIFICATION_DROPPED', `核验项“${claim}”没有原文触发依据，已丢弃。`);
      return;
    }
    const lookup = normalizeVerificationLookup(candidate?.lookup, context.warnings, claim);
    const verified = lookup === null &&
      candidate?.status === 'verified' &&
      provenance.kind === 'official';
    if (candidate?.status === 'verified' && !verified) {
      context.warnings.add(
        'UNVERIFIED_OFFICIAL_CLAIM_DOWNGRADED',
        `核验项“${claim}”没有调用方验证的官方来源，已降级为待核验。`,
      );
    }
    seen.add(key);
    items.push({
      id: `verification-${items.length + 1}`,
      claim,
      reason,
      status: verified ? 'verified' : 'pending',
      lookup,
      provenance: verified ? provenance : downgradeToPending(provenance),
    });
  });
  return items;
}

function normalizeVerificationLookup(value, warnings, claim) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    warnings.add('INVALID_VERIFICATION_LOOKUP_DROPPED', `核验项“${claim}”的检索计划格式无效，已丢弃。`);
    return null;
  }

  const publisher = strictBoundedString(value.publisher, 120);
  const query = strictBoundedString(value.query, 120);
  if (!publisher || !query || countWords(query) > 16) {
    warnings.add(
      'INVALID_VERIFICATION_LOOKUP_DROPPED',
      `核验项“${claim}”的发布者或检索词不符合安全限制，已丢弃检索计划。`,
    );
    return null;
  }

  const candidateUrls = [];
  const seen = new Set();
  if (value.candidateUrls !== undefined && !Array.isArray(value.candidateUrls)) {
    warnings.add(
      'INVALID_LOOKUP_URLS_DROPPED',
      `核验项“${claim}”的候选 URL 不是数组，已清空。`,
    );
  }
  for (const candidateUrl of Array.isArray(value.candidateUrls) ? value.candidateUrls : []) {
    const url = strictBoundedString(candidateUrl, 2048);
    if (!isSafeLookupUrl(url)) {
      warnings.add(
        'UNSAFE_LOOKUP_URL_DROPPED',
        `核验项“${claim}”包含不安全的候选 URL，已丢弃。`,
      );
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    if (candidateUrls.length < 3) candidateUrls.push(url);
  }
  if (Array.isArray(value.candidateUrls) && value.candidateUrls.length > 3) {
    warnings.add(
      'LOOKUP_URLS_TRUNCATED',
      `核验项“${claim}”的候选 URL 已截断为 3 个。`,
    );
  }

  return { publisher, query, candidateUrls };
}

function normalizeContentBlock(candidate, context) {
  if (candidate === null || candidate === undefined) return null;
  const value = typeof candidate === 'string' ? { text: candidate } : candidate;
  const text = boundedString(value?.text, 100000);
  if (!text) {
    context.warnings.add('INVALID_CONTENT_BLOCK_DROPPED', `${context.path} 缺少文本，已丢弃。`);
    return null;
  }
  return {
    text,
    provenance: normalizeProvenance(value, context),
  };
}

function normalizeProvenance(candidate, context) {
  const requested = typeof candidate?.provenance === 'string'
    ? candidate.provenance
    : candidate?.provenance?.kind;
  let kind = PROVENANCE_KINDS.includes(requested) ? requested : context.defaultKind;
  const quotes = collectCandidateQuotes(candidate, context.fallbackQuotes || []);
  const evidence = resolveEvidenceQuotes(context.sourceText, quotes);
  let citations = resolveOfficialCitations(candidate, context.officialSourcesById);
  let note = null;

  if (kind === 'official' && citations.length === 0) {
    kind = 'pending';
    note = '模型请求 official provenance，但没有调用方验证的官方来源。';
    context.warnings.add(
      'OFFICIAL_PROVENANCE_DOWNGRADED',
      `${context.path} 的官方来源声明已降级为待核验。`,
    );
  } else if (kind !== 'official') {
    citations = [];
  }

  if ((kind === 'original' || (kind === 'inference' && context.requireEvidence)) && evidence.length === 0) {
    kind = 'pending';
    note = '没有解析到与原文一致的 evidence quote。';
  }

  return {
    kind,
    confidence: normalizeConfidence(candidate?.confidence ?? candidate?.provenance?.confidence),
    note,
    evidence,
    citations,
  };
}

function downgradeToPending(provenance) {
  return {
    ...provenance,
    kind: 'pending',
    note: provenance.note || '尚未由调用方验证的官方来源确认。',
    citations: [],
  };
}

function createBaseBrief({
  status,
  sourceText,
  sourceId,
  sourceLanguage,
  targetLanguage,
  provider,
  model,
  processingTimeMs,
  generatedAt,
  responseKind,
}) {
  return createEmptyActionBrief({
    status,
    sourceId: nullableBoundedString(sourceId, 500),
    sourceSha256: createHash('sha256').update(sourceText, 'utf8').digest('hex'),
    sourceLength: sourceText.length,
    sourceLanguage,
    targetLanguage,
    responseKind,
    provider: nullableBoundedString(provider, 500),
    model: nullableBoundedString(model, 500),
    processingTimeMs: normalizeProcessingTime(processingTimeMs),
    generatedAt: normalizeGeneratedAt(generatedAt),
  });
}

function createInvalidBrief({
  sourceText,
  provider = null,
  model = null,
  processingTimeMs = null,
  sourceId = null,
  generatedAt,
  code,
  message,
}) {
  assertSourceText(sourceText);
  const brief = createBaseBrief({
    status: 'invalid',
    sourceText,
    sourceId,
    sourceLanguage: inferSourceLanguage(sourceText),
    targetLanguage: inferSourceLanguage(sourceText) === 'zh' ? 'en' : 'zh',
    provider,
    model,
    processingTimeMs,
    generatedAt,
    responseKind: 'invalid',
  });
  brief.warnings.push({ code, message: boundedString(message, 5000) || '结构化分析失败。' });
  return assertActionBrief(brief, { sourceText });
}

function resolveBriefStatus(brief, partial) {
  if (!brief.translation && !brief.explanation) return 'invalid';
  const structuredCount = brief.terms.length + brief.contexts.length + brief.deadlines.length +
    brief.materials.length + brief.nextSteps.length + brief.verifications.length;
  if (!brief.explanation && structuredCount === 0) return 'translation_only';
  if (partial || containsPending(brief)) return 'partial';
  return 'complete';
}

function containsPending(brief) {
  return [brief.translation, brief.explanation]
    .concat(brief.terms, brief.contexts, brief.deadlines, brief.materials, brief.nextSteps, brief.verifications)
    .some((item) => item?.provenance?.kind === 'pending');
}

function addCandidateWarnings(value, warnings) {
  if (!Array.isArray(value)) return;
  for (const warning of value.slice(0, ARRAY_LIMITS.warnings)) {
    const message = boundedString(typeof warning === 'string' ? warning : warning?.message, 1000);
    if (message) warnings.add('MODEL_WARNING', message, true);
  }
}

function forEachCandidate(value, key, warnings, callback) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    warnings.add('INVALID_ARRAY_DROPPED', `${key} 不是数组，已丢弃。`);
    return;
  }
  value.slice(0, ARRAY_LIMITS[key]).forEach(callback);
  if (value.length > ARRAY_LIMITS[key]) {
    warnings.add('ARRAY_TRUNCATED', `${key} 超过 ${ARRAY_LIMITS[key]} 项，已截断。`);
  }
}

function createWarningCollector(initialWarnings = []) {
  const warnings = [];
  const seen = new Set();
  let partial = false;
  const add = (code, message, marksPartial = true) => {
    const safeCode = boundedString(code, 100);
    const safeMessage = boundedString(message, 5000);
    if (!safeCode || !safeMessage) return;
    const key = `${safeCode}:${safeMessage}`;
    if (seen.has(key) || warnings.length >= ARRAY_LIMITS.warnings) return;
    seen.add(key);
    warnings.push({ code: safeCode, message: safeMessage });
    partial = partial || marksPartial;
  };
  for (const warning of initialWarnings) add(warning?.code, warning?.message);
  return {
    add,
    isPartial: () => partial,
    values: () => warnings.map((warning) => ({ ...warning })),
  };
}

function isGrounded(provenance) {
  return provenance.evidence.length > 0 || provenance.citations.length > 0;
}

function normalizeIsoInstant(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  return Number.isNaN(Date.parse(trimmed)) ? null : new Date(trimmed).toISOString();
}

function normalizeConfidence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function normalizeProcessingTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function normalizeGeneratedAt(value) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function resolveSourceLanguage(sourceText, candidateLanguage) {
  const inferred = inferSourceLanguage(sourceText);
  if (!SOURCE_LANGUAGES.includes(candidateLanguage)) return inferred;
  if (candidateLanguage === 'unknown') return inferred;
  return candidateLanguage;
}

function inferSourceLanguage(sourceText) {
  const cjkCount = (sourceText.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latinCount = (sourceText.match(/[A-Za-z]/g) || []).length;
  if (cjkCount > 0 && latinCount > 0 && Math.min(cjkCount, latinCount) / Math.max(cjkCount, latinCount) > 0.2) {
    return 'mixed';
  }
  if (cjkCount > latinCount) return 'zh';
  if (latinCount > 0) return 'en';
  return 'unknown';
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : '';
}

function strictBoundedString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : '';
}

function countWords(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  return value.trim().split(/\s+/u).length;
}

function nullableBoundedString(value, maxLength) {
  const string = boundedString(value, maxLength);
  return string || null;
}

function assertSourceText(sourceText) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new Error('sourceText must be a non-empty string');
  }
}

module.exports = {
  createBaseBrief,
  createInvalidBrief,
  inferSourceLanguage,
  normalizeActionBriefCandidate,
};
