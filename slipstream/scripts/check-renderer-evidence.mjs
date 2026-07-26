import assert from 'node:assert/strict';
import {
  buildActionGroups,
  buildEvidenceCatalog,
  catalogEntriesFor,
  getEvidenceResultRoute,
  getHeadline,
} from '../src/renderer/utils/evidenceMapping.mjs';

function evidenceFor(sourceText, quote) {
  const start = sourceText.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote is missing: ${quote}`);
  return { quote, start, end: start + quote.length, match: 'exact', ambiguous: false };
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
