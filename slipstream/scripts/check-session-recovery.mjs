import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SESSION_RECOVERY_KEY,
  SESSION_RECOVERY_TTL_MS,
  SESSION_RECOVERY_VERSION,
  SESSION_RECOVERY_WRITE_DELAY_MS,
  clearSessionRecovery,
  createSessionRecoveryRecord,
  describeSessionRecovery,
  parseSessionRecoveryRecord,
  prepareSessionRecoveryRestore,
  readSessionRecovery,
  writeSessionRecovery,
} from '../src/renderer/utils/sessionRecovery.mjs';
import {
  REPLY_DRAFT_MAX_LENGTH,
  createReplyModelIdentity,
} from '../src/renderer/utils/replyDraftState.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const NOW = 2_000_000_000_000;
const SOURCE = 'Please submit your passport before 28 July 2026.';
const BRIEF = {
  status: 'actionable',
  translation: null,
  terms: [],
  contexts: [],
  deadlines: [{ id: 'deadline-1', whenText: '28 July 2026' }],
  materials: [],
  nextSteps: [],
  verifications: [],
  warnings: [],
};
const CAPTURE = {
  confidence: 0.98,
  blocks: [{
    id: 'block-1',
    text: SOURCE,
    confidence: 0.98,
    boundingBox: { x: 0.1, y: 0.2, w: 0.7, h: 0.1 },
  }],
};
const LAST_GOOD = {
  inputText: SOURCE,
  processedSourceText: SOURCE,
  brief: BRIEF,
  result: '',
  sourceType: 'ocr',
  captureMeta: CAPTURE,
  sourceMeta: { truncated: false, originalLength: SOURCE.length },
  processingTimeMs: 1200,
  verificationTimeMs: 300,
  verificationApprovalId: 'approval-secret-id',
  processingConfigSignature: 'settings-secret-signature',
  processingLocation: 'local-loopback',
  processingProvider: 'custom',
  warning: '',
};
const REPLY_MODEL_IDENTITY = createReplyModelIdentity({
  title: 'Reply to the passport request',
  facts: ['passport'],
});
const REPLY_DRAFT_STATE = {
  modelIdentity: REPLY_MODEL_IDENTITY,
  draft: 'Dear team,\n\nI am still preparing the requested passport copy.',
  completionStatus: 'in_progress',
  overrideConfirmed: true,
  selection: { start: 11, end: 23, direction: 'backward' },
  copyToken: 'copy-token-secret',
  settings: { apiKey: 'reply-settings-secret' },
};

assert.equal(SESSION_RECOVERY_VERSION, 1);
assert.equal(SESSION_RECOVERY_TTL_MS, 30 * 60 * 1000);
assert.equal(SESSION_RECOVERY_WRITE_DELAY_MS, 180);
assert.equal(createSessionRecoveryRecord({}, NOW), null);
assert.equal(createSessionRecoveryRecord({ inputText: '   ' }, NOW), null);

const draft = createSessionRecoveryRecord({
  inputText: SOURCE,
  processedSourceText: SOURCE,
  status: 'idle',
  sourceType: 'manual',
}, NOW);
assert.equal(draft.kind, 'draft');
assert.equal(draft.savedAt, NOW);
assert.equal(draft.interruptedTask, false);
assert.equal(parseSessionRecoveryRecord(JSON.stringify(draft), NOW + 1000).kind, 'draft');
assert.match(describeSessionRecovery(draft, NOW + 1000).title, /恢复未完成的原文/);
assert.match(describeSessionRecovery(draft, NOW + 1000).detail, new RegExp(`${SOURCE.length} 字`));
assert.match(describeSessionRecovery(draft, NOW + 1000).privacyDetail, /当前窗口/);
assert.match(describeSessionRecovery(draft, NOW + 1000).privacyDetail, /30 分钟/);
const orphanReplyDraft = createSessionRecoveryRecord({
  inputText: SOURCE,
  status: 'idle',
  replyDraftState: REPLY_DRAFT_STATE,
}, NOW);
assert.equal(orphanReplyDraft.payload.replyDraftState, null);

const result = createSessionRecoveryRecord({
  ...LAST_GOOD,
  status: 'done',
  processingErrorCode: 'processing-unauthorized',
  lastGood: LAST_GOOD,
  verificationApprovalId: 'approval-secret-id',
  replyDraftState: REPLY_DRAFT_STATE,
}, NOW);
assert.equal(result.kind, 'result');
assert.equal(result.hadVerificationApproval, true);
assert.equal(result.payload.lastGood.verificationApprovalId, null);
assert.equal(result.payload.lastGood.processingConfigSignature, undefined);
assert.equal(result.payload.lastGood.processingLocation, 'local-loopback');
assert.equal(result.payload.lastGood.processingProvider, 'custom');
assert.deepEqual(result.payload.captureMeta, CAPTURE);
assert.deepEqual(result.payload.sourceMeta, { truncated: false, originalLength: SOURCE.length });
assert.equal(result.payload.processingErrorCode, 'processing-unauthorized');
assert.deepEqual(result.payload.replyDraftState, {
  modelIdentity: REPLY_MODEL_IDENTITY,
  draft: REPLY_DRAFT_STATE.draft,
  completionStatus: 'in_progress',
  overrideConfirmed: false,
  selection: { start: 11, end: 23, direction: 'backward' },
});
const resultCopy = describeSessionRecovery(result, NOW);
assert.match(resultCopy.title, /恢复上一份原文和结果/);
assert.match(resultCopy.approvalDetail, /恢复后重新分析/);
assert.match(resultCopy.approvalDetail, /再次征求允许/);
assert.match(resultCopy.detail, /未发送的回复草稿也会一并恢复/);
assert.match(resultCopy.detail, /不会自动打开或发送/);
assert.match(resultCopy.detail, /不会把草稿视为已经复制/);
const restoredResult = prepareSessionRecoveryRestore(result);
assert.equal(restoredResult.status, 'done');
assert.equal(restoredResult.inputText, SOURCE);
assert.equal(restoredResult.verificationApprovalId, null);
assert.equal(restoredResult.lastGood.verificationApprovalId, null);
assert.equal(restoredResult.lastGood.processingLocation, 'local-loopback');
assert.equal(restoredResult.processingErrorCode, 'processing-unauthorized');
assert.deepEqual(restoredResult.replyDraftState, result.payload.replyDraftState);
assert.equal(restoredResult.replyDraftState.overrideConfirmed, false);
assert.match(restoredResult.warning, /重新分析后再批准/);

const ENDPOINT_SENTINEL = 'https://recovery-endpoint.invalid/private/v1';
const provenanceBoundaryRecord = createSessionRecoveryRecord({
  inputText: SOURCE,
  processedSourceText: SOURCE,
  status: 'done',
  brief: {
    ...BRIEF,
    analysisProvenance: {
      responseKind: 'structured',
      provider: ENDPOINT_SENTINEL,
      model: 'fixture-model',
      processingTimeMs: 12,
      processingLocation: ENDPOINT_SENTINEL,
      promptVersion: 'fixture-prompt',
      generatedAt: '2026-08-03T00:00:00.000Z',
      endpoint: ENDPOINT_SENTINEL,
      apiKey: 'provenance-api-key-secret',
    },
  },
  lastGood: {
    ...LAST_GOOD,
    processingLocation: ENDPOINT_SENTINEL,
    processingProvider: ENDPOINT_SENTINEL,
    brief: {
      ...BRIEF,
      analysisProvenance: {
        responseKind: 'structured',
        provider: 'custom',
        model: 'fixture-model',
        processingTimeMs: 12,
        processingLocation: ENDPOINT_SENTINEL,
        promptVersion: 'fixture-prompt',
        generatedAt: '2026-08-03T00:00:00.000Z',
        endpoint: ENDPOINT_SENTINEL,
      },
    },
  },
}, NOW);
assert.equal(provenanceBoundaryRecord.payload.brief.analysisProvenance.processingLocation, 'unknown');
assert.equal(provenanceBoundaryRecord.payload.brief.analysisProvenance.provider, null);
assert.equal(provenanceBoundaryRecord.payload.lastGood.processingLocation, 'unknown');
assert.equal(provenanceBoundaryRecord.payload.lastGood.processingProvider, null);
assert.equal(provenanceBoundaryRecord.payload.lastGood.brief.analysisProvenance.processingLocation, 'unknown');
assert.equal(provenanceBoundaryRecord.payload.lastGood.brief.analysisProvenance.model, 'fixture-model');
assert.doesNotMatch(JSON.stringify(provenanceBoundaryRecord), /recovery-endpoint|provenance-api-key-secret/,
  'temporary recovery must never retain endpoint details hidden in provenance metadata');

for (const unsafeModel of [
  'sk-private-recovery-model-secret',
  'https://models.example/private/v1',
  'Please upload the unredacted bank statement tomorrow.',
  'x'.repeat(81),
]) {
  const protectedModelRecord = createSessionRecoveryRecord({
    inputText: SOURCE,
    status: 'done',
    brief: {
      ...BRIEF,
      analysisProvenance: {
        provider: 'openai',
        model: unsafeModel,
        processingLocation: 'online',
      },
    },
  }, NOW);
  assert.equal(protectedModelRecord.payload.brief.analysisProvenance.model, null);
  assert.equal(JSON.stringify(protectedModelRecord).includes(unsafeModel), false,
    'an arbitrary provenance model marker must not cross the recovery privacy boundary');
}

const edit = createSessionRecoveryRecord({
  ...LAST_GOOD,
  status: 'idle',
  lastGood: LAST_GOOD,
  isEditingSource: true,
  sourceEditDraft: {
    baseSourceText: SOURCE,
    text: `${SOURCE}\nPlease also reply by email.`,
  },
}, NOW);
assert.equal(edit.kind, 'edit');
assert.match(describeSessionRecovery(edit, NOW).title, /恢复修正中的原文/);
const restoredEdit = prepareSessionRecoveryRestore(edit);
assert.equal(restoredEdit.status, 'idle');
assert.equal(restoredEdit.isEditingSource, true);
assert.match(restoredEdit.sourceEditDraft.text, /reply by email/);

const interruptedDraft = createSessionRecoveryRecord({
  inputText: SOURCE,
  processedSourceText: SOURCE,
  status: 'processing',
}, NOW);
assert.equal(interruptedDraft.kind, 'draft');
assert.equal(interruptedDraft.interruptedTask, true);
assert.match(describeSessionRecovery(interruptedDraft, NOW).taskDetail, /不会自动重新发送/);
assert.match(describeSessionRecovery(interruptedDraft, NOW).taskDetail, /处理位置未记录/);
const restoredInterruptedDraft = prepareSessionRecoveryRestore(interruptedDraft);
assert.equal(restoredInterruptedDraft.status, 'idle');
assert.match(restoredInterruptedDraft.warning, /任务没有自动重启/);

const interruptedOnlineFirstRun = createSessionRecoveryRecord({
  inputText: SOURCE,
  processedSourceText: SOURCE,
  status: 'processing',
  processingProvider: 'custom',
  processingLocation: 'online',
  endpoint: 'https://active-recovery-endpoint.invalid/private/v1',
  apiKey: 'active-recovery-api-key-secret',
  model: 'active-recovery-model-must-not-be-snapshotted',
  source: 'active-recovery-source-marker',
}, NOW);
assert.equal(interruptedOnlineFirstRun.payload.processingProvider, 'custom');
assert.equal(interruptedOnlineFirstRun.payload.processingLocation, 'online');
assert.match(
  describeSessionRecovery(interruptedOnlineFirstRun, NOW).taskDetail,
  /完整原文发送给远程自定义服务/,
);
assert.deepEqual(
  Object.keys(interruptedOnlineFirstRun.payload)
    .filter((key) => ['endpoint', 'apiKey', 'model', 'source'].includes(key)),
  [],
);
assert.doesNotMatch(
  JSON.stringify(interruptedOnlineFirstRun),
  /active-recovery-(?:endpoint|api-key|model|source)/,
  'the immutable task destination snapshot must exclude endpoint, credential, model, and source markers',
);
const reparsedInterruptedOnline = parseSessionRecoveryRecord(
  JSON.stringify(interruptedOnlineFirstRun),
  NOW + 1000,
);
assert.equal(reparsedInterruptedOnline.payload.processingProvider, 'custom');
assert.equal(reparsedInterruptedOnline.payload.processingLocation, 'online');

for (const [processingProvider, processingLocation, destinationPattern] of [
  ['deepseek', 'online', /DeepSeek（在线服务）/],
  ['custom', 'local-loopback', /本机回环兼容服务/],
  ['ollama', 'local', /这台 Mac 上由 Ollama 处理/],
]) {
  const destinationRecord = createSessionRecoveryRecord({
    inputText: SOURCE,
    status: 'processing',
    processingProvider,
    processingLocation,
  }, NOW);
  assert.match(describeSessionRecovery(destinationRecord, NOW).taskDetail, destinationPattern);
}

const interruptedRetry = createSessionRecoveryRecord({
  inputText: SOURCE,
  processedSourceText: SOURCE,
  status: 'processing',
  lastGood: LAST_GOOD,
}, NOW);
assert.equal(interruptedRetry.kind, 'result');
const restoredInterruptedRetry = prepareSessionRecoveryRestore(interruptedRetry);
assert.equal(restoredInterruptedRetry.status, 'done');
assert.deepEqual(restoredInterruptedRetry.brief, LAST_GOOD.brief);
assert.match(restoredInterruptedRetry.warning, /任务没有自动重启/);

const CLIPBOARD_TRANSIENT_STATE = {
  clipboardNotice: {
    kind: 'reply',
    status: 'copied',
    consequenceId: 'clipboard-consequence-secret',
    acknowledgementPending: true,
    acknowledgementError: 'clipboard-acknowledgement-secret',
    dismissed: false,
  },
  clipboardOperation: {
    id: 43,
    type: 'acknowledge',
    consequenceId: 'clipboard-operation-consequence-secret',
  },
  clipboardResidueRisk: { id: 'clipboard-residue-consequence-secret' },
  hasClipboardCopyConsequence: true,
  hasPendingClipboardAcknowledgement: true,
};

const interruptedVerification = createSessionRecoveryRecord({
  ...LAST_GOOD,
  status: 'done',
  lastGood: LAST_GOOD,
  isVerifying: true,
  verificationApprovalId: 'approval-secret-id',
  replyDraftState: {
    ...REPLY_DRAFT_STATE,
    completionStatus: 'completed',
    overrideConfirmed: true,
  },
  ...CLIPBOARD_TRANSIENT_STATE,
}, NOW);
assert.equal(interruptedVerification.interruptedTask, true);
assert.equal(interruptedVerification.hadVerificationApproval, true);

assert.equal(parseSessionRecoveryRecord('', NOW), null);
assert.equal(parseSessionRecoveryRecord('{not-json', NOW), null);
assert.equal(parseSessionRecoveryRecord(JSON.stringify({ ...draft, version: 99 }), NOW), null);
assert.equal(parseSessionRecoveryRecord(JSON.stringify(draft), NOW + SESSION_RECOVERY_TTL_MS + 1), null);
assert.equal(parseSessionRecoveryRecord(JSON.stringify(draft), NOW - 5001), null);
assert.equal(parseSessionRecoveryRecord(JSON.stringify({ ...draft, kind: 'result' }), NOW), null);
assert.equal(parseSessionRecoveryRecord(JSON.stringify({ ...draft, kind: 'unknown' }), NOW), null);
assert.equal(parseSessionRecoveryRecord('x'.repeat(750001), NOW), null);
assert.equal(createSessionRecoveryRecord({ inputText: 'x'.repeat(10001) }, NOW), null);

const privacyRecord = createSessionRecoveryRecord({
  inputText: SOURCE,
  status: 'done',
  brief: BRIEF,
  result: 'Safe result',
  apiKey: 'top-level-key-secret',
  settings: { openaiApiKey: 'settings-key-secret' },
  customPrompt: 'custom-prompt-secret',
  captureMeta: { ...CAPTURE, apiKey: 'capture-key-secret' },
  sourceMeta: { truncated: false, originalLength: SOURCE.length, endpoint: 'endpoint-secret' },
  lastGood: {
    ...LAST_GOOD,
    apiKey: 'last-good-key-secret',
    settings: { anthropicApiKey: 'nested-settings-secret' },
  },
  sourceEditDraft: {
    baseSourceText: SOURCE,
    text: `${SOURCE} revised`,
    apiKey: 'edit-key-secret',
  },
  verificationApprovalId: 'approval-secret-id',
  replyDraftState: {
    ...REPLY_DRAFT_STATE,
    completionStatus: 'completed',
    overrideConfirmed: true,
  },
  ...CLIPBOARD_TRANSIENT_STATE,
}, NOW);
const privacySerialized = JSON.stringify(privacyRecord);
for (const secret of [
  'top-level-key-secret',
  'settings-key-secret',
  'custom-prompt-secret',
  'capture-key-secret',
  'endpoint-secret',
  'last-good-key-secret',
  'nested-settings-secret',
  'settings-secret-signature',
  'edit-key-secret',
  'approval-secret-id',
  'copy-token-secret',
  'reply-settings-secret',
  'clipboard-consequence-secret',
  'clipboard-acknowledgement-secret',
  'clipboard-operation-consequence-secret',
  'clipboard-residue-consequence-secret',
]) {
  assert.doesNotMatch(privacySerialized, new RegExp(secret));
}
for (const consequenceField of [
  'clipboardNotice',
  'clipboardOperation',
  'clipboardResidueRisk',
  'hasClipboardCopyConsequence',
  'hasPendingClipboardAcknowledgement',
  'consequenceId',
  'acknowledgementPending',
]) {
  assert.equal(Object.hasOwn(privacyRecord.payload, consequenceField), false,
    `temporary recovery must exclude main-owned clipboard consequence field ${consequenceField}`);
  assert.equal(Object.hasOwn(prepareSessionRecoveryRestore(privacyRecord), consequenceField), false,
    `restored state must not claim manual acknowledgement through ${consequenceField}`);
}
assert.equal(privacyRecord.hadVerificationApproval, true);
assert.equal(privacyRecord.payload.replyDraftState.overrideConfirmed, false);

const invalidReplyStateRecord = createSessionRecoveryRecord({
  ...LAST_GOOD,
  status: 'done',
  lastGood: LAST_GOOD,
  replyDraftState: {
    modelIdentity: 'raw-reply-model-json',
    draft: 'x'.repeat(REPLY_DRAFT_MAX_LENGTH + 1),
    completionStatus: 'forged',
    overrideConfirmed: true,
  },
}, NOW);
assert.equal(invalidReplyStateRecord.payload.replyDraftState, null);

const storage = createStorage();
assert.equal(writeSessionRecovery(storage, draft), true);
assert.equal(storage.values.has(SESSION_RECOVERY_KEY), true);
assert.equal(readSessionRecovery(storage, NOW).kind, 'draft');
assert.equal(clearSessionRecovery(storage), true);
assert.equal(storage.values.has(SESSION_RECOVERY_KEY), false);
storage.setItem(SESSION_RECOVERY_KEY, '{broken');
assert.equal(readSessionRecovery(storage, NOW), null);
assert.equal(storage.values.has(SESSION_RECOVERY_KEY), false);
storage.setItem(SESSION_RECOVERY_KEY, JSON.stringify(draft));
assert.equal(readSessionRecovery(storage, NOW + SESSION_RECOVERY_TTL_MS + 1), null);
assert.equal(storage.values.has(SESSION_RECOVERY_KEY), false);
assert.equal(readSessionRecovery(null, NOW), null);
assert.equal(writeSessionRecovery(null, draft), false);
assert.equal(clearSessionRecovery(null), false);

const panelSource = readSource('src/renderer/components/FloatingPanel.jsx');
const appSource = readSource('src/renderer/App.jsx');
const dialogSource = readSource('src/renderer/components/SessionRecoveryDialog.jsx');
const residueNoticeSource = readSource(
  'src/renderer/components/ClipboardResidueRiskNotice.jsx',
);
const mainSource = readSource('src/main/main.js');
const preloadSource = readSource('preload.js');
const constantsSource = readSource('src/shared/constants.js');
const demoSource = readSource('src/renderer/hooks/useIpc.js');
const privacySource = readSource('../docs/PRIVACY.md');
const releaseSource = readSource('../docs/RELEASE.md');

assert.match(panelSource, /window\.sessionStorage/);
assert.doesNotMatch(panelSource, /localStorage/);
assert.match(panelSource, /SESSION_RECOVERY_WRITE_DELAY_MS/);
assert.match(panelSource, /const requestProcessingSnapshot = Object\.freeze\(/,
  'an active task must hold an immutable provider/location authority snapshot');
assert.match(panelSource, /processingLocation: requestProcessingSnapshot\.processingLocation[\s\S]*?processingProvider: requestProcessingSnapshot\.processingProvider[\s\S]*?writeSessionRecovery\(getSessionRecoveryStorage\(\), activeRecoveryRecord\)/,
  'a first analysis must synchronously save its bounded provider/location snapshot before interruption');
assert.match(panelSource, /window\.addEventListener\('pagehide', flushSessionRecovery\)/);
assert.match(panelSource, /window\.setInterval\(flushSessionRecovery, 5 \* 60 \* 1000\)/);
const flushStart = panelSource.indexOf('const flushSessionRecovery = () => {');
const flushEnd = panelSource.indexOf('const heartbeat =', flushStart);
assert.ok(flushStart >= 0 && flushEnd > flushStart,
  'the temporary recovery flush must remain inspectable');
assert.doesNotMatch(
  panelSource.slice(flushStart, flushEnd),
  /savedAt\s*:\s*Date\.now\(\)/,
  'an idle heartbeat or pagehide flush must not extend the 30-minute privacy lifetime',
);
assert.match(panelSource, /clearSessionRecovery\(getSessionRecoveryStorage\(\)\)/);
assert.match(panelSource, /handleRestoreSessionRecovery/);
assert.match(panelSource, /handleDiscardSessionRecovery/);
assert.match(panelSource, /replyDraftState,/);
assert.match(panelSource, /setReplyDraftState\(restored\.replyDraftState \|\| null\)/);
assert.match(panelSource, /replyDraftState=\{replyDraftState\}/);
assert.match(panelSource, /pendingSessionRecovery\?\.kind === 'draft'/);
assert.match(panelSource, /pendingSessionRecovery\?\.kind === 'result'/);
assert.doesNotMatch(panelSource, /APP_RENDERER_RECOVERY_STATUS_GET/,
  'a child task surface must not consume the one-shot renderer recovery status');
assert.match(appSource,
  /rendererRecoveryStatusRequestedRef\.current = true;[\s\S]*?APP_RENDERER_RECOVERY_STATUS_GET/,
  'App must own the one-shot renderer recovery status request');
assert.match(appSource,
  /clipboardResidueRiskFromRecoveryStatus\(response\)[\s\S]*?publishClipboardResidueRisk/,
  'recovery residue metadata must remain independent of the task snapshot');
assert.match(panelSource, /没有找到可恢复的临时原文或结果/);

assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /event\.key === 'Escape'/);
assert.match(dialogSource, /event\.key !== 'Tab'/);
assert.match(dialogSource, /node\.inert = true/);
assert.match(dialogSource, /丢弃临时内容/);
assert.match(dialogSource, /恢复后的安全边界/);
assert.match(dialogSource, /clipboardResidueRisk/);
assert.match(dialogSource, /session-recovery-safety/,
  'clipboard residue must be included in the modal description before restore/discard');
assert.match(residueNoticeSource, /role="alert"/);
assert.match(residueNoticeSource, /data-clipboard-residue-acknowledge/);
assert.doesNotMatch(residueNoticeSource, /data-clipboard-clear-action/,
  'crash recovery must not recreate an automatic clipboard action');

assert.match(mainSource, /function resetRendererOwnedWorkAfterCrash\(senderId\)/);
assert.match(mainSource, /llmAbortController\?\.abort\(\)/);
assert.match(mainSource, /providerConnectionAbortController\?\.abort\(\)/);
assert.match(mainSource, /verificationAbortController\?\.abort\(\)/);
assert.match(mainSource, /captureAbortController\?\.abort\(\)/);
assert.match(mainSource, /webContents\.on\('render-process-gone'/);
assert.match(mainSource, /rendererCrashCount <= 2/);
assert.match(mainSource, /hasClipboardResidueRisk \? '保留剪贴板并退出' : '退出 Slipstream'/);
assert.match(mainSource, /APP_RENDERER_RECOVERY_STATUS_GET/);
assert.match(mainSource, /pendingRendererRecoveryNotice = null/);

assert.match(preloadSource, /'app:renderer-recovery-status-get'/);
assert.match(constantsSource, /APP_RENDERER_RECOVERY_STATUS_GET: 'app:renderer-recovery-status-get'/);
assert.match(demoSource, /case IPC_CHANNELS\.APP_RENDERER_RECOVERY_STATUS_GET:/);
assert.match(demoSource, /recovered: false/);
assert.match(privacySource, /browser-managed session storage/);
assert.match(privacySource, /does not become Slipstream history/);
assert.match(privacySource, /does not survive an application restart/);
assert.match(privacySource, /excludes settings drafts, API keys, service addresses, custom analysis prompts/);
assert.match(privacySource, /never restart automatically/);
assert.match(releaseSource, /Same-window interruption recovery remains bounded to temporary session storage/);

console.log('Session recovery checks passed.');
