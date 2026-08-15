import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeActionChecklistText } from '../src/renderer/utils/evidenceMapping.mjs';
import {
  createClearedSessionSnapshot,
  prepareClearedSessionRestore,
} from '../src/renderer/utils/clearedSession.mjs';
import {
  createSessionRecoveryRecord,
  prepareSessionRecoveryRestore,
} from '../src/renderer/utils/sessionRecovery.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const brief = {
  status: 'actionable',
  deadlines: [],
  materials: [],
  nextSteps: [
    { id: 'prepare', action: '准备护照信息页', mandatory: true },
    { id: 'submit', action: '提交材料', mandatory: true },
  ],
  warnings: [],
};

const legacyChecklist = composeActionChecklistText(brief);
assert.doesNotMatch(legacyChecklist, /\[已完成\]|\[待完成\]/);

const pendingChecklist = composeActionChecklistText(brief, { completedActionIds: [] });
assert.match(pendingChecklist, /1\. \[待完成\] 准备护照信息页/);
assert.match(pendingChecklist, /2\. \[待完成\] 提交材料/);

const mixedChecklist = composeActionChecklistText(brief, { completedActionIds: ['submit'] });
assert.match(mixedChecklist, /1\. \[待完成\] 准备护照信息页/);
assert.match(mixedChecklist, /2\. \[已完成\] 提交材料/);

const lastGood = {
  inputText: 'Please prepare and submit the documents.',
  processedSourceText: 'Please prepare and submit the documents.',
  brief,
  result: '',
  completedActionIds: ['submit'],
};
const cleared = createClearedSessionSnapshot({
  ...lastGood,
  status: 'done',
  lastGood,
  completedActionIds: ['submit'],
});
assert.deepEqual(prepareClearedSessionRestore(cleared).completedActionIds, ['submit']);

const recovery = createSessionRecoveryRecord({
  ...lastGood,
  status: 'done',
  lastGood,
  completedActionIds: ['submit', 'submit', '', 42, 'x'.repeat(201)],
}, 2_000_000_000_000);
assert.deepEqual(recovery.payload.completedActionIds, ['submit']);
assert.deepEqual(recovery.payload.lastGood.completedActionIds, ['submit']);
assert.deepEqual(prepareSessionRecoveryRestore(recovery).completedActionIds, ['submit']);

const resultSource = readSource('src/renderer/components/ResultDisplay.jsx');
const panelSource = readSource('src/renderer/components/FloatingPanel.jsx');
const cssSource = readSource('src/renderer/App.css');

assert.match(resultSource, /你已标记 \$\{completedActionCount\} \/ \$\{actionGroups\.length\} 项完成/);
assert.match(resultSource, /你已标记全部 \$\{actionGroups\.length\} 项完成/);
assert.match(resultSource, /不代表 Slipstream 已验证现实进度/);
assert.match(resultSource, /type="checkbox"/);
assert.match(resultSource, /checked=\{isComplete\}/);
assert.match(resultSource, /onToggleActionCompletion\?\.\(actionId\)/);
assert.match(resultSource, /completedActionIds: \[\.\.\.completedActionIdSet\]/);
assert.match(resultSource, /查看原文依据 · \$\{group\.evidence\.length\} 条/);
assert.match(resultSource, /aria-expanded=\{completedEvidenceExpanded\}/);
assert.match(resultSource, /aria-controls=\{evidenceRegionId\}/);
assert.match(resultSource, /hidden=\{canCollapseCompletedEvidence && !completedEvidenceExpanded\}/);
assert.match(resultSource, /setExpandedCompletedActionIds\(\(current\) => current\.filter/);
assert.match(resultSource, /回复状态仍请按现实进度选择/);
assert.match(panelSource, /const \[completedActionIds, setCompletedActionIds\] = useState\(\[\]\)/);
assert.match(panelSource, /completedActionIds: next/);
assert.match(panelSource, /setCompletedActionIds\(restored\.completedActionIds/);
assert.match(panelSource, /completedActionIds=\{completedActionIds\}/);
assert.match(cssSource, /\.action-completion-toggle:focus-within/);
assert.match(cssSource, /accent-color: var\(--accent\)/);
const completedFocusStart = cssSource.indexOf('.completed-evidence-toggle:focus-visible {');
const completedFocusEnd = cssSource.indexOf('}', completedFocusStart);
assert.ok(completedFocusStart >= 0 && completedFocusEnd > completedFocusStart);
const completedFocusRule = cssSource.slice(completedFocusStart, completedFocusEnd + 1);
assert.match(completedFocusRule, /outline:\s*3px solid var\(--focus-ring\);/u);
assert.match(completedFocusRule, /outline-offset:\s*2px;/u);
assert.doesNotMatch(completedFocusRule, /outline:\s*none/u,
  'completed-evidence focus must not rely on a box shadow that Increase Contrast removes');
const increasedContrastStart = cssSource.indexOf('@media (prefers-contrast: more)');
const forcedColorsStart = cssSource.indexOf('@media (forced-colors: active)', increasedContrastStart);
assert.ok(increasedContrastStart >= 0 && forcedColorsStart > increasedContrastStart);
const increasedContrastCss = cssSource.slice(increasedContrastStart, forcedColorsStart);
assert.match(
  increasedContrastCss,
  /\.completed-evidence-toggle:focus-visible\s*\{\s*outline:\s*3px solid var\(--focus-ring\);\s*outline-offset:\s*2px;/u,
  'Increase Contrast must retain a non-shadow focus perimeter for completed evidence',
);
const forcedColorsCss = cssSource.slice(forcedColorsStart);
assert.match(
  forcedColorsCss,
  /\.completed-evidence-toggle:focus-visible\s*\{\s*outline:\s*3px solid Highlight !important;\s*outline-offset:\s*2px !important;/u,
  'forced colors must draw completed-evidence focus with the system highlight color',
);
assert.match(cssSource, /\.action-group\.is-evidence-collapsed \.action-group__heading/);
assert.match(cssSource, /\.evidence-list\[hidden\]/);

console.log('Action progress checks passed.');
