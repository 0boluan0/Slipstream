const MAX_PUBLISHER_CHARS = 120;
const MAX_QUERY_CHARS = 120;
const MAX_QUERY_WORDS = 16;
const MAX_CANDIDATE_URLS = 3;
const MAX_URL_CHARS = 2048;
const MAX_QUERY_PARAMETERS = 8;
const MAX_URL_QUERY_CHARS = 256;
const MAX_URL_QUERY_VALUE_CHARS = 120;

const RAW_TEXT_FIELDS = new Set([
  'body',
  'content',
  'email',
  'fullText',
  'message',
  'originalText',
  'rawText',
  'sourceText',
]);

class VerificationRequestError extends Error {
  constructor(message, code = 'invalid-verification-request') {
    super(message);
    this.name = 'VerificationRequestError';
    this.code = code;
  }
}

function rejectRawTextFields(input) {
  for (const field of RAW_TEXT_FIELDS) {
    if (Object.hasOwn(input, field) && input[field] != null && input[field] !== '') {
      throw new VerificationRequestError(
        'Raw source field "' + field + '" is not accepted; pass only a minimal query and candidate official URLs',
        'raw-text-rejected'
      );
    }
  }
}

function normalizeSingleLine(value, field, maxChars, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new VerificationRequestError(field + ' is required');
    return '';
  }
  if (typeof value !== 'string') throw new VerificationRequestError(field + ' must be a string');
  if (/[\r\n]/.test(value)) throw new VerificationRequestError(field + ' must be a single line');

  const normalized = [...value]
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized && required) throw new VerificationRequestError(field + ' is required');
  if (normalized.length > maxChars) {
    throw new VerificationRequestError(field + ' exceeds the privacy limit of ' + maxChars + ' characters');
  }
  return normalized;
}

function normalizeMinimalQuery(value) {
  const query = normalizeSingleLine(value, 'query', MAX_QUERY_CHARS);
  if (!query) return '';
  if (query.split(/\s+/).length > MAX_QUERY_WORDS) {
    throw new VerificationRequestError('query exceeds the privacy limit of ' + MAX_QUERY_WORDS + ' words');
  }
  if (/(^|\s)(from|to|cc|bcc|subject):/i.test(query)) {
    throw new VerificationRequestError('query looks like message content, not a minimal lookup', 'raw-text-rejected');
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(query) ||
    /\b(?:\+?\d[\d ()-]{7,}\d)\b/.test(query) ||
    /\b(?=[A-Z0-9]{7,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/i.test(query)
  ) {
    throw new VerificationRequestError('query contains a likely personal identifier', 'personal-data-rejected');
  }
  return query;
}

function normalizeCandidateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VerificationRequestError('candidate URL must be a non-empty string');
  }
  if (value.length > MAX_URL_CHARS) throw new VerificationRequestError('candidate URL is too long');

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new VerificationRequestError('candidate URL is invalid');
  }
  if (url.protocol !== 'https:') throw new VerificationRequestError('candidate URL must use HTTPS', 'unsafe-url');
  if (url.username || url.password) {
    throw new VerificationRequestError('candidate URL must not contain credentials', 'unsafe-url');
  }
  if (url.port && url.port !== '443') {
    throw new VerificationRequestError('candidate URL must use the default HTTPS port', 'unsafe-url');
  }
  if ([...url.searchParams].length > MAX_QUERY_PARAMETERS || url.search.length > MAX_URL_QUERY_CHARS) {
    throw new VerificationRequestError('candidate URL query exceeds the privacy limit');
  }
  for (const [, parameterValue] of url.searchParams) {
    if (parameterValue.length > MAX_URL_QUERY_VALUE_CHARS || /[\r\n]/.test(parameterValue)) {
      throw new VerificationRequestError('candidate URL contains an oversized query value');
    }
  }

  url.hash = '';
  return url.href;
}

function createVerificationRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VerificationRequestError('verification request must be an object');
  }
  rejectRawTextFields(input);

  const publisher = normalizeSingleLine(input.publisher, 'publisher', MAX_PUBLISHER_CHARS, { required: true });
  const query = normalizeMinimalQuery(input.query);
  const rawUrls = input.candidateUrls ?? input.officialUrls ?? [];
  if (!Array.isArray(rawUrls)) throw new VerificationRequestError('candidateUrls must be an array');
  if (rawUrls.length > MAX_CANDIDATE_URLS) {
    throw new VerificationRequestError('at most ' + MAX_CANDIDATE_URLS + ' candidate URLs are allowed');
  }

  const candidateUrls = [...new Set(rawUrls.map(normalizeCandidateUrl))];
  return Object.freeze({
    publisher,
    query,
    candidateUrls: Object.freeze(candidateUrls),
  });
}

module.exports = {
  MAX_CANDIDATE_URLS,
  MAX_QUERY_CHARS,
  VerificationRequestError,
  createVerificationRequest,
  normalizeCandidateUrl,
  rejectRawTextFields,
};
