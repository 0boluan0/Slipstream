const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function supportTokens(value) {
  const tokens = String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [];
  return [
    ...new Set(
      tokens.filter((token) => {
        if (/[\u3400-\u9fff]/u.test(token)) return true;
        if (/^\d+$/u.test(token)) return token.length >= 2;
        return token.length >= 3 && !STOP_WORDS.has(token);
      })
    ),
  ];
}

function textTokenSet(value) {
  return new Set(String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || []);
}

function assessLexicalSupport({ query, text }) {
  const queryTokens = supportTokens(query);
  if (!queryTokens.length || !String(text || '').trim()) {
    return { supported: false, matchedTokens: [], requiredMatches: 0, totalTokens: queryTokens.length };
  }
  const pageTokens = textTokenSet(text);
  const normalizedText = String(text).toLocaleLowerCase();
  const matchedTokens = queryTokens.filter((token) =>
    /[\u3400-\u9fff]/u.test(token) ? normalizedText.includes(token) : pageTokens.has(token)
  );
  const requiredMatches =
    queryTokens.length < 2
      ? 2
      : queryTokens.length === 2
        ? 2
        : Math.max(2, Math.ceil(queryTokens.length * 0.6));
  return {
    supported: matchedTokens.length >= requiredMatches,
    matchedTokens,
    requiredMatches,
    totalTokens: queryTokens.length,
  };
}

function clipRelevantText(value, queryTokens, maxChars) {
  if (value.length <= maxChars) return value;
  const normalized = value.toLocaleLowerCase();
  const indexes = queryTokens.map((token) => normalized.indexOf(token)).filter((index) => index >= 0);
  const center = indexes.length ? Math.min(...indexes) : 0;
  let start = Math.max(0, center - Math.floor(maxChars / 3));
  let end = Math.min(value.length, start + maxChars);
  start = Math.max(0, end - maxChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < value.length ? '…' : '';
  return prefix + value.slice(start + prefix.length, end - suffix.length).trim() + suffix;
}

function selectRelevantExcerpt(value, query, maxChars) {
  const text = String(value || '').trim();
  if (!text) return '';
  const queryTokens = supportTokens(query);
  const segments = text.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  let best = segments[0] || text;
  let bestScore = -1;

  for (const segment of segments) {
    const assessment = assessLexicalSupport({ query, text: segment });
    const score = assessment.matchedTokens.length;
    if (score > bestScore || (score === bestScore && segment.length < best.length)) {
      best = segment;
      bestScore = score;
    }
  }
  return clipRelevantText(best, queryTokens, maxChars);
}

module.exports = {
  assessLexicalSupport,
  selectRelevantExcerpt,
  supportTokens,
};
