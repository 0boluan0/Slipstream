const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function createRequestImpl({ statusCode = 200, body = '{}', headers = { 'content-type': 'application/json' }, inspect } = {}) {
  return (options, callback) => {
    inspect?.(options);
    const request = new EventEmitter();
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.headers = headers;
        response.destroy = (error) => {
          if (error) queueMicrotask(() => response.emit('error', error));
        };
        callback(response);
        if (statusCode >= 200 && statusCode < 300) {
          if (body) response.emit('data', Buffer.from(body));
          response.emit('end');
        }
      });
    };
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    return request;
  };
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

async function main() {
  const {
    CONNECTION_CODES,
    CONNECTION_STATUSES,
    PROVIDER_CONNECTION_TIMEOUT_MS,
    testProviderConnection,
  } = require('../src/main/provider-connection');
  const { validateEndpointUrl, validateProviderConnectionTestOptions } = require('../src/main/validation');

  assert.equal(PROVIDER_CONNECTION_TIMEOUT_MS, 7000);
  assert.deepEqual(validateProviderConnectionTestOptions(undefined), {});
  assert.throws(() => validateProviderConnectionTestOptions({ sourceText: 'private source' }));
  assert.equal(validateEndpointUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(validateEndpointUrl('http://localhost:11434'), 'http://127.0.0.1:11434');
  assert.throws(() => validateEndpointUrl('http://api.example.com/v1'));
  assert.throws(() => validateEndpointUrl('https://127.0.0.1/v1'));
  assert.throws(() => validateEndpointUrl('https://user:pass@api.example.com/v1'));
  assert.throws(() => validateEndpointUrl('https://api.example.com/v1?token=secret'));
  assert.throws(() => validateEndpointUrl('https://api.example.com/v1#fragment'));
  assert.throws(() => validateEndpointUrl('https://api.example.com/v1/models'));
  assert.throws(() => validateEndpointUrl('http://127.0.0.1:11434/api/tags'));

  let openAiRequests = 0;
  const openAi = await testProviderConnection({
    activeBackend: 'openai',
    activeModel: 'gpt-4o',
    openaiApiKey: 'test-openai-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      body: JSON.stringify({ id: 'gpt-4o', object: 'model' }),
      inspect: (options) => {
        openAiRequests += 1;
        assert.equal(options.method, 'GET');
        assert.equal(options.path, '/v1/models/gpt-4o');
        assert.equal(typeof options.lookup, 'function');
        assert.equal(options.headers.Authorization, 'Bearer test-openai-key');
        assert.equal(options.headers['Content-Type'], undefined);
      },
    }),
  });
  assert.deepEqual(openAi, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK });
  assert.equal(openAiRequests, 1, 'connection tests must never retry');

  const anthropic = await testProviderConnection({
    activeBackend: 'anthropic',
    activeModel: 'claude-sonnet-4-6',
    anthropicApiKey: 'test-anthropic-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      body: JSON.stringify({ id: 'claude-sonnet-4-6', type: 'model' }),
      inspect: (options) => {
        assert.equal(options.path, '/v1/models/claude-sonnet-4-6');
        assert.equal(options.headers['x-api-key'], 'test-anthropic-key');
        assert.equal(typeof options.headers['anthropic-version'], 'string');
      },
    }),
  });
  assert.deepEqual(anthropic, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK });

  const deepseek = await testProviderConnection({
    activeBackend: 'deepseek',
    activeModel: 'deepseek-v4-flash',
    deepseekApiKey: 'test-deepseek-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      body: JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] }),
      inspect: (options) => assert.equal(options.path, '/models'),
    }),
  });
  assert.deepEqual(deepseek, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK });

  let ollamaLookups = 0;
  const ollama = await testProviderConnection({
    activeBackend: 'ollama',
    activeModel: 'qwen2.5',
    ollamaBaseUrl: 'http://localhost:11434',
  }, {
    lookup: async () => { ollamaLookups += 1; return []; },
    httpRequest: createRequestImpl({
      body: JSON.stringify({ models: [{ name: 'qwen2.5:latest' }] }),
      inspect: (options) => {
        assert.equal(options.hostname, '127.0.0.1');
        assert.equal(options.path, '/api/tags');
      },
    }),
  });
  assert.deepEqual(ollama, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK });
  assert.equal(ollamaLookups, 0, 'literal loopback probes must not use DNS');

  let customRequests = 0;
  const customUnsupported = await testProviderConnection({
    activeBackend: 'custom',
    activeModel: 'private-model',
    customEndpointUrl: 'https://gateway.example.com/v1',
    customEndpointApiKey: 'test-custom-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      statusCode: 404,
      inspect: (options) => {
        customRequests += 1;
        assert.equal(options.path, '/v1/models');
      },
    }),
  });
  assert.deepEqual(customUnsupported, {
    status: CONNECTION_STATUSES.INCONCLUSIVE,
    code: CONNECTION_CODES.UNSUPPORTED,
  });
  assert.equal(customRequests, 1);

  const customUnknownJson = await testProviderConnection({
    activeBackend: 'custom',
    activeModel: 'private-model',
    customEndpointUrl: 'https://gateway.example.com/v1',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({ body: JSON.stringify({ vendorModels: ['private-model'] }) }),
  });
  assert.deepEqual(customUnknownJson, {
    status: CONNECTION_STATUSES.INCONCLUSIVE,
    code: CONNECTION_CODES.UNSUPPORTED,
  });

  const unauthorized = await testProviderConnection({
    activeBackend: 'openai', activeModel: 'gpt-4o', openaiApiKey: 'bad-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({ statusCode: 401 }),
  });
  assert.deepEqual(unauthorized, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.UNAUTHORIZED });

  let redirectRequests = 0;
  const redirect = await testProviderConnection({
    activeBackend: 'openai', activeModel: 'gpt-4o', openaiApiKey: 'test-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      statusCode: 302,
      headers: { location: 'https://attacker.example/models' },
      inspect: () => { redirectRequests += 1; },
    }),
  });
  assert.deepEqual(redirect, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.REDIRECT_REJECTED });
  assert.equal(redirectRequests, 1, 'redirects must not be followed');

  const wrongMime = await testProviderConnection({
    activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash', deepseekApiKey: 'test-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({ body: '<html></html>', headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(wrongMime, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.INVALID_RESPONSE });

  const tooLarge = await testProviderConnection({
    activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash', deepseekApiKey: 'test-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({
      body: '{}',
      headers: { 'content-type': 'application/json', 'content-length': String(300 * 1024) },
    }),
  });
  assert.deepEqual(tooLarge, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.RESPONSE_TOO_LARGE });

  let unsafeRequests = 0;
  const unsafe = await testProviderConnection({
    activeBackend: 'custom',
    activeModel: 'private-model',
    customEndpointUrl: 'https://gateway.example.com/v1',
  }, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    httpsRequest: createRequestImpl({ inspect: () => { unsafeRequests += 1; } }),
  });
  assert.deepEqual(unsafe, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.UNSAFE_ENDPOINT });
  assert.equal(unsafeRequests, 0, 'unsafe DNS results must be rejected before a request');

  const cancelledController = new AbortController();
  const cancelledPromise = testProviderConnection({
    activeBackend: 'openai', activeModel: 'gpt-4o', openaiApiKey: 'test-key',
  }, {
    lookup: publicLookup,
    signal: cancelledController.signal,
    httpsRequest: createRequestImpl(),
  });
  cancelledController.abort();
  const cancelled = await cancelledPromise;
  assert.deepEqual(cancelled, { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.CANCELLED });

  for (const result of [openAi, anthropic, deepseek, ollama, customUnsupported, unauthorized, redirect, wrongMime, tooLarge, unsafe, cancelled]) {
    assert.deepEqual(Object.keys(result).sort(), ['code', 'status']);
    assert.equal(JSON.stringify(result).includes('test-'), false, 'results must not expose keys or request metadata');
  }

  const providerSource = fs.readFileSync(path.join(root, 'src/main/provider-connection.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/components/SettingsPanel.jsx'), 'utf8');
  const apiKeyInputSource = fs.readFileSync(path.join(root, 'src/renderer/components/ApiKeyInput.jsx'), 'utf8');
  const modelSelectorSource = fs.readFileSync(path.join(root, 'src/renderer/components/ModelSelector.jsx'), 'utf8');
  const settingsStyles = fs.readFileSync(path.join(root, 'src/renderer/components/SettingsPanel.css'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(providerSource, /console\.(?:log|warn|error)/, 'provider tests must not log secrets, URLs, or bodies');
  assert.doesNotMatch(providerSource, /sourceText|rawText|prompt|message[s]?\s*:/i,
    'provider tests must never accept or send source/inference payloads');
  assert.match(mainSource, /IPC_CHANNELS\.PROVIDER_CONNECTION_TEST/);
  assert.match(mainSource, /IPC_CHANNELS\.PROVIDER_CONNECTION_CANCEL/);
  assert.match(mainSource, /providerConnectionAbortController\?\.abort\(\)/);
  assert.match(mainSource, /validateProviderConnectionTestOptions\(options\)/);
  assert.match(preloadSource, /'provider:connection-test'/);
  assert.match(preloadSource, /'provider:connection-cancel'/);
  assert.match(rendererSource, /测试只请求模型元数据，不会发送截图、剪贴板或任何待分析原文/);
  assert.match(rendererSource, /不会检验结构化输出兼容性/);
  assert.match(rendererSource, /testProviderConnection/);
  assert.match(rendererSource, /hasUnsavedConnectionDraft/);
  assert.match(rendererSource, /onDraftStateChange=\{handleModelDraftState\}/);
  assert.match(rendererSource, /hasCurrentSuccessfulConnectionTest/);
  assert.match(rendererSource, /!hasCurrentSuccessfulConnectionTest/,
    'full analysis activation must require a successful current connection test');
  assert.match(rendererSource, /connectionTest\.connectionRevision !== connectionRevisionRef\.current/);
  assert.match(rendererSource, /connectionTest\.processingConfigGeneration !== processingConfigGenerationRef\.current/,
    'activation must recheck the processing generation after a successful test');
  assert.match(rendererSource, /processingConfigGenerationRef\.current === processingGeneration/,
    'an in-flight result must be discarded when any processing configuration changes');
  assert.match(rendererSource, /connectionRevision: revision/);
  assert.match(rendererSource, /processingConfigGeneration: processingGeneration/);
  const deleteHandler = rendererSource.match(/const handleCredentialDelete[\s\S]*?\n\s*\);/)?.[0] || '';
  assert.ok(
    deleteHandler.indexOf('resetConnectionTest()') >= 0 &&
      deleteHandler.indexOf('resetConnectionTest()') < deleteHandler.indexOf("await updateSettings('setupMode'"),
    'credential deletion must invalidate the old test before its first persisted write'
  );
  assert.match(rendererSource, /handleApiKeyChange[\s\S]*settings\.setupMode === SETUP_MODES\.FULL[\s\S]*SETUP_MODES\.UNCONFIGURED/,
    'saving a replacement credential or endpoint must leave full mode until the new configuration is retested');
  assert.match(rendererSource, /handleCustomApiKeyChange[\s\S]*settings\.setupMode === SETUP_MODES\.FULL[\s\S]*SETUP_MODES\.UNCONFIGURED/,
    'saving a custom credential must leave full mode until the new configuration is retested');
  assert.match(rendererSource, /元数据连接成功/);
  assert.match(rendererSource, /不验证结构化输出兼容性/);
  assert.doesNotMatch(rendererSource, /testProviderConnection[\s\S]{0,800}activateMode/,
    'a successful connection test must not enable full mode');

  assert.match(apiKeyInputSource, /className="setting-save-button"/);
  assert.match(apiKeyInputSource, /有未保存的更改/);
  assert.match(apiKeyInputSource, /onClick=\{commit\}/);
  assert.match(apiKeyInputSource, /if \(e\.key === 'Enter'\)[\s\S]{0,120}commit\(\)/);
  const apiBlurHandler = apiKeyInputSource.match(/onBlur=\{\(e\) => \{([\s\S]*?)\n\s*\}\}/)?.[1] || '';
  assert.doesNotMatch(apiBlurHandler, /commit\(/, 'API keys and URLs must not rely on hidden blur persistence');

  assert.match(modelSelectorSource, /className="setting-save-button"/);
  assert.match(modelSelectorSource, /保存模型/);
  assert.match(modelSelectorSource, /if \(event\.key === 'Enter'\)[\s\S]{0,120}commit\(\)/);
  assert.doesNotMatch(modelSelectorSource, /onBlur=\{commit\}/,
    'models must not rely on hidden blur persistence');
  assert.match(settingsStyles, /\.setting-save-status\.is-dirty/);
  assert.match(settingsStyles, /\.setting-save-button/);
  for (const focusClass of [
    'settings-return-button',
    'backend-option-button',
    'setting-save-button',
    'provider-connection-test-button',
    'full-analysis-enable-button',
  ]) {
    assert.match(settingsStyles, new RegExp(`\\.${focusClass}:focus-visible`), `${focusClass} needs a visible keyboard focus ring`);
  }
  assert.doesNotMatch(rendererSource, /const segmentBtnBase = \{[\s\S]*?outline:\s*'none'/,
    'backend choices must not suppress their keyboard focus indicator');

  console.log('provider metadata-only connection checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
