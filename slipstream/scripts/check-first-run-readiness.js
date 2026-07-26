const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { redactSettingsForRenderer } = require('../src/main/safe-settings');
const { validateSetting } = require('../src/main/validation');

const projectRoot = path.resolve(__dirname, '..');
const storeModulePath = require.resolve('../src/main/store');

function loadStoreWithMocks(initialData = {}, storageOverride) {
  const originalLoad = Module._load;
  let instance;

  class FakeStore {
    constructor(options) {
      this.store = {};
      for (const [key, definition] of Object.entries(options.schema || {})) {
        if (Object.hasOwn(definition, 'default')) this.store[key] = structuredClone(definition.default);
      }
      Object.assign(this.store, structuredClone(initialData));
      instance = this;
    }

    get(key) {
      return this.store[key];
    }

    set(key, value) {
      this.store[key] = value;
    }
  }

  const safeStorage = storageOverride || {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^sealed:/, ''),
  };

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { safeStorage };
    if (request === 'electron-store') return FakeStore;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[storeModulePath];
  try {
    const store = require(storeModulePath);
    store.getAllSettings();
    return { store, raw: () => instance.store };
  } finally {
    Module._load = originalLoad;
    delete require.cache[storeModulePath];
  }
}

async function main() {
  const {
    hasEndpointOriginChanged,
    isBackendReadyForFullAnalysis,
    isSetupComplete,
    normalizeLoadedSettings,
    SETUP_MODES,
  } = await import('../src/renderer/utils/setupReadiness.mjs');

  assert.equal(isSetupComplete({ setupMode: SETUP_MODES.UNCONFIGURED }), false);
  assert.equal(isSetupComplete({ setupMode: SETUP_MODES.FULL }), false);
  assert.equal(isSetupComplete({ setupMode: SETUP_MODES.TRANSLATION_ONLY }), false);
  assert.equal(isSetupComplete({
    setupMode: SETUP_MODES.FULL,
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    hasOpenaiApiKey: true,
  }), true);
  assert.equal(isSetupComplete({
    setupMode: SETUP_MODES.TRANSLATION_ONLY,
    activeBackend: 'free_translate',
  }), true);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    hasOpenaiApiKey: true,
  }), true);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    hasOpenaiApiKey: false,
  }), false);
  assert.equal(hasEndpointOriginChanged('https://api.example.com/v1', 'https://api.example.com/v2'), false);
  assert.equal(hasEndpointOriginChanged('https://api.example.com/v1', 'https://other.example.com/v1'), true);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'free_translate',
    activeModel: 'google-translate',
  }), false);

  const normalized = normalizeLoadedSettings(
    { setupMode: SETUP_MODES.UNCONFIGURED, languageHint: 'en' },
    { activeBackend: 'openai', activeModel: 'gpt-4o-mini', hasOpenaiApiKey: true, languageHint: 'auto' }
  );
  assert.equal(normalized.setupMode, SETUP_MODES.FULL, 'legacy configured renderer settings should remain usable');
  assert.equal(normalized.languageHint, 'en', 'renderer must never restore the removed language directions');
  const missingKey = normalizeLoadedSettings(
    { setupMode: SETUP_MODES.UNCONFIGURED, languageHint: 'en' },
    { activeBackend: 'openai', activeModel: 'gpt-4o-mini' }
  );
  assert.equal(missingKey.setupMode, SETUP_MODES.UNCONFIGURED, 'a provider selection without credentials must not bypass setup');

  assert.deepEqual(validateSetting('setupMode', SETUP_MODES.FULL), ['setupMode', SETUP_MODES.FULL]);
  assert.deepEqual(validateSetting('setupMode', SETUP_MODES.TRANSLATION_ONLY), ['setupMode', SETUP_MODES.TRANSLATION_ONLY]);
  assert.throws(() => validateSetting('setupMode', 'implicit'), /功能模式/);
  assert.deepEqual(validateSetting('languageHint', 'en'), ['languageHint', 'en']);
  assert.throws(() => validateSetting('languageHint', 'zh'), /英文到中文/);
  assert.throws(() => validateSetting('languageHint', 'auto'), /英文到中文/);

  let cleanKeychainProbeCount = 0;
  const clean = loadStoreWithMocks({}, {
    isEncryptionAvailable: () => {
      cleanKeychainProbeCount += 1;
      return true;
    },
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^sealed:/, ''),
  });
  assert.equal(clean.store.getSettings('setupMode'), SETUP_MODES.UNCONFIGURED);
  assert.equal(clean.store.getSettings('languageHint'), 'en');
  assert.equal(clean.raw().productReadinessVersion, 2);
  assert.equal(cleanKeychainProbeCount, 0, 'a clean launch must not block on Keychain when no secret exists');

  const legacyConfigured = loadStoreWithMocks({
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    openaiApiKey: 'legacy-secret',
    languageHint: 'auto',
  });
  assert.equal(legacyConfigured.store.getSettings('setupMode'), SETUP_MODES.FULL);
  assert.equal(legacyConfigured.store.getSettings('languageHint'), 'en');
  assert.equal(legacyConfigured.raw().productReadinessVersion, 2);

  const legacyDeepSeek = loadStoreWithMocks({
    productReadinessVersion: 1,
    setupMode: SETUP_MODES.FULL,
    activeBackend: 'deepseek',
    activeModel: 'deepseek-chat',
    deepseekApiKey: 'legacy-secret',
  });
  assert.equal(legacyDeepSeek.store.getSettings('setupMode'), SETUP_MODES.FULL);
  assert.equal(legacyDeepSeek.store.getSettings('activeModel'), 'deepseek-v4-flash');
  assert.equal(legacyDeepSeek.raw().productReadinessVersion, 2);

  const unavailableKeychain = loadStoreWithMocks({
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    openaiApiKey: `enc:${Buffer.from('sealed:legacy-secret').toString('base64')}`,
  }, {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('unavailable'); },
    decryptString: () => { throw new Error('unavailable'); },
  });
  assert.equal(unavailableKeychain.store.getSettings('setupMode'), SETUP_MODES.UNCONFIGURED);

  const explicitBasic = loadStoreWithMocks({
    productReadinessVersion: 1,
    setupMode: SETUP_MODES.TRANSLATION_ONLY,
    activeBackend: 'openai',
    activeModel: 'gpt-4o-mini',
    openaiApiKey: 'legacy-secret',
    languageHint: 'zh',
  });
  assert.equal(explicitBasic.store.getSettings('setupMode'), SETUP_MODES.TRANSLATION_ONLY);
  assert.equal(explicitBasic.store.getSettings('activeBackend'), 'free_translate');
  assert.equal(explicitBasic.store.getSettings('activeModel'), 'google-translate');
  assert.equal(explicitBasic.store.getSettings('languageHint'), 'en');

  const redacted = redactSettingsForRenderer({ setupMode: SETUP_MODES.FULL, openaiApiKey: 'secret' });
  assert.equal(redacted.setupMode, SETUP_MODES.FULL);
  assert.equal(Object.hasOwn(redacted, 'openaiApiKey'), false);

  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/App.jsx'), 'utf8');
  const gateSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/SetupGate.jsx'), 'utf8');
  const languageSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/LanguageToggle.jsx'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/SettingsPanel.jsx'), 'utf8');
  const settingsStyles = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/SettingsPanel.css'), 'utf8');
  assert.match(appSource, /!setupComplete && view !== 'settings'/, 'unconfigured users must be gated before the processing panel mounts');
  assert.match(appSource, /hidden=\{view === 'settings'\}/, 'opening settings must hide rather than unmount the active result');
  assert.match(appSource, /visible=\{view !== 'settings'\}/, 'returning from settings must reactivate result focus');
  assert.match(appSource, /WINDOW_SET_MODE, 'setup'/, 'the first-run choice must request the dedicated setup window');
  assert.match(appSource, /setupWindowActiveRef/, 'leaving first-run setup must not resize an existing result opened from settings');
  assert.match(gateSource, /我明确选择只用基础翻译/);
  assert.match(gateSource, /不包含行动步骤、材料清单、截止日期、术语解释或流程说明/);
  assert.match(gateSource, /Google \/ MyMemory/, 'the first choice must disclose where basic translation sends text');
  assert.doesNotMatch(languageSource, /LANGUAGES\.ZH|LANGUAGES\.AUTO|onChange\(/);
  assert.match(languageSource, /英文.*中文/s);
  assert.match(settingsSource, /必需连接信息已填写，尚未验证/);
  assert.match(settingsSource, /清除全部 API Key 和连接凭据、保存的术语及所有设置/);
  assert.match(settingsSource, /aria-label="自动检测剪贴板"/);
  assert.match(settingsStyles, /input:focus-visible \+ span/);
  assert.match(settingsSource, /customOriginChanged[\s\S]*updateSettings\('customEndpointApiKey', ''\)/);
  assert.match(settingsSource, /width: '100%'[\s\S]*height: '100%'/, 'settings must fill the wider first-run window');

  console.log('first-run readiness and fixed language checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
