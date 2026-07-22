const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
} = require('./constants');
const {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  FetchConstraintError,
  extractExcerpt,
  extractVisibleText,
  fetchPublicText,
} = require('./fetch-page');
const {
  MAX_CANDIDATE_URLS,
  MAX_QUERY_CHARS,
  VerificationRequestError,
  createVerificationRequest,
} = require('./request');
const { createVerificationService, verifyOfficialSources } = require('./service');
const { assessLexicalSupport, selectRelevantExcerpt, supportTokens } = require('./support');
const {
  CONSERVATIVE_OFFICIAL_SUFFIXES,
  isConservativeOfficialHost,
  isTrustedOfficialUrl,
  normalizeTrustedHosts,
} = require('./trust');
const {
  UnsafeUrlError,
  isPublicIpAddress,
  parseSafeHttpsUrl,
  resolvePublicAddresses,
} = require('./url-safety');

module.exports = {
  ALLOWED_MIME_TYPES,
  CONSERVATIVE_OFFICIAL_SUFFIXES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  FetchConstraintError,
  MAX_CANDIDATE_URLS,
  MAX_QUERY_CHARS,
  UnsafeUrlError,
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  VerificationRequestError,
  createVerificationRequest,
  createVerificationService,
  assessLexicalSupport,
  extractExcerpt,
  extractVisibleText,
  fetchPublicText,
  isConservativeOfficialHost,
  isPublicIpAddress,
  isTrustedOfficialUrl,
  normalizeVerificationPolicy,
  parseSafeHttpsUrl,
  resolvePublicAddresses,
  normalizeTrustedHosts,
  selectRelevantExcerpt,
  supportTokens,
  verifyOfficialSources,
};
