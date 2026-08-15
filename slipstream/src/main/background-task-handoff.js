'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');

const DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS = 4_000;
const MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS = 100;
const MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS = 60_000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

function isSenderId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hashHandoffSource(sourceText) {
  if (typeof sourceText !== 'string') {
    throw new Error('background-task handoff source must be a string');
  }
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

function normalizeTaskMetadata(task) {
  if (
    !task
    || typeof task !== 'object'
    || Array.isArray(task)
    || !Number.isSafeInteger(task.id)
    || task.id < 1
    || task.kind !== 'ocr'
  ) {
    throw new Error('invalid OCR background-task metadata');
  }
  return Object.freeze({ id: task.id, kind: 'ocr' });
}

function sameSourceHash(left, right) {
  if (!SHA256_HEX_PATTERN.test(left) || !SHA256_HEX_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function createBackgroundTaskHandoffRegistry({
  timeoutMs = DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onTimeout = () => {},
} = {}) {
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS
    || timeoutMs > MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS
  ) {
    throw new Error('invalid background-task handoff timeout');
  }
  if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new Error('background-task handoff timers must be functions');
  }
  if (typeof onTimeout !== 'function') {
    throw new Error('background-task handoff timeout handler must be a function');
  }

  let pending = null;
  let pendingTimer = null;

  function snapshot(record) {
    if (!record) return null;
    return Object.freeze({
      senderId: record.senderId,
      sourceHash: record.sourceHash,
      task: Object.freeze({ ...record.task }),
    });
  }

  function settle(record) {
    if (!record || pending !== record) return null;
    pending = null;
    const timerId = pendingTimer;
    pendingTimer = null;
    if (timerId !== null) clearTimeoutFn(timerId);
    return snapshot(record);
  }

  function expire(record) {
    const expired = settle(record);
    if (!expired) return;
    onTimeout(Object.freeze({ status: 'expired', ...expired }));
  }

  function arm({ senderId, sourceText, task } = {}) {
    if (!isSenderId(senderId)) throw new Error('invalid background-task handoff sender');
    const sourceHash = hashHandoffSource(sourceText);
    const taskMetadata = normalizeTaskMetadata(task);
    const record = {
      senderId,
      sourceHash,
      task: taskMetadata,
    };

    // Schedule before replacing the old record so a timer setup failure leaves
    // the existing handoff available to its caller.
    const timerId = setTimeoutFn(() => expire(record), timeoutMs);
    const replaced = pending ? settle(pending) : null;
    pending = record;
    pendingTimer = timerId;

    return Object.freeze({
      status: 'armed',
      senderId,
      sourceHash,
      task: Object.freeze({ ...taskMetadata }),
      replaced,
    });
  }

  function claim({ senderId, sourceKind, sourceText } = {}) {
    if (!pending) return Object.freeze({ status: 'empty' });
    if (
      sourceKind !== 'ocr'
      || !isSenderId(senderId)
      || pending.senderId !== senderId
      || typeof sourceText !== 'string'
      || !sameSourceHash(pending.sourceHash, hashHandoffSource(sourceText))
    ) {
      return Object.freeze({ status: 'mismatch' });
    }

    const claimed = settle(pending);
    return Object.freeze({ status: 'claimed', ...claimed });
  }

  function cancelForSender(senderId) {
    if (!pending) return Object.freeze({ status: 'empty' });
    if (!isSenderId(senderId) || pending.senderId !== senderId) {
      return Object.freeze({ status: 'mismatch' });
    }
    const cancelled = settle(pending);
    return Object.freeze({ status: 'cancelled', ...cancelled });
  }

  function clear() {
    if (!pending) return Object.freeze({ status: 'empty' });
    const cleared = settle(pending);
    return Object.freeze({ status: 'cleared', ...cleared });
  }

  return Object.freeze({
    arm,
    claim,
    cancelForSender,
    clear,
    peek: () => snapshot(pending),
    hasPending: () => pending !== null,
  });
}

module.exports = {
  DEFAULT_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  MIN_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  MAX_BACKGROUND_TASK_HANDOFF_TIMEOUT_MS,
  hashHandoffSource,
  createBackgroundTaskHandoffRegistry,
};
