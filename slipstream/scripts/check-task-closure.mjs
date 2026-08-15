import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getActionCompletionState } from '../src/renderer/utils/evidenceMapping.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const actionGroups = [
  { id: 'prepare' },
  { id: 'submit' },
  { id: 'reply' },
];

assert.deepEqual(
  getActionCompletionState([], ['ghost'], 'reply'),
  {
    completedActionIdSet: new Set(),
    totalCount: 0,
    completedCount: 0,
    allActionsComplete: false,
    replyActionCompleted: false,
  },
);

const partial = getActionCompletionState(actionGroups, ['prepare', 'ghost'], 'reply');
assert.equal(partial.completedCount, 1);
assert.equal(partial.allActionsComplete, false);
assert.equal(partial.replyActionCompleted, false);
assert.deepEqual([...partial.completedActionIdSet], ['prepare']);

const replyOnly = getActionCompletionState(actionGroups, new Set(['reply']), 'reply');
assert.equal(replyOnly.allActionsComplete, false);
assert.equal(replyOnly.replyActionCompleted, true);

const complete = getActionCompletionState(actionGroups, ['prepare', 'submit', 'reply'], 'reply');
assert.equal(complete.completedCount, 3);
assert.equal(complete.allActionsComplete, true);
assert.equal(complete.replyActionCompleted, true);

const resultSource = readSource('src/renderer/components/ResultDisplay.jsx');
const cssSource = readSource('src/renderer/App.css');

assert.match(resultSource, /你已标记全部 \$\{actionGroups\.length\} 项完成/);
assert.match(resultSource, /这是你的自报记录，不代表 Slipstream 已验证现实结果/);
assert.match(resultSource, /回复已标记完成/);
assert.match(resultSource, /再次准备英文回复/);
assert.match(resultSource, /const processingCompletionLabel = isTranslationOnly \? '翻译完成' : '处理完成'/);
assert.match(resultSource, /完成任务并清空当前原文和结果/);
assert.match(resultSource, /allActionsComplete \? '完成并返回' : '清空并返回'/);
assert.match(resultSource, /new-capture-button--complete/);
assert.match(cssSource, /\.action-progress\.is-complete/);
assert.match(cssSource, /\.summary-meta > \.summary-reply-status\.is-complete/);
assert.match(cssSource, /\.new-capture-button--complete:focus-visible/);

console.log('Task closure checks passed.');
