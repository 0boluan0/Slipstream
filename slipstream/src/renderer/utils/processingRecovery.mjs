const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  custom: '自定义服务',
  deepseek: 'DeepSeek',
  free_translate: '基础翻译服务',
  ollama: 'Ollama',
  openai: 'OpenAI',
});

const CREDENTIAL_ERRORS = new Set([
  'processing-key-missing',
  'processing-unauthorized',
]);

const MODEL_ERRORS = new Set([
  'model-not-found',
  'ollama-runtime-failed',
  'processing-invalid',
]);

const CONNECTION_ERRORS = new Set([
  'ollama-unavailable',
  'processing-location-unknown',
  'processing-unreachable',
]);

const TRANSIENT_ERRORS = new Set([
  'processing-rate-limited',
  'processing-service-unavailable',
  'processing-timeout',
  'processing-failed',
]);

const LOCAL_GUARD_ERRORS = new Set([
  'ocr-review-required',
]);

const FREE_TRANSLATION_FAILURES = new Set([
  ...CONNECTION_ERRORS,
  ...TRANSIENT_ERRORS,
]);

export function processingFailureMessage(errorCode, backend, defaultMessage) {
  if (backend !== 'free_translate' || !FREE_TRANSLATION_FAILURES.has(errorCode)) {
    return defaultMessage;
  }

  if (errorCode === 'processing-rate-limited') {
    return 'Google Translate 或备用 MyMemory 暂时限制了请求。无需检查 API Key；原文和上一份有效结果已保留，可稍后重试或改用其他处理方式。';
  }

  if (errorCode === 'processing-timeout') {
    return 'Google Translate 与备用 MyMemory 这次都没有及时返回完整翻译。原文和上一份有效结果已保留，可直接重试或改用其他处理方式。';
  }

  return 'Google Translate 与备用 MyMemory 这次都没有返回可用翻译。原文和上一份有效结果已保留，可直接重试或改用其他处理方式。';
}

export function describeProcessingRecovery(errorCode, backend) {
  if (typeof errorCode !== 'string' || !errorCode) return null;
  const provider = PROVIDER_LABELS[backend] || '当前分析服务';

  if (backend === 'free_translate' && FREE_TRANSLATION_FAILURES.has(errorCode)) {
    return {
      kind: 'translation-service',
      entryTarget: 'full-analysis',
      actionLabel: '改用本机或在线分析',
      priority: 'retry',
      notice: '这次 Google Translate 与备用 MyMemory 都没有完成翻译；原文和上一份有效结果仍在主面板。基础翻译没有可验证的账户设置。可选择本机 Ollama 或已有 API Key 的在线服务，或直接返回重试。',
    };
  }

  if (CREDENTIAL_ERRORS.has(errorCode)) {
    return {
      kind: 'credentials',
      entryTarget: 'processing-credentials',
      actionLabel: backend === 'ollama' ? '检查连接信息' : '更新并验证 API Key',
      priority: 'configure',
      notice: `这次 ${provider} 分析没有成功；原文和上一份有效结果仍在主面板。更新凭据并通过完整分析验证后，返回即可重试。`,
    };
  }

  if (MODEL_ERRORS.has(errorCode)) {
    return {
      kind: 'model',
      entryTarget: 'processing-model',
      actionLabel: '选择并验证模型',
      priority: 'configure',
      notice: `这次 ${provider} 分析没有生成可用结果；原文和上一份有效结果仍在主面板。选择可用模型并通过完整分析验证后，返回即可重试。`,
    };
  }

  if (CONNECTION_ERRORS.has(errorCode)) {
    const configurableEndpoint = backend === 'ollama' || backend === 'custom';
    return {
      kind: 'connection',
      entryTarget: configurableEndpoint ? 'processing-connection' : 'processing-test',
      actionLabel: configurableEndpoint ? '检查连接地址并验证' : '检查连接并验证',
      priority: 'configure',
      notice: `这次无法连接 ${provider}；原文和上一份有效结果仍在主面板。检查当前连接并通过完整分析验证后，返回即可重试。`,
    };
  }

  if (TRANSIENT_ERRORS.has(errorCode)) {
    return {
      kind: 'transient',
      entryTarget: 'processing-test',
      actionLabel: '验证当前服务',
      priority: 'retry',
      notice: `这次 ${provider} 请求暂时没有成功；原文和上一份有效结果仍在主面板。可先验证当前服务，或返回后直接重试。`,
    };
  }

  return null;
}

export function processingFailureCode(response, invalidBrief = false) {
  if (invalidBrief) return 'processing-invalid';
  const code = typeof response?.errorCode === 'string' ? response.errorCode : '';
  return LOCAL_GUARD_ERRORS.has(code) || describeProcessingRecovery(code, response?.backend)
    ? code
    : 'processing-failed';
}
