const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { Arch } = require('builder-util');

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
  const runtimeScripts = path.join(appPath, 'Contents', 'Resources', 'scripts');
  const swiftSource = path.join(runtimeScripts, 'VisionOCR.swift');
  const ocrBinary = path.join(runtimeScripts, 'slipstream-ocr');
  const archName = Arch[context.arch] === 'arm64' ? 'arm64' : 'x86_64';

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
