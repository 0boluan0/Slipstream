const { clipboard } = require('electron');
const { createHash } = require('crypto');
const { DEFAULTS } = require('../shared/constants.cjs');

class ClipboardMonitor {
  constructor() {
    this._intervalId = null;
    this._lastFingerprint = '';
    this._callback = null;
    this._suppressedFingerprint = null;
    this._suppressedUntil = 0;
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
    this._lastFingerprint = fingerprint(clipboard.readText());

    this._intervalId = setInterval(() => {
      try {
        const currentText = clipboard.readText();
        const currentFingerprint = fingerprint(currentText);

        if (currentText && currentFingerprint !== this._lastFingerprint) {
          this._lastFingerprint = currentFingerprint;
          if (currentFingerprint === this._suppressedFingerprint && Date.now() <= this._suppressedUntil) {
            this._suppressedFingerprint = null;
            this._suppressedUntil = 0;
            return;
          }
          this._suppressedFingerprint = null;
          this._suppressedUntil = 0;
          const maxLen = DEFAULTS.MAX_TEXT_LENGTH;

          if (currentText.length > maxLen) {
            // Check if the text was truncated identically before — skip if same
            const trimmed = currentText.slice(0, maxLen);
            if (trimmed === this._lastSentText) return;
            this._lastSentText = trimmed;
            if (this._callback) {
              this._callback({
                text: trimmed,
                truncated: true,
                originalLength: currentText.length,
              });
            }
          } else {
            this._lastSentText = null;
            if (this._callback) {
              this._callback({
                text: currentText,
                truncated: false,
                originalLength: currentText.length,
              });
            }
          }
        }
      } catch (err) {
        console.error('[ClipboardMonitor] Error polling clipboard:', err);
      }
    }, DEFAULTS.CLIPBOARD_POLL_INTERVAL);

    // Duplicate clipboard detection: avoid re-triggering on identical text
    this._lastSentText = null;
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

  suppressNextText(text) {
    this._suppressedFingerprint = fingerprint(text);
    this._suppressedUntil = Date.now() + (DEFAULTS.CLIPBOARD_POLL_INTERVAL * 2);
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

function fingerprint(text) {
  return createHash('sha256').update(text || '').digest('hex');
}

module.exports = ClipboardMonitor;
