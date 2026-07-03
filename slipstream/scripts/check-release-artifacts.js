const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const arch = process.arch;
const appDir = arch === 'arm64' ? 'mac-arm64' : 'mac';
const dmgPath = path.join(root, 'release', `${productName}-${pkg.version}-${arch}.dmg`);
const zipPath = path.join(root, 'release', `${productName}-${pkg.version}-${arch}.zip`);
const appPath = path.join(root, 'release', appDir, `${productName}.app`);
const checksumsPath = path.join(root, 'release', 'SHA256SUMS.txt');

for (const file of [dmgPath, zipPath, appPath, checksumsPath]) {
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

for (const filePath of [dmgPath, zipPath]) {
  const filename = path.basename(filePath);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (checksums[filename] !== actual) {
    console.error(`checksum mismatch: ${filename}`);
    process.exit(1);
  }
}

execFileSync('hdiutil', ['verify', dmgPath], { stdio: 'ignore' });

let mountPoint = '';
let dmgError = '';
try {
  const attachOutput = execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', dmgPath], { encoding: 'utf8' });
  mountPoint = attachOutput
    .split('\n')
    .map((line) => line.match(/(\/Volumes\/.+)$/)?.[1])
    .find(Boolean);

  if (!mountPoint || !fs.existsSync(path.join(mountPoint, `${productName}.app`))) {
    dmgError = `DMG does not contain ${productName}.app`;
  } else if (!fs.existsSync(path.join(mountPoint, 'Applications'))) {
    dmgError = 'DMG does not contain Applications install shortcut';
  }
} finally {
  if (mountPoint) {
    execFileSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' });
  }
}

if (dmgError) {
  console.error(dmgError);
  process.exit(1);
}

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-release-'));
try {
  execFileSync('unzip', ['-q', zipPath, '-d', tmpdir]);

  const binaryPath = path.join(tmpdir, `${productName}.app`, 'Contents', 'MacOS', productName);
  fs.accessSync(binaryPath, fs.constants.X_OK);
} catch (error) {
  console.error(error.message.includes('access') ? `zip does not contain executable ${productName}.app` : error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpdir, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log('release artifact check passed');
