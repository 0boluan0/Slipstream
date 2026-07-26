const assert = require('node:assert/strict');
const {
  DISCOVERY_METADATA_TRUST,
  GOV_UK_SEARCH_ENDPOINT,
  createGovUkDiscovery,
  discoverGovUkCandidates,
} = require('../src/main/verification');

function jsonPage(results, url) {
  return {
    fetched: true,
    url,
    supportText: JSON.stringify({ results }),
  };
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function main() {
  const calls = [];
  const rawSource = 'From: private.person@example.com\nCase GWF123456789';
  const discovery = createGovUkDiscovery({
    fetchPage: async (url, options) => {
      calls.push({ url, options });
      return jsonPage(
        [
          {
            title: 'Graduate visa\n guidance',
            description: '<strong>Search metadata</strong> only',
            link: '/graduate-visa',
          },
          { title: 'Absolute', description: 'drop', link: 'https://www.gov.uk/absolute' },
          { title: 'Protocol-relative', description: 'drop', link: '//evil.example/collect' },
          {
            title: 'Redirect-like',
            description: 'drop',
            link: '/redirect?url=https://evil.example/collect',
          },
          { title: 'Fragment', description: 'drop', link: '/student-visa#private' },
          { title: 'Credentials', description: 'drop', link: 'https://user:secret@www.gov.uk/private' },
          { title: 'Backslash host switch', description: 'drop', link: '/\\evil.example/collect' },
          { title: 'Student visa', description: 'Official search description', link: '/student-visa' },
          { title: 'Duplicate', description: 'drop', link: '/student-visa' },
          { title: 'Third', description: 'Third result', link: '/browse/visas-immigration' },
          { title: 'Fourth', description: 'over limit', link: '/fourth' },
        ],
        url
      );
    },
  });

  const discovered = await discovery.discover({
    publisher: '  gov.uk  ',
    query: 'graduate visa official guidance',
    sourceText: rawSource,
    rawSource,
  });
  assert.equal(calls.length, 1);
  const requestedUrl = new URL(calls[0].url);
  assert.equal(requestedUrl.origin + requestedUrl.pathname, GOV_UK_SEARCH_ENDPOINT);
  assert.deepEqual([...requestedUrl.searchParams.keys()].sort(), ['count', 'fields', 'q']);
  assert.equal(requestedUrl.searchParams.get('q'), 'graduate visa official guidance');
  assert.equal(requestedUrl.searchParams.get('count'), '3');
  assert.equal(requestedUrl.searchParams.get('fields'), 'title,description,link');
  assert.equal(calls[0].url.includes(rawSource), false);
  assert.equal(JSON.stringify(calls[0].options).includes(rawSource), false);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(calls[0].options.maxBytes <= 64 * 1024, true);
  assert.deepEqual(discovered.candidateUrls, [
    'https://www.gov.uk/graduate-visa',
    'https://www.gov.uk/student-visa',
    'https://www.gov.uk/browse/visas-immigration',
  ]);
  assert.equal(discovered.candidates.length, 3);
  assert.equal(discovered.candidates[0].title, 'Graduate visa guidance');
  assert.equal(discovered.candidates[0].description, '<strong>Search metadata</strong> only');
  for (const candidate of discovered.candidates) {
    assert.equal(candidate.metadataTrust, DISCOVERY_METADATA_TRUST);
    assert.equal(Object.hasOwn(candidate, 'excerpt'), false);
    assert.equal(Object.hasOwn(candidate, 'evidence'), false);
    assert.equal(Object.hasOwn(candidate, 'supportText'), false);
  }

  let noNetworkCalls = 0;
  const noNetwork = createGovUkDiscovery({
    fetchPage: async () => {
      noNetworkCalls += 1;
      throw new Error('must not fetch');
    },
  });
  const unsupported = await noNetwork.discover({
    publisher: 'United States Government',
    query: 'graduate visa guidance',
  });
  assert.equal(unsupported.fetchAttempted, false);
  assert.equal(unsupported.reason, 'unsupported-publisher');
  const empty = await noNetwork.discover({ publisher: 'UK Government', query: '   ' });
  assert.equal(empty.fetchAttempted, false);
  assert.equal(empty.reason, 'empty-query');
  assert.equal(noNetworkCalls, 0);

  for (const query of [
    'private.person@example.com visa status',
    '+44 7700 900123 visa status',
    'GWF123456789 visa status',
  ]) {
    await assertRejectCode(
      noNetwork.discover({ publisher: 'GOV.UK', query }),
      'personal-data-rejected'
    );
  }
  assert.equal(noNetworkCalls, 0, 'PII queries must be rejected before a request');

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assertRejectCode(
    noNetwork.discover({
      publisher: 'GOV.UK',
      query: 'graduate visa guidance',
      signal: alreadyAborted.signal,
    }),
    'aborted'
  );
  assert.equal(noNetworkCalls, 0);

  let receivedSignal;
  let pendingCalls = 0;
  const pendingDiscovery = createGovUkDiscovery({
    fetchPage: (_url, options) => {
      pendingCalls += 1;
      receivedSignal = options.signal;
      return new Promise(() => {});
    },
  });
  const abortController = new AbortController();
  const pending = pendingDiscovery.discover({
    publisher: 'UK Government',
    query: 'graduate visa guidance',
    signal: abortController.signal,
  });
  abortController.abort();
  await assertRejectCode(pending, 'aborted');
  assert.equal(pendingCalls, 1);
  assert.equal(receivedSignal, abortController.signal);

  const oneShot = await discoverGovUkCandidates(
    { publisher: 'GOV.UK', query: 'student visa' },
    {
      fetchPage: async (url) =>
        jsonPage([{ title: 'Student visa', description: 'Metadata', link: '/student-visa' }], url),
    }
  );
  assert.deepEqual(oneShot.candidateUrls, ['https://www.gov.uk/student-visa']);

  console.log('GOV.UK verification discovery checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
