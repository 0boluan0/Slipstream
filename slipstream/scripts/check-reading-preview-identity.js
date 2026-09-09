'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { READING_PREVIEW } = require('../src/shared/reading-preview.cjs');
function check(appPath) {
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }));
  assert.equal(plist.CFBundleIdentifier, READING_PREVIEW.appId, 'preview must not share the installed application bundle ID');
  assert.equal(plist.CFBundleDisplayName, READING_PREVIEW.displayName, 'the privacy panel must show the preview name');
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath]);
  const identity = spawnSync('codesign', ['-d', '-r-', '--verbose=2', appPath], { encoding: 'utf8' });
  const signing = identity.stdout + identity.stderr;
  assert.equal(identity.status, 0);
  assert.match(signing, /Authority=Developer ID Application:/u, 'preview needs a stable developer signing identity');
  assert.match(signing, /designated => identifier /u);
  assert.doesNotMatch(signing, /designated => cdhash/u, 'a per-build hash makes previous macOS grants stale');
  console.log('Reading preview identity passed: separate bundle ID, clear display name, stable developer requirement and valid signature.');
}
if (require.main === module) {
  try { check(path.resolve(process.argv[2] || path.join(process.env.HOME, 'Applications', `${READING_PREVIEW.name}.app`))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { check };
