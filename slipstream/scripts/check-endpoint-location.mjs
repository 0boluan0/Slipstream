import assert from 'node:assert/strict';
import endpointLocationCjs from '../src/shared/endpoint-location.cjs';
import endpointLocationEsm, {
  ENDPOINT_LOCATION_KINDS,
  ENDPOINT_UI_LOCATIONS,
  PROCESSING_LOCATION_KINDS,
  classifyEndpointLocation,
  endpointLocationForUi,
  isHttpLoopbackEndpoint,
  processingLocationForSettings,
} from '../src/shared/endpoint-location.mjs';

const { LOCAL_LOOPBACK, REMOTE_HTTPS, UNKNOWN, INVALID } = ENDPOINT_LOCATION_KINDS;

assert.deepEqual(endpointLocationEsm.ENDPOINT_LOCATION_KINDS, endpointLocationCjs.ENDPOINT_LOCATION_KINDS);
assert.deepEqual(endpointLocationEsm.ENDPOINT_UI_LOCATIONS, endpointLocationCjs.ENDPOINT_UI_LOCATIONS);
assert.deepEqual(endpointLocationEsm.PROCESSING_LOCATION_KINDS, endpointLocationCjs.PROCESSING_LOCATION_KINDS);
assert.equal(endpointLocationEsm.classifyEndpointLocation, endpointLocationCjs.classifyEndpointLocation);
assert.equal(endpointLocationEsm.endpointLocationForUi, endpointLocationCjs.endpointLocationForUi);
assert.equal(endpointLocationEsm.isHttpLoopbackEndpoint, endpointLocationCjs.isHttpLoopbackEndpoint);
assert.equal(endpointLocationEsm.processingLocationForSettings, endpointLocationCjs.processingLocationForSettings);
assert.equal(Object.isFrozen(ENDPOINT_LOCATION_KINDS), true);
assert.equal(Object.isFrozen(ENDPOINT_UI_LOCATIONS), true);
assert.equal(Object.isFrozen(PROCESSING_LOCATION_KINDS), true);

const localLoopbackCases = [
  'http://localhost',
  'HTTP://LOCALHOST:11434/v1',
  'http://localhost./v1',
  'HTTPS://LOCALHOST./v1',
  'http://127.0.0.0/v1',
  'http://127.42.8.9:8000/v1',
  'https://127.255.255.255/v1',
  'http://127.1/v1',
  'http://0177.0.0.1/v1',
  'http://0x7f000001/v1',
  'http://2130706433/v1',
  'http://[::1]/v1',
  'HTTPS://[0:0:0:0:0:0:0:1]/v1',
];

for (const endpoint of localLoopbackCases) {
  assert.equal(
    classifyEndpointLocation(endpoint),
    LOCAL_LOOPBACK,
    'an allowed parsed loopback hostname was not classified as local',
  );
  assert.equal(classifyEndpointLocation(endpoint).includes(endpoint), false);
}

for (const endpoint of localLoopbackCases) {
  assert.equal(
    isHttpLoopbackEndpoint(endpoint),
    new URL(endpoint).protocol === 'http:',
    'only HTTP loopback endpoints may cross a local-only transport boundary',
  );
}

const remoteHttpsCases = [
  'https://api.example.com/v1',
  'HTTPS://API.EXAMPLE.COM/v1',
  'https://localhost.evil/v1',
  'https://127.0.0.1.evil/v1',
  'https://sub.localhost/v1',
  'https://128.0.0.1/v1',
  'https://[2001:4860:4860::8888]/v1',
  'https://[::ffff:127.0.0.1]/v1',
  'https://[0:0:0:0:0:ffff:127.0.0.1]/v1',
];

for (const endpoint of remoteHttpsCases) {
  assert.equal(
    classifyEndpointLocation(endpoint),
    REMOTE_HTTPS,
    'a credential-free non-loopback HTTPS endpoint was not classified as remote',
  );
  assert.notEqual(classifyEndpointLocation(endpoint), LOCAL_LOOPBACK);
}

const invalidCases = [
  42,
  {},
  'not a URL',
  'localhost:11434',
  '//localhost:11434/v1',
  'ftp://localhost/v1',
  'file:///tmp/local-endpoint',
  'http://example.com/v1',
  'HTTP://LOCALHOST.EVIL/v1',
  'http://128.0.0.1/v1',
  'http://[::ffff:127.0.0.1]/v1',
  'http://user@localhost/v1',
  'https://user:secret@api.example.com/v1',
  'http://@localhost/v1',
  'https://@api.example.com/v1',
  'https://',
];

for (const endpoint of invalidCases) {
  assert.equal(classifyEndpointLocation(endpoint), INVALID);
  assert.notEqual(classifyEndpointLocation(endpoint), LOCAL_LOOPBACK);
}

for (const endpoint of [undefined, null, '', '   \n\t']) {
  assert.equal(classifyEndpointLocation(endpoint), UNKNOWN);
}

assert.equal(endpointLocationForUi(LOCAL_LOOPBACK), ENDPOINT_UI_LOCATIONS.LOCAL);
assert.equal(endpointLocationForUi(REMOTE_HTTPS), ENDPOINT_UI_LOCATIONS.ONLINE);
assert.equal(endpointLocationForUi(UNKNOWN), ENDPOINT_UI_LOCATIONS.UNKNOWN);
assert.equal(endpointLocationForUi(INVALID), ENDPOINT_UI_LOCATIONS.UNKNOWN);
assert.equal(endpointLocationForUi('future-classification'), ENDPOINT_UI_LOCATIONS.UNKNOWN);

assert.equal(
  processingLocationForSettings({
    activeBackend: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
  }),
  PROCESSING_LOCATION_KINDS.LOCAL,
);
for (const ollamaBaseUrl of [
  undefined,
  '',
  'https://api.example.com/ollama',
  'https://localhost/ollama',
  'http://api.example.com:11434',
  'not-a-url',
]) {
  assert.equal(
    processingLocationForSettings({ activeBackend: 'ollama', ollamaBaseUrl }),
    PROCESSING_LOCATION_KINDS.UNKNOWN,
    'an unsafe or missing Ollama endpoint must never be labelled local',
  );
}
for (const activeBackend of ['anthropic', 'deepseek', 'free_translate', 'openai']) {
  assert.equal(
    processingLocationForSettings({ activeBackend }),
    PROCESSING_LOCATION_KINDS.ONLINE,
  );
}
assert.equal(
  processingLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: 'http://127.0.0.1:8000/v1',
  }),
  PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK,
);
assert.equal(
  processingLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: 'https://api.example.com/v1',
  }),
  PROCESSING_LOCATION_KINDS.ONLINE,
);
for (const customEndpointUrl of [
  '',
  'not-a-url',
  'http://example.com/v1',
  'https://localhost/v1',
  'https://127.0.0.1/v1',
]) {
  assert.equal(
    processingLocationForSettings({ activeBackend: 'custom', customEndpointUrl }),
    PROCESSING_LOCATION_KINDS.UNKNOWN,
  );
}

for (const endpoint of [...localLoopbackCases, ...remoteHttpsCases, ...invalidCases]) {
  assert.equal(
    endpointLocationCjs.classifyEndpointLocation(endpoint),
    classifyEndpointLocation(endpoint),
    'CommonJS and ESM endpoint classification must remain identical',
  );
}

console.log('endpoint location classification checks passed');
