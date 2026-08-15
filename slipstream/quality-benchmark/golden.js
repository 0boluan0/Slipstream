'use strict';

const { createHash } = require('node:crypto');
const { createEmptyActionBrief } = require('../src/shared/action-brief.cjs');

const GOLDEN_GENERATED_AT = '2099-01-01T00:00:00.000Z';

function evidenceFor(source, quote) {
  const start = source.indexOf(quote);
  if (start === -1) throw new Error(`Golden evidence is absent from case source: ${quote}`);
  return {
    quote,
    start,
    end: start + quote.length,
    match: 'exact',
    ambiguous: source.indexOf(quote, start + 1) !== -1,
  };
}

function provenanceFor(source, quote, kind = 'original') {
  return {
    kind,
    confidence: 1,
    note: null,
    evidence: [evidenceFor(source, quote)],
    citations: [],
  };
}

function buildGoldenBrief(testCase) {
  if (!testCase || typeof testCase !== 'object') throw new TypeError('testCase must be an object');
  const source = testCase.source;
  const expected = testCase.expected;
  if (typeof source !== 'string' || !source.trim() || !expected) {
    throw new TypeError('testCase must contain source and expected');
  }

  const brief = createEmptyActionBrief({
    status: 'complete',
    sourceId: `benchmark:${testCase.id}`,
    sourceSha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    sourceLength: source.length,
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    responseKind: 'structured',
    provider: 'benchmark-golden',
    model: 'deterministic-reference',
    processingTimeMs: 0,
    generatedAt: GOLDEN_GENERATED_AT,
  });

  const wholeSourceProvenance = provenanceFor(source, source, 'inference');
  brief.translation = {
    text: source,
    provenance: wholeSourceProvenance,
  };
  brief.explanation = {
    text: `Synthetic golden action brief for ${testCase.id}. ${source}`,
    provenance: provenanceFor(source, source, 'inference'),
  };

  const deadlineIdByExpectedId = new Map();
  brief.deadlines = expected.deadlines.map((deadline, index) => {
    const id = `deadline-${index + 1}`;
    deadlineIdByExpectedId.set(deadline.id, id);
    return {
      id,
      whenText: deadline.whenAny[0],
      calendarDate: deadline.calendarDate,
      normalizedAt: deadline.normalizedAt,
      timezone: deadline.normalizedAt ? 'UTC' : null,
      condition: deadline.conditionRequired
        ? 'Applies only when the condition stated in the supporting sentence is met.'
        : null,
      provenance: provenanceFor(source, deadline.evidenceAny[0]),
    };
  });

  brief.materials = expected.materials.map((material, index) => ({
    id: `material-${index + 1}`,
    name: material.goldenName,
    requirement: material.requirement,
    details: material.requirement === 'conditional'
      ? 'Required only if the source condition applies.'
      : null,
    provenance: provenanceFor(source, material.evidenceAny[0]),
  }));

  brief.nextSteps = expected.actions.map((action, index) => ({
    id: `step-${index + 1}`,
    action: action.goldenAction,
    actor: action.actor,
    urgency: action.urgency,
    mandatory: action.mandatory,
    deadlineId: action.deadlineRef
      ? deadlineIdByExpectedId.get(action.deadlineRef) || null
      : null,
    prerequisiteStepIds: [],
    provenance: provenanceFor(source, action.evidenceAny[0], 'inference'),
  }));

  return brief;
}

module.exports = {
  GOLDEN_GENERATED_AT,
  buildGoldenBrief,
  evidenceFor,
  provenanceFor,
};
