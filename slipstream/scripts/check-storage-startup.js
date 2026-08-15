const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const storeModulePath = require.resolve('../src/main/store');
const electronStoreModulePath = require.resolve('electron-store');
const settingsFileName = 'slipstream-settings.json';

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

function loadStore(userDataPath) {
  const originalLoad = Module._load;
  const safeStorage = availableSafeStorage();

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => userDataPath },
        safeStorage,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[storeModulePath];
  delete require.cache[electronStoreModulePath];
  try {
    return require(storeModulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createProfile(rootPath, name) {
  const profilePath = path.join(rootPath, name);
  fs.mkdirSync(profilePath, { recursive: true });
  return profilePath;
}

function settingsPath(profilePath) {
  return path.join(profilePath, settingsFileName);
}

function writeSettings(profilePath, contents) {
  const bytes = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(JSON.stringify(contents, null, '\t'));
  fs.writeFileSync(settingsPath(profilePath), bytes, { mode: 0o600 });
  return bytes;
}

function assertPrivateFile(filePath) {
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
}

function assertNoStartupCandidate(profilePath) {
  assert.equal(
    fs.readdirSync(profilePath).some((name) => name.includes('.startup-')),
    false,
    'staged startup files must always be cleaned up',
  );
}

function assertSanitizedStatus(status, expected) {
  assert.deepEqual(status, expected);
  assert.deepEqual(Object.keys(status).sort(), ['reason', 'state']);
}

function checkMalformedJson(rootPath) {
  const profilePath = createProfile(rootPath, 'malformed');
  const originalBytes = writeSettings(
    profilePath,
    Buffer.from('{"customPrompt":"do-not-expose",\n"openaiApiKey":"secret"'),
  );
  const store = loadStore(profilePath);

  assertSanitizedStatus(store.getStoreInitializationStatus(), {
    state: 'uninitialized',
    reason: null,
  });
  assert.equal(store.isStoreReady(), false);
  assert.throws(
    () => store.getAllSettings(),
    (error) => error?.code === 'STORE_NOT_READY' && error?.reason === null,
  );
  assert.deepEqual(fs.readFileSync(settingsPath(profilePath)), originalBytes);

  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'corrupt-json',
  });
  assert.equal(store.isStoreReady(), false);
  assert.deepEqual(fs.readFileSync(settingsPath(profilePath)), originalBytes);
  assertNoStartupCandidate(profilePath);
}

function checkSchemaInvalid(rootPath) {
  const profilePath = createProfile(rootPath, 'schema-invalid');
  const originalBytes = writeSettings(profilePath, {
    customPrompt: 'do-not-expose',
    windowWidth: 'not-a-number',
  });
  const store = loadStore(profilePath);

  const status = store.initializeStore();
  assertSanitizedStatus(status, { state: 'blocked', reason: 'schema-invalid' });
  assert.equal(JSON.stringify(status).includes('do-not-expose'), false);
  assert.equal(JSON.stringify(status).includes(profilePath), false);
  assert.deepEqual(fs.readFileSync(settingsPath(profilePath)), originalBytes);
  assertNoStartupCandidate(profilePath);
}

function checkValidMigration(rootPath) {
  const profilePath = createProfile(rootPath, 'migration');
  const originalBytes = writeSettings(profilePath, {
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    setupMode: 'unconfigured',
    productReadinessVersion: 0,
    openaiApiKey: 'legacy-openai-secret',
    clipboardMonitoring: true,
    privacyVersion: 0,
    privacyStorageVersion: 0,
    explanationHistory: [{ sourceText: 'private source', explanation: 'private result' }],
  });
  const store = loadStore(profilePath);

  assertSanitizedStatus(store.initializeStore(), { state: 'ready', reason: null });
  assert.equal(store.isStoreReady(), true);
  assert.equal(store.getSettings('clipboardMonitoring'), false);
  assert.equal(store.getSettings('privacyVersion'), 1);
  assert.equal(store.getSettings('openaiApiKey'), 'legacy-openai-secret');

  const migratedBytes = fs.readFileSync(settingsPath(profilePath));
  const migrated = JSON.parse(migratedBytes.toString('utf8'));
  assert.notDeepEqual(migratedBytes, originalBytes);
  assert.equal(migrated.clipboardMonitoring, false);
  assert.equal(migrated.privacyVersion, 1);
  assert.equal(migrated.privacyStorageVersion, 3);
  assert.deepEqual(migrated.explanationHistory, []);
  assert.match(migrated.openaiApiKey, /^enc:/);
  assert.equal(migrated.openaiApiKey.includes('legacy-openai-secret'), false);
  assertPrivateFile(settingsPath(profilePath));
  assertNoStartupCandidate(profilePath);
}

function checkMigrationFailurePreservesOriginal(rootPath) {
  const profilePath = createProfile(rootPath, 'migration-failure');
  const originalBytes = writeSettings(profilePath, {
    privacyVersion: 1,
    privacyStorageVersion: 3,
    productReadinessVersion: 2,
    savedTerms: [{ term: 'CAS' }],
  });
  const store = loadStore(profilePath);
  const NativeDate = Date;

  global.Date = class FailingDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) throw new Error('forced migration failure');
      super(...args);
    }
  };
  try {
    assertSanitizedStatus(store.initializeStore(), {
      state: 'blocked',
      reason: 'migration-failed',
    });
  } finally {
    global.Date = NativeDate;
  }

  assert.deepEqual(fs.readFileSync(settingsPath(profilePath)), originalBytes);
  assertNoStartupCandidate(profilePath);
  assertSanitizedStatus(store.retryStoreInitialization(), { state: 'ready', reason: null });
}

function checkRetryAfterRepair(rootPath) {
  const profilePath = createProfile(rootPath, 'retry');
  writeSettings(profilePath, Buffer.from('{broken-json'));
  const store = loadStore(profilePath);

  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'corrupt-json',
  });

  const repairedBytes = writeSettings(profilePath, {
    customPrompt: 'repaired locally',
    clipboardMonitoring: true,
    privacyVersion: 0,
  });
  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'corrupt-json',
  });
  assert.deepEqual(
    fs.readFileSync(settingsPath(profilePath)),
    repairedBytes,
    'normal access and initializeStore must not silently retry a blocked store',
  );

  assertSanitizedStatus(store.retryStoreInitialization(), { state: 'ready', reason: null });
  assert.equal(store.getSettings('customPrompt'), 'repaired locally');
  assert.equal(store.getSettings('clipboardMonitoring'), false);
  assertNoStartupCandidate(profilePath);
}

function checkRecoveryAndFullReset(rootPath) {
  const profilePath = createProfile(rootPath, 'recovery');
  const originalBytes = writeSettings(
    profilePath,
    Buffer.from('{"private":"archive-only","broken":'),
  );
  const store = loadStore(profilePath);
  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'corrupt-json',
  });

  const result = store.recoveryResetStore();
  assert.deepEqual(Object.keys(result).sort(), [
    'backupCreated',
    'backupFileName',
    'status',
  ]);
  assert.equal(result.status, 'recovered');
  assert.equal(result.backupCreated, true);
  assert.match(
    result.backupFileName,
    /^slipstream-settings\.recovery-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{16}\.json$/,
  );
  assert.equal(path.basename(result.backupFileName), result.backupFileName);
  assert.equal(JSON.stringify(result).includes('archive-only'), false);
  assert.equal(JSON.stringify(result).includes(profilePath), false);

  const archivePath = path.join(profilePath, result.backupFileName);
  assert.deepEqual(fs.readFileSync(archivePath), originalBytes);
  assertPrivateFile(archivePath);
  assertPrivateFile(settingsPath(profilePath));
  assert.equal(store.isStoreReady(), true);
  assert.equal(store.getSettings('clipboardMonitoring'), false);
  assert.equal(store.getSettings('privacyVersion'), 1);

  assert.deepEqual(store.recoveryResetStore(), {
    status: 'failed',
    reason: 'unavailable',
  });

  const secondArchiveName =
    'slipstream-settings.recovery-20260728T010203.004Z-0123456789abcdef.json';
  const secondArchivePath = path.join(profilePath, secondArchiveName);
  fs.writeFileSync(secondArchivePath, 'another recovery copy', { mode: 0o600 });
  const unrelatedPath = path.join(profilePath, 'slipstream-settings.recovery-not-an-archive.json');
  fs.writeFileSync(unrelatedPath, 'unrelated');

  store.setSetting('customPrompt', 'remove on reset');
  const resetSettings = store.resetUserDataAndSettings();
  assert.equal(resetSettings.customPrompt, '');
  assert.equal(resetSettings.clipboardMonitoring, false);
  assert.equal(resetSettings.privacyVersion, 1);
  assert.equal(fs.existsSync(archivePath), false);
  assert.equal(fs.existsSync(secondArchivePath), false);
  assert.equal(fs.existsSync(unrelatedPath), true);
}

function checkRecoveryRestoresOnFreshCreationFailure(rootPath) {
  const profilePath = createProfile(rootPath, 'recovery-restore');
  const originalBytes = writeSettings(profilePath, Buffer.from('{"broken":'));
  const store = loadStore(profilePath);
  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'corrupt-json',
  });

  const originalChmodSync = fs.chmodSync;
  let chmodCalls = 0;
  fs.chmodSync = function failFreshStoreChmod(...args) {
    chmodCalls += 1;
    if (chmodCalls === 2) {
      const error = new Error('forced fresh-store failure');
      error.code = 'EACCES';
      throw error;
    }
    return originalChmodSync.apply(this, args);
  };
  try {
    assert.deepEqual(store.recoveryResetStore(), {
      status: 'failed',
      reason: 'unavailable',
    });
  } finally {
    fs.chmodSync = originalChmodSync;
  }

  assert.deepEqual(fs.readFileSync(settingsPath(profilePath)), originalBytes);
  assert.equal(
    fs.readdirSync(profilePath).some((name) => name.includes('.recovery-')),
    false,
    'a failed fresh-store creation must restore the archive as the live settings file',
  );
  assertSanitizedStatus(store.getStoreInitializationStatus(), {
    state: 'blocked',
    reason: 'unavailable',
  });
}

function checkUnavailablePath(rootPath) {
  const profilePath = createProfile(rootPath, 'unavailable');
  fs.mkdirSync(settingsPath(profilePath));
  const store = loadStore(profilePath);
  assertSanitizedStatus(store.initializeStore(), {
    state: 'blocked',
    reason: 'unavailable',
  });
}

function checkFreshInstall(rootPath) {
  const profilePath = createProfile(rootPath, 'fresh');
  const store = loadStore(profilePath);
  assertSanitizedStatus(store.initializeStore(), { state: 'ready', reason: null });
  assert.equal(store.getSettings('clipboardMonitoring'), false);
  assert.equal(store.getSettings('privacyVersion'), 1);
  assertPrivateFile(settingsPath(profilePath));
}

function main() {
  const dependencyVersion = require('../node_modules/electron-store/package.json').version;
  assert.equal(dependencyVersion, '8.2.0', 'the real lockfile-pinned electron-store must be exercised');

  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-storage-startup-'));
  try {
    checkMalformedJson(rootPath);
    checkSchemaInvalid(rootPath);
    checkValidMigration(rootPath);
    checkMigrationFailurePreservesOriginal(rootPath);
    checkRetryAfterRepair(rootPath);
    checkRecoveryAndFullReset(rootPath);
    checkRecoveryRestoresOnFreshCreationFailure(rootPath);
    checkUnavailablePath(rootPath);
    checkFreshInstall(rootPath);
    console.log('storage startup recovery checks passed');
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

main();
