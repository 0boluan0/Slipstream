const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const { LLM_BACKENDS } = require('../shared/constants.cjs');
const {
  ENDPOINT_LOCATION_KINDS,
  classifyEndpointLocation,
} = require('../shared/endpoint-location.cjs');
const {
  validateEndpointUrl,
  validateOllamaEndpointUrl,
} = require('./validation');
const {
  UnsafeUrlError,
  createPinnedLookup,
  resolvePublicAddresses,
} = require('./verification/url-safety');

const PROVIDER_CONNECTION_TIMEOUT_MS = 7000;
const PROVIDER_CONNECTION_MAX_BYTES = 256 * 1024;

const CONNECTION_STATUSES = Object.freeze({
  CONNECTED: 'connected',
  FAILED: 'failed',
  INCONCLUSIVE: 'inconclusive',
});

const CONNECTION_CODES = Object.freeze({
  OK: 'ok',
  UNSUPPORTED: 'unsupported',
  MISSING_CREDENTIALS: 'missing-credentials',
  INVALID_CONFIG: 'invalid-config',
  UNSAFE_ENDPOINT: 'unsafe-endpoint',
  UNAUTHORIZED: 'unauthorized',
  MODEL_NOT_FOUND: 'model-not-found',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  INVALID_RESPONSE: 'invalid-response',
  RESPONSE_TOO_LARGE: 'response-too-large',
  REDIRECT_REJECTED: 'redirect-rejected',
  RATE_LIMITED: 'rate-limited',
  SERVICE_UNAVAILABLE: 'service-unavailable',
  HTTP_ERROR: 'http-error',
  STRUCTURED_OUTPUT_INVALID: 'structured-output-invalid',
  GENERATION_FAILED: 'generation-failed',
  BUSY: 'busy',
  CANCELLED: 'cancelled',
  CANCELLED_BY_USER: 'cancelled-by-user',
  SETTINGS_SAVE_FAILED: 'settings-save-failed',
});

class ConnectionTestError extends Error {
  constructor(connectionCode) {
    super(connectionCode);
    this.name = 'ConnectionTestError';
    this.connectionCode = connectionCode;
  }
}

function result(status, code) {
  return { status, code };
}

function connected() {
  return result(CONNECTION_STATUSES.CONNECTED, CONNECTION_CODES.OK);
}

function failed(code) {
  return result(CONNECTION_STATUSES.FAILED, code);
}

function inconclusive() {
  return result(CONNECTION_STATUSES.INCONCLUSIVE, CONNECTION_CODES.UNSUPPORTED);
}

function requireText(value, code = CONNECTION_CODES.INVALID_CONFIG) {
  if (typeof value !== 'string' || !value.trim()) throw new ConnectionTestError(code);
  return value.trim();
}

function appendPath(baseUrl, suffix) {
  const url = new URL(baseUrl);
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  url.pathname = `${basePath}${normalizedSuffix}`;
  return url;
}

function createProviderRequest(settings) {
  const backend = settings?.activeBackend;
  const model = requireText(settings?.activeModel);
  const commonHeaders = {
    Accept: 'application/json',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-store',
  };

  if (backend === LLM_BACKENDS.OPENAI) {
    const key = requireText(settings.openaiApiKey, CONNECTION_CODES.MISSING_CREDENTIALS);
    return {
      backend,
      model,
      url: new URL(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`),
      headers: { ...commonHeaders, Authorization: `Bearer ${key}` },
    };
  }

  if (backend === LLM_BACKENDS.ANTHROPIC) {
    const key = requireText(settings.anthropicApiKey, CONNECTION_CODES.MISSING_CREDENTIALS);
    return {
      backend,
      model,
      url: new URL(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`),
      headers: {
        ...commonHeaders,
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    };
  }

  if (backend === LLM_BACKENDS.DEEPSEEK) {
    const key = requireText(settings.deepseekApiKey, CONNECTION_CODES.MISSING_CREDENTIALS);
    return {
      backend,
      model,
      url: new URL('https://api.deepseek.com/models'),
      headers: { ...commonHeaders, Authorization: `Bearer ${key}` },
    };
  }

  if (backend === LLM_BACKENDS.OLLAMA) {
    const configuredUrl = requireText(settings.ollamaBaseUrl);
    let baseUrl;
    try {
      baseUrl = validateOllamaEndpointUrl(configuredUrl);
    } catch {
      throw new ConnectionTestError(CONNECTION_CODES.UNSAFE_ENDPOINT);
    }
    return {
      backend,
      model,
      url: appendPath(baseUrl, '/api/tags'),
      headers: commonHeaders,
    };
  }

  if (backend === LLM_BACKENDS.CUSTOM) {
    const baseUrl = validateEndpointUrl(requireText(settings.customEndpointUrl));
    const key = typeof settings.customEndpointApiKey === 'string'
      ? settings.customEndpointApiKey.trim()
      : '';
    return {
      backend,
      model,
      url: appendPath(baseUrl, '/models'),
      headers: key
        ? { ...commonHeaders, Authorization: `Bearer ${key}` }
        : commonHeaders,
    };
  }

  throw new ConnectionTestError(CONNECTION_CODES.INVALID_CONFIG);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const exact = headers[name];
  if (exact != null) return Array.isArray(exact) ? exact.join(',') : String(exact);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value.join(',') : String(value || '');
}

function isJsonMediaType(value) {
  const mediaType = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

function responseCodeForStatus(statusCode, backend) {
  if (statusCode >= 300 && statusCode < 400) return CONNECTION_CODES.REDIRECT_REJECTED;
  if (statusCode === 401 || statusCode === 403) return CONNECTION_CODES.UNAUTHORIZED;
  if (statusCode === 402 || statusCode === 429) return CONNECTION_CODES.RATE_LIMITED;
  if (backend === LLM_BACKENDS.ANTHROPIC && statusCode === 529) {
    return CONNECTION_CODES.SERVICE_UNAVAILABLE;
  }
  if (
    [LLM_BACKENDS.OPENAI, LLM_BACKENDS.ANTHROPIC, LLM_BACKENDS.DEEPSEEK].includes(backend)
    && [500, 502, 503, 504].includes(statusCode)
  ) {
    return CONNECTION_CODES.SERVICE_UNAVAILABLE;
  }
  if (
    backend === LLM_BACKENDS.CUSTOM &&
    (statusCode === 404 || statusCode === 405 || statusCode === 501)
  ) {
    return CONNECTION_CODES.UNSUPPORTED;
  }
  if (
    (backend === LLM_BACKENDS.OPENAI || backend === LLM_BACKENDS.ANTHROPIC) &&
    statusCode === 404
  ) {
    return CONNECTION_CODES.MODEL_NOT_FOUND;
  }
  return CONNECTION_CODES.HTTP_ERROR;
}

function requestJson(requestSpec, {
  lookup,
  httpRequest = http.request,
  httpsRequest = https.request,
  timeoutMs = PROVIDER_CONNECTION_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let onAbort = null;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const timer = setTimeout(() => {
      request?.destroy();
      settle(reject, new ConnectionTestError(CONNECTION_CODES.TIMEOUT));
    }, timeoutMs);
    onAbort = () => {
      request?.destroy();
      settle(reject, new ConnectionTestError(CONNECTION_CODES.CANCELLED));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    (async () => {
      try {
      const url = requestSpec.url;
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      let requestImpl;
      let pinnedLookup;

      if (url.protocol === 'https:') {
        const resolved = await resolvePublicAddresses(url, lookup ? { lookup } : undefined);
        if (settled) return;
        requestImpl = httpsRequest;
        pinnedLookup = createPinnedLookup(resolved.addresses);
      } else if (
        url.protocol === 'http:' &&
        classifyEndpointLocation(url.href) === ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK
      ) {
        requestImpl = httpRequest;
      } else {
        throw new ConnectionTestError(CONNECTION_CODES.UNSAFE_ENDPOINT);
      }

      const options = {
        protocol: url.protocol,
        hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method: 'GET',
        path: url.pathname,
        headers: requestSpec.headers,
        agent: false,
      };
      if (pinnedLookup) {
        options.lookup = pinnedLookup;
        if (!net.isIP(hostname)) options.servername = hostname;
      }

      request = requestImpl(options, (response) => {
        const statusCode = Number(response.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          response.destroy?.();
          settle(reject, new ConnectionTestError(responseCodeForStatus(statusCode, requestSpec.backend)));
          return;
        }

        const contentEncoding = headerValue(response.headers, 'content-encoding').trim().toLowerCase();
        if (contentEncoding && contentEncoding !== 'identity') {
          response.destroy?.();
          settle(reject, new ConnectionTestError(CONNECTION_CODES.INVALID_RESPONSE));
          return;
        }
        if (!isJsonMediaType(headerValue(response.headers, 'content-type'))) {
          response.destroy?.();
          settle(reject, new ConnectionTestError(CONNECTION_CODES.INVALID_RESPONSE));
          return;
        }

        const declaredLength = Number(headerValue(response.headers, 'content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > PROVIDER_CONNECTION_MAX_BYTES) {
          response.destroy?.();
          settle(reject, new ConnectionTestError(CONNECTION_CODES.RESPONSE_TOO_LARGE));
          return;
        }

        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > PROVIDER_CONNECTION_MAX_BYTES) {
            response.destroy?.();
            settle(reject, new ConnectionTestError(CONNECTION_CODES.RESPONSE_TOO_LARGE));
            return;
          }
          chunks.push(bytes);
        });
        response.on('error', () => {
          settle(reject, new ConnectionTestError(CONNECTION_CODES.UNREACHABLE));
        });
        response.on('end', () => {
          if (settled) return;
          try {
            settle(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            settle(reject, new ConnectionTestError(CONNECTION_CODES.INVALID_RESPONSE));
          }
        });
      });
      request.once('error', (error) => {
        const code = error?.code === 'ETIMEDOUT'
          ? CONNECTION_CODES.TIMEOUT
          : CONNECTION_CODES.UNREACHABLE;
        settle(reject, new ConnectionTestError(code));
      });
      request.end();
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          const code = error.code === 'dns-failed'
            ? CONNECTION_CODES.UNREACHABLE
            : CONNECTION_CODES.UNSAFE_ENDPOINT;
          settle(reject, new ConnectionTestError(code));
          return;
        }
        if (error instanceof ConnectionTestError) {
          settle(reject, error);
          return;
        }
        settle(reject, new ConnectionTestError(CONNECTION_CODES.INVALID_CONFIG));
      }
    })();
  });
}

function extractModelIds(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean);
  }
  if (Array.isArray(payload?.models)) {
    return payload.models
      .map((item) => typeof item === 'string' ? item : item?.name || item?.model || item?.id)
      .filter(Boolean);
  }
  return null;
}

function hasOllamaModel(modelIds, model) {
  return modelIds.some((candidate) => candidate === model || candidate === `${model}:latest`);
}

function inspectProviderPayload(requestSpec, payload) {
  const { backend, model } = requestSpec;
  if (backend === LLM_BACKENDS.OPENAI || backend === LLM_BACKENDS.ANTHROPIC) {
    return payload && payload.id === model
      ? connected()
      : failed(CONNECTION_CODES.MODEL_NOT_FOUND);
  }

  const modelIds = extractModelIds(payload);
  if (backend === LLM_BACKENDS.CUSTOM && modelIds === null) return inconclusive();
  if (!modelIds) return failed(CONNECTION_CODES.INVALID_RESPONSE);
  if (backend === LLM_BACKENDS.OLLAMA) {
    return hasOllamaModel(modelIds, model)
      ? connected()
      : failed(CONNECTION_CODES.MODEL_NOT_FOUND);
  }
  return modelIds.includes(model)
    ? connected()
    : failed(CONNECTION_CODES.MODEL_NOT_FOUND);
}

async function testProviderConnection(settings, dependencies = {}) {
  let requestSpec;
  try {
    requestSpec = createProviderRequest(settings);
    const payload = await requestJson(requestSpec, dependencies);
    return inspectProviderPayload(requestSpec, payload);
  } catch (error) {
    const code = error instanceof ConnectionTestError
      ? error.connectionCode
      : CONNECTION_CODES.INVALID_CONFIG;
    if (requestSpec?.backend === LLM_BACKENDS.CUSTOM && code === CONNECTION_CODES.UNSUPPORTED) {
      return inconclusive();
    }
    return failed(code);
  }
}

module.exports = {
  CONNECTION_CODES,
  CONNECTION_STATUSES,
  PROVIDER_CONNECTION_MAX_BYTES,
  PROVIDER_CONNECTION_TIMEOUT_MS,
  testProviderConnection,
};
