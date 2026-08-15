const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');

const { validateEndpointUrl } = require('./validation');
const {
  ENDPOINT_LOCATION_KINDS,
  classifyEndpointLocation,
} = require('../shared/endpoint-location.cjs');
const {
  createPinnedLookup,
  resolvePublicAddresses,
} = require('./verification/url-safety');

const CUSTOM_ENDPOINT_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'custom-endpoint-invalid-request',
  ORIGIN_MISMATCH: 'custom-endpoint-origin-mismatch',
  REDIRECT_REJECTED: 'custom-endpoint-redirect-rejected',
  UNSAFE_TARGET: 'custom-endpoint-unsafe-target',
  FETCH_FAILED: 'custom-endpoint-fetch-failed',
});

class CustomEndpointBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CustomEndpointBoundaryError';
    this.code = code;
  }
}

function requestUrlFromInput(input) {
  try {
    if (input instanceof URL) return new URL(input.href);
    if (typeof input === 'string') return new URL(input);
    if (input && typeof input.url === 'string') return new URL(input.url);
  } catch {
    // The generic error below intentionally excludes the supplied address.
  }
  throw new CustomEndpointBoundaryError(
    CUSTOM_ENDPOINT_ERROR_CODES.INVALID_REQUEST,
    '自定义服务请求地址无效',
  );
}

function isLoopbackHttpUrl(url) {
  return url.protocol === 'http:'
    && classifyEndpointLocation(url.href) === ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK;
}

function disposeResponseBody(response) {
  const body = response?.body;
  if (typeof body?.destroy === 'function') body.destroy();
  else if (typeof body?.cancel === 'function') void body.cancel().catch(() => {});
}

function isRedirectStatus(status) {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

function headersForNodeRequest(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return { ...headers };
}

function createResponseFromIncomingMessage(incoming, requestUrl) {
  const status = Number(incoming.statusCode || 500);
  const response = new Response(status === 204 || status === 205 ? null : Readable.toWeb(incoming), {
    status,
    statusText: incoming.statusMessage || '',
    headers: incoming.headers,
  });
  Object.defineProperty(response, 'url', {
    configurable: false,
    enumerable: true,
    value: requestUrl.href,
  });
  return response;
}

function requestWithoutRedirect(requestUrl, init, agent) {
  return new Promise((resolve, reject) => {
    const requestImpl = requestUrl.protocol === 'https:' ? https.request : http.request;
    const signal = init?.signal;
    if (signal?.aborted) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }

    const request = requestImpl({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname.replace(/^\[|\]$/g, ''),
      port: requestUrl.port || (requestUrl.protocol === 'https:' ? 443 : 80),
      method: init?.method || 'GET',
      path: `${requestUrl.pathname}${requestUrl.search}`,
      headers: headersForNodeRequest(init?.headers),
      agent,
      signal,
    }, (incoming) => {
      if (isRedirectStatus(Number(incoming.statusCode))) {
        incoming.destroy();
        reject(new CustomEndpointBoundaryError(
          CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED,
          '自定义服务返回了重定向，已停止请求',
        ));
        return;
      }
      try {
        resolve(createResponseFromIncomingMessage(incoming, requestUrl));
      } catch {
        incoming.destroy();
        reject(new CustomEndpointBoundaryError(
          CUSTOM_ENDPOINT_ERROR_CODES.FETCH_FAILED,
          '自定义服务请求失败（fetch failed）',
        ));
      }
    });

    request.once('error', reject);
    if (init?.body == null) request.end();
    else request.end(init.body);
  });
}

function findCustomEndpointBoundaryError(error) {
  let current = error;
  const seen = new Set();
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    if (current instanceof CustomEndpointBoundaryError) return current;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

/**
 * Build a fetch implementation for the OpenAI-compatible custom provider.
 *
 * Every request is constrained to the validated configured origin. Redirects
 * are handled manually and rejected before fetch can replay the body or
 * Authorization header to a second hop. Public HTTPS requests additionally
 * use a DNS result that has been checked and pinned for that request.
 */
function createCustomEndpointFetch(baseUrl, dependencies = {}) {
  const validatedBaseUrl = validateEndpointUrl(baseUrl);
  const configuredOrigin = new URL(validatedBaseUrl).origin;
  const fetchImpl = dependencies.fetchImpl;
  const resolveAddresses = dependencies.resolvePublicAddresses || resolvePublicAddresses;
  const makePinnedLookup = dependencies.createPinnedLookup || createPinnedLookup;
  const httpAgentFactory = dependencies.httpAgentFactory || ((options) => new http.Agent(options));
  const httpsAgentFactory = dependencies.httpsAgentFactory || ((options) => new https.Agent(options));

  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  return async function customEndpointFetch(input, init = {}) {
    const requestUrl = requestUrlFromInput(input);
    if (requestUrl.username || requestUrl.password || requestUrl.origin !== configuredOrigin) {
      throw new CustomEndpointBoundaryError(
        CUSTOM_ENDPOINT_ERROR_CODES.ORIGIN_MISMATCH,
        '自定义服务请求越过了已配置的服务边界',
      );
    }

    let agent;
    if (isLoopbackHttpUrl(requestUrl)) {
      agent = httpAgentFactory({ keepAlive: false });
    } else if (requestUrl.protocol === 'https:' && !requestUrl.port && !net.isIP(requestUrl.hostname)) {
      let resolved;
      try {
        resolved = await resolveAddresses(requestUrl);
      } catch {
        throw new CustomEndpointBoundaryError(
          CUSTOM_ENDPOINT_ERROR_CODES.UNSAFE_TARGET,
          '自定义服务目标未通过安全检查',
        );
      }
      agent = httpsAgentFactory({
        keepAlive: false,
        lookup: makePinnedLookup(resolved.addresses),
      });
    } else {
      throw new CustomEndpointBoundaryError(
        CUSTOM_ENDPOINT_ERROR_CODES.UNSAFE_TARGET,
        '自定义服务目标未通过安全检查',
      );
    }

    let response;
    try {
      response = fetchImpl
        ? await fetchImpl(requestUrl.href, {
          ...init,
          agent,
          redirect: 'manual',
        })
        : await requestWithoutRedirect(requestUrl, init, agent);
    } catch (error) {
      if (error?.name === 'AbortError' || init?.signal?.aborted) throw error;
      const boundaryError = findCustomEndpointBoundaryError(error);
      if (boundaryError) throw boundaryError;
      throw new CustomEndpointBoundaryError(
        CUSTOM_ENDPOINT_ERROR_CODES.FETCH_FAILED,
        '自定义服务请求失败（fetch failed）',
      );
    }

    if (isRedirectStatus(response?.status)) {
      disposeResponseBody(response);
      throw new CustomEndpointBoundaryError(
        CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED,
        '自定义服务返回了重定向，已停止请求',
      );
    }

    // `redirect: manual` is the primary boundary. This is a defensive check
    // for injected or future fetch implementations that expose a final URL.
    if (response?.url) {
      let responseOrigin;
      try {
        responseOrigin = new URL(response.url).origin;
      } catch {
        responseOrigin = '';
      }
      if (responseOrigin !== configuredOrigin) {
        disposeResponseBody(response);
        throw new CustomEndpointBoundaryError(
          CUSTOM_ENDPOINT_ERROR_CODES.ORIGIN_MISMATCH,
          '自定义服务响应越过了已配置的服务边界',
        );
      }
    }

    return response;
  };
}

module.exports = {
  CUSTOM_ENDPOINT_ERROR_CODES,
  CustomEndpointBoundaryError,
  createCustomEndpointFetch,
  findCustomEndpointBoundaryError,
};
