const DEFAULT_VERIFICATION_APPROVAL_TTL_MS = 10 * 60 * 1000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function isValidSenderId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidSha256(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

function createKey(senderId, sourceSha256, approvalId) {
  return `${senderId}:${sourceSha256}:${approvalId}`;
}

function createVerificationApprovalRegistry(options = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_VERIFICATION_APPROVAL_TTL_MS;
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive safe integer');
  }

  const approvals = new Map();
  const authorityEpochs = new Map();

  function currentTime() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now must return a finite number');
    return value;
  }

  function clearExpired(at = currentTime()) {
    for (const [key, approval] of approvals) {
      if (approval.expiresAt <= at) approvals.delete(key);
    }
  }

  function getAuthorityEpoch(senderId) {
    if (!isValidSenderId(senderId)) return null;
    if (!authorityEpochs.has(senderId)) authorityEpochs.set(senderId, 0);
    return authorityEpochs.get(senderId);
  }

  function isAuthorityCurrent(senderId, authorityEpoch) {
    return Number.isSafeInteger(authorityEpoch)
      && authorityEpoch >= 0
      && getAuthorityEpoch(senderId) === authorityEpoch;
  }

  function register({ senderId, sourceSha256, approvalId, authorityEpoch } = {}) {
    if (
      !isAuthorityCurrent(senderId, authorityEpoch)
      || !isValidSha256(sourceSha256)
      || !isValidSha256(approvalId)
    ) {
      return false;
    }
    const registeredAt = currentTime();
    clearExpired(registeredAt);
    approvals.set(createKey(senderId, sourceSha256, approvalId), {
      senderId,
      sourceSha256,
      approvalId,
      expiresAt: registeredAt + ttlMs,
    });
    return true;
  }

  function consume({ senderId, sourceSha256, approvalId, authorityEpoch } = {}) {
    if (
      !isAuthorityCurrent(senderId, authorityEpoch)
      || !isValidSha256(sourceSha256)
      || !isValidSha256(approvalId)
    ) {
      return false;
    }
    const consumedAt = currentTime();
    clearExpired(consumedAt);
    const key = createKey(senderId, sourceSha256, approvalId);
    const approval = approvals.get(key);
    if (!approval || approval.expiresAt <= consumedAt) return false;
    approvals.delete(key);
    return true;
  }

  function clearSender(senderId) {
    if (!isValidSenderId(senderId)) return 0;
    let cleared = 0;
    for (const [key, approval] of approvals) {
      if (approval.senderId !== senderId) continue;
      approvals.delete(key);
      cleared += 1;
    }
    return cleared;
  }

  function revokeSender(senderId) {
    const authorityEpoch = getAuthorityEpoch(senderId);
    if (authorityEpoch === null) return null;
    clearSender(senderId);
    if (authorityEpoch === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('verification authority epoch exhausted');
    }
    const nextAuthorityEpoch = authorityEpoch + 1;
    authorityEpochs.set(senderId, nextAuthorityEpoch);
    return nextAuthorityEpoch;
  }

  function clearAll() {
    const cleared = approvals.size;
    approvals.clear();
    for (const [senderId, authorityEpoch] of authorityEpochs) {
      if (authorityEpoch === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('verification authority epoch exhausted');
      }
      authorityEpochs.set(senderId, authorityEpoch + 1);
    }
    return cleared;
  }

  return Object.freeze({
    register,
    consume,
    getAuthorityEpoch,
    isAuthorityCurrent,
    clearSender,
    revokeSender,
    clearAll,
    clearExpired,
    get size() {
      clearExpired();
      return approvals.size;
    },
  });
}

module.exports = {
  DEFAULT_VERIFICATION_APPROVAL_TTL_MS,
  createVerificationApprovalRegistry,
};
