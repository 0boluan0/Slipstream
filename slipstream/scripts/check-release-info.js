'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractFile } = require('@electron/asar');

const { createOcrEnvironment } = require('../src/main/ocr-environment');
const {
  validateVisionOcrResult,
  writeVisionOcrFixture,
} = require('./vision-ocr-fixture');
const {
  findFileProviderConflictCopies,
  findFileProviderConflictCopiesInEntries,
  formatConflictCopies,
} = require('./file-provider-conflicts');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const allowedPackagedBuildIdentities = new Set(['local-adhoc', 'developer-id']);
const archiveContracts = Object.freeze({
  arm64: Object.freeze({ machOArch: 'arm64' }),
  x64: Object.freeze({ machOArch: 'x86_64' }),
});
const arches = Object.keys(archiveContracts);
const hostContract = archiveContracts[process.arch];
const maxOcrOutputBytes = 1024 * 1024;
const ocrTimeoutMs = 30_000;

if (!hostContract) {
  console.error(`release OCR runtime check does not support host architecture ${process.arch}`);
  process.exit(1);
}

function assertPrivateDirectory(directory, label) {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private directory`);
  }
}

function createPrivateDirectory(directory, label) {
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  assertPrivateDirectory(directory, label);
}

function runPackagedOcr(runnerPath, imagePath, cacheDir) {
  return spawnSync('/bin/bash', [runnerPath, imagePath], {
    encoding: 'utf8',
    env: createOcrEnvironment(cacheDir),
    maxBuffer: maxOcrOutputBytes,
    timeout: ocrTimeoutMs,
    windowsHide: true,
  });
}

function assertPackagedOcrNegativeCase(runnerPath, runtimeRoot, cacheDir) {
  const missingImagePath = path.join(runtimeRoot, 'missing-fictional-image.png');
  if (fs.existsSync(missingImagePath)) {
    throw new Error('packaged OCR missing-image fixture unexpectedly exists');
  }

  const run = runPackagedOcr(runnerPath, missingImagePath, cacheDir);
  if (run.error) {
    const reason = run.error.code === 'ETIMEDOUT' ? 'timed out' : 'could not start';
    throw new Error(`packaged OCR missing-image check ${reason}`);
  }
  if (run.status !== 1) {
    throw new Error(`packaged OCR missing-image check returned status ${run.status}`);
  }
  if (run.stderr !== '') {
    throw new Error('packaged OCR missing-image check wrote unexpected stderr');
  }

  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    throw new Error('packaged OCR missing-image check returned invalid JSON');
  }
  if (
    !result
    || typeof result !== 'object'
    || typeof result.error !== 'string'
    || result.error !== `Failed to load image at path: ${missingImagePath}`
  ) {
    throw new Error('packaged OCR missing-image check returned the wrong error contract');
  }
}

function assertPackagedOcrPositiveCase(runnerPath, runtimeRoot, cacheDir) {
  const { imagePath } = writeVisionOcrFixture(runtimeRoot);
  const run = runPackagedOcr(runnerPath, imagePath, cacheDir);
  if (run.error) {
    const reason = run.error.code === 'ETIMEDOUT' ? 'timed out' : 'could not start';
    throw new Error(`packaged Apple Vision OCR check ${reason}`);
  }
  if (run.status !== 0) {
    throw new Error(`packaged Apple Vision OCR check failed with status ${run.status}`);
  }
  if (run.stderr !== '') {
    throw new Error('packaged Apple Vision OCR check wrote unexpected stderr');
  }

  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    throw new Error('packaged Apple Vision OCR check returned invalid JSON');
  }
  return validateVisionOcrResult(result, { minimumConfidence: 0.5 });
}

function inspectArchive(arch, outputDir, runtimeRoot) {
  const contract = archiveContracts[arch];
  const archivePath = path.join(root, 'release', `${productName}-${pkg.version}-${arch}.zip`);
  const zipEntries = execFileSync('/usr/bin/unzip', ['-Z1', archivePath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const zipConflictCopies = findFileProviderConflictCopiesInEntries(zipEntries);
  if (zipConflictCopies.length) {
    throw new Error(`${arch} ZIP contains File Provider conflict copies: ${formatConflictCopies(zipConflictCopies)}`);
  }
  createPrivateDirectory(outputDir, `${arch} archive extraction directory`);
  execFileSync('/usr/bin/unzip', ['-q', archivePath, '-d', outputDir], {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });

  const appPath = path.join(outputDir, `${productName}.app`);
  const bundleConflictCopies = findFileProviderConflictCopies(appPath);
  if (bundleConflictCopies.length) {
    throw new Error(`${arch} app bundle contains File Provider conflict copies: ${formatConflictCopies(bundleConflictCopies)}`);
  }
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const output = execFileSync('/usr/bin/plutil', ['-p', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' });
  const banned = ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSAllowsArbitraryLoads'].filter((key) => output.includes(key));
  if (banned.length) {
    throw new Error(`unused privacy keys present: ${banned.join(', ')}`);
  }
  if (!output.includes('"LSMinimumSystemVersion" => "12.0"')) {
    throw new Error('packaged app must declare macOS 12.0 as its minimum system version');
  }

  const asarPath = path.join(resourcesPath, 'app.asar');
  const packagedPackage = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  const packagedBuildIdentity = packagedPackage.slipstreamBuildIdentity;
  if (!allowedPackagedBuildIdentities.has(packagedBuildIdentity)) {
    throw new Error(`unknown packaged build identity for ${arch}: ${JSON.stringify(packagedBuildIdentity)}`);
  }

  const asarList = execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'asar'), ['list', asarPath], { encoding: 'utf8' });
  const asarEntries = asarList.split('\n').filter(Boolean);
  const asarEntrySet = new Set(asarEntries);
  const conflictCopies = findFileProviderConflictCopiesInEntries(asarEntries);
  if (conflictCopies.length) {
    throw new Error(`File Provider conflict copies present in packaged ASAR: ${formatConflictCopies(conflictCopies)}`);
  }
  const bannedAppFiles = [
    'scripts/after-pack.js',
    'scripts/check-release-info.js',
    'scripts/check-vision-ocr-runtime.js',
    'scripts/vision-ocr-fixture.js',
    'scripts/ui-fixture-main.js',
    'scripts/ui-fixture-preload.js',
    'scripts/VisionOCR.swift',
    'scripts/ocr-swift-runner.sh',
    'src/main/ui-fixture-mode.js',
    'assets/app-icon-generated.png',
    'assets/menubar-source.png',
  ].filter((file) => asarEntrySet.has(`/${file}`));
  if (bannedAppFiles.length) {
    throw new Error(`build-only scripts present in app: ${bannedAppFiles.join(', ')}`);
  }
  const unexpectedDistFiles = asarEntries.filter((entry) => (
    entry.startsWith('/dist/')
    && entry !== '/dist/renderer'
    && !entry.startsWith('/dist/renderer/')
  ));
  if (unexpectedDistFiles.length) {
    throw new Error(`unexpected packaged dist subtree: ${unexpectedDistFiles.join(', ')}`);
  }
  const packagedMainSource = extractFile(asarPath, 'src/main/main.js').toString('utf8');
  const bannedFixtureImplementations = [
    'finishUiFixtureRuntimeCheck',
    '__SLIPSTREAM_UI_FIXTURE_CHECK__',
    'slipstream-ui-fixture:trusted-input',
    'function registerUiFixtureRecoveryHandlers',
    'function registerUiFixtureTrustedInputHandler',
  ].filter((marker) => packagedMainSource.includes(marker));
  if (bannedFixtureImplementations.length) {
    throw new Error(`packaged main contains UI fixture implementation: ${bannedFixtureImplementations.join(', ')}`);
  }
  for (const requiredFile of [
    '/LICENSE',
    '/README.md',
    '/dist/renderer/index.html',
    '/dist/renderer/assets/ResultDisplay.js',
    '/dist/renderer/assets/ResultDisplay.css',
    '/dist/renderer/assets/SettingsPanel.js',
    '/dist/renderer/assets/SettingsPanel.css',
    '/dist/renderer/assets/SavedTermsLibrary.js',
    '/dist/renderer/assets/SavedTermsLibrary.css',
  ]) {
    if (!asarEntrySet.has(requiredFile)) {
      throw new Error(`missing packaged project file: ${requiredFile}`);
    }
  }

  for (const file of ['slipstream-ocr', 'ocr-swift-runner.sh']) {
    const filePath = path.join(resourcesPath, 'scripts', file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`missing runtime OCR resource: ${filePath}`);
    }
  }
  const runtimeScriptDirectory = path.join(resourcesPath, 'scripts');
  const allowedRuntimeScripts = new Set(['slipstream-ocr', 'ocr-swift-runner.sh']);
  const unexpectedRuntimeScripts = fs.readdirSync(runtimeScriptDirectory, { withFileTypes: true })
    .filter((entry) => !entry.isFile() || !allowedRuntimeScripts.has(entry.name))
    .map((entry) => entry.name);
  if (unexpectedRuntimeScripts.length) {
    throw new Error(`unexpected runtime scripts present: ${unexpectedRuntimeScripts.join(', ')}`);
  }
  if (fs.existsSync(path.join(runtimeScriptDirectory, 'VisionOCR.swift'))) {
    throw new Error('runtime package still contains OCR compiler source');
  }

  const packagedOcrBinary = path.join(runtimeScriptDirectory, 'slipstream-ocr');
  const binaryArches = execFileSync('/usr/bin/lipo', ['-archs', packagedOcrBinary], { encoding: 'utf8' })
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (binaryArches.length !== 1 || binaryArches[0] !== contract.machOArch) {
    throw new Error(`${arch} packaged OCR binary has the wrong architecture slice`);
  }

  let runtimeSummary = null;
  if (arch === process.arch) {
    const cacheDir = path.join(runtimeRoot, 'cache');
    createPrivateDirectory(cacheDir, 'packaged OCR cache');
    const runnerPath = path.join(runtimeScriptDirectory, 'ocr-swift-runner.sh');
    assertPackagedOcrNegativeCase(runnerPath, runtimeRoot, cacheDir);
    runtimeSummary = assertPackagedOcrPositiveCase(runnerPath, runtimeRoot, cacheDir);
    if (
      fs.existsSync(path.join(cacheDir, 'slipstream-ocr'))
      || fs.existsSync(path.join(cacheDir, 'slipstream-ocr.version'))
    ) {
      throw new Error('packaged OCR runner unexpectedly created development compile artifacts');
    }
  }

  return Object.freeze({
    packagedBuildIdentity,
    runtimeSummary,
  });
}

function main() {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-info-'));
  fs.chmodSync(tmpdir, 0o700);
  assertPrivateDirectory(tmpdir, 'release inspection root');
  const runtimeRoot = path.join(tmpdir, 'host-ocr-runtime');
  createPrivateDirectory(runtimeRoot, 'packaged OCR runtime directory');
  const packagedBuildIdentities = new Map();
  let hostRuntimeSummary = null;

  try {
    for (const arch of arches) {
      const outputDir = path.join(tmpdir, `archive-${arch}`);
      try {
        const inspection = inspectArchive(arch, outputDir, runtimeRoot);
        packagedBuildIdentities.set(arch, inspection.packagedBuildIdentity);
        if (inspection.runtimeSummary) hostRuntimeSummary = inspection.runtimeSummary;
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }

    if (new Set(packagedBuildIdentities.values()).size !== 1) {
      throw new Error(`packaged build identity differs across architectures: ${arches.map((arch) => `${arch}=${packagedBuildIdentities.get(arch)}`).join(', ')}`);
    }
    if (!hostRuntimeSummary) {
      throw new Error('host-architecture packaged OCR runtime check did not execute');
    }

    console.log(`release archive checks passed; OCR slices arm64=${archiveContracts.arm64.machOArch}, x64=${archiveContracts.x64.machOArch}; fixed fictional fixture executed on ${process.arch} with ${hostRuntimeSummary.blockCount} blocks at ${hostRuntimeSummary.confidence.toFixed(3)} confidence`);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || 'release archive check failed');
  process.exit(1);
}
