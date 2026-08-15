/* eslint-disable no-inner-declarations */
// Renderer-harness helpers intentionally close over isolated fixture state.
'use strict';

const HARNESS_FLAG = '--saved-terms-deferral-harness';
const PROTOCOL = 'SLIPSTREAM_SAVED_TERMS_DEFERRAL_V1';
const OUTPUT_PREFIX = `${PROTOCOL}:`;
const TEMP_PREFIX = 'slipstream-saved-terms-deferral-';
const SCENARIOS = new Set([
  'first-use-setup',
  'returning-capture',
  'returning-capture-empty',
  'returning-capture-recovery',
  'returning-capture-stylesheet-recovery',
  'returning-capture-data-truth',
]);

if (process.type === 'renderer') {
  const { contextBridge } = require('electron');

  const scenario = process.env.SLIPSTREAM_SAVED_TERMS_SCENARIO;
  if (!SCENARIOS.has(scenario)) throw new Error('Saved Terms harness scenario is invalid');

  const baseSettings = Object.freeze({
    anthropicApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    ollamaBaseUrl: 'http://localhost:11434',
    customEndpointUrl: '',
    customEndpointApiKey: '',
    hasAnthropicApiKey: false,
    hasOpenaiApiKey: false,
    hasDeepseekApiKey: false,
    hasCustomEndpointApiKey: false,
    activeBackend: 'free_translate',
    activeModel: 'google-translate',
    customPrompt: '',
    languageHint: 'en',
    windowWidth: 520,
    windowHeight: 680,
    windowX: null,
    windowY: null,
    startMinimized: false,
    clipboardMonitoring: false,
    verificationPolicy: 'ask',
    resultOrder: 'action-first',
    privacyNoticeSeen: true,
    clipboardShortcut: 'Alt+C',
    screenshotShortcut: 'Alt+Shift+S',
    setupMode: scenario === 'first-use-setup' ? 'unconfigured' : 'translation-only',
    runtimeStatus: Object.freeze({
      trayAvailable: true,
      clipboardMonitoringDisabled: false,
      clipboardMonitoringDisablePersistFailed: false,
    }),
  });
  const savedTerms = Object.freeze([Object.freeze({
    id: 1785456000000,
    createdAt: '2026-07-31T00:00:00.000Z',
    term: 'CAS',
    explanation: 'Confirmation of Acceptance for Studies',
    evidence: 'The university will issue a CAS after the conditions are met.',
    termKind: 'abbreviation',
    provenanceKind: 'original',
  })]);
  const termImportPreview = Object.freeze({
    status: 'ready',
    previewId: 'saved-terms-deferral-preview',
    fileName: 'Slipstream-terms-backup.json',
    examples: Object.freeze(['BRP']),
    planTerms: Object.freeze([Object.freeze({
      term: 'BRP',
      explanation: 'Biometric Residence Permit',
      termKind: 'abbreviation',
      provenanceKind: 'unknown',
    })]),
    summary: Object.freeze({
      existingCount: 1,
      incomingCount: 1,
      totalInFile: 1,
      validCount: 1,
      newCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      capacitySkippedCount: 0,
      totalAfter: 2,
      invalidCount: 0,
      duplicateCount: 0,
      ignoredEvidenceCount: 0,
      downgradedProvenanceCount: 1,
    }),
  });
  const shortcutStatus = Object.freeze({
    allRegistered: true,
    clipboard: Object.freeze({
      accelerator: baseSettings.clipboardShortcut,
      registered: true,
      reason: null,
    }),
    screenshot: Object.freeze({
      accelerator: baseSettings.screenshotShortcut,
      registered: true,
      reason: null,
    }),
  });
  const allowedSubscriptions = new Set([
    'app:quit-requested',
    'app:settings-requested',
    'clipboard:text-changed',
    'ocr:error',
    'screenshot:requested',
    'settings:loaded',
    'shortcut:status-changed',
  ]);
  const invokeCounts = new Map();
  const subscriptionCounts = new Map();
  const unexpectedCalls = [];
  const unexpectedWrites = { provider: 0, settings: 0, terms: 0 };
  let pendingTermsGet = null;
  const termsGetSettlements = [];

  function increment(counts, channel) {
    counts.set(channel, (counts.get(channel) || 0) + 1);
  }

  function countUnexpectedWrite(channel) {
    if (/^(?:llm|provider|verification):/u.test(channel)) unexpectedWrites.provider += 1;
    if (/^settings:(?:set|recovery-reset)$/u.test(channel)
      || /^user-data(?:-reset)?:/u.test(channel)) unexpectedWrites.settings += 1;
    if (/^terms:/u.test(channel)
      && !['terms:get', 'terms:import-preview'].includes(channel)) unexpectedWrites.terms += 1;
  }

  function markUnexpected(channel, reason = 'not-allowed') {
    countUnexpectedWrite(channel);
    if (unexpectedCalls.length < 20) {
      unexpectedCalls.push(`${String(channel).slice(0, 80)}:${reason}`);
    }
  }

  function validNoArguments(args) {
    return args.length === 0;
  }

  function controlledTermsGet() {
    if (pendingTermsGet) {
      markUnexpected('terms:get', 'concurrent-controlled-request');
      return Promise.reject(new Error('Saved Terms controlled request is already pending'));
    }
    const requestNumber = invokeCounts.get('terms:get') || 0;
    return new Promise((resolve, reject) => {
      pendingTermsGet = { requestNumber, resolve, reject };
    });
  }

  function settleControlledTermsGet(expectedRequestNumber, outcome) {
    if (scenario !== 'returning-capture-data-truth') {
      throw new Error('Saved Terms controlled settlement is unavailable in this scenario');
    }
    if (!pendingTermsGet) {
      throw new Error('Saved Terms controlled settlement has no pending request');
    }
    if (pendingTermsGet.requestNumber !== expectedRequestNumber) {
      throw new Error('Saved Terms controlled settlement request number does not match');
    }
    const request = pendingTermsGet;
    pendingTermsGet = null;
    termsGetSettlements.push({ requestNumber: expectedRequestNumber, outcome });
    if (outcome === 'reject') {
      const error = new Error('Saved Terms controlled read failed');
      error.code = 'saved-terms-controlled-read-failed';
      request.reject(error);
    } else if (outcome === 'invalid') {
      request.resolve([null]);
    } else if (outcome === 'ready') {
      request.resolve(savedTerms.map((term) => ({ ...term })));
    } else {
      throw new Error('Saved Terms controlled settlement outcome is invalid');
    }
    return { requestNumber: expectedRequestNumber, outcome };
  }

  async function invoke(channel, ...args) {
    increment(invokeCounts, channel);
    switch (channel) {
      case 'settings:get':
        if (validNoArguments(args)) return { ...baseSettings };
        break;
      case 'shortcut:status-get':
        if (validNoArguments(args)) {
          return {
            ...shortcutStatus,
            clipboard: { ...shortcutStatus.clipboard },
            screenshot: { ...shortcutStatus.screenshot },
          };
        }
        break;
      case 'app:renderer-recovery-status-get':
        if (validNoArguments(args)) return { recovered: false, clipboardResidueRisk: null };
        break;
      case 'window:set-mode':
        if (args.length === 1 && ['setup', 'capture', 'result'].includes(args[0])) return true;
        break;
      case 'app:session-risk-update':
        if (args.length === 1 && args[0] && typeof args[0] === 'object') return true;
        break;
      case 'app:quit-listener-ready':
        if (validNoArguments(args)) return { status: 'ready', replayed: false };
        break;
      case 'app:settings-listener-ready':
        if (validNoArguments(args)) return { status: 'ready', replayed: false };
        break;
      case 'capture:listener-ready':
        if (validNoArguments(args)) return { ready: true, replayed: false };
        break;
      case 'terms:get':
        if (validNoArguments(args)) {
          if (scenario === 'returning-capture-data-truth') return controlledTermsGet();
          if (scenario === 'returning-capture-empty') return [];
          return savedTerms.map((term) => ({ ...term }));
        }
        break;
      case 'terms:import-preview':
        if (validNoArguments(args)) {
          return {
            ...termImportPreview,
            summary: {
              ...termImportPreview.summary,
              existingCount: scenario === 'returning-capture-empty'
                ? 0
                : termImportPreview.summary.existingCount,
              totalAfter: scenario === 'returning-capture-empty'
                ? 1
                : termImportPreview.summary.totalAfter,
            },
          };
        }
        break;
      case 'clipboard:pending-status':
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
          return { status: 'recorded' };
        }
        break;
      default:
        markUnexpected(channel);
        throw new Error('Saved Terms harness rejected a capability request');
    }
    markUnexpected(channel, 'invalid-arguments');
    throw new Error('Saved Terms harness rejected invalid arguments');
  }

  function on(channel, callback) {
    increment(subscriptionCounts, channel);
    if (!allowedSubscriptions.has(channel)) {
      markUnexpected(channel);
      return () => {};
    }
    if (typeof callback !== 'function') {
      markUnexpected(channel, 'invalid-callback');
      return () => {};
    }
    return () => {};
  }

  function countSnapshot(counts) {
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    )));
  }

  contextBridge.exposeInMainWorld('api', Object.freeze({ invoke, on }));
  contextBridge.exposeInMainWorld('slipstreamSavedTermsHarness', Object.freeze({
    protocol: PROTOCOL,
    rejectTermsGet: (requestNumber) => settleControlledTermsGet(requestNumber, 'reject'),
    resolveTermsGetInvalid: (requestNumber) => (
      settleControlledTermsGet(requestNumber, 'invalid')
    ),
    resolveTermsGetReady: (requestNumber) => settleControlledTermsGet(requestNumber, 'ready'),
    getSummary: () => ({
      scenario,
      invokeCounts: countSnapshot(invokeCounts),
      subscriptionCounts: countSnapshot(subscriptionCounts),
      pendingTermsGetRequest: pendingTermsGet?.requestNumber || null,
      termsGetSettlements: termsGetSettlements.map((entry) => ({ ...entry })),
      unexpectedCalls: [...unexpectedCalls],
      unexpectedWrites: { ...unexpectedWrites },
    }),
  }));
} else {
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { fileURLToPath } = require('node:url');

  const electronPath = require('electron');
  const projectRoot = path.join(__dirname, '..');
  const rendererRoot = path.join(projectRoot, 'dist', 'renderer');
  const savedTermsAsset = path.join(rendererRoot, 'assets', 'SavedTermsLibrary.js');
  const savedTermsStylesheetAsset = path.join(
    rendererRoot,
    'assets',
    'SavedTermsLibrary.css',
  );
  const evidenceRoot = path.join(
    projectRoot,
    '..',
    'docs',
    'ux-evidence',
    '2026-08-03-saved-terms-presentation-boundary',
  );
  const stylesheetEvidenceFileNames = Object.freeze([
    '03-stylesheet-load-failure.png',
    '04-stylesheet-retry-recovered.png',
  ]);

  function isInside(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
  }

  function createOwnedTempRoot() {
    const created = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    fs.chmodSync(created, 0o700);
    const realPath = fs.realpathSync(created);
    const stats = fs.statSync(realPath);
    return Object.freeze({ realPath, device: stats.dev, inode: stats.ino });
  }

  function validateOwnedTempRoot(candidate, expectedParent = os.tmpdir()) {
    const realPath = fs.realpathSync(candidate.realPath || candidate);
    const stats = fs.statSync(realPath);
    assert.equal(path.dirname(realPath), fs.realpathSync(expectedParent));
    assert.match(path.basename(realPath), new RegExp(`^${TEMP_PREFIX}[A-Za-z0-9]{6}$`, 'u'));
    assert.ok(stats.isDirectory());
    assert.equal(stats.mode & 0o777, 0o700);
    if (candidate.realPath) {
      assert.equal(realPath, candidate.realPath);
      assert.equal(stats.dev, candidate.device);
      assert.equal(stats.ino, candidate.inode);
    }
    return realPath;
  }

  function createPrivateDirectory(parent, name) {
    const directory = path.join(parent, name);
    fs.mkdirSync(directory, { mode: 0o700 });
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    return directory;
  }

  function removeOwnedTempRoot(ownedRoot) {
    const verified = validateOwnedTempRoot(ownedRoot);
    fs.rmSync(verified, { recursive: true, force: true });
  }

  function validateEvidenceDirectory(candidate) {
    if (candidate == null || candidate === '') return null;
    assert.equal(path.isAbsolute(candidate), true,
      'Saved Terms evidence directory must be absolute');
    const allowedRoot = fs.realpathSync(evidenceRoot);
    const realPath = fs.realpathSync(candidate);
    assert.ok(realPath === allowedRoot || isInside(allowedRoot, realPath),
      'Saved Terms evidence directory is outside the fixed evidence root');
    assert.ok(fs.statSync(realPath).isDirectory(),
      'Saved Terms evidence path must be an existing directory');
    return realPath;
  }

  function assertRendererArtifact() {
    assert.ok(fs.statSync(rendererRoot).isDirectory(),
      'build the production renderer before running the Saved Terms deferral gate');
    assert.ok(fs.statSync(savedTermsAsset).isFile(),
      'the production renderer is missing assets/SavedTermsLibrary.js; run npm run build:renderer');
    assert.ok(fs.statSync(savedTermsStylesheetAsset).isFile(),
      'the production renderer is missing assets/SavedTermsLibrary.css; run npm run build:renderer');
  }

  function sanitizedHarnessEnvironment({
    evidenceDirectory,
    scenario,
    homePath,
    temporaryPath,
  }) {
    const environment = {
      HOME: homePath,
      TMPDIR: temporaryPath,
      SLIPSTREAM_SAVED_TERMS_SCENARIO: scenario,
    };
    if (evidenceDirectory) {
      environment.SLIPSTREAM_SAVED_TERMS_EVIDENCE_DIR = evidenceDirectory;
    }
    for (const key of ['PATH', 'LANG', 'LC_ALL']) {
      if (typeof process.env[key] === 'string') environment[key] = process.env[key];
    }
    return environment;
  }

  async function runElectronHarness({ evidenceDirectory, scenario, ownedRoot }) {
    const root = validateOwnedTempRoot(ownedRoot);
    const scenarioRoot = createPrivateDirectory(root, scenario);
    const homePath = createPrivateDirectory(scenarioRoot, 'home');
    const temporaryPath = createPrivateDirectory(scenarioRoot, 'tmp');
    const userDataPath = createPrivateDirectory(scenarioRoot, 'user-data');
    const sessionDataPath = createPrivateDirectory(scenarioRoot, 'session-data');

    return new Promise((resolve, reject) => {
      const child = spawn(
        electronPath,
        [
          __filename,
          HARNESS_FLAG,
          scenario,
          root,
          path.dirname(root),
          rendererRoot,
          userDataPath,
          sessionDataPath,
        ],
        {
          cwd: projectRoot,
          env: sanitizedHarnessEnvironment({
            evidenceDirectory,
            scenario,
            homePath,
            temporaryPath,
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        callback();
      };
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        finish(() => reject(new Error(`Saved Terms ${scenario} harness timed out`)));
      }, 30_000);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.once('error', (error) => {
        clearTimeout(timeout);
        finish(() => reject(error));
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        finish(() => {
          try {
            const proofLine = stdout.split(/\r?\n/u)
              .find((line) => line.startsWith(OUTPUT_PREFIX));
            assert.equal(signal, null, `Electron Saved Terms harness exited by ${signal}`);
            assert.equal(
              code,
              0,
              stderr || stdout || `Electron Saved Terms ${scenario} harness failed`,
            );
            assert.ok(proofLine, `Electron Saved Terms ${scenario} harness emitted no proof`);
            const proof = JSON.parse(proofLine.slice(OUTPUT_PREFIX.length));
            assert.equal(proof.protocol, PROTOCOL);
            assert.equal(proof.scenario, scenario);
            resolve(proof);
          } catch (error) {
            reject(error);
          }
        });
      });
    });
  }

  function validateScenarioProof(proof) {
    assert.equal(proof.startupSavedTermsRequests, 0,
      `${proof.scenario} startup requested SavedTermsLibrary.js`);
    assert.equal(proof.externalRequests, 0,
      `${proof.scenario} attempted an external request`);
    assert.deepEqual(proof.unexpectedWrites, { provider: 0, settings: 0, terms: 0 });
    assert.deepEqual(proof.unexpectedCalls, []);
    if (proof.scenario === 'first-use-setup') {
      assert.equal(proof.readyTarget, 'first-use-setup');
      assert.equal(proof.adapterInvokeCounts['terms:get'] || 0, 0,
        'first use must not read Saved Terms before the capture workspace is visible');
      return;
    }
    if (proof.scenario === 'returning-capture-stylesheet-recovery') {
      assert.equal(proof.readyTarget, 'returning-capture-stylesheet-recovery');
      assert.equal(proof.primaryStylesheetFailureInjected, true);
      assert.equal(proof.primaryStylesheetFailureStatus, 503);
      assert.equal(proof.loadFailureDialogCount, 1);
      assert.equal(proof.loadFailureAlertCount, 1);
      assert.equal(proof.retryFocused, true);
      assert.equal(proof.retryFocusedAfterReachability, true);
      assert.equal(proof.backgroundInertDuringFailure, true);
      assert.equal(proof.privateControlsDuringFailure, 0);
      assert.equal(proof.failedStylesheetLinkCount, 0);
      assert.deepEqual(proof.eagerRecoveryStyle, {
        backdropFixed: true,
        backdropFlex: true,
        dialogFlex: true,
        dialogOpaque: true,
        bodyGrid: true,
        actionsGrid: true,
      });
      assert.deepEqual(proof.recoveryViewport, { width: 200, height: 200 });
      assert.deepEqual(proof.recoveredViewport, { width: 200, height: 200 });
      assert.deepEqual(proof.recoveryGeometry, {
        backdropWithinViewport: true,
        dialogWithinViewport: true,
        backdropVisible: true,
        dialogVisible: true,
        noHorizontalOverflow: true,
      });
      assert.deepEqual(proof.recoveryScrollOwnership, {
        ownerCount: 1,
        dialogIsOnlyOwner: true,
        dialogOverflowY: 'auto',
        bodyOverflowY: 'visible',
        dialogHasRange: true,
        bodyHasRange: false,
      });
      for (const label of ['alert', 'hint']) {
        assert.deepEqual(proof.recoveryReachability[label], {
          horizontallyContained: true,
          topEdgeReachable: true,
          bottomEdgeReachable: true,
          scrollLeftZero: true,
        }, `${label} must remain reachable in the 200x200 recovery modal`);
      }
      for (const label of ['close', 'retry', 'returnAction']) {
        const reachability = proof.recoveryReachability[label];
        assert.deepEqual(reachability, {
          focused: true,
          horizontallyContained: true,
          verticallyIntersects: true,
          verticallyContained: true,
          scrollLeftZero: true,
        }, `${label} must remain reachable in the 200x200 recovery modal`);
      }
      assert.equal(proof.loadedStylesheetLinkCount, 1);
      assert.equal(proof.loadedStylesheetAttempt, '1');
      assert.equal(proof.loadedStylesheetReady, 'true');
      assert.equal(proof.privateRuleLoaded, true);
      assert.equal(proof.privateRuleApplied, true);
      assert.equal(proof.recoveredSearchFocused, true);
      assert.equal(proof.rendererTimeOriginPreserved, true);
      assert.equal(proof.rendererUrlPreserved, true);
      assert.equal(proof.javaScriptRequestCount, 2);
      assert.equal(proof.stylesheetRequestCount, 2);
      assert.equal(proof.primaryJavaScriptQuery, '');
      assert.equal(proof.retryJavaScriptQuery, '?workspace-attempt=1');
      assert.equal(proof.primaryStylesheetQuery, '');
      assert.equal(proof.retryStylesheetQuery, '?workspace-attempt=1');
      assert.equal(proof.sameJavaScriptPhysicalPath, true);
      assert.equal(proof.sameStylesheetPhysicalPath, true);
      assert.deepEqual(proof.stylesheetResponses, [
        { query: '', statusCode: 503 },
        { query: '?workspace-attempt=1', statusCode: 200 },
      ]);
      assert.equal(proof.rendererDocumentRequests, 1);
      assert.ok(
        (proof.evidenceFiles.length === 0)
          || (
            proof.evidenceFiles.length === stylesheetEvidenceFileNames.length
            && stylesheetEvidenceFileNames.every((fileName, index) => (
              proof.evidenceFiles[index] === fileName
            ))
          ),
        'Saved Terms evidence capture must be disabled or contain the two fixed files',
      );
      assert.deepEqual(proof.prohibitedEffects, {
        termMutations: 0,
        termImports: 0,
        termExports: 0,
        clipboardReadsOrWrites: 0,
        providerCalls: 0,
        reloads: 0,
        externalRequests: 0,
        download: 0,
        navigation: 0,
        redirect: 0,
        windowOpen: 0,
      });
      return;
    }
    if (proof.scenario === 'returning-capture-recovery') {
      assert.equal(proof.readyTarget, 'returning-capture-recovery');
      assert.equal(proof.primaryFailureInjected, true);
      assert.equal(proof.loadFailureDialogCount, 1);
      assert.equal(proof.loadFailureAlertCount, 1);
      assert.equal(proof.retryFocused, true);
      assert.equal(proof.backgroundInertDuringFailure, true);
      assert.equal(proof.recoveredSearchFocused, true);
      assert.equal(proof.focusReturnedToTrigger, true);
      assert.equal(proof.rendererTimeOriginPreserved, true);
      assert.equal(proof.finalSavedTermsRequests, 2);
      assert.equal(proof.primaryRequestQuery, '');
      assert.equal(proof.retryRequestQuery, '?workspace-attempt=1');
      assert.equal(proof.recoveryAsyncStylesheets, 1);
      assert.equal(proof.recoveryStylesheetQuery, '?workspace-attempt=1');
      return;
    }
    if (proof.scenario === 'returning-capture-empty') {
      assert.equal(proof.readyTarget, 'returning-capture-empty');
      assert.equal(proof.triggerLabel, '打开术语库，已保存 0 个术语');
      assert.equal(proof.triggerVisualCount, '0');
      assert.equal(proof.emptyOwnerCount, 1);
      assert.equal(proof.enabledImportActionCount, 1);
      assert.equal(proof.searchCount, 0);
      assert.equal(proof.cardCount, 0);
      assert.equal(proof.importFocusedOnOpen, true);
      assert.equal(proof.importPreviewVisible, true);
      assert.equal(proof.importPreviewFocused, true);
      assert.equal(proof.cancelReturnedToImport, true);
      assert.equal(proof.rendererTimeOriginPreserved, true);
      assert.equal(proof.adapterInvokeCounts['terms:get'], 1);
      assert.equal(proof.adapterInvokeCounts['terms:import-preview'], 1);
      return;
    }
    if (proof.scenario === 'returning-capture-data-truth') {
      assert.equal(proof.readyTarget, 'returning-capture-data-truth');
      assert.equal(proof.firstPendingTermsGetRequest, 1);
      assert.equal(proof.firstPendingTermsGetCount, 1);
      assert.equal(proof.firstPendingSettlementCount, 0);
      assert.equal(proof.firstInteractionProof.sourceLoaded, true);
      assert.equal(proof.firstInteractionProof.sourceFocused, true);
      assert.equal(proof.firstInteractionProof.analyzeEnabled, true);
      assert.equal(proof.firstInteractionProof.termsReadStillPending, true);
      assert.equal(proof.firstInteractionProof.termsGetRequestCount, 1);
      assert.equal(proof.firstInteractionProof.termsGetSettlementCount, 0);
      assert.equal(proof.firstInteractionProof.sampleNoticeVisible, true);
      assert.equal(
        proof.loadingProof.triggerLabel,
        '打开术语库，正在读取已保存术语',
      );
      assert.equal(proof.loadingProof.triggerBusy, true);
      assert.equal(proof.loadingProof.drawerSaysLoading, true);
      assert.equal(proof.loadingProof.falseZeroClaims, 0);
      assert.equal(proof.loadingProof.falseEmptyClaims, 0);
      assert.equal(proof.loadingProof.mutationOrTransferControls, 0);
      assert.equal(proof.loadingProof.dialogOwnedFocus, true);
      for (const [label, recoverableProof] of [
        ['rejected', proof.rejectedProof],
        ['invalid', proof.invalidProof],
      ]) {
        assert.equal(recoverableProof.alertCount, 1, `${label} read must expose one alert`);
        assert.equal(recoverableProof.retryCount, 1, `${label} read must expose one retry`);
        assert.equal(recoverableProof.headerCloseCount, 1,
          `${label} read must keep the drawer close action`);
        assert.equal(
          recoverableProof.triggerLabel,
          '打开术语库，暂时无法读取已保存术语，可打开后重试',
        );
        assert.equal(recoverableProof.falseZeroClaims, 0);
        assert.equal(recoverableProof.falseEmptyClaims, 0);
        assert.equal(recoverableProof.mutationOrTransferControls, 0);
        assert.equal(recoverableProof.dialogOwnedFocus, true);
      }
      assert.equal(proof.rejectedProof.returnToTaskCount, 1);
      assert.equal(
        proof.readyProof.triggerLabel,
        '打开术语库，已保存 1 个术语',
      );
      assert.equal(proof.readyProof.triggerVisualCount, '1');
      assert.equal(proof.readyProof.headerSaysOne, true);
      assert.equal(proof.readyProof.searchCount, 1);
      assert.equal(proof.readyProof.cardCount, 1);
      assert.equal(proof.readyProof.sampleTermVisible, true);
      assert.equal(proof.readyProof.dialogOwnedFocus, true);
      assert.equal(proof.finalTermsGetRequests, 3);
      assert.equal(proof.finalTermsGetPendingRequest, null);
      assert.equal(proof.adapterInvokeCounts['terms:get'], 3);
      assert.deepEqual(proof.termsGetSettlements, [
        { requestNumber: 1, outcome: 'reject' },
        { requestNumber: 2, outcome: 'invalid' },
        { requestNumber: 3, outcome: 'ready' },
      ]);
      assert.equal(proof.rendererTimeOriginPreserved, true);
      assert.equal(proof.rendererUrlPreserved, true);
      assert.equal(
        proof.resourceRequests.filter((request) => request.path === 'index.html').length,
        1,
        'the data-truth scenario must not reload the production renderer',
      );
      return;
    }
    assert.equal(proof.readyTarget, 'returning-capture');
    assert.equal(proof.firstOpenSavedTermsRequests, 1);
    assert.equal(proof.finalSavedTermsRequests, 1);
    assert.equal(proof.firstOpenResourceRequests, 2,
      'the first open must request the stable Saved Terms JavaScript and stylesheet assets');
    assert.equal(proof.closeAndReopenResourceRequests, 0,
      'close and reopen must reuse the mounted production module without another resource request');
    assert.equal(proof.firstRequestQuery, '');
    assert.equal(proof.firstOpenAsyncStylesheets, 1);
    assert.equal(proof.firstStylesheetRequestQuery, '');
    assert.equal(proof.dialogOwnedFocus, true);
    assert.equal(proof.searchFocusedOnFirstOpen, true);
    assert.equal(proof.focusReturnedToTrigger, true);
    assert.equal(proof.searchFocusedOnReopen, true);
    assert.equal(proof.importPreviewVisible, true);
    assert.equal(proof.importPreviewFocused, true);
    assert.equal(proof.importSessionPreserved, true);
    assert.equal(proof.importPreviewCloseEnabled, true);
    assert.equal(proof.rendererTimeOriginPreserved, true);
  }

  async function runParent() {
    assertRendererArtifact();
    const evidenceDirectory = validateEvidenceDirectory(
      process.env.SLIPSTREAM_SAVED_TERMS_EVIDENCE_DIR,
    );
    const ownedRoot = createOwnedTempRoot();
    try {
      const proofs = [];
      for (const scenario of SCENARIOS) {
        const proof = await runElectronHarness({ evidenceDirectory, scenario, ownedRoot });
        validateScenarioProof(proof);
        proofs.push(proof);
      }
      return proofs;
    } finally {
      removeOwnedTempRoot(ownedRoot);
    }
  }

  async function waitForRendererCondition(window, expression, label, timeoutMs = 15_000) {
    const source = `
      (async () => {
        const deadline = performance.now() + ${Number(timeoutMs)};
        const nextFrame = () => new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
          setTimeout(resolve, 25);
        });
        while (performance.now() < deadline) {
          if (${expression}) return true;
          await nextFrame();
        }
        throw new Error(${JSON.stringify(`${label} timed out`)});
      })()
    `;
    return window.webContents.executeJavaScript(source, true);
  }

  async function settleRenderer(window) {
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)));
      })
    `, true);
  }

  function savedTermsRequests(resourceRequests) {
    return resourceRequests.filter((request) => request.fileName === 'SavedTermsLibrary.js');
  }

  async function runElectronChild(argumentsAfterFlag) {
    const {
      app,
      BrowserWindow,
      session,
    } = require('electron');
    const [
      scenario,
      rootArgument,
      rootParentArgument,
      rendererArgument,
      userDataPath,
      sessionDataPath,
    ] = argumentsAfterFlag;
    let window = null;
    let completed = false;
    let outputWritten = false;
    let safetyTimeout = null;
    const resourceRequests = [];
    const protocolResourceRequests = [];
    const stylesheetResponses = [];
    const externalRequestUrls = [];
    const externalEffectAttempts = {
      download: 0,
      navigation: 0,
      redirect: 0,
      windowOpen: 0,
    };
    let primaryFailureInjected = false;
    let primaryStylesheetFailureInjected = false;
    let primaryStylesheetFailureStatus = null;
    let activeEvidenceDirectory = null;
    const evidenceFiles = [];

    const writeOutcome = (payload, exitCode) => new Promise((resolve) => {
      if (outputWritten) return resolve();
      outputWritten = true;
      process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify(payload)}\n`, () => {
        app.exit(exitCode);
        resolve();
      });
    });

    const captureStylesheetEvidence = async (fileName) => {
      if (!activeEvidenceDirectory) return false;
      assert.ok(stylesheetEvidenceFileNames.includes(fileName),
        'Saved Terms evidence filename is outside the fixed set');
      assert.ok(window && !window.isDestroyed(),
        'Saved Terms evidence requires the active Electron window');
      const target = path.join(activeEvidenceDirectory, fileName);
      assert.equal(path.dirname(target), activeEvidenceDirectory);
      if (fs.existsSync(target)) {
        assert.equal(fs.lstatSync(target).isSymbolicLink(), false,
          'Saved Terms evidence target must not be a symbolic link');
      }
      const image = await window.webContents.capturePage();
      assert.equal(image.isEmpty(), false, 'Saved Terms evidence capture is empty');
      fs.writeFileSync(target, image.toPNG(), { mode: 0o644 });
      evidenceFiles.push(fileName);
      return true;
    };

    try {
      assert.ok(SCENARIOS.has(scenario), 'invalid Saved Terms scenario');
      const root = validateOwnedTempRoot(rootArgument, rootParentArgument);
      activeEvidenceDirectory = validateEvidenceDirectory(
        process.env.SLIPSTREAM_SAVED_TERMS_EVIDENCE_DIR,
      );
      const renderer = fs.realpathSync(rendererArgument);
      assert.ok(isInside(projectRoot, renderer), 'renderer root is outside the project');
      assert.equal(renderer, fs.realpathSync(rendererRoot), 'renderer root changed');
      for (const [label, candidate] of [
        ['userData', userDataPath],
        ['sessionData', sessionDataPath],
        ['HOME', process.env.HOME],
        ['TMPDIR', process.env.TMPDIR],
      ]) {
        const realPath = fs.realpathSync(candidate);
        assert.ok(isInside(root, realPath), `${label} is outside the owned root`);
        assert.equal(fs.statSync(realPath).mode & 0o777, 0o700, `${label} is not private`);
      }

      app.setPath('userData', userDataPath);
      app.setPath('sessionData', sessionDataPath);
      app.enableSandbox();
      app.commandLine.appendSwitch('disable-background-networking');
      app.commandLine.appendSwitch('disable-component-update');
      app.commandLine.appendSwitch('disable-domain-reliability');
      app.commandLine.appendSwitch('disable-sync');
      await app.whenReady();

      const harnessSession = session.fromPartition(
        `slipstream-saved-terms-deferral-${scenario}-${process.pid}`,
        { cache: false },
      );
      harnessSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });
      harnessSession.setPermissionCheckHandler(() => false);
      if (scenario === 'returning-capture-stylesheet-recovery') {
        harnessSession.protocol.handle('file', async (request) => {
          try {
            const requestUrl = new URL(request.url);
            const requestedPath = fs.realpathSync(fileURLToPath(requestUrl));
            if (requestedPath !== renderer && !isInside(renderer, requestedPath)) {
              externalRequestUrls.push('file://outside-renderer');
              return new Response('Blocked renderer-boundary request', { status: 403 });
            }
            protocolResourceRequests.push({
              fileName: path.basename(requestedPath),
              path: path.relative(renderer, requestedPath),
              query: requestUrl.search,
            });
            if (
              path.basename(requestedPath) === 'SavedTermsLibrary.css'
              && requestUrl.search === ''
              && !primaryStylesheetFailureInjected
            ) {
              primaryStylesheetFailureInjected = true;
              primaryStylesheetFailureStatus = 503;
              stylesheetResponses.push({
                query: requestUrl.search,
                statusCode: primaryStylesheetFailureStatus,
              });
              return new Response('Fixed Saved Terms stylesheet failure', {
                status: primaryStylesheetFailureStatus,
                headers: {
                  'Cache-Control': 'no-store',
                  'Content-Type': 'text/css; charset=utf-8',
                },
              });
            }
            const response = await harnessSession.fetch(request, {
              bypassCustomProtocolHandlers: true,
            });
            if (path.basename(requestedPath) === 'SavedTermsLibrary.css') {
              stylesheetResponses.push({
                query: requestUrl.search,
                statusCode: response.status,
              });
            }
            return response;
          } catch {
            externalRequestUrls.push('invalid-file-protocol-request');
            return new Response('Invalid renderer request', { status: 400 });
          }
        });
      }
      harnessSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        try {
          const requestUrl = new URL(details.url);
          if (requestUrl.protocol !== 'file:') {
            externalRequestUrls.push(`${requestUrl.protocol}//${requestUrl.host}`);
            return callback({ cancel: true });
          }
          const requestedPath = fs.realpathSync(fileURLToPath(requestUrl));
          if (requestedPath !== renderer && !isInside(renderer, requestedPath)) {
            externalRequestUrls.push('file://outside-renderer');
            return callback({ cancel: true });
          }
          resourceRequests.push({
            fileName: path.basename(requestedPath),
            path: path.relative(renderer, requestedPath),
            query: requestUrl.search,
            resourceType: details.resourceType,
          });
          if (
            scenario === 'returning-capture-recovery'
            && path.basename(requestedPath) === 'SavedTermsLibrary.js'
            && requestUrl.search === ''
            && !primaryFailureInjected
          ) {
            primaryFailureInjected = true;
            return callback({ cancel: true });
          }
          return callback({ cancel: false });
        } catch {
          externalRequestUrls.push('invalid-request');
          return callback({ cancel: true });
        }
      });
      harnessSession.on('will-download', (event) => {
        externalEffectAttempts.download += 1;
        event.preventDefault();
      });

      window = new BrowserWindow({
        width: scenario === 'first-use-setup' ? 820 : 720,
        height: 720,
        show: false,
        backgroundColor: '#f4f2ed',
        webPreferences: {
          preload: __filename,
          session: harnessSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          spellcheck: false,
          backgroundThrottling: false,
          allowRunningInsecureContent: false,
        },
      });
      window.on('show', () => window.hide());
      if (scenario === 'returning-capture-stylesheet-recovery') {
        window.setContentSize(400, 400);
        window.webContents.setZoomFactor(2);
      }
      window.webContents.setWindowOpenHandler(() => {
        externalEffectAttempts.windowOpen += 1;
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event) => {
        externalEffectAttempts.navigation += 1;
        event.preventDefault();
      });
      window.webContents.on('will-redirect', (event) => {
        externalEffectAttempts.redirect += 1;
        event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && !completed) {
          void writeOutcome({
            protocol: PROTOCOL,
            scenario,
            error: `renderer load failed (${code}): ${description}`,
          }, 1);
        }
      });
      safetyTimeout = setTimeout(() => {
        if (!completed) {
          void writeOutcome({
            protocol: PROTOCOL,
            scenario,
            error: 'Saved Terms Electron harness timed out',
          }, 1);
        }
      }, 25_000);

      await window.loadFile(path.join(renderer, 'index.html'));
      if (scenario === 'returning-capture-stylesheet-recovery') {
        window.setContentSize(400, 400);
        window.webContents.setZoomFactor(2);
        await waitForRendererCondition(
          window,
          'window.innerWidth === 200 && window.innerHeight === 200',
          'Saved Terms stylesheet recovery 200x200 viewport',
        );
      }
      const readyExpression = scenario === 'first-use-setup'
        ? `document.querySelector('#setup-title')
          && document.querySelector('.setup-primary:not(:disabled)')
          && document.querySelector('.setup-secondary:not(:disabled)')`
        : `document.querySelector('.capture-card')
          && document.querySelector('.capture-input textarea:not(:disabled)')
          && document.querySelector('.saved-terms-trigger:not(:disabled)')`;
      await waitForRendererCondition(window, readyExpression, `${scenario} readiness`);
      if (scenario === 'returning-capture-data-truth') {
        await waitForRendererCondition(
          window,
          `window.slipstreamSavedTermsHarness?.getSummary().pendingTermsGetRequest === 1
            && window.slipstreamSavedTermsHarness.getSummary().invokeCounts['terms:get'] === 1
            && document.querySelector('.saved-terms-trigger[aria-busy="true"]')`,
          'Saved Terms controlled first read',
        );
      } else {
        await settleRenderer(window);
      }

      const startupSavedTermsRequests = savedTermsRequests(resourceRequests).length;
      const readyTarget = scenario;
      let interactionProof = {};
      if (scenario === 'returning-capture-data-truth') {
        const timeOriginBefore = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const rendererUrlBefore = window.webContents.getURL();
        const firstPendingSummary = await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.getSummary()
        `, true);

        await window.webContents.executeJavaScript(`
          (() => {
            const sampleButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent.includes('载入安全示例'));
            if (!sampleButton) throw new Error('Saved Terms startup sample action is unavailable');
            sampleButton.click();
            return true;
          })()
        `, true);
        await waitForRendererCondition(
          window,
          `(() => {
            const textarea = document.querySelector('.capture-input textarea');
            const analyze = document.querySelector('.process-button');
            const harness = window.slipstreamSavedTermsHarness?.getSummary();
            return Boolean(
              textarea?.value.startsWith('Dear Student,')
              && analyze
              && !analyze.disabled
              && document.activeElement === textarea
              && document.querySelector('.capture-sample-loaded')
              && document.querySelector('.saved-terms-trigger[aria-busy="true"]')
              && harness?.pendingTermsGetRequest === 1
              && harness?.invokeCounts?.['terms:get'] === 1
              && harness?.termsGetSettlements?.length === 0
            );
          })()`,
          'Saved Terms pending-read first interaction',
        );
        const firstInteractionProof = await window.webContents.executeJavaScript(`
          (() => {
            const textarea = document.querySelector('.capture-input textarea');
            const analyze = document.querySelector('.process-button');
            const harness = window.slipstreamSavedTermsHarness.getSummary();
            return {
              sourceLoaded: textarea?.value.startsWith('Dear Student,') || false,
              sourceFocused: document.activeElement === textarea,
              analyzeEnabled: Boolean(analyze && !analyze.disabled),
              termsReadStillPending: harness.pendingTermsGetRequest === 1,
              termsGetRequestCount: harness.invokeCounts['terms:get'] || 0,
              termsGetSettlementCount: harness.termsGetSettlements.length,
              sampleNoticeVisible: Boolean(document.querySelector('.capture-sample-loaded')),
            };
          })()
        `, true);
        await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger:not(:disabled)');
            if (!trigger) throw new Error('Saved Terms data-truth trigger is unavailable');
            trigger.click();
            return true;
          })()
        `, true);
        await waitForRendererCondition(
          window,
          `(() => {
            const dialog = document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]');
            const status = dialog?.querySelector('.saved-terms-workspace-state__notice[role="status"]');
            const statusText = status?.innerText || '';
            const lazyFallbackPresent = dialog?.matches('[data-workspace-loading="saved-terms"]')
              || dialog?.querySelector('[data-workspace-loading="saved-terms"]');
            return Boolean(dialog
              && status
              && !lazyFallbackPresent
              && statusText.includes('正在读取这台 Mac 上的术语')
              && dialog.contains(document.activeElement));
          })()`,
          'Saved Terms controlled loading dialog',
        );
        const loadingProof = await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger');
            const dialog = document.querySelector('#saved-terms-drawer');
            const drawerText = dialog?.innerText || '';
            const triggerLabel = trigger?.getAttribute('aria-label') || '';
            return {
              triggerLabel,
              triggerBusy: trigger?.getAttribute('aria-busy') === 'true',
              drawerSaysLoading: drawerText.includes('正在读取本机术语')
                && drawerText.includes('正在读取这台 Mac 上的术语'),
              falseZeroClaims: Number(/已保存\\s*0\\s*个术语/u.test(
                document.body.innerText + ' ' + triggerLabel,
              )),
              falseEmptyClaims: Number(drawerText.includes('还没有保存术语')),
              mutationOrTransferControls: dialog?.querySelectorAll(
                '.saved-term-card, .saved-terms-drawer__empty, .saved-term-transfer, '
                  + '[data-saved-term-copy-action], [data-saved-term-remove-id]',
              ).length || 0,
              dialogOwnedFocus: Boolean(dialog && dialog.contains(document.activeElement)),
            };
          })()
        `, true);
        await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.rejectTermsGet(1)
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelectorAll('#saved-terms-drawer [role="alert"]').length === 1
            && document.querySelector('[data-saved-terms-retry-load="true"]')
            && document.querySelector('[data-saved-terms-return-to-task="true"]')
            && document.querySelector('#saved-terms-drawer').contains(document.activeElement)`,
          'Saved Terms controlled rejected read',
        );
        const rejectedProof = await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger');
            const dialog = document.querySelector('#saved-terms-drawer');
            const drawerText = dialog?.innerText || '';
            const triggerLabel = trigger?.getAttribute('aria-label') || '';
            return {
              alertCount: dialog?.querySelectorAll('[role="alert"]').length || 0,
              retryCount: dialog?.querySelectorAll('[data-saved-terms-retry-load="true"]').length || 0,
              headerCloseCount: dialog?.querySelectorAll('[aria-label="关闭术语库"]').length || 0,
              returnToTaskCount: dialog?.querySelectorAll('[data-saved-terms-return-to-task="true"]').length || 0,
              triggerLabel,
              falseZeroClaims: Number(/已保存\\s*0\\s*个术语/u.test(
                document.body.innerText + ' ' + triggerLabel,
              )),
              falseEmptyClaims: Number(drawerText.includes('还没有保存术语')),
              mutationOrTransferControls: dialog?.querySelectorAll(
                '.saved-term-card, .saved-terms-drawer__empty, .saved-term-transfer, '
                  + '[data-saved-term-copy-action], [data-saved-term-remove-id]',
              ).length || 0,
              dialogOwnedFocus: Boolean(dialog && dialog.contains(document.activeElement)),
            };
          })()
        `, true);

        await window.webContents.executeJavaScript(`
          document.querySelector('[data-saved-terms-retry-load="true"]')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `window.slipstreamSavedTermsHarness.getSummary().pendingTermsGetRequest === 2
            && document.querySelector('.saved-terms-trigger[aria-busy="true"]')
            && document.querySelector('#saved-terms-drawer [role="status"]')`,
          'Saved Terms controlled invalid retry pending',
        );
        await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.resolveTermsGetInvalid(2)
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelectorAll('#saved-terms-drawer [role="alert"]').length === 1
            && document.querySelectorAll('[data-saved-terms-retry-load="true"]').length === 1
            && document.querySelector('#saved-terms-drawer').contains(document.activeElement)`,
          'Saved Terms controlled invalid retry recovery',
        );
        const invalidProof = await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger');
            const dialog = document.querySelector('#saved-terms-drawer');
            const drawerText = dialog?.innerText || '';
            const triggerLabel = trigger?.getAttribute('aria-label') || '';
            return {
              alertCount: dialog?.querySelectorAll('[role="alert"]').length || 0,
              retryCount: dialog?.querySelectorAll('[data-saved-terms-retry-load="true"]').length || 0,
              headerCloseCount: dialog?.querySelectorAll('[aria-label="关闭术语库"]').length || 0,
              triggerLabel,
              falseZeroClaims: Number(/已保存\\s*0\\s*个术语/u.test(
                document.body.innerText + ' ' + triggerLabel,
              )),
              falseEmptyClaims: Number(drawerText.includes('还没有保存术语')),
              mutationOrTransferControls: dialog?.querySelectorAll(
                '.saved-term-card, .saved-terms-drawer__empty, .saved-term-transfer, '
                  + '[data-saved-term-copy-action], [data-saved-term-remove-id]',
              ).length || 0,
              dialogOwnedFocus: Boolean(dialog && dialog.contains(document.activeElement)),
            };
          })()
        `, true);

        await window.webContents.executeJavaScript(`
          document.querySelector('[data-saved-terms-retry-load="true"]')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `window.slipstreamSavedTermsHarness.getSummary().pendingTermsGetRequest === 3
            && document.querySelector('.saved-terms-trigger[aria-busy="true"]')
            && document.querySelector('#saved-terms-drawer [role="status"]')`,
          'Saved Terms controlled ready retry pending',
        );
        await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.resolveTermsGetReady(3)
        `, true);
        await waitForRendererCondition(
          window,
          `(() => {
            const dialog = document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]');
            const trigger = document.querySelector('.saved-terms-trigger');
            const card = dialog?.querySelector('.saved-term-card');
            return Boolean(
              dialog
              && trigger?.getAttribute('aria-label') === '打开术语库，已保存 1 个术语'
              && document.querySelector('#saved-term-drawer-search')
              && card?.innerText.includes('CAS')
              && dialog.contains(document.activeElement)
            );
          })()`,
          'Saved Terms controlled ready state',
        );
        const readyProof = await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger');
            const dialog = document.querySelector('#saved-terms-drawer');
            const card = dialog?.querySelector('.saved-term-card');
            return {
              triggerLabel: trigger?.getAttribute('aria-label') || '',
              triggerVisualCount: trigger?.querySelector('strong')?.innerText || '',
              headerSaysOne: Boolean(dialog?.innerText.includes('已保存 1 个术语')),
              searchCount: dialog?.querySelectorAll('#saved-term-drawer-search').length || 0,
              cardCount: dialog?.querySelectorAll('.saved-term-card').length || 0,
              sampleTermVisible: Boolean(card?.innerText.includes('CAS')),
              dialogOwnedFocus: Boolean(dialog && dialog.contains(document.activeElement)),
            };
          })()
        `, true);
        const finalAdapterSummary = await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.getSummary()
        `, true);
        const timeOriginAfter = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        interactionProof = {
          firstPendingTermsGetRequest: firstPendingSummary.pendingTermsGetRequest,
          firstPendingTermsGetCount: firstPendingSummary.invokeCounts['terms:get'] || 0,
          firstPendingSettlementCount: firstPendingSummary.termsGetSettlements.length,
          firstInteractionProof,
          loadingProof,
          rejectedProof,
          invalidProof,
          readyProof,
          finalTermsGetRequests: finalAdapterSummary.invokeCounts['terms:get'] || 0,
          finalTermsGetPendingRequest: finalAdapterSummary.pendingTermsGetRequest,
          termsGetSettlements: finalAdapterSummary.termsGetSettlements,
          rendererTimeOriginPreserved: timeOriginAfter === timeOriginBefore,
          rendererUrlPreserved: window.webContents.getURL() === rendererUrlBefore,
        };
      } else if (scenario === 'returning-capture-empty') {
        const timeOriginBefore = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        await waitForRendererCondition(
          window,
          `document.querySelector('.saved-terms-trigger')?.getAttribute('aria-label')
            === '打开术语库，已保存 0 个术语'`,
          'Saved Terms truthful ready-empty trigger',
        );
        await window.webContents.executeJavaScript(`
          document.querySelector('.saved-terms-trigger:not(:disabled)')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `(() => {
            const dialog = document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]');
            const importAction = dialog?.querySelector('.saved-terms-drawer__empty button');
            return Boolean(dialog && importAction && document.activeElement === importAction);
          })()`,
          'Saved Terms ready-empty import focus',
        );
        const emptyProof = await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger');
            const dialog = document.querySelector('#saved-terms-drawer');
            const enabledImportActions = [...(dialog?.querySelectorAll('button:not(:disabled)') || [])]
              .filter((button) => /^导入(?:已有)?备份$/u.test(
                button.textContent.replace(/\\s+/gu, ' ').trim(),
              ));
            const importAction = dialog?.querySelector('.saved-terms-drawer__empty button');
            return {
              triggerLabel: trigger?.getAttribute('aria-label') || '',
              triggerVisualCount: trigger?.querySelector('strong')?.innerText || '',
              emptyOwnerCount: dialog?.querySelectorAll('.saved-terms-drawer__empty').length || 0,
              enabledImportActionCount: enabledImportActions.length,
              searchCount: dialog?.querySelectorAll('#saved-term-drawer-search').length || 0,
              cardCount: dialog?.querySelectorAll('.saved-term-card').length || 0,
              importFocusedOnOpen: document.activeElement === importAction,
            };
          })()
        `, true);
        await window.webContents.executeJavaScript(`
          document.querySelector('#saved-terms-drawer .saved-terms-drawer__empty button')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('#term-import-trust-review')
            && document.activeElement === document.querySelector('#term-import-trust-review')`,
          'Saved Terms ready-empty import preview focus',
        );
        const importPreviewProof = await window.webContents.executeJavaScript(`
          (() => {
            const trustReview = document.querySelector('#term-import-trust-review');
            return {
              visible: Boolean(trustReview),
              focused: document.activeElement === trustReview,
            };
          })()
        `, true);
        await window.webContents.executeJavaScript(`
          (() => {
            const preview = document.querySelector('#term-import-trust-review')
              ?.closest('.saved-term-transfer__confirm');
            const cancel = [...(preview?.querySelectorAll('button') || [])].find((button) => (
              button.textContent.replace(/\\s+/gu, ' ').trim() === '取消'
            ));
            if (!cancel) throw new Error('Saved Terms ready-empty import cancel is unavailable');
            cancel.click();
            return true;
          })()
        `, true);
        await waitForRendererCondition(
          window,
          `!document.querySelector('#term-import-trust-review')
            && document.activeElement
              === document.querySelector('#saved-terms-drawer .saved-terms-drawer__empty button')`,
          'Saved Terms ready-empty import cancel focus return',
        );
        const timeOriginAfter = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        interactionProof = {
          ...emptyProof,
          importPreviewVisible: importPreviewProof.visible,
          importPreviewFocused: importPreviewProof.focused,
          cancelReturnedToImport: await window.webContents.executeJavaScript(
            `document.activeElement
              === document.querySelector('#saved-terms-drawer .saved-terms-drawer__empty button')`,
            true,
          ),
          rendererTimeOriginPreserved: timeOriginAfter === timeOriginBefore,
        };
      } else if (scenario === 'returning-capture-stylesheet-recovery') {
        const timeOriginBefore = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const rendererUrlBefore = window.webContents.getURL();
        const resourcesBeforeOpen = protocolResourceRequests.length;
        await window.webContents.executeJavaScript(`
          document.querySelector('.saved-terms-trigger:not(:disabled)').click()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('[data-workspace-load-failure="saved-terms"] #saved-terms-drawer[role="dialog"][aria-modal="true"]')
            && document.activeElement
              === document.querySelector('[data-workspace-retry="saved-terms"]')`,
          'Saved Terms stylesheet load recovery',
        );
        await settleRenderer(window);
        const failureProof = await window.webContents.executeJavaScript(`
          (async () => {
            const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
            const failure = document.querySelector(
              '[data-workspace-load-failure="saved-terms"]',
            );
            const dialog = failure?.querySelector(
              '#saved-terms-drawer[role="dialog"][aria-modal="true"]',
            );
            const body = dialog?.querySelector('.saved-terms-drawer__body');
            const alert = dialog?.querySelector('[role="alert"]');
            const actions = dialog?.querySelector('.saved-terms-workspace-state__actions');
            const hint = dialog?.querySelector('.saved-terms-workspace-state__hint');
            const close = dialog?.querySelector('[aria-label="关闭术语库"]');
            const retry = dialog?.querySelector('[data-workspace-retry="saved-terms"]');
            const returnAction = dialog?.querySelector(
              '[data-workspace-return="saved-terms"]',
            );
            if (!failure || !dialog || !body || !alert || !actions || !hint
              || !close || !retry || !returnAction) {
              throw new Error('Saved Terms stylesheet recovery surface is incomplete');
            }
            const initialRetryFocused = document.activeElement === retry;
            const shell = failure.closest('.slipstream-shell');
            const background = shell
              ? [...shell.children].filter((node) => node !== failure)
              : [];
            const failureRect = failure.getBoundingClientRect();
            const dialogRect = dialog.getBoundingClientRect();
            const backdropStyle = getComputedStyle(failure);
            const dialogStyle = getComputedStyle(dialog);
            const bodyStyle = getComputedStyle(body);
            const actionsStyle = getComputedStyle(actions);
            const activeVerticalScrollOwner = (node) => {
              const overflowY = getComputedStyle(node).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && node.scrollHeight > node.clientHeight + 1;
            };
            const scrollCandidates = [failure, dialog, body, alert, actions, hint];
            const verticalScrollOwners = scrollCandidates.filter(activeVerticalScrollOwner);
            const reveal = async (target, { focus = false } = {}) => {
              if (focus) target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              await nextFrame();
              await nextFrame();
              const targetRect = target.getBoundingClientRect();
              const currentDialogRect = dialog.getBoundingClientRect();
              const top = Math.max(0, currentDialogRect.top);
              const right = Math.min(window.innerWidth, currentDialogRect.right);
              const bottom = Math.min(window.innerHeight, currentDialogRect.bottom);
              const left = Math.max(0, currentDialogRect.left);
              return {
                focused: !focus || document.activeElement === target,
                horizontallyContained: targetRect.left >= left - 1
                  && targetRect.right <= right + 1,
                verticallyIntersects: targetRect.bottom >= top - 1
                  && targetRect.top <= bottom + 1,
                verticallyContained: targetRect.top >= top - 1
                  && targetRect.bottom <= bottom + 1,
                scrollLeftZero: dialog.scrollLeft === 0,
              };
            };
            const revealPassiveEdges = async (target) => {
              target.scrollIntoView({ block: 'start', inline: 'nearest' });
              await nextFrame();
              await nextFrame();
              const startRect = target.getBoundingClientRect();
              const startDialogRect = dialog.getBoundingClientRect();
              target.scrollIntoView({ block: 'end', inline: 'nearest' });
              await nextFrame();
              await nextFrame();
              const endRect = target.getBoundingClientRect();
              const endDialogRect = dialog.getBoundingClientRect();
              return {
                horizontallyContained: startRect.left >= startDialogRect.left - 1
                  && startRect.right <= startDialogRect.right + 1
                  && endRect.left >= endDialogRect.left - 1
                  && endRect.right <= endDialogRect.right + 1,
                topEdgeReachable: startRect.top >= Math.max(0, startDialogRect.top) - 1
                  && startRect.top <= Math.min(window.innerHeight, startDialogRect.bottom) + 1,
                bottomEdgeReachable: endRect.bottom
                    >= Math.max(0, endDialogRect.top) - 1
                  && endRect.bottom
                    <= Math.min(window.innerHeight, endDialogRect.bottom) + 1,
                scrollLeftZero: dialog.scrollLeft === 0,
              };
            };
            const alertReachability = await revealPassiveEdges(alert);
            const hintReachability = await revealPassiveEdges(hint);
            const closeReachability = await reveal(close, { focus: true });
            const returnReachability = await reveal(returnAction, { focus: true });
            const retryReachability = await reveal(retry, { focus: true });
            const privateControlCount = dialog.querySelectorAll(
              '.saved-terms-drawer__privacy, #saved-term-drawer-search, '
                + '.saved-term-card, .saved-term-transfer, '
                + '[data-saved-term-copy-action], [data-saved-term-remove-id], '
                + '[data-saved-terms-retry-load]',
            ).length;
            return {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              dialogCount: document.querySelectorAll(
                '#saved-terms-drawer[role="dialog"][aria-modal="true"]',
              ).length,
              alertCount: dialog.querySelectorAll('[role="alert"]').length,
              initialRetryFocused,
              retryFocusedAfterReachability: document.activeElement === retry,
              backgroundInert: background.length > 0
                && background.every((node) => (
                  node.inert && node.getAttribute('aria-hidden') === 'true'
                )),
              privateControlCount,
              failedStylesheetLinkCount: document.querySelectorAll(
                'link[data-workspace-stylesheet="saved-terms"]',
              ).length,
              eagerStyle: {
                backdropFixed: backdropStyle.position === 'fixed',
                backdropFlex: backdropStyle.display === 'flex',
                dialogFlex: dialogStyle.display === 'flex'
                  && dialogStyle.flexDirection === 'column',
                dialogOpaque: dialogStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
                bodyGrid: bodyStyle.display === 'grid',
                actionsGrid: actionsStyle.display === 'grid',
              },
              geometry: {
                backdropWithinViewport: failureRect.left >= -1
                  && failureRect.top >= -1
                  && failureRect.right <= window.innerWidth + 1
                  && failureRect.bottom <= window.innerHeight + 1,
                dialogWithinViewport: dialogRect.left >= -1
                  && dialogRect.top >= -1
                  && dialogRect.right <= window.innerWidth + 1
                  && dialogRect.bottom <= window.innerHeight + 1,
                backdropVisible: failureRect.width > 0 && failureRect.height > 0,
                dialogVisible: dialogRect.width > 0 && dialogRect.height > 0,
                noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1
                  && document.documentElement.scrollWidth <= window.innerWidth + 1,
              },
              scrollOwnership: {
                ownerCount: verticalScrollOwners.length,
                dialogIsOnlyOwner: verticalScrollOwners.length === 1
                  && verticalScrollOwners[0] === dialog,
                dialogOverflowY: dialogStyle.overflowY,
                bodyOverflowY: bodyStyle.overflowY,
                dialogHasRange: dialog.scrollHeight > dialog.clientHeight + 1,
                bodyHasRange: body.scrollHeight > body.clientHeight + 1,
              },
              reachability: {
                alert: alertReachability,
                hint: hintReachability,
                close: closeReachability,
                retry: retryReachability,
                returnAction: returnReachability,
              },
            };
          })()
        `, true);
        await captureStylesheetEvidence(stylesheetEvidenceFileNames[0]);
        await window.webContents.executeJavaScript(`
          document.querySelector('[data-workspace-retry="saved-terms"]')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `(() => {
            const link = document.querySelector(
              'link[data-workspace-stylesheet="saved-terms"][data-workspace-attempt="1"][data-workspace-loaded="true"]',
            );
            return Boolean(
              link
              && document.querySelectorAll(
                'link[data-workspace-stylesheet="saved-terms"]',
              ).length === 1
              && document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]')
              && document.activeElement === document.querySelector('#saved-term-drawer-search')
            );
          })()`,
          'Saved Terms stylesheet recovered workspace',
        );
        await settleRenderer(window);
        const recoveredProof = await window.webContents.executeJavaScript(`
          (() => {
            const links = [...document.querySelectorAll(
              'link[data-workspace-stylesheet="saved-terms"]',
            )];
            const link = links[0] || null;
            const privacy = document.querySelector(
              '#saved-terms-drawer .saved-terms-drawer__privacy',
            );
            const searchRegion = document.querySelector(
              '#saved-terms-drawer .saved-term-search',
            );
            let privateRuleLoaded = false;
            try {
              privateRuleLoaded = Boolean(link?.sheet)
                && [...link.sheet.cssRules].some((rule) => (
                  rule.cssText.includes('.saved-terms-drawer__privacy')
                ));
            } catch {
              privateRuleLoaded = false;
            }
            return {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              linkCount: links.length,
              linkAttempt: link?.dataset.workspaceAttempt || null,
              linkLoaded: link?.dataset.workspaceLoaded || null,
              privateRuleLoaded,
              privateRuleApplied: getComputedStyle(privacy).display === 'flex'
                && getComputedStyle(searchRegion).display === 'grid',
              searchFocused: document.activeElement
                === document.querySelector('#saved-term-drawer-search'),
            };
          })()
        `, true);
        await captureStylesheetEvidence(stylesheetEvidenceFileNames[1]);
        const timeOriginAfter = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const finalAdapterSummary = await window.webContents.executeJavaScript(`
          window.slipstreamSavedTermsHarness.getSummary()
        `, true);
        const workspaceRequests = protocolResourceRequests
          .slice(resourcesBeforeOpen)
          .filter((request) => [
            'SavedTermsLibrary.js',
            'SavedTermsLibrary.css',
          ].includes(request.fileName));
        const javaScriptRequests = workspaceRequests.filter((request) => (
          request.fileName === 'SavedTermsLibrary.js'
        ));
        const stylesheetRequests = workspaceRequests.filter((request) => (
          request.fileName === 'SavedTermsLibrary.css'
        ));
        const invokeCounts = finalAdapterSummary.invokeCounts;
        const countInvokes = (channels) => channels.reduce(
          (total, channel) => total + (invokeCounts[channel] || 0),
          0,
        );
        const providerCalls = Object.entries(invokeCounts).reduce(
          (total, [channel, count]) => (
            /^(?:llm|provider|verification):/u.test(channel) ? total + count : total
          ),
          0,
        );
        interactionProof = {
          primaryStylesheetFailureInjected,
          primaryStylesheetFailureStatus,
          loadFailureDialogCount: failureProof.dialogCount,
          loadFailureAlertCount: failureProof.alertCount,
          retryFocused: failureProof.initialRetryFocused,
          retryFocusedAfterReachability: failureProof.retryFocusedAfterReachability,
          backgroundInertDuringFailure: failureProof.backgroundInert,
          privateControlsDuringFailure: failureProof.privateControlCount,
          failedStylesheetLinkCount: failureProof.failedStylesheetLinkCount,
          eagerRecoveryStyle: failureProof.eagerStyle,
          recoveryViewport: failureProof.viewport,
          recoveryGeometry: failureProof.geometry,
          recoveryScrollOwnership: failureProof.scrollOwnership,
          recoveryReachability: failureProof.reachability,
          recoveredViewport: recoveredProof.viewport,
          loadedStylesheetLinkCount: recoveredProof.linkCount,
          loadedStylesheetAttempt: recoveredProof.linkAttempt,
          loadedStylesheetReady: recoveredProof.linkLoaded,
          privateRuleLoaded: recoveredProof.privateRuleLoaded,
          privateRuleApplied: recoveredProof.privateRuleApplied,
          recoveredSearchFocused: recoveredProof.searchFocused,
          rendererTimeOriginPreserved: timeOriginAfter === timeOriginBefore,
          rendererUrlPreserved: window.webContents.getURL() === rendererUrlBefore,
          javaScriptRequestCount: javaScriptRequests.length,
          stylesheetRequestCount: stylesheetRequests.length,
          primaryJavaScriptQuery: javaScriptRequests[0]?.query || '',
          retryJavaScriptQuery: javaScriptRequests[1]?.query || '',
          primaryStylesheetQuery: stylesheetRequests[0]?.query || '',
          retryStylesheetQuery: stylesheetRequests[1]?.query || '',
          sameJavaScriptPhysicalPath: javaScriptRequests.length === 2
            && javaScriptRequests[0].path === javaScriptRequests[1].path,
          sameStylesheetPhysicalPath: stylesheetRequests.length === 2
            && stylesheetRequests[0].path === stylesheetRequests[1].path,
          rendererDocumentRequests: protocolResourceRequests.filter((request) => (
            request.path === 'index.html'
          )).length,
          prohibitedEffects: {
            termMutations: countInvokes(['terms:save', 'terms:delete']),
            termImports: countInvokes(['terms:import-preview', 'terms:import-commit']),
            termExports: countInvokes(['terms:export']),
            clipboardReadsOrWrites: countInvokes(['clipboard:read', 'clipboard:write']),
            providerCalls,
            reloads: Math.max(0, protocolResourceRequests.filter((request) => (
              request.path === 'index.html'
            )).length - 1),
            externalRequests: externalRequestUrls.length,
            ...externalEffectAttempts,
          },
          stylesheetResponses,
          evidenceFiles: [...evidenceFiles],
        };
      } else if (scenario === 'returning-capture-recovery') {
        const timeOriginBefore = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const resourcesBeforeOpen = resourceRequests.length;
        await window.webContents.executeJavaScript(`
          document.querySelector('.saved-terms-trigger:not(:disabled)').click()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('[data-workspace-load-failure="saved-terms"] #saved-terms-drawer[role="dialog"][aria-modal="true"]')
            && document.querySelector('[data-workspace-retry="saved-terms"]')`,
          'Saved Terms load recovery',
        );
        await settleRenderer(window);
        const failureProof = await window.webContents.executeJavaScript(`
          (() => {
            const failure = document.querySelector('[data-workspace-load-failure="saved-terms"]');
            const retry = document.querySelector('[data-workspace-retry="saved-terms"]');
            const shell = failure?.closest('.slipstream-shell');
            const background = shell
              ? [...shell.children].filter((node) => node !== failure)
              : [];
            return {
              dialogCount: document.querySelectorAll('#saved-terms-drawer[role="dialog"][aria-modal="true"]').length,
              alertCount: failure?.querySelectorAll('[role="alert"]').length || 0,
              retryFocused: document.activeElement === retry,
              backgroundInert: background.length > 0
                && background.every((node) => node.inert && node.getAttribute('aria-hidden') === 'true'),
            };
          })()
        `, true);
        await window.webContents.executeJavaScript(`
          document.querySelector('[data-workspace-retry="saved-terms"]')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]')
            && document.activeElement === document.querySelector('#saved-term-drawer-search')`,
          'Saved Terms recovered workspace',
        );
        await settleRenderer(window);
        const recoveredSearchFocused = await window.webContents.executeJavaScript(
          `document.activeElement === document.querySelector('#saved-term-drawer-search')`,
          true,
        );
        await window.webContents.executeJavaScript(`
          document.querySelector('#saved-terms-drawer [aria-label="关闭术语库"]')?.click()
        `, true);
        await waitForRendererCondition(
          window,
          `!document.querySelector('#saved-terms-drawer')
            && document.activeElement === document.querySelector('.saved-terms-trigger')`,
          'Saved Terms recovered trigger return',
        );
        const timeOriginAfter = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const recoveryRequests = resourceRequests.slice(resourcesBeforeOpen);
        const recoverySavedTermsRequests = savedTermsRequests(resourceRequests);
        const recoveryStylesheetRequests = recoveryRequests.filter((request) => (
          request.fileName === 'SavedTermsLibrary.css'
        ));
        interactionProof = {
          primaryFailureInjected,
          loadFailureDialogCount: failureProof.dialogCount,
          loadFailureAlertCount: failureProof.alertCount,
          retryFocused: failureProof.retryFocused,
          backgroundInertDuringFailure: failureProof.backgroundInert,
          recoveredSearchFocused,
          focusReturnedToTrigger: await window.webContents.executeJavaScript(
            `document.activeElement === document.querySelector('.saved-terms-trigger')`,
            true,
          ),
          rendererTimeOriginPreserved: timeOriginAfter === timeOriginBefore,
          finalSavedTermsRequests: recoverySavedTermsRequests.length,
          primaryRequestQuery: recoverySavedTermsRequests[0]?.query || '',
          retryRequestQuery: recoverySavedTermsRequests[1]?.query || '',
          recoveryAsyncStylesheets: recoveryStylesheetRequests.length,
          recoveryStylesheetQuery: recoveryStylesheetRequests[0]?.query || '',
        };
      } else if (scenario === 'returning-capture') {
        const timeOriginBefore = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const resourcesBeforeOpen = resourceRequests.length;
        await window.webContents.executeJavaScript(`
          (() => {
            const trigger = document.querySelector('.saved-terms-trigger:not(:disabled)');
            if (!trigger) throw new Error('Saved Terms trigger is unavailable');
            trigger.click();
            return true;
          })()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('#saved-terms-drawer[role="dialog"][aria-modal="true"]')
            && document.querySelector('#saved-term-drawer-search')`,
          'Saved Terms first open',
        );
        await settleRenderer(window);
        const firstOpenFocus = await window.webContents.executeJavaScript(`
          (() => {
            const dialog = document.querySelector('#saved-terms-drawer');
            const search = document.querySelector('#saved-term-drawer-search');
            return {
              dialogOwnedFocus: Boolean(dialog && dialog.contains(document.activeElement)),
              searchFocused: document.activeElement === search,
            };
          })()
        `, true);
        const firstOpenRequests = resourceRequests.slice(resourcesBeforeOpen);
        const firstSavedTermsRequests = savedTermsRequests(resourceRequests);
        const firstStylesheetRequests = firstOpenRequests.filter((request) => (
          request.fileName === 'SavedTermsLibrary.css'
        ));
        const resourcesAfterFirstOpen = resourceRequests.length;

        await window.webContents.executeJavaScript(`
          (() => {
            const close = document.querySelector('#saved-terms-drawer [aria-label="关闭术语库"]');
            if (!close) throw new Error('Saved Terms close action is unavailable');
            close.click();
            return true;
          })()
        `, true);
        await waitForRendererCondition(
          window,
          `!document.querySelector('#saved-terms-drawer')
            && document.activeElement === document.querySelector('.saved-terms-trigger')`,
          'Saved Terms trigger focus return',
        );
        const focusReturnedToTrigger = await window.webContents.executeJavaScript(
          `document.activeElement === document.querySelector('.saved-terms-trigger')`,
          true,
        );

        await window.webContents.executeJavaScript(`
          document.querySelector('.saved-terms-trigger:not(:disabled)').click()
        `, true);
        await waitForRendererCondition(
          window,
          `document.querySelector('#saved-terms-drawer[aria-modal="true"]')
            && document.activeElement === document.querySelector('#saved-term-drawer-search')`,
          'Saved Terms reopen focus',
        );
        await settleRenderer(window);
        const timeOriginAfter = await window.webContents.executeJavaScript(
          'performance.timeOrigin',
          true,
        );
        const searchFocusedOnReopen = await window.webContents.executeJavaScript(
          `document.activeElement === document.querySelector('#saved-term-drawer-search')`,
          true,
        );
        const importSessionProof = await window.webContents.executeJavaScript(`
          (async () => {
            const drawer = document.querySelector('#saved-terms-drawer');
            const importButton = [...(drawer?.querySelectorAll('button') || [])].find((button) => (
              button.textContent.replace(/\\s+/gu, ' ').trim() === '导入备份'
            ));
            if (!drawer || !importButton || importButton.disabled) {
              throw new Error('Saved Terms import preview is unavailable');
            }
            importButton.focus({ preventScroll: true });
            importButton.click();
            const deadline = performance.now() + 7_000;
            let trustReview = null;
            while (performance.now() < deadline) {
              trustReview = document.querySelector('#term-import-trust-review');
              if (trustReview && document.activeElement === trustReview) break;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const currentDrawer = document.querySelector('#saved-terms-drawer');
            const close = currentDrawer?.querySelector('[aria-label="关闭术语库"]');
            return {
              visible: Boolean(trustReview),
              focused: document.activeElement === trustReview,
              sessionPreserved: currentDrawer === drawer,
              closeEnabled: Boolean(close && !close.disabled),
            };
          })()
        `, true);
        interactionProof = {
          firstOpenSavedTermsRequests: firstSavedTermsRequests.length,
          finalSavedTermsRequests: savedTermsRequests(resourceRequests).length,
          firstOpenResourceRequests: firstOpenRequests.length,
          closeAndReopenResourceRequests: resourceRequests.length - resourcesAfterFirstOpen,
          firstRequestQuery: firstSavedTermsRequests[0]?.query || '',
          firstOpenAsyncStylesheets: firstStylesheetRequests.length,
          firstStylesheetRequestQuery: firstStylesheetRequests[0]?.query || '',
          dialogOwnedFocus: firstOpenFocus.dialogOwnedFocus,
          searchFocusedOnFirstOpen: firstOpenFocus.searchFocused,
          focusReturnedToTrigger,
          searchFocusedOnReopen,
          importPreviewVisible: importSessionProof.visible,
          importPreviewFocused: importSessionProof.focused,
          importSessionPreserved: importSessionProof.sessionPreserved,
          importPreviewCloseEnabled: importSessionProof.closeEnabled,
          rendererTimeOriginPreserved: timeOriginAfter === timeOriginBefore,
        };
      }

      const adapterSummary = await window.webContents.executeJavaScript(`
        (() => {
          const adapter = window.slipstreamSavedTermsHarness;
          if (!adapter || adapter.protocol !== ${JSON.stringify(PROTOCOL)}) {
            throw new Error('Saved Terms fixed adapter is unavailable');
          }
          return adapter.getSummary();
        })()
      `, true);
      assert.equal(adapterSummary.scenario, scenario);

      completed = true;
      clearTimeout(safetyTimeout);
      await writeOutcome({
        protocol: PROTOCOL,
        scenario,
        readyTarget,
        startupSavedTermsRequests,
        ...interactionProof,
        externalRequests: externalRequestUrls.length,
        adapterInvokeCounts: adapterSummary.invokeCounts,
        unexpectedCalls: adapterSummary.unexpectedCalls,
        unexpectedWrites: adapterSummary.unexpectedWrites,
        resourceRequests,
      }, 0);
    } catch (error) {
      completed = true;
      if (safetyTimeout) clearTimeout(safetyTimeout);
      await writeOutcome({
        protocol: PROTOCOL,
        scenario: scenario || 'unknown',
        error: error?.stack || error?.message || 'Saved Terms Electron harness failed',
      }, 1);
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
    }
  }

  const flagIndex = process.argv.indexOf(HARNESS_FLAG);
  if (flagIndex >= 0) {
    void runElectronChild(process.argv.slice(flagIndex + 1));
  } else {
    runParent()
      .then((proofs) => {
        console.log('Saved Terms production deferral Electron runtime check passed.');
        console.log(JSON.stringify(proofs, null, 2));
      })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
