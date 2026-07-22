const https = require('node:https');
const net = require('node:net');
const { createPinnedLookup, resolvePublicAddresses, UnsafeUrlError } = require('./url-safety');
const { selectRelevantExcerpt } = require('./support');

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const HARD_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const HARD_MAX_REDIRECTS = 5;
const MAX_EXCERPT_CHARS = 600;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'application/json']);

class FetchConstraintError extends Error {
  constructor(message, code = 'fetch-failed') {
    super(message);
    this.name = 'FetchConstraintError';
    this.code = code;
  }
}

function boundedInteger(value, fallback, maximum, field) {
  const resolved = value == null ? fallback : value;
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new FetchConstraintError(field + ' is outside the allowed range', 'invalid-fetch-options');
  }
  return resolved;
}

function decodeHtmlEntities(text) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const isHex = body[1]?.toLowerCase() === 'x';
      const value = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isInteger(value) && value > 0 && value <= 0x10ffff) return String.fromCodePoint(value);
      return entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function extractVisibleText(text, mimeType) {
  let visible = typeof text === 'string' ? text : '';
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
    visible = visible
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
    visible = decodeHtmlEntities(visible);
  }
  visible = [...visible]
    .map((character) => {
      const code = character.codePointAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return visible;
}

function extractExcerpt(text, mimeType, maxChars = MAX_EXCERPT_CHARS, query = '') {
  return selectRelevantExcerpt(extractVisibleText(text, mimeType), query, maxChars);
}

function normalizeMimeType(headers) {
  const value = headers?.['content-type'];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(';', 1)[0].trim().toLowerCase() : '';
}

function validateResponseMetadata(response, maxBytes) {
  const encoding = response.headers?.['content-encoding'];
  if (encoding && String(encoding).toLowerCase() !== 'identity') {
    throw new FetchConstraintError('compressed responses are not accepted', 'unsupported-encoding');
  }

  const mimeType = normalizeMimeType(response.headers);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new FetchConstraintError('response MIME type is not allowed', 'unsupported-mime');
  }

  const contentLength = Number(response.headers?.['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new FetchConstraintError('response exceeds the size limit', 'response-too-large');
  }
  return mimeType;
}

function errorFromStatus(statusCode) {
  const error = new FetchConstraintError('official source returned HTTP ' + statusCode, 'http-error');
  error.statusCode = statusCode;
  return error;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new FetchConstraintError('official source request timed out', 'timeout')),
      timeoutMs
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function fetchWithRedirect(value, options, redirectCount, deadline) {
  if (redirectCount > options.maxRedirects) {
    throw new FetchConstraintError('redirect limit exceeded', 'too-many-redirects');
  }
  const remainingMs = deadline - options.now();
  if (remainingMs <= 0) throw new FetchConstraintError('official source request timed out', 'timeout');

  const { url, addresses } = await withTimeout(
    resolvePublicAddresses(value, { lookup: options.lookup }),
    remainingMs
  );
  const requestRemainingMs = deadline - options.now();
  if (requestRemainingMs <= 0) throw new FetchConstraintError('official source request timed out', 'timeout');
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (callback, valueToReturn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(valueToReturn);
    };
    const fail = (error) => finish(reject, error);
    const timer = setTimeout(() => {
      request?.destroy(new FetchConstraintError('official source request timed out', 'timeout'));
    }, requestRemainingMs);

    const requestOptions = {
      protocol: 'https:',
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: 443,
      method: 'GET',
      path: url.pathname + url.search,
      lookup: createPinnedLookup(addresses),
      servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
      rejectUnauthorized: true,
      agent: false,
      headers: {
        Accept: [...ALLOWED_MIME_TYPES].join(', '),
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-store',
        'User-Agent': 'Slipstream-Official-Verification/1.0',
      },
    };

    try {
      request = options.requestImpl(requestOptions, (response) => {
        const statusCode = Number(response.statusCode) || 0;
        if (REDIRECT_STATUS_CODES.has(statusCode)) {
          const location = response.headers?.location;
          response.destroy();
          if (!location) {
            fail(new FetchConstraintError('redirect response has no location', 'invalid-redirect'));
            return;
          }
          let redirectUrl;
          try {
            redirectUrl = new URL(location, url).href;
          } catch {
            fail(new FetchConstraintError('redirect location is invalid', 'invalid-redirect'));
            return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fetchWithRedirect(redirectUrl, options, redirectCount + 1, deadline));
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.destroy();
          fail(errorFromStatus(statusCode));
          return;
        }

        let mimeType;
        try {
          mimeType = validateResponseMetadata(response, options.maxBytes);
        } catch (error) {
          response.destroy();
          fail(error);
          return;
        }

        let byteLength = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += buffer.length;
          if (byteLength > options.maxBytes) {
            response.destroy();
            fail(new FetchConstraintError('response exceeds the size limit', 'response-too-large'));
            return;
          }
          chunks.push(buffer);
        });
        response.once('error', fail);
        response.once('end', () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString('utf8');
          const supportText = extractVisibleText(text, mimeType);
          finish(resolve, {
            fetched: true,
            url: url.href,
            retrievedAt: new Date(options.now()).toISOString(),
            mimeType,
            excerpt: selectRelevantExcerpt(supportText, options.query, MAX_EXCERPT_CHARS),
            supportText,
          });
        });
      });
      request.once('error', (error) => {
        if (error instanceof FetchConstraintError || error instanceof UnsafeUrlError) {
          fail(error);
          return;
        }
        fail(new FetchConstraintError('official source request failed', 'fetch-failed'));
      });
      request.end();
    } catch (error) {
      fail(error instanceof FetchConstraintError ? error : new FetchConstraintError('official source request failed'));
    }
  });
}

async function fetchPublicText(value, options = {}) {
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'timeoutMs');
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, HARD_MAX_BYTES, 'maxBytes');
  const maxRedirects =
    options.maxRedirects == null
      ? DEFAULT_MAX_REDIRECTS
      : boundedInteger(options.maxRedirects + 1, DEFAULT_MAX_REDIRECTS + 1, HARD_MAX_REDIRECTS + 1, 'maxRedirects') - 1;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  return fetchWithRedirect(
    value,
    {
      lookup: options.lookup,
      maxBytes,
      maxRedirects,
      now,
      query: typeof options.query === 'string' ? options.query.slice(0, 120) : '',
      requestImpl: options.requestImpl || https.request,
    },
    0,
    now() + timeoutMs
  );
}

module.exports = {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  FetchConstraintError,
  extractExcerpt,
  extractVisibleText,
  fetchPublicText,
  validateResponseMetadata,
};
