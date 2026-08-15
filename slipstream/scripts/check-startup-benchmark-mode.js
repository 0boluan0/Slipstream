const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const forbiddenRuntimeFiles = [
  'src/main/startup-benchmark-mode.js',
  'src/main/startup-benchmark-runner.js',
  'scripts/measure-packaged-startup.js',
];
const forbiddenActivationTokens = [
  '--startup-benchmark',
  'SLIPSTREAM_STARTUP_BENCHMARK_',
  'startup-benchmark-mode',
  'startup-benchmark-runner',
];

for (const relativePath of forbiddenRuntimeFiles) {
  assert.equal(
    fs.existsSync(path.join(projectRoot, relativePath)),
    false,
    `unsafe packaged startup benchmark runtime must remain absent: ${relativePath}`,
  );
}

const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
for (const token of forbiddenActivationTokens) {
  assert.equal(
    mainSource.includes(token),
    false,
    `formal app main must not contain a packaged benchmark activation token: ${token}`,
  );
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
assert.equal(
  Object.prototype.hasOwnProperty.call(packageJson.scripts, 'measure:packaged-startup'),
  false,
  'package scripts must not expose an unproven packaged startup measurement entry',
);
assert.match(
  packageJson.scripts.test,
  /check:startup-benchmark-mode/,
  'the disabled-integration regression gate must stay in the full test suite',
);

const packagedFiles = JSON.stringify(packageJson.build.files || []);
const extraResources = JSON.stringify(packageJson.build.extraResources || []);
assert.doesNotMatch(packagedFiles, /startup-benchmark/iu);
assert.doesNotMatch(extraResources, /startup-benchmark|benchmark-marker/iu);

for (const [basePath, relativePath] of [
  [projectRoot, 'README.md'],
  [path.dirname(projectRoot), 'docs/PERFORMANCE.md'],
  [path.dirname(projectRoot), 'docs/RELEASE.md'],
  [path.dirname(projectRoot), 'CHANGELOG.md'],
]) {
  const filePath = path.join(basePath, relativePath);
  if (!fs.existsSync(filePath)) continue;
  const source = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(
    source,
    /spawnTo(?:Usable|DomReady|Paint)|measure:packaged-startup|packaged startup benchmark/iu,
    `${relativePath} must not publish an unproven packaged startup baseline`,
  );
}

console.log('Unproven packaged startup benchmark integration remains disabled.');
