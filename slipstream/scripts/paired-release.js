'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function sourceIdentity() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', 'src', 'scripts', 'preload.js', 'package.json', 'package-lock.json', 'build'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty) throw new Error('Commit the application and build inputs before producing paired release artifacts.');
  return { version: require('../package.json').version, sourceRevision: revision };
}

function writeManifest(artifact, platform, arch, identity, packagedMetadata) {
  if (packagedMetadata.version !== identity.version || packagedMetadata.slipstreamSourceRevision !== identity.sourceRevision) {
    throw new Error('Packaged version/source revision does not match the release input.');
  }
  const manifest = { schemaVersion: 1, ...identity, platform, arch,
    file: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256: sha256(artifact) };
  fs.writeFileSync(`${artifact}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function verifyPair(directory) {
  const manifests = fs.readdirSync(directory).filter(file => file.endsWith('.manifest.json'))
    .map(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
  if (manifests.length !== 2 || !manifests.some(m => m.platform === 'darwin' && m.arch === 'arm64')
    || !manifests.some(m => m.platform === 'win32' && m.arch === 'x64')) {
    throw new Error('A paired preview needs exactly one macOS arm64 installer and one Windows x64 installer.');
  }
  const first = manifests[0];
  for (const item of manifests) {
    if (item.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(item.sourceRevision)
      || typeof item.version !== 'string' || item.version !== first.version || item.sourceRevision !== first.sourceRevision
      || typeof item.file !== 'string' || path.basename(item.file) !== item.file
      || !(item.platform === 'darwin' ? item.file.endsWith('.dmg') : item.file.endsWith('-Setup.exe'))) {
      throw new Error('Release artifacts must use the same version and source commit, with valid installer filenames.');
    }
    const file = path.join(directory, item.file);
    if (fs.lstatSync(file).isSymbolicLink() || item.bytes <= 0 || fs.statSync(file).size !== item.bytes || sha256(file) !== item.sha256) {
      throw new Error(`Installer checksum mismatch: ${item.file}`);
    }
  }
  return { version: first.version, sourceRevision: first.sourceRevision, artifacts: manifests };
}

if (require.main === module) {
  try {
    const directory = path.resolve(process.argv[2] || 'release/paired');
    const release = verifyPair(directory);
    fs.writeFileSync(path.join(directory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), release.artifacts.map(m => `${m.sha256}  ${m.file}\n`).join(''));
    console.log(`Paired installers verified: ${release.version} / ${release.sourceRevision}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { sourceIdentity, writeManifest, verifyPair };
