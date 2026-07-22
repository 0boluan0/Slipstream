const assert = require('node:assert/strict');
const Module = require('node:module');
const { redactSettingsForRenderer } = require('../src/main/safe-settings');

const storeModulePath = require.resolve('../src/main/store');

function loadStoreWithMocks(initialData, safeStorage) {
  const originalLoad = Module._load;
  let instance;

  class FakeStore {
    constructor(options) {
      this.store = {};
      for (const [key, definition] of Object.entries(options.schema || {})) {
        if (Object.hasOwn(definition, 'default')) {
          this.store[key] = structuredClone(definition.default);
        }
      }
      Object.assign(this.store, structuredClone(initialData || {}));
      instance = this;
    }

    get(key) {
      return this.store[key];
    }

    set(key, value) {
      this.store[key] = value;
    }
  }

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { safeStorage };
    if (request === 'electron-store') return FakeStore;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[storeModulePath];
  try {
    const store = require(storeModulePath);
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
    },
    availableSafeStorage()
  );

  assert.equal(encrypted.store.getSettings('verificationPolicy'), 'ask');
  assert.equal(encrypted.store.getSettings('windowWidth'), 520);
  assert.equal(encrypted.store.getSettings('windowHeight'), 680);
  assert.equal(encrypted.store.getSettings('resultOrder'), 'action-first');
  assert.equal(encrypted.store.getSettings('openaiApiKey'), 'legacy-openai-secret');
  const encryptedRaw = encrypted.getRawStore();
  assert.match(encryptedRaw.openaiApiKey, /^enc:/);
  assert.equal(encryptedRaw.openaiApiKey.includes('legacy-openai-secret'), false);
  assert.equal(encryptedRaw.customEndpointApiKey, '');
  assert.equal(encryptedRaw.privacyStorageVersion, 1);
  assert.equal(encryptedRaw.savedTerms.length, 1);
  assert.equal(Object.hasOwn(encryptedRaw.savedTerms[0], 'sourceText'), false);
  assert.equal(encryptedRaw.savedTerms[0].evidence, 'FAFSA is due on Friday.');
  assert.equal(JSON.stringify(encryptedRaw.savedTerms).includes('account number'), false);
  assert.equal(JSON.stringify(encryptedRaw.savedTerms).includes('student@example.edu'), false);

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
    sourceText: longPrivateSource,
    explanation:
      'Full translated message that should not be retained. FAFSA: Free Application for Federal Student Aid. ' +
      'Other unrelated details. '.repeat(100),
  });
  assert.equal(Object.hasOwn(added, 'sourceText'), false);
  assert.equal(added.evidence, 'FAFSA is due on Friday.');
  assert.ok(added.evidence.length <= 180);
  assert.ok(added.explanation.length <= 600);
  assert.equal(JSON.stringify(added).includes('account number'), false);
  assert.equal(JSON.stringify(added).includes('student@example.edu'), false);
  assert.equal(JSON.stringify(encrypted.getRawStore().savedTerms).includes(longPrivateSource), false);

  encrypted.store.addExplanationHistory({
    sourceText: 'Temporary source',
    explanation: 'Temporary explanation',
  });
  assert.equal(encrypted.store.getExplanationHistory().length, 1);
  encrypted.store.clearRetainedContent();
  assert.deepEqual(encrypted.store.getSavedTerms(), []);
  assert.deepEqual(encrypted.store.getExplanationHistory(), []);

  encrypted.store.setSetting('openaiApiKey', 'replacement-secret');
  assert.equal(encrypted.store.getSettings('openaiApiKey'), 'replacement-secret');
  encrypted.store.clearSecrets();
  assert.equal(encrypted.store.getSettings('openaiApiKey'), '');

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
