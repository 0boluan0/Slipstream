export function normalizeClipboardPayload(payload) {
  if (typeof payload === 'string') {
    return { text: payload, source: 'monitor', error: null, truncated: false, originalLength: payload.length };
  }
  return {
    text: payload?.text || '',
    source: payload?.source || 'monitor',
    error: payload?.error || null,
    truncated: Boolean(payload?.truncated),
    originalLength: payload?.originalLength || payload?.text?.length || 0,
    confidence: payload?.confidence ?? null,
  };
}
