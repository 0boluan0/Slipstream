const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TermTransferError,
  createTermBackup,
  mergePortableTerms,
  parseTermBackup,
  serializeTermBackup,
} = require('../src/main/term-transfer');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function sourceBetween(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return contents.slice(start, end);
}

function main() {
  const storedTerms = [{
    id: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    term: 'FAFSA',
    explanation: 'Federal student aid application.',
    termKind: 'abbreviation',
    provenanceKind: 'official',
    evidence: 'Sensitive account 123456789 appears beside FAFSA.',
    sourceText: 'A longer private source must never leave the device.',
  }];
  const backup = createTermBackup(storedTerms, '2026-07-27T12:00:00.000Z');
  assert.equal(backup.version, 2);
  assert.deepEqual(backup.terms, [{
    term: 'FAFSA',
    explanation: 'Federal student aid application.',
    termKind: 'abbreviation',
    provenanceKind: 'official',
  }]);
  assert.deepEqual(backup.privacy, {
    includesEvidence: false,
    includesSettings: false,
    includesCredentials: false,
  });
  const serialized = serializeTermBackup(storedTerms, '2026-07-27T12:00:00.000Z');
  for (const privateValue of ['Sensitive account', 'longer private source', '123456789', '"id"', 'createdAt']) {
    assert.equal(serialized.includes(privateValue), false, `export must exclude ${privateValue}`);
  }
  const exportedRoundTrip = parseTermBackup(serialized);
  assert.equal(exportedRoundTrip.terms[0].provenanceKind, 'unknown',
    'an exported official label must fail closed when the evidence-free backup is imported');
  const importedRoundTrip = mergePortableTerms([], exportedRoundTrip.terms, {
    now: '2026-07-27T12:01:00.000Z',
    idFactory: () => 6,
  });
  assert.equal(importedRoundTrip.terms[0].provenanceKind, 'unknown',
    'export then import must not recreate official trust without a verifiable receipt');

  const evidenceBoundLabels = parseTermBackup(JSON.stringify({
    format: 'slipstream-terms',
    version: 2,
    terms: [
      { term: 'Claimed original', explanation: 'No source travels with this file.', provenanceKind: 'original' },
      { term: 'Claimed inference', explanation: 'No inference evidence travels with this file.', provenanceKind: 'inference' },
      { term: 'Still pending', explanation: 'A pending warning is safe to retain.', provenanceKind: 'pending' },
    ],
  }));
  assert.deepEqual(
    evidenceBoundLabels.terms.map((term) => term.provenanceKind),
    ['unknown', 'unknown', 'pending'],
    'evidence-free imports must drop every evidence-bound label while retaining an explicit pending warning',
  );

  const parsed = parseTermBackup(JSON.stringify({
    format: 'slipstream-terms',
    version: 1,
    terms: [
      {
        term: ' CAS ',
        definition: 'Confirmation of Acceptance for Studies',
        termKind: 'specialist_term',
        provenanceKind: 'official',
        evidence: 'private quote',
      },
      { term: 'ＣＡＳ', explanation: 'duplicate' },
      { term: '', explanation: 'invalid' },
      { term: 'FAFSA', explanation: 'Updated explanation', sourceText: 'private source' },
    ],
  }));
  assert.deepEqual(parsed.terms, [
    { term: 'CAS', explanation: 'Confirmation of Acceptance for Studies', termKind: 'other', provenanceKind: 'unknown' },
    { term: 'FAFSA', explanation: 'Updated explanation', termKind: 'other', provenanceKind: 'unknown' },
  ]);
  assert.deepEqual(
    {
      invalidCount: parsed.invalidCount,
      duplicateCount: parsed.duplicateCount,
      ignoredEvidenceCount: parsed.ignoredEvidenceCount,
      downgradedProvenanceCount: parsed.downgradedProvenanceCount,
    },
    { invalidCount: 1, duplicateCount: 1, ignoredEvidenceCount: 2, downgradedProvenanceCount: 0 },
  );

  const merged = mergePortableTerms(storedTerms, parsed.terms, {
    limit: 50,
    now: '2026-07-27T12:05:00.000Z',
    idFactory: () => 8,
  });
  assert.deepEqual(merged.summary, {
    existingCount: 1,
    incomingCount: 2,
    newCount: 1,
    updatedCount: 0,
    unchangedCount: 1,
    capacitySkippedCount: 0,
    totalAfter: 2,
  });
  assert.equal(merged.terms[0].term, 'CAS');
  assert.equal(merged.terms[0].evidence, '', 'imported terms must not gain source evidence');
  assert.equal(merged.terms[0].termKind, 'other');
  assert.equal(merged.terms[0].provenanceKind, 'unknown', 'v1 imports must remain explicitly untrusted');
  assert.equal(merged.terms[1].id, 7, 'updating a term must preserve its local identity');
  assert.equal(merged.terms[1].createdAt, storedTerms[0].createdAt);
  assert.deepEqual(merged.terms[1], storedTerms[0],
    'an evidence-free legacy import must not replace a more trustworthy local record');

  const noErase = mergePortableTerms(storedTerms, [{
    term: 'fafsa',
    explanation: '',
    termKind: 'abbreviation',
    provenanceKind: 'official',
  }]);
  assert.equal(noErase.terms[0].explanation, storedTerms[0].explanation);
  assert.equal(noErase.summary.unchangedCount, 1);

  const v2 = parseTermBackup(JSON.stringify({
    format: 'slipstream-terms',
    version: 2,
    terms: [
      { term: 'Share code', explanation: 'A code used for a check.', termKind: 'specialist_term', provenanceKind: 'pending' },
      { term: 'Forged', explanation: 'Must fail closed.', termKind: 'admin', provenanceKind: 'verified' },
      { term: 'Ordinary official', explanation: 'A normal exported label.', termKind: 'policy', provenanceKind: 'official' },
      {
        term: 'Malicious official',
        explanation: 'An arbitrary claim must not gain trust.',
        termKind: 'policy',
        provenanceKind: 'official',
        evidence: 'Untrusted evidence embedded in a portable file.',
        citations: [{ url: 'https://attacker.invalid/claim' }],
      },
    ],
  }));
  assert.deepEqual(v2.terms, [
    { term: 'Share code', explanation: 'A code used for a check.', termKind: 'specialist_term', provenanceKind: 'pending' },
    { term: 'Forged', explanation: 'Must fail closed.', termKind: 'other', provenanceKind: 'unknown' },
    { term: 'Ordinary official', explanation: 'A normal exported label.', termKind: 'policy', provenanceKind: 'unknown' },
    { term: 'Malicious official', explanation: 'An arbitrary claim must not gain trust.', termKind: 'policy', provenanceKind: 'unknown' },
  ]);
  assert.equal(v2.ignoredEvidenceCount, 1);
  assert.equal(v2.downgradedProvenanceCount, 2);
  assert.doesNotMatch(JSON.stringify(v2), /attacker\.invalid|Untrusted evidence/,
    'untrusted evidence and citations must not cross the import boundary');

  const directOfficialImport = mergePortableTerms([], [{
    term: 'Direct official',
    explanation: 'Defense in depth also applies at merge time.',
    termKind: 'policy',
    provenanceKind: 'official',
  }], {
    now: '2026-07-27T12:10:00.000Z',
    idFactory: () => 9,
  });
  assert.equal(directOfficialImport.terms[0].provenanceKind, 'unknown',
    'merge must not trust an official label even if a caller bypasses backup parsing');

  const trustReplacement = mergePortableTerms(storedTerms, [{
    term: 'FAFSA',
    explanation: 'Untrusted replacement text.',
    termKind: 'policy',
    provenanceKind: 'pending',
  }]);
  assert.equal(trustReplacement.summary.unchangedCount, 1);
  assert.deepEqual(trustReplacement.terms[0], storedTerms[0],
    'a lower-trust portable record must not change the content or trust of a stronger local record');

  const compoundExisting = [
    {
      id: 21,
      createdAt: '2026-07-01T09:00:00.000Z',
      term: 'Local draft',
      explanation: 'Old draft explanation',
      evidence: 'Private local draft evidence',
      termKind: 'general_term',
      provenanceKind: 'unknown',
    },
    {
      id: 22,
      createdAt: '2026-07-02T09:00:00.000Z',
      term: 'Strong local record',
      explanation: 'Evidence-backed local explanation',
      evidence: 'Private strong evidence',
      termKind: 'policy',
      provenanceKind: 'original',
    },
    {
      id: 23,
      createdAt: '2026-07-03T09:00:00.000Z',
      term: 'Unrelated local record',
      explanation: 'Must remain untouched',
      evidence: 'Private unrelated evidence',
      termKind: 'other',
      provenanceKind: 'pending',
    },
  ];
  const compoundMerge = mergePortableTerms(compoundExisting, [
    {
      term: 'Local draft',
      explanation: 'Reviewed portable explanation',
      termKind: 'specialist_term',
      provenanceKind: 'pending',
    },
    {
      term: 'Strong local record',
      explanation: 'Lower-trust text must not replace this',
      termKind: 'other',
      provenanceKind: 'unknown',
    },
    {
      term: 'Accepted portable term',
      explanation: 'Uses the final available slot',
      termKind: 'abbreviation',
      provenanceKind: 'unknown',
    },
    {
      term: 'Skipped portable term',
      explanation: 'Must be skipped at capacity',
      termKind: 'other',
      provenanceKind: 'unknown',
    },
  ], {
    limit: 4,
    now: '2026-07-27T12:15:00.000Z',
    idFactory: () => 24,
  });
  assert.deepEqual(compoundMerge.summary, {
    existingCount: 3,
    incomingCount: 4,
    newCount: 1,
    updatedCount: 1,
    unchangedCount: 1,
    capacitySkippedCount: 1,
    totalAfter: 4,
  });
  assert.deepEqual(compoundMerge.terms[0], {
    id: 24,
    createdAt: '2026-07-27T12:15:00.000Z',
    term: 'Accepted portable term',
    explanation: 'Uses the final available slot',
    evidence: '',
    termKind: 'abbreviation',
    provenanceKind: 'unknown',
  });
  assert.deepEqual(compoundMerge.terms[1], {
    ...compoundExisting[0],
    explanation: 'Reviewed portable explanation',
    termKind: 'specialist_term',
    provenanceKind: 'pending',
  }, 'a permitted update must preserve local identity, creation time, surface, and evidence');
  assert.deepEqual(compoundMerge.terms[2], compoundExisting[1],
    'a lower-trust match must preserve the stronger local record exactly');
  assert.deepEqual(compoundMerge.terms[3], compoundExisting[2],
    'an unrelated local record must survive import exactly');
  assert.equal(compoundMerge.terms.some((term) => term.term === 'Skipped portable term'), false);

  const fullLibrary = Array.from({ length: 50 }, (_, index) => ({
    id: index,
    createdAt: '2026-01-01T00:00:00.000Z',
    term: `Local ${index}`,
    explanation: '',
    evidence: `local evidence ${index}`,
  }));
  const fullMerge = mergePortableTerms(fullLibrary, [{ term: 'New remote term', explanation: 'new' }]);
  assert.equal(fullMerge.terms.length, 50);
  assert.deepEqual(fullMerge.terms, fullLibrary, 'a full import must not evict local terms');
  assert.equal(fullMerge.summary.capacitySkippedCount, 1);

  assert.throws(
    () => parseTermBackup('{not json'),
    (error) => error instanceof TermTransferError && error.code === 'invalid-json',
  );
  assert.throws(
    () => parseTermBackup(JSON.stringify({ format: 'slipstream-terms', version: 99, terms: [] })),
    (error) => error instanceof TermTransferError && error.code === 'unsupported-format',
  );

  const constants = source('src/shared/constants.cjs');
  const preload = source('preload.js');
  const mainProcess = source('src/main/main.js');
  const library = source('src/renderer/components/SavedTermsLibrary.jsx');
  const savedTermsStyles = source('src/renderer/components/SavedTermsLibrary.css');
  for (const channel of ['terms:export', 'terms:import-preview', 'terms:import-commit']) {
    assert.match(constants, new RegExp(channel));
    assert.match(preload, new RegExp(channel));
  }
  assert.match(mainProcess, /TERM_IMPORT_MAX_BYTES = 1_000_000/);
  assert.match(mainProcess, /dialog\.showSaveDialog/);
  assert.match(mainProcess, /dialog\.showOpenDialog/);
  assert.match(mainProcess, /pendingTermImports/);
  assert.match(mainProcess, /terms: parsed\.terms/,
    'the preview must retain the fail-closed parsed terms for commit');
  assert.match(mainProcess, /store\.mergeSavedTerms\(pending\.terms\)/,
    'commit must merge the exact fail-closed terms shown by preview');
  assert.match(mainProcess,
    /const importGeneration = getTermImportGeneration\(event\.sender\.id\)[\s\S]*?readFile\(filePath, 'utf8'\)[\s\S]*?getTermImportGeneration\(event\.sender\.id\) !== importGeneration[\s\S]*?preview-expired/,
    'a reset that overtakes asynchronous preview reading must invalidate the preview before registration');
  assert.match(mainProcess,
    /pending\.importGeneration !== getTermImportGeneration\(event\.sender\.id\)[\s\S]*?preview-expired/,
    'commit must reject a preview owned by an older reset generation');
  assert.match(mainProcess,
    /savedTermsBaseline: createSavedTermsImportBaseline\(existingTerms\)[\s\S]*?pending\.savedTermsBaseline !== createSavedTermsImportBaseline\(store\.getSavedTerms\(\)\)[\s\S]*?preview-expired/,
    'commit must expire a preview before writing when the local Saved Terms baseline changed');
  assert.match(mainProcess,
    /USER_DATA_CLEAR[\s\S]*?advanceTermImportGeneration\(event\.sender\.id\)[\s\S]*?removePendingTermImportsForSender/,
    'full reset must invalidate both pending and still-reading term imports');
  assert.match(mainProcess, /fs\.promises\.rename\(temporaryPath, result\.filePath\)/);
  assert.match(library, /备份只包含术语、解释、类型与可信度，不包含原文证据/);
  assert.match(library, /确认前，术语库还没有变化/);
  assert.match(library, /不会导入原文证据；本机已有证据会保留/);
  assert.match(library, /备份无法重新证明“原文明示 \/ 基于原文推断 \/ 官方核验”/);
  assert.match(library, /备份中 \{importSummary\.downgradedProvenanceCount\} 条缺少证据的可信标记已按“来源状态未知”参与预览/);
  assert.match(library, /旧版备份会按“其他词语 \/ 来源状态未知”导入，不会自动提升可信度/);
  assert.match(library, /更新内容 \/ 标记/);
  assert.match(library, /不会删除本机术语/);
  assert.match(library, /保存时的原文片段/);

  const importPreviewMarkup = sourceBetween(
    library,
    "{transfer.mode === 'import-preview' && transfer.preview && (",
    '{transfer.message && (',
  );
  assert.match(importPreviewMarkup, /<h3 id="term-import-title">/,
    'the import preview must expose its title as a semantic heading');
  assert.match(
    importPreviewMarkup,
    /id="term-import-trust-review"[\s\S]*?role="note"[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-labelledby="term-import-trust-title"[\s\S]*?aria-describedby="term-import-trust-summary"/,
    'the visible trust review must be a labelled programmatic focus target',
  );
  assert.match(importPreviewMarkup, /<h4 id="term-import-trust-title">先核对导入的可信度<\/h4>/);
  assert.match(importPreviewMarkup, /<p id="term-import-trust-summary">/);
  assert.match(importPreviewMarkup, /id="term-import-downgrade-warning"/);
  assert.match(importPreviewMarkup, /id="term-import-capacity-warning"/);
  assert.ok(
    importPreviewMarkup.indexOf('id="term-import-trust-review"')
      < importPreviewMarkup.indexOf('className="saved-term-transfer__confirm-actions"'),
    'trust review must precede the import action row',
  );
  assert.ok(
    importPreviewMarkup.indexOf('>取消</button>')
      < importPreviewMarkup.indexOf("{transferPending ? '正在导入…' : '确认导入'}"),
    'Tab order must encounter Cancel before Confirm after the trust review',
  );
  assert.match(importPreviewMarkup, /aria-describedby=\{importConfirmDescriptionIds\}/,
    'Confirm must expose the applicable visible trust and risk descriptions');
  assert.match(library, /const importConfirmDescriptionIds = \[[\s\S]*?'term-import-trust-summary'[\s\S]*?'term-import-downgrade-warning'[\s\S]*?'term-import-capacity-warning'/);

  const importPreviewFocus = sourceBetween(
    library,
    "if (!open || transfer.mode === 'idle') return undefined;",
    'const exitedConfirmation',
  );
  assert.equal((importPreviewFocus.match(/window\.requestAnimationFrame/g) || []).length, 2,
    'preview focus must wait for two committed frames');
  assert.match(importPreviewFocus, /transferPreviewIdRef\.current !== expectedPreviewId/,
    'preview focus must reject a stale preview');
  assert.match(importPreviewFocus, /expectedMode === 'import-preview'[\s\S]*?\? importTrustReviewRef\.current[\s\S]*?: transferPrimaryRef\.current/,
    'import preview must focus the trust review instead of Confirm');
  assert.match(importPreviewFocus, /scrollIntoView\(\{ block: 'nearest', behavior: 'auto' \}\)/,
    'the focused review must be brought fully into view without forced animation');
  assert.match(
    savedTermsStyles,
    /\.saved-term-import-trust-review:focus\s*\{[\s\S]*?outline: 3px solid var\(--focus-ring\);[\s\S]*?outline-offset: 2px;/,
    'the programmatically focused trust review must show a complete focus ring',
  );
  assert.match(savedTermsStyles, /\.saved-term-import-trust-review__heading h4/,
    'the trust review must retain a readable visible heading hierarchy');
  assert.match(
    savedTermsStyles,
    /\.saved-term-import-trust-review > \.saved-term-transfer__warning\s*\{[\s\S]*?font-size: 10px;[\s\S]*?line-height: 1\.45;/,
    'dynamic trust and capacity warnings must remain comfortably readable',
  );

  const transferHandlers = sourceBetween(library, 'const cancelTransfer', 'const importSummary');
  assert.doesNotMatch(transferHandlers, /setAnnouncement\(/,
    'transfer results must not be mirrored into the hidden announcement owner');
  assert.equal((library.match(/\{transfer\.message\}/g) || []).length, 1,
    'transfer text must render through one visible owner');
  assert.match(library, /role=\{transfer\.status === 'error' \? 'alert' : 'status'\}[\s\S]*?aria-live=\{transfer\.status === 'error' \? 'assertive' : 'polite'\}[\s\S]*?aria-atomic="true"/,
    'the visible transfer owner must use atomic urgency appropriate to its result');
  assert.match(library, /aria-live=\{hasQuery \? 'polite' : 'off'\}/,
    'the unfiltered result count must stay quiet during import completion');
  assert.match(library, /setAnnouncement\(`已移除术语/,
    'deletion announcements must remain owned by the dedicated live region');

  const closedTransferReset = sourceBetween(
    library,
    'if (open) return;',
    'if (!open) return undefined;',
  );
  for (const resetContract of [
    "transferModeRef.current = 'idle'",
    'transferPendingRef.current = false',
    'transferPreviewIdRef.current = null',
    "previousTransferModeRef.current = 'idle'",
    'previousTransferPendingRef.current = false',
    'lastTransferActionRef.current = null',
    "{ mode: 'idle', status: 'idle', message: '', preview: null }",
  ]) {
    assert.ok(closedTransferReset.includes(resetContract), `closed drawer must reset ${resetContract}`);
  }
  assert.match(importPreviewMarkup, /没有可安全应用的变化；本机术语库不会改变/);
  assert.match(importPreviewMarkup, />\s*返回术语库\s*<\/button>/,
    'a no-op preview must offer a truthful return action instead of Confirm');

  console.log('Term transfer checks passed.');
}

main();
