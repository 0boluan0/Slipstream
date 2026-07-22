const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEMP_DIR = path.join(os.tmpdir(), `slipstream-${process.getuid?.() ?? 'user'}`, 'screenshots');

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(TEMP_DIR, 0o700);
}

function getTempDir() {
  ensureTempDir();
  return TEMP_DIR;
}

function outputPath() {
  return path.join(getTempDir(), `screenshot-${crypto.randomUUID()}.png`);
}

function cancelError() {
  const error = new Error('Capture cancelled by user');
  error.isCancellation = true;
  return error;
}

function captureRegion(outPath) {
  return new Promise((resolve, reject) => {
    const filePath = outPath || outputPath();
    execFile('/usr/sbin/screencapture', ['-i', '-x', '-t', 'png', filePath], { timeout: 30000 }, (error) => {
      if (error) {
        try { fs.unlinkSync(filePath); } catch (_) { /* nothing to clean */ }
        if (error.code === 1) return reject(cancelError());
        return reject(new Error(`screencapture failed: ${error.message}`));
      }
      resolve(filePath);
    });
  });
}

function cleanup() {
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

module.exports = {
  captureRegion,
  captureSelectedRegion: captureRegion,
  cleanup,
  getTempDir,
};
