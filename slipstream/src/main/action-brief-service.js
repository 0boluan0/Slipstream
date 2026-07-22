const {
  analyzeModelOutput,
  createFallbackBrief,
} = require('./analysis');
const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  normalizeVerificationPolicy,
  verifyOfficialSources,
} = require('./verification');
const { assertActionBrief } = require('../shared/action-brief.cjs');

const MAX_VERIFICATIONS_PER_RUN = 3;

async function createActionBrief({
  sourceText,
  rawOutput,
  backend,
  model,
  processingTimeMs,
  captureEnvelope,
  verificationPolicy,
  verificationApproved = false,
  verificationDependencies,
}) {
  const sourceId = captureEnvelope?.id || null;
  const brief = backend === 'free_translate'
    ? createFallbackBrief({
      sourceText,
      translation: stripFreeTranslationNotice(rawOutput),
      provider: backend,
      model,
      processingTimeMs,
      sourceId,
    })
    : analyzeModelOutput({
      sourceText,
      rawOutput,
      provider: backend,
      model,
      processingTimeMs,
      sourceId,
    });

  const policy = normalizeVerificationPolicy(verificationPolicy);
  const eligible = brief.verifications
    .filter((item) => item?.status === 'pending' && item?.lookup)
    .slice(0, MAX_VERIFICATIONS_PER_RUN);

  if (eligible.length === 0 || policy === VERIFICATION_POLICIES.LOCAL_ONLY ||
      (policy === VERIFICATION_POLICIES.ASK && verificationApproved !== true)) {
    return {
      brief: assertActionBrief(brief, { sourceText }),
      verificationSummary: createVerificationSummary(policy, false, eligible.length, 0),
    };
  }

  const outcomes = await Promise.all(eligible.map(async (item) => {
    try {
      const response = await verifyOfficialSources({
        ...item.lookup,
        policy,
        approved: verificationApproved === true,
      }, verificationDependencies);
      return { item, response };
    } catch (error) {
      return { item, error };
    }
  }));

  let verifiedCount = 0;
  for (const outcome of outcomes) {
    const item = outcome.item;
    if (outcome.error) {
      item.status = 'failed';
      item.provenance.note = '官方来源核验请求失败，未把该主张当作事实。';
      continue;
    }
    const verified = outcome.response.results.find((result) =>
      result.status === VERIFICATION_STATUSES.VERIFIED &&
      typeof result.url === 'string' &&
      typeof result.retrievedAt === 'string' &&
      typeof result.excerpt === 'string' && result.excerpt.trim()
    );
    if (!verified) {
      const attempted = outcome.response.fetchAttempted === true;
      item.status = attempted ? 'failed' : 'pending';
      item.provenance.note = attempted
        ? '已访问候选来源，但没有找到足以支持该主张的官方证据。'
        : '尚未访问候选官方来源。';
      continue;
    }

    verifiedCount += 1;
    item.status = 'verified';
    item.lookup = null;
    item.provenance = {
      ...item.provenance,
      kind: 'official',
      note: '该核验项由实际读取的官方页面支持。',
      citations: [{
        id: `official-${verifiedCount}`,
        url: verified.url,
        title: verified.title || verified.publisher || new URL(verified.url).hostname,
        publisher: verified.publisher || item.lookup.publisher,
        retrievedAt: verified.retrievedAt,
        quote: verified.excerpt,
        official: true,
      }],
    };
  }

  if (brief.verifications.length > MAX_VERIFICATIONS_PER_RUN) {
    brief.warnings.push({
      code: 'VERIFICATION_LIMIT_REACHED',
      message: `本次只核验前 ${MAX_VERIFICATIONS_PER_RUN} 项，其余项目仍为待核验。`,
    });
  }
  brief.status = hasPendingOrFailedClaims(brief) ? 'partial' : brief.status;

  return {
    brief: assertActionBrief(brief, { sourceText }),
    verificationSummary: createVerificationSummary(policy, true, eligible.length, verifiedCount),
  };
}

function stripFreeTranslationNotice(value) {
  return String(value || '')
    .replace(/\n\n---\n免费翻译仅提供翻译；配置 LLM API Key 后可获得术语解释。\s*$/, '')
    .trim();
}

function hasPendingOrFailedClaims(brief) {
  return brief.verifications.some((item) => item.status === 'pending' || item.status === 'failed');
}

function createVerificationSummary(policy, fetchAttempted, requestedCount, verifiedCount) {
  return { policy, fetchAttempted, requestedCount, verifiedCount };
}

module.exports = {
  MAX_VERIFICATIONS_PER_RUN,
  createActionBrief,
  stripFreeTranslationNotice,
};
