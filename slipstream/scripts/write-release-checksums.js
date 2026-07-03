const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const arch = process.arch;
const files = [`${productName}-${pkg.version}-${arch}.dmg`, `${productName}-${pkg.version}-${arch}.zip`];

const lines = files.map((filename) => {
  const filePath = path.join(root, 'release', filename);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return `${hash}  ${filename}`;
});

fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log('release checksums written');
