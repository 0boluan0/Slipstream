// Browser- and Node-safe OCR review destination descriptor. The renderer and
// main process hash the same canonical serialization without sharing secrets
// or exposing the descriptor over IPC.
(function installOcrReviewDestinationApi() {
  const FIXED_ONLINE_BACKENDS = new Set([
    'anthropic',
    'deepseek',
    'free_translate',
    'openai',
  ]);
  const MAX_ENDPOINT_LENGTH = 2_048;
  const DESTINATION_SCHEMA = 'ocr-review-destination.v1';

  function exactEndpoint(value) {
    if (
      typeof value !== 'string'
      || !value
      || value.length > MAX_ENDPOINT_LENGTH
      || value !== value.trim()
      // Control characters are intentionally rejected from the exact endpoint.
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new Error('invalid OCR review destination endpoint');
    }
    return value;
  }

  function assertExactDescriptorKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid OCR review destination descriptor');
    }
    const keys = Object.keys(value).sort();
    if (
      keys.length !== 3
      || keys[0] !== 'activeBackend'
      || keys[1] !== 'endpoint'
      || keys[2] !== 'processingLocation'
    ) {
      throw new Error('invalid OCR review destination descriptor');
    }
  }

  function createOcrReviewDestinationDescriptor(value) {
    assertExactDescriptorKeys(value);
    const { activeBackend, processingLocation } = value;
    let endpoint = value.endpoint;

    if (FIXED_ONLINE_BACKENDS.has(activeBackend)) {
      if (processingLocation !== 'online' || endpoint !== '') {
        throw new Error('invalid fixed OCR review destination');
      }
    } else if (activeBackend === 'ollama') {
      if (processingLocation !== 'local') {
        throw new Error('invalid Ollama OCR review destination');
      }
      endpoint = exactEndpoint(endpoint);
    } else if (activeBackend === 'custom') {
      if (processingLocation !== 'online' && processingLocation !== 'local-loopback') {
        throw new Error('invalid custom OCR review destination');
      }
      endpoint = exactEndpoint(endpoint);
    } else {
      throw new Error('unsupported OCR review destination backend');
    }

    return Object.freeze({ activeBackend, processingLocation, endpoint });
  }

  function ocrReviewDestinationForSettings(settings, processingLocation) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('invalid OCR review destination settings');
    }
    const activeBackend = settings.activeBackend;
    const endpoint = activeBackend === 'custom'
      ? settings.customEndpointUrl
      : activeBackend === 'ollama'
        ? settings.ollamaBaseUrl
        : '';
    return createOcrReviewDestinationDescriptor({
      activeBackend,
      processingLocation,
      endpoint,
    });
  }

  function serializeOcrReviewDestination(value) {
    const descriptor = createOcrReviewDestinationDescriptor(value);
    return JSON.stringify([
      DESTINATION_SCHEMA,
      descriptor.activeBackend,
      descriptor.processingLocation,
      descriptor.endpoint,
    ]);
  }

  const ocrReviewDestinationApi = Object.freeze({
    createOcrReviewDestinationDescriptor,
    ocrReviewDestinationForSettings,
    serializeOcrReviewDestination,
  });
  Object.defineProperty(globalThis, Symbol.for('slipstream.ocr-review-destination'), {
    configurable: true,
    enumerable: false,
    writable: false,
    value: ocrReviewDestinationApi,
  });
}());
