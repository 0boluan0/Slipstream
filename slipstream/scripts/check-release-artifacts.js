const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const arches = ['arm64', 'x64'];
const artifacts = arches.map((arch) => ({
  arch,
  dmgPath: path.join(root, 'release', `${productName}-${pkg.version}-${arch}.dmg`),
  zipPath: path.join(root, 'release', `${productName}-${pkg.version}-${arch}.zip`),
}));
const checksumsPath = path.join(root, 'release', 'SHA256SUMS.txt');

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

for (const { dmgPath } of artifacts) {
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
    } else {
      execFileSync('codesign', ['--verify', '--deep', path.join(mountPoint, `${productName}.app`)], { stdio: 'ignore' });
    }
  } finally {
    if (mountPoint) execFileSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' });
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
    execFileSync('unzip', ['-q', zipPath, '-d', archDir]);
    const unzippedApp = path.join(archDir, `${productName}.app`);
    fs.accessSync(path.join(unzippedApp, 'Contents', 'MacOS', productName), fs.constants.X_OK);
    execFileSync('codesign', ['--verify', '--deep', '--strict', unzippedApp], { stdio: 'ignore' });
  }
} catch (error) {
  console.error(error.message.includes('access') ? `zip does not contain executable ${productName}.app` : error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpdir, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log('release artifact check passed');
