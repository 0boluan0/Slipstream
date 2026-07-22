const { assertSafeHostname, parseSafeHttpsUrl } = require('./url-safety');

const CONSERVATIVE_OFFICIAL_SUFFIXES = Object.freeze([
  '.ac.jp',
  '.ac.kr',
  '.ac.uk',
  '.canada.ca',
  '.edu',
  '.edu.au',
  '.edu.cn',
  '.edu.hk',
  '.edu.tw',
  '.europa.eu',
  '.gc.ca',
  '.go.jp',
  '.go.kr',
  '.gouv.fr',
  '.gov',
  '.gov.au',
  '.gov.cn',
  '.gov.hk',
  '.gov.ie',
  '.gov.mo',
  '.gov.scot',
  '.gov.tw',
  '.gov.uk',
  '.govt.nz',
  '.mil',
  '.nhs.uk',
  '.police.uk',
]);

function normalizeTrustedHost(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('trusted host must be a non-empty string');
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes('://')) {
    const url = parseSafeHttpsUrl(trimmed);
    if (url.pathname !== '/' || url.search) throw new TypeError('trusted host URL must not contain a path or query');
    return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  }
  if (/[/@:*?#]/.test(trimmed)) throw new TypeError('trusted host must contain only a hostname');
  return assertSafeHostname(trimmed);
}

function normalizeTrustedHosts(values = []) {
  if (!Array.isArray(values)) throw new TypeError('trustedHosts must be an array');
  return Object.freeze([...new Set(values.map(normalizeTrustedHost))]);
}

function hostMatches(hostname, expectedHost) {
  return hostname === expectedHost || hostname.endsWith('.' + expectedHost);
}

function isConservativeOfficialHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return CONSERVATIVE_OFFICIAL_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix)
  );
}

function isTrustedOfficialUrl(value, trustedHosts = []) {
  let url;
  try {
    url = parseSafeHttpsUrl(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return (
    isConservativeOfficialHost(hostname) ||
    trustedHosts.some((trustedHost) => hostMatches(hostname, trustedHost))
  );
}

module.exports = {
  CONSERVATIVE_OFFICIAL_SUFFIXES,
  isConservativeOfficialHost,
  isTrustedOfficialUrl,
  normalizeTrustedHost,
  normalizeTrustedHosts,
};
