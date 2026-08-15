const POSITIVE_REPLY_PATTERN = /回复|回信|reply|respond/i;
const NEGATIVE_REPLY_PATTERN = /(?:无需|不用|不必|不要|请勿|无须|可不).{0,10}(?:回复|回信)|(?:回复|回信).{0,8}(?:不是|并非).{0,6}(?:必须|必要)|(?:do not|don['’]?t|no need to|not required to).{0,12}(?:reply|respond)|(?:reply|respond).{0,12}(?:isn['’]?t|is not|not).{0,8}(?:required|necessary)|(?:reply|respond).{0,8}(?:is )?optional/i;

export function findPositiveReplyStep(brief) {
  const steps = Array.isArray(brief?.nextSteps) ? brief.nextSteps : [];
  return steps.find((step) => (
    step?.actor === 'user'
    && step?.mandatory === true
    && POSITIVE_REPLY_PATTERN.test(step?.action || '')
    && !NEGATIVE_REPLY_PATTERN.test(step?.action || '')
  )) || null;
}

export function getReplyRequiredCompletionActionIds(brief, replyStep = findPositiveReplyStep(brief)) {
  if (!replyStep || brief?.status === 'translation_only') return [];
  return (Array.isArray(brief?.nextSteps) ? brief.nextSteps : [])
    .filter((step) => (
      step !== replyStep
      && step?.actor === 'user'
      && step?.mandatory === true
    ))
    .map((step) => step?.id)
    .filter((id) => typeof id === 'string' && id.trim());
}

export function getReplyProgressConsistency(model, completedActionIds = []) {
  const requiredActionIds = Array.isArray(model?.requiredCompletionActionIds)
    ? [...new Set(model.requiredCompletionActionIds.filter((id) => typeof id === 'string' && id.trim()))]
    : [];
  const completed = completedActionIds instanceof Set
    ? completedActionIds
    : new Set(Array.isArray(completedActionIds) ? completedActionIds : []);
  const completedRequiredActionIds = requiredActionIds.filter((id) => completed.has(id));
  const remainingActionIds = requiredActionIds.filter((id) => !completed.has(id));
  return {
    requiredActionIds,
    completedRequiredActionIds,
    remainingActionIds,
    requiredCount: requiredActionIds.length,
    completedCount: completedRequiredActionIds.length,
    isComplete: remainingActionIds.length === 0,
  };
}

export function getReplyProgressConsistencyForBrief(brief, completedActionIds = []) {
  return getReplyProgressConsistency({
    requiredCompletionActionIds: getReplyRequiredCompletionActionIds(brief),
  }, completedActionIds);
}
