const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  UI_FIXTURE_FLAG,
  UI_FIXTURE_RENDERER_URL_ENV,
  UI_FIXTURE_USER_DATA_ENV,
  UI_FIXTURE_USER_DATA_PREFIX,
  resolveUiFixtureMode,
  sanitizeFixtureEnvironment,
  validateFixtureRendererUrl,
  validateFixtureUserDataPath,
} = require('../src/main/ui-fixture-mode');
const {
  DEFAULT_FIXTURE_PATH,
  createOwnedUserDataDirectory,
  findAvailableLoopbackPort,
  parseArguments,
  removeOwnedUserDataDirectory,
  validateRelativeFixturePath,
} = require('./run-ui-fixture');

const projectRoot = path.join(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function assertBefore(source, earlier, later, message) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assert.notEqual(earlierIndex, -1, `missing source contract: ${earlier}`);
  assert.notEqual(laterIndex, -1, `missing source contract: ${later}`);
  assert(earlierIndex < laterIndex, message);
}

function checkFixtureCheckBackgroundThrottlingContract(formalMainSource, fixtureMainSource) {
  const attachStartMarker = '  function attachToWindow(fixtureWindow, { isTextScaleNativeFixture = false } = {}) {';
  const attachEndMarker = '\n\n  return Object.freeze({\n    attachToWindow,';
  const attachStart = fixtureMainSource.indexOf(attachStartMarker);
  const attachEnd = fixtureMainSource.indexOf(attachEndMarker, attachStart);
  assert.notEqual(attachStart, -1, 'fixture module is missing its BrowserWindow attachment boundary');
  assert.notEqual(attachEnd, -1, 'fixture BrowserWindow attachment has no fixed end boundary');

  const attachSource = fixtureMainSource.slice(attachStart, attachEnd);
  const throttlingAssignment = 'if (uiFixtureCheckMode) fixtureWindow.webContents.backgroundThrottling = false;';
  assert.equal(
    (fixtureMainSource.match(/\.backgroundThrottling\s*=(?!=)/gu) || []).length,
    1,
    'the fixture module must contain exactly one background-throttling assignment',
  );
  assert.match(
    attachSource,
    /if \(uiFixtureCheckMode\) fixtureWindow\.webContents\.backgroundThrottling = false;/u,
    'only validated fixture-check mode may disable throttling on its attached webContents',
  );
  assert.doesNotMatch(
    formalMainSource,
    /\bbackgroundThrottling\b/u,
    'formal BrowserWindow construction must retain Electron background-throttling defaults',
  );
  assert.match(
    formalMainSource,
    /show: uiFixtureMode\.enabled \? !uiFixtureCheckMode : false,/u,
    'fixture-check capability must still identify the hidden fixture BrowserWindow',
  );
  assertBefore(
    attachSource,
    "throw new TypeError('UI fixture runtime requires a live BrowserWindow');",
    throttlingAssignment,
    'the fixture-check exception must follow live-window validation',
  );
  assertBefore(
    attachSource,
    throttlingAssignment,
    'registerUiFixtureRecoveryHandlers();',
    'the fixture-only exception must be established before fixture handlers attach',
  );
  assertBefore(
    formalMainSource,
    'if (app.isPackaged && uiFixtureRequested)',
    "require('../../scripts/ui-fixture-main')",
    'packaged fixture requests must fail before the excluded fixture module can load',
  );
  assert.match(
    fixtureMainSource,
    /const uiFixtureCheckMode = uiFixtureMode\.enabled\s*&& new URL\(uiFixtureMode\.rendererUrl\)\.searchParams\.get\('fixture'\) === 'check';/su,
    'the exception capability must remain derived from the validated fixture URL',
  );
}

function checkStableFrameEvidenceContract(fixtureMainSource, runtimeCheckSource) {
  const appCssSource = readProjectFile('src/renderer/App.css');
  const savedTermsCssSource = readProjectFile(
    'src/renderer/components/SavedTermsLibrary.css',
  );
  const stableWaitStart = fixtureMainSource.indexOf('const waitForStableEvidence = async (');
  const stableWaitEnd = fixtureMainSource.indexOf(
    'const readScrollPosition =',
    stableWaitStart,
  );
  const revealStart = fixtureMainSource.indexOf('const revealEvidence = async (');
  const revealEnd = fixtureMainSource.indexOf('const cssPaintIsVisible =', revealStart);
  const focusedStart = fixtureMainSource.indexOf('const focusedControlEvidence = async (');
  const focusedEnd = fixtureMainSource.indexOf('const findButton =', focusedStart);
  const alignmentStart = fixtureMainSource.indexOf('const alignTargetInScrollport = (');
  const alignmentEnd = fixtureMainSource.indexOf(
    'const pageHasNoHorizontalOverflow =',
    alignmentStart,
  );
  const manualStart = fixtureMainSource.indexOf('if (isManualClipboardReplacementRun)');
  const manualEnd = fixtureMainSource.indexOf(
    'if (isSettingsStylesheetCollisionRun)',
    manualStart,
  );
  for (const [label, start, end] of [
    ['stable-frame wait', stableWaitStart, stableWaitEnd],
    ['reveal evidence', revealStart, revealEnd],
    ['focused-control evidence', focusedStart, focusedEnd],
    ['owner-scoped scroll alignment', alignmentStart, alignmentEnd],
    ['manual clipboard evidence', manualStart, manualEnd],
  ]) {
    assert.notEqual(start, -1, `missing ${label} boundary`);
    assert.notEqual(end, -1, `missing ${label} end boundary`);
  }

  const stableWaitSource = fixtureMainSource.slice(stableWaitStart, stableWaitEnd);
  const revealSource = fixtureMainSource.slice(revealStart, revealEnd);
  const focusedSource = fixtureMainSource.slice(focusedStart, focusedEnd);
  const alignmentSource = fixtureMainSource.slice(alignmentStart, alignmentEnd);
  const manualSource = fixtureMainSource.slice(manualStart, manualEnd);
  const tinyViewportStart = appCssSource.indexOf(
    '@media (max-width: 280px), (max-height: 280px)',
  );
  const tinyViewportEnd = appCssSource.indexOf(
    '@media (prefers-reduced-motion: reduce)',
    tinyViewportStart,
  );
  assert.notEqual(tinyViewportStart, -1, 'missing ultra-narrow text-scale CSS boundary');
  assert.notEqual(tinyViewportEnd, -1, 'missing ultra-narrow text-scale CSS end boundary');
  const tinyViewportSource = appCssSource.slice(tinyViewportStart, tinyViewportEnd);
  const savedTermsTinyViewportStart = savedTermsCssSource.indexOf(
    '@media (max-width: 280px), (max-height: 280px)',
  );
  const savedTermsTinyViewportEnd = savedTermsCssSource.indexOf(
    '@media (prefers-contrast: more)',
    savedTermsTinyViewportStart,
  );
  assert.notEqual(savedTermsTinyViewportStart, -1,
    'missing deferred Saved Terms ultra-narrow CSS boundary');
  assert.notEqual(savedTermsTinyViewportEnd, -1,
    'missing deferred Saved Terms ultra-narrow CSS end boundary');
  const savedTermsTinyViewportSource = savedTermsCssSource.slice(
    savedTermsTinyViewportStart,
    savedTermsTinyViewportEnd,
  );
  assert.match(stableWaitSource, /\{ timeout = 2000, requiredFrames = 3 \} = \{\}/u,
    'stable evidence must remain bounded to two seconds and three consecutive frames');
  assert.match(stableWaitSource, /await nextFrame\(\)/u);
  assert.match(stableWaitSource, /snapshotKey === lastSnapshotKey/u);
  assert.match(stableWaitSource, /stableReadyFrames >= requiredFrames/u);
  assert.match(stableWaitSource, /activeElement: elementSnapshot\(document\.activeElement\)/u);
  assert.match(stableWaitSource, /lastSnapshot,/u,
    'stable-evidence timeouts must retain the last non-sensitive evidence snapshot');
  assert.doesNotMatch(stableWaitSource, /\.focus\(|\.click\(|scrollIntoView|scrollTo/u,
    'the stable sampler must observe rather than replay a product action');
  assert.equal((alignmentSource.match(/scrollport\.scrollTop = requestedTop/gu) || []).length, 1,
    'owner-scoped alignment must perform one deterministic vertical scroll write');
  assert.doesNotMatch(alignmentSource, /\.focus\(|\.click\(|scrollIntoView|scrollLeft\s*=/u,
    'owner-scoped alignment must not replay focus, activation, ancestor scrolling, or horizontal movement');
  assert.doesNotMatch(fixtureMainSource, /scrollIntoView/u,
    'native fixture scrolling must address the proven owner instead of ambiguous ancestor chains');

  for (const [label, source] of [
    ['reveal evidence', revealSource],
    ['focused-control evidence', focusedSource],
  ]) {
    assert.equal((source.match(/\.focus\(\{ preventScroll: true \}\)/gu) || []).length, 1,
      `${label} must focus exactly once before read-only sampling`);
    assert.doesNotMatch(source, /await delay\((?:25|50)\)/u,
      `${label} must not use fixed-delay focus or geometry samples`);
    assert.match(source, /waitForStableEvidence\(/u);
    assert.match(source, /evidence\.focused/u);
    assert.match(source, /evidence\.ringRendered/u);
  }
  assert.match(focusedSource, /evidence\.ringVisible/u,
    'focused-control sampling must require the complete rendered focus ring');
  assert.match(focusedSource, /requireFullyVisible = true/u,
    'focused controls must require whole-control visibility by default');
  assert.match(focusedSource, /requireFocusVisible = true/u,
    'focused controls must require a visible ring by default');
  assert.match(revealSource, /requireFocusVisible = true/u,
    'revealed controls must require a visible ring by default');
  assert.match(
    focusedSource,
    /!requireFocusVisible \|\| \([\s\S]*evidence\.focusVisible[\s\S]*evidence\.ringRendered/u,
    'only an explicit pointer-focus observation may omit keyboard-ring requirements',
  );
  assert.match(
    fixtureMainSource,
    /dispatchTrustedFixedText[\s\S]*revealEvidence\([\s\S]*textarea,[\s\S]*textareaScrollport,[\s\S]*label,[\s\S]*\{ requireFocusVisible: false \}/u,
    'trusted text injection must require exact focus and geometry without inventing keyboard modality',
  );
  assert.match(
    fixtureMainSource,
    /\(!requireFullyVisible \|\| evidence\.fullyVisible\)[\s\S]*\(!requireFullyVisible \|\| evidence\.ringVisible\)/u,
    'only an explicit tall-control exception may defer whole-ring visibility to split-edge proof',
  );
  assert.match(fixtureMainSource, /const readRevealEvidence = \([\s\S]*target,[\s\S]*scrollport,[\s\S]*label,[\s\S]*canFocus,[\s\S]*alignment,[\s\S]*\) => \{[\s\S]*horizontallyContained:[\s\S]*verticallyReachable:[\s\S]*fullyVisible:[\s\S]*ringVisible:[\s\S]*pageNoHorizontalOverflow:[\s\S]*scrollportNoHorizontalOverflow:[\s\S]*scrollChain: scrollChainSnapshot[\s\S]*alignment,/u,
    'stable reveal snapshots must retain every strict focus, geometry, and overflow field');
  assert.match(fixtureMainSource, /const revealGeometryReady = \(evidence\)[\s\S]*evidence\.horizontallyContained[\s\S]*evidence\.verticallyReachable[\s\S]*evidence\.pageNoHorizontalOverflow[\s\S]*evidence\.scrollportNoHorizontalOverflow/u,
    'stable reveal sampling must require a reachable, horizontally contained scroll state');
  assert.match(manualSource, /const waitForStableManualFocus = \(target, label\) => waitForStableEvidence/u);
  assert.ok((manualSource.match(/await waitForStableManualFocus\(/gu) || []).length >= 6,
    'manual clipboard decisions and return targets must use stable exact-focus observation');
  assert.doesNotMatch(
    manualSource.slice(
      manualSource.indexOf('const waitForStableManualFocus ='),
      manualSource.indexOf("const sourceInput = await waitFor("),
    ),
    /\.focus\(/u,
    'manual stable-focus observation must never repair focus itself',
  );
  assert.match(fixtureMainSource, /footerFocusEvidence,[\s\S]*outerScrollBefore,[\s\S]*outerScrollAfterFooterReveal,/u,
    'footer failures must retain per-control evidence and before/after scroll diagnostics');
  assert.match(runtimeCheckSource, /proof\.nativeWindow\.backgroundThrottlingDisabled, true/u,
    'runtime isolation checks must prove unthrottled hidden fixture frames');
  assert.match(
    tinyViewportSource,
    /\.saved-terms-drawer\s*\{[^}]*overflow-y:\s*auto/su,
    'the outer Saved Terms drawer must own tiny-viewport vertical scrolling',
  );
  assert.match(
    tinyViewportSource,
    /\.saved-terms-drawer__body\s*\{[^}]*overflow:\s*visible/su,
    'the tiny-viewport Saved Terms body must not create a nested scroll owner',
  );
  assert.match(
    savedTermsTinyViewportSource,
    /\.saved-terms-drawer \.saved-term-library\s*\{[^}]*overflow:\s*visible/su,
    'the deferred expanded tiny-viewport term list must leave focus scrolling to the eager outer drawer',
  );
  assert.match(fixtureMainSource, /drawerScrollOwnership\.singleVerticalOwner/u,
    'native evidence must prove the computed Saved Terms scroll-owner chain');
  assert.match(
    fixtureMainSource,
    /const revealDrawerEvidence = \(target, label\) => revealEvidence\([\s\S]*\{ focusBeforeAlign: true \}/u,
    'Saved Terms must transfer focus once before owner-scoped scrolling can be anchored elsewhere',
  );
  assert.match(runtimeCheckSource, /completedTerms\.scrollOwnership/u,
    'runtime acceptance must enforce the computed Saved Terms scroll-owner chain');
}

function checkOwnedFixtureClipboardContract() {
  const fixtureSources = new Map([
    ['launcher', readProjectFile('scripts/run-ui-fixture.js')],
    ['preload', readProjectFile('scripts/ui-fixture-preload.js')],
    ['static check', readProjectFile('scripts/check-electron-ui-fixture.js')],
    ['runtime check', readProjectFile('scripts/check-electron-ui-fixture-runtime.js')],
  ]);
  const retiredMarkers = Object.freeze([
    ['clear', 'Token'].join(''),
    ['clipboard:clear', '-if-matches'].join(''),
    ['data-clipboard', '-clear-action'].join(''),
    ['Clipboard', 'Clear'].join(''),
    ['clipboard', 'Clear'].join(''),
    ['expires', 'InMs'].join(''),
    ['matching', 'Clear'].join(''),
    ['matching', 'Token'].join(''),
  ]);
  for (const [label, source] of fixtureSources) {
    for (const marker of retiredMarkers) {
      assert.equal(
        source.includes(marker),
        false,
        `${label} still contains retired clipboard mutation contract ${marker}`,
      );
    }
  }

  const launcherSource = fixtureSources.get('launcher');
  const preloadSource = fixtureSources.get('preload');
  const runtimeSource = fixtureSources.get('runtime check');
  const writeStubStart = preloadSource.indexOf('function writeFixtureClipboard()');
  const writeStubEnd = preloadSource.indexOf(
    'function isCompletedResultTrustedInputFixture()',
    writeStubStart,
  );
  assert.notEqual(writeStubStart, -1, 'fixture preload is missing its in-memory write stub');
  assert.notEqual(writeStubEnd, -1, 'fixture preload write stub has no fixed boundary');
  const writeStubSource = preloadSource.slice(writeStubStart, writeStubEnd);

  assert.match(writeStubSource, /fixtureClipboardSequence \+= 1/);
  assert.match(writeStubSource, /const consequenceId = `fixture-consequence-/);
  assert.match(writeStubSource, /replacedPrevious/);
  assert.doesNotMatch(writeStubSource, /\b(?:input|payload|text|value)\b/iu,
    'the preload write stub must not retain or echo copied plaintext');
  assert.match(preloadSource, /function hasNoAutomaticClipboardAction\(notice\)/);
  assert.match(preloadSource, /\[data-clipboard-consequence-ack\]/);
  for (const proofField of [
    'pendingReplyActionDisabled',
    'resultCopyDisabled',
    'actionsCopyDisabled',
    'sourceCopiesDisabled',
    'savedTermCopiesDisabled',
    'diagnosticsCopyDisabled',
    'recoveryCopiesDisabled',
    'competingClicksRejected',
    'writesBeforeCompetingClicks',
    'writesAfterCompetingClicks',
    'nativeWriteStubsWhilePending',
    'taskExitedBeforeSettlement',
    'replyConsequenceRetainedAcrossViews',
    'settingsNoAutomaticClipboardAction',
    'savedTermsNoAutomaticClipboardAction',
    'undoPreservedReplyConsequence',
    'followupCopyReplacedPriorConsequence',
    'manualOverwriteAcknowledgementVisible',
    'exactConsequenceAcknowledged',
    'acknowledgementDidNotWrite',
    'clipboardWriteRequests',
    'nativeClipboardWriteStubs',
  ]) {
    assert.match(preloadSource, new RegExp(`\\b${proofField}\\b`, 'u'),
      `dedicated clipboard transaction journey is missing ${proofField}`);
    assert.match(runtimeSource, new RegExp(`\\b${proofField}\\b`, 'u'),
      `runtime gate is missing dedicated transaction field ${proofField}`);
  }

  for (const directProofField of [
    'writesStubbed',
    'consequenceIdsUnique',
    'consequenceIdsOpaque',
    'firstWriteCreatedConsequence',
    'secondWriteReplacedConsequence',
    'plaintextAbsentFromResponses',
    'clipboardMutationApiUnavailable',
  ]) {
    assert.match(launcherSource, new RegExp(`\\b${directProofField}\\b`, 'u'),
      `launcher direct preload proof is missing ${directProofField}`);
    assert.match(runtimeSource, new RegExp(`\\b${directProofField}\\b`, 'u'),
      `runtime gate is missing ${directProofField}`);
  }
  assert.match(runtimeSource, /clipboard-app-transaction-native/);
  assert.match(runtimeSource, /__SLIPSTREAM_UI_FIXTURE_CLIPBOARD_TRANSACTION__/);
}

function checkRendererUrls() {
  const validUrls = [
    'http://127.0.0.1:49152/?demo=capture&backend=openai&connection=slow',
    'http://127.0.0.1:49153/?demo=result&run=fixture',
    'http://127.0.0.1:49154/?demo=setup&credentialDelete=once',
    'http://127.0.0.1:49155/?demo=setup&fixture=check&trapPort=49156',
    'http://127.0.0.1:49175/?demo=setup&fixture=check&trapPort=49176&run=first-use-capture-text-scale-native',
    'http://127.0.0.1:49177/?demo=result&terms=sample&fixture=check&trapPort=49178&run=completed-result-text-scale-native',
    'http://127.0.0.1:49183/?demo=result&terms=sample&fixture=check&trapPort=49184&run=guided-reply-text-scale-native',
    'http://127.0.0.1:49187/?demo=result&terms=sample&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49189/?demo=result&terms=sample&fixture=check&trapPort=49190&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49201/?demo=result&terms=sample&run=result-stylesheet-recovery-native',
    'http://127.0.0.1:49203/?demo=result&terms=sample&fixture=check&trapPort=49204&run=result-stylesheet-recovery-native',
    'http://127.0.0.1:49205/?demo=result&terms=sample&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49207/?demo=result&terms=sample&quit=5000&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49213/?demo=result&terms=sample&quit=20000&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49209/?demo=result&terms=sample&activeCapture=settings-screenshot&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49211/?demo=result&terms=sample&activeCapture=fixture-screenshot&quit=fixture&fixture=check&trapPort=49212&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49179/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49180&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49181/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49157/?demo=result&terms=sample&connection=unreachable&clipboard=write-slow&fixture=check&trapPort=49158&run=reply-copy-settlement-native',
    'http://127.0.0.1:49159/?demo=result&terms=sample&connection=unreachable&clipboard=write-slow&fixture=check&trapPort=49160&run=clipboard-app-transaction-native',
    'http://127.0.0.1:49161/?demo=capture&backend=openai&activeCapture=source-edit-transition&fixture=check&trapPort=49162&run=option-c-edit-transition-native',
    'http://127.0.0.1:49165/?demo=capture&backend=deepseek&monitor=on&runtime=all&fixture=check&trapPort=49166&run=runtime-degraded-native',
    'http://127.0.0.1:49167/?demo=setup&settings=corrupt-json&startupRecovery=archive-success&fixture=check&trapPort=49168&run=startup-recovery-native',
    'http://127.0.0.1:49169/?demo=capture&backend=deepseek&connection=unreachable-once&fixture=check&trapPort=49170&run=provider-retry-native',
    'http://127.0.0.1:49185/?demo=capture&backend=deepseek&save=prompt-twice&fixture=check&trapPort=49186&run=settings-prompt-draft-recovery-native',
    'http://127.0.0.1:49171/?demo=result&backend=deepseek&process=replacement-source-once&fixture=check&trapPort=49172&run=failed-source-retry-native',
    'http://127.0.0.1:49173/?demo=capture&backend=deepseek&rendererRecovery=clipboard-residue&fixture=check&trapPort=49174&run=clipboard-residue-recovery-native',
    'http://127.0.0.1:49191/?demo=capture&backend=deepseek&fixture=check&trapPort=49192&run=manual-clipboard-replacement-native',
  ];
  for (const url of validUrls) assert.equal(validateFixtureRendererUrl(url), url);

  for (const url of [
    'http://localhost:49152/?demo=capture',
    'HTTP://127.0.0.1:49152/?demo=capture',
    'http://127.1:49152/?demo=capture',
    'http://127.0.0.1:49152?demo=capture',
    'http://127.0.0.1:49152/?demo=%63apture',
    'http://127.0.0.2:49152/?demo=capture',
    'https://127.0.0.1:49152/?demo=capture',
    'http://127.0.0.1:80/?demo=capture',
    'http://127.0.0.1/?demo=capture',
    'http://127.0.0.1:49152/nested?demo=capture',
    'http://user:password@127.0.0.1:49152/?demo=capture',
    'http://127.0.0.1:49152/?demo=capture#private',
    'http://127.0.0.1:49152/?demo=unknown',
    'http://127.0.0.1:49152/?backend=openai',
    'http://127.0.0.1:49152/?demo=capture&demo=result',
    'http://127.0.0.1:49152/?demo=capture&backend=openai&backend=ollama',
    'http://127.0.0.1:49152/?demo=capture&apiKey=private',
    'http://127.0.0.1:49152/?demo=capture&token=private',
    'http://127.0.0.1:49152/?demo=capture&unknown=value',
    'http://127.0.0.1:49152/?demo=capture&runtime=unknown',
    'http://127.0.0.1:49152/?demo=capture&runtime=%7B%22trayAvailable%22%3Afalse%7D',
    'http://127.0.0.1:49152/?demo=setup&startupRecovery=unknown',
    'http://127.0.0.1:49152/?demo=capture&connection=unreachable-oncee',
    'http://127.0.0.1:49152/?demo=capture&run=arbitrary-native-run',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&fixture=check&trapPort=49153&run=settings-prompt-draft-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&save=credential-once&fixture=check&trapPort=49153&run=settings-prompt-draft-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&save=once&fixture=check&trapPort=49153&run=settings-prompt-draft-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&save=prompt-twice&quit=2500&fixture=check&trapPort=49153&run=settings-prompt-draft-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&fixture=check&trapPort=49153&run=first-use-capture-text-scale-native',
    'http://127.0.0.1:49152/?demo=setup&backend=deepseek&fixture=check&trapPort=49153&run=first-use-capture-text-scale-native',
    'http://127.0.0.1:49152/?demo=result&fixture=check&trapPort=49153&run=completed-result-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&terms=sample&fixture=check&trapPort=49153&run=completed-result-text-scale-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&backend=deepseek&fixture=check&trapPort=49153&run=completed-result-text-scale-native',
    'http://127.0.0.1:49152/?demo=result&fixture=check&trapPort=49153&run=guided-reply-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&terms=sample&fixture=check&trapPort=49153&run=guided-reply-text-scale-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&backend=deepseek&fixture=check&trapPort=49153&run=guided-reply-text-scale-native',
    'http://127.0.0.1:49152/?demo=result&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&terms=sample&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&backend=deepseek&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49152/?terms=sample&demo=result&run=lazy-workspace-recovery-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&run=lazy-workspace-recovery-native&fixture=check&trapPort=49153',
    'http://127.0.0.1:49152/?demo=result&terms=sample&fixture=check&trapPort=49153&run=lazy-workspace-recovery-native&settings=once',
    'http://127.0.0.1:49152/?demo=result&run=result-stylesheet-recovery-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&run=result-stylesheet-recovery-native&fixture=check&trapPort=49153',
    'http://127.0.0.1:49152/?demo=result&terms=sample&fixture=check&trapPort=49153&run=result-stylesheet-recovery-native&settings=once',
    'http://127.0.0.1:49152/?demo=result&terms=sample&activeCapture=fixture-screenshot&fixture=check&trapPort=49153&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&quit=fixture&fixture=check&trapPort=49153&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&activeCapture=settings-screenshot&quit=fixture&fixture=check&trapPort=49153&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49152/?demo=result&terms=sample&quit=5000&activeCapture=settings-screenshot&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49152/?terms=sample&demo=result&run=settings-stylesheet-collision-native',
    'http://127.0.0.1:49152/?demo=capture&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=ollama&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=off&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=clipboard-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&process=slow&shortcut=both-conflict&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&terms=sample&fixture=check&trapPort=49153&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&rendererRecovery=clipboard-residue&activeCapture=foreground-screenshot&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot&rendererRecovery=clipboard-residue&terms=sample&run=stacked-status-text-scale-native',
    'http://127.0.0.1:49152/?demo=capture&runtime=all&runtime=tray-unavailable',
    'http://127.0.0.1:49152/?demo=setup&settings=corrupt-json&startupRecovery=archive-success&startupRecovery=archive-success',
    'http://127.0.0.1:49152/?demo=capture&settings=corrupt-json&startupRecovery=archive-success',
    'http://127.0.0.1:49152/?demo=setup&settings=fail&startupRecovery=archive-success',
    'http://127.0.0.1:49152/?demo=setup&startupRecovery=archive-success',
    'http://127.0.0.1:49152/?demo=capture&rendererRecovery=unknown',
    'http://127.0.0.1:49152/?demo=capture&rendererRecovery=clipboard-residue',
    'http://127.0.0.1:49152/?demo=result&rendererRecovery=clipboard-residue&fixture=check&trapPort=49153&run=clipboard-residue-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&fixture=check&trapPort=49153&run=clipboard-residue-recovery-native',
    'http://127.0.0.1:49152/?demo=capture&fixture=sk-abcdefghijklmnopqrstuvwxyz',
    'http://127.0.0.1:49152/?demo=capture&run=Bearer+abcdefghijklmnopqrst',
    'http://127.0.0.1:49152/?demo=capture&fixture=-----BEGIN+PRIVATE+KEY-----',
    'http://127.0.0.1:49152/?demo=setup&fixture=unknown',
    'http://127.0.0.1:49152/?demo=setup&fixture=check',
    'http://127.0.0.1:49152/?demo=setup&trapPort=49153',
    'http://127.0.0.1:49152/?demo=setup&fixture=check&trapPort=49152',
    'http://127.0.0.1:49152/?demo=setup&fixture=check&trapPort=049153',
    'http://127.0.0.1:49152/?demo=setup&fixture=check&trapPort=80',
    'http://127.0.0.1:49152/?demo=setup&fixture=check&trapPort=65536',
  ]) {
    assert.throws(() => validateFixtureRendererUrl(url), `expected unsafe fixture URL to fail: ${url}`);
  }
}

function checkUserDataAndResolver() {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-ui-fixture-check-'));
  const fixtureDirectory = fs.mkdtempSync(path.join(testRoot, UI_FIXTURE_USER_DATA_PREFIX));
  const wrongPrefixDirectory = fs.mkdtempSync(path.join(testRoot, 'arbitrary-user-data-'));
  fs.chmodSync(fixtureDirectory, 0o700);
  fs.chmodSync(wrongPrefixDirectory, 0o700);

  try {
    const expectedPath = fs.realpathSync(fixtureDirectory);
    assert.equal(validateFixtureUserDataPath(fixtureDirectory, { tempRoot: testRoot }), expectedPath);
    assert.throws(() => validateFixtureUserDataPath('relative-user-data', { tempRoot: testRoot }));
    assert.throws(() => validateFixtureUserDataPath(testRoot, { tempRoot: testRoot }));
    assert.throws(() => validateFixtureUserDataPath(wrongPrefixDirectory, { tempRoot: testRoot }));
    assert.throws(() => validateFixtureUserDataPath(path.join(testRoot, `${UI_FIXTURE_USER_DATA_PREFIX}ABC123`), {
      tempRoot: testRoot,
    }));

    if (process.platform !== 'win32') {
      const symlinkPath = path.join(testRoot, `${UI_FIXTURE_USER_DATA_PREFIX}SYM123`);
      fs.symlinkSync(fixtureDirectory, symlinkPath);
      assert.throws(() => validateFixtureUserDataPath(symlinkPath, { tempRoot: testRoot }));
    }

    const environment = {
      [UI_FIXTURE_RENDERER_URL_ENV]: 'http://127.0.0.1:49152/?demo=capture',
      [UI_FIXTURE_USER_DATA_ENV]: fixtureDirectory,
    };
    for (const argv of [[], ['electron', '.'], ['electron', '.', '--dev']]) {
      const disabled = resolveUiFixtureMode({ argv, env: {}, isPackaged: false, tempRoot: testRoot });
      assert.deepEqual(disabled, { enabled: false });
      assert(Object.isFrozen(disabled));
    }

    const enabled = resolveUiFixtureMode({
      argv: ['electron', '.', '--dev', UI_FIXTURE_FLAG],
      env: environment,
      isPackaged: false,
      tempRoot: testRoot,
    });
    assert.deepEqual(enabled, {
      enabled: true,
      userDataPath: expectedPath,
      rendererUrl: environment[UI_FIXTURE_RENDERER_URL_ENV],
    });
    assert(Object.isFrozen(enabled));

    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', UI_FIXTURE_FLAG], env: environment, isPackaged: false, tempRoot: testRoot,
    }), /both --dev and --ui-fixture/);
    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', '--dev'], env: environment, isPackaged: false, tempRoot: testRoot,
    }), /both --dev and --ui-fixture/);
    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', '--dev', UI_FIXTURE_FLAG],
      env: { [UI_FIXTURE_RENDERER_URL_ENV]: environment[UI_FIXTURE_RENDERER_URL_ENV] },
      isPackaged: false,
      tempRoot: testRoot,
    }), /complete launcher environment/);
    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', '--dev', UI_FIXTURE_FLAG], env: environment, isPackaged: true, tempRoot: testRoot,
    }), /unavailable in packaged builds/);
    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', '--dev'],
      env: { SLIPSTREAM_DEMO_RESULT: '0' },
      isPackaged: false,
      tempRoot: testRoot,
    }), /dev:ui-fixture/);

    fs.writeFileSync(path.join(fixtureDirectory, 'preseeded-settings.json'), '{}');
    assert.throws(() => resolveUiFixtureMode({
      argv: ['electron', '.', '--dev', UI_FIXTURE_FLAG], env: environment, isPackaged: false, tempRoot: testRoot,
    }), /must be unused/);
    fs.rmSync(path.join(fixtureDirectory, 'preseeded-settings.json'));

    if (process.platform !== 'win32') {
      fs.chmodSync(fixtureDirectory, 0o755);
      assert.throws(() => resolveUiFixtureMode({
        argv: ['electron', '.', '--dev', UI_FIXTURE_FLAG], env: environment, isPackaged: false, tempRoot: testRoot,
      }), /group or other users/);
      fs.chmodSync(fixtureDirectory, 0o700);
    }
  } finally {
    fs.rmSync(testRoot, { force: true, recursive: true });
  }
}

function checkEnvironmentSanitization() {
  const original = Object.freeze({
    PATH: '/usr/bin',
    HOME: '/tmp/example-home',
    LANG: 'en_GB.UTF-8',
    [UI_FIXTURE_RENDERER_URL_ENV]: 'http://127.0.0.1:49152/?demo=capture',
    [UI_FIXTURE_USER_DATA_ENV]: '/tmp/example-fixture',
    OPENAI_API_KEY: 'private',
    GITHUB_TOKEN: 'private',
    CLIENT_SECRET: 'private',
    ACCOUNT_PASSWORD: 'private',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/private.json',
    SSH_PRIVATE_KEY: 'private',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    NODE_OPTIONS: '--require=/tmp/untrusted.js',
    NODE_PATH: '/tmp/untrusted-modules',
    ELECTRON_RUN_AS_NODE: '1',
    DYLD_INSERT_LIBRARIES: '/tmp/untrusted.dylib',
    LD_PRELOAD: '/tmp/untrusted.so',
  });
  const sanitized = sanitizeFixtureEnvironment(original);
  assert.deepEqual(sanitized, {
    PATH: original.PATH,
    HOME: original.HOME,
    LANG: original.LANG,
    [UI_FIXTURE_RENDERER_URL_ENV]: original[UI_FIXTURE_RENDERER_URL_ENV],
    [UI_FIXTURE_USER_DATA_ENV]: original[UI_FIXTURE_USER_DATA_ENV],
  });
  assert(Object.isFrozen(sanitized));
  assert.equal(original.OPENAI_API_KEY, 'private', 'sanitization must not mutate its input');
}

function checkStackedStatusTextScaleContract() {
  const fixtureModeSource = readProjectFile('src/main/ui-fixture-mode.js');
  const mainSource = readProjectFile('scripts/ui-fixture-main.js');
  const runtimeSource = readProjectFile('scripts/check-electron-ui-fixture-runtime.js');
  const floatingPanelSource = readProjectFile('src/renderer/components/FloatingPanel.jsx');
  const appCssSource = readProjectFile('src/renderer/App.css');
  const run = 'stacked-status-text-scale-native';
  const wideShortStart = mainSource.indexOf(
    "if (fixtureRun === 'stacked-status-text-scale-native')",
  );
  const wideShortEnd = mainSource.indexOf(
    '    let sessionTrapFetchBlocked = false;',
    wideShortStart,
  );
  assert.notEqual(wideShortStart, -1, 'missing wide-short native proof boundary');
  assert.notEqual(wideShortEnd, -1, 'missing wide-short native proof end boundary');
  const wideShortSource = mainSource.slice(wideShortStart, wideShortEnd);
  const fixedScenario = '?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict'
    + '&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot'
    + '&rendererRecovery=clipboard-residue'
    + '&fixture=check&trapPort=${trapPort}&run=${run}';

  assert.match(fixtureModeSource, new RegExp(`'${run}'`, 'u'),
    'fixture mode must whitelist the dedicated stacked-status native run');
  assert.match(
    fixtureModeSource,
    /const fixedBusinessSearch = '\?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict'/u,
    'fixture mode must define the fixed stacked-status business scenario',
  );
  assert.match(fixtureModeSource, /&rendererRecovery=clipboard-residue/u);
  assert.match(fixtureModeSource, /const expectedCheckSearch = `\$\{fixedBusinessSearch\}&fixture=check&trapPort=\$\{trapPortValue\}`/u);
  assert.match(fixtureModeSource, /const expectedPreviewSearch = `\$\{fixedBusinessSearch\}&run=stacked-status-text-scale-native`/u);
  assert.match(fixtureModeSource, /if \(!isFixedCheck && !isFixedPreview\)/u,
    'stacked-status URL validation must accept only canonical check and preview scenarios');

  assert.match(floatingPanelSource, /className=\{`slipstream-shell\$\{[^`]*has-foreground-status/s,
    'FloatingPanel must identify the shell that owns foreground-status scrolling');
  assert.match(floatingPanelSource, /className="foreground-status-center"/u,
    'FloatingPanel must group the four simultaneous statuses in one semantic center');
  assert.match(floatingPanelSource, /data-pending-capture-count=/u);
  assert.match(floatingPanelSource, /data-operational-status-count=/u);
  assert.match(
    floatingPanelSource,
    /const panelOwnsClipboardResidueRisk = Boolean\(\s*visible\s*&& clipboardResidueRisk\s*&& !pendingSessionRecovery\s*&& onAcknowledgeClipboardResidueRisk/s,
    'hidden panels must not steal clipboard-residue recovery ownership or focus',
  );
  assert.match(
    floatingPanelSource,
    /const hasForegroundWarning = pendingCaptureStatusCount > 0\s*\|\| Boolean\(shortcutReadinessCopy\)\s*\|\| Boolean\(clipboardMonitoringStopError\)\s*\|\| hasRuntimeAlerts/s,
    'foreground summary warning semantics must include capture, shortcut, monitor-stop, and runtime failures',
  );
  assertBefore(
    floatingPanelSource,
    '{panelOwnsClipboardResidueRisk && (',
    '<header className="app-header">',
    'clipboard residue recovery must precede the header and status center',
  );
  assertBefore(
    floatingPanelSource,
    'is-screenshot-request',
    'clipboard-monitor-queue__preview',
    'pending screenshot status must precede pending clipboard status',
  );
  assertBefore(
    floatingPanelSource,
    'clipboard-monitor-queue__preview',
    'shortcut-readiness-alert',
    'pending clipboard status must precede shortcut readiness',
  );
  assertBefore(
    floatingPanelSource,
    'shortcut-readiness-alert',
    'clipboard-monitoring-live',
    'shortcut readiness must precede monitoring status',
  );
  assert.match(appCssSource, /\.slipstream-shell\.has-foreground-status\s*\{[^}]*overflow-y:\s*auto/s,
    'the status-bearing shell must own the single page-level vertical scroll');
  assert.match(appCssSource, /\.foreground-status-center\s*\{/u,
    'the status center needs an explicit grouping layout');
  assert.match(appCssSource, /@media \(max-width: 280px\), \(max-height: 280px\)/u,
    'shared foreground scrolling must cover both narrow and wide-short 200% viewports');

  assert.match(mainSource, new RegExp(`=== '${run}'`, 'u'));
  assert.match(mainSource, /setContentSize\(400, 400\)/u);
  assert.match(mainSource, /setZoomFactor\(2\)/u);
  assert.match(wideShortSource, /const waitForStableEvidence = async \(read, ready, label\)/u,
    'the separate wide-short renderer evaluation must own its stable-frame sampler');
  assert.match(wideShortSource, /const deadline = Date\.now\(\) \+ 2000/u);
  assert.match(wideShortSource, /if \(stableFrames >= 3\) return snapshot/u);
  assert.match(wideShortSource, /const waitForStableScrollPosition = \(scrollport, top, label\)/u);
  assert.match(wideShortSource, /const revealEvidence = async \(/u,
    'the separate wide-short renderer evaluation must own its reveal observer');
  assert.match(
    mainSource,
    /\.foreground-status-center\[data-pending-capture-count="2"\]\[data-operational-status-count="2"\]/u,
    'native main-process proof must wait for all four simultaneous statuses',
  );
  for (const proofField of [
    'shellIsOnlyVerticalScrollOwner',
    'statusCenterIsNotScrollable',
    'statusDomPriorityCorrect',
    'wholeFlowDomPriorityCorrect',
    'keyboardPriorityCorrect',
    'flowDoesNotOverlap',
    'actionPairsDoNotOverlap',
    'actionsDoNotOverlapCardCopy',
    'allPassiveContentReachable',
    'allEnabledActionsFocusVisible',
    'allDisabledActionsReachable',
    'regionsHaveNoHorizontalOverflow',
    'regionsHorizontallyContained',
    'applicationIpcRejected',
    'fixtureClipboardStubbed',
    'residueBeforeHeader',
    'residueDoesNotOverlapHeader',
    'residueAcknowledged',
    'recoveryFocusInitiallyOwned',
    'recoveryFocusEvidenceComplete',
    'screenshotTitleFocusEvidence',
    'preAckAllStatusesMounted',
    'preAckCountsMatch',
    'postProcessFourStatusesRetained',
    'processingStartedFromSafeSample',
  ]) {
    assert.match(mainSource, new RegExp(`\\b${proofField}\\b`, 'u'),
      `native stacked-status proof is missing ${proofField}`);
    assert.match(runtimeSource, new RegExp(`\\b${proofField}\\b`, 'u'),
      `runtime stacked-status gate is missing ${proofField}`);
  }
  assert.match(runtimeSource, new RegExp(fixedScenario.replace(/[?${}]/gu, '\\$&'), 'u'),
    'runtime launcher must use the exact fixed stacked-status collision URL');
  assert.match(runtimeSource, /pendingCaptureCount:\s*2/u);
  assert.match(runtimeSource, /operationalStatusCount:\s*2/u);
  assert.match(runtimeSource, /statusCardCount:\s*4/u);
  assert.match(runtimeSource, /actionCount:\s*6/u);
  assert.match(runtimeSource, /processRequests:\s*1/u);
  assert.match(runtimeSource, /screenshotCaptureRequests:\s*0/u);
  assert.match(runtimeSource, /clipboardWriteRequests:\s*0/u);
  assert.match(runtimeSource, /nativeClipboardWriteStubs:\s*0/u);
  assert.match(runtimeSource, /acknowledgedRisks:\s*1/u);
  assert.match(runtimeSource, /rendererReloads:\s*0/u);
  for (const wideShortField of [
    'stackedStatusWideShort',
    'shellIsOnlyVerticalScrollOwner',
    'statusCenterIsNotScrollable',
    'allPassiveContentReachable',
    'allEnabledActionsFocusVisible',
    'allDisabledActionsReachable',
    'fourStatusesRetained',
    'restoredBaseline',
  ]) {
    assert.match(mainSource, new RegExp(`\\b${wideShortField}\\b`, 'u'),
      `wide-short native proof is missing ${wideShortField}`);
    assert.match(runtimeSource, new RegExp(`\\b${wideShortField}\\b`, 'u'),
      `wide-short runtime gate is missing ${wideShortField}`);
  }
}

function checkLazyWorkspaceRecoveryContract() {
  const fixtureModeSource = readProjectFile('src/main/ui-fixture-mode.js');
  const formalMainSource = readProjectFile('src/main/main.js');
  const mainSource = readProjectFile('scripts/ui-fixture-main.js');
  const runtimeSource = readProjectFile('scripts/check-electron-ui-fixture-runtime.js');
  const viteSource = readProjectFile('vite.config.js');
  const appSource = readProjectFile('src/renderer/App.jsx');
  const floatingPanelSource = readProjectFile('src/renderer/components/FloatingPanel.jsx');
  const recoverySource = readProjectFile(
    'src/renderer/components/LazyWorkspaceRecovery.jsx',
  );
  const runs = [
    'lazy-workspace-recovery-native',
    'result-stylesheet-recovery-native',
  ];

  for (const run of runs) {
    assert.match(fixtureModeSource, new RegExp(`'${run}'`, 'u'),
      `fixture mode must whitelist the dedicated ${run} run`);
  }
  assert.match(
    fixtureModeSource,
    /const fixedBusinessSearch = '\?demo=result&terms=sample';[\s\S]*expectedCheckSearch[\s\S]*expectedPreviewSearch/,
    'lazy recovery must bind to canonical sample-result check and preview URLs',
  );
  assert.match(
    fixtureModeSource,
    /UI fixture workspace recovery requires the fixed sample result check or preview scenario/,
  );

  for (const source of [appSource, floatingPanelSource]) {
    assert.match(source, /lazy-workspace-recovery-native/u,
      'each lazy workspace loader must bind its rejection to the dedicated run query');
    assert.doesNotMatch(source, /searchParams\.get\('workspaceFailure'\)/u,
      'lazy workspace injection must not add an unvalidated fixture query capability');
  }
  assert.match(floatingPanelSource, /result-stylesheet-recovery-native/u,
    'the Result loader must bind the stylesheet failure to its separate dedicated run');
  assert.match(appSource,
    /WORKSPACE_RECOVERY_FIXTURE[\s\S]*result-stylesheet-recovery-native/u,
    'Settings must remain part of the Result stylesheet recovery journey');
  assert.match(appSource, /settings-style-fixture-primary/u,
    'the stylesheet journey must fail the Settings stylesheet rather than its JS chunk');
  assert.match(appSource,
    /settings-style-retry&workspace-attempt=1/u,
    'the Settings retry module must select the single finite stylesheet retry attempt');
  assert.match(viteSource,
    /const SETTINGS_STYLESHEET_FIXTURE_LOAD = 'settings-style-fixture-primary'/u);
  assert.match(viteSource,
    /RESULT_STYLESHEET_FIXTURE_LOADS = new Set\(\[[\s\S]*SETTINGS_STYLESHEET_FIXTURE_LOAD[\s\S]*RESULT_STYLESHEET_FIXTURE_LOAD/u,
    'the combined stylesheet fixture must reject Result and Settings CSS only');
  assert.match(viteSource,
    /\[SETTINGS_STYLESHEET_FIXTURE_LOAD\]: '\/components\/SettingsPanel\.css'/u);
  assert.match(formalMainSource,
    /const isResultStylesheetRecoveryTextScaleFixture = fixtureRun\s*=== 'result-stylesheet-recovery-native'/u,
    'the combined stylesheet recovery journey must use the exact text-scale viewport');
  assert.match(recoverySource, /data-workspace-load-failure=/u);
  assert.match(recoverySource, /data-workspace-retry/u);
  assert.match(recoverySource, /data-workspace-return/u,
    'Settings lazy failure must expose a safe return to the preserved result');

  assert.match(runtimeSource, /const lazyWorkspaceRecoveryRun = 'lazy-workspace-recovery-native'/u);
  assert.match(runtimeSource,
    /const resultStylesheetRecoveryRun = 'result-stylesheet-recovery-native'/u);
  assert.match(
    runtimeSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/u,
    'runtime launcher must use the exact fixed lazy recovery check URL',
  );
  assert.match(mainSource, /const isLazyWorkspaceRecoveryRun = fixtureRun\s*=== 'lazy-workspace-recovery-native'/u);
  assert.match(mainSource,
    /const isResultStylesheetRecoveryRun = fixtureRun\s*=== 'result-stylesheet-recovery-native'/u);
  assert.match(mainSource,
    /const isWorkspaceRecoveryRun = isLazyWorkspaceRecoveryRun\s*\|\| isResultStylesheetRecoveryRun/u);
  assert.match(mainSource, /\[data-workspace-load-failure="result"\]/u);
  assert.match(mainSource, /\[data-workspace-load-failure="settings"\]/u);
  for (const field of [
    'mainNamed',
    'mainRolePreserved',
    'alertWithinMain',
    'focusOwned',
    'exactRetryFocus',
    'retryFocusEvidence',
    'focusEvidence',
    'retryActionVisible',
    'returnActionVisible',
    'preservedResultUnchanged',
    'restoredSampleResult',
    'settingsWriteRequests',
    'sameResult',
    'sameDocument',
    'noReload',
    'externalResourceRequestCount',
    'resultStylesheet',
    'settingsStylesheet',
    'dedicatedRuleLoaded',
    'privateRuleLoaded',
    'primaryRequestCount',
    'retryRequestCount',
    'unstyledFrameObserved',
    'primaryFailureInjected',
    'usedQueriedRetry',
    'urlUnchanged',
    'timeOriginUnchanged',
    'sideEffectRequests',
    'exactViewport',
    'nativeKeyboardModalityPrimed',
    'initialRetryFocusOwned',
  ]) {
    assert.match(mainSource, new RegExp(`\\b${field}\\b`, 'u'),
      `native lazy recovery proof is missing ${field}`);
    assert.match(runtimeSource, new RegExp(`\\b${field}\\b`, 'u'),
      `runtime lazy recovery gate is missing ${field}`);
  }
}

function checkSettingsStylesheetCollisionContract() {
  const fixtureModeSource = readProjectFile('src/main/ui-fixture-mode.js');
  const formalMainSource = readProjectFile('src/main/main.js');
  const fixtureMainSource = readProjectFile('scripts/ui-fixture-main.js');
  const preloadSource = readProjectFile('scripts/ui-fixture-preload.js');
  const runtimeSource = readProjectFile('scripts/check-electron-ui-fixture-runtime.js');
  const viteSource = readProjectFile('vite.config.js');
  const appSource = readProjectFile('src/renderer/App.jsx');
  const ipcSource = readProjectFile('src/renderer/hooks/useIpc.js');
  const run = 'settings-stylesheet-collision-native';

  for (const source of [
    fixtureModeSource,
    formalMainSource,
    fixtureMainSource,
    preloadSource,
    runtimeSource,
    viteSource,
    appSource,
    ipcSource,
  ]) {
    assert.match(source, new RegExp(run, 'u'),
      `Settings stylesheet collision contract is missing ${run}`);
  }
  assert.match(
    fixtureModeSource,
    /expectedCheckSearch[\s\S]*activeCapture=fixture-screenshot[\s\S]*quit=fixture[\s\S]*allowedPreviewSearches/,
    'Settings collision URLs must remain closed check and preview capabilities',
  );
  assert.match(
    runtimeSource,
    /\?demo=result&terms=sample&activeCapture=fixture-screenshot&quit=fixture&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/u,
    'runtime launcher must use the canonical Settings collision check URL',
  );
  assert.match(
    preloadSource,
    /else if \(isSettingsStylesheetCollisionTrustedInputFixture\(\)\) \{[\s\S]*?keyPress: \(step, key\)[\s\S]*?\n\}/u,
    'preload must expose only the validated key bridge to the Settings collision run',
  );
  assert.match(
    fixtureMainSource,
    /settingsStylesheetCollisionExpectedInputSteps[\s\S]*step: 1, kind: 'key', key: 'Escape'/u,
    'Settings collision must allow exactly one native Escape input step',
  );
  assert.match(
    formalMainSource,
    /isSettingsStylesheetCollisionTextScaleFixture[\s\S]*\|\| isSettingsStylesheetCollisionTextScaleFixture[\s\S]*const fixtureWidth = isTextScaleNativeFixture\s*\? 400[\s\S]*const fixtureHeight = isTextScaleNativeFixture\s*\? 400/u,
    'Settings collision must select the exact native 400x400 text-scale window',
  );
  assert.match(
    fixtureMainSource,
    /if \(isTextScaleNativeFixture\) \{\s*fixtureWindow\.setContentSize\(400, 400\);\s*fixtureWindow\.webContents\.setZoomFactor\(2\);/u,
    'the attached Settings collision window must use 200 percent zoom',
  );
  for (const endpoint of [
    'settings-stylesheet-collision/arm',
    'settings-stylesheet-collision/release',
    'settings-stylesheet-collision/state',
  ]) {
    assert.match(viteSource, new RegExp(endpoint, 'u'),
      `Settings collision gate is missing ${endpoint}`);
  }
  assert.match(viteSource, /SETTINGS_STYLESHEET_COLLISION_WATCHDOG_MS = 12_000/u);
  assert.match(viteSource,
    /SETTINGS_STYLESHEET_COLLISION_PREVIEW_WATCHDOG_MS = 40_000/u);
  assert.match(viteSource, /manualReleaseCount/u);
  assert.match(viteSource, /watchdogReleaseCount/u);
  assert.match(viteSource, /failureCount/u);
  assert.match(
    viteSource,
    /url\.searchParams\.get\('run'\) !== SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN[\s\S]*resetSettingsCollisionGate\(\)/u,
    'leaving the Settings collision document must release its bounded held response',
  );
  assert.match(
    appSource,
    /deferredFromSettingsWorkspace:[\s\S]*!settingsWorkspaceReadyRef\.current/u,
  );
  assert.match(
    appSource,
    /quitRequestIdRef\.current\s*\|\| quitDecisionRef\.current/u,
    'deferred takeover must respect both synchronous App Quit mutexes',
  );
  assert.match(
    appSource,
    /confirmQuitRequestAutomatically[\s\S]*setSettingsCaptureRequest\(null\);\s*setApprovedSettingsCapture\(null\);[\s\S]{0,180}?clearCurrentQuitRequest/u,
    'automatic confirmed quit must drop deferred and approved capture intent',
  );
  assert.match(ipcSource, /demoActiveCaptureEventsCode !== 'fixture-screenshot'/u);
  assert.match(ipcSource, /slipstream:fixture-screenshot-request/u);

  for (const field of [
    'settingsStylesheetCollision',
    'quitOverLoading',
    'failureUnderQuit',
    'truthfulResultConsequence',
    'trustedEscape',
    'backgroundRestored',
    'queuedUnderQuit',
    'captureTakeover',
    'retryNoReplay',
    'settingsStayedVisible',
    'confirmedCaptureDrop',
    'captureDidNotStart',
    'manualReleaseCount',
    'watchdogReleaseCount',
    'screenshotShortcutEvents',
    'screenshotCaptureRequests',
    'quitConfirmedDecisions',
    'externalResourceRequestCount',
  ]) {
    assert.match(fixtureMainSource, new RegExp(`\\b${field}\\b`, 'u'),
      `native Settings collision proof is missing ${field}`);
    assert.match(runtimeSource, new RegExp(`\\b${field}\\b`, 'u'),
      `runtime Settings collision gate is missing ${field}`);
  }
}

async function checkLauncherContract() {
  assert.deepEqual(parseArguments([]), { fixturePath: DEFAULT_FIXTURE_PATH });
  assert.deepEqual(parseArguments(['--path', '?demo=result&run=fixture']), {
    fixturePath: '/?demo=result&run=fixture',
  });
  assert.deepEqual(parseArguments(['--path=/?demo=setup']), { fixturePath: '/?demo=setup' });
  for (const args of [
    ['--path', 'https://example.com/?demo=capture'],
    ['--path', '//example.com/?demo=capture'],
    ['--path', '/?demo=capture#private'],
    ['--path', '/?demo=capture', '--path', '/?demo=result'],
    ['--unknown'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
  assert.throws(() => validateRelativeFixturePath('http://127.0.0.1:49152/?demo=capture'));

  const port = await findAvailableLoopbackPort();
  assert(Number.isInteger(port) && port > 1023 && port <= 65535);

  const ownedDirectory = createOwnedUserDataDirectory();
  assert.equal(validateFixtureUserDataPath(ownedDirectory.realPath), ownedDirectory.realPath);
  removeOwnedUserDataDirectory(ownedDirectory);
  assert.equal(fs.existsSync(ownedDirectory.realPath), false);

  const launcherSource = readProjectFile('scripts/run-ui-fixture.js');
  assert.match(launcherSource, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), UI_FIXTURE_USER_DATA_PREFIX\)\)/);
  assert.match(launcherSource, /host: '127\.0\.0\.1', port: 0, exclusive: true/);
  assert.match(launcherSource, /'--strictPort'/);
  assert.match(launcherSource, /sanitizeFixtureEnvironment\(process\.env\)/);
  assert.match(launcherSource, /\['\.', '--dev', UI_FIXTURE_FLAG\]/);
  assert.match(launcherSource, /\[__filename, CLIPBOARD_TRANSACTION_HARNESS_FLAG\]/);
  assert.match(launcherSource, /show: false/);
  assert.match(launcherSource, /contextIsolation: true/);
  assert.match(launcherSource, /nodeIntegration: false/);
  assert.match(launcherSource, /sandbox: true/);
  assert.match(launcherSource, /setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/);
  assert.match(launcherSource, /webRequest\.onBeforeRequest/);
  assert.match(launcherSource, /callback\(\{ cancel: !allowed \}\)/);
  assert.match(launcherSource, /CLIPBOARD_TRANSACTION_PROOF_DATASET/);
  assert.match(launcherSource, /stats\.dev !== ownedDirectory\.device \|\| stats\.ino !== ownedDirectory\.inode/);
  assert.doesNotMatch(launcherSource, /openDevTools/);
}

function checkNativeElectronBinding() {
  const formalMainSource = readProjectFile('src/main/main.js');
  const fixtureMainSource = readProjectFile('scripts/ui-fixture-main.js');
  checkFixtureCheckBackgroundThrottlingContract(formalMainSource, fixtureMainSource);
  const mainSource = `${formalMainSource}\n${fixtureMainSource}`;
  const fixtureModeSource = readProjectFile('src/main/ui-fixture-mode.js');
  const appSource = readProjectFile('src/renderer/App.jsx');
  const preloadSource = readProjectFile('scripts/ui-fixture-preload.js');
  const ipcHookSource = readProjectFile('src/renderer/hooks/useIpc.js');
  const floatingPanelSource = readProjectFile('src/renderer/components/FloatingPanel.jsx');
  const resultDisplaySource = readProjectFile('src/renderer/components/ResultDisplay.jsx');
  const savedTermsLibrarySource = readProjectFile('src/renderer/components/SavedTermsLibrary.jsx');
  const previewDataSource = readProjectFile('src/renderer/utils/previewData.js');
  const productionPreviewDataSource = readProjectFile('src/renderer/utils/previewData.production.js');
  const safeSampleSource = readProjectFile('src/renderer/utils/safeSampleSource.js');
  const runtimeCheckSource = readProjectFile('scripts/check-electron-ui-fixture-runtime.js');
  checkStableFrameEvidenceContract(fixtureMainSource, runtimeCheckSource);
  const setupGateSource = readProjectFile('src/renderer/components/SetupGate.jsx');
  const settingsPanelSource = readProjectFile('src/renderer/components/SettingsPanel.jsx');
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const trustedInputHandlerStart = fixtureMainSource.indexOf(
    'function registerUiFixtureTrustedInputHandler(fixtureWindow)',
  );
  const trustedInputHandlerEnd = fixtureMainSource.indexOf(
    'function registerUiFixtureRecoveryHandlers()',
  );
  assert.notEqual(trustedInputHandlerStart, -1, 'missing fixture-only trusted input handler');
  assert.notEqual(trustedInputHandlerEnd, -1, 'missing trusted input handler boundary');
  const trustedInputHandlerSource = fixtureMainSource.slice(
    trustedInputHandlerStart,
    trustedInputHandlerEnd,
  );
  const fixtureRecoveryHandlerStart = fixtureMainSource.indexOf('function registerUiFixtureRecoveryHandlers()');
  const fixtureRecoveryHandlerEnd = fixtureMainSource.indexOf('async function finishUiFixtureRuntimeCheck()');
  assert.notEqual(fixtureRecoveryHandlerStart, -1, 'missing fixture-only recovery handler');
  assert.notEqual(fixtureRecoveryHandlerEnd, -1, 'missing fixture recovery runtime boundary');
  const fixtureRecoveryHandlerSource = fixtureMainSource.slice(
    fixtureRecoveryHandlerStart,
    fixtureRecoveryHandlerEnd,
  );
  const completedResultProofStart = fixtureMainSource.indexOf('if (isCompletedResultTextScaleRun)');
  const completedResultProofEnd = fixtureMainSource.indexOf(
    'if (isSettingsTransitionRun)',
    completedResultProofStart,
  );
  assert.notEqual(completedResultProofStart, -1, 'missing completed-result proof');
  assert.notEqual(completedResultProofEnd, -1, 'missing completed-result proof boundary');
  const completedResultProofSource = fixtureMainSource.slice(
    completedResultProofStart,
    completedResultProofEnd,
  );
  const targetCenterHitStart = fixtureMainSource.indexOf('const targetCenterHit =');
  const targetCenterHitEnd = fixtureMainSource.indexOf(
    'const dispatchTrustedClick =',
    targetCenterHitStart,
  );
  assert.notEqual(targetCenterHitStart, -1, 'missing trusted target-center helper');
  assert.notEqual(targetCenterHitEnd, -1, 'missing trusted target-center helper boundary');
  const targetCenterHitSource = fixtureMainSource.slice(targetCenterHitStart, targetCenterHitEnd);
  const guidedReplyProofStart = fixtureMainSource.indexOf('if (isGuidedReplyTextScaleRun)');
  const guidedReplyProofEnd = fixtureMainSource.indexOf(
    'if (isCompletedResultTextScaleRun)',
    guidedReplyProofStart,
  );
  assert.notEqual(guidedReplyProofStart, -1, 'missing guided-reply text-scale proof');
  assert.notEqual(guidedReplyProofEnd, -1, 'missing guided-reply text-scale proof boundary');
  const guidedReplyProofSource = fixtureMainSource.slice(
    guidedReplyProofStart,
    guidedReplyProofEnd,
  );
  const manualClipboardReplacementProofStart = fixtureMainSource.indexOf(
    'if (isManualClipboardReplacementRun)',
  );
  const manualClipboardReplacementProofEnd = fixtureMainSource.indexOf(
    'if (isSettingsStylesheetCollisionRun)',
    manualClipboardReplacementProofStart,
  );
  assert.notEqual(manualClipboardReplacementProofStart, -1,
    'missing manual clipboard replacement proof');
  assert.notEqual(manualClipboardReplacementProofEnd, -1,
    'missing manual clipboard replacement proof boundary');
  const manualClipboardReplacementProofSource = fixtureMainSource.slice(
    manualClipboardReplacementProofStart,
    manualClipboardReplacementProofEnd,
  );
  const fixtureStoreStart = fixtureMainSource.indexOf('function createUiFixtureStore(');
  const fixtureStoreEnd = fixtureMainSource.indexOf(
    'function createUiFixtureRuntime(',
    fixtureStoreStart,
  );
  assert.notEqual(fixtureStoreStart, -1, 'missing fixture-only in-memory settings adapter');
  assert.notEqual(fixtureStoreEnd, -1, 'missing fixture-only settings adapter boundary');
  const fixtureStoreSource = fixtureMainSource.slice(fixtureStoreStart, fixtureStoreEnd);

  assert.equal(packageJson.scripts['dev:ui-fixture'], 'node scripts/run-ui-fixture.js');
  assert.equal(packageJson.scripts['check:electron-ui-fixture'], 'node scripts/check-electron-ui-fixture.js');
  assert.equal(
    packageJson.scripts['check:electron-ui-fixture-runtime'],
    'node scripts/check-electron-ui-fixture-runtime.js',
  );
  assert.match(packageJson.scripts.test, /npm run check:electron-ui-fixture/);
  assert.match(packageJson.scripts.test, /npm run check:electron-ui-fixture-runtime/);
  assert.ok(packageJson.build.files.includes('!src/main/ui-fixture-mode.js'),
    'production files must explicitly exclude the fixture mode resolver');
  assert.ok(packageJson.build.files.includes('dist/renderer/**/*'),
    'production files must include only the renderer build subtree');
  assert.equal(
    packageJson.build.files.some((entry) => (
      entry !== 'dist/renderer/**/*' && /^!?dist\//u.test(entry)
    )),
    false,
    'production files must not include a broader or second dist subtree',
  );
  assert.doesNotMatch(
    JSON.stringify(packageJson.build.files.filter((entry) => !entry.startsWith('!'))),
    /ui-fixture/u,
    'production files must never positively include fixture modules',
  );
  assert.doesNotMatch(JSON.stringify(packageJson.build.extraResources), /ui-fixture/u,
    'production resources must never include fixture modules');
  assert.deepEqual(packageJson.build.extraResources, [{
    from: 'scripts',
    to: 'scripts',
    filter: ['VisionOCR.swift', 'ocr-swift-runner.sh'],
  }], 'production resources must remain the exact two-file OCR build allowlist');
  assert.match(runtimeCheckSource, /createFixtureRuntimeTempRoot\(\)/);
  assert.match(runtimeCheckSource, /TMPDIR: tempRoot/);
  assert.match(runtimeCheckSource, /TMP: tempRoot/);
  assert.match(runtimeCheckSource, /TEMP: tempRoot/);
  assert.match(runtimeCheckSource, /const timeoutMs = 60_000/,
    'runtime gate must allow one bounded minute for a native launcher under load');
  assert.match(runtimeCheckSource, /const launcherTerminationGraceMs = 12_000/,
    'runtime gate must outwait the launcher\'s bounded child shutdown before escalation');
  assert.match(runtimeCheckSource, /stats\.dev !== ownedRoot\.device/);
  assert.match(runtimeCheckSource, /stats\.ino !== ownedRoot\.inode/);
  assert.match(runtimeCheckSource, /waitForNoNewFixtureDirectories\(beforeFixtureDirectories, fixtureTempRoot\)/);
  assert.doesNotMatch(runtimeCheckSource, /os\.homedir\(\)|Application Support|metadataManifest/,
    'runtime fixture gate must not inspect or snapshot the live normal profile');
  assert.match(fixtureModeSource, /'manual-clipboard-replacement-native'/);
  assert.match(
    runtimeCheckSource,
    /\?demo=capture&backend=deepseek&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/,
    'manual clipboard replacement must use the isolated capture fixture',
  );
  for (const proofField of [
    'preservedExactDraft',
    'decisionFocused',
    'requestSettled',
    'decisionExplicit',
    'restoredExactFocus',
    'readActionEnabled',
    'loadedClipboardPreview',
    'noticeTruthful',
    'noAutomaticProcessing',
    'pausedCopyTruthful',
    'undoDisabledDuringDecision',
    'heldPastOriginalExpiry',
    'keepFocusedEnabledUndo',
    'restoredExactSource',
    'focusedRestoredSource',
  ]) {
    assert.match(
      manualClipboardReplacementProofSource,
      new RegExp(`\\b${proofField}\\b`, 'u'),
      `manual clipboard replacement proof is missing ${proofField}`,
    );
    assert.match(
      runtimeCheckSource,
      new RegExp(`\\b${proofField}\\b`, 'u'),
      `manual clipboard replacement runtime gate is missing ${proofField}`,
    );
  }
  assert.match(
    manualClipboardReplacementProofSource,
    /document\.activeElement === firstDecision\.title/,
    'the first replacement decision must own focus',
  );
  assert.match(
    manualClipboardReplacementProofSource,
    /document\.activeElement === readButton/,
    'Keep must restore focus to the exact manual-read trigger',
  );
  assert.match(
    manualClipboardReplacementProofSource,
    /pausedDecisionWaitMs = 10_500/,
    'the native Clear Undo decision must remain mounted past the original ten-second window',
  );
  assert.match(
    manualClipboardReplacementProofSource,
    /document\.activeElement === activeUndoButton/,
    'Keep during Clear Undo must focus the resumed Undo action',
  );
  assert.match(
    manualClipboardReplacementProofSource,
    /!candidate\.disabled[\s\S]*candidate\.getAttribute\('aria-busy'\) !== 'true'/,
    'the second read must wait for the exact trigger to settle and become enabled',
  );
  assert.match(manualClipboardReplacementProofSource, /finalProcessRequests === 0/);
  assert.match(manualClipboardReplacementProofSource, /demoClipboardWriteRequests/);
  assert.match(manualClipboardReplacementProofSource, /demoNativeClipboardWriteStubs/);

  assert.match(mainSource, /const isDev = !app\.isPackaged && process\.argv\.includes\('--dev'\);/);
  for (const fixtureSignal of [
    '--ui-fixture',
    'SLIPSTREAM_UI_FIXTURE_REQUEST',
    'SLIPSTREAM_UI_FIXTURE_MODE',
    'SLIPSTREAM_UI_FIXTURE_RENDERER_URL',
    'SLIPSTREAM_UI_FIXTURE_USER_DATA',
    'SLIPSTREAM_DEMO_RESULT',
  ]) {
    assert.match(mainSource, new RegExp(fixtureSignal, 'u'),
      `formal main must detect fixture startup signal ${fixtureSignal}`);
  }
  assertBefore(
    mainSource,
    'if (app.isPackaged && uiFixtureRequested)',
    "require('../../scripts/ui-fixture-main')",
    'packaged fixture requests must be rejected before requiring excluded scripts',
  );
  assert.match(fixtureMainSource, /resolveUiFixtureMode\(\{\s*argv,\s*env,\s*isPackaged: app\.isPackaged,/s);
  assert.match(
    fixtureMainSource,
    /const uiFixtureCheckMode = uiFixtureMode\.enabled\s*&& new URL\(uiFixtureMode\.rendererUrl\)\.searchParams\.get\('fixture'\) === 'check';/s,
    'fixture-check capability must be explicit and derived from the validated renderer URL',
  );
  assert.match(
    mainSource,
    /const store = uiFixtureMode\.enabled\s*\? uiFixtureMain\.createUiFixtureStore\(\{ createBlockedStartupSettings \}\)\s*: require\('\.\/store'\);/s,
    'production must load the formal store while validated fixture mode uses only memory',
  );
  assert.equal(
    (mainSource.match(/require\('\.\/store'\)/g) || []).length,
    1,
    'the formal store import must have one explicit production-only call site',
  );
  assert.match(
    mainSource,
    /const LLMService = uiFixtureMode\.enabled \? null : require\('\.\/llm-service'\);/,
    'production must load the formal LLM service while fixtures exclude its persistent store graph',
  );
  assert.match(
    mainSource,
    /const \{ testProviderReadiness \} = uiFixtureMode\.enabled\s*\? \{ testProviderReadiness: null \}\s*: require\('\.\/provider-readiness'\);/s,
    'production must load provider readiness while fixtures exclude its LLM/store graph',
  );
  assert.match(fixtureStoreSource, /return Object\.freeze\(\{/);
  assert.match(fixtureStoreSource, /if \(!settings\) settings = createBlockedStartupSettings\(\);/);
  assert.match(fixtureStoreSource, /return \{ \.\.\.requireReadySettings\(\) \};/);
  assert.doesNotMatch(
    fixtureStoreSource,
    /\b(?:fs|path|safeStorage|electron-store|require)\b/,
    'fixture settings adapter must remain memory-only and dependency-free',
  );
  assert.match(
    fixtureModeSource,
    /if \(isPackaged\) throw new Error\('UI fixture mode is unavailable in packaged builds'\);/,
    'the fixture store branch must be unreachable in packaged builds',
  );
  assertBefore(fixtureMainSource, "app.setPath('userData', uiFixtureMode.userDataPath);", 'return Object.freeze({ uiFixtureMode, uiFixtureCheckMode });', 'fixture userData must be selected during bootstrap');
  assertBefore(fixtureMainSource, "app.setPath('sessionData', sessionDataPath);", 'return Object.freeze({ uiFixtureMode, uiFixtureCheckMode });', 'fixture sessionData must be selected during bootstrap');
  assertBefore(mainSource, 'uiFixtureMain.initializeUiFixture(', "require('./store')", 'fixture bootstrap and path selection must precede the production store import');
  assert.match(mainSource, /uiFixtureMode\.enabled\s*\? path\.join\(__dirname, '\.\.', '\.\.', 'scripts', 'ui-fixture-preload\.js'\)/);
  assert.match(mainSource, /setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/);
  assert.match(fixtureMainSource, /webRequest\.onBeforeRequest/);
  assert.match(fixtureMainSource, /\['http:', 'ws:'\]\.includes\(requestUrl\.protocol\)/);
  assert.match(fixtureMainSource, /requestUrl\.hostname === fixtureUrl\.hostname/);
  assert.match(fixtureMainSource, /requestUrl\.port === fixtureUrl\.port/);
  assert.match(fixtureMainSource, /requestUrl\.protocol === 'data:'/);
  assert.match(fixtureMainSource, /requestUrl\.protocol === 'blob:' && requestUrl\.origin === fixtureUrl\.origin/);
  assert.match(fixtureMainSource, /getMainWindow\(\)\.webContents\.session\.fetch\(trapUrl/);
  assert.match(fixtureMainSource, /uiFixtureBlockedRendererExternalRequests \+= 1/);
  assert.match(fixtureMainSource, /details\.webContentsId === fixtureWindow\.webContents\.id/);
  assert.match(mainSource, /getMainWindow: \(\) => mainWindow/);
  assert.match(mainSource, /getTray: \(\) => tray/);
  assert.match(mainSource, /uiFixtureRuntime\.attachToWindow\(mainWindow, \{ isTextScaleNativeFixture \}\)/);
  assertBefore(
    formalMainSource,
    'uiFixtureRuntime.attachToWindow(mainWindow, { isTextScaleNativeFixture });',
    'mainWindow.loadURL(uiFixtureMode.rendererUrl)',
    'fixture handlers and request interception must attach before renderer loading begins',
  );
  assert.doesNotMatch(formalMainSource, /function finishUiFixtureRuntimeCheck|function registerUiFixtureTrustedInputHandler/,
    'formal main must not embed fixture proof or native handler bodies');
  assert.match(mainSource, /mainWindow\.on\('close', \(event\) => \{\s*if \(uiFixtureMode\.enabled\) \{\s*app\.isQuitting = true;\s*return;/s);
  assert.match(mainSource, /app\.on\('ready', \(\) => \{\s*const storageStatus = store\.initializeStore\(\);\s*const settings = getStartupSettings\(\);\s*installAboutPanel\(\);\s*installApplicationMenu\(\);\s*registerAppQuitIpcHandlers\(\);\s*registerAppSettingsIpcHandlers\(\);\s*if \(!uiFixtureMode\.enabled\) registerIpcHandlers\(\);\s*createMainWindow\(settings\);\s*if \(uiFixtureMode\.enabled\) return;/s);
  assert.match(mainSource, /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(createApplicationMenuTemplate\(\)\)\)/);
  assert.doesNotMatch(mainSource, /\{ role: '(?:reload|forceReload|toggleDevTools)' \}/);
  assert.match(mainSource, /app\.on\('window-all-closed', \(\) => \{\s*if \(uiFixtureMode\.enabled\) \{\s*app\.isQuitting = true;\s*app\.quit\(\);\s*return;/s);
  assert.match(
    mainSource,
    /if \(uiFixtureMode\.enabled && !uiFixtureRuntime\?\.isCommandQSafeExitFixture\?\.\(\)\) \{\s*app\.isQuitting = true;\s*return;\s*\}/s,
    'ordinary fixtures must still bypass production cleanup while the exact safe-exit run may prove it',
  );
  assertBefore(
    mainSource,
    "if (uiFixtureMode.enabled && !uiFixtureRuntime?.isCommandQSafeExitFixture?.()) {",
    'ScreenshotService.cleanup();',
    'the exact safe-exit fixture exception must be decided before production cleanup',
  );
  assert.match(mainSource, /if \(isDev && !uiFixtureMode\.enabled\) \{\s*mainWindow\.webContents\.openDevTools/s);

  assert.match(trustedInputHandlerSource, /function registerUiFixtureTrustedInputHandler\(fixtureWindow\)/);
  assert.equal(
    (trustedInputHandlerSource.match(/!uiFixtureCheckMode/g) || []).length,
    2,
    'trusted input must require explicit fixture-check mode at registration and dispatch time',
  );
  assert.match(trustedInputHandlerSource, /!fixtureWindow\s*\|\| fixtureWindow\.isDestroyed\(\)/s);
  assert.match(trustedInputHandlerSource, /const fixtureWebContents = fixtureWindow\.webContents;/);
  assert.match(trustedInputHandlerSource, /ipcMain\.handle\(UI_FIXTURE_TRUSTED_INPUT_CHANNEL/);
  assert.match(trustedInputHandlerSource, /event\.sender !== fixtureWebContents/);
  assert.match(trustedInputHandlerSource, /event\.senderFrame !== fixtureWebContents\.mainFrame/);
  assert.match(trustedInputHandlerSource, /event\.sender\.getURL\(\) !== uiFixtureMode\.rendererUrl/);
  assert.match(trustedInputHandlerSource, /event\.senderFrame\.url !== uiFixtureMode\.rendererUrl/);
  assert.match(trustedInputHandlerSource, /isCompletedResultTrustedInputFixtureUrl\(new URL\(event\.senderFrame\.url\)\)/);
  assert.match(
    trustedInputHandlerSource,
    /\.\.\.Array\.from\(\{ length: 19 \}, \(_value, index\) => Object\.freeze\(\{\s*step: index \+ 1,\s*kind: 'mouse',\s*\}\)\)/s,
    'the trusted input gate must begin with exactly 19 numbered mouse steps',
  );
  assert.match(trustedInputHandlerSource, /Object\.freeze\(\{ step: 20, kind: 'key', key: 'Tab' \}\)/);
  assert.match(trustedInputHandlerSource, /Object\.freeze\(\{ step: 21, kind: 'key', key: 'Tab' \}\)/);
  assert.match(trustedInputHandlerSource, /Object\.freeze\(\{ step: 22, kind: 'key', key: 'Escape' \}\)/);
  assert.match(trustedInputHandlerSource, /Object\.freeze\(\{ step: 23, kind: 'mouse' \}\)/);
  assert.match(
    trustedInputHandlerSource,
    /Object\.freeze\(\{ step: 24, kind: 'mouse' \}\),\s*\]\);/,
    'the exact input sequence must end after deadline pointer step 24',
  );
  assert.match(
    trustedInputHandlerSource,
    /uiFixtureTrustedInputProbe = \{\s*expectedSteps: expectedInputSteps\.length,\s*acceptedSteps: 0,\s*rejectedSteps: 0,\s*nextStep: 1,\s*complete: false,\s*mouseActions: 0,\s*mouseInputEvents: 0,\s*keyActions: 0,\s*keyInputEvents: 0,\s*\};/s,
    'the trusted input probe must expose the complete sequence state',
  );
  assert.match(
    trustedInputHandlerSource,
    /const rejectInput = \(message\) => \{\s*uiFixtureTrustedInputProbe\.rejectedSteps \+= 1;\s*throw new TypeError\(message\);\s*\};/s,
    'rejection must increment only the rejection counter and leave the sequence in place',
  );
  assert.match(trustedInputHandlerSource, /Number\.isSafeInteger\(payload\.step\)/);
  assert.match(trustedInputHandlerSource, /payload\.step !== expectedStep\.step/);
  assert.match(trustedInputHandlerSource, /payload\.kind !== expectedStep\.kind/);
  assert.match(trustedInputHandlerSource, /payloadKeys\.join\(','\) !== 'kind,step,x,y'/);
  assert.match(trustedInputHandlerSource, /Number\.isSafeInteger\(payload\.x\)/);
  assert.match(trustedInputHandlerSource, /payload\.x >= viewportWidth/);
  assert.match(trustedInputHandlerSource, /payload\.key !== expectedStep\.key/);
  assert.match(trustedInputHandlerSource, /!\['Tab', 'Escape'\]\.includes\(payload\.key\)/);
  assert.match(trustedInputHandlerSource, /payloadKeys\.join\(','\) !== 'key,kind,step'/);
  assert.match(trustedInputHandlerSource, /fixtureWebContents\.sendInputEvent\(input\)/);
  assert.match(trustedInputHandlerSource, /type: 'mouseMove'/);
  assert.match(trustedInputHandlerSource, /type: 'mouseDown'/);
  assert.match(trustedInputHandlerSource, /type: 'mouseUp'/);
  assert.match(trustedInputHandlerSource, /type: 'keyDown', keyCode: payload\.key/);
  assert.match(trustedInputHandlerSource, /type: 'keyUp', keyCode: payload\.key/);
  assert.match(trustedInputHandlerSource, /uiFixtureTrustedInputProbe\.acceptedSteps \+= 1;/);
  assert.match(
    trustedInputHandlerSource,
    /uiFixtureTrustedInputProbe\.nextStep = uiFixtureTrustedInputProbe\.acceptedSteps \+ 1;/,
  );
  assert.match(
    trustedInputHandlerSource,
    /uiFixtureTrustedInputProbe\.complete = uiFixtureTrustedInputProbe\.acceptedSteps\s*=== expectedInputSteps\.length;/s,
  );
  assertBefore(
    trustedInputHandlerSource,
    'fixtureWebContents.sendInputEvent(input);',
    'uiFixtureTrustedInputProbe.acceptedSteps += 1;',
    'the native-input sequence must advance only after input dispatch',
  );
  assert.doesNotMatch(trustedInputHandlerSource, /executeJavaScript/,
    'trusted input IPC handler must not re-enter renderer JavaScript');

  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('slipstreamUiFixture'/);
  assert.match(preloadSource, /enabled: true/);
  assert.match(preloadSource, /isolated: true/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('slipstreamUiFixtureRecovery'/);
  assert.equal((preloadSource.match(/ipcRenderer\.invoke/g) || []).length, 16,
    'fixture preload must expose only recovery, fixed trusted input, safe-exit, and Settings bridges');
  assert.match(preloadSource, /slipstream-ui-fixture:renderer-recovery-status-get/);
  assert.match(preloadSource, /slipstream-ui-fixture:clipboard-residue-risk-ack/);
  assert.match(preloadSource, /slipstream-ui-fixture:trusted-input/);
  assert.match(preloadSource, /function isCompletedResultTrustedInputFixture\(\)/);
  assert.match(preloadSource, /fixtureUrl\.username === ''/);
  assert.match(preloadSource, /fixtureUrl\.password === ''/);
  assert.match(preloadSource, /Number\(fixtureUrl\.port\) <= 65535/);
  assert.match(
    preloadSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{expectedRun\}/,
  );
  assert.match(
    preloadSource,
    /isTrustedInputFixtureForRun\(COMPLETED_RESULT_TRUSTED_INPUT_RUN\)/,
  );
  assert.match(
    preloadSource,
    /if \(isCompletedResultTrustedInputFixture\(\)\) \{[\s\S]*exposeInMainWorld\('slipstreamUiFixtureInput'[\s\S]*mouseClick: \(step, x, y\)[\s\S]*keyPress: \(step, key\)/,
  );
  assert.match(
    preloadSource,
    /mouseClick: \(step, x, y\) => ipcRenderer\.invoke\(FIXTURE_TRUSTED_INPUT_CHANNEL, \{\s*kind: 'mouse',\s*step,\s*x,\s*y,\s*\}\)/s,
    'fixture preload must expose the exact numbered mouseClick signature',
  );
  assert.match(
    preloadSource,
    /keyPress: \(step, key\) => ipcRenderer\.invoke\(FIXTURE_TRUSTED_INPUT_CHANNEL, \{\s*kind: 'key',\s*step,\s*key,\s*\}\)/s,
    'fixture preload must expose the exact numbered keyPress signature',
  );
  assert.doesNotMatch(preloadSource, /\b(?:clickAt|pressEscape)\b/,
    'fixture preload must not retain unnumbered trusted-input methods');
  assert.doesNotMatch(preloadSource, /slipstreamUiFixtureInput[\s\S]{0,300}\bdispatch\s*:/,
    'trusted input preload bridge must not expose arbitrary payload dispatch');
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|once|sendSync)/);
  assert.match(
    preloadSource,
    /if \(isCommandQSafeExitFixture\(\)\) \{[\s\S]*?exposeInMainWorld\('slipstreamUiFixtureQuit'[\s\S]*?listenerReady:[\s\S]*?APP_QUIT_LISTENER_READY_CHANNEL[\s\S]*?updateRisk:[\s\S]*?decide:[\s\S]*?onRequested:[\s\S]*?ipcRenderer\.on\(APP_QUIT_REQUESTED_CHANNEL, listener\)[\s\S]*?ipcRenderer\.removeListener\(APP_QUIT_REQUESTED_CHANNEL, listener\)/,
    'only the exact safe-exit fixture may subscribe to the production quit request channel',
  );
  assert.match(
    preloadSource,
    /if \(isCommandCommaSafeSettingsFixture\(\)\) \{[\s\S]*?exposeInMainWorld\('slipstreamUiFixtureSettingsMenu'[\s\S]*?listenerReady:[\s\S]*?APP_SETTINGS_LISTENER_READY_CHANNEL[\s\S]*?handled:[\s\S]*?APP_SETTINGS_REQUEST_HANDLED_CHANNEL[\s\S]*?onRequested:[\s\S]*?ipcRenderer\.on\(APP_SETTINGS_REQUESTED_CHANNEL, listener\)[\s\S]*?ipcRenderer\.removeListener\(APP_SETTINGS_REQUESTED_CHANNEL, listener\)/,
    'only the exact Command+, fixture may use the production Settings request bridge',
  );
  assert.match(preloadSource,
    /FIXTURE_SETTINGS_READY_ACCEPT_AFTER_MS = 225[\s\S]*?fixtureSettingsReadyAttempts \+= 1[\s\S]*?attemptDelayMs < FIXTURE_SETTINGS_READY_ACCEPT_AFTER_MS/,
    'the Settings READY fixture must reject every synchronous StrictMode attempt');
  assert.match(preloadSource,
    /listenerReadyAttempts: fixtureSettingsReadyAttempts[\s\S]*?listenerReadyFailuresInjected: fixtureSettingsReadyFailuresInjected[\s\S]*?listenerReadyAcceptedDelayMs: fixtureSettingsReadyAcceptedDelayMs/,
    'the Settings READY fixture must report attempts, failures, and observed acceptance delay');
  assert.match(preloadSource,
    /ipcRenderer\.invoke\(APP_SETTINGS_REQUEST_HANDLED_CHANNEL[\s\S]*?\.then\(\(response\) => \{[\s\S]*?if \(dropConsumedResponse\)[\s\S]*?Dropped consumed Settings acknowledgement response/,
    'the ACK fault must drop a response only after the main process consumes the request');
  assert.match(preloadSource,
    /handledResponsesDropped: fixtureSettingsHandledResponsesDropped[\s\S]*?handledInvalidResponsesDelivered: fixtureSettingsHandledInvalidResponsesDelivered/,
    'the ACK proof must report the dropped acknowledged response and delivered invalid retry');
  assert.match(fixtureModeSource, /'command-comma-safe-settings-native'/,
    'fixture mode must whitelist the exact Command+, Settings run');
  assert.match(fixtureModeSource,
    /UI fixture Command\+, Settings run requires the fixed isolated check or preview scenario/);
  assert.match(mainSource, /function isCommandCommaSafeSettingsFixtureUrl\(fixtureUrl\)/);
  assert.match(mainSource,
    /isCommandCommaSafeSettingsFixture: \(\) => isCommandCommaSafeSettingsFixtureUrl/);
  assert.match(mainSource, /finishCommandCommaSafeSettingsRuntimeCheck\(\)/);
  assert.match(runtimeCheckSource,
    /const commandCommaSafeSettingsRun = 'command-comma-safe-settings-native'/);
  assert.match(runtimeCheckSource,
    /await runFixture\(commandCommaSafeSettingsRun\)/,
    'the native runtime suite must execute the exact Command+, Settings journey');
  assert.match(runtimeCheckSource, /physicalAcceleratorCausality, false/,
    'automated MenuItem coverage must stay distinct from physical accelerator causality');
  assert.match(mainSource,
    /processingRemovalMutationOrder < settingsInsertionMutationOrder/,
    'Stop-and-open proof must observe processing removal before Settings insertion');
  assert.match(runtimeCheckSource,
    /listenerReadyAcceptedDelayMs >= 225/,
    'native runtime assertions must reject a synchronous READY acceptance');
  assert.match(ipcHookSource,
    /cancelRequest === 2 \? 1200 : cancelRequest === 4 \? 350 : null/,
    'the exact Command+, fixture must own deterministic late and early cancellation failures');
  assert.match(ipcHookSource,
    /process-5-failed[\s\S]*?DEMO_PROCESS_FAILURES\['service-unavailable'\]/,
    'the exact Command+, fixture must settle its fifth task as an ordinary failure');
  assert.match(fixtureMainSource,
    /process-3-succeeded[\s\S]*?< eventSequence\(settledTimeline, 'cancel-2-failed'\)/,
    'the native journey must observe task success before the late cancellation failure');
  assert.match(fixtureMainSource,
    /cancel-4-failed[\s\S]*?< eventSequence\(settledTimeline, 'process-5-failed'\)/,
    'the native journey must observe cancellation failure before ordinary task failure');
  assert.match(runtimeCheckSource, /failureIntentClearedBeforeNextCancel: true/,
    'the runtime gate must require a following ordinary cancel to stay out of Settings');
  assert.match(runtimeCheckSource, /acknowledgementInvalidRetryDelivered: true/,
    'the runtime gate must require the renderer to settle the idempotent invalid ACK retry');
  assert.match(fixtureMainSource,
    /lifecycle\.requestSentCount === 10[\s\S]*?lifecycle\.listenerReadyCount === 1[\s\S]*?lifecycle\.pendingReplayCount === 1[\s\S]*?lifecycle\.acknowledgedCount === 9[\s\S]*?lifecycle\.invalidAcknowledgementCount === 1/,
    'the exact Command+, lifecycle must reject replay, delivery, or ACK retry storms');
  assert.doesNotMatch(preloadSource, /app:renderer-recovery-status-get|app:clipboard-residue-risk-ack/,
    'fixture preload must not expose production application IPC channels');
  assert.doesNotMatch(preloadSource, /navigator\.clipboard/);
  assert.match(preloadSource, /Native UI fixtures do not expose application IPC/);

  assert.match(fixtureModeSource, /'guided-reply-text-scale-native'/,
    'fixture mode must whitelist the guided-reply text-scale run');
  assert.match(fixtureModeSource, /const guidedReplyTextScaleRun = rendererUrl\.searchParams\.get\('run'\)/);
  assert.match(
    fixtureModeSource,
    /UI fixture guided-reply text-scale probe requires the fixed sample result check scenario/,
  );
  assert.match(mainSource, /const GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN = 'guided-reply-text-scale-native'/);
  assert.match(mainSource, /function isGuidedReplyTextScaleTrustedInputFixtureUrl\(fixtureUrl\)/);
  assert.match(
    mainSource,
    /const renderedTarget = visualTarget instanceof HTMLElement \? visualTarget : target;[\s\S]*?alignTargetInScrollport\(renderedTarget, scrollport\);/,
    'focus evidence must align the rendered ring target in its known scroll owner before measuring containment',
  );
  assert.match(
    mainSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN\}/,
    'main must bind guided-reply input only to the exact fixed URL',
  );
  assert.match(preloadSource, /isTrustedInputFixtureForRun\(GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN\)/);
  assert.match(
    preloadSource,
    /replacePlaceholder: \(step\) => ipcRenderer\.invoke\([\s\S]*?\{ kind: 'fixed-text', step, action: 'replace-placeholder' \}/,
    'the placeholder bridge must accept only a numbered fixed action',
  );
  assert.match(
    preloadSource,
    /editAfterCopy: \(step\) => ipcRenderer\.invoke\([\s\S]*?\{ kind: 'fixed-text', step, action: 'edit-after-copy' \}/,
    'the post-copy bridge must accept only a numbered fixed action',
  );
  assert.doesNotMatch(
    preloadSource,
    /(?:replacePlaceholder|editAfterCopy): \(step,\s*(?:text|value|payload|input)/,
    'the guided-reply preload must never accept renderer-supplied text',
  );
  assert.match(trustedInputHandlerSource, /const guidedReplyExpectedInputSteps = Object\.freeze\(\[/);
  for (const [step, action] of [
    [4, 'replace-placeholder'],
    [6, 'edit-after-copy'],
  ]) {
    assert.match(
      trustedInputHandlerSource,
      new RegExp(`step: ${step}, kind: 'fixed-text', action: '${action}'`, 'u'),
      `guided-reply trusted sequence is missing fixed step ${step}`,
    );
  }
  assert.match(trustedInputHandlerSource, /Array\.from\(\{ length: 9 \}/,
    'guided-reply trusted sequence must drive the complete native nine-Tab loop');
  assert.match(trustedInputHandlerSource, /Object\.freeze\(\{ step: 18, kind: 'key', key: 'Escape' \}\)/);
  assert.match(trustedInputHandlerSource, /payloadKeys\.join\(','\) !== 'action,kind,step'/);
  assert.match(trustedInputHandlerSource, /fixtureWebContents\.insertText\(fixedText\)/);
  assert.match(trustedInputHandlerSource, /\? 'Fixture User'/);
  assert.match(trustedInputHandlerSource, /'\\nFixture follow-up edit\.'/);
  assert.doesNotMatch(
    trustedInputHandlerSource,
    /fixedText\s*=\s*payload\.(?:text|value|input|payload)/,
    'main must never insert renderer-supplied fixture text',
  );
  assertBefore(
    trustedInputHandlerSource,
    'await fixtureWebContents.insertText(fixedText);',
    'uiFixtureTrustedInputProbe.acceptedSteps += 1;',
    'the guided-reply fixed step must advance only after insertion',
  );

  for (const field of [
    'initialRadioFocus',
    'initialRadioHit',
    'backgroundIsolated',
    'blockSummaryBeforeOverride',
    'blockSummaryAfterOverride',
    'trustedReplacementApplied',
    'postCopyEditApplied',
    'blockedFooterLayout',
    'blockedFooterReachabilityEvidence',
    'footerPosition',
    'footerDoesNotOverlapPrevious',
    'targetMinimumEvidence',
    'tabStayedContained',
    'tabLoopReturnedToInitial',
    'firstCloseReturnedToExactTrigger',
    'escapeReturnedToExactTrigger',
    'onlyExpectedClipboardWrite',
  ]) {
    assert.match(guidedReplyProofSource, new RegExp(`\\b${field}\\b`, 'u'),
      `guided-reply proof is missing ${field}`);
  }
  for (const field of [
    'radioVisible',
    'ringVisible',
    'backgroundIsolated',
    'blockSummaryBeforeOverride',
    'blockSummaryAfterOverride',
    'trustedReplacementApplied',
    'postCopyEditApplied',
    'guidedBlockedFooter',
    'guidedBlockedFooterReachability',
    'footerPosition',
    'footerDoesNotOverlapPrevious',
    'mismatchTargets',
    'settledTargets',
    'tabStayedContained',
    'tabLoopReturnedToInitial',
    'firstCloseReturnedToExactTrigger',
    'escapeReturnedToExactTrigger',
    'onlyExpectedClipboardWrite',
  ]) {
    assert.match(runtimeCheckSource, new RegExp(`\\b${field}\\b`, 'u'),
      `guided-reply runtime gate is missing ${field}`);
  }
  assert.match(guidedReplyProofSource, /footerLayout\.footerPosition === 'static'/);
  assert.match(guidedReplyProofSource, /blockedFooterLayout\.footerPosition === 'static'/);
  assert.match(guidedReplyProofSource, /blockedFooter: blockedFooterLayout/);
  assert.match(guidedReplyProofSource, /blockedFooterReachability,/);
  assert.match(guidedReplyProofSource, /dialog\.scrollTop = maximumScrollTop;/);
  assert.match(guidedReplyProofSource, /scrollLeftStayedZero/);
  assert.match(guidedReplyProofSource, /closeCopyOverlapArea: overlapArea\(closeRect, copyRect\)/);
  assert.match(
    guidedReplyProofSource,
    /Number\.isSafeInteger\(blockedFooterReachability\.close\.centerHit\.x\)[\s\S]*Number\.isSafeInteger\(blockedFooterReachability\.copy\.centerHit\.x\)/,
    'blocked footer must hard-gate both action center hits',
  );
  assert.match(
    guidedReplyProofSource,
    /targetCenterHit\(copyAction, 'guided-reply blocked Copy action'\)/,
    'disabled blocked Copy must still expose an unobscured hit-tested center',
  );
  assert.match(guidedReplyProofSource, /rect\.width >= 32 && rect\.height >= 32/);
  assert.match(guidedReplyProofSource, /input\[name="reply-status"\]\[value="completed"\]/);
  assert.match(guidedReplyProofSource, /#reply-progress-mismatch\[role="alert"\]/);
  assert.match(guidedReplyProofSource, /#reply-placeholder-warning\[role="alert"\]/);
  assert.match(guidedReplyProofSource, /data-clipboard-status="outdated"/);
  assert.match(guidedReplyProofSource, /const copiedNoticeVisibleAtCopy = copiedNotice\.isConnected/);
  assert.match(
    guidedReplyProofSource,
    /const outdatedEvidence = await waitForStableEvidence\([\s\S]*?copiedNoticeCleared: !replyDrawer\.querySelector\(/,
    'guided-reply proof must stably verify the current copied selector disappears after editing',
  );
  assert.match(
    guidedReplyProofSource,
    /postCopyEditApplied: replyTextarea\.value[\s\S]*?Fixture follow-up edit\./,
    'guided-reply proof must wait for the fixed post-copy edit to reach the committed controlled value',
  );
  assert.doesNotMatch(
    guidedReplyProofSource,
    /copiedNotice\.isConnected === false/,
    'ClipboardActionNotice may reuse its root DOM node across copied and outdated states',
  );
  assert.equal((guidedReplyProofSource.match(/await dispatchTrustedClick\(/g) || []).length, 6,
    'guided-reply proof must express exactly six native pointer actions');
  assert.equal((guidedReplyProofSource.match(/await dispatchTrustedFixedText\(/g) || []).length, 2,
    'guided-reply proof must express exactly two fixed trusted edits');
  assert.match(guidedReplyProofSource, /const nativeTabStopCount = 9;/);
  assert.match(guidedReplyProofSource, /for \(let index = 0; index < nativeTabStopCount; index \+= 1\)/);
  assert.match(guidedReplyProofSource, /await dispatchTrustedKey\(\s*18,\s*'Escape'/s);
  assert.doesNotMatch(guidedReplyProofSource, /dispatchEvent\(new (?:Mouse|Keyboard|Input)Event/,
    'guided-reply proof must not synthesize user input');
  assert.match(
    runtimeCheckSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/,
  );
  assert.match(runtimeCheckSource, /const guidedReplyTextScaleRun = 'guided-reply-text-scale-native'/);
  assert.match(runtimeCheckSource, /expectedSteps: 18,[\s\S]*acceptedSteps: 18,[\s\S]*rejectedSteps: 1,[\s\S]*nextStep: 19,[\s\S]*mouseActions: 6,[\s\S]*fixedTextActions: 2/s);
  assert.match(preloadSource, /\[data-saved-term-copy-action\]/);
  assert.match(preloadSource, /\[data-support-diagnostics-copy-action\]/);
  assert.match(preloadSource, /\[data-connection-recovery-copy-action="true"\]/);
  assert.match(preloadSource, /demoClipboardWriteRequests/);
  assert.match(preloadSource, /demoNativeClipboardWriteStubs/);

  assert.match(ipcHookSource, /document\.documentElement\.dataset\.uiFixture = 'native-isolated'/);
  assertBefore(ipcHookSource, 'if (isNativeUiFixture && isDemo) return invokeDemo(channel, ...args);', 'if (window.api?.invoke)', 'native fixtures must select demo behavior before preload IPC');
  assert.match(ipcHookSource, /demoActiveCaptureEventsCode === 'source-edit-transition'/,
    'the native Option+C edit fixture must emit one dedicated delayed shortcut capture');
  assert.match(ipcHookSource, /demoClipboardWriteCode === 'write-slow'[\s\S]*window\.setTimeout\(resolve, 2500\)/);
  assert.match(ipcHookSource, /if \(isNativeUiFixture\) \{[\s\S]*demoNativeClipboardWriteStubs \+= 1;[\s\S]*return true;[\s\S]*navigator\.clipboard\?\.writeText\(args\[0\] \|\| ''\)/);
  for (const marker of [
    ['demoClipboard', 'Clear'].join(''),
    ['demoNativeClipboard', 'Clear'].join(''),
  ]) {
    assert.equal(ipcHookSource.includes(marker), false,
      'native demo fixtures must not restore retired system-clipboard mutation counters');
  }
  assert.match(ipcHookSource, /demoSettingsLoadCode === 'corrupt-json'/);
  assert.match(ipcHookSource, /demoStartupRecoveryCode !== 'archive-success'/);
  assert.match(ipcHookSource, /backupFileName: 'slipstream-settings\.corrupt-20260728\.json'/);
  assert.match(ipcHookSource, /demoConnectionCode === 'unreachable-once'/);
  assert.match(ipcHookSource, /demoProviderConnectionRequests === 1 \? 'unreachable' : 'ok'/);
  assert.match(ipcHookSource, /dataset\.demoCustomPromptWriteRequests/);
  assert.match(ipcHookSource, /dataset\.demoCustomPromptWriteSuccesses/);
  assert.match(ipcHookSource, /const customPromptWrite = key === 'customPrompt'/);
  assert.match(ipcHookSource, /demoRunCode === 'settings-prompt-draft-recovery-native'/);
  assert.match(ipcHookSource, /demoSaveCode === 'prompt-twice'/);
  assert.match(runtimeCheckSource, /const settingsPromptDraftRecoveryRun = 'settings-prompt-draft-recovery-native'/);
  assert.match(
    runtimeCheckSource,
    /\?demo=capture&backend=deepseek&save=prompt-twice&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/,
  );
  for (const field of [
    'firstUseConnectionReady',
    'firstUseEnableInitiallyEnabled',
    'firstUseEnableRemainedActionable',
    'firstUseEnableStartedFromTriggerFocus',
    'firstUseEnableGuardVisible',
    'firstUseEnableGuardCancelled',
    'firstUseEnableGuardRestoredTriggerFocus',
    'firstUseEnableAttemptStayedInSettings',
    'firstUseEnableDidNotWrite',
    'escapeNoImplicitWrite',
    'escapeCancelRestoredPromptFocus',
    'returnNoImplicitWrite',
    'returnActionStartedFromReturnFocus',
    'returnCancelRestoredReturnFocus',
    'escapeAndReturnFocusAreDistinct',
    'firstFailurePreservedDraft',
    'firstFailureLocalErrorVisible',
    'firstFailureGlobalErrorVisible',
    'failedRetryClearedOnPersistedRestore',
    'persistedRestoreDidNotWrite',
    'persistedRestoreLeftWithoutGuard',
    'persistedRestoreSurvivedReopen',
    'failedRetryAbsentAfterReopen',
    'failedPromptANotRevived',
    'retryStartedWhileAdvancedCollapsed',
    'retrySucceeded',
    'retryOpenedAdvancedPrompt',
    'retryFocusedPrompt',
    'retryFocusedVisiblePrompt',
    'reopenedShowsSavedA',
    'discardedBAbsent',
    'retryDidNotRevive',
    'discardDidNotWrite',
    'customPromptWriteRequests',
    'customPromptWriteSuccesses',
  ]) {
    assert.match(mainSource, new RegExp(`\\b${field}\\b`, 'u'),
      `custom prompt native proof is missing ${field}`);
    assert.match(runtimeCheckSource, new RegExp(`\\b${field}\\b`, 'u'),
      `custom prompt runtime gate is missing ${field}`);
  }
  assert.match(ipcHookSource, /const DEMO_FAILED_SOURCE_TEXT = 'Fixture source B:/);
  assert.match(ipcHookSource, /document\.documentElement\.dataset\.demoProcessPayloads = JSON\.stringify\(demoProcessPayloads\)/);
  assert.match(ipcHookSource, /demoProcessCode === 'replacement-source-once'/);
  assert.match(ipcHookSource, /const DEMO_RUNTIME_STATUSES = Object\.freeze/);
  assert.match(ipcHookSource, /demoRendererRecoveryCode === 'clipboard-residue'/);
  assert.match(ipcHookSource, /window\.slipstreamUiFixtureRecovery\?\.getStatus/);
  assert.match(ipcHookSource, /window\.slipstreamUiFixtureRecovery\?\.acknowledge/);
  assert.match(setupGateSource, /ref=\{recoveryNoticeRef\}[\s\S]*tabIndex=\{-1\}/);
  assert.match(setupGateSource, /const target = recoveryNoticeRef\.current;[\s\S]*target\.focus\(\{ preventScroll: true \}\)[\s\S]*recoveryNoticeFocusedRef\.current = document\.activeElement === target/);
  assert.match(setupGateSource, /let cancelled = false;[\s\S]*cancelled = true;[\s\S]*cancelAnimationFrame\(outerFrame\)/,
    'the recovery-notice focus handoff must survive development effect replay without leaving stale frames');
  assert.match(settingsPanelSource, /previousStatus !== 'testing'/);
  assert.match(settingsPanelSource, /connectionResultRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(mainSource, /fixtureRun === 'reply-copy-settlement-native'/);
  assert.match(mainSource, /fixtureRun === 'option-c-edit-transition-native'/);
  assert.match(mainSource, /fixtureRun === 'runtime-degraded-native'/);
  assert.match(mainSource, /fixtureRun === 'startup-recovery-native'/);
  assert.match(mainSource, /fixtureRun === 'provider-retry-native'/);
  assert.match(mainSource, /fixtureRun\s*=== 'settings-prompt-draft-recovery-native'/);
  assert.match(fixtureModeSource, /'settings-prompt-draft-recovery-native'/);
  assert.match(
    fixtureModeSource,
    /UI fixture Settings prompt draft recovery requires the fixed isolated two-failure check scenario/,
  );
  assert.match(mainSource, /fixtureRun === 'failed-source-retry-native'/);
  assert.match(mainSource, /fixtureRun === 'clipboard-residue-recovery-native'/);
  assert.match(mainSource, /fixtureRun\s*=== 'first-use-capture-text-scale-native'/);
  assert.match(mainSource, /fixtureRun\s*=== 'completed-result-text-scale-native'/);
  assert.match(mainSource, /function isCompletedResultTrustedInputFixtureUrl\(fixtureUrl\)/);
  assert.match(mainSource, /fixtureUrl\.username === ''/);
  assert.match(mainSource, /fixtureUrl\.password === ''/);
  assert.match(
    mainSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{COMPLETED_RESULT_TRUSTED_INPUT_RUN\}/,
  );
  assert.match(fixtureMainSource, /registerUiFixtureTrustedInputHandler\(fixtureWindow\)/);
  assertBefore(
    formalMainSource,
    'mainWindow = new BrowserWindow(windowOptions);',
    'uiFixtureRuntime.attachToWindow(mainWindow, { isTextScaleNativeFixture });',
    'trusted input must bind only after the fixture BrowserWindow exists',
  );
  assert.match(
    mainSource,
    /const isTextScaleNativeFixture = isSettingsTextScaleFixture\s*\|\| isFirstUseCaptureTextScaleFixture\s*\|\| isCompletedResultTextScaleFixture/,
  );
  assert.match(fixtureMainSource, /fixtureWindow\.setContentSize\(400, 400\)/);
  assert.match(fixtureMainSource, /fixtureWindow\.webContents\.setZoomFactor\(2\)/);
  assert.match(settingsPanelSource, /className="settings-panel__scroll"/,
    'the Settings fixture must have one stable application scrollport');
  assert.match(mainSource, /window\.innerWidth === 200 && window\.innerHeight === 200/,
    'the native Settings shell must be inspected at an exact 200x200 CSS viewport');
  assert.match(mainSource, /const allSectionsReachable = Object\.values\(sectionEvidence\)/,
    'the native Settings shell must prove that every major section is vertically reachable');
  assert.match(mainSource, /modeSummaryDetailRect\.top >= modeSummaryLabelRect\.bottom - 1/,
    'the 200x200 Settings proof must require the mode summary to stack');
  assert.match(mainSource, /intersectionArea: overlapArea\(privacyBadgeRect, privacyTitleRect\)/,
    'the 200x200 Settings proof must measure privacy-badge/title overlap');
  assert.match(mainSource, /allWidthsMeaningful/,
    'the 200x200 Settings proof must reject character-width editor columns');
  assert.match(mainSource, /supportGridColumns\.length === 1/,
    'the 200x200 Settings proof must require one support-card column');
  assert.match(mainSource, /advancedSummaryRect\.height >= 32/,
    'the 200x200 Settings proof must measure the advanced-summary hit target');
  assert.match(mainSource, /const allRadioGroupsHaveAuthoritativeTabStop = Object\.values\(radioGroups\)/,
    'the Settings shell must enforce one authoritative checked tab stop per radiogroup');
  assert.match(mainSource, /const focusedControlEvidence = async/,
    'the Settings shell must capture rendered focus-ring evidence');
  assert.match(mainSource, /key: 'ArrowRight'/,
    'the draft-discard fixture must drive the provider radiogroup by keyboard');
  assert.match(mainSource, /failedBackendAuthoritativeDeepSeek[\s\S]*focusTarget: false/,
    'post-failure DeepSeek evidence must not be created by fixture refocusing');
  assert.match(runtimeCheckSource, /assert\.deepEqual\(textScale\.viewport, \{ width: 200, height: 200 \}/,
    'the runtime gate must require the exact zoomed Settings viewport');
  assert.match(runtimeCheckSource, /keyboardDiscard\.failure\.focusEvidence\.ringVisible/,
    'the runtime gate must require the restored DeepSeek focus ring');
  assert.match(runtimeCheckSource, /layout\.privacyBadge\.intersectionArea, 0/,
    'the runtime gate must reject privacy-badge/title overlap');
  assert.match(runtimeCheckSource, /layout\.supportGrid\.oneColumn, true/,
    'the runtime gate must require a one-column support grid');
  assert.match(runtimeCheckSource, /layout\.advancedSummary\.rect\.height >= 32/,
    'the runtime gate must require the advanced-summary minimum height');
  assert.match(mainSource, /const keyboardReadySelector = fixtureRun === 'first-use-capture-text-scale-native'/);
  assert.match(mainSource, /getMainWindow\(\)\.webContents\.focus\(\);[\s\S]*getMainWindow\(\)\.webContents\.sendInputEvent\(\{ type: 'keyDown', keyCode: 'Tab' \}\)[\s\S]*getMainWindow\(\)\.webContents\.sendInputEvent\(\{ type: 'keyUp', keyCode: 'Tab' \}\)/,
    'every native text-scale fixture must prime real keyboard focus after its renderer is ready');
  assert.match(mainSource, /document\.activeElement\.matches\(':focus-visible'\)/,
    'the native text-scale fixture must prove that real keyboard focus is visibly rendered');
  assert.match(mainSource, /const focusStyle = getComputedStyle\(target\)/);
  assert.match(mainSource, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(mainSource, /focusVisible\s*:/,
    'the native fixture must not force focus-visible independently of real keyboard modality');
  assert.match(mainSource, /outlineWidth \+ Math\.max\(0, outlineOffset\)/,
    'the first-use text-scale fixture must measure the rendered focus outline');
  assert.match(mainSource, /choicesStacked/,
    'the first-use text-scale fixture must prove the choices form one vertical column');
  assert.match(mainSource, /headerItemsDoNotOverlap/,
    'the first-use text-scale fixture must reject overlapping header actions');
  assert.match(mainSource, /captureInitialFocusEvidence/,
    'the first-use text-scale fixture must inspect each empty-capture focus target');
  assert.match(mainSource, /safeSampleTextCorrect/,
    'the first-use text-scale fixture must verify the deterministic sample payload');
  assert.match(mainSource, /let completedResultTextScale = null/);
  assert.match(mainSource, /const actionCheckboxSelector = '\.action-completion-toggle input\[type="checkbox"\]'/,
    'the completed-result fixture must use the real action checkboxes');
  assert.match(mainSource, /\.new-capture-button\.new-capture-button--complete/,
    'the completed-result fixture must inspect the real completed return action');
  assert.match(mainSource, /#saved-terms-drawer/,
    'the completed-result fixture must inspect the real Saved Terms drawer');
  assert.match(mainSource, /searchRingOpaque/,
    'the Saved Terms text-scale proof must require an opaque rendered search ring');
  assert.match(
    mainSource,
    /focusedControlEvidence\(\s*deepSeekOption,\s*settingsScrollport,\s*'DeepSeek provider before keyboard transition'/s,
    'draft-discard keyboard evidence must use its locally proven Settings scrollport',
  );
  assert.match(targetCenterHitSource, /const rects = \[\.\.\.target\.getClientRects\(\)\]/,
    'trusted native targets must consider every rendered client rect');
  assert.match(
    targetCenterHitSource,
    /for \(let rectIndex = 0; rectIndex < rects\.length; rectIndex \+= 1\)/,
    'trusted target selection must traverse rendered client rects',
  );
  assert.match(targetCenterHitSource, /const x = Math\.floor\(rect\.left \+ rect\.width \/ 2\)/);
  assert.match(targetCenterHitSource, /const y = Math\.floor\(rect\.top \+ rect\.height \/ 2\)/);
  assert.match(
    targetCenterHitSource,
    /if \(x < 0 \|\| y < 0 \|\| x >= window\.innerWidth \|\| y >= window\.innerHeight\) continue;/,
    'an offscreen rect center must be rejected instead of moved to another coordinate',
  );
  assert.match(targetCenterHitSource, /document\.elementFromPoint\(x, y\)/,
    'trusted native clicks must first prove their hit target');
  assert.match(targetCenterHitSource, /rectIndex,/,
    'trusted target evidence must identify the client rect used');
  assert.doesNotMatch(targetCenterHitSource, /Math\.(?:max|min)\(/,
    'trusted target centers must never be clamped into the viewport');
  assert.match(mainSource, /event\.isTrusted/,
    'completed-result interactions must record browser-trusted input');
  assert.match(
    mainSource,
    /const dispatchTrustedClick = async \(\s*step,\s*target,\s*scrollport,\s*label,\s*\{ focusBeforeClick = true \} = \{\},\s*\)/s,
    'trusted mouse dispatch must require an explicit sequence step and opt-in natural-focus observation',
  );
  assert.match(mainSource, /revealEvidence\(target, scrollport, label, \{ focus: focusBeforeClick \}\)/);
  assert.match(mainSource, /trustedInputBridge\.mouseClick\(step, point\.x, point\.y\)/);
  assert.match(
    mainSource,
    /observedEvent\.clientX === point\.x\s*&& observedEvent\.clientY === point\.y/s,
    'trusted mouse evidence must prove the browser received the requested client coordinates',
  );
  assert.match(
    mainSource,
    /const evidence = \{\s*label,\s*step,\s*point,\s*\.\.\.observedEvent,\s*\};/s,
    'trusted input evidence must preserve the accepted sequence step and requested point',
  );
  assert.match(mainSource, /const dispatchTrustedKey = async \(step, key, dialog, label\)/,
    'trusted keyboard dispatch must require an explicit sequence step and key');
  assert.match(mainSource, /trustedInputBridge\.keyPress\(step, key\)/);
  assert.match(mainSource, /movedTarget\.matches\(':focus-visible'\)/,
    'trusted Tab evidence must prove browser focus-visible state');
  assert.equal(
    (completedResultProofSource.match(/await dispatchTrustedClick\(/g) || []).length,
    12,
    'completed-result proof must express four direct clicks, three looped clicks, two disclosure clicks, and three drawer clicks',
  );
  for (const step of [1, 2, 3, 4, 17, 18, 19, 23, 24]) {
    assert.match(
      completedResultProofSource,
      new RegExp(`await dispatchTrustedClick\\(\\s*${step},`),
      `completed-result proof is missing native mouse step ${step}`,
    );
  }
  assert.match(completedResultProofSource, /const firstCheckboxStep = 5 \+ index \* 3;/);
  assert.match(
    completedResultProofSource,
    /button\[data-evidence-target="action"\]\[aria-controls="source-evidence-2"\]/,
    'the evidence round trip must not pre-open the deadline disclosure under test',
  );
  assert.match(completedResultProofSource, /dispatchTrustedClick\(\s*firstCheckboxStep,/s);
  assert.match(completedResultProofSource, /dispatchTrustedClick\(\s*firstCheckboxStep \+ 1,/s);
  assert.match(completedResultProofSource, /dispatchTrustedClick\(\s*firstCheckboxStep \+ 2,/s);
  assert.match(completedResultProofSource, /initialActionCheckboxes\.length === 4/);
  assert.match(completedResultProofSource, /button#result-deadlines\.disclosure__trigger/);
  assert.match(completedResultProofSource, /#result-deadlines-panel\.disclosure__content/);
  assert.match(completedResultProofSource, /#result-deadlines-heading\.disclosure__heading/);
  assert.match(completedResultProofSource, /#result-deadlines-title/);
  assert.match(completedResultProofSource, /#result-deadlines-meta/);
  assert.match(
    completedResultProofSource,
    /await dispatchTrustedClick\(\s*23,\s*deadlineDisclosureTrigger,\s*resultView,\s*'deadline disclosure open',\s*\{ focusBeforeClick: false \},\s*\)/s,
    'deadline open must use native input without fixture-created focus',
  );
  assert.match(
    completedResultProofSource,
    /await dispatchTrustedClick\(\s*24,\s*deadlineDisclosureTrigger,\s*resultView,\s*'deadline disclosure close',\s*\{ focusBeforeClick: false \},\s*\)/s,
    'deadline close must reuse the same native trigger without fixture-created focus',
  );
  assertBefore(
    completedResultProofSource,
    "'deadline disclosure open'",
    "'deadline disclosure close'",
    'deadline disclosure must open before it closes',
  );
  assertBefore(
    completedResultProofSource,
    "'Saved Terms trigger focus restoration'",
    'const deadlineDisclosureProof = await exerciseDeadlineDisclosure();',
    'deadline pointer acceptance must run after the Saved Terms keyboard-ring journey',
  );
  assert.match(completedResultProofSource, /deadlineDisclosureIds\.ariaControls === deadlineDisclosureIds\.panel/);
  assert.match(completedResultProofSource, /deadlineDisclosureIds\.ariaLabelledBy === deadlineDisclosureIds\.title/);
  assert.match(completedResultProofSource, /deadlineDisclosureIds\.ariaDescribedBy === deadlineDisclosureIds\.meta/);
  assert.match(completedResultProofSource, /deadlineDisclosureInitial\.panelHidden/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.cardCount === 2/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.focusRetained/);
  assert.match(completedResultProofSource, /deadlineDisclosureClosed\.focusRetained/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.sameTrigger/);
  assert.match(completedResultProofSource, /deadlineDisclosureClosed\.sameTrigger/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.samePanel/);
  assert.match(completedResultProofSource, /deadlineDisclosureClosed\.samePanel/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.panelConnected/);
  assert.match(completedResultProofSource, /deadlineDisclosureClosed\.panelConnected/);
  assert.match(completedResultProofSource, /deadlineDisclosureOpen\.noHorizontalOverflow/);
  assert.match(completedResultProofSource, /deadlineDisclosureClosed\.noHorizontalOverflow/);
  assert.match(
    completedResultProofSource,
    /focusedControlEvidence\(\s*deadlineDisclosureTrigger,[\s\S]*?'open deadline disclosure trigger',[\s\S]*?\{ focusTarget: false, requireFocusVisible: false \}/s,
    'deadline open evidence must observe natural pointer focus without requiring a keyboard-only ring',
  );
  assert.match(
    completedResultProofSource,
    /focusedControlEvidence\(\s*deadlineDisclosureTrigger,[\s\S]*?'closed deadline disclosure trigger',[\s\S]*?\{ focusTarget: false, requireFocusVisible: false \}/s,
    'deadline close evidence must observe natural pointer focus without requiring a keyboard-only ring',
  );
  assert.match(completedResultProofSource, /disclosures: \{\s*deadline: deadlineDisclosureProof/s);
  assert.match(completedResultProofSource, /trustedInputEvidence\.mouse\.length === 21/,
    'completed-result proof must require all 21 native clicks');
  assert.equal(
    (completedResultProofSource.match(/await dispatchTrustedKey\(/g) || []).length,
    3,
    'completed-result proof must issue exactly two Tabs and one Escape',
  );
  assert.match(
    completedResultProofSource,
    /await dispatchTrustedKey\(20, 'Tab', termsDrawer, 'Saved Terms Tab 1'\)/,
  );
  assert.match(
    completedResultProofSource,
    /await dispatchTrustedKey\(21, 'Tab', termsDrawer, 'Saved Terms Tab 2'\)/,
  );
  assert.match(
    completedResultProofSource,
    /await dispatchTrustedKey\(22, 'Escape', termsDrawer, 'Saved Terms drawer'\)/,
  );
  assert.match(
    completedResultProofSource,
    /await trustedInputBridge\.keyPress\(1, 'Escape'\);[\s\S]*rejectedOutOfSequenceStep = true;[\s\S]*nextAcceptedStep: 1,/,
    'completed-result proof must deliberately reject a step without consuming it',
  );
  assertBefore(
    completedResultProofSource,
    "await trustedInputBridge.keyPress(1, 'Escape');",
    'await dispatchTrustedClick(\n            1,',
    'the deliberate rejection must happen before accepted mouse step 1',
  );
  assert.doesNotMatch(completedResultProofSource, /\bclick\(/,
    'completed-result proof must not activate controls with synthetic click helpers');
  assert.doesNotMatch(
    completedResultProofSource,
    /dispatchEvent\(new (?:Mouse|Keyboard)Event/,
    'completed-result proof must not synthesize DOM input events',
  );
  assert.match(completedResultProofSource, /trustedInputEvidence\.keyboard\.length === 3/);
  assert.match(
    completedResultProofSource,
    /trustedInputEvidence\.keyboard\.slice\(0, 2\)\.every\(\(evidence\) => \([\s\S]*evidence\.focusMoved[\s\S]*evidence\.focusRemainedOwned[\s\S]*evidence\.focusVisible/s,
    'completed-result proof must require both Tabs to move visible focus within the dialog',
  );
  assert.match(completedResultProofSource, /#term-import-trust-review/,
    'completed-result proof must inspect the labelled import trust review');
  assert.match(completedResultProofSource, /h3#term-import-title/,
    'completed-result proof must require a semantic import-preview heading');
  assert.match(completedResultProofSource, /document\.activeElement === importTrustReview/,
    'completed-result proof must observe the natural trust-review focus handoff');
  assert.match(completedResultProofSource, /!importConfirmInitiallyFocused/,
    'completed-result proof must reject initial focus on Confirm');
  assert.match(completedResultProofSource, /importTrustReview\.getAttribute\('role'\) === 'note'/,
    'completed-result proof must require the trust review note role');
  assert.match(completedResultProofSource, /term-import-trust-summary/);
  assert.match(completedResultProofSource, /term-import-downgrade-warning/);
  assert.match(completedResultProofSource, /Node\.DOCUMENT_POSITION_FOLLOWING/,
    'completed-result proof must require the downgrade warning before Confirm');
  assert.match(
    completedResultProofSource,
    /focusedControlEvidence\([\s\S]*importTrustReview,[\s\S]*\{ focusTarget: false, requireFullyVisible: false \}/s,
    'the oversized trust review must observe natural focus and defer full perimeter proof',
  );
  assert.match(completedResultProofSource, /importTrustFocusEvidence\.ringPerimeterReachable/,
    'the tall trust review must prove its entire focus-ring perimeter is vertically reachable');
  assert.match(completedResultProofSource, /importTrustFocusEvidence\.scrollLeftStayedZero/,
    'the trust-review ring proof must remain vertical-only');
  assert.match(completedResultProofSource, /importCancellation\.liveOwnerCount === 1/,
    'import cancellation must have exactly one matching live announcement owner');
  assert.match(completedResultProofSource, /importCancellation\.termCountBefore === 1/);
  assert.match(completedResultProofSource, /importCancellation\.termCountAfter === 1/);
  assert.match(completedResultProofSource, /document\.activeElement === importAction/,
    'import cancellation must restore focus to the initiating action');
  const completedResultCounterDatasets = [
    ['clipboardWriteRequests', 'demoClipboardWriteRequests'],
    ['processRequests', 'demoProcessRequests'],
    ['screenshotCaptureRequests', 'demoScreenshotCaptureRequests'],
    ['credentialDeleteRequests', 'demoCredentialDeleteRequests'],
    ['credentialDeleteSuccesses', 'demoCredentialDeleteSuccesses'],
    ['deepseekCredentialWriteRequests', 'demoDeepseekCredentialWriteRequests'],
    ['deepseekCredentialWriteSuccesses', 'demoDeepseekCredentialWriteSuccesses'],
    ['providerConnectionRequests', 'demoProviderConnectionRequests'],
    ['quitRequests', 'demoQuitRequests'],
    ['quitDecisionRequests', 'demoQuitDecisionRequests'],
    ['quitConfirmedDecisions', 'demoQuitConfirmedDecisions'],
  ];
  for (const [counter, dataset] of completedResultCounterDatasets) {
    assert.match(
      completedResultProofSource,
      new RegExp(`${counter}: readCompletedResultAppCounter\\(\\s*'${dataset}'`),
      `completed-result snapshot must read ${dataset}`,
    );
    assert.match(
      runtimeCheckSource,
      new RegExp(`${counter}: 0`),
      `runtime check must require zero ${counter}`,
    );
  }
  assert.match(
    completedResultProofSource,
    /const appCountersBefore = readCompletedResultAppCounters\(\);\s*ensure\(\s*Object\.values\(appCountersBefore\)\.every\(\(value\) => value === 0\)/s,
    'completed-result proof must reject any nonzero App counter before native input',
  );
  assert.match(
    completedResultProofSource,
    /const appCountersAfter = readCompletedResultAppCounters\(\);\s*ensure\(\s*Object\.values\(appCountersAfter\)\.every\(\(value\) => value === 0\)/s,
    'completed-result proof must reject any nonzero App counter after native input',
  );
  assert.match(completedResultProofSource, /sourceTextClone\?\.querySelectorAll\('\.source-evidence__number'\)/);
  assert.match(completedResultProofSource, /const sourceMatchesPreview = renderedSourceText === expectedPreviewSource/);
  assert.match(completedResultProofSource, /const footerControlEntries = \[/);
  assert.match(completedResultProofSource, /allFocusEvidenceVisible: footerFocusVisible/);
  assert.match(
    runtimeCheckSource,
    /\?demo=result&terms=sample&fixture=check&trapPort=\$\{trapPort\}&run=\$\{run\}/,
    'the runtime launcher must wire the exact fixed completed-result scenario',
  );
  assert.match(
    runtimeCheckSource,
    /expectedSteps: 24,[\s\S]*acceptedSteps: 24,[\s\S]*rejectedSteps: 1,[\s\S]*nextStep: 25,[\s\S]*complete: true,[\s\S]*mouseActions: 21,[\s\S]*mouseInputEvents: 63,[\s\S]*keyActions: 3,[\s\S]*keyInputEvents: 6,/,
    'runtime check must require the complete 24-step native-input state',
  );
  assert.match(runtimeCheckSource, /evidence\.clientX, evidence\.point\.x/);
  assert.match(runtimeCheckSource, /evidence\.clientY, evidence\.point\.y/);
  assert.match(runtimeCheckSource, /\['Saved Terms Tab 1', 'Saved Terms Tab 2', 'Saved Terms drawer'\]/);
  assert.match(runtimeCheckSource, /'Saved Terms import preview'/);
  assert.match(runtimeCheckSource, /'Saved Terms import cancel'/);
  assert.match(runtimeCheckSource, /'deadline disclosure open'/);
  assert.match(runtimeCheckSource, /'deadline disclosure close'/);
  assert.match(runtimeCheckSource, /completedResultTextScale\.disclosures\?\.deadline/);
  assert.match(runtimeCheckSource, /completedDeadlineDisclosure\.open\.cardCount, 2/);
  assert.match(runtimeCheckSource, /completedDeadlineDisclosure\.open\.focusRetained, true/);
  assert.match(runtimeCheckSource, /completedDeadlineDisclosure\.closed\.focusRetained, true/);
  assert.match(runtimeCheckSource, /completedDeadlineDisclosure\.open\.noHorizontalOverflow, true/);
  assert.match(runtimeCheckSource, /completedDeadlineDisclosure\.closed\.noHorizontalOverflow, true/);
  assert.match(
    runtimeCheckSource,
    /assertPointerFocusEvidence\(\s*completedDeadlineDisclosure\.open\.focusEvidence/s,
  );
  assert.match(
    runtimeCheckSource,
    /assertPointerFocusEvidence\(\s*completedDeadlineDisclosure\.closed\.focusEvidence/s,
  );
  assert.match(runtimeCheckSource, /completedTerms\.importTrustPreview\.downgradedProvenanceCount, 1/);
  assert.match(runtimeCheckSource, /completedTerms\.importTrustPreview\.autoFocused, true/);
  assert.match(runtimeCheckSource, /completedTerms\.importTrustPreview\.confirmInitiallyFocused, false/);
  assert.match(runtimeCheckSource, /completedTerms\.importTrustPreview\.confirmDescribedByTrust, true/);
  assert.match(runtimeCheckSource, /completedTerms\.importTrustPreview\.warningPrecedesConfirm, true/);
  assert.match(runtimeCheckSource, /importTrustFocus\.topRingReachable, true/);
  assert.match(runtimeCheckSource, /importTrustFocus\.bottomRingReachable, true/);
  assert.match(runtimeCheckSource, /importTrustFocus\.ringPerimeterReachable, true/);
  assert.match(runtimeCheckSource, /liveOwnerCount: 1,[\s\S]*termCountBefore: 1,[\s\S]*termCountAfter: 1,[\s\S]*termsUnchanged: true,[\s\S]*previewRemoved: true,[\s\S]*focusReturnedToImport: true,/s);
  assert.match(floatingPanelSource, /setInputText\(PREVIEW_SOURCE_TEXT\)/);
  assert.match(floatingPanelSource, /setProcessedSourceText\(PREVIEW_SOURCE_TEXT\)/);
  assert.match(floatingPanelSource, /setBrief\(PREVIEW_ACTION_BRIEF\)/);
  assert.match(floatingPanelSource, /from '@preview-data'/);
  assert.match(previewDataSource, /const PREVIEW_ACTION_BRIEF = \{/);
  assert.match(previewDataSource, /status: 'partial'/);
  assert.match(previewDataSource, /const PREVIEW_SOURCE_TEXT = SAFE_SAMPLE_SOURCE_TEXT/);
  assert.match(safeSampleSource, /const SAFE_SAMPLE_SOURCE_TEXT = `Dear Student,/);
  assert.match(productionPreviewDataSource, /const PREVIEW_ACTION_BRIEF = null/);
  assert.match(productionPreviewDataSource, /const PREVIEW_CAPTURE = null/);
  assert.doesNotMatch(
    productionPreviewDataSource,
    /preview-university-services-email|action-brief-preview|verify-evisa-guidance/,
    'production preview data must not retain any synthetic structured-result marker',
  );
  assert.match(resultDisplaySource, /data-mobile-pane=\{mobilePane\}/);
  assert.match(resultDisplaySource, /className="action-completion-toggle"/);
  assert.match(resultDisplaySource, /\? '完成并返回' : '清空并返回'/);
  assert.match(savedTermsLibrarySource, /id="saved-terms-drawer"/);
  assert.match(savedTermsLibrarySource, /aria-modal="true"/);
  assert.match(
    savedTermsLibrarySource,
    /window\.requestAnimationFrame\(\(\) => \{[\s\S]*document\.activeElement !== target[\s\S]*dialog\.scrollTop/su,
    'a deferred modal-focus scroll must not override focus the user already moved elsewhere',
  );
  assert.match(savedTermsLibrarySource, /id="saved-term-drawer-search"/);
  assert.match(savedTermsLibrarySource, /data-saved-term-copy-action=\{kind\}/);
  assert.match(savedTermsLibrarySource, /data-saved-term-remove-id=\{term\.id\}/);
  assert.match(savedTermsLibrarySource, />\s*导出备份\s*</);
  assert.match(savedTermsLibrarySource, />\s*导入备份\s*</);
  assert.match(savedTermsLibrarySource, /id="term-import-trust-review"/);
  assert.match(savedTermsLibrarySource, /role="note"/);
  assert.match(savedTermsLibrarySource, /tabIndex=\{-1\}/);
  assert.match(savedTermsLibrarySource, /aria-labelledby="term-import-trust-title"/);
  assert.match(savedTermsLibrarySource, /id="term-import-trust-summary"/);
  assert.match(savedTermsLibrarySource, /id="term-import-downgrade-warning"/);
  assert.match(savedTermsLibrarySource, /aria-describedby=\{importConfirmDescriptionIds\}/,
    'the import confirmation must expose its trust explanation to assistive technology');
  assert.match(fixtureRecoveryHandlerSource, /activeRisk: Object\.freeze\(\{ id: crypto\.randomUUID\(\) \}\)/);
  assert.match(fixtureRecoveryHandlerSource, /storedRiskKeys: Object\.freeze\(\['id'\]\)/);
  assert.match(fixtureRecoveryHandlerSource, /id !== uiFixtureClipboardResidueProbe\.activeRisk\.id/);
  assert.doesNotMatch(fixtureRecoveryHandlerSource, /clipboard\.(?:readText|writeText|clear)\(/,
    'fixture recovery state must not access the system clipboard');
  assert.match(mainSource, /getMainWindow\(\)\.webContents\.reload\(\)/,
    'clipboard residue fixture must prove state across a renderer reload');
  assert.match(mainSource, /invalidAcknowledgementPreservedWarning/);
  assert.match(mainSource, /exactAcknowledgementReleasedRisk/);
  assert.match(mainSource, /warningExplainsManualOverwriteOnly/);
  assert.match(mainSource, /noAutomaticClipboardAction/);
  assert.match(mainSource, /clipboardCountersAreSafeIntegers/);
  assert.match(mainSource, /noClipboardOperations/);
  assert.match(mainSource, /retryPayloadMatchesCorrectedB/,
    'the native fixture must prove that retry submits corrected source B rather than visible result A or original B');
  assert.match(mainSource, /document\.activeElement === recoveryNotice/);
  assert.match(mainSource, /document\.activeElement === connectedResult/);
  assert.match(mainSource, /requestsAfterDelayedWindow === 0/,
    'the native fixture must prove an edited source does not dispatch during the delayed window');
  assert.match(mainSource, /reopenedInput\.value !== capturedSource/,
    'the native fixture must prove the processed source is not the stale captured original');
  assert.match(mainSource, /\[data-reply-copy-action\]/);
  assert.match(mainSource, /\[data-saved-term-copy-action\]/);
  assert.match(mainSource, /\[data-support-diagnostics-copy-action\]/);
  assert.match(mainSource, /\[data-connection-recovery-copy-action="true"\]/);
  assert.match(mainSource, /\[data-clipboard-kind="reply"\]\[data-clipboard-status="retained"\]/);
  assert.match(mainSource, /\[data-clipboard-kind="reply"\]\[data-clipboard-status="outdated"\]/);
  assert.match(mainSource, /\[data-clipboard-consequence-ack\]/);
  assert.match(mainSource, /manualOverwriteAcknowledgementVisible/);
  assert.match(mainSource, /manualOverwriteAcknowledged/);
  assert.match(mainSource, /acknowledgementDidNotWrite/);
  assert.match(resultDisplaySource, /await onAcknowledgeClipboardConsequence\(consequenceId\)/,
    'manual-overwrite acknowledgement must forward the current rendered consequence ID');
  assert.match(appSource, /const requestedId = typeof expectedId === 'string' \? expectedId : null/);
  assert.match(appSource, /requestedId && requestedId !== consequenceId/,
    'the application must reject acknowledgement for a stale consequence ID');
  assert.match(appSource, /APP_CLIPBOARD_RESIDUE_RISK_ACK, \{\s*id: consequenceId,\s*\}/s,
    'the application must acknowledge the exact current consequence ID');
  for (const marker of [
    ['demoClipboard', 'ClearRequests'].join(''),
    ['demoNativeClipboard', 'ClearStubs'].join(''),
    ['clipboardQuit', 'ClearSettlement'].join(''),
    ['isClipboardQuit', 'ClearSettlementRun'].join(''),
  ]) {
    assert.equal(mainSource.includes(marker), false,
      'native main-process proofs must not depend on retired clipboard mutation counters');
  }
  assert.match(resultDisplaySource, /data-result-copy-action/);
  assert.match(resultDisplaySource, /data-actions-copy-action/);
  assert.match(resultDisplaySource, /data-source-link-copy-action/);
}

function collectChildOutput(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-200_000);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-200_000);
  });
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function monitorExit(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function probeHttp(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Vite can spend tens of seconds faulting cold dependencies into memory on
// macOS before it begins listening. Keep the wait bounded, but align it with
// the native Electron launch allowance below so cold I/O is not misreported
// as a product regression.
const viteServerStartupTimeoutMs = 90_000;

async function waitForHttp(url, child) {
  const deadline = Date.now() + viteServerStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Vite exited before the runtime fixture check');
    if (await probeHttp(url)) return;
    await wait(100);
  }
  throw new Error('Timed out waiting for runtime fixture Vite server');
}

async function waitWithTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A cold macOS launch can spend tens of seconds loading Electron/Vite native
// dependencies before the fixture emits any output. Retain a hard bound while
// avoiding a false product failure on that startup path.
const nativeFixtureRuntimeTimeoutMs = 90_000;

async function stopChild(child, exitPromise) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  child.kill('SIGTERM');
  try {
    await waitWithTimeout(exitPromise, 2_000, 'child did not stop after SIGTERM');
    return true;
  } catch {
    child.kill('SIGKILL');
    try {
      await waitWithTimeout(exitPromise, 2_000, 'child did not stop after SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

async function checkNativeElectronRuntime() {
  const outputPrefix = '__SLIPSTREAM_UI_FIXTURE_CHECK__';
  const networkTrap = await startNetworkTrap();
  let ownedDirectory = null;
  let vite = null;
  let viteExit = null;
  let electron = null;
  let electronExit = null;
  try {
    ownedDirectory = createOwnedUserDataDirectory();
    const port = await findAvailableLoopbackPort();
    const rendererUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${port}/?demo=setup&fixture=check&trapPort=${networkTrap.port}`,
    );
    const childEnvironment = sanitizeFixtureEnvironment({
      ...process.env,
      OPENAI_API_KEY: 'must-not-reach-fixture',
      SSH_AUTH_SOCK: '/tmp/must-not-reach-fixture.sock',
      NODE_OPTIONS: '--require=/tmp/must-not-run.js',
    });
    const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    vite = spawn(process.execPath, [
      viteEntry,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--strictPort',
    ], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteExit = monitorExit(vite);
    const viteOutput = collectChildOutput(vite);
    try {
      await waitForHttp(rendererUrl, vite);
    } catch (error) {
      throw new Error([
        error.message,
        `Vite stdout tail:\n${viteOutput.stdout.slice(-10_000)}`,
        `Vite stderr tail:\n${viteOutput.stderr.slice(-10_000)}`,
      ].join('\n'));
    }

    electron = spawn(require('electron'), ['.', '--dev', UI_FIXTURE_FLAG], {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        [UI_FIXTURE_RENDERER_URL_ENV]: rendererUrl,
        [UI_FIXTURE_USER_DATA_ENV]: ownedDirectory.realPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    electronExit = monitorExit(electron);
    const electronOutput = collectChildOutput(electron);
    let outcome;
    try {
      outcome = await waitWithTimeout(
        electronExit,
        nativeFixtureRuntimeTimeoutMs,
        'Native Electron fixture runtime check timed out',
      );
    } catch (error) {
      throw new Error([
        error.message,
        `Electron stdout tail:\n${electronOutput.stdout.slice(-20_000)}`,
        `Electron stderr tail:\n${electronOutput.stderr.slice(-20_000)}`,
        `Vite stderr tail:\n${viteOutput.stderr.slice(-10_000)}`,
      ].join('\n'));
    }
    assert.ifError(outcome.error);
    assert.equal(outcome.signal, null, `Electron fixture terminated by ${outcome.signal}`);
    assert.equal(outcome.code, 0, `Electron fixture failed:\n${electronOutput.stdout}\n${electronOutput.stderr}\n${viteOutput.stderr}`);

    const markerIndex = electronOutput.stdout.lastIndexOf(outputPrefix);
    assert.notEqual(markerIndex, -1, `Electron fixture did not emit its check payload:\n${electronOutput.stdout}`);
    const payloadLine = electronOutput.stdout.slice(markerIndex + outputPrefix.length).split(/\r?\n/u)[0];
    const payload = JSON.parse(payloadLine);
    assert.equal(payload.success, true, payload.error || 'runtime fixture reported failure');
    assert.equal(payload.isPackaged, false);
    assert.equal(payload.rendererUrlExact, true);
    assert.equal(payload.userDataIsFixture, true);
    assert.equal(payload.sessionDataIsNested, true);
    assert.equal(payload.contextIsolation, true);
    assert.equal(payload.nodeIntegrationDisabled, true);
    assert.equal(payload.sandboxEnabled, true);
    if (payload.productionPreloadExcluded !== undefined) {
      assert.equal(payload.productionPreloadExcluded, true);
    }
    assert.equal(payload.trayCreated, false);
    assert.equal(payload.shortcutsRegistered, false);
    assert.equal(payload.applicationMenuSafe, true);
    assert.equal(payload.inheritedSecretsPresent, false);
    assert.equal(payload.sessionTrapFetchBlocked, true);
    assert.deepEqual(payload.renderer.marker, { enabled: true, isolated: true });
    assert.equal(payload.renderer.dataset, 'native-isolated');
    assert(payload.renderer.setupTitle.length > 0);
    assert.equal(payload.renderer.settingsIpcRejected, true);
    assert.equal(payload.renderer.clipboardStubbed, true);
    assert.equal(networkTrap.requestCount, 0, 'fixture renderer request reached the blocked loopback trap');
    assert.equal(payload.renderer.sameOriginFetchAllowed, true);
    assert.equal(payload.renderer.nodeGlobalsUnavailable, true);

    electron = null;
    electronExit = null;
    removeOwnedUserDataDirectory(ownedDirectory);
    ownedDirectory = null;

    ownedDirectory = createOwnedUserDataDirectory();
    const editRendererUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${port}/?demo=capture&backend=openai&activeCapture=source-edit-transition&fixture=check&trapPort=${networkTrap.port}&run=option-c-edit-transition-native`,
    );
    await waitForHttp(editRendererUrl, vite);
    electron = spawn(require('electron'), ['.', '--dev', UI_FIXTURE_FLAG], {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        [UI_FIXTURE_RENDERER_URL_ENV]: editRendererUrl,
        [UI_FIXTURE_USER_DATA_ENV]: ownedDirectory.realPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    electronExit = monitorExit(electron);
    const editElectronOutput = collectChildOutput(electron);
    const editOutcome = await waitWithTimeout(
      electronExit,
      20_000,
      'Option+C edit-transition native fixture timed out',
    );
    assert.ifError(editOutcome.error);
    assert.equal(editOutcome.signal, null,
      `Option+C edit-transition fixture terminated by ${editOutcome.signal}`);
    assert.equal(editOutcome.code, 0,
      `Option+C edit-transition fixture failed:\n${editElectronOutput.stdout}\n${editElectronOutput.stderr}\n${viteOutput.stderr}`);

    const editMarkerIndex = editElectronOutput.stdout.lastIndexOf(outputPrefix);
    assert.notEqual(editMarkerIndex, -1,
      `Option+C edit-transition fixture did not emit its check payload:\n${editElectronOutput.stdout}`);
    const editPayloadLine = editElectronOutput.stdout
      .slice(editMarkerIndex + outputPrefix.length)
      .split(/\r?\n/u)[0];
    const editPayload = JSON.parse(editPayloadLine);
    assert.equal(editPayload.success, true,
      editPayload.error || 'Option+C edit-transition fixture reported failure');
    assert.equal(editPayload.isPackaged, false);
    assert.equal(editPayload.rendererUrlExact, true);
    assert.equal(editPayload.userDataIsFixture, true);
    assert.equal(editPayload.sessionDataIsNested, true);
    assert.equal(editPayload.contextIsolation, true);
    assert.equal(editPayload.nodeIntegrationDisabled, true);
    assert.equal(editPayload.sandboxEnabled, true);
    assert.equal(editPayload.trayCreated, false);
    assert.equal(editPayload.shortcutsRegistered, false);
    assert.equal(editPayload.applicationMenuSafe, true);
    assert.equal(editPayload.inheritedSecretsPresent, false);
    assert.equal(editPayload.sessionTrapFetchBlocked, true);
    assert.deepEqual(editPayload.renderer.marker, { enabled: true, isolated: true });
    assert.equal(editPayload.renderer.dataset, 'native-isolated');
    assert.equal(editPayload.renderer.settingsIpcRejected, true);
    assert.equal(editPayload.renderer.clipboardStubbed, true);
    assert.equal(editPayload.renderer.sameOriginFetchAllowed, true);
    assert.equal(editPayload.renderer.nodeGlobalsUnavailable, true);

    const editTransition = editPayload.renderer.optionCEditTransition;
    assert.ok(editTransition, 'native fixture did not return Option+C edit-transition evidence');
    assert.equal(editTransition.captureArrivedBeforeDispatch, true);
    assert.equal(editTransition.editedDuringTransition, true);
    assert.equal(editTransition.staleRequestBlocked, true);
    assert.equal(editTransition.pauseNoticeVisible, true);
    assert.equal(editTransition.pauseNoticeExplainsManualSubmit, true);
    assert.equal(editTransition.latestDraftPreserved, true);
    assert.equal(editTransition.explicitSubmitStartedOnce, true);
    assert.equal(editTransition.reopenedEditedSource, true);
    assert.equal(editTransition.staleCapturedSourceRejected, true);
    assert.equal(editTransition.processRequests, 1);
    assert.ok(editTransition.viewport.width >= 400 && editTransition.viewport.width <= 520,
      `expected a compact native capture width, got ${editTransition.viewport.width}`);
    assert.ok(editTransition.viewport.height >= 400,
      `expected a usable native capture height, got ${editTransition.viewport.height}`);
    assert.equal(networkTrap.requestCount, 0,
      'Option+C edit-transition fixture reached the blocked loopback trap');

    electron = null;
    electronExit = null;
    removeOwnedUserDataDirectory(ownedDirectory);
    ownedDirectory = null;

  } finally {
    const [electronStopped, viteStopped] = await Promise.all([
      stopChild(electron, electronExit),
      stopChild(vite, viteExit),
    ]);
    if (electronStopped && viteStopped) removeOwnedUserDataDirectory(ownedDirectory);
    else console.error('Preserved UI fixture userData because a child process did not stop');
    await networkTrap.close();
  }
}

async function main() {
  checkOwnedFixtureClipboardContract();
  checkRendererUrls();
  checkUserDataAndResolver();
  checkEnvironmentSanitization();
  checkStackedStatusTextScaleContract();
  checkLazyWorkspaceRecoveryContract();
  checkSettingsStylesheetCollisionContract();
  await checkLauncherContract();
  checkNativeElectronBinding();
  await checkNativeElectronRuntime();
  console.log('Native Electron UI fixture checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
