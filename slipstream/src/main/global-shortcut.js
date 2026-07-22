const { clipboard, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS } = require('../shared/constants.cjs');
const screenshotService = require('./screenshot-service');
const ocrService = require('./ocr-service');

const OCR_FAILURE_MESSAGE = '没有识别到清晰文字';

/**
 * Register the application's global keyboard shortcuts.
 * @param {BrowserWindow} mainWindow - The main BrowserWindow to control.
 * @param {object} settings - User settings containing shortcut accelerators.
 */
function registerShortcuts(mainWindow, settings = {}) {
  const clipboardShortcut = (settings.clipboardShortcut || 'Alt+C').trim();
  const screenshotShortcut = (settings.screenshotShortcut || 'F2').trim();

  const sendShortcutError = (shortcut) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, {
      error: `快捷键冲突：${shortcut}，请在设置里修改`,
    });
  };

  const sendText = (text, source, extra = {}) => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, { text, source, ...extra });
  };

  const clipboardRegistered = globalShortcut.register(clipboardShortcut, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const text = clipboard.readText().trim();
    if (!text) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, {
        text: '',
        source: 'shortcut',
        error: '剪贴板里没有可解释的文本',
      });
      return;
    }

    sendText(text, 'shortcut');
  });

  if (!clipboardRegistered) {
    console.warn(`[GlobalShortcut] Failed to register ${clipboardShortcut} shortcut (may be taken by another app).`);
    sendShortcutError(clipboardShortcut);
  }

  // Screenshot capture — the user's primary OCR workflow trigger
  const screenshotRegistered = globalShortcut.register(screenshotShortcut, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const outputPath = path.join(screenshotService.getTempDir(), `screenshot-${Date.now()}.png`);

    try {
      await screenshotService.captureSelectedRegion(outputPath);
      const ocrResult = await ocrService.performOCR(outputPath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!ocrResult.text || !ocrResult.text.trim()) {
          mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, { error: OCR_FAILURE_MESSAGE });
          return;
        }
        sendText(ocrResult.text, 'ocr', {
          confidence: ocrResult.confidence,
          blocks: ocrResult.blocks,
        });
      }
    } catch (err) {
      // User pressed Escape — not an error, just silently return
      if (err.isCancellation) {
        return;
      }
      console.error('[GlobalShortcut] Screenshot error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        const msg = err.message || OCR_FAILURE_MESSAGE;
        mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, { error: msg });
      }
    } finally {
      // Clean up temporary file
      try { fs.unlinkSync(outputPath); } catch (_) { /* cleanup failure is non-fatal */ }
    }
  });

  if (!screenshotRegistered) {
    console.warn(`[GlobalShortcut] Failed to register ${screenshotShortcut} shortcut (may be taken by another app).`);
    sendShortcutError(screenshotShortcut);
  }

  return clipboardRegistered && screenshotRegistered;
}

/**
 * Unregister all global shortcuts.
 */
function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = {
  registerShortcuts,
  unregisterAll,
};
