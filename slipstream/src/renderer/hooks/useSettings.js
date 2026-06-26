import { useState, useCallback, useEffect } from 'react';
import { useIpc } from './useIpc';
import { IPC_CHANNELS, DEFAULTS } from '../../shared/constants';

// NOTE: These defaults must match the schema defaults in src/main/store.js
const defaultSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  customEndpointUrl: '',
  customEndpointApiKey: '',
  activeBackend: DEFAULTS.BACKEND,
  activeModel: DEFAULTS.MODEL,
  customPrompt: '',
  languageHint: DEFAULTS.LANGUAGE,
  windowWidth: DEFAULTS.WINDOW_WIDTH,
  windowHeight: DEFAULTS.WINDOW_HEIGHT,
  windowX: null,
  windowY: null,
  startMinimized: false,
  clipboardMonitoring: true,
};

export function useSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const { invoke, on } = useIpc();

  useEffect(() => {
    let timeout;

    // Listen for settings loaded from main (push event, guaranteed to fire once after window loads)
    const unsub = on(IPC_CHANNELS.SETTINGS_LOADED, (loaded) => {
      if (loaded) setSettings(loaded);
      setLoading(false);
      if (timeout) clearTimeout(timeout);
    });

    // Fallback: if SETTINGS_LOADED doesn't fire within 2s, stop loading anyway
    timeout = setTimeout(() => setLoading(false), 2000);

    return () => {
      unsub();
      if (timeout) clearTimeout(timeout);
    };
  }, [on]);

  const updateSettings = useCallback(async (key, value) => {
    try {
      await invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error('Failed to save setting:', err);
    }
  }, [invoke]);

  const updateMultipleSettings = useCallback(async (updates) => {
    const entries = Object.entries(updates);
    for (const [key, value] of entries) {
      try {
        await invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
      } catch (err) {
        console.error(`Failed to save ${key}:`, err);
      }
    }
    setSettings(prev => ({ ...prev, ...updates }));
  }, [invoke]);

  const resetSettings = useCallback(() => {
    updateMultipleSettings(defaultSettings);
  }, [updateMultipleSettings]);

  return { settings, updateSettings, updateMultipleSettings, resetSettings, loading };
}
