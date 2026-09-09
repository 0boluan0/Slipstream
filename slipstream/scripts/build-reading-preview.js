'use strict';
// Separate, certificate-signed local preview. Production bundle identity and
// installed files are unchanged; this command only produces a staged .app.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveDeveloperIdIdentity, assertCleanPackagingInputs } = require('./build-macos');
const { READING_PREVIEW } = require('../src/shared/reading-preview.cjs');
const { check } = require('./check-reading-preview-identity');
const root = path.join(__dirname, '..');
function buildArguments(output, identity) {
  return ['--dir', '--mac', '--arm64', '--publish', 'never',
    `-c.directories.output=${output}`, `-c.appId=${READING_PREVIEW.appId}`,
    `-c.mac.extendInfo.CFBundleDisplayName=${READING_PREVIEW.displayName}`,
    '-c.extraMetadata.slipstreamBuildIdentity=developer-id',
    '-c.extraMetadata.slipstreamReadingPreview=true',
    '-c.extraMetadata.main=src/main/reading-preview-main.js',
    `-c.mac.identity=${identity}`, '-c.forceCodeSigning=true', '-c.mac.notarize=false',
    '-c.mac.entitlements=build/entitlements.mac.plist',
    '-c.mac.entitlementsInherit=build/entitlements.mac.plist'];
}
function build() {
  if (process.platform !== 'darwin') throw new Error('Reading preview requires macOS.');
  const identity = resolveDeveloperIdIdentity();
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-preview-'));
  const project = path.join(output, 'project');
  fs.mkdirSync(project);
  // A fresh dependency tree outside the synced workspace avoids File Provider
  // conflict copies entering the package. Source copies are still validated.
  for (const entry of ['src', 'dist', 'scripts', 'assets', 'build', 'preload.js', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
    fs.cpSync(path.join(root, entry), path.join(project, entry), { recursive: true });
  }
  const environment = { ...process.env };
  // This is a local preview, not the public release/notarization lifecycle.
  delete environment.SLIPSTREAM_REQUIRE_SIGNING;
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: project, env: environment, stdio: 'inherit' });
  assertCleanPackagingInputs(project);
  execFileSync(path.join(project, 'node_modules/.bin/electron-builder'), buildArguments(output, identity), { cwd: project, env: environment, stdio: 'inherit' });
  const built = path.join(output, 'mac-arm64/Slipstream.app');
  const preview = path.join(output, `${READING_PREVIEW.name}.app`);
  fs.renameSync(built, preview);
  check(preview);
  fs.rmSync(project, { recursive: true, force: true });
  console.log(`READING_PREVIEW_APP=${preview}`);
}
if (require.main === module) {
  try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildArguments };
