'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeManifest, verifyPair } = require('./paired-release');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-pair-check-'));
const source = { version: '1.3.0-preview.1', sourceRevision: 'a'.repeat(40) };
const metadata = { version: source.version, slipstreamSourceRevision: source.sourceRevision };
try {
  const mac = path.join(directory, 'Slipstream-arm64.dmg');
  const win = path.join(directory, 'Slipstream-x64-Setup.exe');
  fs.writeFileSync(mac, 'mac installer fixture');
  fs.writeFileSync(win, 'windows installer fixture');
  writeManifest(mac, 'darwin', 'arm64', source, metadata);
  assert.throws(() => verifyPair(directory), /exactly one/);
  writeManifest(win, 'win32', 'x64', source, metadata);
  assert.equal(verifyPair(directory).sourceRevision, source.sourceRevision);
  assert.throws(() => writeManifest(win, 'win32', 'x64', source, { ...metadata, version: '1.2.1' }), /does not match/);
  const other = { ...source, sourceRevision: 'b'.repeat(40) };
  writeManifest(win, 'win32', 'x64', other, { ...metadata, slipstreamSourceRevision: other.sourceRevision });
  assert.throws(() => verifyPair(directory), /same version and source commit/);
  writeManifest(win, 'win32', 'x64', source, metadata);
  fs.appendFileSync(win, 'changed');
  assert.throws(() => verifyPair(directory), /checksum mismatch/);
  console.log('Paired release rejects missing installers, mixed commits/versions, and altered files.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
