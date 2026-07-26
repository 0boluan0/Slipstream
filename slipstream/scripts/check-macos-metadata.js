const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Arch } = require('builder-util');
const afterPack = require('./after-pack.js').default;

if (process.platform !== 'darwin') {
  console.log('macOS metadata check skipped on non-macOS host');
  process.exit(0);
}

const appPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.slipstream.fixture</string></dict></plist>`;
const helperPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Fixture Helper (GPU)</string>
<key>CFBundleIdentifier</key><string>com.slipstream.fixture.helper.gpu</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`;

async function main() {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-metadata-'));
  const appPath = path.join(tmpdir, 'Fixture.app');
  const contentsPath = path.join(appPath, 'Contents');
  const scriptsPath = path.join(contentsPath, 'Resources', 'scripts');
  const helperPath = path.join(contentsPath, 'Frameworks', 'Fixture Helper (GPU).app');
  const helperContentsPath = path.join(helperPath, 'Contents');
  const helperBinary = path.join(helperContentsPath, 'MacOS', 'Fixture Helper (GPU)');
  const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.adhoc.plist');

  try {
    fs.mkdirSync(scriptsPath, { recursive: true });
    fs.mkdirSync(path.dirname(helperBinary), { recursive: true });
    fs.writeFileSync(path.join(contentsPath, 'Info.plist'), appPlist);
    fs.writeFileSync(path.join(helperContentsPath, 'Info.plist'), helperPlist);
    fs.writeFileSync(path.join(scriptsPath, 'VisionOCR.swift'), 'print("metadata fixture")\n');
    fs.copyFileSync('/usr/bin/true', helperBinary);
    fs.chmodSync(helperBinary, 0o755);
    execFileSync('/usr/bin/xattr', ['-w', 'com.apple.ResourceFork', 'detritus', helperBinary]);
    execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', '01'.repeat(32), helperPath]);

    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir: tmpdir,
      packager: { appInfo: { productFilename: 'Fixture' } },
      arch: process.arch === 'arm64' ? Arch.arm64 : Arch.x64,
    });

    for (const target of [helperBinary, helperPath]) {
      const result = spawnSync(
        '/usr/bin/codesign',
        ['--sign', '-', '--force', '--options', 'runtime', '--entitlements', entitlementsPath, target],
        { encoding: 'utf8' }
      );
      if (result.status !== 0) {
        console.error(result.stderr || result.stdout || `codesign rejected ${target}`);
        process.exitCode = 1;
        return;
      }
    }

    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', helperPath]);

    console.log('macOS metadata check passed');
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
