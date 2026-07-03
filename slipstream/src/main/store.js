const { safeStorage } = require('electron');

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
  activeBackend: { type: 'string', default: 'anthropic' },
  activeModel: { type: 'string', default: 'claude-sonnet-4-20250514' },
  customPrompt: { type: 'string', default: '' },
  languageHint: { type: 'string', default: 'en' },
  windowWidth: { type: 'number', default: 480 },
  windowHeight: { type: 'number', default: 600 },
  windowX: { type: ['number', 'null'], default: null },
  windowY: { type: ['number', 'null'], default: null },
  startMinimized: { type: 'boolean', default: false },
  clipboardMonitoring: { type: 'boolean', default: true },
  clipboardShortcut: { type: 'string', default: 'Alt+C' },
  screenshotShortcut: { type: 'string', default: 'F2' },
  savedTerms: { type: 'array', default: [] },
  explanationHistory: { type: 'array', default: [] },
};

const SECRET_KEYS = ['anthropicApiKey', 'openaiApiKey', 'deepseekApiKey', 'customEndpointApiKey'];

let storeInstance = null;

function getStore() {
  if (!storeInstance) {
    storeInstance = new Store({
      name: 'slipstream-settings',
      schema,
      clearInvalidConfig: true,
    });
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
    if (SECRET_KEYS.includes(key) && typeof value === 'string' && value.startsWith('enc:')) {
      try {
        const buf = Buffer.from(value.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch (_) {
        return value;
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
  if (SECRET_KEYS.includes(key) && typeof value === 'string' && safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value);
    store.set(key, 'enc:' + encrypted.toString('base64'));
  } else {
    store.set(key, value);
  }
}

/**
 * Get all settings as a plain object (with decrypted secrets).
 * @returns {UserSettings}
 */
function getAllSettings() {
  const store = getStore();
  const raw = { ...store.store };
  for (const key of SECRET_KEYS) {
    if (typeof raw[key] === 'string' && raw[key].startsWith('enc:')) {
      try {
        const buf = Buffer.from(raw[key].slice(4), 'base64');
        raw[key] = safeStorage.decryptString(buf);
      } catch (_) {
        // leave as-is if decryption fails
      }
    }
  }
  return raw;
}

function getSavedTerms() {
  return getStore().get('savedTerms') || [];
}

function addSavedTerm(term) {
  const label = typeof term?.term === 'string' ? term.term.trim() : '';
  if (!label) {
    throw new Error('Term is required');
  }
  const terms = getSavedTerms();
  const savedTerm = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    term: label,
    sourceText: typeof term?.sourceText === 'string' ? term.sourceText : '',
    explanation: typeof term?.explanation === 'string' ? term.explanation : '',
  };
  getStore().set('savedTerms', [savedTerm, ...terms].slice(0, 50));
  return savedTerm;
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

module.exports = {
  getSettings,
  setSetting,
  getAllSettings,
  getSavedTerms,
  addSavedTerm,
  getExplanationHistory,
  addExplanationHistory,
};
