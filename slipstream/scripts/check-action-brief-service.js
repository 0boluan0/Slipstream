const assert = require('node:assert/strict');

const {
  createActionBrief,
  verifyExistingActionBrief,
} = require('../src/main/action-brief-service');
const { validateActionBrief } = require('../src/shared/action-brief.cjs');

const SOURCE_TEXT = 'The message asks whether Graduate Route eligibility rules have changed.';
const OFFICIAL_URL = 'https://www.gov.uk/graduate-visa';
const RETRIEVED_AT = '2026-07-23T08:00:00.000Z';
const LOOKUP = Object.freeze({
  publisher: 'GOV.UK',
  query: 'Graduate Route eligibility rules',
  candidateUrls: Object.freeze([OFFICIAL_URL]),
});

function makePendingCandidate() {
  return {
    schemaVersion: 'action-brief.candidate.v1',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translation: {
      text: '这封消息询问毕业生签证路线的资格规则是否有变化。',
      provenance: 'inference',
      evidenceQuotes: [],
      citationIds: [],
      confidence: 0.9,
    },
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [
      {
        claim: 'Graduate Route eligibility rules are current',
        reason: 'The message does not contain the current official policy.',
        status: 'pending',
        provenance: 'pending',
        lookup: {
          publisher: LOOKUP.publisher,
          query: LOOKUP.query,
          candidateUrls: [...LOOKUP.candidateUrls],
        },
        evidenceQuotes: ['Graduate Route eligibility rules'],
        citationIds: [],
        confidence: null,
      },
    ],
    warnings: [],
  };
}

function makeDiscoveryCandidate() {
  const candidate = makePendingCandidate();
  candidate.verifications[0].lookup.candidateUrls = [];
  return candidate;
}

function structuredOutput() {
  return JSON.stringify(makePendingCandidate());
}

function assertValid(result) {
  assert.deepEqual(validateActionBrief(result.brief, { sourceText: SOURCE_TEXT }), {
    valid: true,
    errors: [],
  });
}

async function checkFreeTranslationFailsClosed() {
  let fetchCalls = 0;
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'free_translate',
    model: 'free-test',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      fetchPage: async () => {
        fetchCalls += 1;
        throw new Error('free translation must never initiate verification');
      },
    },
  });

  assertValid(result);
  assert.equal(fetchCalls, 0);
  assert.equal(result.brief.status, 'translation_only');
  assert.deepEqual(result.brief.verifications, []);
  assert.deepEqual(result.brief.deadlines, []);
  assert.deepEqual(result.brief.materials, []);
  assert.deepEqual(result.brief.nextSteps, []);
  assert.equal(result.verificationSummary.fetchAttempted, false);
  assert.equal(result.verificationSummary.requestedCount, 0);
  assert(result.brief.warnings.some((warning) => warning.code === 'OFFICIAL_VERIFICATION_NOT_RUN'));
}

async function checkTruncatedCaptureWarningIsDurable() {
  const candidate = makePendingCandidate();
  candidate.verifications = [];
  candidate.terms = [{
    surface: 'Graduate Route',
    kind: 'policy',
    explanation: '英国毕业生签证路线。',
    provenance: 'original',
    evidenceQuotes: ['Graduate Route'],
    citationIds: [],
    confidence: 1,
  }];
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(candidate),
    backend: 'openai',
    model: 'test-model',
    captureEnvelope: {
      id: 'capture-truncated',
      truncated: true,
      originalLength: SOURCE_TEXT.length + 37,
    },
    verificationPolicy: 'local-only',
  });

  assertValid(result);
  assert.equal(result.brief.status, 'partial');
  const warning = result.brief.warnings.find((item) => item.code === 'SOURCE_TRUNCATED');
  assert.ok(warning);
  assert.equal(warning.originalLength, SOURCE_TEXT.length + 37);
  assert.equal(warning.retainedLength, SOURCE_TEXT.length);
  assert.match(warning.message, new RegExp(`${SOURCE_TEXT.length + 37}.*${SOURCE_TEXT.length}`));
}

async function checkAskWithoutApprovalMakesNoFetch() {
  let fetchCalls = 0;
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
    verificationApproved: false,
    verificationDependencies: {
      fetchPage: async () => {
        fetchCalls += 1;
        throw new Error('unapproved ask must never fetch');
      },
    },
  });

  assertValid(result);
  assert.equal(fetchCalls, 0);
  assert.match(result.verificationSummary.approvalId, /^[a-f0-9]{64}$/);
  assert.deepEqual({ ...result.verificationSummary, approvalId: undefined }, {
    policy: 'ask',
    fetchAttempted: false,
    requestedCount: 1,
    verifiedCount: 0,
    approvalId: undefined,
  });
  const verification = result.brief.verifications[0];
  assert.equal(verification.status, 'pending');
  assert.deepEqual(verification.lookup, LOOKUP);
  assert.equal(verification.provenance.kind, 'pending');
  assert.deepEqual(verification.provenance.citations, []);
}

async function checkAskApprovalIsBoundToCurrentLookup() {
  const firstPass = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
  });
  const approvalId = firstPass.verificationSummary.approvalId;
  assert.match(approvalId, /^[a-f0-9]{64}$/);

  for (const candidateApprovalId of [undefined, '0'.repeat(64)]) {
    let fetchCalls = 0;
    const result = await createActionBrief({
      sourceText: SOURCE_TEXT,
      rawOutput: structuredOutput(),
      backend: 'openai',
      model: 'test-model',
      verificationPolicy: 'ask',
      verificationApproved: true,
      verificationApprovalId: candidateApprovalId,
      verificationDependencies: {
        fetchPage: async () => {
          fetchCalls += 1;
          throw new Error('unbound approval must never fetch');
        },
      },
    });
    assert.equal(fetchCalls, 0);
    assert.equal(result.verificationSummary.fetchAttempted, false);
    assert.equal(result.brief.verifications[0].status, 'pending');
  }

  const changedCandidate = makePendingCandidate();
  changedCandidate.verifications[0].lookup.query = 'Graduate visa changed lookup';
  let changedPlanFetchCalls = 0;
  const changedPlan = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(changedCandidate),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
    verificationApproved: true,
    verificationApprovalId: approvalId,
    verificationDependencies: {
      fetchPage: async () => {
        changedPlanFetchCalls += 1;
        throw new Error('approval for a previous lookup must never fetch a changed plan');
      },
    },
  });
  assert.equal(changedPlanFetchCalls, 0);
  assert.equal(changedPlan.verificationSummary.fetchAttempted, false);
  assert.notEqual(changedPlan.verificationSummary.approvalId, approvalId);

  let approvedFetchCalls = 0;
  const approvedPlan = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
    verificationApproved: true,
    verificationApprovalId: approvalId,
    verificationDependencies: {
      fetchPage: async (url) => {
        approvedFetchCalls += 1;
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Graduate Route eligibility rules are current.',
          supportText: 'Graduate Route eligibility rules are current.',
        };
      },
    },
  });
  assert.equal(approvedFetchCalls, 1);
  assert.equal(approvedPlan.verificationSummary.verifiedCount, 0);
  assert.equal(approvedPlan.brief.verifications[0].status, 'retrieved');
  assert.equal(approvedPlan.brief.verifications[0].provenance.kind, 'pending');
  assert.equal(approvedPlan.brief.verifications[0].retrievals.length, 1);
}

async function checkExistingBriefVerificationUsesApprovedPlanOnly() {
  const pending = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
  });
  const approvalId = pending.verificationSummary.approvalId;

  let approvedFetchCalls = 0;
  const verified = await verifyExistingActionBrief({
    sourceText: SOURCE_TEXT,
    brief: pending.brief,
    verificationPolicy: 'ask',
    verificationApproved: true,
    verificationApprovalId: approvalId,
    verificationDependencies: {
      fetchPage: async (url) => {
        approvedFetchCalls += 1;
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Graduate Route eligibility rules are current.',
          supportText: 'Graduate Route eligibility rules are current.',
        };
      },
    },
  });
  assert.equal(approvedFetchCalls, 1);
  assert.notEqual(verified.brief, pending.brief);
  assert.equal(pending.brief.verifications[0].status, 'pending');
  assert.equal(verified.brief.verifications[0].status, 'retrieved');
  assert.equal(verified.brief.verifications[0].provenance.kind, 'pending');
  assert.equal(verified.brief.verifications[0].retrievals.length, 1);

  for (const mutate of [
    (brief) => {
      brief.verifications[0].lookup.query = 'Changed unseen lookup';
    },
    (brief) => {
      brief.verifications[0].claim = 'Changed unseen claim';
    },
  ]) {
    const alteredBrief = structuredClone(pending.brief);
    mutate(alteredBrief);
    let alteredFetchCalls = 0;
    const result = await verifyExistingActionBrief({
      sourceText: SOURCE_TEXT,
      brief: alteredBrief,
      verificationPolicy: 'ask',
      verificationApproved: true,
      verificationApprovalId: approvalId,
      verificationDependencies: {
        fetchPage: async () => {
          alteredFetchCalls += 1;
          throw new Error('altered approved plan must never fetch');
        },
      },
    });
    assert.equal(alteredFetchCalls, 0);
    assert.equal(result.verificationSummary.fetchAttempted, false);
    assert.equal(result.brief.verifications[0].status, 'pending');
  }

  const wrongSource = structuredClone(pending.brief);
  wrongSource.source.sha256 = '0'.repeat(64);
  let wrongSourceFetchCalls = 0;
  await assert.rejects(
    verifyExistingActionBrief({
      sourceText: SOURCE_TEXT,
      brief: wrongSource,
      verificationPolicy: 'ask',
      verificationApproved: true,
      verificationApprovalId: approvalId,
      verificationDependencies: {
        fetchPage: async () => {
          wrongSourceFetchCalls += 1;
        },
      },
    }),
    (error) => error.code === 'source-mismatch'
  );
  assert.equal(wrongSourceFetchCalls, 0);
}

async function checkDiscoveryRunsOnlyInApprovedExecutionChain() {
  let unapprovedDiscoveryCalls = 0;
  let unapprovedFetchCalls = 0;
  const pending = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(makeDiscoveryCandidate()),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
    verificationDependencies: {
      discoverCandidates: async () => {
        unapprovedDiscoveryCalls += 1;
        throw new Error('unapproved analysis must not discover');
      },
      fetchPage: async () => {
        unapprovedFetchCalls += 1;
        throw new Error('unapproved analysis must not fetch');
      },
    },
  });
  assert.equal(unapprovedDiscoveryCalls, 0);
  assert.equal(unapprovedFetchCalls, 0);
  assert.equal(pending.brief.verifications[0].status, 'pending');
  assert.deepEqual(pending.brief.verifications[0].lookup.candidateUrls, []);

  const controller = new AbortController();
  let approvedDiscoveryCalls = 0;
  let approvedFetchCalls = 0;
  const approved = await verifyExistingActionBrief({
    sourceText: SOURCE_TEXT,
    brief: pending.brief,
    verificationPolicy: 'ask',
    verificationApproved: true,
    verificationApprovalId: pending.verificationSummary.approvalId,
    signal: controller.signal,
    verificationDependencies: {
      discoverCandidates: async (input) => {
        approvedDiscoveryCalls += 1;
        assert.equal(input.publisher, LOOKUP.publisher);
        assert.equal(input.query, LOOKUP.query);
        assert.equal(input.signal, controller.signal);
        return {
          fetchAttempted: true,
          candidateUrls: [OFFICIAL_URL],
          candidates: [{
            url: OFFICIAL_URL,
            title: 'UNTRUSTED_SEARCH_METADATA',
            description: 'Metadata is not evidence.',
            metadataTrust: 'untrusted',
          }],
        };
      },
      fetchPage: async (url, options) => {
        approvedFetchCalls += 1;
        assert.equal(url, OFFICIAL_URL);
        assert.equal(options.signal, controller.signal);
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Fetched GOV.UK page receipt.',
          supportText: 'Fetched GOV.UK page receipt.',
        };
      },
    },
  });
  assertValid(approved);
  assert.equal(approvedDiscoveryCalls, 1);
  assert.equal(approvedFetchCalls, 1);
  assert.equal(approved.verificationSummary.fetchAttempted, true);
  assert.equal(approved.verificationSummary.verifiedCount, 0);
  assert.equal(approved.brief.verifications[0].status, 'retrieved');
  assert.equal(approved.brief.verifications[0].provenance.kind, 'pending');
  assert.equal(approved.brief.verifications[0].retrievals[0].url, OFFICIAL_URL);
  assert.equal(approved.brief.verifications[0].retrievals[0].excerpt, 'Fetched GOV.UK page receipt.');
  assert.equal(JSON.stringify(approved).includes('UNTRUSTED_SEARCH_METADATA'), false);
  assert.equal(JSON.stringify(approved).includes('Metadata is not evidence'), false);

  let autoDiscoveryCalls = 0;
  let autoFetchCalls = 0;
  const automatic = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(makeDiscoveryCandidate()),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      discoverCandidates: async () => {
        autoDiscoveryCalls += 1;
        return { fetchAttempted: true, candidateUrls: [OFFICIAL_URL], candidates: [] };
      },
      fetchPage: async (url) => {
        autoFetchCalls += 1;
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Automatically fetched GOV.UK page receipt.',
        };
      },
    },
  });
  assertValid(automatic);
  assert.equal(autoDiscoveryCalls, 1);
  assert.equal(autoFetchCalls, 1);
  assert.equal(automatic.brief.verifications[0].status, 'retrieved');
  assert.equal(automatic.verificationSummary.verifiedCount, 0);
}

async function checkUnrelatedOfficialPageIsNotVerified() {
  let fetchCalls = 0;
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      fetchPage: async (url, options) => {
        fetchCalls += 1;
        assert.equal(url, OFFICIAL_URL);
        assert.deepEqual(options, { query: LOOKUP.query, maxRedirects: 0 });
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Register to vote and find your local polling station.',
          supportText: 'Register to vote and find your local polling station.',
        };
      },
    },
  });

  assertValid(result);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(result.verificationSummary, {
    policy: 'official-auto',
    fetchAttempted: true,
    requestedCount: 1,
    verifiedCount: 0,
  });
  const verification = result.brief.verifications[0];
  assert.equal(verification.status, 'retrieved');
  assert.notEqual(verification.status, 'verified');
  assert.equal(verification.provenance.kind, 'pending');
  assert.deepEqual(verification.provenance.citations, []);
  assert.deepEqual(verification.lookup, LOOKUP);
  assert.equal(verification.retrievals.length, 1);
  assert.equal(verification.retrievals[0].url, OFFICIAL_URL);
  assert.equal(verification.retrievals[0].retrievedAt, RETRIEVED_AT);
}

async function checkQueryMatchCannotVerifyUnsupportedClaim() {
  const candidate = makePendingCandidate();
  candidate.verifications[0].claim = 'Graduate visa lasts 99 years';
  candidate.verifications[0].lookup.query = 'Graduate visa duration';

  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(candidate),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      fetchPage: async (url, options) => {
        assert.equal(url, OFFICIAL_URL);
        assert.deepEqual(options, { query: 'Graduate visa duration', maxRedirects: 0 });
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt: 'Graduate visa duration and application guidance.',
          supportText: 'Official guidance about Graduate visa duration and applications.',
        };
      },
    },
  });

  assertValid(result);
  assert.equal(result.verificationSummary.verifiedCount, 0);
  assert.equal(result.brief.verifications[0].status, 'retrieved');
  assert.equal(result.brief.verifications[0].provenance.kind, 'pending');
  assert.deepEqual(result.brief.verifications[0].provenance.citations, []);
  assert.equal(result.brief.verifications[0].retrievals.length, 1);
}

async function checkSupportedOfficialPageCreatesReceipt() {
  let fetchCalls = 0;
  let assessmentCalls = 0;
  const excerpt = 'Graduate Route eligibility rules explain who can apply and the current requirements.';
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      fetchPage: async (url, options) => {
        fetchCalls += 1;
        assert.equal(url, OFFICIAL_URL);
        assert.deepEqual(options, { query: LOOKUP.query, maxRedirects: 0 });
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt,
          supportText: `GOV.UK guidance. ${excerpt}`,
        };
      },
      assessSupport: async ({ claim, query, text, url, publisher }) => {
        assessmentCalls += 1;
        assert.equal(claim, 'Graduate Route eligibility rules are current');
        assert.equal(query, LOOKUP.query);
        assert.match(text, /Graduate Route eligibility rules/);
        assert.equal(url, OFFICIAL_URL);
        assert.equal(publisher, LOOKUP.publisher);
        return { supported: true, excerpt };
      },
    },
  });

  assertValid(result);
  assert.equal(fetchCalls, 1);
  assert.equal(assessmentCalls, 1);
  assert.deepEqual(result.verificationSummary, {
    policy: 'official-auto',
    fetchAttempted: true,
    requestedCount: 1,
    verifiedCount: 1,
  });
  const verification = result.brief.verifications[0];
  assert.equal(verification.status, 'verified');
  assert.equal(verification.lookup, null);
  assert.equal(verification.provenance.kind, 'official');
  assert.equal(verification.provenance.citations.length, 1);

  const citation = verification.provenance.citations[0];
  assert.equal(citation.url, OFFICIAL_URL);
  assert.equal(citation.publisher, LOOKUP.publisher);
  assert.equal(citation.retrievedAt, RETRIEVED_AT);
  assert.equal(citation.quote, excerpt);
  assert.equal(citation.official, true);
}

async function checkFailedFetchRetainsRetryLookup() {
  let fetchCalls = 0;
  const result = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: structuredOutput(),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'official-auto',
    verificationDependencies: {
      fetchPage: async () => {
        fetchCalls += 1;
        const error = new Error('simulated timeout');
        error.code = 'verification-timeout';
        throw error;
      },
    },
  });

  assertValid(result);
  assert.equal(fetchCalls, 1);
  assert.equal(result.verificationSummary.fetchAttempted, true);
  assert.equal(result.verificationSummary.verifiedCount, 0);
  const verification = result.brief.verifications[0];
  assert.equal(verification.status, 'failed');
  assert.equal(verification.provenance.kind, 'pending');
  assert.deepEqual(verification.provenance.citations, []);
  assert.deepEqual(verification.lookup, LOOKUP, 'failed verification must retain its retry plan');
}

async function checkAbortedVerificationRejectsWithoutFailedBrief() {
  const controller = new AbortController();
  await assert.rejects(
    createActionBrief({
      sourceText: SOURCE_TEXT,
      rawOutput: structuredOutput(),
      backend: 'openai',
      model: 'test-model',
      verificationPolicy: 'official-auto',
      signal: controller.signal,
      verificationDependencies: {
        fetchPage: async (url, options) => {
          assert.equal(url, OFFICIAL_URL);
          assert.equal(options.signal, controller.signal);
          controller.abort();
          const error = new Error('simulated cancellation');
          error.code = 'aborted';
          throw error;
        },
      },
    }),
    (error) => error.code === 'aborted'
  );
}

async function main() {
  await checkFreeTranslationFailsClosed();
  await checkTruncatedCaptureWarningIsDurable();
  await checkAskWithoutApprovalMakesNoFetch();
  await checkAskApprovalIsBoundToCurrentLookup();
  await checkExistingBriefVerificationUsesApprovedPlanOnly();
  await checkDiscoveryRunsOnlyInApprovedExecutionChain();
  await checkUnrelatedOfficialPageIsNotVerified();
  await checkQueryMatchCannotVerifyUnsupportedClaim();
  await checkSupportedOfficialPageCreatesReceipt();
  await checkFailedFetchRetainsRetryLookup();
  await checkAbortedVerificationRejectsWithoutFailedBrief();
  console.log('action brief service integration checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
