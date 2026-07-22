const pkg = require('../package.json');
const { DebugLogger } = require('builder-util');
const { validateConfiguration } = require('app-builder-lib/out/util/config/config');

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

if (!pkg.scripts['build:signed'].includes('mac.notarize=true') || !pkg.scripts['build:signed'].includes('forceCodeSigning=true')) {
  console.error('signed build must enable notarization and require a signing identity');
  process.exit(1);
}

if (!pkg.scripts['release:signed'].includes('npm run build:signed')) {
  console.error('signed release does not use signed build');
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
