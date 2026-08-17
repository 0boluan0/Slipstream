import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildReplyDraft,
  buildActionGroups,
  buildEvidenceCatalog,
  catalogEntriesFor,
  composeActionChecklistText,
  composeCompleteResultText,
  composeReplyDraft,
  getEvidenceResultRoute,
  getHeadline,
  getTaskReviewFailureCode,
} from '../src/renderer/utils/evidenceMapping.mjs';

function evidenceFor(sourceText, quote) {
  const start = sourceText.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { quote, start, end: start + quote.length, match: 'exact', ambiguous: false };
}

{
  const brief = briefWith({
    materials: [{ id: 'conditional-form', name: '修正表格', requirement: 'conditional', provenance: { evidence: [] } }],
    nextSteps: [{
      id: 'reply',
      action: '完成后回复确认',
      actor: 'user',
      mandatory: true,
      urgency: 'now',
      provenance: { evidence: [] },
    }, {
      id: 'conditional-upload',
      action: '如果被拒，上传修正后的表格',
      actor: 'user',
      mandatory: false,
      urgency: 'when_triggered',
      provenance: { evidence: [] },
    }],
  });
  const model = buildReplyDraft(brief);
  assert.equal(model.hasMaterials, false,
    'conditional materials must not be claimed as already provided in a completion reply');
  assert.deepEqual(model.requiredCompletionActionIds, [],
    'a conditional action must not be treated as a currently required completion fact');
  const completedDraft = composeReplyDraft(model, { completionStatus: 'completed' });
  assert.match(completedDraft, /completed the currently required steps/);
  assert.doesNotMatch(
    completedDraft,
    /provided the requested materials/,
  );
}

function provenance(sourceText, kind, ...quotes) {
  return {
    kind,
    confidence: 0.99,
    note: null,
    evidence: quotes.map((quote) => evidenceFor(sourceText, quote)),
    citations: [],
  };
}

function briefWith(overrides = {}) {
  return {
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    ...overrides,
  };
}

const resultSource = fs.readFileSync(
  new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url),
  'utf8',
);
assert.match(resultSource, /点击任意彩色原文，右侧会跳到并展开对应结论/,
  'the result must directly teach source-to-conclusion evidence navigation');
assert.match(resultSource, /未识别到需要继续完成的行动/,
  'a complete zero-action analysis must not be mislabeled as basic translation');
assert.match(resultSource, /行动复核失败，请重试/,
  'a failed task review must not masquerade as a successful zero-action analysis');
assert.match(resultSource, /taskReviewFailureCode === 'TASK_REVIEW_TIMEOUT'/,
  'a task-review timeout must retain retry-specific empty-state copy');
assert.match(resultSource, /base\.nextSteps\.filter\(isUserActionStep\)/,
  'every result consumer must receive the same user-action-only step list');

{
  const brief = briefWith({
    materials: [{ id: 'receipt', name: 'digital receipt', provenance: { evidence: [] } }],
    deadlines: [{ id: 'submitted-at', whenText: '14 August 2026', provenance: { evidence: [] } }],
    nextSteps: [
      { id: 'optional', action: '保存副本', actor: 'user', mandatory: false, urgency: 'now' },
      { id: 'institution', action: '学校审核材料', actor: 'institution', mandatory: true, urgency: 'now' },
    ],
  });
  assert.deepEqual(buildActionGroups(brief, []), [],
    'materials and dates must not be synthesized into user actions');
}

{
  const sourceText = 'Reply to confirm receipt. You can save a copy. The university will review the form.';
  const brief = briefWith({
    nextSteps: [
      { id: 'reply', action: '回复确认收到', actor: 'user', mandatory: true, urgency: 'now', provenance: provenance(sourceText, 'original', 'Reply to confirm receipt.') },
      { id: 'optional', action: '保存副本', actor: 'user', mandatory: false, urgency: 'now', provenance: provenance(sourceText, 'inference', 'You can save a copy.') },
      { id: 'institution', action: '学校审核表格', actor: 'institution', mandatory: true, urgency: 'now', provenance: provenance(sourceText, 'original', 'The university will review the form.') },
    ],
  });
  const catalog = buildEvidenceCatalog(brief, sourceText);
  assert.deepEqual(buildActionGroups(brief, catalog).map((group) => group.id), ['reply']);
  assert.deepEqual(catalog.map((entry) => entry.quote), ['Reply to confirm receipt.']);
  assert.doesNotMatch(composeActionChecklistText(brief), /保存副本|学校审核表格/);
  assert.doesNotMatch(composeCompleteResultText(brief), /保存副本|学校审核表格/);
  assert.deepEqual(buildReplyDraft(brief).facts.map((fact) => fact.value), ['Reply to confirm receipt.']);
}

{
  const sourceText = 'Your file was successfully submitted. Your receipt can be downloaded.';
  const brief = briefWith({
    explanation: {
      text: '保存或下载收据',
      provenance: provenance(sourceText, 'inference', 'Your receipt can be downloaded.'),
    },
    nextSteps: [{
      id: 'optional-receipt',
      action: '下载收据',
      actor: 'user',
      mandatory: false,
      urgency: 'now',
      provenance: provenance(sourceText, 'inference', 'Your receipt can be downloaded.'),
    }],
  });
  assert.equal(
    getHeadline(brief, sourceText),
    '未识别到需要继续完成的行动',
    'an explanation or optional capability must not reappear as the zero-action headline',
  );

  const timedOutBrief = briefWith({
    warnings: [{ code: 'TASK_REVIEW_TIMEOUT', message: '行动复核超时，请重试。' }],
  });
  assert.equal(getTaskReviewFailureCode(timedOutBrief), 'TASK_REVIEW_TIMEOUT');
  assert.equal(
    getHeadline(timedOutBrief, sourceText),
    '行动复核失败，请重试',
    'a review timeout must not be presented as evidence that no action exists',
  );
}

{
  const sourceText = [
    'Submit the form now.',
    'A background-check process is used.',
    'Deadline: Friday.',
  ].join('\n');
  const deadline = {
    id: 'deadline-friday',
    whenText: 'Friday',
    condition: 'The form must arrive by Friday.',
    provenance: provenance(sourceText, 'original', 'Deadline: Friday.'),
  };
  const context = {
    id: 'context-background-check',
    label: '背景核验流程',
    kind: 'institutional_process',
    provenance: provenance(sourceText, 'inference', 'A background-check process is used.'),
  };
  const step = {
    id: 'step-submit',
    action: '提交表格',
    actor: 'user',
    urgency: 'now',
    mandatory: true,
    deadlineId: null,
    provenance: provenance(sourceText, 'original', 'Submit the form now.'),
  };
  const brief = briefWith({ deadlines: [deadline], contexts: [context], nextSteps: [step] });

  assert.equal(
    getHeadline(brief, sourceText),
    '提交表格',
    'an unrelated first deadline and first context must never be synthesized into one headline',
  );

  const catalog = buildEvidenceCatalog(brief, sourceText);
  const deadlineEntries = catalogEntriesFor(deadline, catalog);
  assert.equal(deadlineEntries.length, 1, 'a non-overlapping deadline must retain a result-side target');
  assert.equal(deadlineEntries[0].quote, 'Deadline: Friday.');
  const actionGroups = buildActionGroups(brief, catalog);
  assert.equal(actionGroups[0].evidence[0].quote, 'Submit the form now.');
  const deadlineHighlight = catalog.find((entry) => entry.id === deadlineEntries[0].id);
  const deadlineRoute = getEvidenceResultRoute(deadlineHighlight, brief, actionGroups);
  assert.equal(deadlineRoute.targetKind, 'deadline');
  assert.equal(deadlineRoute.sections.deadlines, true);

  const linkedBrief = briefWith({
    deadlines: [deadline],
    contexts: [context],
    nextSteps: [{ ...step, urgency: 'before_deadline', deadlineId: deadline.id }],
  });
  assert.equal(
    getHeadline(linkedBrief, sourceText),
    'Friday前提交表格',
    'a deadline may modify an action only through an explicit deadlineId relationship',
  );
}

{
  const sourceText = 'A clear scan of your eVisa share code.';
  const term = {
    id: 'term-evisa',
    surface: 'eVisa share code',
    provenance: provenance(sourceText, 'pending', 'eVisa share code'),
  };
  const verification = {
    id: 'verify-evisa',
    claim: 'Confirm how the eVisa share code works.',
    reason: 'The source names the code but does not explain the official process.',
    status: 'pending',
    provenance: provenance(sourceText, 'pending', sourceText),
  };
  const step = {
    id: 'step-evisa',
    action: '准备 eVisa share code',
    actor: 'user',
    urgency: 'now',
    mandatory: true,
    deadlineId: null,
    provenance: provenance(sourceText, 'original', sourceText, 'eVisa share code'),
  };
  const brief = briefWith({ terms: [term], verifications: [verification], nextSteps: [step] });
  const catalog = buildEvidenceCatalog(brief, sourceText);

  assert.equal(catalog.length, 1, 'overlapping ranges should paint one stable source highlight');
  assert.equal(catalog[0].quote, sourceText);
  assert.ok(catalog[0].owners.includes(verification), 'verification claims/reasons must own source anchors');

  const termEntry = catalogEntriesFor(term, catalog)[0];
  const verificationEntry = catalogEntriesFor(verification, catalog)[0];
  assert.equal(termEntry.id, verificationEntry.id, 'overlapping owners should share the visual source id');
  assert.equal(termEntry.quote, 'eVisa share code', 'the term must retain its exact shorter quote');
  assert.equal(verificationEntry.quote, sourceText, 'the verification must retain its exact wider quote');
  assert.notEqual(termEntry.start, verificationEntry.start, 'owner-specific ranges must not be replaced by the merged range');

  const actionEvidence = buildActionGroups(brief, catalog)[0].evidence;
  assert.deepEqual(
    actionEvidence.map((entry) => entry.quote),
    [sourceText, 'eVisa share code'],
    'one owner must retain every distinct exact quote even when they share a source highlight',
  );
  assert.equal(new Set(actionEvidence.map((entry) => entry.id)).size, 1);

  const verificationRoute = getEvidenceResultRoute(catalog[0], brief, buildActionGroups(brief, catalog));
  assert.equal(verificationRoute.targetKind, 'verification', 'a source anchor must route to its verification disclosure');
  assert.equal(verificationRoute.sections.verification, true);
  assert.equal(verificationRoute.sections.terms, true, 'all disclosures sharing the highlight should be opened');
}

console.log('renderer evidence mapping checks passed');
