const { clipboard, globalShortcut } = require('electron');
const { DEFAULTS, IPC_CHANNELS } = require('../shared/constants.cjs');
const { analyzeShortcutAccelerator } = require('../shared/shortcut-accelerator.cjs');

function createClipboardPayload(value) {
  const sourceText = typeof value === 'string' ? value : '';
  const originalLength = sourceText.length;
  const truncated = originalLength > DEFAULTS.MAX_TEXT_LENGTH;
  let text = truncated ? sourceText.slice(0, DEFAULTS.MAX_TEXT_LENGTH) : sourceText;
  const finalCodeUnit = text.charCodeAt(text.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) text = text.slice(0, -1);
  return { text, truncated, originalLength };
}

function createShortcutRegistrationStatus(settings = {}, registration = {}) {
  const clipboardShortcut = (settings.clipboardShortcut || DEFAULTS.CLIPBOARD_SHORTCUT).trim();
  const screenshotShortcut = (settings.screenshotShortcut || DEFAULTS.SCREENSHOT_SHORTCUT).trim();
  const clipboardRegistered = registration.clipboardRegistered === true;
  const screenshotRegistered = registration.screenshotRegistered === true;
  const clipboardReason = clipboardRegistered
    ? null
    : ['conflict', 'invalid', 'reserved'].includes(registration.clipboardReason)
      ? registration.clipboardReason
      : null;
  const screenshotReason = screenshotRegistered
    ? null
    : ['conflict', 'invalid', 'reserved'].includes(registration.screenshotReason)
      ? registration.screenshotReason
      : null;
  return {
    allRegistered: clipboardRegistered && screenshotRegistered,
    clipboard: {
      accelerator: clipboardShortcut,
      registered: clipboardRegistered,
      reason: clipboardReason,
    },
    screenshot: {
      accelerator: screenshotShortcut,
      registered: screenshotRegistered,
      reason: screenshotReason,
    },
  };
}

function tryRegister(accelerator, callback) {
  const analysis = analyzeShortcutAccelerator(accelerator);
  if (!analysis.ok) {
    return {
      registered: false,
      reason: analysis.reason === 'reserved-app-quit' ? 'reserved' : 'invalid',
    };
  }
  try {
    const registered = globalShortcut.register(analysis.accelerator, callback) === true;
    return { registered, reason: registered ? null : 'conflict' };
  } catch {
    return { registered: false, reason: 'invalid' };
  }
}

/**
 * Register the application's global keyboard shortcuts.
 * @param {function(object): void} dispatchCapture - Main-owned capture dispatcher.
 * @param {object} settings - User settings containing shortcut accelerators.
 */
function registerShortcuts(dispatchCapture, settings = {}) {
  if (typeof dispatchCapture !== 'function') {
    throw new TypeError('Capture dispatcher is required to register global shortcuts');
  }
  const clipboardShortcut = (settings.clipboardShortcut || DEFAULTS.CLIPBOARD_SHORTCUT).trim();
  const screenshotShortcut = (settings.screenshotShortcut || DEFAULTS.SCREENSHOT_SHORTCUT).trim();

  const sendText = (text, source, extra = {}) => {
    dispatchCapture({
      channel: IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
      payload: { text, source, ...extra },
    });
  };

  const clipboardRegistration = tryRegister(clipboardShortcut, () => {
    const payload = createClipboardPayload(clipboard.readText());
    if (!payload.text.trim()) {
      dispatchCapture({
        channel: IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
        payload: {
          text: '',
          source: 'shortcut',
          error: '剪贴板里没有可解释的文本',
        },
      });
      return;
    }

    sendText(payload.text, 'shortcut', {
      truncated: payload.truncated,
      originalLength: payload.originalLength,
    });
  });

  if (!clipboardRegistration.registered) {
    const reason = clipboardRegistration.reason === 'reserved'
      ? 'reserved for safe application quit'
      : clipboardRegistration.reason === 'invalid'
        ? 'invalid accelerator'
        : 'may be taken by another app';
    console.warn(`[GlobalShortcut] Failed to register ${clipboardShortcut} shortcut (${reason}).`);
  }

  // Delegate to the renderer so the global shortcut and visible button share one guarded IPC task.
  const screenshotRegistration = tryRegister(screenshotShortcut, () => {
    dispatchCapture({
      channel: IPC_CHANNELS.SCREENSHOT_REQUESTED,
      payload: { source: 'shortcut' },
    });
  });

  if (!screenshotRegistration.registered) {
    const reason = screenshotRegistration.reason === 'reserved'
      ? 'reserved for safe application quit'
      : screenshotRegistration.reason === 'invalid'
        ? 'invalid accelerator'
        : 'may be taken by another app';
    console.warn(`[GlobalShortcut] Failed to register ${screenshotShortcut} shortcut (${reason}).`);
  }

  return createShortcutRegistrationStatus(settings, {
    clipboardRegistered: clipboardRegistration.registered,
    clipboardReason: clipboardRegistration.reason,
    screenshotRegistered: screenshotRegistration.registered,
    screenshotReason: screenshotRegistration.reason,
  });
}

/**
 * Unregister all global shortcuts.
 */
function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = {
  createClipboardPayload,
  createShortcutRegistrationStatus,
  registerShortcuts,
  unregisterAll,
};
