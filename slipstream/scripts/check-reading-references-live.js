'use strict';

// Use the signed preview's own Keychain identity. Credentials never leave it.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('./check-reading-preview-identity');
const appArg = process.argv.find((arg) => arg.startsWith('--app='));
if (!appArg || !path.isAbsolute(appArg.slice(6))) throw new Error('Specify the signed reading preview: --app=/absolute/path/Slipstream 阅读预览.app');
const preview = appArg.slice(6);
check(preview);
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = outputArg ? path.resolve(outputArg.slice(9)) : fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reference-live-'));
const child = spawn(path.join(preview, 'Contents/MacOS/Slipstream'),
  ['--reading-check', '--reading-check-references', `--reading-check-output=${output}`], { stdio: 'inherit' });
child.on('error', () => { console.error('Could not start the signed reading preview.'); process.exitCode = 1; });
child.on('close', (code) => { console.log(`Reference evidence: ${output}`); process.exitCode = code === 0 ? 0 : 1; });
