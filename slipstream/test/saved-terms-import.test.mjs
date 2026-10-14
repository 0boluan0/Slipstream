// Behavior of the frozen term-library import protocol. Replaces two assertions
// that only matched the validators' source text.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidSavedTermsImportCommit,
  isValidSavedTermsImportPreview,
} from '../src/renderer/legacy/savedTermsImport.mjs';

const existing = [{
  id: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  term: 'Portal',
  explanation: 'An entry point.',
  evidence: 'Use the portal.',
  termKind: 'portal',
  provenanceKind: 'original',
}];
const planTerms = [{ term: 'Intake form', explanation: 'The form to submit.', termKind: 'form', provenanceKind: 'unknown' }];
const summary = {
  existingCount: 1, incomingCount: 1, newCount: 1, updatedCount: 0, unchangedCount: 0, capacitySkippedCount: 0,
  totalAfter: 2, invalidCount: 0, duplicateCount: 0, ignoredEvidenceCount: 0, downgradedProvenanceCount: 0,
};
const previewResponse = { status: 'ready', previewId: 'preview-1', fileName: 'terms.json', examples: ['Intake form'], summary, planTerms };
const trustedPreview = { previewId: 'preview-1', fileName: 'terms.json', summary: { ...summary }, planTerms };
const imported = { id: 2, createdAt: '2026-01-02T00:00:00.000Z', term: 'Intake form', explanation: 'The form to submit.',
  evidence: '', termKind: 'form', provenanceKind: 'unknown' };
const commitResponse = { status: 'imported', fileName: 'terms.json', summary: { ...summary }, savedTerms: [imported, ...existing] };

test('a preview whose summary matches its sanitized plan is accepted', () => {
  assert.equal(isValidSavedTermsImportPreview(previewResponse, existing), true);
});

test('previews with unbounded identifiers, extra examples or a mismatched plan fail closed', () => {
  const rejected = {
    'non-ready status': { ...previewResponse, status: 'failed' },
    'oversized preview id': { ...previewResponse, previewId: 'x'.repeat(101) },
    'missing file name': { ...previewResponse, fileName: '  ' },
    'more than five examples': { ...previewResponse, examples: Array(6).fill('Intake form') },
    'examples out of plan order': { ...previewResponse, examples: ['Something else'] },
    'summary disagreeing with the plan': { ...previewResponse, summary: { ...summary, newCount: 0, totalAfter: 1 } },
    'unsanitized plan text': { ...previewResponse, planTerms: [{ ...planTerms[0], term: ' Intake form ' }] },
  };
  for (const [reason, response] of Object.entries(rejected)) {
    assert.equal(isValidSavedTermsImportPreview(response, existing), false, reason);
  }
});

test('a commit that reproduces the planned list from the same file is accepted', () => {
  assert.equal(isValidSavedTermsImportCommit(commitResponse, existing, trustedPreview), true);
});

test('commits from another file, with changed counts or an unplanned list are rejected', () => {
  const rejected = {
    'another file': { ...commitResponse, fileName: 'other.json' },
    'changed summary field': { ...commitResponse, summary: { ...summary, ignoredEvidenceCount: 1 } },
    'non-canonical saved term': { ...commitResponse, savedTerms: [{ ...imported, id: -2 }, ...existing] },
    'unplanned extra term': { ...commitResponse, savedTerms: [imported, ...existing, { ...imported, id: 3, term: 'Receipt' }] },
    'imported evidence': { ...commitResponse, savedTerms: [{ ...imported, evidence: 'copied from the file' }, ...existing] },
    'reordered list': { ...commitResponse, savedTerms: [...existing, imported] },
  };
  for (const [reason, response] of Object.entries(rejected)) {
    assert.equal(isValidSavedTermsImportCommit(response, existing, trustedPreview), false, reason);
  }
  assert.equal(isValidSavedTermsImportCommit(commitResponse, existing, null), false, 'no trusted preview');
});
