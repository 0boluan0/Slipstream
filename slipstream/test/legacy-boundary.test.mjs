// Static architecture contract: the earlier action workspace is frozen under
// src/main/legacy, src/shared/legacy and src/renderer/legacy. Only the listed
// integration points may load it, so the reading product cannot start
// depending on it again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_DIRECTORIES = ['src/main/legacy', 'src/shared/legacy', 'src/renderer/legacy'];
// Shrink this list as compatibility code is retired; never grow it.
const INTEGRATION_POINTS = new Set([
  'src/main/main.js',
  'src/main/llm-service.js',
  'src/main/store.js',
  'src/renderer/components/FloatingPanel.jsx',
  'src/renderer/components/SavedTermsLibrary.jsx',
]);
const SPECIFIER = /(?:require\s*\(\s*|import\s*\(\s*|from\s+|import\s+)['"](\.{1,2}\/[^'"]+)['"]/gu;

function sourceFiles(directory = path.join(root, 'src')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:c?js|mjs|jsx)$/u.test(entry.name) ? [file] : [];
  });
}

const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const isLegacy = (file) => LEGACY_DIRECTORIES.some((directory) => relative(file).startsWith(`${directory}/`));

function legacyImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(SPECIFIER)].map((match) => path.resolve(path.dirname(file), match[1])).filter(isLegacy);
}

test('only the registered integration points load frozen workspace code', () => {
  const offenders = sourceFiles()
    .filter((file) => !isLegacy(file) && legacyImports(file).length && !INTEGRATION_POINTS.has(relative(file)))
    .map(relative);
  assert.deepEqual(offenders, [], 'New code must not depend on the frozen legacy directories.');
});

test('every registered integration point still needs its exception', () => {
  const unused = [...INTEGRATION_POINTS].filter((file) => !legacyImports(path.join(root, file)).length);
  assert.deepEqual(unused, [], 'Remove integration points that no longer import legacy code.');
});

test('the renderer never loads frozen main-process or shared workspace modules', () => {
  const rendererImports = sourceFiles(path.join(root, 'src/renderer'))
    .filter((file) => legacyImports(file).some((target) => !relative(target).startsWith('src/renderer/legacy/')));
  assert.deepEqual(rendererImports.map(relative), []);
});
