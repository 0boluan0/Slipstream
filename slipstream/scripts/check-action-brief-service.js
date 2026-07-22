const assert = require('node:assert/strict');

const { createActionBrief } = require('../src/main/action-brief-service');
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
  assert.deepEqual(result.verificationSummary, {
    policy: 'ask',
    fetchAttempted: false,
    requestedCount: 1,
    verifiedCount: 0,
  });
  const verification = result.brief.verifications[0];
  assert.equal(verification.status, 'pending');
  assert.deepEqual(verification.lookup, LOOKUP);
  assert.equal(verification.provenance.kind, 'pending');
  assert.deepEqual(verification.provenance.citations, []);
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
        assert.deepEqual(options, { query: LOOKUP.query });
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
  assert.equal(verification.status, 'failed');
  assert.notEqual(verification.status, 'verified');
  assert.equal(verification.provenance.kind, 'pending');
  assert.deepEqual(verification.provenance.citations, []);
  assert.deepEqual(verification.lookup, LOOKUP);
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
        assert.deepEqual(options, { query: 'Graduate visa duration' });
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
  assert.equal(result.brief.verifications[0].status, 'failed');
  assert.equal(result.brief.verifications[0].provenance.kind, 'pending');
  assert.deepEqual(result.brief.verifications[0].provenance.citations, []);
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
        assert.deepEqual(options, { query: LOOKUP.query });
        return {
          fetched: true,
          url,
          retrievedAt: RETRIEVED_AT,
          excerpt,
          supportText: `GOV.UK guidance. ${excerpt}`,
        };
      },
      assessSupport: async ({ query, text, url, publisher }) => {
        assessmentCalls += 1;
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

async function main() {
  await checkFreeTranslationFailsClosed();
  await checkAskWithoutApprovalMakesNoFetch();
  await checkUnrelatedOfficialPageIsNotVerified();
  await checkQueryMatchCannotVerifyUnsupportedClaim();
  await checkSupportedOfficialPageCreatesReceipt();
  await checkFailedFetchRetainsRetryLookup();
  console.log('action brief service integration checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
