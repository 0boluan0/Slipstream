import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beginReplyClipboardCopy,
  createReplyContentIdentity,
  isReplyClipboardCopyPending,
  markPendingReplyCopyAfterTaskExit,
  markPendingReplyCopyOutdated,
  reconcileReplyClipboardNotice,
  settleReplyClipboardCopyFailure,
  settleReplyClipboardCopySuccess,
} from '../src/renderer/utils/replyClipboardLifecycle.mjs';

const modelIdentity = 'reply-v1-0123456789abcdef';
const taskGeneration = 4;
const draftA = 'Dear team,\n\nI have submitted the requested documents.\n\nKind regards';
const draftB = `${draftA}\nSebastian`;
const stateA = {
  modelIdentity,
  draft: draftA,
  completionStatus: 'completed',
  overrideConfirmed: false,
  selection: { start: 0, end: 0, direction: 'none' },
};
const stateB = { ...stateA, draft: draftB };
const response = { success: true, consequenceId: 'reply-consequence-a' };

const identityA = createReplyContentIdentity(draftA);
assert.match(identityA, /^reply-content-v1-[a-f0-9]{16}$/);
assert.equal(identityA.includes(draftA), false, 'version identity must not retain plaintext');
assert.notEqual(identityA, createReplyContentIdentity(draftB));

const begin = (requestId = 1, previousNotice = null) => beginReplyClipboardCopy({
  requestId,
  taskGeneration,
  modelIdentity,
  draft: draftA,
  previousNotice,
});

const pending = begin();
assert.equal(isReplyClipboardCopyPending(pending), true);
assert.equal(pending.status, 'copying');
assert.equal(pending.consequenceId, null);
assert.equal(pending.previousConsequence, null);
assert.equal(JSON.stringify(pending).includes(draftA), false);

const current = settleReplyClipboardCopySuccess(pending, response, {
  requestId: 1,
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(current.status, 'copied');
assert.equal(current.consequenceId, 'reply-consequence-a');
assert.equal(current.contentIdentity, identityA);
assert.equal(current.taskGeneration, taskGeneration);
assert.match(current.detail, /手动覆盖/);

const completionRegressedBeforeSettlement = settleReplyClipboardCopySuccess(
  begin(9),
  response,
  {
    requestId: 9,
    replyDraftState: stateA,
    taskActive: true,
    completionClaimCurrent: false,
  },
);
assert.equal(completionRegressedBeforeSettlement.status, 'outdated');
assert.equal(completionRegressedBeforeSettlement.consequenceId, 'reply-consequence-a');

const editedBeforeSettlement = markPendingReplyCopyOutdated(begin(2));
const outdated = settleReplyClipboardCopySuccess(editedBeforeSettlement, response, {
  requestId: 2,
  replyDraftState: stateB,
  taskActive: true,
});
assert.equal(outdated.status, 'outdated');
assert.equal(outdated.consequenceId, 'reply-consequence-a');
assert.match(outdated.message, /上一版英文回复/);

const exitedPending = markPendingReplyCopyAfterTaskExit(begin(3));
const retained = settleReplyClipboardCopySuccess(exitedPending, response, {
  requestId: 3,
  replyDraftState: null,
  taskActive: false,
});
assert.equal(retained.status, 'retained');
assert.equal(retained.consequenceId, 'reply-consequence-a');

const restoredExact = reconcileReplyClipboardNotice(retained, {
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(restoredExact.status, 'copied');
assert.equal(restoredExact.consequenceId, 'reply-consequence-a',
  'Undo must preserve the exact main-owned consequence id');
const restoredEdited = reconcileReplyClipboardNotice(retained, {
  replyDraftState: stateB,
  taskActive: true,
});
assert.equal(restoredEdited.status, 'outdated');
assert.equal(restoredEdited.consequenceId, 'reply-consequence-a');

const completionRegressedAfterCopy = reconcileReplyClipboardNotice(current, {
  replyDraftState: stateA,
  taskActive: true,
  completionClaimCurrent: false,
});
assert.equal(completionRegressedAfterCopy.status, 'outdated');
assert.equal(completionRegressedAfterCopy.consequenceId, 'reply-consequence-a');
const completionRestoredAfterCopy = reconcileReplyClipboardNotice(
  completionRegressedAfterCopy,
  {
    replyDraftState: stateA,
    taskActive: true,
    completionClaimCurrent: true,
  },
);
assert.equal(completionRestoredAfterCopy.status, 'copied');
assert.equal(completionRestoredAfterCopy.consequenceId, 'reply-consequence-a');

const undoWhilePending = reconcileReplyClipboardNotice(exitedPending, {
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(undoWhilePending.status, 'copying');
assert.equal(undoWhilePending.taskExited, false);
const undoBeforeSettlement = settleReplyClipboardCopySuccess(undoWhilePending, response, {
  requestId: 3,
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(undoBeforeSettlement.status, 'copied');
assert.equal(undoBeforeSettlement.consequenceId, 'reply-consequence-a');

const wrongRequest = settleReplyClipboardCopySuccess(begin(4), {
  success: true,
  consequenceId: 'wrong-consequence',
}, {
  requestId: 999,
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(wrongRequest.status, 'copying');
assert.equal(wrongRequest.consequenceId, null,
  'a stale settlement must not replace request ownership');

const lateFailure = settleReplyClipboardCopyFailure(
  markPendingReplyCopyAfterTaskExit(begin(5)),
  { requestId: 5, replyDraftState: null, taskActive: false },
);
assert.equal(lateFailure.status, 'copy-error');
assert.equal(lateFailure.taskExited, true);
assert.equal(lateFailure.consequenceId, null);

const failedReplacement = settleReplyClipboardCopyFailure(
  begin(6, current),
  { requestId: 6, replyDraftState: stateB, taskActive: true },
);
assert.equal(failedReplacement.consequenceId, 'reply-consequence-a');
assert.match(failedReplacement.message, /仍可能保留先前内容/);
assert.equal(JSON.stringify(failedReplacement).includes(draftA), false);

const malformedSuccess = begin(8, current);
assert.throws(() => settleReplyClipboardCopySuccess(
  malformedSuccess,
  { success: true },
  { requestId: 8, replyDraftState: stateA, taskActive: true },
), /clipboard-consequence-id-missing/,
'a successful native write without its opaque consequence id must fail closed');
const malformedRecovered = settleReplyClipboardCopyFailure(malformedSuccess, {
  requestId: 8,
  replyDraftState: stateA,
  taskActive: true,
});
assert.equal(malformedRecovered.consequenceId, 'reply-consequence-a',
  'failure recovery must retain the prior exact consequence id');

const differentTask = settleReplyClipboardCopySuccess(begin(7), response, {
  requestId: 7,
  replyDraftState: stateA,
  taskActive: false,
});
assert.equal(differentTask.status, 'retained');
assert.equal(differentTask.consequenceId, 'reply-consequence-a');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lifecycleSource = fs.readFileSync(
  path.join(root, 'src/renderer/utils/replyClipboardLifecycle.mjs'),
  'utf8',
);
const appSource = fs.readFileSync(path.join(root, 'src/renderer/App.jsx'), 'utf8');
const panelSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/FloatingPanel.jsx'),
  'utf8',
);

assert.doesNotMatch(lifecycleSource, /clearToken|expiresInMs|previousAuthority/,
  'reply lifecycle must contain only opaque preserve-only consequence metadata');
const replyCopyStart = panelSource.indexOf('const handleCopyReply = useCallback');
const replyCopyEnd = panelSource.indexOf('const purgeForFullDataReset = useCallback', replyCopyStart);
const replyCopySource = panelSource.slice(replyCopyStart, replyCopyEnd);
assert.ok(replyCopyStart >= 0 && replyCopyEnd > replyCopyStart);
assert.match(replyCopySource, /onClipboardCopy\(\{[\s\S]*?kind: 'reply',[\s\S]*?text: draft/);
assert.match(replyCopySource, /onBegin: \(\{ requestId, previousNotice \}\) =>[\s\S]*?beginReplyClipboardCopy/);
assert.match(replyCopySource, /onSuccess: \(\{ requestId, response, notice \}\) => settleReplyClipboardCopySuccess/);
assert.match(replyCopySource, /onFailure: \(\{ requestId, notice \}\) => settleReplyClipboardCopyFailure/);
assert.doesNotMatch(replyCopySource, /IPC_CHANNELS\.CLIPBOARD_WRITE|navigator\.clipboard/);
assert.match(appSource, /const response = await invoke\(IPC_CHANNELS\.CLIPBOARD_WRITE, text\)/);
assert.match(appSource, /onSuccess\(\{ requestId, response, notice: currentNotice \}\)/);
assert.match(appSource, /onFailure\(\{ requestId, error: cause, notice: currentNotice \}\)/);

console.log('Reply clipboard lifecycle checks passed.');
