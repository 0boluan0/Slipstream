const { fetchPublicText } = require('./fetch-page');
const { createVerificationRequest } = require('./request');

const GOV_UK_ORIGIN = 'https://www.gov.uk';
const GOV_UK_SEARCH_ENDPOINT = GOV_UK_ORIGIN + '/api/search.json';
const GOV_UK_SEARCH_FIELDS = 'title,description,link';
const GOV_UK_DISCOVERY_LIMIT = 3;
const GOV_UK_DISCOVERY_MAX_BYTES = 64 * 1024;
const GOV_UK_DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_METADATA_TRUST = 'untrusted';
const MAX_RESULT_LINK_CHARS = 2048;
const MAX_TITLE_CHARS = 240;
const MAX_DESCRIPTION_CHARS = 600;

const SUPPORTED_PUBLISHERS = new Map([
  ['gov.uk', 'GOV.UK'],
  ['uk government', 'UK Government'],
]);

class DiscoveryError extends Error {
  constructor(message, code = 'discovery-failed') {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

function normalizeGovUkPublisher(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-GB');
  return SUPPORTED_PUBLISHERS.get(normalized) || null;
}

function createAbortError() {
  const error = new DiscoveryError('GOV.UK discovery was cancelled', 'aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function withAbort(value, signal) {
  if (!signal) return Promise.resolve(value);
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener?.('abort', onAbort);
      callback(result);
    };
    const onAbort = () => finish(reject, createAbortError());

    signal.addEventListener?.('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error)
    );
  });
}

function emptyDiscovery(publisher, reason) {
  return Object.freeze({
    publisher,
    fetchAttempted: false,
    candidateUrls: Object.freeze([]),
    candidates: Object.freeze([]),
    reason,
  });
}

function createSearchUrl(query) {
  const url = new URL(GOV_UK_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(GOV_UK_DISCOVERY_LIMIT));
  url.searchParams.set('fields', GOV_UK_SEARCH_FIELDS);
  return url.href;
}

function normalizeMetadataText(value, maxChars) {
  if (typeof value !== 'string') return '';
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function normalizeGovUkResultLink(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.length > MAX_RESULT_LINK_CHARS ||
    /[\\\r\n]/.test(value)
  ) {
    return null;
  }

  let url;
  try {
    url = new URL(value, GOV_UK_ORIGIN);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.origin !== GOV_UK_ORIGIN ||
    url.hostname !== 'www.gov.uk' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  return url.href;
}

function parseSearchPayload(fetchResult, expectedUrl) {
  if (fetchResult && typeof fetchResult === 'object' && typeof fetchResult.url === 'string') {
    let actualUrl;
    try {
      actualUrl = new URL(fetchResult.url).href;
    } catch {
      throw new DiscoveryError('GOV.UK search returned an invalid response URL', 'invalid-response-url');
    }
    if (actualUrl !== expectedUrl) {
      throw new DiscoveryError('GOV.UK search response came from an unexpected URL', 'unexpected-response-url');
    }
  }

  if (fetchResult?.fetched === false) {
    throw new DiscoveryError('GOV.UK search was not fetched', 'unconfirmed-response');
  }

  if (fetchResult && typeof fetchResult === 'object' && Array.isArray(fetchResult.results)) {
    return fetchResult;
  }

  const text =
    typeof fetchResult === 'string'
      ? fetchResult
      : typeof fetchResult?.supportText === 'string'
        ? fetchResult.supportText
        : typeof fetchResult?.text === 'string'
          ? fetchResult.text
          : null;
  if (text == null) {
    throw new DiscoveryError('GOV.UK search returned no JSON body', 'invalid-json');
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new DiscoveryError('GOV.UK search returned invalid JSON', 'invalid-json');
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
    throw new DiscoveryError('GOV.UK search returned an invalid result shape', 'invalid-result-shape');
  }
  return payload;
}

function candidatesFromPayload(payload) {
  const candidates = [];
  const seenUrls = new Set();

  for (const result of payload.results) {
    if (!result || typeof result !== 'object') continue;
    const url = normalizeGovUkResultLink(result.link);
    if (!url || seenUrls.has(url)) continue;

    seenUrls.add(url);
    candidates.push(
      Object.freeze({
        url,
        title: normalizeMetadataText(result.title, MAX_TITLE_CHARS),
        description: normalizeMetadataText(result.description, MAX_DESCRIPTION_CHARS),
        metadataTrust: DISCOVERY_METADATA_TRUST,
      })
    );
    if (candidates.length === GOV_UK_DISCOVERY_LIMIT) break;
  }

  return Object.freeze(candidates);
}

function createGovUkDiscovery({ fetchPage = fetchPublicText } = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');

  return Object.freeze({
    async discover(input = {}) {
      throwIfAborted(input.signal);
      const publisher = normalizeGovUkPublisher(input.publisher);
      if (!publisher) return emptyDiscovery(null, 'unsupported-publisher');

      const request = createVerificationRequest({
        publisher,
        query: input.query,
        candidateUrls: [],
      });
      if (!request.query) return emptyDiscovery(publisher, 'empty-query');

      const searchUrl = createSearchUrl(request.query);
      const fetchOptions = {
        maxBytes: GOV_UK_DISCOVERY_MAX_BYTES,
        maxRedirects: 0,
        timeoutMs: GOV_UK_DISCOVERY_TIMEOUT_MS,
      };
      if (input.signal) fetchOptions.signal = input.signal;

      const fetchResult = await withAbort(fetchPage(searchUrl, fetchOptions), input.signal);
      throwIfAborted(input.signal);
      const candidates = candidatesFromPayload(parseSearchPayload(fetchResult, searchUrl));
      return Object.freeze({
        publisher,
        fetchAttempted: true,
        candidateUrls: Object.freeze(candidates.map((candidate) => candidate.url)),
        candidates,
      });
    },
  });
}

async function discoverGovUkCandidates(input, dependencies) {
  return createGovUkDiscovery(dependencies).discover(input);
}

module.exports = {
  DISCOVERY_METADATA_TRUST,
  GOV_UK_DISCOVERY_LIMIT,
  GOV_UK_SEARCH_ENDPOINT,
  GOV_UK_SEARCH_FIELDS,
  DiscoveryError,
  createGovUkDiscovery,
  discoverGovUkCandidates,
  normalizeGovUkPublisher,
  normalizeGovUkResultLink,
};
