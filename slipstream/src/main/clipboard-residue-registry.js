'use strict';

const crypto = require('crypto');

const MAX_RISK_ID_LENGTH = 100;

function isSenderId(value) {
  return Number.isInteger(value) && value > 0;
}

function isRiskId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_RISK_ID_LENGTH;
}

/**
 * Tracks only whether the latest successful app-owned copy may outlive
 * renderer memory. It never stores copied text, a fingerprint, or native
 * clipboard authority.
 */
function createClipboardResidueRegistry({ idFactory = () => crypto.randomUUID() } = {}) {
  let activeRisk = null;
  const preparedBySender = new Map();

  function prepare(senderId) {
    if (!isSenderId(senderId)) throw new Error('invalid clipboard-residue sender');
    const id = idFactory();
    if (!isRiskId(id)) throw new Error('invalid clipboard-residue id');
    preparedBySender.set(senderId, id);
    return { id };
  }

  function commit(senderId, id) {
    if (
      !isSenderId(senderId)
      || !isRiskId(id)
      || preparedBySender.get(senderId) !== id
    ) {
      throw new Error('invalid prepared clipboard-residue consequence');
    }
    preparedBySender.delete(senderId);
    activeRisk = { id, senderId, interrupted: false };
    return { id };
  }

  function replace(senderId) {
    const prepared = prepare(senderId);
    return commit(senderId, prepared.id);
  }

  function get(senderId) {
    if (!isSenderId(senderId) || activeRisk?.senderId !== senderId) return null;
    return { id: activeRisk.id };
  }

  function getCurrent() {
    return activeRisk ? { id: activeRisk.id } : null;
  }

  function markInterrupted(senderId) {
    if (!isSenderId(senderId) || activeRisk?.senderId !== senderId) return null;
    activeRisk.interrupted = true;
    return { id: activeRisk.id };
  }

  function getInterrupted(senderId) {
    if (!activeRisk?.interrupted) return null;
    return get(senderId);
  }

  function resolve(senderId, id) {
    if (
      !isSenderId(senderId)
      || !isRiskId(id)
      || !activeRisk
      || activeRisk.senderId !== senderId
      || activeRisk.id !== id
    ) {
      return { status: 'invalid' };
    }
    activeRisk = null;
    return { status: 'acknowledged' };
  }

  function clearSender(senderId) {
    preparedBySender.delete(senderId);
    if (activeRisk?.senderId === senderId) activeRisk = null;
  }

  function clearAll() {
    preparedBySender.clear();
    activeRisk = null;
  }

  function adoptSender(senderId) {
    if (!isSenderId(senderId)) throw new Error('invalid clipboard-residue sender');
    if (!activeRisk) return null;
    activeRisk.senderId = senderId;
    return { id: activeRisk.id };
  }

  return {
    prepare,
    commit,
    replace,
    get,
    getCurrent,
    markInterrupted,
    getInterrupted,
    resolve,
    adoptSender,
    clearSender,
    clearAll,
    hasRisk: (senderId) => get(senderId) !== null,
    hasInterruptedRisk: (senderId) => getInterrupted(senderId) !== null,
    pendingCount: () => (activeRisk ? 1 : 0),
  };
}

module.exports = {
  MAX_RISK_ID_LENGTH,
  createClipboardResidueRegistry,
};
