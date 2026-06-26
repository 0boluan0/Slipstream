const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMP_DIR = path.join(os.tmpdir(), 'slipstream-screenshots');

/**
 * Ensure the temp directory exists.
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function getTempDir() {
  ensureTempDir();
  return TEMP_DIR;
}

/**
 * Generate a unique output path for a screenshot.
 * @returns {string}
 */
function outputPath() {
  ensureTempDir();
  return path.join(TEMP_DIR, `screenshot-${Date.now()}.png`);
}

/**
 * Capture a user-selected screen region.
 * Runs `screencapture -i -x -t png <path>` for interactive region selection.
 * @param {string} [outPath] - Optional output path; generated if omitted.
 * @returns {Promise<string>} Resolves with the path to the captured screenshot.
 */
function captureRegion(outPath) {
  return new Promise((resolve, reject) => {
    const filePath = outPath || outputPath();
    execFile('/usr/sbin/screencapture', ['-i', '-x', '-t', 'png', filePath], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        // The user cancelled the selection by pressing Escape; return a
        // structured error so callers can distinguish cancel from failure.
        if (error.code === 1 && !stderr) {
          const cancelError = new Error('Capture cancelled by user');
          cancelError.isCancellation = true;
          return reject(cancelError);
        }
        return reject(new Error(`screencapture failed: ${error.message}`));
      }
      resolve(filePath);
    });
  });
}

/**
 * Remove all temporary screenshot files.
 */
function cleanup() {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      } catch (_) {
        // ignore individual file deletion errors
      }
    }
    try {
      fs.rmdirSync(TEMP_DIR);
    } catch (_) {
      // ignore
    }
  }
}

module.exports = {
  captureRegion,
  cleanup,
  getTempDir,
};
