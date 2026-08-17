const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BUILD_IDENTITIES } = require('../src/main/build-identity');
const {
  findFileProviderConflictCopies,
  formatConflictCopies,
} = require('./file-provider-conflicts');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const architectures = ['x64', 'arm64'];
const extensions = ['dmg', 'zip', 'zip.blockmap'];
const packagedInputDirectories = [
  'node_modules',
  'dist/renderer',
  'src/main',
  'src/shared',
];
function assertCleanPackagingInputs(projectRoot = root) {
  const conflicts = packagedInputDirectories.flatMap((relativeDirectory) => (
    findFileProviderConflictCopies(path.join(projectRoot, relativeDirectory))
      .map((conflict) => `${relativeDirectory}/${conflict}`)
  ));
  if (conflicts.length) {
    throw new Error(
      `macOS packaging inputs contain File Provider conflict copies: ${formatConflictCopies(conflicts)}. Reinstall dependencies or remove the conflict copies before building.`,
    );
  }
}

function createStagingDirectory() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-build-'));
  const relativeToProject = path.relative(fs.realpathSync(root), fs.realpathSync(stagingDir));
  if (!relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error('macOS staging directory must be outside the project workspace');
  }
  return stagingDir;
}

function buildArguments(signed, stagingDir) {
  const buildIdentity = signed
    ? BUILD_IDENTITIES.DEVELOPER_ID
    : BUILD_IDENTITIES.LOCAL_ADHOC;
  const args = [
    '--mac',
    '--x64',
    '--arm64',
    '--publish',
    'never',
    `-c.directories.output=${stagingDir}`,
    `-c.extraMetadata.slipstreamBuildIdentity=${buildIdentity}`,
  ];
  if (signed) {
    return [...args, '-c.mac.notarize=true', '-c.forceCodeSigning=true'];
  }
  return [
    ...args,
    '-c.mac.identity=-',
    '-c.mac.notarize=false',
    '-c.mac.entitlements=build/entitlements.adhoc.plist',
    '-c.mac.entitlementsInherit=build/entitlements.adhoc.plist',
  ];
}

function artifactNames() {
  return [
    ...architectures.flatMap((arch) =>
      extensions.map((extension) => `${productName}-${pkg.version}-${arch}.${extension}`)
    ),
    'latest-mac.yml',
  ];
}

function notarizationArguments(dmgPath, env = process.env) {
  const args = ['notarytool', 'submit', dmgPath, '--wait'];
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return [
      ...args,
      '--key',
      env.APPLE_API_KEY,
      '--key-id',
      env.APPLE_API_KEY_ID,
      '--issuer',
      env.APPLE_API_ISSUER,
    ];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return [
      ...args,
      '--apple-id',
      env.APPLE_ID,
      '--password',
      env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      env.APPLE_TEAM_ID,
    ];
  }
  if (env.APPLE_KEYCHAIN && env.APPLE_KEYCHAIN_PROFILE) {
    return [
      ...args,
      '--keychain',
      env.APPLE_KEYCHAIN,
      '--keychain-profile',
      env.APPLE_KEYCHAIN_PROFILE,
    ];
  }
  throw new Error('missing Apple notarization credentials');
}

function resolveDeveloperIdIdentity(identityOutput) {
  const output = identityOutput ?? execFileSync(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8' },
  );
  const identities = [...output.matchAll(
    /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"Developer ID Application:[^"\r\n]+"\s*$/gmu,
  )];
  if (identities.length !== 1) {
    throw new Error(`expected exactly one installed Developer ID Application identity; found ${identities.length}`);
  }
  return identities[0][1];
}

function resolveStagingDirectory(stagingDir) {
  const resolvedStagingDir = fs.realpathSync(stagingDir);
  if (!path.basename(resolvedStagingDir).startsWith('slipstream-build-')) {
    throw new Error('refusing to prune an unexpected macOS staging directory');
  }
  return resolvedStagingDir;
}

function discardUnpackedApplication(stagingDir, arch) {
  const resolvedStagingDir = resolveStagingDirectory(stagingDir);
  const directory = { arm64: 'mac-arm64', x64: 'mac' }[arch];
  if (!directory) throw new Error(`refusing to prune an unknown macOS architecture: ${arch}`);
  fs.rmSync(path.join(resolvedStagingDir, directory), { recursive: true, force: true });
}

function discardUnpackedApplications(stagingDir) {
  for (const arch of architectures) discardUnpackedApplication(stagingDir, arch);
}

async function notarizeDmgArtifacts(stagingDir, env = process.env) {
  const resolvedStagingDir = resolveStagingDirectory(stagingDir);
  const signingIdentity = resolveDeveloperIdIdentity();
  for (const arch of architectures) {
    const dmgPath = path.join(resolvedStagingDir, `${productName}-${pkg.version}-${arch}.dmg`);
    if (!fs.existsSync(dmgPath) || fs.statSync(dmgPath).size === 0) {
      throw new Error(`missing staged DMG for notarization: ${dmgPath}`);
    }
    execFileSync(
      'codesign',
      ['--force', '--sign', signingIdentity, '--timestamp', dmgPath],
      { env, stdio: 'inherit' },
    );
    execFileSync('codesign', ['--verify', '--verbose=2', dmgPath], { env, stdio: 'inherit' });
    try {
      execFileSync('xcrun', notarizationArguments(dmgPath, env), { env, stdio: 'inherit' });
    } catch {
      throw new Error(`Apple notarization failed for ${path.basename(dmgPath)}; see output above`);
    }
    execFileSync('xcrun', ['stapler', 'staple', dmgPath], { env, stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', dmgPath], { env, stdio: 'inherit' });
  }
}

function publishArtifacts(stagingDir) {
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const pending = [];
  try {
    for (const filename of artifactNames()) {
      const source = path.join(stagingDir, filename);
      if (!fs.existsSync(source) || fs.statSync(source).size === 0) {
        throw new Error(`missing staged release artifact: ${source}`);
      }
      const destination = path.join(releaseDir, filename);
      const temporaryDestination = `${destination}.pending`;
      pending.push({ destination, temporaryDestination });
      fs.copyFileSync(source, temporaryDestination);
    }

    for (const { destination, temporaryDestination } of pending) {
      fs.renameSync(temporaryDestination, destination);
    }
  } finally {
    for (const { temporaryDestination } of pending) {
      fs.rmSync(temporaryDestination, { force: true });
    }
  }
}

async function buildMacRelease({ signed = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS release builds require a macOS host');
  assertCleanPackagingInputs();
  const stagingDir = createStagingDirectory();
  const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');
  const env = signed ? { ...process.env, SLIPSTREAM_REQUIRE_SIGNING: '1' } : process.env;
  let completed = false;

  console.log(`staging macOS release outside the synced workspace: ${stagingDir}`);
  try {
    execFileSync(builder, buildArguments(signed, stagingDir), {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    assertCleanPackagingInputs();
    discardUnpackedApplications(stagingDir);
    if (signed) await notarizeDmgArtifacts(stagingDir, env);
    publishArtifacts(stagingDir);
    completed = true;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (!completed) console.error('macOS release build failed before artifacts were published');
  }
}

if (require.main === module) {
  buildMacRelease({ signed: process.argv.includes('--signed') }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertCleanPackagingInputs,
  artifactNames,
  buildArguments,
  buildMacRelease,
  createStagingDirectory,
  discardUnpackedApplications,
  notarizationArguments,
  publishArtifacts,
  resolveDeveloperIdIdentity,
};
