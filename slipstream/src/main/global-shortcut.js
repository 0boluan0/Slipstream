const { clipboard, globalShortcut } = require('electron');
const { DEFAULTS, IPC_CHANNELS } = require('../shared/constants.cjs');

function createClipboardPayload(value) {
  const sourceText = typeof value === 'string' ? value : '';
  const originalLength = sourceText.length;
  const truncated = originalLength > DEFAULTS.MAX_TEXT_LENGTH;
  let text = truncated ? sourceText.slice(0, DEFAULTS.MAX_TEXT_LENGTH) : sourceText;
  const finalCodeUnit = text.charCodeAt(text.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) text = text.slice(0, -1);
  return { text, truncated, originalLength };
}

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

    const payload = createClipboardPayload(clipboard.readText());
    if (!payload.text.trim()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, {
        text: '',
        source: 'shortcut',
        error: '剪贴板里没有可解释的文本',
      });
      return;
    }

    sendText(payload.text, 'shortcut', {
      truncated: payload.truncated,
      originalLength: payload.originalLength,
    });
  });

  if (!clipboardRegistered) {
    console.warn(`[GlobalShortcut] Failed to register ${clipboardShortcut} shortcut (may be taken by another app).`);
    sendShortcutError(clipboardShortcut);
  }

  // Delegate to the renderer so F2 and the visible button share one guarded IPC task.
  const screenshotRegistered = globalShortcut.register(screenshotShortcut, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IPC_CHANNELS.SCREENSHOT_REQUESTED, { source: 'shortcut' });
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
  createClipboardPayload,
  registerShortcuts,
  unregisterAll,
};
