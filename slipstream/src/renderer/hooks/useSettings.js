import { useState, useCallback, useEffect } from 'react';
import { useIpc } from './useIpc';
import { applyRendererSettingUpdate } from './settingsRedaction.mjs';
import constants from '../../shared/constants';

const { IPC_CHANNELS, DEFAULTS } = constants;

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
};

export function useSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const { invoke, on } = useIpc();

  useEffect(() => {
    let timeout;

    // Listen for settings loaded from main (push event, guaranteed to fire once after window loads)
    const unsub = on(IPC_CHANNELS.SETTINGS_LOADED, (loaded) => {
      if (loaded) setSettings(prev => ({ ...prev, ...loaded }));
      setLoading(false);
      if (timeout) clearTimeout(timeout);
    });

    invoke(IPC_CHANNELS.SETTINGS_GET)
      .then((loaded) => {
        if (loaded) setSettings(prev => ({ ...prev, ...loaded }));
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

  const updateSettings = useCallback(async (key, value) => {
    try {
      await invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
      setSettings(prev => applyRendererSettingUpdate(prev, key, value));
      setSaveError('');
      return true;
    } catch (err) {
      console.error('Failed to save setting:', err);
      setSaveError(err?.message || '设置保存失败');
      throw err;
    }
  }, [invoke]);

  const updateMultipleSettings = useCallback(async (updates) => {
    const entries = Object.entries(updates);
    try {
      for (const [key, value] of entries) {
        await invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
      }
      setSettings(prev => ({ ...prev, ...updates }));
      setSaveError('');
      return true;
    } catch (err) {
      setSaveError(err?.message || '设置保存失败');
      throw err;
    }
  }, [invoke]);

  const resetSettings = useCallback(async () => {
    const persistedDefaults = Object.fromEntries(
      Object.entries(defaultSettings).filter(([key]) => !key.startsWith('has'))
    );
    await updateMultipleSettings(persistedDefaults);
    await invoke(IPC_CHANNELS.USER_DATA_CLEAR);
    setSettings(defaultSettings);
  }, [invoke, updateMultipleSettings]);

  return { settings, updateSettings, updateMultipleSettings, resetSettings, loading, saveError };
}
