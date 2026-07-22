const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const { registerShortcuts, unregisterAll } = require('./global-shortcut');
const ScreenshotService = require('./screenshot-service');
const OCRService = require('./ocr-service');
const ClipboardMonitor = require('./clipboard-monitor');
const LLMService = require('./llm-service');
const { createActionBrief } = require('./action-brief-service');
const { createCaptureEnvelope } = require('./capture-envelope');
const { redactSettingsForRenderer } = require('./safe-settings');
const { isTrustedRendererUrl, validateExternalUrl, validateProcessOptions, validateSetting } = require('./validation');
const {
  IPC_CHANNELS,
  DEFAULTS,
  APP_NAME,
} = require('../shared/constants.cjs');

const OCR_FAILURE_MESSAGE = '没有识别到清晰文字';

// --------------- State ---------------

let mainWindow = null;
let tray = null;
let clipboardMonitor = null;
let llmRequestInFlight = false;
let llmAbortController = null;
let currentWindowMode = 'capture';
let captureWindowBounds = null;
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

// --------------- Window ---------------

function createMainWindow() {
  const settings = store.getAllSettings();
  const primaryWorkArea = screen.getPrimaryDisplay().workAreaSize;

  const windowOptions = {
    width: Math.min(Math.max(settings.windowWidth || DEFAULTS.WINDOW_WIDTH, 400), primaryWorkArea.width),
    height: Math.min(Math.max(settings.windowHeight || DEFAULTS.WINDOW_HEIGHT, 400), primaryWorkArea.height),
    frame: false,
    alwaysOnTop: true,
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
  captureWindowBounds = mainWindow.getBounds();

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
    mainWindow = null;
  });

  let boundsSaveTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const bounds = mainWindow.getBounds();
      store.setSetting('windowX', bounds.x);
      store.setSetting('windowY', bounds.y);
      if (currentWindowMode === 'capture') {
        captureWindowBounds = bounds;
        store.setSetting('windowWidth', bounds.width);
        store.setSetting('windowHeight', bounds.height);
      }
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
  if (!['capture', 'result'].includes(mode)) throw new Error('窗口模式无效');
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
  return true;
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
    return clipboard.readText().slice(0, DEFAULTS.MAX_TEXT_LENGTH);
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
    await shell.openExternal(safeUrl, { activate: true });
    return true;
  });

  // Settings: set
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (event, key, value) => {
    assertTrustedIpc(event);
    [key, value] = validateSetting(key, value);

    const previousSettings = store.getAllSettings();

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

  // LLM processing
  ipcMain.handle(IPC_CHANNELS.LLM_CANCEL, (event) => {
    assertTrustedIpc(event);
    llmAbortController?.abort();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.LLM_PROCESS, async (event, options) => {
    assertTrustedIpc(event);
    if (llmRequestInFlight) return { success: false, error: '已有任务正在处理，请稍候' };
    const requestStartedAt = Date.now();
    const request = validateProcessOptions(options);
    const settings = store.getAllSettings();
    const captureEnvelope = createCaptureEnvelope({
      text: request.text,
      sourceKind: request.source,
      capture: request.capture,
    });
    llmRequestInFlight = true;
    llmAbortController = new AbortController();
    try {
      const llmResponse = await LLMService.processText({
        ...request,
        captureEnvelope,
        backend: settings.activeBackend,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        signal: llmAbortController.signal,
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
      });
      return {
        success: true,
        brief: actionBriefResponse.brief,
        text: llmResponse.result,
        source: {
          text: captureEnvelope.rawText,
          kind: captureEnvelope.sourceKind,
          capturedAt: captureEnvelope.capturedAt,
          ocr: captureEnvelope.ocr,
        },
        verificationSummary: actionBriefResponse.verificationSummary,
        processingTimeMs: Date.now() - requestStartedAt,
      };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      llmRequestInFlight = false;
      llmAbortController = null;
    }
  });

  // Screenshot capture flow: capture region -> OCR -> LLM
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async (event) => {
    assertTrustedIpc(event);
    let imagePath = null;
    try {
      // 1. Capture region
      imagePath = await ScreenshotService.captureSelectedRegion().catch(err => {
        // User cancelled — return a special result so the renderer can distinguish
        if (err.isCancellation) {
          return { cancelled: true };
        }
        throw err;
      });
      if (imagePath.cancelled) {
        return { success: false, cancelled: true };
      }
      if (!imagePath) {
        return { success: false, error: OCR_FAILURE_MESSAGE };
      }

      // 2. OCR
      const ocrResult = await OCRService.performOCR(imagePath);

      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        return { success: false, error: OCR_FAILURE_MESSAGE };
      }

      return {
        success: true,
        text: ocrResult.text,
        confidence: ocrResult.confidence,
        blocks: ocrResult.blocks,
      };
    } catch (error) {
      console.error('[ScreenshotCapture] Error:', error.message);
      return { success: false, error: '截图或文字识别失败，请检查屏幕录制权限后重试' };
    } finally {
      if (typeof imagePath === 'string') {
        try { fs.unlinkSync(imagePath); } catch (_) { /* cleanup failure is non-fatal */ }
      }
    }
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
  unregisterAll();
  ScreenshotService.cleanup();
  OCRService.cleanup();
});
