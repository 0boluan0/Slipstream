const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
} = require('./constants');
const {
  DISCOVERY_METADATA_TRUST,
  GOV_UK_DISCOVERY_LIMIT,
  GOV_UK_SEARCH_ENDPOINT,
  GOV_UK_SEARCH_FIELDS,
  DiscoveryError,
  createGovUkDiscovery,
  discoverGovUkCandidates,
  normalizeGovUkPublisher,
  normalizeGovUkResultLink,
} = require('./discovery');
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
  DISCOVERY_METADATA_TRUST,
  GOV_UK_DISCOVERY_LIMIT,
  GOV_UK_SEARCH_ENDPOINT,
  GOV_UK_SEARCH_FIELDS,
  DiscoveryError,
  FetchConstraintError,
  MAX_CANDIDATE_URLS,
  MAX_QUERY_CHARS,
  UnsafeUrlError,
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  VerificationRequestError,
  createGovUkDiscovery,
  createVerificationRequest,
  createVerificationService,
  discoverGovUkCandidates,
  assessLexicalSupport,
  extractExcerpt,
  extractVisibleText,
  fetchPublicText,
  isConservativeOfficialHost,
  isPublicIpAddress,
  isTrustedOfficialUrl,
  normalizeVerificationPolicy,
  normalizeGovUkPublisher,
  normalizeGovUkResultLink,
  parseSafeHttpsUrl,
  resolvePublicAddresses,
  normalizeTrustedHosts,
  selectRelevantExcerpt,
  supportTokens,
  verifyOfficialSources,
};
