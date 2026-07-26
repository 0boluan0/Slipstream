const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let invocation;
let holdCallback = false;
let pendingCallback;
let killed = false;

Module._load = function load(request, parent, isMain) {
  if (request === 'child_process') {
    return {
      execFile: (binary, args, options, callback) => {
        invocation = { binary, args, options };
        if (holdCallback) {
          pendingCallback = callback;
          return { kill: () => { killed = true; } };
        }
        callback(null);
        return { kill: () => {} };
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

  holdCallback = true;
  const controller = new AbortController();
  const abortedCapture = service.captureSelectedRegion(undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(abortedCapture, (error) => error.isCancellation === true);
  assert.equal(killed, true, 'aborting a capture must terminate screencapture');
  pendingCallback?.(Object.assign(new Error('terminated'), { code: 'SIGTERM' }));
  console.log('native screenshot selection check passed');
}

main().finally(() => {
  Module._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
