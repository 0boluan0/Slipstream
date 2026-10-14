'use strict';

// Seal held-out evaluation bundles so agents that fix bugs cannot read them by
// accident. Commands:
//   node scripts/eval-seal.js new-key <key-file>
//   node scripts/eval-seal.js seal <bundle.json> <sealed.json> --key-file=<key-file>
//   node scripts/eval-seal.js verify <sealed.json> --key-file=<key-file>   (counts only)
//   node scripts/eval-seal.js unseal <sealed.json> --key-file=<key-file>   (graders only; prints JSON)
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { BUNDLE_FORMAT, loadEvalFile, readPassphrase, sealEval, unsealEval } = require('../src/main/reading-eval');

const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter((arg) => !arg.startsWith('--'));
const keyFile = rest.find((arg) => arg.startsWith('--key-file='))?.slice('--key-file='.length);

function requireKey() {
  if (!keyFile) throw new Error('Pass --key-file=<path>.');
  return readPassphrase(keyFile);
}

if (command === 'new-key' && positional[0]) {
  const target = path.resolve(positional[0]);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${crypto.randomBytes(32).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Created key ${target}. Keep it away from the repository; move it off this Mac for a strict seal.`);
} else if (command === 'seal' && positional.length === 2) {
  const bundle = JSON.parse(fs.readFileSync(positional[0], 'utf8'));
  if (bundle.format !== BUNDLE_FORMAT) throw new Error(`Expected ${BUNDLE_FORMAT}.`);
  const sealed = sealEval(JSON.stringify(bundle), requireKey());
  fs.writeFileSync(positional[1], JSON.stringify(sealed) + '\n', { flag: 'wx', mode: 0o600 });
  const loaded = loadEvalFile(positional[1], { keyFile });
  console.log(`Sealed ${loaded.suites.reduce((sum, suite) => sum + suite.cases.length, 0)} cases into ${positional[1]}.`);
} else if (command === 'verify' && positional.length === 1) {
  const loaded = loadEvalFile(positional[0], { keyFile });
  console.log(JSON.stringify(Object.fromEntries(loaded.suites.map(({ suite, cases }) => [suite, cases.length]))));
} else if (command === 'unseal' && positional.length === 1) {
  process.stdout.write(unsealEval(JSON.parse(fs.readFileSync(positional[0], 'utf8')), requireKey()) + '\n');
} else {
  console.error('Usage: eval-seal.js new-key <key> | seal <bundle> <sealed> --key-file=<key> | verify <sealed> --key-file=<key> | unseal <sealed> --key-file=<key>');
  process.exitCode = 2;
}
