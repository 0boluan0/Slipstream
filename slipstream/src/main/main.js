const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const { createClipboardPayload, registerShortcuts, unregisterAll } = require('./global-shortcut');
const ScreenshotService = require('./screenshot-service');
const OCRService = require('./ocr-service');
const ClipboardMonitor = require('./clipboard-monitor');
const LLMService = require('./llm-service');
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
  testProviderConnection,
} = require('./provider-connection');
const { createVerificationApprovalRegistry } = require('./verification/approval-registry');
const { redactSettingsForRenderer } = require('./safe-settings');
const { resolvePublicAddresses } = require('./verification/url-safety');
const {
  isTrustedRendererUrl,
  validateExternalUrl,
  validateProcessOptions,
  validateProviderConnectionTestOptions,
  validateSetting,
  validateVerificationOptions,
} = require('./validation');
const {
  IPC_CHANNELS,
  DEFAULTS,
  APP_NAME,
} = require('../shared/constants.cjs');

const OCR_FAILURE_MESSAGE = '没有识别到清晰文字，请重新截图并确保文字清晰。';
const USER_ERRORS = Object.freeze({
  PROCESSING_BUSY: Object.freeze({ code: 'processing-busy', message: '已有任务正在处理，请稍候。' }),
  PROCESSING_CANCELLED: Object.freeze({ code: 'processing-cancelled', message: '处理已取消。' }),
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

// --------------- State ---------------

let mainWindow = null;
let tray = null;
let clipboardMonitor = null;
let llmRequestInFlight = false;
let llmAbortController = null;
let providerConnectionInFlight = false;
let providerConnectionAbortController = null;
let verificationRequestInFlight = false;
let verificationAbortController = null;
let captureRequestInFlight = false;
let captureAbortController = null;
let currentWindowMode = 'capture';
let captureWindowBounds = null;
const verificationApprovalRegistry = createVerificationApprovalRegistry();
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
const isDev = process.argv.includes('--dev');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function getSafeSettings() {
  return redactSettingsForRenderer(store.getAllSettings());
}

function assertTrustedIpc(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isTrustedRendererUrl(url, isDev)) throw new Error('拒绝了不受信任的应用请求');
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

function createMainWindow() {
  const settings = store.getAllSettings();
  const primaryWorkArea = screen.getPrimaryDisplay().workAreaSize;
  const needsSetup = settings.setupMode === 'unconfigured';
  currentWindowMode = needsSetup ? 'setup' : 'capture';

  const windowOptions = {
    width: Math.min(
      needsSetup ? DEFAULTS.SETUP_WINDOW_WIDTH : Math.max(settings.windowWidth || DEFAULTS.WINDOW_WIDTH, 400),
      primaryWorkArea.width,
    ),
    height: Math.min(
      needsSetup ? DEFAULTS.SETUP_WINDOW_HEIGHT : Math.max(settings.windowHeight || DEFAULTS.WINDOW_HEIGHT, 400),
      primaryWorkArea.height,
    ),
    frame: false,
    // The compact capture surface may float above the current app, but the
    // wide result and setup surfaces must let users switch to the source app
    // or an official page without Slipstream covering it.
    alwaysOnTop: !needsSetup,
    transparent: true,
    resizable: true,
    minWidth: 400,
    minHeight: 400,
    skipTaskbar: true,
    show: !settings.startMinimized,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  // Apply vibrancy on macOS
  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'hudWindow';
  }

  mainWindow = new BrowserWindow(windowOptions);
  const rendererSenderId = mainWindow.webContents.id;
  captureWindowBounds = needsSetup ? null : mainWindow.getBounds();

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  // Restore saved position; place at bottom-right of primary display by default
  if (settings.windowX !== null && settings.windowY !== null) {
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
  if (isDev) {
    const devRendererUrl = process.env.SLIPSTREAM_DEMO_RESULT === '1'
      ? 'http://localhost:5173/?demo=result'
      : 'http://localhost:5173';
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
    mainWindow.loadFile(indexPath);
  }

  // On macOS, hide instead of quit on close
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    verificationApprovalRegistry.revokeSender(rendererSenderId);
    verificationAbortController?.abort();
    mainWindow = null;
  });

  let boundsSaveTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
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
  if (isDev) {
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
  mainWindow.setAlwaysOnTop(mode === 'capture');
  mainWindow.setBounds(nextBounds, true);
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

async function captureScreenshotTask() {
  if (captureRequestInFlight) return userError(USER_ERRORS.SCREENSHOT_BUSY);
  let imagePath = null;
  let windowState = null;
  let phase = 'selection';
  const controller = new AbortController();
  captureRequestInFlight = true;
  captureAbortController = controller;
  try {
    windowState = await hideWindowForCapture();
    imagePath = await ScreenshotService.captureSelectedRegion(undefined, { signal: controller.signal });
    restoreWindowAfterCapture(windowState);
    windowState = null;
    phase = 'ocr';
    const ocrResult = await OCRService.performOCR(imagePath, { signal: controller.signal });
    if (!ocrResult.text || !ocrResult.text.trim()) {
      return userError(USER_ERRORS.SCREENSHOT_EMPTY);
    }
    const textPayload = createClipboardPayload(ocrResult.text);
    return {
      success: true,
      ...textPayload,
      confidence: ocrResult.confidence,
      blocks: ocrResult.blocks,
    };
  } catch (error) {
    if (error?.isCancellation || controller.signal.aborted) {
      return { success: false, cancelled: true };
    }
    console.error('[ScreenshotCapture] Error:', error);
    return userError(classifyScreenshotError(error, phase));
  } finally {
    if (typeof imagePath === 'string') {
      try { fs.unlinkSync(imagePath); } catch (_) { /* cleanup failure is non-fatal */ }
    }
    restoreWindowAfterCapture(windowState);
    if (captureAbortController === controller) captureAbortController = null;
    captureRequestInFlight = false;
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

  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}

// --------------- Clipboard Monitor ---------------

function startClipboardMonitoring() {
  clipboardMonitor = new ClipboardMonitor();

  clipboardMonitor.startMonitoring((payload) => {
    if (mainWindow && !mainWindow.isDestroyed() && payload?.text) {
      mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, { ...payload, source: 'monitor' });
    }
  });
}

function stopClipboardMonitoring() {
  if (clipboardMonitor) {
    clipboardMonitor.stopMonitoring();
    clipboardMonitor = null;
  }
}

// --------------- IPC Handlers ---------------

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (event) => {
    assertTrustedIpc(event);
    return getSafeSettings();
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

  ipcMain.handle(IPC_CHANNELS.USER_DATA_CLEAR, (event) => {
    assertTrustedIpc(event);
    verificationApprovalRegistry.revokeSender(event.sender.id);
    verificationAbortController?.abort();
    providerConnectionAbortController?.abort();
    llmAbortController?.abort();
    store.clearUserData();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, (event, text) => {
    assertTrustedIpc(event);
    if (typeof text !== 'string' || text.length > 100000) {
      throw new Error('无法复制无效或过长的内容');
    }
    if (clipboardMonitor) clipboardMonitor.suppressNextText(text);
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, (event) => {
    assertTrustedIpc(event);
    return createClipboardPayload(clipboard.readText());
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_HIDE, (event) => {
    assertTrustedIpc(event);
    mainWindow?.hide();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_MODE, (event, mode) => {
    assertTrustedIpc(event);
    return setWindowMode(mode);
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
      unregisterAll();
      const candidateSettings = { ...previousSettings, [key]: value };
      if (!registerShortcuts(mainWindow, candidateSettings)) {
        unregisterAll();
        registerShortcuts(mainWindow, previousSettings);
        throw new Error(`快捷键 ${value} 无法注册，原快捷键已恢复`);
      }
    }

    store.setSetting(key, value);

    if (key === 'customEndpointUrl') {
      const previousUrl = previousSettings.customEndpointUrl;
      let previousOrigin = '';
      try { previousOrigin = previousUrl ? new URL(previousUrl).origin : ''; } catch (_) { /* legacy invalid URL */ }
      const nextOrigin = value ? new URL(value).origin : '';
      if (previousOrigin !== nextOrigin) store.setSetting('customEndpointApiKey', '');
    }

    // If clipboard monitoring setting changed, start or stop the monitor
    if (key === 'clipboardMonitoring') {
      if (value) {
        if (!clipboardMonitor) {
          startClipboardMonitoring();
        }
      } else {
        stopClipboardMonitoring();
      }
    }

    return true;
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_TEST, async (event, options) => {
    assertTrustedIpc(event);
    try {
      validateProviderConnectionTestOptions(options);
    } catch {
      return { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.INVALID_CONFIG };
    }
    if (providerConnectionInFlight) {
      return { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.BUSY };
    }

    const controller = new AbortController();
    providerConnectionInFlight = true;
    providerConnectionAbortController = controller;
    try {
      return await testProviderConnection(store.getAllSettings(), { signal: controller.signal });
    } catch {
      return { status: CONNECTION_STATUSES.FAILED, code: CONNECTION_CODES.INVALID_CONFIG };
    } finally {
      if (providerConnectionAbortController === controller) providerConnectionAbortController = null;
      providerConnectionInFlight = false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_CANCEL, (event) => {
    assertTrustedIpc(event);
    providerConnectionAbortController?.abort();
    return true;
  });

  // LLM processing
  ipcMain.handle(IPC_CHANNELS.LLM_CANCEL, (event, options) => {
    assertTrustedIpc(event);
    const discardResult = options?.discardResult === true;
    if (discardResult) {
      verificationApprovalRegistry.revokeSender(event.sender.id);
    }
    providerConnectionAbortController?.abort();
    llmAbortController?.abort();
    verificationAbortController?.abort();
    captureAbortController?.abort();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.LLM_PROCESS, async (event, options) => {
    assertTrustedIpc(event);
    if (llmRequestInFlight) return userError(USER_ERRORS.PROCESSING_BUSY);
    const requestStartedAt = Date.now();
    const controller = new AbortController();
    let requestBackend = store.getSettings('activeBackend');
    llmRequestInFlight = true;
    llmAbortController = controller;
    try {
      const request = validateProcessOptions(options);
      const senderId = event.sender.id;
      const analysisAuthorityEpoch = verificationApprovalRegistry.revokeSender(senderId);
      verificationAbortController?.abort();
      const settings = store.getAllSettings();
      requestBackend = settings.activeBackend;
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
        signal: controller.signal,
      });
      const actionBriefResponse = await createActionBrief({
        sourceText: request.text,
        rawOutput: llmResponse.result,
        backend: settings.activeBackend,
        model: settings.activeModel,
        processingTimeMs: llmResponse.processingTimeMs,
        captureEnvelope,
        verificationPolicy: settings.verificationPolicy,
        verificationApproved: request.verificationApproved,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || !verificationApprovalRegistry.isAuthorityCurrent(senderId, analysisAuthorityEpoch)
      ) {
        return userError(USER_ERRORS.PROCESSING_CANCELLED, { cancelled: true });
      }
      if (actionBriefResponse.brief?.status === 'invalid') {
        console.error('[LLMProcess] Structured output validation failed:', {
          provider: settings.activeBackend,
          model: settings.activeModel,
        });
        return userError(USER_ERRORS.PROCESSING_INVALID, {
          brief: actionBriefResponse.brief,
          processingTimeMs: Date.now() - requestStartedAt,
        });
      }
      registerVerificationApproval(
        event,
        actionBriefResponse.brief,
        actionBriefResponse.verificationSummary,
        analysisAuthorityEpoch,
      );
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
        processingTimeMs: Date.now() - requestStartedAt,
      };
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'aborted' || error?.name === 'AbortError') {
        return userError(USER_ERRORS.PROCESSING_CANCELLED, { cancelled: true });
      }
      console.error('[LLMProcess] Error:', error);
      return userError(classifyProcessingError(error, requestBackend));
    } finally {
      llmRequestInFlight = false;
      if (llmAbortController === controller) llmAbortController = null;
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
    let request = null;
    let approvalConsumed = false;
    verificationRequestInFlight = true;
    verificationAbortController = controller;
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
    }
  });

  // Screenshot capture flow: capture region -> OCR -> LLM
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async (event) => {
    assertTrustedIpc(event);
    llmAbortController?.abort();
    verificationAbortController?.abort();
    return captureScreenshotTask();
  });
}

// --------------- App Lifecycle ---------------

app.isQuitting = false;

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('ready', () => {
  if (!hasSingleInstanceLock) return;
  if ((store.getSettings('privacyVersion') || 0) < 1) {
    store.setSetting('clipboardMonitoring', false);
    store.setSetting('privacyVersion', 1);
  }
  createMainWindow();
  createTray();
  registerShortcuts(mainWindow, store.getAllSettings());
  registerIpcHandlers();

  if (store.getSettings('clipboardMonitoring') === true) {
    startClipboardMonitoring();
  }

  // Send settings to renderer once ready (strip sensitive keys)
  mainWindow.webContents.on('did-finish-load', () => {
    if (store.getSettings('startMinimized') !== true && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_LOADED, getSafeSettings());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopClipboardMonitoring();
  llmAbortController?.abort();
  verificationAbortController?.abort();
  captureAbortController?.abort();
  verificationApprovalRegistry.clearAll();
  unregisterAll();
  ScreenshotService.cleanup();
  OCRService.cleanup();
});
