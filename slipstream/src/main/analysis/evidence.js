const MAX_EVIDENCE_QUOTES = 20;
const MAX_QUOTE_LENGTH = 2000;
const MAX_MATCHES_PER_QUOTE = 20;

function resolveEvidenceQuotes(sourceText, quotes) {
  if (typeof sourceText !== 'string' || !Array.isArray(quotes)) return [];

  const resolved = [];
  const seenQuotes = new Set();
  for (const rawQuote of quotes.slice(0, MAX_EVIDENCE_QUOTES)) {
    if (typeof rawQuote !== 'string') continue;
    const quote = rawQuote.trim();
    if (!quote || quote.length > MAX_QUOTE_LENGTH || seenQuotes.has(quote)) continue;
    seenQuotes.add(quote);

    let matches = findExactMatches(sourceText, quote);
    let matchKind = 'exact';
    if (matches.length === 0) {
      matches = findWhitespaceNormalizedMatches(sourceText, quote);
      matchKind = 'whitespace_normalized';
    }

    const ambiguous = matches.length > 1;
    for (const match of matches.slice(0, MAX_MATCHES_PER_QUOTE)) {
      resolved.push({
        quote: sourceText.slice(match.start, match.end),
        start: match.start,
        end: match.end,
        match: matchKind,
        ambiguous,
      });
    }
  }

  return deduplicateEvidence(resolved);
}

function collectCandidateQuotes(candidate, fallbackQuotes = []) {
  const values = [];
  if (Array.isArray(candidate?.evidenceQuotes)) values.push(...candidate.evidenceQuotes);
  if (Array.isArray(candidate?.evidence)) {
    for (const item of candidate.evidence) {
      if (typeof item === 'string') values.push(item);
      else if (typeof item?.quote === 'string') values.push(item.quote);
    }
  }
  values.push(...fallbackQuotes);
  return values.filter((value) => typeof value === 'string');
}

function normalizeOfficialSources(officialSources) {
  const byId = new Map();
  if (!Array.isArray(officialSources)) return byId;

  for (const source of officialSources) {
    if (!isValidOfficialSource(source) || byId.has(source.id)) continue;
    byId.set(source.id, {
      id: source.id,
      url: source.url,
      title: source.title.trim(),
      publisher: source.publisher.trim(),
      retrievedAt: new Date(source.retrievedAt).toISOString(),
      quote: typeof source.quote === 'string' && source.quote.trim() ? source.quote.trim() : null,
      official: true,
    });
  }
  return byId;
}

function resolveOfficialCitations(candidate, officialSourcesById) {
  if (!(officialSourcesById instanceof Map)) return [];
  const ids = Array.isArray(candidate?.citationIds) ? candidate.citationIds : [];
  const seen = new Set();
  const citations = [];
  for (const id of ids.slice(0, 10)) {
    if (typeof id !== 'string' || seen.has(id) || !officialSourcesById.has(id)) continue;
    seen.add(id);
    citations.push({ ...officialSourcesById.get(id) });
  }
  return citations;
}

function findExactMatches(sourceText, quote) {
  const matches = [];
  let fromIndex = 0;
  while (matches.length < MAX_MATCHES_PER_QUOTE) {
    const start = sourceText.indexOf(quote, fromIndex);
    if (start === -1) break;
    matches.push({ start, end: start + quote.length });
    fromIndex = start + 1;
  }
  return matches;
}

function findWhitespaceNormalizedMatches(sourceText, quote) {
  const normalizedSource = normalizeWhitespaceWithMap(sourceText);
  const normalizedQuote = normalizeWhitespaceWithMap(quote).text;
  if (!normalizedQuote) return [];

  const matches = [];
  let fromIndex = 0;
  while (matches.length < MAX_MATCHES_PER_QUOTE) {
    const normalizedStart = normalizedSource.text.indexOf(normalizedQuote, fromIndex);
    if (normalizedStart === -1) break;
    const normalizedEnd = normalizedStart + normalizedQuote.length;
    const sourceStart = normalizedSource.starts[normalizedStart];
    const sourceEnd = normalizedSource.ends[normalizedEnd - 1];
    if (Number.isSafeInteger(sourceStart) && Number.isSafeInteger(sourceEnd)) {
      matches.push({ start: sourceStart, end: sourceEnd });
    }
    fromIndex = normalizedStart + 1;
  }
  return matches;
}

function normalizeWhitespaceWithMap(value) {
  let text = '';
  const starts = [];
  const ends = [];
  let whitespaceStart = null;
  let whitespaceEnd = null;

  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const characterEnd = index + character.length;
    if (/\s/u.test(character)) {
      if (whitespaceStart === null) whitespaceStart = index;
      whitespaceEnd = characterEnd;
    } else {
      if (whitespaceStart !== null && text.length > 0) {
        text += ' ';
        starts.push(whitespaceStart);
        ends.push(whitespaceEnd);
      }
      for (let unit = 0; unit < character.length; unit += 1) {
        text += character[unit];
        starts.push(index + unit);
        ends.push(index + unit + 1);
      }
      whitespaceStart = null;
      whitespaceEnd = null;
    }
    index = characterEnd;
  }

  return { text, starts, ends };
}

function isValidOfficialSource(source) {
  if (!source || typeof source !== 'object' || source.official !== true) return false;
  if (typeof source.id !== 'string' || !source.id.trim()) return false;
  if (typeof source.title !== 'string' || !source.title.trim()) return false;
  if (typeof source.publisher !== 'string' || !source.publisher.trim()) return false;
  if (typeof source.retrievedAt !== 'string' || Number.isNaN(Date.parse(source.retrievedAt))) return false;
  try {
    return new URL(source.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function deduplicateEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.start}:${item.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  collectCandidateQuotes,
  normalizeOfficialSources,
  resolveEvidenceQuotes,
  resolveOfficialCitations,
};
