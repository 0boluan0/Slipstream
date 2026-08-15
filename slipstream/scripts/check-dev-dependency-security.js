const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const packageLock = require(path.join(projectRoot, 'package-lock.json'));

const MINIMATCH_3_BRACE_VERSION = '1.1.18';
const MINIMATCH_4_TO_9_BRACE_VERSION = '2.1.4';
const MINIMATCH_10_BRACE_VERSION = '5.0.9';
const FAST_URI_PATCH_VERSION = '3.1.5';
const JS_YAML_PATCH_VERSION = '4.3.1';
const NANOID_PATCH_VERSION = '3.3.18';
const UNDICI_PATCH_VERSION = '7.29.0';
const MINIMATCH_3_BRACE_INTEGRITY = 'sha512-Edep/X9fGqVNmzKBVsDYIOtD+z1tuezV70LBjdCst9Tqu76lsnvRiZ6oTic1n+/BIwX6QDGAO94PN4N2SADvtw==';
const MINIMATCH_4_TO_9_BRACE_INTEGRITY = 'sha512-hGfVzPxthbf3+2yjg/RBs60cB0FhqBS/zvdV/4wn4/BmN0bNMMHPc4V/BbFieqf1TKAGGAHnY4eSjajCl0f2Xg==';
const MINIMATCH_10_BRACE_INTEGRITY = 'sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==';
const FAST_URI_PATCH_INTEGRITY = 'sha512-gHwA1O9LDIcKunMKhObS/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw==';
const JS_YAML_PATCH_INTEGRITY = 'sha512-CY6crGq313MX8GkwvB7tzgp99vjQxY1++5y10/BKN/GUfHqWaOGQMNZkBvqSzsZKWk/ijwHlWzzkLulsGHhjWQ==';
const NANOID_PATCH_INTEGRITY = 'sha512-DTg4MJbGMWkfi6VZFdNt2/caMbQy4Ou+Op/hJQvGEWcnVfoA1QA+xzRKAzw9jD6+GVOOeYr/mIcuDSdug6F6+w==';
const UNDICI_PATCH_INTEGRITY = 'sha512-IDxfleLmmbSskfWSUATiN1nfn2rDuvnMOqb5CWR92iIfojA0Ud+ulOAAEQ57LPr9rWmsreUyf5lwyao+7GNNVw==';

assert.deepEqual(packageJson.overrides, {
  'fast-uri': FAST_URI_PATCH_VERSION,
  'js-yaml': JS_YAML_PATCH_VERSION,
  nanoid: NANOID_PATCH_VERSION,
  'undici@>=7 <8': UNDICI_PATCH_VERSION,
});

execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['ls', 'brace-expansion', 'undici', 'fast-uri', 'js-yaml', 'nanoid', '--all', '--json'],
  { cwd: projectRoot, stdio: 'pipe' },
);

const fastUriPackage = packageLock.packages?.['node_modules/fast-uri'];
assert.equal(fastUriPackage?.version, FAST_URI_PATCH_VERSION);
assert.equal(fastUriPackage?.integrity, FAST_URI_PATCH_INTEGRITY);

const jsYamlPackage = packageLock.packages?.['node_modules/js-yaml'];
assert.equal(jsYamlPackage?.version, JS_YAML_PATCH_VERSION);
assert.equal(jsYamlPackage?.integrity, JS_YAML_PATCH_INTEGRITY);

const nanoidPackage = packageLock.packages?.['node_modules/nanoid'];
assert.equal(nanoidPackage?.version, NANOID_PATCH_VERSION);
assert.equal(nanoidPackage?.integrity, NANOID_PATCH_INTEGRITY);

const undiciPackage = packageLock.packages?.['node_modules/undici'];
assert.equal(undiciPackage?.version, UNDICI_PATCH_VERSION);
assert.equal(undiciPackage?.integrity, UNDICI_PATCH_INTEGRITY);

const braceExpansionPackages = Object.entries(packageLock.packages || {})
  .filter(([packagePath]) => packagePath.endsWith('node_modules/brace-expansion'));

assert.deepEqual(
  braceExpansionPackages.map(([packagePath, metadata]) => [packagePath, metadata.version]),
  [
    ['node_modules/app-builder-lib/node_modules/brace-expansion', MINIMATCH_10_BRACE_VERSION],
    ['node_modules/brace-expansion', MINIMATCH_4_TO_9_BRACE_VERSION],
    ['node_modules/minimatch/node_modules/brace-expansion', MINIMATCH_3_BRACE_VERSION],
  ],
);

for (const [, metadata] of braceExpansionPackages) {
  const expectedIntegrity = {
    [MINIMATCH_3_BRACE_VERSION]: MINIMATCH_3_BRACE_INTEGRITY,
    [MINIMATCH_4_TO_9_BRACE_VERSION]: MINIMATCH_4_TO_9_BRACE_INTEGRITY,
    [MINIMATCH_10_BRACE_VERSION]: MINIMATCH_10_BRACE_INTEGRITY,
  }[metadata.version];
  assert.ok(expectedIntegrity, `unexpected brace-expansion version: ${metadata.version}`);
  assert.equal(metadata.integrity, expectedIntegrity);
}

const minimatch3 = require(path.join(projectRoot, 'node_modules', 'minimatch'));
const minimatch5 = require(path.join(projectRoot, 'node_modules', 'filelist', 'node_modules', 'minimatch'));
const minimatch9 = require(path.join(projectRoot, 'node_modules', '@electron', 'universal', 'node_modules', 'minimatch'));

assert.equal(typeof minimatch3, 'function');
assert.equal(minimatch3('src/App.jsx', 'src/*.{js,jsx}'), true);
assert.equal(minimatch5('src/App.jsx', 'src/*.{js,jsx}'), true);
assert.equal(minimatch9.minimatch('src/App.jsx', 'src/*.{js,jsx}'), true);
assert.deepEqual(minimatch3.braceExpand('a{b,c}d'), ['abd', 'acd']);

const legacyExpand = require(path.join(
  projectRoot,
  'node_modules',
  'minimatch',
  'node_modules',
  'brace-expansion',
));
assert.equal(typeof legacyExpand, 'function');
assert.deepEqual(legacyExpand('file-{a,b}.txt'), ['file-a.txt', 'file-b.txt']);

const bounded = legacyExpand('{a,b}'.repeat(1500), { maxLength: 100 });
const boundedLength = bounded.reduce((total, value) => total + value.length, 0);
assert.ok(boundedLength <= 100, `legacy expansion exceeded maxLength: ${boundedLength}`);

console.log('Development dependency security checks passed');
