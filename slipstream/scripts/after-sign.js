const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { notarizationArguments } = require('./build-macos');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.SLIPSTREAM_REQUIRE_SIGNING !== '1') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-notary-'));
  const submissionPath = path.join(temporaryDirectory, `${context.packager.appInfo.productFilename}.zip`);
  try {
    execFileSync('/usr/bin/ditto', [
      '-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appPath), submissionPath,
    ], { cwd: path.dirname(appPath), stdio: 'inherit' });
    execFileSync('/usr/bin/xcrun', notarizationArguments(submissionPath, process.env), {
      stdio: 'inherit',
    });
    execFileSync('/usr/bin/xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};
