const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-info-'));
process.on('exit', () => fs.rmSync(tmpdir, { recursive: true, force: true }));
const arches = ['arm64', 'x64'];
const appPaths = arches.map((arch) => {
  const outputDir = path.join(tmpdir, arch);
  execFileSync('unzip', ['-q', path.join(root, 'release', `${productName}-${pkg.version}-${arch}.zip`), '-d', outputDir]);
  return path.join(outputDir, `${productName}.app`);
});
for (const appPath of appPaths) {
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const output = execFileSync('plutil', ['-p', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' });
  const banned = ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSAllowsArbitraryLoads'].filter((key) => output.includes(key));
  if (banned.length) {
    console.error(`unused privacy keys present: ${banned.join(', ')}`);
    process.exit(1);
  }
  if (!output.includes('"LSMinimumSystemVersion" => "12.0"')) {
    console.error('packaged app must declare macOS 12.0 as its minimum system version');
    process.exit(1);
  }

  const asarList = execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'asar'), ['list', path.join(resourcesPath, 'app.asar')], { encoding: 'utf8' });
  const bannedAppFiles = ['scripts/after-pack.js', 'scripts/check-release-info.js', 'scripts/VisionOCR.swift', 'scripts/ocr-swift-runner.sh', 'assets/app-icon-generated.png', 'assets/menubar-source.png'].filter((file) => asarList.includes(`/${file}`));
  if (bannedAppFiles.length) {
    console.error(`build-only scripts present in app: ${bannedAppFiles.join(', ')}`);
    process.exit(1);
  }
  for (const requiredFile of ['/LICENSE', '/README.md']) {
    if (!asarList.includes(requiredFile)) {
      console.error(`missing packaged project file: ${requiredFile}`);
      process.exit(1);
    }
  }

  for (const file of ['slipstream-ocr', 'ocr-swift-runner.sh']) {
    const filePath = path.join(resourcesPath, 'scripts', file);
    if (!fs.existsSync(filePath)) {
      console.error(`missing runtime OCR resource: ${filePath}`);
      process.exit(1);
    }
  }
}

const resourcesPath = path.join(appPaths[process.arch === 'arm64' ? 0 : 1], 'Contents', 'Resources');
const ocrCache = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-ocr-check-'));
try {
  execFileSync('/bin/bash', [path.join(resourcesPath, 'scripts', 'ocr-swift-runner.sh'), path.join(os.tmpdir(), 'slipstream-no-image.png')], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, SLIPSTREAM_OCR_CACHE: ocrCache },
  });
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`;
  if (!output.includes('Failed to load image at path')) {
    console.error(output || error.message);
    process.exit(1);
  }
} finally {
  fs.rmSync(ocrCache, { recursive: true, force: true });
}

if (fs.existsSync(path.join(resourcesPath, 'scripts', 'VisionOCR.swift'))) {
  console.error('runtime package still contains OCR compiler source');
  process.exit(1);
}

console.log('release Info.plist check passed');
