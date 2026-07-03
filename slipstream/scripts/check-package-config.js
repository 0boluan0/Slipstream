const pkg = require('../package.json');

const required = [
  ['scripts.build', pkg.scripts?.build],
  ['scripts.build:signed', pkg.scripts?.['build:signed']],
  ['scripts.release:unsigned', pkg.scripts?.['release:unsigned']],
  ['scripts.release:signed', pkg.scripts?.['release:signed']],
  ['scripts.check:release', pkg.scripts?.['check:release']],
  ['build.afterPack', pkg.build?.afterPack],
  ['build.files', pkg.build?.files?.length],
  ['build.extraResources', pkg.build?.extraResources?.length],
  ['build.mac.icon', pkg.build?.mac?.icon],
  ['build.mac.hardenedRuntime', pkg.build?.mac?.hardenedRuntime === true],
  ['build.mac.entitlements', pkg.build?.mac?.entitlements],
  ['build.mac.entitlementsInherit', pkg.build?.mac?.entitlementsInherit],
];

const missing = required.filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error(`missing package release config: ${missing.join(', ')}`);
  process.exit(1);
}

if (!pkg.scripts['build:signed'].includes('mac.notarize.teamId=$APPLE_TEAM_ID')) {
  console.error('signed build does not pass APPLE_TEAM_ID to notarization');
  process.exit(1);
}

if (!pkg.scripts['release:signed'].includes('npm run build:signed')) {
  console.error('signed release does not use signed build');
  process.exit(1);
}

console.log('package release config check passed');
