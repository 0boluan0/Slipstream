import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  filterSavedTerms,
  getSavedTermCopyText,
  getSavedTermMetadata,
  isCanonicalSavedTerm,
  isCanonicalSavedTerms,
  upsertSavedTerm,
} from '../src/renderer/utils/savedTerms.mjs';

const canonical = {
  id: 1785142800000,
  createdAt: '2026-07-27T09:00:00.000Z',
  term: 'passport information page',
  explanation: '护照个人信息页。',
  evidence: 'passport information page',
  termKind: 'specialist_term',
  provenanceKind: 'original',
};

assert.equal(isCanonicalSavedTerm(canonical), true);
assert.equal(isCanonicalSavedTerms([canonical]), true);
assert.equal(isCanonicalSavedTerms([]), true);
assert.equal(isCanonicalSavedTerms([null]), false);
assert.equal(isCanonicalSavedTerm({ ...canonical, id: 'undeletable-id' }), false);
assert.equal(isCanonicalSavedTerm({ ...canonical, provenanceKind: undefined }), false);
assert.equal(isCanonicalSavedTerms([canonical, { ...canonical }]), false);
assert.equal(isCanonicalSavedTerms([
  canonical,
  { ...canonical, id: canonical.id + 1, term: canonical.term.toUpperCase() },
]), false);

const fiftyTerms = Array.from({ length: 50 }, (_, index) => ({
  ...canonical,
  id: canonical.id + index,
  term: `term-${index}`,
}));
const cappedTerms = upsertSavedTerm(fiftyTerms, {
  ...canonical,
  id: canonical.id + 100,
  term: 'newest-term',
});
assert.equal(cappedTerms.length, 50);
assert.equal(cappedTerms[0].term, 'newest-term');
assert.equal(cappedTerms.some((term) => term.term === 'term-49'), false);

const pending = {
  term: 'eVisa share code',
  explanation: '用于证明移民身份的代码。',
  termKind: 'specialist_term',
  provenanceKind: 'pending',
  evidence: 'PRIVATE SOURCE EXCERPT',
};

assert.deepEqual(getSavedTermMetadata(pending), {
  termKind: 'specialist_term',
  termKindLabel: '专业术语',
  provenanceKind: 'pending',
  provenanceLabel: '待核验',
  warning: '提醒：这个术语的解释仍待核验，请勿作为已确认事实使用。',
});

for (const kind of ['term', 'explanation', 'combined']) {
  const copied = getSavedTermCopyText(pending, kind);
  assert.match(copied, /类型：专业术语/);
  assert.match(copied, /可信度：待核验/);
  assert.match(copied, /请勿作为已确认事实使用/);
  assert.doesNotMatch(copied, /原文片段/);
  assert.doesNotMatch(copied, /PRIVATE SOURCE EXCERPT/);
}

const legacy = { term: 'CAS', explanation: '录取确认文件。', termKind: 'forged', provenanceKind: 'verified' };
const legacyMetadata = getSavedTermMetadata(legacy);
assert.equal(legacyMetadata.termKind, 'other');
assert.equal(legacyMetadata.provenanceKind, 'unknown');
assert.match(getSavedTermCopyText(legacy, 'combined'), /来源状态未知/);
assert.match(getSavedTermCopyText(legacy, 'combined'), /返回原文或官方来源核对/);

assert.equal(filterSavedTerms([pending, legacy], '待核验').length, 1);
assert.equal(filterSavedTerms([pending, legacy], '其他词语 来源状态未知').length, 1);
assert.equal(getSavedTermCopyText({ term: 'No definition' }, 'explanation'), '');

const [panelSource, storeSource, librarySource] = await Promise.all([
  readFile(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/store.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/SavedTermsLibrary.jsx', import.meta.url), 'utf8'),
]);
assert.match(panelSource, /termKind:\s*term\.kind/,
  'saving a result term must carry its classification across the IPC boundary');
assert.match(panelSource, /provenanceKind:\s*term\.provenance\?\.kind/,
  'saving a result term must carry its trust state across the IPC boundary');
assert.match(storeSource, /termKind:\s*SAVED_TERM_KINDS\.has/,
  'persistent saved terms must strictly normalize classification');
assert.match(storeSource, /provenanceKind:\s*SAVED_TERM_PROVENANCE_KINDS\.has/,
  'persistent saved terms must strictly normalize trust state');
assert.match(librarySource, /类型：\{metadata\.termKindLabel\} · 可信度：\{metadata\.provenanceLabel\}/,
  'the library card must keep classification and trust visible after reload');
assert.match(librarySource, /保存时的原文片段/,
  'retained evidence must not be presented as proof of the saved explanation');

console.log('Saved term trust checks passed.');
