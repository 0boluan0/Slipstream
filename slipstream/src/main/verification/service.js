const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
} = require('./constants');
const { createGovUkDiscovery, normalizeGovUkPublisher } = require('./discovery');
const { fetchPublicText } = require('./fetch-page');
const { MAX_CANDIDATE_URLS, createVerificationRequest } = require('./request');
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

function unavailableResults(request, reason) {
  const urls = request.candidateUrls.length ? request.candidateUrls : [null];
  return urls.map((url) =>
    createResult({
      publisher: request.publisher,
      url,
      status: VERIFICATION_STATUSES.NOT_VERIFIED,
      reason,
    })
  );
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

function abortedError() {
  const error = new Error('official source verification was cancelled');
  error.name = 'AbortError';
  error.code = 'aborted';
  return error;
}

function isAborted(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.code === 'aborted' ||
    error?.code === 'ABORT_ERR' ||
    error?.name === 'AbortError'
  );
}

function awaitWithAbort(value, signal) {
  const promise = Promise.resolve(value);
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener?.('abort', onAbort);
      callback(result);
    };
    const onAbort = () => finish(reject, abortedError());

    promise.then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error)
    );
    signal.addEventListener?.('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function normalizeDiscoveredGovUkUrls(value) {
  if (!Array.isArray(value)) return [];

  const urls = [];
  const seen = new Set();
  for (const candidate of value) {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.gov.uk' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      continue;
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    urls.push(url.href);
    if (urls.length === MAX_CANDIDATE_URLS) break;
  }
  return urls;
}

function publisherForFetchedUrl(value, fallback) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'gov.uk' || hostname.endsWith('.gov.uk')) return 'GOV.UK';
    return hostname || fallback;
  } catch {
    return fallback;
  }
}

function createVerificationService({
  fetchPage = fetchPublicText,
  assessSupport = null,
  trustedHosts = [],
  discoverCandidates = null,
} = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (assessSupport !== null && typeof assessSupport !== 'function') {
    throw new TypeError('assessSupport must be a function or null');
  }
  if (discoverCandidates !== null && typeof discoverCandidates !== 'function') {
    throw new TypeError('discoverCandidates must be a function or null');
  }
  const normalizedTrustedHosts = normalizeTrustedHosts(trustedHosts);
  const discover = discoverCandidates || createGovUkDiscovery({ fetchPage }).discover;

  return {
    async verify(input = {}) {
      if (input.signal?.aborted) throw abortedError();
      const policy = normalizeVerificationPolicy(input.policy);
      let request = createVerificationRequest(input);
      const claim = typeof input.claim === 'string' ? input.claim.trim() : '';

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

      if (!claim) {
        return {
          policy,
          request,
          fetchAttempted: false,
          results: unavailableResults(request, 'missing-claim'),
        };
      }

      let discoveryFetchAttempted = false;
      if (!request.candidateUrls.length) {
        if (!request.query) {
          return {
            policy,
            request,
            fetchAttempted: false,
            results: unavailableResults(request, 'missing-query'),
          };
        }
        if (!normalizeGovUkPublisher(request.publisher)) {
          return {
            policy,
            request,
            fetchAttempted: false,
            results: unavailableResults(request, 'unsupported-publisher'),
          };
        }

        let discovery;
        try {
          discovery = await awaitWithAbort(
            discover({
              publisher: request.publisher,
              query: request.query,
              signal: input.signal,
            }),
            input.signal
          );
          discoveryFetchAttempted = discovery?.fetchAttempted === true;
        } catch (error) {
          if (isAborted(error, input.signal)) throw error;
          return {
            policy,
            request,
            fetchAttempted: true,
            results: unavailableResults(request, normalizeFailureReason(error)),
          };
        }

        request = createVerificationRequest({
          publisher: request.publisher,
          query: request.query,
          candidateUrls: normalizeDiscoveredGovUkUrls(discovery?.candidateUrls),
        });
        if (!request.candidateUrls.length) {
          return {
            policy,
            request,
            fetchAttempted: discoveryFetchAttempted,
            results: unavailableResults(request, discovery?.reason || 'no-discovery-results'),
          };
        }
      }

      const results = [];
      let fetchAttempted = discoveryFetchAttempted;
      for (const candidateUrl of request.candidateUrls) {
        if (input.signal?.aborted) throw abortedError();
        if (!isTrustedOfficialUrl(candidateUrl, normalizedTrustedHosts)) {
          results.push(
            createResult({
              publisher: request.publisher,
              url: candidateUrl,
              status: VERIFICATION_STATUSES.NOT_VERIFIED,
              reason: 'untrusted-host',
            })
          );
          continue;
        }
        try {
          fetchAttempted = true;
          const fetchOptions = { query: request.query, maxRedirects: 0 };
          if (input.signal) fetchOptions.signal = input.signal;
          const page = await awaitWithAbort(fetchPage(candidateUrl, fetchOptions), input.signal);
          const resultPublisher = publisherForFetchedUrl(page?.url, request.publisher);
          const actuallyFetched =
            page?.fetched === true &&
            typeof page.url === 'string' &&
            typeof page.retrievedAt === 'string' &&
            typeof page.excerpt === 'string' &&
            page.excerpt.trim().length > 0;
          if (!actuallyFetched) {
            results.push(
              createResult({
                publisher: resultPublisher,
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
          if (request.query && trustedOfficialHost && assessSupport) {
            try {
              assessment = normalizeAssessment(
                await awaitWithAbort(
                  assessSupport({
                    claim,
                    query: request.query,
                    text: typeof page.supportText === 'string' ? page.supportText : page.excerpt,
                    excerpt: page.excerpt,
                    url: page.url,
                    publisher: resultPublisher,
                    signal: input.signal,
                  }),
                  input.signal
                )
              );
            } catch (error) {
              if (isAborted(error, input.signal)) throw error;
              assessmentFailed = true;
            }
          }
          const verified = Boolean(
            claim && request.query && trustedOfficialHost && assessSupport && assessment.supported
          );
          const reason = verified
            ? null
            : !claim
              ? 'missing-claim'
              : !request.query
              ? 'missing-query'
              : !trustedOfficialHost
                ? 'untrusted-host'
                : !assessSupport
                  ? 'semantic-assessment-required'
                : assessmentFailed
                  ? 'support-assessment-failed'
                  : 'insufficient-support';
          const result = createResult({
            publisher: resultPublisher,
            url: page.url,
            retrievedAt: page.retrievedAt,
            excerpt: assessment.excerpt || page.excerpt,
            status: verified ? VERIFICATION_STATUSES.VERIFIED : VERIFICATION_STATUSES.RETRIEVED,
            reason,
          });
          results.push(result);
          if (verified) break;
        } catch (error) {
          if (isAborted(error, input.signal)) throw error;
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
        fetchAttempted,
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
