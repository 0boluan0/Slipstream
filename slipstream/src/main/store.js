const crypto = require('crypto');

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

const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update('slipstream-v1-encryption-key')
  .digest('hex')
  .slice(0, 32);

const schema = {
  anthropicApiKey: {
    type: 'string',
    default: '',
  },
  openaiApiKey: {
    type: 'string',
    default: '',
  },
  ollamaBaseUrl: {
    type: 'string',
    default: 'http://localhost:11434',
  },
  customEndpointUrl: {
    type: 'string',
    default: '',
  },
  customEndpointApiKey: {
    type: 'string',
    default: '',
  },
  activeBackend: {
    type: 'string',
    default: 'anthropic',
  },
  activeModel: {
    type: 'string',
    default: 'claude-sonnet-4-20250514',
  },
  customPrompt: {
    type: 'string',
    default: '',
  },
  languageHint: {
    type: 'string',
    default: 'en',
  },
  windowWidth: {
    type: 'number',
    default: 480,
  },
  windowHeight: {
    type: 'number',
    default: 600,
  },
  windowX: {
    type: ['number', 'null'],
    default: null,
  },
  windowY: {
    type: ['number', 'null'],
    default: null,
  },
  startMinimized: {
    type: 'boolean',
    default: false,
  },
  clipboardMonitoring: {
    type: 'boolean',
    default: true,
  },
};

let storeInstance = null;

function getStore() {
  if (!storeInstance) {
    storeInstance = new Store({
      name: 'slipstream-settings',
      schema,
      encryptionKey: ENCRYPTION_KEY,
      clearInvalidConfig: true,
    });
  }
  return storeInstance;
}

/**
 * Get a specific setting by key, or all settings if key is omitted.
 * @param {string} [key]
 * @returns {object|*}
 */
function getSettings(key) {
  const store = getStore();
  if (key !== undefined) {
    return store.get(key);
  }
  return getAllSettings();
}

/**
 * Set a single setting key-value pair.
 * @param {string} key
 * @param {*} value
 */
function setSetting(key, value) {
  const store = getStore();
  store.set(key, value);
}

/**
 * Get all settings as a plain object.
 * @returns {UserSettings}
 */
function getAllSettings() {
  const store = getStore();
  return store.store;
}

module.exports = {
  getSettings,
  setSetting,
  getAllSettings,
};
