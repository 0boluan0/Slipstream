const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const appDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const appPath = path.join(root, 'release', appDir, `${productName}.app`);
const plistPath = path.join(appPath, 'Contents', 'Info.plist');
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
const resourcesPath = path.join(appPath, 'Contents', 'Resources');
const output = execFileSync('plutil', ['-p', plistPath], { encoding: 'utf8' });
const banned = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSAllowsArbitraryLoads',
].filter((key) => output.includes(key));

if (banned.length) {
  console.error(`unused privacy keys present: ${banned.join(', ')}`);
  process.exit(1);
}

const asarList = execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'asar'), ['list', asarPath], {
  encoding: 'utf8',
});
const bannedAppFiles = [
  'scripts/after-pack.js',
  'scripts/check-release-info.js',
  'scripts/VisionOCR.swift',
  'scripts/ocr-swift-runner.sh',
  'assets/app-icon-generated.png',
  'assets/menubar-source.png',
].filter((file) =>
  asarList.includes(`/${file}`)
);

if (bannedAppFiles.length) {
  console.error(`build-only scripts present in app: ${bannedAppFiles.join(', ')}`);
  process.exit(1);
}

for (const file of ['VisionOCR.swift', 'ocr-swift-runner.sh']) {
  const filePath = path.join(resourcesPath, 'scripts', file);
  try {
    fs.accessSync(filePath);
  } catch {
    console.error(`missing runtime OCR resource: ${filePath}`);
    process.exit(1);
  }
}

try {
  fs.rmSync('/tmp/slipstream-ocr', { force: true });
  execFileSync('/bin/bash', [path.join(resourcesPath, 'scripts', 'ocr-swift-runner.sh'), path.join(os.tmpdir(), 'slipstream-no-image.png')], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`;
  if (!output.includes('Failed to load image at path')) {
    console.error(output || error.message);
    process.exit(1);
  }
} finally {
  fs.rmSync('/tmp/slipstream-ocr', { force: true });
}

console.log('release Info.plist check passed');
