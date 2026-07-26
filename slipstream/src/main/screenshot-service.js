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

function captureRegion(outPath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const filePath = outPath || outputPath();
    let settled = false;
    let child;
    const cleanupFile = () => {
      try { fs.unlinkSync(filePath); } catch (_) { /* nothing to clean */ }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      child?.kill('SIGTERM');
      cleanupFile();
      finish(reject, cancelError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    child = execFile('/usr/sbin/screencapture', ['-i', '-x', '-t', 'png', filePath], { timeout: 30000 }, (error) => {
      if (error) {
        cleanupFile();
        if (signal?.aborted || error.code === 1) return finish(reject, cancelError());
        return finish(reject, new Error(`screencapture failed: ${error.message}`));
      }
      finish(resolve, filePath);
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
