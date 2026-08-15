import assert from 'node:assert/strict';
import fs from 'node:fs';

import { describeConnectionTestExitIntent } from '../src/renderer/utils/connectionTestExit.mjs';
import { describeSettingsDraftIntent } from '../src/renderer/utils/settingsDraftGuard.mjs';

const screenshotDraft = describeSettingsDraftIntent({
  kind: 'capture',
  captureKind: 'screenshot',
});
assert.equal(screenshotDraft.actionLabel, '开始截图');
assert.equal(screenshotDraft.safeLabel, '继续编辑，稍后处理');
assert.match(screenshotDraft.detail, /需要离开设置/);
assert.match(screenshotDraft.confirmLabel, /放弃草稿并开始截图/);

const clipboardDraft = describeSettingsDraftIntent({
  kind: 'capture',
  captureKind: 'clipboard',
});
assert.equal(clipboardDraft.actionLabel, '处理新文字');
assert.match(clipboardDraft.confirmLabel, /放弃草稿并处理新文字/);

const screenshotConnection = describeConnectionTestExitIntent({
  kind: 'capture',
  captureKind: 'screenshot',
});
assert.equal(screenshotConnection.confirmLabel, '停止验证并开始截图');
assert.equal(screenshotConnection.safeLabel, '继续等待，稍后处理');

const clipboardConnection = describeConnectionTestExitIntent({
  kind: 'capture',
  captureKind: 'clipboard',
});
assert.equal(clipboardConnection.confirmLabel, '停止验证并处理新文字');

const panelSource = fs.readFileSync(
  new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url),
  'utf8',
);
const settingsSource = fs.readFileSync(
  new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url),
  'utf8',
);
const appSource = fs.readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const ipcSource = fs.readFileSync(
  new URL('../src/renderer/hooks/useIpc.js', import.meta.url),
  'utf8',
);

assert.match(panelSource, /const shouldHoldCapture = !visible \|\| shouldHoldClipboardCapture/,
  'hidden settings must force clipboard events into the waiting queue');
assert.match(panelSource, /if \(!visible\)[\s\S]*?announceHiddenCaptureRequest\('screenshot'\)/,
  'F2 must become a visible settings capture intent instead of starting in the hidden panel');
assert.match(panelSource, /announceHiddenCaptureRequest\('clipboard'\)/);
assert.match(panelSource, /announceHiddenCaptureRequest\('clipboard-error'\)/);
assert.match(panelSource, /approvedCaptureRequest\.kind === 'clipboard'[\s\S]*?handleProcessPendingClipboard/);
assert.match(panelSource, /approvedCaptureRequest\.kind === 'screenshot'[\s\S]*?handleProceedPendingScreenshot/);

assert.match(settingsSource, /kind: 'capture'[\s\S]*?requestId: captureRequest\.id/);
assert.match(settingsSource, /captureRequestHandledRef/,
  'dismissing a capture guard must not immediately reopen the same dialog');
assert.match(
  settingsSource,
  /captureRequestHandledRef\.current === captureRequest\.id[\s\S]*?\|\| confirmCredentialRemoval[\s\S]*?\|\| apiKeyDeleteConfirmationOpen[\s\S]*?captureRequestHandledRef\.current = captureRequest\.id/,
  'credential-removal decisions must keep foreground captures queued before marking them handled',
);
assert.match(
  settingsSource,
  /\[\s*appDecisionBlocked,\s*apiKeyDeleteConfirmationOpen,[\s\S]*?confirmCredentialRemoval,[\s\S]*?requestDraftExitIntent/,
  'capture ownership must be reevaluated when either credential-removal surface closes',
);
assert.match(settingsSource, /captureRequestHandledRef\.current = captureRequest\.id;\s+if \(isGuidedSetup\) return;/,
  'guided setup must keep capture waiting until a processing mode is actually enabled');
assert.match(settingsSource, /onCaptureRequestApproved/);
assert.match(settingsSource, /剪贴板里没有可处理的文字/);
assert.match(settingsSource, /截图请求已保留/);

assert.match(appSource, /settingsCaptureRequest/);
assert.match(appSource, /approvedSettingsCapture/);
assert.match(appSource, /onHiddenCaptureRequest=\{handleHiddenCaptureRequest\}/);
assert.match(appSource, /onCaptureRequestApproved=\{handleSettingsCaptureApproved\}/);
assert.match(
  appSource,
  /settingsWorkspaceReadyRef[\s\S]*?deferredFromSettingsWorkspace:[\s\S]*?view === 'settings'[\s\S]*?!settingsWorkspaceReadyRef\.current/,
  'capture requests that arrive before Settings mounts must be marked as workspace-deferred',
);
assert.match(
  appSource,
  /!settingsCaptureRequest\?\.deferredFromSettingsWorkspace[\s\S]*?\|\| quitRequestIdRef\.current\s*\|\| quitDecisionRef\.current[\s\S]*?handleSettingsCaptureApproved\(settingsCaptureRequest\)/,
  'a deferred Settings capture must use both synchronous App Quit mutexes before takeover',
);
assert.match(
  appSource,
  /confirmQuitRequestAutomatically[\s\S]*?status === 'confirmed'[\s\S]*?setSettingsCaptureRequest\(null\);\s*setApprovedSettingsCapture\(null\);[\s\S]{0,180}?clearCurrentQuitRequest\(requestId\)/,
  'automatic confirmed quit must drop capture intent received during its IPC round trip',
);
assert.match(
  appSource,
  /returnFromSettingsFailure[\s\S]*?setSettingsCaptureRequest\(\(current\) => current\?\.origin === 'settings' \? null : current\)/,
  'returning from Settings failure must not leave a replayable shadow capture intent',
);
assert.match(appSource, /onPendingCaptureSettled=\{settleSettingsCaptureRequest\}/);

assert.match(
  panelSource,
  /onPendingCaptureSettled\?\.\(\{ kind: 'screenshot' \}\)[\s\S]*?performScreenshotCapture\(\)/,
  'starting a queued screenshot must settle the Settings shadow request',
);
assert.match(
  panelSource,
  /onPendingCaptureSettled\?\.\(\{ kind: 'clipboard' \}\)[\s\S]*?pendingClipboardRef\.current = null/,
  'processing queued clipboard text must settle the Settings shadow request',
);
assert.match(
  settingsSource,
  /onWorkspaceReadyChange\?\.\(true\)[\s\S]*?onWorkspaceReadyChange\?\.\(false\)/,
  'Settings must publish its mounted ownership window to App',
);

assert.match(ipcSource, /demoActiveCaptureEventsCode === 'settings-clipboard'/);
assert.match(ipcSource, /demoActiveCaptureEventsCode === 'settings-clipboard-error'/);
assert.match(ipcSource, /'settings-screenshot'/);
assert.match(
  ipcSource,
  /demoActiveCaptureEventsCode !== 'fixture-screenshot'[\s\S]*?slipstream:fixture-screenshot-request/,
  'the deterministic Settings collision screenshot must not also emit a clipboard event',
);

console.log('Settings capture guard checks passed.');
