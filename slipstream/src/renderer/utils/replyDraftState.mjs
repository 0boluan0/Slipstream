export const REPLY_DRAFT_MAX_LENGTH = 30000;

const MODEL_IDENTITY_PATTERN = /^reply-v1-[a-f0-9]{16}$/;
const VALID_COMPLETION_STATUSES = new Set(['unconfirmed', 'in_progress', 'completed']);
const VALID_SELECTION_DIRECTIONS = new Set(['forward', 'backward', 'none']);

function stableSerialize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  const serialized = Array.isArray(value)
    ? `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`
    )).join(',')}}`;
  seen.delete(value);
  return serialized;
}

function hash32(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createReplyModelIdentity(model) {
  const serialized = stableSerialize(model ?? null);
  return `reply-v1-${hash32(serialized, 0x811c9dc5)}${hash32(serialized, 0x9e3779b9)}`;
}

function cleanSelection(candidate, draftLength) {
  const startCandidate = Number(candidate?.start);
  const endCandidate = Number(candidate?.end);
  const start = Number.isSafeInteger(startCandidate) && startCandidate >= 0
    ? Math.min(startCandidate, draftLength)
    : 0;
  const end = Number.isSafeInteger(endCandidate) && endCandidate >= 0
    ? Math.min(endCandidate, draftLength)
    : start;
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    direction: VALID_SELECTION_DIRECTIONS.has(candidate?.direction)
      ? candidate.direction
      : 'none',
  };
}

export function sanitizeReplyDraftState(candidate, {
  expectedModelIdentity,
  preserveOverride = true,
} = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const modelIdentity = typeof candidate.modelIdentity === 'string'
    && MODEL_IDENTITY_PATTERN.test(candidate.modelIdentity)
    ? candidate.modelIdentity
    : '';
  if (!modelIdentity || (expectedModelIdentity && modelIdentity !== expectedModelIdentity)) return null;
  const draftIsValid = typeof candidate.draft === 'string'
    && candidate.draft.length <= REPLY_DRAFT_MAX_LENGTH;
  const draft = draftIsValid ? candidate.draft : '';
  const completionStatus = draftIsValid && VALID_COMPLETION_STATUSES.has(candidate.completionStatus)
    ? candidate.completionStatus
    : 'unconfirmed';
  return {
    modelIdentity,
    draft,
    completionStatus,
    overrideConfirmed: preserveOverride
      && completionStatus === 'completed'
      && candidate.overrideConfirmed === true,
    selection: draftIsValid
      ? cleanSelection(candidate.selection, draft.length)
      : { start: 0, end: 0, direction: 'none' },
  };
}

export function createEmptyReplyDraftState(modelIdentity) {
  return sanitizeReplyDraftState({
    modelIdentity,
    draft: '',
    completionStatus: 'unconfirmed',
    overrideConfirmed: false,
    selection: { start: 0, end: 0, direction: 'none' },
  });
}

export function hasMeaningfulReplyDraftState(candidate) {
  const state = sanitizeReplyDraftState(candidate);
  return Boolean(state && (
    state.completionStatus !== 'unconfirmed'
    || state.draft.trim()
  ));
}
