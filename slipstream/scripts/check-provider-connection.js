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

function createCompatibilityCandidate() {
  return {
    schemaVersion: 'action-brief.candidate.v1',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translation: {
      text: '这是一项完全虚构的测试。Northstar Intake 是机构归档流程，LanternGate 门户收据是确认提交已进入流程的记录。登记仍是暂定状态，出现暂停时要等待。请在 2099 年 9 月 30 日下午 5:00 前通过 LanternGate 门户提交签字后的 Wren-7 Intake Form，并回复确认收到。',
      provenance: 'inference',
      evidenceQuotes: [],
      citationIds: [],
      confidence: 0.99,
    },
    explanation: {
      text: '测试文字说明登记尚未最终完成，并要求通过指定门户按时提交表格、理解归档流程及回复确认收到。',
      provenance: 'inference',
      evidenceQuotes: [
        'Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.',
        'Reply to confirm receipt.',
      ],
      citationIds: [],
      confidence: 0.99,
    },
    terms: [
      {
        surface: 'provisional',
        kind: 'general_term',
        explanation: '这里表示登记仍是暂定状态，要等虚构的归档流程完成后才不再是该状态。',
        verificationIndex: null,
        provenance: 'inference',
        evidenceQuotes: ['Registration remains provisional until this fictional intake process is complete.'],
        citationIds: [],
        confidence: 0.99,
      },
      {
        surface: 'Wren-7 Intake Form',
        kind: 'form',
        explanation: '这是这项虚构归档流程要求签字并提交的表格。',
        verificationIndex: null,
        provenance: 'inference',
        evidenceQuotes: ['signed Wren-7 Intake Form'],
        citationIds: [],
        confidence: 0.99,
      },
    ],
    contexts: [{
      label: 'Northstar Intake',
      kind: 'institutional_process',
      explanation: '这是一个以门户收据记录表格已进入流程的虚构机构归档流程。',
      whatItIs: 'Northstar Intake 是虚构 Alderbridge Institute 的机构归档流程。',
      whyItMatters: '门户收据是确认提交已进入该流程的记录。',
      whatToDo: '通过 LanternGate 门户提交签字后的 Wren-7 Intake Form。',
      verificationIndex: null,
      provenance: 'inference',
      evidenceQuotes: [
        'At the fictional Alderbridge Institute, the invented Northstar Intake is an institutional filing process: applicants must submit the signed Wren-7 Intake Form through the LanternGate portal, and the portal receipt is the process record confirming that the submission entered the intake.',
      ],
      citationIds: [],
      confidence: 0.99,
    }],
    deadlines: [{
      whenText: '5:00 PM on 30 September 2099',
      normalizedAt: null,
      timezone: null,
      condition: 'submit the signed Wren-7 Intake Form through the LanternGate portal',
      provenance: 'original',
      evidenceQuotes: ['5:00 PM on 30 September 2099'],
      citationIds: [],
      confidence: 1,
    }],
    materials: [{
      name: 'signed Wren-7 Intake Form',
      requirement: 'required',
      details: null,
      provenance: 'original',
      evidenceQuotes: ['submit the signed Wren-7 Intake Form through the LanternGate portal'],
      citationIds: [],
      confidence: 1,
    }],
    nextSteps: [
      {
        action: '在截止时间前通过 LanternGate 门户提交签字后的 Wren-7 Intake Form',
        actor: 'user',
        urgency: 'before_deadline',
        mandatory: true,
        deadlineIndex: 0,
        provenance: 'inference',
        evidenceQuotes: ['Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.'],
        citationIds: [],
        confidence: 0.99,
      },
      {
        action: '回复确认收到',
        actor: 'user',
        urgency: 'now',
        mandatory: true,
        deadlineIndex: null,
        provenance: 'inference',
        evidenceQuotes: ['Reply to confirm receipt.'],
        citationIds: [],
        confidence: 0.99,
      },
    ],
    verifications: [],
    warnings: [],
  };
}

async function main() {
  const {
    OLLAMA_DOWNLOAD_URL,
    buildConnectionRecoveryPlan,
  } = await import('../src/renderer/utils/connectionRecovery.mjs');
  const {
    describeConnectionTestExitIntent,
    didConnectionTestFinishBeforeStop,
    isConnectionTestStopConfirmed,
  } = await import('../src/renderer/utils/connectionTestExit.mjs');
  const {
    CONNECTION_CODES,
    CONNECTION_STATUSES,
    PROVIDER_CONNECTION_TIMEOUT_MS,
    testProviderConnection,
  } = require('../src/main/provider-connection');
  const {
    FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    getRepresentativeStructuredBriefChecks,
    isRepresentativeStructuredBrief,
    testFullAnalysisCompatibility,
    testProviderReadiness,
  } = require('../src/main/provider-readiness');
  const { CUSTOM_ENDPOINT_ERROR_CODES } = require('../src/main/custom-endpoint-fetch');
  const { analyzeModelOutput } = require('../src/main/analysis');
  const {
    PROVIDER_CONNECTION_CANCEL_ACK_MS,
    waitForProviderConnectionStop,
  } = require('../src/main/provider-connection-cancellation');
  const {
    validateEndpointUrl,
    validateOllamaEndpointUrl,
    validateProviderConnectionTestOptions,
  } = require('../src/main/validation');

  assert.equal(PROVIDER_CONNECTION_CANCEL_ACK_MS, 2000);
  assert.equal(describeConnectionTestExitIntent({ kind: 'close' }).confirmLabel, '停止验证并返回');
  assert.deepEqual(
    describeConnectionTestExitIntent({ kind: 'close' }, { guidedSetup: true }),
    {
      actionLabel: '返回首次使用选择',
      confirmLabel: '停止验证并返回首次使用选择',
      safeLabel: '继续等待',
    },
  );
  assert.equal(describeConnectionTestExitIntent({ kind: 'backend' }).actionLabel, '切换分析服务');
  assert.equal(describeConnectionTestExitIntent({ kind: 'location' }).confirmLabel, '停止验证并切换位置');
  assert.equal(isConnectionTestStopConfirmed({ status: 'cancelled' }), true);
  assert.equal(isConnectionTestStopConfirmed({ status: 'still-running' }), false);
  assert.equal(didConnectionTestFinishBeforeStop({ status: 'not-running' }), true);
  let releaseSettledTask;
  const settledTask = new Promise((resolve) => { releaseSettledTask = resolve; });
  const acknowledgedStop = waitForProviderConnectionStop(settledTask, { timeoutMs: 50 });
  releaseSettledTask();
  assert.equal(await acknowledgedStop, true);
  assert.equal(
    await waitForProviderConnectionStop(new Promise(() => {}), { timeoutMs: 5 }),
    false,
    'a cancellation request must not claim success when the task never settles'
  );

  const localRecovery = buildConnectionRecoveryPlan({
    code: 'unreachable',
    backend: 'ollama',
    model: 'qwen2.5',
  });
  assert.equal(localRecovery.steps.length, 3);
  assert.equal(localRecovery.steps[0].action.value, OLLAMA_DOWNLOAD_URL);
  assert.equal(localRecovery.steps[1].action.value, 'ollama serve');
  assert.equal(localRecovery.steps[2].action.value, 'ollama pull qwen2.5');
  assert.equal(localRecovery.actions.some((action) => action.kind === 'switch-online'), true);

  const unsafeModelRecovery = buildConnectionRecoveryPlan({
    code: 'model-not-found',
    backend: 'ollama',
    model: 'qwen2.5; rm -rf unsafe',
  });
  assert.equal(unsafeModelRecovery.steps[0].command, null,
    'untrusted model IDs must never be interpolated into copied shell commands');
  assert.equal(unsafeModelRecovery.steps[0].action.kind, 'focus');
  assert.equal(buildConnectionRecoveryPlan({
    code: 'model-not-found', backend: 'ollama', model: '--help',
  }).steps[0].command, null, 'option-like model IDs must not become copied commands');

  const customCredentialRecovery = buildConnectionRecoveryPlan({
    code: 'unauthorized',
    backend: 'custom',
    model: 'private-model',
  });
  assert.equal(customCredentialRecovery.actions[0].kind, 'focus');
  assert.equal(customCredentialRecovery.actions[0].value, 'provider-custom-key-input');
  assert.equal(customCredentialRecovery.actions.some((action) => action.kind === 'retry'), false,
    'a rejected credential must not offer a same-key retry');

  const unsupportedRecovery = buildConnectionRecoveryPlan({
    code: 'unsupported',
    backend: 'custom',
    model: 'private-model',
  });
  assert.match(unsupportedRecovery.description, /完整分析仍保持关闭/);

  const onlineUnreachableRecovery = buildConnectionRecoveryPlan({
    code: 'unreachable', backend: 'openai', model: 'gpt-4o',
  });
  assert.match(onlineUnreachableRecovery.title, /网络|服务状态/);
  assert.doesNotMatch(JSON.stringify(onlineUnreachableRecovery), /本机服务|服务地址/,
    'online-provider recovery must not send users to local-service or endpoint settings');
  assert.equal(onlineUnreachableRecovery.actions[0].kind, 'retry');

  const customUnreachableRecovery = buildConnectionRecoveryPlan({
    code: 'unreachable', backend: 'custom', model: 'private-model',
  });
  assert.match(JSON.stringify(customUnreachableRecovery), /自定义服务地址/,
    'custom-provider recovery must point users to their configured endpoint');

  const temporarilyUnavailableRecovery = buildConnectionRecoveryPlan({
    code: 'service-unavailable', backend: 'anthropic', model: 'claude-sonnet-4-6',
  });
  assert.match(temporarilyUnavailableRecovery.title, /暂时不可用/);
  assert.doesNotMatch(JSON.stringify(temporarilyUnavailableRecovery), /模型|本机|服务地址/,
    'temporary online-service failure must not blame the model or local configuration');
  assert.equal(temporarilyUnavailableRecovery.actions[0].kind, 'retry');

  const customTimeoutRecovery = buildConnectionRecoveryPlan({
    code: 'timeout', backend: 'custom', model: 'private-model',
  });
  assert.equal(customTimeoutRecovery.steps[1].action.value, 'provider-connection-input');

  const incompatibleRecovery = buildConnectionRecoveryPlan({
    code: 'structured-output-invalid', backend: 'ollama', model: 'small-reasoning-model',
  });
  assert.equal(incompatibleRecovery.steps[0].action.value, 'provider-model-input');
  assert.match(incompatibleRecovery.description, /结构与证据校验/);

  const generationRecovery = buildConnectionRecoveryPlan({
    code: 'generation-failed', backend: 'openai', model: 'test-model',
  });
  assert.equal(generationRecovery.steps[0].action.value, 'provider-model-input');
  assert.match(generationRecovery.description, /没有使用你的任务内容/);

  assert.equal(PROVIDER_CONNECTION_TIMEOUT_MS, 7000);
  assert.deepEqual(validateProviderConnectionTestOptions(undefined), {});
  assert.throws(() => validateProviderConnectionTestOptions({ sourceText: 'private source' }));
  assert.equal(validateEndpointUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(validateEndpointUrl('http://localhost:11434'), 'http://127.0.0.1:11434');
  assert.equal(validateOllamaEndpointUrl('http://localhost:11434'), 'http://127.0.0.1:11434');
  assert.throws(() => validateOllamaEndpointUrl('https://api.example.com/ollama'));
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

  const anthropicOverloaded = await testProviderConnection({
    activeBackend: 'anthropic',
    activeModel: 'claude-sonnet-4-6',
    anthropicApiKey: 'test-anthropic-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({ statusCode: 529 }),
  });
  assert.deepEqual(anthropicOverloaded, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.SERVICE_UNAVAILABLE,
  }, 'Anthropic HTTP 529 must use temporary-service recovery');

  const cloudMetadataUnavailableResults = [];
  for (const [backend, activeModel, keyName] of [
    ['openai', 'gpt-4o', 'openaiApiKey'],
    ['anthropic', 'claude-sonnet-4-6', 'anthropicApiKey'],
    ['deepseek', 'deepseek-v4-flash', 'deepseekApiKey'],
  ]) {
    for (const statusCode of [500, 502, 503, 504]) {
      const result = await testProviderConnection({
        activeBackend: backend,
        activeModel,
        [keyName]: 'test-key',
      }, {
        lookup: publicLookup,
        httpsRequest: createRequestImpl({ statusCode }),
      });
      assert.deepEqual(result, {
        status: CONNECTION_STATUSES.FAILED,
        code: CONNECTION_CODES.SERVICE_UNAVAILABLE,
      }, `${backend} metadata HTTP ${statusCode} must use temporary-service recovery`);
      cloudMetadataUnavailableResults.push(result);
    }
  }

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

  for (const ollamaBaseUrl of [
    'https://api.example.com/ollama',
    'https://localhost/ollama',
    'http://api.example.com:11434',
  ]) {
    let unsafeOllamaRequests = 0;
    let unsafeOllamaLookups = 0;
    const unsafeOllama = await testProviderConnection({
      activeBackend: 'ollama',
      activeModel: 'qwen2.5',
      ollamaBaseUrl,
    }, {
      lookup: async () => {
        unsafeOllamaLookups += 1;
        return publicLookup();
      },
      httpRequest: createRequestImpl({ inspect: () => { unsafeOllamaRequests += 1; } }),
      httpsRequest: createRequestImpl({ inspect: () => { unsafeOllamaRequests += 1; } }),
    });
    assert.deepEqual(unsafeOllama, {
      status: CONNECTION_STATUSES.FAILED,
      code: CONNECTION_CODES.UNSAFE_ENDPOINT,
    });
    assert.equal(unsafeOllamaLookups, 0, 'unsafe Ollama settings must fail before DNS');
    assert.equal(unsafeOllamaRequests, 0, 'unsafe Ollama settings must fail before any request');
  }

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

  const paymentRequired = await testProviderConnection({
    activeBackend: 'openai', activeModel: 'gpt-4o', openaiApiKey: 'test-key',
  }, {
    lookup: publicLookup,
    httpsRequest: createRequestImpl({ statusCode: 402 }),
  });
  assert.deepEqual(paymentRequired, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.RATE_LIMITED,
  }, 'HTTP 402 must lead to the quota/rate-limit recovery');

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

  let compatibilityRequest;
  const ready = await testProviderReadiness({
    activeBackend: 'ollama',
    activeModel: 'qwen2.5',
  }, {
    testProviderConnection: async () => ({
      status: CONNECTION_STATUSES.CONNECTED,
      code: CONNECTION_CODES.OK,
    }),
    processText: async (options) => {
      compatibilityRequest = options;
      return {
        result: JSON.stringify(createCompatibilityCandidate()),
        processingTimeMs: 25,
        responseKind: 'action_brief_candidate',
      };
    },
  });
  assert.deepEqual(ready, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK });
  assert.equal(compatibilityRequest.text, FULL_ANALYSIS_COMPATIBILITY_SOURCE);
  assert.equal(compatibilityRequest.ignoreCustomPrompt, true);
  assert.equal(compatibilityRequest.languageHint, 'en');
  assert.equal(FULL_ANALYSIS_COMPATIBILITY_SOURCE.includes('fictional'), true);
  assert.match(FULL_ANALYSIS_COMPATIBILITY_SOURCE, /Every name, organization, form, portal, and event[^.]+fictional/);
  assert.match(FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    /Registration remains provisional until this fictional intake process is complete\./);
  assert.match(FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    /ordinary status phrase "on hold"[\s\S]*reply to ask which required item is missing/);
  assert.match(FULL_ANALYSIS_COMPATIBILITY_SOURCE, /Northstar Intake is an institutional filing process/);

  const normalizeCompatibilityCandidate = (candidate) => analyzeModelOutput({
    sourceText: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    rawOutput: JSON.stringify(candidate),
    provider: 'test-provider',
    model: 'test-model',
    processingTimeMs: 25,
  });
  const representativeBrief = normalizeCompatibilityCandidate(createCompatibilityCandidate());
  assert.equal(isRepresentativeStructuredBrief(representativeBrief), true);
  assert.equal(
    Object.values(getRepresentativeStructuredBriefChecks(representativeBrief)).every(Boolean),
    true,
    'the positive fixture must exercise every maturity capability in the readiness gate'
  );

  const portalTermCandidate = createCompatibilityCandidate();
  portalTermCandidate.terms[1] = {
    surface: 'LanternGate portal',
    kind: 'portal',
    explanation: '这是该虚构流程指定用于正式提交表格的门户。',
    verificationIndex: null,
    provenance: 'inference',
    evidenceQuotes: ['LanternGate portal'],
    citationIds: [],
    confidence: 0.99,
  };
  assert.equal(
    isRepresentativeStructuredBrief(normalizeCompatibilityCandidate(portalTermCandidate)),
    true,
    'a grounded portal term is a valid professional-term capability example'
  );

  const ordinaryPhraseCandidate = createCompatibilityCandidate();
  ordinaryPhraseCandidate.terms[0] = {
    surface: 'on hold',
    kind: 'general_term',
    explanation: '这里表示先暂停，不要再次发送副本，而应询问缺少哪项材料。',
    verificationIndex: null,
    provenance: 'inference',
    evidenceQuotes: [
      'The ordinary status phrase "on hold" appears in this fictional process: if the LanternGate portal displays it, pause before sending another copy and reply to ask which required item is missing.',
    ],
    citationIds: [],
    confidence: 0.99,
  };
  assert.equal(
    isRepresentativeStructuredBrief(normalizeCompatibilityCandidate(ordinaryPhraseCandidate)),
    true,
    'a grounded action-relevant ordinary phrase is a valid general-term capability example'
  );

  const irrelevantGeneralTerm = createCompatibilityCandidate();
  irrelevantGeneralTerm.terms[0] = {
    ...ordinaryPhraseCandidate.terms[0],
    surface: 'fictional',
    explanation: '这里表示内容是虚构的。',
    evidenceQuotes: ['Every name, organization, form, portal, and event in this message is fictional.'],
  };
  assert.equal(
    isRepresentativeStructuredBrief(normalizeCompatibilityCandidate(irrelevantGeneralTerm)),
    false,
    'an unrelated ordinary word must not satisfy the action-language capability gate'
  );

  const withoutGeneralTerm = structuredClone(representativeBrief);
  withoutGeneralTerm.terms = withoutGeneralTerm.terms.filter((term) => term.kind !== 'general_term');
  assert.equal(isRepresentativeStructuredBrief(withoutGeneralTerm), false,
    'omitting the action-relevant ordinary term must fail readiness');

  const misclassifiedGeneralTerm = structuredClone(representativeBrief);
  misclassifiedGeneralTerm.terms[0].kind = 'specialist_term';
  assert.equal(isRepresentativeStructuredBrief(misclassifiedGeneralTerm), false,
    'the provisional status word must be classified specifically as general_term');

  const weakGeneralTermEvidence = structuredClone(representativeBrief);
  weakGeneralTermEvidence.terms[0].provenance.evidence = structuredClone(
    representativeBrief.materials[0].provenance.evidence
  );
  assert.equal(isRepresentativeStructuredBrief(weakGeneralTermEvidence), false,
    'unrelated exact source evidence must not support the ordinary term');

  const oversizedGeneralTerm = structuredClone(representativeBrief);
  oversizedGeneralTerm.terms[0].surface = FULL_ANALYSIS_COMPATIBILITY_SOURCE;
  oversizedGeneralTerm.terms[0].provenance.evidence = [{
    kind: 'source',
    sourceId: representativeBrief.source.id,
    quote: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    start: 0,
    end: FULL_ANALYSIS_COMPATIBILITY_SOURCE.length,
    match: 'exact',
  }];
  assert.equal(isRepresentativeStructuredBrief(oversizedGeneralTerm), false,
    'an entire sentence or message must not masquerade as one ordinary term');

  const withoutProfessionalTerm = structuredClone(representativeBrief);
  withoutProfessionalTerm.terms = withoutProfessionalTerm.terms.filter((term) => (
    term.kind !== 'form' && term.kind !== 'portal'
  ));
  assert.equal(isRepresentativeStructuredBrief(withoutProfessionalTerm), false,
    'omitting a grounded form or portal term must fail readiness');

  const weakProfessionalTermEvidence = structuredClone(representativeBrief);
  weakProfessionalTermEvidence.terms[1].provenance.evidence = structuredClone(
    representativeBrief.terms[0].provenance.evidence
  );
  assert.equal(isRepresentativeStructuredBrief(weakProfessionalTermEvidence), false,
    'ordinary-word evidence must not stand in for the professional form term');

  const withoutProcessContext = structuredClone(representativeBrief);
  withoutProcessContext.contexts = [];
  assert.equal(isRepresentativeStructuredBrief(withoutProcessContext), false,
    'omitting the necessary institutional or social process context must fail readiness');

  const weakProcessContextEvidence = structuredClone(representativeBrief);
  weakProcessContextEvidence.contexts[0].provenance.evidence = structuredClone(
    representativeBrief.terms[0].provenance.evidence
  );
  assert.equal(isRepresentativeStructuredBrief(weakProcessContextEvidence), false,
    'an unrelated source fragment must not ground the process context');

  const portalOnlyProcessEvidence = structuredClone(representativeBrief);
  portalOnlyProcessEvidence.contexts[0].provenance.evidence = structuredClone(
    representativeBrief.terms[1].provenance.evidence
  );
  assert.equal(isRepresentativeStructuredBrief(portalOnlyProcessEvidence), false,
    'one portal name alone must not support the full process explanation');

  const wrongProcessKind = structuredClone(representativeBrief);
  wrongProcessKind.contexts[0].kind = 'social_process';
  assert.equal(isRepresentativeStructuredBrief(wrongProcessKind), false,
    'the explicitly institutional fixed process must not pass under another context kind');

  for (const [field, value] of [
    ['label', '无关'],
    ['whatItIs', '无关'],
    ['whyItMatters', '无关'],
    ['whatToDo', '无关'],
  ]) {
    const meaninglessContext = structuredClone(representativeBrief);
    meaninglessContext.contexts[0][field] = value;
    assert.equal(isRepresentativeStructuredBrief(meaninglessContext), false,
      `a context with unrelated ${field} content must fail readiness`);
  }

  for (const field of ['whatItIs', 'whyItMatters', 'whatToDo']) {
    const incompleteContext = structuredClone(representativeBrief);
    incompleteContext.contexts[0][field] = '   ';
    assert.equal(isRepresentativeStructuredBrief(incompleteContext), false,
      `a process context with an empty ${field} must fail readiness`);
  }

  const wrongDeadlineValue = structuredClone(representativeBrief);
  wrongDeadlineValue.deadlines[0].whenText = 'tomorrow';
  assert.equal(isRepresentativeStructuredBrief(wrongDeadlineValue), false,
    'correct evidence must not rescue an incorrect deadline value');

  const wrongMaterialValue = structuredClone(representativeBrief);
  wrongMaterialValue.materials[0].name = 'passport';
  assert.equal(isRepresentativeStructuredBrief(wrongMaterialValue), false,
    'correct evidence must not rescue an incorrect material value');

  const sentenceAsMaterial = structuredClone(representativeBrief);
  sentenceAsMaterial.materials[0].name =
    'Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.';
  assert.equal(isRepresentativeStructuredBrief(sentenceAsMaterial), false,
    'a whole instruction sentence must not masquerade as the required material name');

  const wrongSubmitAction = structuredClone(representativeBrief);
  wrongSubmitAction.nextSteps[0].action = '做一件无关的事';
  assert.equal(isRepresentativeStructuredBrief(wrongSubmitAction), false,
    'correct evidence must not rescue an unrelated submit action');

  const negatedSubmitAction = structuredClone(representativeBrief);
  negatedSubmitAction.nextSteps[0].action = 'Do not submit the Wren-7 Intake Form through LanternGate';
  assert.equal(isRepresentativeStructuredBrief(negatedSubmitAction), false,
    'a negated submission instruction must not satisfy the required action');

  const negatedReplyAction = structuredClone(representativeBrief);
  negatedReplyAction.nextSteps[1].action = 'Do not reply to confirm receipt';
  assert.equal(isRepresentativeStructuredBrief(negatedReplyAction), false,
    'a negated reply instruction must not satisfy the reply action');

  const conciseReceiptConfirmation = structuredClone(representativeBrief);
  conciseReceiptConfirmation.nextSteps[1].action = '确认已收到';
  assert.equal(isRepresentativeStructuredBrief(conciseReceiptConfirmation), true,
    'a concise receipt-confirmation action must remain compatible without a brittle reply verb');

  const negatedConciseReceiptConfirmation = structuredClone(representativeBrief);
  negatedConciseReceiptConfirmation.nextSteps[1].action = '不要确认收到';
  assert.equal(isRepresentativeStructuredBrief(negatedConciseReceiptConfirmation), false,
    'a negated receipt-confirmation action must not satisfy readiness');

  const alternateNegatedActions = structuredClone(representativeBrief);
  alternateNegatedActions.nextSteps[0].action = 'Never submit the Wren-7 Intake Form through LanternGate';
  alternateNegatedActions.nextSteps[1].action = 'Avoid replying to confirm receipt';
  assert.equal(isRepresentativeStructuredBrief(alternateNegatedActions), false,
    'alternate English negation must not satisfy representative actions');

  const negatedProcessContext = structuredClone(representativeBrief);
  negatedProcessContext.contexts[0].whatItIs = 'Northstar Intake is not a process';
  negatedProcessContext.contexts[0].whyItMatters = 'This receipt record does not confirm entry';
  negatedProcessContext.contexts[0].whatToDo = 'Do not submit the Wren-7 Intake Form through LanternGate';
  assert.equal(isRepresentativeStructuredBrief(negatedProcessContext), false,
    'negated or contradictory process guidance must not satisfy readiness');

  const softenedNegatedProcess = structuredClone(representativeBrief);
  softenedNegatedProcess.contexts[0].whatItIs = 'Northstar Intake is not really a process';
  softenedNegatedProcess.contexts[0].whatToDo = 'Never submit the Wren-7 Intake Form through LanternGate';
  assert.equal(isRepresentativeStructuredBrief(softenedNegatedProcess), false,
    'softened negation must not satisfy representative process guidance');

  const trivialTranslation = structuredClone(representativeBrief);
  trivialTranslation.translation.text = 'x';
  assert.equal(isRepresentativeStructuredBrief(trivialTranslation), false,
    'a non-empty but meaningless translation must not satisfy readiness');

  const keywordListTranslation = structuredClone(representativeBrief);
  keywordListTranslation.translation.text =
    'Northstar Intake Wren-7 LanternGate submit reply 5:00 PM 30 September 2099 process form portal';
  assert.equal(isRepresentativeStructuredBrief(keywordListTranslation), false,
    'an English keyword list must not masquerade as a Chinese translation');

  const synonymousChineseTranslation = structuredClone(representativeBrief);
  synonymousChineseTranslation.translation.text =
    '这是虚构的 Northstar Intake 机构流程，LanternGate 收据是表明提交进入流程的记录。登记仍是临时状态，如果被暂缓就等待。请在 2099 年 9 月 30 日下午 5:00 前，通过 LanternGate 交付已签署的 Wren-7 表单，之后回信确认已经收到。';
  assert.equal(isRepresentativeStructuredBrief(synonymousChineseTranslation), true,
    'a complete Chinese translation must not depend on one brittle submit/reply verb pair');

  const negatedDeadline = structuredClone(representativeBrief);
  negatedDeadline.deadlines[0].whenText = 'Not 5:00 PM on 30 September 2099';
  assert.equal(isRepresentativeStructuredBrief(negatedDeadline), false,
    'a negated date phrase must not satisfy the representative deadline');

  const unrelatedTermExplanations = structuredClone(representativeBrief);
  unrelatedTermExplanations.terms[0].explanation = '这是一段完全无关的说明。';
  unrelatedTermExplanations.terms[1].explanation = '这也是一段完全无关的说明。';
  assert.equal(isRepresentativeStructuredBrief(unrelatedTermExplanations), false,
    'unrelated explanations must not satisfy ordinary and professional term readiness');

  const negatedTermExplanations = structuredClone(representativeBrief);
  negatedTermExplanations.terms[0].explanation = '这里并不是暂定状态。';
  negatedTermExplanations.terms[1].explanation = '这不是表格，也不用于提交。';
  assert.equal(isRepresentativeStructuredBrief(negatedTermExplanations), false,
    'negated keywords must not masquerade as useful term explanations');

  const adversarialTermExplanations = structuredClone(representativeBrief);
  adversarialTermExplanations.terms[0].explanation = '这绝非暂定状态。';
  adversarialTermExplanations.terms[1].explanation = '它与表格和提交无关。';
  assert.equal(isRepresentativeStructuredBrief(adversarialTermExplanations), false,
    'contradictory term explanations must fail even when they repeat expected keywords');

  const hollowProcessReason = structuredClone(representativeBrief);
  hollowProcessReason.contexts[0].whyItMatters = 'Track and trace are merely words.';
  assert.equal(isRepresentativeStructuredBrief(hollowProcessReason), false,
    'overlapping record words alone must not satisfy the process reason');

  const confirmNothingProcessReason = structuredClone(representativeBrief);
  confirmNothingProcessReason.contexts[0].whyItMatters = 'Track and trace confirm nothing.';
  assert.equal(isRepresentativeStructuredBrief(confirmNothingProcessReason), false,
    'record and confirmation keywords in a contradictory sentence must not satisfy the process reason');

  const wrongProcessTargets = structuredClone(representativeBrief);
  wrongProcessTargets.contexts[0].whatToDo = '提交错误表格到错误门户。';
  assert.equal(isRepresentativeStructuredBrief(wrongProcessTargets), false,
    'process guidance must retain the exact representative form and portal identifiers');

  const decoyProcessTargets = structuredClone(representativeBrief);
  decoyProcessTargets.contexts[0].whatToDo = '提交错误表格到错误门户。Wren-7 和 LanternGate 仅供参考。';
  assert.equal(isRepresentativeStructuredBrief(decoyProcessTargets), false,
    'identifiers in an unrelated clause must not rescue incorrect process guidance');

  const chineseFillerTranslation = structuredClone(representativeBrief);
  chineseFillerTranslation.translation.text =
    '这是一段与任务无关的中文填充说明，只重复 Northstar Intake、Wren-7、LanternGate、2099 年 9 月 30 日下午 5:00，没有说明真实动作或流程。';
  assert.equal(isRepresentativeStructuredBrief(chineseFillerTranslation), false,
    'Chinese filler plus fixed entities and dates must not satisfy translation readiness');

  const keywordStuffedChineseTranslation = structuredClone(representativeBrief);
  keywordStuffedChineseTranslation.translation.text =
    '这是与原文无关的中文填充和关键词罗列：虚构 Northstar Intake 流程，暂定暂停，收据确认，在 2099 年 9 月 30 日下午 5:00 通过 LanternGate 提交 Wren-7，然后回复确认收到。';
  assert.equal(isRepresentativeStructuredBrief(keywordStuffedChineseTranslation), false,
    'keyword-stuffed Chinese filler must not masquerade as a representative translation');

  const decoyProcessFirst = structuredClone(representativeBrief);
  decoyProcessFirst.contexts.unshift({
    ...structuredClone(representativeBrief.contexts[0]),
    id: 'context-decoy',
    label: '无关机构流程',
    whatItIs: '这是一项无关流程。',
    whyItMatters: '与当前任务无关。',
    whatToDo: '无需处理。',
  });
  assert.equal(isRepresentativeStructuredBrief(decoyProcessFirst), true,
    'an invalid first context must not hide a later valid representative process context');

  const unlinkedSubmitDeadline = structuredClone(representativeBrief);
  unlinkedSubmitDeadline.nextSteps[0].deadlineId = null;
  assert.equal(isRepresentativeStructuredBrief(unlinkedSubmitDeadline), false,
    'the required submission must remain linked to the representative deadline');

  const expandedEvidenceCandidate = createCompatibilityCandidate();
  expandedEvidenceCandidate.deadlines[0].evidenceQuotes = [
    'Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.',
  ];
  expandedEvidenceCandidate.materials[0].evidenceQuotes = [
    'Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.',
  ];
  const expandedEvidence = await testFullAnalysisCompatibility({
    activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash',
  }, {
    processText: async () => ({
      result: JSON.stringify(expandedEvidenceCandidate),
      processingTimeMs: 25,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(expandedEvidence, {
    status: CONNECTION_STATUSES.CONNECTED,
    code: CONNECTION_CODES.OK,
  }, 'a longer exact source quote must remain valid evidence for the representative requirement');

  const weakActionEvidenceCandidate = createCompatibilityCandidate();
  weakActionEvidenceCandidate.nextSteps[0].evidenceQuotes = ['signed Wren-7 Intake Form'];
  const weakActionEvidence = await testFullAnalysisCompatibility({
    activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash',
  }, {
    processText: async () => ({
      result: JSON.stringify(weakActionEvidenceCandidate),
      processingTimeMs: 25,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(weakActionEvidence, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID,
  }, 'mentioning the material without evidence of the submit action must not unlock setup');

  const weakReplyEvidenceCandidate = createCompatibilityCandidate();
  weakReplyEvidenceCandidate.nextSteps[1].evidenceQuotes = ['confirm receipt'];
  const weakReplyEvidence = await testFullAnalysisCompatibility({
    activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash',
  }, {
    processText: async () => ({
      result: JSON.stringify(weakReplyEvidenceCandidate),
      processingTimeMs: 25,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(weakReplyEvidence, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID,
  }, 'an evidence fragment that omits the reply action must not unlock setup');

  let generationCalls = 0;
  const metadataFailure = await testProviderReadiness({ activeBackend: 'openai' }, {
    testProviderConnection: async () => ({
      status: CONNECTION_STATUSES.FAILED,
      code: CONNECTION_CODES.UNAUTHORIZED,
    }),
    processText: async () => {
      generationCalls += 1;
      throw new Error('must not run');
    },
  });
  assert.deepEqual(metadataFailure, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.UNAUTHORIZED,
  });
  assert.equal(generationCalls, 0, 'a failed metadata check must not start a generation request');

  const customReady = await testProviderReadiness({
    activeBackend: 'custom', activeModel: 'private-model',
  }, {
    testProviderConnection: async () => ({
      status: CONNECTION_STATUSES.INCONCLUSIVE,
      code: CONNECTION_CODES.UNSUPPORTED,
    }),
    processText: async () => ({
      result: JSON.stringify(createCompatibilityCandidate()),
      processingTimeMs: 30,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(customReady, { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK },
    'a real structured generation can prove custom-provider readiness even without a model-list endpoint');

  const invalidStructuredOutput = await testFullAnalysisCompatibility({
    activeBackend: 'ollama', activeModel: 'reasoning-model',
  }, {
    processText: async () => ({
      result: 'I can explain the message, but I did not return the required JSON.',
      processingTimeMs: 10,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(invalidStructuredOutput, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID,
  });

  const emptyStructuredCandidate = createCompatibilityCandidate();
  emptyStructuredCandidate.terms = [];
  emptyStructuredCandidate.contexts = [];
  emptyStructuredCandidate.deadlines = [];
  emptyStructuredCandidate.materials = [];
  emptyStructuredCandidate.nextSteps = [];
  const emptyStructuredOutput = await testFullAnalysisCompatibility({
    activeBackend: 'ollama', activeModel: 'weak-json-model',
  }, {
    processText: async () => ({
      result: JSON.stringify(emptyStructuredCandidate),
      processingTimeMs: 10,
      responseKind: 'action_brief_candidate',
    }),
  });
  assert.deepEqual(emptyStructuredOutput, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID,
  }, 'valid JSON without the representative action, term, context, material, deadline, and reply evidence must not unlock setup');

  const generationFailed = await testFullAnalysisCompatibility({
    activeBackend: 'openai', activeModel: 'test-model',
  }, {
    processText: async () => { throw new Error('provider rejected generation'); },
  });
  assert.deepEqual(generationFailed, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.GENERATION_FAILED,
  });

  const customGenerationNotFound = await testFullAnalysisCompatibility({
    activeBackend: 'custom', activeModel: 'private-model',
  }, {
    processText: async () => {
      const error = new Error('自定义服务拒绝了请求');
      error.code = 'custom-provider-http-error';
      error.status = 404;
      throw error;
    },
  });
  assert.deepEqual(customGenerationNotFound, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.GENERATION_FAILED,
  }, 'a custom generation POST 404 must not be presented as a missing model');

  const explicitMissingModel = await testFullAnalysisCompatibility({
    activeBackend: 'openai', activeModel: 'retired-model',
  }, {
    processText: async () => {
      const error = new Error('model not found');
      error.code = 'model_not_found';
      error.status = 404;
      throw error;
    },
  });
  assert.deepEqual(explicitMissingModel, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.MODEL_NOT_FOUND,
  }, 'an explicit provider model-not-found signal must remain actionable');

  const quotaRequired = await testFullAnalysisCompatibility({
    activeBackend: 'openai', activeModel: 'gpt-4o',
  }, {
    processText: async () => {
      const error = new Error('private provider response');
      error.status = 402;
      throw error;
    },
  });
  assert.deepEqual(quotaRequired, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.RATE_LIMITED,
  }, 'HTTP 402 generation failures must lead to the quota/rate-limit recovery');

  const anthropicGenerationOverloaded = await testFullAnalysisCompatibility({
    activeBackend: 'anthropic', activeModel: 'claude-sonnet-4-6',
  }, {
    processText: async () => {
      const error = new Error('private provider response');
      error.status = 529;
      throw error;
    },
  });
  assert.deepEqual(anthropicGenerationOverloaded, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.SERVICE_UNAVAILABLE,
  }, 'Anthropic HTTP 529 generation failures must use temporary-service recovery');

  const cloudServiceUnavailableResults = [];
  for (const backend of ['openai', 'anthropic', 'deepseek']) {
    for (const status of [500, 502, 503, 504]) {
      const result = await testFullAnalysisCompatibility({
        activeBackend: backend,
        activeModel: 'fixture-model',
      }, {
        processText: async () => {
          const error = new Error('private provider response');
          error.status = status;
          throw error;
        },
      });
      assert.deepEqual(result, {
        status: CONNECTION_STATUSES.FAILED,
        code: CONNECTION_CODES.SERVICE_UNAVAILABLE,
      }, `${backend} HTTP ${status} must use temporary-service recovery`);
      cloudServiceUnavailableResults.push(result);
    }
  }

  const redirectSensitiveValues = [
    'https://private-redirect.example/v1/chat/completions',
    'sk-private-redirect-key',
    'PRIVATE_REDIRECT_SOURCE_TEXT',
  ];
  const compatibilityRedirectRejected = await testProviderReadiness({
    activeBackend: 'custom',
    activeModel: 'private-custom-model',
    customEndpointUrl: redirectSensitiveValues[0],
    customEndpointApiKey: redirectSensitiveValues[1],
  }, {
    testProviderConnection: async () => ({
      status: CONNECTION_STATUSES.INCONCLUSIVE,
      code: CONNECTION_CODES.UNSUPPORTED,
    }),
    processText: async () => {
      const error = new Error(redirectSensitiveValues.join(' '));
      error.code = CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED;
      throw error;
    },
  });
  assert.deepEqual(compatibilityRedirectRejected, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.REDIRECT_REJECTED,
  }, 'a rejected formal compatibility POST redirect must remain actionable');
  for (const sensitiveValue of redirectSensitiveValues) {
    assert.equal(JSON.stringify(compatibilityRedirectRejected).includes(sensitiveValue), false,
      'compatibility redirect results must not expose endpoint, credential, or source details');
  }

  const readinessController = new AbortController();
  readinessController.abort();
  const cancelledReadiness = await testProviderReadiness({ activeBackend: 'openai' }, {
    signal: readinessController.signal,
    testProviderConnection: async () => ({
      status: CONNECTION_STATUSES.CONNECTED,
      code: CONNECTION_CODES.OK,
    }),
    processText: async () => { throw new Error('must not run'); },
  });
  assert.deepEqual(cancelledReadiness, {
    status: CONNECTION_STATUSES.FAILED,
    code: CONNECTION_CODES.CANCELLED,
  });

  for (const result of [
    openAi,
    anthropic,
    deepseek,
    ollama,
    customUnsupported,
    unauthorized,
    paymentRequired,
    anthropicOverloaded,
    ...cloudMetadataUnavailableResults,
    redirect,
    wrongMime,
    tooLarge,
    unsafe,
    cancelled,
    ready,
    metadataFailure,
    customReady,
    invalidStructuredOutput,
    emptyStructuredOutput,
    generationFailed,
    customGenerationNotFound,
    explicitMissingModel,
    quotaRequired,
    anthropicGenerationOverloaded,
    ...cloudServiceUnavailableResults,
    compatibilityRedirectRejected,
    cancelledReadiness,
  ]) {
    assert.deepEqual(Object.keys(result).sort(), ['code', 'status']);
    assert.equal(JSON.stringify(result).includes('test-'), false, 'results must not expose keys or request metadata');
  }

  const providerSource = fs.readFileSync(path.join(root, 'src/main/provider-connection.js'), 'utf8');
  const readinessSource = fs.readFileSync(path.join(root, 'src/main/provider-readiness.js'), 'utf8');
  const liveDiagnosticSource = fs.readFileSync(path.join(root, 'scripts/check-deepseek-live.js'), 'utf8');
  const { compatibilityDiagnostics } = require('./check-deepseek-live');
  const diagnosticSentinel = 'PRIVATE_LIVE_DIAGNOSTIC_SENTINEL';
  const diagnosticPayload = compatibilityDiagnostics({
    status: diagnosticSentinel,
    analysisProvenance: { responseKind: diagnosticSentinel },
    warnings: [{ code: diagnosticSentinel, message: diagnosticSentinel }],
    terms: [{
      surface: 'provisional',
      kind: diagnosticSentinel,
      explanation: diagnosticSentinel,
      provenance: { evidence: [{ match: 'exact', quote: 'provisional' }] },
    }],
    contexts: [{
      kind: 'institutional_process',
      whatItIs: diagnosticSentinel,
      whyItMatters: diagnosticSentinel,
      whatToDo: diagnosticSentinel,
      provenance: { evidence: [{ match: 'exact', quote: diagnosticSentinel }] },
    }],
  });
  assert.equal(JSON.stringify(diagnosticPayload).includes(diagnosticSentinel), false,
    'live compatibility diagnostics must reduce generated content to fixed booleans and counts');
  const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/components/SettingsPanel.jsx'), 'utf8');
  const recoverySource = fs.readFileSync(path.join(root, 'src/renderer/components/ConnectionRecovery.jsx'), 'utf8');
  const settingsHookSource = fs.readFileSync(path.join(root, 'src/renderer/hooks/useSettings.js'), 'utf8');
  const demoIpcSource = fs.readFileSync(path.join(root, 'src/renderer/hooks/useIpc.js'), 'utf8');
  const apiKeyInputSource = fs.readFileSync(path.join(root, 'src/renderer/components/ApiKeyInput.jsx'), 'utf8');
  const modelSelectorSource = fs.readFileSync(path.join(root, 'src/renderer/components/ModelSelector.jsx'), 'utf8');
  const settingsStyles = fs.readFileSync(path.join(root, 'src/renderer/components/SettingsPanel.css'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(providerSource, /console\.(?:log|warn|error)/, 'provider tests must not log secrets, URLs, or bodies');
  assert.doesNotMatch(providerSource, /sourceText|rawText|prompt|message[s]?\s*:/i,
    'provider tests must never accept or send source/inference payloads');
  assert.doesNotMatch(readinessSource, /console\.(?:log|warn|error)/,
    'readiness tests must not log generated output or configuration');
  assert.match(readinessSource, /FULL_ANALYSIS_COMPATIBILITY_SOURCE/);
  assert.match(readinessSource, /ignoreCustomPrompt: true/,
    'compatibility tests must use only the fixed fictional source and built-in prompt');
  assert.match(readinessSource, /isRepresentativeStructuredBrief/);
  assert.match(readinessSource, /brief\.deadlines\.find/);
  assert.match(readinessSource, /brief\.materials\.find/);
  assert.match(readinessSource, /brief\.nextSteps\.find/,
    'readiness must require representative grounded actions, materials, deadlines, and reply handling');
  assert.match(readinessSource, /brief\.terms\.some/);
  assert.match(readinessSource, /institutionalProcessContexts\.find/);
  assert.match(readinessSource, /general_term/);
  assert.match(readinessSource, /'form'[\s\S]{0,160}'portal'/);
  assert.match(readinessSource, /context\?\.kind === 'institutional_process'/);
  assert.doesNotMatch(readinessSource, /context\?\.kind === 'social_process'/);
  assert.match(readinessSource, /contextWhatItIs[\s\S]{0,240}contextWhyItMatters[\s\S]{0,240}contextWhatToDo/,
    'readiness must require grounded term classes and every process-context guidance field');
  assert.match(readinessSource, /evidence\?\.match === 'exact'/,
    'readiness evidence must come from an exact quote in the fixed source');
  assert.doesNotMatch(liveDiagnosticSource, /(?:apiKey|rawOutput)\s*:/,
    'live diagnostics must never include credentials or generated output in a result payload');
  assert.match(liveDiagnosticSource, /processText\(\{/,
    'the live check must use the production model request path');
  assert.match(liveDiagnosticSource, /ignoreCustomPrompt: true/);
  assert.match(liveDiagnosticSource, /if \(require\.main === module\)/,
    'the pure diagnostics helper must remain importable without starting a live request');
  assert.match(liveDiagnosticSource, /generalTerm/);
  assert.match(liveDiagnosticSource, /professionalTerm/);
  assert.match(liveDiagnosticSource, /contextSections/);
  assert.match(mainSource, /IPC_CHANNELS\.PROVIDER_CONNECTION_TEST/);
  assert.match(mainSource, /IPC_CHANNELS\.PROVIDER_CONNECTION_CANCEL/);
  assert.match(mainSource, /providerConnectionAbortController\?\.abort\(\)/);
  assert.match(mainSource, /await waitForProviderConnectionStop\(task\)/,
    'leaving settings must wait for the provider test to settle after abort');
  assert.match(mainSource, /status: settled && !providerConnectionInFlight \? 'cancelled' : 'still-running'/,
    'the main process must distinguish requested cancellation from confirmed task settlement');
  assert.match(mainSource, /providerConnectionInFlight \|\| llmRequestInFlight \|\| verificationRequestInFlight/,
    'readiness checks must not compete with an active user analysis or verification request');
  assert.match(mainSource, /if \(providerConnectionInFlight\) return userError\(USER_ERRORS\.PROCESSING_BUSY\)/,
    'a user analysis must not start while readiness is consuming the selected model');
  assert.match(mainSource, /validateProviderConnectionTestOptions\(options\)/);
  assert.match(mainSource,
    /const settingsSnapshot = store\.getAllSettings\(\);[\s\S]{0,320}testProviderReadiness\(settingsSnapshot, \{ signal: controller\.signal \}\)/,
    'readiness must use one stable settings snapshot for metadata and compatibility checks');
  assert.match(preloadSource, /'provider:connection-test'/);
  assert.match(preloadSource, /'provider:connection-cancel'/);
  assert.match(rendererSource, /内置、虚构的英文测试文本/);
  assert.match(rendererSource, /翻译、行动、术语、流程背景及其来源证据/);
  assert.match(rendererSource, /不会发送截图、剪贴板、你的任务原文或高级分析说明/);
  assert.match(rendererSource, /在线服务可能产生少量调用费用/);
  assert.match(rendererSource, /取消测试/);
  assert.match(rendererSource, /handleCancelConnectionTest/);
  assert.match(rendererSource, /验证仍在进行/);
  assert.match(rendererSource, /收到停止确认前不会离开设置/);
  assert.match(rendererSource, /没有收到停止确认/);
  assert.match(rendererSource, /验证已经完成/);
  assert.match(rendererSource, /查看验证结果/);
  assert.match(rendererSource, /isConnectionTestStopConfirmed\(response\)/);
  assert.match(rendererSource, /testProviderConnection/);
  assert.match(rendererSource, /hasUnsavedConnectionDraft/);
  assert.match(rendererSource, /credentialUpdateRequired/);
  assert.match(rendererSource, /result\.code === 'unauthorized' \|\| result\.code === 'missing-credentials'/,
    'a rejected credential must block another network test until the credential changes');
  assert.match(rendererSource, /请先更新并保存 API Key/);
  assert.match(rendererSource, /setCredentialUpdateRequired\(false\)[\s\S]{0,120}return saved/,
    'a successfully saved replacement credential must release the retry guard');
  assert.match(rendererSource, /onDraftStateChange=\{handleModelDraftState\}/);
  assert.match(rendererSource, /hasCurrentSuccessfulConnectionTest/);
  assert.match(rendererSource, /!hasCurrentSuccessfulConnectionTest/,
    'full analysis activation must require a successful current connection test');
  assert.match(rendererSource, /connectionTest\.connectionRevision !== connectionRevisionRef\.current/);
  assert.match(rendererSource, /connectionRevisionRef\.current === revision/,
    'an in-flight result must be discarded when provider credentials, endpoint, or model change');
  assert.match(rendererSource, /connectionRevision: revision/);
  assert.doesNotMatch(rendererSource, /processingConfigGeneration/,
    'optional analysis preferences must not invalidate a capability test that intentionally does not send them');
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
  assert.match(rendererSource, /完整分析能力验证通过/);
  assert.match(rendererSource, /当前模型能力不兼容/);
  assert.match(rendererSource, /没有连接到本机 Ollama/);
  assert.match(rendererSource, /inputId="provider-connection-input"/);
  assert.match(rendererSource, /inputId="provider-model-input"/);
  assert.match(recoverySource, /aria-label="连接恢复步骤"/);
  assert.match(recoverySource, /connection-recovery-notice/);
  assert.match(demoIpcSource, /DEMO_CONNECTION_RESULTS/,
    'development previews must support repeatable failure-state walkthroughs');
  assert.match(demoIpcSource, /demoConnectionCode === 'slow' \? 30000 : demoConnectionCode === 'race' \? 3000 : 450/,
    'development previews must keep the cancellable in-progress state inspectable');
  assert.match(demoIpcSource, /demoConnectionCancelCode === 'fail'/,
    'development previews must reproduce a missing cancellation acknowledgement');
  assert.match(demoIpcSource, /demoProviderConnectionPending\.resolve\(\{ status: 'failed', code: 'cancelled' \}\)/,
    'the preview cancellation must settle the original provider task before acknowledging stop');
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
  assert.match(modelSelectorSource, /<select[\s\S]*?id=\{inputId\}/,
    'known online providers must use a visible native model picker');
  assert.match(modelSelectorSource, /DeepSeek V4 Flash（推荐）/);
  assert.match(modelSelectorSource, /DeepSeek V4 Pro/);
  assert.match(modelSelectorSource, /当前已保存：/,
    'a saved online model outside the built-in list must remain selectable');
  assert.match(modelSelectorSource, /backend === 'ollama' \|\| backend === 'custom'/,
    'local and custom providers must retain editable model IDs');
  assert.doesNotMatch(modelSelectorSource, /onBlur=\{commit\}/,
    'models must not rely on hidden blur persistence');
  assert.match(rendererSource, /backend === LLM_BACKENDS\.CUSTOM && code === 'unreachable'/,
    'custom connection failure copy must explicitly name its configured endpoint');
  assert.match(rendererSource, /code === 'unreachable'[\s\S]{0,700}无法连接在线服务/,
    'online connection failure copy must avoid local-service instructions');
  assert.match(rendererSource, /'service-unavailable': \['服务暂时不可用'/);
  assert.match(rendererSource, /'rate-limited': \['请求受限', '[^']*(?:余额|额度)/,
    'HTTP 402 recovery must tell users to check account balance or quota');
  assert.match(settingsHookSource, /'service-unavailable'/,
    'the renderer must accept the precise temporary-service failure code');
  assert.match(rendererSource, /code === 'ok' && fullAnalysisEnabled[\s\S]{0,300}当前配置已可用/,
    'successful revalidation must acknowledge an already-enabled full-analysis mode');
  assert.match(rendererSource, /getConnectionResultCopy\([\s\S]{0,160}settings\.setupMode === SETUP_MODES\.FULL/,
    'the success copy must receive the persisted feature mode');
  assert.match(rendererSource, /settings\.setupMode === SETUP_MODES\.FULL\s*\? '连接信息已保存，可重新验证'/,
    'saved full-analysis settings must not be described as never verified after restart');
  assert.match(settingsStyles, /\.setting-save-status\.is-dirty/);
  assert.match(settingsStyles, /\.setting-save-button/);
  assert.match(settingsStyles, /\.connection-recovery-action:focus-visible/);
  assert.match(settingsStyles, /\.provider-connection-cancel-notice/);
  assert.match(settingsStyles, /\.settings-connection-exit-spinner/);
  assert.match(settingsStyles, /@media \(max-width: 620px\)[\s\S]*\.connection-recovery-steps/);
  for (const focusClass of [
    'settings-return-button',
    'backend-option-button',
    'setting-save-button',
    'provider-connection-test-button',
    'provider-connection-cancel-button',
    'full-analysis-enable-button',
  ]) {
    assert.match(settingsStyles, new RegExp(`\\.${focusClass}:focus-visible`), `${focusClass} needs a visible keyboard focus ring`);
  }
  assert.doesNotMatch(rendererSource, /const segmentBtnBase = \{[\s\S]*?outline:\s*'none'/,
    'backend choices must not suppress their keyboard focus indicator');

  console.log('provider readiness and full-analysis compatibility checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
