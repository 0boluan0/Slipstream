const { execFile } = require('child_process');
const { app } = require('electron');
const path = require('path');
const { createOcrEnvironment } = require('./ocr-environment');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const OCR_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'ocr-swift-runner.sh')
  : path.join(APP_ROOT, 'scripts', 'ocr-swift-runner.sh');

/**
 * Clean raw OCR text by normalizing whitespace and removing garbage.
 * @param {string} rawText
 * @returns {string}
 */
function cleanOcrText(rawText) {
  if (!rawText) return '';
  return rawText
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // remove control chars
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines
    .replace(/\s{2,}/g, ' ') // collapse multiple spaces
    .replace(/[=]{3,}/g, ''); // remove === separators
}

/**
 * Perform OCR on the given image file using the Swift Vision script.
 * @param {string} imagePath - Absolute path to the image file.
 * @returns {Promise<{text: string, confidence: number, blocks: Array}>}
 */
function performOCR(imagePath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const cacheDir = path.join(app.getPath('userData'), 'ocr-cache');
    let settled = false;
    let child;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      child?.kill('SIGTERM');
      const error = new Error('OCR cancelled by user');
      error.isCancellation = true;
      finish(reject, error);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    let environment;
    try {
      environment = createOcrEnvironment(cacheDir);
    } catch (error) {
      finish(reject, error);
      return;
    }
    child = execFile('/bin/bash', [OCR_SCRIPT, imagePath], {
      timeout: 15000,
      env: environment,
    }, (error, stdout, stderr) => {
      if (error) {
        if (signal?.aborted) {
          const cancellation = new Error('OCR cancelled by user');
          cancellation.isCancellation = true;
          return finish(reject, cancellation);
        }
        // Swift prints structured errors to stdout; shell/compiler errors usually use stderr.
        try {
          const errData = JSON.parse((stdout || stderr).trim());
          if (errData && errData.error) {
            return finish(reject, new Error(errData.error));
          }
        } catch (_) {
          // stderr isn't JSON, fall through
        }
        return finish(reject, new Error(`OCR script failed: ${error.message}`));
      }

      try {
        const result = JSON.parse(stdout.trim());

        if (result.error) {
          return finish(reject, new Error(result.error));
        }

        finish(resolve, {
          text: cleanOcrText(result.text || ''),
          confidence: result.confidence || 0,
          blocks: result.blocks || [],
        });
      } catch (parseError) {
        finish(reject, new Error(`Failed to parse OCR output: ${parseError.message}`));
      }
    });
  });
}

/**
 * Cleanup any resources held by the OCR service.
 * Currently a no-op but provided for interface consistency.
 */
function cleanup() {
  // No resources to clean up at this time.
}

module.exports = {
  performOCR,
  cleanup,
};
