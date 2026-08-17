const {
  createTaskReviewPlan,
  finalizeTaskReview,
} = require('../src/main/analysis/task-review');

function createFixtureTaskReview(sourceText, candidate, options = {}) {
  const plan = createTaskReviewPlan({ sourceText, rawOutput: candidate });
  if (!plan) return null;

  const requestedSteps = new Set(
    options.acceptedStepIndices
      ?? plan.payload.claims.nextSteps.map((claim) => claim.index),
  );
  const acceptedNextSteps = plan.payload.claims.nextSteps.flatMap((claim) => {
    const step = candidate?.nextSteps?.[claim.index];
    const eligible = step?.actor === 'user' && (
      step?.mandatory === true
      || (step?.mandatory === false && step?.urgency === 'when_triggered')
    );
    return requestedSteps.has(claim.index) && eligible && claim.evidenceQuotes?.[0]
      ? [{
        index: claim.index,
        kind: step.mandatory === false ? 'conditional' : 'required',
        action: step.action,
        condition: step.mandatory === false ? step.action : null,
        prerequisiteStepIndices: Array.isArray(step.prerequisiteStepIndices)
          ? step.prerequisiteStepIndices
          : [],
        requirementEvidenceQuote: claim.evidenceQuotes[0],
      }]
      : [];
  });
  const firstAcceptedStep = acceptedNextSteps[0]?.index;
  const firstAcceptedStepClaim = plan.payload.claims.nextSteps.find(
    (claim) => claim.index === firstAcceptedStep,
  );

  const acceptLinkedClaims = (claims, requestedIndices, kind) => {
    if (firstAcceptedStep === undefined) return [];
    const requested = new Set(requestedIndices ?? claims.map((claim) => claim.index));
    return claims.flatMap((claim) => {
      const requirementEvidenceQuote = evidenceCoveringClaims(
        sourceText,
        claim,
        firstAcceptedStepClaim,
      );
      if (!requested.has(claim.index) || !requirementEvidenceQuote) return [];
      const candidateItem = candidate?.[kind === 'material' ? 'materials' : 'deadlines']?.[claim.index];
      return [{
          index: claim.index,
          ...(kind === 'material'
            ? {
              name: candidateItem?.name,
              details: candidateItem?.details ?? null,
            }
            : {
              whenText: candidateItem?.whenText,
              calendarDate: candidateItem?.calendarDate ?? null,
              normalizedAt: candidateItem?.normalizedAt ?? null,
              timezone: candidateItem?.timezone ?? null,
              condition: candidateItem?.condition ?? null,
            }),
          nextStepIndices: [firstAcceptedStep],
          requirementEvidenceQuote,
        }];
    });
  };

  const review = finalizeTaskReview({
    plan,
    rawOutput: JSON.stringify({
      schemaVersion: 'action-brief.task-review.v1',
      acceptedNextSteps,
      acceptedMaterials: acceptLinkedClaims(
        plan.payload.claims.materials,
        options.acceptedMaterialIndices,
        'material',
      ),
      acceptedDeadlines: acceptLinkedClaims(
        plan.payload.claims.deadlines,
        options.acceptedDeadlineIndices,
        'deadline',
      ),
    }),
  });
  if (review?.status !== 'complete') {
    throw new Error(`invalid fixture task review: ${review?.reason || 'unknown'}`);
  }
  return review;
}

function evidenceCoveringClaims(sourceText, ...claims) {
  const ranges = claims.flatMap((claim) => (claim?.evidenceQuotes || []).slice(0, 1).flatMap((quote) => {
    const start = sourceText.indexOf(quote);
    return start === -1 ? [] : [{ start, end: start + quote.length }];
  }));
  if (ranges.length !== claims.length) return null;
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  return end - start <= 2000 ? sourceText.slice(start, end) : null;
}

module.exports = { createFixtureTaskReview };
