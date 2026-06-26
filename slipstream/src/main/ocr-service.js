const { execFile } = require('child_process');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const OCR_SCRIPT = path.join(APP_ROOT, 'scripts', 'ocr-swift-runner.sh');

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
function performOCR(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(OCR_SCRIPT, [imagePath], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        // Try to parse stderr for a JSON error message
        try {
          const errData = JSON.parse(stderr.trim());
          if (errData && errData.error) {
            return reject(new Error(errData.error));
          }
        } catch (_) {
          // stderr isn't JSON, fall through
        }
        return reject(new Error(`OCR script failed: ${error.message}`));
      }

      try {
        const result = JSON.parse(stdout.trim());

        if (result.error) {
          return reject(new Error(result.error));
        }

        resolve({
          text: cleanOcrText(result.text || ''),
          confidence: result.confidence || 0,
          blocks: result.blocks || [],
        });
      } catch (parseError) {
        reject(new Error(`Failed to parse OCR output: ${parseError.message}`));
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
