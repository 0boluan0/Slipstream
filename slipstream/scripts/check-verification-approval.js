const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createActionBrief,
  verifyExistingActionBrief,
} = require('../src/main/action-brief-service');
const {
  DEFAULT_VERIFICATION_APPROVAL_TTL_MS,
  createVerificationApprovalRegistry,
} = require('../src/main/verification/approval-registry');

const SOURCE_TEXT = 'The message asks whether Graduate Route eligibility rules have changed.';
const OFFICIAL_URL = 'https://www.gov.uk/graduate-visa';
const RETRIEVED_AT = '2026-07-23T08:00:00.000Z';
const SENDER_ID = 17;

function approvalRecord(
  registry,
  senderId,
  sourceSha256,
  approvalId,
  authorityEpoch = registry.getAuthorityEpoch(senderId),
) {
  return { senderId, sourceSha256, approvalId, authorityEpoch };
}

function makeCandidate() {
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
    verifications: [{
      claim: 'Graduate Route eligibility rules are current',
      reason: 'The message does not contain the current official policy.',
      status: 'pending',
      provenance: 'pending',
      lookup: {
        publisher: 'GOV.UK',
        query: 'Graduate Route eligibility rules',
        candidateUrls: [OFFICIAL_URL],
      },
      evidenceQuotes: ['Graduate Route eligibility rules'],
      citationIds: [],
      confidence: null,
    }],
    warnings: [],
  };
}

async function createAskPlan() {
  let fetchCalls = 0;
  const response = await createActionBrief({
    sourceText: SOURCE_TEXT,
    rawOutput: JSON.stringify(makeCandidate()),
    backend: 'openai',
    model: 'test-model',
    verificationPolicy: 'ask',
    verificationDependencies: {
      fetchPage: async () => {
        fetchCalls += 1;
        throw new Error('ask planning must not fetch before approval');
      },
    },
  });
  assert.equal(fetchCalls, 0);
  assert.match(response.brief.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(response.verificationSummary.approvalId, /^[a-f0-9]{64}$/);
  return response;
}

function registerPlan(
  registry,
  plan,
  senderId = SENDER_ID,
  authorityEpoch = registry.getAuthorityEpoch(senderId),
) {
  return registry.register(approvalRecord(
    registry,
    senderId,
    plan.brief.source.sha256,
    plan.verificationSummary.approvalId,
    authorityEpoch,
  ));
}

async function executeApprovedPlan({
  registry,
  plan,
  senderId = SENDER_ID,
  sourceText = SOURCE_TEXT,
  brief = plan.brief,
  approvalId = plan.verificationSummary.approvalId,
  authorityEpoch = registry.getAuthorityEpoch(senderId),
  fetchPage,
}) {
  const authorized = registry.consume(approvalRecord(
    registry,
    senderId,
    brief?.source?.sha256,
    approvalId,
    authorityEpoch,
  ));
  if (!authorized) return { authorized: false, response: null };
  const response = await verifyExistingActionBrief({
    sourceText,
    brief,
    verificationPolicy: 'ask',
    verificationApproved: true,
    verificationApprovalId: approvalId,
    verificationDependencies: { fetchPage },
  });
  return { authorized: true, response };
}

function checkRegistryUnitContract() {
  assert.equal(DEFAULT_VERIFICATION_APPROVAL_TTL_MS, 10 * 60 * 1000);
  let time = 1_000;
  const now = () => time;
  const sourceA = '1'.repeat(64);
  const sourceB = '2'.repeat(64);
  const approvalA = 'a'.repeat(64);
  const approvalB = 'b'.repeat(64);
  const registry = createVerificationApprovalRegistry({ now });
  const sender1Epoch = registry.getAuthorityEpoch(1);
  const sender2Epoch = registry.getAuthorityEpoch(2);

  assert.equal(sender1Epoch, 0);
  assert.equal(registry.register(approvalRecord(registry, 1, sourceA, approvalA, sender1Epoch)), true);
  assert.equal(registry.size, 1);
  assert.equal(registry.consume(approvalRecord(registry, 2, sourceA, approvalA, sender2Epoch)), false);
  assert.equal(registry.consume(approvalRecord(registry, 1, sourceB, approvalA, sender1Epoch)), false);
  assert.equal(registry.consume(approvalRecord(registry, 1, sourceA, approvalB, sender1Epoch)), false);
  assert.equal(registry.size, 1, 'wrong sender/source/id must not burn the valid approval');
  assert.equal(registry.consume(approvalRecord(registry, 1, sourceA, approvalA, sender1Epoch)), true);
  assert.equal(
    registry.consume(approvalRecord(registry, 1, sourceA, approvalA, sender1Epoch)),
    false,
    'replay must fail',
  );

  assert.equal(registry.register(approvalRecord(registry, 1, sourceA, approvalA, sender1Epoch)), true);
  assert.equal(registry.register(approvalRecord(registry, 2, sourceA, approvalA, sender2Epoch)), true);
  assert.equal(registry.register(approvalRecord(registry, 1, sourceB, approvalA, sender1Epoch)), true);
  assert.equal(registry.size, 3, 'the same plan id must remain isolated by sender and source');
  assert.equal(registry.clearSender(1), 2);
  assert.equal(registry.size, 1);
  assert.equal(registry.isAuthorityCurrent(1, sender1Epoch), true, 'clear without revoke keeps authority');
  assert.equal(registry.consume(approvalRecord(registry, 2, sourceA, approvalA, sender2Epoch)), true);

  const sender3Epoch = registry.getAuthorityEpoch(3);
  assert.equal(registry.register(approvalRecord(registry, 3, sourceA, approvalA, sender3Epoch)), true);
  time += DEFAULT_VERIFICATION_APPROVAL_TTL_MS;
  assert.equal(
    registry.consume(approvalRecord(registry, 3, sourceA, approvalA, sender3Epoch)),
    false,
    'expiry boundary must reject',
  );
  assert.equal(registry.size, 0);

  const sender4Epoch = registry.getAuthorityEpoch(4);
  const sender5Epoch = registry.getAuthorityEpoch(5);
  assert.equal(registry.register(approvalRecord(registry, 4, sourceA, approvalA, sender4Epoch)), true);
  assert.equal(registry.register(approvalRecord(registry, 5, sourceB, approvalB, sender5Epoch)), true);
  assert.equal(registry.clearAll(), 2);
  assert.equal(registry.size, 0);
  assert.equal(registry.isAuthorityCurrent(4, sender4Epoch), false, 'clearAll must revoke known senders');
  assert.equal(
    registry.register(approvalRecord(registry, 4, sourceA, approvalA, sender4Epoch)),
    false,
    'a callback captured before clearAll must not restore an approval',
  );

  assert.equal(registry.register({ senderId: -1, sourceSha256: sourceA, approvalId: approvalA, authorityEpoch: 0 }), false);
  assert.equal(registry.register({ senderId: 1, sourceSha256: 'bad', approvalId: approvalA, authorityEpoch: 1 }), false);
  assert.equal(registry.register({ senderId: 1, sourceSha256: sourceA, approvalId: 'bad', authorityEpoch: 1 }), false);
  assert.equal(registry.register({ senderId: 1, sourceSha256: sourceA, approvalId: approvalA }), false);
  assert.equal(registry.getAuthorityEpoch(-1), null);
  assert.equal(registry.revokeSender(-1), null);
  assert.throws(() => createVerificationApprovalRegistry({ now: 1 }), /now must be a function/);
  assert.throws(() => createVerificationApprovalRegistry({ ttlMs: 0 }), /ttlMs must be a positive safe integer/);
}

function checkAuthorityEpochRaceContract() {
  const source = '3'.repeat(64);
  const approval = 'c'.repeat(64);
  const registry = createVerificationApprovalRegistry();

  const staleSender = 31;
  const consumedEpoch = registry.getAuthorityEpoch(staleSender);
  const consumedRecord = approvalRecord(registry, staleSender, source, approval, consumedEpoch);
  assert.equal(registry.register(consumedRecord), true);
  assert.equal(registry.consume(consumedRecord), true);
  assert.equal(registry.size, 0);

  const nextEpoch = registry.revokeSender(staleSender);
  assert.equal(nextEpoch, consumedEpoch + 1);
  assert.equal(registry.isAuthorityCurrent(staleSender, consumedEpoch), false);
  assert.equal(
    registry.register(consumedRecord),
    false,
    'consume -> revoke -> stale catch must never resurrect the consumed approval',
  );
  assert.equal(registry.size, 0);

  const cancelledSender = 32;
  const cancelledEpoch = registry.getAuthorityEpoch(cancelledSender);
  const cancelledRecord = approvalRecord(registry, cancelledSender, source, approval, cancelledEpoch);
  assert.equal(registry.register(cancelledRecord), true);
  assert.equal(registry.consume(cancelledRecord), true);
  assert.equal(
    registry.register(cancelledRecord),
    true,
    'ordinary cancellation without revoke may restore a retry in the same epoch',
  );
  assert.equal(registry.consume(cancelledRecord), true);
}

async function checkDiscardCancellationInterleavingContract() {
  const source = '4'.repeat(64);
  const approval = 'd'.repeat(64);
  const registry = createVerificationApprovalRegistry();
  const senderId = 33;
  const authorityEpoch = registry.getAuthorityEpoch(senderId);
  const record = approvalRecord(registry, senderId, source, approval, authorityEpoch);
  let releaseStaleCatch;
  let signalApprovalConsumed;
  const staleCatchMayContinue = new Promise((resolve) => { releaseStaleCatch = resolve; });
  const approvalConsumed = new Promise((resolve) => { signalApprovalConsumed = resolve; });

  assert.equal(registry.register(record), true);
  const staleVerificationCatch = (async () => {
    assert.equal(registry.consume(record), true);
    signalApprovalConsumed();
    await staleCatchMayContinue;
    return registry.register(record);
  })();

  await approvalConsumed;
  registry.revokeSender(senderId);
  releaseStaleCatch();

  assert.equal(
    await staleVerificationCatch,
    false,
    'discard-result cancellation must revoke before abort wakes a stale verification catch',
  );
  assert.equal(registry.size, 0);
}

async function checkApprovalExecutionContract() {
  const plan = await createAskPlan();
  const successfulRegistry = createVerificationApprovalRegistry();
  assert.equal(registerPlan(successfulRegistry, plan), true);
  let successfulFetches = 0;
  const fetchPage = async (url) => {
    successfulFetches += 1;
    return {
      fetched: true,
      url,
      retrievedAt: RETRIEVED_AT,
      excerpt: 'Graduate Route eligibility rules are current.',
      supportText: 'Graduate Route eligibility rules are current.',
    };
  };
  const first = await executeApprovedPlan({ registry: successfulRegistry, plan, fetchPage });
  assert.equal(first.authorized, true);
  assert.equal(successfulFetches, 1);
  assert.equal(first.response.brief.verifications[0].status, 'retrieved');
  const replay = await executeApprovedPlan({ registry: successfulRegistry, plan, fetchPage });
  assert.equal(replay.authorized, false);
  assert.equal(successfulFetches, 1, 'replay must never cause another fetch');

  const wrongSenderRegistry = createVerificationApprovalRegistry();
  registerPlan(wrongSenderRegistry, plan);
  let wrongSenderFetches = 0;
  const wrongSender = await executeApprovedPlan({
    registry: wrongSenderRegistry,
    plan,
    senderId: SENDER_ID + 1,
    fetchPage: async () => { wrongSenderFetches += 1; },
  });
  assert.equal(wrongSender.authorized, false);
  assert.equal(wrongSenderFetches, 0);

  const wrongHashRegistry = createVerificationApprovalRegistry();
  registerPlan(wrongHashRegistry, plan);
  const wrongHashBrief = structuredClone(plan.brief);
  wrongHashBrief.source.sha256 = '0'.repeat(64);
  let wrongHashFetches = 0;
  const wrongHash = await executeApprovedPlan({
    registry: wrongHashRegistry,
    plan,
    brief: wrongHashBrief,
    fetchPage: async () => { wrongHashFetches += 1; },
  });
  assert.equal(wrongHash.authorized, false);
  assert.equal(wrongHashFetches, 0);

  const changedSourceRegistry = createVerificationApprovalRegistry();
  registerPlan(changedSourceRegistry, plan);
  let changedSourceFetches = 0;
  await assert.rejects(
    executeApprovedPlan({
      registry: changedSourceRegistry,
      plan,
      sourceText: `${SOURCE_TEXT.slice(0, -1)}!`,
      fetchPage: async () => { changedSourceFetches += 1; },
    }),
    (error) => error.code === 'source-mismatch'
  );
  assert.equal(changedSourceFetches, 0);

  const changedLookupRegistry = createVerificationApprovalRegistry();
  registerPlan(changedLookupRegistry, plan);
  const changedLookupBrief = structuredClone(plan.brief);
  changedLookupBrief.verifications[0].lookup.query = 'Changed lookup must not be approved';
  let changedLookupFetches = 0;
  const changedLookup = await executeApprovedPlan({
    registry: changedLookupRegistry,
    plan,
    brief: changedLookupBrief,
    fetchPage: async () => { changedLookupFetches += 1; },
  });
  assert.equal(changedLookup.authorized, true, 'the registry consumes the envelope before semantic plan validation');
  assert.equal(changedLookupFetches, 0);
  assert.equal(changedLookup.response.verificationSummary.fetchAttempted, false);
  assert.notEqual(changedLookup.response.verificationSummary.approvalId, plan.verificationSummary.approvalId);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(section, markers, message) {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = section.indexOf(marker);
    assert.ok(index > previousIndex, `${message}: expected ${marker} after the previous marker`);
    previousIndex = index;
  }
}

function checkMainAuthorityWiring() {
  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'main.js'),
    'utf8',
  );
  assert.doesNotMatch(
    mainSource,
    /verificationApprovalRegistry\.clearSender/,
    'authority invalidation must revoke the sender epoch, not only clear approvals',
  );

  const closedHandler = sourceSection(
    mainSource,
    "mainWindow.on('closed'",
    'let boundsSaveTimer',
  );
  assertOrdered(
    closedHandler,
    ['verificationApprovalRegistry.revokeSender', 'verificationAbortController?.abort()'],
    'window close must revoke before abort observers can retry',
  );

  const clearDataHandler = sourceSection(
    mainSource,
    'ipcMain.handle(IPC_CHANNELS.USER_DATA_CLEAR',
    'ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE',
  );
  assertOrdered(
    clearDataHandler,
    [
      'verificationApprovalRegistry.revokeSender(event.sender.id)',
      'verificationAbortController?.abort()',
      'store.resetUserDataAndSettings()',
    ],
    'clearing user data must revoke verification authority before aborting and clearing storage',
  );

  const settingsHandler = sourceSection(
    mainSource,
    'ipcMain.handle(IPC_CHANNELS.SETTINGS_SET',
    'ipcMain.handle(IPC_CHANNELS.PROVIDER_CONNECTION_TEST',
  );
  const policyInvalidation = sourceSection(
    settingsHandler,
    "if (settingChanged && key === 'verificationPolicy')",
    "if (key === 'clipboardShortcut'",
  );
  assertOrdered(
    policyInvalidation,
    ['verificationApprovalRegistry.revokeSender(event.sender.id)', 'verificationAbortController?.abort()'],
    'policy changes must revoke before abort observers can retry',
  );

  const cancelHandler = sourceSection(
    mainSource,
    'ipcMain.handle(IPC_CHANNELS.LLM_CANCEL',
    'ipcMain.handle(IPC_CHANNELS.LLM_PROCESS',
  );
  assert.match(
    cancelHandler,
    /options\?\.discardResult === true/,
    'cancel must expose an explicit discard-result option',
  );
  assert.match(
    cancelHandler,
    /if \(discardResult\) \{\s*verificationApprovalRegistry\.revokeSender\(event\.sender\.id\);\s*\}/,
    'discard-result cancellation must revoke the sender even when no verification is in flight',
  );
  assertOrdered(
    cancelHandler,
    [
      'verificationApprovalRegistry.revokeSender(event.sender.id)',
      'verificationAbortController?.abort()',
    ],
    'discard-result cancellation must revoke before abort observers can retry',
  );
  assert.match(cancelHandler, /verificationAbortController\?\.abort\(\)/);
  assert.doesNotMatch(
    cancelHandler,
    /if \(!discardResult\)[\s\S]*revokeSender/,
    'ordinary user cancellation must retain the epoch so the consumed approval can be retried',
  );

  const llmHandler = sourceSection(
    mainSource,
    'ipcMain.handle(IPC_CHANNELS.LLM_PROCESS',
    'ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN',
  );
  assertOrdered(
    llmHandler,
    [
      'if (llmRequestInFlight)',
      'validateProcessOptions(options)',
      'verificationApprovalRegistry.revokeSender(senderId)',
      'verificationAbortController?.abort()',
      'await LLMService.processText',
      'verificationApprovalRegistry.isAuthorityCurrent(senderId, analysisAuthorityEpoch)',
      'registerVerificationApproval(',
    ],
    'an accepted analysis must revoke old authority and reject stale completion before registration',
  );
  assert.match(
    llmHandler,
    /registerVerificationApproval\(\s*event,\s*actionBriefResponse\.brief,\s*actionBriefResponse\.verificationSummary,\s*analysisAuthorityEpoch,\s*\)/,
    'analysis approval registration must be bound to the captured authority epoch',
  );

  const verificationHandler = sourceSection(
    mainSource,
    'ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN',
    '// Screenshot capture flow',
  );
  assertOrdered(
    verificationHandler,
    [
      'verificationApprovalRegistry.getAuthorityEpoch(senderId)',
      'consumeVerificationApproval(',
      'await verifyExistingActionBrief',
      'verificationApprovalRegistry.isAuthorityCurrent(senderId, verificationAuthorityEpoch)',
      'registerVerificationApproval(',
    ],
    'verification must capture/consume one epoch and reject stale success before retry registration',
  );
  assert.match(
    verificationHandler,
    /consumeVerificationApproval\(\s*event,\s*request\.approvalId,\s*request\.brief\?\.source\?\.sha256,\s*verificationAuthorityEpoch,\s*\)/,
    'verification consumption must be bound to the captured authority epoch',
  );
  assert.match(
    verificationHandler,
    /registerVerificationApproval\(\s*event,\s*response\.brief,\s*verificationSummary,\s*verificationAuthorityEpoch,\s*\)/,
    'successful verification retry registration must be bound to the captured epoch',
  );
  const verificationCatch = sourceSection(
    verificationHandler,
    '} catch (error)',
    '} finally',
  );
  assertOrdered(
    verificationCatch,
    [
      'const authorityCurrent = verificationApprovalRegistry.isAuthorityCurrent',
      'authorityCurrent && verificationApprovalRegistry.register',
      'authorityEpoch: verificationAuthorityEpoch',
      '|| !authorityCurrent',
    ],
    'verification catch must reject revoked authority before restoring a retry',
  );
}

function checkRendererDiscardWiring() {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'components', 'FloatingPanel.jsx'),
    'utf8',
  );
  const clearHandler = sourceSection(
    rendererSource,
    'const handleClear = useCallback',
    'const handleSaveTerm = useCallback',
  );
  assert.match(
    clearHandler,
    /invoke\(IPC_CHANNELS\.LLM_CANCEL, \{ discardResult: true \}\)/,
    'clearing or returning to capture must revoke the result-bound verification authority',
  );
  assertOrdered(
    clearHandler,
    [
      'invoke(IPC_CHANNELS.LLM_CANCEL, { discardResult: true })',
      'lastGoodRef.current = null',
      'invalidateVerification()',
    ],
    'renderer clear must dispatch revocation before discarding the local result and approval',
  );
}

function checkRendererVerificationUx() {
  const resultSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'components', 'ResultDisplay.jsx'),
    'utf8',
  );
  const panelSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'components', 'FloatingPanel.jsx'),
    'utf8',
  );
  const demoSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'hooks', 'useIpc.js'),
    'utf8',
  );
  const styleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'App.css'),
    'utf8',
  );

  assert.match(resultSource, /\$\{verificationPlanCount\} 项可查找 · 需你批准/);
  assert.match(resultSource, /查看并批准官方核验/);
  assert.match(resultSource, /setOpenSections\(\(current\) => \(\{ \.\.\.current, sources: true \}\)\)/);
  assert.match(resultSource, /verificationApprovalRef\.current \|\| officialSourcesTriggerRef\.current/);
  assert.match(resultSource, /target\?\.scrollIntoView[\s\S]*?target\?\.focus/);
  assert.match(resultSource, /onCancelVerification/);
  assert.match(resultSource, /取消查找/);
  assert.match(resultSource, /verificationCancellationFocusRef\.current = true/);
  assert.match(resultSource, /verificationApprovalRef\.current\?\.focus/);
  assert.match(resultSource, /这份核验批准已失效/);
  assert.match(resultSource, /重新分析并生成核验方案/);

  assert.match(panelSource, /const \[isCancellingVerification, setIsCancellingVerification\] = useState\(false\)/);
  assert.match(panelSource, /cancelRequested: true/);
  assert.match(panelSource, /VERIFICATION_CANCELLED_NOTICE/);
  assert.match(panelSource, /lastGoodRef\.current = withVerificationApproval\(lastGoodRef\.current, nextApprovalId\)/);
  assert.match(panelSource, /onCancelVerification=\{cancelOfficialVerification\}/);
  assert.match(panelSource, /isCancellingVerification=\{isCancellingVerification\}/);

  assert.match(demoSource, /get\('verification'\)/);
  assert.match(demoSource, /demoVerificationCode === 'slow' \? 30000 : 500/);
  assert.match(demoSource, /errorCode: 'verification-cancelled'/);
  assert.match(demoSource, /retryApprovalId: 'a'\.repeat\(64\)/);
  assert.match(styleSource, /\.verification-plan-link/);
  assert.match(styleSource, /\.verification-cancel-button/);
  assert.match(styleSource, /\.verification-recovery/);
  assert.match(styleSource, /\.completion-button \{ max-width: calc\(100% - 116px\); \}/);
  assert.match(styleSource, /\.completion-button__detail-label \{ display: none; \}/);
}

async function main() {
  checkRegistryUnitContract();
  checkAuthorityEpochRaceContract();
  await checkDiscardCancellationInterleavingContract();
  checkMainAuthorityWiring();
  checkRendererDiscardWiring();
  checkRendererVerificationUx();
  await checkApprovalExecutionContract();
  console.log('Verification approval registry and IPC contract checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
