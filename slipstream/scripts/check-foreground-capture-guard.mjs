import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  describePendingScreenshotRequest,
  getForegroundCaptureBlockReason,
  isForegroundCaptureDecisionBlocking,
} from '../src/renderer/utils/foregroundCaptureGuard.mjs';
import { isCaptureContextProtected } from '../src/renderer/utils/clipboardMonitorQueue.mjs';

assert.equal(getForegroundCaptureBlockReason({
  appDecisionBlocked: true,
  hasSessionRecovery: true,
  isEditingSource: true,
}), 'app-decision');
assert.equal(getForegroundCaptureBlockReason({
  hasSessionRecovery: true,
  hasClipboardResidueRisk: true,
  savedTermsOpen: true,
  isEditingSource: true,
}), 'session-recovery');
assert.equal(getForegroundCaptureBlockReason({
  hasClipboardResidueRisk: true,
  savedTermsOpen: true,
}), 'clipboard-residue');
assert.equal(getForegroundCaptureBlockReason({
  savedTermsOpen: true,
  isEditingSource: true,
}), 'saved-terms');
assert.equal(getForegroundCaptureBlockReason({ isEditingSource: true }), 'source-edit');
assert.equal(getForegroundCaptureBlockReason({ hasClearedSessionUndo: true }), 'clear-undo');
assert.equal(getForegroundCaptureBlockReason({ hasSourceDraft: true }), 'source-draft');
assert.equal(getForegroundCaptureBlockReason(), null);

assert.equal(isForegroundCaptureDecisionBlocking('app-decision', {
  appDecisionBlocked: true,
}), true);
assert.equal(isForegroundCaptureDecisionBlocking('app-decision', {
  appDecisionBlocked: false,
}), false);
assert.equal(isForegroundCaptureDecisionBlocking('clipboard-residue', {
  hasClipboardResidueRisk: true,
}), true);
assert.equal(isForegroundCaptureDecisionBlocking('clipboard-residue', {
  hasClipboardResidueRisk: false,
}), false);
assert.equal(isForegroundCaptureDecisionBlocking('source-edit', {
  isEditingSource: true,
}), false);

const sourceEditCopy = describePendingScreenshotRequest({
  reason: 'source-edit',
  receivedCount: 1,
});
assert.equal(sourceEditCopy.title, '截图请求正在等待原文修正决定');
assert.equal(sourceEditCopy.actionLabel, '放弃修正并截图');
assert.equal(sourceEditCopy.ignoreLabel, '继续修正');

const clearUndoCopy = describePendingScreenshotRequest({
  reason: 'clear-undo',
  receivedCount: 2,
});
assert.match(clearUndoCopy.title, /连续按下 2 次/);
assert.equal(clearUndoCopy.actionLabel, '放弃撤销并截图');

const blockingQuitCopy = describePendingScreenshotRequest({
  reason: 'app-decision',
}, { decisionStillBlocking: true });
assert.match(blockingQuitCopy.detail, /确认层背后/);

const blockingClipboardResidueCopy = describePendingScreenshotRequest({
  reason: 'clipboard-residue',
}, { decisionStillBlocking: true });
assert.match(blockingClipboardResidueCopy.title, /剪贴板检查/);
assert.match(blockingClipboardResidueCopy.detail, /手动覆盖/);
assert.equal(blockingClipboardResidueCopy.actionLabel, '开始截图');

const resolvedCopy = describePendingScreenshotRequest({
  reason: 'foreground-resolved',
});
assert.equal(resolvedCopy.actionLabel, '开始截图');
assert.match(resolvedCopy.detail, /前台操作已经结束/);

assert.equal(isCaptureContextProtected({ hasForegroundDecision: true }), true);

const [panelSource, appSource, ipcSource] = await Promise.all([
  readFile(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8'),
]);

assert.match(panelSource, /captureDecisionBlocked = false/);
assert.match(panelSource, /hasClipboardResidueRisk: Boolean\(clipboardResidueRisk\)/);
assert.match(panelSource, /hasForegroundDecision: Boolean\(/);
assert.match(panelSource, /getForegroundCaptureBlockReason\(foregroundCaptureContext\)/);
assert.match(panelSource,
  /const openSavedTerms = useCallback\(\(\) => \{[\s\S]*?savedTermsDrawerOpenRef\.current = true;[\s\S]*?foregroundCaptureDecisionBlockingRef\.current = true;/,
  'opening Saved Terms must synchronously claim foreground capture ownership');
assert.match(panelSource,
  /const liveForegroundContext = \{[\s\S]*?savedTermsOpen: savedTermsDrawerOpenRef\.current/,
  'same-frame screenshot requests must observe Saved Terms modal intent');
assert.match(panelSource,
  /hasForegroundDecision: Boolean\([\s\S]*?foregroundCaptureDecisionBlockingRef\.current[\s\S]*?savedTermsDrawerOpenRef\.current[\s\S]*?replyDialogOpenRef\.current/,
  'same-frame clipboard requests must remain queued behind Saved Terms');
assert.match(panelSource, /pendingScreenshotDecisionStillBlocking/);
assert.match(panelSource, /reason: 'foreground-resolved'/);
assert.match(panelSource, /screenshotRequestHandlerRef\.current\?\.\(\)/);
assert.match(panelSource, /\}, \[on\]\);/);
assert.match(panelSource, /describePendingScreenshotRequest\(pendingScreenshotRequest/);
assert.match(panelSource, /disabled=\{[\s\S]*pendingScreenshotDecisionStillBlocking/);
assert.match(appSource, /captureDecisionBlocked=\{Boolean\(quitRequestId\)\}/);
assert.match(ipcSource, /foreground-screenshot/);

console.log('Foreground capture guard checks passed.');
