import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CLEAR_UNDO_WINDOW_MS,
  createClearedSessionSnapshot,
  getClearUndoSecondsRemaining,
  pauseClearUndoWindow,
  prepareClearedSessionRestore,
  resumeClearUndoWindow,
} from '../src/renderer/utils/clearedSession.mjs';
import {
  classifyClipboardReadAttempt,
  isCurrentClipboardReadAttempt,
} from '../src/renderer/utils/clipboardReadAttempt.mjs';
import {
  REPLY_DRAFT_MAX_LENGTH,
  createReplyModelIdentity,
  sanitizeReplyDraftState,
} from '../src/renderer/utils/replyDraftState.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const lastGood = {
  inputText: 'private source text',
  brief: { headline: 'Action required' },
  warning: '',
  verificationApprovalId: 'approval-id',
};
const replyModelIdentity = createReplyModelIdentity({ title: 'Reply', facts: ['passport'] });
assert.match(replyModelIdentity, /^reply-v1-[a-f0-9]{16}$/);
assert.doesNotMatch(replyModelIdentity, /Reply|passport|facts/);
assert.equal(
  createReplyModelIdentity({ facts: ['passport'], title: 'Reply' }),
  replyModelIdentity,
);
assert.notEqual(
  createReplyModelIdentity({ title: 'Reply', facts: ['different requirement'] }),
  replyModelIdentity,
);
const replyDraftState = {
  modelIdentity: replyModelIdentity,
  draft: 'Dear team,\n\nI have completed the requested steps.',
  completionStatus: 'completed',
  overrideConfirmed: true,
  selection: { start: 5, end: 12, direction: 'forward' },
  copyToken: 'must-not-survive',
  settings: { apiKey: 'must-not-survive-either' },
};
const snapshot = createClearedSessionSnapshot({
  inputText: 'private source text',
  processedSourceText: 'private source text',
  brief: lastGood.brief,
  result: '',
  captureMeta: { confidence: 0.98, blocks: [] },
  sourceMeta: { truncated: false, originalLength: 19 },
  status: 'done',
  warning: 'Existing warning.',
  error: null,
  captureErrorCode: null,
  processingErrorCode: 'processing-unauthorized',
  processingTimeMs: 1200,
  verificationTimeMs: null,
  sourceType: 'ocr',
  lastGood,
  isEditingSource: true,
  sourceEditDraft: { baseSourceText: 'private source text', text: 'edited private source text' },
  verificationApprovalId: 'approval-id',
  replyDraftState,
});

assert.equal(CLEAR_UNDO_WINDOW_MS, 10000);
assert.equal(getClearUndoSecondsRemaining(11000, 1000), 10);
assert.equal(getClearUndoSecondsRemaining(10001, 1000), 10);
assert.equal(getClearUndoSecondsRemaining(10000, 1000), 9);
assert.equal(getClearUndoSecondsRemaining(1001, 1000), 1);
assert.equal(getClearUndoSecondsRemaining(1000, 1000), 0);
assert.equal(getClearUndoSecondsRemaining('invalid', 1000), 0);
const nearExpiryUndo = Object.freeze({ snapshot, kind: 'result', expiresAt: 2000 });
const pausedNearExpiryUndo = pauseClearUndoWindow(nearExpiryUndo, 1250);
assert.notEqual(pausedNearExpiryUndo, nearExpiryUndo);
assert.equal(pausedNearExpiryUndo.expiresAt, null);
assert.equal(pausedNearExpiryUndo.remainingMs, 750,
  'pausing must retain the exact sub-second remainder');
const resumedNearExpiryUndo = resumeClearUndoWindow(pausedNearExpiryUndo, 9000);
assert.equal(resumedNearExpiryUndo.expiresAt, 9750,
  'resuming must add only the retained remainder, not a fresh ten seconds');
assert.equal(resumedNearExpiryUndo.remainingMs, null);
assert.equal(getClearUndoSecondsRemaining(resumedNearExpiryUndo.expiresAt, 9000), 1);
assert.equal(pauseClearUndoWindow(nearExpiryUndo, 2000), nearExpiryUndo,
  'an expired Undo must never be revived');
assert.equal(resumeClearUndoWindow(nearExpiryUndo, 9000), nearExpiryUndo,
  'an active, unpaused Undo must not be rescheduled');
assert.equal(snapshot.inputText, 'private source text');
assert.equal(snapshot.hadVerificationApproval, true);
assert.equal(snapshot.verificationApprovalId, undefined);
assert.equal(snapshot.isEditingSource, true);
assert.equal(snapshot.sourceEditDraft.text, 'edited private source text');
assert.equal(snapshot.processingErrorCode, 'processing-unauthorized');
assert.deepEqual(snapshot.replyDraftState, {
  modelIdentity: replyModelIdentity,
  draft: replyDraftState.draft,
  completionStatus: 'completed',
  overrideConfirmed: true,
  selection: { start: 5, end: 12, direction: 'forward' },
});
assert.doesNotMatch(JSON.stringify(snapshot.replyDraftState), /must-not-survive/);

const restored = prepareClearedSessionRestore(snapshot);
assert.equal(restored.inputText, 'private source text');
assert.equal(restored.status, 'done');
assert.equal(restored.verificationApprovalId, null);
assert.equal(restored.lastGood.verificationApprovalId, null);
assert.equal(restored.isEditingSource, true);
assert.equal(restored.sourceEditDraft.text, 'edited private source text');
assert.equal(restored.processingErrorCode, 'processing-unauthorized');
assert.deepEqual(restored.replyDraftState, snapshot.replyDraftState);
assert.match(restored.warning, /官方核验授权没有恢复/);
assert.equal(prepareClearedSessionRestore(null), null);
assert.equal(
  prepareClearedSessionRestore(createClearedSessionSnapshot({ status: 'processing' })).status,
  'idle',
);

assert.equal(isCurrentClipboardReadAttempt(4, 4), true);
assert.equal(isCurrentClipboardReadAttempt(4, 5), false);
assert.equal(isCurrentClipboardReadAttempt('4', 4), false);
assert.deepEqual(classifyClipboardReadAttempt('replacement text', 7, 8), {
  status: 'stale',
  payload: null,
});
assert.deepEqual(classifyClipboardReadAttempt('   ', 7, 7), {
  status: 'empty',
  payload: null,
});
assert.deepEqual(classifyClipboardReadAttempt({
  text: 'replacement text',
  truncated: true,
  originalLength: 42,
}, 7, 7), {
  status: 'ready',
  payload: {
    text: 'replacement text',
    truncated: true,
    originalLength: 42,
  },
});
assert.deepEqual(classifyClipboardReadAttempt({
  text: 'replacement text',
  truncated: 'yes',
  originalLength: 2,
}, 7, 7), {
  status: 'ready',
  payload: {
    text: 'replacement text',
    truncated: false,
    originalLength: 'replacement text'.length,
  },
});

assert.equal(sanitizeReplyDraftState({
  ...replyDraftState,
  modelIdentity: createReplyModelIdentity({ title: 'Different reply model' }),
}, { expectedModelIdentity: replyModelIdentity }), null);
assert.deepEqual(sanitizeReplyDraftState({
  ...replyDraftState,
  draft: 'x'.repeat(REPLY_DRAFT_MAX_LENGTH + 1),
}), {
  modelIdentity: replyModelIdentity,
  draft: '',
  completionStatus: 'unconfirmed',
  overrideConfirmed: false,
  selection: { start: 0, end: 0, direction: 'none' },
});
assert.deepEqual(sanitizeReplyDraftState({
  ...replyDraftState,
  completionStatus: 'forged',
  selection: { start: -1, end: 999999, direction: 'sideways' },
}), {
  modelIdentity: replyModelIdentity,
  draft: replyDraftState.draft,
  completionStatus: 'unconfirmed',
  overrideConfirmed: false,
  selection: { start: 0, end: replyDraftState.draft.length, direction: 'none' },
});

const panelSource = readSource('src/renderer/components/FloatingPanel.jsx');
const resultSource = readSource('src/renderer/components/ResultDisplay.jsx');
const utilitySource = readSource('src/renderer/utils/clearedSession.mjs');

assert.match(panelSource, /expiresAt = Date\.now\(\) \+ CLEAR_UNDO_WINDOW_MS/);
assert.match(panelSource, /getClearUndoSecondsRemaining\(clearedSessionExpiresAt\)/);
assert.match(panelSource, /还可撤销 \$\{clearedSessionSecondsRemaining\} 秒/);
assert.match(panelSource, /撤销倒计时已暂停（剩余 \$\{clearedSessionSecondsRemaining\} 秒）/);
assert.match(panelSource, /aria-hidden="true"/);
assert.match(panelSource, /armClearedSessionUndo\(snapshot\)/);
assert.match(panelSource, /replyDraftState: replyDraftStateRef\.current/);
assert.match(panelSource, /setReplyDraftState\(restored\.replyDraftState \|\| null\)/);
assert.match(panelSource, /setReplyDialogOpen\(false\)/);
assert.match(panelSource, /clearUndoButtonRef\.current\?\.focus/);
assert.doesNotMatch(panelSource, /resultReturnButtonRef\.current\?\.focus/);
assert.match(resultSource, /headlineRef\.current\?\.focus/);
assert.match(panelSource, /textareaRef\.current\?\.focus/);
assert.match(panelSource, /discardClearedSession\(\);\n\s+const nextText = event\.target\.value/);

const handlePasteStart = panelSource.indexOf('const handlePaste = useCallback(async () => {');
const handlePasteEnd = panelSource.indexOf('const handleSourceLimitRecovery', handlePasteStart);
assert.ok(handlePasteStart >= 0 && handlePasteEnd > handlePasteStart,
  'the clipboard read handler must remain inspectable');
const handlePasteSource = panelSource.slice(handlePasteStart, handlePasteEnd);
assert.match(handlePasteSource, /const attemptToken = clipboardReadRunRef\.current/);
assert.match(handlePasteSource, /pauseClearedSessionUndo\(attemptToken\)/);
assert.match(handlePasteSource, /outcome\.status === 'stale'/);
assert.match(handlePasteSource, /isCurrentClipboardReadAttempt\(attemptToken, clipboardReadRunRef\.current\)/);
assert.doesNotMatch(
  handlePasteSource,
  /discardClearedSession\(\)/,
  'reading useful clipboard text must not consume clear undo before the replacement decision',
);
assert.match(handlePasteSource, /source: 'manual-read'/);
assert.match(handlePasteSource, /setPendingClipboardItem\(next\)/);
assert.match(handlePasteSource, /resumeClearedSessionUndo\(clearUndoPauseOwner\)/);

const commitManualReadStart = panelSource.indexOf('const commitManualClipboardRead = useCallback(');
const commitManualReadEnd = panelSource.indexOf('const handlePaste = useCallback(', commitManualReadStart);
assert.ok(commitManualReadStart >= 0 && commitManualReadEnd > commitManualReadStart,
  'the explicit clipboard replacement commit must remain inspectable');
const commitManualReadSource = panelSource.slice(commitManualReadStart, commitManualReadEnd);
assert.equal(
  (commitManualReadSource.match(/discardClearedSession\(\)/g) || []).length,
  1,
  'an explicitly committed clipboard replacement must consume clear undo exactly once',
);
assert.ok(
  commitManualReadSource.indexOf("if (!payload?.text?.trim()) return false")
    < commitManualReadSource.indexOf('discardClearedSession()'),
  'empty clipboard data must not consume clear undo',
);
assert.match(panelSource, /clearUndoPauseOwnerRef\.current !== owner/);
assert.match(panelSource, /clearedSessionRef\.current !== owner\.session/);
assert.match(panelSource, /owner\.attemptToken !== clipboardReadRunRef\.current/);
assert.match(resultSource, /ref=\{newCaptureButtonRef\}/);
assert.match(resultSource, /createReplyModelIdentity\(replyDraftModel\)/);
assert.match(resultSource, /onReplyDraftStateChange\?\./);
assert.match(resultSource, /expectedModelIdentity: replyDraftModelIdentity/);
assert.match(resultSource, /完成任务并清空当前原文和结果，返回捕获；10 秒内可撤销/);
assert.match(resultSource, /清空当前原文和结果并返回捕获，10 秒内可撤销/);
assert.match(resultSource, /allActionsComplete \? '完成并返回' : '清空并返回'/);
assert.doesNotMatch(utilitySource, /localStorage|sessionStorage|indexedDB|IPC_CHANNELS|SETTINGS_SET|TERMS_SAVE/);

console.log('Clear undo checks passed.');
