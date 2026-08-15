function normalizeSavedTermText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ');
}

const TERM_KIND_LABELS = Object.freeze({
  proper_noun: '名称 / 专有名词',
  abbreviation: '缩写',
  specialist_term: '专业术语',
  general_term: '普通词语',
  institution: '机构名称',
  course: '课程名称',
  policy: '政策名称',
  form: '表格',
  portal: '系统 / 入口',
  other: '其他词语',
});

const PROVENANCE_LABELS = Object.freeze({
  original: '原文明示',
  inference: '基于原文推断',
  pending: '待核验',
  official: '官方核验',
  unknown: '来源状态未知',
});

const MAX_SAVED_TERMS = 50;
const MAX_SAVED_TERM_CHARS = 200;
const MAX_SAVED_TERM_EXPLANATION_CHARS = 400;
const MAX_SAVED_TERM_EVIDENCE_CHARS = 180;

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasBoundedText(value, maximum, { required = false } = {}) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (required && !normalized) return false;
  return [...value].length <= maximum;
}

export function isCanonicalSavedTerm(term) {
  return isPlainRecord(term)
    && Number.isSafeInteger(term.id)
    && term.id > 0
    && typeof term.createdAt === 'string'
    && term.createdAt.trim().length > 0
    && Number.isFinite(Date.parse(term.createdAt))
    && hasBoundedText(term.term, MAX_SAVED_TERM_CHARS, { required: true })
    && hasBoundedText(term.explanation, MAX_SAVED_TERM_EXPLANATION_CHARS)
    && hasBoundedText(term.evidence, MAX_SAVED_TERM_EVIDENCE_CHARS)
    && Object.hasOwn(TERM_KIND_LABELS, term.termKind)
    && Object.hasOwn(PROVENANCE_LABELS, term.provenanceKind);
}

export function isCanonicalSavedTerms(terms) {
  if (!Array.isArray(terms) || terms.length > MAX_SAVED_TERMS) return false;
  const ids = new Set();
  const keys = new Set();
  for (const term of terms) {
    if (!isCanonicalSavedTerm(term)) return false;
    const key = savedTermKey(term);
    if (!key || ids.has(term.id) || keys.has(key)) return false;
    ids.add(term.id);
    keys.add(key);
  }
  return true;
}

export function normalizeSavedTermKind(value) {
  return Object.hasOwn(TERM_KIND_LABELS, value) ? value : 'other';
}

export function normalizeSavedTermProvenance(value) {
  return Object.hasOwn(PROVENANCE_LABELS, value) ? value : 'unknown';
}

export function getSavedTermMetadata(term) {
  const termKind = normalizeSavedTermKind(term?.termKind);
  const provenanceKind = normalizeSavedTermProvenance(term?.provenanceKind);
  const warning = provenanceKind === 'pending'
    ? '提醒：这个术语的解释仍待核验，请勿作为已确认事实使用。'
    : provenanceKind === 'unknown'
      ? '提醒：这个术语的来源状态未知，请返回原文或官方来源核对。'
      : '';
  return {
    termKind,
    termKindLabel: TERM_KIND_LABELS[termKind],
    provenanceKind,
    provenanceLabel: PROVENANCE_LABELS[provenanceKind],
    warning,
  };
}

export function savedTermKey(term) {
  return normalizeSavedTermText(typeof term === 'string' ? term : term?.term);
}

const SAVED_TERMS_IMPORT_SUMMARY_FIELDS = Object.freeze([
  'existingCount',
  'incomingCount',
  'newCount',
  'updatedCount',
  'unchangedCount',
  'capacitySkippedCount',
  'totalAfter',
  'invalidCount',
  'duplicateCount',
  'ignoredEvidenceCount',
  'downgradedProvenanceCount',
]);

export function isValidSavedTermsImportSummary(summary, expectedTotalAfter = null) {
  if (!isPlainRecord(summary)) return false;
  if (SAVED_TERMS_IMPORT_SUMMARY_FIELDS.some((field) => (
    !Number.isSafeInteger(summary[field]) || summary[field] < 0
  ))) return false;
  const rawTermCount = summary.incomingCount + summary.invalidCount + summary.duplicateCount;
  if (summary.existingCount > MAX_SAVED_TERMS
    || summary.totalAfter > MAX_SAVED_TERMS
    || rawTermCount > 500
    || summary.updatedCount + summary.unchangedCount > summary.existingCount
    || summary.newCount > MAX_SAVED_TERMS - summary.existingCount
    || summary.ignoredEvidenceCount > rawTermCount
    || summary.downgradedProvenanceCount > summary.incomingCount
    || (summary.capacitySkippedCount > 0 && summary.totalAfter !== MAX_SAVED_TERMS)) {
    return false;
  }
  if (expectedTotalAfter !== null && summary.totalAfter !== expectedTotalAfter) return false;
  return summary.totalAfter === summary.existingCount + summary.newCount
    && summary.incomingCount === summary.newCount
      + summary.updatedCount
      + summary.unchangedCount
      + summary.capacitySkippedCount;
}

const SAVED_TERM_IMPORT_PLAN_FIELDS = Object.freeze([
  'term',
  'explanation',
  'termKind',
  'provenanceKind',
]);
const SAVED_TERM_IMPORT_PRESERVED_FIELDS = Object.freeze([
  'id',
  'createdAt',
  'term',
  'evidence',
]);
const SAVED_TERM_IMPORT_MUTABLE_FIELDS = Object.freeze([
  'explanation',
  'termKind',
  'provenanceKind',
]);
const SAVED_TERM_IMPORT_PROVENANCE_KINDS = new Set(['unknown', 'pending']);

function normalizeSavedTermImportText(value) {
  return typeof value === 'string'
    ? [...value]
        .map((character) => {
          const code = character.codePointAt(0);
          return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

export function isCanonicalSavedTermsImportPlan(planTerms) {
  if (!Array.isArray(planTerms) || planTerms.length === 0 || planTerms.length > 500) return false;
  const keys = new Set();
  for (const term of planTerms) {
    if (!isPlainRecord(term)
      || Object.keys(term).length !== SAVED_TERM_IMPORT_PLAN_FIELDS.length
      || SAVED_TERM_IMPORT_PLAN_FIELDS.some((field) => !Object.hasOwn(term, field))
      || term.term !== normalizeSavedTermImportText(term.term)
      || term.explanation !== normalizeSavedTermImportText(term.explanation)
      || !hasBoundedText(term.term, MAX_SAVED_TERM_CHARS, { required: true })
      || !hasBoundedText(term.explanation, MAX_SAVED_TERM_EXPLANATION_CHARS)
      || !Object.hasOwn(TERM_KIND_LABELS, term.termKind)
      || !SAVED_TERM_IMPORT_PROVENANCE_KINDS.has(term.provenanceKind)) return false;
    const key = savedTermKey(term);
    if (!key || keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function importedPlanCanReplaceLocal(currentKind, importedKind) {
  return currentKind === 'unknown'
    || (currentKind === 'pending' && importedKind === 'pending');
}

function buildSavedTermsImportPlan(existingTerms, planTerms) {
  if (!isCanonicalSavedTerms(existingTerms)
    || !isCanonicalSavedTermsImportPlan(planTerms)) return null;

  const existingByKey = new Map(existingTerms.map((term) => [savedTermKey(term), term]));
  const expectedExistingByKey = new Map(existingByKey);
  const acceptedNewByKey = new Map();
  const acceptedNewKeys = [];
  const availableSlots = Math.max(0, MAX_SAVED_TERMS - existingTerms.length);
  let updatedCount = 0;
  let unchangedCount = 0;
  let newCount = 0;
  let capacitySkippedCount = 0;

  for (const incomingTerm of planTerms) {
    const key = savedTermKey(incomingTerm);
    const existingTerm = existingByKey.get(key);
    if (existingTerm) {
      if (!importedPlanCanReplaceLocal(existingTerm.provenanceKind, incomingTerm.provenanceKind)) {
        unchangedCount += 1;
        continue;
      }
      const nextTerm = {
        ...existingTerm,
        explanation: incomingTerm.explanation || existingTerm.explanation,
        termKind: incomingTerm.termKind,
        provenanceKind: incomingTerm.provenanceKind,
      };
      if (SAVED_TERM_IMPORT_MUTABLE_FIELDS.some((field) => (
        nextTerm[field] !== existingTerm[field]
      ))) {
        expectedExistingByKey.set(key, nextTerm);
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }
      continue;
    }
    if (newCount >= availableSlots) {
      capacitySkippedCount += 1;
      continue;
    }
    acceptedNewKeys.push(key);
    acceptedNewByKey.set(key, incomingTerm);
    newCount += 1;
  }

  return {
    acceptedNewByKey,
    expectedExistingByKey,
    expectedKeys: [
      ...acceptedNewKeys,
      ...existingTerms.map((term) => savedTermKey(term)),
    ],
    summary: {
      existingCount: existingTerms.length,
      incomingCount: planTerms.length,
      newCount,
      updatedCount,
      unchangedCount,
      capacitySkippedCount,
      totalAfter: existingTerms.length + newCount,
    },
  };
}

const SAVED_TERM_IMPORT_PLAN_SUMMARY_FIELDS = Object.freeze([
    'existingCount',
    'incomingCount',
    'newCount',
    'updatedCount',
    'unchangedCount',
    'capacitySkippedCount',
    'totalAfter',
]);

export function isSavedTermsImportPlanSummaryConsistent(existingTerms, planTerms, summary) {
  const plan = buildSavedTermsImportPlan(existingTerms, planTerms);
  return Boolean(plan && isPlainRecord(summary)
    && SAVED_TERM_IMPORT_PLAN_SUMMARY_FIELDS.every((field) => (
      summary[field] === plan.summary[field]
    )));
}

export function isSavedTermsImportCommitConsistent(
  existingTerms,
  planTerms,
  importedTerms,
  summary,
) {
  const plan = buildSavedTermsImportPlan(existingTerms, planTerms);
  if (!plan
    || !isCanonicalSavedTerms(importedTerms)
    || !isSavedTermsImportPlanSummaryConsistent(existingTerms, planTerms, summary)
    || importedTerms.length !== plan.expectedKeys.length) return false;

  return importedTerms.every((term, index) => {
    const key = savedTermKey(term);
    if (key !== plan.expectedKeys[index]) return false;
    const acceptedNewTerm = plan.acceptedNewByKey.get(key);
    if (acceptedNewTerm) {
      return term.evidence === ''
        && SAVED_TERM_IMPORT_PLAN_FIELDS.every((field) => (
          term[field] === acceptedNewTerm[field]
        ));
    }
    const expectedExistingTerm = plan.expectedExistingByKey.get(key);
    return Boolean(expectedExistingTerm
      && [...SAVED_TERM_IMPORT_PRESERVED_FIELDS, ...SAVED_TERM_IMPORT_MUTABLE_FIELDS]
        .every((field) => term[field] === expectedExistingTerm[field]));
  });
}

export function hasSavedTerm(terms, surface) {
  const key = normalizeSavedTermText(surface);
  return Boolean(key && (Array.isArray(terms) ? terms : []).some((term) => savedTermKey(term) === key));
}

export function filterSavedTerms(terms, query) {
  const list = Array.isArray(terms) ? terms : [];
  const tokens = normalizeSavedTermText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return list;
  return list.filter((term) => {
    const metadata = getSavedTermMetadata(term);
    const searchableText = normalizeSavedTermText([
      term?.term,
      term?.explanation ?? term?.definition,
      term?.evidence,
      metadata.termKindLabel,
      metadata.provenanceLabel,
    ].filter(Boolean).join(' '));
    return tokens.every((token) => searchableText.includes(token));
  });
}

export function getSavedTermCopyText(term, kind) {
  const surface = String(term?.term || '').trim();
  const explanation = String(term?.explanation ?? term?.definition ?? '').trim();
  const metadata = getSavedTermMetadata(term);
  if (kind === 'term' && !surface) return '';
  if (kind === 'explanation' && !explanation) return '';
  if (kind === 'combined' && (!surface || !explanation)) return '';
  const content = kind === 'term'
    ? [`术语：${surface}`]
    : kind === 'explanation'
      ? [`解释：${explanation}`]
      : kind === 'combined'
        ? [`术语：${surface}`, `解释：${explanation}`]
        : [];
  if (content.length === 0) return '';
  return [
    ...content,
    `类型：${metadata.termKindLabel}`,
    `可信度：${metadata.provenanceLabel}`,
    metadata.warning,
  ].filter(Boolean).join('\n');
}

export function upsertSavedTerm(terms, savedTerm) {
  if (!savedTerm || !savedTermKey(savedTerm)) return Array.isArray(terms) ? terms : [];
  const key = savedTermKey(savedTerm);
  return [
    savedTerm,
    ...(Array.isArray(terms) ? terms : []).filter((term) => (
      term?.id !== savedTerm.id && savedTermKey(term) !== key
    )),
  ].slice(0, MAX_SAVED_TERMS);
}
