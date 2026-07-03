const { execFileSync } = require('node:child_process');
const path = require('node:path');

const UNUSED_PRIVACY_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const plistPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist');

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
