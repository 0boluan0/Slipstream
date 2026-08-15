'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const minimatch = require('minimatch');
const pkg = require('../package.json');

const {
  canonicalizeConflictPath,
  findFileProviderConflictCopies,
  findFileProviderConflictCopiesInEntries,
} = require('./file-provider-conflicts');
const { assertCleanPackagingInputs } = require('./build-macos');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-file-provider-conflicts-'));

function writeFixture(relativePath, contents = relativePath) {
  const filePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

try {
  writeFixture('node_modules/example/index.js', 'canonical');
  writeFixture('node_modules/example/index 3.js', 'stale conflict');
  writeFixture('node_modules/example/index.d.ts');
  writeFixture('node_modules/example/index.d 12.ts');
  writeFixture('node_modules/example/Guide 2.md');
  writeFixture('node_modules/example/package 02.json');
  writeFixture('node_modules/example/core.js 2.map');
  writeFixture('node_modules/example/LICENSE 3');
  writeFixture('node_modules/example/icon@2x.png');
  writeFixture('node_modules/example/file 2.js.map');
  writeFixture('node_modules/example/file (2).js');
  writeFixture('node_modules/example/index 3a.js');
  writeFixture('node_modules/example/index3.js');
  writeFixture('node_modules/example/lib/runtime.js');
  writeFixture('node_modules/example/lib 2/runtime.js');

  assert.deepEqual(findFileProviderConflictCopies(path.join(fixtureRoot, 'node_modules')), [
    'example/Guide 2.md',
    'example/LICENSE 3',
    'example/core.js 2.map',
    'example/index 3.js',
    'example/index.d 12.ts',
    'example/lib 2',
    'example/package 02.json',
  ]);
  assert.equal(canonicalizeConflictPath('example/index.d 12.ts'), 'example/index.d.ts');
  assert.equal(canonicalizeConflictPath('example/Guide 2.md'), 'example/Guide.md');

  assert.deepEqual(findFileProviderConflictCopiesInEntries([
    '/node_modules/example/index.js',
    '/node_modules/example/index 3.js',
    '/node_modules/example/lib',
    '/node_modules/example/lib/runtime.js',
    '/node_modules/example/lib 2',
    '/node_modules/example/lib 2/runtime.js',
    '/node_modules/example/Guide 2.md',
    '/node_modules/example/icon@2x.png',
  ]), [
    'node_modules/example/Guide 2.md',
    'node_modules/example/index 3.js',
    'node_modules/example/lib 2',
  ]);

  const conflictExclusions = pkg.build.files.slice(-2).map((pattern) => pattern.slice(1));
  const isExcluded = (entry) => conflictExclusions.some((pattern) => minimatch(entry, pattern, { dot: true }));
  for (const entry of [
    'node_modules/example/index 3.js',
    'node_modules/example/package 02.json',
    'node_modules/example/index.d 12.ts',
    'node_modules/example/core.js 2.map',
    'node_modules/example/LICENSE 3',
    'node_modules/example/resources 2',
    'node_modules/example/resources 2/chat.js',
  ]) {
    assert.equal(isExcluded(entry), true, `expected package exclusion for ${entry}`);
  }
  for (const entry of [
    'node_modules/example/index.js',
    'node_modules/example/index3.js',
    'node_modules/example/index 3a.js',
    'node_modules/example/icon@2x.png',
    'node_modules/example/release-2/file.js',
    'node_modules/example/file (2).js',
    'node_modules/example/file 2.js.map',
  ]) {
    assert.equal(isExcluded(entry), false, `unexpected package exclusion for ${entry}`);
  }

  assert.throws(
    () => assertCleanPackagingInputs(fixtureRoot),
    /File Provider conflict copies/u,
  );

  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'index 3.js'));
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'index.d 12.ts'));
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'lib 2'), { recursive: true });
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'package 02.json'));
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'core.js 2.map'));
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'LICENSE 3'));
  assert.throws(() => assertCleanPackagingInputs(fixtureRoot), /Guide 2\.md/u);
  fs.rmSync(path.join(fixtureRoot, 'node_modules', 'example', 'Guide 2.md'));
  assert.doesNotThrow(() => assertCleanPackagingInputs(fixtureRoot));

  console.log('File Provider conflict-copy gate check passed');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
