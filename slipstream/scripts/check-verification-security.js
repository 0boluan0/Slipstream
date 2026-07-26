const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const {
  VERIFICATION_POLICIES,
  VERIFICATION_STATUSES,
  createVerificationRequest,
  createVerificationService,
  fetchPublicText,
  isConservativeOfficialHost,
  isPublicIpAddress,
  normalizeVerificationPolicy,
  parseSafeHttpsUrl,
  resolvePublicAddresses,
} = require('../src/main/verification');

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

function fakeRequestSequence(scenarios, calls) {
  let index = 0;
  return (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.end = (body) => {
      assert.equal(body, undefined, 'verification requests must not upload a body');
      const scenario = scenarios[Math.min(index, scenarios.length - 1)];
      index += 1;
      if (scenario?.neverRespond) return;
      setImmediate(() => {
        const response = Readable.from(scenario?.chunks || []);
        response.statusCode = scenario?.statusCode ?? 200;
        response.headers = scenario?.headers || { 'content-type': 'text/plain' };
        callback(response);
      });
    };
    request.destroy = (error) => {
      setImmediate(() => request.emit('error', error || new Error('destroyed')));
    };
    return request;
  };
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function main() {
  assert.equal(normalizeVerificationPolicy(undefined), VERIFICATION_POLICIES.ASK);
  assert.equal(normalizeVerificationPolicy('broken'), VERIFICATION_POLICIES.ASK);
  assert.equal(isConservativeOfficialHost('gov.uk'), true);
  assert.equal(isConservativeOfficialHost('www.gov.uk'), true);
  assert.equal(isConservativeOfficialHost('canada.ca'), true);
  assert.equal(isConservativeOfficialHost('www.canada.ca'), true);
  assert.equal(isConservativeOfficialHost('nhs.uk'), true);
  assert.equal(isConservativeOfficialHost('service.nhs.uk'), true);
  assert.equal(isConservativeOfficialHost('gov.uk.evil.example.com'), false);

  const minimal = createVerificationRequest({
    publisher: 'Example University',
    query: 'financial aid deadline 2026',
    candidateUrls: ['https://www.example.edu/aid#details'],
    ignoredFutureField: 'not forwarded',
  });
  assert.deepEqual(Object.keys(minimal), ['publisher', 'query', 'candidateUrls']);

  for (const query of ['john@example.com visa status', '+44 7700 900123 account help', 'GWF123456789 visa status']) {
    assert.throws(
      () => createVerificationRequest({ publisher: 'GOV.UK', query, candidateUrls: [] }),
      (error) => error.code === 'personal-data-rejected'
    );
  }
  assert.equal(minimal.candidateUrls[0], 'https://www.example.edu/aid');
  assert.throws(
    () =>
      createVerificationRequest({
        publisher: 'Example University',
        query: 'deadline',
        sourceText: 'From: student@example.edu\nFull private email',
      }),
    (error) => error.code === 'raw-text-rejected'
  );
  assert.throws(
    () =>
      createVerificationRequest({
        publisher: 'Example University',
        candidateUrls: ['http://www.example.edu/aid'],
      }),
    (error) => error.code === 'unsafe-url'
  );
  assert.throws(
    () =>
      createVerificationRequest({
        publisher: 'Example University',
        query: 'case guidance',
        candidateUrls: [
          'https://attacker.com/collect?email=student%40example.edu&case=ABC-123-SECRET',
        ],
      }),
    (error) => error.code === 'personal-data-rejected'
  );

  let fetchCalls = 0;
  const noNetworkService = createVerificationService({
    fetchPage: async () => {
      fetchCalls += 1;
      throw new Error('must not run');
    },
  });
  const localOnly = await noNetworkService.verify({
    policy: VERIFICATION_POLICIES.LOCAL_ONLY,
    publisher: 'Example University',
    query: 'financial aid deadline',
    candidateUrls: ['https://www.example.edu/aid'],
  });
  assert.equal(fetchCalls, 0);
  assert.equal(localOnly.fetchAttempted, false);
  assert.equal(localOnly.results[0].status, VERIFICATION_STATUSES.LOCAL_ONLY);
  assert.equal(localOnly.results[0].retrievedAt, null);
  assert.equal(localOnly.results[0].excerpt, '');

  const askByDefault = await noNetworkService.verify({
    publisher: 'Example University',
    query: 'financial aid deadline',
    candidateUrls: ['https://www.example.edu/aid'],
  });
  assert.equal(fetchCalls, 0);
  assert.equal(askByDefault.policy, VERIFICATION_POLICIES.ASK);
  assert.equal(askByDefault.results[0].status, VERIFICATION_STATUSES.APPROVAL_REQUIRED);

  let gatedDiscoveryCalls = 0;
  let gatedPageFetchCalls = 0;
  const gatedDiscoveryService = createVerificationService({
    discoverCandidates: async () => {
      gatedDiscoveryCalls += 1;
      throw new Error('discovery must remain behind policy approval');
    },
    fetchPage: async () => {
      gatedPageFetchCalls += 1;
      throw new Error('page fetch must remain behind policy approval');
    },
  });
  for (const input of [
    {
      policy: VERIFICATION_POLICIES.LOCAL_ONLY,
      publisher: 'GOV.UK',
      claim: 'Graduate visa rules are current.',
      query: 'graduate visa current rules',
      candidateUrls: [],
    },
    {
      policy: VERIFICATION_POLICIES.ASK,
      approved: false,
      publisher: 'UK Government',
      claim: 'Graduate visa rules are current.',
      query: 'graduate visa current rules',
      candidateUrls: [],
    },
  ]) {
    const gated = await gatedDiscoveryService.verify(input);
    assert.equal(gated.fetchAttempted, false);
  }
  assert.equal(gatedDiscoveryCalls, 0);
  assert.equal(gatedPageFetchCalls, 0);

  const discoveredUrls = [
    'https://www.gov.uk/graduate-visa',
    'https://www.gov.uk/student-visa',
    'https://www.gov.uk/browse/visas-immigration',
    'https://www.gov.uk/fourth-result',
  ];
  for (const [policy, approved] of [
    [VERIFICATION_POLICIES.ASK, true],
    [VERIFICATION_POLICIES.OFFICIAL_AUTO, false],
  ]) {
    const controller = new AbortController();
    let discoveryCalls = 0;
    const pageFetches = [];
    const discovered = await createVerificationService({
      discoverCandidates: async (input) => {
        discoveryCalls += 1;
        assert.equal(input.query, 'graduate visa current rules');
        assert.equal(input.signal, controller.signal);
        return {
          fetchAttempted: true,
          candidateUrls: discoveredUrls,
          candidates: [{
            url: discoveredUrls[0],
            title: 'SEARCH_METADATA_MUST_NOT_BECOME_EVIDENCE',
            description: 'Metadata falsely claims the assertion is proven.',
            metadataTrust: 'untrusted',
          }],
        };
      },
      fetchPage: async (url, options) => {
        pageFetches.push({ url, options });
        return {
          fetched: true,
          url,
          retrievedAt: '2026-07-23T00:00:00.000Z',
          excerpt: `Fetched official page ${pageFetches.length}.`,
        };
      },
    }).verify({
      policy,
      approved,
      publisher: 'GOV.UK',
      claim: 'Graduate visa rules are current.',
      query: 'graduate visa current rules',
      candidateUrls: [],
      signal: controller.signal,
    });

    assert.equal(discoveryCalls, 1);
    assert.equal(discovered.fetchAttempted, true);
    assert.deepEqual(discovered.request.candidateUrls, discoveredUrls.slice(0, 3));
    assert.equal(pageFetches.length, 3, 'discovery must fetch at most three official pages');
    assert(pageFetches.every(({ options }) => options.signal === controller.signal));
    assert(pageFetches.every(({ options }) => options.maxRedirects === 0));
    assert(discovered.results.every((result) => result.status === VERIFICATION_STATUSES.RETRIEVED));
    assert(discovered.results.every((result) => result.status !== VERIFICATION_STATUSES.VERIFIED));
    assert(discovered.results.every((result) => result.publisher === 'GOV.UK'));
    assert.equal(JSON.stringify(discovered).includes('SEARCH_METADATA_MUST_NOT_BECOME_EVIDENCE'), false);
    assert.equal(JSON.stringify(discovered).includes('Metadata falsely claims'), false);
  }

  let unsupportedDiscoveryCalls = 0;
  let unsupportedFetchCalls = 0;
  const unsupportedDiscovery = await createVerificationService({
    discoverCandidates: async () => {
      unsupportedDiscoveryCalls += 1;
      throw new Error('unsupported publishers must not invoke discovery');
    },
    fetchPage: async () => {
      unsupportedFetchCalls += 1;
      throw new Error('unsupported publishers must not fetch');
    },
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'United States Government',
    claim: 'A current government rule exists.',
    query: 'current government rule',
    candidateUrls: [],
  });
  assert.equal(unsupportedDiscoveryCalls, 0);
  assert.equal(unsupportedFetchCalls, 0);
  assert.equal(unsupportedDiscovery.fetchAttempted, false);
  assert.equal(unsupportedDiscovery.results[0].reason, 'unsupported-publisher');

  const discoveryAbortController = new AbortController();
  let abortDiscoveryCalls = 0;
  let abortPageFetchCalls = 0;
  const abortDuringDiscovery = createVerificationService({
    discoverCandidates: ({ signal }) => {
      abortDiscoveryCalls += 1;
      assert.equal(signal, discoveryAbortController.signal);
      setImmediate(() => discoveryAbortController.abort());
      return new Promise(() => {});
    },
    fetchPage: async () => {
      abortPageFetchCalls += 1;
      throw new Error('aborted discovery must not fetch a result page');
    },
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'GOV.UK',
    claim: 'Graduate visa rules are current.',
    query: 'graduate visa current rules',
    candidateUrls: [],
    signal: discoveryAbortController.signal,
  });
  await assertRejectCode(abortDuringDiscovery, 'aborted');
  assert.equal(abortDiscoveryCalls, 1);
  assert.equal(abortPageFetchCalls, 0);

  const approved = await createVerificationService({
    fetchPage: async (url) => {
      fetchCalls += 1;
      return {
        fetched: true,
        url,
        retrievedAt: '2026-07-23T00:00:00.000Z',
        excerpt: 'The official financial aid deadline is 1 August 2026.',
      };
    },
  }).verify({
    policy: VERIFICATION_POLICIES.ASK,
    approved: true,
    publisher: 'Example University',
    claim: 'The official financial aid deadline is 1 August 2026.',
    query: 'financial aid deadline',
    candidateUrls: ['https://www.example.edu/aid'],
  });
  assert.equal(approved.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
  assert.equal(approved.results[0].reason, 'semantic-assessment-required');
  for (const field of ['publisher', 'url', 'retrievedAt', 'excerpt', 'status']) {
    assert.ok(Object.hasOwn(approved.results[0], field), 'missing result field ' + field);
  }

  let missingClaimFetchCalls = 0;
  const missingClaim = await createVerificationService({
    fetchPage: async () => {
      missingClaimFetchCalls += 1;
      throw new Error('a request without a claim must not fetch');
    },
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example University',
    query: 'financial aid deadline',
    candidateUrls: ['https://www.example.edu/aid'],
  });
  assert.equal(missingClaimFetchCalls, 0);
  assert.equal(missingClaim.fetchAttempted, false);
  assert.equal(missingClaim.results[0].status, VERIFICATION_STATUSES.NOT_VERIFIED);
  assert.equal(missingClaim.results[0].reason, 'missing-claim');

  const unconfirmed = await createVerificationService({
    fetchPage: async (url) => ({ url, excerpt: 'A claim without a fetch receipt' }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example University',
    claim: 'A claim without a fetch receipt',
    candidateUrls: ['https://www.example.edu/aid'],
  });
  assert.equal(unconfirmed.results[0].status, VERIFICATION_STATUSES.NOT_VERIFIED);
  assert.notEqual(unconfirmed.results[0].status, VERIFICATION_STATUSES.VERIFIED);

  const unrelated = await createVerificationService({
    fetchPage: async (url) => ({
      fetched: true,
      url,
      retrievedAt: '2026-07-23T00:00:00.000Z',
      excerpt: 'Campus parking permits are available.',
      supportText: 'Campus parking permits are available.',
    }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example University',
    claim: 'The official financial aid deadline is 1 August 2026.',
    query: 'financial aid deadline 2026',
    candidateUrls: ['https://www.example.edu/unrelated'],
  });
  assert.equal(unrelated.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
  assert.equal(unrelated.results[0].reason, 'semantic-assessment-required');

  const reversedRelation = await createVerificationService({
    fetchPage: async (url) => ({
      fetched: true,
      url,
      retrievedAt: '2026-07-23T00:00:00.000Z',
      excerpt: 'You can apply after graduation. Before you apply, read the guidance.',
      supportText: 'You can apply after graduation. Before you apply, read the guidance.',
    }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example University',
    claim: 'You can apply before graduation',
    query: 'graduation application timing',
    candidateUrls: ['https://www.example.edu/apply'],
  });
  assert.equal(reversedRelation.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
  assert.equal(reversedRelation.results[0].reason, 'semantic-assessment-required');

  for (const supportText of [
    'If your sponsor gives written permission, you can apply before graduation.',
    'Archived guidance: You can apply before graduation. This page is no longer current.',
    'The page quotes the disputed wording “You can apply before graduation” without endorsing it.',
  ]) {
    const contextDependentWording = await createVerificationService({
      fetchPage: async (url) => ({
        fetched: true,
        url,
        retrievedAt: '2026-07-23T00:00:00.000Z',
        excerpt: supportText,
        supportText,
      }),
    }).verify({
      policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
      publisher: 'Example University',
      claim: 'You can apply before graduation',
      query: 'graduation application timing',
      candidateUrls: ['https://www.example.edu/apply'],
    });
    assert.equal(contextDependentWording.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
    assert.notEqual(contextDependentWording.results[0].status, VERIFICATION_STATUSES.VERIFIED);
    assert.equal(contextDependentWording.results[0].reason, 'semantic-assessment-required');
  }

  for (const [policy, approved] of [
    [VERIFICATION_POLICIES.OFFICIAL_AUTO, false],
    [VERIFICATION_POLICIES.ASK, true],
  ]) {
    let untrustedFetchCalls = 0;
    const publisherCannotGrantTrust = await createVerificationService({
      fetchPage: async (url) => {
        untrustedFetchCalls += 1;
        return {
          fetched: true,
          url,
          retrievedAt: '2026-07-23T00:00:00.000Z',
          excerpt: 'The official financial aid deadline is 1 August 2026.',
        };
      },
    }).verify({
      policy,
      approved,
      publisher: 'United States Government',
      claim: 'The official financial aid deadline is 1 August 2026.',
      query: 'financial aid deadline 2026',
      candidateUrls: ['https://example.com/claim'],
    });
    assert.equal(untrustedFetchCalls, 0, 'untrusted hosts must be rejected before fetch');
    assert.equal(publisherCannotGrantTrust.fetchAttempted, false);
    assert.equal(publisherCannotGrantTrust.results[0].status, VERIFICATION_STATUSES.NOT_VERIFIED);
    assert.equal(publisherCannotGrantTrust.results[0].reason, 'untrusted-host');
  }

  const explicitlyTrusted = await createVerificationService({
    trustedHosts: ['example.com'],
    fetchPage: async (url) => ({
      fetched: true,
      url,
      retrievedAt: '2026-07-23T00:00:00.000Z',
      excerpt: 'The official financial aid deadline is 1 August 2026.',
    }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example Organization',
    claim: 'The official financial aid deadline is 1 August 2026.',
    query: 'financial aid deadline 2026',
    candidateUrls: ['https://notices.example.com/claim'],
  });
  assert.equal(explicitlyTrusted.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
  assert.equal(explicitlyTrusted.results[0].reason, 'semantic-assessment-required');
  assert.equal(
    explicitlyTrusted.results[0].publisher,
    'notices.example.com',
    'retrieval receipts must identify the fetched host, not the model-supplied publisher'
  );

  let semanticAssessmentInput;
  const semanticallyConfirmed = await createVerificationService({
    trustedHosts: ['example.com'],
    assessSupport: async (input) => {
      semanticAssessmentInput = input;
      return { supported: true, excerpt: 'Semantically confirmed evidence.' };
    },
    fetchPage: async (url) => ({
      fetched: true,
      url,
      retrievedAt: '2026-07-23T00:00:00.000Z',
      excerpt: 'A fetched source requiring semantic assessment.',
      supportText: 'Full visible source text for local assessment.',
    }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example Organization',
    claim: 'Financial aid applications close on 1 August 2026.',
    query: 'financial aid deadline 2026',
    candidateUrls: ['https://example.com/claim'],
  });
  assert.equal(semanticallyConfirmed.results[0].status, VERIFICATION_STATUSES.VERIFIED);
  assert.equal(semanticallyConfirmed.results[0].excerpt, 'Semantically confirmed evidence.');
  assert.equal(semanticAssessmentInput.query, 'financial aid deadline 2026');
  assert.equal(semanticAssessmentInput.claim, 'Financial aid applications close on 1 August 2026.');
  assert.equal(semanticAssessmentInput.text, 'Full visible source text for local assessment.');

  const missingQuery = await createVerificationService({
    fetchPage: async (url) => ({
      fetched: true,
      url,
      retrievedAt: '2026-07-23T00:00:00.000Z',
      excerpt: 'Financial aid deadline 2026.',
    }),
  }).verify({
    policy: VERIFICATION_POLICIES.OFFICIAL_AUTO,
    publisher: 'Example University',
    claim: 'Financial aid deadline 2026.',
    candidateUrls: ['https://www.example.edu/claim'],
  });
  assert.equal(missingQuery.results[0].status, VERIFICATION_STATUSES.RETRIEVED);
  assert.equal(missingQuery.results[0].reason, 'missing-query');

  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.51.100.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address + ' must be blocked');
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
  assert.throws(() => parseSafeHttpsUrl('https://127.0.0.1/private'));
  assert.throws(() => parseSafeHttpsUrl('https://127.1/private'));
  assert.throws(() => parseSafeHttpsUrl('https://0x7f000001/private'));
  assert.throws(() => parseSafeHttpsUrl('https://169.254.169.254/latest/meta-data'));
  assert.throws(() => parseSafeHttpsUrl('https://service.internal/'));
  assert.throws(() => parseSafeHttpsUrl('https://example.com:8443/'));

  await assertRejectCode(
    resolvePublicAddresses('https://official.example.edu/', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    'unsafe-url'
  );

  const successCalls = [];
  const successfulPage = await fetchPublicText('https://official.example.edu/notices', {
    lookup: PUBLIC_LOOKUP,
    requestImpl: fakeRequestSequence(
      [
        {
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '90' },
          chunks: ['<style>secret</style><h1>Official notice</h1><script>private()</script> Deadline: Friday.'],
        },
      ],
      successCalls
    ),
    now: () => Date.parse('2026-07-23T00:00:00.000Z'),
  });
  assert.equal(successfulPage.fetched, true);
  assert.equal(successfulPage.retrievedAt, '2026-07-23T00:00:00.000Z');
  assert.equal(successfulPage.excerpt, 'Official notice Deadline: Friday.');
  assert.equal(successCalls[0].method, 'GET');
  assert.equal(successCalls[0].agent, false);
  assert.equal(successCalls[0].headers['Accept-Encoding'], 'identity');

  const relevantCalls = [];
  const relevantPage = await fetchPublicText('https://official.example.edu/notices', {
    lookup: PUBLIC_LOOKUP,
    query: 'financial aid deadline 2026',
    requestImpl: fakeRequestSequence(
      [
        {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          chunks: [
            '<p>Welcome to campus. General navigation and unrelated boilerplate.</p>'.repeat(20) +
              '<p>The financial aid deadline for 2026 is Friday.</p>',
          ],
        },
      ],
      relevantCalls
    ),
  });
  assert.match(relevantPage.excerpt, /financial aid deadline for 2026/i);
  assert.equal(relevantCalls[0].path, '/notices');

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/image', {
      lookup: PUBLIC_LOOKUP,
      requestImpl: fakeRequestSequence(
        [{ headers: { 'content-type': 'image/png' }, chunks: ['not really an image'] }],
        []
      ),
    }),
    'unsupported-mime'
  );

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/compressed', {
      lookup: PUBLIC_LOOKUP,
      requestImpl: fakeRequestSequence(
        [{ headers: { 'content-type': 'text/plain', 'content-encoding': 'gzip' }, chunks: ['compressed'] }],
        []
      ),
    }),
    'unsupported-encoding'
  );

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/declared-large', {
      lookup: PUBLIC_LOOKUP,
      maxBytes: 8,
      requestImpl: fakeRequestSequence(
        [{ headers: { 'content-type': 'text/plain', 'content-length': '9' }, chunks: [] }],
        []
      ),
    }),
    'response-too-large'
  );

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/large', {
      lookup: PUBLIC_LOOKUP,
      maxBytes: 8,
      requestImpl: fakeRequestSequence(
        [{ headers: { 'content-type': 'text/plain' }, chunks: ['12345', '67890'] }],
        []
      ),
    }),
    'response-too-large'
  );

  const redirectCalls = [];
  await assertRejectCode(
    fetchPublicText('https://official.example.edu/start', {
      lookup: PUBLIC_LOOKUP,
      requestImpl: fakeRequestSequence(
        [{ statusCode: 302, headers: { location: 'https://127.0.0.1/private' } }],
        redirectCalls
      ),
    }),
    'unsafe-url'
  );
  assert.equal(redirectCalls.length, 1, 'private redirects must be rejected before a second request');

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/slow', {
      lookup: PUBLIC_LOOKUP,
      timeoutMs: 20,
      requestImpl: fakeRequestSequence([{ neverRespond: true }], []),
    }),
    'timeout'
  );

  await assertRejectCode(
    fetchPublicText('https://official.example.edu/dns-timeout', {
      lookup: async () => new Promise(() => {}),
      timeoutMs: 20,
      requestImpl: () => {
        throw new Error('request must not start before DNS resolves');
      },
    }),
    'timeout'
  );

  const abortController = new AbortController();
  const abortedFetch = fetchPublicText('https://official.example.edu/cancelled', {
    lookup: PUBLIC_LOOKUP,
    timeoutMs: 5000,
    signal: abortController.signal,
    requestImpl: fakeRequestSequence([{ neverRespond: true }], []),
  });
  setImmediate(() => abortController.abort());
  await assertRejectCode(abortedFetch, 'aborted');

  console.log('verification privacy and network security checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
