import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  PROCESSING_LOCATION_KINDS,
  classifyEndpointLocation,
  processingLocationForSettings,
} from '../src/shared/endpoint-location.mjs';

const require = createRequire(import.meta.url);
const {
  validateEndpointUrl,
  validateSetting,
} = require('../src/main/validation');

const {
  LOCAL,
  LOCAL_LOOPBACK,
  ONLINE,
  UNKNOWN,
} = PROCESSING_LOCATION_KINDS;

function validateCustomEndpoint(endpoint) {
  const [key, normalized] = validateSetting('customEndpointUrl', endpoint);
  assert.equal(key, 'customEndpointUrl');
  assert.equal(normalized, validateEndpointUrl(endpoint));
  return normalized;
}

function customLocation(endpoint) {
  return processingLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: endpoint,
  });
}

function assertCustomAccepted(endpoint, expectedLocation) {
  const normalized = validateCustomEndpoint(endpoint);
  assert.equal(
    customLocation(endpoint),
    expectedLocation,
    `${endpoint} must be classified consistently before validation`,
  );
  assert.equal(
    customLocation(normalized),
    expectedLocation,
    `${endpoint} must keep its processing location after normalization`,
  );
  return normalized;
}

function assertCustomRejected(endpoint, expectedLocation = null) {
  assert.throws(
    () => validateEndpointUrl(endpoint),
    undefined,
    `${endpoint} must be rejected by the endpoint validator`,
  );
  assert.throws(
    () => validateSetting('customEndpointUrl', endpoint),
    undefined,
    `${endpoint} must be rejected at the persisted-setting boundary`,
  );
  const location = customLocation(endpoint);
  assert.equal(
    Object.values(PROCESSING_LOCATION_KINDS).includes(location),
    true,
    `${endpoint} must resolve to a bounded processing-location value`,
  );
  if (expectedLocation !== null) {
    assert.equal(location, expectedLocation, `${endpoint} has an unsafe UI processing location`);
  }
}

const customLoopbackCases = [
  'http://localhost',
  'http://localhost:8000/v1',
  'http://localhost.',
  'http://localhost.:8000/v1',
  'http://127.0.0.1:8000/v1',
  'http://127.42.8.9',
  'http://127.42.8.9:8000/v1',
  'http://127.255.255.255:8000/v1',
  'http://127.1:8000/v1',
  'http://[::1]',
  'http://[::1]:8000/v1',
];

for (const endpoint of customLoopbackCases) {
  const normalized = assertCustomAccepted(endpoint, LOCAL_LOOPBACK);
  assert.equal(new URL(normalized).protocol, 'http:');
  assert.equal(classifyEndpointLocation(normalized), LOCAL_LOOPBACK);
}

for (const endpoint of [
  'https://api.example.com/v1',
  'https://gateway.example.com/compatible/v1',
]) {
  const normalized = assertCustomAccepted(endpoint, ONLINE);
  assert.equal(new URL(normalized).protocol, 'https:');
}

for (const endpoint of [
  'http://api.example.com/v1',
  'http://192.0.2.10/v1',
]) {
  assertCustomRejected(endpoint, UNKNOWN);
}

for (const endpoint of [
  'https://localhost/v1',
  'https://localhost./v1',
  'https://127.0.0.1/v1',
  'https://127.42.8.9/v1',
  'https://[::1]/v1',
]) {
  assertCustomRejected(endpoint, UNKNOWN);
}

for (const endpoint of [
  'http://user@localhost:8000/v1',
  'http://user:secret@127.0.0.1:8000/v1',
  'https://user:secret@api.example.com/v1',
]) {
  assertCustomRejected(endpoint, UNKNOWN);
}

// Query strings, fragments, concrete API routes, public HTTPS IPs/ports, and
// unsupported schemes may be coarsely classifiable, but none may cross the
// validator boundary as a saved custom endpoint.
for (const endpoint of [
  'https://api.example.com/v1?token=secret',
  'https://api.example.com/v1#fragment',
  'https://api.example.com/v1/models',
  'https://api.example.com/v1/chat/completions',
  'http://127.0.0.1:8000/api/tags',
  'http://127.0.0.1:8000/api/generate',
  'https://api.example.com/v1/../models',
  'https://api.example.com:8443/v1',
  'https://192.0.2.10/v1',
  'ftp://localhost/v1',
]) {
  assertCustomRejected(endpoint);
}

assert.equal(customLocation(''), UNKNOWN);
assert.equal(customLocation('not-a-url'), UNKNOWN);

function validateOllamaEndpoint(endpoint) {
  const [key, normalized] = validateSetting('ollamaBaseUrl', endpoint);
  assert.equal(key, 'ollamaBaseUrl');
  assert.equal(new URL(normalized).protocol, 'http:');
  assert.equal(classifyEndpointLocation(normalized), LOCAL_LOOPBACK);
  assert.equal(processingLocationForSettings({
    activeBackend: 'ollama',
    ollamaBaseUrl: normalized,
  }), LOCAL);
  return normalized;
}

for (const endpoint of [
  'http://localhost:11434',
  'http://localhost.:11434',
  'http://127.0.0.1:11434',
  'http://127.42.8.9:11434',
  'http://127.1:11434',
  'http://[::1]:11434',
]) {
  validateOllamaEndpoint(endpoint);
}

// The generic endpoint validator must accept public HTTPS for custom
// providers, while the provider-specific setting boundary must reject it for
// Ollama. HTTPS loopback and every non-loopback HTTP address are also invalid.
assert.equal(validateEndpointUrl('https://api.example.com'), 'https://api.example.com');
for (const endpoint of [
  'http://api.example.com:11434',
  'http://192.0.2.10:11434',
  'https://api.example.com',
  'https://localhost',
  'https://127.0.0.1',
  'https://[::1]',
  'http://user:secret@127.0.0.1:11434',
  'http://127.0.0.1:11434?token=secret',
  'http://127.0.0.1:11434/api/tags',
  'ftp://localhost:11434',
]) {
  assert.throws(
    () => validateSetting('ollamaBaseUrl', endpoint),
    undefined,
    `${endpoint} must not be accepted as a local Ollama service`,
  );
  assert.equal(
    processingLocationForSettings({ activeBackend: 'ollama', ollamaBaseUrl: endpoint }),
    UNKNOWN,
    `${endpoint} must not be presented as local before validation`,
  );
}

console.log('endpoint classification/validation invariant checks passed');
