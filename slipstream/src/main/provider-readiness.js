const LLMService = require('./llm-service');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  CONNECTION_CODES,
  CONNECTION_STATUSES,
  testProviderConnection,
} = require('./provider-connection');
const { CUSTOM_ENDPOINT_ERROR_CODES } = require('./custom-endpoint-fetch');
const { READING_SETUP_SOURCE, READING_SETUP_SELECTION, readingSetupSample } = require('../shared/reading-setup.mjs');
const { mathRanges } = require('../shared/reading-math.cjs');

function failed(code) {
  return { status: CONNECTION_STATUSES.FAILED, code };
}

function connected() {
  return { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK };
}

function compatibilityErrorCode(error, signal, backend) {
  if (signal?.aborted || error?.name === 'AbortError') return CONNECTION_CODES.CANCELLED;

  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED) {
    return CONNECTION_CODES.REDIRECT_REJECTED;
  }
  if (status === 401 || status === 403 || code === 'invalid_api_key' || code === 'authentication_error') {
    return CONNECTION_CODES.UNAUTHORIZED;
  }
  if (status === 402 || code.includes('insufficient_quota') || message.includes('insufficient balance')) {
    return CONNECTION_CODES.INSUFFICIENT_BALANCE;
  }
  if (status === 429 || code.includes('rate_limit')) {
    return CONNECTION_CODES.RATE_LIMITED;
  }
  if (backend === 'anthropic' && status === 529) {
    return CONNECTION_CODES.SERVICE_UNAVAILABLE;
  }
  if (
    ['openai', 'anthropic', 'deepseek'].includes(backend)
    && [500, 502, 503, 504].includes(status)
  ) {
    return CONNECTION_CODES.SERVICE_UNAVAILABLE;
  }
  if (
    code === 'model_not_found'
    || /model[^\n]*(not found|does not exist|\u4e0d\u5b58\u5728|\u672a\u627e\u5230)/i.test(message)
  ) {
    return CONNECTION_CODES.MODEL_NOT_FOUND;
  }
  if (message.includes('\u9700\u8981\u5148\u6dfb\u52a0 api key') || message.includes('\u8bf7\u5148\u914d\u7f6e\u81ea\u5b9a\u4e49\u670d\u52a1\u5730\u5740')) {
    return CONNECTION_CODES.MISSING_CREDENTIALS;
  }
  if (
    code === 'etimedout'
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('\u6a21\u578b\u54cd\u5e94\u8d85\u65f6')
  ) {
    return CONNECTION_CODES.TIMEOUT;
  }
  if (
    code === 'econnrefused'
    || code === 'enotfound'
    || code === 'eai_again'
    || message.includes('fetch failed')
    || message.includes('failed to connect')
    || message.includes('network error')
    || message.includes('socket')
  ) {
    return CONNECTION_CODES.UNREACHABLE;
  }
  return CONNECTION_CODES.GENERATION_FAILED;
}

async function testProviderReadiness(settings, dependencies = {}) {
  const parentSignal = dependencies.signal;
  if (parentSignal?.aborted) return failed(CONNECTION_CODES.CANCELLED);
  const controller = new AbortController();
  const signal = controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, dependencies.timeoutMs ?? 60000);
  const cancel = () => { clearTimeout(timer); controller.abort(); };
  parentSignal?.addEventListener('abort', cancel, { once: true });
  const stopped = () => failed(timedOut ? CONNECTION_CODES.TIMEOUT : CONNECTION_CODES.CANCELLED);
  const connectionTest = dependencies.testProviderConnection || testProviderConnection;
  const processReadingText = dependencies.processReadingText || LLMService.processReadingText;
  const requireImage = dependencies.requireImage ?? ['darwin', 'win32'].includes(process.platform);
  const readScreenshot = dependencies.readScreenshot || LLMService.readScreenshot;
  try {
    const metadataResult = await connectionTest(settings, {
      ...(dependencies.connectionDependencies || {}),
      signal,
    });
    if (signal.aborted) return stopped();
    // Providers can accept aliases that their model catalogue omits. Let the
    // actual reading request decide; credential and endpoint failures still stop.
    if (metadataResult?.status === CONNECTION_STATUSES.FAILED
      && metadataResult.code !== CONNECTION_CODES.MODEL_NOT_FOUND) return metadataResult;
    const translated = requireImage ? await readScreenshot({
      image: `data:image/png;base64,${(await fs.readFile(path.join(__dirname, '../shared/reading-setup.png'))).toString('base64')}`,
      settingsSnapshot: { ...settings, setupMode: 'full' },
      signal,
    }) : await processReadingText({
      text: READING_SETUP_SOURCE,
      kind: 'translate',
      withTerms: true,
      settingsSnapshot: settings,
      signal,
    });
    if (signal.aborted) return stopped();
    if (requireImage && (translated?.uncertain?.length || !/eigenvector/iu.test(translated?.text || '')
      || !mathRanges(translated?.text || '').some(({ tex }) =>
        tex.replace(/\\(?:qquad|quad|[,;:!])|[{}\s]/gu, '') === 'Av=2v'))) return failed(CONNECTION_CODES.IMAGE_NOT_SUPPORTED);
    const explained = await processReadingText({
      text: requireImage ? translated.text : READING_SETUP_SOURCE,
      kind: 'lookup',
      selection: READING_SETUP_SELECTION,
      settingsSnapshot: settings,
      signal,
    });
    if (signal.aborted) return stopped();
    const sample = readingSetupSample({
      translation: translated?.translation,
      meaning: explained?.lookup?.meaning,
      note: explained?.lookup?.note,
      imageChecked: requireImage,
    });
    if (!sample || !Array.isArray(translated?.terms)
      || explained?.lookup?.quote !== READING_SETUP_SELECTION
      || explained?.lookup?.contextual !== true) {
      return failed(CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID);
    }
    return { ...connected(), sample };
  } catch (error) {
    if (signal.aborted) return stopped();
    if (error instanceof SyntaxError || error?.message === 'reading-invalid-output') {
      return failed(CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID);
    }
    if (requireImage && (Number(error?.status) === 400 || /image.*(?:unsupported|not supported)|does not support.*image/iu.test(error?.message || ''))) {
      return failed(CONNECTION_CODES.IMAGE_NOT_SUPPORTED);
    }
    return failed(compatibilityErrorCode(error, signal, settings?.activeBackend));
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', cancel);
  }
}

module.exports = {
  compatibilityErrorCode,
  testProviderReadiness,
};
