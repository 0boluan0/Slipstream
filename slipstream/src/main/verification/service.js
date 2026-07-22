const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
} = require('./constants');
const { fetchPublicText } = require('./fetch-page');
const { createVerificationRequest } = require('./request');
const { assessLexicalSupport } = require('./support');
const { isTrustedOfficialUrl, normalizeTrustedHosts } = require('./trust');

function createResult({
  publisher,
  url = null,
  retrievedAt = null,
  excerpt = '',
  status,
  reason = null,
}) {
  return {
    publisher,
    url,
    retrievedAt,
    excerpt,
    status,
    ...(reason ? { reason } : {}),
  };
}

function placeholderResults(request, status) {
  const urls = request.candidateUrls.length ? request.candidateUrls : [null];
  return urls.map((url) => createResult({ publisher: request.publisher, url, status }));
}

function normalizeFailureReason(error) {
  if (error && typeof error.code === 'string') return error.code;
  return 'fetch-failed';
}

function normalizeAssessment(assessment) {
  if (assessment === true) return { supported: true };
  if (!assessment || typeof assessment !== 'object') return { supported: false };
  return {
    supported: assessment.supported === true,
    excerpt:
      typeof assessment.excerpt === 'string'
        ? assessment.excerpt.replace(/\s+/g, ' ').trim().slice(0, 600)
        : '',
  };
}

function createVerificationService({
  fetchPage = fetchPublicText,
  assessSupport = assessLexicalSupport,
  trustedHosts = [],
} = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (typeof assessSupport !== 'function') throw new TypeError('assessSupport must be a function');
  const normalizedTrustedHosts = normalizeTrustedHosts(trustedHosts);

  return {
    async verify(input = {}) {
      const policy = normalizeVerificationPolicy(input.policy);
      const request = createVerificationRequest(input);

      if (policy === VERIFICATION_POLICIES.LOCAL_ONLY) {
        return {
          policy,
          request,
          fetchAttempted: false,
          results: placeholderResults(request, VERIFICATION_STATUSES.LOCAL_ONLY),
        };
      }

      if (policy === VERIFICATION_POLICIES.ASK && input.approved !== true) {
        return {
          policy,
          request,
          fetchAttempted: false,
          results: placeholderResults(request, VERIFICATION_STATUSES.APPROVAL_REQUIRED),
        };
      }

      if (!request.candidateUrls.length) {
        return {
          policy,
          request,
          fetchAttempted: false,
          results: placeholderResults(request, VERIFICATION_STATUSES.NOT_VERIFIED),
        };
      }

      const results = [];
      for (const candidateUrl of request.candidateUrls) {
        try {
          const page = await fetchPage(candidateUrl, { query: request.query });
          const actuallyFetched =
            page?.fetched === true &&
            typeof page.url === 'string' &&
            typeof page.retrievedAt === 'string' &&
            typeof page.excerpt === 'string' &&
            page.excerpt.trim().length > 0;
          if (!actuallyFetched) {
            results.push(
              createResult({
                publisher: request.publisher,
                url: typeof page?.url === 'string' ? page.url : candidateUrl,
                retrievedAt: typeof page?.retrievedAt === 'string' ? page.retrievedAt : null,
                excerpt: typeof page?.excerpt === 'string' ? page.excerpt : '',
                status: VERIFICATION_STATUSES.NOT_VERIFIED,
                reason: 'empty-or-unconfirmed-response',
              })
            );
            continue;
          }

          const trustedOfficialHost = isTrustedOfficialUrl(page.url, normalizedTrustedHosts);
          let assessment = { supported: false };
          let assessmentFailed = false;
          if (request.query && trustedOfficialHost) {
            try {
              assessment = normalizeAssessment(
                await assessSupport({
                  query: request.query,
                  text: typeof page.supportText === 'string' ? page.supportText : page.excerpt,
                  excerpt: page.excerpt,
                  url: page.url,
                  publisher: request.publisher,
                })
              );
            } catch {
              assessmentFailed = true;
            }
          }
          const verified = Boolean(request.query && trustedOfficialHost && assessment.supported);
          const reason = verified
            ? null
            : !request.query
              ? 'missing-query'
              : !trustedOfficialHost
                ? 'untrusted-host'
                : assessmentFailed
                  ? 'support-assessment-failed'
                  : 'insufficient-support';
          const result = createResult({
            publisher: request.publisher,
            url: page.url,
            retrievedAt: page.retrievedAt,
            excerpt: assessment.excerpt || page.excerpt,
            status: verified ? VERIFICATION_STATUSES.VERIFIED : VERIFICATION_STATUSES.RETRIEVED,
            reason,
          });
          results.push(result);
          if (verified) break;
        } catch (error) {
          results.push(
            createResult({
              publisher: request.publisher,
              url: candidateUrl,
              status: VERIFICATION_STATUSES.NOT_VERIFIED,
              reason: normalizeFailureReason(error),
            })
          );
        }
      }

      return {
        policy,
        request,
        fetchAttempted: true,
        results,
      };
    },
  };
}

async function verifyOfficialSources(input, dependencies) {
  return createVerificationService(dependencies).verify(input);
}

module.exports = {
  createResult,
  createVerificationService,
  verifyOfficialSources,
};
