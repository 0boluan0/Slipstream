const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const launcherPath = path.join(__dirname, 'run-ui-fixture.js');
const outputPrefix = '__SLIPSTREAM_UI_FIXTURE_CHECK__';
const clipboardTransactionOutputPrefix = '__SLIPSTREAM_UI_FIXTURE_CLIPBOARD_TRANSACTION__';
const clipboardTransactionRun = 'clipboard-app-transaction-native';
const clipboardResidueRecoveryRun = 'clipboard-residue-recovery-native';
const settingsTextScaleRun = 'settings-transition-text-scale-native';
const firstUseCaptureTextScaleRun = 'first-use-capture-text-scale-native';
const completedResultTextScaleRun = 'completed-result-text-scale-native';
const guidedReplyTextScaleRun = 'guided-reply-text-scale-native';
const stackedStatusTextScaleRun = 'stacked-status-text-scale-native';
const settingsSaveRetryRun = 'settings-save-retry-native';
const settingsPromptDraftRecoveryRun = 'settings-prompt-draft-recovery-native';
const lazyWorkspaceRecoveryRun = 'lazy-workspace-recovery-native';
const resultStylesheetRecoveryRun = 'result-stylesheet-recovery-native';
const settingsStylesheetCollisionRun = 'settings-stylesheet-collision-native';
const manualClipboardReplacementRun = 'manual-clipboard-replacement-native';
const commandQSafeExitRun = 'command-q-safe-exit-native';
const commandQSafeExitOutputPrefix = '__SLIPSTREAM_UI_FIXTURE_COMMAND_Q_SAFE_EXIT__';
const commandCommaSafeSettingsRun = 'command-comma-safe-settings-native';
const commandCommaSafeSettingsOutputPrefix = '__SLIPSTREAM_UI_FIXTURE_COMMAND_COMMA_SETTINGS__';
const timeoutMs = 60_000;
const launcherTerminationGraceMs = 12_000;

function startNetworkTrap() {
  return new Promise((resolve, reject) => {
    let requestCount = 0;
    const server = http.createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(204).end();
    });
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address !== 'object' || !Number.isInteger(address.port)) {
        server.close();
        reject(new Error('Failed to start the UI fixture network trap'));
        return;
      }
      resolve({
        port: address.port,
        get requestCount() {
          return requestCount;
        },
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) closeReject(error);
            else closeResolve();
          });
        }),
      });
    });
  });
}

function createFixtureRuntimeTempRoot() {
  const createdPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-ui-fixture-runtime-'));
  fs.chmodSync(createdPath, 0o700);
  const realPath = fs.realpathSync(createdPath);
  const stats = fs.statSync(realPath);
  return Object.freeze({ realPath, device: stats.dev, inode: stats.ino });
}

function removeFixtureRuntimeTempRoot(ownedRoot) {
  const realPath = fs.realpathSync(ownedRoot.realPath);
  const stats = fs.statSync(realPath);
  if (
    realPath !== ownedRoot.realPath
    || !stats.isDirectory()
    || stats.dev !== ownedRoot.device
    || stats.ino !== ownedRoot.inode
  ) {
    throw new Error('UI fixture runtime temp-root identity changed');
  }
  fs.rmSync(realPath, { force: true, recursive: true });
}

function fixtureDirectories(tempRoot) {
  return new Set(fs.readdirSync(tempRoot)
    .filter((entry) => /^slipstream-ui-fixture-[A-Za-z0-9]{6}$/u.test(entry)));
}

function newlyCreatedFixtureDirectories(before, tempRoot) {
  return [...fixtureDirectories(tempRoot)]
    .filter((entry) => !before.has(entry))
    .sort();
}

async function waitForNoNewFixtureDirectories(before, tempRoot, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let created = newlyCreatedFixtureDirectories(before, tempRoot);
  while (created.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    created = newlyCreatedFixtureDirectories(before, tempRoot);
  }
  return created;
}

function runLauncher(trapPort, tempRoot, run = 'native-runtime') {
  return new Promise((resolve, reject) => {
    const environment = {
      ...process.env,
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      DEEPSEEK_API_KEY: 'fixture-secret-must-not-cross',
      OPENAI_API_KEY: 'fixture-secret-must-not-cross',
      SSH_AUTH_SOCK: '/tmp/fixture-authority-must-not-cross',
      NODE_OPTIONS: '--trace-warnings',
    };
    delete environment.SLIPSTREAM_DEMO_RESULT;
    delete environment.SLIPSTREAM_UI_FIXTURE_RENDERER_URL;
    delete environment.SLIPSTREAM_UI_FIXTURE_USER_DATA;

    const fixturePath = run === clipboardTransactionRun
      ? `/?demo=result&terms=sample&connection=unreachable&clipboard=write-slow&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === commandQSafeExitRun
        ? `/?demo=result&terms=sample&quit=ipc&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === commandCommaSafeSettingsRun
        ? `/?demo=capture&backend=deepseek&process=slow&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === firstUseCaptureTextScaleRun
        ? `/?demo=setup&fixture=check&trapPort=${trapPort}&run=${run}`
        : run === completedResultTextScaleRun
          ? `/?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${run}`
          : run === guidedReplyTextScaleRun
            ? `/?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${run}`
          : run === settingsStylesheetCollisionRun
            ? `/?demo=result&terms=sample&activeCapture=fixture-screenshot&quit=fixture&fixture=check&trapPort=${trapPort}&run=${run}`
          : [lazyWorkspaceRecoveryRun, resultStylesheetRecoveryRun].includes(run)
            ? `/?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${run}`
          : run === stackedStatusTextScaleRun
            ? `/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=${trapPort}&run=${run}`
      : ['settings-transition-native', settingsTextScaleRun].includes(run)
      ? `/?demo=capture&backend=deepseek&connection=race&connectionCancel=fail&quit=fixture&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === settingsSaveRetryRun
        ? `/?demo=capture&backend=deepseek&save=credential-once&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === settingsPromptDraftRecoveryRun
        ? `/?demo=capture&backend=deepseek&save=prompt-twice&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === manualClipboardReplacementRun
        ? `/?demo=capture&backend=deepseek&fixture=check&trapPort=${trapPort}&run=${run}`
      : run === 'settings-failed-draft-discard-native'
        ? `/?demo=capture&backend=deepseek&save=credential-once&fixture=check&trapPort=${trapPort}&run=${run}`
        : run === 'failed-source-retry-native'
          ? `/?demo=result&backend=deepseek&process=replacement-source-once&fixture=check&trapPort=${trapPort}&run=${run}`
        : run === 'settings-draft-discard-native'
          ? `/?demo=capture&backend=deepseek&save=once&quit=fixture&fixture=check&trapPort=${trapPort}&run=${run}`
          : run === 'reply-copy-settlement-native'
            ? `/?demo=result&terms=sample&connection=unreachable&clipboard=write-slow&fixture=check&trapPort=${trapPort}&run=${run}`
            : run === 'runtime-degraded-native'
                ? `/?demo=capture&backend=deepseek&monitor=on&runtime=all&fixture=check&trapPort=${trapPort}&run=${run}`
                : run === 'startup-recovery-native'
                  ? `/?demo=setup&settings=corrupt-json&startupRecovery=archive-success&fixture=check&trapPort=${trapPort}&run=${run}`
                  : run === clipboardResidueRecoveryRun
                    ? `/?demo=capture&backend=deepseek&rendererRecovery=clipboard-residue&fixture=check&trapPort=${trapPort}&run=${run}`
                  : run === 'provider-retry-native'
                    ? `/?demo=capture&backend=deepseek&connection=unreachable-once&fixture=check&trapPort=${trapPort}&run=${run}`
                    : `/?demo=setup&fixture=check&trapPort=${trapPort}&run=${run}`;
    const child = spawn(process.execPath, [
      launcherPath,
      `--path=${fixturePath}`,
    ], {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, launcherTerminationGraceMs);
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(timedOut ? new Error('Native Electron UI fixture check timed out') : error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error(`Native Electron UI fixture check timed out (${signal || code})`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseProof(outcome, expectedOutputPrefix = outputPrefix) {
  const markerLine = outcome.stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(expectedOutputPrefix));
  const proof = markerLine ? JSON.parse(markerLine.slice(expectedOutputPrefix.length)) : null;
  assert.equal(
    outcome.code,
    0,
    `Native fixture exited unexpectedly (${outcome.signal || outcome.code})\n${proof?.error || outcome.stderr.slice(-4000)}`,
  );
  assert.ok(markerLine, `Native fixture did not emit its runtime proof\n${outcome.stdout.slice(-4000)}`);
  return proof;
}

function assertIsolationProof(proof) {
  assert.equal(proof.success, true, proof.error || 'native fixture runtime proof failed');
  assert.equal(proof.isPackaged, false);
  assert.equal(proof.rendererUrlExact, true);
  assert.equal(proof.userDataIsFixture, true);
  assert.equal(proof.sessionDataIsNested, true);
  assert.equal(proof.contextIsolation, true);
  assert.equal(proof.nodeIntegrationDisabled, true);
  assert.equal(proof.sandboxEnabled, true);
  assert.equal(proof.nativeWindow.backgroundThrottlingDisabled, true,
    'hidden fixture-check windows must keep animation-frame evidence unthrottled');
  assert.equal(proof.trayCreated, false);
  assert.equal(proof.shortcutsRegistered, false);
  assert.equal(proof.applicationMenuSafe, true);
  assert.equal(proof.inheritedSecretsPresent, false);
  assert.equal(proof.sessionTrapFetchBlocked, true);
  assert.equal(proof.blockedRendererExternalRequests, 0,
    'fixture renderer attempted a session-blocked external request');
  assert.deepEqual(proof.renderer.marker, { enabled: true, isolated: true });
  assert.equal(proof.renderer.dataset, 'native-isolated');
  assert.equal(proof.renderer.settingsIpcRejected, true);
  assert.equal(proof.renderer.clipboardStubbed, true);
  assert.equal(proof.renderer.sameOriginFetchAllowed, true);
  assert.equal(proof.renderer.nodeGlobalsUnavailable, true);
}

function assertVisibleFocusEvidence(evidence, label) {
  assert.ok(evidence, `${label} evidence is missing`);
  assert.equal(evidence.focused, true, `${label} did not retain DOM focus`);
  assert.equal(evidence.horizontallyContained, true,
    `${label} escaped its horizontal scrollport bounds`);
  assert.equal(evidence.verticallyReachable, true,
    `${label} was not visible after scrollIntoView`);
  assert.equal(evidence.fullyVisible, true, `${label} was only partially visible after reveal`);
  assert.equal(evidence.ringRendered, true, `${label} did not render a focus outline`);
  assert.ok(evidence.ringExtent > 0, `${label} reported a zero-width focus outline`);
  assert.equal(evidence.ringVisible, true, `${label} focus ring was clipped`);
  assert.equal(evidence.pageNoHorizontalOverflow, true,
    `${label} introduced page-level horizontal overflow`);
  assert.equal(evidence.scrollportNoHorizontalOverflow, true,
    `${label} introduced a horizontally scrolling region`);
}

function assertPointerFocusEvidence(evidence, label) {
  assert.ok(evidence, `${label} evidence is missing`);
  assert.equal(evidence.focused, true, `${label} did not retain natural pointer focus`);
  assert.equal(evidence.horizontallyContained, true,
    `${label} escaped its horizontal scrollport bounds`);
  assert.equal(evidence.verticallyReachable, true,
    `${label} was not reachable after the native pointer action`);
  assert.equal(evidence.fullyVisible, true,
    `${label} was only partially visible after the 200 percent reflow`);
  assert.equal(evidence.pageNoHorizontalOverflow, true,
    `${label} introduced page-level horizontal overflow`);
  assert.equal(evidence.scrollportNoHorizontalOverflow, true,
    `${label} introduced a horizontally scrolling region`);
}

function assertStackedStatusFocusEvidence(evidence, label) {
  assert.ok(evidence, `${label} evidence is missing`);
  assert.equal(evidence.focused, true, `${label} did not retain DOM focus`);
  assert.equal(evidence.focusVisible, true,
    `${label} was not focus-visible after native keyboard modality was established`);
  assert.equal(evidence.ringRendered, true,
    `${label} did not render a computed outline or box-shadow focus ring`);
  assert.ok(evidence.ringExtent > 0, `${label} reported a zero-width focus ring`);
  assert.equal(evidence.ringVisible, true, `${label} focus ring was clipped`);
  assert.equal(evidence.horizontallyContained, true,
    `${label} escaped the shared shell horizontally`);
  assert.equal(evidence.verticallyReachable, true,
    `${label} was not reachable through shared shell scrolling`);
  assert.equal(evidence.pageNoHorizontalOverflow, true,
    `${label} introduced page-level horizontal overflow`);
  assert.equal(evidence.scrollportNoHorizontalOverflow, true,
    `${label} introduced horizontal shell scrolling`);
}

function assertWorkspaceFocusEvidence(evidence, label) {
  assert.ok(evidence, `${label} evidence is missing`);
  assert.equal(evidence.focused, true, `${label} did not retain exact DOM focus`);
  assert.equal(evidence.focusVisible, true, `${label} was not browser focus-visible`);
  assert.equal(evidence.ringRendered, true,
    `${label} did not render a computed focus ring`);
  assert.ok(evidence.ringExtent > 0, `${label} reported a zero-width focus ring`);
  assert.equal(evidence.ringVisible, true, `${label} focus ring was clipped`);
  assert.equal(evidence.horizontallyContained, true,
    `${label} escaped its workspace horizontally`);
  assert.equal(evidence.verticallyReachable, true,
    `${label} was not reachable through workspace scrolling`);
  assert.equal(evidence.pageNoHorizontalOverflow, true,
    `${label} introduced page-level horizontal overflow`);
  assert.equal(evidence.scrollportNoHorizontalOverflow, true,
    `${label} introduced horizontal workspace scrolling`);
}

function assertStackedStatusPassiveEvidence(evidence, label) {
  assert.ok(evidence, `${label} evidence is missing`);
  assert.equal(evidence.horizontallyContained, true,
    `${label} escaped the shared shell horizontally`);
  assert.equal(evidence.verticallyReachable, true,
    `${label} was not reachable through shared shell scrolling`);
  assert.equal(evidence.fullyVisible, true,
    `${label} could not be fully revealed inside the native viewport`);
  assert.equal(evidence.pageNoHorizontalOverflow, true,
    `${label} introduced page-level horizontal overflow`);
  assert.equal(evidence.scrollportNoHorizontalOverflow, true,
    `${label} introduced horizontal shell scrolling`);
}

async function main() {
  const networkTrap = await startNetworkTrap();
  const ownedFixtureTempRoot = createFixtureRuntimeTempRoot();
  const fixtureTempRoot = ownedFixtureTempRoot.realPath;
  try {
    const beforeFixtureDirectories = fixtureDirectories(fixtureTempRoot);
    const runFixture = (run) => runLauncher(networkTrap.port, fixtureTempRoot, run);
    const proof = parseProof(await runFixture());
    assertIsolationProof(proof);
    assert.equal(proof.renderer.setupTitle, '先选择你希望获得哪种帮助');
    assert.equal(proof.renderer.settingsTransition, null);
    assert.equal(proof.renderer.trustedInputBridgeAvailable, false);
    assert.equal(proof.trustedInputState, null);

    const commandQSafeExitProof = parseProof(
      await runFixture(commandQSafeExitRun),
      commandQSafeExitOutputPrefix,
    );
    assert.equal(commandQSafeExitProof.success, true,
      commandQSafeExitProof.error || 'native Command+Q safe-exit fixture failed');
    assert.deepEqual(commandQSafeExitProof.isolation, {
      rendererUrlExact: true,
      contextIsolation: true,
      nodeIntegrationDisabled: true,
      sandboxEnabled: true,
      inheritedSecretsPresent: false,
      blockedRendererExternalRequests: 0,
      applicationQuitMenu: {
        exists: true,
        acceleratorIsCommandQ: true,
        handlerAttached: true,
      },
    });
    const commandQLifecycle = commandQSafeExitProof.lifecycle;
    assert.ok(commandQLifecycle, 'native Command+Q safe-exit fixture omitted lifecycle proof');
    assert.deepEqual({
      expectedSteps: commandQLifecycle.expectedSteps,
      acceptedSteps: commandQLifecycle.acceptedSteps,
      rejectedSteps: commandQLifecycle.rejectedSteps,
      complete: commandQLifecycle.complete,
      commandQInputs: commandQLifecycle.commandQInputs,
      escapeInputs: commandQLifecycle.escapeInputs,
      mouseInputs: commandQLifecycle.mouseInputs,
      requestCount: commandQLifecycle.requestCount,
      requestSentCount: commandQLifecycle.requestSentCount,
      menuInvocationCount: commandQLifecycle.menuInvocationCount,
      acceleratorActivationCount: commandQLifecycle.acceleratorActivationCount,
      cancelDecisionCount: commandQLifecycle.cancelDecisionCount,
      mismatchDecisionCount: commandQLifecycle.mismatchDecisionCount,
      confirmedDecisionCount: commandQLifecycle.confirmedDecisionCount,
      confirmedQuitCount: commandQLifecycle.confirmedQuitCount,
      beforeQuitCount: commandQLifecycle.beforeQuitCount,
      nativeTerminateActionCount: commandQLifecycle.nativeTerminateActionCount,
      cleanupStarted: commandQLifecycle.cleanupStarted,
      cleanupComplete: commandQLifecycle.cleanupComplete,
    }, {
      expectedSteps: 5,
      acceptedSteps: 5,
      rejectedSteps: 0,
      complete: true,
      commandQInputs: 2,
      escapeInputs: 1,
      mouseInputs: 2,
      requestCount: 2,
      requestSentCount: 2,
      menuInvocationCount: 0,
      acceleratorActivationCount: 0,
      cancelDecisionCount: 1,
      mismatchDecisionCount: 1,
      confirmedDecisionCount: 1,
      confirmedQuitCount: 1,
      beforeQuitCount: 1,
      nativeTerminateActionCount: 2,
      cleanupStarted: true,
      cleanupComplete: true,
    });
    assert.ok(commandQLifecycle.listenerReadyCount >= 3,
      'the renderer must announce readiness and exercise active/settled replay checks');
    assert.equal(commandQLifecycle.pendingReplayCount, 1,
      'only the controlled active pending request may be replayed');
    assert.ok(commandQLifecycle.riskUpdateCount >= 1);
    assert.deepEqual(commandQLifecycle.rendererProof, {
      bridgeAvailable: true,
      bridgeFrozen: true,
      otherFixtureApisIsolated: true,
      dialogOpenedAfterFirstCommand: true,
      activeReadyReplayed: true,
      replayKeptSingleDialog: true,
      escapeClosedDialog: true,
      settledReadyDidNotReplay: true,
      processSurvivedCancel: true,
      dialogOpenedAfterSecondCommand: true,
      firstConfirmAttempted: true,
      mismatchStayedOpen: true,
      secondConfirmAttempted: true,
    });

    const commandCommaSettingsProof = parseProof(
      await runFixture(commandCommaSafeSettingsRun),
      commandCommaSafeSettingsOutputPrefix,
    );
    assert.equal(commandCommaSettingsProof.success, true,
      commandCommaSettingsProof.error || 'native Command+, Settings fixture failed');
    assert.deepEqual(commandCommaSettingsProof.applicationSettingsMenu, {
      id: 'app-settings',
      label: '设置…',
      accelerator: 'Command+,',
      handlerAttached: true,
    });
    assert.deepEqual(commandCommaSettingsProof.isolation, {
      rendererUrlExact: true,
      userDataIsFixture: true,
      sessionDataIsNested: true,
      contextIsolation: true,
      nodeIntegrationDisabled: true,
      sandboxEnabled: true,
      inheritedSecretsPresent: false,
      blockedRendererExternalRequests: 0,
      windowCount: 1,
    });
    const commandCommaLifecycle = commandCommaSettingsProof.lifecycle;
    assert.equal(commandCommaLifecycle.menuInvocationCount, 9);
    assert.equal(commandCommaLifecycle.acceleratorActivationCount, 0);
    assert.equal(commandCommaLifecycle.requestCount, 9);
    assert.equal(commandCommaLifecycle.requestSentCount, 10);
    assert.equal(commandCommaLifecycle.listenerReadyCount, 1);
    assert.equal(commandCommaLifecycle.pendingReplayCount, 1);
    assert.equal(commandCommaLifecycle.acknowledgedCount, 9);
    assert.equal(commandCommaLifecycle.invalidAcknowledgementCount, 1);
    assert.equal(commandCommaLifecycle.requestPendingAfterRetry, false);
    assert.equal(commandCommaLifecycle.menuHandlerCoverage, true);
    assert.equal(commandCommaLifecycle.physicalAcceleratorCausality, false);
    const {
      listenerReadyAttempts,
      listenerReadyFailuresInjected,
      listenerReadyAcceptedCount,
      listenerReadyAcceptedDelayMs,
      ...stableCommandCommaRendererProof
    } = commandCommaSettingsProof.renderer;
    assert.ok(Number.isSafeInteger(listenerReadyAttempts) && listenerReadyAttempts >= 3,
      'READY proof must include both StrictMode setups and the scheduled retry');
    assert.ok(Number.isSafeInteger(listenerReadyFailuresInjected)
      && listenerReadyFailuresInjected >= 2,
    'both synchronous StrictMode READY attempts must fail');
    assert.equal(listenerReadyAcceptedCount, 1,
      'only the delayed READY retry may reach the main-process handler');
    assert.ok(Number.isSafeInteger(listenerReadyAcceptedDelayMs)
      && listenerReadyAcceptedDelayMs >= 225,
    'the accepted READY invocation must be delayed until the 250 ms retry');
    assert.deepEqual(stableCommandCommaRendererProof, {
      bridgeAvailable: true,
      bridgeFrozen: true,
      otherFixtureApisIsolated: true,
      initialPendingReplayOpenedSettings: true,
      initialAcknowledgementConsumedBeforeDrop: true,
      initialAcknowledgementRetryWasInvalid: true,
      unsavedDraftPrepared: true,
      focusedDraftPrepared: true,
      samePanelIdentity: true,
      sameInputIdentity: true,
      draftPreserved: true,
      focusPreserved: true,
      scrollPreserved: true,
      settingsClosedWithoutWrite: true,
      fixedFictionalSourceLoaded: true,
      processingStarted: true,
      processingFocusPrepared: true,
      guardOpened: true,
      guardIsModal: true,
      activeTaskPreserved: true,
      settingsStayedClosed: true,
      guardOwnedFocus: true,
      repeatedGuardKeptIdentity: true,
      guardDismissed: true,
      focusRestoredToInitiatingControl: true,
      activeTaskStillVisible: true,
      counters: {
        processRequests: 6,
        settingsWrites: 0,
        providerConnectionRequests: 0,
        credentialDeletes: 0,
        credentialWrites: 0,
        customPromptWrites: 0,
        clipboardWrites: 0,
        nativeClipboardWrites: 0,
        screenshotRequests: 0,
      },
      stopAndOpenGuardOwnedFocus: true,
      activeTaskStoppedBeforeSettings: true,
      processingRemovalObservedBeforeSettingsInsertion: true,
      settingsOpenedAfterConfirmedStop: true,
      returnedFromSettingsAfterStop: true,
      stopAndOpenFocusRestored: true,
      bodyAndHtmlRejectedAsFocusOrigin: true,
      noControlSettingsOpened: true,
      semanticSourceFocusRestored: true,
      secondProcessingStarted: true,
      secondProcessingFocusPrepared: true,
      completionWonBeforeChoice: true,
      completionGuardStayedOpen: true,
      completionGuardCopyUpdated: true,
      completionGuardActionsUpdated: true,
      completionChoiceOpenedSettings: true,
      completionResultRetained: true,
      completionReturnFocusRestored: true,
      listenerReadyRetryRecovered: true,
      acknowledgementRetryRecovered: true,
      acknowledgementConsumedBeforeResponseDrop: true,
      acknowledgementRetrySettledAsInvalid: true,
      lateCompletionProcessingStarted: true,
      lateCompletionProcessingFocusPrepared: true,
      resultObservedWhileCancelPending: true,
      lateCancelProcessSettledBeforeFailure: true,
      lateCancelSettingsStayedClosed: true,
      lateCancelResultRetained: true,
      lateCancelWarningHonest: true,
      lateCancelResultFocusRestored: true,
      lateCancelIntentClearedBeforeNextTask: true,
      failureSettlementFreshSourcePrepared: true,
      failureSettlementProcessingStarted: true,
      failureSettlementFocusPrepared: true,
      cancelFailureObservedWhileTaskActive: true,
      cancellationFailureCopyHonest: true,
      cancelFailurePrecededOrdinaryFailure: true,
      ordinaryFailureSettingsStayedClosed: true,
      ordinaryFailureErrorRetained: true,
      ordinaryFailureSourceRetained: true,
      ordinaryFailureFocusedError: true,
      failureIntentClearedBeforeNextCancel: true,
      nextOrdinaryCancelSettingsStayedClosed: true,
      nextOrdinaryCancelReturnedToSource: true,
      acknowledgementRequests: 10,
      acknowledgementResponseDroppedAfterConsumption: true,
      acknowledgementInvalidRetryDelivered: true,
      cancellationCounters: {
        requests: 5,
        successes: 3,
        failures: 2,
      },
    });
    assert.equal(networkTrap.requestCount, 0,
      'Command+, Settings fixture reached the blocked loopback trap');

    const manualClipboardReplacementProof = parseProof(await runFixture(
      manualClipboardReplacementRun,
    ));
    assertIsolationProof(manualClipboardReplacementProof);
    assert.equal(manualClipboardReplacementProof.renderer.trustedInputBridgeAvailable, false);
    assert.equal(manualClipboardReplacementProof.trustedInputState, null);
    assert.equal(manualClipboardReplacementProof.blockedRendererExternalRequests, 0,
      'manual clipboard replacement renderer attempted an external request');
    const manualClipboardReplacement = manualClipboardReplacementProof.renderer
      .manualClipboardReplacement;
    assert.ok(manualClipboardReplacement,
      'native fixture did not return manual clipboard replacement evidence');
    assert.deepEqual(manualClipboardReplacement.firstRead, {
      preservedExactDraft: true,
      decisionFocused: true,
      requestSettled: true,
      decisionExplicit: true,
      noAutomaticProcessing: true,
      replaceLabel: '放弃草稿并替换',
      keepLabel: '继续编辑原文',
    });
    assert.deepEqual(manualClipboardReplacement.keep, {
      preservedExactDraft: true,
      restoredExactFocus: true,
      readActionEnabled: true,
      noAutomaticProcessing: true,
    });
    assert.deepEqual(manualClipboardReplacement.secondRead, {
      preservedExactDraft: true,
      decisionFocused: true,
    });
    assert.deepEqual(manualClipboardReplacement.replace, {
      loadedClipboardPreview: true,
      focusedSource: true,
      noticeVisible: true,
      noticeTruthful: true,
      noAutomaticProcessing: true,
    });
    assert.deepEqual(manualClipboardReplacement.clearUndoPause, {
      decisionFocused: true,
      pausedCopyTruthful: true,
      undoDisabledDuringDecision: true,
      heldPastOriginalExpiry: true,
      pausedDecisionWaitMs: 10_500,
      keepFocusedEnabledUndo: true,
      restoredExactSource: true,
      focusedRestoredSource: true,
      noAutomaticProcessing: true,
    });
    assert.equal(manualClipboardReplacement.processRequests, 0);
    assert.equal(manualClipboardReplacement.clipboardWriteRequests, 0);
    assert.equal(manualClipboardReplacement.nativeClipboardWriteStubs, 0);
    assert.ok(manualClipboardReplacement.viewport.width >= 400
      && manualClipboardReplacement.viewport.width <= 520,
    `expected a compact manual clipboard width, got ${manualClipboardReplacement.viewport.width}`);
    assert.ok(manualClipboardReplacement.viewport.height >= 400,
      `expected a usable manual clipboard height, got ${manualClipboardReplacement.viewport.height}`);
    assert.equal(networkTrap.requestCount, 0,
      'manual clipboard replacement fixture reached the blocked loopback trap');

    const firstUseTextScaleProof = parseProof(await runFixture(
      firstUseCaptureTextScaleRun,
    ));
    assertIsolationProof(firstUseTextScaleProof);
    assert.equal(firstUseTextScaleProof.renderer.trustedInputBridgeAvailable, false);
    assert.equal(firstUseTextScaleProof.trustedInputState, null);
    assert.deepEqual(firstUseTextScaleProof.nativeWindow.contentSize, { width: 400, height: 400 });
    assert.deepEqual(firstUseTextScaleProof.nativeWindow.bounds, { width: 400, height: 400 });
    assert.equal(firstUseTextScaleProof.nativeWindow.zoomFactor, 2);
    const firstUseTextScale = firstUseTextScaleProof.renderer.firstUseCaptureTextScale;
    assert.ok(firstUseTextScale,
      'native fixture did not return first-use capture 200% reflow evidence');
    assert.deepEqual(firstUseTextScale.viewport, { width: 200, height: 200 });

    const firstUseSetup = firstUseTextScale.setup;
    assert.equal(firstUseSetup.title, '先选择你希望获得哪种帮助');
    assert.equal(firstUseSetup.choiceCount, 2);
    assert.equal(firstUseSetup.choicesStacked, true);
    assert.equal(firstUseSetup.regionsNoHorizontalOverflow, true);
    assert.equal(firstUseSetup.regionsHorizontallyContained, true);
    assert.equal(firstUseSetup.verticalScrollOnly, true);
    assert.equal(firstUseSetup.privacyDisclosureComplete, true);
    assert.equal(firstUseSetup.privacyReachable, true);
    assert.equal(firstUseSetup.allFocusEvidenceVisible, true);
    assert.deepEqual(Object.keys(firstUseSetup.focusEvidence).sort(), [
      'basicChoice',
      'fullChoice',
    ]);
    for (const [label, evidence] of Object.entries(firstUseSetup.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `first-use ${label}`);
    }

    const firstUseHeader = firstUseTextScale.header;
    assert.equal(firstUseHeader.brandVisible, true);
    assert.equal(firstUseHeader.itemsContained, true);
    assert.equal(firstUseHeader.itemsDoNotOverlap, true);
    assert.equal(firstUseHeader.noHorizontalOverflow, true);
    assert.equal(firstUseHeader.allFocusEvidenceVisible, true);
    assert.deepEqual(Object.keys(firstUseHeader.focusEvidence).sort(), [
      'hide',
      'savedTerms',
      'settings',
    ]);
    for (const [label, evidence] of Object.entries(firstUseHeader.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `capture header ${label}`);
      assert.equal(evidence.keyboardModalityPrimed, true,
        `capture header ${label} did not inherit the native keyboard modality`);
      assert.equal(evidence.headerGeometryStable, true,
        `capture header ${label} focus shifted the header geometry`);
      assert.equal(evidence.brandGeometryStable, true,
        `capture header ${label} focus shifted or hid the brand`);
      assert.equal(evidence.scrollStayedAtOrigin, true,
        `capture header ${label} focus scrolled the window, document, or header`);
    }

    const emptyCapture = firstUseTextScale.emptyCapture;
    assert.equal(emptyCapture.firstPrivacyNoticeVisible, true);
    assert.equal(emptyCapture.firstPrivacyNoticeComplete, true);
    assert.equal(emptyCapture.inputEmpty, true);
    assert.equal(emptyCapture.generateDisabled, true);
    assert.equal(emptyCapture.shortcutHelpComplete, true);
    assert.equal(emptyCapture.verticalScrollOnly, true);
    assert.equal(emptyCapture.regionsNoHorizontalOverflow, true);
    assert.equal(emptyCapture.allFocusEvidenceVisible, true);
    assert.equal(emptyCapture.passiveContentReachable, true);
    assert.deepEqual(Object.keys(emptyCapture.focusEvidence).sort(), [
      'clipboard',
      'privacyAcknowledge',
      'processingLocation',
      'sample',
      'screenshot',
      'sourceInput',
    ]);
    for (const [label, evidence] of Object.entries(emptyCapture.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `empty capture ${label}`);
    }
    for (const [label, evidence] of Object.entries(emptyCapture.passiveEvidence)) {
      assert.equal(evidence.horizontallyContained, true,
        `empty capture ${label} escaped its horizontal scrollport bounds`);
      assert.equal(evidence.verticallyReachable, true,
        `empty capture ${label} was not reachable by vertical scrolling`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `empty capture ${label} introduced page-level horizontal overflow`);
      assert.equal(evidence.scrollportNoHorizontalOverflow, true,
        `empty capture ${label} introduced a horizontally scrolling region`);
    }

    const loadedSample = firstUseTextScale.loadedSample;
    assert.equal(loadedSample.textCorrect, true);
    assert.equal(loadedSample.clearVisible, true);
    assert.equal(loadedSample.countCorrect, true);
    assert.equal(loadedSample.safetyCopyVisible, true);
    assert.equal(loadedSample.generateEnabled, true);
    assert.equal(loadedSample.generateLabelCorrect, true);
    assert.equal(loadedSample.noAutoProcess, true);
    assert.equal(loadedSample.submittedSource, 'sample');
    assert.equal(loadedSample.submittedCapture, null);
    assert.equal(loadedSample.noHorizontalOverflow, true);
    assert.equal(loadedSample.allFocusEvidenceVisible, true);
    assert.deepEqual(Object.keys(loadedSample.focusEvidence).sort(), [
      'clear',
      'process',
      'sourceInput',
    ]);
    for (const [label, evidence] of Object.entries(loadedSample.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `loaded sample ${label}`);
    }
    assert.equal(loadedSample.sampleNoticeEvidence.horizontallyContained, true);
    assert.equal(loadedSample.sampleNoticeEvidence.verticallyReachable, true);
    assert.equal(loadedSample.sampleNoticeEvidence.pageNoHorizontalOverflow, true);
    assert.equal(loadedSample.sampleNoticeEvidence.scrollportNoHorizontalOverflow, true);
    assert.equal(networkTrap.requestCount, 0,
      'first-use capture text-scale fixture reached the blocked loopback trap');

    const completedResultTextScaleProof = parseProof(await runFixture(
      completedResultTextScaleRun,
    ));
    assertIsolationProof(completedResultTextScaleProof);
    assert.equal(completedResultTextScaleProof.renderer.trustedInputBridgeAvailable, true);
    assert.equal(completedResultTextScaleProof.blockedRendererExternalRequests, 0,
      'completed-result renderer attempted a session-blocked external request');
    assert.deepEqual(completedResultTextScaleProof.trustedInputState, {
      expectedSteps: 24,
      acceptedSteps: 24,
      rejectedSteps: 1,
      nextStep: 25,
      complete: true,
      mouseActions: 21,
      mouseInputEvents: 63,
      keyActions: 3,
      keyInputEvents: 6,
    });
    assert.deepEqual(
      completedResultTextScaleProof.nativeWindow.contentSize,
      { width: 400, height: 400 },
    );
    assert.deepEqual(
      completedResultTextScaleProof.nativeWindow.bounds,
      { width: 400, height: 400 },
    );
    assert.equal(completedResultTextScaleProof.nativeWindow.zoomFactor, 2);
    const completedResultTextScale = completedResultTextScaleProof
      .renderer.completedResultTextScale;
    assert.ok(completedResultTextScale,
      'native fixture did not return completed-result 200% reflow evidence');
    assert.deepEqual(completedResultTextScale.viewport, { width: 200, height: 200 });
    assert.equal(completedResultTextScale.preview.sourceMatchesPreview, true);
    assert.equal(completedResultTextScale.preview.actionCount, 4);
    assert.match(completedResultTextScale.preview.headline, /收到邮件后一天内/u);
    assert.match(completedResultTextScale.preview.headline, /eVisa share code/u);
    const completedResultZeroAppCounters = {
      clipboardWriteRequests: 0,
      processRequests: 0,
      screenshotCaptureRequests: 0,
      credentialDeleteRequests: 0,
      credentialDeleteSuccesses: 0,
      deepseekCredentialWriteRequests: 0,
      deepseekCredentialWriteSuccesses: 0,
      providerConnectionRequests: 0,
      quitRequests: 0,
      quitDecisionRequests: 0,
      quitConfirmedDecisions: 0,
    };
    assert.deepEqual(completedResultTextScale.appCounters, {
      before: completedResultZeroAppCounters,
      after: completedResultZeroAppCounters,
    });
    const completedTrustedInteractions = completedResultTextScale.trustedInteractions;
    assert.deepEqual(completedTrustedInteractions.rejectedStep, {
      step: 1,
      kind: 'key',
      key: 'Escape',
      rejected: true,
      nextAcceptedStep: 1,
    });
    assert.equal(completedTrustedInteractions.mouse.length, 21);
    assert.deepEqual(
      completedTrustedInteractions.mouse.map((evidence) => evidence.label),
      [
        'source pane switch',
        'action pane switch',
        'action-to-source evidence control',
        'source-to-action evidence control',
        'action completion checkbox 1 check',
        'action completion checkbox 1 reverse',
        'action completion checkbox 1 recheck',
        'action completion checkbox 2 check',
        'action completion checkbox 2 reverse',
        'action completion checkbox 2 recheck',
        'action completion checkbox 3 check',
        'action completion checkbox 3 reverse',
        'action completion checkbox 3 recheck',
        'action completion checkbox 4 check',
        'action completion checkbox 4 reverse',
        'action completion checkbox 4 recheck',
        'Saved Terms trigger',
        'Saved Terms import preview',
        'Saved Terms import cancel',
        'deadline disclosure open',
        'deadline disclosure close',
      ],
    );
    const completedMouseSteps = [
      ...Array.from({ length: 19 }, (_, index) => index + 1),
      23,
      24,
    ];
    for (const [index, evidence] of completedTrustedInteractions.mouse.entries()) {
      assert.equal(evidence.step, completedMouseSteps[index],
        `${evidence.label} did not use its fixed native-input step`);
      assert.equal(evidence.isTrusted, true, `${evidence.label} was not a trusted click`);
      assert.equal(evidence.targetOwned, true, `${evidence.label} click missed its target`);
      assert.equal(evidence.type, 'click');
      assert.ok(Number.isSafeInteger(evidence.point.x));
      assert.ok(Number.isSafeInteger(evidence.point.y));
      assert.ok(Number.isSafeInteger(evidence.point.rectIndex));
      assert.ok(evidence.point.rectIndex >= 0);
      assert.match(evidence.point.hitTag, /^[a-z][a-z0-9-]*$/u);
      assert.equal(evidence.clientX, evidence.point.x,
        `${evidence.label} click clientX did not match the requested native point`);
      assert.equal(evidence.clientY, evidence.point.y,
        `${evidence.label} click clientY did not match the requested native point`);
    }
    assert.equal(completedTrustedInteractions.keyboard.length, 3);
    assert.deepEqual(
      completedTrustedInteractions.keyboard.map((evidence) => evidence.label),
      ['Saved Terms Tab 1', 'Saved Terms Tab 2', 'Saved Terms drawer'],
    );
    assert.deepEqual(
      completedTrustedInteractions.keyboard.map((evidence) => evidence.step),
      [20, 21, 22],
    );
    assert.deepEqual(
      completedTrustedInteractions.keyboard.map((evidence) => evidence.key),
      ['Tab', 'Tab', 'Escape'],
    );
    for (const evidence of completedTrustedInteractions.keyboard) {
      assert.equal(evidence.isTrusted, true,
        `${evidence.label} was not a trusted keyboard event`);
      assert.equal(evidence.eventTargetOwned, true,
        `${evidence.label} keyboard event escaped the Saved Terms dialog`);
      assert.equal(evidence.activeTargetOwned, true,
        `${evidence.label} left focus outside the Saved Terms dialog`);
      assert.ok(Number.isSafeInteger(evidence.point.x));
      assert.ok(Number.isSafeInteger(evidence.point.y));
      assert.ok(Number.isSafeInteger(evidence.point.rectIndex));
      assert.ok(evidence.point.rectIndex >= 0);
      assert.match(evidence.point.hitTag, /^[a-z][a-z0-9-]*$/u);
    }
    for (const evidence of completedTrustedInteractions.keyboard.slice(0, 2)) {
      assert.equal(evidence.focusMoved, true,
        `${evidence.label} did not move focus`);
      assert.equal(evidence.focusRemainedOwned, true,
        `${evidence.label} did not keep focus inside the Saved Terms dialog`);
      assert.equal(evidence.focusVisible, true,
        `${evidence.label} did not produce browser focus-visible state`);
    }
    const completedEscape = completedTrustedInteractions.keyboard[2];
    assert.equal(completedEscape.focusMoved, null);
    assert.equal(completedEscape.focusRemainedOwned, null);
    assert.equal(completedEscape.focusVisible, null);
    assert.deepEqual(completedTrustedInteractions.escape, completedEscape);

    const completedGeometry = completedResultTextScale.geometry;
    assert.equal(completedGeometry.pageNoHorizontalOverflow, true);
    assert.equal(completedGeometry.shellNoHorizontalOverflow, true);
    assert.equal(completedGeometry.resultNoHorizontalOverflow, true);
    assert.equal(completedGeometry.workspaceNoHorizontalOverflow, true);
    assert.equal(completedGeometry.naturalWorkspaceNonzero, true);
    assert.ok(completedGeometry.workspaceRect.width > 0);
    assert.ok(completedGeometry.workspaceRect.height > 0);
    assert.ok(completedGeometry.workspaceClientHeight > 0);
    assert.ok(completedGeometry.workspaceScrollHeight > 0);
    assert.equal(completedGeometry.sourcePaneNoHorizontalOverflow, true);
    assert.equal(completedGeometry.actionPaneNoHorizontalOverflow, true);

    const completedSummary = completedResultTextScale.summary;
    assert.match(completedSummary.headlineText, /eVisa share code/u);
    assert.match(completedSummary.deadlineText, /收到邮件后一天内/u);
    assert.doesNotMatch(completedSummary.deadlineText, /已逾期/u,
      'the time-stable sample must never open in an overdue state');
    assert.equal(completedSummary.replyText, '需要回复');
    for (const [label, evidence] of Object.entries(completedSummary.evidence)) {
      assert.equal(evidence.horizontallyContained, true,
        `completed summary ${label} escaped its horizontal bounds`);
      assert.equal(evidence.verticallyReachable, true,
        `completed summary ${label} was not vertically reachable`);
      assert.equal(evidence.fullyVisible, true,
        `completed summary ${label} was not fully visible after reveal`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `completed summary ${label} introduced page overflow`);
      assert.equal(evidence.scrollportNoHorizontalOverflow, true,
        `completed summary ${label} introduced result overflow`);
    }
    assertVisibleFocusEvidence(completedSummary.evidence.deadline, 'completed result deadline');

    const completedDeadlineDisclosure = completedResultTextScale.disclosures?.deadline;
    assert.ok(completedDeadlineDisclosure,
      'completed result omitted the native deadline disclosure proof');
    assert.deepEqual(completedDeadlineDisclosure.ids, {
      trigger: 'result-deadlines',
      panel: 'result-deadlines-panel',
      heading: 'result-deadlines-heading',
      title: 'result-deadlines-title',
      meta: 'result-deadlines-meta',
      ariaControls: 'result-deadlines-panel',
      ariaLabelledBy: 'result-deadlines-title',
      ariaDescribedBy: 'result-deadlines-meta',
      headingOwnsTrigger: true,
    });
    assert.deepEqual(completedDeadlineDisclosure.initial, {
      ariaExpanded: 'false',
      panelHidden: true,
      panelConnected: true,
      triggerWasNotFocused: true,
    });
    assert.equal(completedDeadlineDisclosure.open.ariaExpanded, 'true');
    assert.equal(completedDeadlineDisclosure.open.panelHidden, false);
    assert.equal(completedDeadlineDisclosure.open.panelConnected, true);
    assert.equal(completedDeadlineDisclosure.open.sameTrigger, true);
    assert.equal(completedDeadlineDisclosure.open.samePanel, true);
    assert.equal(completedDeadlineDisclosure.open.focusRetained, true);
    assert.equal(completedDeadlineDisclosure.open.cardCount, 2);
    assert.equal(completedDeadlineDisclosure.open.cardTexts.length, 2);
    assert.ok(completedDeadlineDisclosure.open.cardTexts.some((text) => (
      text.includes('收到邮件后一天内')
    )));
    assert.ok(completedDeadlineDisclosure.open.cardTexts.some((text) => (
      text.includes('收到邮件后两天内')
    )));
    assert.equal(completedDeadlineDisclosure.open.noHorizontalOverflow, true);
    assertPointerFocusEvidence(
      completedDeadlineDisclosure.open.focusEvidence,
      'open deadline disclosure trigger',
    );
    assert.equal(completedDeadlineDisclosure.closed.ariaExpanded, 'false');
    assert.equal(completedDeadlineDisclosure.closed.panelHidden, true);
    assert.equal(completedDeadlineDisclosure.closed.panelConnected, true);
    assert.equal(completedDeadlineDisclosure.closed.sameTrigger, true);
    assert.equal(completedDeadlineDisclosure.closed.samePanel, true);
    assert.equal(completedDeadlineDisclosure.closed.focusRetained, true);
    assert.equal(completedDeadlineDisclosure.closed.cardCount, 2);
    assert.equal(completedDeadlineDisclosure.closed.noHorizontalOverflow, true);
    assertPointerFocusEvidence(
      completedDeadlineDisclosure.closed.focusEvidence,
      'closed deadline disclosure trigger',
    );

    const completedPanes = completedResultTextScale.panes;
    assert.equal(completedPanes.buttonCount, 2);
    assert.equal(completedPanes.sourcePaneActive, true);
    assert.equal(completedPanes.actionPaneHiddenForSource, true);
    assert.equal(completedPanes.actionPaneActive, true);
    assert.equal(completedPanes.sourcePaneHiddenForAction, true);
    assert.equal(completedPanes.linkedEvidenceRoundTrip, true);
    assert.equal(completedPanes.outerResultVerticalScrollChanged, true);
    assert.equal(completedPanes.outerResultScrollLeftStayedZero, true);
    assert.deepEqual(Object.keys(completedPanes.focusEvidence).sort(), [
      'actionSwitch',
      'sourceSwitch',
    ]);
    for (const [label, evidence] of Object.entries(completedPanes.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `completed result pane ${label}`);
    }

    const completedHeader = completedResultTextScale.header;
    assert.equal(completedHeader.controlCount, 5);
    assert.equal(completedHeader.controlsPositive, true);
    assert.equal(completedHeader.controlsDoNotOverlap, true);
    assert.equal(completedHeader.visualDomOrder, true);
    assert.equal(completedHeader.noHorizontalOverflow, true);
    assert.equal(completedHeader.keyboardModalityPrimed, true);
    assert.equal(completedHeader.allFocusEvidenceVisible, true);
    assert.deepEqual(Object.keys(completedHeader.focusEvidence).sort(), [
      'actionPreference',
      'hide',
      'savedTerms',
      'settings',
      'translationPreference',
    ]);
    for (const [label, evidence] of Object.entries(completedHeader.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `completed result header ${label}`);
    }
    for (const rect of completedHeader.rects) {
      assert.ok(rect.width > 0 && rect.height > 0,
        'completed result header reported a zero-size control');
    }

    const completedActions = completedResultTextScale.actions;
    assert.equal(completedActions.checkboxCount, 4);
    assert.equal(completedActions.allEnabled, true);
    assert.equal(completedActions.allChecked, true);
    assert.equal(completedActions.allReversible, true);
    assert.equal(completedActions.partialStatusRetained, true);
    assert.equal(completedActions.pendingVerificationRetained, true);
    assert.equal(completedActions.selfReportedAllComplete, true);
    assert.equal(completedActions.selfReportedCopyHonest, true);
    assert.equal(completedActions.completedReturnLabel, '完成并返回');
    assert.equal(completedActions.completedReturnUndoConsequence, true);
    assert.equal(completedActions.processingCompletionStillDistinct, true);
    assert.match(completedActions.processingCompletionLabel, /^处理完成/u);
    assert.deepEqual(Object.keys(completedActions.focusEvidence).sort(), [
      'actionCheckbox',
      'completedReturn',
      'processingCompletion',
      'reanalyze',
    ]);
    for (const [label, evidence] of Object.entries(completedActions.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `completed result ${label}`);
    }

    const completedFooter = completedResultTextScale.footer;
    assert.equal(completedFooter.buttonCount, 8);
    assert.equal(completedFooter.allEnabled, true);
    assert.equal(completedFooter.allPositive, true);
    assert.equal(completedFooter.reanalyzeVisible, true);
    assert.equal(completedFooter.allFocusEvidenceVisible, true);
    assert.deepEqual(Object.keys(completedFooter.focusEvidence).sort(), [
      'copyActions',
      'copyResult',
      'editSource',
      'prepareReply',
      'processingCompletion',
      'reanalyze',
      'recapture',
      'returnBeforeCompletion',
    ]);
    for (const [label, evidence] of Object.entries(completedFooter.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `completed result footer ${label}`);
    }
    for (const label of [
      '准备英文回复',
      '复制行动清单',
      '复制结果',
      '修正原文',
      '重新截图',
      '重新分析',
      '处理完成',
      '完成并返回',
    ]) {
      assert.ok(completedFooter.labels.some((value) => value.includes(label)),
        `completed result footer omitted ${label}`);
    }

    const completedTerms = completedResultTextScale.savedTerms;
    assert.equal(completedTerms.role, 'dialog');
    assert.equal(completedTerms.ariaModal, 'true');
    assert.equal(completedTerms.backgroundIsolated, true);
    assert.equal(completedTerms.triggerOwnedByInertBackground, true);
    assert.equal(completedTerms.searchAutoFocused, true);
    assertVisibleFocusEvidence(completedTerms.searchFocusEvidence, 'Saved Terms search');
    assert.equal(completedTerms.searchFocusEvidence.ringOpaque, true);
    assert.equal(completedTerms.primaryGeometryPositive, true);
    assert.equal(completedTerms.primaryGeometryContained, true);
    assert.deepEqual(completedTerms.scrollOwnership, {
      outerOverflowY: 'auto',
      bodyOverflowY: 'visible',
      listOverflowY: 'visible',
      outerHasVerticalRange: true,
      bodyHasVerticalRange: false,
      listHasVerticalRange: false,
      singleVerticalOwner: true,
    });
    assert.equal(completedTerms.sampleCopyReachable, true);
    assert.equal(completedTerms.sampleRemoveReachable, true);
    assert.equal(completedTerms.exportReachable, true);
    assert.equal(completedTerms.importReachable, true);
    assert.equal(completedTerms.outerVerticalScrollChanged, true);
    assert.equal(completedTerms.outerScrollLeftStayedZero, true);
    assert.equal(completedTerms.noHorizontalOverflow, true);
    assert.equal(completedTerms.footerReachable, true);
    assert.match(completedTerms.importTrustPreview.title, /确认导入/u);
    assert.deepEqual(completedTerms.importTrustPreview.summaryValues, ['1', '0', '1', '2']);
    assert.equal(completedTerms.importTrustPreview.downgradedProvenanceCount, 1);
    assert.equal(completedTerms.importTrustPreview.autoFocused, true);
    assert.equal(completedTerms.importTrustPreview.confirmInitiallyFocused, false);
    assert.equal(completedTerms.importTrustPreview.labelled, true);
    assert.ok(
      completedTerms.importTrustPreview.confirmDescriptionIds.includes(
        'term-import-trust-summary',
      ),
    );
    assert.ok(
      completedTerms.importTrustPreview.confirmDescriptionIds.includes(
        'term-import-downgrade-warning',
      ),
    );
    assert.equal(completedTerms.importTrustPreview.confirmDescribedByTrust, true);
    assert.equal(completedTerms.importTrustPreview.warningPrecedesConfirm, true);
    const importTrustFocus = completedTerms.importTrustPreview.focusEvidence;
    assert.equal(importTrustFocus.focused, true);
    assert.equal(importTrustFocus.focusVisible, true);
    assert.equal(importTrustFocus.ringRendered, true);
    assert.ok(importTrustFocus.ringExtent > 0);
    assert.equal(importTrustFocus.horizontallyContained, true);
    assert.equal(importTrustFocus.verticallyReachable, true);
    assert.equal(importTrustFocus.topRingReachable, true);
    assert.equal(importTrustFocus.bottomRingReachable, true);
    assert.equal(importTrustFocus.horizontalRingVisible, true);
    assert.equal(importTrustFocus.ringPerimeterReachable, true);
    assert.equal(importTrustFocus.scrollLeftStayedZero, true);
    assert.equal(importTrustFocus.pageNoHorizontalOverflow, true);
    assert.equal(importTrustFocus.scrollportNoHorizontalOverflow, true);
    assert.deepEqual(completedTerms.importCancellation, {
      message: '已取消导入；术语库没有变化。',
      liveOwnerCount: 1,
      termCountBefore: 1,
      termCountAfter: 1,
      termsUnchanged: true,
      previewRemoved: true,
      focusReturnedToImport: true,
    });
    assert.equal(completedTerms.escapeClosed, true);
    assert.equal(completedTerms.focusReturnedToTrigger, true);
    assert.equal(completedTerms.backgroundStateRestored, true);
    assert.deepEqual(Object.keys(completedTerms.focusEvidence).sort(), [
      'exportAction',
      'importAction',
      'sampleCopy',
      'sampleRemove',
    ]);
    for (const [label, evidence] of Object.entries(completedTerms.focusEvidence)) {
      assertVisibleFocusEvidence(evidence, `Saved Terms ${label}`);
    }
    assert.equal(networkTrap.requestCount, 0,
      'completed-result text-scale fixture reached the blocked loopback trap');

    const guidedReplyTextScaleProof = parseProof(await runFixture(
      guidedReplyTextScaleRun,
    ));
    assertIsolationProof(guidedReplyTextScaleProof);
    assert.equal(guidedReplyTextScaleProof.renderer.trustedInputBridgeAvailable, true);
    assert.deepEqual(guidedReplyTextScaleProof.nativeWindow.contentSize, {
      width: 400,
      height: 400,
    });
    assert.deepEqual(guidedReplyTextScaleProof.nativeWindow.bounds, {
      width: 400,
      height: 400,
    });
    assert.equal(guidedReplyTextScaleProof.nativeWindow.zoomFactor, 2);
    assert.deepEqual(guidedReplyTextScaleProof.trustedInputState, {
      expectedSteps: 18,
      acceptedSteps: 18,
      rejectedSteps: 1,
      nextStep: 19,
      complete: true,
      mouseActions: 6,
      mouseInputEvents: 18,
      keyActions: 10,
      keyInputEvents: 20,
      fixedTextActions: 2,
      fixedTextCharacters: 36,
    });
    const guidedReplyTextScale = guidedReplyTextScaleProof.renderer.guidedReplyTextScale;
    assert.ok(guidedReplyTextScale,
      'native fixture did not return guided-reply 200% reflow evidence');
    assert.deepEqual(guidedReplyTextScale.viewport, { width: 200, height: 200 });

    assert.equal(guidedReplyTextScale.initialFocus.radioVisible, true);
    assert.equal(guidedReplyTextScale.initialFocus.ringVisible, true);
    assert.ok(Number.isSafeInteger(guidedReplyTextScale.initialFocus.centerHit.x));
    assert.ok(Number.isSafeInteger(guidedReplyTextScale.initialFocus.centerHit.y));
    assertVisibleFocusEvidence(
      guidedReplyTextScale.initialFocus.evidence,
      'guided-reply initial completed radio',
    );

    const guidedModal = guidedReplyTextScale.modal;
    assert.equal(guidedModal.backgroundIsolated, true);
    assert.equal(guidedModal.firstCloseBackgroundRestored, true);
    assert.equal(guidedModal.escapeBackgroundRestored, true);
    assert.equal(guidedModal.firstCloseReturnedToExactTrigger, true);
    assert.equal(guidedModal.escapeReturnedToExactTrigger, true);
    assert.equal(guidedModal.reopenedStateRetained, true);
    assert.equal(guidedModal.selectorMatchCount, 10,
      'guided-reply selector diagnostics should still include both grouped radios');
    assert.equal(guidedModal.nativeTabStopCount, 9,
      'guided-reply native loop should count the selected radio as the sole group Tab stop');
    assert.equal(guidedModal.tabStayedContained, true);
    assert.equal(guidedModal.tabLoopReturnedToInitial, true);
    assert.equal(guidedModal.tabFocusEvidence.length, guidedModal.nativeTabStopCount);
    for (const [index, evidence] of guidedModal.tabFocusEvidence.entries()) {
      assertVisibleFocusEvidence(evidence, `guided-reply Tab ${index + 1}`);
      assert.equal(evidence.focusVisible, true,
        `guided-reply Tab ${index + 1} was not focus-visible`);
    }

    assert.deepEqual(guidedReplyTextScale.blockers, {
      mismatchVisible: true,
      copyDisabledBeforeOverride: true,
      overrideConfirmed: true,
      placeholderStillBlockedAfterOverride: true,
      trustedReplacementApplied: true,
      copyEnabledAfterReplacement: true,
      copiedNoticeVisible: true,
      copiedNoticeClearedAfterEdit: true,
      postCopyEditApplied: true,
      outdatedNoticeVisible: true,
      blockSummaryBeforeOverride: '复制前还需：确认进度差异，填写 1 处内容',
      blockSummaryAfterOverride: '复制前还需：填写 1 处内容',
    });

    const guidedBlockedFooter = guidedReplyTextScale.layout.blockedFooter;
    assert.equal(guidedBlockedFooter.pageNoHorizontalOverflow, true);
    assert.equal(guidedBlockedFooter.drawerNoHorizontalOverflow, true);
    assert.equal(guidedBlockedFooter.footerNoHorizontalOverflow, true);
    assert.equal(guidedBlockedFooter.drawerScrollLeftStayedZero, true);
    assert.equal(guidedBlockedFooter.footerPosition, 'static');
    assert.equal(guidedBlockedFooter.footerDoesNotOverlapPrevious, true);
    assert.ok(
      guidedBlockedFooter.footerRect.top >= guidedBlockedFooter.previousRect.bottom - 1,
      'guided-reply blocked-state footer overlapped its preceding warning',
    );
    const guidedBlockedFooterReachability = guidedReplyTextScale.layout
      .blockedFooterReachability;
    assert.equal(guidedBlockedFooterReachability.scrolling.scrollTopAtOrigin, 0);
    assert.ok(guidedBlockedFooterReachability.scrolling.maximumScrollTop > 0);
    assert.ok(
      Math.abs(
        guidedBlockedFooterReachability.scrolling.scrollTopAtMaximum
          - guidedBlockedFooterReachability.scrolling.maximumScrollTop,
      ) <= 1,
      'guided-reply blocked drawer did not reach its native maximum scroll position',
    );
    assert.equal(guidedBlockedFooterReachability.scrolling.reachedMaximum, true);
    assert.equal(guidedBlockedFooterReachability.scrolling.scrollLeftStayedZero, true);
    for (const [label, evidence] of Object.entries({
      summary: guidedBlockedFooterReachability.summary,
      close: guidedBlockedFooterReachability.close,
      copy: guidedBlockedFooterReachability.copy,
    })) {
      assert.equal(evidence.horizontallyContained, true,
        `guided-reply blocked ${label} escaped the drawer horizontally`);
      assert.equal(evidence.verticallyReachable, true,
        `guided-reply blocked ${label} was not vertically reachable`);
    }
    assert.equal(guidedBlockedFooterReachability.copy.disabled, true);
    assert.equal(guidedBlockedFooterReachability.closeCopyOverlapArea, 0);
    for (const [label, evidence] of Object.entries({
      close: guidedBlockedFooterReachability.close,
      copy: guidedBlockedFooterReachability.copy,
    })) {
      assert.ok(Number.isSafeInteger(evidence.centerHit.x),
        `guided-reply blocked ${label} center x was not an integer`);
      assert.ok(Number.isSafeInteger(evidence.centerHit.y),
        `guided-reply blocked ${label} center y was not an integer`);
    }

    const guidedFooter = guidedReplyTextScale.layout.footer;
    assert.equal(guidedFooter.pageNoHorizontalOverflow, true);
    assert.equal(guidedFooter.drawerNoHorizontalOverflow, true);
    assert.equal(guidedFooter.footerNoHorizontalOverflow, true);
    assert.equal(guidedFooter.drawerScrollLeftStayedZero, true);
    assert.equal(guidedFooter.footerPosition, 'static');
    assert.equal(guidedFooter.footerDoesNotOverlapPrevious, true);
    assert.ok(guidedFooter.footerRect.top >= guidedFooter.previousRect.bottom - 1);
    for (const target of [
      ...guidedReplyTextScale.layout.mismatchTargets,
      ...guidedReplyTextScale.layout.settledTargets,
    ]) {
      assert.ok(target.width >= 32, `${target.label} is narrower than 32px`);
      assert.ok(target.height >= 32, `${target.label} is shorter than 32px`);
      assert.equal(target.meetsMinimum, true);
    }

    const guidedZeroAppCounters = {
      clipboardWriteRequests: 0,
      nativeClipboardWriteStubs: 0,
      processRequests: 0,
      screenshotCaptureRequests: 0,
      providerConnectionRequests: 0,
      credentialDeleteRequests: 0,
      deepseekCredentialWriteRequests: 0,
      quitRequests: 0,
    };
    assert.deepEqual(guidedReplyTextScale.appCounters.before, guidedZeroAppCounters);
    assert.deepEqual(guidedReplyTextScale.appCounters.after, {
      ...guidedZeroAppCounters,
      clipboardWriteRequests: 1,
      nativeClipboardWriteStubs: 1,
    });
    assert.equal(guidedReplyTextScale.appCounters.onlyExpectedClipboardWrite, true);

    const guidedTrusted = guidedReplyTextScale.trustedInteractions;
    assert.deepEqual(guidedTrusted.rejectedStep, {
      step: 1,
      kind: 'fixed-text',
      action: 'replace-placeholder',
      rejected: true,
      nextAcceptedStep: 1,
    });
    assert.equal(guidedTrusted.mouse.length, 6);
    assert.deepEqual(guidedTrusted.mouse.map(({ step }) => step), [1, 2, 3, 5, 7, 8]);
    assert.ok(guidedTrusted.mouse.every((evidence) => (
      evidence.isTrusted
        && evidence.targetOwned
        && evidence.clientX === evidence.point.x
        && evidence.clientY === evidence.point.y
    )));
    assert.equal(guidedTrusted.fixedText.length, 2);
    assert.deepEqual(guidedTrusted.fixedText.map(({ step, action }) => ({ step, action })), [
      { step: 4, action: 'replace-placeholder' },
      { step: 6, action: 'edit-after-copy' },
    ]);
    assert.ok(guidedTrusted.fixedText.every((evidence) => (
      evidence.isTrusted && evidence.targetOwned
    )));
    assert.deepEqual(
      guidedTrusted.fixedText.map(({ insertedCharacterCount }) => insertedCharacterCount),
      [12, 24],
    );
    assert.equal(guidedTrusted.keyboard.length, 10);
    assert.deepEqual(
      guidedTrusted.keyboard.map(({ step }) => step),
      [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    );
    assert.ok(guidedTrusted.keyboard.slice(0, guidedModal.nativeTabStopCount).every((evidence) => (
      evidence.isTrusted
        && evidence.key === 'Tab'
        && evidence.focusMoved
        && evidence.focusRemainedOwned
        && evidence.focusVisible
    )));
    assert.equal(guidedTrusted.escape.isTrusted, true);
    assert.equal(guidedTrusted.escape.key, 'Escape');
    assert.equal(guidedTrusted.escape.step, 18);
    assert.equal(guidedReplyTextScaleProof.blockedRendererExternalRequests, 0,
      'guided-reply renderer attempted a session-blocked external request');
    assert.equal(networkTrap.requestCount, 0,
      'guided-reply text-scale fixture reached the blocked loopback trap');

    const stackedStatusTextScaleProof = parseProof(await runFixture(
      stackedStatusTextScaleRun,
    ));
    assertIsolationProof(stackedStatusTextScaleProof);
    assert.equal(stackedStatusTextScaleProof.renderer.trustedInputBridgeAvailable, false);
    assert.equal(stackedStatusTextScaleProof.trustedInputState, null);
    assert.deepEqual(
      stackedStatusTextScaleProof.nativeWindow.contentSize,
      { width: 400, height: 400 },
    );
    assert.deepEqual(
      stackedStatusTextScaleProof.nativeWindow.bounds,
      { width: 400, height: 400 },
    );
    assert.equal(stackedStatusTextScaleProof.nativeWindow.zoomFactor, 2);
    const stackedStatusTextScale = stackedStatusTextScaleProof.renderer.stackedStatusTextScale;
    assert.ok(stackedStatusTextScale,
      'native fixture did not return stacked-status 200% reflow evidence');
    assert.deepEqual(stackedStatusTextScale.viewport, { width: 200, height: 200 },
      '400x400 native content at 200% must expose an exact 200x200 CSS viewport');
    assert.deepEqual(stackedStatusTextScale.counts, {
      pendingCaptureCount: 2,
      operationalStatusCount: 2,
      statusCardCount: 4,
      actionCount: 6,
      enabledActionCount: 4,
      disabledActionCount: 2,
    });
    assert.deepEqual(stackedStatusTextScale.order.expected, [
      'screenshot',
      'clipboard',
      'shortcut',
      'monitoring',
    ]);
    assert.deepEqual(stackedStatusTextScale.order.dom, stackedStatusTextScale.order.expected);
    assert.deepEqual(
      stackedStatusTextScale.order.keyboardGroups,
      stackedStatusTextScale.order.expected,
    );
    assert.deepEqual(
      stackedStatusTextScale.order.expectedEnabledKeyboardGroups,
      ['screenshot', 'shortcut', 'monitoring'],
    );
    assert.deepEqual(
      stackedStatusTextScale.order.enabledKeyboardGroups,
      stackedStatusTextScale.order.expectedEnabledKeyboardGroups,
    );
    assert.equal(stackedStatusTextScale.order.statusDomPriorityCorrect, true);
    assert.equal(stackedStatusTextScale.order.wholeFlowDomPriorityCorrect, true);
    assert.equal(stackedStatusTextScale.order.keyboardPriorityCorrect, true);

    const stackedRecovery = stackedStatusTextScale.recovery;
    assert.ok(stackedRecovery, 'stacked-status fixture did not return recovery evidence');
    assert.equal(stackedRecovery.warningRole, 'alert');
    assert.equal(stackedRecovery.titleTabIndex, -1);
    assert.equal(stackedRecovery.recoveryFocusInitiallyOwned, true);
    assert.equal(stackedRecovery.recoveryFocusEvidenceComplete, true);
    assert.equal(stackedRecovery.residueBeforeHeader, true);
    assert.equal(stackedRecovery.residueDoesNotOverlapHeader, true);
    assert.equal(stackedRecovery.residueAcknowledged, true);
    assert.equal(stackedRecovery.preAckAllStatusesMounted, true);
    assert.equal(stackedRecovery.preAckCountsMatch, true);
    assert.equal(stackedRecovery.warningRemovedAfterAcknowledgement, true);
    assert.equal(stackedRecovery.opaqueIdNotRendered, true);
    assert.ok(stackedRecovery.geometry.warning.width > 0);
    assert.ok(stackedRecovery.geometry.warning.height > 0);
    assert.ok(stackedRecovery.geometry.header.width > 0);
    assert.ok(stackedRecovery.geometry.header.height > 0);
    assert.ok(
      stackedRecovery.geometry.warning.bottom <= stackedRecovery.geometry.header.top + 1,
      'clipboard residue recovery warning overlapped the header',
    );
    assertStackedStatusFocusEvidence(
      stackedRecovery.titleFocusEvidence,
      'stacked-status clipboard residue title',
    );
    assertStackedStatusFocusEvidence(
      stackedRecovery.actionFocusEvidence,
      'stacked-status clipboard residue acknowledgement',
    );
    assertStackedStatusFocusEvidence(
      stackedRecovery.screenshotTitleFocusEvidence,
      'stacked-status screenshot handoff after recovery',
    );

    const stackedScrolling = stackedStatusTextScale.scrolling;
    assert.ok(['auto', 'scroll'].includes(stackedScrolling.shellOverflowY));
    assert.ok(!['auto', 'scroll'].includes(stackedScrolling.statusCenterOverflowY));
    assert.equal(stackedScrolling.shellIsOnlyVerticalScrollOwner, true,
      'the full shell must be the sole active vertical scroll owner');
    assert.equal(stackedScrolling.statusCenterIsNotScrollable, true,
      'the status center must not create a nested vertical scrollport');
    assert.equal(stackedScrolling.scrollOwnerClasses.length, 1);
    assert.match(stackedScrolling.scrollOwnerClasses[0], /slipstream-shell/u);
    assert.ok(stackedScrolling.clientHeight > 0 && stackedScrolling.clientHeight <= 200);
    assert.ok(stackedScrolling.scrollHeight > stackedScrolling.clientHeight);
    assert.ok(stackedScrolling.maximumScrollTop > 0);
    assert.ok(Math.abs(stackedScrolling.scrollTopAtOrigin) <= 1);
    assert.ok(stackedScrolling.scrollTopAtMaximum > 0);
    assert.equal(stackedScrolling.reachedMaximum, true);
    assert.equal(stackedScrolling.scrollLeftStayedZero, true);

    const stackedLayout = stackedStatusTextScale.layout;
    assert.equal(stackedLayout.flowDoesNotOverlap, true);
    assert.equal(stackedLayout.actionPairsDoNotOverlap, true);
    assert.equal(stackedLayout.actionsDoNotOverlapCardCopy, true);
    assert.equal(stackedLayout.regionsHaveNoHorizontalOverflow, true);
    assert.equal(stackedLayout.regionsHorizontallyContained, true);
    assert.equal(stackedLayout.pageNoHorizontalOverflow, true);
    assert.equal(stackedLayout.allPassiveContentReachable, true);
    assert.equal(stackedLayout.coreMounted, true,
      'the active processing task must remain mounted after all four statuses appear');
    assert.match(stackedLayout.coreHeading, /把原文整理成可追溯的行动结论/u);
    assert.equal(stackedLayout.coreCancelVisible, true);
    assert.equal(stackedLayout.postProcessFourStatusesRetained, true);
    assert.equal(stackedLayout.processingStartedFromSafeSample, true);
    assert.equal(stackedLayout.flowRects.length, 6);
    for (const [index, rect] of stackedLayout.flowRects.entries()) {
      assert.ok(rect.width > 0 && rect.height > 0,
        `stacked flow item ${index + 1} has zero geometry`);
      if (index > 0) {
        assert.ok(
          stackedLayout.flowRects[index - 1].bottom <= rect.top + 1,
          `stacked flow item ${index + 1} overlaps its predecessor`,
        );
      }
    }

    assert.equal(stackedStatusTextScale.allEnabledActionsFocusVisible, true);
    assert.equal(stackedStatusTextScale.allDisabledActionsReachable, true);
    assert.equal(stackedStatusTextScale.nativeKeyboardModalityPrimed, true);
    assert.equal(stackedStatusTextScale.applicationIpcRejected, true);
    assert.equal(stackedStatusTextScale.fixtureClipboardStubbed, true);
    assert.deepEqual(Object.keys(stackedStatusTextScale.passiveEvidence).sort(), [
      'clipboard',
      'coreHeading',
      'header',
      'monitoring',
      'screenshot',
      'shortcut',
    ]);
    for (const [label, evidence] of Object.entries(stackedStatusTextScale.passiveEvidence)) {
      assertStackedStatusPassiveEvidence(evidence, `stacked-status ${label}`);
    }
    assert.deepEqual(Object.keys(stackedStatusTextScale.focusEvidence).sort(), [
      'coreCancel',
      'monitoring action 1',
      'screenshot action 1',
      'screenshot action 2',
      'shortcut action 1',
    ]);
    for (const [label, evidence] of Object.entries(stackedStatusTextScale.focusEvidence)) {
      assertStackedStatusFocusEvidence(evidence, `stacked-status ${label}`);
    }
    assert.deepEqual(Object.keys(stackedStatusTextScale.disabledActionEvidence).sort(), [
      'clipboard action 1',
      'clipboard action 2',
    ]);
    for (const [label, evidence] of Object.entries(
      stackedStatusTextScale.disabledActionEvidence,
    )) {
      assertStackedStatusPassiveEvidence(
        evidence,
        `stacked-status disabled ${label}`,
      );
    }
    assert.deepEqual(stackedStatusTextScale.appCounters, {
      processRequests: 1,
      screenshotCaptureRequests: 0,
      clipboardWriteRequests: 0,
      nativeClipboardWriteStubs: 0,
      providerConnectionRequests: 0,
      credentialDeleteRequests: 0,
      credentialDeleteSuccesses: 0,
      deepseekCredentialWriteRequests: 0,
      deepseekCredentialWriteSuccesses: 0,
      quitRequests: 0,
      quitDecisionRequests: 0,
      quitConfirmedDecisions: 0,
    });
    assert.deepEqual(stackedStatusTextScaleProof.fixtureRecoveryState, {
      storedRiskKeys: ['id'],
      activeRisk: false,
      statusRequests: 3,
      invalidAcknowledgements: 0,
      acknowledgedRisks: 1,
      rendererReloads: 0,
    });
    const stackedStatusWideShort = stackedStatusTextScaleProof.renderer.stackedStatusWideShort;
    assert.ok(stackedStatusWideShort,
      'native fixture did not return wide-short stacked-status evidence');
    assert.deepEqual(stackedStatusWideShort.viewport, { width: 400, height: 200 });
    assert.deepEqual(stackedStatusWideShort.counts, {
      pendingCaptureCount: 2,
      operationalStatusCount: 2,
      actionCount: 6,
      enabledActionCount: 4,
      disabledActionCount: 2,
    });
    assert.ok(['auto', 'scroll'].includes(stackedStatusWideShort.shell.overflowY));
    assert.equal(stackedStatusWideShort.shell.shellIsOnlyVerticalScrollOwner, true);
    assert.equal(stackedStatusWideShort.shell.statusCenterIsNotScrollable, true);
    assert.ok(stackedStatusWideShort.shell.clientWidth > 0
      && stackedStatusWideShort.shell.clientWidth <= 400);
    assert.ok(stackedStatusWideShort.shell.clientHeight > 0
      && stackedStatusWideShort.shell.clientHeight <= 200);
    assert.ok(stackedStatusWideShort.shell.scrollHeight
      > stackedStatusWideShort.shell.clientHeight);
    assert.ok(stackedStatusWideShort.shell.maximumScrollTop > 0);
    assert.equal(stackedStatusWideShort.shell.reachedMaximum, true);
    assert.equal(stackedStatusWideShort.shell.noHorizontalOverflow, true);
    assert.ok(stackedStatusWideShort.shell.scrollWidth
      <= stackedStatusWideShort.shell.clientWidth + 1);
    assert.equal(stackedStatusWideShort.layout.flowDoesNotOverlap, true);
    assert.equal(stackedStatusWideShort.layout.allPassiveContentReachable, true);
    assert.equal(stackedStatusWideShort.layout.allEnabledActionsFocusVisible, true);
    assert.equal(stackedStatusWideShort.layout.allDisabledActionsReachable, true);
    assert.equal(stackedStatusWideShort.layout.coreMounted, true);
    assert.equal(stackedStatusWideShort.layout.coreCancelVisible, true);
    assert.equal(stackedStatusWideShort.layout.fourStatusesRetained, true);
    assert.equal(stackedStatusWideShort.layout.flowRects.length, 6);
    for (const [index, rect] of stackedStatusWideShort.layout.flowRects.entries()) {
      assert.ok(rect.width > 0 && rect.height > 0,
        `wide-short flow item ${index + 1} has zero geometry`);
      if (index > 0) {
        assert.ok(
          stackedStatusWideShort.layout.flowRects[index - 1].bottom <= rect.top + 1,
          `wide-short flow item ${index + 1} overlaps its predecessor`,
        );
      }
    }
    assert.deepEqual(Object.keys(stackedStatusWideShort.passiveEvidence).sort(), [
      'clipboard',
      'coreHeading',
      'header',
      'monitoring',
      'screenshot',
      'shortcut',
    ]);
    for (const [label, evidence] of Object.entries(stackedStatusWideShort.passiveEvidence)) {
      assert.equal(evidence.fullyVisible, true,
        `wide-short ${label} was not fully reachable`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `wide-short ${label} introduced horizontal overflow`);
      assert.ok(Math.abs(evidence.shellScrollLeft) <= 1,
        `wide-short ${label} required horizontal scrolling`);
    }
    assert.deepEqual(Object.keys(stackedStatusWideShort.focusEvidence).sort(), [
      'coreCancel',
      'status action 1',
      'status action 2',
      'status action 5',
      'status action 6',
    ]);
    for (const [label, evidence] of Object.entries(stackedStatusWideShort.focusEvidence)) {
      assert.equal(evidence.focused, true, `wide-short ${label} did not retain focus`);
      assert.equal(evidence.focusVisible, true, `wide-short ${label} was not focus-visible`);
      assert.equal(evidence.ringRendered, true, `wide-short ${label} did not render a focus ring`);
      assert.equal(evidence.ringVisible, true, `wide-short ${label} focus ring was clipped`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `wide-short ${label} introduced horizontal overflow`);
      assert.ok(Math.abs(evidence.shellScrollLeft) <= 1,
        `wide-short ${label} required horizontal scrolling`);
    }
    assert.deepEqual(Object.keys(stackedStatusWideShort.disabledEvidence).sort(), [
      'status action 3',
      'status action 4',
    ]);
    for (const [label, evidence] of Object.entries(stackedStatusWideShort.disabledEvidence)) {
      assert.equal(evidence.fullyVisible, true,
        `wide-short disabled ${label} was not fully reachable`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `wide-short disabled ${label} introduced horizontal overflow`);
      assert.ok(Math.abs(evidence.shellScrollLeft) <= 1,
        `wide-short disabled ${label} required horizontal scrolling`);
    }
    assert.deepEqual(stackedStatusWideShort.appCounters, {
      processRequests: 1,
      screenshotCaptureRequests: 0,
      clipboardWriteRequests: 0,
      nativeClipboardWriteStubs: 0,
    });
    assert.deepEqual(stackedStatusWideShort.restoredBaseline, {
      contentSize: { width: 400, height: 400 },
      viewport: { width: 200, height: 200 },
      zoomFactor: 2,
    });
    assert.equal(stackedStatusTextScaleProof.blockedRendererExternalRequests, 0);
    assert.equal(networkTrap.requestCount, 0,
      'stacked-status text-scale fixture reached the blocked loopback trap');

    const runtimeProof = parseProof(await runFixture(
      'runtime-degraded-native',
    ));
    assertIsolationProof(runtimeProof);
    const runtimeDegraded = runtimeProof.renderer.runtimeDegraded;
    assert.ok(runtimeDegraded, 'native fixture did not return degraded runtime evidence');
    assert.equal(runtimeDegraded.role, 'alert');
    assert.equal(runtimeDegraded.titleVisible, true);
    assert.equal(runtimeDegraded.allMessagesVisible, true);
    assert.equal(runtimeDegraded.alertWithinViewport, true);
    assert.equal(runtimeDegraded.noHorizontalOverflow, true);
    assert.equal(runtimeDegraded.captureControlsReachable, true);
    assert.ok(runtimeDegraded.sessionSurfaceHeight > 200,
      `expected usable content below runtime alert, got ${runtimeDegraded.sessionSurfaceHeight}`);
    assert.ok(runtimeDegraded.viewport.width >= 400 && runtimeDegraded.viewport.width <= 520,
      `expected a compact degraded-runtime width, got ${runtimeDegraded.viewport.width}`);
    assert.ok(runtimeDegraded.viewport.height >= 400,
      `expected a usable degraded-runtime height, got ${runtimeDegraded.viewport.height}`);

    const startupRecoveryProof = parseProof(await runFixture(
      'startup-recovery-native',
    ));
    assertIsolationProof(startupRecoveryProof);
    const startupRecovery = startupRecoveryProof.renderer.startupRecovery;
    assert.ok(startupRecovery, 'native fixture did not return startup recovery evidence');
    assert.equal(startupRecovery.initialBlockedReasonVisible, true);
    assert.equal(startupRecovery.setupHiddenWhileBlocked, true);
    assert.equal(startupRecovery.confirmationStepVisible, true);
    assert.equal(startupRecovery.confirmationGuarded, true);
    assert.equal(startupRecovery.confirmationEntryFocused, true);
    assert.equal(startupRecovery.topLayerEscapePreservedConfirmation, true);
    assert.equal(startupRecovery.escapeClosedConfirmation, true);
    assert.equal(startupRecovery.escapeReturnedToFreshTrigger, true);
    assert.equal(startupRecovery.busyStateVisible, true);
    assert.equal(startupRecovery.recoveryScreenRemoved, true);
    assert.equal(startupRecovery.setupTitle, '先选择你希望获得哪种帮助');
    assert.equal(startupRecovery.recoveryNoticeVisible, true);
    assert.equal(startupRecovery.recoveryNoticeRole, 'status');
    assert.equal(startupRecovery.recoveryNoticeFocused, true);
    assert.equal(startupRecovery.backupFileNameSafe, true);
    assert.equal(startupRecovery.oldDataLeakAbsent, true);
    assert.equal(startupRecovery.noHorizontalOverflow, true);
    assert.equal(startupRecovery.recoveryRequests, 1);
    assert.ok(startupRecovery.viewport.width >= 400 && startupRecovery.viewport.width <= 820,
      `expected a bounded setup-width startup-recovery window, got ${startupRecovery.viewport.width}`);
    assert.ok(startupRecovery.viewport.height >= 400,
      `expected a usable startup-recovery height, got ${startupRecovery.viewport.height}`);

    const lazyWorkspaceRecoveryProof = parseProof(await runFixture(
      lazyWorkspaceRecoveryRun,
    ));
    assertIsolationProof(lazyWorkspaceRecoveryProof);
    assert.equal(lazyWorkspaceRecoveryProof.renderer.trustedInputBridgeAvailable, false);
    const lazyRecovery = lazyWorkspaceRecoveryProof.renderer.lazyWorkspaceRecovery;
    assert.ok(lazyRecovery,
      'native fixture did not return lazy workspace recovery evidence');
    assert.ok(lazyRecovery.viewport.width >= 520,
      `expected a usable native result width, got ${lazyRecovery.viewport.width}`);
    assert.ok(lazyRecovery.viewport.height >= 600,
      `expected a usable native result height, got ${lazyRecovery.viewport.height}`);

    for (const [label, evidence] of Object.entries({
      result: lazyRecovery.resultFailure,
      settings: lazyRecovery.settingsFailure,
    })) {
      assert.equal(evidence.mainCount, 1,
        `${label} load failure must expose exactly one visible main`);
      assert.equal(evidence.mainNamed, true,
        `${label} load failure main must have an accessible name`);
      assert.equal(evidence.mainRolePreserved, true,
        `${label} load failure must not replace the main role with alert`);
      assert.equal(evidence.alertCount, 1,
        `${label} load failure must expose exactly one visible alert`);
      assert.equal(evidence.alertWithinMain, true,
        `${label} load failure alert must be owned by the main landmark`);
      assert.equal(evidence.focusOwned, true,
        `${label} load failure must retain focus inside its recovery surface`);
      assert.equal(evidence.exactRetryFocus, true,
        `${label} load failure must focus its exact retry action`);
      assert.equal(evidence.focusTargetIsBody, false,
        `${label} load failure left focus on the document body`);
      assert.match(evidence.focusTargetTag, /^(?:button|h1|main)$/u,
        `${label} load failure focused an unexpected target`);
      assert.equal(evidence.retryActionVisible, true,
        `${label} load failure must expose its retry action`);
      assert.equal(evidence.retryActionEnabled, true,
        `${label} load failure retry action must remain enabled`);
    }
    assert.equal(lazyRecovery.settingsFailure.returnActionVisible, true,
      'Settings load failure must expose the preserved-result return action');
    assert.equal(lazyRecovery.settingsFailure.returnActionEnabled, true,
      'Settings load failure return action must remain enabled');
    assert.equal(lazyRecovery.settingsFailure.preservedResultMounted, true,
      'Settings load failure unmounted the completed result workspace');
    assert.equal(lazyRecovery.settingsFailure.preservedResultUnchanged, true,
      'Settings load failure changed the completed result');

    assert.equal(lazyRecovery.resultRetry.succeeded, true);
    assert.equal(lazyRecovery.resultRetry.failureRemoved, true);
    assert.equal(lazyRecovery.resultRetry.restoredSampleResult, true);
    assert.equal(lazyRecovery.resultRetry.processRequests, 0,
      'Result chunk retry must not repeat analysis');
    assert.equal(lazyRecovery.resultRetry.mainCount, 1);
    assert.equal(lazyRecovery.resultRetry.mainNamed, true);
    assert.equal(lazyRecovery.resultRetry.focusOwned, true,
      'recovered Result workspace did not receive focus');
    assert.equal(lazyRecovery.resultRetry.focusTargetIsBody, false);
    assert.equal(lazyRecovery.resultStylesheet.activeAttempt, '1');
    assert.equal(lazyRecovery.resultStylesheet.dedicatedRuleLoaded, true);
    assert.equal(lazyRecovery.resultStylesheet.loadedLinkCount, 1);
    assert.ok(lazyRecovery.resultStylesheet.requestCount >= 1,
      'the JS-failure fixture did not request its Result retry stylesheet');
    assert.equal(lazyRecovery.resultStylesheet.primaryFailureInjected, false);
    assert.equal(lazyRecovery.resultStylesheet.usedQueriedRetry, true);

    assert.equal(lazyRecovery.settingsRetry.succeeded, true);
    assert.equal(lazyRecovery.settingsRetry.failureRemoved, true);
    assert.equal(lazyRecovery.settingsRetry.settingsWriteRequests, 0,
      'Settings chunk retry must not write settings');
    assert.equal(lazyRecovery.settingsRetry.mainCount, 1);
    assert.equal(lazyRecovery.settingsRetry.mainNamed, true);
    assert.equal(lazyRecovery.settingsRetry.focusOwned, true,
      'recovered Settings workspace did not receive focus');
    assert.equal(lazyRecovery.settingsRetry.focusTargetIsBody, false);
    assert.equal(lazyRecovery.settingsStylesheet.activeAttempt, '1');
    assert.equal(lazyRecovery.settingsStylesheet.privateRuleLoaded, true);
    assert.equal(lazyRecovery.settingsStylesheet.loadedLinkCount, 1);
    assert.ok(lazyRecovery.settingsStylesheet.requestCount >= 1,
      'the JS-failure fixture did not request its Settings retry stylesheet');
    assert.equal(lazyRecovery.settingsStylesheet.primaryRequestCount, 0);
    assert.equal(lazyRecovery.settingsStylesheet.retryRequestCount, 1);
    assert.equal(lazyRecovery.settingsStylesheet.primaryFailureInjected, false);
    assert.equal(lazyRecovery.settingsStylesheet.usedQueriedRetry, true);
    assert.equal(lazyRecovery.settingsStylesheet.unstyledFrameObserved, false);

    assert.equal(lazyRecovery.returnedResult.sameResult, true,
      'returning from recovered Settings did not preserve the same result');
    assert.equal(lazyRecovery.returnedResult.processRequests, 0,
      'lazy recovery journey unexpectedly repeated analysis');
    assert.equal(lazyRecovery.returnedResult.mainCount, 1);
    assert.equal(lazyRecovery.returnedResult.mainNamed, true);
    assert.equal(lazyRecovery.navigation.sameDocument, true);
    assert.equal(lazyRecovery.navigation.urlUnchanged, true);
    assert.equal(lazyRecovery.navigation.timeOriginUnchanged, true);
    assert.equal(lazyRecovery.navigation.noReload, true);
    assert.equal(lazyRecovery.navigation.entryCount, 1);
    assert.equal(lazyRecovery.navigation.type, 'navigate');
    assert.equal(lazyRecovery.externalResourceRequestCount, 0,
      'lazy recovery journey requested an external renderer resource');
    assert.deepEqual(lazyRecovery.sideEffectRequests, {
      settingsWrites: 0,
      credentialWrites: 0,
      customPromptWrites: 0,
      credentialDeletes: 0,
      modelRequests: 0,
      processingRequests: 0,
      screenshotRequests: 0,
      clipboardWrites: 0,
      nativeClipboardWrites: 0,
    });
    assert.equal(lazyWorkspaceRecoveryProof.blockedRendererExternalRequests, 0,
      'lazy recovery renderer attempted a session-blocked external request');
    assert.equal(networkTrap.requestCount, 0,
      'lazy workspace recovery fixture reached the blocked loopback trap');

    const resultStylesheetRecoveryProof = parseProof(await runFixture(
      resultStylesheetRecoveryRun,
    ));
    assertIsolationProof(resultStylesheetRecoveryProof);
    assert.equal(
      resultStylesheetRecoveryProof.renderer.trustedInputBridgeAvailable,
      false,
    );
    const resultStylesheetRecovery = resultStylesheetRecoveryProof
      .renderer.lazyWorkspaceRecovery;
    assert.ok(resultStylesheetRecovery,
      'native fixture did not return Result stylesheet recovery evidence');
    assert.deepEqual(resultStylesheetRecoveryProof.nativeWindow.contentSize, {
      width: 400,
      height: 400,
    });
    assert.equal(resultStylesheetRecoveryProof.nativeWindow.zoomFactor, 2);
    assert.deepEqual(resultStylesheetRecovery.viewport, { width: 200, height: 200 },
      'stylesheet recovery must run at an exact 200x200 CSS viewport');
    assert.equal(resultStylesheetRecovery.textScale.exactViewport, true);
    assert.equal(resultStylesheetRecovery.textScale.nativeKeyboardModalityPrimed, true);
    assert.equal(resultStylesheetRecovery.textScale.initialRetryFocusOwned, true,
      'product focus must own the Result retry before fixture keyboard priming');
    assert.equal(resultStylesheetRecovery.resultFailure.mainCount, 1);
    assert.equal(resultStylesheetRecovery.resultFailure.mainNamed, true);
    assert.equal(resultStylesheetRecovery.resultFailure.alertCount, 1);
    assert.equal(resultStylesheetRecovery.resultFailure.alertWithinMain, true);
    assert.equal(resultStylesheetRecovery.resultFailure.focusOwned, true,
      'Result stylesheet failure did not retain recovery focus');
    assert.equal(resultStylesheetRecovery.resultFailure.exactRetryFocus, true,
      'Result stylesheet failure did not focus the exact retry action');
    assertWorkspaceFocusEvidence(
      resultStylesheetRecovery.resultFailure.retryFocusEvidence,
      'Result stylesheet failure retry',
    );
    assert.equal(resultStylesheetRecovery.resultFailure.retryActionEnabled, true);
    assert.equal(resultStylesheetRecovery.resultRetry.succeeded, true);
    assert.equal(resultStylesheetRecovery.resultRetry.failureRemoved, true);
    assert.equal(resultStylesheetRecovery.resultRetry.restoredSampleResult, true);
    assert.equal(resultStylesheetRecovery.resultRetry.processRequests, 0,
      'Result stylesheet retry must not repeat analysis');
    assert.equal(resultStylesheetRecovery.resultRetry.mainCount, 1);
    assert.equal(resultStylesheetRecovery.resultRetry.mainNamed, true);
    assert.equal(resultStylesheetRecovery.resultRetry.focusOwned, true,
      'recovered Result stylesheet workspace did not receive focus');
    assertWorkspaceFocusEvidence(
      resultStylesheetRecovery.resultRetry.focusEvidence,
      'recovered Result stylesheet headline',
    );
    assert.equal(resultStylesheetRecovery.resultStylesheet.activeAttempt, '1');
    assert.equal(resultStylesheetRecovery.resultStylesheet.dedicatedRuleLoaded, true);
    assert.equal(resultStylesheetRecovery.resultStylesheet.loadedLinkCount, 1);
    assert.ok(resultStylesheetRecovery.resultStylesheet.requestCount >= 2,
      'Result stylesheet recovery did not observe both primary and retry requests');
    assert.equal(resultStylesheetRecovery.resultStylesheet.primaryFailureInjected, true);
    assert.equal(resultStylesheetRecovery.resultStylesheet.usedQueriedRetry, true);
    assert.equal(resultStylesheetRecovery.settingsFailure.exactRetryFocus, true,
      'Settings stylesheet failure did not focus the exact retry action');
    assertWorkspaceFocusEvidence(
      resultStylesheetRecovery.settingsFailure.retryFocusEvidence,
      'Settings stylesheet failure retry',
    );
    assert.equal(resultStylesheetRecovery.settingsRetry.settingsWriteRequests, 0,
      'the stylesheet recovery journey must not write Settings while retrying');
    assertWorkspaceFocusEvidence(
      resultStylesheetRecovery.settingsRetry.focusEvidence,
      'recovered Settings return action',
    );
    assert.equal(resultStylesheetRecovery.settingsStylesheet.activeAttempt, '1');
    assert.equal(resultStylesheetRecovery.settingsStylesheet.privateRuleLoaded, true);
    assert.equal(resultStylesheetRecovery.settingsStylesheet.loadedLinkCount, 1);
    assert.ok(resultStylesheetRecovery.settingsStylesheet.requestCount >= 2,
      'Settings stylesheet recovery must observe its primary and retry resources');
    assert.equal(resultStylesheetRecovery.settingsStylesheet.primaryRequestCount, 1);
    assert.equal(resultStylesheetRecovery.settingsStylesheet.retryRequestCount, 1);
    assert.equal(resultStylesheetRecovery.settingsStylesheet.primaryFailureInjected, true);
    assert.equal(resultStylesheetRecovery.settingsStylesheet.usedQueriedRetry, true);
    assert.equal(resultStylesheetRecovery.settingsStylesheet.unstyledFrameObserved, false,
      'Settings rendered before its private stylesheet was parsed');
    assert.equal(resultStylesheetRecovery.returnedResult.sameResult, true,
      'the stylesheet recovery journey changed the completed result');
    assert.equal(resultStylesheetRecovery.returnedResult.processRequests, 0,
      'the stylesheet recovery journey unexpectedly repeated analysis');
    assertWorkspaceFocusEvidence(
      resultStylesheetRecovery.returnedResult.focusEvidence,
      'returned preserved Result headline',
    );
    assert.equal(resultStylesheetRecovery.navigation.sameDocument, true);
    assert.equal(resultStylesheetRecovery.navigation.urlUnchanged, true);
    assert.equal(resultStylesheetRecovery.navigation.timeOriginUnchanged, true);
    assert.equal(resultStylesheetRecovery.navigation.noReload, true);
    assert.equal(resultStylesheetRecovery.externalResourceRequestCount, 0,
      'Result stylesheet recovery requested an external renderer resource');
    assert.deepEqual(resultStylesheetRecovery.sideEffectRequests, {
      settingsWrites: 0,
      credentialWrites: 0,
      customPromptWrites: 0,
      credentialDeletes: 0,
      modelRequests: 0,
      processingRequests: 0,
      screenshotRequests: 0,
      clipboardWrites: 0,
      nativeClipboardWrites: 0,
    });
    assert.equal(resultStylesheetRecoveryProof.blockedRendererExternalRequests, 0,
      'Result stylesheet recovery attempted a session-blocked external request');
    assert.equal(networkTrap.requestCount, 0,
      'Result stylesheet recovery fixture reached the blocked loopback trap');

    const settingsStylesheetCollisionProof = parseProof(await runFixture(
      settingsStylesheetCollisionRun,
    ));
    assertIsolationProof(settingsStylesheetCollisionProof);
    assert.equal(settingsStylesheetCollisionProof.renderer.trustedInputBridgeAvailable, true);
    assert.deepEqual(settingsStylesheetCollisionProof.trustedInputState, {
      expectedSteps: 1,
      acceptedSteps: 1,
      rejectedSteps: 0,
      nextStep: 2,
      complete: true,
      mouseActions: 0,
      mouseInputEvents: 0,
      keyActions: 1,
      keyInputEvents: 2,
    });
    assert.deepEqual(settingsStylesheetCollisionProof.nativeWindow.contentSize, {
      width: 400,
      height: 400,
    });
    assert.equal(settingsStylesheetCollisionProof.nativeWindow.zoomFactor, 2);
    const settingsStylesheetCollision = settingsStylesheetCollisionProof
      .renderer.settingsStylesheetCollision;
    assert.ok(settingsStylesheetCollision,
      'native fixture did not return Settings stylesheet collision evidence');
    assert.deepEqual(settingsStylesheetCollision.viewport, { width: 200, height: 200 });
    assert.equal(settingsStylesheetCollision.loading.focus.focused, true);
    assert.equal(settingsStylesheetCollision.loading.focus.ariaBusy, 'true');
    assert.equal(settingsStylesheetCollision.loading.focus.visible, true);
    assert.deepEqual(settingsStylesheetCollision.loading.gate, {
      armCount: 1,
      heldCount: 0,
      manualReleaseCount: 0,
      watchdogReleaseCount: 0,
      failureCount: 0,
      armed: true,
      held: false,
    });
    assert.deepEqual(settingsStylesheetCollision.loading.heldGate, {
      armCount: 1,
      heldCount: 1,
      manualReleaseCount: 0,
      watchdogReleaseCount: 0,
      failureCount: 0,
      armed: true,
      held: true,
    });
    assert.equal(settingsStylesheetCollision.quitOverLoading.role, 'alertdialog');
    assert.equal(settingsStylesheetCollision.quitOverLoading.ariaModal, 'true');
    assert.equal(
      settingsStylesheetCollision.quitOverLoading.truthfulResultConsequence,
      true,
    );
    assert.equal(settingsStylesheetCollision.quitOverLoading.focus.exactSafeFocus, true);
    assert.equal(settingsStylesheetCollision.quitOverLoading.focus.topLayerCount, 1);
    assert.equal(settingsStylesheetCollision.quitOverLoading.focus.loadingConnected, true);
    assert.equal(settingsStylesheetCollision.quitOverLoading.focus.isolation.allInert, true);
    assert.equal(settingsStylesheetCollision.quitOverLoading.focus.isolation.allAriaHidden, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.exactSafeFocus, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.loadingConnected, false);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.failureConnected, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.retryEnabled, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.retryInert, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.retryFocused, false);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.preservedResultUnchanged, true);
    assert.equal(settingsStylesheetCollision.failureUnderQuit.unstyledSettingsHidden, true);
    assert.equal(settingsStylesheetCollision.quitCancel.trustedEscape.isTrusted, true);
    assert.equal(settingsStylesheetCollision.quitCancel.trustedEscape.key, 'Escape');
    assert.equal(
      settingsStylesheetCollision.quitCancel.trustedEscape.activeTargetOwned,
      true,
    );
    assert.equal(
      settingsStylesheetCollision.quitCancel.trustedEscape.eventTargetOwned,
      true,
    );
    assert.equal(settingsStylesheetCollision.quitCancel.backgroundRestored, true);
    assertWorkspaceFocusEvidence(
      settingsStylesheetCollision.quitCancel.retryFocus,
      'Settings Retry after App Quit cancellation',
    );
    const queuedCaptureUnderQuit = settingsStylesheetCollision.captureTakeover
      .queuedUnderQuit;
    assert.equal(queuedCaptureUnderQuit.exactSafeFocus, true);
    assert.equal(queuedCaptureUnderQuit.topLayerCount, 1);
    assert.equal(queuedCaptureUnderQuit.retryInert, true);
    assert.equal(queuedCaptureUnderQuit.counters.screenshotShortcutEvents, 1);
    assert.equal(queuedCaptureUnderQuit.counters.screenshotCaptureRequests, 0,
      'screenshot capture escaped App Quit ownership');
    assert.equal(queuedCaptureUnderQuit.counters.processRequests, 0,
      'analysis started behind App Quit');
    assert.equal(settingsStylesheetCollision.captureTakeover.failureRemoved, true);
    assert.equal(settingsStylesheetCollision.captureTakeover.completedResult, true);
    assert.equal(
      settingsStylesheetCollision.captureTakeover.counters.screenshotCaptureRequests,
      1,
    );
    assert.equal(settingsStylesheetCollision.captureTakeover.counters.processRequests, 1);
    assert.deepEqual(
      settingsStylesheetCollision.retryNoReplay.countersAfterRetry,
      settingsStylesheetCollision.retryNoReplay.countersBeforeRetry,
      'Settings Retry replayed a settled screenshot intent',
    );
    assert.equal(settingsStylesheetCollision.retryNoReplay.settingsStayedVisible, true);
    assert.equal(settingsStylesheetCollision.retryNoReplay.privateStylesheetLoaded, true);
    assert.equal(settingsStylesheetCollision.retryNoReplay.stylesheetLinkCount, 1);
    assertWorkspaceFocusEvidence(
      settingsStylesheetCollision.retryNoReplay.settingsReturnFocus,
      'retried Settings return after screenshot takeover',
    );
    assert.equal(settingsStylesheetCollision.confirmedCaptureDrop.queued.exactSafeFocus, true);
    assert.equal(settingsStylesheetCollision.confirmedCaptureDrop.queued.settingsInert, true);
    assert.equal(
      settingsStylesheetCollision.confirmedCaptureDrop.queued.counters
        .screenshotShortcutEvents,
      2,
    );
    assert.equal(
      settingsStylesheetCollision.confirmedCaptureDrop.queued.counters
        .screenshotCaptureRequests,
      1,
      'second screenshot started before the confirmed quit decision',
    );
    assert.equal(
      settingsStylesheetCollision.confirmedCaptureDrop.previewNoticeVisible,
      true,
    );
    assert.equal(settingsStylesheetCollision.confirmedCaptureDrop.captureDidNotStart, true);
    assert.deepEqual(settingsStylesheetCollision.gate, {
      armCount: 1,
      heldCount: 1,
      manualReleaseCount: 1,
      watchdogReleaseCount: 0,
      failureCount: 1,
      armed: false,
      held: false,
    });
    assert.deepEqual(settingsStylesheetCollision.counters, {
      processRequests: 1,
      screenshotCaptureRequests: 1,
      screenshotShortcutEvents: 2,
      settingsWrites: 0,
      credentialWrites: 0,
      customPromptWrites: 0,
      credentialDeletes: 0,
      providerConnectionRequests: 0,
      clipboardWrites: 0,
      nativeClipboardWrites: 0,
      quitRequests: 3,
      quitDecisionRequests: 3,
      quitConfirmedDecisions: 1,
    });
    assert.equal(settingsStylesheetCollision.navigation.sameDocument, true);
    assert.equal(settingsStylesheetCollision.navigation.urlUnchanged, true);
    assert.equal(settingsStylesheetCollision.navigation.timeOriginUnchanged, true);
    assert.equal(settingsStylesheetCollision.navigation.noReload, true);
    assert.equal(settingsStylesheetCollision.navigation.entryCount, 1);
    assert.equal(settingsStylesheetCollision.navigation.type, 'navigate');
    assert.equal(settingsStylesheetCollision.externalResourceRequestCount, 0);
    assert.equal(settingsStylesheetCollisionProof.blockedRendererExternalRequests, 0,
      'Settings stylesheet collision attempted a session-blocked external request');
    assert.equal(networkTrap.requestCount, 0,
      'Settings stylesheet collision fixture reached the blocked loopback trap');

    const clipboardResidueProof = parseProof(await runFixture(
      clipboardResidueRecoveryRun,
    ));
    assertIsolationProof(clipboardResidueProof);
    const clipboardResidueRecovery = clipboardResidueProof.renderer.clipboardResidueRecovery;
    assert.ok(clipboardResidueRecovery,
      'native fixture did not return clipboard residue recovery evidence');
    assert.equal(clipboardResidueRecovery.navigationType, 'reload');
    assert.equal(clipboardResidueRecovery.warningRole, 'alert');
    assert.equal(clipboardResidueRecovery.warningFocused, true);
    assert.equal(clipboardResidueRecovery.warningInitiallyFocused, true);
    assert.equal(clipboardResidueRecovery.warningFocusTargetId, 'clipboard-residue-risk-title');
    assertStackedStatusFocusEvidence(
      clipboardResidueRecovery.warningFocusEvidence,
      'clipboard residue warning title after reload',
    );
    assert.equal(clipboardResidueRecovery.warningExplainsManualOverwriteOnly, true);
    assert.equal(clipboardResidueRecovery.noAutomaticClipboardAction, true);
    assert.equal(clipboardResidueRecovery.opaqueIdNotRendered, true);
    assert.equal(clipboardResidueRecovery.copiedContentNotRendered, true);
    assert.equal(clipboardResidueRecovery.invalidAcknowledgementPreservedWarning, true);
    assert.equal(clipboardResidueRecovery.exactAcknowledgementReleasedRisk, true);
    assert.equal(clipboardResidueRecovery.warningRemovedAfterAcknowledgement, true);
    assert.equal(clipboardResidueRecovery.noHorizontalOverflow, true);
    assert.equal(clipboardResidueRecovery.noClipboardOperations, true);
    assert.equal(clipboardResidueRecovery.clipboardCountersAreSafeIntegers, true);
    assert.equal(clipboardResidueRecovery.clipboardWriteRequests, 0);
    assert.equal(clipboardResidueRecovery.nativeClipboardWriteStubs, 0);
    assert.deepEqual(clipboardResidueProof.fixtureRecoveryState, {
      storedRiskKeys: ['id'],
      activeRisk: false,
      statusRequests: 4,
      invalidAcknowledgements: 1,
      acknowledgedRisks: 1,
      rendererReloads: 1,
    });
    assert.ok(
      clipboardResidueRecovery.viewport.width >= 400
        && clipboardResidueRecovery.viewport.width <= 520,
      `expected a compact clipboard-residue width, got ${clipboardResidueRecovery.viewport.width}`,
    );
    assert.ok(clipboardResidueRecovery.viewport.height >= 400,
      `expected a usable clipboard-residue height, got ${clipboardResidueRecovery.viewport.height}`);
    assert.equal(networkTrap.requestCount, 0,
      'clipboard residue recovery fixture reached the blocked loopback trap');

    const settingsSaveRetryProof = parseProof(await runFixture(
      settingsSaveRetryRun,
    ));
    assertIsolationProof(settingsSaveRetryProof);
    assert.equal(settingsSaveRetryProof.renderer.trustedInputBridgeAvailable, false);
    const settingsSaveRetry = settingsSaveRetryProof.renderer.settingsSaveRetry;
    assert.ok(settingsSaveRetry,
      'native fixture did not return Settings credential save retry evidence');
    assert.equal(settingsSaveRetry.initialFailureVisible, true);
    assert.equal(settingsSaveRetry.retryActionVisible, true);
    assert.equal(settingsSaveRetry.initialCredentialWriteRequests, 1,
      'the initial fictional credential write must be attempted exactly once');
    assert.equal(settingsSaveRetry.initialCredentialWriteSuccesses, 0,
      'the isolated credential-once scenario must fail its first write');
    assert.equal(settingsSaveRetry.deepseekCredentialWriteRequests, 2,
      'global retry must make exactly one additional credential write');
    assert.equal(settingsSaveRetry.deepseekCredentialWriteSuccesses, 1,
      'exactly the retried credential write must succeed');
    assert.equal(settingsSaveRetry.localErrorAbsent, true);
    assert.doesNotMatch(settingsSaveRetry.localStatusText, /保存失败/u);
    assert.equal(settingsSaveRetry.draftCleared, true);
    assert.equal(settingsSaveRetry.fictionalCredentialAbsentFromInputs, true);
    assert.equal(settingsSaveRetry.saveButtonDisabled, true);
    assert.equal(settingsSaveRetry.providerTestEnabled, true);
    assert.equal(settingsSaveRetry.providerTestPromptAbsent, true);
    assert.doesNotMatch(settingsSaveRetry.providerTestText, /请先保存/u);
    assert.equal(settingsSaveRetry.globalErrorAbsent, true);
    assert.equal(settingsSaveRetry.recoveryStatusPresent, true);
    assert.equal(settingsSaveRetry.recoveryStatusRole, 'status');
    assert.match(settingsSaveRetry.recoveryStatusText, /刚才的设置已保存，可以继续/u);
    assert.equal(settingsSaveRetry.providerTestFocused, true);
    assert.equal(settingsSaveRetry.activeElementIsEnabledProviderTestButton, true);
    assert.equal(settingsSaveRetry.activeElementIsBody, false);
    assert.equal(settingsSaveRetry.activeElementIsLiveRegion, false);
    assert.equal(settingsSaveRetry.activeElement.tagName, 'button');
    assert.match(settingsSaveRetry.activeElement.className,
      /(?:^|\s)provider-connection-test-button(?:\s|$)/u);
    assert.equal(settingsSaveRetry.testSideFocusManipulation, false);
    assert.ok(Number.isSafeInteger(settingsSaveRetry.liveOwnerCount));
    assert.equal(settingsSaveRetry.liveOwnerCount, settingsSaveRetry.liveOwners.length);
    assert.equal(settingsSaveRetry.liveOwnerFailureTextAbsent, true);
    assert.ok(settingsSaveRetry.liveOwners.some((owner) => (
      owner.role === 'status'
        && owner.text.includes('刚才的设置已保存，可以继续')
    )), 'DOM live-owner inventory omitted the Settings recovery status');
    assert.ok(
      settingsSaveRetry.viewport.width >= 400 && settingsSaveRetry.viewport.width <= 520,
      `expected a compact Settings save-retry width, got ${settingsSaveRetry.viewport.width}`,
    );
    assert.ok(settingsSaveRetry.viewport.height >= 400,
      `expected a usable Settings save-retry height, got ${settingsSaveRetry.viewport.height}`);
    assert.equal(networkTrap.requestCount, 0,
      'Settings credential save retry fixture reached the blocked loopback trap');

    const settingsPromptDraftRecoveryProof = parseProof(await runFixture(
      settingsPromptDraftRecoveryRun,
    ));
    assertIsolationProof(settingsPromptDraftRecoveryProof);
    assert.equal(
      settingsPromptDraftRecoveryProof.renderer.trustedInputBridgeAvailable,
      false,
    );
    const promptDraft = settingsPromptDraftRecoveryProof
      .renderer.settingsPromptDraftRecovery;
    assert.ok(promptDraft,
      'native fixture did not return custom prompt draft recovery evidence');
    assert.equal(
      Object.values(promptDraft).every((value) => (
        typeof value === 'boolean' || Number.isSafeInteger(value)
      )),
      true,
      'custom prompt proof must contain only booleans and safe counters',
    );
    assert.doesNotMatch(JSON.stringify(promptDraft), /Fixture prompt/u,
      'custom prompt proof must never emit fixture draft content');
    assert.equal(promptDraft.firstUseConnectionReady, true);
    assert.equal(promptDraft.firstUseEnableInitiallyEnabled, true);
    assert.equal(promptDraft.firstUseEnableRemainedActionable, true);
    assert.equal(promptDraft.firstUseEnableStartedFromTriggerFocus, true);
    assert.equal(promptDraft.firstUseEnableGuardVisible, true);
    assert.equal(promptDraft.firstUseEnableGuardCancelled, true);
    assert.equal(promptDraft.firstUseEnableGuardRestoredTriggerFocus, true);
    assert.equal(promptDraft.firstUseEnableAttemptStayedInSettings, true);
    assert.equal(promptDraft.firstUseEnableDidNotWrite, true);
    assert.equal(promptDraft.escapeGuardVisible, true);
    assert.equal(promptDraft.escapeNoImplicitWrite, true);
    assert.equal(promptDraft.escapeCancelPreservedDraft, true);
    assert.equal(promptDraft.escapeCancelRestoredPromptFocus, true);
    assert.equal(promptDraft.returnGuardVisible, true);
    assert.equal(promptDraft.returnNoImplicitWrite, true);
    assert.equal(promptDraft.returnCancelPreservedDraft, true);
    assert.equal(promptDraft.returnActionStartedFromReturnFocus, true);
    assert.equal(promptDraft.returnCancelRestoredReturnFocus, true);
    assert.equal(promptDraft.escapeAndReturnFocusAreDistinct, true);
    assert.equal(promptDraft.firstFailurePreservedDraft, true);
    assert.equal(promptDraft.firstFailureLocalErrorVisible, true);
    assert.equal(promptDraft.firstFailureGlobalErrorVisible, true);
    assert.equal(promptDraft.firstFailureRequestCount, 1);
    assert.equal(promptDraft.firstFailureSuccessCount, 0);
    assert.equal(promptDraft.failedRetryClearedOnPersistedRestore, true);
    assert.equal(promptDraft.persistedRestoreDidNotWrite, true);
    assert.equal(promptDraft.persistedRestoreLeftWithoutGuard, true);
    assert.equal(promptDraft.persistedRestoreSurvivedReopen, true);
    assert.equal(promptDraft.failedRetryAbsentAfterReopen, true);
    assert.equal(promptDraft.failedPromptANotRevived, true);
    assert.equal(promptDraft.retryStartedWhileAdvancedCollapsed, true);
    assert.equal(promptDraft.retrySucceeded, true);
    assert.equal(promptDraft.retryOpenedAdvancedPrompt, true);
    assert.equal(promptDraft.retryFocusedPrompt, true);
    assert.equal(promptDraft.retryFocusedVisiblePrompt, true);
    assert.equal(promptDraft.reopenedShowsSavedA, true);
    assert.equal(promptDraft.discardedBAbsent, true);
    assert.equal(promptDraft.retryDidNotRevive, true);
    assert.equal(promptDraft.discardDidNotWrite, true);
    assert.equal(promptDraft.reopenedSaveDisabled, true);
    assert.equal(promptDraft.settingsWriteRequests, 3,
      'prompt recovery must make two failed writes and one explicit retry');
    assert.equal(promptDraft.settingsWriteSuccesses, 1,
      'only the explicit prompt retry may persist');
    assert.equal(promptDraft.customPromptWriteRequests, 3);
    assert.equal(promptDraft.customPromptWriteSuccesses, 1);
    assert.ok(
      settingsPromptDraftRecoveryProof.nativeWindow.contentSize.width >= 400
        && settingsPromptDraftRecoveryProof.nativeWindow.contentSize.width <= 520,
      'expected a compact custom prompt recovery window',
    );
    assert.ok(settingsPromptDraftRecoveryProof.nativeWindow.contentSize.height >= 400,
      'expected a usable custom prompt recovery window');
    assert.equal(networkTrap.requestCount, 0,
      'Settings custom prompt draft recovery fixture reached the blocked loopback trap');

    const providerRetryProof = parseProof(await runFixture(
      'provider-retry-native',
    ));
    assertIsolationProof(providerRetryProof);
    const providerRetry = providerRetryProof.renderer.providerRetry;
    assert.ok(providerRetry, 'native fixture did not return provider retry evidence');
    assert.equal(providerRetry.firstFailureVisible, true);
    assert.equal(providerRetry.failedResultFocused, true);
    assert.equal(providerRetry.retryActionVisible, true);
    assert.equal(providerRetry.successVisible, true);
    assert.equal(providerRetry.successResultFocused, true);
    assert.equal(providerRetry.savedConfigurationPreserved, true);
    assert.equal(providerRetry.providerConnectionRequests, 2);
    assert.ok(providerRetry.viewport.width >= 400 && providerRetry.viewport.width <= 520,
      `expected a compact provider-retry width, got ${providerRetry.viewport.width}`);
    assert.ok(providerRetry.viewport.height >= 400,
      `expected a usable provider-retry height, got ${providerRetry.viewport.height}`);
    assert.equal(networkTrap.requestCount, 0,
      'recovery fixture scenarios reached the blocked loopback trap');

    const transitionProof = parseProof(await runFixture(
      'settings-transition-native',
    ));
    assertIsolationProof(transitionProof);
    const transition = transitionProof.renderer.settingsTransition;
    assert.ok(transition, 'native fixture did not return Settings transition evidence');
    assert.equal(transition.draftRole, 'alertdialog');
    assert.equal(transition.draftAriaModal, 'true');
    assert.equal(transition.backgroundIsolated, true);
    assert.equal(transition.pointerBlocked, true);
    assert.equal(transition.geometryContained, true);
    assert.equal(transition.appQuitLifo, true);
    assert.equal(transition.appQuitRequestDelivered, true);
    assert.equal(transition.appQuitStayedPendingForExplicitDecision, true);
    assert.equal(transition.tabWrappedBothDirections, true);
    assert.equal(transition.priorSiblingRestored, true);
    assert.equal(transition.busyEscapeConsumed, true);
    assert.equal(transition.stopFailureFocused, true);
    assert.equal(transition.lateCompletionSurfaced, true);
    assert.equal(transition.controlsLockedUntilSettled, true);
    assert.equal(transition.completedResultFocused, true);
    assert.ok(transition.viewport.width >= 400 && transition.viewport.width <= 520,
      `expected a compact native Settings width, got ${transition.viewport.width}`);
    assert.ok(transition.viewport.height >= 400,
      `expected a usable native Settings height, got ${transition.viewport.height}`);

    const textScaleProof = parseProof(await runFixture(
      settingsTextScaleRun,
    ));
    assertIsolationProof(textScaleProof);
    assert.deepEqual(textScaleProof.nativeWindow.contentSize, { width: 400, height: 400 });
    assert.deepEqual(textScaleProof.nativeWindow.bounds, { width: 400, height: 400 });
    assert.equal(textScaleProof.nativeWindow.zoomFactor, 2);
    const textScale = textScaleProof.renderer.settingsTransition?.textScaleNative;
    assert.ok(textScale, 'native fixture did not return 200% Settings focus-visibility evidence');
    assert.deepEqual(textScale.viewport, { width: 200, height: 200 },
      '400x400 native content at 200% must expose an exact 200x200 CSS viewport');
    const shell = textScale.shell;
    assert.ok(shell, 'native fixture did not return full Settings shell evidence');
    assert.deepEqual(shell.viewport, { width: 200, height: 200 });
    assert.equal(shell.pageNoHorizontalOverflow, true);
    assert.equal(shell.scrollportNoHorizontalOverflow, true);
    assert.equal(shell.scrollLeftStayedZero, true);
    assert.equal(shell.allSectionsReachable, true);
    assert.equal(shell.allFocusEvidenceVisible, true);
    assert.equal(shell.allRadioGroupsHaveAuthoritativeTabStop, true);
    assert.ok(shell.scrollport.clientWidth > 0 && shell.scrollport.clientWidth <= 200);
    assert.ok(shell.scrollport.clientHeight > 0 && shell.scrollport.clientHeight < 200);
    assert.ok(shell.scrollport.scrollHeight > shell.scrollport.clientHeight);
    assert.ok(shell.scrollport.maxScrollTop > 0);
    const layout = shell.layoutEvidence;
    assert.ok(layout, 'native fixture did not return defect-specific Settings geometry');
    assert.equal(layout.allDefectSpecificGeometryPasses, true);
    assert.equal(layout.modeSummary.stacked, true,
      'mode-summary label and detail must stack at 200x200 CSS pixels');
    assert.ok(layout.modeSummary.detail.top >= layout.modeSummary.label.bottom - 1);
    assert.equal(layout.privacyBadge.intersectionArea, 0,
      'analysis-location privacy badge must not overlap its title');
    assert.ok(layout.settingEditors.rowCount >= 2);
    assert.equal(layout.settingEditors.allRowsStacked, true,
      'setting-editor status and actions must stack at 200x200 CSS pixels');
    assert.equal(layout.settingEditors.allWidthsMeaningful, true,
      'setting-editor controls must not collapse into character-width columns');
    assert.equal(layout.settingEditors.allTextVisible, true);
    assert.equal(layout.settingEditors.noHorizontalOverflow, true);
    for (const row of layout.settingEditors.rows) {
      assert.equal(row.stacked, true);
      assert.equal(row.meaningfulStatusWidth, true);
      assert.equal(row.meaningfulControlWidth, true);
      assert.equal(row.meaningfulButtonWidths, true);
      assert.equal(row.textNotClipped, true);
      assert.equal(row.noHorizontalOverflow, true);
      assert.ok(row.status.width >= 72);
      assert.ok(row.controls.width >= 72);
      assert.ok(row.buttons.every((button) => button.width >= 64));
    }
    assert.equal(layout.supportGrid.oneColumn, true,
      'support diagnostics must use one card column at 200x200 CSS pixels');
    assert.equal(layout.supportGrid.computedColumns.length, 1);
    assert.ok(layout.supportGrid.cardCount >= 4);
    assert.equal(layout.supportGrid.cardsVerticallyStacked, true);
    assert.equal(layout.supportGrid.strongSmallWrap, true,
      'support diagnostic strong/small copy must wrap at 200x200 CSS pixels');
    assert.equal(layout.supportGrid.strongSmallNoClipping, true,
      'support diagnostic strong/small copy must not clip');
    assert.equal(layout.supportGrid.noHorizontalOverflow, true);
    for (const textEvidence of layout.supportGrid.textEvidence) {
      assert.equal(textEvidence.wraps, true);
      assert.equal(textEvidence.noClipping, true);
      assert.notEqual(textEvidence.whiteSpace, 'nowrap');
      assert.ok(['anywhere', 'break-word'].includes(textEvidence.overflowWrap));
    }
    assert.equal(layout.advancedSummary.minimumHeight, 32);
    assert.equal(layout.advancedSummary.meetsMinimumHeight, true,
      'advanced Settings summary must retain a 32 CSS-pixel hit target');
    assert.ok(layout.advancedSummary.rect.height >= 32);
    assert.equal(layout.advancedSummary.noHorizontalClipping, true);
    assert.deepEqual(Object.keys(shell.sectionEvidence).sort(), [
      'analysisLocation',
      'connectionTest',
      'credentialEditor',
      'modeSummary',
      'modelEditor',
      'monitoring',
      'onlineProvider',
      'reset',
      'secondarySettings',
      'shortcuts',
      'support',
      'translationFallback',
      'verification',
    ]);
    for (const [label, evidence] of Object.entries(shell.sectionEvidence)) {
      assert.equal(evidence.verticallyReachable, true,
        `${label} was not reachable by vertical Settings scrolling`);
      assert.equal(evidence.horizontallyContained, true,
        `${label} escaped the Settings scrollport horizontally`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `${label} introduced horizontal document overflow`);
      assert.equal(evidence.scrollportNoHorizontalOverflow, true,
        `${label} introduced horizontal Settings scrollport overflow`);
      assert.ok(Math.abs(evidence.shellScrollLeft) <= 1,
        `${label} required horizontal Settings scrolling`);
    }
    assert.deepEqual(Object.keys(shell.focusEvidence).sort(), [
      'clipboardShortcutRecorder',
      'connectionTest',
      'credentialInput',
      'credentialSave',
      'locationRadio',
      'modelInput',
      'monitoringSwitch',
      'providerRadio',
      'reset',
      'return',
      'screenshotShortcutRecorder',
      'secondarySummary',
      'supportCopy',
      'supportRefresh',
      'verificationRadio',
    ]);
    for (const [label, evidence] of Object.entries(shell.focusEvidence)) {
      assert.equal(evidence.focused, true, `${label} did not retain shell focus`);
      assert.equal(evidence.focusVisible, true, `${label} was not browser focus-visible`);
      assert.equal(evidence.ringRendered, true, `${label} did not render a focus ring`);
      assert.equal(evidence.ringVisible, true,
        `${label} focus ring was clipped by the Settings shell`);
      assert.equal(evidence.horizontallyContained, true,
        `${label} escaped the Settings shell horizontally`);
      assert.equal(evidence.verticallyReachable, true,
        `${label} was not vertically reachable in Settings`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `${label} introduced horizontal document overflow`);
      assert.equal(evidence.scrollportNoHorizontalOverflow, true,
        `${label} introduced horizontal shell overflow`);
      assert.ok(Math.abs(evidence.shellScrollLeft) <= 1,
        `${label} required horizontal Settings scrolling`);
    }
    assert.deepEqual(Object.keys(shell.radioGroups).sort(), [
      'analysisLocation',
      'onlineProvider',
      'verification',
    ]);
    for (const [label, group] of Object.entries(shell.radioGroups)) {
      assert.ok(group.radioCount > 1, `${label} did not expose a complete radiogroup`);
      assert.equal(group.checkedCount, 1, `${label} must have exactly one checked radio`);
      assert.equal(group.tabStopCount, 1, `${label} must have exactly one tab stop`);
      assert.equal(group.tabStopMatchesChecked, true,
        `${label} tab stop did not match its authoritative checked radio`);
      assert.equal(group.checkedText, group.tabStopText);
    }
    assert.deepEqual(Object.keys(textScale.focusEvidence).sort(), [
      'completedNotice',
      'completedTabAction',
      'draftInitialSafe',
      'draftShiftTabLastAction',
      'draftTabFirstAction',
      'errorNotice',
      'errorShiftTabLastAction',
      'errorTabFirstAction',
    ]);
    for (const [label, evidence] of Object.entries(textScale.focusEvidence)) {
      assert.equal(evidence.focused, true, `${label} did not retain DOM focus`);
      assert.equal(evidence.ringVisible, true, `${label} focus ring was clipped by the dialog scrollport`);
      assert.equal(evidence.pageNoHorizontalOverflow, true,
        `${label} introduced horizontal document overflow`);
      assert.equal(evidence.dialogNoHorizontalOverflow, true,
        `${label} introduced horizontal dialog overflow`);
    }
    assert.equal(textScale.noHorizontalOverflow, true);
    assert.equal(textScale.dialogsNoHorizontalOverflow, true);
    assert.equal(textScale.allFocusEvidenceVisible, true);

    const discardProof = parseProof(await runFixture(
      'settings-draft-discard-native',
    ));
    assertIsolationProof(discardProof);
    const discard = discardProof.renderer.settingsTransition;
    assert.ok(discard, 'native fixture did not return draft-discard evidence');
    assert.equal(discard.appQuitRequestDelivered, true);
    assert.equal(discard.appQuitStayedPendingForExplicitDecision, true);
    assert.equal(discard.discardResetVisibleDraft, true);
    assert.equal(discard.discardClearedDirtyState, true);
    assert.equal(discard.discardTestUsesSavedConfiguration, true);
    assert.equal(discard.discardFailureKeptSavedBackend, true);
    assert.equal(discard.discardFailureRecoveryVisible, true);
    const keyboardDiscard = discard.keyboardBackendDiscard;
    assert.ok(keyboardDiscard, 'native fixture did not return keyboard backend discard evidence');
    assert.equal(keyboardDiscard.firstArrowRightOwned, true);
    assert.equal(keyboardDiscard.firstArrowRightTargetedOpenAi, true);
    assert.equal(keyboardDiscard.cancelledOnce, true);
    assert.equal(keyboardDiscard.cancel.deepSeekFocused, true);
    assert.equal(keyboardDiscard.cancel.deepSeekChecked, true);
    assert.equal(keyboardDiscard.cancel.deepSeekTabIndex, 0);
    assert.equal(keyboardDiscard.cancel.openAiChecked, false);
    assert.equal(keyboardDiscard.cancel.openAiTabIndex, -1);
    assert.equal(keyboardDiscard.cancel.focusEvidence.focused, true);
    assert.equal(keyboardDiscard.secondArrowRightOwned, true);
    assert.equal(keyboardDiscard.secondArrowRightTargetedOpenAi, true);
    assert.equal(keyboardDiscard.confirmedDiscard, true);
    assert.equal(keyboardDiscard.saveOnceFailureVisible, true);
    assert.equal(keyboardDiscard.failure.deepSeekFocused, true);
    assert.equal(keyboardDiscard.failure.deepSeekChecked, true);
    assert.equal(keyboardDiscard.failure.deepSeekTabIndex, 0);
    assert.equal(keyboardDiscard.failure.openAiChecked, false);
    assert.equal(keyboardDiscard.failure.openAiTabIndex, -1);
    assert.equal(keyboardDiscard.failure.focusEvidence.focused, true);
    assert.equal(keyboardDiscard.failure.focusEvidence.focusVisible, true);
    assert.equal(keyboardDiscard.failure.focusEvidence.ringRendered, true);
    assert.equal(keyboardDiscard.failure.focusEvidence.ringVisible, true);
    assert.ok(discard.viewport.width >= 400 && discard.viewport.width <= 520,
      `expected a compact native Settings width, got ${discard.viewport.width}`);
    assert.ok(discard.viewport.height >= 400,
      `expected a usable native Settings height, got ${discard.viewport.height}`);

    const failedDraftDiscardProof = parseProof(await runFixture(
      'settings-failed-draft-discard-native',
    ));
    assertIsolationProof(failedDraftDiscardProof);
    const failedDraftDiscard = failedDraftDiscardProof.renderer.failedDraftDiscard;
    assert.ok(failedDraftDiscard,
      'native fixture did not return failed credential draft discard evidence');
    assert.equal(failedDraftDiscard.initialFailureVisible, true);
    assert.equal(failedDraftDiscard.explicitDiscardRequired, true);
    assert.equal(failedDraftDiscard.visibleDraftCleared, true);
    assert.equal(failedDraftDiscard.genericRecoveryRemoved, true);
    assert.equal(failedDraftDiscard.abandonedCredentialNotRetried, true);
    assert.equal(failedDraftDiscard.abandonedCredentialNotPersisted, true);
    assert.equal(failedDraftDiscard.targetSwitchSucceeded, true);
    assert.equal(failedDraftDiscard.deepseekCredentialWriteRequests, 1,
      'discarded replacement credential must have only its original failed write attempt');
    assert.equal(failedDraftDiscard.deepseekCredentialWriteSuccesses, 0,
      'discarded replacement credential must never reach the fixture store');
    assert.ok(failedDraftDiscard.viewport.width >= 400 && failedDraftDiscard.viewport.width <= 520,
      `expected a compact native Settings width, got ${failedDraftDiscard.viewport.width}`);
    assert.ok(failedDraftDiscard.viewport.height >= 400,
      `expected a usable native Settings height, got ${failedDraftDiscard.viewport.height}`);

    const failedSourceRetryProof = parseProof(await runFixture(
      'failed-source-retry-native',
    ));
    assertIsolationProof(failedSourceRetryProof);
    const failedSourceRetry = failedSourceRetryProof.renderer.failedSourceRetry;
    assert.ok(failedSourceRetry,
      'native fixture did not return failed replacement source retry evidence');
    assert.equal(failedSourceRetry.initialAVisible, true);
    assert.equal(failedSourceRetry.previousAVisibleAfterFailure, true);
    assert.equal(failedSourceRetry.failedAttemptNoticeVisible, true);
    assert.equal(failedSourceRetry.retryActionVisible, true);
    assert.equal(failedSourceRetry.reviewActionVisible, true);
    assert.equal(failedSourceRetry.reviewSourceBVisible, true);
    assert.equal(failedSourceRetry.correctedSourceBVisible, true);
    assert.equal(failedSourceRetry.reviewReturnRestoredA, true);
    assert.equal(failedSourceRetry.reviewReturnRestoredActions, true);
    assert.equal(failedSourceRetry.reviewDidNotSubmit, true);
    assert.equal(failedSourceRetry.firstPayloadIsB, true);
    assert.equal(failedSourceRetry.retryPayloadMatchesCorrectedB, true);
    assert.equal(failedSourceRetry.successfulCorrectedBVisible, true);
    assert.equal(failedSourceRetry.source, 'manual');
    assert.equal(failedSourceRetry.truncated, false);
    assert.equal(failedSourceRetry.originalLength, 92);
    assert.equal(failedSourceRetry.captureMetadataCleared, true);
    assert.equal(failedSourceRetry.processRequests, 2,
      'failed source retry must submit source B exactly twice');
    assert.ok(failedSourceRetry.viewport.width >= 520,
      `expected a usable native result width, got ${failedSourceRetry.viewport.width}`);
    assert.ok(failedSourceRetry.viewport.height >= 600,
      `expected a usable native result height, got ${failedSourceRetry.viewport.height}`);

    const replyCopyProof = parseProof(await runFixture(
      'reply-copy-settlement-native',
    ));
    assertIsolationProof(replyCopyProof);
    const settlement = replyCopyProof.renderer.replyCopySettlement;
    assert.ok(settlement, 'native fixture did not return guided reply copy settlement evidence');
    assert.equal(settlement.pendingActionDisabled, true);
    assert.equal(settlement.pendingActionBusy, true);
    assert.equal(settlement.pendingNoticeVisible, true);
    assert.equal(settlement.editedBeforeSettlement, true);
    assert.equal(settlement.resultCopyDisabledWhileReplyPending, true);
    assert.equal(settlement.actionsCopyDisabledWhileReplyPending, true);
    assert.ok(Number.isSafeInteger(settlement.sourceLinkCopyCountWhileReplyPending));
    assert.ok(settlement.sourceLinkCopyCountWhileReplyPending >= 1,
      'fixture should render at least one retrieved official source copy action');
    assert.equal(settlement.sourceLinksDisabledWhileReplyPending, true);
    assert.ok(Number.isSafeInteger(settlement.savedTermCopyCountWhileReplyPending));
    assert.ok(settlement.savedTermCopyCountWhileReplyPending >= 3,
      'fixture should render every saved-term copy variant');
    assert.equal(settlement.savedTermCopiesDisabledWhileReplyPending, true);
    assert.equal(settlement.diagnosticsCopyDisabledWhileReplyPending, true);
    assert.ok(Number.isSafeInteger(settlement.recoveryCommandCopyCountWhileReplyPending));
    assert.ok(settlement.recoveryCommandCopyCountWhileReplyPending >= 2,
      'unreachable Ollama recovery should expose both guarded command copies');
    assert.equal(settlement.recoveryCommandsDisabledWhileReplyPending, true);
    assert.equal(settlement.crossEntryClicksRejected, true);
    assert.equal(settlement.writesBeforeCrossEntryClicks, 1,
      'reply copy should be the sole pending clipboard write before cross-entry attempts');
    assert.equal(settlement.writesAfterCrossEntryClicks, 1,
      'disabled result/action/source copy attempts must not start another write');
    assert.equal(settlement.writesAfterSavedTermClicks, 1,
      'disabled saved-term copy attempts must not start another write');
    assert.equal(settlement.writesAfterSettingsClicks, 1,
      'disabled diagnostics/recovery copy attempts must not start another write');
    assert.equal(settlement.taskExitedBeforeSettlement, true);
    assert.equal(settlement.lateSuccessRetainedGlobally, true);
    assert.equal(settlement.retainedConsequenceVisibleInSettings, true);
    assert.equal(settlement.settingsNoAutomaticClipboardAction, true);
    assert.equal(settlement.retainedConsequenceVisibleInSavedTerms, true);
    assert.equal(settlement.savedTermsNoAutomaticClipboardAction, true);
    assert.equal(settlement.undoRestoredNewerDraft, true);
    assert.equal(settlement.undoPreservedReplyConsequence, true);
    assert.equal(settlement.replyNoAutomaticClipboardAction, true);
    assert.equal(settlement.followupResultConsequenceVisible, true);
    assert.equal(settlement.manualOverwriteAcknowledgementVisible, true);
    assert.equal(settlement.manualOverwriteAcknowledged, true);
    assert.equal(settlement.acknowledgementDidNotWrite, true);
    assert.equal(settlement.clipboardWriteRequests, 2,
      'clipboard consequence fixture should perform one reply and one result write');
    assert.equal(settlement.nativeClipboardWriteStubs, 2,
      'native consequence fixture must stub both writes rather than touch the system clipboard');
    assert.ok(settlement.viewport.width >= 520,
      `expected a usable native result width, got ${settlement.viewport.width}`);
    assert.ok(settlement.viewport.height >= 600,
      `expected a usable native result height, got ${settlement.viewport.height}`);

    const clipboardTransactionProof = parseProof(
      await runFixture(clipboardTransactionRun),
      clipboardTransactionOutputPrefix,
    );
    assert.equal(
      clipboardTransactionProof.success,
      true,
      clipboardTransactionProof.error || 'dedicated clipboard transaction proof failed',
    );
    assert.equal(clipboardTransactionProof.rendererUrlExact, true);
    assert.equal(clipboardTransactionProof.userDataIsFixture, true);
    assert.equal(clipboardTransactionProof.sessionDataIsNested, true);
    assert.equal(clipboardTransactionProof.contextIsolation, true);
    assert.equal(clipboardTransactionProof.nodeIntegrationDisabled, true);
    assert.equal(clipboardTransactionProof.sandboxEnabled, true);
    assert.equal(clipboardTransactionProof.inheritedSecretsPresent, false);
    assert.equal(clipboardTransactionProof.sessionTrapFetchBlocked, true);
    assert.equal(clipboardTransactionProof.blockedCrossOriginRequests, 1,
      'dedicated clipboard transaction should issue exactly one blocked isolation probe');
    assert.deepEqual(
      clipboardTransactionProof.renderer.marker,
      { enabled: true, isolated: true },
    );
    assert.equal(clipboardTransactionProof.renderer.dataset, 'native-isolated');
    assert.equal(clipboardTransactionProof.renderer.nodeGlobalsUnavailable, true);

    const directPreloadProof = clipboardTransactionProof.preloadClipboardStub;
    assert.ok(directPreloadProof, 'dedicated launcher did not return direct preload proof');
    assert.equal(directPreloadProof.writesStubbed, true);
    assert.equal(directPreloadProof.consequenceIdsUnique, true);
    assert.equal(directPreloadProof.consequenceIdsOpaque, true);
    assert.equal(directPreloadProof.firstWriteCreatedConsequence, true);
    assert.equal(directPreloadProof.secondWriteReplacedConsequence, true);
    assert.equal(directPreloadProof.plaintextAbsentFromResponses, true);
    assert.equal(directPreloadProof.clipboardMutationApiUnavailable, true);

    const transaction = clipboardTransactionProof.transaction;
    assert.ok(transaction, 'dedicated launcher did not return renderer transaction evidence');
    assert.equal(transaction.success, true);
    assert.equal(transaction.sessionTrapFetchBlocked, true);
    assert.equal(transaction.secretTextAbsent, true);
    assert.equal(transaction.pendingReplyActionDisabled, true);
    assert.equal(transaction.pendingReplyActionBusy, true);
    assert.equal(transaction.pendingNoticeVisible, true);
    assert.equal(transaction.resultCopyDisabled, true);
    assert.equal(transaction.actionsCopyDisabled, true);
    assert.ok(Number.isSafeInteger(transaction.sourceCopyCount));
    assert.ok(transaction.sourceCopyCount >= 1,
      'dedicated journey should reach at least one official-source copy action');
    assert.equal(transaction.sourceCopiesDisabled, true);
    assert.ok(Number.isSafeInteger(transaction.savedTermCopyCount));
    assert.ok(transaction.savedTermCopyCount >= 3,
      'dedicated journey should reach every saved-term copy variant');
    assert.equal(transaction.savedTermCopiesDisabled, true);
    assert.equal(transaction.diagnosticsCopyCount, 1);
    assert.equal(transaction.diagnosticsCopyDisabled, true);
    assert.ok(Number.isSafeInteger(transaction.recoveryCopyCount));
    assert.ok(transaction.recoveryCopyCount >= 2,
      'dedicated journey should reach both recovery-command copy actions');
    assert.equal(transaction.recoveryCopiesDisabled, true);
    assert.equal(transaction.competingClicksRejected, true);
    assert.equal(transaction.writesBeforeCompetingClicks, 1);
    assert.equal(transaction.writesAfterCompetingClicks, 1);
    assert.equal(transaction.nativeWriteStubsWhilePending, 0);
    assert.equal(transaction.taskExitedBeforeSettlement, true);
    assert.equal(transaction.replyConsequenceRetainedAcrossViews, true);
    assert.equal(transaction.settingsNoAutomaticClipboardAction, true);
    assert.equal(transaction.savedTermsNoAutomaticClipboardAction, true);
    assert.equal(transaction.undoPreservedReplyConsequence, true);
    assert.equal(transaction.followupCopyReplacedPriorConsequence, true);
    assert.equal(transaction.manualOverwriteAcknowledgementVisible, true);
    assert.equal(transaction.exactConsequenceAcknowledged, true);
    assert.equal(transaction.acknowledgementDidNotWrite, true);
    assert.equal(transaction.clipboardWriteRequests, 2,
      'dedicated journey must perform exactly the reply and replacement writes');
    assert.equal(transaction.nativeClipboardWriteStubs, 2,
      'dedicated journey must keep both writes inside the in-memory native stub');
    assert.equal(networkTrap.requestCount, 0,
      'dedicated clipboard transaction reached the blocked loopback trap');

    assert.deepEqual(
      await waitForNoNewFixtureDirectories(beforeFixtureDirectories, fixtureTempRoot),
      [],
      'launcher must remove every fixture directory created by this run',
    );
    removeFixtureRuntimeTempRoot(ownedFixtureTempRoot);
    console.log('Native Electron UI fixture runtime check passed.');
  } finally {
    if (fs.existsSync(ownedFixtureTempRoot.realPath)) {
      try {
        removeFixtureRuntimeTempRoot(ownedFixtureTempRoot);
      } catch (error) {
        console.error(`Preserved unverified UI fixture runtime temp root: ${error.message}`);
      }
    }
    await networkTrap.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
