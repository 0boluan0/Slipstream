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

export const MAX_SAVED_TERMS = 50;
export const MAX_SAVED_TERM_CHARS = 200;
export const MAX_SAVED_TERM_EXPLANATION_CHARS = 400;
const MAX_SAVED_TERM_EVIDENCE_CHARS = 180;

export function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function hasBoundedText(value, maximum, { required = false } = {}) {
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

export function isSavedTermKind(value) {
  return Object.hasOwn(TERM_KIND_LABELS, value);
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
