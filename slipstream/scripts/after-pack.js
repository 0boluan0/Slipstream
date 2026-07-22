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

  const plistPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist');
  const runtimeScripts = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'scripts');
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
};
