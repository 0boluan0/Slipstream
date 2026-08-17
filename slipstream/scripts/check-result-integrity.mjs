import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EVIDENCE_COLORS,
  buildReplyDraft,
  composeReplyDraft,
  composeActionChecklistText,
  composeCompleteResultText,
  getEvidenceNavigationAnnouncement,
  getReplyDraftPlaceholders,
  isTranslationOnlyBrief,
  shouldOfferReply,
} from '../src/renderer/utils/evidenceMapping.mjs';
import {
  getProcessingConfigSignature,
  isProcessingConfigGenerationCurrent,
  PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
  resolveSnapshotWarning,
  shouldRestoreLastGoodAfterConfigChange,
  withVerificationApproval,
} from '../src/renderer/utils/processingConfig.mjs';
import {
  completeTaskForGeneration,
  createRequestCoordinator,
} from '../src/renderer/hooks/requestCoordinator.mjs';
import { formatResultTiming } from '../src/renderer/utils/resultTiming.mjs';
import {
  filterSavedTerms,
  getSavedTermCopyText,
  hasSavedTerm,
  isSavedTermsImportCommitConsistent,
  isSavedTermsImportPlanSummaryConsistent,
  isValidSavedTermsImportSummary,
  upsertSavedTerm,
} from '../src/renderer/utils/savedTerms.mjs';
import {
  hasModifiedSourceEditDraft,
  openSourceEditDraft,
  updateSourceEditDraft,
} from '../src/renderer/utils/sourceEditDraft.mjs';
import {
  getProcessingPrivacyDisclosure,
  getProcessingSourceSummary,
  resolveResultProcessingSnapshot,
} from '../src/renderer/utils/processingPrivacy.mjs';
import {
  PROCESSING_CANCELLED_RESULT_NOTICE,
  PROCESSING_CANCELLED_SOURCE_NOTICE,
  PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE,
  PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE,
  PROCESSING_COMPLETED_BEFORE_SETTINGS_NOTICE,
  PROCESSING_COMPLETED_DURING_CANCEL_NOTICE,
  processingCancelFailureMessage,
  processingSettingsGuardMessage,
} from '../src/renderer/utils/processingCancellation.mjs';

assert.equal(PROCESSING_CANCELLED_SOURCE_NOTICE, '处理已停止；原文仍保留，你可以修改后重新生成。');
assert.equal(PROCESSING_CANCELLED_RESULT_NOTICE, '处理已停止；已返回上一份结果。');
assert.match(PROCESSING_COMPLETED_DURING_CANCEL_NOTICE, /任务已经完成/);
assert.match(PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE, /停止请求未能确认/);
assert.match(PROCESSING_COMPLETED_BEFORE_SETTINGS_NOTICE, /未自动打开设置/);
assert.match(PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE, /未自动打开设置/);
assert.match(processingCancelFailureMessage('online'), /可能仍在处理并产生费用/);
assert.doesNotMatch(processingCancelFailureMessage('local'), /费用/);
assert.match(processingCancelFailureMessage('local-loopback'), /本机兼容服务/);
assert.match(processingCancelFailureMessage('local-loopback'), /取决于自己的配置/);
assert.match(processingSettingsGuardMessage('online'), /已经发送给在线服务[\s\S]*重复费用/);
assert.match(processingSettingsGuardMessage('online', true), /返回上一份结果/);
assert.doesNotMatch(processingSettingsGuardMessage('local'), /费用/);
assert.match(processingSettingsGuardMessage('local-loopback'), /本机回环地址/);
assert.match(processingSettingsGuardMessage('unknown'), /位置无法确认/);

assert.deepEqual(getProcessingPrivacyDisclosure('ollama', { processingLocation: 'local' }), {
  location: 'local',
  providerLabel: 'Ollama',
  headerLabel: '本地处理 · 隐私优先',
  title: '将在这台 Mac 上分析',
  detail: '原文不会发送给模型服务商；若模型提出待办，会在本机再做一次短复核。截图 OCR 始终在本机，官方来源核验另行征求允许。',
  activeTitle: '正在这台 Mac 上分析',
  activeDetail: '原文仍在本机；若模型提出待办，会在本机再做一次短复核。',
  resultTitle: '本次在这台 Mac 上完成分析',
  resultDetail: '原文没有发送给模型服务商；官方来源核验仅在你允许时另行联网。',
  footer: '原文不会发送给模型服务商；官方来源核验只在你允许时进行。',
});
assert.equal(
  getProcessingPrivacyDisclosure('ollama', { processingLocation: 'unknown' }).location,
  'unknown',
  'Ollama must not claim local processing when its saved endpoint is not a verified HTTP loopback',
);
assert.match(
  getProcessingPrivacyDisclosure('ollama', { processingLocation: 'unknown' }).resultTitle,
  /处理位置未记录/,
);
assert.equal(getProcessingPrivacyDisclosure('openai').title, '将发送给 OpenAI');
assert.match(getProcessingPrivacyDisclosure('openai').detail, /完整原文会发送/);
assert.match(getProcessingPrivacyDisclosure('openai').detail, /再发送一次做短复核/);
assert.match(getProcessingPrivacyDisclosure('openai').detail, /第二次调用费用/);
assert.equal(getProcessingPrivacyDisclosure('openai').activeTitle, '正在由 OpenAI 分析');
assert.match(getProcessingPrivacyDisclosure('openai').activeDetail, /已发送/);
const freeTranslationDisclosure = getProcessingPrivacyDisclosure('free_translate');
assert.equal(freeTranslationDisclosure.providerLabel, 'Google Translate / MyMemory');
assert.match(freeTranslationDisclosure.detail, /先发送给 Google Translate/);
assert.match(freeTranslationDisclosure.detail, /再发送给备用 MyMemory/);
assert.match(freeTranslationDisclosure.activeDetail, /若失败/);
assert.equal(getProcessingPrivacyDisclosure(null).location, 'unknown');
const localCustomDisclosure = getProcessingPrivacyDisclosure({
  activeBackend: 'custom',
  customEndpointUrl: 'http://127.0.0.1:8000/v1',
});
assert.equal(localCustomDisclosure.location, 'local-loopback');
assert.equal(localCustomDisclosure.providerLabel, '本机兼容服务');
assert.match(localCustomDisclosure.title, /这台 Mac 上的兼容服务/);
assert.match(localCustomDisclosure.detail, /是否再联网、转发、留存或计费取决于它自己的配置/);
assert.match(localCustomDisclosure.detail, /再发送一次做短复核/);
assert.doesNotMatch(localCustomDisclosure.activeDetail, /在线服务/);
assert.match(localCustomDisclosure.resultTitle, /这台 Mac 上的兼容服务完成分析/);
assert.match(localCustomDisclosure.resultDetail, /本机回环地址/);
const remoteCustomDisclosure = getProcessingPrivacyDisclosure({
  activeBackend: 'custom',
  customEndpointUrl: 'https://api.example.com/v1',
});
assert.equal(remoteCustomDisclosure.location, 'online');
assert.equal(remoteCustomDisclosure.providerLabel, '远程自定义服务');
assert.equal(remoteCustomDisclosure.title, '将发送给远程自定义服务');
assert.equal(remoteCustomDisclosure.activeTitle, '正在由远程自定义服务分析');
assert.match(remoteCustomDisclosure.activeDetail, /在线服务/);
assert.equal(getProcessingPrivacyDisclosure('custom').location, 'unknown');
assert.equal(getProcessingPrivacyDisclosure('custom', {
  processingLocation: 'local-loopback',
}).location, 'local-loopback', 'a task snapshot must remain local-loopback after settings change');
assert.equal(getProcessingPrivacyDisclosure('custom', {
  processingLocation: 'online',
}).location, 'online', 'a task snapshot must remain online after settings change');
const legacyTextOnlySnapshot = resolveResultProcessingSnapshot(null, {
  processingProvider: 'custom',
  processingLocation: 'local-loopback',
  result: 'legacy text-only result',
});
assert.deepEqual(legacyTextOnlySnapshot, {
  provider: 'custom',
  location: 'local-loopback',
});
assert.match(
  getProcessingPrivacyDisclosure(legacyTextOnlySnapshot.provider, {
    processingLocation: legacyTextOnlySnapshot.location,
  }).resultTitle,
  /这台 Mac 上的兼容服务完成分析/,
  'a legacy/text-only result must disclose its lastGood historical destination',
);
assert.deepEqual(resolveResultProcessingSnapshot({
  analysisProvenance: { provider: 'openai', processingLocation: 'online' },
}, null), { provider: 'openai', location: 'online' });
assert.deepEqual(getProcessingSourceSummary('ocr', 355), {
  title: '截图 OCR 原文',
  detail: '完整原文已保留 · 355 个字符；为避免旁观泄露，处理时不重复显示内容。',
});
assert.equal(getProcessingSourceSummary('sample', 42).title, '安全示例原文');
assert.equal(getProcessingSourceSummary('unknown', -10).detail.includes('0 个字符'), true);

const originalSource = 'Dear Student, submit the passport scan.';
const firstEditDraft = openSourceEditDraft(originalSource);
assert.deepEqual(firstEditDraft, { baseSourceText: originalSource, text: originalSource });
const correctedDraft = updateSourceEditDraft(
  firstEditDraft,
  'Dear Student: submit the passport scan.',
);
assert.equal(hasModifiedSourceEditDraft(correctedDraft, originalSource), true);
assert.deepEqual(openSourceEditDraft(originalSource, correctedDraft), correctedDraft,
  'a failed corrected analysis must reopen the exact unsaved draft');
assert.deepEqual(
  openSourceEditDraft('A newer source', correctedDraft),
  { baseSourceText: 'A newer source', text: 'A newer source' },
  'a draft from an older result must never leak into a newer source');
assert.equal(hasModifiedSourceEditDraft(correctedDraft, 'A newer source'), false);

assert.equal(
  formatResultTiming({ processingTimeMs: 6800, verificationTimeMs: 520 }),
  '分析 6.8 秒 · 最近核验 0.5 秒',
);
assert.equal(
  formatResultTiming({ processingTimeMs: 1200, verificationTimeMs: null, translationOnly: true }),
  '翻译 1.2 秒',
);
assert.equal(formatResultTiming({ processingTimeMs: null, verificationTimeMs: null }), '已处理');

const savedTerm = { id: 1, term: 'eVisa share code', explanation: 'A saved explanation' };
assert.equal(hasSavedTerm([savedTerm], '  EVISA SHARE CODE '), true);
assert.deepEqual(
  upsertSavedTerm([savedTerm, { id: 2, term: 'CAS' }], { id: 3, term: 'eVisa share code', explanation: 'Updated' }),
  [{ id: 3, term: 'eVisa share code', explanation: 'Updated' }, { id: 2, term: 'CAS' }],
  'renderer term state must replace a case-insensitive duplicate instead of appending it',
);
const canonicalSavedTerm = (overrides = {}) => ({
  id: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  term: 'CAS',
  explanation: 'Confirmation of Acceptance for Studies',
  evidence: 'Your CAS number',
  termKind: 'abbreviation',
  provenanceKind: 'unknown',
  ...overrides,
});
const importExistingTerms = [
  canonicalSavedTerm(),
  canonicalSavedTerm({
    id: 2,
    term: 'eVisa share code',
    explanation: 'A code used to prove immigration status',
    evidence: 'Provide your eVisa share code',
    termKind: 'specialist_term',
  }),
];
const importPlanTerms = [
  {
    term: 'CAS',
    explanation: 'A reference number issued for a confirmed course place',
    termKind: 'abbreviation',
    provenanceKind: 'unknown',
  },
  {
    term: 'eVisa share code',
    explanation: 'A code used to prove immigration status',
    termKind: 'specialist_term',
    provenanceKind: 'unknown',
  },
  {
    term: 'BRP',
    explanation: 'Biometric Residence Permit',
    termKind: 'abbreviation',
    provenanceKind: 'unknown',
  },
];
const importCommittedTerms = [
  canonicalSavedTerm({
    id: 3,
    createdAt: '2026-08-02T12:00:00.000Z',
    term: 'BRP',
    explanation: 'Biometric Residence Permit',
    evidence: '',
  }),
  canonicalSavedTerm({ explanation: 'A reference number issued for a confirmed course place' }),
  importExistingTerms[1],
];
const honestImportSummary = {
  existingCount: 2,
  incomingCount: 3,
  newCount: 1,
  updatedCount: 1,
  unchangedCount: 1,
  capacitySkippedCount: 0,
  totalAfter: 3,
};
const honestImportProtocolSummary = {
  ...honestImportSummary,
  invalidCount: 1,
  duplicateCount: 1,
  ignoredEvidenceCount: 2,
  downgradedProvenanceCount: 1,
};
assert.equal(isValidSavedTermsImportSummary(honestImportProtocolSummary, 3), true);
assert.equal(
  isValidSavedTermsImportSummary({
    ...honestImportProtocolSummary,
    ignoredEvidenceCount: 6,
  }),
  false,
  'ignored-evidence count cannot exceed the raw backup term population',
);
assert.equal(
  isValidSavedTermsImportSummary({
    ...honestImportProtocolSummary,
    invalidCount: 498,
  }),
  false,
  'valid, invalid, and duplicate backup entries must stay within the parser limit',
);
assert.equal(
  isSavedTermsImportPlanSummaryConsistent(
    importExistingTerms,
    importPlanTerms,
    honestImportSummary,
  ),
  true,
  'an import preview summary must reconcile with the sanitized incoming plan',
);
assert.equal(
  isSavedTermsImportCommitConsistent(
    importExistingTerms,
    importPlanTerms,
    importCommittedTerms,
    honestImportSummary,
  ),
  true,
  'an import commit must reconcile with both the incoming plan and returned Saved Terms snapshot',
);
assert.equal(
  isSavedTermsImportPlanSummaryConsistent(importExistingTerms, importPlanTerms, {
    ...honestImportSummary,
    updatedCount: 0,
    unchangedCount: 2,
  }),
  false,
  'a self-consistent updated/unchanged swap must not be published',
);
assert.equal(
  isSavedTermsImportCommitConsistent(
    importExistingTerms,
    importPlanTerms,
    importCommittedTerms.slice(0, 2),
    honestImportSummary,
  ),
  false,
  'an import commit must not silently remove an existing normalized term',
);
for (const field of ['id', 'createdAt', 'term', 'evidence']) {
  const changed = importCommittedTerms.map((term, index) => (
    index === 1 ? {
      ...term,
      [field]: field === 'id'
        ? 99
        : field === 'createdAt'
          ? '2026-08-03T12:00:00.000Z'
          : `${term[field]} changed`,
    } : term
  ));
  assert.equal(
    isSavedTermsImportCommitConsistent(
      importExistingTerms,
      importPlanTerms,
      changed,
      honestImportSummary,
    ),
    false,
    `an import commit must preserve the existing term ${field}`,
  );
}
assert.equal(
  isSavedTermsImportCommitConsistent(
    importExistingTerms,
    importPlanTerms,
    [{ ...importCommittedTerms[0], evidence: 'forged evidence' }, ...importCommittedTerms.slice(1)],
    honestImportSummary,
  ),
  false,
  'a newly imported term must never recreate source evidence',
);
assert.equal(
  isSavedTermsImportCommitConsistent(
    importExistingTerms,
    importPlanTerms,
    [{ ...importCommittedTerms[0], provenanceKind: 'official' }, ...importCommittedTerms.slice(1)],
    honestImportSummary,
  ),
  false,
  'a newly imported term must never gain evidence-bound trust',
);
const strongLocalTerm = canonicalSavedTerm({ provenanceKind: 'original' });
const weakerImportPlan = [{
  term: 'CAS',
  explanation: 'A lower-trust replacement',
  termKind: 'other',
  provenanceKind: 'unknown',
}];
const rejectedReplacementSummary = {
  existingCount: 1,
  incomingCount: 1,
  newCount: 0,
  updatedCount: 0,
  unchangedCount: 1,
  capacitySkippedCount: 0,
  totalAfter: 1,
};
assert.equal(
  isSavedTermsImportCommitConsistent(
    [strongLocalTerm],
    weakerImportPlan,
    [strongLocalTerm],
    rejectedReplacementSummary,
  ),
  true,
  'a lower-trust portable term may be counted only as an unchanged local record',
);
assert.equal(
  isSavedTermsImportCommitConsistent(
    [strongLocalTerm],
    weakerImportPlan,
    [{ ...strongLocalTerm, explanation: 'A lower-trust replacement' }],
    rejectedReplacementSummary,
  ),
  false,
  'a portable import must not modify a stronger local record',
);
const nearlyFullImportExisting = Array.from({ length: 49 }, (_, index) => canonicalSavedTerm({
  id: 100 + index,
  term: `Existing ${index + 1}`,
  explanation: `Existing explanation ${index + 1}`,
  evidence: '',
}));
const capacityImportPlan = [
  {
    term: nearlyFullImportExisting[0].term,
    explanation: nearlyFullImportExisting[0].explanation,
    termKind: nearlyFullImportExisting[0].termKind,
    provenanceKind: nearlyFullImportExisting[0].provenanceKind,
  },
  {
    term: 'Accepted at capacity',
    explanation: 'The final available slot',
    termKind: 'other',
    provenanceKind: 'unknown',
  },
  {
    term: 'Skipped at capacity',
    explanation: 'Must not appear in the committed list',
    termKind: 'other',
    provenanceKind: 'unknown',
  },
];
const capacityImportSummary = {
  existingCount: 49,
  incomingCount: 3,
  newCount: 1,
  updatedCount: 0,
  unchangedCount: 1,
  capacitySkippedCount: 1,
  totalAfter: 50,
};
const capacityCommittedTerms = [
  canonicalSavedTerm({
    id: 999,
    createdAt: '2026-08-02T14:00:00.000Z',
    term: 'Accepted at capacity',
    explanation: 'The final available slot',
    evidence: '',
    termKind: 'other',
  }),
  ...nearlyFullImportExisting,
];
assert.equal(
  isSavedTermsImportCommitConsistent(
    nearlyFullImportExisting,
    capacityImportPlan,
    capacityCommittedTerms,
    capacityImportSummary,
  ),
  true,
  'the import oracle must independently prove unchanged and capacity-skipped counts',
);
for (const [unchangedCount, capacitySkippedCount] of [[2, 0], [0, 2]]) {
  assert.equal(
    isSavedTermsImportPlanSummaryConsistent(
      nearlyFullImportExisting,
      capacityImportPlan,
      { ...capacityImportSummary, unchangedCount, capacitySkippedCount },
    ),
    false,
    'a self-consistent unchanged/capacity swap must not pass plan-backed validation',
  );
}
const searchableTerms = [
  savedTerm,
  { id: 2, term: 'CAS', explanation: 'Confirmation of Acceptance for Studies', evidence: 'Your CAS number' },
  { id: 3, term: 'received', explanation: '材料必须被对方收到', evidence: 'must be received by Friday' },
];
assert.deepEqual(filterSavedTerms(searchableTerms, '  EVISA   code  '), [savedTerm]);
assert.deepEqual(filterSavedTerms(searchableTerms, '对方收到'), [searchableTerms[2]]);
assert.deepEqual(filterSavedTerms(searchableTerms, 'your number'), [searchableTerms[1]]);
assert.deepEqual(filterSavedTerms(searchableTerms, 'not present'), []);
assert.equal(hasSavedTerm([{ id: 4, term: 'ＣＡＳ' }], 'CAS'), true, 'full-width variants must deduplicate');
assert.equal(
  getSavedTermCopyText(savedTerm, 'term'),
  '术语：eVisa share code\n类型：其他词语\n可信度：来源状态未知\n提醒：这个术语的来源状态未知，请返回原文或官方来源核对。',
);
assert.equal(
  getSavedTermCopyText(savedTerm, 'explanation'),
  '解释：A saved explanation\n类型：其他词语\n可信度：来源状态未知\n提醒：这个术语的来源状态未知，请返回原文或官方来源核对。',
);
assert.equal(
  getSavedTermCopyText({ ...savedTerm, evidence: 'Sensitive source excerpt' }, 'combined'),
  '术语：eVisa share code\n解释：A saved explanation\n类型：其他词语\n可信度：来源状态未知\n提醒：这个术语的来源状态未知，请返回原文或官方来源核对。',
  'combined reuse must preserve trust metadata without silently including retained source evidence',
);
assert.equal(getSavedTermCopyText({ term: 'CAS' }, 'explanation'), '');
assert.equal(getSavedTermCopyText(savedTerm, 'unknown'), '');

function provenance(quote = null) {
  return {
    kind: quote ? 'original' : 'pending',
    confidence: quote ? 0.99 : null,
    note: null,
    evidence: quote ? [{ quote, start: 0, end: quote.length, match: 'exact', ambiguous: false }] : [],
    citations: [],
  };
}

function briefWith(overrides = {}) {
  return {
    status: 'complete',
    translation: { text: '请提交材料并回复邮件。', provenance: provenance() },
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    warnings: [],
    ...overrides,
  };
}

{
  const basicSettings = {
    activeBackend: 'free_translate',
    activeModel: 'google',
    hasAnthropicApiKey: false,
    hasOpenaiApiKey: false,
    hasDeepseekApiKey: false,
    ollamaBaseUrl: 'http://localhost:11434',
    customEndpointUrl: '',
    hasCustomEndpointApiKey: false,
    customPrompt: '',
    verificationPolicy: 'ask',
  };
  const ollamaSettings = {
    ...basicSettings,
    activeBackend: 'ollama',
    activeModel: 'gpt-oss:20b',
  };
  const basicSignature = getProcessingConfigSignature(basicSettings);
  const ollamaSignature = getProcessingConfigSignature(ollamaSettings);
  const snapshot = { processingConfigSignature: basicSignature, warning: '' };

  assert.equal(resolveSnapshotWarning(snapshot, basicSignature), '');
  assert.equal(
    resolveSnapshotWarning(snapshot, ollamaSignature),
    PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
  );
  assert.equal(
    resolveSnapshotWarning(snapshot, ollamaSignature, 'Ollama failed.'),
    `${PRESERVED_RESULT_CONFIG_CHANGED_WARNING} Ollama failed.`,
  );
  // A basic result remains current after A → B → A. A monotonic settings
  // revision may trigger reconciliation, but must not make this result stale.
  assert.equal(resolveSnapshotWarning(snapshot, getProcessingConfigSignature({ ...basicSettings })), '');
  assert.notEqual(
    basicSignature,
    getProcessingConfigSignature({ ...basicSettings, customPrompt: 'Different prompt' }),
  );
  assert.notEqual(
    basicSignature,
    getProcessingConfigSignature({ ...basicSettings, verificationPolicy: 'local-only' }),
  );
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: true }, snapshot), true);
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: false }, snapshot), false);
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: true }, null), false);
  assert.equal(
    withVerificationApproval({ ...snapshot, verificationApprovalId: 'dead-token' }, null).verificationApprovalId,
    null,
  );
}

{
  assert.equal(isProcessingConfigGenerationCurrent(7, 7), true);
  assert.equal(isProcessingConfigGenerationCurrent(7, 8), false);

  // Interleaving regression: a settings update can advance the synchronous
  // generation while an IPC response is resolving, before React runs effects.
  // Invalidating before complete makes that old response ineligible to apply.
  const coordinator = createRequestCoordinator();
  const task = coordinator.schedule({ source: 'generation-race' });
  const requestGeneration = 7;
  const currentGeneration = 8;
  if (!isProcessingConfigGenerationCurrent(requestGeneration, currentGeneration)) {
    coordinator.invalidate();
  }
  assert.deepEqual(coordinator.complete(task), { apply: false, next: null });
}

{
  const configSignatures = new Map([
    [10, 'config-a'],
    [11, 'config-b'],
    [12, 'config-c'],
  ]);

  const createConfigRace = ({ retryOfLastGood, hasLastGood }) => {
    const coordinator = createRequestCoordinator();
    const task = coordinator.schedule({ options: { retryOfLastGood } });
    const lastGood = hasLastGood
      ? { processingConfigSignature: configSignatures.get(10), warning: '' }
      : null;
    let liveGeneration = 11;
    let status = 'processing';
    let warning = null;
    let warningWrittenByGeneration = null;
    let invocationRejected = false;
    let activeProcessing = {
      taskId: task.id,
      retryOfLastGood,
      configGeneration: 10,
    };
    let resolveInvocation;
    let rejectInvocation;
    const invocation = new Promise((resolve, reject) => {
      resolveInvocation = resolve;
      rejectInvocation = reject;
    });

    const restoreForGeneration = (generation) => {
      if (!lastGood) return false;
      status = 'done';
      warning = resolveSnapshotWarning(lastGood, configSignatures.get(generation));
      warningWrittenByGeneration = generation;
      return true;
    };

    const completion = (async () => {
      try {
        await invocation;
      } catch {
        invocationRejected = true;
      }
      const completionOwnsActiveProcessing = activeProcessing?.taskId === task.id;
      const completionResult = completeTaskForGeneration(coordinator, task, {
        generationIsCurrent: isProcessingConfigGenerationCurrent(10, liveGeneration),
        restoreLastGoodIfStale: completionOwnsActiveProcessing
          && shouldRestoreLastGoodAfterConfigChange(task.payload.options, lastGood),
      });
      if (!completionResult.next
        && completionOwnsActiveProcessing
        && !completionResult.restoreLastGood) {
        activeProcessing = null;
      }
      if (completionResult.restoreLastGood) restoreForGeneration(10);
      return completionResult;
    })();

    const runConfigEffect = ({
      generation,
      closureStatus,
    }) => {
      if (!isProcessingConfigGenerationCurrent(generation, liveGeneration)) return 'obsolete';
      if (closureStatus === 'processing') {
        const activeAtEffect = activeProcessing;
        if (activeAtEffect?.configGeneration === generation) return 'current-generation-task';
        const restoreRetry = shouldRestoreLastGoodAfterConfigChange(
          activeAtEffect,
          lastGood,
        );
        coordinator.invalidate();
        activeProcessing = null;
        if (restoreRetry && restoreForGeneration(generation)) return 'restored';
        status = 'idle';
        return 'idle';
      }
      if (closureStatus === 'done' && lastGood) {
        if (activeProcessing && activeProcessing.configGeneration !== generation) {
          activeProcessing = null;
        }
        warning = resolveSnapshotWarning(lastGood, configSignatures.get(generation));
        warningWrittenByGeneration = generation;
        return 'updated-warning';
      }
      return 'unchanged';
    };

    return {
      task,
      complete(outcome) {
        if (outcome === 'rejected') rejectInvocation(new Error('provider rejected'));
        else resolveInvocation({ success: false });
        return completion;
      },
      runConfigEffect,
      setLiveGeneration(generation) {
        liveGeneration = generation;
      },
      startNewTask(taskId, configGeneration = liveGeneration) {
        activeProcessing = { taskId, retryOfLastGood: true, configGeneration };
        status = 'processing';
      },
      state() {
        return {
          activeTaskId: activeProcessing?.taskId ?? null,
          invocationRejected,
          status,
          warning,
          warningWrittenByGeneration,
        };
      },
    };
  };

  for (const outcome of ['resolved', 'rejected']) {
    const completionFirst = createConfigRace({ retryOfLastGood: true, hasLastGood: true });
    await completionFirst.complete(outcome);
    assert.deepEqual(completionFirst.state(), {
      activeTaskId: completionFirst.task.id,
      invocationRejected: outcome === 'rejected',
      status: 'done',
      warning: '',
      warningWrittenByGeneration: 10,
    });
    completionFirst.runConfigEffect({
      generation: 11,
      closureStatus: 'processing',
      taskId: completionFirst.task.id,
    });
    assert.deepEqual(completionFirst.state(), {
      activeTaskId: null,
      invocationRejected: outcome === 'rejected',
      status: 'done',
      warning: PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
      warningWrittenByGeneration: 11,
    }, `completion-first (${outcome}) must finish with the latest effect restoration`);

    const effectFirst = createConfigRace({ retryOfLastGood: true, hasLastGood: true });
    effectFirst.runConfigEffect({
      generation: 11,
      closureStatus: 'processing',
      taskId: effectFirst.task.id,
    });
    const effectFirstBeforeCompletion = effectFirst.state();
    await effectFirst.complete(outcome);
    assert.deepEqual(effectFirst.state(), {
      ...effectFirstBeforeCompletion,
      invocationRejected: outcome === 'rejected',
    }, `effect-first (${outcome}) must not be overwritten by the old completion closure`);
  }

  for (const options of [
    { retryOfLastGood: false, hasLastGood: true },
    { retryOfLastGood: true, hasLastGood: false },
  ]) {
    for (const order of ['completion-first', 'effect-first']) {
      const race = createConfigRace(options);
      if (order === 'completion-first') await race.complete('resolved');
      race.runConfigEffect({
        generation: 11,
        closureStatus: 'processing',
        taskId: race.task.id,
      });
      if (order === 'effect-first') await race.complete('resolved');
      assert.equal(race.state().status, 'idle',
        `${order} must fall back to IDLE when restoration is ineligible`);
      assert.equal(race.state().warningWrittenByGeneration, null,
        `${order} must not invent a last-good restoration`);
    }
  }

  const completionThenNewerGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  await completionThenNewerGeneration.complete('resolved');
  completionThenNewerGeneration.setLiveGeneration(12);
  assert.equal(completionThenNewerGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: completionThenNewerGeneration.task.id,
  }), 'obsolete');
  assert.equal(completionThenNewerGeneration.state().warningWrittenByGeneration, 10,
    'an obsolete effect must not consume or rewrite newer reconciliation state');
  completionThenNewerGeneration.runConfigEffect({
    generation: 12,
    closureStatus: 'done',
    taskId: completionThenNewerGeneration.task.id,
  });
  assert.equal(completionThenNewerGeneration.state().warningWrittenByGeneration, 12);
  assert.equal(completionThenNewerGeneration.state().activeTaskId, null);

  const effectThenNewerGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  effectThenNewerGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: effectThenNewerGeneration.task.id,
  });
  effectThenNewerGeneration.setLiveGeneration(12);
  await effectThenNewerGeneration.complete('rejected');
  assert.equal(effectThenNewerGeneration.state().warningWrittenByGeneration, 11,
    'a later stale completion must not replay its old closure after effect-first restoration');
  effectThenNewerGeneration.runConfigEffect({
    generation: 12,
    closureStatus: 'done',
    taskId: null,
  });
  assert.equal(effectThenNewerGeneration.state().warningWrittenByGeneration, 12);

  const newerTaskSameGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  await newerTaskSameGeneration.complete('resolved');
  newerTaskSameGeneration.startNewTask(999);
  assert.equal(newerTaskSameGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: newerTaskSameGeneration.task.id,
  }), 'current-generation-task');
  assert.equal(newerTaskSameGeneration.state().status, 'processing');
  assert.equal(newerTaskSameGeneration.state().activeTaskId, 999,
    'an old same-generation effect must not cancel or restore over a newer task');

  const lateCompletionAfterNewTask = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  lateCompletionAfterNewTask.startNewTask(1001, 11);
  await lateCompletionAfterNewTask.complete('rejected');
  assert.equal(lateCompletionAfterNewTask.state().status, 'processing');
  assert.equal(lateCompletionAfterNewTask.state().activeTaskId, 1001);
  assert.equal(lateCompletionAfterNewTask.state().warningWrittenByGeneration, null,
    'task 1 completion must not restore after task 2 owns the processing intent');

  const pendingIntentSameGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  pendingIntentSameGeneration.startNewTask(null, 11);
  assert.equal(pendingIntentSameGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: pendingIntentSameGeneration.task.id,
  }), 'current-generation-task',
  'a queued current-generation intent must be protected before it has a task id');
  assert.equal(pendingIntentSameGeneration.state().status, 'processing');

  const pendingIntentOldGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  pendingIntentOldGeneration.startNewTask(null, 10);
  assert.equal(pendingIntentOldGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
  }), 'restored',
  'the latest effect must cancel and reconcile an intent still bound to the old generation');
  assert.equal(pendingIntentOldGeneration.state().status, 'done');
  assert.equal(pendingIntentOldGeneration.state().activeTaskId, null);

  const pendingCoordinator = createRequestCoordinator();
  const oldTask = pendingCoordinator.schedule({
    options: { retryOfLastGood: true },
    configGeneration: 10,
  });
  assert.equal(pendingCoordinator.schedule({
    options: { retryOfLastGood: true },
    configGeneration: 11,
  }), null);
  const currentGenerationIntent = { taskId: null, configGeneration: 11 };
  assert.equal(currentGenerationIntent.configGeneration, 11,
    'the queued intent must identify itself as already using the effect generation');
  const staleOldCompletion = completeTaskForGeneration(pendingCoordinator, oldTask, {
    generationIsCurrent: false,
    restoreLastGoodIfStale: false,
  });
  assert.equal(staleOldCompletion.apply, false);
  assert.equal(staleOldCompletion.next.payload.configGeneration, 11,
    'suppressing a stale active task must preserve its newer queued task');
  assert.deepEqual(
    completeTaskForGeneration(pendingCoordinator, staleOldCompletion.next, {
      generationIsCurrent: true,
      restoreLastGoodIfStale: false,
    }),
    {
      apply: true,
      next: null,
      stale: false,
      restoreLastGood: false,
    },
    'the preserved current-generation task must still be eligible to apply',
  );
}

{
  const translationOnly = briefWith({
    status: 'translation_only',
    translation: { text: '这是一封只完成了翻译的邮件。', provenance: provenance() },
    // A defensive renderer must ignore contradictory structured arrays whenever
    // the canonical result status says no structured analysis was produced.
    deadlines: [{ id: 'stale-date', whenText: 'Friday', condition: 'stale', provenance: provenance() }],
    materials: [{ id: 'stale-material', name: 'stale passport', requirement: 'required', details: null, provenance: provenance() }],
    nextSteps: [{ id: 'stale-step', action: 'stale action', deadlineId: 'stale-date', provenance: provenance() }],
    warnings: [{ code: 'SOURCE_TRUNCATED', message: '原文过长，后半部分未进入本次翻译。' }],
  });

  assert.equal(isTranslationOnlyBrief(translationOnly), true);
  const copied = composeCompleteResultText(translationOnly, { additionalWarnings: ['截图文字可能不完整。'] });
  assert.match(copied, /完整翻译\n这是一封只完成了翻译的邮件。/);
  assert.match(copied, /本次仅完成翻译/);
  assert.match(copied, /原文过长，后半部分未进入本次翻译/);
  assert.match(copied, /截图文字可能不完整/);
  assert.doesNotMatch(copied, /stale action|stale passport|Friday|\n行动路径\n|\n材料清单\n|\n截止日期\n/);
}

{
  const brief = briefWith({
    deadlines: [
      {
        id: 'deadline-1',
        whenText: 'Monday, 28 July 2026',
        normalizedAt: '2026-07-28T17:00:00+01:00',
        timezone: 'Europe/London',
        condition: 'All items must be received by this date.',
        provenance: provenance(),
      },
      {
        id: 'deadline-2',
        whenText: 'within 10 working days',
        normalizedAt: null,
        timezone: null,
        condition: 'Appeals use this separate deadline.',
        provenance: provenance(),
      },
    ],
    materials: [
      {
        id: 'material-passport',
        name: '护照信息页扫描件',
        requirement: 'required',
        details: '必须清晰可读',
        provenance: provenance('A clear scan of your passport information page.'),
      },
    ],
    nextSteps: [
      {
        id: 'step-submit',
        action: '提交身份证明材料',
        actor: 'user',
        urgency: 'before_deadline',
        mandatory: true,
        deadlineId: 'deadline-1',
        provenance: provenance('Please submit the required identity documents.'),
      },
      {
        id: 'step-reply',
        action: '回复邮件，确认材料已经提交',
        actor: 'user',
        urgency: 'when_triggered',
        mandatory: true,
        deadlineId: null,
        provenance: provenance('Please reply to confirm that you have submitted the documents.'),
      },
    ],
    warnings: [{ code: 'ARRAY_TRUNCATED', message: '部分行动项超过上限，结果已截断。' }],
  });

  const actions = composeActionChecklistText(brief, { additionalWarnings: ['OCR 置信度较低，请核对原文。'] });
  assert.match(actions, /1\. 提交身份证明材料/);
  assert.match(actions, /关联截止：Monday, 28 July 2026/);
  assert.match(actions, /2026-07-28T17:00:00\+01:00/);
  assert.match(actions, /Europe\/London/);
  assert.match(actions, /护照信息页扫描件（必需；必须清晰可读）/);
  assert.match(actions, /within 10 working days/);
  assert.match(actions, /部分行动项超过上限，结果已截断/);
  assert.match(actions, /OCR 置信度较低，请核对原文/);

  const complete = composeCompleteResultText(brief, { additionalWarnings: ['OCR 置信度较低，请核对原文。'] });
  for (const criticalText of [
    'Monday, 28 July 2026',
    'within 10 working days',
    '护照信息页扫描件',
    '部分行动项超过上限，结果已截断',
    'OCR 置信度较低，请核对原文',
  ]) {
    assert.ok(complete.includes(criticalText), `complete copy omitted: ${criticalText}`);
  }

  assert.equal(shouldOfferReply(brief), true);
  const draft = buildReplyDraft(brief);
  assert.equal(draft.mode, 'guided');
  assert.match(draft.title, /确认事实/);
  assert.equal(draft.text, '');
  assert.ok(draft.facts.some((fact) => fact.value === 'A clear scan of your passport information page.'));
  assert.ok(draft.facts.some((fact) => fact.value.includes('Monday, 28 July 2026')));
  assert.ok(draft.facts.some((fact) => fact.value === 'Please reply to confirm that you have submitted the documents.'));
  assert.ok(draft.facts.length >= 3, 'the guided reply must expose its source-backed inputs');

  assert.equal(composeReplyDraft(draft), '', 'an unconfirmed real-world status must not produce a sendable draft');
  const completedDraft = composeReplyDraft(draft, { completionStatus: 'completed' });
  assert.match(completedDraft, /I confirm that I have completed the currently required steps and provided the currently required materials\./);
  assert.match(completedDraft, /\[Your name\]/);
  assert.deepEqual(getReplyDraftPlaceholders(completedDraft), ['[Your name]']);
  assert.deepEqual(
    getReplyDraftPlaceholders(completedDraft.replace('[Your name]', 'Li Ming')),
    [],
    'a completed reply must become copyable after the user replaces the template placeholder',
  );
  assert.deepEqual(
    getReplyDraftPlaceholders('[Your name]\n[YOUR NAME]\n[Insert reference]'),
    ['[Your name]', '[YOUR NAME]', '[Insert reference]'],
    'placeholder detection must remain case-insensitive without collapsing visibly different edits',
  );

  const inProgressDraft = composeReplyDraft(draft, { completionStatus: 'in_progress' });
  assert.match(inProgressDraft, /I have not completed the currently required steps yet\./);
  assert.doesNotMatch(inProgressDraft, /I confirm that I have completed/);
  assert.doesNotMatch(inProgressDraft, /provided the requested materials/);
}

{
  const negativeReply = briefWith({
    nextSteps: [{
      id: 'step-no-reply',
      action: '无需回复这封邮件',
      actor: 'user',
      mandatory: true,
      deadlineId: null,
      provenance: provenance('You do not need to reply to this email.'),
    }],
  });
  assert.equal(shouldOfferReply(negativeReply), false);
  assert.equal(buildReplyDraft(negativeReply).mode, 'unavailable');
}

for (const action of ['回复不是必须的', 'A reply is not required']) {
  const explicitlyOptional = briefWith({
    nextSteps: [{
      id: `step-optional-${action}`,
      action,
      actor: 'user',
      mandatory: true,
      deadlineId: null,
      provenance: provenance(action),
    }],
  });
  assert.equal(shouldOfferReply(explicitlyOptional), false, `optional reply was misclassified: ${action}`);
}

{
  const institutionReply = briefWith({
    nextSteps: [{
      id: 'step-institution-reply',
      action: '学校将在五个工作日内回复',
      actor: 'institution',
      mandatory: true,
      deadlineId: null,
      provenance: provenance('The university will reply within five working days.'),
    }],
  });
  assert.equal(shouldOfferReply(institutionReply), false);
}

{
  const verifiedSource = briefWith({
    verifications: [{
      id: 'verification-verified',
      claim: '官方流程说明',
      reason: '需要官方来源',
      status: 'verified',
      lookup: null,
      retrievals: [{
        id: 'receipt-1',
        publisher: 'GOV.UK',
        url: 'https://www.gov.uk/example',
        retrievedAt: '2026-07-23T09:00:00.000Z',
        excerpt: 'Official guidance.',
        official: true,
      }],
      provenance: provenance(),
    }],
  });
  const copied = composeCompleteResultText(verifiedSource);
  assert.match(copied, /官方流程说明：已核验/);
  assert.match(copied, /用于已核验结论的官方页面/);
  assert.match(copied, /2026-07-23T09:00:00\.000Z/);
  assert.doesNotMatch(copied, /已找到页面，结论仍需确认：GOV\.UK/);
}

function contrastAgainstWhite(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  return 1.05 / (luminance + 0.05);
}

for (const color of EVIDENCE_COLORS) {
  assert.ok(contrastAgainstWhite(color.solid) >= 4.5, `${color.solid} is too light for white badge text`);
}

{
  assert.equal(
    getEvidenceNavigationAnnouncement({ id: 3, quote: 'eVisa share code' }, 'result', 'term'),
    '已定位到结果中的词语解释：证据 3，eVisa share code',
  );
  assert.equal(
    getEvidenceNavigationAnnouncement({ id: 3, quote: 'eVisa share code' }, 'source', null),
    '已定位到原文证据 3：eVisa share code',
  );
}

{
  const componentPath = new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url);
  const componentSource = await readFile(componentPath, 'utf8');
  assert.match(componentSource, /onConfigureAnalysis/);
  assert.match(componentSource, /配置完整分析/);
  assert.match(componentSource, /aria-live="polite"/);
  assert.match(componentSource, /aria-controls=/);
  assert.match(componentSource, /target\?\.focus\(/);
  const disclosureStart = componentSource.indexOf('function Disclosure(');
  const disclosureEnd = componentSource.indexOf('\nfunction ProvenanceBadge', disclosureStart);
  const disclosureSource = componentSource.slice(disclosureStart, disclosureEnd);
  const triggerStart = disclosureSource.indexOf('<button');
  const triggerEnd = disclosureSource.indexOf('</button>', triggerStart);
  const persistentPanel = disclosureSource.indexOf(
    '<div id={panelId} className="disclosure__content" hidden={!open}>',
    triggerEnd,
  );
  assert.ok(disclosureStart >= 0 && disclosureEnd > disclosureStart
    && triggerStart >= 0 && triggerEnd > triggerStart && persistentPanel > triggerEnd,
  'the shared accordion trigger must remain mounted ahead of its persistent hidden panel');
  assert.ok(
    disclosureSource.indexOf('ref={triggerRef}', triggerStart) < triggerEnd
      && disclosureSource.indexOf('onClick={onToggle}', triggerStart) < triggerEnd,
    'opening or closing a common panel must keep focus on the same ref-capable trigger button',
  );
  const evidenceFocusStart = componentSource.indexOf('const focusEvidence = useCallback');
  const evidenceFocusEnd = componentSource.indexOf('const toggleSection = useCallback', evidenceFocusStart);
  const evidenceFocusSource = componentSource.slice(evidenceFocusStart, evidenceFocusEnd);
  assert.ok(
    evidenceFocusSource.indexOf('setOpenSections((current) => {') >= 0
      && evidenceFocusSource.indexOf('target?.focus({ preventScroll: true })')
        > evidenceFocusSource.indexOf('setOpenSections((current) => {'),
    'evidence navigation must open its persistent panel before focusing the routed evidence control',
  );
  const deadlineFocusStart = componentSource.indexOf('const openDeadlineDetails = useCallback');
  const deadlineFocusEnd = componentSource.indexOf('const openOfficialVerificationPlan = useCallback', deadlineFocusStart);
  const deadlineFocusSource = componentSource.slice(deadlineFocusStart, deadlineFocusEnd);
  assert.ok(
    deadlineFocusSource.indexOf('deadlines: true') >= 0
      && deadlineFocusSource.indexOf('deadlineDisclosureRef.current?.focus({ preventScroll: true })')
        > deadlineFocusSource.indexOf('deadlines: true'),
    'the deadline summary must still open the deadline panel and focus its ordinary trigger',
  );
  const sourceFocusStart = deadlineFocusEnd;
  const sourceFocusEnd = componentSource.indexOf('const cancelOfficialVerification = useCallback', sourceFocusStart);
  const sourceFocusSource = componentSource.slice(sourceFocusStart, sourceFocusEnd);
  assert.ok(
    sourceFocusSource.indexOf('sources: true') >= 0
      && sourceFocusSource.indexOf('verificationApprovalRef.current || officialSourcesTriggerRef.current')
        > sourceFocusSource.indexOf('sources: true'),
    'official-source navigation must still prefer the approval action and fall back to its trigger',
  );
  assert.match(componentSource, /if \(!active\) return undefined;[\s\S]*headlineRef\.current\?\.focus/,
    'returning from settings must restore focus to the preserved result headline');
  assert.match(componentSource, /isTranslationOnly \? \(/);
  assert.match(componentSource, /completionStages\.map/);
  assert.match(componentSource,
    /aria-label="这份结果的处理位置"[\s\S]*processingPrivacyDisclosure\.resultTitle[\s\S]*processingPrivacyDisclosure\.resultDetail/,
    'expanded completion details must let the user audit the immutable processing location of this result');
  assert.match(componentSource, /\['pending', 'retrieved', 'failed'\]\.includes/);
  assert.match(componentSource, /receipt\.verificationStatus === 'verified'/);
  assert.match(componentSource, /检索时间/);
  assert.match(componentSource, /const showLookupApproval = verificationPolicy === 'ask'[\s\S]*Boolean\(onVerifyOfficialSources\) \|\| isVerifying/,
    'approval details must remain visible while lookup runs and disappear after an unretryable retrieval');
  assert.match(componentSource, /showLookupApproval && verificationTargets\.length > 0/);
  assert.match(componentSource, /aria-busy=\{isVerifying\}/);
  assert.match(componentSource,
    /savedTermsLoadStatus === 'ready'[\s\S]*?hasSavedTerm\(savedTerms, selectedTerm\?\.surface\)/,
    'the save action may claim an already-saved term only from a ready snapshot');
  assert.match(componentSource,
    /message: \[[\s\S]*?'saved-terms-mutation-unconfirmed'[\s\S]*?'saved-terms-invalid-mutation-response'[\s\S]*?'saved-terms-invalid-import-response'[\s\S]*?\]\.includes\(error\?\.code\)[\s\S]*?最近一次术语更改仍未确认/,
    'result-side save retry must preserve uncertainty from mutations and imports instead of claiming a definite no-op');
  assert.doesNotMatch(componentSource, /onOpenSavedTerms\?\.\(\)/,
    'saving a term should preserve the user\'s place in the result instead of opening a modal');
  assert.match(componentSource, /useState\('action'\)/,
    'the mobile result should open on the pane selected by the action/translation preference');
  assert.match(componentSource, /preference === 'translation'[\s\S]*\['translation', 'action'\][\s\S]*\['action', 'translation'\][\s\S]*\.map\(\(primarySection\)/,
    'the selected result order must change semantic DOM order as well as visual order');
  assert.doesNotMatch(componentSource, /className="(?:action-path|translation-detail)" style=/,
    'primary result order must not rely on CSS order, which leaves assistive reading order unchanged');
  assert.match(componentSource, /effectivePreference === 'translation' \? '翻译与行动' : '行动与解释'/,
    'the narrow result pane must name the user-selected primary content');
  assert.match(componentSource, /onEditSource[\s\S]*hasSourceEditDraft \? '继续修正原文' : '修正原文'/,
    'the completed result must expose source correction and name a preserved draft');
  assert.match(componentSource, /name="reply-status"/,
    'reply drafts must ask for the user\'s real completion status');
  assert.match(componentSource, /const replyCopyBlocked = replyCompletionStatus === 'unconfirmed'[\s\S]*replyPlaceholders\.length > 0/,
    'reply copy must remain unavailable before status confirmation and placeholder replacement');
  assert.match(componentSource, /aria-describedby=\{replyPlaceholders\.length > 0 \? 'reply-placeholder-warning'/,
    'the editable draft must expose its unresolved-placeholder warning to assistive technology');
  assert.match(componentSource, /还有 \{replyPlaceholders\.length\} 处需要填写/,
    'the reply drawer must name the remaining work before copy becomes available');
  assert.match(componentSource, /disabled=\{replyCopyBlocked \|\| clipboardWritePending \|\| replyCopyState === 'copying'\}/,
    'the visible reply copy action must combine the content guard with the global clipboard mutex');
  assert.match(componentSource, /aria-busy=\{replyCopyPending \|\| replyCopyState === 'copying'\}/,
    'the in-flight reply copy state must be announced to assistive technology');
  assert.match(componentSource, /data-reply-copy-action/,
    'the native settlement fixture must target the real reply copy action');
  assert.match(componentSource, /handleCopyResult[\s\S]*?if \(clipboardWritePending\) return;/,
    'result copying must respect every unsettled App-owned clipboard operation');
  assert.match(componentSource, /handleCopyActions[\s\S]*?if \(clipboardWritePending\) return;/,
    'action-list copying must respect every unsettled App-owned clipboard operation');
  assert.match(componentSource, /handleActionCompletionChange[\s\S]*?markCopiedClipboardNoticeOutdated\(current, 'actions'\)/,
    'changing completion markers must stop describing an older copied checklist as current');
  assert.match(componentSource, /resultCopyResetTimerRef[\s\S]*?window\.clearTimeout\(resultCopyResetTimerRef\.current\)[\s\S]*?setCopyState\('copying'\)/,
    'a repeated result copy must cancel the previous success-reset timer before becoming pending');
  assert.match(componentSource, /actionCopyResetTimerRef[\s\S]*?window\.clearTimeout\(actionCopyResetTimerRef\.current\)[\s\S]*?setActionCopyState\('copying'\)/,
    'a repeated checklist copy must cancel the previous success-reset timer before becoming pending');
  assert.match(componentSource, /data-result-copy-action[\s\S]*?disabled=\{clipboardWritePending\}/,
    'the result-copy control must visibly reflect the global clipboard mutex');
  assert.match(componentSource, /data-actions-copy-action[\s\S]*?disabled=\{clipboardWritePending \|\|/,
    'the action-copy control must visibly reflect the global clipboard mutex');
  assert.match(componentSource, /markCopiedClipboardNoticeOutdated\(current, 'reply'\)/,
    'editing a copied reply must distinguish the clipboard copy from the current draft');
  assert.match(componentSource, /composeReplyDraft\(replyDraftModel, \{ completionStatus \}\)/,
    'the selected completion status must drive the generated reply');
  assert.match(componentSource, /replyRequired && \([\s\S]*准备英文回复/,
    'a required reply must keep the guided reply action visible');
  assert.match(componentSource, /className=\{replyRequired \? 'secondary-button' : 'primary-button'\}[\s\S]*onClick=\{handleCopyActions\}/,
    'the action checklist must remain available even when the source also requires a reply');
  assert.doesNotMatch(componentSource, /不会发送完整原文、姓名、邮箱或账户信息/);
  assert.doesNotMatch(componentSource, /PROCESSING_STAGES\.map/);
}

{
  const libraryPath = new URL('../src/renderer/components/SavedTermsLibrary.jsx', import.meta.url);
  const librarySource = await readFile(libraryPath, 'utf8');
  assert.match(librarySource, /role="dialog"[\s\S]*aria-modal="true"/,
    'the saved-term library must be an independent modal surface');
  assert.match(librarySource, /const hiddenSiblings = new Map\(\)[\s\S]*node\.inert = true/,
    'background content must be inert while the library is open');
  assert.match(librarySource, /new MutationObserver[\s\S]*record\.addedNodes\.forEach\(hideBackgroundSibling\)/,
    'new foreground siblings must not escape the modal accessibility boundary');
  assert.match(librarySource, /hiddenSiblings\.forEach\(\(previous, node\)[\s\S]*node\.inert = previous\.inert[\s\S]*previous\.ariaHidden/,
    'closing the library must restore each background sibling\'s prior inert ownership');
  assert.match(librarySource, /getClientRects\(\)\.length > 0[\s\S]*getComputedStyle\(node\)\.visibility !== 'hidden'/,
    'the drawer focus loop must exclude controls hidden by responsive layout');
  assert.match(librarySource, /document\.addEventListener\('focusin', handleFocusIn\)[\s\S]*document\.removeEventListener\('focusin', handleFocusIn\)/,
    'programmatic focus must remain contained while the saved-term dialog owns the foreground');
  assert.match(librarySource, /!searchInputRef\.current\?\.disabled[\s\S]*!closeButtonRef\.current\?\.disabled[\s\S]*\|\| dialog/,
    'a pending transfer with disabled controls must return modal focus to the dialog itself');
  assert.match(librarySource, /target\?\.closest\('\.saved-term-search__field'\)[\s\S]*const focusExtent = 5[\s\S]*dialog\.scrollTop \+=/,
    'restoring search focus must also reveal the wrapper that owns its visible focus ring');
  assert.match(librarySource, /event\.key === 'Escape'[\s\S]*onClose\(\)/,
    'keyboard users must be able to close the library with Escape');
  assert.match(librarySource, /const trigger = triggerRef\?\.current[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/,
    'closing the library must restore focus to its global trigger');
  assert.match(librarySource, /placeholder="搜索术语、解释或原文"/,
    'the saved-term library must remain searchable by all retained content');
  assert.match(librarySource, /找到 \$\{filteredTerms\.length\} 条，共 \$\{terms\.length\} 条/,
    'filtered results must report both the match count and total count');
  assert.match(librarySource, /没有找到匹配的术语[\s\S]*清除搜索/,
    'an empty term search must provide a clear recovery action');
  assert.match(librarySource, /event\.key === 'Escape'[\s\S]*queryRef\.current[\s\S]*setQuery\(''\)/,
    'Escape in a populated search must clear the query before closing the drawer');
  assert.match(librarySource, /\['term', 'explanation', 'combined'\]\.map/,
    'each saved term must expose explicit copy scopes for the term, explanation, and combined text');
  assert.match(librarySource, /未包含原文片段/,
    'combined copy feedback must state that retained source evidence was excluded');
  assert.match(librarySource, /剪贴板内容没有改变.*选中文本手动复制/s,
    'clipboard failure must preserve trust and offer a manual recovery path');
  assert.match(librarySource, /还没有保存术语[\s\S]*完成一次完整分析后/,
    'the always-available entry must explain how an empty library becomes useful');
  assert.match(librarySource, /撤销删除/,
    'term removal must offer a visible recovery action');
  assert.match(librarySource, /无法确认是否已移除.*可能已经完成，也可能没有完成.*重新读取术语库/s,
    'an unconfirmed term delete must require reconciliation instead of claiming the old snapshot is intact');
  assert.doesNotMatch(librarySource, /className="saved-term-strip"/);
}

{
  const appCssPath = new URL('../src/renderer/App.css', import.meta.url);
  const savedTermsCssPath = new URL(
    '../src/renderer/components/SavedTermsLibrary.css',
    import.meta.url,
  );
  const appCssSource = await readFile(appCssPath, 'utf8');
  const savedTermsCssSource = await readFile(savedTermsCssPath, 'utf8');
  const narrowStart = appCssSource.indexOf('@media (max-width: 280px)');
  const savedTermsNarrowStart = savedTermsCssSource.indexOf('@media (max-width: 280px)');
  assert.ok(narrowStart >= 0, 'the exact 200% minimum-window reflow boundary must remain explicit');
  assert.ok(savedTermsNarrowStart >= 0,
    'the deferred Saved Terms stylesheet must retain the exact 200% reflow boundary');
  const narrowCss = appCssSource.slice(narrowStart);
  const savedTermsNarrowCss = savedTermsCssSource.slice(savedTermsNarrowStart);
  assert.match(appCssSource, /\.disclosure__trigger:focus-visible\s*\{[\s\S]*?outline-offset:\s*-3px;/,
    'focus on clipped disclosures must use a complete inset ring');
  assert.match(narrowCss, /\.slipstream-shell\.is-result \.app-header__actions \.preference-switch\s*\{[\s\S]*?overflow:\s*visible;/,
    'result-order focus rings must not be clipped by the segmented-control shell');
  assert.match(narrowCss, /\.completion-button\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?overflow:\s*visible;/,
    'the narrow completion control must override the wider-layout width cap');
  assert.match(narrowCss, /\.verification-targets li\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    'official-verification targets must collapse to one readable narrow column');
  assert.match(narrowCss, /\.verification-card\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?\.verification-citation\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\);/,
    'verification results and citations must shed fixed horizontal columns at 200%');
  assert.match(savedTermsNarrowCss, /\.saved-term-transfer__confirm-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    'saved-term transfer decisions must not retain two fixed-width actions at 200%');
}

{
  const ipcHookPath = new URL('../src/renderer/hooks/useIpc.js', import.meta.url);
  const ipcHookSource = await readFile(ipcHookPath, 'utf8');
  assert.match(ipcHookSource, /demoTermsCode === 'sample'[\s\S]*DEMO_SAVED_TERMS\.map/,
    'the local capture preview must support a deterministic populated-library state');
  assert.match(ipcHookSource, /demoClipboardWriteFailuresRemaining = demoClipboardWriteCode === 'once' \? 1 : 0/,
    'clipboard failure must remain reproducible at the central demo write boundary');
  assert.match(ipcHookSource, /demoClipboardWriteFailuresRemaining > 0[\s\S]*?demoClipboardWriteFailuresRemaining -= 1/,
    'the one-shot clipboard failure fixture must recover on the next App-owned write');
}

{
  const panelPath = new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url);
  const panelSource = await readFile(panelPath, 'utf8');
  const effectGenerationGuard = panelSource.indexOf('if (!isProcessingConfigGenerationCurrent(\n      processingConfigEffectGeneration,');
  const previousConfigMutation = panelSource.indexOf('previousProcessingConfigRef.current = processingConfigChangeKey;', effectGenerationGuard);
  const currentGenerationIntentGuard = panelSource.indexOf('activeProcessing?.configGeneration === processingConfigEffectGeneration', previousConfigMutation);
  const doneGenerationCleanup = panelSource.indexOf('activeProcessingRef.current.configGeneration !== processingConfigEffectGeneration', currentGenerationIntentGuard);
  const configChangeCancelStart = panelSource.indexOf('const cancelToken = processingCancelRunRef.current.token + 1;', currentGenerationIntentGuard);
  const configChangeCancelAck = panelSource.indexOf('acknowledged = await invoke(IPC_CHANNELS.LLM_CANCEL) === true;', configChangeCancelStart);
  const configChangeClearActive = panelSource.indexOf('activeProcessingRef.current = null;', configChangeCancelAck);
  const completionGenerationGuard = panelSource.indexOf('const generationIsCurrent = isProcessingConfigGenerationCurrent(');
  const completionOwnership = panelSource.indexOf('const completionOwnsActiveProcessing = activeProcessingRef.current?.taskId === task.id;', completionGenerationGuard);
  const restoreDecision = panelSource.indexOf('const restoreLastGoodIfStale = completionOwnsActiveProcessing', completionOwnership);
  const complete = panelSource.indexOf('completeTaskForGeneration(requestCoordinatorRef.current, task, {', restoreDecision);
  const clearActive = panelSource.indexOf('activeProcessingRef.current = null;', complete);
  const restore = panelSource.indexOf('if (!next && restoreStaleLastGood) restoreLastGood();', complete);
  const currentProcessingGeneration = panelSource.indexOf(
    'const currentProcessingConfigRevision = processingConfigGenerationRef?.current',
  );
  const intendedGeneration = panelSource.indexOf(
    'const intendedConfigGeneration = currentProcessingConfigRevision',
    currentProcessingGeneration,
  );
  assert.ok(effectGenerationGuard >= 0 && effectGenerationGuard < previousConfigMutation,
    'an obsolete config effect must exit before mutating reconciliation state');
  assert.ok(currentGenerationIntentGuard > previousConfigMutation,
    'a task already intended for the effect generation must not be cancelled');
  assert.ok(doneGenerationCleanup > currentGenerationIntentGuard,
    'DONE reconciliation may clear only processing identity from an older generation');
  assert.ok(configChangeCancelStart > currentGenerationIntentGuard
    && configChangeCancelAck > configChangeCancelStart
    && configChangeClearActive > configChangeCancelAck,
  'a config change must retain the visible task and location until main confirms settlement');
  assert.match(
    panelSource.slice(configChangeCancelStart, configChangeClearActive),
    /if \(!acknowledged\)[\s\S]*setProcessingCancelError/,
    'a failed config-change stop must keep the task visible with location-specific retry copy',
  );
  assert.ok(completionGenerationGuard >= 0,
    'processing completion must compare the synchronous config generation');
  assert.ok(completionOwnership > completionGenerationGuard && restoreDecision > completionOwnership,
    'stale completion restoration must require ownership of the exact active task');
  assert.ok(complete > restoreDecision,
    'generation suppression and task completion must be settled atomically');
  assert.ok(clearActive > complete
    && panelSource.slice(complete, clearActive).includes('!next && completionOwnsActiveProcessing'),
  'a settled stale task must release its task identity without hiding a still-running request');
  assert.ok(restore > clearActive,
    'eligible stale retry restoration must occur only after the settled task releases its identity');
  assert.ok(currentProcessingGeneration >= 0
    && intendedGeneration > currentProcessingGeneration
    && panelSource.indexOf('configGeneration: intendedConfigGeneration', intendedGeneration) > intendedGeneration,
  'every newly queued processing intent must carry its synchronous config generation');
  const runProcessingStart = panelSource.indexOf('const runProcessing = useCallback');
  const triggerProcessingStart = panelSource.indexOf('const triggerProcessing = useCallback', runProcessingStart);
  const runProcessingSource = panelSource.slice(runProcessingStart, triggerProcessingStart);
  const triggerProcessingEnd = panelSource.indexOf('const performScreenshotCapture = useCallback', triggerProcessingStart);
  const triggerProcessingSource = panelSource.slice(triggerProcessingStart, triggerProcessingEnd);
  assert.match(runProcessingSource,
    /activeProcessingRef\.current = requestProcessingSnapshot;[\s\S]*setActiveProcessingSnapshot\(requestProcessingSnapshot\)/,
    'the privacy location snapshot must become active only when the queued task actually starts');
  assert.doesNotMatch(triggerProcessingSource, /activeProcessingRef\.current\s*=/,
    'queueing a newer task must not overwrite the provider/location of the request still in flight');
  assert.match(runProcessingSource,
    /processingFailureMessage\([\s\S]*?failureCode,[\s\S]*?requestProcessingProvider,/,
    'task failure copy must use the provider that actually executed, not mutable settings');
  assert.doesNotMatch(panelSource, /processingConfigReconciliationRef/);
  assert.doesNotMatch(panelSource, /processingConfigEffectTaskId/,
    'effect reconciliation must use config generation rather than a stale render-time task id');
  assert.match(panelSource, /setVerificationTimeMs\(nextVerificationTimeMs\)/,
    'official lookup duration must be tracked separately from model analysis duration');
  assert.match(panelSource, /markTaskClipboardCopiesOutdated\(\);\s*setBrief\(response\.brief\)/,
    'official verification must mark copied result/checklist text outdated before replacing its payload');
  assert.doesNotMatch(panelSource, /setProcessingTimeMs\(response\.processingTimeMs \|\| processingTimeMs\)/,
    'official lookup must not overwrite the displayed analysis duration');
  assert.match(panelSource, /upsertSavedTerm\(terms, savedTerm\)/,
    'saving the same normalized term must not create duplicate renderer entries');
  assert.match(panelSource,
    /isCanonicalSavedTerms\(terms\)[\s\S]*?saved-terms-invalid-response/,
    'a Saved Terms read must reject malformed array members instead of publishing a false count');
  assert.match(panelSource,
    /const runSavedTermsMutation = useCallback[\s\S]*?saved-terms-mutation-unconfirmed[\s\S]*?setSavedTermsLoadState\(SAVED_TERMS_LOAD_STATUS\.ERROR/,
    'an unconfirmed Saved Terms mutation must invalidate the old snapshot until a fresh read reconciles it');
  assert.match(panelSource,
    /savedTermsReconciliationErrorCodeRef[\s\S]*?SAVED_TERMS_RECONCILIATION_ERROR_CODES\.has\(incomingCode\)[\s\S]*?createSavedTermsLoadError\([\s\S]*?savedTermsReconciliationErrorCodeRef\.current/,
    'a failed reconciliation read must preserve mutation uncertainty instead of downgrading it to an ordinary load failure');
  assert.match(panelSource,
    /const publishedError = setSavedTermsLoadState[\s\S]*?throw publishedError \|\| error/,
    'callers retrying a reconciliation read must receive the preserved mutation-uncertainty error');
  assert.match(panelSource,
    /return \{ status: 'already-saved', term \}[\s\S]*?return \{ status: 'saved', term: savedTerm \}/,
    'result-side retry must distinguish deduplication from a new persistent save');
  assert.match(panelSource,
    /function isValidSavedTermsImportPreview[\s\S]*?previewId\.length > 100[\s\S]*?response\.examples\.length > 5[\s\S]*?isValidSavedTermsImportSummary\(response\.summary\)[\s\S]*?isSavedTermsImportPlanSummaryConsistent/,
    'import preview UI must require both a bounded protocol summary and a matching sanitized plan');
  assert.match(panelSource,
    /function isValidSavedTermsImportCommit\(response, existingTerms, preview\)[\s\S]*?hasValidSavedTermsImportFileName\(response\)[\s\S]*?isCanonicalSavedTerms\(response\.savedTerms\)[\s\S]*?isValidSavedTermsImportSummary\(response\.summary, response\.savedTerms\.length\)[\s\S]*?response\.fileName === preview\.fileName[\s\S]*?isSavedTermsImportCommitConsistent\([\s\S]*?preview\.planTerms[\s\S]*?response\.savedTerms[\s\S]*?response\.summary/,
    'import commit success must reconcile its file, sanitized plan, prior snapshot, and returned list before publication');
  assert.match(panelSource,
    /savedTermsImportPreviewRef\.current = \{[\s\S]*?previewId: response\.previewId[\s\S]*?summary: \{ \.\.\.response\.summary \}[\s\S]*?planTerms: response\.planTerms\.map[\s\S]*?const existingTerms = savedTermsRef\.current\.map[\s\S]*?isValidSavedTermsImportCommit\(response, existingTerms, preview\)/,
    'import commit validation must retain the trusted preview and capture the pre-mutation Saved Terms snapshot');
  assert.match(panelSource,
    /const handlePreviewTermImport = useCallback\(async[\s\S]*?isValidSavedTermsImportPreview\(response, savedTermsRef\.current\)[\s\S]*?planTerms: response\.planTerms\.map[\s\S]*?saved-terms-invalid-import-preview-response/,
    'malformed import previews or previews that disagree with their sanitized plan must fail closed before reaching the drawer');
  assert.match(panelSource,
    /savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS\.READY[\s\S]*?打开术语库，已保存 \$\{savedTerms\.length\} 个术语[\s\S]*?暂时无法读取已保存术语[\s\S]*?正在读取已保存术语/,
    'the global library entry must expose counts only for a ready snapshot and name loading/error honestly');
  assert.match(panelSource,
    /<SavedTermsLibrary[\s\S]*savedTerms=\{savedTerms\}[\s\S]*loadStatus=\{savedTermsLoadStatus\}[\s\S]*onRetryLoad=\{retrySavedTermsLoad\}/,
    'the global library must render outside the result-only branch with explicit data status and recovery');
  assert.match(panelSource,
    /<ResultDisplay[\s\S]*savedTermsLoadStatus=\{savedTermsLoadStatus\}[\s\S]*savedTermsLoadErrorCode=\{savedTermsLoadErrorCode\}/,
    'the Result workspace must receive mutation uncertainty instead of presenting every load error as a confirmed no-op');
  assert.match(panelSource, /onRestoreTerm=\{handleRestoreTerm\}/,
    'the global library must be able to restore a removed term through persistent storage');
  assert.match(panelSource, /const handleResultOrderChange = useCallback/,
    'result-order changes must use a recoverable persistence handler');
  assert.match(panelSource, /显示顺序没有保存[\s\S]*重试保存/,
    'a failed result-order save must explain the unchanged state and offer retry');
  assert.match(panelSource, /const handleEditSource = useCallback[\s\S]*上一份结果仍在内存保留/,
    'source correction must keep the last valid result while returning to the editable capture surface');
  assert.match(panelSource, /setSourceEditDraft\(null\)[\s\S]*setWindowMode\('result'\)/,
    'a successful corrected analysis must replace the old result and clear the edit draft');
  assert.match(panelSource, /生成失败也不会丢失上一份结果或这次修改/,
    'the correction surface must state its failure-recovery behavior');
  assert.match(panelSource, /aria-label="提交前的处理位置"[\s\S]*capturePrivacyDisclosure\.title[\s\S]*capturePrivacyDisclosure\.detail/,
    'the processing destination and source-transfer consequence must stay beside the submit action at every viewport');
  assert.match(panelSource, /capturePrivacyDisclosure\.footer/,
    'the persistent capture footer must not imply local-only handling for an online provider');
  assert.match(panelSource, /processingPrivacyDisclosure=\{privacyDisclosure\}/,
    'the completed result must receive the immutable task/result processing disclosure');
  assert.match(panelSource, /resolveResultProcessingSnapshot\(brief, lastGoodRef\.current\)/,
    'legacy and text-only results must use the lastGood provider/location snapshot');
  assert.match(panelSource, /returnsToPreviousResult=\{Boolean\(lastGoodRef\.current\)\}/,
    'the processing cancel action must say whether it returns to a prior result');
  assert.match(panelSource, /PROCESSING_CANCELLED_SOURCE_NOTICE[\s\S]*textareaRef\.current\?\.focus/,
    'first-run cancellation must confirm retention and restore keyboard focus to the source');
  const processingCancelStart = panelSource.indexOf('const handleCancelProcessing = useCallback');
  const processingCancelEnd = panelSource.indexOf('const handleEditSource = useCallback', processingCancelStart);
  const processingCancelSource = panelSource.slice(processingCancelStart, processingCancelEnd);
  assert.ok(
    processingCancelSource.indexOf('await invoke(IPC_CHANNELS.LLM_CANCEL)')
      < processingCancelSource.indexOf('requestCoordinatorRef.current.invalidate()'),
    'renderer cancellation must await acknowledgement before discarding the active task',
  );
  assert.match(processingCancelSource, /if \(!acknowledged\)[\s\S]*setProcessingCancelError/,
    'failed cancellation acknowledgement must keep the task visible and retryable');
  assert.match(processingCancelSource, /completedWithNewResult[\s\S]*PROCESSING_COMPLETED_DURING_CANCEL_NOTICE/,
    'a result that wins the cancellation race must remain visible and be described honestly');
  assert.match(panelSource, /const handleOpenSettingsRequest = useCallback[\s\S]*status === STATUS\.PROCESSING[\s\S]*setProcessingSettingsGuardOpen\(true\)[\s\S]*onOpenSettings\(\)/,
    'active work must be guarded before settings navigation is allowed');
  assert.match(panelSource, /aria-modal="true"[\s\S]*不会直接切换或丢弃当前任务[\s\S]*停止任务后打开设置/,
    'the guard must describe the invariant and offer an explicit stop-then-open path');
  assert.match(panelSource, /hiddenSiblings[\s\S]*node\.inert = true[\s\S]*event\.key === 'Escape'/,
    'the processing settings guard must isolate background content and support Escape');
  assert.match(processingCancelSource, /const shouldOpenSettings = settingsOpenIntentRef\.current === 'analysis'[\s\S]*requestCoordinatorRef\.current\.invalidate\(\)[\s\S]*onOpenSettings\(previousLastGood/,
    'settings navigation must occur only after cancellation acknowledgement and task invalidation');
  assert.doesNotMatch(panelSource, /updateSettings\('resultOrder',[\s\S]{0,120}catch\(\(\) => \{\}\)/,
    'result-order persistence failures must not be swallowed');

  const coordinatorPath = new URL('../src/renderer/hooks/requestCoordinator.mjs', import.meta.url);
  const coordinatorSource = await readFile(coordinatorPath, 'utf8');
  assert.match(coordinatorSource, /suppress\(task\)[\s\S]*?suppressed\.add\(task\.id\)/,
    'stale active work must have a non-destructive suppression path');
  assert.match(coordinatorSource, /if \(stale\) coordinator\.suppress\(task\);/);
  assert.doesNotMatch(coordinatorSource, /if \(stale\) coordinator\.invalidate\(\);/,
    'stale completion must not discard a newer queued task');
}

{
  const appPath = new URL('../src/renderer/App.jsx', import.meta.url);
  const settingsPath = new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url);
  const appSource = await readFile(appPath, 'utf8');
  const settingsSource = await readFile(settingsPath, 'utf8');
  assert.match(appSource, /settingsEntryNotice[\s\S]*onOpenSettings=\{openSettings\}[\s\S]*entryNotice=\{settingsEntryNotice\}/,
    'the settings route must carry the task-retention confirmation across navigation');
  assert.match(settingsSource, /settings-entry-notice[\s\S]*当前任务已安全保留[\s\S]*\{entryNotice\}/,
    'settings must visibly confirm that the source or prior result remains available');
}

{
  const settingsHookPath = new URL('../src/renderer/hooks/useSettings.js', import.meta.url);
  const settingsHookSource = await readFile(settingsHookPath, 'utf8');
  const singleUpdate = settingsHookSource.indexOf('const updateSettings = useCallback');
  const multipleUpdate = settingsHookSource.indexOf('const updateMultipleSettings = useCallback');
  const singleGuard = settingsHookSource.indexOf(
    'if (processingConfigChanged) advanceProcessingConfigGeneration();',
    singleUpdate,
  );
  const singlePersist = settingsHookSource.indexOf('await persistSetting(', singleUpdate);
  const multipleGuard = settingsHookSource.indexOf(
    'if (processingConfigChanged) advanceProcessingConfigGeneration();',
    multipleUpdate,
  );
  const multiplePersist = settingsHookSource.indexOf('await persistSetting(', multipleUpdate);
  assert.ok(singleGuard > singleUpdate && singleGuard < singlePersist,
    'single config updates must synchronously advance generation before persistence');
  assert.ok(multipleGuard > multipleUpdate && multipleGuard < multiplePersist,
    'batched config updates must synchronously advance generation before persistence');
  assert.match(settingsHookSource, /if \(!PROCESSING_CONFIG_KEYS\.has\(key\)\) return false;/,
    'non-processing or no-op writes must not advance the processing generation');
  assert.match(settingsHookSource, /return value \? true : Boolean\(settings\[secretFlag\]\);/,
    'redacted credential deletion must still count as a processing config change');
}

console.log('result integrity checks passed');
