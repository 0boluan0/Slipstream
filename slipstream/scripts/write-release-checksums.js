const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  findFileProviderConflictCopies,
  formatConflictCopies,
} = require('./file-provider-conflicts');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const files = ['arm64', 'x64'].flatMap((arch) => [
  `${productName}-${pkg.version}-${arch}.dmg`,
  `${productName}-${pkg.version}-${arch}.zip`,
  `${productName}-${pkg.version}-${arch}.zip.blockmap`,
]).concat('latest-mac.yml');
const releaseConflictCopies = findFileProviderConflictCopies(path.join(root, 'release'));

if (releaseConflictCopies.length) {
  throw new Error(`refusing to checksum release artifacts beside File Provider conflict copies: ${formatConflictCopies(releaseConflictCopies)}`);
}

const lines = files.map((filename) => {
  const filePath = path.join(root, 'release', filename);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return `${hash}  ${filename}`;
});

fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log('release checksums written');
