const assert = require('node:assert/strict');
const { runAppleTool } = require('./apple-tool-retry');

const id = '48dc30bb-04ca-4fe8-a1d6-12fedccb46bc';
const submit = ['notarytool', 'submit', '/tmp/authored-app.zip', '--wait', '--no-s3-acceleration', '--keychain', '/tmp/fixture.keychain', '--keychain-profile', 'fixture'];
function failure(stderr, stdout = '') {
  return Object.assign(new Error('command line includes fixture-password'), { stderr, stdout });
}
function replay(args, failures) {
  const calls = [];
  const pauses = [];
  let error;
  try {
    runAppleTool('/usr/bin/xcrun', args, {}, {
      execute: (_tool, actual) => {
        calls.push([...actual]);
        if (calls.length <= failures.length) throw failures[calls.length - 1];
        return 'status: Accepted\n';
      },
      pause: delay => pauses.push(delay),
      log: () => {},
    });
  } catch (caught) { error = caught; }
  return { calls, pauses, error };
}

// An accepted upload must survive a dropped polling connection without a second upload.
const resumed = replay(submit, [
  failure('NSURLErrorDomain Code=-1009: offline', `Submission ID received\n id: ${id}\nSuccessfully uploaded file\nWaiting for processing to complete.\n`),
  failure('NSURLErrorDomain Code=-1005: connection lost'),
]);
const wait = ['notarytool', 'wait', id, '--keychain', '/tmp/fixture.keychain', '--keychain-profile', 'fixture'];
assert.equal(resumed.error, undefined);
assert.deepEqual(resumed.calls, [submit, wait, wait]);
assert.deepEqual(resumed.pauses, [3000, 10000]);

// A submission id alone does not prove the binary reached Apple.
const incomplete = replay(submit, [failure('HTTPClientError.connectTimeout', `Submission ID received\n id: ${id}`)]);
assert.deepEqual(incomplete.calls, [submit, submit]);
assert.equal(incomplete.error, undefined);

const signing = ['--force', '--sign', 'fixture', '--timestamp', '/tmp/authored-app.dmg'];
const timestamp = replay(signing, [failure('The timestamp service is not available.')]);
assert.deepEqual(timestamp.calls, [signing, signing]);

const rejected = replay(submit, [failure('The signature is invalid.')]);
assert.equal(rejected.calls.length, 1);
assert.deepEqual(rejected.pauses, []);
assert.match(rejected.error.message, /Apple tool failed/);
assert.doesNotMatch(rejected.error.message, /fixture-password/);

const unavailable = replay(submit, Array.from({ length: 5 }, () => failure('HTTPClientError.connectTimeout')));
assert.equal(unavailable.calls.length, 4);
assert.deepEqual(unavailable.pauses, [3000, 10000, 20000]);
assert.match(unavailable.error.message, /Apple tool failed/);
console.log('Apple transport retries passed: resume uploaded submissions, preserve commands, reject permanent failures, bound retries and protect credentials.');
