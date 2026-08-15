import { FULL_DATA_RESET_ERROR_CODES } from './fullDataResetErrorCodes.mjs';

const MAX_CONSEQUENCE_ID_LENGTH = 100;
const MAX_RESET_TICKET_LENGTH = 200;
const MAX_PREPARE_EXPIRY_FUTURE_MS = 5 * 60 * 1_000;
const ABORT_STATUSES = new Set(['aborted', 'invalid-ticket', 'expired-ticket']);

function normalizeConsequenceId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CONSEQUENCE_ID_LENGTH
    ? value
    : null;
}

function normalizeResetTicket(value) {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= MAX_RESET_TICKET_LENGTH
    ? value
    : null;
}

function normalizeOpaqueConsequence(candidate) {
  if (candidate == null) return null;
  const id = normalizeConsequenceId(candidate?.id);
  return id ? Object.freeze({ id }) : undefined;
}

function createResetError(code, cause = null, {
  sessionCleared = false,
  clipboardConsequence,
} = {}) {
  const error = new Error(code);
  error.code = code;
  error.sessionCleared = Boolean(sessionCleared);
  if (cause) error.cause = cause;
  const consequence = clipboardConsequence === undefined
    ? normalizeOpaqueConsequence(cause?.clipboardConsequence)
    : normalizeOpaqueConsequence(clipboardConsequence);
  if (consequence !== undefined) error.clipboardConsequence = consequence;
  return error;
}

function validatePrepareResponse(response, expectedClipboardStatus, sessionCleared) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
      null,
      { sessionCleared },
    );
  }

  if (response.status === 'clipboard-consequence-mismatch') {
    if (!Object.hasOwn(response, 'clipboardConsequence')) {
      throw createResetError(
        FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
        null,
        { sessionCleared },
      );
    }
    const consequence = normalizeOpaqueConsequence(response.clipboardConsequence);
    if (response.clipboardConsequence != null && !consequence) {
      throw createResetError(
        FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
        null,
        { sessionCleared },
      );
    }
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
      null,
      { sessionCleared, clipboardConsequence: consequence },
    );
  }

  const ticket = normalizeResetTicket(response.ticket);
  const receivedAt = Date.now();
  if (
    response.status !== 'prepared'
    || !ticket
    || response.clipboardStatus !== expectedClipboardStatus
    || !Number.isSafeInteger(response.expiresAt)
    || response.expiresAt <= receivedAt
    || response.expiresAt > receivedAt + MAX_PREPARE_EXPIRY_FUTURE_MS
  ) {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
      null,
      { sessionCleared },
    );
  }

  return { ticket, clipboardStatus: response.clipboardStatus };
}

async function bestEffortAbort(abortReset, ticket) {
  try {
    const response = await abortReset({ ticket });
    return Boolean(response && typeof response === 'object' && ABORT_STATUSES.has(response.status));
  } catch {
    return false;
  }
}

export async function runFullDataReset({
  clipboardMode = 'none',
  hasClipboardCopyConsequence = false,
  hasClipboardResidueRisk = false,
  consequenceId = null,
  sessionAlreadyCleared = false,
  prepareReset,
  abortReset,
  purgeSession,
  resetPersistentData,
} = {}) {
  let sessionCleared = Boolean(sessionAlreadyCleared);
  const hasClipboardConsequence = Boolean(
    hasClipboardCopyConsequence || hasClipboardResidueRisk,
  );
  const normalizedConsequenceId = normalizeConsequenceId(consequenceId);
  const effectiveClipboardMode = hasClipboardConsequence ? clipboardMode : 'none';

  if (clipboardMode === 'clear' || (hasClipboardConsequence && clipboardMode !== 'preserve')) {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CHOICE_REQUIRED,
      null,
      { sessionCleared },
    );
  }
  if (hasClipboardConsequence && !normalizedConsequenceId) {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CONSEQUENCE_ID_REQUIRED,
      null,
      { sessionCleared },
    );
  }
  if (
    typeof prepareReset !== 'function'
    || typeof abortReset !== 'function'
    || typeof resetPersistentData !== 'function'
  ) {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
      null,
      { sessionCleared },
    );
  }
  if (!sessionCleared && typeof purgeSession !== 'function') {
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNAVAILABLE,
      null,
      { sessionCleared },
    );
  }

  let prepared;
  try {
    const response = await prepareReset({
      clipboardMode: effectiveClipboardMode,
      clipboardConsequenceId: hasClipboardConsequence ? normalizedConsequenceId : null,
    });
    prepared = validatePrepareResponse(
      response,
      hasClipboardConsequence ? 'retained' : 'not-applicable',
      sessionCleared,
    );
  } catch (cause) {
    if (cause?.code === FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED) throw cause;
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED,
      cause,
      { sessionCleared },
    );
  }

  if (!sessionCleared) {
    let sessionResponse;
    try {
      sessionResponse = await purgeSession();
    } catch (cause) {
      await bestEffortAbort(abortReset, prepared.ticket);
      throw createResetError(
        FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNCONFIRMED,
        cause,
        { sessionCleared: false },
      );
    }
    if (sessionResponse?.status !== 'cleared') {
      await bestEffortAbort(abortReset, prepared.ticket);
      throw createResetError(
        FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNCONFIRMED,
        null,
        { sessionCleared: false },
      );
    }
    sessionCleared = true;
  }

  try {
    const persistentResponse = await resetPersistentData({ ticket: prepared.ticket });
    if (persistentResponse !== true) throw new Error('persistent-reset-unconfirmed');
  } catch (cause) {
    await bestEffortAbort(abortReset, prepared.ticket);
    throw createResetError(
      FULL_DATA_RESET_ERROR_CODES.PERSISTENT_CLEAR_UNCONFIRMED,
      cause,
      { sessionCleared: true },
    );
  }

  return {
    status: 'cleared',
    sessionCleared: true,
    clipboardStatus: prepared.clipboardStatus,
  };
}
