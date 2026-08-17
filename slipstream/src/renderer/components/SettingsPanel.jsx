import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Cloud,
  Copy,
  Desktop,
  HardDrives,
  Keyboard,
  ShieldCheck,
  Translate,
  WarningCircle,
} from '../phosphorIcons';
import ApiKeyInput from './ApiKeyInput';
import ClipboardMonitoringConsentDialog from './ClipboardMonitoringConsentDialog';
import ConnectionRecovery from './ConnectionRecovery';
import CredentialRemovalDialog from './CredentialRemovalDialog';
import ModelSelector from './ModelSelector';
import PromptEditor from './PromptEditor';
import ClipboardActionNotice from './ClipboardActionNotice';
import LanguageToggle from './LanguageToggle';
import SettingsResetDialog from './SettingsResetDialog';
import SettingsTransitionDialog from './SettingsTransitionDialog';
import constants from '../../shared/constants';
import { useIpc } from '@renderer-ipc';
import {
  ANALYSIS_LOCATIONS,
  analysisLocationForBackend,
  analysisLocationForSettings,
  isBackendReadyForFullAnalysis,
  modeLabel,
  SETUP_MODES,
} from '../utils/setupReadiness.mjs';
import {
  connectionDraftKindsForRetriedSettings,
  describeSettingsDraftIntent,
  settingsKeysForDiscardedDrafts,
  settingsExitOwner,
} from '../utils/settingsDraftGuard.mjs';
import {
  describeConnectionTestExitIntent,
  didConnectionTestFinishBeforeStop,
  isConnectionTestStopConfirmed,
} from '../utils/connectionTestExit.mjs';
import {
  CLIPBOARD_MONITORING_OFF_DETAIL,
  describeClipboardMonitoring,
} from '../utils/clipboardMonitoringConsent.mjs';
import {
  PROCESSING_LOCATIONS,
  processingLocationForSettings,
} from '../utils/processingPrivacy.mjs';
import {
  shortcutFailureCode,
  shortcutStatusForKind,
} from '../utils/shortcutReadiness.mjs';
import {
  buildTranslationFallbackPauseUpdates,
  describeCredentialExit,
  translationFallbackCompletionUpdate,
} from '../utils/credentialExit.mjs';
import {
  describeFullDataResetFailure,
  nextFullDataResetSessionCleared,
} from '../utils/fullDataResetFailure.mjs';
import { runFullDataReset } from '../utils/fullDataReset.mjs';
import { shouldHandleBackgroundEscape } from '../utils/modalOwnership.mjs';
import {
  authoritativeRadioTarget,
  radioGroupTargetIndex,
} from '../utils/radioGroupNavigation.mjs';
import { preferredScrollBehavior } from '../utils/motionPreference.mjs?workspace=settings';
import settingsPanelStylesheetUrl from './SettingsPanel.css?url&no-inline';
import {
  getSettingsStylesheetAttempt,
  loadSettingsWorkspaceStylesheet,
} from './settingsWorkspaceStylesheet.mjs';
import shortcutAccelerator from '../../shared/shortcut-accelerator.mjs';

const settingsPanelModuleUrl = new URL(import.meta.url);
const settingsPanelStylesheetHref = new URL(settingsPanelStylesheetUrl, document.baseURI);
if (
  import.meta.env.DEV
  && settingsPanelModuleUrl.searchParams.get('workspace-load')
    === 'settings-style-fixture-primary'
) {
  settingsPanelStylesheetHref.searchParams.set(
    'workspace-load',
    'settings-style-fixture-primary',
  );
}
export const settingsWorkspaceStylesheetReady = loadSettingsWorkspaceStylesheet({
  attempt: getSettingsStylesheetAttempt(import.meta.url),
  href: settingsPanelStylesheetHref.href,
});

const {
  acceleratorFromKeyboardEvent,
  analyzeShortcutAccelerator,
  displayShortcutAccelerator,
  sameShortcutAccelerator,
  shortcutDisplayParts,
} = shortcutAccelerator;

const { DEFAULTS, IPC_CHANNELS, LLM_BACKENDS, MODEL_IDS } = constants;

const ONLINE_BACKEND_OPTIONS = [
  { label: 'DeepSeek', detail: '需要 DeepSeek API Key', value: LLM_BACKENDS.DEEPSEEK },
  { label: 'OpenAI', detail: '需要 OpenAI API Key', value: LLM_BACKENDS.OPENAI },
  { label: 'Anthropic', detail: '需要 Anthropic API Key', value: LLM_BACKENDS.ANTHROPIC },
  { label: '远程自定义服务', detail: '兼容接口或自建公开 HTTPS 服务', value: LLM_BACKENDS.CUSTOM },
];

const LOCAL_BACKEND_OPTIONS = [
  { label: 'Ollama', detail: '模型与原文都留在这台 Mac', value: LLM_BACKENDS.OLLAMA },
  { label: '本机兼容服务', detail: '仅连接 localhost、127/8 或 ::1 回环地址', value: LLM_BACKENDS.CUSTOM },
];

const CREDENTIAL_SETTING_BY_BACKEND = Object.freeze({
  [LLM_BACKENDS.ANTHROPIC]: 'anthropicApiKey',
  [LLM_BACKENDS.CUSTOM]: 'customEndpointUrl',
  [LLM_BACKENDS.OLLAMA]: 'ollamaBaseUrl',
  [LLM_BACKENDS.OPENAI]: 'openaiApiKey',
  [LLM_BACKENDS.DEEPSEEK]: 'deepseekApiKey',
});

const VERIFICATION_OPTIONS = [
  { value: 'ask', label: '每次询问', detail: '发现待核验内容时，先展示最小检索词与目标，再由你决定是否访问。' },
  { value: 'official-auto', label: '自动查找', detail: '自动查找并读取符合条件的官方页面；仅保留检索收据，不自动把结论标成已核验。' },
  { value: 'local-only', label: '仅本地', detail: '不访问外部来源，相关结论始终标记为待核验。' },
];

const CONNECTION_RESULT_COPY = Object.freeze({
  ok: ['完整分析能力验证通过', '服务与当前模型已通过测试；内置虚构文本的翻译、行动、术语和流程背景也都通过了结构与来源证据校验。你现在可以决定是否启用。'],
  unsupported: ['无法确认', '这个自定义服务没有提供可识别的模型列表接口；未发送任何原文。'],
  'missing-credentials': ['缺少凭据', '请先保存当前服务所需的 API Key。'],
  'invalid-config': ['配置无效', '请检查服务、模型 ID 和服务地址后重试。'],
  'unsafe-endpoint': ['地址不安全', '只允许公开 HTTPS 地址，或指向本机回环地址的 HTTP 服务。'],
  unauthorized: ['凭据未通过', '服务拒绝了当前凭据，请检查或更换 API Key。'],
  'model-not-found': ['没有找到模型', '服务可访问，但模型列表中没有当前模型 ID。'],
  timeout: ['测试超时', '服务没有在限定时间内完成连接或完整分析验证，请稍后重试。'],
  'invalid-response': ['响应无法确认', '服务没有返回可识别的 JSON 模型元数据。'],
  'response-too-large': ['响应超出限制', '模型元数据响应过大，Slipstream 已停止读取。'],
  'redirect-rejected': ['拒绝了重定向', '为避免把凭据发送到另一地址，连接测试不会跟随重定向。'],
  'rate-limited': ['请求受限', '服务暂时限制了请求，或账户余额、额度不足。请检查服务商账户后再试。'],
  'service-unavailable': ['服务暂时不可用', '服务商当前无法完成测试，请稍后重试。'],
  'http-error': ['服务返回错误', '服务已响应，但没有完成这次模型元数据检查。'],
  'structured-output-invalid': ['当前模型能力不兼容', '模型能够响应，但内置虚构文本的翻译、行动、术语或流程背景没有全部通过结构与来源证据校验。'],
  'generation-failed': ['完整分析测试失败', '模型已找到，但没有完成这次内置虚构文本的生成测试。'],
  busy: ['已有测试进行中', '请等待当前连接测试结束后再试。'],
  cancelled: ['测试已取消', '配置或输入发生变化，旧连接测试结果已丢弃。'],
  'cancelled-by-user': ['测试已取消', '你已停止这次验证；配置没有改变，可以随时重新验证。'],
  'settings-save-failed': ['设置尚未保存', '连接测试没有使用旧配置；请先修正上方的保存错误。'],
});

function getConnectionResultCopy(code, backend, fullAnalysisEnabled = false) {
  if (code === 'ok' && fullAnalysisEnabled) {
    return ['完整分析能力验证通过', '服务与当前模型已通过测试；当前配置已可用，可以继续使用完整分析。'];
  }
  if (backend === LLM_BACKENDS.OLLAMA && code === 'unreachable') {
    return ['没有连接到本机 Ollama', '没有发送任何原文。下面按顺序检查安装、服务和当前模型。'];
  }
  if (backend === LLM_BACKENDS.OLLAMA && code === 'timeout') {
    return ['本机 Ollama 响应超时', '服务在 7 秒内没有返回模型信息。下面按顺序恢复本地服务。'];
  }
  if (backend === LLM_BACKENDS.CUSTOM && code === 'unreachable') {
    return ['无法连接自定义服务', '请检查已保存的服务地址，并确认对应服务正在运行且可以访问。'];
  }
  if (code === 'unreachable') {
    return ['无法连接在线服务', '请检查这台 Mac 的网络，并确认服务商当前没有中断或维护。'];
  }
  return CONNECTION_RESULT_COPY[code] || CONNECTION_RESULT_COPY['invalid-response'];
}

const IDLE_CONNECTION_TEST = Object.freeze({ status: 'idle', code: 'not-tested' });
const IDLE_SHORTCUT_RECORDER = Object.freeze({ key: null, phase: 'idle', candidate: '', hint: '' });

function shortcutRecorderHint(reason) {
  if (reason === 'modifier-only') return '继续按一个字母、数字或功能键。';
  if (reason === 'reserved-app-quit') {
    return 'Command+Q 专门用于经过风险确认的安全退出；请按其他组合。';
  }
  if (reason === 'unsafe-unmodified') {
    return '字母或数字需搭配 Command、Control 或 Option；F1–F24 可保存，但多数 Apple 键盘需同时按 Fn/Globe。';
  }
  if (reason === 'unsupported-key' || reason === 'multiple-keys') {
    return '这个按键暂不支持；请使用字母、数字、方向键或 F1–F24。';
  }
  return '没有识别到可用组合，请重新按键。';
}

function moveFocusByTab(currentElement, reverse = false) {
  const focusableElements = Array.from(document.querySelectorAll([
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  });
  const currentIndex = focusableElements.indexOf(currentElement);
  if (currentIndex < 0 || focusableElements.length < 2) return;
  const offset = reverse ? -1 : 1;
  const nextIndex = (currentIndex + offset + focusableElements.length) % focusableElements.length;
  focusableElements[nextIndex]?.focus({ preventScroll: true });
}

function handleRadioGroupKeyDown(event) {
  const currentRadio = event.target.closest?.('[role="radio"]');
  if (!currentRadio || !event.currentTarget.contains(currentRadio)) return;

  const radios = Array.from(
    event.currentTarget.querySelectorAll('[role="radio"]:not([disabled])')
  );
  const nextIndex = radioGroupTargetIndex(
    event.key,
    radios.indexOf(currentRadio),
    radios.length,
  );
  if (nextIndex === null) return;

  event.preventDefault();
  const nextRadio = radios[nextIndex];
  nextRadio.focus({ preventScroll: true });
  nextRadio.click();
}

function restoreAuthoritativeRadioFocus(attemptedRadio) {
  if (!attemptedRadio) return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (document.activeElement !== attemptedRadio) return;
      const authoritativeRadio = authoritativeRadioTarget(attemptedRadio);
      if (
        authoritativeRadio === attemptedRadio
        || !authoritativeRadio?.isConnected
        || authoritativeRadio.matches?.(':disabled, [aria-disabled="true"]')
      ) return;
      authoritativeRadio.focus({ preventScroll: true });
      authoritativeRadio.scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  });
}

function ShortcutKeycaps({ value }) {
  const parts = shortcutDisplayParts(value);
  return (
    <span className="shortcut-recorder__keys" aria-hidden="true">
      {parts.map((part, index) => (
        <React.Fragment key={`${part}-${index}`}>
          {index > 0 && <span className="shortcut-recorder__plus">+</span>}
          <kbd>{part}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

export default function SettingsPanel({
  onClose,
  onSetupComplete,
  onQuitRiskChange,
  entryNotice = '',
  entryTarget = '',
  captureRequest,
  appDecisionBlocked = false,
  onCaptureRequestApproved,
  onCaptureRequestDismissed,
  onWorkspaceReadyChange,
  hasClipboardCopyConsequence = false,
  hasClipboardResidueRisk = false,
  clipboardWritePending = false,
  onWriteClipboard,
  clipboardNotice,
  onAcknowledgeClipboardConsequence,
  onDismissClipboardNotice,
  onResetAllData,
  settingsController,
}) {
  const { invoke } = useIpc();
  const {
    settings,
    updateSettings,
    updateMultipleSettings,
    retryFailedSettings,
    discardFailedSettings,
    testProviderConnection,
    cancelProviderConnectionTest,
    saveError,
    settingsSaving,
    shortcutStatus,
    refreshShortcutStatus,
  } = settingsController;
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSessionAlreadyCleared, setResetSessionAlreadyCleared] = useState(false);
  const [shortcutRecorder, setShortcutRecorder] = useState(IDLE_SHORTCUT_RECORDER);
  const [shortcutNotice, setShortcutNotice] = useState(null);
  const [connectionTest, setConnectionTest] = useState(IDLE_CONNECTION_TEST);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [credentialUpdateRequired, setCredentialUpdateRequired] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [hasUnsavedConnectionDraft, setHasUnsavedConnectionDraft] = useState(false);
  const [connectionDraftResetEpoch, setConnectionDraftResetEpoch] = useState(0);
  const [hasUnsavedPromptDraft, setHasUnsavedPromptDraft] = useState(false);
  const [promptDraftResetEpoch, setPromptDraftResetEpoch] = useState(0);
  const [draftExitIntent, setDraftExitIntent] = useState(null);
  const [draftExitSaveFailed, setDraftExitSaveFailed] = useState(false);
  const [connectionExitIntent, setConnectionExitIntent] = useState(null);
  const [connectionExitStatus, setConnectionExitStatus] = useState('idle');
  const [isCancellingConnection, setIsCancellingConnection] = useState(false);
  const [connectionCancelNotice, setConnectionCancelNotice] = useState('');
  const [isRetryingSave, setIsRetryingSave] = useState(false);
  const [saveRecoveryNotice, setSaveRecoveryNotice] = useState('');
  const [saveRetryReceipt, setSaveRetryReceipt] = useState(null);
  const [clipboardMonitoringIntent, setClipboardMonitoringIntent] = useState(false);
  const [clipboardMonitoringStatus, setClipboardMonitoringStatus] = useState('idle');
  const [clipboardMonitoringError, setClipboardMonitoringError] = useState('');
  const [clipboardMonitoringNotice, setClipboardMonitoringNotice] = useState({
    status: 'idle',
    message: '',
    expectedValue: null,
  });
  const [analysisLocation, setAnalysisLocation] = useState(
    () => analysisLocationForSettings(settings)
  );
  const [showSecondarySettings, setShowSecondarySettings] = useState(
    () => settings.setupMode !== SETUP_MODES.UNCONFIGURED
  );
  const [showTranslationFallback, setShowTranslationFallback] = useState(false);
  const [confirmCredentialRemoval, setConfirmCredentialRemoval] = useState(false);
  const [apiKeyDeleteConfirmationOpen, setApiKeyDeleteConfirmationOpen] = useState(false);
  const [translationFallbackStatus, setTranslationFallbackStatus] = useState('idle');
  const [translationFallbackError, setTranslationFallbackError] = useState('');
  const [translationFallbackChoice, setTranslationFallbackChoice] = useState('keep');
  const [showSetupSupport, setShowSetupSupport] = useState(false);
  const [supportDiagnostics, setSupportDiagnostics] = useState({ status: 'loading', data: null });
  const [supportNotice, setSupportNotice] = useState({ status: 'idle', message: '' });
  const connectionRevisionRef = useRef(0);
  const connectionRunRef = useRef(0);
  const connectionTestLocationRef = useRef(PROCESSING_LOCATIONS.UNKNOWN);
  const saveRetryReceiptIdRef = useRef(0);
  const connectionTaskActiveRef = useRef(false);
  const previousConnectionTestStatusRef = useRef(IDLE_CONNECTION_TEST.status);
  const connectionDraftKeysRef = useRef(new Set());
  const draftExitTriggerRef = useRef(null);
  const draftExitConfirmedRef = useRef(false);
  const draftExitWaitingForSaveRef = useRef(false);
  const connectionExitTriggerRef = useRef(null);
  const connectionExitConfirmedRef = useRef(false);
  const connectionExitStatusRef = useRef('idle');
  const settingsReturnButtonRef = useRef(null);
  const resetTriggerRef = useRef(null);
  const supportDiagnosticsRequestRef = useRef(0);
  const supportRetryButtonRef = useRef(null);
  const supportRefreshButtonRef = useRef(null);
  const supportCopyButtonRef = useRef(null);
  const clipboardShortcutControlRef = useRef(null);
  const screenshotShortcutControlRef = useRef(null);
  const shortcutSettingsRef = useRef(null);
  const connectionTestButtonRef = useRef(null);
  const connectionResultRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const clipboardMonitoringTriggerRef = useRef(null);
  const captureRequestHandledRef = useRef(null);
  const translationFallbackRemoveRef = useRef(null);

  useEffect(() => {
    onWorkspaceReadyChange?.(true);
    return () => onWorkspaceReadyChange?.(false);
  }, [onWorkspaceReadyChange]);

  const currentBackendLocation = analysisLocationForSettings(settings);
  const isGuidedSetup = settings.setupMode === SETUP_MODES.UNCONFIGURED;
  const hasSelectedFullAnalysisBackend = Boolean(analysisLocation)
    && (
      currentBackendLocation === analysisLocation
      || settings.activeBackend === LLM_BACKENDS.CUSTOM
    );
  const connectionMatchesSelectedLocation = currentBackendLocation === analysisLocation;
  const isCurrentConnectionReady = connectionMatchesSelectedLocation
    && isBackendReadyForFullAnalysis(settings);
  const isBasicTranslationSelection = settings.activeBackend === LLM_BACKENDS.FREE_TRANSLATE
    && analysisLocation === null;
  const hasUnsavedSettingsDraft = hasUnsavedConnectionDraft || hasUnsavedPromptDraft;
  const credentialExit = describeCredentialExit(settings);
  const connectionStepNumber = 3;
  const testStepNumber = connectionStepNumber + 1;
  const enableStepNumber = connectionStepNumber + 2;
  const connectionResultCopy = getConnectionResultCopy(
    connectionTest.code,
    settings.activeBackend,
    settings.setupMode === SETUP_MODES.FULL,
  );
  const draftExitCopy = describeSettingsDraftIntent(draftExitIntent, {
    guidedSetup: isGuidedSetup,
    hasConnectionDraft: hasUnsavedConnectionDraft,
    hasPromptDraft: hasUnsavedPromptDraft,
  });
  const connectionExitCopy = describeConnectionTestExitIntent(connectionExitIntent, {
    guidedSetup: isGuidedSetup,
  });
  const clipboardMonitoringCopy = describeClipboardMonitoring(settings);
  const currentProcessingLocation = processingLocationForSettings(settings);
  const providerConnectionTestRiskCopy = currentProcessingLocation === PROCESSING_LOCATIONS.ONLINE
    ? '在线服务可能产生少量调用费用，通常需要 10–60 秒。'
    : currentProcessingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK
      ? '只会连接本机回环地址；兼容服务仍可能按自己的配置联网、留存或产生费用，通常需要 10–60 秒。'
      : currentProcessingLocation === PROCESSING_LOCATIONS.LOCAL
        ? '只会连接这台 Mac 上的 Ollama，不会产生在线模型调用费用，通常需要 10–60 秒。'
        : '处理位置尚未确认；请先保存与所选路径一致的服务地址。';
  const providerConnectionExitWaitCopy = currentProcessingLocation === PROCESSING_LOCATIONS.ONLINE
    ? '继续等待可保留这次结果；停止后再离开可避免请求失去去向。在线服务可能产生少量调用费用。'
    : currentProcessingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK
      ? '继续等待可保留这次结果；停止后再离开可避免请求失去去向。本机兼容服务是否再联网或计费取决于它的配置。'
      : currentProcessingLocation === PROCESSING_LOCATIONS.LOCAL
        ? '继续等待可保留这次结果；停止后再离开可避免请求失去去向。本机 Ollama 不会产生在线模型调用费用。'
        : '继续等待可保留这次结果；停止后再离开可避免请求失去去向。当前处理位置未确认，不能声称请求仅在本机。';

  const setConnectionExitPhase = useCallback((phase) => {
    connectionExitStatusRef.current = phase;
    setConnectionExitStatus(phase);
  }, []);

  useLayoutEffect(() => {
    onQuitRiskChange?.({
      activeProviderTest: isTestingConnection || isCancellingConnection,
      activeProviderTestLocation: connectionTestLocationRef.current === PROCESSING_LOCATIONS.UNKNOWN
        ? currentProcessingLocation
        : connectionTestLocationRef.current,
      hasConnectionDraft: hasUnsavedConnectionDraft,
      hasPromptDraft: hasUnsavedPromptDraft,
      resetInProgress: isResetting,
      hasResetRecovery: Boolean(resetError),
      settingsSaving: settingsSaving || isRetryingSave,
    });
  }, [
    hasUnsavedConnectionDraft,
    hasUnsavedPromptDraft,
    isCancellingConnection,
    isRetryingSave,
    isResetting,
    isTestingConnection,
    onQuitRiskChange,
    currentProcessingLocation,
    resetError,
    settingsSaving,
  ]);

  useLayoutEffect(() => () => onQuitRiskChange?.({}), [onQuitRiskChange]);

  useEffect(() => {
    const previousStatus = previousConnectionTestStatusRef.current;
    previousConnectionTestStatusRef.current = connectionTest.status;
    if (
      previousStatus !== 'testing'
      || !['connected', 'failed'].includes(connectionTest.status)
      || connectionExitIntent
    ) return undefined;

    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        connectionResultRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [connectionExitIntent, connectionTest.status]);

  const resetConnectionTest = useCallback(() => {
    if (connectionTaskActiveRef.current) return false;
    connectionRevisionRef.current += 1;
    setConnectionTest(IDLE_CONNECTION_TEST);
    setRecoveryNotice('');
    setConnectionCancelNotice('');
    return true;
  }, []);

  const clearConnectionDrafts = useCallback(() => {
    connectionDraftKeysRef.current.clear();
    setHasUnsavedConnectionDraft(false);
  }, []);

  const discardConnectionDrafts = useCallback(() => {
    clearConnectionDrafts();
    setConnectionDraftResetEpoch((current) => current + 1);
  }, [clearConnectionDrafts]);

  const discardSettingsDraftsAndFailedWrites = useCallback(() => {
    const abandonedKeys = settingsKeysForDiscardedDrafts({
      connectionDraftKinds: connectionDraftKeysRef.current,
      backend: settings.activeBackend,
      hasPromptDraft: hasUnsavedPromptDraft,
    });
    discardConnectionDrafts();
    setHasUnsavedPromptDraft(false);
    setPromptDraftResetEpoch((current) => current + 1);
    discardFailedSettings(abandonedKeys);
  }, [
    discardConnectionDrafts,
    discardFailedSettings,
    hasUnsavedPromptDraft,
    settings.activeBackend,
  ]);

  const updateConnectionDraftState = useCallback((key, dirty) => {
    const drafts = connectionDraftKeysRef.current;
    const changed = dirty ? !drafts.has(key) : drafts.has(key);
    if (!changed) return;
    if (!resetConnectionTest()) return;
    if (dirty) drafts.add(key);
    else drafts.delete(key);
    setHasUnsavedConnectionDraft(drafts.size > 0);
  }, [resetConnectionTest]);

  const handlePrimaryDraftState = useCallback(
    (dirty) => updateConnectionDraftState('primary', dirty),
    [updateConnectionDraftState]
  );
  const handleCustomKeyDraftState = useCallback(
    (dirty) => updateConnectionDraftState('custom-key', dirty),
    [updateConnectionDraftState]
  );
  const handleModelDraftState = useCallback(
    (dirty) => updateConnectionDraftState('model', dirty),
    [updateConnectionDraftState]
  );

  const hasCurrentSuccessfulConnectionTest = connectionTest.status === 'connected'
    && connectionTest.code === 'ok'
    && connectionTest.connectionRevision === connectionRevisionRef.current
    && !hasUnsavedConnectionDraft
    && !settingsSaving;

  const clipboardShortcutStatus = shortcutStatusForKind(shortcutStatus, 'clipboard');
  const screenshotShortcutStatus = shortcutStatusForKind(shortcutStatus, 'screenshot');

  useEffect(() => {
    if (entryTarget !== 'shortcuts') return undefined;
    setShowSecondarySettings(true);
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        shortcutSettingsRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
        const target = clipboardShortcutStatus.registered === false
          ? clipboardShortcutControlRef.current
          : screenshotShortcutStatus.registered === false
            ? screenshotShortcutControlRef.current
            : clipboardShortcutControlRef.current;
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [
    clipboardShortcutStatus.registered,
    entryTarget,
    screenshotShortcutStatus.registered,
  ]);

  useEffect(() => {
    const processingTargets = {
      'processing-credentials': settings.activeBackend === LLM_BACKENDS.CUSTOM
        ? 'provider-custom-key-input'
        : 'provider-connection-input',
      'processing-model': 'provider-model-input',
      'processing-connection': 'provider-connection-input',
    };
    if (!entryTarget?.startsWith('processing-') && entryTarget !== 'full-analysis') return undefined;

    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const target = entryTarget === 'full-analysis'
          ? document.querySelector('[role="radiogroup"][aria-label="完整分析运行位置"] [role="radio"]')
          : entryTarget === 'processing-test'
            ? connectionTestButtonRef.current
            : document.getElementById(processingTargets[entryTarget]);
        target?.scrollIntoView({ block: 'center', behavior: 'auto' });
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [entryTarget, settings.activeBackend]);

  useEffect(() => {
    if (currentBackendLocation) setAnalysisLocation(currentBackendLocation);
  }, [currentBackendLocation]);

  useEffect(() => {
    if (saveError) setSaveRecoveryNotice('');
  }, [saveError]);

  const loadSupportDiagnostics = useCallback(async (preserveCurrent = false, restoreFocus = false) => {
    const requestId = supportDiagnosticsRequestRef.current + 1;
    supportDiagnosticsRequestRef.current = requestId;
    setSupportNotice({ status: 'idle', message: '' });
    setSupportDiagnostics((current) => ({
      status: 'loading',
      data: preserveCurrent ? current.data : null,
    }));
    try {
      const data = await invoke(IPC_CHANNELS.SUPPORT_DIAGNOSTICS_GET);
      if (supportDiagnosticsRequestRef.current !== requestId) return;
      if (!data || typeof data.summaryText !== 'string' || data.summaryText.length > 10000) {
        throw new Error('invalid-support-diagnostics');
      }
      setSupportDiagnostics({ status: 'ready', data });
      if (restoreFocus) {
        window.requestAnimationFrame(() => supportRefreshButtonRef.current?.focus({ preventScroll: true }));
      }
    } catch {
      if (supportDiagnosticsRequestRef.current !== requestId) return;
      setSupportDiagnostics((current) => ({ status: 'error', data: current.data }));
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          const target = preserveCurrent ? supportRefreshButtonRef.current : supportRetryButtonRef.current;
          target?.focus({ preventScroll: true });
        });
      }
    }
  }, [invoke]);

  useEffect(() => {
    if (isGuidedSetup && !showSetupSupport) return undefined;
    loadSupportDiagnostics(false);
    return () => {
      supportDiagnosticsRequestRef.current += 1;
    };
  }, [isGuidedSetup, loadSupportDiagnostics, showSetupSupport]);

  const handleCopyDiagnostics = useCallback(async () => {
    const summaryText = supportDiagnostics.data?.summaryText;
    if (!summaryText || clipboardWritePending || typeof onWriteClipboard !== 'function') return;
    setSupportNotice({ status: 'idle', message: '' });
    try {
      await onWriteClipboard('diagnostics', summaryText);
    } catch {
      // The clipboard owner publishes the authoritative result, including busy rejection.
    } finally {
      window.requestAnimationFrame(() => supportCopyButtonRef.current?.focus({ preventScroll: true }));
    }
  }, [clipboardWritePending, onWriteClipboard, supportDiagnostics.data?.summaryText]);

  const handleOpenScreenRecordingSettings = useCallback(async () => {
    setSupportNotice({ status: 'idle', message: '' });
    try {
      await invoke(IPC_CHANNELS.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS);
      setSupportNotice({ status: 'success', message: '已打开屏幕录制设置；授权后返回这里刷新状态。' });
    } catch {
      setSupportNotice({
        status: 'error',
        message: '暂时无法打开系统设置；请手动前往“隐私与安全性 → 屏幕录制”。',
      });
    }
  }, [invoke]);

  const closeResetConfirmation = useCallback(() => {
    if (isResetting) return;
    setConfirmReset(false);
    setResetError('');
    setResetSessionAlreadyCleared(false);
  }, [isResetting]);

  const handleRetrySettingsSave = useCallback(async () => {
    if (isRetryingSave || settingsSaving) return;
    setIsRetryingSave(true);
    setSaveRecoveryNotice('');
    try {
      const retryResult = await retryFailedSettings();
      if (retryResult?.status === 'saved') {
        const savedSettingKeys = retryResult.savedSettingKeys || [];
        if (savedSettingKeys.includes('customPrompt')) setShowSecondarySettings(true);
        const connectionDraftKinds = connectionDraftKindsForRetriedSettings(
          savedSettingKeys,
          settings.activeBackend,
        );
        saveRetryReceiptIdRef.current += 1;
        setSaveRetryReceipt(Object.freeze({
          ...retryResult,
          id: saveRetryReceiptIdRef.current,
          connectionDraftKinds,
        }));
        if (savedSettingKeys.includes(CREDENTIAL_SETTING_BY_BACKEND[settings.activeBackend])) {
          setCredentialUpdateRequired(false);
        }
        setSaveRecoveryNotice('刚才的设置已保存，可以继续。');
      }
    } catch {
      // Keep the actionable error card visible for another retry.
    } finally {
      setIsRetryingSave(false);
    }
  }, [isRetryingSave, retryFailedSettings, settings.activeBackend, settingsSaving]);

  useEffect(() => {
    if (
      saveRetryReceipt?.status !== 'saved'
      || isRetryingSave
      || settingsSaving
    ) return undefined;
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const connectionRetry = saveRetryReceipt.connectionDraftKinds?.length > 0;
        const promptRetry = saveRetryReceipt.savedSettingKeys?.includes('customPrompt');
        let promptDetails = null;
        if (promptRetry) {
          const secondaryDetails = settingsPanelRef.current
            ?.querySelector('.secondary-settings');
          promptDetails = settingsPanelRef.current
            ?.querySelector('.secondary-settings__advanced');
          if (secondaryDetails) secondaryDetails.open = true;
          if (promptDetails) promptDetails.open = true;
        }
        const testButton = connectionTestButtonRef.current;
        let target = promptRetry
          ? settingsPanelRef.current?.querySelector('#custom-prompt-input:not(:disabled)') || null
          : connectionRetry && testButton && !testButton.disabled
          ? testButton
          : null;
        if (!target && connectionRetry) {
          const dirtyStatus = settingsPanelRef.current
            ?.querySelector('.setting-save-status.is-dirty');
          target = dirtyStatus?.closest('.setting-editor-actions')?.parentElement
            ?.querySelector('input:not(:disabled)') || null;
          if (!target) {
            const primaryInput = settingsPanelRef.current
              ?.querySelector('#provider-connection-input:not(:disabled)');
            target = primaryInput || null;
          }
        }
        if (!target) target = settingsReturnButtonRef.current;
        target?.focus({ preventScroll: true });
        if (target && document.activeElement !== target) {
          const promptSummary = promptRetry
            ? promptDetails?.querySelector('summary')
            : null;
          target = promptSummary || settingsReturnButtonRef.current;
          target?.focus({ preventScroll: true });
        }
        if (target && document.activeElement === target) {
          target.scrollIntoView({
            behavior: 'auto',
            block: 'nearest',
            inline: 'nearest',
          });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [isRetryingSave, saveRetryReceipt, settingsSaving]);

  const saveSetting = useCallback(
    (key, value) => updateSettings(key, value).catch(() => false),
    [updateSettings]
  );

  const saveRadioSetting = useCallback(async (key, value, attemptedRadio) => {
    const saved = await saveSetting(key, value);
    if (!saved) restoreAuthoritativeRadioFocus(attemptedRadio);
    return saved;
  }, [saveSetting]);

  const applyBackendChange = useCallback(
    async (backend, attemptedRadio = null, locationHint = null) => {
      const nextLocation = locationHint || analysisLocationForBackend(backend, settings);
      if (backend === settings.activeBackend) {
        if (nextLocation) setAnalysisLocation(nextLocation);
        return true;
      }
      if (!resetConnectionTest()) {
        restoreAuthoritativeRadioFocus(attemptedRadio);
        return false;
      }
      if (nextLocation) setAnalysisLocation(nextLocation);
      setCredentialUpdateRequired(false);
      clearConnectionDrafts();
      const models = MODEL_IDS[backend] || [];
      const activeModel = models.includes(settings.activeModel) ? settings.activeModel : models[0];
      try {
        await updateMultipleSettings({
          setupMode: SETUP_MODES.UNCONFIGURED,
          activeBackend: backend,
          activeModel,
        });
        return true;
      } catch {
        restoreAuthoritativeRadioFocus(attemptedRadio);
        return false;
      }
    },
    [clearConnectionDrafts, resetConnectionTest, settings, updateMultipleSettings]
  );

  const applyAnalysisLocationChange = useCallback((location, attemptedRadio = null) => {
    if (location === ANALYSIS_LOCATIONS.LOCAL) {
      if (currentBackendLocation === ANALYSIS_LOCATIONS.LOCAL) {
        setAnalysisLocation(location);
        return true;
      }
      return applyBackendChange(LLM_BACKENDS.OLLAMA, attemptedRadio, location);
    }
    if (currentBackendLocation === ANALYSIS_LOCATIONS.ONLINE) {
      setAnalysisLocation(location);
      return true;
    }
    if (!resetConnectionTest()) {
      restoreAuthoritativeRadioFocus(attemptedRadio);
      return false;
    }
    setAnalysisLocation(location);
    clearConnectionDrafts();
    return true;
  }, [applyBackendChange, clearConnectionDrafts, currentBackendLocation, resetConnectionTest]);

  const applyTranslationFallback = useCallback(async (removeCredential = false) => {
    if (translationFallbackStatus === 'saving' || settingsSaving) return;
    if (!resetConnectionTest()) return;
    setTranslationFallbackChoice(removeCredential ? 'remove' : 'keep');
    setTranslationFallbackStatus('saving');
    setTranslationFallbackError('');
    clearConnectionDrafts();
    try {
      await updateMultipleSettings(buildTranslationFallbackPauseUpdates(
        settings,
        removeCredential,
      ));
      const [completionKey, completionValue] = translationFallbackCompletionUpdate();
      await updateSettings(completionKey, completionValue);
      setAnalysisLocation(null);
      setConfirmCredentialRemoval(false);
      setTranslationFallbackStatus('idle');
      onSetupComplete?.();
    } catch {
      setTranslationFallbackStatus('error');
      setTranslationFallbackError(
        '切换没有完整保存。当前任务仍保留，完整分析已暂停；重试会继续完成同一个选择。',
      );
    }
  }, [
    clearConnectionDrafts,
    onSetupComplete,
    resetConnectionTest,
    settings,
    settingsSaving,
    translationFallbackStatus,
    updateMultipleSettings,
    updateSettings,
  ]);

  const activateMode = useCallback(
    async (mode) => {
      const translationOnly = mode === SETUP_MODES.TRANSLATION_ONLY;
      if (
        !translationOnly &&
        (
          !isCurrentConnectionReady ||
          hasUnsavedConnectionDraft ||
          settingsSaving ||
          !hasCurrentSuccessfulConnectionTest ||
          connectionTest.connectionRevision !== connectionRevisionRef.current
        )
      ) return;
      try {
        await updateMultipleSettings(translationOnly ? {
          setupMode: mode,
          activeBackend: LLM_BACKENDS.FREE_TRANSLATE,
          activeModel: MODEL_IDS[LLM_BACKENDS.FREE_TRANSLATE][0],
        } : { setupMode: mode });
        onSetupComplete?.();
      } catch {
        // The persistent error banner explains what failed.
      }
    },
    [
      connectionTest,
      hasCurrentSuccessfulConnectionTest,
      hasUnsavedConnectionDraft,
      isCurrentConnectionReady,
      onSetupComplete,
      settingsSaving,
      updateMultipleSettings,
    ]
  );

  const performDraftExitIntent = useCallback((intent, trigger = null) => {
    if (!intent) return;
    clearConnectionDrafts();
    if (intent.kind === 'close') {
      onClose?.();
      return;
    }
    if (intent.kind === 'capture') {
      onCaptureRequestApproved?.({
        id: intent.requestId,
        kind: intent.captureKind,
      });
      return;
    }
    if (intent.kind === 'translation-fallback') {
      applyTranslationFallback(intent.removeCredential === true);
      return;
    }
    if (intent.kind === 'activate-mode') {
      activateMode(intent.value);
      return;
    }
    if (intent.kind === 'backend') {
      applyBackendChange(intent.value, trigger, intent.location);
      return;
    }
    if (intent.kind === 'location') applyAnalysisLocationChange(intent.value, trigger);
  }, [
    applyAnalysisLocationChange,
    applyBackendChange,
    applyTranslationFallback,
    activateMode,
    clearConnectionDrafts,
    onCaptureRequestApproved,
    onClose,
  ]);

  const requestConnectionExitIntent = useCallback((intent, trigger = null) => {
    if (settingsExitOwner({ isTestingConnection }) !== 'connection') {
      performDraftExitIntent(intent, trigger);
      return true;
    }
    connectionExitTriggerRef.current = trigger || settingsReturnButtonRef.current;
    connectionExitConfirmedRef.current = false;
    setConnectionExitPhase('idle');
    setConnectionExitIntent(intent);
    return false;
  }, [isTestingConnection, performDraftExitIntent, setConnectionExitPhase]);

  const requestDraftExitIntent = useCallback((intent, trigger = null) => {
    if (settingsExitOwner({
      hasUnsavedConnectionDraft,
      hasUnsavedPromptDraft,
      isTestingConnection,
    }) !== 'draft') {
      requestConnectionExitIntent(intent, trigger);
      return;
    }
    draftExitTriggerRef.current = trigger || settingsReturnButtonRef.current;
    draftExitConfirmedRef.current = false;
    draftExitWaitingForSaveRef.current = settingsSaving;
    setDraftExitSaveFailed(false);
    setDraftExitIntent(intent);
  }, [
    hasUnsavedConnectionDraft,
    hasUnsavedPromptDraft,
    isTestingConnection,
    requestConnectionExitIntent,
    settingsSaving,
  ]);

  const requestClose = useCallback((trigger = null) => {
    requestDraftExitIntent({ kind: 'close' }, trigger);
  }, [requestDraftExitIntent]);

  useEffect(() => {
    if (
      !captureRequest?.id
      || captureRequest.kind === 'clipboard-error'
      || captureRequestHandledRef.current === captureRequest.id
      || appDecisionBlocked
      || confirmReset
      || confirmCredentialRemoval
      || apiKeyDeleteConfirmationOpen
      || draftExitIntent
      || connectionExitIntent
      || clipboardMonitoringIntent
      || clipboardWritePending
      || translationFallbackStatus === 'saving'
    ) return;
    captureRequestHandledRef.current = captureRequest.id;
    if (isGuidedSetup) return;
    requestDraftExitIntent({
      kind: 'capture',
      requestId: captureRequest.id,
      captureKind: captureRequest.kind,
    }, settingsReturnButtonRef.current);
  }, [
    appDecisionBlocked,
    apiKeyDeleteConfirmationOpen,
    captureRequest,
    clipboardMonitoringIntent,
    clipboardWritePending,
    confirmCredentialRemoval,
    confirmReset,
    connectionExitIntent,
    draftExitIntent,
    isGuidedSetup,
    requestDraftExitIntent,
    translationFallbackStatus,
  ]);

  const requestBackendChange = useCallback((backend, trigger = null, location = analysisLocation) => {
    if (backend === settings.activeBackend && location === analysisLocation) return;
    requestDraftExitIntent({ kind: 'backend', value: backend, location }, trigger);
  }, [analysisLocation, requestDraftExitIntent, settings.activeBackend]);

  const requestAnalysisLocationChange = useCallback((location, trigger = null) => {
    if (location === analysisLocation) return;
    requestDraftExitIntent({ kind: 'location', value: location }, trigger);
  }, [analysisLocation, requestDraftExitIntent]);

  const requestTranslationFallback = useCallback((removeCredential, trigger = null) => {
    setTranslationFallbackError('');
    requestDraftExitIntent({
      kind: 'translation-fallback',
      removeCredential: removeCredential === true,
    }, trigger);
  }, [requestDraftExitIntent]);

  const dismissDraftExitIntent = useCallback(() => {
    draftExitWaitingForSaveRef.current = false;
    setDraftExitSaveFailed(false);
    setDraftExitIntent(null);
  }, []);

  const dismissConnectionExitIntent = useCallback(() => {
    if (connectionExitStatusRef.current === 'cancelling') return;
    setConnectionExitIntent(null);
    setConnectionExitPhase('idle');
  }, [setConnectionExitPhase]);

  const reviewCompletedConnectionTest = useCallback(() => {
    connectionExitConfirmedRef.current = true;
    dismissConnectionExitIntent();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const result = connectionResultRef.current;
        const testButton = connectionTestButtonRef.current;
        const target = result?.isConnected
          ? result
          : testButton?.isConnected && !testButton.disabled
            ? testButton
            : settingsReturnButtonRef.current;
        target?.focus({ preventScroll: true });
      });
    });
  }, [dismissConnectionExitIntent]);

  const restoreFocusAfterDraftIntent = useCallback((intent, preferredTarget = null) => {
    if (intent?.kind === 'close' || intent?.kind === 'capture') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const trigger = preferredTarget || draftExitTriggerRef.current;
        const canFocus = (target) => Boolean(
          target
          && target.isConnected
          && !target.matches?.(':disabled, [aria-disabled="true"]')
          && !target.closest?.('[inert]'),
        );
        const target = canFocus(trigger)
          ? trigger
          : canFocus(settingsReturnButtonRef.current) ? settingsReturnButtonRef.current : null;
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const confirmDraftExitIntent = useCallback(() => {
    if (!draftExitIntent || settingsSaving) return false;
    const intent = draftExitIntent;
    draftExitConfirmedRef.current = true;
    draftExitWaitingForSaveRef.current = false;
    setDraftExitSaveFailed(false);
    setDraftExitIntent(null);
    discardSettingsDraftsAndFailedWrites();
    const completedDirectly = requestConnectionExitIntent(intent, draftExitTriggerRef.current);
    if (completedDirectly) restoreFocusAfterDraftIntent(intent);
    return true;
  }, [
    discardSettingsDraftsAndFailedWrites,
    draftExitIntent,
    requestConnectionExitIntent,
    restoreFocusAfterDraftIntent,
    settingsSaving,
  ]);

  useEffect(() => {
    if (
      !draftExitIntent ||
      !draftExitWaitingForSaveRef.current ||
      settingsSaving
    ) return;
    if (hasUnsavedSettingsDraft) {
      if (saveError) {
        draftExitWaitingForSaveRef.current = false;
        setDraftExitSaveFailed(true);
      }
      return;
    }
    const intent = draftExitIntent;
    draftExitConfirmedRef.current = true;
    draftExitWaitingForSaveRef.current = false;
    setDraftExitSaveFailed(false);
    setDraftExitIntent(null);
    clearConnectionDrafts();
    const completedDirectly = requestConnectionExitIntent(intent, draftExitTriggerRef.current);
    if (completedDirectly) restoreFocusAfterDraftIntent(intent);
  }, [
    clearConnectionDrafts,
    draftExitIntent,
    hasUnsavedSettingsDraft,
    requestConnectionExitIntent,
    restoreFocusAfterDraftIntent,
    saveError,
    settingsSaving,
  ]);

  const markConnectionTestCancelled = useCallback(() => {
    connectionRunRef.current += 1;
    connectionTaskActiveRef.current = false;
    connectionRevisionRef.current += 1;
    const revision = connectionRevisionRef.current;
    setIsTestingConnection(false);
    setCredentialUpdateRequired(false);
    setConnectionCancelNotice('');
    setConnectionTest({
      status: 'failed',
      code: 'cancelled-by-user',
      connectionRevision: revision,
    });
  }, []);

  const confirmConnectionExitIntent = useCallback(async () => {
    if (!connectionExitIntent || connectionExitStatus === 'cancelling') return false;
    const intent = connectionExitIntent;
    setConnectionExitPhase('cancelling');
    const response = await cancelProviderConnectionTest();
    if (isConnectionTestStopConfirmed(response)) {
      markConnectionTestCancelled();
      connectionExitConfirmedRef.current = true;
      setConnectionExitIntent(null);
      setConnectionExitPhase('idle');
      performDraftExitIntent(intent, connectionExitTriggerRef.current);
      restoreFocusAfterDraftIntent(intent, connectionExitTriggerRef.current);
      return true;
    }
    if (didConnectionTestFinishBeforeStop(response)) {
      setConnectionExitPhase('completed');
      return false;
    }
    setConnectionExitPhase('error');
    return false;
  }, [
    cancelProviderConnectionTest,
    connectionExitIntent,
    connectionExitStatus,
    markConnectionTestCancelled,
    performDraftExitIntent,
    restoreFocusAfterDraftIntent,
    setConnectionExitPhase,
  ]);

  useEffect(() => {
    if (
      !connectionExitIntent ||
      !['idle', 'cancelling', 'error'].includes(connectionExitStatus) ||
      isTestingConnection ||
      connectionTest.status === 'testing'
    ) return;
    setConnectionExitPhase('completed');
  }, [connectionExitIntent, connectionExitStatus, connectionTest.status, isTestingConnection, setConnectionExitPhase]);

  useEffect(() => {
    const handleSettingsEscape = (event) => {
      if (
        !shouldHandleBackgroundEscape(event)
        || confirmReset
        || confirmCredentialRemoval
        || apiKeyDeleteConfirmationOpen
        || draftExitIntent
        || connectionExitIntent
        || clipboardMonitoringIntent
        || shortcutRecorder.phase !== 'idle'
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose(document.activeElement);
    };
    window.addEventListener('keydown', handleSettingsEscape, true);
    return () => window.removeEventListener('keydown', handleSettingsEscape, true);
  }, [
    apiKeyDeleteConfirmationOpen,
    clipboardMonitoringIntent,
    confirmCredentialRemoval,
    confirmReset,
    connectionExitIntent,
    draftExitIntent,
    requestClose,
    shortcutRecorder.phase,
  ]);

  const handleModelChange = useCallback(
    async (model) => {
      if (!resetConnectionTest()) return false;
      try {
        if (settings.setupMode === SETUP_MODES.FULL) {
          await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        }
        await updateSettings('activeModel', model);
        return true;
      } catch {
        // The persistent error banner explains what failed.
        return false;
      }
    },
    [resetConnectionTest, settings.setupMode, updateSettings]
  );

  const handlePromptChange = useCallback(
    (prompt) => saveSetting('customPrompt', prompt),
    [saveSetting]
  );

  const handlePromptDraftStateChange = useCallback((dirty) => {
    setHasUnsavedPromptDraft(dirty);
    if (!dirty) discardFailedSettings(['customPrompt']);
  }, [discardFailedSettings]);

  const handleApiKeyChange = useCallback(
    async (value) => {
      if (!resetConnectionTest()) return false;
      const keyMap = {
        [LLM_BACKENDS.ANTHROPIC]: 'anthropicApiKey',
        [LLM_BACKENDS.OPENAI]: 'openaiApiKey',
        [LLM_BACKENDS.DEEPSEEK]: 'deepseekApiKey',
        [LLM_BACKENDS.OLLAMA]: 'ollamaBaseUrl',
        [LLM_BACKENDS.CUSTOM]: 'customEndpointUrl',
      };
      const settingKey = keyMap[settings.activeBackend];
      if (settingKey) {
        if (settings.setupMode === SETUP_MODES.FULL) {
          await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        }
        const saved = await updateSettings(settingKey, value);
        setCredentialUpdateRequired(false);
        return saved;
      }
    },
    [resetConnectionTest, settings, updateSettings]
  );

  const handleCustomApiKeyChange = useCallback(
    async (value) => {
      if (!resetConnectionTest()) return false;
      if (settings.setupMode === SETUP_MODES.FULL) {
        await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
      }
      const saved = await updateSettings('customEndpointApiKey', value);
      setCredentialUpdateRequired(false);
      return saved;
    },
    [resetConnectionTest, settings.setupMode, updateSettings]
  );

  const handleCredentialDelete = useCallback(
    async (credentialSetting) => {
      if (!credentialSetting) return false;
      // Invalidate a previously successful probe before the first persisted
      // write so a late response cannot briefly re-enable the old credential.
      if (!resetConnectionTest()) return false;
      try {
        if (settings.setupMode === SETUP_MODES.FULL) {
          await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        }
        await updateSettings(credentialSetting, '');
        setCredentialUpdateRequired(false);
        return true;
      } catch {
        throw new Error('settings-save-failed');
      }
    },
    [resetConnectionTest, settings.setupMode, updateSettings]
  );

  const handleConnectionTest = useCallback(async () => {
    if (
      connectionTaskActiveRef.current ||
      isTestingConnection ||
      isCancellingConnection ||
      credentialUpdateRequired ||
      hasUnsavedConnectionDraft ||
      settingsSaving ||
      !isCurrentConnectionReady
    ) return;
    const revision = connectionRevisionRef.current;
    const runId = connectionRunRef.current + 1;
    connectionRunRef.current = runId;
    connectionTestLocationRef.current = currentProcessingLocation;
    connectionTaskActiveRef.current = true;
    setRecoveryNotice('');
    setConnectionCancelNotice('');
    setIsTestingConnection(true);
    setConnectionTest({ status: 'testing', code: 'testing' });
    const result = await testProviderConnection();
    if (connectionRunRef.current === runId && connectionRevisionRef.current === revision) {
      if (Object.values(PROCESSING_LOCATIONS).includes(result.processingLocation)) {
        connectionTestLocationRef.current = result.processingLocation;
      }
      connectionTaskActiveRef.current = false;
      setCredentialUpdateRequired(
        result.code === 'unauthorized' || result.code === 'missing-credentials'
      );
      setConnectionTest({
        ...result,
        connectionRevision: revision,
      });
      setIsTestingConnection(false);
    }
  }, [
    credentialUpdateRequired,
    hasUnsavedConnectionDraft,
    isCancellingConnection,
    isCurrentConnectionReady,
    isTestingConnection,
    currentProcessingLocation,
    settingsSaving,
    testProviderConnection,
  ]);

  const handleCancelConnectionTest = useCallback(async () => {
    if (!isTestingConnection || isCancellingConnection) return;
    setIsCancellingConnection(true);
    setConnectionCancelNotice('');
    const response = await cancelProviderConnectionTest();
    if (isConnectionTestStopConfirmed(response)) {
      markConnectionTestCancelled();
      window.requestAnimationFrame(() => connectionTestButtonRef.current?.focus({ preventScroll: true }));
    } else if (!didConnectionTestFinishBeforeStop(response)) {
      setConnectionCancelNotice('没有收到停止确认；验证可能仍在运行。请重试停止，或继续等待结果。');
    }
    setIsCancellingConnection(false);
  }, [
    cancelProviderConnectionTest,
    isCancellingConnection,
    isTestingConnection,
    markConnectionTestCancelled,
  ]);

  const handleRecoveryAction = useCallback(async (action) => {
    if (action.kind === 'copy' && clipboardWritePending) return;
    setRecoveryNotice('');
    if (action.kind === 'retry') {
      if (credentialUpdateRequired) {
        setRecoveryNotice('请先更新并保存 API Key，再重新验证。');
        return;
      }
      await handleConnectionTest();
      return;
    }
    if (action.kind === 'switch-online') {
      applyAnalysisLocationChange(ANALYSIS_LOCATIONS.ONLINE);
      window.requestAnimationFrame(() => {
        document.getElementById('online-provider-title')?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    if (action.kind === 'focus') {
      const target = document.getElementById(action.value);
      if (!target) {
        setRecoveryNotice('没有找到要修改的输入项，请回到上方检查连接信息。');
        return;
      }
      target.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
      target.focus({ preventScroll: true });
      return;
    }
    if (action.kind === 'copy') {
      if (typeof onWriteClipboard !== 'function') return;
      try {
        await onWriteClipboard('recovery-command', action.value);
      } catch {
        // The clipboard owner publishes the authoritative result, including busy rejection.
      }
      return;
    }
    try {
      if (action.kind === 'open') {
        await invoke(IPC_CHANNELS.EXTERNAL_OPEN, action.value);
        setRecoveryNotice('已在浏览器中打开官方页面。');
      }
    } catch {
      setRecoveryNotice('暂时无法打开官方页面，请检查网络后重试。');
    }
  }, [
    applyAnalysisLocationChange,
    clipboardWritePending,
    credentialUpdateRequired,
    handleConnectionTest,
    invoke,
    onWriteClipboard,
  ]);

  useEffect(() => {
    if (
      clipboardMonitoringNotice.status !== 'error'
      || clipboardMonitoringNotice.expectedValue !== settings.clipboardMonitoring
    ) return;
    setClipboardMonitoringNotice({
      status: 'success',
      message: settings.clipboardMonitoring
        ? clipboardMonitoringCopy.enabledNotice
        : '自动检测已关闭；新复制的文字不会再自动处理。',
      expectedValue: settings.clipboardMonitoring,
    });
  }, [
    clipboardMonitoringCopy.enabledNotice,
    clipboardMonitoringNotice.expectedValue,
    clipboardMonitoringNotice.status,
    settings.clipboardMonitoring,
  ]);

  const persistClipboardMonitoring = useCallback(async (enabled) => {
    if (clipboardMonitoringStatus !== 'idle') return false;
    setClipboardMonitoringStatus(enabled ? 'enabling' : 'disabling');
    setClipboardMonitoringNotice({ status: 'idle', message: '', expectedValue: null });
    if (enabled) setClipboardMonitoringError('');
    try {
      await updateSettings('clipboardMonitoring', enabled);
      loadSupportDiagnostics(true);
      if (enabled) {
        setClipboardMonitoringIntent(false);
        setClipboardMonitoringError('');
      }
      setClipboardMonitoringNotice(enabled
        ? { status: 'idle', message: '', expectedValue: true }
        : {
          status: 'success',
          message: '自动检测已关闭；新复制的文字不会再自动处理。',
          expectedValue: false,
        });
      window.requestAnimationFrame(() => {
        clipboardMonitoringTriggerRef.current?.focus({ preventScroll: true });
      });
      return true;
    } catch {
      // This setting owns its recovery UI, so do not leave a second generic
      // retry path that could later apply a privacy-sensitive state change.
      discardFailedSettings(['clipboardMonitoring']);
      if (enabled) {
        setClipboardMonitoringError('没有开启自动检测；剪贴板内容仍不会自动处理。请重试，或保持关闭。');
      } else {
        const consequence = clipboardMonitoringCopy.kind === 'online'
          ? `新复制的文字仍会自动发送给 ${clipboardMonitoringCopy.destination}`
          : clipboardMonitoringCopy.kind === 'local-custom'
            ? '新复制的文字仍会自动发送到本机回环地址；兼容服务是否再联网取决于它的配置'
            : clipboardMonitoringCopy.kind === 'unknown'
              ? '新复制文字的处理位置仍无法确认'
              : '新复制的文字仍会在这台 Mac 上自动分析';
        setClipboardMonitoringNotice({
          status: 'error',
          message: `没有关闭自动检测；${consequence}。请重试关闭。`,
          expectedValue: false,
        });
      }
      return false;
    } finally {
      setClipboardMonitoringStatus('idle');
    }
  }, [
    clipboardMonitoringCopy.destination,
    clipboardMonitoringCopy.kind,
    clipboardMonitoringStatus,
    discardFailedSettings,
    loadSupportDiagnostics,
    updateSettings,
  ]);

  const dismissClipboardMonitoringIntent = useCallback(() => {
    if (clipboardMonitoringStatus !== 'idle') return;
    if (clipboardMonitoringError) discardFailedSettings(['clipboardMonitoring']);
    setClipboardMonitoringIntent(false);
    setClipboardMonitoringError('');
  }, [clipboardMonitoringError, clipboardMonitoringStatus, discardFailedSettings]);

  const handleClipboardToggle = useCallback((event) => {
    clipboardMonitoringTriggerRef.current = event.currentTarget;
    if (event.target.checked) {
      setClipboardMonitoringNotice({ status: 'idle', message: '', expectedValue: null });
      setClipboardMonitoringError('');
      setClipboardMonitoringIntent(true);
      return;
    }
    persistClipboardMonitoring(false);
  }, [persistClipboardMonitoring]);

  const handleShortcutChange = useCallback(async (key, value, { restoreFocus = false } = {}) => {
    const kind = key === 'clipboardShortcut' ? 'clipboard' : 'screenshot';
    const label = kind === 'clipboard' ? '剪贴板解释' : '截图 OCR';
    const validation = analyzeShortcutAccelerator(value);
    const previousValue = settings[key];
    const previousDisplay = displayShortcutAccelerator(previousValue);
    const currentStatus = kind === 'clipboard' ? clipboardShortcutStatus : screenshotShortcutStatus;
    const controlRef = kind === 'clipboard' ? clipboardShortcutControlRef : screenshotShortcutControlRef;

    if (!validation.ok) {
      setShortcutNotice({
        status: 'error',
        key,
        message: `${shortcutRecorderHint(validation.reason)}当前仍使用 ${previousDisplay}。`,
      });
      window.requestAnimationFrame(() => controlRef.current?.focus({ preventScroll: true }));
      return false;
    }

    const nextValue = validation.accelerator;
    const nextDisplay = displayShortcutAccelerator(nextValue);
    if (sameShortcutAccelerator(nextValue, previousValue) && currentStatus.registered === true) return true;
    setShortcutNotice(null);
    try {
      await updateSettings(key, nextValue);
      await refreshShortcutStatus();
      await loadSupportDiagnostics(true);
      setShortcutNotice({
        status: 'success',
        key,
        message: `${nextDisplay} 已保存并在 macOS 启用为${label}快捷键。`,
      });
      if (restoreFocus) {
        window.requestAnimationFrame(() => controlRef.current?.focus({ preventScroll: true }));
      }
      return true;
    } catch (error) {
      const code = shortcutFailureCode(error);
      if (code) {
        await loadSupportDiagnostics(true);
        const previousState = code === 'shortcut-restore-failed' || currentStatus.registered === false
          ? `原来的 ${previousDisplay} 也仍不可用；界面按钮可以继续使用。`
          : `Slipstream 已恢复并继续使用 ${previousDisplay}。`;
        const otherLabel = kind === 'clipboard' ? '截图 OCR' : '剪贴板解释';
        const message = code === 'shortcut-duplicate'
          ? `${nextDisplay} 已用于${otherLabel}；两个功能需要不同的组合。${previousState}`
          : code === 'shortcut-invalid'
            ? `${nextDisplay} 不是可用的 macOS 快捷键。${previousState}`
            : `${nextDisplay} 没有启用，可能已被其他应用或 macOS 占用。${previousState}`;
        setShortcutNotice({
          status: 'error',
          key,
          message,
        });
        window.requestAnimationFrame(() => controlRef.current?.focus({ preventScroll: true }));
      }
      return false;
    }
  }, [
    clipboardShortcutStatus,
    loadSupportDiagnostics,
    refreshShortcutStatus,
    screenshotShortcutStatus,
    settings,
    updateSettings,
  ]);

  const startShortcutRecording = useCallback((key) => {
    if (settingsSaving) return;
    setShortcutNotice(null);
    setShortcutRecorder({
      key,
      phase: 'listening',
      candidate: '',
      hint: '请按下新组合；按 Escape 取消。',
    });
  }, [settingsSaving]);

  const cancelShortcutRecording = useCallback((key, announce = false) => {
    setShortcutRecorder(IDLE_SHORTCUT_RECORDER);
    if (!announce) return;
    setShortcutNotice({
      status: 'success',
      key,
      message: `已取消更改；仍使用 ${displayShortcutAccelerator(settings[key])}。`,
    });
  }, [settings]);

  const handleShortcutRecorderKeyDown = useCallback(async (key, event) => {
    if (shortcutRecorder.key !== key || shortcutRecorder.phase !== 'listening') return;
    const result = acceleratorFromKeyboardEvent(event);
    if (result.reason === 'navigation') {
      const currentTarget = event.currentTarget;
      event.preventDefault();
      event.stopPropagation();
      cancelShortcutRecording(key);
      window.requestAnimationFrame(() => moveFocusByTab(currentTarget, event.shiftKey));
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (result.reason === 'cancelled') {
      cancelShortcutRecording(key, true);
      return;
    }
    if (!result.ok) {
      setShortcutRecorder((current) => ({
        ...current,
        hint: shortcutRecorderHint(result.reason),
      }));
      return;
    }

    const otherKey = key === 'clipboardShortcut' ? 'screenshotShortcut' : 'clipboardShortcut';
    if (sameShortcutAccelerator(result.accelerator, settings[otherKey])) {
      const otherLabel = otherKey === 'clipboardShortcut' ? '剪贴板解释' : '截图 OCR';
      setShortcutNotice({
        status: 'error',
        key,
        message: `${displayShortcutAccelerator(result.accelerator)} 已用于${otherLabel}；请按下不同组合。当前快捷键没有改变。`,
      });
      setShortcutRecorder((current) => ({
        ...current,
        hint: '请按下不同组合；按 Escape 取消。',
      }));
      return;
    }

    setShortcutRecorder({
      key,
      phase: 'saving',
      candidate: result.accelerator,
      hint: '',
    });
    await handleShortcutChange(key, result.accelerator, { restoreFocus: true });
    setShortcutRecorder(IDLE_SHORTCUT_RECORDER);
  }, [
    cancelShortcutRecording,
    handleShortcutChange,
    settings,
    shortcutRecorder,
  ]);

  const handleReset = useCallback(async (clipboardMode = 'none') => {
    if (!confirmReset || isResetting || clipboardWritePending) return false;
    setIsResetting(true);
    setResetError('');
    try {
      if (!resetConnectionTest()) throw new Error('provider-test-still-running');
      if (typeof onResetAllData !== 'function') throw new Error('full-data-reset-unavailable');
      await onResetAllData({
        clipboardMode,
        resetTransaction: runFullDataReset,
        sessionAlreadyCleared: resetSessionAlreadyCleared,
      });
      setConfirmReset(false);
      setResetSessionAlreadyCleared(false);
      return true;
    } catch (error) {
      const nextSessionAlreadyCleared = nextFullDataResetSessionCleared(
        resetSessionAlreadyCleared,
        error,
      );
      setResetSessionAlreadyCleared(nextSessionAlreadyCleared);
      setResetError(describeFullDataResetFailure(error, {
        sessionAlreadyCleared: nextSessionAlreadyCleared,
      }));
      return false;
    } finally {
      setIsResetting(false);
    }
  }, [
    clipboardWritePending,
    confirmReset,
    isResetting,
    onResetAllData,
    resetConnectionTest,
    resetSessionAlreadyCleared,
  ]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    backgroundColor: 'var(--bg-primary)',
    borderRadius: 12,
    border: '1px solid var(--border-primary)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow)',
  };

  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  };
  const supportData = supportDiagnostics.data;
  const supportGeneratedAt = supportData?.generatedAt
    ? new Date(supportData.generatedAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const screenRecordingNeedsAction = ['denied', 'restricted'].includes(
    supportData?.screenRecording?.status
  );
  const supportShortcutNeedsAction = supportData?.shortcuts?.clipboardRegistered === false
    || supportData?.shortcuts?.screenshotRegistered === false;
  const supportShortcutsReady = supportData?.shortcuts?.clipboardRegistered === true
    && supportData?.shortcuts?.screenshotRegistered === true;
  const SupportDiagnosticsDisclosure = isGuidedSetup ? 'details' : 'div';
  const analysisLocationTabStop = [
    ANALYSIS_LOCATIONS.LOCAL,
    ANALYSIS_LOCATIONS.ONLINE,
  ].includes(analysisLocation)
    ? analysisLocation
    : ANALYSIS_LOCATIONS.LOCAL;
  const onlineBackendTabStop = ONLINE_BACKEND_OPTIONS.some(
    (option) => option.value === settings.activeBackend
  )
    ? settings.activeBackend
    : ONLINE_BACKEND_OPTIONS[0].value;
  const localBackendTabStop = LOCAL_BACKEND_OPTIONS.some(
    (option) => option.value === settings.activeBackend
  )
    ? settings.activeBackend
    : LOCAL_BACKEND_OPTIONS[0].value;
  const verificationPolicy = VERIFICATION_OPTIONS.some(
    (option) => option.value === settings.verificationPolicy
  )
    ? settings.verificationPolicy
    : VERIFICATION_OPTIONS[0].value;

  return (
    <main className="settings-panel"
      ref={settingsPanelRef}
      style={containerStyle}
      aria-labelledby="settings-title"
    >
      {/* Header — drag region */}
      <div className="settings-panel__header">
        <h1 id="settings-title">
          {isGuidedSetup ? '配置完整分析' : '设置'}
        </h1>
        <button
          ref={settingsReturnButtonRef}
          className="settings-return-button"
          type="button"
          autoFocus
          data-quit-return-focus
          onClick={(event) => requestClose(event.currentTarget)}
          aria-label={settings.setupMode === SETUP_MODES.UNCONFIGURED ? '返回首次使用选择' : '返回主面板'}
        >
          <ArrowLeft size={17} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {settings.setupMode === SETUP_MODES.UNCONFIGURED ? '返回选择' : '返回'}
        </button>
      </div>

      <ClipboardActionNotice
        notice={clipboardNotice}
        onAcknowledge={onAcknowledgeClipboardConsequence}
        onDismiss={onDismissClipboardNotice}
      />

      {/* Scrollable content */}
      <div className="settings-panel__scroll">
        {entryNotice && (
          <div className="settings-entry-notice" role="status" aria-live="polite">
            <ShieldCheck size={19} weight="fill" aria-hidden="true" />
            <span>
              <strong>当前任务已安全保留</strong>
              <small>{entryNotice}</small>
            </span>
          </div>
        )}
        {captureRequest?.kind === 'clipboard-error' && (
          <div className="settings-entry-notice settings-capture-notice is-warning" role="alert">
            <WarningCircle size={19} weight="fill" aria-hidden="true" />
            <span>
              <strong>剪贴板里没有可处理的文字</strong>
              <small>设置、未保存的输入和当前任务都没有改变。复制文字后可再次按快捷键。</small>
            </span>
            <button
              type="button"
              onClick={() => onCaptureRequestDismissed?.(captureRequest.id)}
            >
              知道了
            </button>
          </div>
        )}
        {captureRequest
          && ['clipboard', 'screenshot'].includes(captureRequest.kind)
          && captureRequestHandledRef.current === captureRequest.id
          && !draftExitIntent
          && !connectionExitIntent
          && (
            <div className="settings-entry-notice settings-capture-notice" role="status" aria-live="polite">
              <ShieldCheck size={19} weight="fill" aria-hidden="true" />
              <span>
                <strong>{captureRequest.kind === 'screenshot' ? '截图请求已保留' : '快捷键捕获的文字已保留'}</strong>
                <small>
                  {isGuidedSetup
                    ? captureRequest.kind === 'screenshot'
                      ? '完整分析尚未启用；完成配置后可返回主面板决定是否开始截图。'
                      : '完整分析尚未启用；完成配置后可返回主面板决定是否处理这段文字。'
                    : captureRequest.kind === 'screenshot'
                      ? '继续设置不会启动框选；返回主面板后仍可决定是否开始截图。'
                      : '继续设置不会替换当前内容；返回主面板后仍可决定是否处理这段文字。'}
                </small>
              </span>
            </div>
          )}
        <div
          className={`settings-mode-summary${settings.setupMode === SETUP_MODES.UNCONFIGURED ? ' is-unconfigured' : ''}`}
          role="status"
        >
          <span className="settings-mode-summary__label">
            <small>当前功能模式</small>
            <strong>{modeLabel(settings.setupMode)}</strong>
          </span>
          <small className="settings-mode-summary__detail">
            {settings.setupMode === SETUP_MODES.FULL
              ? '会生成翻译、行动、材料、日期、术语与原文依据。'
              : settings.setupMode === SETUP_MODES.TRANSLATION_ONLY
                ? '只提供翻译，不生成行动简报。'
                : '完成下面的选择后才能开始使用。'}
          </small>
        </div>

        {/* Analysis location first, provider second */}
        <section className="analysis-location-section" aria-labelledby="analysis-location-title">
          <div className="settings-step-heading">
            <span>1</span>
            <div>
              <h2 id="analysis-location-title">先决定文字在哪里分析</h2>
              <p>不需要先了解模型名称。选择符合你的隐私与使用条件的路径即可。</p>
            </div>
          </div>
          <div
            className="analysis-location-options"
            role="radiogroup"
            aria-label="完整分析运行位置"
            onKeyDown={handleRadioGroupKeyDown}
          >
            <button
              type="button"
              role="radio"
              aria-checked={analysisLocation === ANALYSIS_LOCATIONS.LOCAL}
              tabIndex={analysisLocationTabStop === ANALYSIS_LOCATIONS.LOCAL ? 0 : -1}
              className={analysisLocation === ANALYSIS_LOCATIONS.LOCAL ? 'is-selected' : ''}
              onClick={(event) => requestAnalysisLocationChange(ANALYSIS_LOCATIONS.LOCAL, event.currentTarget)}
            >
              <HardDrives size={24} weight={analysisLocation === ANALYSIS_LOCATIONS.LOCAL ? 'fill' : 'regular'} />
              <span>
                <strong>连接这台 Mac 上的服务</strong>
                <small>可选 Ollama 或本机回环兼容服务；兼容服务是否再联网取决于它自己的配置。</small>
              </span>
              <em>本机入口</em>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={analysisLocation === ANALYSIS_LOCATIONS.ONLINE}
              tabIndex={analysisLocationTabStop === ANALYSIS_LOCATIONS.ONLINE ? 0 : -1}
              className={analysisLocation === ANALYSIS_LOCATIONS.ONLINE ? 'is-selected' : ''}
              onClick={(event) => requestAnalysisLocationChange(ANALYSIS_LOCATIONS.ONLINE, event.currentTarget)}
            >
              <Cloud size={24} weight={analysisLocation === ANALYSIS_LOCATIONS.ONLINE ? 'fill' : 'regular'} />
              <span>
                <strong>使用在线分析服务</strong>
                <small>适合已经拥有 API Key 的用户；主动提交的原文会发送给所选服务。</small>
              </span>
            </button>
          </div>
        </section>

        {analysisLocation === ANALYSIS_LOCATIONS.LOCAL && (
          <>
            <section className="online-provider-section" aria-labelledby="local-provider-title">
              <div className="settings-step-heading settings-step-heading--compact">
                <span>2</span>
                <div>
                  <h2 id="local-provider-title">选择这台 Mac 上的服务</h2>
                  <p>Ollama 完全在本机运行；兼容服务只通过回环地址连接，但它自身仍可能按配置联网。</p>
                </div>
              </div>
              <div
                className="backend-options"
                role="radiogroup"
                aria-label="本机分析服务"
                onKeyDown={handleRadioGroupKeyDown}
              >
                {LOCAL_BACKEND_OPTIONS.map((option) => {
                  const isSelected = settings.activeBackend === option.value;
                  return (
                    <button
                      className={`backend-option-button${isSelected ? ' is-selected' : ''}`}
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={localBackendTabStop === option.value ? 0 : -1}
                      onClick={(event) => requestBackendChange(
                        option.value,
                        event.currentTarget,
                        ANALYSIS_LOCATIONS.LOCAL,
                      )}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            {settings.activeBackend === LLM_BACKENDS.OLLAMA && (
              <div className="selected-analysis-path" role="status">
                <HardDrives size={20} />
                <span><strong>本地路径 · Ollama</strong><small>需要 Ollama 已安装、正在运行，并已下载一个可用模型。官方来源查询仍按下方策略单独处理。</small></span>
              </div>
            )}

            {settings.activeBackend === LLM_BACKENDS.CUSTOM && (
              <div className="selected-analysis-path" role="status">
                <HardDrives size={20} />
                <span><strong>本机入口 · 兼容服务</strong><small>Slipstream 只接受 localhost、127/8 或 ::1 回环地址；该服务是否再联网、转发或留存由它自己的配置决定。</small></span>
              </div>
            )}
          </>
        )}

        {analysisLocation === ANALYSIS_LOCATIONS.ONLINE && (
          <section className="online-provider-section" aria-labelledby="online-provider-title">
            <div className="settings-step-heading settings-step-heading--compact">
              <span>2</span>
              <div>
                <h2 id="online-provider-title">选择你已经在使用的服务</h2>
                <p>Slipstream 不替你创建账户；选择与你现有 API Key 对应的服务。</p>
              </div>
            </div>
            <div
              className="backend-options"
              role="radiogroup"
              aria-label="在线分析服务"
              onKeyDown={handleRadioGroupKeyDown}
            >
              {ONLINE_BACKEND_OPTIONS.map((option) => {
                const isSelected = settings.activeBackend === option.value;
                return (
                  <button
                    className={`backend-option-button${isSelected ? ' is-selected' : ''}`}
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={onlineBackendTabStop === option.value ? 0 : -1}
                    onClick={(event) => requestBackendChange(
                      option.value,
                      event.currentTarget,
                      ANALYSIS_LOCATIONS.ONLINE,
                    )}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <details
          className="translation-fallback"
          open={showTranslationFallback}
          onToggle={(event) => setShowTranslationFallback(event.currentTarget.open)}
        >
          <summary><Translate size={17} />暂时只需要基础翻译</summary>
          <div>
            <p>
              无需配置，但后续主动提交的原文会发送给 Google / MyMemory，并且只生成翻译。当前原文和上一份结果不会被清除。
            </p>
            {!isBasicTranslationSelection && (
              <div className="translation-fallback__decision">
                {credentialExit.hasSavedCredential ? (
                  <div className="translation-fallback__credential" role="note">
                    <ShieldCheck size={18} weight="fill" aria-hidden="true" />
                    <span>
                      <strong>{credentialExit.credentialLabel} 仍安全保存在这台 Mac</strong>
                      <small>
                        改用基础翻译不会自动删除它；保留后不会把凭据发送给 Google / MyMemory，以后切回 {credentialExit.providerLabel} 时可以继续使用。
                      </small>
                    </span>
                  </div>
                ) : (
                  <p className="translation-fallback__credential-empty">
                    当前没有需要删除的在线凭据；切换只会改变后续处理方式。
                  </p>
                )}

                <div className="translation-fallback__actions">
                  <button
                    type="button"
                    className="translation-fallback__keep"
                    onClick={(event) => requestTranslationFallback(false, event.currentTarget)}
                    disabled={translationFallbackStatus === 'saving' || settingsSaving || confirmCredentialRemoval}
                    aria-busy={translationFallbackStatus === 'saving'}
                  >
                    {translationFallbackStatus === 'saving' && translationFallbackChoice === 'keep'
                      ? '正在保留并切换…'
                      : credentialExit.hasSavedCredential
                        ? `保留 ${credentialExit.providerLabel} 凭据并改用`
                        : '确认改用基础翻译'}
                  </button>
                  {credentialExit.hasSavedCredential && (
                    <button
                      ref={translationFallbackRemoveRef}
                      type="button"
                      className="translation-fallback__remove"
                      onClick={() => setConfirmCredentialRemoval(true)}
                      disabled={translationFallbackStatus === 'saving' || settingsSaving || confirmCredentialRemoval}
                      aria-haspopup="dialog"
                      aria-expanded={confirmCredentialRemoval}
                      aria-controls={confirmCredentialRemoval
                        ? 'translation-fallback-credential-removal-dialog'
                        : undefined}
                    >
                      删除 {credentialExit.providerLabel} 凭据并改用
                    </button>
                  )}
                </div>
              </div>
            )}
            {isBasicTranslationSelection && settings.setupMode !== SETUP_MODES.TRANSLATION_ONLY && (
              <button
                type="button"
                className="translation-only-confirm-button"
                onClick={(event) => requestTranslationFallback(
                  translationFallbackChoice === 'remove',
                  event.currentTarget,
                )}
                disabled={translationFallbackStatus === 'saving' || settingsSaving}
              >
                {translationFallbackStatus === 'saving' ? '正在完成切换…' : '继续完成基础翻译切换'}
              </button>
            )}
            {translationFallbackError && (
              <div className="translation-fallback__error" role="alert">
                <WarningCircle size={17} weight="fill" aria-hidden="true" />
                <span>{translationFallbackError}</span>
                <button
                  type="button"
                  onClick={(event) => requestTranslationFallback(
                    translationFallbackChoice === 'remove',
                    event.currentTarget,
                  )}
                  disabled={translationFallbackStatus === 'saving' || settingsSaving}
                >
                  {translationFallbackStatus === 'saving' ? '正在重试…' : '重试完成切换'}
                </button>
              </div>
            )}
          </div>
        </details>

        {/* API Key section — hidden for free_translate */}
        {hasSelectedFullAnalysisBackend && (
          <>
            {settings.activeBackend === LLM_BACKENDS.CUSTOM
              && currentBackendLocation
              && !connectionMatchesSelectedLocation && (
                <div className="selected-analysis-path" role="alert">
                  <WarningCircle size={20} weight="fill" />
                  <span>
                    <strong>当前地址与所选路径不一致</strong>
                    <small>
                      {analysisLocation === ANALYSIS_LOCATIONS.LOCAL
                        ? '请把自定义 API 地址改为 localhost、127/8 或 ::1 回环地址；保存前不会把它称为本机服务。'
                        : '请把自定义 API 地址改为公开 HTTPS 地址；保存前不会把本机回环服务称为在线服务。'}
                    </small>
                  </span>
                </div>
              )}
            <div style={sectionTitleStyle}>{connectionStepNumber} 保存连接信息</div>
            <ApiKeyInput
              backend={settings.activeBackend}
              settingKey={CREDENTIAL_SETTING_BY_BACKEND[settings.activeBackend]}
              inputId="provider-connection-input"
              value={
                settings.activeBackend === LLM_BACKENDS.ANTHROPIC
                  ? settings.anthropicApiKey
                  : settings.activeBackend === LLM_BACKENDS.OPENAI
                  ? settings.openaiApiKey
                  : settings.activeBackend === LLM_BACKENDS.DEEPSEEK
                  ? settings.deepseekApiKey
                  : settings.activeBackend === LLM_BACKENDS.OLLAMA
                  ? settings.ollamaBaseUrl
                  : settings.activeBackend === LLM_BACKENDS.CUSTOM
                  ? settings.customEndpointUrl
                  : ''
              }
              onChange={handleApiKeyChange}
              onDelete={() => handleCredentialDelete(
                CREDENTIAL_SETTING_BY_BACKEND[settings.activeBackend],
              )}
              onDeleteFailureDismiss={() => discardFailedSettings([
                'setupMode',
                CREDENTIAL_SETTING_BY_BACKEND[settings.activeBackend],
              ].filter(Boolean))}
              onDraftStateChange={handlePrimaryDraftState}
              onDeleteConfirmationChange={setApiKeyDeleteConfirmationOpen}
              disabled={settingsSaving || isTestingConnection || isCancellingConnection || isRetryingSave}
              resetEpoch={connectionDraftResetEpoch}
              retryReceipt={saveRetryReceipt}
              isSaved={
                settings.activeBackend === LLM_BACKENDS.ANTHROPIC
                  ? settings.hasAnthropicApiKey
                  : settings.activeBackend === LLM_BACKENDS.OPENAI
                  ? settings.hasOpenaiApiKey
                  : settings.activeBackend === LLM_BACKENDS.DEEPSEEK
                  ? settings.hasDeepseekApiKey
                  : false
              }
            />

            {/* Show API key field for custom backend */}
            {settings.activeBackend === LLM_BACKENDS.CUSTOM && (
              <ApiKeyInput
                backend="custom_api_key"
                settingKey="customEndpointApiKey"
                inputId="provider-custom-key-input"
                value={settings.customEndpointApiKey}
                onChange={handleCustomApiKeyChange}
                onDelete={() => handleCredentialDelete('customEndpointApiKey')}
                onDeleteFailureDismiss={() => discardFailedSettings([
                  'setupMode',
                  'customEndpointApiKey',
                ])}
                onDraftStateChange={handleCustomKeyDraftState}
                onDeleteConfirmationChange={setApiKeyDeleteConfirmationOpen}
                disabled={settingsSaving || isTestingConnection || isCancellingConnection || isRetryingSave}
                resetEpoch={connectionDraftResetEpoch}
                retryReceipt={saveRetryReceipt}
                isSaved={settings.hasCustomEndpointApiKey}
              />
            )}

            {/* Model selector */}
            <div style={{ ...sectionTitleStyle, marginTop: 4 }}>分析模型</div>
            <ModelSelector
              backend={settings.activeBackend}
              settingKey="activeModel"
              inputId="provider-model-input"
              value={settings.activeModel}
              onChange={handleModelChange}
              onDraftStateChange={handleModelDraftState}
              disabled={settingsSaving || isTestingConnection || isCancellingConnection || isRetryingSave}
              resetEpoch={connectionDraftResetEpoch}
              retryReceipt={saveRetryReceipt}
            />

            <div style={{ ...sectionTitleStyle, marginTop: 12 }}>{testStepNumber} 测试服务与模型</div>
            <div className="provider-connection-card">
              <strong style={{ display: 'block', marginBottom: 3 }}>
                {isCurrentConnectionReady
                  ? settings.setupMode === SETUP_MODES.FULL
                    ? '连接信息已保存，可重新验证'
                    : '必需连接信息已填写，尚未验证'
                  : '继续填写连接信息'}
              </strong>
              <p>
                {isCurrentConnectionReady
                  ? settings.setupMode === SETUP_MODES.FULL
                    ? '重新验证会检查当前连接与模型能力，不会改变已经启用的功能模式。'
                    : '启用前会检查连接，并确认当前模型能从内置虚构文本生成翻译、行动、术语和流程背景，且每项通过结构与来源证据校验。'
                  : '完成上方必需信息后，才能测试当前服务与模型。'}
              </p>
              <small className="provider-connection-privacy">
                测试先读取模型元数据，再让当前模型处理一段内置、虚构的英文测试文本；若模型提出待办，会再用同一模型做一次短复核。它会检查翻译、行动、术语、流程背景及其来源证据，不会发送截图、剪贴板、你的任务原文或高级分析说明。{providerConnectionTestRiskCopy}
              </small>
              <button
                type="button"
                className="provider-connection-test-button"
                ref={connectionTestButtonRef}
                disabled={
                  !isCurrentConnectionReady ||
                  hasUnsavedConnectionDraft ||
                  settingsSaving ||
                  credentialUpdateRequired ||
                  isCancellingConnection ||
                  isTestingConnection
                }
                onClick={handleConnectionTest}
                aria-busy={isTestingConnection}
              >
                {hasUnsavedConnectionDraft
                  ? '请先保存当前输入…'
                  : settingsSaving
                  ? '正在保存设置…'
                  : credentialUpdateRequired
                    ? '请先更新并保存 API Key'
                  : isCancellingConnection
                    ? '正在停止验证…'
                  : isTestingConnection
                    ? '正在验证完整分析能力…'
                    : connectionTest.status === 'failed' || connectionTest.status === 'inconclusive'
                      ? '重新验证完整分析能力'
                      : settings.setupMode === SETUP_MODES.FULL
                        ? '重新验证完整分析能力'
                        : '验证完整分析能力'}
              </button>
              {isTestingConnection && (
                <>
                  <div className="provider-connection-progress">
                    <CircleNotch size={17} weight="bold" aria-hidden="true" />
                    <span role="status" aria-live="polite">
                      <strong>{isCancellingConnection ? '正在停止验证' : '正在验证完整分析能力'}</strong>
                      <small>
                        {isCancellingConnection
                          ? '确认模型请求已经结束前，会保留当前设置与进度。'
                          : '正在检查翻译、行动、术语和流程背景的结构与来源证据。连接信息暂时锁定；验证只使用内置虚构文本，不会使用你的内容。'}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="provider-connection-cancel-button"
                      onClick={handleCancelConnectionTest}
                      disabled={isCancellingConnection}
                      aria-busy={isCancellingConnection}
                    >
                      {isCancellingConnection ? '正在停止…' : connectionCancelNotice ? '重试停止' : '取消测试'}
                    </button>
                  </div>
                  {connectionCancelNotice && (
                    <p className="provider-connection-cancel-notice" role="alert">
                      <WarningCircle size={15} weight="fill" aria-hidden="true" />
                      <span>{connectionCancelNotice}</span>
                    </p>
                  )}
                </>
              )}
              {connectionTest.status !== 'idle' && connectionTest.status !== 'testing' && (
                <div
                  ref={connectionResultRef}
                  className="provider-connection-result"
                  data-status={connectionTest.status}
                  role="region"
                  aria-label={`${connectionResultCopy[0]}：${connectionResultCopy[1]}`}
                  tabIndex={-1}
                >
                  <div className="provider-connection-result-summary" role="status" aria-live="polite">
                    <strong>{connectionResultCopy[0]}</strong>
                    <span>{connectionResultCopy[1]}</span>
                  </div>
                  {connectionTest.code !== 'ok' && (
                    <ConnectionRecovery
                      code={connectionTest.code}
                      backend={settings.activeBackend}
                      model={settings.activeModel}
                      notice={recoveryNotice}
                      onAction={handleRecoveryAction}
                      clipboardWritePending={clipboardWritePending}
                    />
                  )}
                </div>
              )}
            </div>

            <div style={{ ...sectionTitleStyle, marginTop: 12 }}>{enableStepNumber} 启用完整分析</div>
            <div style={{ padding: '11px 12px', marginBottom: 12, borderRadius: 9, background: 'var(--accent-light)', color: 'var(--accent-ink)', fontSize: 11, lineHeight: 1.5 }}>
              <strong style={{ display: 'block', marginBottom: 3 }}>
                {settings.setupMode === SETUP_MODES.FULL ? '完整分析已启用' : '功能模式由你决定'}
              </strong>
              {settings.setupMode === SETUP_MODES.FULL
                ? '完整分析能力测试只检查当前配置，不会更改已经选择的功能模式。'
                : hasCurrentSuccessfulConnectionTest
                  ? '当前已保存配置通过了完整分析能力测试。启用仍由你决定。'
                  : isCurrentConnectionReady
                    ? '第一次启用前，当前已保存配置必须通过上方完整分析能力测试。测试通过也不会自动启用。'
                  : '完成上方必需信息后，才能启用完整分析。'}
              {settings.setupMode !== SETUP_MODES.FULL && (
                <button
                  type="button"
                  className="full-analysis-enable-button"
                  disabled={
                    !isCurrentConnectionReady ||
                    hasUnsavedConnectionDraft ||
                    settingsSaving ||
                    !hasCurrentSuccessfulConnectionTest
                  }
                  onClick={(event) => requestDraftExitIntent({
                    kind: 'activate-mode',
                    value: SETUP_MODES.FULL,
                  }, event.currentTarget)}
                  style={{ display: 'block', width: '100%', marginTop: 9, padding: '8px 10px', border: 'none', borderRadius: 8, background: 'var(--accent-fill)', color: 'var(--on-solid)', cursor: hasCurrentSuccessfulConnectionTest ? 'pointer' : 'not-allowed', opacity: hasCurrentSuccessfulConnectionTest ? 1 : 0.48, fontSize: 11, fontWeight: 700 }}
                >
                  {hasCurrentSuccessfulConnectionTest ? '完成配置并启用完整分析' : '请先通过完整分析能力测试'}
                </button>
              )}
              {isCurrentConnectionReady && (
                <small style={{ display: 'block', marginTop: 7, color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5 }}>
                  真实任务仍可能遇到临时网络、额度或服务错误；Slipstream 会明确提示，不会把基础翻译显示成完整结果。
                </small>
              )}
            </div>
          </>
        )}

        {analysisLocation === ANALYSIS_LOCATIONS.ONLINE && hasSelectedFullAnalysisBackend && (
          <div style={{ padding: '10px 12px', marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            当前服务会收到你主动提交的文字。剪贴板监控默认关闭，开启后复制的新文字也会自动提交。
          </div>
        )}

        {analysisLocation === ANALYSIS_LOCATIONS.LOCAL
          && settings.activeBackend === LLM_BACKENDS.CUSTOM
          && hasSelectedFullAnalysisBackend && (
            <div style={{ padding: '10px 12px', marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
              Slipstream 只会把你主动提交的文字发送到本机回环地址；该兼容服务自身是否再联网、转发、留存或计费取决于它的配置。剪贴板自动检测默认关闭。
            </div>
          )}

        {saveError && (
          <div className="settings-save-recovery" role="alert">
            <div>
              <strong>刚才的设置还没有保存</strong>
              <span>刚才的更改仍待保存；重试会继续完成同一个选择，不需要重新填写。</span>
            </div>
            <button
              type="button"
              onClick={handleRetrySettingsSave}
              disabled={isRetryingSave || settingsSaving}
              aria-busy={isRetryingSave || settingsSaving}
            >
              <ArrowClockwise size={15} weight="bold" />
              {isRetryingSave || settingsSaving ? '正在重新保存…' : '重试保存刚才的设置'}
            </button>
          </div>
        )}
        {!saveError && saveRecoveryNotice && (
          <div className="settings-save-recovered" role="status">{saveRecoveryNotice}</div>
        )}

        <details
          className="secondary-settings"
          open={showSecondarySettings}
          onToggle={(event) => setShowSecondarySettings(event.currentTarget.open)}
        >
          <summary className="secondary-settings__summary">
            {settings.setupMode === SETUP_MODES.UNCONFIGURED
              ? '其他设置 · 可以稍后调整'
              : '隐私、行为与快捷键'}
          </summary>
          <div className="secondary-settings__content">
            {/* Language hint */}
            <LanguageToggle />

            <details className="secondary-settings__advanced">
              <summary className="secondary-settings__advanced-summary">
                高级分析说明（可选）
              </summary>
              <div style={{ marginTop: 8 }}>
                <PromptEditor
                  settingKey="customPrompt"
                  inputId="custom-prompt-input"
                  value={settings.customPrompt}
                  onChange={handlePromptChange}
                  onDraftStateChange={handlePromptDraftStateChange}
                  disabled={settingsSaving || isRetryingSave}
                  resetEpoch={promptDraftResetEpoch}
                  retryReceipt={saveRetryReceipt}
                />
              </div>
            </details>

        {/* Clipboard monitoring toggle */}
        <div style={sectionTitleStyle}>行为</div>
        <div className="clipboard-monitoring-setting">
          <div className="clipboard-monitoring-setting__row">
            <span>
              <strong>自动检测剪贴板</strong>
              <small id="clipboard-monitoring-description">
                {settings.clipboardMonitoring
                  ? '当前已开启；自动处理位置与关闭操作见下方。'
                  : clipboardMonitoringCopy.kind === 'unknown'
                    ? '先完成并验证连接设置，才能开启自动检测；保持关闭不会读取新的剪贴板内容。'
                    : CLIPBOARD_MONITORING_OFF_DETAIL}
              </small>
            </span>
            <label className="clipboard-monitor-toggle">
              <input
                ref={clipboardMonitoringTriggerRef}
                type="checkbox"
                checked={settings.clipboardMonitoring}
                onChange={handleClipboardToggle}
                role="switch"
                aria-label="自动检测剪贴板"
                aria-checked={settings.clipboardMonitoring}
                aria-describedby="clipboard-monitoring-description"
                aria-busy={clipboardMonitoringStatus !== 'idle'}
                disabled={
                  clipboardMonitoringStatus !== 'idle'
                  || settingsSaving
                  || (!settings.clipboardMonitoring && clipboardMonitoringCopy.kind === 'unknown')
                }
              />
              <span aria-hidden="true"><span /></span>
            </label>
          </div>

          {settings.clipboardMonitoring && (
            <div className={`clipboard-monitoring-active is-${clipboardMonitoringCopy.kind}`} role="status">
              {clipboardMonitoringCopy.kind === 'local' || clipboardMonitoringCopy.kind === 'local-custom'
                ? <HardDrives size={19} weight="fill" aria-hidden="true" />
                : <Cloud size={19} weight="fill" aria-hidden="true" />}
              <span>
                <strong>{clipboardMonitoringCopy.activeTitle}</strong>
                <small>{clipboardMonitoringCopy.activeDetail}</small>
              </span>
              <button
                type="button"
                onClick={() => persistClipboardMonitoring(false)}
                disabled={clipboardMonitoringStatus !== 'idle' || settingsSaving}
              >
                {clipboardMonitoringStatus === 'disabling' ? '正在关闭…' : '关闭自动检测'}
              </button>
            </div>
          )}

          {clipboardMonitoringNotice.status !== 'idle' && (
            <p
              className={`clipboard-monitoring-notice is-${clipboardMonitoringNotice.status}`}
              role={clipboardMonitoringNotice.status === 'error' ? 'alert' : 'status'}
            >
              {clipboardMonitoringNotice.message}
              {clipboardMonitoringNotice.status === 'error' && (
                <button
                  type="button"
                  onClick={() => persistClipboardMonitoring(false)}
                  disabled={clipboardMonitoringStatus !== 'idle' || settingsSaving}
                >
                  {clipboardMonitoringStatus === 'disabling' ? '正在重试…' : '重试关闭'}
                </button>
              )}
            </p>
          )}
        </div>

        <div style={sectionTitleStyle}>官方来源核验</div>
        <div
          className="verification-policy"
          role="radiogroup"
          aria-label="官方来源核验策略"
          onKeyDown={handleRadioGroupKeyDown}
        >
          {VERIFICATION_OPTIONS.map((option) => {
            const selected = verificationPolicy === option.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                key={option.value}
                className={selected ? 'is-selected' : ''}
                onClick={(event) => saveRadioSetting(
                  'verificationPolicy',
                  option.value,
                  event.currentTarget,
                )}
              >
                <ShieldCheck size={19} weight={selected ? 'fill' : 'regular'} />
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>

            <section ref={shortcutSettingsRef} className="shortcut-settings" aria-labelledby="shortcut-settings-title">
              <div id="shortcut-settings-title" style={sectionTitleStyle}>快捷键</div>
              <p id="shortcut-recorder-instructions" className="shortcut-settings__intro">
                选择“更改”后直接按下新组合，无需输入格式。字母或数字需搭配 Command、Control 或 Option；F1–F24 可保存，但多数 Apple 键盘需同时按 Fn/Globe。
              </p>

              <div className="shortcut-setting">
                <label htmlFor="clipboard-shortcut-control">剪贴板解释</label>
                <button
                  ref={clipboardShortcutControlRef}
                  id="clipboard-shortcut-control"
                  type="button"
                  className={`shortcut-recorder${shortcutRecorder.key === 'clipboardShortcut' ? ' is-recording' : ''}`}
                  onClick={() => startShortcutRecording('clipboardShortcut')}
                  onKeyDown={(event) => handleShortcutRecorderKeyDown('clipboardShortcut', event)}
                  onBlur={() => {
                    if (shortcutRecorder.key === 'clipboardShortcut' && shortcutRecorder.phase === 'listening') {
                      cancelShortcutRecording('clipboardShortcut');
                    }
                  }}
                  disabled={settingsSaving || shortcutRecorder.phase === 'saving'}
                  aria-pressed={shortcutRecorder.key === 'clipboardShortcut'}
                  aria-invalid={clipboardShortcutStatus.registered === false}
                  aria-describedby="shortcut-recorder-instructions clipboard-shortcut-status"
                  aria-label={shortcutRecorder.key === 'clipboardShortcut'
                    ? '正在更改剪贴板解释快捷键；请按新组合，按 Escape 取消'
                    : `更改剪贴板解释快捷键，当前 ${clipboardShortcutStatus.displayAccelerator}`}
                >
                  {shortcutRecorder.key === 'clipboardShortcut'
                    ? <>
                        <Keyboard size={19} aria-hidden="true" />
                        <span>
                          <strong>{shortcutRecorder.phase === 'saving'
                            ? `正在启用 ${displayShortcutAccelerator(shortcutRecorder.candidate)}…`
                            : '请按新组合'}</strong>
                          <small>{shortcutRecorder.phase === 'saving'
                            ? 'macOS 正在确认是否可用。'
                            : shortcutRecorder.hint}</small>
                        </span>
                      </>
                    : <>
                        <ShortcutKeycaps value={settings.clipboardShortcut || DEFAULTS.CLIPBOARD_SHORTCUT} />
                        <span className="shortcut-recorder__action">更改</span>
                      </>}
                </button>
                <div
                  id="clipboard-shortcut-status"
                  className={`shortcut-registration is-${clipboardShortcutStatus.requiresFunctionModifier
                    ? 'unavailable' : clipboardShortcutStatus.state}`}
                  role={clipboardShortcutStatus.registered === false
                    || clipboardShortcutStatus.requiresFunctionModifier ? 'alert' : 'status'}
                >
                  {clipboardShortcutStatus.registered === true
                    && !clipboardShortcutStatus.requiresFunctionModifier
                    ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
                    : clipboardShortcutStatus.registered === false
                      || clipboardShortcutStatus.requiresFunctionModifier
                      ? <WarningCircle size={17} weight="fill" aria-hidden="true" />
                      : <CircleNotch size={17} aria-hidden="true" />}
                  <span>
                    <strong>{clipboardShortcutStatus.title}</strong>
                    <small>{clipboardShortcutStatus.detail}</small>
                  </span>
                  {clipboardShortcutStatus.requiresFunctionModifier ? (
                    <button
                      type="button"
                      onClick={() => handleShortcutChange(
                        'clipboardShortcut',
                        DEFAULTS.CLIPBOARD_SHORTCUT,
                        { restoreFocus: true },
                      )}
                      disabled={settingsSaving}
                    >
                      改为推荐组合
                    </button>
                  ) : clipboardShortcutStatus.registered === false && (
                    <button
                      type="button"
                      onClick={() => handleShortcutChange(
                        'clipboardShortcut',
                        settings.clipboardShortcut,
                        { restoreFocus: true },
                      )}
                      disabled={settingsSaving}
                    >
                      重新尝试
                    </button>
                  )}
                </div>
              </div>

              <div className="shortcut-setting">
                <label htmlFor="screenshot-shortcut-control">截图 OCR</label>
                <button
                  ref={screenshotShortcutControlRef}
                  id="screenshot-shortcut-control"
                  type="button"
                  className={`shortcut-recorder${shortcutRecorder.key === 'screenshotShortcut' ? ' is-recording' : ''}`}
                  onClick={() => startShortcutRecording('screenshotShortcut')}
                  onKeyDown={(event) => handleShortcutRecorderKeyDown('screenshotShortcut', event)}
                  onBlur={() => {
                    if (shortcutRecorder.key === 'screenshotShortcut' && shortcutRecorder.phase === 'listening') {
                      cancelShortcutRecording('screenshotShortcut');
                    }
                  }}
                  disabled={settingsSaving || shortcutRecorder.phase === 'saving'}
                  aria-pressed={shortcutRecorder.key === 'screenshotShortcut'}
                  aria-invalid={screenshotShortcutStatus.registered === false}
                  aria-describedby="shortcut-recorder-instructions screenshot-shortcut-status"
                  aria-label={shortcutRecorder.key === 'screenshotShortcut'
                    ? '正在更改截图 OCR 快捷键；请按新组合，按 Escape 取消'
                    : `更改截图 OCR 快捷键，当前 ${screenshotShortcutStatus.displayAccelerator}`}
                >
                  {shortcutRecorder.key === 'screenshotShortcut'
                    ? <>
                        <Keyboard size={19} aria-hidden="true" />
                        <span>
                          <strong>{shortcutRecorder.phase === 'saving'
                            ? `正在启用 ${displayShortcutAccelerator(shortcutRecorder.candidate)}…`
                            : '请按新组合'}</strong>
                          <small>{shortcutRecorder.phase === 'saving'
                            ? 'macOS 正在确认是否可用。'
                            : shortcutRecorder.hint}</small>
                        </span>
                      </>
                    : <>
                        <ShortcutKeycaps value={settings.screenshotShortcut || DEFAULTS.SCREENSHOT_SHORTCUT} />
                        <span className="shortcut-recorder__action">更改</span>
                      </>}
                </button>
                <div
                  id="screenshot-shortcut-status"
                  className={`shortcut-registration is-${screenshotShortcutStatus.requiresFunctionModifier
                    ? 'unavailable' : screenshotShortcutStatus.state}`}
                  role={screenshotShortcutStatus.registered === false
                    || screenshotShortcutStatus.requiresFunctionModifier ? 'alert' : 'status'}
                >
                  {screenshotShortcutStatus.registered === true
                    && !screenshotShortcutStatus.requiresFunctionModifier
                    ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
                    : screenshotShortcutStatus.registered === false
                      || screenshotShortcutStatus.requiresFunctionModifier
                      ? <WarningCircle size={17} weight="fill" aria-hidden="true" />
                      : <CircleNotch size={17} aria-hidden="true" />}
                  <span>
                    <strong>{screenshotShortcutStatus.title}</strong>
                    <small>{screenshotShortcutStatus.detail}</small>
                  </span>
                  {screenshotShortcutStatus.requiresFunctionModifier ? (
                    <button
                      type="button"
                      onClick={() => handleShortcutChange(
                        'screenshotShortcut',
                        DEFAULTS.SCREENSHOT_SHORTCUT,
                        { restoreFocus: true },
                      )}
                      disabled={settingsSaving}
                    >
                      改为推荐组合
                    </button>
                  ) : screenshotShortcutStatus.registered === false && (
                    <button
                      type="button"
                      onClick={() => handleShortcutChange(
                        'screenshotShortcut',
                        settings.screenshotShortcut,
                        { restoreFocus: true },
                      )}
                      disabled={settingsSaving}
                    >
                      重新尝试
                    </button>
                  )}
                </div>
              </div>

              {shortcutNotice && (
                <div
                  className={`shortcut-notice is-${shortcutNotice.status}`}
                  role={shortcutNotice.status === 'error' ? 'alert' : 'status'}
                >
                  {shortcutNotice.status === 'error'
                    ? <WarningCircle size={17} weight="fill" aria-hidden="true" />
                    : <CheckCircle size={17} weight="fill" aria-hidden="true" />}
                  <span>{shortcutNotice.message}</span>
                </div>
              )}
            </section>
          </div>
        </details>

        <SupportDiagnosticsDisclosure
          className={`support-diagnostics-disclosure${isGuidedSetup ? ' is-setup' : ' is-expanded'}`}
          open={isGuidedSetup ? showSetupSupport : undefined}
          onToggle={isGuidedSetup ? (event) => {
            if (isGuidedSetup) setShowSetupSupport(event.currentTarget.open);
          } : undefined}
        >
          {isGuidedSetup && (
            <summary>
              <Desktop size={19} weight="duotone" />
              <span>
                <strong>遇到问题？查看应用状态与支持</strong>
                <small>按需读取本机状态；不会读取或发送你的原文、凭据或剪贴板内容。</small>
              </span>
            </summary>
          )}
          <section className="support-diagnostics" aria-labelledby="support-diagnostics-title">
          <header className="support-diagnostics__header">
            <span className="support-diagnostics__icon"><Desktop size={22} weight="duotone" /></span>
            <div>
              <h2 id="support-diagnostics-title">应用状态与支持</h2>
              <p>先在本机预览一份脱敏摘要，再由你决定是否复制给支持人员。</p>
            </div>
            {supportData && (
              <span
                className="support-diagnostics__version"
                data-build-identity={supportData.buildIdentity}
              >
                Slipstream {supportData.appVersion}<small>{supportData.buildKind}</small>
              </span>
            )}
          </header>

          {supportDiagnostics.status === 'loading' && !supportData && (
            <div className="support-diagnostics__loading" role="status" aria-live="polite">
              <CircleNotch size={17} />正在读取本机状态…
            </div>
          )}

          {supportDiagnostics.status === 'error' && !supportData && (
            <div className="support-diagnostics__unavailable" role="alert">
              <WarningCircle size={18} weight="fill" />
              <div><strong>暂时无法读取应用状态</strong><span>这不会影响分析；可以直接重试。</span></div>
              <button ref={supportRetryButtonRef} type="button" onClick={() => loadSupportDiagnostics(false, true)}>重试读取</button>
            </div>
          )}

          {supportData && (
            <>
              <div className="support-diagnostics__grid" aria-label="当前应用状态">
                <div>
                  <span>系统与构建</span>
                  <strong>{supportData.system.name} {supportData.system.version}</strong>
                  <small>{supportData.system.architectureLabel} · {supportData.buildKind}</small>
                </div>
                <div>
                  <span>分析方式</span>
                  <strong>{supportData.mode.label}</strong>
                  <small>{supportData.analysis.label}</small>
                </div>
                <div data-status={screenRecordingNeedsAction ? 'attention' : 'ok'}>
                  <span>屏幕录制权限</span>
                  <strong>{supportData.screenRecording.label}</strong>
                  <small>{screenRecordingNeedsAction ? '截图 OCR 需要处理' : '用于本地截图 OCR'}</small>
                </div>
                <div>
                  <span>本机使用状态</span>
                  <strong>{supportData.savedTermCount} 条已保存术语</strong>
                  <small>剪贴板自动检测{supportData.clipboardMonitoring ? '已开启' : '已关闭'}</small>
                </div>
                <div data-status={supportShortcutNeedsAction ? 'attention' : supportShortcutsReady ? 'ok' : undefined}>
                  <span>全局快捷键</span>
                  <strong>
                    {supportShortcutNeedsAction ? '需要处理' : supportShortcutsReady ? '已启用' : '尚未确认'}
                  </strong>
                  <small>
                    剪贴板 {displayShortcutAccelerator(supportData.shortcuts.clipboard)}
                    {supportData.shortcuts.clipboardRegistered === false ? '（不可用）' : ''}
                    {' · '}截图 {displayShortcutAccelerator(supportData.shortcuts.screenshot)}
                    {supportData.shortcuts.screenshotRegistered === false ? '（不可用）' : ''}
                  </small>
                </div>
              </div>

              {screenRecordingNeedsAction && (
                <div className="support-diagnostics__permission" role="note">
                  <WarningCircle size={17} weight="fill" />
                  <span><strong>截图 OCR 当前不可用</strong><small>允许屏幕录制后，返回这里刷新状态。</small></span>
                  <button type="button" onClick={handleOpenScreenRecordingSettings}>
                    <ArrowSquareOut size={14} />打开系统设置
                  </button>
                </div>
              )}

              <details className="support-diagnostics__preview">
                <summary>预览将复制的诊断摘要</summary>
                <pre tabIndex={0} aria-label="诊断摘要预览">{supportData.summaryText}</pre>
              </details>

              <div className="support-diagnostics__privacy" role="note">
                <ShieldCheck size={17} weight="fill" />
                <span>摘要不包含 API Key、服务地址、原文、术语内容或剪贴板内容，也不会自动发送。</span>
              </div>

              <div className="support-diagnostics__actions">
                <button
                  ref={supportRefreshButtonRef}
                  type="button"
                  className="secondary"
                  onClick={() => loadSupportDiagnostics(true, true)}
                  disabled={supportDiagnostics.status === 'loading'}
                  aria-busy={supportDiagnostics.status === 'loading'}
                >
                  <ArrowClockwise size={15} />
                  {supportDiagnostics.status === 'loading' ? '正在刷新…' : '刷新状态'}
                </button>
                <button
                  ref={supportCopyButtonRef}
                  type="button"
                  className="primary"
                  data-support-diagnostics-copy-action
                  onClick={handleCopyDiagnostics}
                  disabled={supportDiagnostics.status === 'loading' || clipboardWritePending}
                  aria-busy={clipboardWritePending}
                >
                  {clipboardWritePending ? <CircleNotch size={15} /> : <Copy size={15} />}
                  {clipboardWritePending ? '正在确认剪贴板复制…' : '复制诊断摘要'}
                </button>
                {supportGeneratedAt && <small>状态更新于 {supportGeneratedAt}</small>}
              </div>

              {supportDiagnostics.status === 'error' && (
                <p className="support-diagnostics__notice support-diagnostics__notice--error" role="alert">
                  <WarningCircle size={15} weight="fill" />没有刷新成功；仍显示上一次读取的状态。
                </p>
              )}
              {supportNotice.message && (
                <p
                  className={`support-diagnostics__notice support-diagnostics__notice--${supportNotice.status}`}
                  role={supportNotice.status === 'error' ? 'alert' : 'status'}
                >
                  {supportNotice.status === 'success'
                    ? <CheckCircle size={15} weight="fill" />
                    : <WarningCircle size={15} weight="fill" />}
                  {supportNotice.message}
                </p>
              )}
            </>
          )}
          </section>
        </SupportDiagnosticsDisclosure>

        {/* Reset button */}
        {!isGuidedSetup && <div className="settings-reset-trigger-region">
          <button
            ref={resetTriggerRef}
            type="button"
            className="settings-reset-trigger"
            onClick={() => {
              if (isTestingConnection || isCancellingConnection) return;
              setResetError('');
              setResetSessionAlreadyCleared(false);
              setConfirmReset(true);
            }}
            disabled={settingsSaving || clipboardWritePending || confirmReset || isTestingConnection || isCancellingConnection}
            aria-label="恢复默认设置"
            aria-haspopup="dialog"
            aria-expanded={confirmReset}
            aria-controls={confirmReset ? 'settings-reset-dialog' : undefined}
          >
            {settingsSaving
              ? '等待当前设置保存完成…'
              : clipboardWritePending
                ? '正在确认剪贴板复制…'
              : isCancellingConnection
                ? '正在停止验证…'
                : isTestingConnection
                  ? '请先取消当前验证'
                  : '清除应用内数据并恢复首次使用'}
          </button>
        </div>}
      </div>
      {confirmReset && (
        <SettingsResetDialog
          busy={isResetting}
          error={resetError}
          sessionAlreadyCleared={resetSessionAlreadyCleared}
          description={(
            <>
              这会停止并清除当前原文、结果、行动进度、撤销副本和同窗口恢复记录，
              再清除全部 API Key、连接凭据、保存的术语及所有设置，然后重新显示首次使用选择。此操作无法在应用内撤销。
            </>
          )}
          clipboardDescription={hasClipboardResidueRisk || hasClipboardCopyConsequence
            ? 'macOS 系统剪贴板不属于应用内数据。Slipstream 不会读取或自动清除当前内容；这次操作只能在你明确保留系统剪贴板后继续。如内容敏感，请先返回，在其他位置复制一段不敏感文字覆盖。'
            : 'macOS 系统剪贴板不属于应用内数据，不会被这次操作读取或更改；若你曾复制过敏感内容，请先手动确认。'}
          cancelLabel={resetSessionAlreadyCleared ? '暂不重试' : '保留我的数据'}
          cancelAriaLabel={resetSessionAlreadyCleared ? '暂不重试剩余清除' : '取消清除'}
          preserveLabel="保留剪贴板内容后清除"
          retryLabel={resetSessionAlreadyCleared
            ? '保留剪贴板内容后重试剩余清除'
            : '保留剪贴板内容后重试清除'}
          onCancel={closeResetConfirmation}
          onReset={handleReset}
          returnFocusRef={resetTriggerRef}
        />
      )}
      {confirmCredentialRemoval && (
        <CredentialRemovalDialog
          id="translation-fallback-credential-removal-dialog"
          busy={translationFallbackStatus === 'saving' || settingsSaving}
          title={`删除 ${credentialExit.credentialLabel} 并改用基础翻译？`}
          busyTitle={`正在删除 ${credentialExit.credentialLabel}`}
          description={`这会从这台 Mac 删除该凭据，无法撤销；以后重新启用 ${credentialExit.providerLabel} 时，需要重新输入并验证。确认后才会继续切换。`}
          reassurance="当前原文和上一份结果都会保留；凭据不会发送给 Google / MyMemory，删除操作也不会联系当前服务商。"
          cancelLabel="保留凭据"
          confirmLabel="删除凭据并继续"
          busyLabel="正在删除并切换…"
          onCancel={() => {
            if (translationFallbackStatus === 'saving' || settingsSaving) return;
            setConfirmCredentialRemoval(false);
          }}
          onConfirm={() => {
            setConfirmCredentialRemoval(false);
            requestTranslationFallback(true, translationFallbackRemoveRef.current);
            return true;
          }}
          returnFocusRef={translationFallbackRemoveRef}
        />
      )}
      {clipboardMonitoringIntent && (
        <ClipboardMonitoringConsentDialog
          copy={clipboardMonitoringCopy}
          saving={clipboardMonitoringStatus === 'enabling'}
          error={clipboardMonitoringError}
          onCancel={dismissClipboardMonitoringIntent}
          onConfirm={() => persistClipboardMonitoring(true)}
          returnFocusRef={clipboardMonitoringTriggerRef}
        />
      )}
      {connectionExitIntent && (
        <SettingsTransitionDialog
          id="settings-connection-exit-dialog"
          className="settings-connection-exit-dialog"
          backdropClassName="settings-connection-exit-backdrop"
          status={connectionExitStatus}
          busy={connectionExitStatus === 'cancelling'}
          error={connectionExitStatus === 'error'
            ? '没有收到停止确认；验证可能仍在运行，当前操作没有执行。'
            : ''}
          title={connectionExitStatus === 'cancelling'
            ? '正在停止验证'
            : connectionExitStatus === 'error'
              ? '验证尚未停止'
              : connectionExitStatus === 'completed'
                ? '验证已经完成'
                : '验证仍在进行'}
          description={connectionExitStatus === 'cancelling'
            ? `Slipstream 会等到模型请求实际结束后再${connectionExitCopy.actionLabel}；收到停止确认前不会离开设置。`
            : connectionExitStatus === 'error'
              ? '你仍在设置页；可以重试停止，或继续等待结果。若验证随后完成，这里会自动改为结果已就绪。'
              : connectionExitStatus === 'completed'
                ? `结果已保留在设置中，没有自动离开。查看结果后，如仍需${connectionExitCopy.actionLabel}，请重新操作。`
                : providerConnectionExitWaitCopy}
          icon={connectionExitStatus === 'completed'
            ? <CheckCircle size={21} weight="fill" />
            : undefined}
          onCancel={connectionExitStatus === 'completed'
            ? reviewCompletedConnectionTest
            : dismissConnectionExitIntent}
          onConfirm={confirmConnectionExitIntent}
          returnFocusRef={connectionExitTriggerRef}
          committedRef={connectionExitConfirmedRef}
          actions={({ safeActionProps, confirmActionProps, status }) => (
            <>
              {status !== 'cancelling' && (
                <button {...safeActionProps} data-settings-connection-safe>
                  {status === 'completed' ? '查看验证结果' : connectionExitCopy.safeLabel}
                </button>
              )}
              {(status === 'idle' || status === 'error') && (
                <button {...confirmActionProps}>
                  {status === 'error'
                    ? `重试停止并${connectionExitCopy.actionLabel}`
                    : connectionExitCopy.confirmLabel}
                </button>
              )}
              {status === 'cancelling' && (
                <button {...confirmActionProps}>正在停止…</button>
              )}
            </>
          )}
        />
      )}
      {draftExitIntent && (
        <SettingsTransitionDialog
          id="settings-draft-exit-dialog"
          status={settingsSaving ? 'busy' : draftExitSaveFailed ? 'error' : 'idle'}
          busy={settingsSaving}
          error={draftExitSaveFailed
            ? '刚才的保存没有完成；草稿仍保留，设置没有离开。'
            : ''}
          title={settingsSaving
            ? '正在完成当前保存'
            : draftExitSaveFailed ? draftExitCopy.failedTitle : draftExitCopy.title}
          description={settingsSaving
            ? `结果确认前不会离开设置。保存成功后会${draftExitCopy.actionLabel}；保存失败会保留草稿供你重试。`
            : draftExitSaveFailed
              ? `返回草稿可重试保存；只有明确选择“${draftExitCopy.confirmLabel}”才会丢弃输入。`
              : draftExitCopy.detail}
          safeLabel={draftExitSaveFailed ? '返回草稿' : draftExitCopy.safeLabel}
          confirmLabel={draftExitCopy.confirmLabel}
          busyLabel="正在保存…"
          onCancel={dismissDraftExitIntent}
          onConfirm={confirmDraftExitIntent}
          returnFocusRef={draftExitTriggerRef}
          committedRef={draftExitConfirmedRef}
        />
      )}
    </main>
  );
}
