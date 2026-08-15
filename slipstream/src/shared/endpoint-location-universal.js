// Browser- and Node-safe implementation shared by the renderer ESM adapter
// and main-process CommonJS adapter. Keeping the implementation free of
// module syntax lets Vite serve it directly during development without a
// CommonJS interoperability transform.
(function installEndpointLocationApi() {
  const ENDPOINT_LOCATION_KINDS = Object.freeze({
    LOCAL_LOOPBACK: 'local-loopback',
    REMOTE_HTTPS: 'remote-https',
    UNKNOWN: 'unknown',
    INVALID: 'invalid',
  });

  const ENDPOINT_UI_LOCATIONS = Object.freeze({
    LOCAL: 'local',
    ONLINE: 'online',
    UNKNOWN: 'unknown',
  });

  const PROCESSING_LOCATION_KINDS = Object.freeze({
    LOCAL: 'local',
    LOCAL_LOOPBACK: ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK,
    ONLINE: 'online',
    UNKNOWN: 'unknown',
  });

  const ONLINE_PROCESSING_BACKENDS = new Set([
    'anthropic',
    'deepseek',
    'free_translate',
    'openai',
  ]);

  function authorityContainsUserInfo(candidate) {
    const match = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(candidate);
    return Boolean(match && match[1].includes('@'));
  }

  function normalizeParsedHostname(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      return normalized.slice(1, -1);
    }
    return normalized;
  }

  function isIpv4Loopback(hostname) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      && octets[0] === 127;
  }

  function isParsedLoopbackHostname(hostname) {
    const normalized = normalizeParsedHostname(hostname);
    return normalized === 'localhost'
      || normalized === 'localhost.'
      || normalized === '::1'
      || isIpv4Loopback(normalized);
  }

  function classifyEndpointLocation(value) {
    if (value == null) return ENDPOINT_LOCATION_KINDS.UNKNOWN;
    if (typeof value !== 'string') return ENDPOINT_LOCATION_KINDS.INVALID;

    const candidate = value.trim();
    if (!candidate) return ENDPOINT_LOCATION_KINDS.UNKNOWN;

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return ENDPOINT_LOCATION_KINDS.INVALID;
    }

    if (parsed.username || parsed.password || authorityContainsUserInfo(candidate)) {
      return ENDPOINT_LOCATION_KINDS.INVALID;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ENDPOINT_LOCATION_KINDS.INVALID;
    }
    if (isParsedLoopbackHostname(parsed.hostname)) {
      return ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK;
    }
    if (parsed.protocol === 'https:') {
      return ENDPOINT_LOCATION_KINDS.REMOTE_HTTPS;
    }
    return ENDPOINT_LOCATION_KINDS.INVALID;
  }

  function isHttpLoopbackEndpoint(value) {
    if (classifyEndpointLocation(value) !== ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK) {
      return false;
    }
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:'
        && !parsed.username
        && !parsed.password
        && !parsed.search
        && !parsed.hash
        && !/\/(?:models|chat\/completions|api\/(?:tags|generate))\/?$/iu.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function endpointLocationForUi(classification) {
    if (classification === ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK) {
      return ENDPOINT_UI_LOCATIONS.LOCAL;
    }
    if (classification === ENDPOINT_LOCATION_KINDS.REMOTE_HTTPS) {
      return ENDPOINT_UI_LOCATIONS.ONLINE;
    }
    return ENDPOINT_UI_LOCATIONS.UNKNOWN;
  }

  function processingLocationForSettings(settings = {}) {
    const backend = settings && typeof settings === 'object'
      ? settings.activeBackend || settings.provider
      : null;
    if (backend === 'ollama') {
      return isHttpLoopbackEndpoint(settings.ollamaBaseUrl)
        ? PROCESSING_LOCATION_KINDS.LOCAL
        : PROCESSING_LOCATION_KINDS.UNKNOWN;
    }
    if (ONLINE_PROCESSING_BACKENDS.has(backend)) return PROCESSING_LOCATION_KINDS.ONLINE;
    if (backend !== 'custom') return PROCESSING_LOCATION_KINDS.UNKNOWN;

    const endpointLocation = classifyEndpointLocation(settings.customEndpointUrl);
    if (endpointLocation === ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK) {
      return isHttpLoopbackEndpoint(settings.customEndpointUrl)
        ? PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK
        : PROCESSING_LOCATION_KINDS.UNKNOWN;
    }
    if (endpointLocation === ENDPOINT_LOCATION_KINDS.REMOTE_HTTPS) {
      return PROCESSING_LOCATION_KINDS.ONLINE;
    }
    return PROCESSING_LOCATION_KINDS.UNKNOWN;
  }

  const endpointLocationApi = Object.freeze({
    ENDPOINT_LOCATION_KINDS,
    ENDPOINT_UI_LOCATIONS,
    PROCESSING_LOCATION_KINDS,
    classifyEndpointLocation,
    endpointLocationForUi,
    isHttpLoopbackEndpoint,
    processingLocationForSettings,
  });
  Object.defineProperty(globalThis, Symbol.for('slipstream.endpoint-location'), {
    configurable: true,
    enumerable: false,
    writable: false,
    value: endpointLocationApi,
  });
}());
