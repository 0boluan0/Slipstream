const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { SECRET_SETTING_KEYS } = require('./safe-settings');
const { mergePortableTerms } = require('./term-transfer');
const { DEFAULTS, MODEL_IDS } = require('../shared/constants.cjs');
const { PROVENANCE_KINDS, TERM_KINDS } = require('../shared/action-brief.cjs');
const { isHttpLoopbackEndpoint } = require('../shared/endpoint-location.cjs');

/**
 * @typedef {Object} UserSettings
 * @property {string} anthropicApiKey
 * @property {string} openaiApiKey
 * @property {string} deepseekApiKey
 * @property {string} ollamaBaseUrl
 * @property {string} customEndpointUrl
 * @property {string} customEndpointApiKey
 * @property {string} activeBackend
 * @property {string} activeModel
 * @property {string} customPrompt
 * @property {string} languageHint
 * @property {number} windowWidth
 * @property {number} windowHeight
 * @property {number|null} windowX
 * @property {number|null} windowY
 * @property {boolean} startMinimized
 * @property {boolean} clipboardMonitoring
 * @property {'local-only'|'ask'|'official-auto'} verificationPolicy
 * @property {'action-first'|'translation-first'} resultOrder
 * @property {'unconfigured'|'full'|'translation-only'} setupMode
 * @property {string} clipboardShortcut
 * @property {string} screenshotShortcut
 * @property {Array<object>} savedTerms
 * @property {Array<object>} explanationHistory
 */

let Store = require('electron-store');

const schema = {
  anthropicApiKey: { type: 'string', default: '' },
  openaiApiKey: { type: 'string', default: '' },
  deepseekApiKey: { type: 'string', default: '' },
  ollamaBaseUrl: { type: 'string', default: 'http://localhost:11434' },
  customEndpointUrl: { type: 'string', default: '' },
  customEndpointApiKey: { type: 'string', default: '' },
  activeBackend: { type: 'string', default: 'free_translate' },
  activeModel: { type: 'string', default: 'google-translate' },
  customPrompt: { type: 'string', default: '' },
  languageHint: { type: 'string', default: 'en' },
  setupMode: {
    type: 'string',
    enum: ['unconfigured', 'full', 'translation-only'],
    default: 'unconfigured',
  },
  productReadinessVersion: { type: 'number', default: 0 },
  windowWidth: { type: 'number', default: 520 },
  windowHeight: { type: 'number', default: 680 },
  windowX: { type: ['number', 'null'], default: null },
  windowY: { type: ['number', 'null'], default: null },
  startMinimized: { type: 'boolean', default: false },
  clipboardMonitoring: { type: 'boolean', default: false },
  verificationPolicy: {
    type: 'string',
    enum: ['local-only', 'ask', 'official-auto'],
    default: 'ask',
  },
  resultOrder: {
    type: 'string',
    enum: ['action-first', 'translation-first'],
    default: 'action-first',
  },
  privacyVersion: { type: 'number', default: 0 },
  privacyStorageVersion: { type: 'number', default: 0 },
  privacyNoticeSeen: { type: 'boolean', default: false },
  clipboardShortcut: { type: 'string', default: DEFAULTS.CLIPBOARD_SHORTCUT },
  screenshotShortcut: { type: 'string', default: DEFAULTS.SCREENSHOT_SHORTCUT },
  savedTerms: { type: 'array', default: [] },
  explanationHistory: { type: 'array', default: [] },
};

const SECRET_KEYS = SECRET_SETTING_KEYS;
const PRIVACY_STORAGE_VERSION = 3;
const INITIAL_SETUP_MIGRATION_VERSION = 1;
const PRODUCT_READINESS_VERSION = 2;
const LEGACY_DEEPSEEK_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);
const MAX_EVIDENCE_CHARS = 180;
const MAX_TERM_EXPLANATION_CHARS = 400;
const SAVED_TERM_KINDS = new Set(TERM_KINDS);
const SAVED_TERM_PROVENANCE_KINDS = new Set([...PROVENANCE_KINDS, 'unknown']);
const STORE_NAME = 'slipstream-settings';
const STORE_FILE_NAME = `${STORE_NAME}.json`;
const RECOVERY_ARCHIVE_PATTERN = /^slipstream-settings\.recovery-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{16}\.json$/;
const FILESYSTEM_ERROR_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EDQUOT',
  'EEXIST',
  'EFBIG',
  'EIO',
  'EISDIR',
  'ELOOP',
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);

let storeInstance = null;
let storeInitializationStatus = { state: 'uninitialized', reason: null };

function normalizeRetainedText(value) {
  return typeof value === 'string'
    ? [...value]
        .map((character) => {
          const code = character.codePointAt(0);
          return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeSavedTermKey(value) {
  return normalizeRetainedText(value).normalize('NFKC').toLocaleLowerCase();
}

function redactIncidentalIdentifiers(value) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, '[phone]');
}

function clipAroundNeedle(value, needle, maxChars) {
  if (value.length <= maxChars) return value;
  const matchIndex = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  const center = matchIndex >= 0 ? matchIndex + Math.floor(needle.length / 2) : 0;
  let start = Math.max(0, center - Math.floor(maxChars / 2));
  let end = Math.min(value.length, start + maxChars);
  start = Math.max(0, end - maxChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < value.length ? '…' : '';
  return prefix + value.slice(start + prefix.length, end - suffix.length).trim() + suffix;
}

function splitEvidenceSegments(value) {
  return String(value || '')
    .split(/[\r\n]+|(?<=[.!?。！？；;])\s+/u)
    .map(normalizeRetainedText)
    .filter(Boolean);
}

function shortestRelevantSegment(value, needle, maxChars, { requireNeedle = true } = {}) {
  const normalizedNeedle = normalizeRetainedText(needle);
  const segments = splitEvidenceSegments(value);
  const matching = normalizedNeedle
    ? segments.filter((segment) => segment.toLocaleLowerCase().includes(normalizedNeedle.toLocaleLowerCase()))
    : [];
  const candidates = matching.length ? matching : requireNeedle ? [] : segments;
  if (!candidates.length) return '';
  const shortest = candidates.reduce((best, candidate) => (candidate.length < best.length ? candidate : best));
  return clipAroundNeedle(redactIncidentalIdentifiers(shortest), normalizedNeedle, maxChars);
}

function minimizeSavedTerm(term, { fallbackId = Date.now(), fallbackCreatedAt = new Date().toISOString() } = {}) {
  const label = normalizeRetainedText(term?.term);
  if (!label || label.length > 200) return null;
  const explicitEvidence = normalizeRetainedText(term?.evidence);
  const evidence = explicitEvidence
    ? shortestRelevantSegment(term.evidence, label, MAX_EVIDENCE_CHARS, { requireNeedle: false })
    : shortestRelevantSegment(term?.sourceText, label, MAX_EVIDENCE_CHARS);
  const explicitDefinition = normalizeRetainedText(term?.definition);
  const explanation = explicitDefinition
    ? shortestRelevantSegment(term.definition, label, MAX_TERM_EXPLANATION_CHARS, { requireNeedle: false })
    : shortestRelevantSegment(term?.explanation, label, MAX_TERM_EXPLANATION_CHARS);

  return {
    id: Number.isSafeInteger(term?.id) && term.id > 0 ? term.id : fallbackId,
    createdAt: typeof term?.createdAt === 'string' && Number.isFinite(Date.parse(term.createdAt))
      ? term.createdAt
      : fallbackCreatedAt,
    term: label,
    termKind: SAVED_TERM_KINDS.has(term?.termKind ?? term?.kind)
      ? (term.termKind ?? term.kind)
      : 'other',
    provenanceKind: SAVED_TERM_PROVENANCE_KINDS.has(
      term?.provenanceKind ?? term?.provenance?.kind,
    )
      ? (term.provenanceKind ?? term.provenance.kind)
      : 'unknown',
    evidence,
    explanation,
  };
}

function minimizeSavedTermsInStore(store) {
  const current = store.get('savedTerms');
  const usedIds = new Set();
  let nextGeneratedId = Date.now();
  const minimized = [];
  for (const value of (Array.isArray(current) ? current : []).slice(0, 50)) {
    while (usedIds.has(nextGeneratedId)) nextGeneratedId += 1;
    const term = minimizeSavedTerm(value, { fallbackId: nextGeneratedId });
    if (!term) continue;
    if (usedIds.has(term.id)) {
      while (usedIds.has(nextGeneratedId)) nextGeneratedId += 1;
      term.id = nextGeneratedId;
    }
    usedIds.add(term.id);
    nextGeneratedId += 1;
    minimized.push(term);
  }
  const changed = JSON.stringify(current || []) !== JSON.stringify(minimized);
  if (changed) store.set('savedTerms', minimized);
  return { changed, count: minimized.length };
}

function safeStorageAvailable(storage) {
  try {
    return Boolean(storage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function migrateLegacySecretsInStore(store, storage = safeStorage) {
  let encryptionAvailable;
  const canUseEncryption = () => {
    if (encryptionAvailable === undefined) encryptionAvailable = safeStorageAvailable(storage);
    return encryptionAvailable;
  };
  const migrated = [];
  const cleared = [];

  for (const key of SECRET_KEYS) {
    const value = store.get(key);
    if (typeof value !== 'string' || !value) continue;
    if (value.startsWith('enc:')) {
      if (canUseEncryption()) {
        try {
          storage.decryptString(Buffer.from(value.slice(4), 'base64'));
        } catch {
          store.set(key, '');
          cleared.push(key);
        }
      }
      continue;
    }
    if (!canUseEncryption()) {
      store.set(key, '');
      cleared.push(key);
      continue;
    }
    try {
      const encrypted = storage.encryptString(value);
      store.set(key, 'enc:' + encrypted.toString('base64'));
      migrated.push(key);
    } catch {
      // Never retain or return a legacy plaintext secret if encryption fails.
      store.set(key, '');
      cleared.push(key);
    }
  }
  return { migrated, cleared };
}

function backendIsConfigured(store) {
  const backend = store.get('activeBackend');
  const model = normalizeRetainedText(store.get('activeModel'));
  if (!model || !backend || backend === 'free_translate') return false;
  const secretIsUsable = (key) => {
    const value = store.get(key);
    if (typeof value !== 'string' || !value) return false;
    if (!value.startsWith('enc:')) return true;
    if (!safeStorageAvailable(safeStorage)) return false;
    try {
      safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
      return true;
    } catch {
      return false;
    }
  };
  if (backend === 'anthropic') return secretIsUsable('anthropicApiKey');
  if (backend === 'openai') return secretIsUsable('openaiApiKey');
  if (backend === 'deepseek') return secretIsUsable('deepseekApiKey');
  if (backend === 'ollama') return isHttpLoopbackEndpoint(store.get('ollamaBaseUrl'));
  if (backend === 'custom') return Boolean(normalizeRetainedText(store.get('customEndpointUrl')));
  return false;
}

function migrateUnsafeOllamaEndpointInStore(store) {
  const current = store.get('ollamaBaseUrl');
  if (isHttpLoopbackEndpoint(current)) return { cleared: false };
  const hadUnsafeValue = typeof current === 'string' && Boolean(current.trim());
  if (hadUnsafeValue) store.set('ollamaBaseUrl', '');
  return { cleared: hadUnsafeValue };
}

function migrateProductReadinessInStore(store) {
  const previousLanguageHint = store.get('languageHint');
  if (previousLanguageHint !== 'en') store.set('languageHint', 'en');

  const previousVersion = Number(store.get('productReadinessVersion')) || 0;
  const knownModes = new Set(['unconfigured', 'full', 'translation-only']);
  let setupMode = store.get('setupMode');
  if (!knownModes.has(setupMode)) setupMode = 'unconfigured';

  if (
    previousVersion < PRODUCT_READINESS_VERSION &&
    store.get('activeBackend') === 'deepseek' &&
    LEGACY_DEEPSEEK_MODELS.has(store.get('activeModel'))
  ) {
    store.set('activeModel', MODEL_IDS.deepseek[0]);
  }

  if (
    previousVersion < INITIAL_SETUP_MIGRATION_VERSION &&
    setupMode === 'unconfigured' &&
    backendIsConfigured(store)
  ) {
    // Preserve a genuinely configured legacy installation without pretending
    // that a bare provider selection is already ready for full analysis.
    setupMode = 'full';
  }

  if (setupMode === 'translation-only') {
    store.set('activeBackend', 'free_translate');
    store.set('activeModel', 'google-translate');
  } else if (setupMode === 'full' && !backendIsConfigured(store)) {
    setupMode = 'unconfigured';
  }

  if (store.get('setupMode') !== setupMode) store.set('setupMode', setupMode);
  if (previousVersion < PRODUCT_READINESS_VERSION) {
    store.set('productReadinessVersion', PRODUCT_READINESS_VERSION);
  }

  return {
    languageChanged: previousLanguageHint !== 'en',
    setupMode,
    migrated: previousVersion < PRODUCT_READINESS_VERSION,
  };
}

function migrateClipboardPrivacyInStore(store) {
  const previousVersion = Number(store.get('privacyVersion')) || 0;
  if (previousVersion >= 1) {
    return { migrated: false, clipboardMonitoringDisabled: false };
  }

  store.set('clipboardMonitoring', false);
  store.set('privacyVersion', 1);
  return { migrated: true, clipboardMonitoringDisabled: true };
}

function runPrivacyMigrations(store) {
  const privacy = migrateClipboardPrivacyInStore(store);
  const secrets = migrateLegacySecretsInStore(store);
  const terms = minimizeSavedTermsInStore(store);
  const ollamaEndpoint = migrateUnsafeOllamaEndpointInStore(store);
  const readiness = migrateProductReadinessInStore(store);
  const legacyHistoryCount = Array.isArray(store.get('explanationHistory'))
    ? store.get('explanationHistory').length
    : 0;
  // V1 intentionally retains no source/result history. Clear legacy plaintext
  // records during migration instead of silently carrying them forward.
  if (legacyHistoryCount > 0) store.set('explanationHistory', []);
  if ((store.get('privacyStorageVersion') || 0) < PRIVACY_STORAGE_VERSION) {
    store.set('privacyStorageVersion', PRIVACY_STORAGE_VERSION);
  }
  return {
    privacy,
    secrets,
    terms,
    ollamaEndpoint,
    readiness,
    history: { cleared: legacyHistoryCount },
  };
}

class StoreInitializationError extends Error {
  constructor(reason) {
    super('Persistent settings could not be initialized');
    this.name = 'StoreInitializationError';
    this.reason = reason;
  }
}

function isFilesystemError(error) {
  return typeof error?.code === 'string' && (
    FILESYSTEM_ERROR_CODES.has(error.code)
    || error.code === 'UNKNOWN'
    || /^E[A-Z0-9]+$/.test(error.code)
  );
}

function classifyStoreError(error, { migration = false } = {}) {
  if (error instanceof StoreInitializationError) return error.reason;
  if (error?.name === 'SyntaxError') return 'corrupt-json';
  if (typeof error?.message === 'string' && error.message.startsWith('Config schema violation:')) {
    return 'schema-invalid';
  }
  if (isFilesystemError(error)) return 'unavailable';
  return migration ? 'migration-failed' : 'unavailable';
}

function storeOptionsForPath(storePath) {
  return {
    name: path.basename(storePath, '.json'),
    cwd: path.dirname(storePath),
    schema,
    clearInvalidConfig: false,
    configFileMode: 0o600,
  };
}

function getStorePath() {
  const userDataPath = app?.getPath?.('userData');
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new StoreInitializationError('unavailable');
  }
  return path.join(path.resolve(userDataPath), STORE_FILE_NAME);
}

function getFilePresence(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new StoreInitializationError('unavailable');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function createUniqueSiblingPath(storePath, kind) {
  const directory = path.dirname(storePath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(8).toString('hex');
    const candidate = path.join(directory, `.${STORE_NAME}.${kind}-${process.pid}-${suffix}.json`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new StoreInitializationError('unavailable');
}

function writeExclusivePrivateFile(filePath, contents) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function removeFileIfPresent(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function discardCandidate(filePath) {
  if (!filePath) return;
  try {
    removeFileIfPresent(filePath);
  } catch {
    // A failed best-effort cleanup must never replace the sanitized startup reason.
  }
}

function openStore(storePath) {
  try {
    return new Store(storeOptionsForPath(storePath));
  } catch (error) {
    throw new StoreInitializationError(classifyStoreError(error));
  }
}

function migrateStore(store) {
  try {
    return runPrivacyMigrations(store);
  } catch (error) {
    throw new StoreInitializationError(classifyStoreError(error, { migration: true }));
  }
}

function makeStorePrivate(storePath) {
  try {
    fs.chmodSync(storePath, 0o600);
  } catch (error) {
    throw new StoreInitializationError(classifyStoreError(error));
  }
}

function initializeFreshStore(storePath) {
  const store = openStore(storePath);
  migrateStore(store);
  makeStorePrivate(storePath);
  return store;
}

function initializeExistingStore(storePath) {
  let candidatePath;
  try {
    const originalBytes = fs.readFileSync(storePath);
    candidatePath = createUniqueSiblingPath(storePath, 'startup');
    writeExclusivePrivateFile(candidatePath, originalBytes);

    const candidateStore = openStore(candidatePath);
    migrateStore(candidateStore);
    makeStorePrivate(candidatePath);

    const currentOriginalBytes = fs.readFileSync(storePath);
    if (!currentOriginalBytes.equals(originalBytes)) {
      throw new StoreInitializationError('unavailable');
    }

    candidateStore.path = storePath;
    if (candidateStore.path !== storePath) {
      throw new StoreInitializationError('unavailable');
    }
    fs.renameSync(candidatePath, storePath);
    candidatePath = null;
    return candidateStore;
  } catch (error) {
    throw new StoreInitializationError(classifyStoreError(error));
  } finally {
    discardCandidate(candidatePath);
  }
}

function attemptStoreInitialization() {
  storeInstance = null;
  try {
    const storePath = getStorePath();
    storeInstance = getFilePresence(storePath)
      ? initializeExistingStore(storePath)
      : initializeFreshStore(storePath);
    storeInitializationStatus = { state: 'ready', reason: null };
  } catch (error) {
    storeInstance = null;
    storeInitializationStatus = {
      state: 'blocked',
      reason: classifyStoreError(error),
    };
  }
  return getStoreInitializationStatus();
}

function initializeStore() {
  if (storeInitializationStatus.state !== 'uninitialized') {
    return getStoreInitializationStatus();
  }
  return attemptStoreInitialization();
}

function retryStoreInitialization() {
  if (storeInitializationStatus.state === 'ready') {
    return getStoreInitializationStatus();
  }
  return attemptStoreInitialization();
}

function isStoreReady() {
  return storeInitializationStatus.state === 'ready' && storeInstance !== null;
}

function getStoreInitializationStatus() {
  return { ...storeInitializationStatus };
}

function getStore() {
  if (!isStoreReady()) {
    const error = new Error('Persistent settings are not ready');
    error.code = 'STORE_NOT_READY';
    error.reason = storeInitializationStatus.reason;
    throw error;
  }
  return storeInstance;
}

/**
 * Get a specific setting by key, or all settings if key is omitted.
 * Secret values are decrypted from the store automatically.
 * @param {string} [key]
 * @returns {object|*}
 */
function getSettings(key) {
  const store = getStore();
  if (key !== undefined) {
    const value = store.get(key);
    if (SECRET_KEYS.includes(key)) {
      if (typeof value !== 'string' || !value.startsWith('enc:')) return '';
      try {
        const buf = Buffer.from(value.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch (_) {
        return '';
      }
    }
    return value;
  }
  return getAllSettings();
}

/**
 * Set a single setting key-value pair.
 * Secret values are encrypted before storage.
 * @param {string} key
 * @param {*} value
 */
function setSetting(key, value) {
  const store = getStore();
  if (key === 'languageHint') {
    store.set(key, 'en');
    return;
  }
  if (SECRET_KEYS.includes(key)) {
    if (typeof value !== 'string') {
      throw new TypeError('API Key must be a string');
    }
    if (!value) {
      store.set(key, '');
      return;
    }
    if (!safeStorageAvailable(safeStorage)) {
      throw new Error('系统安全存储不可用，未保存 API Key');
    }
    let encrypted;
    try {
      encrypted = safeStorage.encryptString(value);
    } catch {
      throw new Error('系统安全存储加密失败，未保存 API Key');
    }
    store.set(key, 'enc:' + encrypted.toString('base64'));
    return;
  }
  store.set(key, value);
}

/**
 * Move the custom provider to a new trust boundary without ever persisting the
 * new URL beside a credential that belonged to the previous origin.
 * electron-store accepts an object form and commits it with one store write.
 * @param {string} customEndpointUrl
 */
function setCustomEndpointBoundary(customEndpointUrl) {
  if (typeof customEndpointUrl !== 'string') {
    throw new TypeError('Custom endpoint URL must be a string');
  }
  getStore().set({
    customEndpointUrl,
    customEndpointApiKey: '',
  });
}

/**
 * Persist a custom endpoint URL while treating an origin change as a secret
 * trust-boundary transition. Same-origin path edits leave the saved key alone.
 * @param {string} customEndpointUrl
 * @returns {{customEndpointApiKeyCleared: boolean}}
 */
function setCustomEndpointUrl(customEndpointUrl) {
  if (typeof customEndpointUrl !== 'string') {
    throw new TypeError('Custom endpoint URL must be a string');
  }
  const store = getStore();
  const previousUrl = store.get('customEndpointUrl');
  let previousOrigin = '';
  try {
    previousOrigin = previousUrl ? new URL(previousUrl).origin : '';
  } catch {
    // A legacy invalid value has no trusted origin and must not retain a key.
  }
  const nextOrigin = customEndpointUrl ? new URL(customEndpointUrl).origin : '';
  const customEndpointApiKeyCleared = previousOrigin !== nextOrigin;
  if (customEndpointApiKeyCleared) {
    setCustomEndpointBoundary(customEndpointUrl);
  } else {
    store.set('customEndpointUrl', customEndpointUrl);
  }
  return { customEndpointApiKeyCleared };
}

/**
 * Get all settings as a plain object (with decrypted secrets).
 * @returns {UserSettings}
 */
function getAllSettings() {
  const store = getStore();
  const raw = { ...store.store };
  for (const key of SECRET_KEYS) {
    if (typeof raw[key] !== 'string' || !raw[key].startsWith('enc:')) {
      raw[key] = '';
      continue;
    }
    try {
      const buf = Buffer.from(raw[key].slice(4), 'base64');
      raw[key] = safeStorage.decryptString(buf);
    } catch (_) {
      raw[key] = '';
    }
  }
  if (!isHttpLoopbackEndpoint(raw.ollamaBaseUrl)) {
    raw.ollamaBaseUrl = '';
    if (raw.activeBackend === 'ollama') raw.setupMode = 'unconfigured';
  }
  return raw;
}

function getSavedTerms() {
  return getStore().get('savedTerms') || [];
}

function addSavedTerm(term) {
  let savedTerm = minimizeSavedTerm(term);
  if (!savedTerm) throw new Error('Term is required');
  const terms = getSavedTerms();
  const key = normalizeSavedTermKey(savedTerm.term);
  const existing = terms.find((item) => normalizeSavedTermKey(item?.term) === key);
  if (existing && term?.id == null) {
    savedTerm = {
      ...savedTerm,
      id: existing.id,
      createdAt: existing.createdAt,
    };
  }
  getStore().set('savedTerms', [
    savedTerm,
    ...terms.filter((item) => (
      item?.id !== savedTerm.id
      && normalizeSavedTermKey(item?.term) !== key
    )),
  ].slice(0, 50));
  return savedTerm;
}

function deleteSavedTerm(id) {
  const terms = getSavedTerms();
  getStore().set('savedTerms', terms.filter((term) => term.id !== id));
}

function mergeSavedTerms(terms) {
  const merged = mergePortableTerms(getSavedTerms(), terms, { limit: 50 });
  getStore().set('savedTerms', merged.terms);
  return merged;
}

function clearSavedTerms() {
  getStore().set('savedTerms', []);
}

function getExplanationHistory() {
  return getStore().get('explanationHistory') || [];
}

function addExplanationHistory(entry) {
  const sourceText = typeof entry?.sourceText === 'string' ? entry.sourceText : '';
  const explanation = typeof entry?.explanation === 'string' ? entry.explanation : '';
  if (!sourceText.trim() || !explanation.trim()) {
    throw new Error('History entry requires source text and explanation');
  }
  // Kept as a compatibility no-op for older callers. Deliberately do not
  // persist captured source text or generated explanations.
  clearExplanationHistory();
  return { stored: false };
}

function clearExplanationHistory() {
  getStore().set('explanationHistory', []);
}

function deleteExplanationHistory(id) {
  getStore().set(
    'explanationHistory',
    getExplanationHistory().filter((entry) => entry.id !== id)
  );
}

function clearSecrets() {
  const store = getStore();
  for (const key of SECRET_KEYS) store.set(key, '');
}

function clearRetainedContent() {
  clearSavedTerms();
  clearExplanationHistory();
}

function clearUserData() {
  clearSecrets();
  clearRetainedContent();
}

function createRecoveryArchivePath(storePath) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(8).toString('hex');
    const fileName = `${STORE_NAME}.recovery-${timestamp}-${suffix}.json`;
    const archivePath = path.join(path.dirname(storePath), fileName);
    if (!fs.existsSync(archivePath)) return archivePath;
  }
  throw new StoreInitializationError('unavailable');
}

function restoreArchivedStore(archivePath, storePath) {
  try {
    fs.renameSync(archivePath, storePath);
    return true;
  } catch {
    return false;
  }
}

function recoveryResetStore() {
  if (storeInitializationStatus.state !== 'blocked') {
    return { status: 'failed', reason: 'unavailable' };
  }

  let storePath;
  let archivePath = null;
  let originalWasArchived = false;
  try {
    storePath = getStorePath();
    if (getFilePresence(storePath)) {
      archivePath = createRecoveryArchivePath(storePath);
      makeStorePrivate(storePath);
      fs.renameSync(storePath, archivePath);
      originalWasArchived = true;
    }

    const freshStore = initializeFreshStore(storePath);
    storeInstance = freshStore;
    storeInitializationStatus = { state: 'ready', reason: null };
    return {
      status: 'recovered',
      backupCreated: originalWasArchived,
      backupFileName: originalWasArchived ? path.basename(archivePath) : null,
    };
  } catch (error) {
    let reason = classifyStoreError(error);
    storeInstance = null;
    if (originalWasArchived && !restoreArchivedStore(archivePath, storePath)) {
      reason = 'unavailable';
    } else if (!originalWasArchived && storePath) {
      discardCandidate(storePath);
    }
    storeInitializationStatus = { state: 'blocked', reason };
    return { status: 'failed', reason };
  }
}

function removeRecoveryArchives(storePath) {
  if (typeof storePath !== 'string' || !storePath) return;
  const directory = path.dirname(storePath);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!RECOVERY_ARCHIVE_PATTERN.test(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    fs.unlinkSync(path.join(directory, entry.name));
  }
}

function resetUserDataAndSettings() {
  const store = getStore();
  // electron-store restores schema defaults during clear(), so credentials,
  // retained terms and preferences are replaced in one authoritative write
  // instead of a long renderer-driven series that can stop halfway through.
  store.clear();
  runPrivacyMigrations(store);
  removeRecoveryArchives(store.path);
  return getAllSettings();
}

module.exports = {
  initializeStore,
  retryStoreInitialization,
  isStoreReady,
  getStoreInitializationStatus,
  recoveryResetStore,
  getSettings,
  setSetting,
  setCustomEndpointUrl,
  getAllSettings,
  getSavedTerms,
  addSavedTerm,
  deleteSavedTerm,
  mergeSavedTerms,
  clearSavedTerms,
  getExplanationHistory,
  addExplanationHistory,
  clearExplanationHistory,
  deleteExplanationHistory,
  clearSecrets,
  clearRetainedContent,
  clearUserData,
  resetUserDataAndSettings,
  minimizeSavedTerm,
  minimizeSavedTermsInStore,
  migrateLegacySecretsInStore,
  migrateUnsafeOllamaEndpointInStore,
  migrateProductReadinessInStore,
  migrateClipboardPrivacyInStore,
  runPrivacyMigrations,
};
