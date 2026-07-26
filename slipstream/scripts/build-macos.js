const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const architectures = ['x64', 'arm64'];
const extensions = ['dmg', 'dmg.blockmap', 'zip', 'zip.blockmap'];

function createStagingDirectory() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-build-'));
  const relativeToProject = path.relative(fs.realpathSync(root), fs.realpathSync(stagingDir));
  if (!relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error('macOS staging directory must be outside the project workspace');
  }
  return stagingDir;
}

function buildArguments(arch, signed, stagingDir) {
  const args = ['--mac', `--${arch}`, `-c.directories.output=${stagingDir}`];
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
  return architectures.flatMap((arch) =>
    extensions.map((extension) => `${productName}-${pkg.version}-${arch}.${extension}`)
  );
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
      fs.copyFileSync(source, temporaryDestination);
      pending.push({ destination, temporaryDestination });
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

function buildMacRelease({ signed = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS release builds require a macOS host');
  const stagingDir = createStagingDirectory();
  const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');
  const env = signed ? { ...process.env, SLIPSTREAM_REQUIRE_SIGNING: '1' } : process.env;
  let completed = false;

  console.log(`staging macOS release outside the synced workspace: ${stagingDir}`);
  try {
    for (const arch of architectures) {
      execFileSync(builder, buildArguments(arch, signed, stagingDir), {
        cwd: root,
        env,
        stdio: 'inherit',
      });
    }
    publishArtifacts(stagingDir);
    completed = true;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (!completed) console.error('macOS release build failed before artifacts were published');
  }
}

if (require.main === module) {
  buildMacRelease({ signed: process.argv.includes('--signed') });
}

module.exports = {
  artifactNames,
  buildArguments,
  buildMacRelease,
  createStagingDirectory,
  publishArtifacts,
};
