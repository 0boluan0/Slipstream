const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let invocation;

Module._load = function load(request, parent, isMain) {
  if (request === 'child_process') {
    return {
      execFile: (binary, args, options, callback) => {
        invocation = { binary, args, options };
        callback(null);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const service = require('../src/main/screenshot-service');
  const selectedPath = await service.captureSelectedRegion();
  assert.equal(invocation.binary, '/usr/sbin/screencapture');
  assert.deepEqual(invocation.args.slice(0, 4), ['-i', '-x', '-t', 'png']);
  assert.equal(invocation.args[4], selectedPath);
  assert.match(selectedPath, /slipstream-[^/]+\/screenshots\/screenshot-[\w-]+\.png$/);
  console.log('native screenshot selection check passed');
}

main().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
