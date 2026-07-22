const ACTION_BRIEF_SCHEMA_VERSION = 'action-brief.v1';
const ACTION_BRIEF_CANDIDATE_VERSION = 'action-brief.candidate.v1';
const ACTION_BRIEF_PROMPT_VERSION = 'action-brief.prompt.v1';

const ACTION_BRIEF_STATUSES = Object.freeze([
  'complete',
  'partial',
  'translation_only',
  'invalid',
]);

// original: stated verbatim in the captured text.
// inference: an interpretation anchored to captured-text evidence.
// official: supported by an official source supplied and verified by the caller.
// pending: not sufficiently supported yet; downstream UI must not present it as verified.
const PROVENANCE_KINDS = Object.freeze(['original', 'inference', 'official', 'pending']);

const TERM_KINDS = Object.freeze([
  'proper_noun',
  'abbreviation',
  'specialist_term',
  'general_term',
  'institution',
  'course',
  'policy',
  'form',
  'portal',
  'other',
]);

const CONTEXT_KINDS = Object.freeze([
  'cultural',
  'social_process',
  'institutional_process',
]);

const MATERIAL_REQUIREMENTS = Object.freeze([
  'required',
  'conditional',
  'recommended',
  'unknown',
]);

const STEP_ACTORS = Object.freeze(['user', 'institution', 'other', 'unknown']);
const STEP_URGENCIES = Object.freeze(['now', 'before_deadline', 'when_triggered', 'unknown']);
const VERIFICATION_STATUSES = Object.freeze(['pending', 'verified', 'failed', 'not_needed']);
const SOURCE_LANGUAGES = Object.freeze(['en', 'zh', 'mixed', 'unknown']);
const TARGET_LANGUAGES = Object.freeze(['zh', 'en']);
const EVIDENCE_MATCH_KINDS = Object.freeze(['exact', 'whitespace_normalized']);

function createEmptyActionBrief({
  status = 'invalid',
  sourceId = null,
  sourceSha256 = null,
  sourceLength = 0,
  sourceLanguage = 'unknown',
  targetLanguage = 'zh',
  responseKind = 'structured',
  provider = null,
  model = null,
  processingTimeMs = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    schemaVersion: ACTION_BRIEF_SCHEMA_VERSION,
    status,
    source: {
      id: sourceId,
      sha256: sourceSha256,
      length: sourceLength,
      offsetUnit: 'utf16',
      language: SOURCE_LANGUAGES.includes(sourceLanguage) ? sourceLanguage : 'unknown',
    },
    targetLanguage: TARGET_LANGUAGES.includes(targetLanguage) ? targetLanguage : 'zh',
    translation: null,
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    warnings: [],
    analysisProvenance: {
      responseKind,
      provider,
      model,
      processingTimeMs,
      promptVersion: ACTION_BRIEF_PROMPT_VERSION,
      generatedAt,
    },
  };
}

function validateActionBrief(brief, { sourceText } = {}) {
  const errors = [];
  if (!isPlainObject(brief)) return { valid: false, errors: ['brief must be an object'] };

  expectEqual(errors, brief.schemaVersion, ACTION_BRIEF_SCHEMA_VERSION, 'schemaVersion');
  expectEnum(errors, brief.status, ACTION_BRIEF_STATUSES, 'status');
  validateSource(errors, brief.source, sourceText);
  expectEnum(errors, brief.targetLanguage, TARGET_LANGUAGES, 'targetLanguage');
  validateContentBlock(errors, brief.translation, 'translation', sourceText, true);
  validateContentBlock(errors, brief.explanation, 'explanation', sourceText, true);

  validateArray(errors, brief.terms, 'terms', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.surface, `${path}.surface`);
    expectEnum(errors, item?.kind, TERM_KINDS, `${path}.kind`);
    expectNonEmptyString(errors, item?.explanation, `${path}.explanation`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
  });

  validateArray(errors, brief.contexts, 'contexts', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.label, `${path}.label`);
    expectEnum(errors, item?.kind, CONTEXT_KINDS, `${path}.kind`);
    expectNonEmptyString(errors, item?.explanation, `${path}.explanation`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
  });

  validateArray(errors, brief.deadlines, 'deadlines', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.whenText, `${path}.whenText`);
    expectNullableString(errors, item?.normalizedAt, `${path}.normalizedAt`);
    expectNullableString(errors, item?.timezone, `${path}.timezone`);
    expectNullableString(errors, item?.condition, `${path}.condition`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
  });

  validateArray(errors, brief.materials, 'materials', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.name, `${path}.name`);
    expectEnum(errors, item?.requirement, MATERIAL_REQUIREMENTS, `${path}.requirement`);
    expectNullableString(errors, item?.details, `${path}.details`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
  });

  validateArray(errors, brief.nextSteps, 'nextSteps', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.action, `${path}.action`);
    expectEnum(errors, item?.actor, STEP_ACTORS, `${path}.actor`);
    expectEnum(errors, item?.urgency, STEP_URGENCIES, `${path}.urgency`);
    if (![true, false, null].includes(item?.mandatory)) {
      errors.push(`${path}.mandatory must be true, false, or null`);
    }
    expectNullableString(errors, item?.deadlineId, `${path}.deadlineId`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
  });

  validateArray(errors, brief.verifications, 'verifications', (item, path) => {
    expectNonEmptyString(errors, item?.id, `${path}.id`);
    expectNonEmptyString(errors, item?.claim, `${path}.claim`);
    expectNonEmptyString(errors, item?.reason, `${path}.reason`);
    expectEnum(errors, item?.status, VERIFICATION_STATUSES, `${path}.status`);
    validateVerificationLookup(errors, item?.lookup, `${path}.lookup`);
    validateProvenance(errors, item?.provenance, `${path}.provenance`, sourceText);
    if (item?.status === 'verified' && item?.provenance?.kind !== 'official') {
      errors.push(`${path} can be verified only with official provenance`);
    }
    if (item?.lookup !== null && (
      !['pending', 'failed'].includes(item?.status) ||
      item?.provenance?.kind !== 'pending'
    )) {
      errors.push(`${path}.lookup is an untrusted retrieval plan and requires pending provenance with pending or failed status`);
    }
  });

  validateArray(errors, brief.warnings, 'warnings', (item, path) => {
    expectNonEmptyString(errors, item?.code, `${path}.code`);
    expectNonEmptyString(errors, item?.message, `${path}.message`);
  });

  if (!isPlainObject(brief.analysisProvenance)) {
    errors.push('analysisProvenance must be an object');
  } else {
    expectNonEmptyString(errors, brief.analysisProvenance.responseKind, 'analysisProvenance.responseKind');
    expectNullableString(errors, brief.analysisProvenance.provider, 'analysisProvenance.provider');
    expectNullableString(errors, brief.analysisProvenance.model, 'analysisProvenance.model');
    if (brief.analysisProvenance.processingTimeMs !== null && (
      typeof brief.analysisProvenance.processingTimeMs !== 'number' ||
      !Number.isFinite(brief.analysisProvenance.processingTimeMs) ||
      brief.analysisProvenance.processingTimeMs < 0
    )) {
      errors.push('analysisProvenance.processingTimeMs must be a non-negative number or null');
    }
    expectEqual(
      errors,
      brief.analysisProvenance.promptVersion,
      ACTION_BRIEF_PROMPT_VERSION,
      'analysisProvenance.promptVersion',
    );
    expectIsoDate(errors, brief.analysisProvenance.generatedAt, 'analysisProvenance.generatedAt');
  }

  if (brief.status === 'complete' && hasPendingProvenance(brief)) {
    errors.push('complete brief cannot contain pending provenance');
  }
  if (brief.status === 'translation_only' && hasStructuredItems(brief)) {
    errors.push('translation_only brief cannot contain structured action items');
  }
  if (brief.status === 'invalid' && (brief.translation || brief.explanation || hasStructuredItems(brief))) {
    errors.push('invalid brief cannot contain analysis content');
  }

  return { valid: errors.length === 0, errors };
}

function assertActionBrief(brief, options) {
  const result = validateActionBrief(brief, options);
  if (!result.valid) {
    throw new Error(`Invalid ${ACTION_BRIEF_SCHEMA_VERSION}: ${result.errors.join('; ')}`);
  }
  return brief;
}

function validateSource(errors, source, sourceText) {
  if (!isPlainObject(source)) {
    errors.push('source must be an object');
    return;
  }
  expectNullableString(errors, source.id, 'source.id');
  if (source.sha256 !== null && !/^[a-f0-9]{64}$/.test(source.sha256 || '')) {
    errors.push('source.sha256 must be a lowercase SHA-256 hex string or null');
  }
  if (!Number.isSafeInteger(source.length) || source.length < 0) {
    errors.push('source.length must be a non-negative safe integer');
  }
  expectEqual(errors, source.offsetUnit, 'utf16', 'source.offsetUnit');
  expectEnum(errors, source.language, SOURCE_LANGUAGES, 'source.language');
  if (typeof sourceText === 'string' && source.length !== sourceText.length) {
    errors.push('source.length does not match sourceText.length');
  }
}

function validateContentBlock(errors, block, path, sourceText, nullable = false) {
  if (block === null && nullable) return;
  if (!isPlainObject(block)) {
    errors.push(`${path} must be an object${nullable ? ' or null' : ''}`);
    return;
  }
  expectNonEmptyString(errors, block.text, `${path}.text`);
  validateProvenance(errors, block.provenance, `${path}.provenance`, sourceText);
}

function validateProvenance(errors, provenance, path, sourceText) {
  if (!isPlainObject(provenance)) {
    errors.push(`${path} must be an object`);
    return;
  }
  expectEnum(errors, provenance.kind, PROVENANCE_KINDS, `${path}.kind`);
  if (provenance.confidence !== null && (
    typeof provenance.confidence !== 'number' ||
    !Number.isFinite(provenance.confidence) ||
    provenance.confidence < 0 ||
    provenance.confidence > 1
  )) {
    errors.push(`${path}.confidence must be between 0 and 1 or null`);
  }
  expectNullableString(errors, provenance.note, `${path}.note`);
  validateArray(errors, provenance.evidence, `${path}.evidence`, (evidence, evidencePath) => {
    expectNonEmptyString(errors, evidence?.quote, `${evidencePath}.quote`);
    if (!Number.isSafeInteger(evidence?.start) || evidence.start < 0) {
      errors.push(`${evidencePath}.start must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(evidence?.end) || evidence.end <= evidence?.start) {
      errors.push(`${evidencePath}.end must be greater than start`);
    }
    expectEnum(errors, evidence?.match, EVIDENCE_MATCH_KINDS, `${evidencePath}.match`);
    if (typeof evidence?.ambiguous !== 'boolean') {
      errors.push(`${evidencePath}.ambiguous must be a boolean`);
    }
    if (typeof sourceText === 'string' && Number.isSafeInteger(evidence?.start) && Number.isSafeInteger(evidence?.end)) {
      if (sourceText.slice(evidence.start, evidence.end) !== evidence.quote) {
        errors.push(`${evidencePath} quote does not match sourceText offsets`);
      }
    }
  });
  validateArray(errors, provenance.citations, `${path}.citations`, (citation, citationPath) => {
    expectNonEmptyString(errors, citation?.id, `${citationPath}.id`);
    expectHttpsUrl(errors, citation?.url, `${citationPath}.url`);
    expectNonEmptyString(errors, citation?.title, `${citationPath}.title`);
    expectNonEmptyString(errors, citation?.publisher, `${citationPath}.publisher`);
    expectIsoDate(errors, citation?.retrievedAt, `${citationPath}.retrievedAt`);
    expectNullableString(errors, citation?.quote, `${citationPath}.quote`);
    if (citation?.official !== true) errors.push(`${citationPath}.official must be true`);
  });

  if (provenance.kind === 'original' && provenance.evidence?.length === 0) {
    errors.push(`${path} with original provenance requires source evidence`);
  }
  if (provenance.kind === 'official' && provenance.citations?.length === 0) {
    errors.push(`${path} with official provenance requires an official citation`);
  }
  if (provenance.kind !== 'official' && provenance.citations?.length > 0) {
    errors.push(`${path} citations require official provenance`);
  }
}

function validateVerificationLookup(errors, lookup, path) {
  if (lookup === null) return;
  if (!isPlainObject(lookup)) {
    errors.push(`${path} must be an object or null`);
    return;
  }

  expectBoundedNonEmptyString(errors, lookup.publisher, 120, `${path}.publisher`);
  expectBoundedNonEmptyString(errors, lookup.query, 120, `${path}.query`);
  if (typeof lookup.query === 'string' && countWords(lookup.query) > 16) {
    errors.push(`${path}.query must contain at most 16 words`);
  }
  if (!Array.isArray(lookup.candidateUrls)) {
    errors.push(`${path}.candidateUrls must be an array`);
    return;
  }
  if (lookup.candidateUrls.length > 3) {
    errors.push(`${path}.candidateUrls must contain at most 3 URLs`);
  }
  lookup.candidateUrls.forEach((url, index) => {
    if (!isSafeLookupUrl(url)) {
      errors.push(`${path}.candidateUrls[${index}] must be HTTPS without credentials or a non-default port`);
    }
  });
}

function validateArray(errors, value, path, validateItem) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => validateItem(item, `${path}[${index}]`));
}

function hasStructuredItems(brief) {
  return ['terms', 'contexts', 'deadlines', 'materials', 'nextSteps', 'verifications']
    .some((key) => Array.isArray(brief[key]) && brief[key].length > 0);
}

function hasPendingProvenance(brief) {
  const values = [brief.translation, brief.explanation]
    .concat(brief.terms || [], brief.contexts || [], brief.deadlines || [], brief.materials || [], brief.nextSteps || [], brief.verifications || []);
  return values.some((item) => item?.provenance?.kind === 'pending');
}

function expectEqual(errors, value, expected, path) {
  if (value !== expected) errors.push(`${path} must equal ${JSON.stringify(expected)}`);
}

function expectEnum(errors, value, allowed, path) {
  if (!allowed.includes(value)) errors.push(`${path} must be one of: ${allowed.join(', ')}`);
}

function expectNonEmptyString(errors, value, path) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${path} must be a non-empty string`);
}

function expectBoundedNonEmptyString(errors, value, maxLength, path) {
  expectNonEmptyString(errors, value, path);
  if (typeof value === 'string' && value.length > maxLength) {
    errors.push(`${path} must contain at most ${maxLength} characters`);
  }
}

function expectNullableString(errors, value, path) {
  if (value !== null && typeof value !== 'string') errors.push(`${path} must be a string or null`);
}

function expectIsoDate(errors, value, path) {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO date string`);
  }
}

function expectHttpsUrl(errors, value, path) {
  try {
    if (new URL(value).protocol !== 'https:') errors.push(`${path} must use HTTPS`);
  } catch {
    errors.push(`${path} must be a valid HTTPS URL`);
  }
}

function countWords(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  return value.trim().split(/\s+/u).length;
}

function isSafeLookupUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = {
  ACTION_BRIEF_CANDIDATE_VERSION,
  ACTION_BRIEF_PROMPT_VERSION,
  ACTION_BRIEF_SCHEMA_VERSION,
  ACTION_BRIEF_STATUSES,
  CONTEXT_KINDS,
  EVIDENCE_MATCH_KINDS,
  MATERIAL_REQUIREMENTS,
  PROVENANCE_KINDS,
  SOURCE_LANGUAGES,
  STEP_ACTORS,
  STEP_URGENCIES,
  TARGET_LANGUAGES,
  TERM_KINDS,
  VERIFICATION_STATUSES,
  assertActionBrief,
  createEmptyActionBrief,
  isPlainObject,
  isSafeLookupUrl,
  validateActionBrief,
};
