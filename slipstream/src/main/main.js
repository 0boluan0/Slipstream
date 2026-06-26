const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const { registerShortcuts, unregisterAll } = require('./global-shortcut');
const ScreenshotService = require('./screenshot-service');
const OCRService = require('./ocr-service');
const ClipboardMonitor = require('./clipboard-monitor');
const LLMService = require('./llm-service');
const {
  IPC_CHANNELS,
  DEFAULTS,
  APP_NAME,
} = require('../shared/constants');

// --------------- State ---------------

let mainWindow = null;
let tray = null;
let clipboardMonitor = null;
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

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
    const displays = require('electron').screen.getPrimaryDisplay();
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
  // Create a tray icon using a system template image on macOS so it
  // adapts to light/dark menu bars. Fall back to an empty icon otherwise.
  let icon;

  if (process.platform === 'darwin') {
    // 'NSStatusItem' or 'NSPreferencesGeneral' are system template images
    icon = nativeImage.createFromNamedImage('NSStatusItem');
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromNamedImage('NSPreferencesGeneral');
    }
  }

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

  tray.setContextMenu(contextMenu);

  // Left-click (or click on non-macOS) toggles window
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
}

// --------------- Clipboard Monitor ---------------

function startClipboardMonitoring() {
  clipboardMonitor = new ClipboardMonitor();

  clipboardMonitor.startMonitoring((text) => {
    if (mainWindow && !mainWindow.isDestroyed() && text) {
      mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, text);
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
  // Settings: get
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, key) => {
    if (key !== undefined) {
      return store.getSettings(key);
    }
    return store.getAllSettings();
  });

  // Settings: set
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, key, value) => {
    store.setSetting(key, value);
    return true;
  });

  // LLM processing
  ipcMain.handle(IPC_CHANNELS.LLM_PROCESS, async (_event, options) => {
    try {
      const llmResponse = await LLMService.processText(options);
      return { success: true, text: llmResponse.result, processingTimeMs: llmResponse.processingTimeMs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Screenshot capture flow: capture region -> OCR -> LLM
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async () => {
    try {
      // 1. Capture region
      const imagePath = await ScreenshotService.captureRegion();
      if (!imagePath) {
        return { success: false, error: 'Capture cancelled' };
      }

      // 2. OCR
      const ocrResult = await OCRService.performOCR(imagePath);

      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        // Clean up the screenshot
        try { fs.unlinkSync(imagePath); } catch (_) {}
        return { success: false, error: 'No text found in the selected region' };
      }

      // 3. Send text to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, ocrResult.text);

        // 4. Auto-process through LLM
        try {
          const settings = store.getAllSettings();
          const llmResult = await LLMService.processText({
            text: ocrResult.text,
            backend: settings.activeBackend,
            model: settings.activeModel,
            promptTemplate: settings.customPrompt,
            languageHint: settings.languageHint,
          });

          mainWindow.webContents.send(IPC_CHANNELS.LLM_RESULT, {
            text: llmResult.result,
            processingTimeMs: llmResult.processingTimeMs,
          });
        } catch (llmError) {
          mainWindow.webContents.send(IPC_CHANNELS.LLM_ERROR, {
            text: ocrResult.text,
            error: llmError.message,
          });
        }
      }

      // Clean up the screenshot
      try { fs.unlinkSync(imagePath); } catch (_) {}

      return { success: true, text: ocrResult.text };
    } catch (error) {
      console.error('[ScreenshotCapture] Error:', error.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, { error: error.message });
      }
      return { success: false, error: error.message };
    }
  });

  // Window: hide
  ipcMain.on(IPC_CHANNELS.WINDOW_HIDE, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  // Window: show
  ipcMain.on(IPC_CHANNELS.WINDOW_SHOW, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// --------------- App Lifecycle ---------------

app.isQuitting = false;

app.on('ready', () => {
  createMainWindow();
  createTray();
  registerShortcuts(mainWindow);
  registerIpcHandlers();

  if (store.getSettings('clipboardMonitoring') !== false) {
    startClipboardMonitoring();
  }

  // Send initial settings to renderer once ready
  mainWindow.webContents.on('did-finish-load', () => {
    const settings = store.getAllSettings();
    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_LOADED, settings);
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

app.on('will-quit', () => {
  unregisterAll();
});

// --------------- Exports ---------------

/**
 * Get the main BrowserWindow instance.
 * @returns {BrowserWindow|null}
 */
function getMainWindow() {
  return mainWindow;
}

module.exports = { getMainWindow };
