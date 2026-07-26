export const SETUP_MODES = Object.freeze({
  UNCONFIGURED: 'unconfigured',
  FULL: 'full',
  TRANSLATION_ONLY: 'translation-only',
});

const API_KEY_FLAGS = Object.freeze({
  anthropic: 'hasAnthropicApiKey',
  openai: 'hasOpenaiApiKey',
  deepseek: 'hasDeepseekApiKey',
});

export function isSetupComplete(settings = {}) {
  if (settings.setupMode === SETUP_MODES.TRANSLATION_ONLY) {
    return settings.activeBackend === 'free_translate';
  }
  if (settings.setupMode === SETUP_MODES.FULL) {
    return isBackendReadyForFullAnalysis(settings);
  }
  return false;
}

export function normalizeLoadedSettings(current = {}, loaded = {}) {
  const next = { ...current, ...loaded, languageHint: 'en' };
  const suppliedMode = loaded?.setupMode;

  if (!Object.values(SETUP_MODES).includes(suppliedMode)) {
    // Older configured installations and the local result preview predate the
    // explicit setup choice. Preserve their working full-analysis backend.
    next.setupMode = isBackendReadyForFullAnalysis(next)
      ? SETUP_MODES.FULL
      : current.setupMode || SETUP_MODES.UNCONFIGURED;
  }

  return next;
}

export function isBackendReadyForFullAnalysis(settings = {}) {
  const { activeBackend, activeModel } = settings;
  if (!activeBackend || activeBackend === 'free_translate' || !String(activeModel || '').trim()) {
    return false;
  }

  const savedFlag = API_KEY_FLAGS[activeBackend];
  if (savedFlag) return settings[savedFlag] === true;
  if (activeBackend === 'ollama') return Boolean(String(settings.ollamaBaseUrl || '').trim());
  if (activeBackend === 'custom') return Boolean(String(settings.customEndpointUrl || '').trim());
  return false;
}

export function modeLabel(setupMode) {
  if (setupMode === SETUP_MODES.FULL) return '完整分析';
  if (setupMode === SETUP_MODES.TRANSLATION_ONLY) return '基础翻译';
  return '尚未完成设置';
}

export function hasEndpointOriginChanged(previousValue, nextValue) {
  const origin = (value) => {
    try {
      return value ? new URL(value).origin : '';
    } catch {
      return '';
    }
  };
  return origin(previousValue) !== origin(nextValue);
}
