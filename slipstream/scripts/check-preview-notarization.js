'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArguments, assertNewPath } = require('./notarize-reading-preview');
const { findPreviewApp, verifySignedPreview, verifyPreviewDistribution } = require('./check-preview-distribution');
const { READING_PREVIEW } = require('../src/shared/reading-preview.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-notary-check-'));
function fixtureApp(parent) {
  const app = path.join(parent, `${READING_PREVIEW.name}.app`);
  fs.mkdirSync(path.join(app, 'Contents/Resources'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/Resources/app.asar'), 'fixed fictional application');
  return app;
}
function runner(overrides = {}) {
  const calls = [];
  function run(command, args) {
    calls.push([command, args]);
    if (command.endsWith('plutil')) return JSON.stringify({ CFBundleIdentifier: overrides.bundleId || READING_PREVIEW.appId, CFBundleDisplayName: READING_PREVIEW.displayName });
    if (command.endsWith('codesign')) {
      if (args.includes('--verify') && overrides.invalidSignature) throw new Error('invalid signature');
      if (args.includes('--entitlements')) return 'com.apple.security.cs.allow-jit' + (overrides.adhoc ? ' com.apple.security.cs.disable-library-validation' : '');
      return `Authority=Developer ID Application: Fictional Test\nTeamIdentifier=ABCDE12345\nCDHash=abc123\nflags=0x10000(${overrides.noRuntime ? 'none' : 'runtime'})\ndesignated => identifier "${READING_PREVIEW.appId}"\n`;
    }
    if (command.endsWith('xcrun') && overrides.noTicket && args.at(-1).endsWith('.app')) throw new Error('missing app ticket');
    if (command.endsWith('spctl') && overrides.gatekeeperRejects) throw new Error('Gatekeeper rejected');
    if (command.endsWith('hdiutil') && args[0] === 'attach') fixtureApp(args[args.indexOf('-mountpoint') + 1]);
    if (command.endsWith('hdiutil') && args[0] === 'detach') fs.rmSync(findPreviewApp(args[1]), { recursive: true });
    return '';
  }
  return { run, calls };
}

try {
  assert.throws(() => parseArguments(['--input', '/tmp/same.dmg', '--output', '/tmp/same.dmg']), /must differ/u);
  assert.throws(() => parseArguments(['--input', 'relative.dmg', '--output', '/tmp/out.dmg']), /absolute/u);
  assert.throws(() => parseArguments(['--input', '/tmp/in.dmg', '--output', '/tmp/out.dmg', '--unknown', '/tmp/value']), /Usage/u);
  assertNewPath(path.join(directory, 'new.dmg'));
  const dmg = path.join(directory, 'input.dmg');
  fs.writeFileSync(dmg, 'fixed fictional DMG');
  assert.throws(() => assertNewPath(dmg), /Refusing to replace/u);
  const dangling = path.join(directory, 'dangling.dmg');
  fs.symlinkSync(path.join(directory, 'absent'), dangling);
  assert.throws(() => assertNewPath(dangling), /Refusing to replace/u);
  const app = fixtureApp(directory);
  const trusted = verifySignedPreview(app, runner().run);
  for (const settings of [{ bundleId: 'com.example.unrelated' }, { invalidSignature: true }, { noRuntime: true }, { adhoc: true }]) {
    assert.throws(() => verifySignedPreview(app, runner(settings).run));
  }
  for (const settings of [{ invalidSignature: true }, { noTicket: true }, { gatekeeperRejects: true }]) {
    assert.throws(() => verifyPreviewDistribution(dmg, trusted, runner(settings).run));
  }
  assert.throws(() => verifyPreviewDistribution(dmg, { ...trusted, asarSha256: 'different' }, runner().run), /must match/u);
  const accepted = runner();
  assert.deepEqual(verifyPreviewDistribution(dmg, trusted, accepted.run).app, trusted);
  assert(accepted.calls.some(([command, args]) => command.endsWith('hdiutil') && args[0] === 'detach'), 'verification must detach its mounted image');
  assert(accepted.calls.some(([command, args]) => command.endsWith('xcrun') && args[0] === 'stapler' && args.at(-1).endsWith('.app')), 'must inspect the actual packaged app ticket');
  fs.rmSync(app, { recursive: true });
  fs.symlinkSync('/Applications/Fictional.app', app);
  assert.throws(() => findPreviewApp(directory), /real directory/u);
  console.log('Preview notarization checks passed: immutable input/output boundaries, signed identity, hardened runtime, final app tickets, Gatekeeper rejection and packaged-code preservation. No Apple requests were made.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
