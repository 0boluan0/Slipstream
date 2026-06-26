const { globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS } = require('../shared/constants');
const screenshotService = require('./screenshot-service');
const ocrService = require('./ocr-service');

/**
 * Register the application's global keyboard shortcuts.
 * @param {BrowserWindow} mainWindow - The main BrowserWindow to control.
 */
function registerShortcuts(mainWindow) {
  // Screenshot capture with F2 — the user's primary workflow trigger
  const screenshotRegistered = globalShortcut.register('F2', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.show();
    mainWindow.focus();

    const outputPath = path.join(screenshotService.getTempDir(), `screenshot-${Date.now()}.png`);

    try {
      await screenshotService.captureRegion(outputPath);
      const ocrResult = await ocrService.performOCR(outputPath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, ocrResult.text);
      }
    } catch (err) {
      // User pressed Escape — not an error, just silently return
      if (err.isCancellation) {
        return;
      }
      console.error('[GlobalShortcut] Screenshot error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.OCR_ERROR, { error: err.message });
      }
    } finally {
      // Clean up temporary file
      try { fs.unlinkSync(outputPath); } catch (_) { /* cleanup failure is non-fatal */ }
    }
  });

  if (!screenshotRegistered) {
    console.warn('[GlobalShortcut] Failed to register F2 shortcut (may be taken by another app).');
  }
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
