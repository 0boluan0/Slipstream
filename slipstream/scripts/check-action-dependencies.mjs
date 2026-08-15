import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildActionGroups,
  composeActionChecklistText,
} from '../src/renderer/utils/evidenceMapping.mjs';

const require = createRequire(import.meta.url);
const { analyzeModelOutput, buildActionBriefPrompt } = require('../src/main/analysis');
const { validateActionBrief } = require('../src/shared/action-brief.cjs');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const sourceText = [
  'Please generate the eVisa share code before you submit the documents.',
  'Submit the passport scan and share code by 28 July 2026.',
  'Please reply after you have submitted them.',
].join(' ');

function candidateWith(nextSteps) {
  return {
    schemaVersion: 'action-brief.candidate.v1',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translation: {
      text: '请先生成 eVisa share code，再于 2026 年 7 月 28 日前提交护照扫描件和 share code，提交后回复。',
      provenance: 'inference',
      evidenceQuotes: [],
      citationIds: [],
      confidence: 0.98,
    },
    explanation: {
      text: '先生成 share code，再提交材料，最后回复确认。',
      provenance: 'inference',
      evidenceQuotes: [
        'Please generate the eVisa share code before you submit the documents.',
        'Please reply after you have submitted them.',
      ],
      citationIds: [],
      confidence: 0.96,
    },
    terms: [],
    contexts: [],
    deadlines: [{
      whenText: '28 July 2026',
      calendarDate: '2026-07-28',
      normalizedAt: null,
      timezone: null,
      condition: 'Submit the passport scan and share code by this date.',
      provenance: 'original',
      evidenceQuotes: ['28 July 2026'],
      citationIds: [],
      confidence: 1,
    }],
    materials: [],
    nextSteps,
    verifications: [],
    warnings: [],
  };
}

const outOfOrderCandidate = candidateWith([
  {
    action: '在 2026 年 7 月 28 日前提交护照扫描件与 share code',
    actor: 'user',
    urgency: 'before_deadline',
    mandatory: true,
    deadlineIndex: 0,
    prerequisiteStepIndices: [1],
    provenance: 'inference',
    evidenceQuotes: ['Submit the passport scan and share code by 28 July 2026.'],
    citationIds: [],
    confidence: 0.96,
  },
  {
    action: '生成 eVisa share code',
    actor: 'user',
    urgency: 'now',
    mandatory: true,
    deadlineIndex: null,
    prerequisiteStepIndices: [],
    provenance: 'inference',
    evidenceQuotes: ['Please generate the eVisa share code before you submit the documents.'],
    citationIds: [],
    confidence: 0.97,
  },
  {
    action: '提交后回复确认',
    actor: 'user',
    urgency: 'when_triggered',
    mandatory: true,
    deadlineIndex: null,
    prerequisiteStepIndices: [0],
    provenance: 'inference',
    evidenceQuotes: ['Please reply after you have submitted them.'],
    citationIds: [],
    confidence: 0.96,
  },
]);

const brief = analyzeModelOutput({
  sourceText,
  rawOutput: outOfOrderCandidate,
  provider: 'deepseek',
  model: 'dependency-test',
  generatedAt: '2026-07-27T12:00:00.000Z',
});

assert.equal(brief.status, 'complete');
assert.deepEqual(
  brief.nextSteps.map((step) => step.action),
  ['生成 eVisa share code', '在 2026 年 7 月 28 日前提交护照扫描件与 share code', '提交后回复确认'],
);
const generateStep = brief.nextSteps[0];
const submitStep = brief.nextSteps[1];
const replyStep = brief.nextSteps[2];
assert.deepEqual(generateStep.prerequisiteStepIds, []);
assert.deepEqual(submitStep.prerequisiteStepIds, [generateStep.id]);
assert.deepEqual(replyStep.prerequisiteStepIds, [submitStep.id]);
assert.deepEqual(validateActionBrief(brief, { sourceText }), { valid: true, errors: [] });

const groups = buildActionGroups(brief, []);
assert.deepEqual(groups[1].prerequisiteStepNumbers, [1]);
assert.deepEqual(groups[2].prerequisiteStepNumbers, [2]);
const copiedChecklist = composeActionChecklistText(brief, { completedActionIds: [] });
assert.match(copiedChecklist, /2\. \[待完成\].*先完成第 1 项/);
assert.match(copiedChecklist, /3\. \[待完成\].*先完成第 2 项/);

const forgedMissingDependency = structuredClone(brief);
forgedMissingDependency.nextSteps[1].prerequisiteStepIds = ['missing-step'];
assert.equal(validateActionBrief(forgedMissingDependency, { sourceText }).valid, false);

const forgedCycle = structuredClone(brief);
forgedCycle.nextSteps[0].prerequisiteStepIds = [forgedCycle.nextSteps[1].id];
assert.equal(validateActionBrief(forgedCycle, { sourceText }).valid, false);

const forgedDuplicateId = structuredClone(brief);
forgedDuplicateId.nextSteps[1].id = forgedDuplicateId.nextSteps[0].id;
assert.equal(validateActionBrief(forgedDuplicateId, { sourceText }).valid, false);

const cyclicCandidate = structuredClone(outOfOrderCandidate);
cyclicCandidate.nextSteps[1].prerequisiteStepIndices = [0];
const cycleSafeBrief = analyzeModelOutput({
  sourceText,
  rawOutput: cyclicCandidate,
  generatedAt: '2026-07-27T12:00:00.000Z',
});
assert.equal(cycleSafeBrief.status, 'partial');
assert(cycleSafeBrief.nextSteps.every((step) => step.prerequisiteStepIds.length === 0));
assert(cycleSafeBrief.warnings.some((warning) => warning.code === 'CYCLIC_STEP_DEPENDENCIES_DROPPED'));
assert.equal(validateActionBrief(cycleSafeBrief, { sourceText }).valid, true);

const missingReferenceCandidate = structuredClone(outOfOrderCandidate);
missingReferenceCandidate.nextSteps[0].prerequisiteStepIndices = [99];
const missingReferenceBrief = analyzeModelOutput({
  sourceText,
  rawOutput: missingReferenceCandidate,
  generatedAt: '2026-07-27T12:00:00.000Z',
});
assert.equal(missingReferenceBrief.status, 'partial');
assert.deepEqual(missingReferenceBrief.nextSteps.find((step) => step.action.startsWith('在 2026')).prerequisiteStepIds, []);
assert(missingReferenceBrief.warnings.some((warning) => warning.code === 'INVALID_STEP_DEPENDENCY_REFERENCE'));

const prompt = buildActionBriefPrompt(sourceText).userMessage;
assert.match(prompt, /prerequisiteStepIndices/);
assert.match(prompt, /executable order/);
assert.match(prompt, /Do not bundle an item/);

const resultSource = readSource('src/renderer/components/ResultDisplay.jsx');
const cssSource = readSource('src/renderer/App.css');
assert.match(resultSource, /建议顺序：先完成第/);
assert.match(resultSource, /前置步骤已标记完成/);
assert.match(resultSource, /进度需核对：第/);
assert.match(cssSource, /\.action-group__dependency/);
assert.match(cssSource, /\.action-group__dependency\.has-progress-conflict/);

console.log('Action dependency ordering and presentation checks passed.');
