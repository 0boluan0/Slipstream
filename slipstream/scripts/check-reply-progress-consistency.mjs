import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReplyDraft,
  getReplyProgressConsistency,
} from '../src/renderer/utils/evidenceMapping.mjs';
import { getReplyProgressConsistencyForBrief } from '../src/renderer/utils/replyProgress.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const brief = {
  status: 'complete',
  materials: [{ id: 'passport', name: 'passport scan' }],
  deadlines: [],
  terms: [],
  nextSteps: [
    { id: 'generate', action: '生成 share code', actor: 'user', mandatory: true },
    { id: 'prepare', action: '准备护照扫描件', actor: 'user', mandatory: true },
    { id: 'submit', action: '提交材料', actor: 'user', mandatory: true },
    { id: 'optional', action: '可选：保存一份副本', actor: 'user', mandatory: false },
    { id: 'institution', action: '学校审核材料', actor: 'institution', mandatory: true },
    { id: 'reply', action: '回复邮件，确认材料已经提交', actor: 'user', mandatory: true },
  ],
};

const model = buildReplyDraft(brief);
assert.equal(model.mode, 'guided');
assert.equal(model.replyStepId, 'reply');
assert.deepEqual(model.requiredCompletionActionIds, ['generate', 'prepare', 'submit']);

assert.deepEqual(getReplyProgressConsistency(model, []), {
  requiredActionIds: ['generate', 'prepare', 'submit'],
  completedRequiredActionIds: [],
  remainingActionIds: ['generate', 'prepare', 'submit'],
  requiredCount: 3,
  completedCount: 0,
  isComplete: false,
});
assert.deepEqual(
  getReplyProgressConsistencyForBrief(brief, []),
  getReplyProgressConsistency(model, []),
  'the entry-owned brief helper must match the Result workspace model contract',
);

const partial = getReplyProgressConsistency(model, new Set(['generate', 'reply', 'unknown']));
assert.deepEqual(partial.completedRequiredActionIds, ['generate']);
assert.deepEqual(partial.remainingActionIds, ['prepare', 'submit']);
assert.equal(partial.completedCount, 1);
assert.equal(partial.isComplete, false);
assert.deepEqual(
  getReplyProgressConsistencyForBrief(brief, new Set(['generate', 'reply', 'unknown'])),
  partial,
  'entry and Result progress checks must stay identical for partial completion',
);

const ready = getReplyProgressConsistency(model, ['submit', 'generate', 'prepare']);
assert.equal(ready.completedCount, 3);
assert.deepEqual(ready.remainingActionIds, []);
assert.equal(ready.isComplete, true);

const unavailable = buildReplyDraft({ status: 'complete', materials: [], deadlines: [], terms: [], nextSteps: [] });
assert.deepEqual(unavailable.requiredCompletionActionIds, []);
assert.equal(getReplyProgressConsistency(unavailable).isComplete, true);

const componentSource = readSource('src/renderer/components/ResultDisplay.jsx');
const cssSource = readSource('src/renderer/components/ResultDisplay.css');
const appCssSource = readSource('src/renderer/App.css');

assert.match(componentSource, /replyProgressOverrideConfirmed/);
assert.match(componentSource, /replyCompletedClaimMismatch[\s\S]*replyProgressConsistency\.requiredCount > 0[\s\S]*!replyProgressConsistency\.isComplete/);
assert.match(componentSource, /replyCopyBlocked[\s\S]*replyCompletedClaimMismatch && !replyProgressOverrideConfirmed/);
assert.match(componentSource, /完成声明与当前行动记录不一致/);
assert.match(componentSource, /我确认清单尚未更新，现实中已经完成原文要求/);
assert.match(componentSource, /不会自动把行动项标记完成/);
assert.match(
  componentSource,
  /affectsCompletedReply[\s\S]*setReplyProgressOverrideConfirmed\(false\)[\s\S]*markCopiedClipboardNoticeOutdated\(actionNotice, 'reply'\)/,
  'required action changes must re-check any already copied completion reply',
);
assert.match(componentSource, /复制前还需：\{replyCopyBlockSummary\}/);
assert.match(componentSource, /role="alert"/);
assert.match(componentSource, /aria-describedby=\{replyCopyDescriptionIds\}/);
assert.match(cssSource, /\.reply-progress-mismatch/);
assert.match(cssSource, /\.reply-progress-mismatch label:focus-within/);
assert.match(appCssSource, /\.reply-drawer > footer \{[\s\S]*position: sticky;[\s\S]*bottom:/);
assert.match(appCssSource, /\.reply-copy-block-summary/);

console.log('Reply progress consistency checks passed.');
