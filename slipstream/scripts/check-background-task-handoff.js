'use strict';

const assert = require('node:assert/strict');

const {
  DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  hashHandoffSource,
  createBackgroundTaskHandoffRegistry,
} = require('../src/main/background-task-handoff');

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map();
  const callbacks = [];
  const cleared = [];

  const setTimeoutFn = (callback, delay) => {
    const id = nextId;
    nextId += 1;
    callbacks.push(callback);
    scheduled.set(id, { callback, dueAt: now + delay });
    return id;
  };

  const clearTimeoutFn = (id) => {
    cleared.push(id);
    scheduled.delete(id);
  };

  const advanceBy = (duration) => {
    now += duration;
    let ranCallback = true;
    while (ranCallback) {
      ranCallback = false;
      const due = [...scheduled.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0]);
      if (due.length > 0) {
        const [id, timer] = due[0];
        scheduled.delete(id);
        timer.callback();
        ranCallback = true;
      }
    }
  };

  return {
    setTimeoutFn,
    clearTimeoutFn,
    advanceBy,
    getCallback: (index) => callbacks[index],
    pendingCount: () => scheduled.size,
    clearedCount: () => cleared.length,
  };
}

function createRegistry({ timers = createFakeTimers(), onTimeout = () => {} } = {}) {
  return {
    timers,
    registry: createBackgroundTaskHandoffRegistry({
      timeoutMs: DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      onTimeout,
    }),
  };
}

assert.equal(DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS, 4_000);
assert.ok(MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS > 0);
assert.ok(MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS >= DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS);
assert.throws(
  () => createBackgroundTaskHandoffRegistry({
    timeoutMs: MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS - 1,
  }),
  /invalid background-task handoff timeout/,
);
assert.throws(
  () => createBackgroundTaskHandoffRegistry({
    timeoutMs: MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS + 1,
  }),
  /invalid background-task handoff timeout/,
);

const sourceText = 'PRIVATE OCR SOURCE: bank reference 1934';
const otherSourceText = 'PRIVATE OCR SOURCE: bank reference 2841';
const ignoredTaskSecret = 'TASK_OBJECT_MUST_NOT_RETAIN_THIS_TEXT';
assert.match(hashHandoffSource(sourceText), /^[a-f0-9]{64}$/u);
assert.notEqual(hashHandoffSource(sourceText), hashHandoffSource(otherSourceText));

const successTimeouts = [];
const success = createRegistry({ onTimeout: (event) => successTimeouts.push(event) });
const armed = success.registry.arm({
  senderId: 41,
  sourceText,
  task: {
    id: 101,
    kind: 'ocr',
    sourceText: ignoredTaskSecret,
    nested: { apiKey: ignoredTaskSecret },
  },
});
assert.equal(armed.status, 'armed');
assert.equal(armed.replaced, null);
assert.deepEqual(armed.task, { id: 101, kind: 'ocr' });
assert.deepEqual(success.registry.peek(), {
  senderId: 41,
  sourceHash: hashHandoffSource(sourceText),
  task: { id: 101, kind: 'ocr' },
});
assert.equal(success.registry.hasPending(), true);
assert.equal(success.timers.pendingCount(), 1);

assert.deepEqual(success.registry.claim({
  senderId: 41,
  sourceKind: 'clipboard',
  sourceText,
}), { status: 'mismatch' });
assert.deepEqual(success.registry.claim({
  senderId: 42,
  sourceKind: 'ocr',
  sourceText,
}), { status: 'mismatch' });
assert.deepEqual(success.registry.claim({
  senderId: 41,
  sourceKind: 'ocr',
  sourceText: otherSourceText,
}), { status: 'mismatch' });
assert.equal(success.registry.hasPending(), true, 'mismatches must not consume the handoff');
assert.equal(success.timers.pendingCount(), 1);

const staleSuccessTimer = success.timers.getCallback(0);
const claimed = success.registry.claim({
  senderId: 41,
  sourceKind: 'ocr',
  sourceText,
});
assert.equal(claimed.status, 'claimed');
assert.deepEqual(claimed.task, { id: 101, kind: 'ocr' });
assert.equal(success.registry.hasPending(), false);
assert.equal(success.timers.pendingCount(), 0);
assert.equal(success.timers.clearedCount(), 1);
staleSuccessTimer();
assert.equal(successTimeouts.length, 0, 'a claimed task must never settle again by timeout');
assert.deepEqual(success.registry.claim({
  senderId: 41,
  sourceKind: 'ocr',
  sourceText,
}), { status: 'empty' });

const timeoutEvents = [];
const timeout = createRegistry({ onTimeout: (event) => timeoutEvents.push(event) });
timeout.registry.arm({
  senderId: 51,
  sourceText: otherSourceText,
  task: { id: 102, kind: 'ocr' },
});
const firedTimeout = timeout.timers.getCallback(0);
timeout.timers.advanceBy(DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS - 1);
assert.equal(timeoutEvents.length, 0);
assert.equal(timeout.registry.hasPending(), true);
timeout.timers.advanceBy(1);
assert.equal(timeoutEvents.length, 1);
assert.equal(timeoutEvents[0].status, 'expired');
assert.deepEqual(timeoutEvents[0].task, { id: 102, kind: 'ocr' });
assert.equal(timeout.registry.hasPending(), false);
assert.equal(timeout.timers.pendingCount(), 0);
firedTimeout();
assert.equal(timeoutEvents.length, 1, 'a timeout callback must settle at most once');

const cancelledTimeouts = [];
const cancelled = createRegistry({ onTimeout: (event) => cancelledTimeouts.push(event) });
cancelled.registry.arm({
  senderId: 61,
  sourceText,
  task: { id: 103, kind: 'ocr' },
});
assert.deepEqual(cancelled.registry.cancelForSender(62), { status: 'mismatch' });
assert.equal(cancelled.registry.hasPending(), true);
const cancellation = cancelled.registry.cancelForSender(61);
assert.equal(cancellation.status, 'cancelled');
assert.deepEqual(cancellation.task, { id: 103, kind: 'ocr' });
assert.equal(cancelled.timers.pendingCount(), 0);
cancelled.timers.advanceBy(DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS);
assert.equal(cancelledTimeouts.length, 0);

const clearedTimeouts = [];
const cleared = createRegistry({ onTimeout: (event) => clearedTimeouts.push(event) });
cleared.registry.arm({
  senderId: 71,
  sourceText,
  task: { id: 104, kind: 'ocr' },
});
const clearResult = cleared.registry.clear();
assert.equal(clearResult.status, 'cleared');
assert.deepEqual(clearResult.task, { id: 104, kind: 'ocr' });
assert.equal(cleared.timers.pendingCount(), 0);
assert.deepEqual(cleared.registry.clear(), { status: 'empty' });
cleared.timers.advanceBy(DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS);
assert.equal(clearedTimeouts.length, 0);

const rearmTimeouts = [];
const rearmed = createRegistry({ onTimeout: (event) => rearmTimeouts.push(event) });
const firstArm = rearmed.registry.arm({
  senderId: 81,
  sourceText,
  task: { id: 105, kind: 'ocr' },
});
const staleRearmTimer = rearmed.timers.getCallback(0);
const secondArm = rearmed.registry.arm({
  senderId: 82,
  sourceText: otherSourceText,
  task: { id: 106, kind: 'ocr' },
});
assert.equal(firstArm.replaced, null);
assert.equal(secondArm.status, 'armed');
assert.deepEqual(secondArm.replaced, {
  senderId: 81,
  sourceHash: hashHandoffSource(sourceText),
  task: { id: 105, kind: 'ocr' },
});
assert.equal(rearmed.timers.pendingCount(), 1, 're-arm must clear the old timer');
staleRearmTimer();
assert.equal(rearmTimeouts.length, 0, 'a replaced timer must not settle the new handoff');
assert.equal(rearmed.registry.hasPending(), true);
assert.equal(rearmed.registry.peek().senderId, 82);
assert.equal(rearmed.registry.claim({
  senderId: 82,
  sourceKind: 'ocr',
  sourceText: otherSourceText,
}).status, 'claimed');

assert.throws(
  () => rearmed.registry.arm({
    senderId: 91,
    sourceText,
    task: { id: 107, kind: 'analysis' },
  }),
  /invalid OCR background-task metadata/,
);

const serializedPublicState = JSON.stringify({
  armed,
  claimed,
  timeoutEvents,
  cancellation,
  clearResult,
  firstArm,
  secondArm,
  finalPeek: rearmed.registry.peek(),
});
for (const secret of [sourceText, otherSourceText, ignoredTaskSecret]) {
  assert.equal(serializedPublicState.includes(secret), false, `handoff state leaked ${secret}`);
}

console.log('Background task handoff checks passed.');
