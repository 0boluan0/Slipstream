const { safeStorage } = require('electron');
const { SECRET_SETTING_KEYS } = require('./safe-settings');

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
  clipboardShortcut: { type: 'string', default: 'Alt+C' },
  screenshotShortcut: { type: 'string', default: 'F2' },
  savedTerms: { type: 'array', default: [] },
  explanationHistory: { type: 'array', default: [] },
};

const SECRET_KEYS = SECRET_SETTING_KEYS;
const PRIVACY_STORAGE_VERSION = 1;
const MAX_EVIDENCE_CHARS = 180;
const MAX_TERM_EXPLANATION_CHARS = 400;

let storeInstance = null;

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

function minimizeSavedTerm(term) {
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
    id: term?.id ?? Date.now(),
    createdAt: typeof term?.createdAt === 'string' ? term.createdAt : new Date().toISOString(),
    term: label,
    evidence,
    explanation,
  };
}

function minimizeSavedTermsInStore(store) {
  const current = store.get('savedTerms');
  const minimized = (Array.isArray(current) ? current : []).map(minimizeSavedTerm).filter(Boolean).slice(0, 50);
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
  const encryptionAvailable = safeStorageAvailable(storage);
  const migrated = [];
  const cleared = [];

  for (const key of SECRET_KEYS) {
    const value = store.get(key);
    if (typeof value !== 'string' || !value) continue;
    if (value.startsWith('enc:')) {
      if (encryptionAvailable) {
        try {
          storage.decryptString(Buffer.from(value.slice(4), 'base64'));
        } catch {
          store.set(key, '');
          cleared.push(key);
        }
      }
      continue;
    }
    if (!encryptionAvailable) {
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

function runPrivacyMigrations(store) {
  const secrets = migrateLegacySecretsInStore(store);
  const terms = minimizeSavedTermsInStore(store);
  if ((store.get('privacyStorageVersion') || 0) < PRIVACY_STORAGE_VERSION) {
    store.set('privacyStorageVersion', PRIVACY_STORAGE_VERSION);
  }
  return { secrets, terms };
}

function getStore() {
  if (!storeInstance) {
    storeInstance = new Store({
      name: 'slipstream-settings',
      schema,
      clearInvalidConfig: true,
    });
    runPrivacyMigrations(storeInstance);
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
  return raw;
}

function getSavedTerms() {
  return getStore().get('savedTerms') || [];
}

function addSavedTerm(term) {
  const savedTerm = minimizeSavedTerm(term);
  if (!savedTerm) throw new Error('Term is required');
  const terms = getSavedTerms();
  getStore().set('savedTerms', [savedTerm, ...terms].slice(0, 50));
  return savedTerm;
}

function deleteSavedTerm(id) {
  const terms = getSavedTerms();
  getStore().set('savedTerms', terms.filter((term) => term.id !== id));
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
  const historyEntry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    sourceText,
    explanation,
    backend: typeof entry?.backend === 'string' ? entry.backend : '',
    model: typeof entry?.model === 'string' ? entry.model : '',
    source: typeof entry?.source === 'string' ? entry.source : '',
  };
  getStore().set('explanationHistory', [historyEntry, ...getExplanationHistory()].slice(0, 50));
  return historyEntry;
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

module.exports = {
  getSettings,
  setSetting,
  getAllSettings,
  getSavedTerms,
  addSavedTerm,
  deleteSavedTerm,
  clearSavedTerms,
  getExplanationHistory,
  addExplanationHistory,
  clearExplanationHistory,
  deleteExplanationHistory,
  clearSecrets,
  clearRetainedContent,
  clearUserData,
  minimizeSavedTerm,
  minimizeSavedTermsInStore,
  migrateLegacySecretsInStore,
  runPrivacyMigrations,
};
