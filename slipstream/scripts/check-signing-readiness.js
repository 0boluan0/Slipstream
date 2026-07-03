const { execFileSync } = require('node:child_process');

const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });

if (!output.includes('Developer ID Application')) {
  console.error('missing Developer ID Application signing identity');
  process.exit(1);
}

console.log('Developer ID Application signing identity found');
