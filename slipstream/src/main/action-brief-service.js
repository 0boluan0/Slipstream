const { createHash, timingSafeEqual } = require('node:crypto');

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
const MAX_RETRIEVALS_PER_VERIFICATION = 6;

async function createActionBrief({
  sourceText,
  rawOutput,
  backend,
  model,
  processingTimeMs,
  processingLocation = 'unknown',
  captureEnvelope,
  verificationPolicy,
  verificationApproved = false,
  verificationApprovalId = null,
  verificationDependencies,
  signal,
  taskReview = null,
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
      taskReview,
    });
  if (brief?.analysisProvenance) {
    brief.analysisProvenance.processingLocation = processingLocation;
  }
  preserveCaptureWarnings(brief, captureEnvelope, sourceText);

  return applyVerificationToBrief({
    sourceText,
    brief,
    verificationPolicy,
    verificationApproved,
    verificationApprovalId,
    verificationDependencies,
    signal,
  });
}

async function applyVerificationToBrief({
  sourceText,
  brief,
  verificationPolicy,
  verificationApproved = false,
  verificationApprovalId = null,
  verificationDependencies,
  signal,
}) {
  const policy = normalizeVerificationPolicy(verificationPolicy);
  const eligible = brief.verifications
    .filter((item) => ['pending', 'retrieved', 'failed'].includes(item?.status) && item?.lookup)
    .slice(0, MAX_VERIFICATIONS_PER_RUN);
  const approvalId = policy === VERIFICATION_POLICIES.ASK && eligible.length
    ? createVerificationApprovalId(eligible)
    : null;
  const approvalMatches = verificationApproved === true &&
    matchesVerificationApprovalId(verificationApprovalId, approvalId);

  if (eligible.length === 0 || policy === VERIFICATION_POLICIES.LOCAL_ONLY ||
      (policy === VERIFICATION_POLICIES.ASK && !approvalMatches)) {
    return {
      brief: assertActionBrief(brief, { sourceText }),
      verificationSummary: createVerificationSummary(policy, false, eligible.length, 0, approvalId),
    };
  }

  const outcomes = await Promise.all(eligible.map(async (item) => {
    try {
      const response = await verifyOfficialSources({
        ...item.lookup,
        claim: item.claim,
        policy,
        approved: policy === VERIFICATION_POLICIES.ASK ? approvalMatches : verificationApproved === true,
        signal,
      }, verificationDependencies);
      return { item, response };
    } catch (error) {
      if (isAborted(error, signal)) throw error;
      return { item, error };
    }
  }));

  if (signal?.aborted) throw createAbortError();
  const fetchAttempted = outcomes.some((outcome) => outcome.response?.fetchAttempted === true);
  let verifiedCount = 0;
  for (const outcome of outcomes) {
    const item = outcome.item;
    if (outcome.error) {
      if (item.retrievals.length > 0) {
        item.status = 'retrieved';
        item.provenance.note = '已保留之前读取的官方页面，但本次核验请求失败，主张仍未确认。';
      } else {
        item.status = 'failed';
        item.provenance.note = '官方来源核验请求失败，未把该主张当作事实。';
      }
      continue;
    }
    const retrievals = mergeRetrievals(
      item.retrievals,
      collectRetrievals(outcome.response.results, item.lookup.publisher),
    );
    const verified = outcome.response.results.find((result) =>
      result.status === VERIFICATION_STATUSES.VERIFIED &&
      typeof result.url === 'string' &&
      typeof result.retrievedAt === 'string' &&
      typeof result.excerpt === 'string' && result.excerpt.trim()
    );
    if (!verified) {
      if (retrievals.length > 0) {
        item.status = 'retrieved';
        item.retrievals = retrievals;
        item.provenance.note = '已读取候选官方页面，但页面收据本身不证明该主张；主张仍待确认。';
        continue;
      }
      const attempted = outcome.response.fetchAttempted === true;
      item.status = attempted ? 'failed' : 'pending';
      item.provenance.note = attempted
        ? '已访问候选来源，但没有找到足以支持该主张的官方证据。'
        : '尚未访问候选官方来源。';
      continue;
    }

    verifiedCount += 1;
    const verifiedLookup = item.lookup;
    item.status = 'verified';
    item.lookup = null;
    item.retrievals = retrievals;
    item.provenance = {
      ...item.provenance,
      kind: 'official',
      note: '该核验项由实际读取的官方页面支持。',
      citations: [{
        id: `official-${verifiedCount}`,
        url: verified.url,
        title: verified.title || verified.publisher || new URL(verified.url).hostname,
        publisher: verified.publisher || verifiedLookup.publisher,
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
    verificationSummary: createVerificationSummary(
      policy,
      fetchAttempted,
      eligible.length,
      verifiedCount,
      approvalId,
    ),
  };
}

async function verifyExistingActionBrief({
  sourceText,
  brief,
  verificationPolicy,
  verificationApproved = false,
  verificationApprovalId = null,
  verificationDependencies,
  signal,
}) {
  const clonedBrief = cloneCanonicalBriefForSource(brief, sourceText);
  return applyVerificationToBrief({
    sourceText,
    brief: clonedBrief,
    verificationPolicy,
    verificationApproved,
    verificationApprovalId,
    verificationDependencies,
    signal,
  });
}

function stripFreeTranslationNotice(value) {
  return String(value || '')
    .replace(/\n\n---\n免费翻译仅提供翻译；配置 LLM API Key 后可获得术语解释。\s*$/, '')
    .trim();
}

function preserveCaptureWarnings(brief, captureEnvelope, sourceText) {
  if (captureEnvelope?.truncated !== true) return;
  const retainedLength = typeof sourceText === 'string' ? sourceText.length : 0;
  const originalLength = Number.isSafeInteger(captureEnvelope.originalLength)
    ? Math.max(captureEnvelope.originalLength, retainedLength)
    : retainedLength;
  if (!brief.warnings.some((warning) => warning?.code === 'SOURCE_TRUNCATED')) {
    brief.warnings.push({
      code: 'SOURCE_TRUNCATED',
      message: `原始文本共 ${originalLength} 个字符，本次仅处理前 ${retainedLength} 个字符。`,
      originalLength,
      retainedLength,
    });
  }
  if (brief.status === 'complete') brief.status = 'partial';
}

function cloneCanonicalBriefForSource(brief, sourceText) {
  let clonedBrief;
  try {
    clonedBrief = JSON.parse(JSON.stringify(brief));
  } catch {
    throw new TypeError('brief must be JSON-serializable');
  }
  assertActionBrief(clonedBrief, { sourceText });
  const expectedSourceHash = createHash('sha256').update(sourceText, 'utf8').digest('hex');
  if (clonedBrief.source.sha256 !== expectedSourceHash) {
    const error = new Error('brief source hash does not match sourceText');
    error.code = 'source-mismatch';
    throw error;
  }
  return clonedBrief;
}

function hasPendingOrFailedClaims(brief) {
  return brief.verifications.some((item) =>
    item.status === 'pending' || item.status === 'retrieved' || item.status === 'failed'
  );
}

function collectRetrievals(results, fallbackPublisher) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((result) =>
      [VERIFICATION_STATUSES.RETRIEVED, VERIFICATION_STATUSES.VERIFIED].includes(result?.status) &&
      result.reason !== 'untrusted-host' &&
      typeof result.url === 'string' &&
      typeof result.retrievedAt === 'string' &&
      typeof result.excerpt === 'string' &&
      result.excerpt.trim()
    )
    .map((result) => ({
      publisher: result.publisher || fallbackPublisher,
      url: result.url,
      retrievedAt: result.retrievedAt,
      excerpt: result.excerpt,
      official: true,
    }));
}

function mergeRetrievals(existing, received) {
  const unique = [];
  const seen = new Set();
  for (const retrieval of [...(Array.isArray(existing) ? existing : []), ...received]) {
    const key = `${retrieval.url}\n${retrieval.retrievedAt}\n${retrieval.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(retrieval);
  }
  return unique.slice(-MAX_RETRIEVALS_PER_VERIFICATION).map((retrieval, index) => ({
    id: `retrieval-${index + 1}`,
    publisher: retrieval.publisher,
    url: retrieval.url,
    retrievedAt: retrieval.retrievedAt,
    excerpt: retrieval.excerpt,
    official: true,
  }));
}

function createVerificationApprovalId(verifications) {
  const plan = Array.isArray(verifications)
    ? verifications.map((item) => ({
      claim: typeof item?.claim === 'string' ? item.claim : '',
      publisher: typeof item?.lookup?.publisher === 'string' ? item.lookup.publisher : '',
      query: typeof item?.lookup?.query === 'string' ? item.lookup.query : '',
      candidateUrls: Array.isArray(item?.lookup?.candidateUrls) ? [...item.lookup.candidateUrls] : [],
    }))
    : [];
  return createHash('sha256').update(JSON.stringify(plan), 'utf8').digest('hex');
}

function matchesVerificationApprovalId(candidate, expected) {
  if (!/^[a-f0-9]{64}$/.test(candidate || '') || !/^[a-f0-9]{64}$/.test(expected || '')) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
}

function createAbortError() {
  const error = new Error('official source verification was cancelled');
  error.name = 'AbortError';
  error.code = 'aborted';
  return error;
}

function isAborted(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.code === 'aborted' ||
    error?.code === 'ABORT_ERR' ||
    error?.name === 'AbortError'
  );
}

function createVerificationSummary(policy, fetchAttempted, requestedCount, verifiedCount, approvalId = null) {
  return {
    policy,
    fetchAttempted,
    requestedCount,
    verifiedCount,
    ...(approvalId ? { approvalId } : {}),
  };
}

module.exports = {
  MAX_VERIFICATIONS_PER_RUN,
  createActionBrief,
  createVerificationApprovalId,
  preserveCaptureWarnings,
  stripFreeTranslationNotice,
  verifyExistingActionBrief,
};
