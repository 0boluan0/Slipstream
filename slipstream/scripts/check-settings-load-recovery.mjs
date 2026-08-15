import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  classifySettingsLoadPayload,
  classifySettingsRecoveryResponse,
  isLoadedSettingsPayload,
  normalizeRecoveryNotice,
  sanitizeStartupBlockReason,
  SETTINGS_LOAD_TIMEOUT_MS,
  settingsLoadErrorCode,
  STARTUP_BLOCK_REASONS,
} from '../src/renderer/utils/settingsLoad.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const validSettings = {
  setupMode: 'full',
  activeBackend: 'ollama',
  activeModel: 'qwen2.5',
};

assert.equal(isLoadedSettingsPayload(validSettings), true);
assert.equal(isLoadedSettingsPayload({ ...validSettings, setupMode: 'unknown' }), false);
assert.equal(isLoadedSettingsPayload({ ...validSettings, activeBackend: 'unknown' }), false);
assert.equal(isLoadedSettingsPayload({ ...validSettings, activeModel: '' }), false);
assert.equal(isLoadedSettingsPayload({ ...validSettings, startupBlocked: true }), false);
assert.equal(isLoadedSettingsPayload({ ...validSettings, openaiApiKey: 'must-not-reach-renderer' }), false);
assert.equal(isLoadedSettingsPayload({}), false);
assert.equal(isLoadedSettingsPayload(null), false);

assert.deepEqual(classifySettingsLoadPayload(validSettings), {
  status: 'ready',
  settings: validSettings,
});
for (const reason of Object.values(STARTUP_BLOCK_REASONS)) {
  assert.deepEqual(
    classifySettingsLoadPayload({
      startupBlocked: true,
      reason,
      error: '/private/path and internal failure details must not escape',
    }),
    { status: 'blocked', reason }
  );
}
assert.deepEqual(
  classifySettingsLoadPayload({ startupBlocked: true, reason: '/private/unknown-reason' }),
  { status: 'blocked', reason: 'unavailable' }
);
assert.deepEqual(classifySettingsLoadPayload({}), {
  status: 'blocked',
  reason: 'schema-invalid',
});
assert.equal(sanitizeStartupBlockReason('corrupt-json'), 'corrupt-json');
assert.equal(sanitizeStartupBlockReason(new Error('private detail')), 'unavailable');

const createdNotice = {
  backupCreated: true,
  backupFileName: 'slipstream-settings.corrupt-20260728.json',
};
assert.deepEqual(normalizeRecoveryNotice(createdNotice), createdNotice);
assert.deepEqual(normalizeRecoveryNotice({ backupCreated: false, backupFileName: null }), {
  backupCreated: false,
  backupFileName: null,
});
assert.equal(normalizeRecoveryNotice({
  backupCreated: true,
  backupFileName: '/private/settings.json',
}), null);
assert.equal(normalizeRecoveryNotice({
  backupCreated: false,
  backupFileName: 'contradictory.json',
}), null);

assert.deepEqual(classifySettingsRecoveryResponse({
  status: 'recovered',
  settings: validSettings,
  recovery: createdNotice,
}), {
  status: 'recovered',
  settings: validSettings,
  recovery: createdNotice,
});
assert.deepEqual(classifySettingsRecoveryResponse({
  status: 'recovered',
  settings: { ...validSettings, activeModel: '' },
  recovery: createdNotice,
}), { status: 'failed', reason: 'schema-invalid' });
assert.deepEqual(classifySettingsRecoveryResponse({
  status: 'failed',
  reason: 'migration-failed',
  error: '/private/path must be dropped',
}), { status: 'failed', reason: 'migration-failed' });
assert.deepEqual(classifySettingsRecoveryResponse({
  status: 'failed',
  reason: 'private-internal-code',
}), { status: 'failed', reason: 'unavailable' });

assert.equal(SETTINGS_LOAD_TIMEOUT_MS, 2000);
assert.equal(settingsLoadErrorCode({ code: 'settings-load-timeout' }), 'timeout');
assert.equal(settingsLoadErrorCode({ code: 'settings-load-invalid' }), 'schema-invalid');
assert.equal(settingsLoadErrorCode({ code: 'corrupt-json' }), 'corrupt-json');
assert.equal(settingsLoadErrorCode(new Error('secret path must not surface')), 'unavailable');

const settingsHookSource = readSource('src/renderer/hooks/useSettings.js');
const appSource = readSource('src/renderer/App.jsx');
const mainSource = readSource('src/main/main.js');
const recoverySource = readSource('src/renderer/components/StartupRecovery.jsx');
const setupGateSource = readSource('src/renderer/components/SetupGate.jsx');
const preloadSource = readSource('preload.js');
const cjsConstantsSource = readSource('src/shared/constants.cjs');
const esmConstantsSource = readSource('src/shared/constants.js');

assert.equal((preloadSource.match(/'settings:recovery-reset'/g) || []).length, 1);
assert.match(cjsConstantsSource, /SETTINGS_RECOVERY_RESET: 'settings:recovery-reset'/);
assert.match(esmConstantsSource, /SETTINGS_RECOVERY_RESET: 'settings:recovery-reset'/);

const lockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');
const storeImportIndex = mainSource.indexOf("require('./store')");
const firstStoreReadIndex = mainSource.indexOf('store.getAllSettings()');
assert(lockIndex >= 0 && storeImportIndex > lockIndex,
  'the losing process must exit before loading persistent storage');
assert.match(mainSource, /if \(!hasSingleInstanceLock\) \{\s*app\.isQuitting = true;\s*app\.quit\(\);\s*\} else \{\s*startApplication\(\);\s*\}/,
  'only the process holding the lock may evaluate the application startup path');
assert(storeImportIndex > mainSource.indexOf('function startApplication()'),
  'persistent storage must be loaded only inside the winning startup path');
assert(firstStoreReadIndex > storeImportIndex,
  'persistent settings must not be read before the winning process loads the store module');
assert.match(mainSource, /let shortcutRegistrationStatus = createShortcutRegistrationStatus\(\);/);
assert.match(mainSource, /const storageStatus = store\.initializeStore\(\);/);
assert.match(mainSource, /if \(!uiFixtureMode\.enabled\) registerIpcHandlers\(\);\s*createMainWindow\(settings\);/);
assert.match(mainSource, /function createMainWindow\(settings = getStartupSettings\(\)\) \{\s*const storageReady = store\.isStoreReady\(\);/);
assert.match(mainSource, /if \(!store\.isStoreReady\(\)\) return;\s*if \(currentWindowMode !== 'capture'\) return;/);
assert.match(mainSource, /IPC_CHANNELS\.SETTINGS_GET[\s\S]{0,420}store\.retryStoreInitialization\(\)[\s\S]{0,220}startupBlocked: true, reason: status\.reason/);
assert.match(mainSource, /IPC_CHANNELS\.SETTINGS_RECOVERY_RESET[\s\S]{0,520}store\.recoveryResetStore\(\)[\s\S]{0,300}status: 'recovered'[\s\S]{0,220}recovery: \{/);
assert.match(mainSource, /function activatePersistentRuntime\(settings,[\s\S]{0,180}!store\.isStoreReady\(\)/);
assert.match(mainSource, /try \{\s*createTray\(\);\s*\} catch \{\s*console\.error\('\[StartupRuntime\] Tray initialization failed\.'/s,
  'an optional tray failure must not overturn an authoritative storage recovery');
assert.match(mainSource, /try \{\s*registerConfiguredShortcuts\(settings, \{ broadcast \}\);[\s\S]{0,100}\} catch \{\s*console\.error\('\[StartupRuntime\] Shortcut initialization failed\.'/s,
  'an optional shortcut failure must not overturn an authoritative storage recovery');
assert.match(mainSource, /Clipboard monitoring initialization failed/);
assert.match(mainSource, /else if \(!persistentRuntimeActive\) activatePersistentRuntime\(settings, \{ broadcast: true \}\);/,
  'a partial optional-runtime failure must be retryable on the next settings load');
assert.match(mainSource, /const nextTray = new Tray\(icon\);[\s\S]{0,520}nextTray\.destroy\(\)[\s\S]{0,140}tray = null/,
  'a partially initialized tray must be rolled back before a later retry');
const clipboardStartSource = mainSource.slice(
  mainSource.indexOf('function startClipboardMonitoring()'),
  mainSource.indexOf('function stopClipboardMonitoring()'),
);
assert(
  clipboardStartSource.indexOf('nextMonitor.startMonitoring(')
    < clipboardStartSource.indexOf('clipboardMonitor = nextMonitor;'),
  'clipboard monitoring must only be published after startup succeeds',
);
assert.match(mainSource, /if \(storageStatus\.state === 'ready'\) activatePersistentRuntime\(settings\);/);
assert.match(mainSource, /function promoteRecoveredWindow\(settings\)[\s\S]{0,220}setSkipTaskbar\(Boolean\(tray\)\)/);
assert.match(mainSource, /getRecoveredCaptureBounds\(settings\)[\s\S]{0,260}settings\.windowX[\s\S]{0,260}settings\.windowY/);
const applyRecoveredSource = mainSource.slice(
  mainSource.indexOf('function applyRecoveredSettings(settings)'),
  mainSource.indexOf('// --------------- IPC Handlers ---------------'),
);
assert.equal(
  (applyRecoveredSource.match(/promoteRecoveredWindow\(settings\)/g) || []).length,
  1,
  'recovery must promote the window exactly once',
);
assert.match(mainSource, /process\.platform === 'darwin' && store\.isStoreReady\(\)/,
  'a blocked recovery window must not disappear into a tray that was never created');
assert.match(mainSource, /process\.platform === 'darwin' && store\.isStoreReady\(\) && tray/,
  'a window must not hide when no menu-bar entry exists');
assert.match(mainSource, /store\.getSettings\('startMinimized'\) !== true \|\| !tray/,
  'start minimized must fail open when the menu-bar entry is unavailable');
assert.match(mainSource, /persistentRuntimeStatus\.clipboardMonitoringDisabled = true/,
  'failed startup monitoring must be persisted off and disclosed safely');
assert.match(mainSource, /persistentRuntimeStatus\.clipboardMonitoringDisablePersistFailed = true/,
  'a failed safety write must still disclose the inactive current-session monitor');

assert.match(settingsHookSource, /Promise\.race\(\[/);
assert.match(settingsHookSource, /invoke\(IPC_CHANNELS\.SETTINGS_GET\)/);
assert.match(settingsHookSource, /classifySettingsLoadPayload\(loaded\)/);
assert.match(settingsHookSource, /outcome\.status !== 'ready'/);
assert.match(settingsHookSource, /applyLoadedSettings\(outcome\.settings\)/);
assert.match(settingsHookSource, /invoke\(IPC_CHANNELS\.SETTINGS_RECOVERY_RESET\)/);
assert.match(settingsHookSource, /classifySettingsRecoveryResponse\(response\)/);
assert.match(settingsHookSource, /setRecoveryNotice\(outcome\.recovery\)/);
assert.match(settingsHookSource, /setLoadStatus\('ready'\)/);
assert.match(settingsHookSource, /settingsRecoveryPendingRef\.current/);
assert.doesNotMatch(settingsHookSource, /setTimeout\(\(\) => setLoading\(false\)/);

assert.match(appSource, /if \(!settingsReady\)/);
assert.match(appSource, /<StartupRecovery/);
assert.match(appSource, /onRecoverFresh=\{settingsController\.recoverFreshSettings\}/);
assert.match(appSource, /recoveryNotice=\{settingsController\.recoveryNotice\}/);
assert.match(appSource, /onDismissRecoveryNotice=\{settingsController\.dismissRecoveryNotice\}/);
assert.match(appSource, /className="app-runtime-alert"/);
assert.match(appSource, /剪贴板自动检测已安全保持关闭/);
assert.match(appSource, /菜单栏入口暂时不可用/);
assert.match(appSource, /关闭状态未能保存/);

assert.match(recoverySource, /'corrupt-json'/);
assert.match(recoverySource, /'schema-invalid'/);
assert.match(recoverySource, /'migration-failed'/);
assert.match(recoverySource, /unavailable:/);
assert.match(recoverySource, /之前的设置、API Key 和已保存术语将不再生效/);
assert.match(recoverySource, /原设置文件会先归档在本机/);
assert.match(recoverySource, /不会上传任何内容/);
assert.match(recoverySource, /showRecoveryConfirmation/);
assert.match(recoverySource, /type="checkbox"/);
assert.match(recoverySource, /disabled=\{!recoveryConfirmed \|\| isPending\}/);
assert.match(recoverySource, /onClick=\{handleRecoverFresh\}/);
assert.doesNotMatch(
  recoverySource,
  /className="startup-recovery-fresh"[\s\S]{0,180}onClick=\{handleRecoverFresh\}/
);
assert.match(recoverySource, /actionPendingRef\.current/);
assert.match(recoverySource, /aria-live="assertive"/);
assert.match(recoverySource, /errorRef\.current\?\.focus/);
assert.match(recoverySource,
  /focusIntentRef\.current = 'confirmation'[\s\S]*setConfirmationOpen\(true\)/,
  'opening destructive startup recovery must claim the confirmation focus target');
assert.match(recoverySource,
  /confirmationHeadingRef\.current[\s\S]*focusTarget\.focus\(\{ preventScroll: true \}\)/,
  'the destructive confirmation step must receive deterministic focus');
assert.match(recoverySource,
  /focusIntentRef\.current = 'fresh'[\s\S]*setConfirmationOpen\(false\)/,
  'cancelling destructive startup recovery must retain its initiating control');
assert.match(recoverySource,
  /freshRecoveryButtonRef\.current[\s\S]*focusTarget\.focus\(\{ preventScroll: true \}\)/,
  'closing the confirmation step must restore focus to the fresh-recovery trigger');
assert.match(recoverySource,
  /import \{ shouldHandleBackgroundEscape \} from '\.\.\/utils\/modalOwnership\.mjs'/,
  'startup recovery must share the app-wide top-layer ownership contract');
assert.match(recoverySource,
  /!shouldHandleBackgroundEscape\(event\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)[\s\S]*cancelRecoveryConfirmation\(\)/,
  'idle destructive confirmation must support an owned Escape return');
assert.match(recoverySource,
  /if \(!confirmationOpen \|\| isPending\) return undefined/,
  'startup recovery Escape must stay disabled while archival recovery is pending');
assert.match(recoverySource,
  /ref=\{confirmationHeadingRef\}[\s\S]*id="startup-recovery-confirm-title"[\s\S]*tabIndex=\{-1\}/,
  'the confirmation heading must be a programmatic focus target');

assert.match(setupGateSource, /recoveryNotice\.backupCreated/);
assert.match(setupGateSource, /不会自动恢复/);
assert.match(setupGateSource, /onDismissRecoveryNotice/);
assert.doesNotMatch(setupGateSource, /recoveryNotice\.(?:settings|error|path|reason)/);

console.log('Settings load recovery checks passed.');
