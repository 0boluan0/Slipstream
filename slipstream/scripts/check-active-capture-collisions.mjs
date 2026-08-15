import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  shouldHoldClipboardCapture,
} from '../src/renderer/utils/clipboardMonitorQueue.mjs';
import {
  ownsDelayedCaptureDispatch,
} from '../src/renderer/utils/captureAutoSubmit.mjs';
import {
  describePendingScreenshotRequest,
} from '../src/renderer/utils/foregroundCaptureGuard.mjs';
import {
  describeQuitRisk,
  hasQuitRisk,
} from '../src/renderer/utils/quitSafety.mjs';

assert.equal(shouldHoldClipboardCapture({
  source: 'shortcut',
  status: 'processing',
  hasInput: true,
}), true, 'Option+C must wait while analysis owns the visible source');
assert.equal(shouldHoldClipboardCapture({
  source: 'shortcut',
  status: 'done',
  hasResult: true,
  isVerifying: true,
}), true, 'Option+C must not replace a result during official verification');
assert.equal(shouldHoldClipboardCapture({
  source: 'shortcut',
  status: 'idle',
  hasInput: false,
}), false, 'Option+C should still start immediately in an empty capture state');

const waitingScreenshotChoice = describePendingScreenshotRequest({
  status: 'waiting',
  reason: 'active-work',
}, { busy: true });
assert.equal(waitingScreenshotChoice.ignoreLabel, '继续当前任务',
  'before cancellation, a waiting screenshot request must preserve the choice to continue');
assert.equal(waitingScreenshotChoice.showIgnoreAction, true,
  'before cancellation, the continue-current-task action must remain available');
assert.equal(waitingScreenshotChoice.actionDisabled, false,
  'before cancellation, the user must be able to choose stop then capture');

const stoppingScreenshotChoice = describePendingScreenshotRequest({
  status: 'stopping',
  reason: 'active-work',
}, { busy: true, stopRequestPending: true });
assert.match(stoppingScreenshotChoice.detail, /停止请求已经发出，无法撤回/,
  'after cancellation starts, copy must disclose that the stop request cannot be withdrawn');
assert.equal(stoppingScreenshotChoice.showIgnoreAction, false,
  'after cancellation starts, the UI must not offer to continue the current task');
assert.equal(stoppingScreenshotChoice.actionDisabled, true,
  'while cancellation is pending, another stop action must not be available');
assert.equal(stoppingScreenshotChoice.actionLabel, '正在停止…');

const unconfirmedStopChoice = describePendingScreenshotRequest({
  status: 'stopping',
  reason: 'active-work',
}, { busy: true, stopRequestPending: false });
assert.equal(unconfirmedStopChoice.showIgnoreAction, false,
  'an unconfirmed cancellation must still fail closed instead of promising that work can continue');
assert.equal(unconfirmedStopChoice.actionDisabled, false,
  'an unconfirmed cancellation may offer a retry');
assert.equal(unconfirmedStopChoice.actionLabel, '重试停止后截图');

const settledStopChoice = describePendingScreenshotRequest({
  status: 'stopping',
  reason: 'active-work',
}, { busy: false, stopRequestPending: false });
assert.equal(settledStopChoice.showIgnoreAction, false);
assert.equal(settledStopChoice.actionDisabled, true,
  'after the task settles, capture starts automatically without a stale decision action');
assert.equal(settledStopChoice.actionLabel, '正在打开框选…');

const delayedCaptureOwner = {
  ownerToken: 7,
  currentToken: 7,
  ownerSourceRevision: 12,
  currentSourceRevision: 12,
  visible: true,
  foregroundBlocked: false,
  processing: false,
};

assert.equal(ownsDelayedCaptureDispatch(delayedCaptureOwner), true,
  'an unchanged visible, unblocked, idle Option+C capture should own its delayed dispatch');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  currentToken: delayedCaptureOwner.ownerToken + 1,
}), false, 'a replaced timer token must not own the delayed Option+C dispatch');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  currentSourceRevision: delayedCaptureOwner.ownerSourceRevision + 1,
}), false, 'a source edit must revoke delayed Option+C ownership');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  currentSourceRevision: delayedCaptureOwner.ownerSourceRevision + 2,
}), false, 'edit then undo to identical text must still revoke ownership through source revision');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  visible: false,
}), false, 'a hidden capture surface must not dispatch delayed Option+C processing');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  foregroundBlocked: true,
}), false, 'a foreground decision owner must block delayed Option+C processing');
assert.equal(ownsDelayedCaptureDispatch({
  ...delayedCaptureOwner,
  processing: true,
}), false, 'an active processing owner must block delayed Option+C processing');

for (const field of [
  'ownerToken',
  'currentToken',
  'ownerSourceRevision',
  'currentSourceRevision',
]) {
  const missingGeneration = { ...delayedCaptureOwner };
  delete missingGeneration[field];
  assert.equal(ownsDelayedCaptureDispatch(missingGeneration), false,
    `missing ${field} must fail closed`);
  for (const invalidValue of [-1, 1.5, Number.NaN]) {
    assert.equal(ownsDelayedCaptureDispatch({
      ...delayedCaptureOwner,
      [field]: invalidValue,
    }), false, `invalid ${field} value ${String(invalidValue)} must fail closed`);
  }
}

for (const [field, invalidValue] of [
  ['visible', 1],
  ['foregroundBlocked', 0],
  ['processing', 0],
]) {
  assert.equal(ownsDelayedCaptureDispatch({
    ...delayedCaptureOwner,
    [field]: invalidValue,
  }), false, `${field} must use a strict boolean ownership state`);
}

const panelSource = fs.readFileSync(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
const ipcSource = fs.readFileSync(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');
const quitSource = fs.readFileSync(new URL('../src/renderer/utils/quitSafety.mjs', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../src/renderer/App.css', import.meta.url), 'utf8');

const textareaChangeHandler = panelSource.match(
  /onChange=\{\(event\) => \{[\s\S]*?\n\s*\}\}\s*onKeyDown=/,
)?.[0] || '';
assert.match(textareaChangeHandler,
  /const \{ revokedPending \} = revokeDelayedCaptureDispatch\(\{\s*sourceReplaced: true,?\s*\}\);/,
  'editing the textarea must revoke delayed ownership and advance the source revision');
assert.match(textareaChangeHandler,
  /setWarning\(\(current\) => \([\s\S]*?revokedPending[\s\S]*?\? EDITED_SOURCE_MANUAL_SUBMIT_WARNING\s*: ''[\s\S]*?\)\);/,
  'the manual-review warning must appear only after an active delayed dispatch was revoked');
assert.match(panelSource,
  /const triggerProcessing = useCallback\(\(text, options = \{\}\) => \{\s*revokeDelayedCaptureDispatch\(\);/,
  'every explicit processing trigger must revoke any delayed capture owner first');

const delayedCaptureCallback = panelSource.match(
  /debounceRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?\n\s*\}, delayMs\);/,
)?.[0] || '';
assert.match(delayedCaptureCallback, /ownsDelayedCaptureDispatch\(\{/,
  'the delayed capture callback must re-check ownership at dispatch time');
assert.match(delayedCaptureCallback, /if \(!ownsDispatch\) \{[\s\S]*?return;\s*\}/,
  'a delayed capture callback without ownership must stop before processing');
assert.match(delayedCaptureCallback,
  /revokeDelayedCaptureDispatch\(\);[\s\S]*?triggerProcessingRef\.current\?\.\(/,
  'the delayed capture callback must consume its one-shot owner before processing');
assert.match(panelSource,
  /const EDITED_SOURCE_MANUAL_SUBMIT_WARNING = '你已修改原文。修改后的文字没有自动发送；请点击下方的生成按钮或按 Command\+Enter 处理。';/,
  'editing a captured source must explain that manual review and submission are required');
assert.match(panelSource,
  /\{warning && \([\s\S]*?className="capture-warning" role="status" aria-live="polite" aria-atomic="true"[\s\S]*?\{warning\}/,
  'the manual-review warning must be visible and announced');

const screenshotHandler = mainSource.match(
  /ipcMain\.handle\(IPC_CHANNELS\.SCREENSHOT_CAPTURE,[\s\S]*?\n\s*\}\);/,
)?.[0] || '';
assert.match(screenshotHandler, /providerConnectionInFlight \|\| llmRequestInFlight \|\| verificationRequestInFlight/,
  'main must reject a screenshot request while provider validation, analysis, or verification is active');
assert.match(screenshotHandler, /SCREENSHOT_BUSY/);
assert.doesNotMatch(screenshotHandler, /AbortController\?\.abort|llmAbortController|verificationAbortController/,
  'starting screenshot capture must never cancel another task implicitly');

assert.match(panelSource, /const \[pendingScreenshotRequest, setPendingScreenshotRequest\]/);
assert.match(panelSource, /guard\.status === STATUS\.PROCESSING \|\| guard\.isVerifying/);
assert.match(panelSource, /截图请求正在等待；当前任务、原文和结果都没有改变/);
assert.match(panelSource, /handleProceedPendingScreenshot[\s\S]*?cancelOfficialVerification\(\)[\s\S]*?handleCancelProcessing\(\)/,
  'the user-confirmed path must use acknowledged cancellation for both task kinds');
assert.match(panelSource, /pendingScreenshotRequest\?\.status !== 'stopping'[\s\S]*?performScreenshotCapture\(\)/,
  'screen selection must start only after the active task has settled');
assert.match(panelSource, /handleIgnorePendingScreenshot/);
assert.match(panelSource,
  /if \(!pendingScreenshotRequest \|\| pendingScreenshotRequest\.status === 'stopping'\) return false;/,
  'the ignore handler must fail closed after cancellation has started');
assert.match(panelSource,
  /if \(!pendingScreenshotRequest\) return undefined;\s*if \(pendingScreenshotRequest\.status === 'stopping'\) return undefined;/,
  'a stopping request must not fall back to stale waiting-state announcements');
assert.match(panelSource,
  /\{screenshotQueueCopy\?\.showIgnoreAction && \([\s\S]*?onClick=\{handleIgnorePendingScreenshot\}/,
  'the continue action must be removed from the rendered stopping state');
assert.match(panelSource, /hasPendingCapture: Boolean\(pendingScreenshotRequest\)/);
assert.match(stylesSource, /\.clipboard-monitor-queue\.is-screenshot-request/);
assert.match(stylesSource, /\.pending-screenshot-spinner/);

assert.match(ipcSource, /get\('activeCapture'\)/);
assert.match(ipcSource, /\['screenshot', 'settings-screenshot', 'foreground-screenshot', 'reply-screenshot'\]\.includes\(demoActiveCaptureEventsCode\)/);
assert.match(ipcSource, /demoActiveCaptureEventsCode === 'foreground-clipboard'/);
assert.match(ipcSource, /source: 'shortcut'/);

assert.equal(hasQuitRisk({ hasPendingCapture: true }), true);
assert.match(describeQuitRisk({ hasPendingCapture: true }).items.join(' '), /不会开始截图框选/);
assert.match(quitSource, /'hasPendingCapture'/);

console.log('Active capture collision checks passed.');
