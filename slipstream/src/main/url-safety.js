const dns = require('node:dns');
const net = require('node:net');

const BLOCKED_HOST_SUFFIXES = [
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.onion',
  '.test',
];

const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

class UnsafeUrlError extends Error {
  constructor(message, code = 'unsafe-url') {
    super(message);
    this.name = 'UnsafeUrlError';
    this.code = code;
  }
}

function ipv4ToBigInt(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6ToBigInt(address) {
  const withoutZone = address.toLowerCase().split('%')[0];
  let normalized = withoutZone;
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = ipv4ToBigInt(ipv4Tail);
    if (ipv4 == null) return null;
    const upper = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const lower = Number(ipv4 & 0xffffn).toString(16);
    normalized = normalized.slice(0, -ipv4Tail.length) + upper + ':' + lower;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.reduce((value, part) => (value << 16n) | BigInt('0x' + part), 0n);
}

function isInRange(value, base, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return value >> shift === base >> shift;
}

function isPublicIpv4(address) {
  const value = ipv4ToBigInt(address);
  if (value == null) return false;
  return !BLOCKED_IPV4_RANGES.some(([baseAddress, prefix]) =>
    isInRange(value, ipv4ToBigInt(baseAddress), prefix, 32)
  );
}

function isPublicIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value == null) return false;

  if (value >> 32n === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    return isPublicIpv4(
      ((ipv4 >>> 24) & 255) +
        '.' +
        ((ipv4 >>> 16) & 255) +
        '.' +
        ((ipv4 >>> 8) & 255) +
        '.' +
        (ipv4 & 255)
    );
  }

  const globalUnicastBase = ipv6ToBigInt('2000::');
  if (!isInRange(value, globalUnicastBase, 3, 128)) return false;
  for (const [baseAddress, prefix] of [
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2002::', 16],
  ]) {
    if (isInRange(value, ipv6ToBigInt(baseAddress), prefix, 128)) return false;
  }
  return true;
}

function isPublicIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function assertSafeHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const family = net.isIP(normalized);
  if (family) {
    if (!isPublicIpAddress(normalized)) {
      throw new UnsafeUrlError('URL points to a private, local, or reserved IP address');
    }
    return normalized;
  }
  if (!normalized || normalized === 'localhost' || !normalized.includes('.')) {
    throw new UnsafeUrlError('URL hostname is not a public DNS name');
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    throw new UnsafeUrlError('URL hostname uses a private or reserved suffix');
  }
  return normalized;
}

function parseSafeHttpsUrl(value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new UnsafeUrlError('URL is invalid');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('only HTTPS URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('URL credentials are not allowed');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('only the default HTTPS port is allowed');
  assertSafeHostname(url.hostname);
  url.hash = '';
  return url;
}

async function resolvePublicAddresses(value, { lookup = dns.promises.lookup } = {}) {
  const url = parseSafeHttpsUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) }] };
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError('public hostname could not be resolved', 'dns-failed');
  }
  if (!Array.isArray(records)) records = records ? [records] : [];
  const addresses = records
    .map((record) => (typeof record === 'string' ? { address: record, family: net.isIP(record) } : record))
    .filter((record) => record && typeof record.address === 'string');
  if (!addresses.length) throw new UnsafeUrlError('public hostname returned no addresses', 'dns-failed');
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new UnsafeUrlError('hostname resolved to a private, local, or reserved address');
  }
  return { url, addresses };
}

function createPinnedLookup(addresses) {
  const approved = addresses.map(({ address, family }) => ({
    address,
    family: Number(family) || net.isIP(address),
  }));
  let cursor = 0;
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all) {
      callback(null, approved.map((record) => ({ ...record })));
      return;
    }
    const record = approved[cursor % approved.length];
    cursor += 1;
    callback(null, record.address, record.family);
  };
}

module.exports = {
  UnsafeUrlError,
  assertSafeHostname,
  createPinnedLookup,
  isPublicIpAddress,
  parseSafeHttpsUrl,
  resolvePublicAddresses,
};
