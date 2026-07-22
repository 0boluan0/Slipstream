const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronBinary = require('electron');
const checkScript = path.join(__dirname, 'check-history.js');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-history-'));

try {
  for (const phase of ['write', 'read']) {
    const result = spawnSync(electronBinary, [checkScript, phase, tempDirectory], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exitCode = result.status || 1;
    if (process.exitCode) break;
  }
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
