'use strict';
// Explicit development/setup download. The application never fetches models
// while processing a screenshot. Pinned revisions and hashes prevent drift.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../src/main/local-formula-models.json');
const destination = path.join(__dirname, '..', 'formula-models');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
async function setup() {
  await fs.mkdir(destination, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(destination, file.name);
    try { if (hash(await fs.readFile(target)) === file.sha256) { console.log(`Verified ${file.name}`); continue; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const response = await fetch(file.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (hash(content) !== file.sha256) throw new Error(`Model hash mismatch: ${file.name}`);
    await fs.writeFile(`${target}.partial`, content);
    await fs.rename(`${target}.partial`, target);
    console.log(`Installed ${file.name} (${content.length} bytes)`);
  }
}
if (require.main === module) setup().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { setup };
