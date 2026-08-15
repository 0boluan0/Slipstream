const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractFile, listPackage } = require('@electron/asar');
const {
  findFileProviderConflictCopies,
  findFileProviderConflictCopiesInEntries,
  formatConflictCopies,
} = require('./file-provider-conflicts');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const allowedPackagedBuildIdentities = new Set(['local-adhoc', 'developer-id']);
const arches = ['arm64', 'x64'];
const artifacts = arches.map((arch) => ({
  arch,
  dmgPath: path.join(root, 'release', `${productName}-${pkg.version}-${arch}.dmg`),
  zipPath: path.join(root, 'release', `${productName}-${pkg.version}-${arch}.zip`),
}));
const checksumsPath = path.join(root, 'release', 'SHA256SUMS.txt');

function inspectCodeSignature(appPath, args) {
  const result = spawnSync('codesign', ['-d', ...args, appPath], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`unable to inspect code signature: ${output.trim()}`);
  return output;
}

function assertPackagedBuildIdentityMatchesSignature(appPath, signature) {
  const hasAdHocSignature = /^Signature=adhoc\s*$/im.test(signature);
  const hasDeveloperIdSignature = /^Authority=Developer ID Application(?::|\s*$)/im.test(signature);
  if (hasAdHocSignature === hasDeveloperIdSignature) {
    throw new Error('release app has an unknown or ambiguous code signature');
  }

  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const packagedPackage = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  const packagedBuildIdentity = packagedPackage.slipstreamBuildIdentity;
  if (!allowedPackagedBuildIdentities.has(packagedBuildIdentity)) {
    throw new Error(`release app has an unknown packaged build identity: ${JSON.stringify(packagedBuildIdentity)}`);
  }

  const expectedBuildIdentity = hasAdHocSignature ? 'local-adhoc' : 'developer-id';
  if (packagedBuildIdentity !== expectedBuildIdentity) {
    throw new Error(`release app build identity ${JSON.stringify(packagedBuildIdentity)} does not match its code signature (expected ${JSON.stringify(expectedBuildIdentity)})`);
  }
  return packagedBuildIdentity;
}

function assertRuntimeEntitlements(appPath) {
  const signature = inspectCodeSignature(appPath, ['--verbose=4']);
  const packagedBuildIdentity = assertPackagedBuildIdentityMatchesSignature(appPath, signature);
  const entitlements = inspectCodeSignature(appPath, ['--entitlements', '-']);
  for (const entitlement of [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
  ]) {
    if (!entitlements.includes(entitlement)) {
      throw new Error(`release app is missing runtime entitlement: ${entitlement}`);
    }
  }

  const hasLibraryValidationException = entitlements.includes('com.apple.security.cs.disable-library-validation');
  if (packagedBuildIdentity === 'local-adhoc' && !hasLibraryValidationException) {
    throw new Error('ad-hoc release app is missing the Electron library-validation exception');
  }
  if (packagedBuildIdentity === 'developer-id' && hasLibraryValidationException) {
    throw new Error('Developer ID release app contains the ad-hoc library-validation exception');
  }
}

function waitForRetry(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function detachMountedImage(mountPoint) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' });
    if (result.status === 0 || !fs.existsSync(mountPoint)) return;
    if (attempt < 3) waitForRetry(250);
  }
  throw new Error(`unable to detach inspected release image: ${mountPoint}`);
}

function assertNoConflictEntries(entries, label) {
  const conflictCopies = findFileProviderConflictCopiesInEntries(entries);
  if (conflictCopies.length) {
    throw new Error(`${label} contains File Provider conflict copies: ${formatConflictCopies(conflictCopies)}`);
  }
}

function assertNoFilesystemConflictCopies(containerRoot, label) {
  const conflictCopies = findFileProviderConflictCopies(containerRoot);
  if (conflictCopies.length) {
    throw new Error(`${label} contains File Provider conflict copies: ${formatConflictCopies(conflictCopies)}`);
  }
}

function assertNoAsarConflictCopies(appPath, label) {
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  assertNoConflictEntries(listPackage(asarPath, { isPack: false }), `${label} ASAR`);
}

assertNoFilesystemConflictCopies(path.join(root, 'release'), 'release directory');

for (const file of [...artifacts.flatMap(({ dmgPath, zipPath }) => [dmgPath, zipPath]), checksumsPath]) {
  if (!fs.existsSync(file)) {
    console.error(`missing release artifact: ${file}`);
    process.exit(1);
  }
}

const checksums = Object.fromEntries(
  fs
    .readFileSync(checksumsPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/))
    .map(([hash, filename]) => [filename, hash])
);

for (const filePath of artifacts.flatMap(({ dmgPath, zipPath }) => [dmgPath, zipPath])) {
  const filename = path.basename(filePath);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (checksums[filename] !== actual) {
    console.error(`checksum mismatch: ${filename}`);
    process.exit(1);
  }
}

if (process.argv.includes('--manifest-only')) {
  assertNoFilesystemConflictCopies(path.join(root, 'release'), 'release directory after manifest inspection');
  console.log('release artifact manifest check passed');
  process.exit(0);
}

for (const { arch, dmgPath } of artifacts) {
  execFileSync('hdiutil', ['verify', dmgPath], { stdio: 'ignore' });
  let mountPoint = '';
  let dmgError = '';
  try {
    const attachOutput = execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', dmgPath], { encoding: 'utf8' });
    mountPoint = attachOutput.split('\n').map((line) => line.match(/(\/Volumes\/.+)$/)?.[1]).find(Boolean);
    if (!mountPoint || !fs.existsSync(path.join(mountPoint, `${productName}.app`))) {
      dmgError = `DMG does not contain ${productName}.app`;
    } else if (!fs.existsSync(path.join(mountPoint, 'Applications'))) {
      dmgError = 'DMG does not contain Applications install shortcut';
    } else if (!fs.existsSync(path.join(mountPoint, '.background.tiff'))) {
      dmgError = 'DMG does not contain the custom installer background';
    } else if (!fs.existsSync(path.join(mountPoint, '.DS_Store'))) {
      dmgError = 'DMG does not contain the Finder installer layout';
    } else {
      const mountedApp = path.join(mountPoint, `${productName}.app`);
      assertNoFilesystemConflictCopies(mountPoint, `${arch} DMG`);
      assertNoAsarConflictCopies(mountedApp, `${arch} DMG app`);
      execFileSync('codesign', ['--verify', '--deep', mountedApp], { stdio: 'ignore' });
      assertRuntimeEntitlements(mountedApp);
    }
  } finally {
    if (mountPoint) detachMountedImage(mountPoint);
  }
  if (dmgError) {
    console.error(dmgError);
    process.exit(1);
  }
}

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-release-'));
try {
  for (const { arch, zipPath } of artifacts) {
    const archDir = path.join(tmpdir, arch);
    try {
      const zipEntries = execFileSync('/usr/bin/unzip', ['-Z1', zipPath], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
      assertNoConflictEntries(zipEntries, `${arch} ZIP`);
      execFileSync('/usr/bin/unzip', ['-q', zipPath, '-d', archDir]);
      const unzippedApp = path.join(archDir, `${productName}.app`);
      assertNoFilesystemConflictCopies(archDir, `${arch} extracted ZIP`);
      assertNoAsarConflictCopies(unzippedApp, `${arch} ZIP app`);
      fs.accessSync(path.join(unzippedApp, 'Contents', 'MacOS', productName), fs.constants.X_OK);
      execFileSync('codesign', ['--verify', '--deep', '--strict', unzippedApp], { stdio: 'ignore' });
      assertRuntimeEntitlements(unzippedApp);
    } finally {
      fs.rmSync(archDir, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error.message.includes('access') ? `zip does not contain executable ${productName}.app` : error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpdir, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
assertNoFilesystemConflictCopies(path.join(root, 'release'), 'release directory after artifact inspection');
console.log('release artifact check passed');
