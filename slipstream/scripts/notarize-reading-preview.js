'use strict';
// Notarize an existing signed binary. Never build from the current source tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { notarizationArguments, resolveDeveloperIdIdentity } = require('./build-macos');
const { runAppleTool } = require('./apple-tool-retry');
const { runTool, sha256, findPreviewApp, verifySignedPreview, withMountedDmg, verifyPreviewDistribution } = require('./check-preview-distribution');

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--input': 'input', '--output': 'output', '--work-dir': 'workDir' }[args[index]];
    assert(key && !options[key] && args[index + 1], 'Usage: --input /absolute/input.dmg --output /absolute/new.dmg [--work-dir /absolute/new-directory]');
    assert(path.isAbsolute(args[index + 1]), 'all paths must be absolute');
    options[key] = path.resolve(args[index + 1]);
  }
  assert(options.input && options.output, '--input and --output are required');
  assert(options.input !== options.output, 'input and output must differ');
  assert(options.input.endsWith('.dmg') && options.output.endsWith('.dmg'), 'input and output must be DMG files');
  return options;
}

function assertNewPath(filename) {
  try { fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Refusing to replace existing path: ${filename}`);
}

function notarizePreview(options, env = process.env) {
  assert(process.platform === 'darwin', 'Notarization requires macOS.');
  assert(fs.lstatSync(options.input).isFile(), 'input must be a regular file');
  assertNewPath(options.output);
  const outputDirectory = fs.realpathSync(path.dirname(options.output));
  const inputHash = sha256(options.input);
  // Validate credential presence before making a stage; never print the values.
  notarizationArguments(options.input, env);
  const signingIdentity = resolveDeveloperIdIdentity();
  let workDir;
  if (options.workDir) {
    assertNewPath(options.workDir);
    fs.mkdirSync(options.workDir, { mode: 0o700 });
    workDir = options.workDir;
  } else {
    workDir = fs.mkdtempSync(path.join(outputDirectory, '.slipstream-notarization-'));
  }
  console.log(`NOTARIZATION_WORK_DIR=${workDir}`);
  const payload = path.join(workDir, 'payload');
  const candidate = path.join(workDir, 'notarized-preview.dmg');
  const record = { input: options.input, inputSha256: inputHash, output: options.output, phase: 'copy-input' };
  function checkpoint(phase) {
    record.phase = phase;
    fs.writeFileSync(path.join(workDir, 'result.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  }
  function apple(tool, args) {
    const log = message => {
      let safe = String(message);
      for (const name of ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY']) {
        if (env[name]) safe = safe.split(env[name]).join('[redacted]');
      }
      fs.appendFileSync(path.join(workDir, 'apple.log'), safe, { mode: 0o600 });
      process.stdout.write(safe);
    };
    runAppleTool(tool, args, { env }, { log });
  }
  checkpoint('copy-input');
  try {
    const original = withMountedDmg(options.input, mount => {
      const identity = verifySignedPreview(findPreviewApp(mount));
      runTool('/usr/bin/ditto', [mount, payload]);
      return identity;
    });
    const appPath = findPreviewApp(payload);
    assert.deepEqual(verifySignedPreview(appPath), original, 'staged copy must preserve the signed application');
    record.app = original;
    const submission = path.join(workDir, 'app-submission.zip');
    runTool('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, submission]);
    checkpoint('notarize-app');
    apple('/usr/bin/xcrun', notarizationArguments(submission, env));
    runTool('/usr/bin/xcrun', ['stapler', 'staple', appPath]);
    runTool('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
    assert.deepEqual(verifySignedPreview(appPath), original, 'notarization must preserve application code');
    checkpoint('package-dmg');
    runTool('/usr/bin/hdiutil', ['create', '-srcfolder', payload, '-volname', 'Slipstream 阅读预览', '-format', 'UDZO', candidate]);
    apple('/usr/bin/codesign', ['--force', '--sign', signingIdentity, '--timestamp', candidate]);
    runTool('/usr/bin/codesign', ['--verify', '--strict', candidate]);
    checkpoint('notarize-dmg');
    apple('/usr/bin/xcrun', notarizationArguments(candidate, env));
    runTool('/usr/bin/xcrun', ['stapler', 'staple', candidate]);
    checkpoint('verify-final');
    const verified = verifyPreviewDistribution(candidate, original);
    assert.equal(sha256(options.input), inputHash, 'input DMG changed during notarization');
    // Link a complete sibling copy into place atomically, without overwriting.
    const pending = path.join(outputDirectory, `.slipstream-verified-${process.pid}-${Date.now()}.dmg`);
    fs.copyFileSync(candidate, pending, fs.constants.COPYFILE_EXCL);
    assert.equal(sha256(pending), verified.sha256, 'output copy must match the verified DMG');
    fs.linkSync(pending, options.output);
    fs.unlinkSync(pending);
    record.result = { ...verified, path: options.output };
    checkpoint('complete');
    console.log(`NOTARIZED_PREVIEW_DMG=${options.output}`);
    console.log(`SHA256=${verified.sha256}`);
    return record.result;
  } catch (error) {
    console.error(`Notarization stopped during ${record.phase}; original and recovery material preserved at ${workDir}`);
    throw error;
  }
}

if (require.main === module) {
  try { notarizePreview(parseArguments(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArguments, assertNewPath, notarizePreview };
