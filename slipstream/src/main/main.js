const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const { registerShortcuts, unregisterAll } = require('./global-shortcut');
const ScreenshotService = require('./screenshot-service');
const OCRService = require('./ocr-service');
const ClipboardMonitor = require('./clipboard-monitor');
const LLMService = require('./llm-service');
const { redactSettingsForRenderer } = require('./safe-settings');
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
const isDev = !app.isPackaged;

function getSafeSettings() {
  return redactSettingsForRenderer(store.getAllSettings());
}

// --------------- Window ---------------

function createMainWindow() {
  const settings = store.getAllSettings();

  const windowOptions = {
    width: settings.windowWidth || DEFAULTS.WINDOW_WIDTH,
    height: settings.windowHeight || DEFAULTS.WINDOW_HEIGHT,
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
      sandbox: false,
    },
  };

  // Apply vibrancy on macOS
  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'hudWindow';
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Restore saved position; place at bottom-right of primary display by default
  if (settings.windowX !== null && settings.windowY !== null) {
    mainWindow.setPosition(settings.windowX, settings.windowY);
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
    mainWindow.loadURL('http://localhost:5173');
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

  // Save window position on move
  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition();
      store.setSetting('windowX', x);
      store.setSetting('windowY', y);
    }
  });

  // Save window size on resize
  mainWindow.on('resized', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [width, height] = mainWindow.getSize();
      store.setSetting('windowWidth', width);
      store.setSetting('windowHeight', height);
    }
  });

  // Open DevTools in dev mode
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
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
      label: 'Show/Hide',
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
      label: 'Quit',
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
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => getSafeSettings());

  ipcMain.handle(IPC_CHANNELS.TERMS_GET, () => store.getSavedTerms());

  ipcMain.handle(IPC_CHANNELS.TERMS_SAVE, (_event, term) => store.addSavedTerm(term));

  // Settings: set
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, key, value) => {
    store.setSetting(key, value);

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

    if (key === 'clipboardShortcut' || key === 'screenshotShortcut') {
      unregisterAll();
      registerShortcuts(mainWindow, store.getAllSettings());
    }

    return true;
  });

  // LLM processing
  ipcMain.handle(IPC_CHANNELS.LLM_PROCESS, async (_event, options) => {
    try {
      const llmResponse = await LLMService.processText(options);
      store.addExplanationHistory({
        sourceText: options?.text,
        explanation: llmResponse.result,
        backend: options?.backend,
        model: options?.model,
        source: options?.source,
      });
      return { success: true, text: llmResponse.result, processingTimeMs: llmResponse.processingTimeMs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Screenshot capture flow: capture region -> OCR -> LLM
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async () => {
    try {
      // 1. Capture region
      const imagePath = await ScreenshotService.captureRegion().catch(err => {
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
        // Clean up the screenshot
        try { fs.unlinkSync(imagePath); } catch (_) { /* cleanup failure is non-fatal */ }
        return { success: false, error: OCR_FAILURE_MESSAGE };
      }

      // 3. Send OCR text to renderer — renderer handles auto-processing via triggerProcessing()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, { text: ocrResult.text, source: 'ocr' });
      }

      // Clean up the screenshot
      try { fs.unlinkSync(imagePath); } catch (_) { /* cleanup failure is non-fatal */ }

      return { success: true, text: ocrResult.text };
    } catch (error) {
      console.error('[ScreenshotCapture] Error:', error.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, { error: OCR_FAILURE_MESSAGE });
      }
      return { success: false, error: OCR_FAILURE_MESSAGE };
    }
  });
}

// --------------- App Lifecycle ---------------

app.isQuitting = false;

app.on('ready', () => {
  createMainWindow();
  createTray();
  registerShortcuts(mainWindow, store.getAllSettings());
  registerIpcHandlers();

  if (store.getSettings('clipboardMonitoring') !== false) {
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
