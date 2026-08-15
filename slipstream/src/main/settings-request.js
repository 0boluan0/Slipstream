'use strict';

const crypto = require('crypto');

const MAX_REQUEST_ID_LENGTH = 100;

function isSenderId(value) {
  return Number.isInteger(value) && value > 0;
}

function isRequestId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_REQUEST_ID_LENGTH;
}

function createSettingsRequestRegistry({ idFactory = () => crypto.randomUUID() } = {}) {
  let pending = null;

  return {
    request(senderId) {
      if (!isSenderId(senderId)) throw new Error('invalid settings-request sender');
      if (pending?.senderId === senderId) return { requestId: pending.requestId };

      const requestId = idFactory();
      if (!isRequestId(requestId)) throw new Error('invalid settings-request id');
      pending = { senderId, requestId };
      return { requestId };
    },

    acknowledge(senderId, payload) {
      if (
        !isSenderId(senderId)
        || !payload
        || typeof payload !== 'object'
        || !isRequestId(payload.requestId)
        || !pending
        || pending.senderId !== senderId
        || pending.requestId !== payload.requestId
      ) {
        return { status: 'invalid' };
      }

      pending = null;
      return { status: 'acknowledged' };
    },

    clearSender(senderId) {
      if (pending?.senderId === senderId) pending = null;
    },

    clear() {
      pending = null;
    },

    getPending(senderId) {
      if (!isSenderId(senderId)) throw new Error('invalid settings-request sender');
      if (pending?.senderId !== senderId) return null;
      return { requestId: pending.requestId };
    },

    hasPending(senderId) {
      return pending?.senderId === senderId;
    },
  };
}

module.exports = { createSettingsRequestRegistry };
