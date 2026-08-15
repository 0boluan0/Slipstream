export const PROCESSING_CONFIG_CHANGED_WARNING = '分析或核验设置已更新；原文已保留，请重新处理。';
export const PRESERVED_RESULT_CONFIG_CHANGED_WARNING = '分析或核验设置已更新；当前显示的是上次结果，请重新处理。';
export const SETUP_INCOMPLETE_WARNING = '完整分析配置尚未完成；当前基础翻译和原文已保留。完成验证并启用后再重新处理。';

export function appendUniqueWarning(current = '', message = '') {
  if (!message || current.includes(message)) return current;
  return [current, message].filter(Boolean).join(' ');
}

export function getProcessingConfigSignature(settings) {
  const providerDetails = {
    anthropic: settings.hasAnthropicApiKey,
    openai: settings.hasOpenaiApiKey,
    deepseek: settings.hasDeepseekApiKey,
    ollama: settings.ollamaBaseUrl,
    custom: `${settings.customEndpointUrl}\u0000${settings.hasCustomEndpointApiKey}`,
  }[settings.activeBackend] ?? '';
  return [
    settings.activeBackend,
    settings.activeModel,
    providerDetails,
    settings.customPrompt,
    settings.verificationPolicy,
  ].join('\u0000');
}

export function resolveSnapshotWarning(
  snapshot,
  currentSignature,
  message = '',
  configChangedWarning = PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
) {
  const snapshotWarning = snapshot?.processingConfigSignature === currentSignature
    ? snapshot?.warning || ''
    : appendUniqueWarning(
      snapshot?.warning || '',
      configChangedWarning,
    );
  return message ? appendUniqueWarning(snapshotWarning, message) : snapshotWarning;
}

export function shouldRestoreLastGoodAfterConfigChange(activeProcessing, snapshot) {
  return Boolean(activeProcessing?.retryOfLastGood && snapshot);
}

export function isProcessingConfigGenerationCurrent(requestGeneration, currentGeneration) {
  return Number.isSafeInteger(requestGeneration)
    && Number.isSafeInteger(currentGeneration)
    && requestGeneration === currentGeneration;
}

export function withVerificationApproval(snapshot, approvalId) {
  return snapshot
    ? { ...snapshot, verificationApprovalId: approvalId || null }
    : snapshot;
}
