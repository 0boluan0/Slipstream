const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { Arch } = require('builder-util');
const { listPackage } = require('@electron/asar');
const { verifyModels } = require('./check-formula-models');
const {
  findFileProviderConflictCopies,
  findFileProviderConflictCopiesInEntries,
  formatConflictCopies,
} = require('./file-provider-conflicts');

const UNUSED_PRIVACY_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const runtimeScripts = path.join(appPath, 'Contents', 'Resources', 'scripts');
  const swiftSource = path.join(runtimeScripts, 'VisionOCR.swift');
  const ocrBinary = path.join(runtimeScripts, 'slipstream-ocr');
  const archName = Arch[context.arch] === 'arm64' ? 'arm64' : 'x86_64';
  verifyModels(path.join(appPath, 'Contents', 'Resources', 'formula-models'));
  const ortDirectory = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules',
    'onnxruntime-node', 'bin', 'napi-v3', 'darwin', Arch[context.arch]);
  for (const file of ['onnxruntime_binding.node', 'libonnxruntime.1.18.0.dylib']) {
    const binary = path.join(ortDirectory, file);
    const architectures = execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' });
    if (!architectures.split(/\s+/).includes(archName)) throw new Error(`Missing ${archName} formula runtime: ${file}`);
  }
  const bundleConflictCopies = findFileProviderConflictCopies(appPath);
  const conflictCopies = findFileProviderConflictCopiesInEntries(listPackage(asarPath, { isPack: false }));

  if (bundleConflictCopies.length) {
    throw new Error(`File Provider conflict copies present in packaged app bundle: ${formatConflictCopies(bundleConflictCopies)}`);
  }
  if (conflictCopies.length) {
    throw new Error(`File Provider conflict copies present in packaged ASAR: ${formatConflictCopies(conflictCopies)}`);
  }

  execFileSync('/usr/bin/xcrun', [
    '--sdk', 'macosx', 'swiftc', '-O',
    '-target', `${archName}-apple-macos12.0`,
    '-o', ocrBinary,
    swiftSource,
  ], { stdio: 'inherit' });
  fs.chmodSync(ocrBinary, 0o755);
  fs.unlinkSync(swiftSource);

  for (const key of UNUSED_PRIVACY_KEYS) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plistPath], { stdio: 'ignore' });
    } catch {
      // Key was already absent.
    }
  }

  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads', plistPath], {
      stdio: 'ignore',
    });
  } catch {
    // Key was already absent.
  }

  // File-provider and downloaded dependency metadata can make macOS reject an
  // otherwise valid bundle before either ad-hoc or Developer ID signing.
  execFileSync('/usr/bin/xattr', ['-cr', appPath], { stdio: 'inherit' });
};
