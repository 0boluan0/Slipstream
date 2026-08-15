import { useState, useCallback, useEffect, useRef } from 'react';
import { useIpc } from '@renderer-ipc';
import { applyRendererSettingUpdate, SECRET_SETTING_FLAGS } from './settingsRedaction.mjs';
import { normalizeLoadedSettings, SETUP_MODES } from '../utils/setupReadiness.mjs';
import {
  classifySettingsLoadPayload,
  classifySettingsRecoveryResponse,
  isLoadedSettingsPayload,
  SETTINGS_LOAD_TIMEOUT_MS,
  settingsLoadErrorCode,
} from '../utils/settingsLoad.mjs';
import {
  normalizeShortcutStatus,
  shortcutFailureCode,
} from '../utils/shortcutReadiness.mjs';
import {
  failedSaveEntries,
  mergeFailedSaveOperation,
  PROCESSING_CONFIG_KEYS,
  reconcileFailedSaveOperation,
  removeFailedSaveOperationKeys,
} from '../utils/failedSettingsRetry.mjs';
import constants from '../../shared/constants';
import { PROCESSING_LOCATION_KINDS } from '../../shared/endpoint-location.mjs';

const { IPC_CHANNELS, DEFAULTS } = constants;

const CONNECTION_TEST_STATUSES = new Set(['connected', 'failed', 'inconclusive']);
const CONNECTION_TEST_PROCESSING_LOCATIONS = new Set(Object.values(PROCESSING_LOCATION_KINDS));
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
  'structured-output-invalid',
  'generation-failed',
  'busy',
  'cancelled',
  'cancelled-by-user',
  'settings-save-failed',
]);
const CONNECTION_CANCEL_STATUSES = new Set(['cancelled', 'not-running', 'still-running']);
const SHORTCUT_SETTING_KEYS = new Set(['clipboardShortcut', 'screenshotShortcut']);

function hasProcessingConfigChange(settings, key, value) {
  if (!PROCESSING_CONFIG_KEYS.has(key)) return false;
  const secretFlag = SECRET_SETTING_FLAGS[key];
  if (!secretFlag) return settings[key] !== value;
  // Secret values are intentionally redacted to an empty string in renderer
  // state. A blank write only changes configuration when a secret is saved;
  // any non-blank write can be a replacement and must invalidate old work.
  return value ? true : Boolean(settings[secretFlag]);
}

// ENDPOINT_BOUNDARY_RESPONSE_START
export function applyConfirmedSettingWrite(settings, key, value, response) {
  const nextSettings = applyRendererSettingUpdate(settings, key, value);
  if (
    key !== 'customEndpointUrl'
    || response?.status !== 'saved'
    || response?.key !== key
    || response?.customEndpointApiKeyCleared !== true
  ) {
    return nextSettings;
  }
  return applyRendererSettingUpdate(nextSettings, 'customEndpointApiKey', '');
}
// ENDPOINT_BOUNDARY_RESPONSE_END

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
  clipboardShortcut: DEFAULTS.CLIPBOARD_SHORTCUT,
  screenshotShortcut: DEFAULTS.SCREENSHOT_SHORTCUT,
  setupMode: SETUP_MODES.UNCONFIGURED,
  runtimeStatus: {
    trayAvailable: true,
    clipboardMonitoringDisabled: false,
    clipboardMonitoringDisablePersistFailed: false,
  },
};

export function useSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [loadErrorCode, setLoadErrorCode] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [processingConfigRevision, setProcessingConfigRevision] = useState(0);
  const [shortcutStatus, setShortcutStatus] = useState(() => (
    normalizeShortcutStatus(null, defaultSettings)
  ));
  const processingConfigGenerationRef = useRef(0);
  const pendingWritesRef = useRef(new Set());
  const failedSettingKeysRef = useRef(new Set());
  const failedSaveOperationRef = useRef(null);
  const settingsLoadRequestRef = useRef(0);
  const settingsRecoveryPendingRef = useRef(false);
  const { invoke, on } = useIpc();

  const refreshShortcutStatus = useCallback(async () => {
    try {
      const status = await invoke(IPC_CHANNELS.SHORTCUT_STATUS_GET);
      setShortcutStatus(normalizeShortcutStatus(status, defaultSettings));
      return true;
    } catch {
      return false;
    }
  }, [invoke]);

  useEffect(() => {
    if (loadStatus !== 'ready') return undefined;
    let active = true;
    const unsubscribe = on(IPC_CHANNELS.SHORTCUT_STATUS_CHANGED, (status) => {
      if (!active) return;
      setShortcutStatus(normalizeShortcutStatus(status, defaultSettings));
    });
    refreshShortcutStatus();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadStatus, on, refreshShortcutStatus]);

  const applyLoadedSettings = useCallback((loaded) => {
    if (!isLoadedSettingsPayload(loaded)) return false;
    setSettings((previous) => normalizeLoadedSettings(previous, loaded));
    setLoadErrorCode('');
    setLoadStatus('ready');
    return true;
  }, []);

  const requestSettingsLoad = useCallback(async ({ retry = false } = {}) => {
    const requestId = settingsLoadRequestRef.current + 1;
    settingsLoadRequestRef.current = requestId;
    setLoadErrorCode('');
    setLoadStatus(retry ? 'retrying' : 'loading');

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        const error = new Error('settings-load-timeout');
        error.code = 'settings-load-timeout';
        reject(error);
      }, SETTINGS_LOAD_TIMEOUT_MS);
    });

    try {
      const loaded = await Promise.race([
        invoke(IPC_CHANNELS.SETTINGS_GET),
        timeout,
      ]);
      if (settingsLoadRequestRef.current !== requestId) return false;
      const outcome = classifySettingsLoadPayload(loaded);
      if (outcome.status !== 'ready') {
        setLoadErrorCode(outcome.reason);
        setLoadStatus('error');
        return false;
      }
      return applyLoadedSettings(outcome.settings);
    } catch (error) {
      if (settingsLoadRequestRef.current !== requestId) return false;
      setLoadErrorCode(settingsLoadErrorCode(error));
      setLoadStatus('error');
      return false;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }, [applyLoadedSettings, invoke]);

  useEffect(() => {
    let active = true;
    const unsub = on(IPC_CHANNELS.SETTINGS_LOADED, (loaded) => {
      if (!active || settingsRecoveryPendingRef.current) return;
      const outcome = classifySettingsLoadPayload(loaded);
      settingsLoadRequestRef.current += 1;
      if (outcome.status === 'ready') {
        applyLoadedSettings(outcome.settings);
        return;
      }
      setLoadErrorCode(outcome.reason);
      setLoadStatus('error');
    });

    requestSettingsLoad();

    return () => {
      active = false;
      settingsLoadRequestRef.current += 1;
      unsub();
    };
  }, [applyLoadedSettings, on, requestSettingsLoad]);

  const retrySettingsLoad = useCallback(
    () => requestSettingsLoad({ retry: true }),
    [requestSettingsLoad]
  );

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

  const reconcileFailedSaveRetry = useCallback((processingConfigGeneration) => {
    const result = reconcileFailedSaveOperation(
      failedSaveOperationRef.current,
      processingConfigGeneration,
    );
    if (!result.invalidated) return result.operation;

    failedSaveOperationRef.current = result.operation;
    for (const key of result.removedKeys) failedSettingKeysRef.current.delete(key);
    setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
    return result.operation;
  }, []);

  const advanceProcessingConfigGeneration = useCallback(() => {
    const nextGeneration = processingConfigGenerationRef.current + 1;
    processingConfigGenerationRef.current = nextGeneration;
    reconcileFailedSaveRetry(nextGeneration);
    setProcessingConfigRevision(nextGeneration);
    return nextGeneration;
  }, [reconcileFailedSaveRetry]);

  const recoverFreshSettings = useCallback(async () => {
    if (settingsRecoveryPendingRef.current) return false;
    settingsRecoveryPendingRef.current = true;
    settingsLoadRequestRef.current += 1;
    setLoadErrorCode('');
    setLoadStatus('recovering');

    try {
      const response = await invoke(IPC_CHANNELS.SETTINGS_RECOVERY_RESET);
      const outcome = classifySettingsRecoveryResponse(response);
      if (outcome.status !== 'recovered') {
        setLoadErrorCode(outcome.reason);
        setLoadStatus('error');
        return false;
      }

      advanceProcessingConfigGeneration();
      failedSettingKeysRef.current.clear();
      failedSaveOperationRef.current = null;
      setSaveError('');
      setSettings(normalizeLoadedSettings(defaultSettings, outcome.settings));
      setRecoveryNotice(outcome.recovery);
      setLoadErrorCode('');
      setLoadStatus('ready');
      return true;
    } catch (error) {
      setLoadErrorCode(settingsLoadErrorCode(error));
      setLoadStatus('error');
      return false;
    } finally {
      settingsRecoveryPendingRef.current = false;
    }
  }, [advanceProcessingConfigGeneration, invoke]);

  const dismissRecoveryNotice = useCallback(() => {
    setRecoveryNotice(null);
  }, []);

  const updateSettings = useCallback(async (key, value) => {
    const normalizedValue = key === 'languageHint' ? 'en' : value;
    const processingConfigChanged = hasProcessingConfigChange(settings, key, normalizedValue);
    if (processingConfigChanged) advanceProcessingConfigGeneration();
    try {
      const response = await persistSetting(key, normalizedValue);
      setSettings(prev => applyConfirmedSettingWrite(prev, key, normalizedValue, response));
      if (SHORTCUT_SETTING_KEYS.has(key)) await refreshShortcutStatus();
      if (failedSettingKeysRef.current.size === 0) failedSaveOperationRef.current = null;
      setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
      return true;
    } catch (error) {
      const shortcutCode = SHORTCUT_SETTING_KEYS.has(key) ? shortcutFailureCode(error) : null;
      if (shortcutCode) {
        failedSettingKeysRef.current.delete(key);
        failedSaveOperationRef.current = removeFailedSaveOperationKeys(
          failedSaveOperationRef.current,
          [key],
        );
        setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
        await refreshShortcutStatus();
        const shortcutError = new Error(shortcutCode);
        shortcutError.code = shortcutCode;
        throw shortcutError;
      }
      failedSaveOperationRef.current = mergeFailedSaveOperation(
        failedSaveOperationRef.current,
        [[key, normalizedValue]],
        processingConfigGenerationRef.current,
      );
      setSaveError('设置保存失败，请重试。');
      throw new Error('settings-save-failed');
    }
  }, [advanceProcessingConfigGeneration, persistSetting, refreshShortcutStatus, settings]);

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
        const response = await persistSetting(key, value);
        // Reflect every confirmed write immediately. If a later write fails,
        // renderer state still matches the safely persisted partial state.
        setSettings(prev => applyConfirmedSettingWrite(prev, key, value, response));
      }
      if (failedSettingKeysRef.current.size === 0) failedSaveOperationRef.current = null;
      setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
      return true;
    } catch {
      // Keep the complete intended transaction, not just the entry that
      // happened to fail. Retrying must also finish writes that were skipped.
      failedSaveOperationRef.current = mergeFailedSaveOperation(
        failedSaveOperationRef.current,
        entries,
        processingConfigGenerationRef.current,
      );
      setSaveError('设置保存失败，请重试。');
      throw new Error('settings-save-failed');
    }
  }, [advanceProcessingConfigGeneration, persistSetting, settings]);

  const retryFailedSettings = useCallback(async () => {
    reconcileFailedSaveRetry(processingConfigGenerationRef.current);
    let entries = failedSaveEntries(failedSaveOperationRef.current);
    if (!entries?.length) return false;
    const processingConfigChanged = entries.some(([key, value]) => (
      hasProcessingConfigChange(settings, key, value)
    ));
    if (processingConfigChanged) {
      advanceProcessingConfigGeneration();
      entries = failedSaveEntries(failedSaveOperationRef.current);
      if (!entries.length) return false;
    }
    const retriedKeys = [...new Set(entries.map(([key]) => key))];
    try {
      for (const [key, value] of entries) {
        const response = await persistSetting(key, value);
        setSettings(prev => applyConfirmedSettingWrite(prev, key, value, response));
      }
      failedSaveOperationRef.current = null;
      setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
      return Object.freeze({ status: 'saved', savedSettingKeys: retriedKeys });
    } catch {
      setSaveError('设置保存失败，请重试。');
      throw new Error('settings-save-failed');
    }
  }, [advanceProcessingConfigGeneration, persistSetting, reconcileFailedSaveRetry, settings]);

  const discardFailedSettings = useCallback((keys = []) => {
    const discardedKeys = new Set(Array.isArray(keys) ? keys : [keys]);
    for (const key of discardedKeys) failedSettingKeysRef.current.delete(key);
    failedSaveOperationRef.current = removeFailedSaveOperationKeys(
      failedSaveOperationRef.current,
      discardedKeys,
    );
    setSaveError(failedSettingKeysRef.current.size ? '设置保存失败，请重试。' : '');
  }, []);

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
      return {
        status: response.status,
        code: response.code,
        processingLocation: CONNECTION_TEST_PROCESSING_LOCATIONS.has(response.processingLocation)
          ? response.processingLocation
          : null,
      };
    } catch {
      return { status: 'failed', code: 'unreachable' };
    }
  }, [invoke]);

  const cancelProviderConnectionTest = useCallback(async () => {
    try {
      const response = await invoke(IPC_CHANNELS.PROVIDER_CONNECTION_CANCEL);
      if (
        !response ||
        typeof response !== 'object' ||
        !CONNECTION_CANCEL_STATUSES.has(response.status)
      ) {
        return { status: 'still-running' };
      }
      return { status: response.status };
    } catch {
      return { status: 'still-running' };
    }
  }, [invoke]);

  const resetSettings = useCallback(async ({ ticket = null } = {}) => {
    // Let already-confirmed writes settle first so a slow old write cannot
    // reappear after the authoritative reset has completed.
    if (pendingWritesRef.current.size > 0) {
      await Promise.allSettled([...pendingWritesRef.current]);
    }
    advanceProcessingConfigGeneration();
    const response = await invoke(IPC_CHANNELS.USER_DATA_CLEAR, { ticket });
    if (
      !response
      || typeof response !== 'object'
      || Array.isArray(response)
      || response.status !== 'cleared'
      || !response.settings
      || typeof response.settings !== 'object'
      || Array.isArray(response.settings)
      || !['retained', 'not-applicable'].includes(response.clipboardStatus)
    ) {
      const error = new Error('settings-reset-failed');
      error.code = typeof response?.status === 'string'
        ? response.status
        : 'settings-reset-failed';
      if (Object.hasOwn(response || {}, 'clipboardConsequence')) {
        error.clipboardConsequence = response.clipboardConsequence;
      }
      throw error;
    }
    failedSettingKeysRef.current.clear();
    failedSaveOperationRef.current = null;
    setSaveError('');
    setSettings(normalizeLoadedSettings(defaultSettings, response.settings));
    setRecoveryNotice(null);
    return true;
  }, [advanceProcessingConfigGeneration, invoke]);

  return {
    settings,
    updateSettings,
    updateMultipleSettings,
    retryFailedSettings,
    discardFailedSettings,
    resetSettings,
    testProviderConnection,
    cancelProviderConnectionTest,
    loading: loadStatus === 'loading',
    loadStatus,
    loadErrorCode,
    retrySettingsLoad,
    recoverFreshSettings,
    recoveryNotice,
    dismissRecoveryNotice,
    saveError,
    settingsSaving,
    processingConfigRevision,
    processingConfigGenerationRef,
    shortcutStatus,
    refreshShortcutStatus,
  };
}
