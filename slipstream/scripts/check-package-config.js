const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');
const { DebugLogger } = require('builder-util');
const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
const {
  buildArguments,
  createStagingDirectory,
  discardUnpackedApplications,
  notarizationArguments,
  resolveDeveloperIdIdentity,
} = require('./build-macos');

const required = [
  ['scripts.build', pkg.scripts?.build],
  ['scripts.build:signed', pkg.scripts?.['build:signed']],
  ['scripts.release:unsigned', pkg.scripts?.['release:unsigned']],
  ['scripts.release:signed', pkg.scripts?.['release:signed']],
  ['scripts.check:release', pkg.scripts?.['check:release']],
  ['scripts.check:release-info', pkg.scripts?.['check:release-info']],
  ['scripts.check:release-manifest', pkg.scripts?.['check:release-manifest']],
  ['scripts.check:build-identity', pkg.scripts?.['check:build-identity']],
  ['scripts.check:file-provider-conflicts', pkg.scripts?.['check:file-provider-conflicts']],
  ['scripts.check:ocr-environment', pkg.scripts?.['check:ocr-environment']],
  ['scripts.check:ocr-runtime', pkg.scripts?.['check:ocr-runtime']],
  ['scripts.check:runtime-dependencies', pkg.scripts?.['check:runtime-dependencies']],
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

const expectedDmgConfig = {
  title: 'Install Slipstream',
  background: 'dmg-background.png',
  iconSize: 128,
  iconTextSize: 12,
  contents: [
    { x: 170, y: 215, type: 'file' },
    { x: 490, y: 215, type: 'link', path: '/Applications' },
  ],
};
if (JSON.stringify(pkg.build.dmg) !== JSON.stringify(expectedDmgConfig)) {
  console.error('DMG must keep the approved drag-to-Applications layout');
  process.exit(1);
}

for (const [filename, width, height] of [
  ['dmg-background.png', 660, 440],
  ['dmg-background@2x.png', 1320, 880],
]) {
  const image = fs.readFileSync(path.join(__dirname, '..', 'build', filename));
  if (
    image.length < 24
    || image.toString('hex', 0, 8) !== '89504e470d0a1a0a'
    || image.readUInt32BE(16) !== width
    || image.readUInt32BE(20) !== height
  ) {
    console.error(`${filename} must be a ${width}x${height} PNG`);
    process.exit(1);
  }
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

if (!pkg.scripts['check:release'].includes('npm run check:runtime-dependencies')) {
  console.error('release checks must audit production runtime dependencies');
  process.exit(1);
}

if (!pkg.scripts['check:release'].includes('npm run check:release-info')) {
  console.error('release checks must inspect packaged OCR runtime evidence');
  process.exit(1);
}

if (!pkg.scripts['check:release'].includes('npm run check:release-artifacts')) {
  console.error('release checks must inspect final ZIP and DMG artifacts');
  process.exit(1);
}

if (pkg.scripts['check:release-manifest'] !== 'node scripts/check-release-artifacts.js --manifest-only') {
  console.error('release manifest gate must reuse the artifact checksum and conflict-copy inspection');
  process.exit(1);
}

const releaseGate = pkg.scripts['check:release'];
const testIndex = releaseGate.indexOf('npm test');
for (const gate of ['npm run check:release-info', 'npm run check:release-artifacts']) {
  const gateIndex = releaseGate.indexOf(gate);
  if (gateIndex < 0 || testIndex < 0 || gateIndex > testIndex) {
    console.error(`${gate} must run before tests download the local Electron runtime`);
    process.exit(1);
  }
}

if (!releaseGate.trim().endsWith('npm run check:release-manifest')) {
  console.error('release checks must finish by revalidating artifact checksums and release-directory conflicts');
  process.exit(1);
}

for (const releaseScript of ['release:unsigned', 'release:signed']) {
  if (!pkg.scripts[releaseScript].includes('npm run check:release')) {
    console.error(`${releaseScript} must run the complete release gate`);
    process.exit(1);
  }
}

for (const gate of ['check:file-provider-conflicts', 'check:ocr-environment', 'check:ocr-runtime']) {
  if (!pkg.scripts.test.includes(`npm run ${gate}`)) {
    console.error(`test gate must include ${gate}`);
    process.exit(1);
  }
}

for (const file of [
  'scripts/check-file-provider-conflicts.js',
  'scripts/file-provider-conflicts.js',
  'scripts/check-ocr-environment.js',
  'scripts/check-vision-ocr-runtime.js',
  'scripts/vision-ocr-fixture.js',
]) {
  if (!fs.existsSync(path.join(__dirname, '..', file))) {
    console.error(`missing release gate source: ${file}`);
    process.exit(1);
  }
}

const releaseInfoSource = fs.readFileSync(path.join(__dirname, 'check-release-info.js'), 'utf8');
for (const marker of [
  'createOcrEnvironment',
  'findFileProviderConflictCopiesInEntries',
  'validateVisionOcrResult',
  'writeVisionOcrFixture',
  "'/usr/bin/lipo'",
]) {
  if (!releaseInfoSource.includes(marker)) {
    console.error(`packaged OCR release check is missing ${marker}`);
    process.exit(1);
  }
}

for (const [file, markers] of [
  ['after-pack.js', ['findFileProviderConflictCopies', 'findFileProviderConflictCopiesInEntries', 'listPackage']],
  ['build-macos.js', ['assertCleanPackagingInputs']],
  ['check-release-artifacts.js', [
    'findFileProviderConflictCopies',
    'findFileProviderConflictCopiesInEntries',
    'listPackage',
    "process.argv.includes('--manifest-only')",
    'fs.rmSync(archDir, { recursive: true, force: true })',
    "['-Z1', zipPath]",
    "['attach', '-nobrowse', '-readonly', dmgPath]",
  ]],
  ['write-release-checksums.js', ['findFileProviderConflictCopies']],
]) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const marker of markers) {
    if (!source.includes(marker)) {
      console.error(`${file} is missing the File Provider conflict-copy gate marker ${marker}`);
      process.exit(1);
    }
  }
}

if (!pkg.scripts.test.includes('npm run check:build-identity')) {
  console.error('test gate must exercise the fail-closed build identity contract');
  process.exit(1);
}

if (Object.hasOwn(pkg, 'slipstreamBuildIdentity')) {
  console.error('source package metadata must not declare a packaged build identity');
  process.exit(1);
}

if (
  pkg.dependencies?.['@phosphor-icons/react'] ||
  pkg.devDependencies?.['@phosphor-icons/react'] !== '2.1.10'
) {
  console.error('renderer-only Phosphor icons must remain a pinned development dependency');
  process.exit(1);
}

const adHocArguments = buildArguments('arm64', false, '/tmp/slipstream-check');
const signedArguments = buildArguments('arm64', true, '/tmp/slipstream-check');
const buildIdentityArgumentPrefix = '-c.extraMetadata.slipstreamBuildIdentity=';

if (
  !adHocArguments.includes(`${buildIdentityArgumentPrefix}local-adhoc`)
  || adHocArguments.filter((argument) => argument.startsWith(buildIdentityArgumentPrefix)).length !== 1
) {
  console.error('ad-hoc build must inject only the local-adhoc packaged identity');
  process.exit(1);
}

if (
  !signedArguments.includes(`${buildIdentityArgumentPrefix}developer-id`)
  || signedArguments.filter((argument) => argument.startsWith(buildIdentityArgumentPrefix)).length !== 1
) {
  console.error('signed build must inject only the developer-id packaged identity');
  process.exit(1);
}

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

const stagedDmgPath = '/tmp/slipstream-check/Slipstream.dmg';
const notarizationArgumentChecks = [
  [
    {
      APPLE_API_KEY: '/tmp/AuthKey.p8',
      APPLE_API_KEY_ID: 'api-key-id',
      APPLE_API_ISSUER: 'api-issuer',
    },
    [
      'notarytool', 'submit', stagedDmgPath, '--wait',
      '--key', '/tmp/AuthKey.p8', '--key-id', 'api-key-id', '--issuer', 'api-issuer',
    ],
  ],
  [
    {
      APPLE_ID: 'release@example.invalid',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'team-id',
    },
    [
      'notarytool', 'submit', stagedDmgPath, '--wait',
      '--apple-id', 'release@example.invalid', '--password', 'app-password', '--team-id', 'team-id',
    ],
  ],
  [
    {
      APPLE_KEYCHAIN: '/tmp/release.keychain-db',
      APPLE_KEYCHAIN_PROFILE: 'notary-profile',
    },
    [
      'notarytool', 'submit', stagedDmgPath, '--wait',
      '--keychain', '/tmp/release.keychain-db', '--keychain-profile', 'notary-profile',
    ],
  ],
];

for (const [env, expected] of notarizationArgumentChecks) {
  if (JSON.stringify(notarizationArguments(stagedDmgPath, env)) !== JSON.stringify(expected)) {
    console.error('DMG notarization must select and order the supported notarytool credentials');
    process.exit(1);
  }
}

const developerIdHash = 'A'.repeat(40);
const identityFixture = [
  `  1) ${developerIdHash} "Developer ID Application: Release Owner (TEAMID1234)"`,
  `  2) ${'B'.repeat(40)} "Apple Development: Release Owner (TEAMID1234)"`,
  '     2 valid identities found',
].join('\n');
if (resolveDeveloperIdIdentity(identityFixture) !== developerIdHash) {
  console.error('DMG signing must resolve the installed Developer ID Application identity by hash');
  process.exit(1);
}

let rejectedAmbiguousDeveloperIds = false;
try {
  resolveDeveloperIdIdentity([
    identityFixture,
    `  3) ${'C'.repeat(40)} "Developer ID Application: Other Owner (TEAMID5678)"`,
  ].join('\n'));
} catch {
  rejectedAmbiguousDeveloperIds = true;
}
if (!rejectedAmbiguousDeveloperIds) {
  console.error('DMG signing must reject ambiguous Developer ID Application identities');
  process.exit(1);
}

const macBuildSource = fs.readFileSync(path.join(__dirname, 'build-macos.js'), 'utf8');
const stagedDmgStepIndexes = [
  macBuildSource.indexOf("['--force', '--sign', signingIdentity, '--timestamp', dmgPath]"),
  macBuildSource.indexOf("execFileSync('xcrun', notarizationArguments(dmgPath, env)"),
  macBuildSource.indexOf("['stapler', 'staple', dmgPath]"),
  macBuildSource.indexOf("['stapler', 'validate', dmgPath]"),
  macBuildSource.indexOf("await buildBlockMap(dmgPath, 'gzip', `${dmgPath}.blockmap`)"),
];
const stagedNotarizationIndex = macBuildSource.lastIndexOf(
  'if (signed) await notarizeDmgArtifacts(stagingDir, env);',
);
const artifactPublishIndex = macBuildSource.lastIndexOf('publishArtifacts(stagingDir);');
if (
  stagedDmgStepIndexes.some((index, position) => (
    index < 0 || (position > 0 && index <= stagedDmgStepIndexes[position - 1])
  ))
  || stagedNotarizationIndex < 0
  || artifactPublishIndex < 0
  || stagedNotarizationIndex > artifactPublishIndex
) {
  console.error(
    'signed DMGs must be signed, notarized, stapled, validated, and re-blockmapped before publishing',
  );
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

  const unpackedDirectories = ['mac', 'mac-arm64'].map((directory) => path.join(stagingDirectory, directory));
  const retainedArtifact = path.join(stagingDirectory, 'retained-artifact.zip');
  for (const directory of unpackedDirectories) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(retainedArtifact, 'fixture');
  discardUnpackedApplications(stagingDirectory);
  if (unpackedDirectories.some((directory) => fs.existsSync(directory)) || !fs.existsSync(retainedArtifact)) {
    console.error('macOS staging cleanup must discard only unpacked application directories');
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

if (!pkg.build.files.includes('!src/main/ui-fixture-mode.js')) {
  console.error('packaged app must exclude the development-only UI fixture mode resolver');
  process.exit(1);
}

const expectedConflictCopyExclusions = [
  '!**/* +([0-9]).+([^.])',
  '!**/* +([0-9]){,/**/*}',
];
if (JSON.stringify(pkg.build.files.slice(-2)) !== JSON.stringify(expectedConflictCopyExclusions)) {
  console.error('File Provider conflict-copy exclusions must remain the final packaged file rules');
  process.exit(1);
}

if (
  !pkg.build.files.includes('dist/renderer/**/*')
  || pkg.build.files.some((entry) => entry !== 'dist/renderer/**/*' && /^!?dist\//u.test(entry))
) {
  console.error('packaged app must allow only the production renderer subtree under dist');
  process.exit(1);
}

if (pkg.build.files.some((entry) => /^scripts(?:\/|\/\*\*)/u.test(entry))) {
  console.error('packaged app must not include the development fixture script tree');
  process.exit(1);
}

const expectedOcrResources = [{
  from: 'scripts',
  to: 'scripts',
  filter: ['VisionOCR.swift', 'ocr-swift-runner.sh'],
}];
if (JSON.stringify(pkg.build.extraResources) !== JSON.stringify(expectedOcrResources)) {
  console.error('packaged extraResources must remain the exact two-file OCR build allowlist');
  process.exit(1);
}

validateConfiguration(pkg.build, new DebugLogger(false))
  .then(() => console.log('package release config check passed'))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
