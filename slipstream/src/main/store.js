const { safeStorage } = require('electron');

/**
 * @typedef {Object} UserSettings
 * @property {string} anthropicApiKey
 * @property {string} openaiApiKey
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
 */

let Store = require('electron-store');

const schema = {
  anthropicApiKey: { type: 'string', default: '' },
  openaiApiKey: { type: 'string', default: '' },
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
};

const SECRET_KEYS = ['anthropicApiKey', 'openaiApiKey', 'customEndpointApiKey'];

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

module.exports = {
  getSettings,
  setSetting,
  getAllSettings,
};
