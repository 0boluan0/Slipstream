const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');
const { DebugLogger } = require('builder-util');
const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
const { buildArguments, createStagingDirectory } = require('./build-macos');

const required = [
  ['scripts.build', pkg.scripts?.build],
  ['scripts.build:signed', pkg.scripts?.['build:signed']],
  ['scripts.release:unsigned', pkg.scripts?.['release:unsigned']],
  ['scripts.release:signed', pkg.scripts?.['release:signed']],
  ['scripts.check:release', pkg.scripts?.['check:release']],
  ['build.afterPack', pkg.build?.afterPack],
  ['build.afterSign', pkg.build?.afterSign],
  ['build.files', pkg.build?.files?.length],
  ['build.extraResources', pkg.build?.extraResources?.length],
  ['build.mac.icon', pkg.build?.mac?.icon],
  ['build.mac.minimumSystemVersion', pkg.build?.mac?.minimumSystemVersion === '12.0'],
  ['build.mac.hardenedRuntime', pkg.build?.mac?.hardenedRuntime === true],
  ['build.mac.entitlements', pkg.build?.mac?.entitlements],
  ['build.mac.entitlementsInherit', pkg.build?.mac?.entitlementsInherit],
];

const missing = required.filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error(`missing package release config: ${missing.join(', ')}`);
  process.exit(1);
}

if (!pkg.scripts.build.includes('node scripts/build-macos.js')) {
  console.error('macOS build must use the isolated staging script');
  process.exit(1);
}

if (!pkg.scripts['build:signed'].includes('node scripts/build-macos.js --signed')) {
  console.error('signed build must use the signed staging path');
  process.exit(1);
}

if (!pkg.scripts['release:signed'].includes('npm run build:signed')) {
  console.error('signed release does not use signed build');
  process.exit(1);
}

const adHocArguments = buildArguments('arm64', false, '/tmp/slipstream-check');
const signedArguments = buildArguments('arm64', true, '/tmp/slipstream-check');

if (!adHocArguments.some((argument) => argument.includes('mac.entitlements=build/entitlements.adhoc.plist'))) {
  console.error('ad-hoc build must use the runnable ad-hoc entitlements');
  process.exit(1);
}

if (signedArguments.some((argument) => argument.includes('entitlements.adhoc.plist'))) {
  console.error('signed build must not use the ad-hoc library-validation exception');
  process.exit(1);
}

if (!signedArguments.includes('-c.mac.notarize=true') || !signedArguments.includes('-c.forceCodeSigning=true')) {
  console.error('signed build must enable notarization and require a signing identity');
  process.exit(1);
}

const stagingDirectory = createStagingDirectory();
try {
  const projectRoot = fs.realpathSync(path.join(__dirname, '..'));
  const relativeToProject = path.relative(projectRoot, fs.realpathSync(stagingDirectory));
  const relativeToSystemTemp = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(stagingDirectory));
  if (
    relativeToSystemTemp.startsWith('..') ||
    path.isAbsolute(relativeToSystemTemp) ||
    (!relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject))
  ) {
    console.error('macOS staging directory must stay outside the synced workspace');
    process.exit(1);
  }
} finally {
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
}

const productionEntitlements = fs.readFileSync(path.join(__dirname, '..', pkg.build.mac.entitlements), 'utf8');
const adHocEntitlements = fs.readFileSync(path.join(__dirname, '..', 'build', 'entitlements.adhoc.plist'), 'utf8');

for (const entitlement of [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
]) {
  if (!productionEntitlements.includes(`<key>${entitlement}</key>`) || !adHocEntitlements.includes(`<key>${entitlement}</key>`)) {
    console.error(`missing Electron runtime entitlement: ${entitlement}`);
    process.exit(1);
  }
}

if (!adHocEntitlements.includes('<key>com.apple.security.cs.disable-library-validation</key>')) {
  console.error('ad-hoc entitlements must disable library validation for pre-signed Electron frameworks');
  process.exit(1);
}

if (productionEntitlements.includes('<key>com.apple.security.cs.disable-library-validation</key>')) {
  console.error('production entitlements must keep library validation enabled');
  process.exit(1);
}

if (!pkg.build.files.includes('LICENSE') || !pkg.build.files.includes('README.md')) {
  console.error('packaged app must include LICENSE and README.md');
  process.exit(1);
}

validateConfiguration(pkg.build, new DebugLogger(false))
  .then(() => console.log('package release config check passed'))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
