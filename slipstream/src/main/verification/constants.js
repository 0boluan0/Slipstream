const VERIFICATION_POLICIES = Object.freeze({
  LOCAL_ONLY: 'local-only',
  ASK: 'ask',
  OFFICIAL_AUTO: 'official-auto',
});

const VERIFICATION_STATUSES = Object.freeze({
  LOCAL_ONLY: 'local-only',
  APPROVAL_REQUIRED: 'approval-required',
  NOT_VERIFIED: 'not-verified',
  RETRIEVED: 'retrieved',
  VERIFIED: 'verified',
});

const POLICY_VALUES = new Set(Object.values(VERIFICATION_POLICIES));

function normalizeVerificationPolicy(policy) {
  return POLICY_VALUES.has(policy) ? policy : VERIFICATION_POLICIES.ASK;
}

module.exports = {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
};
