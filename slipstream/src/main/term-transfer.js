const TERM_BACKUP_FORMAT = 'slipstream-terms';
const TERM_BACKUP_VERSION = 2;
const SUPPORTED_TERM_BACKUP_VERSIONS = new Set([1, TERM_BACKUP_VERSION]);
const MAX_BACKUP_TERMS = 500;
const MAX_TERM_CHARS = 200;
const MAX_EXPLANATION_CHARS = 400;
const TERM_KINDS = new Set([
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
const PROVENANCE_KINDS = new Set(['original', 'inference', 'pending', 'official', 'unknown']);
const EVIDENCE_BOUND_PROVENANCE_KINDS = new Set(['original', 'inference', 'official']);
const PROVENANCE_TRUST_RANK = Object.freeze({
  unknown: 0,
  pending: 1,
  inference: 2,
  original: 3,
  official: 4,
});

class TermTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TermTransferError';
    this.code = code;
  }
}

function normalizeText(value) {
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

function portableTermKey(value) {
  return normalizeText(typeof value === 'string' ? value : value?.term)
    .normalize('NFKC')
    .toLocaleLowerCase();
}

function normalizeTermKind(value) {
  return typeof value === 'string' && TERM_KINDS.has(value) ? value : 'other';
}

function normalizeProvenanceKind(value) {
  return typeof value === 'string' && PROVENANCE_KINDS.has(value) ? value : 'unknown';
}

function sanitizePortableTerm(value, version = TERM_BACKUP_VERSION, { importing = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const term = normalizeText(value.term);
  const explanation = normalizeText(value.explanation ?? value.definition);
  if (!term || term.length > MAX_TERM_CHARS || explanation.length > MAX_EXPLANATION_CHARS) return null;
  const normalizedProvenanceKind = version === 1
    ? 'unknown'
    : normalizeProvenanceKind(value.provenanceKind);
  return {
    term,
    explanation,
    termKind: version === 1 ? 'other' : normalizeTermKind(value.termKind),
    // Portable backups intentionally contain neither the original evidence nor
    // an official retrieval receipt. Keep the label in an export for
    // transparency, but never recreate any evidence-bound trust on import.
    provenanceKind: importing && EVIDENCE_BOUND_PROVENANCE_KINDS.has(normalizedProvenanceKind)
      ? 'unknown'
      : normalizedProvenanceKind,
  };
}

function importedTrustCanReplaceLocal(currentKind, importedKind) {
  return PROVENANCE_TRUST_RANK[importedKind] >= PROVENANCE_TRUST_RANK[currentKind];
}

function createTermBackup(terms, exportedAt = new Date().toISOString()) {
  const seen = new Set();
  const portableTerms = [];
  for (const value of Array.isArray(terms) ? terms : []) {
    const term = sanitizePortableTerm(value, TERM_BACKUP_VERSION);
    const key = portableTermKey(term);
    if (!term || !key || seen.has(key)) continue;
    seen.add(key);
    portableTerms.push(term);
  }
  return {
    format: TERM_BACKUP_FORMAT,
    version: TERM_BACKUP_VERSION,
    exportedAt,
    privacy: {
      includesEvidence: false,
      includesSettings: false,
      includesCredentials: false,
    },
    terms: portableTerms,
  };
}

function serializeTermBackup(terms, exportedAt) {
  return `${JSON.stringify(createTermBackup(terms, exportedAt), null, 2)}\n`;
}

function parseTermBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TermTransferError('invalid-json', '备份文件不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TermTransferError('invalid-format', '备份文件结构无效');
  }
  if (parsed.format !== TERM_BACKUP_FORMAT || !SUPPORTED_TERM_BACKUP_VERSIONS.has(parsed.version)) {
    throw new TermTransferError('unsupported-format', '备份格式或版本不受支持');
  }
  if (!Array.isArray(parsed.terms) || parsed.terms.length > MAX_BACKUP_TERMS) {
    throw new TermTransferError('invalid-terms', '备份中的术语列表无效或过长');
  }

  const seen = new Set();
  const terms = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let ignoredEvidenceCount = 0;
  let downgradedProvenanceCount = 0;
  for (const value of parsed.terms) {
    if (normalizeText(value?.evidence) || normalizeText(value?.sourceText)) ignoredEvidenceCount += 1;
    const provenanceWillBeDowngraded = (
      parsed.version === TERM_BACKUP_VERSION
      && EVIDENCE_BOUND_PROVENANCE_KINDS.has(normalizeProvenanceKind(value?.provenanceKind))
    );
    const term = sanitizePortableTerm(value, parsed.version, { importing: true });
    const key = portableTermKey(term);
    if (!term || !key) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    if (provenanceWillBeDowngraded) downgradedProvenanceCount += 1;
    terms.push(term);
  }

  return {
    terms,
    invalidCount,
    duplicateCount,
    ignoredEvidenceCount,
    downgradedProvenanceCount,
  };
}

function mergePortableTerms(existingTerms, importedTerms, options = {}) {
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 50;
  const now = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const existing = Array.isArray(existingTerms) ? existingTerms.slice(0, limit) : [];
  const existingByKey = new Map();
  existing.forEach((term, index) => {
    const key = portableTermKey(term);
    if (key && !existingByKey.has(key)) existingByKey.set(key, { index, term });
  });

  const importedSeen = new Set();
  const incoming = [];
  for (const value of Array.isArray(importedTerms) ? importedTerms : []) {
    const term = sanitizePortableTerm(value, TERM_BACKUP_VERSION, { importing: true });
    const key = portableTermKey(term);
    if (!term || !key || importedSeen.has(key)) continue;
    importedSeen.add(key);
    incoming.push({ key, term });
  }

  const updatedByIndex = new Map();
  const acceptedNew = [];
  const availableSlots = Math.max(0, limit - existing.length);
  let updatedCount = 0;
  let unchangedCount = 0;
  let capacitySkippedCount = 0;
  let nextGeneratedId = Date.now();
  const usedIds = new Set(existing.map((term) => term?.id));
  const allocateId = (index) => {
    if (typeof options.idFactory === 'function') return options.idFactory(index);
    while (usedIds.has(nextGeneratedId)) nextGeneratedId += 1;
    const id = nextGeneratedId;
    usedIds.add(id);
    nextGeneratedId += 1;
    return id;
  };

  for (const { key, term } of incoming) {
    const match = existingByKey.get(key);
    if (match) {
      const currentExplanation = normalizeText(match.term?.explanation ?? match.term?.definition);
      const nextExplanation = term.explanation || currentExplanation;
      const currentTermKind = normalizeTermKind(match.term?.termKind);
      const currentProvenanceKind = normalizeProvenanceKind(match.term?.provenanceKind);
      if (!importedTrustCanReplaceLocal(currentProvenanceKind, term.provenanceKind)) {
        unchangedCount += 1;
        continue;
      }
      if (nextExplanation !== currentExplanation
        || term.termKind !== currentTermKind
        || term.provenanceKind !== currentProvenanceKind) {
        updatedByIndex.set(match.index, {
          ...match.term,
          explanation: nextExplanation,
          termKind: term.termKind,
          provenanceKind: term.provenanceKind,
        });
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }
      continue;
    }
    if (acceptedNew.length >= availableSlots) {
      capacitySkippedCount += 1;
      continue;
    }
    acceptedNew.push({
      id: allocateId(acceptedNew.length),
      createdAt: now,
      term: term.term,
      explanation: term.explanation,
      termKind: term.termKind,
      provenanceKind: term.provenanceKind,
      evidence: '',
    });
  }

  const mergedExisting = existing.map((term, index) => updatedByIndex.get(index) || term);
  const terms = [...acceptedNew, ...mergedExisting];
  return {
    terms,
    summary: {
      existingCount: existing.length,
      incomingCount: incoming.length,
      newCount: acceptedNew.length,
      updatedCount,
      unchangedCount,
      capacitySkippedCount,
      totalAfter: terms.length,
    },
  };
}

module.exports = {
  TERM_BACKUP_FORMAT,
  TERM_BACKUP_VERSION,
  TermTransferError,
  createTermBackup,
  serializeTermBackup,
  parseTermBackup,
  mergePortableTerms,
  portableTermKey,
};
