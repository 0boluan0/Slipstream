import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  describePendingScreenshotRequest,
  getForegroundCaptureBlockReason,
  isForegroundCaptureDecisionBlocking,
} from '../src/renderer/utils/foregroundCaptureGuard.mjs';
import {
  createPendingClipboardItem,
  describePendingClipboard,
} from '../src/renderer/utils/clipboardMonitorQueue.mjs';

assert.equal(getForegroundCaptureBlockReason({
  appDecisionBlocked: true,
  hasReplyDraft: true,
}), 'app-decision', 'application quit must remain above the guided-reply drawer');
assert.equal(getForegroundCaptureBlockReason({
  hasReplyDraft: true,
  hasActiveDecision: true,
}), 'active-decision', 'an existing modal decision must remain above the guided-reply drawer');
assert.equal(getForegroundCaptureBlockReason({
  hasReplyDraft: true,
  isEditingSource: true,
  hasClearedSessionUndo: true,
  hasSourceDraft: true,
}), 'reply-draft', 'the guided-reply drawer must own capture ahead of non-modal foreground work');
assert.equal(isForegroundCaptureDecisionBlocking('reply-draft', {
  hasReplyDraft: true,
}), true, 'an open guided-reply drawer must block foreground capture');
assert.equal(isForegroundCaptureDecisionBlocking('reply-draft', {
  hasReplyDraft: false,
}), false, 'a closed guided-reply drawer must release foreground capture');

const blockingScreenshotCopy = describePendingScreenshotRequest({
  reason: 'reply-draft',
  receivedCount: 1,
}, { decisionStillBlocking: true });
assert.match(blockingScreenshotCopy.title, /回复草稿/);
assert.match(blockingScreenshotCopy.detail, /等待|先完成|不会/);

const settledScreenshotCopy = describePendingScreenshotRequest({
  reason: 'reply-draft',
  receivedCount: 1,
});
assert.match(settledScreenshotCopy.actionLabel, /放弃回复草稿并截图/);
assert.match(settledScreenshotCopy.ignoreLabel, /继续编辑回复/);
assert.match(settledScreenshotCopy.detail, /回复草稿/);

const resolvedProtectedScreenshotCopy = describePendingScreenshotRequest({
  reason: 'foreground-resolved',
  replyDraftProtected: true,
});
assert.match(resolvedProtectedScreenshotCopy.actionLabel, /放弃回复草稿并截图/,
  'a temporary foreground owner must not erase the protected reply-draft decision');
assert.match(resolvedProtectedScreenshotCopy.ignoreLabel, /继续编辑回复/);

const firstProtectedClipboard = createPendingClipboardItem({
  text: 'First captured reply-safe text',
  source: 'shortcut',
  truncated: false,
  originalLength: 30,
}, null, { replyDraftProtected: true });
assert.equal(firstProtectedClipboard.replyDraftProtected, true,
  'a capture created behind the reply drawer must retain that ownership reason');

const latestProtectedClipboard = createPendingClipboardItem({
  text: 'Latest captured reply-safe text',
  source: 'shortcut',
  truncated: false,
  originalLength: 31,
}, firstProtectedClipboard, { replyDraftProtected: false });
assert.equal(latestProtectedClipboard.text, 'Latest captured reply-safe text',
  'the existing latest-wins clipboard rule must remain intact');
assert.equal(latestProtectedClipboard.replyDraftProtected, true,
  'a later capture must not erase the pending reply-draft recovery right');
assert.equal(latestProtectedClipboard.receivedCount, 2);

const settledClipboardCopy = describePendingClipboard(latestProtectedClipboard, {
  foregroundReason: null,
});
assert.match(settledClipboardCopy.title, /回复草稿/,
  'reply-draft copy must survive after the drawer closes');
assert.match(settledClipboardCopy.actionLabel, /放弃回复草稿并处理/);
assert.match(settledClipboardCopy.ignoreLabel, /继续编辑回复/);
assert.match(settledClipboardCopy.detail, /回复草稿/);

const [resultSource, panelSource, ipcSource] = [
  '../src/renderer/components/ResultDisplay.jsx',
  '../src/renderer/components/FloatingPanel.jsx',
  '../src/renderer/hooks/useIpc.js',
].map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

assert.match(resultSource, /replyDialogOpen:\s*controlledReplyDialogOpen/,
  'ResultDisplay must receive controlled reply-dialog state');
assert.match(resultSource, /const replyDialogOpen\s*=\s*controlledReplyDialogOpen\s*\?\?\s*localReplyDialogOpen/,
  'ResultDisplay may fall back locally without hiding controlled ownership');
assert.match(resultSource, /onReplyDialogOpenChange/,
  'all reply-dialog transitions must report to the capture owner');
assert.doesNotMatch(resultSource, /const \[showReplyDraft,\s*setShowReplyDraft\]/,
  'reply ownership must not remain hidden in child-only open state');
assert.match(resultSource, /createPortal\(/,
  'the guided reply must render at an application-level modal boundary');
assert.match(resultSource, /new MutationObserver\(/,
  'new shell content must become isolated while the reply portal is open');
assert.match(resultSource, /inert:\s*node\.inert[\s\S]*?ariaHidden:\s*node\.getAttribute\('aria-hidden'\)/,
  'modal isolation must snapshot exact prior inert and aria-hidden state');
assert.match(resultSource, /node\.inert\s*=\s*previous\.inert[\s\S]*?previous\.ariaHidden === null[\s\S]*?removeAttribute\('aria-hidden'\)/,
  'closing the reply portal must restore exact prior modal state');
assert.match(resultSource, /observer\?\.disconnect\(\)|observer\.disconnect\(\)/,
  'the reply modal observer must be disconnected during cleanup');

assert.match(panelSource, /const \[replyDialogOpen,\s*setReplyDialogOpen\]\s*=\s*useState\(false\)/);
assert.match(panelSource, /const replyDialogOpenRef\s*=\s*useRef\(false\)/,
  'shortcut callbacks need a live reply owner instead of render-stale state');
assert.match(panelSource, /replyDialogOpenRef\.current\s*=\s*replyDialogOpen/);
assert.match(panelSource, /hasReplyDraft:\s*replyDialogOpen/,
  'foreground priority must include the controlled reply drawer');
assert.match(panelSource, /replyDraftProtected:\s*replyDialogOpenRef\.current/,
  'clipboard items must remember that they arrived behind the reply drawer');
assert.match(panelSource, /const liveForegroundContext\s*=\s*\{[\s\S]{0,300}hasReplyDraft:\s*replyDialogOpenRef\.current[\s\S]{0,300}getForegroundCaptureBlockReason\(liveForegroundContext\)/,
  'F2 must derive its queue reason from the live reply owner instead of render-stale state');
assert.match(panelSource, /reason:\s*queueReason[\s\S]{0,250}replyDraftProtected:\s*replyDialogOpenRef\.current/,
  'F2 must persist both its live queue reason and reply-draft recovery right');
const protectedReplyRestores = panelSource.match(
  /replyDraftProtected\s*===\s*true[\s\S]{0,700}?resumeReplyDraft\(\)/g,
) || [];
assert.ok(protectedReplyRestores.length >= 2,
  'ignoring protected clipboard and screenshot requests must both restore the reply drawer safely');
assert.match(panelSource, /replyDialogOpen=\{replyDialogOpen\}/);
assert.match(panelSource, /onReplyDialogOpenChange=\{[^}]+\}/);

assert.match(ipcSource, /demoActiveCaptureEventsCode === 'reply-clipboard'/,
  'the deterministic Option+C fixture must target an edited reply');
assert.match(ipcSource, /'reply-screenshot'/,
  'the deterministic F2 fixture must target an edited reply');
assert.match(ipcSource, /demoActiveCaptureEventsCode !== 'reply-screenshot'/,
  'the F2 fixture must not accidentally emit a clipboard event');
assert.match(ipcSource, /dataset\.demoScreenshotCaptureRequests\s*=\s*String\(demoScreenshotCaptureRequests\)/,
  'screenshot fixture requests must be observable to deterministic browser checks');
const screenshotCaseStart = ipcSource.indexOf('case IPC_CHANNELS.SCREENSHOT_CAPTURE:');
const screenshotCaseEnd = ipcSource.indexOf('\n    case IPC_CHANNELS.', screenshotCaseStart + 1);
assert.notEqual(screenshotCaseStart, -1, 'the deterministic fixture must implement SCREENSHOT_CAPTURE');
assert.notEqual(screenshotCaseEnd, -1,
  'the SCREENSHOT_CAPTURE fixture branch must remain bounded by the next IPC case');
const screenshotCaseSource = ipcSource.slice(screenshotCaseStart, screenshotCaseEnd);
assert.match(
  screenshotCaseSource,
  /demoScreenshotCaptureRequests\s*\+=\s*1[\s\S]*?exposeDemoRequestCounters\(\)/,
  'the screenshot fixture must count and expose requests so no-start and one-shot behavior are observable',
);
assert.match(ipcSource, /dataset\.demoProcessRequests\s*=\s*String\(demoProcessRequests\)/,
  'processing fixture requests must be observable to deterministic browser checks');
const processCaseStart = ipcSource.indexOf('case IPC_CHANNELS.LLM_PROCESS:');
const processCaseEnd = ipcSource.indexOf('\n    case IPC_CHANNELS.', processCaseStart + 1);
assert.notEqual(processCaseStart, -1, 'the deterministic fixture must implement LLM_PROCESS');
assert.notEqual(processCaseEnd, -1, 'the LLM_PROCESS fixture branch must remain bounded by the next IPC case');
const processCaseSource = ipcSource.slice(processCaseStart, processCaseEnd);
assert.match(
  processCaseSource,
  /demoProcessRequests\s*\+=\s*1[\s\S]*?recordDemoProcessPayload\(args\[0\]\)[\s\S]*?exposeDemoRequestCounters\(\)/,
  'the LLM_PROCESS fixture must count, retain, and expose each real processing request',
);

console.log('Guided reply capture ownership checks passed.');
