export const SECRET_SETTING_FLAGS = {
  anthropicApiKey: 'hasAnthropicApiKey',
  openaiApiKey: 'hasOpenaiApiKey',
  deepseekApiKey: 'hasDeepseekApiKey',
  customEndpointApiKey: 'hasCustomEndpointApiKey',
};

export function applyRendererSettingUpdate(settings, key, value) {
  const flag = SECRET_SETTING_FLAGS[key];
  if (!flag) {
    if (key === 'clipboardMonitoring') {
      return {
        ...settings,
        [key]: value,
        runtimeStatus: {
          ...settings.runtimeStatus,
          clipboardMonitoringDisabled: false,
          clipboardMonitoringDisablePersistFailed: false,
        },
      };
    }
    return { ...settings, [key]: value };
  }
  return { ...settings, [key]: '', [flag]: Boolean(value) };
}
