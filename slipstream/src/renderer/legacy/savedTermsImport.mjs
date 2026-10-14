// Frozen action-workspace term import/export validation. It ships inside the
// lazily loaded SavedTermsLibrary chunk (re-exported there), so the renderer
// entry does not carry it; useSavedTermsWorkspace loads it on first use.
import {
  MAX_SAVED_TERMS,
  MAX_SAVED_TERM_CHARS,
  MAX_SAVED_TERM_EXPLANATION_CHARS,
  hasBoundedText,
  isCanonicalSavedTerms,
  isPlainRecord,
  isSavedTermKind,
  savedTermKey,
} from '../utils/savedTerms.mjs';

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
      || !isSavedTermKind(term.termKind)
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

export const SAVED_TERMS_CONFIRMED_IMPORT_NOOP_CODES = new Set(['preview-expired']);
export const SAVED_TERMS_IMPORT_PREVIEW_FAILURE_CODES = new Set([
  'file-too-large',
  'no-usable-terms',
  'read-failed',
  'invalid-json',
  'invalid-format',
  'unsupported-format',
  'invalid-terms',
  'preview-expired',
]);

function hasValidSavedTermsImportFileName(response) {
  return typeof response?.fileName === 'string'
    && response.fileName.trim().length > 0
    && response.fileName.length <= 255;
}

export function isValidSavedTermsImportPreview(response, existingTerms) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  if (response.status !== 'ready') return false;
  if (typeof response.previewId !== 'string'
    || response.previewId.length === 0
    || response.previewId.length > 100) return false;
  if (!hasValidSavedTermsImportFileName(response)) return false;
  if (!Array.isArray(response.examples)
    || response.examples.length > 5
    || response.examples.some((term) => (
      typeof term !== 'string' || !term.trim() || term.length > 200
    ))) return false;
  return isValidSavedTermsImportSummary(response.summary)
    && isSavedTermsImportPlanSummaryConsistent(
      existingTerms,
      response.planTerms,
      response.summary,
    )
    && response.examples.length === Math.min(5, response.planTerms.length)
    && response.examples.every((term, index) => term === response.planTerms[index].term);
}

export function isValidSavedTermsImportCommit(response, existingTerms, preview) {
  return Boolean(
    response
    && typeof response === 'object'
    && !Array.isArray(response)
    && response.status === 'imported'
    && hasValidSavedTermsImportFileName(response)
    && isCanonicalSavedTerms(response.savedTerms)
    && isValidSavedTermsImportSummary(response.summary, response.savedTerms.length)
    && preview?.previewId
    && response.fileName === preview.fileName
    && SAVED_TERMS_IMPORT_SUMMARY_FIELDS.every((field) => (
      response.summary[field] === preview.summary?.[field]
    ))
    && isSavedTermsImportCommitConsistent(
      existingTerms,
      preview.planTerms,
      response.savedTerms,
      response.summary,
    )
  );
}
