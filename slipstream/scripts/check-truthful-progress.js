const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'components', 'LoadingOverlay.jsx'),
  'utf8',
);

assert.equal(
  source.includes('setTimeout('),
  false,
  'processing feedback must not advance through fake timed stages',
);
assert.equal(
  source.includes('is-complete'),
  false,
  'planned output checks must not be presented as completed work',
);
assert.match(source, /正在等待所选服务返回/);
assert.match(source, /仍在等待；你可以取消并检查模型设置/);
assert.match(source, /aria-live="polite"/);
assert.match(source, /aria-hidden="true">\{elapsedSeconds\} 秒/);

console.log('truthful processing feedback check passed');
