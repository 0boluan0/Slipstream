import { sanitizeReplyDraftState } from './replyDraftState.mjs';

export const CLEAR_UNDO_WINDOW_MS = 10000;

export function getClearUndoSecondsRemaining(expiresAt, now = Date.now()) {
  const expiry = Number(expiresAt);
  const currentTime = Number(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(currentTime)) return 0;
  return Math.max(0, Math.ceil((expiry - currentTime) / 1000));
}

export function pauseClearUndoWindow(session, now = Date.now()) {
  const expiresAt = Number(session?.expiresAt);
  const currentTime = Number(now);
  if (
    !session
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(currentTime)
    || expiresAt <= currentTime
  ) return session || null;
  return {
    ...session,
    expiresAt: null,
    remainingMs: expiresAt - currentTime,
  };
}

export function resumeClearUndoWindow(session, now = Date.now()) {
  const remainingMs = Number(session?.remainingMs);
  const currentTime = Number(now);
  if (
    !session
    || !Number.isFinite(remainingMs)
    || remainingMs <= 0
    || !Number.isFinite(currentTime)
  ) return session || null;
  return {
    ...session,
    expiresAt: currentTime + remainingMs,
    remainingMs: null,
  };
}

const SNAPSHOT_FIELDS = Object.freeze([
  'inputText',
  'processedSourceText',
  'brief',
  'result',
  'captureMeta',
  'sourceMeta',
  'status',
  'warning',
  'error',
  'captureErrorCode',
  'processingErrorCode',
  'processingTimeMs',
  'verificationTimeMs',
  'sourceType',
  'lastGood',
  'completedActionIds',
  'isEditingSource',
  'sourceEditDraft',
  'replyDraftState',
]);

export function createClearedSessionSnapshot(session = {}) {
  const snapshot = {};
  for (const field of SNAPSHOT_FIELDS) snapshot[field] = session[field];
  snapshot.replyDraftState = sanitizeReplyDraftState(session.replyDraftState);
  snapshot.hadVerificationApproval = Boolean(session.verificationApprovalId);
  return snapshot;
}

export function prepareClearedSessionRestore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const verificationWarning = snapshot.hadVerificationApproval
    ? '内容已恢复；此前的官方核验授权没有恢复，如需核验请重新分析。'
    : '';
  const warning = [snapshot.warning, verificationWarning].filter(Boolean).join(' ');
  return {
    ...snapshot,
    status: snapshot.status === 'processing' ? 'idle' : snapshot.status,
    warning,
    verificationApprovalId: null,
    replyDraftState: sanitizeReplyDraftState(snapshot.replyDraftState),
    lastGood: snapshot.lastGood ? {
      ...snapshot.lastGood,
      warning,
      verificationApprovalId: null,
    } : null,
  };
}
