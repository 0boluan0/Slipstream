'use strict';

const crypto = require('crypto');

const DEFAULT_USER_DATA_RESET_TTL_MS = 30_000;
const MAX_RESET_TICKET_LENGTH = 200;
const MAX_CONSEQUENCE_ID_LENGTH = 100;

function isSenderId(value) {
  return Number.isInteger(value) && value > 0;
}

function isTicket(value) {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= MAX_RESET_TICKET_LENGTH;
}

function isConsequenceId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CONSEQUENCE_ID_LENGTH;
}

function normalizeConsequence(candidate) {
  if (candidate == null) return { valid: true, value: null };
  if (!isConsequenceId(candidate?.id)) return { valid: false, value: null };
  return { valid: true, value: { id: candidate.id } };
}

function createUserDataResetRegistry({
  idFactory = () => crypto.randomBytes(32).toString('base64url'),
  now = () => Date.now(),
  ttlMs = DEFAULT_USER_DATA_RESET_TTL_MS,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60 * 1_000) {
    throw new Error('invalid user-data reset ticket ttl');
  }

  const pendingBySender = new Map();

  function remove(record) {
    if (record && pendingBySender.get(record.senderId) === record) {
      pendingBySender.delete(record.senderId);
    }
  }

  function getLiveRecord(senderId) {
    const record = pendingBySender.get(senderId) || null;
    if (!record) return { record: null, expired: false };
    if (record.expiresAt > now()) return { record, expired: false };
    remove(record);
    return { record: null, expired: true };
  }

  function prepare(senderId, payload, currentConsequence) {
    if (!isSenderId(senderId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { status: 'invalid' };
    }

    const existing = getLiveRecord(senderId);
    if (existing.record) return { status: 'busy' };

    const consequence = normalizeConsequence(currentConsequence);
    if (!consequence.valid) return { status: 'invalid' };

    const clipboardMode = payload.clipboardMode;
    const suppliedId = payload.clipboardConsequenceId;
    const validNoneChoice = clipboardMode === 'none' && suppliedId === null;
    const validPreserveChoice = clipboardMode === 'preserve' && isConsequenceId(suppliedId);
    if (!validNoneChoice && !validPreserveChoice) return { status: 'invalid' };

    const expectedId = consequence.value?.id || null;
    if (
      (expectedId && (!validPreserveChoice || suppliedId !== expectedId))
      || (!expectedId && !validNoneChoice)
    ) {
      return {
        status: 'clipboard-consequence-mismatch',
        clipboardConsequence: consequence.value,
      };
    }

    const ticket = idFactory();
    if (!isTicket(ticket)) throw new Error('invalid user-data reset ticket');
    const record = {
      senderId,
      ticket,
      clipboardMode,
      consequenceId: expectedId,
      expiresAt: now() + ttlMs,
    };
    pendingBySender.set(senderId, record);
    return {
      status: 'prepared',
      ticket,
      clipboardStatus: expectedId ? 'retained' : 'not-applicable',
      expiresAt: record.expiresAt,
    };
  }

  function consume(senderId, ticket, currentConsequence) {
    if (!isSenderId(senderId) || !isTicket(ticket)) return { status: 'invalid-ticket' };
    const live = getLiveRecord(senderId);
    if (live.expired) return { status: 'expired-ticket' };
    const record = live.record;
    if (!record || record.ticket !== ticket) return { status: 'invalid-ticket' };

    // An exact ticket is one-shot even when the consequence changed. This
    // prevents a failed authorization from being replayed after state moves.
    remove(record);
    const consequence = normalizeConsequence(currentConsequence);
    if (!consequence.valid) return { status: 'invalid-ticket' };
    const currentId = consequence.value?.id || null;
    if (currentId !== record.consequenceId) {
      return {
        status: 'clipboard-consequence-changed',
        clipboardConsequence: consequence.value,
      };
    }

    return {
      status: 'authorized',
      clipboardStatus: record.consequenceId ? 'retained' : 'not-applicable',
    };
  }

  function abort(senderId, ticket) {
    if (!isSenderId(senderId) || !isTicket(ticket)) return { status: 'invalid-ticket' };
    const live = getLiveRecord(senderId);
    if (live.expired) return { status: 'expired-ticket' };
    const record = live.record;
    if (!record || record.ticket !== ticket) return { status: 'invalid-ticket' };
    remove(record);
    return { status: 'aborted' };
  }

  function isLocked(senderId) {
    if (!isSenderId(senderId)) return false;
    return Boolean(getLiveRecord(senderId).record);
  }

  function clearSender(senderId) {
    if (isSenderId(senderId)) pendingBySender.delete(senderId);
  }

  function clearAll() {
    pendingBySender.clear();
  }

  function pendingCount() {
    for (const senderId of pendingBySender.keys()) getLiveRecord(senderId);
    return pendingBySender.size;
  }

  return {
    prepare,
    consume,
    abort,
    isLocked,
    clearSender,
    clearAll,
    pendingCount,
  };
}

module.exports = {
  DEFAULT_USER_DATA_RESET_TTL_MS,
  createUserDataResetRegistry,
};
