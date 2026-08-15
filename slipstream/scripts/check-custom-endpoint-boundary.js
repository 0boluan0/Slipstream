const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const storeModulePath = require.resolve('../src/main/store');
const temporaryDirectories = [];

process.on('exit', () => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function availableSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (buffer) => {
      const value = buffer.toString();
      if (!value.startsWith('sealed:')) throw new Error('invalid ciphertext');
      return value.slice('sealed:'.length);
    },
  };
}

function loadStore(initialData) {
  const originalLoad = Module._load;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-endpoint-boundary-'));
  temporaryDirectories.push(userDataPath);
  fs.writeFileSync(
    path.join(userDataPath, 'slipstream-settings.json'),
    JSON.stringify(initialData),
    { mode: 0o600 },
  );

  let instance;
  let failNextObjectSet = false;

  class FakeStore {
    constructor(options) {
      this.defaults = {};
      for (const [key, definition] of Object.entries(options.schema || {})) {
        if (Object.hasOwn(definition, 'default')) {
          this.defaults[key] = structuredClone(definition.default);
        }
      }
      this.store = { ...structuredClone(this.defaults), ...structuredClone(initialData) };
      this.setCalls = [];
      instance = this;
    }

    get(key) {
      return this.store[key];
    }

    set(key, value) {
      const objectWrite = key && typeof key === 'object' && !Array.isArray(key);
      this.setCalls.push(objectWrite
        ? { kind: 'object', value: structuredClone(key) }
        : { kind: 'key', key, value: structuredClone(value) });
      if (objectWrite) {
        if (failNextObjectSet) {
          failNextObjectSet = false;
          throw new Error('forced atomic settings write failure');
        }
        this.store = { ...this.store, ...structuredClone(key) };
        return;
      }
      this.store[key] = value;
    }

    clear() {
      this.store = structuredClone(this.defaults);
    }
  }

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataPath }, safeStorage: availableSafeStorage() };
    }
    if (request === 'electron-store') return FakeStore;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[storeModulePath];
  try {
    const store = require(storeModulePath);
    assert.deepEqual(store.initializeStore(), { state: 'ready', reason: null });
    instance.setCalls = [];
    return {
      store,
      raw: () => structuredClone(instance.store),
      setCalls: () => structuredClone(instance.setCalls),
      failNextAtomicWrite: () => { failNextObjectSet = true; },
    };
  } finally {
    Module._load = originalLoad;
    delete require.cache[storeModulePath];
  }
}

function loadConfirmedWriteReducer() {
  const hookSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/hooks/useSettings.js'),
    'utf8',
  );
  const redactionSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/hooks/settingsRedaction.mjs'),
    'utf8',
  );
  const startMarker = '// ENDPOINT_BOUNDARY_RESPONSE_START';
  const endMarker = '// ENDPOINT_BOUNDARY_RESPONSE_END';
  const start = hookSource.indexOf(startMarker);
  const end = hookSource.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'confirmed-write reducer markers must remain intact');

  const reducerSource = hookSource
    .slice(start + startMarker.length, end)
    .replace(/\bexport\s+/, '');
  const executableRedactionSource = redactionSource.replace(/\bexport\s+/g, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${executableRedactionSource}\n${reducerSource}\nthis.reducer = applyConfirmedSettingWrite;`,
    context,
  );
  return context.reducer;
}

function checkAtomicStoreBoundary() {
  const initial = {
    privacyVersion: 1,
    privacyStorageVersion: 3,
    productReadinessVersion: 2,
    customEndpointUrl: 'https://old.example/v1',
    customEndpointApiKey: 'old-origin-secret',
  };
  const successful = loadStore(initial);
  assert.deepEqual(
    successful.store.setCustomEndpointUrl('https://new.example/v1'),
    { customEndpointApiKeyCleared: true },
  );
  assert.deepEqual(successful.setCalls(), [{
    kind: 'object',
    value: {
      customEndpointUrl: 'https://new.example/v1',
      customEndpointApiKey: '',
    },
  }], 'cross-origin persistence must be one electron-store object write');
  assert.equal(successful.raw().customEndpointUrl, 'https://new.example/v1');
  assert.equal(successful.raw().customEndpointApiKey, '');

  const sameOrigin = loadStore(initial);
  assert.deepEqual(
    sameOrigin.store.setCustomEndpointUrl('https://old.example/compatible-v2'),
    { customEndpointApiKeyCleared: false },
  );
  assert.deepEqual(sameOrigin.setCalls(), [{
    kind: 'key',
    key: 'customEndpointUrl',
    value: 'https://old.example/compatible-v2',
  }], 'same-origin path edits must use the ordinary URL-only write');
  assert.equal(sameOrigin.raw().customEndpointUrl, 'https://old.example/compatible-v2');
  assert.notEqual(sameOrigin.raw().customEndpointApiKey, '', 'same-origin edits must retain the saved key');

  const failed = loadStore(initial);
  const beforeFailure = failed.raw();
  failed.failNextAtomicWrite();
  assert.throws(
    () => failed.store.setCustomEndpointUrl('https://new.example/v1'),
    /forced atomic settings write failure/,
  );
  assert.deepEqual(
    failed.raw(),
    beforeFailure,
    'a failed object write must retain both the old URL and its old encrypted key',
  );
  assert.equal(failed.setCalls().length, 1, 'failure must not fall back to per-key writes');
  assert.equal(failed.setCalls()[0].kind, 'object');
}

function checkResponseCorrelation() {
  const reducer = loadConfirmedWriteReducer();
  const initial = {
    customEndpointUrl: 'https://old.example/v1',
    customEndpointApiKey: '',
    hasCustomEndpointApiKey: true,
  };
  const apply = (response) => reducer(
    initial,
    'customEndpointUrl',
    'https://new.example/v1',
    response,
  );

  const confirmed = apply({
    status: 'saved',
    key: 'customEndpointUrl',
    customEndpointApiKeyCleared: true,
  });
  assert.equal(confirmed.customEndpointUrl, 'https://new.example/v1');
  assert.equal(confirmed.hasCustomEndpointApiKey, false);

  for (const unrelatedResponse of [
    { status: 'saved', key: 'activeModel', customEndpointApiKeyCleared: true },
    { status: 'failed', key: 'customEndpointUrl', customEndpointApiKeyCleared: true },
    { status: 'saved', key: 'customEndpointUrl', customEndpointApiKeyCleared: false },
    true,
    null,
  ]) {
    assert.equal(
      apply(unrelatedResponse).hasCustomEndpointApiKey,
      true,
      'only the matching successful URL write may clear the renderer credential flag',
    );
  }
}

function checkCrossLayerContract() {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
  const settingsSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/components/SettingsPanel.jsx'),
    'utf8',
  );
  const handlerStart = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.SETTINGS_SET');
  const handlerEnd = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_TEST', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handlerSource = mainSource.slice(handlerStart, handlerEnd);
  assert.match(
    handlerSource,
    /const \{ customEndpointApiKeyCleared \} = store\.setCustomEndpointUrl\(value\);/,
    'main must delegate the origin decision and atomic persistence to the store boundary',
  );
  assert.doesNotMatch(
    handlerSource,
    /store\.setSetting\(['"]customEndpointApiKey['"],\s*['"]['"]\)/,
    'main must never clear the old key in a second settings write',
  );
  assert.match(
    handlerSource,
    /return \{ status: 'saved', key, customEndpointApiKeyCleared \};/,
    'the response must correlate the side effect to the confirmed URL write',
  );

  const changeStart = settingsSource.indexOf('const handleApiKeyChange = useCallback');
  const changeEnd = settingsSource.indexOf('const handleCustomApiKeyChange = useCallback', changeStart);
  assert.ok(changeStart >= 0 && changeEnd > changeStart);
  const changeSource = settingsSource.slice(changeStart, changeEnd);
  assert.doesNotMatch(
    changeSource,
    /updateSettings\(['"]customEndpointApiKey['"],\s*['"]['"]\)/,
    'renderer must not issue a second non-atomic credential-clear request',
  );
}

checkAtomicStoreBoundary();
checkResponseCorrelation();
checkCrossLayerContract();
console.log('custom endpoint trust-boundary checks passed');
