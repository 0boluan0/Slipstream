import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const rendererRoot = path.join(projectRoot, 'src/renderer');
const facadePath = path.join(rendererRoot, 'phosphorIcons.js');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [entryPath] : [];
  });
}

const facadeSource = fs.readFileSync(facadePath, 'utf8');
const leafExportPattern = /^export \{ (\w+) \} from '@phosphor-icons\/react\/(\w+)';$/gm;
const facadeExports = new Map();

for (const match of facadeSource.matchAll(leafExportPattern)) {
  const [, exportedName, leafName] = match;
  assert.equal(
    exportedName,
    leafName,
    `Phosphor facade export ${exportedName} must use its matching leaf module`,
  );
  assert.equal(
    facadeExports.has(exportedName),
    false,
    `Phosphor facade must not export ${exportedName} more than once`,
  );
  facadeExports.set(exportedName, leafName);
}

const phosphorLines = facadeSource
  .split('\n')
  .filter((line) => line.includes('@phosphor-icons/react'));
assert.equal(
  phosphorLines.length,
  facadeExports.size,
  'every Phosphor facade entry must be a named leaf export',
);

const usedIcons = new Set();
let facadeImportCount = 0;

for (const filePath of sourceFiles(rendererRoot)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(projectRoot, filePath);

  assert.doesNotMatch(
    source,
    /['"]@phosphor-icons\/react['"]/,
    `${relativePath} must not import the Phosphor root barrel`,
  );

  if (filePath !== facadePath) {
    assert.doesNotMatch(
      source,
      /['"]@phosphor-icons\/react\//,
      `${relativePath} must use the renderer icon facade instead of bypassing it`,
    );
  }

  const facadeImportPattern = /import\s*\{([^}]*)\}\s*from ['"][^'"]*phosphorIcons(?:\.js)?['"];/g;
  for (const match of source.matchAll(facadeImportPattern)) {
    facadeImportCount += 1;
    for (const rawName of match[1].split(',')) {
      const importedName = rawName.trim().split(/\s+as\s+/)[0];
      if (importedName) usedIcons.add(importedName);
    }
  }
}

assert.ok(facadeImportCount > 0, 'renderer components must import icons through the facade');

const missingExports = [...usedIcons].filter((name) => !facadeExports.has(name));
assert.deepEqual(missingExports, [], 'every used renderer icon must have a leaf facade export');

const unusedExports = [...facadeExports.keys()].filter((name) => !usedIcons.has(name));
assert.deepEqual(unusedExports, [], 'the renderer icon facade must not retain unused leaf exports');

console.log(
  `Renderer icon import checks passed (${usedIcons.size} leaf icons across ${facadeImportCount} imports).`,
);
