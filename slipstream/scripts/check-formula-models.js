'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../src/main/local-formula-models.json');
function verifyModels(directory) {
  for (const file of manifest.files) {
    const content = fs.readFileSync(path.join(directory, file.name));
    if (crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error(`Formula model hash mismatch: ${file.name}. Run npm run setup:formula-models.`);
  }
}
if (require.main === module) {
  verifyModels(path.join(__dirname, '..', 'formula-models'));
  console.log('Pinned formula model hashes verified');
}
module.exports = { verifyModels };
