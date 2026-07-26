import { useState, useCallback, useEffect, useRef } from 'react';
import { useIpc } from './useIpc';
import { applyRendererSettingUpdate, SECRET_SETTING_FLAGS } from './settingsRedaction.mjs';
import { normalizeLoadedSettings, SETUP_MODES } from '../utils/setupReadiness.mjs';
import constants from '../../shared/constants';

const { IPC_CHANNELS, DEFAULTS } = constants;

const CONNECTION_TEST_STATUSES = new Set(['connected', 'failed', 'inconclusive']);
const CONNECTION_TEST_CODES = new Set([
  'ok',
  'unsupported',
  'missing-credentials',
  'invalid-config',
  'unsafe-endpoint',
  'unauthorized',
  'model-not-found',
  'unreachable',
  'timeout',
  'invalid-response',
  'response-too-large',
  'redirect-rejected',
  'rate-limited',
  'http-error',
  'busy',
  'cancelled',
  'settings-save-failed',
]);
const PROCESSING_CONFIG_KEYS = new Set([
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'ollamaBaseUrl',
  'customEndpointUrl',
  'customEndpointApiKey',
  'activeBackend',
  'activeModel',
  'customPrompt',
  'languageHint',
  'verificationPolicy',
]);

function hasProcessingConfigChange(settings, key, value) {
  if (!PROCESSING_CONFIG_KEYS.has(key)) return false;
  const secretFlag = SECRET_SETTING_FLAGS[key];
  if (!secretFlag) return settings[key] !== value;
  // Secret values are intentionally redacted to an empty string in renderer
  // state. A blank write only changes configuration when a secret is saved;
  // any non-blank write can be a replacement and must invalidate old work.
  return value ? true : Boolean(settings[secretFlag]);
}

// NOTE: These defaults must match the schema defaults in src/main/store.js
const defaultSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  deepseekApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  customEndpointUrl: '',
  customEndpointApiKey: '',
  hasAnthropicApiKey: false,
  hasOpenaiApiKey: false,
  hasDeepseekApiKey: false,
  hasCustomEndpointApiKey: false,
  activeBackend: DEFAULTS.BACKEND,
  activeModel: DEFAULTS.MODEL,
  customPrompt: '',
  languageHint: DEFAULTS.LANGUAGE,
  windowWidth: DEFAULTS.WINDOW_WIDTH,
  windowHeight: DEFAULTS.WINDOW_HEIGHT,
  windowX: null,
  windowY: null,
  startMinimized: false,
  clipboardMonitoring: DEFAULTS.CLIPBOARD_MONITORING,
  verificationPolicy: 'ask',
  resultOrder: 'action-first',
  privacyNoticeSeen: false,
  clipboardShortcut: 'Alt+C',
  screenshotShortcut: 'F2',
  setupMode: SETUP_MODES.UNCONFIGURED,
};

export function useSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [processingConfigRevision, setProcessingConfigRevision] = useState(0);
  const processingConfigGenerationRef = useRef(0);
  const pendingWritesRef = useRef(new Set());
  const failedSettingKeysRef = useRef(new Set());
  const { invoke, on } = useIpc();

  useEffect(() => {
    let timeout;

    // Listen for settings loaded from main (push event, guaranteed to fire once after window loads)
    const unsub = on(IPC_CHANNELS.SETTINGS_LOADED, (loaded) => {
      if (loaded) setSettings(prev => normalizeLoadedSettings(prev, loaded));
      setLoading(false);
      if (timeout) clearTimeout(timeout);
    });

    invoke(IPC_CHANNELS.SETTINGS_GET)
      .then((loaded) => {
        if (loaded) setSettings(prev => normalizeLoadedSettings(prev, loaded));
        setLoading(false);
        if (timeout) clearTimeout(timeout);
      })
      .catch(() => {});

    // Fallback: if SETTINGS_LOADED doesn't fire within 2s, stop loading anyway
    timeout = setTimeout(() => setLoading(false), 2000);

    return () => {
      unsub();
      if (timeout) clearTimeout(timeout);
    };
  }, [invoke, on]);

  const persistSetting = useCallback((key, value) => {
    const write = invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
    pendingWritesRef.current.add(write);
    setSettingsSaving(true);
    write.then(
      () => failedSettingKeysRef.current.delete(key),
      () => failedSettingKeysRef.current.add(key)
    ).finally(() => {
      pendingWritesRef.current.delete(write);
      if (pendingWritesRef.current.size === 0) setSettingsSaving(false);
    });
    return write;
  }, [invoke]);

  const advanceProcessingConfigGeneration = useCallback(() => {
    const nextGeneration = processingConfigGenerationRef.current + 1;
    processingConfigGenerationRef.current = nextGeneration;
    setProcessingConfigRevision(nextGeneration);
  }, []);

  const updateSettings = useCallback(async (key, value) => {
    const normalizedValue = key === 'languageHint' ? 'en' : value;
    const processingConfigChanged = hasProcessingConfigChange(settings, key, normalizedValue);
    if (processingConfigChanged) advanceProcessingConfigGeneration();
    try {
      await persistSetting(key, normalizedValue);
      setSettings(prev => applyRendererSettingUpdate(prev, key, normalizedValue));
      setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
      return true;
    } catch {
      setSaveError('设置保存失败，请重试。');
      throw new Error('settings-save-failed');
    }
  }, [advanceProcessingConfigGeneration, persistSetting, settings]);

  const updateMultipleSettings = useCallback(async (updates) => {
    const normalizedUpdates = { ...updates, languageHint: 'en' };
    const allEntries = Object.entries(normalizedUpdates);
    const setupEntry = allEntries.find(([key]) => key === 'setupMode');
    const otherEntries = allEntries.filter(([key]) => key !== 'setupMode');
    // Enter the blocking state before reconfiguration, but persist a completed
    // choice only after every prerequisite write has succeeded.
    const entries = setupEntry?.[1] === SETUP_MODES.UNCONFIGURED
      ? [setupEntry, ...otherEntries]
      : setupEntry
        ? [...otherEntries, setupEntry]
        : otherEntries;
    const processingConfigChanged = entries.some(([key, value]) => (
      hasProcessingConfigChange(settings, key, value)
    ));
    if (processingConfigChanged) advanceProcessingConfigGeneration();
    try {
      for (const [key, value] of entries) {
        await persistSetting(key, value);
        // Reflect every confirmed write immediately. If a later write fails,
        // renderer state still matches the safely persisted partial state.
        setSettings(prev => applyRendererSettingUpdate(prev, key, value));
      }
      setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
      return true;
    } catch {
      setSaveError('设置保存失败，请重试。');
      throw new Error('settings-save-failed');
    }
  }, [advanceProcessingConfigGeneration, persistSetting, settings]);

  const testProviderConnection = useCallback(async () => {
    while (pendingWritesRef.current.size > 0) {
      await Promise.allSettled([...pendingWritesRef.current]);
    }
    if (failedSettingKeysRef.current.size > 0) {
      return { status: 'failed', code: 'settings-save-failed' };
    }

    try {
      const response = await invoke(IPC_CHANNELS.PROVIDER_CONNECTION_TEST);
      if (
        !response ||
        typeof response !== 'object' ||
        !CONNECTION_TEST_STATUSES.has(response.status) ||
        !CONNECTION_TEST_CODES.has(response.code)
      ) {
        return { status: 'failed', code: 'invalid-response' };
      }
      return { status: response.status, code: response.code };
    } catch {
      return { status: 'failed', code: 'unreachable' };
    }
  }, [invoke]);

  const cancelProviderConnectionTest = useCallback(() => {
    return invoke(IPC_CHANNELS.PROVIDER_CONNECTION_CANCEL).catch(() => false);
  }, [invoke]);

  const resetSettings = useCallback(async () => {
    const persistedDefaults = Object.fromEntries(
      Object.entries(defaultSettings).filter(([key]) => !key.startsWith('has'))
    );
    await updateMultipleSettings(persistedDefaults);
    await invoke(IPC_CHANNELS.USER_DATA_CLEAR);
    setSettings(defaultSettings);
  }, [invoke, updateMultipleSettings]);

  return {
    settings,
    updateSettings,
    updateMultipleSettings,
    resetSettings,
    testProviderConnection,
    cancelProviderConnectionTest,
    loading,
    saveError,
    settingsSaving,
    processingConfigRevision,
    processingConfigGenerationRef,
  };
}
