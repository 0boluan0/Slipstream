const { execFileSync } = require('node:child_process');
const path = require('node:path');

const pkg = require('../package.json');
const productName = pkg.build?.productName || pkg.name;
const appDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const appPath = path.join(__dirname, '..', 'release', appDir, `${productName}.app`);

for (const [name, command, args] of [
  ['codesign', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]],
  ['spctl', 'spctl', ['-a', '-vv', '-t', 'exec', appPath]],
]) {
  try {
    execFileSync(command, args, { stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
    console.error(`${name} distribution check failed${output ? `: ${output}` : ''}`);
    process.exit(1);
  }
}

console.log('distribution trust check passed');
