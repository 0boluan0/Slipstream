'use strict';

// Keep cleanup outside Electron: Chromium holds profile files until it exits on Windows.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-home-'));
const child = spawn(require('electron'), [
  path.join(__dirname, 'check-reading-home-native.js'), ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: { ...process.env, SLIPSTREAM_READING_HOME_WORK: work },
});
let failed = false;
child.on('error', (error) => { failed = true; console.error(error); });
child.on('close', (code) => {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  } catch (error) {
    failed = true;
    console.error(`Could not clean reading test directory: ${work}`, error);
  }
  process.exitCode = failed || code !== 0 ? 1 : 0;
});
