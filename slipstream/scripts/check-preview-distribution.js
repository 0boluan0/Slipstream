'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { READING_PREVIEW } = require('../src/shared/reading-preview.cjs');

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    // Never include a subprocess command line in an error.
    throw new Error(`${path.basename(command)} failed (${result.status ?? 'unavailable'}): ${result.stderr || ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function sha256(filename) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filename, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function findPreviewApp(directory) {
  const apps = fs.readdirSync(directory).filter(name => name.endsWith('.app'));
  assert.equal(apps.length, 1, 'DMG must contain exactly one top-level application');
  const appPath = path.join(directory, apps[0]);
  assert(fs.lstatSync(appPath).isDirectory(), 'application must be a real directory, not a symlink');
  return appPath;
}

function verifySignedPreview(appPath, run = runTool) {
  const plist = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')]));
  assert.equal(plist.CFBundleIdentifier, READING_PREVIEW.appId, 'unexpected application identity');
  assert.equal(plist.CFBundleDisplayName, READING_PREVIEW.displayName, 'unexpected preview display name');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  const signature = run('/usr/bin/codesign', ['-d', '-r-', '--verbose=4', appPath]);
  assert.match(signature, /Authority=Developer ID Application:/u, 'Developer ID signature required');
  assert.match(signature, /flags=.*runtime/u, 'hardened runtime required');
  assert.match(signature, /designated => identifier /u, 'stable signing identity required');
  const teamId = signature.match(/^TeamIdentifier=([A-Z0-9]{10})$/mu)?.[1];
  const cdhash = signature.match(/^CDHash=([a-f0-9]+)$/mu)?.[1];
  assert(teamId && cdhash, 'signature must identify its team and code hash');
  const entitlements = run('/usr/bin/codesign', ['-d', '--entitlements', '-', appPath]);
  assert(entitlements.includes('com.apple.security.cs.allow-jit'), 'Electron JIT entitlement required');
  assert(!entitlements.includes('com.apple.security.cs.disable-library-validation'), 'ad-hoc library validation exception forbidden');
  return { bundleId: plist.CFBundleIdentifier, teamId, cdhash, asarSha256: sha256(path.join(appPath, 'Contents/Resources/app.asar')) };
}

function detachDmg(mount, run) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { run('/usr/bin/hdiutil', ['detach', mount]); return; }
    catch { if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
  throw new Error(`Could not detach read-only DMG; mount preserved at ${mount}`);
}

function withMountedDmg(dmgPath, inspect, run = runTool) {
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-preview-mount-'));
  let attached = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmgPath]);
    attached = true;
    return inspect(mount);
  } finally {
    if (attached) detachDmg(mount, run);
    if (fs.existsSync(mount)) fs.rmdirSync(mount);
  }
}

function verifyPreviewDistribution(dmgPath, expected, run = runTool) {
  assert(path.isAbsolute(dmgPath), 'DMG path must be absolute');
  assert(fs.lstatSync(dmgPath).isFile(), 'DMG must be a regular file');
  run('/usr/bin/codesign', ['--verify', '--strict', dmgPath]);
  const signature = run('/usr/bin/codesign', ['-d', '--verbose=4', dmgPath]);
  assert.match(signature, /Authority=Developer ID Application:/u, 'DMG needs a Developer ID signature');
  run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);
  run('/usr/sbin/spctl', ['--assess', '--verbose=2', '--type', 'open', '--context', 'context:primary-signature', dmgPath]);
  const app = withMountedDmg(dmgPath, mount => {
    const appPath = findPreviewApp(mount);
    const identity = verifySignedPreview(appPath, run);
    assert(signature.includes(`TeamIdentifier=${identity.teamId}`), 'DMG and application must share a signing team');
    if (expected) assert.deepEqual(identity, expected, 'packaged application must match the original signed application');
    run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
    run('/usr/sbin/spctl', ['--assess', '--verbose=2', '--type', 'execute', appPath]);
    return identity;
  }, run);
  return { path: dmgPath, sha256: sha256(dmgPath), app };
}

if (require.main === module) {
  try {
    if (process.platform !== 'darwin') throw new Error('Distribution verification requires macOS.');
    assert.equal(process.argv.length, 3, 'Usage: node scripts/check-preview-distribution.js /absolute/preview.dmg');
    console.log(JSON.stringify(verifyPreviewDistribution(process.argv[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { runTool, sha256, findPreviewApp, verifySignedPreview, withMountedDmg, verifyPreviewDistribution };
