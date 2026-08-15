import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const main = read('src/main/main.js');
const app = read('src/renderer/App.jsx');
const panel = read('src/renderer/components/FloatingPanel.jsx');
const setup = read('src/renderer/components/SetupGate.jsx');
const preload = read('preload.js');
const constantsJs = read('src/shared/constants.js');
const constantsCjs = read('src/shared/constants.cjs');

for (const source of [constantsJs, constantsCjs]) {
  assert.match(source, /APP_SETTINGS_REQUESTED: 'app:settings-requested'/u);
  assert.match(source, /APP_SETTINGS_LISTENER_READY: 'app:settings-listener-ready'/u);
  assert.match(source, /APP_SETTINGS_REQUEST_HANDLED: 'app:settings-request-handled'/u);
}

assert.match(
  main,
  /id: 'app-settings',[\s\S]{0,160}?label: '设置…',[\s\S]{0,160}?accelerator: 'Command\+,',[\s\S]{0,160}?click: requestAppSettings/u,
  'the macOS app menu must expose a guarded Settings item with the standard Command+, accelerator',
);
assert.doesNotMatch(main, /globalShortcut\.register\(['"]Command\+,/u,
  'Command+, must remain an application-menu accelerator, not a competing global shortcut');
assert.match(
  main,
  /function requestAppSettings\([^)]*\) \{[\s\S]*?if \(app\.isQuitting \|\| rendererLoadFailureDialogOpen\) return;[\s\S]*?settingsRequestRegistry\.request\(senderId\);[\s\S]*?showMainWindow\(\);[\s\S]*?sendPendingSettingsRequest\(senderId\);[\s\S]*?\n\}/u,
  'the native action must retain one sender-bound request and reveal the existing window before delivery',
);
assert.match(
  main,
  /function sendPendingSettingsRequest\(senderId\) \{[\s\S]*?isLoadingMainFrame\(\)[\s\S]*?settingsRequestRegistry\.getPending\(senderId\)[\s\S]*?APP_SETTINGS_REQUESTED/u,
  'renderer loading must keep the request pending for listener-ready replay',
);
assert.match(main,
  /function sendPendingSettingsRequest\(senderId\) \{[\s\S]*?webContents\.isCrashed\(\)/u,
  'a crashed renderer must retain the request without attempting delivery');
assert.match(
  main,
  /APP_SETTINGS_LISTENER_READY[\s\S]{0,500}?settingsRequestRegistry\.getPending\(event\.sender\.id\)[\s\S]{0,300}?event\.sender\.send\(IPC_CHANNELS\.APP_SETTINGS_REQUESTED, pendingRequest\)/u,
  'listener readiness must replay the same pending request through the event channel',
);
assert.match(
  main,
  /APP_SETTINGS_REQUEST_HANDLED[\s\S]{0,500}?settingsRequestRegistry\.acknowledge\(event\.sender\.id, payload\)/u,
  'only an exact renderer acknowledgement may consume the pending request',
);
assert.match(main, /settingsRequestRegistry\.clearSender\(rendererSenderId\)/u);
assert.match(
  main,
  /loadProductionRenderer[\s\S]*?startup-failure dialog becomes the sole owner[\s\S]*?settingsRequestRegistry\.clearSender\(rendererSenderId\)[\s\S]*?rendererLoadFailureDialogOpen = true/u,
  'a failed first production load must revoke any pre-render Settings intent before Retry',
);
assert.match(
  main,
  /if \(response === 0\) \{[\s\S]{0,300}?settingsRequestRegistry\.clearSender\(rendererSenderId\)[\s\S]{0,160}?rendererLoadFailureDialogOpen = false[\s\S]{0,160}?loadProductionRenderer\(\)/u,
  'Retry must revoke any Settings request received while the native load-failure owner was visible',
);
assert.match(main, /settingsRequestRegistry\.clear\(\)/u);
assert.match(
  main,
  /function assertTrustedSettingsIpc\(event\) \{[\s\S]*?event\.sender !== mainWindow\.webContents[\s\S]*?event\.senderFrame !== mainWindow\.webContents\.mainFrame/u,
  'Settings readiness and acknowledgement must be bound to the live main frame',
);

for (const channel of [
  'app:settings-listener-ready',
  'app:settings-request-handled',
  'app:settings-requested',
]) assert.ok(preload.includes(`'${channel}'`), `preload must expose only the required ${channel} capability`);

const settingsListenerIndex = app.indexOf('on(IPC_CHANNELS.APP_SETTINGS_REQUESTED');
const settingsReadyIndex = app.indexOf('invoke(IPC_CHANNELS.APP_SETTINGS_LISTENER_READY)');
assert.ok(settingsListenerIndex >= 0 && settingsListenerIndex < settingsReadyIndex,
  'App must subscribe before announcing Settings-listener readiness');
assert.match(
  app,
  /setSettingsMenuRequest\(\(current\) => \(\{[\s\S]*?requestId,[\s\S]*?delivery:[\s\S]*?handled:/u,
  'active request replay must reuse one request identity while allowing acknowledgement retry',
);
assert.match(
  app,
  /Claim the request synchronously[\s\S]*?handled: true[\s\S]*?window\.setTimeout\(attempt, 250\)[\s\S]*?APP_SETTINGS_REQUEST_HANDLED/u,
  'a no-op owner must synchronously claim the request and retry its exact acknowledgement',
);
assert.match(
  app,
  /const announceReady = \(\) => \{[\s\S]*?APP_SETTINGS_LISTENER_READY[\s\S]*?window\.setTimeout\(announceReady, 250\)/u,
  'a transient listener-ready failure must retry without losing a pre-render request',
);
assert.match(
  app,
  /!settingsReady[\s\S]*?\|\| quitRequestId[\s\S]*?\|\| clipboardResidueRisk[\s\S]*?\|\| panelSessionRecoveryPending[\s\S]*?\|\| view === 'settings'[\s\S]*?acknowledgeSettingsMenuRequest\(requestId\)/u,
  'startup recovery, quit, clipboard recovery, session recovery, and existing Settings must remain strict no-ops',
);
assert.match(app, /settingsMenuRequest=\{showPanel[\s\S]*?onSettingsMenuRequestHandled=\{acknowledgeSettingsMenuRequest\}/u,
  'normal panel ownership must receive the native intent instead of App opening Settings directly');
assert.match(app, /<SetupGate[\s\S]*?settingsMenuRequest=\{!quitRequestId[\s\S]*?onSettingsMenuRequestHandled=\{acknowledgeSettingsMenuRequest\}/u,
  'first use must receive the native intent through SetupGate');
assert.ok((app.match(/settingsMenuRequest\?\.handled !== true/gu) || []).length >= 2,
  'a synchronously handled request must not be forwarded after a higher-priority owner disappears');

assert.match(
  setup,
  /if \(!loading && !captureRequest && !recoveryNotice && !choiceBusy\) \{\s*configureFullAnalysis\(\);\s*\}/u,
  'first-use Command+, must reuse the full-analysis choice transaction without bypassing foreground setup work',
);
assert.match(
  setup,
  /discardFailedSettings\(TRANSLATION_ONLY_SETUP_KEYS\);\s*onConfigureFull\(\);/u,
  'first-use Settings entry must still revoke an abandoned basic-mode retry',
);

assert.match(
  panel,
  /if \(visible && !hasForegroundFocusOwner\) \{\s*handleOpenSettingsRequest\('native-menu'\);\s*\}/u,
  'a native request must reuse the panel guard only when no higher-priority owner is visible',
);
assert.match(
  panel,
  /status === STATUS\.PROCESSING[\s\S]{0,160}?\|\| isCancellingProcessing[\s\S]{0,160}?\|\| isVerifying[\s\S]{0,160}?\|\| isCancellingVerification[\s\S]{0,220}?setProcessingSettingsGuardOpen\(true\)/u,
  'active processing and verification must present the existing stop-before-Settings decision',
);
assert.match(panel, /settingsGuardReturnFocusRef\.current = activeElement \|\| settingsTriggerRef\.current/u,
  'dismissing the processing guard must return to the menu invocation focus when possible');
assert.match(
  panel,
  /if \(focusAvailableElement\(trigger\)\) return;[\s\S]{0,260}?const fallback = settledTaskFocusTarget\(\)/u,
  'a task that settles behind the guard must fall back from its retired trigger to the retained outcome',
);
assert.match(
  panel,
  /processingSettingsGuardTaskSettled[\s\S]*?processingSettingsGuardSettlement[\s\S]*?result:[\s\S]*?'任务已经完成'[\s\S]*?'查看结果'[\s\S]*?review:[\s\S]*?'任务需要复核'[\s\S]*?'复核原文'[\s\S]*?error:[\s\S]*?'这次没有处理成功；仍要打开设置吗？'[\s\S]*?'查看问题'[\s\S]*?source:[\s\S]*?'任务已经结束'[\s\S]*?'返回原文'/u,
  'a guard that outlives any terminal task outcome must replace stale in-progress copy and actions',
);
assert.match(panel, /settingsReturnFocusElementRef\.current = activeElement/u,
  'returning from Settings must preserve the initiating panel focus when possible');
assert.match(panel, /node === document\.body[\s\S]{0,80}?node === document\.documentElement/u,
  'body and html must not be mistaken for a meaningful native-menu focus destination');
assert.match(
  panel,
  /handleStopAndOpenSettings[\s\S]{0,300}?returnFocusElement = settingsGuardReturnFocusRef\.current[\s\S]{0,300}?settingsReturnFocusElementRef\.current = returnFocusElement/u,
  'stopping an active task must transfer the native menu focus destination into Settings',
);
assert.match(
  panel,
  /Clear a handoff only after focus actually lands[\s\S]*?if \(focusTransferred\)[\s\S]*?settingsReturnFocusElementRef\.current = null/u,
  'cancelled animation frames must not discard the Settings return-focus destination',
);
assert.match(
  panel,
  /if \(wasVisible === false\) settingsReturnFocusReadyRef\.current = true[\s\S]*?hasSettingsHandoff && !settingsReturnFocusReadyRef\.current/u,
  'the guard-to-Settings focus handoff must arm only after Settings returns and survive a cancelled focus frame',
);
assert.match(
  panel,
  /verificationSettingsSettlementRef\.current = \{[\s\S]{0,120}?outcome: 'pending'/u,
  'opening Settings during verification must track the exact cancellation settlement',
);
assert.match(
  panel,
  /settlement\.outcome === 'pending'[\s\S]{0,100}?\|\| settlement\.outcome === 'completed'/u,
  'verification completion must cancel a stale Settings intent instead of hiding a newly completed result',
);
assert.match(
  panel,
  /settleSettingsIntent\([\s\S]{0,120}?cancellationRequested \|\| response\?\.cancelled \? 'cancelled' : 'settled-without-result'[\s\S]*?settleSettingsIntent\('completed'\)/u,
  'verification cancellation and completion must publish distinct Settings settlements',
);
assert.match(
  panel,
  /const handleDismissProcessingSettingsGuard = useCallback\(\(\) => \{\s*revokePendingSettingsNavigation\(\);\s*setProcessingSettingsGuardOpen\(false\)/u,
  'continuing the task must revoke any earlier delayed Settings navigation',
);
assert.match(
  panel,
  /const hasActiveProcessingTarget[\s\S]{0,220}?if \(!hasActiveProcessingTarget\) \{[\s\S]{0,300}?onOpenSettings/u,
  'a task that completes while the guard is open must still honor a later explicit Settings choice',
);
assert.match(
  panel,
  /if \(completedAfterCancelFailure\)[\s\S]{0,500}?failedTaskId: null[\s\S]{0,300}?if \(completedAfterSettingsCancelFailure\)[\s\S]{0,180}?revokePendingSettingsNavigation\(\)[\s\S]{0,300}?focusAvailableElement\(settledTaskFocusTarget\(\)\)/u,
  'every terminal outcome after cancellation failure must clear stale handoff state and focus its retained outcome',
);
assert.match(
  panel,
  /if \(!acknowledged\)[\s\S]*?else if \(completedWithNewResult\)[\s\S]{0,500}?if \(shouldOpenSettings\)[\s\S]{0,180}?revokePendingSettingsNavigation\(\)[\s\S]{0,300}?focusAvailableElement\(settledTaskFocusTarget\(\)\)[\s\S]{0,240}?else if \(shouldOpenSettings\)[\s\S]{0,160}?revokePendingSettingsNavigation\(\)[\s\S]{0,300}?focusAvailableElement\(settledTaskFocusTarget\(\)\)/u,
  'a task that settles before a failed cancellation acknowledgement must revoke Settings and focus its real outcome',
);
assert.match(
  panel,
  /failedScreenshotToken[\s\S]*?inheritsPendingScreenshotCancellation[\s\S]*?inheritsFailedScreenshotCancellation[\s\S]*?failedTaskId: task\.id[\s\S]*?failedScreenshotToken: null/u,
  'a screenshot cancellation race must stay associated while capture hands off to analysis',
);
assert.match(
  panel,
  /settleFailedScreenshotCancellation[\s\S]*?failedScreenshotToken !== screenshotToken[\s\S]*?revokePendingSettingsNavigation\(\)[\s\S]*?screenshot\?\.cancelled[\s\S]*?settleFailedScreenshotCancellation\(token\)[\s\S]*?nextSourceMeta\.truncated[\s\S]*?settleFailedScreenshotCancellation\(token\)[\s\S]*?triggerProcessing\(screenshot\.text[\s\S]*?settleFailedScreenshotCancellation\(token\)[\s\S]*?catch[\s\S]*?settleFailedScreenshotCancellation\(token\)/u,
  'capture cancellation failures must be revoked on every terminal capture path',
);
assert.match(
  panel,
  /Existing top-layer decisions are strict no-ops[\s\S]{0,180}?onSettingsMenuRequestHandled\?\.\(requestId\);/u,
  'a blocked top-layer request must settle instead of becoming a delayed navigation surprise',
);

console.log('macOS Settings menu ownership and replay checks passed.');
