'use strict';

// Run an evaluation file through the signed reading preview, which uses its own
// Keychain identity and configured service; credentials never leave that app.
//   npm run eval -- --app="/abs/Slipstream 阅读预览.app" --cases=eval/dev/lookups.json
//   npm run eval -- --app=... --cases=/abs/heldout/cases.sealed.json --key-file=/abs/heldout.key
// Optional: --output=DIR --repetitions=1..5 --case=ID
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('./check-reading-preview-identity');

function option(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
}

const preview = option('app');
if (!preview || !path.isAbsolute(preview)) throw new Error('Specify the signed reading preview: --app=/absolute/path/Slipstream 阅读预览.app');
check(preview);
const cases = option('cases');
if (!cases) throw new Error('Specify an evaluation file: --cases=eval/dev/lookups.json');
const keyFile = option('key-file');
if (keyFile && !path.isAbsolute(keyFile)) throw new Error('Pass the held-out key file as an absolute path outside protected folders.');
const output = option('output') ? path.resolve(option('output')) : fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-eval-'));
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
// The app reads its own private copy, so files under Desktop or Documents do not
// trigger a folder-access prompt for the preview identity.
const staged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-eval-input-')), path.basename(cases));
fs.copyFileSync(path.resolve(cases), staged);
const args = ['--reading-check', `--reading-check-output=${output}`, `--reading-eval=${staged}`];
if (keyFile) args.push(`--reading-eval-key-file=${keyFile}`);
for (const name of ['repetitions', 'case']) if (option(name)) args.push(`--reading-eval-${name}=${option(name)}`);
const child = spawn(path.join(preview, 'Contents/MacOS/Slipstream'), args, { stdio: 'inherit' });
child.on('error', () => { console.error('Could not start the signed reading preview.'); process.exitCode = 1; });
child.on('close', (code) => {
  fs.rmSync(path.dirname(staged), { recursive: true, force: true });
  console.log(`Evaluation output: ${output}`);
  process.exitCode = code === 0 ? 0 : 1;
});
