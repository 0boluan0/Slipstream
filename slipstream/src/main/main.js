const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, screen, clipboard, dialog, shell, systemPreferences, desktopCapturer, globalShortcut } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const UI_FIXTURE_REQUEST_ENV_KEYS = Object.freeze([
  'SLIPSTREAM_UI_FIXTURE_REQUEST',
  'SLIPSTREAM_UI_FIXTURE_MODE',
  'SLIPSTREAM_UI_FIXTURE_RENDERER_URL',
  'SLIPSTREAM_UI_FIXTURE_USER_DATA',
  'SLIPSTREAM_DEMO_RESULT',
]);

function isUiFixtureStartupRequested(argv, env) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(env, key);
  return argv.includes('--ui-fixture') || UI_FIXTURE_REQUEST_ENV_KEYS.some(hasOwn);
}

const isDev = !app.isPackaged && process.argv.includes('--dev');
const uiFixtureRequested = isUiFixtureStartupRequested(process.argv, process.env);
if (app.isPackaged && uiFixtureRequested) {
  throw new Error('UI fixture mode is unavailable in packaged builds');
}
const uiFixtureMain = uiFixtureRequested
  ? require('../../scripts/ui-fixture-main')
  : null;
const {
  uiFixtureMode,
  uiFixtureCheckMode,
} = uiFixtureMain
  ? uiFixtureMain.initializeUiFixture({ app, argv: process.argv, env: process.env })
  : Object.freeze({
    uiFixtureMode: Object.freeze({ enabled: false }),
    uiFixtureCheckMode: false,
  });

app.isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.isQuitting = true;
  app.quit();
} else {
  startApplication();
}

function startApplication() {
const store = uiFixtureMode.enabled
  ? uiFixtureMain.createUiFixtureStore({ createBlockedStartupSettings })
  : require('./store');
const {
  createClipboardPayload,
  createShortcutRegistrationStatus,
  registerShortcuts,
  unregisterAll,
} = require('./global-shortcut');
const { createCaptureIngressRegistry } = require('./capture-ingress-registry');
const { sameShortcutAccelerator } = require('../shared/shortcut-accelerator.cjs');
const ScreenshotService = require('./screenshot-service');
const OCRService = require('./ocr-service');
const ClipboardMonitor = require('./clipboard-monitor');
const LLMService = uiFixtureMode.enabled ? null : require('./llm-service');
const {
  MAX_VERIFICATIONS_PER_RUN,
  createActionBrief,
  createVerificationApprovalId,
  verifyExistingActionBrief,
} = require('./action-brief-service');
const { createCaptureEnvelope } = require('./capture-envelope');
const {
  CONNECTION_CODES,
  CONNECTION_STATUSES,
} = require('./provider-connection');
const { waitForProviderConnectionStop } = require('./provider-connection-cancellation');
const { createTaskSettlement, waitForTaskSettlements } = require('./task-cancellation');
const { testProviderReadiness } = uiFixtureMode.enabled
  ? { testProviderReadiness: null }
  : require('./provider-readiness');
const { createVerificationApprovalRegistry } = require('./verification/approval-registry');
const { redactSettingsForRenderer } = require('./safe-settings');
const { resolvePublicAddresses } = require('./verification/url-safety');
const { createSupportDiagnostics } = require('./support-diagnostics');
const appPackageMetadata = require('../../package.json');
const {
  createAboutPanelOptions,
  resolveBuildIdentity,
} = require('./build-identity');
const runtimeBuildIdentity = resolveBuildIdentity({
  isPackaged: app.isPackaged,
  declaredIdentity: appPackageMetadata.slipstreamBuildIdentity,
});
const {
  createBackgroundTaskPresentation,
  createCompletedTaskState,
} = require('./background-task-status');
const { createBackgroundTaskHandoffRegistry } = require('./background-task-handoff');
const {
  assessOcrReview,
  createDestinationSha256,
  createPendingOcrReviewRegistry,
  isOcrReviewConfirmed,
} = require('./ocr-review');
const { createClipboardMonitoringTrayPresentation } = require('./clipboard-monitoring-status');
const { transitionClipboardMonitoring } = require('./clipboard-monitoring-transition');
const {
  createClipboardPendingTrayPresentation,
  normalizeClipboardPendingStatus,
} = require('./clipboard-pending-status');
const { createClipboardResidueRegistry } = require('./clipboard-residue-registry');
const { createUserDataResetRegistry } = require('./user-data-reset-registry');
const { createQuitRequestRegistry } = require('./quit-request');
const { createSettingsRequestRegistry } = require('./settings-request');
const {
  TermTransferError,
  createTermBackup,
  mergePortableTerms,
  parseTermBackup,
  serializeTermBackup,
} = require('./term-transfer');
const {
  isTrustedRendererUrl,
  validateEndpointUrl,
  validateExternalUrl,
  validateOllamaEndpointUrl,
  validateProcessOptions,
  validateProviderConnectionTestOptions,
  validateSetting,
  validateVerificationOptions,
} = require('./validation');
const {
  IPC_CHANNELS,
  DEFAULTS,
} = require('../shared/constants.cjs');
const {
  PROCESSING_LOCATION_KINDS,
  processingLocationForSettings,
} = require('../shared/endpoint-location.cjs');
const {
  ocrReviewDestinationForSettings,
} = require('../shared/ocr-review-destination.cjs');

const OCR_FAILURE_MESSAGE = '没有识别到清晰文字，请重新截图并确保文字清晰。';
const SCREEN_RECORDING_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const SCREEN_RECORDING_BLOCKED_STATUSES = new Set(['denied', 'restricted']);
const TERM_IMPORT_MAX_BYTES = 1_000_000;
const TERM_IMPORT_TTL_MS = 5 * 60 * 1000;
const USER_ERRORS = Object.freeze({
  PROCESSING_BUSY: Object.freeze({ code: 'processing-busy', message: '已有任务正在处理，请稍候。' }),
  PROCESSING_CANCELLED: Object.freeze({ code: 'processing-cancelled', message: '处理已取消。' }),
  OCR_REVIEW_REQUIRED: Object.freeze({
    code: 'ocr-review-required',
    message: '请先核对并确认截图识别的原文；确认前不会交给分析服务。',
  }),
  PROCESSING_INVALID: Object.freeze({
    code: 'processing-invalid',
    message: '模型返回的内容未通过结构与证据校验。原文和上一份有效结果已保留，请重试或更换模型。',
  }),
  PROCESSING_KEY_MISSING: Object.freeze({
    code: 'processing-key-missing',
    message: '当前在线模型还没有配置 API Key。请打开设置添加后重试，原文已保留。',
  }),
  PROCESSING_UNAUTHORIZED: Object.freeze({
    code: 'processing-unauthorized',
    message: '当前服务拒绝了连接凭据。请在设置中重新保存并测试凭据；原文和上一份有效结果已保留。',
  }),
  PROCESSING_RATE_LIMITED: Object.freeze({
    code: 'processing-rate-limited',
    message: '当前服务暂时限制了请求，或账户额度不足。请稍后重试并检查服务账户；原文和上一份有效结果已保留。',
  }),
  PROCESSING_SERVICE_UNAVAILABLE: Object.freeze({
    code: 'processing-service-unavailable',
    message: '当前分析服务暂时不可用。请稍后重试；原文和上一份有效结果已保留。',
  }),
  PROCESSING_UNREACHABLE: Object.freeze({
    code: 'processing-unreachable',
    message: '无法连接当前分析服务。请检查网络或服务地址后重试；原文和上一份有效结果已保留。',
  }),
  PROCESSING_LOCATION_UNKNOWN: Object.freeze({
    code: 'processing-location-unknown',
    message: '无法确认当前分析服务的处理位置。请在设置中重新保存并验证服务地址；原文和上一份有效结果已保留。',
  }),
  OLLAMA_UNAVAILABLE: Object.freeze({
    code: 'ollama-unavailable',
    message: '无法连接本机 Ollama。请确认 Ollama 已启动，并检查设置中的服务地址。',
  }),
  OLLAMA_RUNTIME_FAILED: Object.freeze({
    code: 'ollama-runtime-failed',
    message: 'Ollama 已连接，但当前模型无法启动或生成结果。请更新 Ollama、释放内存或更换模型后重试；原文已保留。',
  }),
  MODEL_NOT_FOUND: Object.freeze({
    code: 'model-not-found',
    message: '当前模型不存在或尚未下载。请在设置中选择可用模型；使用 Ollama 时请先拉取该模型。',
  }),
  PROCESSING_TIMEOUT: Object.freeze({
    code: 'processing-timeout',
    message: '模型响应超时。原文和上一份有效结果已保留，可直接重试或改用更快的模型。',
  }),
  PROCESSING_FAILED: Object.freeze({
    code: 'processing-failed',
    message: '处理失败。原文和上一份有效结果已保留，请检查模型设置和网络连接后重试。',
  }),
  VERIFICATION_BUSY: Object.freeze({ code: 'verification-busy', message: '已有官方核验任务正在处理，请稍候。' }),
  VERIFICATION_APPROVAL_INVALID: Object.freeze({
    code: 'verification-approval-invalid',
    message: '本次官方核验请求已失效，请重新分析原文后再试。',
  }),
  VERIFICATION_CANCELLED: Object.freeze({ code: 'verification-cancelled', message: '官方来源核验已取消。' }),
  VERIFICATION_FAILED: Object.freeze({ code: 'verification-failed', message: '官方来源核验失败，请稍后重试。' }),
  SCREENSHOT_BUSY: Object.freeze({ code: 'screenshot-busy', message: '已有截图任务正在处理，请稍候。' }),
  SCREENSHOT_EMPTY: Object.freeze({ code: 'screenshot-empty', message: OCR_FAILURE_MESSAGE }),
  SCREENSHOT_PERMISSION_DENIED: Object.freeze({
    code: 'screenshot-permission-denied',
    message: '无法读取屏幕。请到“系统设置 → 隐私与安全性 → 屏幕录制”允许 Slipstream，然后重试。',
  }),
  SCREENSHOT_OCR_FAILED: Object.freeze({
    code: 'screenshot-ocr-failed',
    message: '截图已完成，但文字识别失败。请重新框选清晰文字；若仍失败，请检查应用安装是否完整。',
  }),
  SCREENSHOT_FAILED: Object.freeze({
    code: 'screenshot-failed',
    message: '截图失败。请重新尝试；如果系统没有出现框选光标，请检查屏幕录制权限。',
  }),
});

function userError(definition, extra = {}) {
  return {
    success: false,
    ...extra,
    errorCode: definition.code,
    error: definition.message,
  };
}

function classifyProcessingError(error, backend) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (message.includes('需要先添加 api key')) return USER_ERRORS.PROCESSING_KEY_MISSING;
  if (
    status === 401
    || status === 403
    || code === 'invalid_api_key'
    || code === 'authentication_error'
  ) {
    return USER_ERRORS.PROCESSING_UNAUTHORIZED;
  }
  if (
    status === 429
    || code.includes('rate_limit')
    || code.includes('insufficient_quota')
  ) {
    return USER_ERRORS.PROCESSING_RATE_LIMITED;
  }
  if (
    message.includes('模型响应超时') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    code === 'etimedout'
  ) {
    return USER_ERRORS.PROCESSING_TIMEOUT;
  }
  if (
    code === 'model_not_found' ||
    /model[^\n]*(not found|does not exist|不存在|未找到)/i.test(message) ||
    (backend === 'ollama' && status === 404) ||
    (backend === 'ollama' && /ollama 服务错误：404/.test(message))
  ) {
    return USER_ERRORS.MODEL_NOT_FOUND;
  }
  if (
    backend === 'ollama' && (
      code === 'econnrefused' ||
      code === 'enotfound' ||
      message.includes('fetch failed') ||
      message.includes('econnrefused') ||
      message.includes('socket') ||
      message.includes('failed to connect')
    )
  ) {
    return USER_ERRORS.OLLAMA_UNAVAILABLE;
  }
  if (backend === 'ollama' && /ollama 服务错误：5\d\d/.test(message)) {
    return USER_ERRORS.OLLAMA_RUNTIME_FAILED;
  }
  if ([500, 502, 503, 504].includes(status)) {
    return USER_ERRORS.PROCESSING_SERVICE_UNAVAILABLE;
  }
  if (
    code === 'econnrefused'
    || code === 'enotfound'
    || code === 'eai_again'
    || message.includes('fetch failed')
    || message.includes('failed to connect')
    || message.includes('network error')
  ) {
    return USER_ERRORS.PROCESSING_UNREACHABLE;
  }
  return USER_ERRORS.PROCESSING_FAILED;
}

function safeProcessingBackend(backend) {
  return ['anthropic', 'custom', 'deepseek', 'free_translate', 'ollama', 'openai']
    .includes(backend) ? backend : 'unknown';
}

function requiresKnownEndpointLocation(backend) {
  return backend === 'custom' || backend === 'ollama';
}

function createAuthoritativeOcrReviewDestination(settings, processingLocation) {
  if (settings.activeBackend === 'custom') {
    validateEndpointUrl(settings.customEndpointUrl);
  } else if (settings.activeBackend === 'ollama') {
    validateOllamaEndpointUrl(settings.ollamaBaseUrl);
  }
  return ocrReviewDestinationForSettings(settings, processingLocation);
}

function processingErrorDiagnostic(error, backend) {
  const definition = classifyProcessingError(error, backend);
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  return {
    backend: safeProcessingBackend(backend),
    errorCode: definition.code,
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
  };
}

function classifyScreenshotError(error, phase) {
  if (phase === 'ocr') return USER_ERRORS.SCREENSHOT_OCR_FAILED;
  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('permission') ||
    message.includes('not authorized') ||
    message.includes('denied') ||
    message.includes('screen recording') ||
    message.includes('could not create image from display')
  ) {
    return USER_ERRORS.SCREENSHOT_PERMISSION_DENIED;
  }
  return USER_ERRORS.SCREENSHOT_FAILED;
}

function getScreenRecordingAccessStatus() {
  if (process.platform !== 'darwin') return 'unknown';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return 'unknown';
  }
}

function isScreenRecordingAccessDenied(status) {
  return SCREEN_RECORDING_BLOCKED_STATUSES.has(status);
}

async function requestScreenRecordingAccessForCapture() {
  const permissionStatus = getScreenRecordingAccessStatus();
  if (process.platform !== 'darwin' || permissionStatus === 'granted') {
    return { granted: true, permissionStatus };
  }
  if (permissionStatus === 'restricted') {
    return { granted: false, permissionStatus };
  }
  // Electron reports both first use and an earlier rejection as `denied` on macOS.
  // Asking through desktopCapturer makes the request belong to the signed app.
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    return { granted: true, permissionStatus: 'granted' };
  } catch {
    return {
      granted: false,
      permissionStatus: getScreenRecordingAccessStatus(),
    };
  }
}

// --------------- State ---------------

let mainWindow = null;
let mainWindowInitialLoadReady = false;
let mainWindowRevealRequested = false;
let captureIngressSenderId = null;
let rendererLoadFailureDialogOpen = false;
let tray = null;
let trayContextMenu = null;
let clipboardMonitor = null;
let llmRequestInFlight = false;
let llmAbortController = null;
let llmRequestSettlement = null;
let providerConnectionInFlight = false;
let providerConnectionAbortController = null;
let providerConnectionTask = null;
let verificationRequestInFlight = false;
let verificationAbortController = null;
let verificationRequestSettlement = null;
let captureRequestInFlight = false;
let captureAbortController = null;
let captureRequestSettlement = null;
let currentWindowMode = 'capture';
let captureWindowBounds = null;
let backgroundTaskSequence = 0;
let activeBackgroundTask = null;
let backgroundTaskPresentation = { phase: 'idle', kind: 'analysis', outcome: null };
const backgroundTaskHandoffRegistry = createBackgroundTaskHandoffRegistry({
  onTimeout: ({ task }) => finishBackgroundTask(task, 'success'),
});
const pendingOcrReviewRegistry = createPendingOcrReviewRegistry();
let completionNotification = null;
let rendererQuitRiskKnown = false;
let rendererHasQuitRisk = true;
let rendererClipboardPendingStatus = { pending: false, count: 0 };
let pendingRendererRecoveryNotice = null;
let quitCleanupStarted = false;
let nativeResidueQuitDialogOpen = false;
let rendererRecoveryReloadTimer = null;
let rendererRecoveryReloadStarted = false;
let shortcutRegistrationStatus = createShortcutRegistrationStatus();
let persistentRuntimeActive = false;
let shortcutsRuntimeActivated = false;
let persistentRuntimeStatus = {
  trayAvailable: false,
  clipboardMonitoringDisabled: false,
  clipboardMonitoringDisablePersistFailed: false,
};
const verificationApprovalRegistry = createVerificationApprovalRegistry();
const clipboardResidueRegistry = createClipboardResidueRegistry();
const userDataResetRegistry = createUserDataResetRegistry();
const quitRequestRegistry = createQuitRequestRegistry();
const settingsRequestRegistry = createSettingsRequestRegistry();
const captureIngressRegistry = createCaptureIngressRegistry();
const pendingTermImports = new Map();
const termImportGenerationBySender = new Map();
const PROVIDER_CONNECTION_SETTING_KEYS = new Set([
  'activeBackend',
  'activeModel',
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'ollamaBaseUrl',
  'customEndpointUrl',
  'customEndpointApiKey',
]);
const LLM_PROCESSING_SETTING_KEYS = new Set([
  ...PROVIDER_CONNECTION_SETTING_KEYS,
  'customPrompt',
  'languageHint',
  'verificationPolicy',
]);
const uiFixtureRuntime = uiFixtureMode.enabled
  ? uiFixtureMain.createUiFixtureRuntime({
    DEFAULTS,
    app,
    applicationMenuHasUnsafeDeveloperActions,
    globalShortcut,
    ipcMain,
    uiFixtureMode,
    uiFixtureCheckMode,
    getApplicationQuitMenuState: () => {
      const quitItem = Menu.getApplicationMenu()?.getMenuItemById('app-quit');
      return Object.freeze({
        exists: Boolean(quitItem),
        accelerator: quitItem?.accelerator || '',
        handlerAttached: typeof quitItem?.click === 'function',
      });
    },
    getApplicationSettingsMenuState: () => {
      const settingsItem = Menu.getApplicationMenu()?.getMenuItemById('app-settings');
      return Object.freeze({
        exists: Boolean(settingsItem),
        id: settingsItem?.id || '',
        label: settingsItem?.label || '',
        accelerator: settingsItem?.accelerator || '',
        handlerAttached: typeof settingsItem?.click === 'function',
      });
    },
    hasPendingApplicationSettingsRequest: () => Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && !mainWindow.webContents.isDestroyed()
      && settingsRequestRegistry.getPending(mainWindow.webContents.id)
    ),
    triggerApplicationSettingsMenu: () => {
      const settingsItem = Menu.getApplicationMenu()?.getMenuItemById('app-settings');
      if (!settingsItem || typeof settingsItem.click !== 'function') return false;
      settingsItem.click(settingsItem, mainWindow, { triggeredByAccelerator: false });
      return true;
    },
    getMainWindow: () => mainWindow,
    getTray: () => tray,
  })
  : null;

function publishShortcutRegistrationStatus(status, { broadcast = true } = {}) {
  shortcutRegistrationStatus = status;
  if (
    broadcast
    && mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
    && !mainWindow.webContents.isLoadingMainFrame()
  ) {
    mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_STATUS_CHANGED, status);
  }
  return status;
}

function registerConfiguredShortcuts(settings, { broadcast = true } = {}) {
  return publishShortcutRegistrationStatus(registerShortcuts(dispatchCaptureIngress, settings), { broadcast });
}

function clearCompletedTaskPresentation() {
  if (backgroundTaskPresentation.phase !== 'completed') return;
  backgroundTaskPresentation = { phase: 'idle', kind: 'analysis', outcome: null };
  if (completionNotification) {
    completionNotification.close();
    completionNotification = null;
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!uiFixtureMode.enabled && !mainWindowInitialLoadReady) {
    mainWindowRevealRequested = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  clearCompletedTaskPresentation();
  mainWindow.show();
  mainWindow.focus();
  refreshTrayPresentation();
}

function deliverCaptureIngress(senderId, event) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || mainWindow.webContents.isCrashed()
    || mainWindow.webContents.id !== senderId
    || mainWindow.webContents.isLoadingMainFrame()
  ) return false;
  try {
    mainWindow.webContents.send(event.channel, event.payload);
    return true;
  } catch {
    return false;
  }
}

function dispatchCaptureIngress(event) {
  if (app.isQuitting) return false;
  const explicitShortcut = event?.payload?.source === 'shortcut';
  if (explicitShortcut && (!mainWindow || mainWindow.isDestroyed())) {
    createMainWindow(getStartupSettings());
  }
  if (explicitShortcut) showMainWindow();

  const senderId = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.id
    : captureIngressSenderId;
  if (!Number.isSafeInteger(senderId)) return false;
  return captureIngressRegistry.dispatch(senderId, event, deliverCaptureIngress);
}

function hideMainWindowForUser() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  refreshTrayPresentation();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) hideMainWindowForUser();
  else showMainWindow();
}

function sendPendingSettingsRequest(senderId) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || mainWindow.webContents.isCrashed()
    || mainWindow.webContents.id !== senderId
    || mainWindow.webContents.isLoadingMainFrame()
  ) return false;
  const request = settingsRequestRegistry.getPending(senderId);
  if (!request) return false;
  mainWindow.webContents.send(IPC_CHANNELS.APP_SETTINGS_REQUESTED, request);
  uiFixtureRuntime?.recordCommandCommaSafeSettingsLifecycle?.({ requestSentCount: 1 });
  return true;
}

function requestAppSettings(_menuItem, _browserWindow, event) {
  uiFixtureRuntime?.recordCommandCommaSafeSettingsLifecycle?.({
    menuInvocationCount: 1,
    acceleratorActivationCount: event?.triggeredByAccelerator === true ? 1 : 0,
  });
  if (app.isQuitting || rendererLoadFailureDialogOpen) return;
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(getStartupSettings());
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const senderId = mainWindow.webContents.id;
  settingsRequestRegistry.request(senderId);
  uiFixtureRuntime?.recordCommandCommaSafeSettingsLifecycle?.({ requestCount: 1 });
  showMainWindow();
  sendPendingSettingsRequest(senderId);
}

function performConfirmedQuit({ defer = false } = {}) {
  if (app.isQuitting) return;
  // Enter the committed-quit state before yielding so no later clipboard
  // write can create an unconfirmed consequence between decision and quit.
  app.isQuitting = true;
  clearPendingRendererRecoveryReload();
  rendererRecoveryReloadStarted = false;
  userDataResetRegistry.clearAll();
  pendingOcrReviewRegistry.clear();
  clipboardResidueRegistry.clearAll();
  uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ confirmedQuitCount: 1 });
  if (defer) setImmediate(() => app.quit());
  else app.quit();
}

function clearPendingRendererRecoveryReload() {
  if (rendererRecoveryReloadTimer !== null) clearTimeout(rendererRecoveryReloadTimer);
  rendererRecoveryReloadTimer = null;
}

function reloadAfterNativeResidueQuitCancel(targetWindow) {
  clearPendingRendererRecoveryReload();
  if (
    !targetWindow
    || targetWindow.isDestroyed()
    || targetWindow.webContents.isDestroyed()
  ) return;
  showMainWindow();
  if (rendererRecoveryReloadStarted) return;
  if (targetWindow.webContents.isLoadingMainFrame()) {
    rendererRecoveryReloadStarted = true;
    return;
  }
  rendererRecoveryReloadStarted = true;
  targetWindow.webContents.reload();
}

function requestNativeResidueAwareQuit(targetWindow, consequenceSnapshot) {
  if (nativeResidueQuitDialogOpen) return;
  if (!consequenceSnapshot?.id) return;
  nativeResidueQuitDialogOpen = true;
  const options = {
    type: 'warning',
    title: '系统剪贴板仍可能保留内容',
    message: 'Slipstream 当前无法确认上次复制的内容是否仍在系统剪贴板。',
    detail: '界面中断期间不会读取或自动清除剪贴板。可以返回并重新载入界面，或明确保留剪贴板内容并退出。',
    buttons: ['返回并重新载入界面', '保留剪贴板并退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const dialogPromise = targetWindow && !targetWindow.isDestroyed()
    ? dialog.showMessageBox(targetWindow, options)
    : dialog.showMessageBox(options);
  dialogPromise.then(({ response }) => {
    nativeResidueQuitDialogOpen = false;
    const currentConsequence = clipboardResidueRegistry.getCurrent();
    if (response === 1 && currentConsequence?.id === consequenceSnapshot.id) {
      performConfirmedQuit();
      return;
    }
    reloadAfterNativeResidueQuitCancel(targetWindow);
  }).catch(() => {
    nativeResidueQuitDialogOpen = false;
    // A dialog failure is not consent to leave clipboard contents behind.
    reloadAfterNativeResidueQuitCancel(targetWindow);
  });
}

function requestAppQuit() {
  if (app.isQuitting) return;
  const menuTriggerEvent = arguments.length >= 3 ? arguments[2] : null;
  if (uiFixtureRuntime?.isCommandQSafeExitFixture?.() && menuTriggerEvent) {
    uiFixtureRuntime.recordCommandQSafeExitLifecycle({
      menuInvocationCount: 1,
      acceleratorActivationCount: menuTriggerEvent.triggeredByAccelerator === true ? 1 : 0,
    });
  }
  if (
    !mainWindow
    || mainWindow.isDestroyed()
  ) {
    const activeConsequence = clipboardResidueRegistry.getCurrent();
    if (activeConsequence) {
      requestNativeResidueAwareQuit(null, activeConsequence);
      return;
    }
    performConfirmedQuit();
    return;
  }

  const senderId = mainWindow.webContents.id;
  if (
    mainWindow.webContents.isDestroyed()
    || mainWindow.webContents.isCrashed()
    || mainWindow.webContents.isLoadingMainFrame()
  ) {
    const activeConsequence = clipboardResidueRegistry.get(senderId);
    if (activeConsequence) {
      requestNativeResidueAwareQuit(mainWindow, activeConsequence);
      return;
    }
    performConfirmedQuit();
    return;
  }

  const request = quitRequestRegistry.request(senderId);
  const activeClipboardConsequence = clipboardResidueRegistry.get(senderId);
  if (!rendererQuitRiskKnown || rendererHasQuitRisk || activeClipboardConsequence) showMainWindow();
  // Re-send the same opaque request while it remains pending. The renderer
  // deduplicates by requestId, and a repeated native quit gesture can recover
  // even if the first event landed before its listener was installed.
  mainWindow.webContents.send(IPC_CHANNELS.APP_QUIT_REQUESTED, request);
  uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({
    requestCount: 1,
    requestSentCount: 1,
  });
}

function resetRendererOwnedWorkAfterCrash(senderId) {
  llmAbortController?.abort();
  providerConnectionAbortController?.abort();
  verificationAbortController?.abort();
  captureAbortController?.abort();
  backgroundTaskHandoffRegistry.clear();
  pendingOcrReviewRegistry.clearSender(senderId);
  activeBackgroundTask = null;
  backgroundTaskPresentation = { phase: 'idle', kind: 'analysis', outcome: null };
  completionNotification?.close();
  completionNotification = null;
  verificationApprovalRegistry.revokeSender(senderId);
  userDataResetRegistry.clearSender(senderId);
  // A renderer interruption promotes the metadata-only consequence so the
  // recovered UI cannot imply that the system clipboard is safe.
  clipboardResidueRegistry.markInterrupted(senderId);
  quitRequestRegistry.clearSender(senderId);
  termImportGenerationBySender.set(
    senderId,
    (termImportGenerationBySender.get(senderId) || 0) + 1,
  );
  pendingTermImports.clear();
  rendererQuitRiskKnown = false;
  rendererHasQuitRisk = true;
  rendererClipboardPendingStatus = { pending: false, count: 0 };
  refreshTrayPresentation();
}

function sendSafeSettingsToRenderer() {
  if (
    !store.isStoreReady()
    || !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || mainWindow.webContents.isLoadingMainFrame()
  ) return;
  mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_LOADED, getSafeSettings());
}

function disableClipboardMonitoringFromTray() {
  if (store.getSettings('clipboardMonitoring') !== true) return;
  store.setSetting('clipboardMonitoring', false);
  rendererClipboardPendingStatus = { pending: false, count: 0 };
  stopClipboardMonitoring();
  sendSafeSettingsToRenderer();
}

function createTrayMenuTemplate(presentation) {
  const monitoring = createClipboardMonitoringTrayPresentation(store.getAllSettings());
  const pending = createClipboardPendingTrayPresentation(rendererClipboardPendingStatus);
  const template = [
    { label: presentation.statusLabel, enabled: false },
  ];
  if (pending.enabled) {
    template.push(
      { label: pending.statusLabel, enabled: false },
      { label: pending.actionLabel, click: showMainWindow },
    );
  }
  template.push(
    { type: 'separator' },
    { label: monitoring.statusLabel, enabled: false },
  );
  if (monitoring.enabled) {
    template.push({
      label: backgroundTaskPresentation.phase === 'processing'
        ? '关闭自动检测（当前任务继续）'
        : monitoring.actionLabel,
      click: disableClipboardMonitoringFromTray,
    });
  }
  template.push(
    { type: 'separator' },
    {
      label: mainWindow?.isVisible() ? '隐藏窗口' : '显示 Slipstream',
      click: toggleMainWindow,
    },
    { type: 'separator' },
    {
      label: '退出 Slipstream',
      click: requestAppQuit,
    },
  );
  return template;
}

function createApplicationMenuTemplate() {
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          id: 'app-settings',
          label: '设置…',
          accelerator: 'Command+,',
          click: requestAppSettings,
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          id: 'app-quit',
          label: '退出 Slipstream',
          accelerator: 'Command+Q',
          click: requestAppQuit,
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
}

function applicationMenuHasUnsafeDeveloperActions(menu = Menu.getApplicationMenu()) {
  const unsafeRoles = new Set(['reload', 'forcereload', 'toggledevtools']);
  const visit = (items) => (Array.isArray(items) ? items : []).some((item) => (
    unsafeRoles.has(String(item?.role || '').toLowerCase())
    || visit(item?.submenu?.items)
  ));
  return visit(menu?.items);
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate()));
}

function installAboutPanel() {
  if (process.platform !== 'darwin' || typeof app.setAboutPanelOptions !== 'function') return;
  app.setAboutPanelOptions(createAboutPanelOptions({
    applicationName: app.name,
    appVersion: app.getVersion(),
    arch: process.arch,
    buildIdentity: runtimeBuildIdentity,
  }));
}

function refreshTrayPresentation() {
  if (!tray) return;
  const presentation = createBackgroundTaskPresentation(backgroundTaskPresentation);
  const monitoring = createClipboardMonitoringTrayPresentation(store.getAllSettings());
  const pending = createClipboardPendingTrayPresentation(rendererClipboardPendingStatus);
  const tooltipParts = [presentation.tooltip];
  if (pending.enabled) tooltipParts.push(pending.tooltip);
  if (monitoring.enabled) tooltipParts.push(monitoring.statusLabel);
  tray.setToolTip(tooltipParts.join('；'));
  if (process.platform === 'darwin') {
    tray.setTitle(backgroundTaskPresentation.phase === 'processing'
      ? presentation.trayTitle
      : pending.trayTitle || presentation.trayTitle);
  }
  trayContextMenu = Menu.buildFromTemplate(createTrayMenuTemplate(presentation));
}

function beginBackgroundTask(kind) {
  const task = { id: backgroundTaskSequence + 1, kind };
  backgroundTaskSequence = task.id;
  activeBackgroundTask = task;
  backgroundTaskPresentation = { phase: 'processing', kind, outcome: null };
  refreshTrayPresentation();
  return task;
}

function handoffBackgroundTask(task, kind) {
  if (
    !task
    || activeBackgroundTask?.id !== task.id
    || activeBackgroundTask.kind !== task.kind
  ) return null;
  const nextTask = { id: task.id, kind };
  activeBackgroundTask = nextTask;
  backgroundTaskPresentation = { phase: 'processing', kind, outcome: null };
  refreshTrayPresentation();
  return nextTask;
}

function showBackgroundCompletionNotification(presentation) {
  if (!presentation.notification || app.isQuitting) return;
  try {
    if (!Notification.isSupported()) return;
    completionNotification?.close();
    const notification = new Notification({
      title: presentation.notification.title,
      body: presentation.notification.body,
      silent: true,
    });
    completionNotification = notification;
    notification.on('click', showMainWindow);
    notification.on('close', () => {
      if (completionNotification === notification) completionNotification = null;
    });
    notification.show();
  } catch {
    completionNotification = null;
  }
}

function finishBackgroundTask(task, outcome) {
  if (
    !task
    || activeBackgroundTask?.id !== task.id
    || activeBackgroundTask.kind !== task.kind
  ) return;
  activeBackgroundTask = null;
  const windowHidden = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible();
  backgroundTaskPresentation = createCompletedTaskState({
    kind: task.kind,
    outcome,
    windowHidden,
    appQuitting: app.isQuitting,
  });
  refreshTrayPresentation();
  if (backgroundTaskPresentation.phase === 'completed') {
    showBackgroundCompletionNotification(createBackgroundTaskPresentation(backgroundTaskPresentation));
  }
}

function getSafeSettings() {
  return {
    ...redactSettingsForRenderer(store.getAllSettings()),
    runtimeStatus: { ...persistentRuntimeStatus },
  };
}

function createBlockedStartupSettings() {
  return {
    setupMode: 'unconfigured',
    windowWidth: DEFAULTS.WINDOW_WIDTH,
    windowHeight: DEFAULTS.WINDOW_HEIGHT,
    windowX: null,
    windowY: null,
    startMinimized: false,
    clipboardMonitoring: false,
    clipboardShortcut: DEFAULTS.CLIPBOARD_SHORTCUT,
    screenshotShortcut: DEFAULTS.SCREENSHOT_SHORTCUT,
  };
}

function getStartupSettings() {
  return store.isStoreReady() ? store.getAllSettings() : createBlockedStartupSettings();
}

function assertTrustedIpc(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isTrustedRendererUrl(url, isDev)) throw new Error('拒绝了不受信任的应用请求');
}

function assertTrustedCaptureIngressIpc(event) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('拒绝了不受信任的捕获监听请求');
  }
  assertTrustedIpc(event);
}

function assertTrustedQuitIpc(event) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('拒绝了不受信任的退出请求');
  }
  if (!uiFixtureMode.enabled) {
    assertTrustedIpc(event);
    return;
  }
  if (!uiFixtureRuntime?.isCommandQSafeExitFixture?.()) {
    throw new Error('原生 UI 样例未授权退出通道');
  }
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (
    senderUrl !== uiFixtureMode.rendererUrl
  ) {
    throw new Error('拒绝了不受信任的退出样例请求');
  }
}

function assertTrustedSettingsIpc(event) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('拒绝了不受信任的设置请求');
  }
  if (uiFixtureMode.enabled) {
    if (!uiFixtureRuntime?.isCommandCommaSafeSettingsFixture?.()) {
      throw new Error('原生 UI 样例未授权设置通道');
    }
    const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
    if (senderUrl !== uiFixtureMode.rendererUrl) {
      throw new Error('拒绝了不受信任的设置样例请求');
    }
    return;
  }
  assertTrustedIpc(event);
}

function removePendingTermImportsForSender(senderId) {
  for (const [previewId, pending] of pendingTermImports) {
    if (pending.senderId === senderId) pendingTermImports.delete(previewId);
  }
}

function getTermImportGeneration(senderId) {
  return termImportGenerationBySender.get(senderId) || 0;
}

function advanceTermImportGeneration(senderId) {
  const generation = getTermImportGeneration(senderId) + 1;
  termImportGenerationBySender.set(senderId, generation);
  return generation;
}

function prunePendingTermImports() {
  const now = Date.now();
  for (const [previewId, pending] of pendingTermImports) {
    if (pending.expiresAt <= now || pending.sender?.isDestroyed?.()) {
      pendingTermImports.delete(previewId);
    }
  }
}

function termImportFailure(code) {
  return { status: 'failed', code };
}

function createSavedTermsImportBaseline(terms) {
  return JSON.stringify((Array.isArray(terms) ? terms : []).map((term) => ({
    id: term?.id,
    createdAt: term?.createdAt,
    term: term?.term,
    explanation: term?.explanation,
    evidence: term?.evidence,
    termKind: term?.termKind,
    provenanceKind: term?.provenanceKind,
  })));
}

function registerVerificationApproval(event, brief, verificationSummary, authorityEpoch) {
  return verificationApprovalRegistry.register({
    senderId: event.sender.id,
    sourceSha256: brief?.source?.sha256,
    approvalId: verificationSummary?.approvalId,
    authorityEpoch,
  });
}

function consumeVerificationApproval(event, approvalId, sourceSha256, authorityEpoch) {
  return verificationApprovalRegistry.consume({
    senderId: event.sender.id,
    sourceSha256,
    approvalId,
    authorityEpoch,
  });
}

function createRetryVerificationSummary(brief, summary) {
  const eligible = (brief?.verifications || [])
    .filter((item) => ['pending', 'retrieved', 'failed'].includes(item?.status) && item?.lookup)
    .slice(0, MAX_VERIFICATIONS_PER_RUN);
  const baseSummary = { ...(summary || {}) };
  delete baseSummary.approvalId;
  return {
    ...baseSummary,
    ...(eligible.length ? { approvalId: createVerificationApprovalId(eligible) } : {}),
  };
}

// --------------- Window ---------------

function createMainWindow(settings = getStartupSettings()) {
  const storageReady = store.isStoreReady();
  const primaryWorkArea = screen.getPrimaryDisplay().workAreaSize;
  const fixtureUrl = uiFixtureMode.enabled ? new URL(uiFixtureMode.rendererUrl) : null;
  const fixtureRendererMode = fixtureUrl?.searchParams.get('demo') || null;
  const fixtureRun = fixtureUrl?.searchParams.get('run') || null;
  const isSettingsTextScaleFixture = fixtureRun === 'settings-transition-text-scale-native';
  const isFirstUseCaptureTextScaleFixture = fixtureRun
    === 'first-use-capture-text-scale-native';
  const isCompletedResultTextScaleFixture = fixtureRun
    === 'completed-result-text-scale-native';
  const isGuidedReplyTextScaleFixture = fixtureRun
    === 'guided-reply-text-scale-native';
  const isStackedStatusTextScaleFixture = fixtureRun
    === 'stacked-status-text-scale-native';
  const isResultStylesheetRecoveryTextScaleFixture = fixtureRun
    === 'result-stylesheet-recovery-native';
  const isSettingsStylesheetCollisionTextScaleFixture = fixtureRun
    === 'settings-stylesheet-collision-native';
  const isTextScaleNativeFixture = isSettingsTextScaleFixture
    || isFirstUseCaptureTextScaleFixture
    || isCompletedResultTextScaleFixture
    || isGuidedReplyTextScaleFixture
    || isStackedStatusTextScaleFixture
    || isResultStylesheetRecoveryTextScaleFixture
    || isSettingsStylesheetCollisionTextScaleFixture;
  const needsSetup = uiFixtureMode.enabled
    ? fixtureRendererMode === 'setup'
    : settings.setupMode === 'unconfigured';
  currentWindowMode = fixtureRendererMode === 'result'
    ? 'result'
    : needsSetup ? 'setup' : 'capture';
  const fixtureWidth = isTextScaleNativeFixture
    ? 400
    : currentWindowMode === 'result'
      ? DEFAULTS.RESULT_WINDOW_WIDTH
      : currentWindowMode === 'setup' ? DEFAULTS.SETUP_WINDOW_WIDTH : DEFAULTS.WINDOW_WIDTH;
  const fixtureHeight = isTextScaleNativeFixture
    ? 400
    : currentWindowMode === 'result'
      ? DEFAULTS.RESULT_WINDOW_HEIGHT
      : currentWindowMode === 'setup' ? DEFAULTS.SETUP_WINDOW_HEIGHT : DEFAULTS.WINDOW_HEIGHT;

  const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
  webPreferences.preload = uiFixtureMode.enabled
    ? path.join(__dirname, '..', '..', 'scripts', 'ui-fixture-preload.js')
    : path.join(__dirname, '..', '..', 'preload.js');

  const windowOptions = {
    width: Math.min(
      uiFixtureMode.enabled
        ? fixtureWidth
        : needsSetup ? DEFAULTS.SETUP_WINDOW_WIDTH : Math.max(settings.windowWidth || DEFAULTS.WINDOW_WIDTH, 400),
      primaryWorkArea.width,
    ),
    height: Math.min(
      uiFixtureMode.enabled
        ? fixtureHeight
        : needsSetup ? DEFAULTS.SETUP_WINDOW_HEIGHT : Math.max(settings.windowHeight || DEFAULTS.WINDOW_HEIGHT, 400),
      primaryWorkArea.height,
    ),
    frame: false,
    // The compact capture surface may float above the current app, but the
    // wide result and setup surfaces must let users switch to the source app
    // or an official page without Slipstream covering it.
    alwaysOnTop: uiFixtureMode.enabled || !storageReady ? false : !needsSetup,
    transparent: true,
    resizable: true,
    useContentSize: isTextScaleNativeFixture,
    minWidth: 400,
    minHeight: 400,
    skipTaskbar: !uiFixtureMode.enabled && storageReady,
    // Formal windows stay hidden until their renderer has completed its first
    // load. This prevents a transparent/blank shell from appearing during a
    // cold start; fixtures retain their explicit visibility contract.
    show: uiFixtureMode.enabled ? !uiFixtureCheckMode : false,
    webPreferences,
  };

  // Apply vibrancy on macOS
  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'hudWindow';
  }

  mainWindow = new BrowserWindow(windowOptions);
  mainWindowInitialLoadReady = uiFixtureMode.enabled;
  mainWindowRevealRequested = false;
  if (!uiFixtureMode.enabled) {
    const startupWindow = mainWindow;
    startupWindow.webContents.once('did-finish-load', () => {
      if (
        app.isQuitting
        || startupWindow.isDestroyed()
        || mainWindow !== startupWindow
      ) return;
      mainWindowInitialLoadReady = true;
      const revealWasRequested = mainWindowRevealRequested;
      mainWindowRevealRequested = false;
      const shouldStartVisible = !store.isStoreReady()
        || store.getSettings('startMinimized') !== true || !tray;
      if (revealWasRequested || shouldStartVisible) showMainWindow();
    });
  }
  const rendererSenderId = mainWindow.webContents.id;
  captureIngressSenderId = rendererSenderId;
  captureIngressRegistry.begin(rendererSenderId);
  clipboardResidueRegistry.adoptSender(rendererSenderId);
  captureWindowBounds = currentWindowMode === 'capture' ? mainWindow.getBounds() : null;

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (uiFixtureMode.enabled) {
    uiFixtureRuntime.attachToWindow(mainWindow, { isTextScaleNativeFixture });
  }
  let rendererCrashCount = 0;
  let rendererStabilityTimer = null;
  let rendererCrashDialogOpen = false;
  let rendererMainFrameReady = false;

  mainWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (
        app.isQuitting
        || isInPlace
        || !isMainFrame
      ) return;
      captureIngressRegistry.markNotReady(rendererSenderId);
      if (!rendererMainFrameReady) return;
      // A full main-frame navigation replaces renderer memory even when the
      // Electron process itself stays alive. Promote the consequence before
      // the old renderer disappears so the next renderer must recover it.
      rendererMainFrameReady = false;
      clearPendingRendererRecoveryReload();
      rendererRecoveryReloadStarted = true;
      resetRendererOwnedWorkAfterCrash(rendererSenderId);
      pendingRendererRecoveryNotice = { recovered: true };
    },
  );

  mainWindow.webContents.on('did-finish-load', () => {
    rendererMainFrameReady = true;
    clearTimeout(rendererStabilityTimer);
    rendererStabilityTimer = setTimeout(() => {
      rendererCrashCount = 0;
    }, 10000);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (app.isQuitting) return;
    captureIngressRegistry.markNotReady(rendererSenderId);
    const recoveryWindow = mainWindow;
    if (!recoveryWindow || recoveryWindow.isDestroyed()) return;
    const replacementNavigationInProgress = !rendererMainFrameReady
      && recoveryWindow.webContents.isLoadingMainFrame();
    resetRendererOwnedWorkAfterCrash(rendererSenderId);
    pendingRendererRecoveryNotice = { recovered: true };
    // A clean exit can be the old renderer completing an already-started
    // reload. The navigation hook above has promoted the consequence, and the
    // in-flight replacement must not be followed by a second reload.
    if (details?.reason === 'clean-exit' && replacementNavigationInProgress) return;
    clearPendingRendererRecoveryReload();
    rendererRecoveryReloadStarted = false;
    rendererCrashCount += 1;

    const reloadRenderer = () => {
      rendererRecoveryReloadTimer = null;
      if (
        app.isQuitting
        || nativeResidueQuitDialogOpen
        || recoveryWindow.isDestroyed()
        || recoveryWindow.webContents.isDestroyed()
      ) return;
      if (rendererRecoveryReloadStarted) return;
      if (recoveryWindow.webContents.isLoadingMainFrame()) {
        rendererRecoveryReloadStarted = true;
        return;
      }
      rendererRecoveryReloadStarted = true;
      showMainWindow();
      recoveryWindow.webContents.reload();
    };

    if (rendererCrashCount <= 2) {
      rendererRecoveryReloadTimer = setTimeout(reloadRenderer, 250);
      return;
    }
    if (rendererCrashDialogOpen) return;
    rendererCrashDialogOpen = true;
    const crashDialogConsequence = clipboardResidueRegistry.get(rendererSenderId);
    const hasClipboardResidueRisk = Boolean(crashDialogConsequence);
    dialog.showMessageBox(recoveryWindow, {
      type: 'error',
      title: 'Slipstream 界面连续中断',
      message: '暂时无法稳定恢复应用界面。',
      detail: hasClipboardResidueRisk
        ? '系统剪贴板可能仍保留 Slipstream 上次复制的内容。Slipstream 不会读取、清除或覆盖系统剪贴板；如内容敏感，请先在其他位置复制一段不敏感文字手动覆盖，再重新载入界面或明确保留剪贴板并退出。临时会话不会写入历史。'
        : '可以再尝试重新载入一次；如果仍然失败，请退出后重新打开应用。临时会话不会写入历史。',
      buttons: [
        '重新载入界面',
        hasClipboardResidueRisk ? '保留剪贴板并退出' : '退出 Slipstream',
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      rendererCrashDialogOpen = false;
      if (response === 1) {
        const currentConsequence = clipboardResidueRegistry.get(rendererSenderId);
        if (
          (!crashDialogConsequence && !currentConsequence)
          || currentConsequence?.id === crashDialogConsequence?.id
        ) {
          performConfirmedQuit();
          return;
        }
        rendererCrashCount = 0;
        reloadRenderer();
        return;
      }
      rendererCrashCount = 0;
      reloadRenderer();
    }).catch(() => {
      rendererCrashDialogOpen = false;
      if (clipboardResidueRegistry.get(rendererSenderId)) {
        reloadRenderer();
        return;
      }
      performConfirmedQuit();
    });
  });

  // Restore saved position; place at bottom-right of primary display by default
  if (storageReady && settings.windowX !== null && settings.windowY !== null) {
    const display = screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY });
    const workArea = display.workArea;
    const winBounds = mainWindow.getBounds();
    const x = Math.min(Math.max(settings.windowX, workArea.x), workArea.x + workArea.width - winBounds.width);
    const y = Math.min(Math.max(settings.windowY, workArea.y), workArea.y + workArea.height - winBounds.height);
    mainWindow.setPosition(x, y);
  } else {
    const displays = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = displays.workAreaSize;
    const winBounds = mainWindow.getBounds();
    mainWindow.setPosition(
      screenWidth - winBounds.width - 20,
      screenHeight - winBounds.height - 60,
    );
  }

  // Load the renderer
  if (uiFixtureMode.enabled) {
    const loadFixtureRenderer = (attempt = 0) => {
      mainWindow.loadURL(uiFixtureMode.rendererUrl).catch(() => {
        if (attempt < 20 && mainWindow && !mainWindow.isDestroyed()) {
          setTimeout(() => loadFixtureRenderer(attempt + 1), 250);
        }
      });
    };
    loadFixtureRenderer();
  } else if (isDev) {
    const devRendererUrl = 'http://localhost:5173';
    const loadDevRenderer = (attempt = 0) => {
      mainWindow.loadURL(devRendererUrl).catch(() => {
        if (attempt < 20 && mainWindow && !mainWindow.isDestroyed()) {
          setTimeout(() => loadDevRenderer(attempt + 1), 250);
        }
      });
    };
    loadDevRenderer();
  } else {
    const indexPath = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
    const startupWindow = mainWindow;
    const loadProductionRenderer = () => {
      if (
        app.isQuitting
        || startupWindow.isDestroyed()
        || startupWindow.webContents.isDestroyed()
      ) return;
      startupWindow.loadFile(indexPath).catch(() => {
        if (
          app.isQuitting
          || startupWindow.isDestroyed()
          || rendererLoadFailureDialogOpen
        ) return;
        // The native startup-failure dialog becomes the sole owner. A Settings
        // request from the failed listener gap must not replay after Retry and
        // surprise the user with navigation they did not make in the new UI.
        settingsRequestRegistry.clearSender(rendererSenderId);
        rendererLoadFailureDialogOpen = true;
        dialog.showMessageBox({
          type: 'error',
          title: 'Slipstream 无法启动',
          message: '无法打开 Slipstream 界面。',
          detail: '应用界面文件可能不完整或已损坏。为保护隐私，此处不会显示文件位置、设置内容或 API Key。你可以重新尝试；如果仍然失败，请退出后重新安装应用。',
          buttons: ['重新尝试', '退出 Slipstream'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }).then(({ response }) => {
          if (response === 0) {
            // A menu action received while the native failure owner was
            // visible is a strict no-op and cannot survive into Retry.
            settingsRequestRegistry.clearSender(rendererSenderId);
            rendererLoadFailureDialogOpen = false;
            loadProductionRenderer();
            return;
          }
          rendererLoadFailureDialogOpen = false;
          performConfirmedQuit();
        }).catch(() => {
          rendererLoadFailureDialogOpen = false;
          performConfirmedQuit();
        });
      });
    };
    loadProductionRenderer();
  }

  // On macOS, hide instead of quit on close. Other platforms keep the
  // renderer alive long enough to confirm session loss before quitting.
  mainWindow.on('close', (event) => {
    if (uiFixtureMode.enabled) {
      app.isQuitting = true;
      return;
    }
    if (app.isQuitting) return;
    event.preventDefault();
    if (process.platform === 'darwin' && store.isStoreReady() && tray) hideMainWindowForUser();
    else requestAppQuit();
  });

  mainWindow.on('show', refreshTrayPresentation);
  mainWindow.on('hide', refreshTrayPresentation);

  mainWindow.on('closed', () => {
    clearTimeout(rendererStabilityTimer);
    clearPendingRendererRecoveryReload();
    rendererRecoveryReloadStarted = false;
    verificationApprovalRegistry.revokeSender(rendererSenderId);
    pendingOcrReviewRegistry.clearSender(rendererSenderId);
    userDataResetRegistry.clearSender(rendererSenderId);
    if (!app.isQuitting && clipboardResidueRegistry.markInterrupted(rendererSenderId)) {
      pendingRendererRecoveryNotice = { recovered: true };
    }
    verificationAbortController?.abort();
    quitRequestRegistry.clearSender(rendererSenderId);
    settingsRequestRegistry.clearSender(rendererSenderId);
    rendererQuitRiskKnown = false;
    rendererHasQuitRisk = true;
    rendererClipboardPendingStatus = { pending: false, count: 0 };
    captureIngressRegistry.clear(rendererSenderId);
    if (captureIngressSenderId === rendererSenderId) captureIngressSenderId = null;
    mainWindowInitialLoadReady = false;
    mainWindowRevealRequested = false;
    mainWindow = null;
  });

  let boundsSaveTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!store.isStoreReady()) return;
      if (currentWindowMode !== 'capture') return;
      const bounds = mainWindow.getBounds();
      store.setSetting('windowX', bounds.x);
      store.setSetting('windowY', bounds.y);
      captureWindowBounds = bounds;
      store.setSetting('windowWidth', bounds.width);
      store.setSetting('windowHeight', bounds.height);
    }, 250);
  };

  mainWindow.on('moved', () => {
    saveBounds();
  });

  // Save window size on resize
  mainWindow.on('resized', () => {
    saveBounds();
  });

  // Open DevTools in dev mode
  if (isDev && !uiFixtureMode.enabled) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
  };
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!['capture', 'setup', 'result'].includes(mode)) throw new Error('窗口模式无效');
  if (mode === currentWindowMode) return true;

  const previous = mainWindow.getBounds();
  if (currentWindowMode === 'capture') captureWindowBounds = previous;
  const display = screen.getDisplayMatching(previous);
  const workArea = display.workArea;
  let nextBounds;

  if (mode === 'result') {
    const width = Math.min(DEFAULTS.RESULT_WINDOW_WIDTH, workArea.width - 24);
    const height = Math.min(DEFAULTS.RESULT_WINDOW_HEIGHT, workArea.height - 24);
    const centerX = previous.x + previous.width / 2;
    const centerY = previous.y + previous.height / 2;
    nextBounds = clampBoundsToWorkArea({
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
    }, workArea);
  } else if (mode === 'setup') {
    const width = Math.min(DEFAULTS.SETUP_WINDOW_WIDTH, workArea.width - 24);
    const height = Math.min(DEFAULTS.SETUP_WINDOW_HEIGHT, workArea.height - 24);
    const centerX = previous.x + previous.width / 2;
    const centerY = previous.y + previous.height / 2;
    nextBounds = clampBoundsToWorkArea({
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
    }, workArea);
  } else {
    const fallback = {
      width: DEFAULTS.WINDOW_WIDTH,
      height: DEFAULTS.WINDOW_HEIGHT,
      x: previous.x + previous.width - DEFAULTS.WINDOW_WIDTH,
      y: previous.y,
    };
    nextBounds = clampBoundsToWorkArea(captureWindowBounds || fallback, workArea);
  }

  currentWindowMode = mode;
  mainWindow.setBounds(nextBounds, true);
  mainWindow.setAlwaysOnTop(mode === 'capture');
  return true;
}

async function hideWindowForCapture() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const windowState = {
    wasVisible: mainWindow.isVisible(),
    wasAlwaysOnTop: mainWindow.isAlwaysOnTop(),
  };
  if (windowState.wasAlwaysOnTop) mainWindow.setAlwaysOnTop(false);
  if (windowState.wasVisible) {
    mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return windowState;
}

function restoreWindowAfterCapture(windowState) {
  if (!windowState || !mainWindow || mainWindow.isDestroyed()) return;
  if (windowState.wasAlwaysOnTop) mainWindow.setAlwaysOnTop(true);
  if (windowState.wasVisible) {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function captureScreenshotTask(senderId) {
  if (captureRequestInFlight) return userError(USER_ERRORS.SCREENSHOT_BUSY);
  let imagePath = null;
  let windowState = null;
  let phase = 'selection';
  let backgroundTask = null;
  let taskOutcome = 'failure';
  let handoffArmed = false;
  const controller = new AbortController();
  const settlement = createTaskSettlement();
  captureRequestInFlight = true;
  captureAbortController = controller;
  captureRequestSettlement = settlement;
  try {
    backgroundTask = beginBackgroundTask('capture');
    const screenRecordingAccess = await requestScreenRecordingAccessForCapture();
    if (!screenRecordingAccess.granted) {
      return userError(USER_ERRORS.SCREENSHOT_PERMISSION_DENIED, {
        permissionStatus: screenRecordingAccess.permissionStatus,
      });
    }
    windowState = await hideWindowForCapture();
    imagePath = await ScreenshotService.captureSelectedRegion(undefined, { signal: controller.signal });
    restoreWindowAfterCapture(windowState);
    windowState = null;
    phase = 'ocr';
    backgroundTask = handoffBackgroundTask(backgroundTask, 'ocr') || backgroundTask;
    const ocrResult = await OCRService.performOCR(imagePath, { signal: controller.signal });
    if (!ocrResult.text || !ocrResult.text.trim()) {
      return userError(USER_ERRORS.SCREENSHOT_EMPTY);
    }
    const textPayload = createClipboardPayload(ocrResult.text);
    const ocrReview = assessOcrReview({
      source: 'ocr',
      text: textPayload.text,
      capture: {
        confidence: ocrResult.confidence,
        blocks: ocrResult.blocks,
      },
    });
    if (ocrReview.required) {
      pendingOcrReviewRegistry.record({ senderId, assessment: ocrReview });
    } else {
      pendingOcrReviewRegistry.clearSender(senderId);
    }
    if (!ocrReview.required) {
      const handoff = backgroundTaskHandoffRegistry.arm({
        senderId,
        sourceText: textPayload.text,
        task: backgroundTask,
      });
      if (handoff?.replaced?.task) finishBackgroundTask(handoff.replaced.task, 'cancelled');
      handoffArmed = true;
    }
    taskOutcome = 'success';
    return {
      success: true,
      ...textPayload,
      confidence: ocrResult.confidence,
      blocks: ocrResult.blocks,
      ocrReview,
    };
  } catch (error) {
    const permissionStatus = getScreenRecordingAccessStatus();
    if (isScreenRecordingAccessDenied(permissionStatus)) {
      return userError(USER_ERRORS.SCREENSHOT_PERMISSION_DENIED, { permissionStatus });
    }
    if (error?.isCancellation || controller.signal.aborted) {
      taskOutcome = 'cancelled';
      return { success: false, cancelled: true };
    }
    console.error('[ScreenshotCapture] Error:', error);
    return userError(classifyScreenshotError(error, phase));
  } finally {
    if (typeof imagePath === 'string') {
      try { fs.unlinkSync(imagePath); } catch (_) { /* cleanup failure is non-fatal */ }
    }
    restoreWindowAfterCapture(windowState);
    if (backgroundTask && !handoffArmed) finishBackgroundTask(backgroundTask, taskOutcome);
    if (captureAbortController === controller) captureAbortController = null;
    captureRequestInFlight = false;
    settlement.resolve();
    if (captureRequestSettlement === settlement) captureRequestSettlement = null;
  }
}

// --------------- Tray ---------------

function createTray() {
  const trayIconPath = path.join(__dirname, '..', '..', 'assets', 'menubar-template.png');
  let icon = nativeImage.createFromPath(trayIconPath);

  if (!icon || icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  const nextTray = new Tray(icon);
  tray = nextTray;
  try {
    refreshTrayPresentation();

    nextTray.on('click', toggleMainWindow);

    nextTray.on('right-click', () => {
      refreshTrayPresentation();
      nextTray.popUpContextMenu(trayContextMenu);
    });
  } catch (error) {
    try { nextTray.destroy(); } catch (_) { /* best-effort rollback */ }
    if (tray === nextTray) tray = null;
    trayContextMenu = null;
    throw error;
  }
}

// --------------- Clipboard Monitor ---------------

function startClipboardMonitoring() {
  const nextMonitor = new ClipboardMonitor();
  try {
    nextMonitor.startMonitoring((payload) => {
      if (!payload?.text) return;
      dispatchCaptureIngress({
        channel: IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
        payload: { ...payload, source: 'monitor' },
      });
    });
    clipboardMonitor = nextMonitor;
  } catch (error) {
    try { nextMonitor.stopMonitoring(); } catch (_) { /* best-effort rollback */ }
    throw error;
  }
  try {
    refreshTrayPresentation();
  } catch {
    console.error('[ClipboardMonitor] Tray status refresh failed.');
  }
}

function stopClipboardMonitoring() {
  if (clipboardMonitor) {
    const currentMonitor = clipboardMonitor;
    currentMonitor.stopMonitoring();
    if (clipboardMonitor === currentMonitor) clipboardMonitor = null;
  }
  try {
    refreshTrayPresentation();
  } catch {
    console.error('[ClipboardMonitor] Tray status refresh failed.');
  }
}

function activatePersistentRuntime(settings, { broadcast = false } = {}) {
  if (persistentRuntimeActive || uiFixtureMode.enabled || !store.isStoreReady()) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  let clipboardMonitoringRequired = settings.clipboardMonitoring === true;

  if (!tray) {
    try {
      createTray();
    } catch {
      console.error('[StartupRuntime] Tray initialization failed.');
    }
  }
  if (!shortcutsRuntimeActivated) {
    try {
      registerConfiguredShortcuts(settings, { broadcast });
      shortcutsRuntimeActivated = true;
    } catch {
      console.error('[StartupRuntime] Shortcut initialization failed.');
    }
  }
  if (clipboardMonitoringRequired && !clipboardMonitor) {
    try {
      startClipboardMonitoring();
    } catch {
      console.error('[StartupRuntime] Clipboard monitoring initialization failed.');
    }
  }

  if (clipboardMonitoringRequired && clipboardMonitor) {
    persistentRuntimeStatus.clipboardMonitoringDisablePersistFailed = false;
  }

  if (clipboardMonitoringRequired && !clipboardMonitor) {
    try {
      store.setSetting('clipboardMonitoring', false);
      clipboardMonitoringRequired = false;
      persistentRuntimeStatus.clipboardMonitoringDisabled = true;
      persistentRuntimeStatus.clipboardMonitoringDisablePersistFailed = false;
    } catch {
      persistentRuntimeStatus.clipboardMonitoringDisablePersistFailed = true;
      console.error('[StartupRuntime] Clipboard monitoring could not be disabled safely.');
    }
  }

  persistentRuntimeActive = Boolean(tray)
    && shortcutsRuntimeActivated
    && (!clipboardMonitoringRequired || Boolean(clipboardMonitor));
  persistentRuntimeStatus = {
    ...persistentRuntimeStatus,
    trayAvailable: Boolean(tray),
  };
  try {
    mainWindow.setSkipTaskbar(Boolean(tray));
  } catch {
    console.error('[StartupRuntime] Window taskbar state could not be updated.');
  }
  return persistentRuntimeActive;
}

function getRecoveredCaptureBounds(settings) {
  const hasStoredPosition = Number.isFinite(settings.windowX) && Number.isFinite(settings.windowY);
  const display = hasStoredPosition
    ? screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY })
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(Math.max(settings.windowWidth || DEFAULTS.WINDOW_WIDTH, 400), workArea.width);
  const height = Math.min(Math.max(settings.windowHeight || DEFAULTS.WINDOW_HEIGHT, 400), workArea.height);
  return clampBoundsToWorkArea({
    width,
    height,
    x: hasStoredPosition ? settings.windowX : workArea.x + workArea.width - width - 20,
    y: hasStoredPosition ? settings.windowY : workArea.y + workArea.height - height - 60,
  }, workArea);
}

function promoteRecoveredWindow(settings) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setSkipTaskbar(Boolean(tray));
  } catch {
    console.error('[StartupRuntime] Window taskbar state could not be restored.');
  }

  try {
    const targetMode = settings.setupMode === 'unconfigured' ? 'setup' : 'capture';
    if (targetMode === 'capture') captureWindowBounds = getRecoveredCaptureBounds(settings);
    if (targetMode === currentWindowMode) {
      if (targetMode === 'capture') mainWindow.setBounds(captureWindowBounds, true);
      mainWindow.setAlwaysOnTop(targetMode === 'capture');
      if (
        targetMode === 'setup'
        && Number.isFinite(settings.windowX)
        && Number.isFinite(settings.windowY)
      ) {
        const display = screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY });
        const bounds = clampBoundsToWorkArea({
          ...mainWindow.getBounds(),
          x: settings.windowX,
          y: settings.windowY,
        }, display.workArea);
        mainWindow.setPosition(bounds.x, bounds.y, true);
      }
    } else {
      setWindowMode(targetMode);
    }
  } catch {
    console.error('[StartupRuntime] Window mode could not be restored.');
  }
  try {
    showMainWindow();
  } catch {
    console.error('[StartupRuntime] Recovered window could not be shown.');
  }
}

function applyRecoveredSettings(settings) {
  activatePersistentRuntime(settings, { broadcast: true });
  promoteRecoveredWindow(settings);
}

// --------------- IPC Handlers ---------------

function registerAppQuitIpcHandlers() {
  if (uiFixtureMode.enabled && !uiFixtureRuntime?.isCommandQSafeExitFixture?.()) return;

  ipcMain.handle(IPC_CHANNELS.APP_QUIT_LISTENER_READY, (event) => {
    assertTrustedQuitIpc(event);
    const pendingRequest = quitRequestRegistry.getPending(event.sender.id);
    if (pendingRequest) {
      event.sender.send(IPC_CHANNELS.APP_QUIT_REQUESTED, pendingRequest);
    }
    uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({
      listenerReadyCount: 1,
      pendingReplayCount: pendingRequest ? 1 : 0,
    });
    // The renderer subscribes before this handshake. Main-owned replay avoids
    // returning a request id through a Promise that could arrive after cancel.
    return { status: 'ready', replayed: Boolean(pendingRequest) };
  });

  ipcMain.handle(IPC_CHANNELS.APP_SESSION_RISK_UPDATE, (event, payload) => {
    assertTrustedQuitIpc(event);
    if (!payload || typeof payload !== 'object' || typeof payload.hasRisk !== 'boolean') {
      throw new Error('退出风险状态无效');
    }
    rendererQuitRiskKnown = true;
    rendererHasQuitRisk = payload.hasRisk;
    if (
      uiFixtureRuntime?.isCommandQSafeExitFixture?.()
      && payload.hasRisk
      && !clipboardResidueRegistry.hasRisk(event.sender.id)
    ) {
      // The fixture owns no clipboard text. This opaque main-owned consequence
      // proves the same fail-closed confirmation branch used after a real copy.
      clipboardResidueRegistry.replace(event.sender.id);
    }
    uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ riskUpdateCount: 1 });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.APP_QUIT_DECISION, (event, payload) => {
    assertTrustedQuitIpc(event);
    const activeConsequence = clipboardResidueRegistry.get(event.sender.id);
    if (
      payload?.confirmed === true
      && activeConsequence
      && payload.clipboardConsequenceId !== activeConsequence.id
    ) {
      uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ mismatchDecisionCount: 1 });
      return {
        status: 'clipboard-consequence-unconfirmed',
        clipboardConsequence: activeConsequence,
      };
    }
    const decision = quitRequestRegistry.decide(event.sender.id, payload);
    if (decision.status === 'cancelled') {
      uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ cancelDecisionCount: 1 });
    }
    if (decision.status === 'confirmed') {
      uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ confirmedDecisionCount: 1 });
      performConfirmedQuit({ defer: true });
      return { status: 'confirmed' };
    }
    return decision;
  });
}

function registerAppSettingsIpcHandlers() {
  if (uiFixtureMode.enabled && !uiFixtureRuntime?.isCommandCommaSafeSettingsFixture?.()) return;

  ipcMain.handle(IPC_CHANNELS.APP_SETTINGS_LISTENER_READY, (event) => {
    assertTrustedSettingsIpc(event);
    const pendingRequest = settingsRequestRegistry.getPending(event.sender.id);
    if (pendingRequest) event.sender.send(IPC_CHANNELS.APP_SETTINGS_REQUESTED, pendingRequest);
    uiFixtureRuntime?.recordCommandCommaSafeSettingsLifecycle?.({
      listenerReadyCount: 1,
      pendingReplayCount: pendingRequest ? 1 : 0,
      requestSentCount: pendingRequest ? 1 : 0,
    });
    return { status: 'ready', replayed: Boolean(pendingRequest) };
  });

  ipcMain.handle(IPC_CHANNELS.APP_SETTINGS_REQUEST_HANDLED, (event, payload) => {
    assertTrustedSettingsIpc(event);
    const acknowledgement = settingsRequestRegistry.acknowledge(event.sender.id, payload);
    uiFixtureRuntime?.recordCommandCommaSafeSettingsLifecycle?.({
      acknowledgedCount: acknowledgement.status === 'acknowledged' ? 1 : 0,
      invalidAcknowledgementCount: acknowledgement.status === 'invalid' ? 1 : 0,
    });
    return acknowledgement;
  });
}

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.CAPTURE_INGRESS_LISTENER_READY, (event) => {
    assertTrustedCaptureIngressIpc(event);
    return captureIngressRegistry.markReady(event.sender.id, deliverCaptureIngress);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (event) => {
    assertTrustedIpc(event);
    let recoveredNow = false;
    if (!store.isStoreReady()) {
      const status = store.retryStoreInitialization();
      if (status.state !== 'ready') {
        return { startupBlocked: true, reason: status.reason };
      }
      recoveredNow = true;
    }
    const settings = store.getAllSettings();
    if (recoveredNow) applyRecoveredSettings(settings);
    else if (!persistentRuntimeActive) activatePersistentRuntime(settings, { broadcast: true });
    return getSafeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RECOVERY_RESET, (event) => {
    assertTrustedIpc(event);
    const result = store.recoveryResetStore();
    if (result.status !== 'recovered') return result;

    applyRecoveredSettings(store.getAllSettings());
    return {
      status: 'recovered',
      settings: getSafeSettings(),
      recovery: {
        backupCreated: result.backupCreated,
        backupFileName: result.backupFileName,
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.SHORTCUT_STATUS_GET, (event) => {
    assertTrustedIpc(event);
    return shortcutRegistrationStatus;
  });

  ipcMain.handle(IPC_CHANNELS.SUPPORT_DIAGNOSTICS_GET, (event) => {
    assertTrustedIpc(event);
    return createSupportDiagnostics({
      appVersion: app.getVersion(),
      buildIdentity: runtimeBuildIdentity,
      systemVersion: typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '未知',
      arch: process.arch,
      screenRecordingStatus: getScreenRecordingAccessStatus(),
      settings: getSafeSettings(),
      shortcutRegistrationStatus,
      savedTermCount: store.getSavedTerms().length,
      generatedAt: new Date().toISOString(),
    });
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_GET, (event) => {
    assertTrustedIpc(event);
    return store.getSavedTerms();
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_SAVE, (event, term) => {
    assertTrustedIpc(event);
    return store.addSavedTerm(term);
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_DELETE, (event, id) => {
    assertTrustedIpc(event);
    if (!Number.isSafeInteger(id)) throw new Error('术语 ID 无效');
    store.deleteSavedTerm(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_EXPORT, async (event) => {
    assertTrustedIpc(event);
    const backup = createTermBackup(store.getSavedTerms());
    if (backup.terms.length === 0) return termImportFailure('no-terms');
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(ownerWindow, {
      title: '导出术语备份',
      defaultPath: path.join(app.getPath('documents'), `Slipstream-terms-${date}.json`),
      filters: [{ name: 'Slipstream 术语备份', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    const temporaryPath = `${result.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, serializeTermBackup(backup.terms, backup.exportedAt), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await fs.promises.rename(temporaryPath, result.filePath);
      return {
        status: 'saved',
        count: backup.terms.length,
        fileName: path.basename(result.filePath),
      };
    } catch {
      await fs.promises.unlink(temporaryPath).catch(() => {});
      return termImportFailure('write-failed');
    }
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_IMPORT_PREVIEW, async (event) => {
    assertTrustedIpc(event);
    prunePendingTermImports();
    removePendingTermImportsForSender(event.sender.id);
    const importGeneration = getTermImportGeneration(event.sender.id);
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: '选择术语备份',
      filters: [{ name: 'Slipstream 术语备份', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length !== 1) return { status: 'cancelled' };

    const filePath = result.filePaths[0];
    try {
      const fileStats = await fs.promises.stat(filePath);
      if (!fileStats.isFile() || fileStats.size > TERM_IMPORT_MAX_BYTES) {
        return termImportFailure('file-too-large');
      }
      const parsed = parseTermBackup(await fs.promises.readFile(filePath, 'utf8'));
      if (getTermImportGeneration(event.sender.id) !== importGeneration) {
        return termImportFailure('preview-expired');
      }
      if (parsed.terms.length === 0) return termImportFailure('no-usable-terms');
      const existingTerms = store.getSavedTerms();
      const planned = mergePortableTerms(existingTerms, parsed.terms, {
        limit: 50,
        now: 'preview',
        idFactory: (index) => `preview-${index}`,
      });
      const previewId = crypto.randomUUID();
      pendingTermImports.set(previewId, {
        senderId: event.sender.id,
        sender: event.sender,
        importGeneration,
        expiresAt: Date.now() + TERM_IMPORT_TTL_MS,
        fileName: path.basename(filePath),
        savedTermsBaseline: createSavedTermsImportBaseline(existingTerms),
        terms: parsed.terms,
        parseSummary: {
          invalidCount: parsed.invalidCount,
          duplicateCount: parsed.duplicateCount,
          ignoredEvidenceCount: parsed.ignoredEvidenceCount,
          downgradedProvenanceCount: parsed.downgradedProvenanceCount,
        },
      });
      return {
        status: 'ready',
        previewId,
        fileName: path.basename(filePath),
        examples: parsed.terms.slice(0, 5).map((term) => term.term),
        planTerms: parsed.terms,
        summary: { ...planned.summary, ...pendingTermImports.get(previewId).parseSummary },
      };
    } catch (error) {
      if (error instanceof TermTransferError) return termImportFailure(error.code);
      return termImportFailure('read-failed');
    }
  });

  ipcMain.handle(IPC_CHANNELS.TERMS_IMPORT_COMMIT, (event, previewId) => {
    assertTrustedIpc(event);
    prunePendingTermImports();
    if (typeof previewId !== 'string' || previewId.length > 100) {
      return termImportFailure('preview-expired');
    }
    const pending = pendingTermImports.get(previewId);
    if (
      !pending
      || pending.senderId !== event.sender.id
      || pending.importGeneration !== getTermImportGeneration(event.sender.id)
    ) {
      pendingTermImports.delete(previewId);
      return termImportFailure('preview-expired');
    }
    pendingTermImports.delete(previewId);
    if (pending.savedTermsBaseline !== createSavedTermsImportBaseline(store.getSavedTerms())) {
      return termImportFailure('preview-expired');
    }
    try {
      const merged = store.mergeSavedTerms(pending.terms);
      return {
        status: 'imported',
        fileName: pending.fileName,
        savedTerms: merged.terms,
        summary: { ...merged.summary, ...pending.parseSummary },
      };
    } catch {
      return termImportFailure('commit-failed');
    }
  });

  ipcMain.handle(IPC_CHANNELS.USER_DATA_RESET_PREPARE, (event, payload) => {
    assertTrustedIpc(event);
    return userDataResetRegistry.prepare(
      event.sender.id,
      payload,
      clipboardResidueRegistry.get(event.sender.id),
    );
  });

  ipcMain.handle(IPC_CHANNELS.USER_DATA_RESET_ABORT, (event, payload) => {
    assertTrustedIpc(event);
    return userDataResetRegistry.abort(event.sender.id, payload?.ticket);
  });

  ipcMain.handle(IPC_CHANNELS.USER_DATA_CLEAR, (event, payload) => {
    assertTrustedIpc(event);
    const authorization = userDataResetRegistry.consume(
      event.sender.id,
      payload?.ticket,
      clipboardResidueRegistry.get(event.sender.id),
    );
    if (authorization.status !== 'authorized') return authorization;

    advanceTermImportGeneration(event.sender.id);
    removePendingTermImportsForSender(event.sender.id);
    verificationApprovalRegistry.revokeSender(event.sender.id);
    verificationAbortController?.abort();
    providerConnectionAbortController?.abort();
    llmAbortController?.abort();
    store.resetUserDataAndSettings();
    clipboardResidueRegistry.clearSender(event.sender.id);
    stopClipboardMonitoring();
    unregisterAll();
    registerConfiguredShortcuts(store.getAllSettings());
    return {
      status: 'cleared',
      settings: getSafeSettings(),
      clipboardStatus: authorization.clipboardStatus,
    };
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, (event, text) => {
    assertTrustedIpc(event);
    if (userDataResetRegistry.isLocked(event.sender.id)) {
      const error = new Error('全量重置授权期间不能更改系统剪贴板');
      error.code = 'user-data-reset-pending';
      throw error;
    }
    if (app.isQuitting) throw new Error('应用正在退出，未更改系统剪贴板');
    if (typeof text !== 'string' || text.length > 100000) {
      throw new Error('无法复制无效或过长的内容');
    }
    const preparedConsequence = clipboardResidueRegistry.prepare(event.sender.id);
    if (clipboardMonitor) clipboardMonitor.suppressNextText(text);
    clipboard.writeText(text);
    const consequence = clipboardResidueRegistry.commit(
      event.sender.id,
      preparedConsequence.id,
    );
    return {
      success: true,
      consequenceId: consequence.id,
    };
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, (event) => {
    assertTrustedIpc(event);
    return createClipboardPayload(clipboard.readText());
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_HIDE, (event) => {
    assertTrustedIpc(event);
    hideMainWindowForUser();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_PENDING_STATUS, (event, payload) => {
    assertTrustedIpc(event);
    if (!payload || typeof payload !== 'object' || typeof payload.pending !== 'boolean') {
      throw new Error('剪贴板等待状态无效');
    }
    rendererClipboardPendingStatus = normalizeClipboardPendingStatus(payload);
    refreshTrayPresentation();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.APP_RENDERER_RECOVERY_STATUS_GET, (event) => {
    assertTrustedIpc(event);
    const notice = pendingRendererRecoveryNotice || { recovered: false };
    pendingRendererRecoveryNotice = null;
    return {
      ...notice,
      clipboardResidueRisk: clipboardResidueRegistry.getInterrupted(event.sender.id),
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK, (event, payload) => {
    assertTrustedIpc(event);
    if (userDataResetRegistry.isLocked(event.sender.id)) {
      const error = new Error('全量重置授权期间不能确认剪贴板后果');
      error.code = 'user-data-reset-pending';
      throw error;
    }
    const id = payload && typeof payload === 'object' ? payload.id : null;
    return clipboardResidueRegistry.resolve(event.sender.id, id);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_MODE, (event, mode) => {
    assertTrustedIpc(event);
    return setWindowMode(mode);
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS, async (event) => {
    assertTrustedIpc(event);
    await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL, { activate: true });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.EXTERNAL_OPEN, async (event, url) => {
    assertTrustedIpc(event);
    const safeUrl = validateExternalUrl(url);
    await resolvePublicAddresses(safeUrl);
    await shell.openExternal(safeUrl, { activate: true });
    return true;
  });

  // Settings: set
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (event, key, value) => {
    assertTrustedIpc(event);
    [key, value] = validateSetting(key, value);
    const previousSettings = store.getAllSettings();
    const settingChanged = previousSettings[key] !== value;

    if (settingChanged && PROVIDER_CONNECTION_SETTING_KEYS.has(key)) {
      providerConnectionAbortController?.abort();
    }
    if (settingChanged && LLM_PROCESSING_SETTING_KEYS.has(key)) {
      llmAbortController?.abort();
    }
    if (settingChanged && key === 'verificationPolicy') {
      verificationApprovalRegistry.revokeSender(event.sender.id);
      verificationAbortController?.abort();
    }

    if (key === 'clipboardShortcut' || key === 'screenshotShortcut') {
      const otherKey = key === 'clipboardShortcut' ? 'screenshotShortcut' : 'clipboardShortcut';
      if (sameShortcutAccelerator(value, previousSettings[otherKey])) {
        throw new Error(`shortcut-duplicate:${key}`);
      }
      unregisterAll();
      const candidateSettings = { ...previousSettings, [key]: value };
      const candidateStatus = registerShortcuts(dispatchCaptureIngress, candidateSettings);
      if (!candidateStatus.allRegistered) {
        unregisterAll();
        const restoredStatus = registerConfiguredShortcuts(previousSettings);
        const changedKind = key === 'clipboardShortcut' ? 'clipboard' : 'screenshot';
        const failureCode = restoredStatus.allRegistered
          ? candidateStatus[changedKind]?.reason === 'invalid'
            ? 'shortcut-invalid'
            : 'shortcut-conflict'
          : 'shortcut-restore-failed';
        throw new Error(`${failureCode}:${key}`);
      }
      try {
        store.setSetting(key, value);
      } catch (error) {
        unregisterAll();
        registerConfiguredShortcuts(previousSettings);
        throw error;
      }
      publishShortcutRegistrationStatus(candidateStatus);
      return { status: 'saved', key, customEndpointApiKeyCleared: false };
    }

    if (key === 'clipboardMonitoring') {
      transitionClipboardMonitoring({
        enabled: value,
        isActive: () => Boolean(clipboardMonitor),
        start: startClipboardMonitoring,
        stop: stopClipboardMonitoring,
        persist: (nextValue) => store.setSetting(key, nextValue),
        onDisabled: () => {
          rendererClipboardPendingStatus = { pending: false, count: 0 };
        },
        onRollbackError: () => {
          console.error('[ClipboardMonitor] Settings rollback failed.');
        },
      });
      persistentRuntimeStatus.clipboardMonitoringDisabled = false;
      persistentRuntimeStatus.clipboardMonitoringDisablePersistFailed = false;
      return { status: 'saved', key, customEndpointApiKeyCleared: false };
    }

    if (key === 'customEndpointUrl') {
      const { customEndpointApiKeyCleared } = store.setCustomEndpointUrl(value);
      return { status: 'saved', key, customEndpointApiKeyCleared };
    }

    store.setSetting(key, value);
    return { status: 'saved', key, customEndpointApiKeyCleared: false };
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_TEST, async (event, options) => {
    assertTrustedIpc(event);
    try {
      validateProviderConnectionTestOptions(options);
    } catch {
      return { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.INVALID_CONFIG };
    }
    if (providerConnectionInFlight || llmRequestInFlight || verificationRequestInFlight) {
      return { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.BUSY };
    }

    const controller = new AbortController();
    const settingsSnapshot = store.getAllSettings();
    const providerTestProcessingLocation = processingLocationForSettings(settingsSnapshot);
    providerConnectionInFlight = true;
    providerConnectionAbortController = controller;
    let task;
    task = Promise.resolve()
      .then(() => testProviderReadiness(settingsSnapshot, { signal: controller.signal }))
      .then((result) => ({
        ...result,
        processingLocation: providerTestProcessingLocation,
      }))
      .catch(() => ({
        status: CONNECTION_STATUSES.FAILED,
        code: CONNECTION_CODES.INVALID_CONFIG,
        processingLocation: providerTestProcessingLocation,
      }))
      .finally(() => {
        if (providerConnectionAbortController === controller) providerConnectionAbortController = null;
        if (providerConnectionTask === task) providerConnectionTask = null;
        providerConnectionInFlight = false;
      });
    providerConnectionTask = task;
    return task;
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_CANCEL, async (event) => {
    assertTrustedIpc(event);
    const task = providerConnectionTask;
    if (!providerConnectionInFlight || !task) return { status: 'not-running' };
    providerConnectionAbortController?.abort();
    const settled = await waitForProviderConnectionStop(task);
    return {
      status: settled && !providerConnectionInFlight ? 'cancelled' : 'still-running',
    };
  });

  // LLM processing
  ipcMain.handle(IPC_CHANNELS.LLM_CANCEL, async (event, options) => {
    assertTrustedIpc(event);
    const discardResult = options?.discardResult === true;
    if (discardResult) {
      verificationApprovalRegistry.revokeSender(event.sender.id);
    }
    const activeTasks = [
      providerConnectionInFlight ? providerConnectionTask : null,
      llmRequestInFlight ? llmRequestSettlement?.promise : null,
      verificationRequestInFlight ? verificationRequestSettlement?.promise : null,
      captureRequestInFlight ? captureRequestSettlement?.promise : null,
    ];
    providerConnectionAbortController?.abort();
    llmAbortController?.abort();
    verificationAbortController?.abort();
    captureAbortController?.abort();
    const cancelledHandoff = backgroundTaskHandoffRegistry.cancelForSender(event.sender.id);
    if (cancelledHandoff?.task) finishBackgroundTask(cancelledHandoff.task, 'cancelled');
    return waitForTaskSettlements(activeTasks);
  });

  ipcMain.handle(IPC_CHANNELS.LLM_PROCESS, async (event, options) => {
    assertTrustedIpc(event);
    if (llmRequestInFlight) return userError(USER_ERRORS.PROCESSING_BUSY);
    if (providerConnectionInFlight) return userError(USER_ERRORS.PROCESSING_BUSY);
    const requestStartedAt = Date.now();
    const controller = new AbortController();
    const settlement = createTaskSettlement();
    let requestBackend = store.getSettings('activeBackend');
    let taskOutcome = 'failure';
    let backgroundTask = null;
    llmRequestInFlight = true;
    llmAbortController = controller;
    llmRequestSettlement = settlement;
    try {
      const request = validateProcessOptions(options);
      const senderId = event.sender.id;
      const settings = store.getAllSettings();
      requestBackend = settings.activeBackend;
      const requestProcessingLocation = processingLocationForSettings(settings);
      if (
        requiresKnownEndpointLocation(settings.activeBackend)
        && requestProcessingLocation === PROCESSING_LOCATION_KINDS.UNKNOWN
      ) {
        return userError(USER_ERRORS.PROCESSING_LOCATION_UNKNOWN);
      }
      let ocrReviewDestination;
      try {
        ocrReviewDestination = createAuthoritativeOcrReviewDestination(
          settings,
          requestProcessingLocation,
        );
      } catch {
        return userError(USER_ERRORS.PROCESSING_LOCATION_UNKNOWN);
      }
      const destinationSha256 = createDestinationSha256(ocrReviewDestination);
      const requestOcrReviewAssessment = assessOcrReview({
        source: request.source,
        text: request.text,
        capture: request.capture,
      });
      const pendingOcrReview = pendingOcrReviewRegistry.match({
        senderId,
        sourceText: request.text,
      });
      const ocrReviewAssessment = pendingOcrReview.status === 'matched'
        ? pendingOcrReview.assessment
        : requestOcrReviewAssessment;
      if (!isOcrReviewConfirmed(
        ocrReviewAssessment,
        request.ocrReview,
        destinationSha256,
      )) {
        return userError(USER_ERRORS.OCR_REVIEW_REQUIRED, {
          ocrReview: ocrReviewAssessment,
        });
      }
      if (pendingOcrReview.status === 'matched') {
        const consumedOcrReview = pendingOcrReviewRegistry.consume({
          senderId,
          sourceText: request.text,
        });
        if (consumedOcrReview.status !== 'consumed') {
          return userError(USER_ERRORS.OCR_REVIEW_REQUIRED, {
            ocrReview: ocrReviewAssessment,
          });
        }
      }
      const pendingOcrHandoff = backgroundTaskHandoffRegistry.claim({
        senderId,
        sourceKind: request.source,
        sourceText: request.text,
      });
      if (pendingOcrHandoff?.task) {
        backgroundTask = handoffBackgroundTask(pendingOcrHandoff.task, 'analysis');
      }
      if (!backgroundTask) backgroundTask = beginBackgroundTask('analysis');
      const analysisAuthorityEpoch = verificationApprovalRegistry.revokeSender(senderId);
      verificationAbortController?.abort();
      const captureEnvelope = createCaptureEnvelope({
        text: request.text,
        sourceKind: request.source,
        capture: request.capture,
        truncated: request.truncated,
        originalLength: request.originalLength,
      });
      const llmResponse = await LLMService.processText({
        ...request,
        captureEnvelope,
        backend: settings.activeBackend,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        settingsSnapshot: settings,
        signal: controller.signal,
      });
      const actionBriefResponse = await createActionBrief({
        sourceText: request.text,
        rawOutput: llmResponse.result,
        backend: settings.activeBackend,
        model: settings.activeModel,
        processingTimeMs: llmResponse.processingTimeMs,
        processingLocation: requestProcessingLocation,
        captureEnvelope,
        verificationPolicy: settings.verificationPolicy,
        verificationApproved: request.verificationApproved,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || !verificationApprovalRegistry.isAuthorityCurrent(senderId, analysisAuthorityEpoch)
      ) {
        taskOutcome = 'cancelled';
        return userError(USER_ERRORS.PROCESSING_CANCELLED, { cancelled: true });
      }
      if (actionBriefResponse.brief?.status === 'invalid') {
        console.error('[LLMProcess] Structured output validation failed:', {
          backend: safeProcessingBackend(settings.activeBackend),
          errorCode: USER_ERRORS.PROCESSING_INVALID.code,
        });
        return userError(USER_ERRORS.PROCESSING_INVALID, {
          brief: actionBriefResponse.brief,
          processingLocation: requestProcessingLocation,
          processingTimeMs: Date.now() - requestStartedAt,
        });
      }
      registerVerificationApproval(
        event,
        actionBriefResponse.brief,
        actionBriefResponse.verificationSummary,
        analysisAuthorityEpoch,
      );
      taskOutcome = 'success';
      return {
        success: true,
        brief: actionBriefResponse.brief,
        text: llmResponse.result,
        source: {
          text: captureEnvelope.rawText,
          kind: captureEnvelope.sourceKind,
          capturedAt: captureEnvelope.capturedAt,
          truncated: captureEnvelope.truncated,
          originalLength: captureEnvelope.originalLength,
          ocr: captureEnvelope.ocr,
        },
        verificationSummary: actionBriefResponse.verificationSummary,
        processingLocation: requestProcessingLocation,
        processingTimeMs: Date.now() - requestStartedAt,
      };
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'aborted' || error?.name === 'AbortError') {
        taskOutcome = 'cancelled';
        return userError(USER_ERRORS.PROCESSING_CANCELLED, { cancelled: true });
      }
      const definition = classifyProcessingError(error, requestBackend);
      console.error('[LLMProcess] Failed:', processingErrorDiagnostic(error, requestBackend));
      return userError(definition);
    } finally {
      llmRequestInFlight = false;
      if (llmAbortController === controller) llmAbortController = null;
      finishBackgroundTask(backgroundTask, taskOutcome);
      settlement.resolve();
      if (llmRequestSettlement === settlement) llmRequestSettlement = null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN, async (event, options) => {
    assertTrustedIpc(event);
    if (verificationRequestInFlight) {
      return userError(USER_ERRORS.VERIFICATION_BUSY);
    }
    const senderId = event.sender.id;
    const verificationAuthorityEpoch = verificationApprovalRegistry.getAuthorityEpoch(senderId);
    const requestStartedAt = Date.now();
    const controller = new AbortController();
    const settlement = createTaskSettlement();
    let request = null;
    let approvalConsumed = false;
    let taskOutcome = 'failure';
    verificationRequestInFlight = true;
    verificationAbortController = controller;
    verificationRequestSettlement = settlement;
    const backgroundTask = beginBackgroundTask('verification');
    try {
      request = validateVerificationOptions(options);
      if (!consumeVerificationApproval(
        event,
        request.approvalId,
        request.brief?.source?.sha256,
        verificationAuthorityEpoch,
      )) {
        return userError(USER_ERRORS.VERIFICATION_APPROVAL_INVALID);
      }
      approvalConsumed = true;
      const settings = store.getAllSettings();
      const response = await verifyExistingActionBrief({
        sourceText: request.sourceText,
        brief: request.brief,
        verificationPolicy: settings.verificationPolicy,
        verificationApproved: true,
        verificationApprovalId: request.approvalId,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || !verificationApprovalRegistry.isAuthorityCurrent(senderId, verificationAuthorityEpoch)
      ) {
        const invalidatedError = new Error('verification authority was invalidated');
        invalidatedError.name = 'AbortError';
        throw invalidatedError;
      }
      const verificationSummary = createRetryVerificationSummary(
        response.brief,
        response.verificationSummary,
      );
      const retryApprovalId = registerVerificationApproval(
        event,
        response.brief,
        verificationSummary,
        verificationAuthorityEpoch,
      ) ? verificationSummary.approvalId : null;
      taskOutcome = 'success';
      return {
        success: true,
        brief: response.brief,
        verificationSummary,
        ...(retryApprovalId ? { retryApprovalId } : {}),
        processingTimeMs: Date.now() - requestStartedAt,
      };
    } catch (error) {
      const authorityCurrent = verificationApprovalRegistry.isAuthorityCurrent(
        senderId,
        verificationAuthorityEpoch,
      );
      const retryApprovalId = approvalConsumed && request && authorityCurrent && verificationApprovalRegistry.register({
        senderId,
        sourceSha256: request.brief?.source?.sha256,
        approvalId: request.approvalId,
        authorityEpoch: verificationAuthorityEpoch,
      }) ? request.approvalId : null;
      if (
        controller.signal.aborted
        || !authorityCurrent
        || error?.code === 'aborted'
        || error?.name === 'AbortError'
      ) {
        taskOutcome = 'cancelled';
        return userError(USER_ERRORS.VERIFICATION_CANCELLED, {
          cancelled: true,
          ...(retryApprovalId ? { retryApprovalId } : {}),
        });
      }
      console.error('[VerificationRun] Error:', error);
      return userError(USER_ERRORS.VERIFICATION_FAILED, {
        ...(retryApprovalId ? { retryApprovalId } : {}),
      });
    } finally {
      if (verificationAbortController === controller) verificationAbortController = null;
      verificationRequestInFlight = false;
      finishBackgroundTask(backgroundTask, taskOutcome);
      settlement.resolve();
      if (verificationRequestSettlement === settlement) verificationRequestSettlement = null;
    }
  });

  // Screenshot capture flow: capture region -> OCR -> LLM
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async (event) => {
    assertTrustedIpc(event);
    if (providerConnectionInFlight || llmRequestInFlight || verificationRequestInFlight) {
      return userError(USER_ERRORS.SCREENSHOT_BUSY);
    }
    return captureScreenshotTask(event.sender.id);
  });
}

// --------------- App Lifecycle ---------------

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
});

app.on('ready', () => {
  const storageStatus = store.initializeStore();
  const settings = getStartupSettings();
  installAboutPanel();
  installApplicationMenu();
  registerAppQuitIpcHandlers();
  registerAppSettingsIpcHandlers();
  if (!uiFixtureMode.enabled) registerIpcHandlers();
  createMainWindow(settings);
  if (uiFixtureMode.enabled) return;
  if (storageStatus.state === 'ready') activatePersistentRuntime(settings);

  // Send settings to renderer once ready (strip sensitive keys)
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!store.isStoreReady()) return;
    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_LOADED, getSafeSettings());
    mainWindow.webContents.send(IPC_CHANNELS.SHORTCUT_STATUS_CHANGED, shortcutRegistrationStatus);
  });
});

app.on('window-all-closed', () => {
  if (uiFixtureMode.enabled) {
    app.isQuitting = true;
    app.quit();
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow(getStartupSettings());
  } else {
    showMainWindow();
  }
});

app.on('before-quit', (event) => {
  if (uiFixtureMode.enabled && !uiFixtureRuntime?.isCommandQSafeExitFixture?.()) {
    app.isQuitting = true;
    return;
  }
  if (!app.isQuitting) {
    event.preventDefault();
    requestAppQuit();
    return;
  }
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({
    beforeQuitCount: 1,
    cleanupStarted: true,
  });
  quitRequestRegistry.clear();
  settingsRequestRegistry.clear();
  captureIngressRegistry.clear();
  captureIngressSenderId = null;
  completionNotification?.close();
  completionNotification = null;
  backgroundTaskHandoffRegistry.clear();
  activeBackgroundTask = null;
  stopClipboardMonitoring();
  llmAbortController?.abort();
  providerConnectionAbortController?.abort();
  verificationAbortController?.abort();
  captureAbortController?.abort();
  verificationApprovalRegistry.clearAll();
  userDataResetRegistry.clearAll();
  clipboardResidueRegistry.clearAll();
  unregisterAll();
  ScreenshotService.cleanup();
  OCRService.cleanup();
  uiFixtureRuntime?.recordCommandQSafeExitLifecycle?.({ cleanupComplete: true });
});

app.on('will-quit', () => {
  uiFixtureRuntime?.emitCommandQSafeExitProof?.();
});
}
