const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const releaseDir = path.join(__dirname, '..', 'release');
const architectures = ['arm64', 'x64'];

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
}

function inspectSignature(appPath) {
  const result = spawnSync('codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`unable to inspect signature: ${output.trim()}`);
  return output;
}

for (const arch of architectures) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), `slipstream-trust-${arch}-`));
  const zipPath = path.join(releaseDir, `${productName}-${pkg.version}-${arch}.zip`);
  const dmgPath = path.join(releaseDir, `${productName}-${pkg.version}-${arch}.dmg`);

  try {
    if (!fs.existsSync(zipPath) || !fs.existsSync(dmgPath)) {
      throw new Error(`missing signed ${arch} ZIP or DMG`);
    }
    run('unzip', ['-q', zipPath, '-d', tmpdir]);
    const appPath = path.join(tmpdir, `${productName}.app`);

    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
    const signature = inspectSignature(appPath);
    if (!/Authority=Developer ID Application:/i.test(signature) || /TeamIdentifier=not set/i.test(signature)) {
      throw new Error(`${arch} app is not signed with a Developer ID Application identity`);
    }
    if (!/flags=.*runtime/i.test(signature)) {
      throw new Error(`${arch} app does not have hardened runtime enabled`);
    }

    run('xcrun', ['stapler', 'validate', appPath]);
    run('spctl', ['-a', '-vv', '-t', 'exec', appPath]);
    run('xcrun', ['stapler', 'validate', dmgPath]);
    run('spctl', ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', dmgPath]);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

console.log('distribution trust check passed for arm64 and x64 ZIP/DMG artifacts');
