'use strict';

const assert = require('node:assert/strict');

const { createSettingsRequestRegistry } = require('../src/main/settings-request');

let sequence = 0;
const registry = createSettingsRequestRegistry({
  idFactory: () => `settings-${sequence += 1}`,
});

assert.throws(() => registry.request(0), /invalid settings-request sender/);
assert.throws(() => registry.getPending(0), /invalid settings-request sender/);

assert.deepEqual(registry.request(7), { requestId: 'settings-1' });
assert.deepEqual(registry.request(7), { requestId: 'settings-1' },
  'a sender must replay its active Settings request instead of creating another one');
assert.equal(registry.hasPending(7), true);
assert.deepEqual(registry.getPending(7), { requestId: 'settings-1' });
assert.equal(registry.getPending(8), null);

for (const payload of [
  null,
  {},
  { requestId: '' },
  { requestId: 'x'.repeat(101) },
  { requestId: 'stale' },
]) {
  assert.deepEqual(registry.acknowledge(7, payload), { status: 'invalid' },
    'malformed or stale acknowledgement must fail closed');
  assert.equal(registry.hasPending(7), true,
    'an invalid acknowledgement must not consume the pending Settings request');
}

assert.deepEqual(registry.acknowledge(8, { requestId: 'settings-1' }), { status: 'invalid' },
  'a different sender must not acknowledge another renderer\'s Settings request');
assert.equal(registry.hasPending(7), true);

assert.deepEqual(registry.acknowledge(7, { requestId: 'settings-1' }), {
  status: 'acknowledged',
});
assert.equal(registry.hasPending(7), false);
assert.equal(registry.getPending(7), null);
assert.deepEqual(registry.acknowledge(7, { requestId: 'settings-1' }), { status: 'invalid' },
  'a settled Settings request must not be replay-acknowledged');

assert.deepEqual(registry.request(7), { requestId: 'settings-2' });
assert.deepEqual(registry.request(8), { requestId: 'settings-3' },
  'a new sender must replace the old sender-bound request');
assert.equal(registry.getPending(7), null);
assert.deepEqual(registry.getPending(8), { requestId: 'settings-3' });
registry.clearSender(7);
assert.equal(registry.hasPending(8), true,
  'clearing a different sender must preserve the active Settings request');
registry.clearSender(8);
assert.equal(registry.hasPending(8), false);

assert.deepEqual(registry.request(9), { requestId: 'settings-4' });
registry.clear();
assert.equal(registry.getPending(9), null);

assert.throws(() => createSettingsRequestRegistry({ idFactory: () => '' }).request(1),
  /invalid settings-request id/);
assert.throws(() => createSettingsRequestRegistry({ idFactory: () => 'x'.repeat(101) }).request(1),
  /invalid settings-request id/);

console.log('Settings request registry checks passed.');
