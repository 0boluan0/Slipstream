'use strict';

const crypto = require('crypto');

function isSenderId(value) {
  return Number.isInteger(value) && value > 0;
}

function createQuitRequestRegistry({ idFactory = () => crypto.randomUUID() } = {}) {
  let pending = null;

  return {
    request(senderId) {
      if (!isSenderId(senderId)) throw new Error('invalid quit-request sender');
      if (pending?.senderId === senderId) return { requestId: pending.requestId };
      pending = { senderId, requestId: idFactory() };
      return { requestId: pending.requestId };
    },

    decide(senderId, payload) {
      if (
        !isSenderId(senderId)
        || !payload
        || typeof payload !== 'object'
        || typeof payload.requestId !== 'string'
        || payload.requestId.length < 1
        || payload.requestId.length > 100
        || typeof payload.confirmed !== 'boolean'
        || !pending
        || pending.senderId !== senderId
        || pending.requestId !== payload.requestId
      ) {
        return { status: 'invalid' };
      }

      pending = null;
      return { status: payload.confirmed ? 'confirmed' : 'cancelled' };
    },

    clearSender(senderId) {
      if (pending?.senderId === senderId) pending = null;
    },

    clear() {
      pending = null;
    },

    getPending(senderId) {
      if (!isSenderId(senderId)) throw new Error('invalid quit-request sender');
      if (pending?.senderId !== senderId) return null;
      return { requestId: pending.requestId };
    },

    hasPending(senderId) {
      return pending?.senderId === senderId;
    },
  };
}

module.exports = { createQuitRequestRegistry };
