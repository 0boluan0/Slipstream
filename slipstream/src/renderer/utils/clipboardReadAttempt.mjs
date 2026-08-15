export function isCurrentClipboardReadAttempt(attemptToken, currentToken) {
  return Number.isSafeInteger(attemptToken)
    && Number.isSafeInteger(currentToken)
    && attemptToken === currentToken;
}

export function classifyClipboardReadAttempt(response, attemptToken, currentToken) {
  if (!isCurrentClipboardReadAttempt(attemptToken, currentToken)) {
    return { status: 'stale', payload: null };
  }

  const rawPayload = typeof response === 'string'
    ? { text: response, truncated: false, originalLength: response.length }
    : response && typeof response === 'object'
      ? response
      : {};
  const text = typeof rawPayload.text === 'string' ? rawPayload.text : '';

  if (!text.trim()) return { status: 'empty', payload: null };

  return {
    status: 'ready',
    payload: {
      text,
      truncated: rawPayload.truncated === true,
      originalLength: Number.isSafeInteger(rawPayload.originalLength)
        && rawPayload.originalLength >= text.length
        ? rawPayload.originalLength
        : text.length,
    },
  };
}
