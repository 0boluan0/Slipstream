const {
  createTaskReviewPlan,
  finalizeTaskReview,
} = require('../src/main/analysis/task-review');

function createFixtureTaskReview(sourceText, candidate, options = {}) {
  const plan = createTaskReviewPlan({ sourceText, rawOutput: candidate });
  if (!plan) return null;

  const reviewOutput = createFixtureTaskReviewOutputForPlan(sourceText, candidate, plan, options);
  const review = finalizeTaskReview({
    plan,
    rawOutput: JSON.stringify(reviewOutput),
  });
  if (review?.status !== 'complete') {
    throw new Error(`invalid fixture task review: ${review?.reason || 'unknown'}`);
  }
  return review;
}

function createFixtureTaskReviewOutput(sourceText, candidate, options = {}) {
  const plan = createTaskReviewPlan({ sourceText, rawOutput: candidate });
  return plan ? createFixtureTaskReviewOutputForPlan(sourceText, candidate, plan, options) : null;
}

function createFixtureTaskReviewOutputForPlan(sourceText, candidate, plan, options) {
  const requestedSteps = new Set(
    options.acceptedStepIndices
      ?? plan.payload.claims.nextSteps.map((_, index) => index),
  );
  const acceptedNextSteps = plan.payload.claims.nextSteps.flatMap((claim, index) => {
    const step = candidate?.nextSteps?.[index];
    const eligible = step?.actor === 'user' && (
      step?.mandatory === true
      || (step?.mandatory === false && step?.urgency === 'when_triggered')
    );
    return requestedSteps.has(index) && eligible && claim.evidenceQuotes?.[0]
      ? [{
        claimId: claim.claimId,
        kind: step.mandatory === false ? 'conditional' : 'required',
        action: step.action,
        condition: step.mandatory === false ? step.action : null,
        prerequisiteStepClaimIds: Array.isArray(step.prerequisiteStepIndices)
          ? step.prerequisiteStepIndices.map((stepIndex) => (
            plan.payload.claims.nextSteps[stepIndex]?.claimId ?? `unknown-step-${stepIndex}`
          ))
          : [],
        requirementEvidenceQuote: claim.evidenceQuotes[0],
      }]
      : [];
  });
  const firstAcceptedStepClaimId = acceptedNextSteps[0]?.claimId;
  const firstAcceptedStepClaim = plan.payload.claims.nextSteps.find(
    (claim) => claim.claimId === firstAcceptedStepClaimId,
  );

  const acceptLinkedClaims = (claims, requestedIndices, kind) => {
    if (!firstAcceptedStepClaimId) return [];
    const requested = new Set(requestedIndices ?? claims.map((_, index) => index));
    return claims.flatMap((claim, index) => {
      const requirementEvidenceQuote = evidenceCoveringClaims(
        sourceText,
        claim,
        firstAcceptedStepClaim,
      );
      if (!requested.has(index) || !requirementEvidenceQuote) return [];
      const candidateItem = candidate?.[kind === 'material' ? 'materials' : 'deadlines']?.[index];
      return [{
        claimId: claim.claimId,
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
        nextStepClaimIds: [firstAcceptedStepClaimId],
        requirementEvidenceQuote,
      }];
    });
  };

  return {
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
  };
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

module.exports = { createFixtureTaskReview, createFixtureTaskReviewOutput };
