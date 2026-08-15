const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { redactSettingsForRenderer } = require('../src/main/safe-settings');

const storeModulePath = require.resolve('../src/main/store');
const temporaryStoreDirectories = [];

process.on('exit', () => {
  for (const directory of temporaryStoreDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function loadStoreWithMocks(initialData, safeStorage) {
  const originalLoad = Module._load;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-storage-unit-'));
  temporaryStoreDirectories.push(userDataPath);
  fs.writeFileSync(
    path.join(userDataPath, 'slipstream-settings.json'),
    JSON.stringify(initialData || {}),
    { mode: 0o600 },
  );
  let instance;

  class FakeStore {
    constructor(options) {
      this.defaults = {};
      for (const [key, definition] of Object.entries(options.schema || {})) {
        if (Object.hasOwn(definition, 'default')) {
          this.defaults[key] = structuredClone(definition.default);
        }
      }
      this.store = structuredClone(this.defaults);
      Object.assign(this.store, structuredClone(initialData || {}));
      instance = this;
    }

    get(key) {
      return this.store[key];
    }

    set(key, value) {
      this.store[key] = value;
    }

    clear() {
      this.store = structuredClone(this.defaults);
    }
  }

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataPath }, safeStorage };
    }
    if (request === 'electron-store') return FakeStore;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[storeModulePath];
  try {
    const store = require(storeModulePath);
    assert.deepEqual(store.initializeStore(), { state: 'ready', reason: null });
    return { store, getRawStore: () => instance?.store };
  } finally {
    Module._load = originalLoad;
  }
}

function availableSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from('sealed:' + value),
    decryptString: (buffer) => {
      const value = buffer.toString();
      if (!value.startsWith('sealed:')) throw new Error('invalid ciphertext');
      return value.slice('sealed:'.length);
    },
  };
}

function unavailableSafeStorage() {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('must not encrypt');
    },
    decryptString: () => {
      throw new Error('must not decrypt');
    },
  };
}

function main() {
  const { DEFAULTS } = require('../src/shared/constants.cjs');
  const redacted = redactSettingsForRenderer({
    openaiApiKey: 'secret',
    futureAccessToken: 'future-secret',
    activeBackend: 'openai',
  });
  assert.equal(redacted.hasOpenaiApiKey, true);
  assert.equal(Object.hasOwn(redacted, 'openaiApiKey'), false);
  assert.equal(Object.hasOwn(redacted, 'futureAccessToken'), false);
  assert.equal(redacted.activeBackend, 'openai');

  const longPrivateSource = [
    'Private account number 1234567890 belongs to student@example.edu.',
    'FAFSA is due on Friday.',
    'Do not retain the rest of this confidential message. '.repeat(20),
  ].join('\n');

  const encrypted = loadStoreWithMocks(
    {
      openaiApiKey: 'legacy-openai-secret',
      customEndpointApiKey: 'enc:not-valid-ciphertext',
      savedTerms: [
        {
          id: 7,
          createdAt: '2026-01-01T00:00:00.000Z',
          term: 'FAFSA',
          sourceText: longPrivateSource,
          explanation: 'General translation. FAFSA means Free Application for Federal Student Aid.',
        },
      ],
      explanationHistory: [{ sourceText: longPrivateSource, explanation: 'legacy private result' }],
    },
    availableSafeStorage()
  );

  assert.equal(encrypted.store.getSettings('verificationPolicy'), 'ask');
  assert.equal(encrypted.store.getSettings('windowWidth'), 520);
  assert.equal(encrypted.store.getSettings('windowHeight'), 680);
  assert.equal(encrypted.store.getSettings('resultOrder'), 'action-first');
  assert.equal(encrypted.store.getSettings('openaiApiKey'), 'legacy-openai-secret');
  const encryptedRaw = encrypted.getRawStore();
  assert.equal(encryptedRaw.clipboardShortcut, DEFAULTS.CLIPBOARD_SHORTCUT);
  assert.equal(encryptedRaw.screenshotShortcut, DEFAULTS.SCREENSHOT_SHORTCUT);
  assert.match(encryptedRaw.openaiApiKey, /^enc:/);
  assert.equal(encryptedRaw.openaiApiKey.includes('legacy-openai-secret'), false);
  assert.equal(encryptedRaw.customEndpointApiKey, '');
  assert.equal(encryptedRaw.privacyStorageVersion, 3);
  assert.deepEqual(encryptedRaw.explanationHistory, []);
  assert.equal(encryptedRaw.savedTerms.length, 1);
  assert.equal(encryptedRaw.savedTerms[0].termKind, 'other');
  assert.equal(encryptedRaw.savedTerms[0].provenanceKind, 'unknown');
  assert.equal(Object.hasOwn(encryptedRaw.savedTerms[0], 'sourceText'), false);
  assert.equal(encryptedRaw.savedTerms[0].evidence, 'FAFSA is due on Friday.');
  assert.equal(JSON.stringify(encryptedRaw.savedTerms).includes('account number'), false);
  assert.equal(JSON.stringify(encryptedRaw.savedTerms).includes('student@example.edu'), false);

  const unsafeLegacyOllama = loadStoreWithMocks(
    {
      activeBackend: 'ollama',
      activeModel: 'qwen2.5',
      setupMode: 'full',
      productReadinessVersion: 2,
      ollamaBaseUrl: 'https://public-ollama.example/v1',
    },
    availableSafeStorage(),
  );
  assert.equal(unsafeLegacyOllama.getRawStore().ollamaBaseUrl, '',
    'migration must clear an unsafe legacy Ollama endpoint instead of converting it to local');
  assert.equal(unsafeLegacyOllama.getRawStore().setupMode, 'unconfigured',
    'an unsafe legacy Ollama endpoint must not preserve full-analysis readiness');
  assert.equal(unsafeLegacyOllama.store.getAllSettings().ollamaBaseUrl, '');
  assert.equal(unsafeLegacyOllama.store.getAllSettings().setupMode, 'unconfigured');

  unsafeLegacyOllama.getRawStore().ollamaBaseUrl = 'https://manual-public-ollama.example/v1';
  unsafeLegacyOllama.getRawStore().setupMode = 'full';
  const failClosedOllamaSnapshot = unsafeLegacyOllama.store.getAllSettings();
  assert.equal(failClosedOllamaSnapshot.ollamaBaseUrl, '',
    'runtime settings snapshots must not expose a manually injected unsafe Ollama endpoint');
  assert.equal(failClosedOllamaSnapshot.setupMode, 'unconfigured');

  const migratedTermIds = loadStoreWithMocks(
    {
      savedTerms: [
        { id: 'legacy-id', createdAt: 'not-a-date', term: 'CAS' },
        { id: 9, createdAt: '2026-01-01T00:00:00.000Z', term: 'BRP' },
        { id: 9, createdAt: '2026-01-02T00:00:00.000Z', term: 'eVisa' },
      ],
    },
    availableSafeStorage(),
  ).getRawStore().savedTerms;
  assert.equal(migratedTermIds.length, 3);
  assert.equal(new Set(migratedTermIds.map((term) => term.id)).size, 3);
  assert.equal(migratedTermIds.every((term) => Number.isSafeInteger(term.id) && term.id > 0), true);
  assert.equal(migratedTermIds.every((term) => Number.isFinite(Date.parse(term.createdAt))), true);
  assert.equal(migratedTermIds.every((term) => term.termKind === 'other'), true);
  assert.equal(migratedTermIds.every((term) => term.provenanceKind === 'unknown'), true);

  const unavailable = loadStoreWithMocks(
    {
      anthropicApiKey: 'legacy-plaintext-secret',
    },
    unavailableSafeStorage()
  );
  assert.equal(unavailable.store.getSettings('anthropicApiKey'), '');
  assert.equal(unavailable.getRawStore().anthropicApiKey, '');
  assert.equal(JSON.stringify(unavailable.store.getAllSettings()).includes('legacy-plaintext-secret'), false);
  assert.throws(() => unavailable.store.setSetting('openaiApiKey', 'new-secret'), /安全存储不可用/);
  assert.equal(unavailable.getRawStore().openaiApiKey, '');
  assert.throws(() => unavailable.store.setSetting('openaiApiKey', { secret: true }), TypeError);

  const encryptionFailureData = { deepseekApiKey: 'legacy-deepseek-secret' };
  const encryptionFailureStore = {
    get: (key) => encryptionFailureData[key],
    set: (key, value) => {
      encryptionFailureData[key] = value;
    },
  };
  encrypted.store.migrateLegacySecretsInStore(encryptionFailureStore, {
    isEncryptionAvailable: () => true,
    encryptString: () => {
      throw new Error('keychain failure');
    },
  });
  assert.equal(encryptionFailureData.deepseekApiKey, '');

  const added = encrypted.store.addSavedTerm({
    term: 'FAFSA',
    termKind: 'form',
    provenanceKind: 'pending',
    sourceText: longPrivateSource,
    explanation:
      'Full translated message that should not be retained. FAFSA: Free Application for Federal Student Aid. ' +
      'Other unrelated details. '.repeat(100),
  });
  assert.equal(Object.hasOwn(added, 'sourceText'), false);
  assert.equal(added.termKind, 'form');
  assert.equal(added.provenanceKind, 'pending');
  assert.equal(added.evidence, 'FAFSA is due on Friday.');
  assert.ok(added.evidence.length <= 180);
  assert.ok(added.explanation.length <= 600);
  assert.equal(JSON.stringify(added).includes('account number'), false);
  assert.equal(JSON.stringify(added).includes('student@example.edu'), false);
  assert.equal(JSON.stringify(encrypted.getRawStore().savedTerms).includes(longPrivateSource), false);

  const legacyShortcut = loadStoreWithMocks(
    { screenshotShortcut: 'F2' },
    availableSafeStorage(),
  );
  assert.equal(legacyShortcut.store.getSettings('screenshotShortcut'), 'F2',
    'existing bare function-key shortcuts must not be silently migrated');

  const updated = encrypted.store.addSavedTerm({
    term: 'fafsa',
    termKind: 'abbreviation',
    provenanceKind: 'official',
    evidence: 'FAFSA is due on Friday.',
    definition: 'FAFSA is the Free Application for Federal Student Aid.',
  });
  assert.equal(updated.id, added.id, 'saving the same normalized term must update the existing record');
  assert.equal(encrypted.store.getSavedTerms().length, 1, 'duplicate term labels must not accumulate');
  assert.match(encrypted.store.getSavedTerms()[0].explanation, /Free Application/);
  assert.equal(updated.termKind, 'abbreviation');
  assert.equal(updated.provenanceKind, 'official');
  assert.equal(
    encrypted.store.getSavedTerms()[0].provenanceKind,
    'official',
    'same-term updates must atomically replace the saved trust state',
  );
  const unicodeUpdated = encrypted.store.addSavedTerm({
    term: '  ＦＡＦＳＡ  ',
    termKind: 'not-a-real-kind',
    provenanceKind: 'verified',
    definition: 'Same term entered with full-width characters.',
  });
  assert.equal(unicodeUpdated.id, added.id, 'Unicode display variants must update the existing record');
  assert.equal(encrypted.store.getSavedTerms().length, 1, 'Unicode display variants must not duplicate terms');
  assert.equal(unicodeUpdated.termKind, 'other', 'unknown term kinds must fail closed');
  assert.equal(unicodeUpdated.provenanceKind, 'unknown', 'unknown provenance must fail closed');

  const historyResult = encrypted.store.addExplanationHistory({
    sourceText: 'Temporary source',
    explanation: 'Temporary explanation',
  });
  assert.deepEqual(historyResult, { stored: false });
  assert.equal(encrypted.store.getExplanationHistory().length, 0);
  encrypted.store.clearRetainedContent();
  assert.deepEqual(encrypted.store.getSavedTerms(), []);
  assert.deepEqual(encrypted.store.getExplanationHistory(), []);

  encrypted.store.setSetting('openaiApiKey', 'replacement-secret');
  assert.equal(encrypted.store.getSettings('openaiApiKey'), 'replacement-secret');
  encrypted.store.clearSecrets();
  assert.equal(encrypted.store.getSettings('openaiApiKey'), '');

  const resettable = loadStoreWithMocks({
    setupMode: 'full',
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    openaiApiKey: `enc:${Buffer.from('sealed:reset-me').toString('base64')}`,
    clipboardMonitoring: true,
    savedTerms: [{ id: 99, term: 'CAS', explanation: 'Confirmation of Acceptance for Studies' }],
  }, availableSafeStorage());
  resettable.store.resetUserDataAndSettings();
  const resetRaw = resettable.getRawStore();
  assert.equal(resetRaw.setupMode, 'unconfigured');
  assert.equal(resetRaw.activeBackend, 'free_translate');
  assert.equal(resetRaw.clipboardMonitoring, false);
  assert.equal(resetRaw.openaiApiKey, '');
  assert.deepEqual(resetRaw.savedTerms, []);
  assert.equal(resetRaw.productReadinessVersion, 2);
  assert.equal(resetRaw.privacyStorageVersion, 3);

  console.log('storage minimization and secret migration checks passed');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  delete require.cache[storeModulePath];
}
