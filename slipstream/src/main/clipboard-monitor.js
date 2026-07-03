const { clipboard } = require('electron');
const { DEFAULTS } = require('../shared/constants.cjs');

class ClipboardMonitor {
  constructor() {
    this._intervalId = null;
    this._lastText = '';
    this._callback = null;
  }

  /**
   * Start polling the clipboard for text changes.
   * @param {function(string): void} callback - Called with the new text when it changes.
   */
  startMonitoring(callback) {
    if (this._intervalId) {
      return; // Already monitoring
    }

    this._callback = callback;
    this._lastText = clipboard.readText();

    this._intervalId = setInterval(() => {
      try {
        const currentText = clipboard.readText();

        if (currentText && currentText !== this._lastText) {
          this._lastText = currentText;

          const maxLen = DEFAULTS.MAX_TEXT_LENGTH;
          const trimmed = currentText.length > maxLen
            ? currentText.slice(0, maxLen)
            : currentText;

          if (this._callback) {
            this._callback({
              text: trimmed,
              truncated: currentText.length > maxLen,
              originalLength: currentText.length,
            });
          }
        }
      } catch (err) {
        console.error('[ClipboardMonitor] Error polling clipboard:', err);
      }
    }, DEFAULTS.CLIPBOARD_POLL_INTERVAL);
  }

  /**
   * Stop monitoring the clipboard.
   */
  stopMonitoring() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._callback = null;
  }

  /**
   * Get the current clipboard text.
   * @returns {string}
   */
  getCurrentText() {
    return clipboard.readText();
  }

  /**
   * Whether the monitor is currently active.
   * @returns {boolean}
   */
  get isMonitoring() {
    return this._intervalId !== null;
  }
}

module.exports = ClipboardMonitor;
