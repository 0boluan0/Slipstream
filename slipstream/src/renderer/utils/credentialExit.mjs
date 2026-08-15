import { SETUP_MODES } from './setupReadiness.mjs';

const FREE_TRANSLATION_BACKEND = 'free_translate';
const FREE_TRANSLATION_MODEL = 'google-translate';

const CREDENTIAL_PROFILES = Object.freeze({
  anthropic: Object.freeze({
    providerLabel: 'Anthropic',
    credentialLabel: 'Anthropic API Key',
    savedFlag: 'hasAnthropicApiKey',
    settingKeys: ['anthropicApiKey'],
  }),
  openai: Object.freeze({
    providerLabel: 'OpenAI',
    credentialLabel: 'OpenAI API Key',
    savedFlag: 'hasOpenaiApiKey',
    settingKeys: ['openaiApiKey'],
  }),
  deepseek: Object.freeze({
    providerLabel: 'DeepSeek',
    credentialLabel: 'DeepSeek API Key',
    savedFlag: 'hasDeepseekApiKey',
    settingKeys: ['deepseekApiKey'],
  }),
  custom: Object.freeze({
    providerLabel: '自定义服务',
    credentialLabel: '自定义服务地址和 API Key',
    savedFlag: 'hasCustomEndpointApiKey',
    settingKeys: ['customEndpointUrl', 'customEndpointApiKey'],
  }),
});

export function describeCredentialExit(settings = {}) {
  const profile = CREDENTIAL_PROFILES[settings.activeBackend];
  if (!profile) {
    return {
      providerLabel: settings.activeBackend === 'ollama' ? 'Ollama' : '当前服务',
      credentialLabel: '',
      settingKeys: [],
      hasSavedCredential: false,
    };
  }

  const hasSavedCredential = profile.settingKeys.some((key) => {
    if (key === 'customEndpointUrl') return Boolean(String(settings[key] || '').trim());
    return settings[profile.savedFlag] === true;
  });

  return {
    providerLabel: profile.providerLabel,
    credentialLabel: profile.credentialLabel,
    settingKeys: [...profile.settingKeys],
    hasSavedCredential,
  };
}

export function buildTranslationFallbackPauseUpdates(settings = {}, removeCredential = false) {
  const credentialExit = describeCredentialExit(settings);
  const updates = {
    setupMode: SETUP_MODES.UNCONFIGURED,
  };

  if (removeCredential) {
    credentialExit.settingKeys.forEach((key) => {
      updates[key] = '';
    });
  }

  updates.activeBackend = FREE_TRANSLATION_BACKEND;
  updates.activeModel = FREE_TRANSLATION_MODEL;
  return updates;
}

export function translationFallbackCompletionUpdate() {
  return ['setupMode', SETUP_MODES.TRANSLATION_ONLY];
}
