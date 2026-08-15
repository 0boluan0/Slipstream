const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { redactSettingsForRenderer } = require('../src/main/safe-settings');
const { validateSetting } = require('../src/main/validation');

const projectRoot = path.resolve(__dirname, '..');
const storeModulePath = require.resolve('../src/main/store');

function loadStoreWithMocks(initialData = {}, storageOverride) {
  const originalLoad = Module._load;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-first-run-'));
  let instance;

  class FakeStore {
    constructor(options) {
      this.defaults = {};
      for (const [key, definition] of Object.entries(options.schema || {})) {
        if (Object.hasOwn(definition, 'default')) this.defaults[key] = structuredClone(definition.default);
      }
      this.store = structuredClone(this.defaults);
      Object.assign(this.store, structuredClone(initialData));
      this.path = path.join(options.cwd, `${options.name}.json`);
      fs.writeFileSync(this.path, JSON.stringify(this.store), { mode: 0o600 });
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

  const safeStorage = storageOverride || {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^sealed:/, ''),
  };

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
    return { store, raw: () => instance.store };
  } finally {
    Module._load = originalLoad;
    delete require.cache[storeModulePath];
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

async function main() {
  const {
    ANALYSIS_LOCATIONS,
    analysisLocationForBackend,
    analysisLocationForSettings,
    hasEndpointOriginChanged,
    isBackendReadyForFullAnalysis,
    isSetupComplete,
    normalizeLoadedSettings,
    SETUP_MODES,
  } = await import('../src/renderer/utils/setupReadiness.mjs');
  const { describeConnectionTestExitIntent } = await import('../src/renderer/utils/connectionTestExit.mjs');
  const { describeSettingsDraftIntent } = await import('../src/renderer/utils/settingsDraftGuard.mjs');
  const {
    createFailedSaveOperation,
    failedSaveEntries,
    mergeFailedSaveOperation,
    PROCESSING_CONFIG_KEYS,
    reconcileFailedSaveOperation,
  } = await import('../src/renderer/utils/failedSettingsRetry.mjs');
  const {
    claimSetupChoice,
    releaseSetupChoice,
    SETUP_CHOICE_ACTIONS,
    TRANSLATION_ONLY_SETUP_KEYS,
  } = await import('../src/renderer/utils/setupChoiceTransaction.mjs');

  assert.deepEqual(TRANSLATION_ONLY_SETUP_KEYS, [
    'activeBackend',
    'activeModel',
    'languageHint',
    'setupMode',
  ], 'switching to full analysis must revoke every write from the older basic choice');

  const choiceLock = { current: null };
  const firstChoice = claimSetupChoice(
    choiceLock,
    SETUP_CHOICE_ACTIONS.SAVE_TRANSLATION_ONLY,
  );
  assert.ok(firstChoice, 'the first setup action must synchronously claim the choice transaction');
  assert.equal(
    claimSetupChoice(choiceLock, SETUP_CHOICE_ACTIONS.CONFIGURE_FULL),
    null,
    'a competing CTA in the same event frame must be rejected before React state flushes',
  );
  assert.equal(releaseSetupChoice(choiceLock, { action: firstChoice.action }), false,
    'a stale completion must not release the active choice transaction');
  assert.strictEqual(choiceLock.current, firstChoice);
  assert.equal(releaseSetupChoice(choiceLock, firstChoice), true);
  const retryChoice = claimSetupChoice(
    choiceLock,
    SETUP_CHOICE_ACTIONS.RETRY_TRANSLATION_ONLY,
  );
  assert.ok(retryChoice, 'the user may retry after the previous transaction settles');
  assert.equal(releaseSetupChoice(choiceLock, retryChoice), true);

  for (const key of [
    'anthropicApiKey',
    'openaiApiKey',
    'deepseekApiKey',
    'ollamaBaseUrl',
    'customEndpointUrl',
    'customEndpointApiKey',
    'activeBackend',
    'activeModel',
    'customPrompt',
    'languageHint',
    'verificationPolicy',
  ]) {
    assert.equal(PROCESSING_CONFIG_KEYS.has(key), true,
      `${key} must invalidate an older full-setup retry`);
  }

  const failedFullSetup = createFailedSaveOperation([
    ['languageHint', 'en'],
    ['setupMode', SETUP_MODES.FULL],
  ], 7);
  const unchangedFullSetup = reconcileFailedSaveOperation(failedFullSetup, 7);
  assert.equal(unchangedFullSetup.invalidated, false,
    'a full-setup save may be retried while its processing configuration is unchanged');
  assert.strictEqual(unchangedFullSetup.operation, failedFullSetup);
  assert.deepEqual(failedSaveEntries(unchangedFullSetup.operation), [
    ['languageHint', 'en'],
    ['setupMode', SETUP_MODES.FULL],
  ]);

  const staleFullSetup = reconcileFailedSaveOperation(failedFullSetup, 8);
  assert.equal(staleFullSetup.invalidated, true,
    'a processing configuration change must revoke an older full-setup retry');
  assert.equal(staleFullSetup.operation, null);
  assert.deepEqual(staleFullSetup.removedKeys, ['languageHint', 'setupMode']);

  const ordinaryFailure = createFailedSaveOperation([
    ['activeModel', 'replacement-model'],
  ], 7);
  const retainedOrdinaryFailure = reconcileFailedSaveOperation(ordinaryFailure, 8);
  assert.equal(retainedOrdinaryFailure.invalidated, false,
    'a failed configuration write without a full-setup completion must remain retryable');
  assert.deepEqual(failedSaveEntries(retainedOrdinaryFailure.operation), [
    ['activeModel', 'replacement-model'],
  ]);

  const mixedFailure = createFailedSaveOperation([
    ['activeModel', 'tested-model'],
    ['windowWidth', 560],
    ['setupMode', SETUP_MODES.FULL],
  ], 9);
  const reconciledMixedFailure = reconcileFailedSaveOperation(mixedFailure, 10);
  assert.equal(reconciledMixedFailure.invalidated, true);
  assert.deepEqual(reconciledMixedFailure.removedKeys, ['activeModel', 'setupMode']);
  assert.deepEqual(failedSaveEntries(reconciledMixedFailure.operation), [
    ['windowWidth', 560],
  ], 'invalidating stale full setup must preserve unrelated failed settings');

  const queuedPromptFailure = mergeFailedSaveOperation(null, [
    ['customPrompt', 'fictional failed prompt A'],
  ], 11);
  const queuedIndependentFailure = mergeFailedSaveOperation(queuedPromptFailure, [
    ['windowWidth', 580],
  ], 11);
  assert.deepEqual(failedSaveEntries(queuedIndependentFailure), [
    ['customPrompt', 'fictional failed prompt A'],
    ['windowWidth', 580],
  ], 'a later failed setting must not orphan an earlier prompt retry');
  const replacedPromptFailure = mergeFailedSaveOperation(queuedIndependentFailure, [
    ['customPrompt', 'fictional failed prompt B'],
  ], 12);
  assert.deepEqual(failedSaveEntries(replacedPromptFailure), [
    ['windowWidth', 580],
    ['customPrompt', 'fictional failed prompt B'],
  ], 'a newer attempt must replace only the matching failed key');

  const failedFullSetupWithIndependentFailure = mergeFailedSaveOperation(
    failedFullSetup,
    [['windowWidth', 600]],
    8,
  );
  assert.equal(failedFullSetupWithIndependentFailure.fullSetupConfigGeneration, 7,
    'an unrelated later failure must not make a stale full-setup retry current again');
  assert.deepEqual(
    failedSaveEntries(reconcileFailedSaveOperation(
      failedFullSetupWithIndependentFailure,
      8,
    ).operation),
    [['windowWidth', 600]],
  );

  const closeDraftIntent = describeSettingsDraftIntent({ kind: 'close' });
  assert.equal(closeDraftIntent.actionLabel, '返回主面板');
  assert.match(closeDraftIntent.detail, /仍有未保存的输入/);
  assert.match(closeDraftIntent.detail, /已经安全保存的配置不会改变/);
  const activateModeDraftIntent = describeSettingsDraftIntent(
    { kind: 'activate-mode', value: SETUP_MODES.FULL },
    { guidedSetup: true, hasPromptDraft: true },
  );
  assert.equal(activateModeDraftIntent.actionLabel, '启用完整分析');
  assert.equal(activateModeDraftIntent.confirmLabel, '放弃草稿并启用完整分析');
  assert.equal(
    describeSettingsDraftIntent({ kind: 'close' }, { guidedSetup: true }).actionLabel,
    '返回首次使用选择',
  );
  assert.equal(
    describeConnectionTestExitIntent({ kind: 'close' }, { guidedSetup: true }).confirmLabel,
    '停止验证并返回首次使用选择',
  );
  assert.equal(
    describeSettingsDraftIntent({ kind: 'backend', value: 'anthropic' }).actionLabel,
    '切换到 Anthropic',
  );
  assert.equal(
    describeSettingsDraftIntent({ kind: 'backend', value: 'free_translate' }).actionLabel,
    '改用基础翻译',
  );
  assert.equal(
    describeSettingsDraftIntent({ kind: 'location', value: 'local' }).actionLabel,
    '改为在本机分析',
  );

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
  const localOllamaSettings = {
    activeBackend: 'ollama',
    activeModel: 'qwen2.5',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
  };
  assert.equal(isBackendReadyForFullAnalysis(localOllamaSettings), true);
  assert.equal(
    analysisLocationForBackend('ollama', localOllamaSettings),
    ANALYSIS_LOCATIONS.LOCAL,
  );
  for (const ollamaBaseUrl of ['', 'https://ollama.example.com', 'http://example.com']) {
    const unsafeOllamaSettings = { ...localOllamaSettings, ollamaBaseUrl };
    assert.equal(isBackendReadyForFullAnalysis(unsafeOllamaSettings), false);
    assert.equal(analysisLocationForBackend('ollama', unsafeOllamaSettings), null);
  }
  for (const backend of ['anthropic', 'openai', 'deepseek']) {
    assert.equal(analysisLocationForBackend(backend), ANALYSIS_LOCATIONS.ONLINE);
  }
  assert.equal(analysisLocationForBackend('custom'), null);
  assert.equal(analysisLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: 'http://127.0.0.1:8000/v1',
  }), ANALYSIS_LOCATIONS.LOCAL);
  assert.equal(analysisLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: 'https://api.example.com/v1',
  }), ANALYSIS_LOCATIONS.ONLINE);
  assert.equal(analysisLocationForSettings({
    activeBackend: 'custom',
    customEndpointUrl: 'http://example.com/v1',
  }), null);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'custom',
    activeModel: 'custom-model',
    customEndpointUrl: 'http://127.0.0.1:8000/v1',
  }), true);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'custom',
    activeModel: 'custom-model',
    customEndpointUrl: 'https://api.example.com/v1',
  }), true);
  assert.equal(isBackendReadyForFullAnalysis({
    activeBackend: 'custom',
    activeModel: 'custom-model',
    customEndpointUrl: 'http://example.com/v1',
  }), false);
  assert.equal(analysisLocationForBackend('free_translate'), null);
  assert.equal(analysisLocationForBackend('unknown'), null);

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
  const apiKeySource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/ApiKeyInput.jsx'), 'utf8');
  const languageSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/LanguageToggle.jsx'), 'utf8');
  const modelSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/ModelSelector.jsx'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/SettingsPanel.jsx'), 'utf8');
  const settingsTransitionSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/components/SettingsTransitionDialog.jsx'),
    'utf8',
  );
  const settingsStyles = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/SettingsPanel.css'), 'utf8');
  const settingsResetDialogSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/components/SettingsResetDialog.jsx'),
    'utf8',
  );
  const settingsHookSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/hooks/useSettings.js'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/hooks/useIpc.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
  assert.match(appSource, /const showSetupGate = !setupComplete && view !== 'settings'/,
    'unconfigured users must be gated before the processing panel becomes visible');
  assert.match(appSource, /hidden=\{!showPanel\}/,
    'setup and settings must hide rather than unmount the capture owner or active result');
  assert.match(appSource, /visible=\{showPanel\}/,
    'leaving setup or settings must reactivate the preserved panel state');
  assert.match(appSource, /WINDOW_SET_MODE, 'setup'/, 'the first-run choice must request the dedicated setup window');
  assert.match(appSource, /setupWindowActiveRef/, 'leaving first-run setup must not resize an existing result opened from settings');
  assert.doesNotMatch(
    appSource,
    /event\.key === 'Escape'[\s\S]*?setView\(setupComplete \? 'panel' : 'setup'\)/,
    'App must not bypass the settings draft guard on Escape',
  );
  assert.match(gateSource, /我明确选择只用基础翻译/);
  assert.match(gateSource, /不包含行动步骤、材料清单、截止日期、术语解释或流程说明/);
  assert.match(gateSource, /Google \/ MyMemory/, 'the first choice must disclose where basic translation sends text');
  assert.match(gateSource, /retryFailedSettings/);
  assert.match(gateSource, /重试保存/,
    'a failed translation-only choice must offer a real retry action');
  assert.equal((gateSource.match(/disabled=\{choiceBusy\}/g) || []).length, 3,
    'both setup CTAs and retry must be unavailable while any choice transaction is active');
  assert.match(
    gateSource,
    /discardFailedSettings\(TRANSLATION_ONLY_SETUP_KEYS\);[\s\S]*?onConfigureFull\(\)/,
    'entering full-analysis settings must revoke an older translation-only retry first',
  );
  assert.doesNotMatch(languageSource, /LANGUAGES\.ZH|LANGUAGES\.AUTO|onChange\(/);
  assert.match(languageSource, /英文.*中文/s);
  assert.match(settingsSource, /必需连接信息已填写，尚未验证/);
  assert.match(settingsSource, /先决定文字在哪里分析/,
    'first-run setup must ask for a user-understandable local or online intent before provider names');
  assert.match(settingsSource, /留在这台 Mac/);
  assert.match(settingsSource, /使用在线分析服务/);
  assert.match(settingsSource, /其他设置 · 可以稍后调整/,
    'secondary preferences should not compete with the first-run connection task');
  assert.match(settingsSource, /const isGuidedSetup = settings\.setupMode === SETUP_MODES\.UNCONFIGURED/,
    'an incomplete setup must have an explicit focused state');
  assert.match(settingsSource, /配置完整分析/,
    'the focused setup header must name the task instead of presenting generic settings');
  assert.match(settingsSource, /遇到问题？查看应用状态与支持/,
    'support must remain reachable from the focused setup without dominating the flow');
  assert.match(settingsSource, /if \(isGuidedSetup && !showSetupSupport\) return undefined/,
    'closed setup support must not eagerly read diagnostics');
  assert.match(settingsSource, /const SupportDiagnosticsDisclosure = isGuidedSetup \? 'details' : 'div'/,
    'regular settings must not expose the browser default Details summary');
  assert.match(settingsSource, /!isGuidedSetup && <div className="settings-reset-trigger-region">/,
    'destructive reset must stay out of the unfinished first-use path');
  assert.match(settingsStyles, /\.support-diagnostics-disclosure\.is-setup > summary:focus-visible/,
    'the optional setup support entry must retain a visible keyboard focus state');
  assert.match(settingsSource, /重试保存刚才的设置/,
    'a failed provider choice must offer an explicit retry action');
  assert.match(apiKeySource, /onDraftStateChange\?\.\(dirty\)/,
    'API key and endpoint editors must report unsaved draft state');
  assert.match(modelSource, /onDraftStateChange\?\.\(dirty\)/,
    'the model editor must report unsaved draft state');
  assert.match(settingsSource, /requestDraftExitIntent\(\{ kind: 'close' \}/,
    'leaving settings must pass through the shared draft guard');
  assert.match(settingsSource, /requestDraftExitIntent\(\{ kind: 'backend', value: backend, location \}/,
    'provider changes must pass through the same draft guard');
  assert.match(settingsSource, /requestDraftExitIntent\(\{ kind: 'location', value: location \}/,
    'local and online path changes must pass through the same draft guard');
  assert.match(settingsSource, /<SettingsTransitionDialog[\s\S]*?id="settings-draft-exit-dialog"/,
    'the unsaved-draft warning must use the shared Settings transition layer');
  assert.match(settingsTransitionSource, /role="alertdialog"[\s\S]*?aria-modal="true"/,
    'the shared transition layer must expose a modal alert dialog');
  assert.match(settingsTransitionSource, /'data-settings-draft-safe': true/,
    'the shared transition layer must retain a stable safe initial action');
  assert.match(settingsSource, /结果确认前不会离开设置/,
    'leaving during a save must wait for an authoritative result');
  assert.match(
    settingsSource,
    /describeConnectionTestExitIntent\(connectionExitIntent, \{\s*guidedSetup: isGuidedSetup/,
    'guided setup must describe a validation exit as returning to the first-use choice',
  );
  assert.match(settingsSource, /draftExitWaitingForSaveRef\.current = settingsSaving/,
    'only an exit requested during a real save may continue automatically after success');
  assert.match(settingsSource, /event\.stopImmediatePropagation\(\)[\s\S]*?requestClose/,
    'Escape must not reach a competing close handler before the draft guard');
  assert.match(settingsTransitionSource, /node\.inert = true[\s\S]*?node\.setAttribute\('aria-hidden', 'true'\)/,
    'the background must be unavailable to keyboard and assistive technology while the guard is open');
  assert.match(settingsStyles, /\.settings-draft-exit-dialog button:focus-visible/,
    'draft guard actions must keep a visible keyboard focus indicator');
  assert.match(settingsStyles, /@media \(max-width: 620px\)[\s\S]*?\.settings-draft-exit-dialog footer/,
    'draft guard actions must reflow at the narrow settings breakpoint');
  assert.match(settingsStyles, /\.settings-save-recovery button:focus-visible/);
  assert.match(settingsHookSource, /failedSaveOperationRef\.current = mergeFailedSaveOperation\(\s*failedSaveOperationRef\.current,\s*entries,/,
    'a partial failure must merge the complete intended transaction with earlier failed settings');
  assert.match(
    settingsHookSource,
    /processingConfigGenerationRef\.current = nextGeneration;\s*reconcileFailedSaveRetry\(nextGeneration\);/,
    'a processing configuration change must synchronously revoke a stale full-setup retry',
  );
  assert.match(
    settingsHookSource,
    /for \(const key of result\.removedKeys\) failedSettingKeysRef\.current\.delete\(key\);\s*setSaveError\(/,
    'revoking a stale full-setup retry must also reconcile its failed keys and visible error',
  );
  assert.match(settingsHookSource, /const retryFailedSettings = useCallback[\s\S]*?for \(const \[key, value\] of entries\)[\s\S]*?persistSetting\(key, value\)/,
    'retry must replay every intended setting instead of only the first failed key');
  assert.match(
    ipcSource,
    /\['once', 'credential-once'\]\.includes\(demoSaveCode\) \? 1 : 0/,
    'the development preview must reproduce ordinary and credential-only first-write failures',
  );
  assert.match(ipcSource, /demoSaveCode === 'slow'[\s\S]*?window\.setTimeout/,
    'the development preview must reproduce leaving while a connection save is still pending');
  assert.match(settingsSource, /清除全部 API Key、连接凭据、保存的术语及所有设置/);
  assert.match(settingsResetDialogSource, /role="alertdialog"[\s\S]*aria-modal="true"/,
    'the destructive reset must be exposed as an explicit confirmation dialog');
  assert.match(settingsResetDialogSource, /safeButtonRef\.current[\s\S]*?focus\(\{ preventScroll: true \}\)/,
    'reset confirmation must move focus to the safe action');
  assert.match(settingsResetDialogSource, /正在保留剪贴板内容并清除…/,
    'the destructive reset must expose its preserve-only in-progress state');
  assert.match(settingsResetDialogSource, /beginReset\('preserve'\)/,
    'the destructive reset must pass an explicit preserve decision');
  assert.doesNotMatch(settingsResetDialogSource, /beginReset\('clear'\)|clearLabel/,
    'the destructive reset must not restore clipboard-clear behavior');
  assert.match(settingsSource, /setResetError\(describeFullDataResetFailure\(error, \{/,
    'reset failure must remain visible beside the destructive action');
  assert.match(
    settingsSource,
    /await onResetAllData\(\{\s*clipboardMode,\s*resetTransaction: runFullDataReset,\s*sessionAlreadyCleared: resetSessionAlreadyCleared,\s*\}\)/,
    'the destructive reset must delegate to the already-loaded cross-layer reset transaction',
  );
  assert.match(settingsStyles, /\.settings-reset-actions button:focus-visible/);
  assert.match(settingsHookSource, /Promise\.allSettled\(\[\.\.\.pendingWritesRef\.current\]\)/,
    'reset must wait for older settings writes so they cannot reappear afterward');
  assert.match(
    settingsHookSource,
    /const response = await invoke\(IPC_CHANNELS\.USER_DATA_CLEAR, \{ ticket \}\);[\s\S]*response\.status !== 'cleared'[\s\S]*response\.settings/,
    'reset commit must consume an authorized one-shot main-process ticket and strictly confirm settings',
  );
  assert.match(ipcSource, /demoResetFailuresRemaining = demoResetCode === 'once' \? 1 : 0/,
    'the development preview must reproduce a recoverable reset failure');
  assert.match(mainSource, /USER_DATA_RESET_PREPARE[\s\S]*userDataResetRegistry\.prepare[\s\S]*USER_DATA_CLEAR[\s\S]*userDataResetRegistry\.consume[\s\S]*store\.resetUserDataAndSettings\(\)[\s\S]*stopClipboardMonitoring\(\)[\s\S]*unregisterAll\(\)[\s\S]*settings: getSafeSettings\(\)/,
    'main must reset persisted data and align runtime monitoring before confirming success');
  assert.match(settingsSource, /aria-label="自动检测剪贴板"/);
  assert.match(settingsStyles, /input:focus-visible \+ span/);
  assert.match(settingsStyles, /\.analysis-location-options > button:focus-visible/);
  assert.match(settingsStyles, /@media \(max-width: 620px\)[\s\S]*\.analysis-location-options/);
  assert.doesNotMatch(
    settingsSource,
    /customOriginChanged[\s\S]*updateSettings\('customEndpointApiKey', ''\)/,
    'custom endpoint origin changes must not use a second renderer credential-clear write',
  );
  assert.match(
    settingsHookSource,
    /applyConfirmedSettingWrite[\s\S]*response\?\.key !== key[\s\S]*customEndpointApiKeyCleared/,
    'renderer must consume the correlated main-process side effect after a confirmed URL write',
  );
  assert.match(settingsSource, /width: '100%'[\s\S]*height: '100%'/, 'settings must fill the wider first-run window');

  console.log('first-run readiness and fixed language checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
