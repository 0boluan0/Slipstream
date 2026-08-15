const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const {
  chmodSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createServer } = require('node:http');
const {
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} = require('node:path');
const {
  sanitizeFixtureEnvironment,
  validateFixtureRendererUrl,
  validateFixtureUserDataPath,
} = require('../src/main/ui-fixture-mode');
const {
  createOwnedUserDataDirectory,
  findAvailableLoopbackPort,
  removeOwnedUserDataDirectory,
} = require('./run-ui-fixture.js');

const projectRoot = join(__dirname, '..');
const workspaceRoot = join(projectRoot, '..');
const evidenceRoot = join(workspaceRoot, 'docs', 'ux-evidence');
const scriptPath = __filename;
const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const harnessFlag = '--screen-reader-semantics-runtime-harness';
const resultUrlEnvironment = 'SLIPSTREAM_SCREEN_READER_RESULT_URL';
const setupUrlEnvironment = 'SLIPSTREAM_SCREEN_READER_SETUP_URL';
const captureUrlEnvironment = 'SLIPSTREAM_SCREEN_READER_CAPTURE_URL';
const userDataEnvironment = 'SLIPSTREAM_SCREEN_READER_USER_DATA';
const evidenceDirEnvironment = 'SLIPSTREAM_SCREEN_READER_EVIDENCE_DIR';
const outputPrefix = '__SLIPSTREAM_SCREEN_READER_SEMANTICS_RUNTIME__';
const timeoutMs = 90_000;
// A fresh macOS process may spend tens of seconds loading Vite's native
// dependency graph from a cold filesystem. Keep renderer readiness bounded,
// but do not misclassify that cold start as an accessibility regression.
const rendererStartupTimeoutMs = 90_000;
const replyMediaFeatures = Object.freeze({
  normal: Object.freeze([
    Object.freeze({ name: 'prefers-reduced-motion', value: 'reduce' }),
    Object.freeze({ name: 'prefers-contrast', value: 'no-preference' }),
    Object.freeze({ name: 'forced-colors', value: 'none' }),
  ]),
  forced: Object.freeze([
    Object.freeze({ name: 'prefers-reduced-motion', value: 'reduce' }),
    Object.freeze({ name: 'prefers-contrast', value: 'no-preference' }),
    Object.freeze({ name: 'forced-colors', value: 'active' }),
  ]),
});

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function modeBits(targetPath) {
  return statSync(targetPath).mode & 0o777;
}

function isDescendant(parent, candidate) {
  const childPath = relative(parent, candidate);
  return childPath !== '' && !childPath.startsWith('..') && !isAbsolute(childPath);
}

function validateEvidenceDirectory(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!isAbsolute(value) || normalize(value) !== value) {
    throw new TypeError('--evidence-dir must be a normalized absolute path');
  }
  const canonicalRoot = realpathSync(evidenceRoot);
  const canonicalDirectory = realpathSync(value);
  if (!statSync(canonicalDirectory).isDirectory() || !isDescendant(canonicalRoot, canonicalDirectory)) {
    throw new TypeError('--evidence-dir must be an existing directory below docs/ux-evidence');
  }
  return canonicalDirectory;
}

function parseArguments(argv) {
  let evidenceDirectory = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let value;
    if (argument === '--evidence-dir') {
      index += 1;
      value = argv[index];
    } else if (argument.startsWith('--evidence-dir=')) {
      value = argument.slice('--evidence-dir='.length);
    } else {
      throw new Error(`Unknown screen-reader runtime argument: ${argument}`);
    }
    if (evidenceDirectory !== null || typeof value !== 'string' || !value) {
      throw new Error('--evidence-dir may be provided once with a value');
    }
    evidenceDirectory = validateEvidenceDirectory(value);
  }
  return Object.freeze({ evidenceDirectory });
}

function secretLikeEnvironmentName(value) {
  const name = String(value).normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLowerCase();
  return new Set([
    'sshauthsock',
    'nodeoptions',
    'nodepath',
    'electronrunasnode',
    'dyldinsertlibraries',
    'ldpreload',
  ]).has(name)
    || name.includes('apikey')
    || name.includes('token')
    || name.includes('secret')
    || name.includes('password')
    || name.includes('passwd')
    || name.includes('credential')
    || name.includes('privatekey')
    || name.includes('accesskey')
    || name.includes('authorization')
    || name.includes('authentication')
    || name === 'auth'
    || name.endsWith('auth')
    || name === 'key'
    || name.endsWith('key');
}

function startNetworkTrap() {
  return new Promise((resolveTrap, reject) => {
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(204).end();
    });
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address !== 'object' || !Number.isInteger(address.port)) {
        server.close();
        reject(new Error('Failed to start the screen-reader semantics network trap'));
        return;
      }
      resolveTrap({
        port: address.port,
        get requestCount() {
          return requestCount;
        },
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        }),
      });
    });
  });
}

function monitorChild(command, args, options) {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  let outcome = null;
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-150_000);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-150_000);
  });
  const exit = new Promise((resolveExit) => {
    const finish = (result) => {
      if (outcome) return;
      outcome = Object.freeze({ ...result, stdout, stderr });
      resolveExit(outcome);
    };
    child.once('error', (error) => finish({ error, code: null, signal: null }));
    child.once('exit', (code, signal) => finish({ error: null, code, signal }));
  });
  return {
    child,
    exit,
    get outcome() {
      return outcome;
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function terminateChild(monitor) {
  if (!monitor || monitor.outcome) return;
  monitor.child.kill('SIGTERM');
  await Promise.race([monitor.exit, delay(2_000)]);
  if (!monitor.outcome) {
    monitor.child.kill('SIGKILL');
    await monitor.exit;
  }
}

async function waitForRenderer(rendererUrl, viteMonitor) {
  const deadline = Date.now() + rendererStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (viteMonitor.outcome) {
      throw new Error(`Vite exited before the screen-reader renderer was ready: ${viteMonitor.outcome.stderr}`);
    }
    try {
      const response = await fetch(rendererUrl, { signal: AbortSignal.timeout(750) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Vite may still be starting.
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for the loopback screen-reader renderer\n${viteMonitor.stdout}\n${viteMonitor.stderr}`,
  );
}

function parseHarnessProof(outcome) {
  const marker = outcome.stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(outputPrefix));
  const proof = marker ? JSON.parse(marker.slice(outputPrefix.length)) : null;
  assert.equal(
    outcome.code,
    0,
    `Screen-reader Electron harness exited unexpectedly (${outcome.signal || outcome.code})\n${proof?.error || outcome.stderr}`,
  );
  assert.ok(marker, `Screen-reader Electron harness did not emit proof\n${outcome.stdout}`);
  return proof;
}

function inferredLanguage(text, fallback = 'und') {
  const value = typeof text === 'string' ? text.normalize('NFKC') : '';
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /\p{Script=Latin}/u.test(value);
  if (hasHan && hasLatin) return 'mul';
  if (hasHan) return 'zh-CN';
  if (hasLatin) return 'en';
  return fallback;
}

function assertLanguageRows(rows, label, fallback = 'en') {
  assert.ok(rows.length > 0, `${label} did not expose any language boundaries`);
  for (const row of rows) {
    assert.equal(
      row.language,
      inferredLanguage(row.text, fallback),
      `${label} used ${row.language} for ${JSON.stringify(row.text)}`,
    );
  }
}

function axHas(inventory, role, namePart = null) {
  const normalizedRole = role.toLowerCase();
  return inventory.some((entry) => (
    entry.role.toLowerCase() === normalizedRole
    && (namePart === null || entry.name.includes(namePart))
  ));
}

function assertAx(inventory, role, namePart, label) {
  assert.equal(
    axHas(inventory, role, namePart),
    true,
    `${label} AX tree is missing ${role}${namePart ? ` named ${namePart}` : ''}`,
  );
}

function assertDisclosureAx(inventory, {
  title,
  description,
  expanded,
  panelId,
}, label) {
  const headings = inventory.filter((entry) => (
    entry.role.toLowerCase() === 'heading' && entry.name === title
  ));
  assert.equal(headings.length, 1, `${label} must expose one named heading`);
  assert.equal(headings[0].level, 2, `${label} must preserve the result H1 to H2 outline`);

  const buttons = inventory.filter((entry) => (
    entry.role.toLowerCase() === 'button' && entry.name === title
  ));
  assert.equal(buttons.length, 1, `${label} must expose one concise trigger name`);
  assert.equal(buttons[0].description, description, `${label} metadata must be a description`);
  assert.equal(buttons[0].expanded, expanded, `${label} expanded state is stale`);
  if (expanded || buttons[0].controls.length > 0) {
    assert.deepEqual(buttons[0].controls, [panelId], `${label} must control its stable panel`);
  }
  return buttons[0];
}

function assertReplyStatusFocusGeometry(proof, label, {
  columns,
  compactInset,
  forcedColors,
  stacked,
  viewport,
  zoomFactor,
}) {
  assert.deepEqual(proof.viewport, viewport, `${label} used an unexpected CSS viewport`);
  assert.equal(proof.zoomFactor, zoomFactor, `${label} used an unexpected native zoom factor`);
  assert.equal(proof.forcedColorsActive, forcedColors, `${label} forced-colors state is stale`);
  assert.equal(proof.radioFocused, true, `${label} did not retain radio focus`);
  assert.equal(proof.radioFocusVisible, true, `${label} did not expose keyboard focus`);
  assert.equal(proof.radioRect.width, 16, `${label} radio width changed`);
  assert.equal(proof.radioRect.height, 16, `${label} radio height changed`);
  assert.equal(proof.radioSquare, true, `${label} radio stretched out of square`);
  assert.equal(proof.radioAlignSelf, 'start', `${label} radio can stretch along the grid row`);
  assert.equal(proof.radioJustifySelf, 'start', `${label} radio alignment changed`);
  assert.equal(proof.radioInsideLabel, true, `${label} radio escaped its status card`);
  assert.equal(proof.inputOutline.visible, false, `${label} retained a duplicate input ring`);
  assert.equal(proof.inputOutline.style, 'none', `${label} input outline style is not suppressed`);
  assert.equal(proof.labelOutline.visible, true, `${label} lost the whole-card focus ring`);
  assert.ok(proof.labelOutline.width >= 3, `${label} whole-card focus ring is too thin`);
  if (forcedColors) {
    assert.equal(proof.labelSelected, true, `${label} did not exercise the selected forced-color card`);
    assert.notEqual(
      proof.labelOutline.color,
      proof.labelBackground,
      `${label} focus ring disappears into the selected-card background`,
    );
    assert.equal(
      proof.labelOutline.color,
      proof.labelTextColor,
      `${label} selected-card ring must use the contrasting HighlightText color`,
    );
  }
  if (compactInset) {
    assert.ok(
      proof.labelOutline.offset <= -proof.labelOutline.width,
      `${label} compact focus ring is not inset from the clipping boundary`,
    );
  } else {
    assert.ok(proof.labelOutline.offset >= 2, `${label} ordinary whole-card ring lost its offset`);
  }
  assert.equal(proof.visibleFocusOutlineCount, 1, `${label} must render exactly one focus outline`);
  assert.equal(
    proof.cardRingContained,
    true,
    `${label} whole-card focus ring is clipped: ${JSON.stringify(proof.cardRingContainment)}`,
  );
  assert.equal(proof.labelsStacked, stacked, `${label} status-card stacking is incorrect`);
  assert.equal(proof.gridColumnCount, columns, `${label} status-picker column count is incorrect`);
  assert.ok(proof.labelRect.height >= 32, `${label} status card is shorter than 32px`);
  assert.equal(proof.pageNoHorizontalOverflow, true, `${label} page overflowed horizontally`);
  assert.equal(proof.dialogNoHorizontalOverflow, true, `${label} reply drawer overflowed horizontally`);
  assert.equal(proof.pickerNoHorizontalOverflow, true, `${label} status picker overflowed horizontally`);
}

function assertRuntimeProof(proof, networkTrap, expectedEvidenceDirectory) {
  assert.equal(proof.success, true, proof.error || 'Screen-reader runtime proof failed');
  assert.equal(proof.urls.resultExact, true);
  assert.equal(proof.urls.setupExact, true);
  assert.equal(proof.urls.captureExact, true);
  assert.equal(proof.urls.sameLoopbackOrigin, true);
  assert.equal(proof.isolation.userDataIsFixture, true);
  assert.equal(proof.isolation.userDataMode, 0o700);
  assert.equal(proof.isolation.sessionDataIsNested, true);
  assert.equal(proof.isolation.sessionDataMode, 0o700);
  assert.equal(proof.isolation.normalProfileExcluded, true);
  assert.equal(proof.isolation.pathsSetBeforeReady, true);
  assert.equal(proof.isolation.resultWindowHidden, true);
  assert.equal(proof.isolation.setupWindowHidden, true);
  assert.equal(proof.isolation.captureWindowHidden, true);
  assert.equal(proof.isolation.contextIsolation, true);
  assert.equal(proof.isolation.nodeIntegrationDisabled, true);
  assert.equal(proof.isolation.sandboxEnabled, true);
  assert.equal(proof.isolation.inheritedSecretLikeEnvironmentKeys, 0);
  assert.equal(proof.isolation.permissionRequestHandlerDenies, true);
  assert.equal(proof.isolation.permissionCheckHandlerDenies, true);
  assert.equal(proof.network.sessionTrapFetchBlocked, true);
  assert.equal(proof.network.rendererTrapFetchBlocked, true);
  assert.ok(proof.network.blockedProbeRequests >= 1);
  assert.deepEqual(proof.network.unexpectedExternalUrls, []);
  assert.equal(networkTrap.requestCount, 0, 'the isolated renderer reached the network trap');
  assert.deepEqual(proof.renderer.marker, { enabled: true, isolated: true });
  assert.equal(proof.renderer.nodeGlobalsUnavailable, true);
  assert.equal(proof.renderer.clipboardStubbed, true);

  assert.equal(proof.dom.result.rootLanguage, 'zh-CN');
  assert.equal(proof.dom.result.sourcePaperLanguage, 'en');
  assert.equal(proof.dom.result.mainCount, 1);
  assert.equal(proof.dom.result.mainLabelledBy, 'result-headline');
  assert.equal(proof.dom.result.mainContainsHeading, true);
  assert.equal(proof.dom.result.mainHeadingVisible, true);
  assert.ok(proof.dom.result.mainHeadingText.length > 0);
  const expectedDisclosureTitles = [
    ['result-translation', '完整翻译'],
    ['result-explanation', '补充解释'],
    ['result-materials', '材料清单'],
    ['result-deadlines', '截止日期'],
    ['result-terms', '词语与术语'],
    ['result-context', '流程背景'],
    ['result-sources', '官方来源'],
    ['result-verification', '待核验'],
  ];
  const collapsedDisclosures = proof.dom.resultDisclosuresCollapsed;
  assert.deepEqual(
    collapsedDisclosures.entries.map(({ id, title }) => [id, title]),
    expectedDisclosureTitles,
    'the completed-result fixture disclosure title set changed',
  );
  assert.equal(collapsedDisclosures.exactFixtureSet, true);
  assert.equal(collapsedDisclosures.uniqueIdReferences, true);
  assert.equal(collapsedDisclosures.uniqueReferenceValues, true);
  assert.equal(collapsedDisclosures.commonPanelRegionCount, 0);
  for (const entry of collapsedDisclosures.entries) {
    assert.equal(entry.triggerId, entry.id);
    assert.equal(entry.headingTag, 'H2');
    assert.equal(entry.headingId, `${entry.id}-heading`);
    assert.equal(entry.headingOwnsOnlyTrigger, true);
    assert.equal(entry.titleId, `${entry.id}-title`);
    assert.equal(entry.labelledBy, entry.titleId);
    assert.equal(entry.metaId, `${entry.id}-meta`);
    assert.equal(entry.describedBy, entry.metaId);
    assert.ok(entry.meta.length > 0);
    assert.equal(entry.panelId, `${entry.id}-panel`);
    assert.equal(entry.controls, entry.panelId);
    assert.equal(entry.panelConnected, true);
    assert.equal(entry.panelHasChildren, true);
    assert.equal(entry.expanded, false);
    assert.equal(entry.panelHidden, true);
    assert.equal(entry.expandedHiddenInverse, true);
    assert.equal(entry.panelContainsSentinel, true);
    assertDisclosureAx(proof.ax.resultCollapsed, {
      title: entry.title,
      description: entry.meta,
      expanded: false,
      panelId: entry.panelId,
    }, `collapsed ${entry.title}`);
    assert.equal(
      proof.ax.resultCollapsed.some((axEntry) => axEntry.name.includes(entry.sentinel)),
      false,
      `${entry.title} collapsed children leaked into the AX tree`,
    );
  }

  const collapsedProcess = collapsedDisclosures.process;
  assert.equal(collapsedProcess.triggerId, 'result-processing-completion');
  assert.equal(collapsedProcess.headingTag, 'H2');
  assert.equal(collapsedProcess.headingId, 'result-processing-completion-heading');
  assert.equal(collapsedProcess.headingOwnsOnlyTrigger, true);
  assert.equal(collapsedProcess.controls, 'result-processing-completion-panel');
  assert.equal(collapsedProcess.panelId, 'result-processing-completion-panel');
  assert.equal(collapsedProcess.panelConnected, true);
  assert.equal(collapsedProcess.panelRole, 'region');
  assert.equal(collapsedProcess.panelLabelledBy, 'result-processing-completion');
  assert.equal(collapsedProcess.expanded, false);
  assert.equal(collapsedProcess.panelHidden, true);
  assert.equal(collapsedProcess.expandedHiddenInverse, true);
  assert.equal(collapsedProcess.panelContainsSentinel, true);
  assertDisclosureAx(proof.ax.resultCollapsed, {
    title: collapsedProcess.name,
    description: '',
    expanded: false,
    panelId: collapsedProcess.panelId,
  }, 'collapsed processing-completion disclosure');
  assert.equal(
    proof.ax.resultCollapsed.some((entry) => (
      entry.role.toLowerCase() === 'region' && entry.name === collapsedProcess.name
    )),
    false,
    'the collapsed processing-completion region leaked into the AX tree',
  );

  const deadlineOpen = proof.dom.deadlineDisclosureOpen;
  assert.equal(deadlineOpen.triggerId, 'result-deadlines');
  assert.equal(deadlineOpen.panelId, 'result-deadlines-panel');
  assert.equal(deadlineOpen.headingId, 'result-deadlines-heading');
  assert.equal(deadlineOpen.titleId, 'result-deadlines-title');
  assert.equal(deadlineOpen.metaId, 'result-deadlines-meta');
  assert.equal(deadlineOpen.focusedBeforeToggle, true);
  assert.equal(deadlineOpen.focusRetainedAfterToggleEvent, true);
  assert.equal(deadlineOpen.sameTriggerIdentity, true);
  assert.equal(deadlineOpen.triggerFocused, true);
  assert.equal(deadlineOpen.expanded, true);
  assert.equal(deadlineOpen.panelHidden, false);
  assert.equal(deadlineOpen.panelVisible, true);
  assert.equal(deadlineOpen.panelConnected, true);
  assert.equal(deadlineOpen.deadlineCardCount, 2);
  assertDisclosureAx(proof.ax.deadlineOpen, {
    title: deadlineOpen.title,
    description: deadlineOpen.meta,
    expanded: true,
    panelId: deadlineOpen.panelId,
  }, 'open deadline disclosure');
  assert.equal(
    proof.ax.deadlineOpen.some((entry) => entry.name.includes(deadlineOpen.sentinel)),
    true,
    'the open deadline panel is absent from the AX tree',
  );

  const deadlineClosed = proof.dom.deadlineDisclosureClosed;
  assert.equal(deadlineClosed.sameTriggerIdentity, true);
  assert.equal(deadlineClosed.samePanelIdentity, true);
  assert.equal(deadlineClosed.focusedBeforeToggle, true);
  assert.equal(deadlineClosed.focusRetainedAfterToggleEvent, true);
  assert.equal(deadlineClosed.triggerFocused, true);
  assert.equal(deadlineClosed.expanded, false);
  assert.equal(deadlineClosed.panelHidden, true);
  assert.equal(deadlineClosed.panelConnected, true);
  assert.equal(deadlineClosed.deadlineCardCount, 2);
  assertDisclosureAx(proof.ax.deadlineClosed, {
    title: deadlineClosed.title,
    description: deadlineClosed.meta,
    expanded: false,
    panelId: deadlineClosed.panelId,
  }, 'closed deadline disclosure');
  assert.equal(
    proof.ax.deadlineClosed.some((entry) => entry.name.includes(deadlineClosed.sentinel)),
    false,
    'the re-collapsed deadline panel remained in the AX tree',
  );
  assertLanguageRows(proof.dom.result.sourceEvidence, 'source evidence');
  assertLanguageRows(proof.dom.result.quotes, 'result evidence quotes');
  assert.equal(proof.dom.reply.textareaLanguage, 'en');
  assert.equal(proof.dom.reply.textareaEnabled, true);
  assertLanguageRows(proof.dom.reply.groundingQuotes, 'reply-grounding quotes');
  assertReplyStatusFocusGeometry(proof.dom.replyStatusFocus.normal, '520px reply focus', {
    columns: 1,
    compactInset: false,
    forcedColors: false,
    stacked: true,
    viewport: { width: 520, height: 680 },
    zoomFactor: 1,
  });
  assertReplyStatusFocusGeometry(proof.dom.replyStatusFocus.textScale, '200% reply focus', {
    columns: 1,
    compactInset: true,
    forcedColors: false,
    stacked: true,
    viewport: { width: 260, height: 340 },
    zoomFactor: 2,
  });
  assertReplyStatusFocusGeometry(proof.dom.replyStatusFocus.forcedColors, 'forced-colors reply focus', {
    columns: 1,
    compactInset: true,
    forcedColors: true,
    stacked: true,
    viewport: { width: 260, height: 340 },
    zoomFactor: 2,
  });
  assert.equal(proof.dom.savedTerms.termText, 'passport information page');
  assert.equal(proof.dom.savedTerms.termLanguage, 'en');
  assert.equal(proof.dom.savedTerms.evidenceText, 'passport information page');
  assert.equal(proof.dom.savedTerms.evidenceLanguage, 'en');
  const importPreview = proof.dom.savedTermsImportPreview;
  assert.equal(importPreview.previewVisible, true);
  assert.equal(importPreview.previewTitleTag, 'H3');
  assert.equal(importPreview.previewTitleText, '确认导入“Slipstream-terms-backup.json”');
  assert.equal(importPreview.trustReviewRole, 'note');
  assert.equal(importPreview.trustReviewLabelledBy, 'term-import-trust-title');
  assert.equal(importPreview.trustReviewFocused, true);
  assert.equal(importPreview.confirmFocused, false);
  assert.equal(importPreview.activeElementIsLiveOwner, false);
  assert.equal(importPreview.trustReviewBeforeActions, true);
  assert.equal(importPreview.cancelBeforeConfirm, true);
  assert.equal(importPreview.confirmDescribedBySummary, true);
  assert.equal(importPreview.confirmDescribedByDowngrade, true);
  assert.equal(importPreview.trustReviewMentionsEvidenceBoundary, true);
  assert.equal(importPreview.trustReviewMentionsTrustDowngrade, true);
  assert.equal(importPreview.trustReviewMentionsLocalRetention, true);
  assert.equal(importPreview.termCountBeforeCommit, 1);
  assert.ok(importPreview.downgradeWarningFontSize >= 10);
  assert.equal(importPreview.nonQuerySearchLive, 'off');

  const importCommit = proof.dom.savedTermsImportCommit;
  assert.equal(importCommit.previewRemoved, true);
  assert.equal(importCommit.termCountAfterCommit, 2);
  assert.equal(importCommit.importButtonFocused, true);
  assert.equal(importCommit.activeElementIsLiveOwner, false);
  assert.equal(importCommit.visibleStatusRole, 'status');
  assert.equal(importCommit.visibleStatusAtomic, 'true');
  assert.equal(importCommit.exactMessageOwnerCount, 1);
  assert.equal(importCommit.hiddenAnnouncementContainsOutcome, false);
  assert.equal(importCommit.nonQuerySearchLive, 'off');
  const importReopen = proof.dom.savedTermsImportReopen;
  assert.equal(importReopen.secondPreviewTrustFocused, true);
  assert.equal(importReopen.closeReturnedToTrigger, true);
  assert.equal(importReopen.reopenedDrawer, true);
  assert.equal(importReopen.stalePreviewAbsent, true);
  assert.equal(importReopen.searchFocused, true);
  assert.equal(importReopen.staleTransferMessageAbsent, true);
  assert.equal(importReopen.termCountAfterReopen, 2);
  assert.equal(proof.dom.processing.safeSampleLoaded, true);
  assert.equal(proof.dom.processing.processActionActivated, true);
  assert.equal(proof.dom.processing.contextId, 'processing-context-title');
  assert.equal(proof.dom.processing.contextFocused, true);
  assert.equal(proof.dom.processing.activeElementId, 'processing-context-title');
  assert.equal(proof.dom.processing.activeElementIsBody, false);
  assert.equal(proof.dom.processing.testSideFocusManipulation, false);
  assert.equal(proof.dom.processing.liveRegionMountedEmpty, true);
  assert.equal(proof.dom.processing.statusOwnerCount, 1);
  assert.equal(proof.dom.processing.liveOwnerCount, 1);
  assert.deepEqual(proof.dom.processing.announcements, [
    '正在准备原文…',
    '正在等待所选服务返回…',
  ]);
  assert.equal(proof.dom.processing.visibleStatus, '正在等待所选服务返回…');

  const settingsSaveRetry = proof.dom.settingsSaveRetry;
  assert.equal(settingsSaveRetry.globalRecoveryVisible, true);
  assert.equal(settingsSaveRetry.globalRecoveryText, '刚才的设置已保存，可以继续。');
  assert.equal(settingsSaveRetry.localErrorVisible, false);
  assert.equal(settingsSaveRetry.localStatusText, '已安全保存');
  assert.equal(settingsSaveRetry.draftCleared, true);
  assert.equal(settingsSaveRetry.saveButtonDisabled, true);
  assert.equal(settingsSaveRetry.testButtonEnabled, true);
  assert.equal(settingsSaveRetry.testButtonText.includes('请先保存当前输入'), false);
  assert.equal(settingsSaveRetry.testButtonFocused, true);
  assert.equal(settingsSaveRetry.activeElementIsBody, false);
  assert.equal(settingsSaveRetry.activeElementRole, 'button');
  assert.equal(settingsSaveRetry.activeElementIsLiveOwner, false);
  assert.equal(settingsSaveRetry.testSideFocusManipulation, false);
  assert.equal(settingsSaveRetry.deepseekCredentialWriteRequests, 2);
  assert.equal(settingsSaveRetry.deepseekCredentialWriteSuccesses, 1);
  assert.equal(
    settingsSaveRetry.liveOwners.some((owner) => owner.text.includes('保存失败')),
    false,
    'the recovered Settings surface retained a failed live owner',
  );
  assert.equal(
    settingsSaveRetry.liveOwners.filter((owner) => (
      owner.role === 'status' && owner.text === '刚才的设置已保存，可以继续。'
    )).length,
    1,
    'the recovered Settings surface must expose one success announcement owner',
  );

  assertAx(proof.ax.result, 'RootWebArea', 'Slipstream', 'result');
  const resultMains = proof.ax.result.filter((entry) => entry.role.toLowerCase() === 'main');
  assert.equal(resultMains.length, 1, 'result AX tree must expose exactly one main landmark');
  assert.equal(
    resultMains[0].name,
    proof.dom.result.mainHeadingText,
    'result main landmark must be named by the visible conclusion heading',
  );
  assertAx(proof.ax.result, 'region', '完整原文', 'result');
  assertAx(proof.ax.result, 'region', '行动路径', 'result');
  assertAx(
    proof.ax.result,
    'region',
    proof.dom.result.processingCompletion.name,
    'processing-completion disclosure',
  );
  assert.equal(proof.dom.result.processingCompletion.expanded, true);
  assert.equal(proof.dom.result.processingCompletion.panelHidden, false);
  assert.equal(proof.dom.result.processingCompletion.panelRole, 'region');
  assert.equal(
    proof.dom.result.processingCompletion.panelLabelledBy,
    'result-processing-completion',
  );
  assertAx(proof.ax.result, 'button', '准备英文回复', 'result');
  assertAx(proof.ax.reply, 'dialog', '先确认事实，再准备英文回复', 'reply');
  assertAx(proof.ax.reply, 'textbox', '英文回复草稿', 'reply');
  assertAx(proof.ax.savedTerms, 'dialog', '术语库', 'Saved Terms');
  assertAx(proof.ax.savedTerms, 'searchbox', '搜索已保存术语', 'Saved Terms');
  assertAx(proof.ax.savedTerms, 'article', 'passport information page', 'Saved Terms');
  assertAx(
    proof.ax.savedTermsImportPreview,
    'heading',
    '确认导入“Slipstream-terms-backup.json”',
    'Saved Terms import preview',
  );
  assertAx(
    proof.ax.savedTermsImportPreview,
    'note',
    '先核对导入的可信度',
    'Saved Terms import preview',
  );
  assertAx(
    proof.ax.savedTermsImportPreview,
    'button',
    '确认导入',
    'Saved Terms import preview',
  );
  const importTrustNotes = proof.ax.savedTermsImportPreview.filter((entry) => (
    entry.role.toLowerCase() === 'note' && entry.name === '先核对导入的可信度'
  ));
  assert.equal(importTrustNotes.length, 1);
  assert.equal(importTrustNotes[0].focused, true);
  const importConfirmButtons = proof.ax.savedTermsImportPreview.filter((entry) => (
    entry.role.toLowerCase() === 'button' && entry.name === '确认导入'
  ));
  assert.equal(importConfirmButtons.length, 1);
  assert.equal(importConfirmButtons[0].description.includes('不会导入原文证据'), true);
  assert.equal(
    proof.ax.savedTermsImportPreview.filter((entry) => (
      entry.role.toLowerCase() === 'statictext'
      && entry.name.includes('条缺少证据的可信标记已按“来源状态未知”参与预览')
    )).length,
    1,
    'Saved Terms import preview must expose the downgrade warning exactly once',
  );
  assert.equal(
    proof.ax.savedTermsImportCommit.filter((entry) => (
      entry.role.toLowerCase() === 'statictext'
      && entry.name === proof.dom.savedTermsImportCommit.outcomeMessage
    )).length,
    1,
    'Saved Terms import completion must expose the outcome exactly once',
  );
  assertAx(proof.ax.setupBefore, 'main', null, 'setup');
  assertAx(proof.ax.setupBefore, 'heading', '先选择你希望获得哪种帮助', 'setup');
  assertAx(proof.ax.setupBefore, 'button', '我明确选择只用基础翻译', 'setup');
  assertAx(proof.ax.setupAfter, 'main', null, 'capture handoff');
  assertAx(proof.ax.setupAfter, 'textbox', '要解释的完整原文', 'capture handoff');
  assertAx(proof.ax.processing, 'heading', '把原文整理成可追溯的行动结论', 'processing');
  assertAx(proof.ax.processing, 'status', null, 'processing');
  assertAx(proof.ax.settingsSaveRetry, 'button', '验证完整分析能力', 'Settings save retry');
  assert.equal(
    proof.ax.settingsSaveRetry.some((entry) => (
      ['alert', 'status', 'statictext'].includes(entry.role.toLowerCase())
      && entry.name.includes('保存失败')
    )),
    false,
    'the recovered Settings AX tree retained a failed announcement',
  );
  assert.equal(
    proof.ax.settingsSaveRetry.filter((entry) => (
      entry.role.toLowerCase() === 'statictext'
      && entry.name === '刚才的设置已保存，可以继续。'
    )).length,
    1,
    'the recovered Settings AX tree must expose the saved message exactly once',
  );
  assert.equal(proof.setupHandoff.clickedBasicTranslation, true);
  assert.equal(proof.setupHandoff.captureReady, true);
  assert.equal(proof.setupHandoff.sourceTextareaFocused, true);
  assert.equal(proof.setupHandoff.testSideFocusManipulation, false);
  assert.equal(proof.evidence.enabled, Boolean(expectedEvidenceDirectory));
  assert.equal(proof.evidence.directory, expectedEvidenceDirectory);
  assert.deepEqual(
    proof.evidence.files,
    expectedEvidenceDirectory
      ? [
          '01-result-named-main.png',
          '02-processing-status.png',
          '04-after-fix-save-retry-recovered.png',
        ]
      : [],
  );
  assert.equal(proof.claim, 'Chromium DOM and Accessibility Tree semantics only; VoiceOver speech was not exercised.');
}

async function runNodeHarness() {
  const { evidenceDirectory } = parseArguments(process.argv.slice(2));
  let ownedUserData = null;
  let viteMonitor = null;
  let electronMonitor = null;
  let networkTrap = null;
  try {
    networkTrap = await startNetworkTrap();
    ownedUserData = createOwnedUserDataDirectory();
    assert.equal(modeBits(ownedUserData.realPath), 0o700);
    const sessionDataPath = join(ownedUserData.realPath, 'session');
    mkdirSync(sessionDataPath, { mode: 0o700 });
    chmodSync(sessionDataPath, 0o700);
    assert.equal(modeBits(sessionDataPath), 0o700);

    const rendererPort = await findAvailableLoopbackPort();
    const resultUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${rendererPort}/?demo=result&terms=sample&fixture=check&trapPort=${networkTrap.port}&run=native-runtime`,
    );
    const setupUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${rendererPort}/?demo=setup&fixture=check&trapPort=${networkTrap.port}&run=native-runtime`,
    );
    const captureUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${rendererPort}/?demo=capture&backend=deepseek&process=slow&save=credential-once&fixture=check&trapPort=${networkTrap.port}&run=native-runtime`,
    );
    const childEnvironment = sanitizeFixtureEnvironment({
      ...process.env,
      DEEPSEEK_API_KEY: 'fixture-secret-must-not-cross',
      OPENAI_API_KEY: 'fixture-secret-must-not-cross',
      SCREEN_READER_TEST_TOKEN: 'fixture-token-must-not-cross',
      SCREEN_READER_TEST_CREDENTIAL: 'fixture-authority-must-not-cross',
      SSH_AUTH_SOCK: '/tmp/fixture-authority-must-not-cross',
      NODE_OPTIONS: '--trace-warnings',
    });
    for (const key of [
      'DEEPSEEK_API_KEY',
      'OPENAI_API_KEY',
      'SCREEN_READER_TEST_TOKEN',
      'SCREEN_READER_TEST_CREDENTIAL',
      'SSH_AUTH_SOCK',
      'NODE_OPTIONS',
    ]) {
      assert.equal(childEnvironment[key], undefined, `${key} survived fixture environment sanitization`);
    }

    viteMonitor = monitorChild(process.execPath, [
      viteEntry,
      '--host', '127.0.0.1',
      '--port', String(rendererPort),
      '--strictPort',
    ], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForRenderer(resultUrl, viteMonitor);

    const electronBinary = require('electron');
    electronMonitor = monitorChild(electronBinary, [scriptPath, harnessFlag], {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        [resultUrlEnvironment]: resultUrl,
        [setupUrlEnvironment]: setupUrl,
        [captureUrlEnvironment]: captureUrl,
        [userDataEnvironment]: ownedUserData.realPath,
        ...(evidenceDirectory ? { [evidenceDirEnvironment]: evidenceDirectory } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(
          `Screen-reader Electron harness timed out\n${electronMonitor.stdout}\n${electronMonitor.stderr}`,
        ));
      }, timeoutMs);
    });
    let outcome;
    try {
      outcome = await Promise.race([electronMonitor.exit, timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
    const proof = parseHarnessProof(outcome);
    assertRuntimeProof(proof, networkTrap, evidenceDirectory);
    console.log('Screen-reader semantics Electron runtime checks passed.');
    console.log(JSON.stringify({
      languageBoundaries: {
        sourceEvidence: proof.dom.result.sourceEvidence.length,
        resultQuotes: proof.dom.result.quotes.length,
        replyGroundingQuotes: proof.dom.reply.groundingQuotes.length,
        savedTerms: 1,
      },
      axSurfaces: [
        'result',
        'reply dialog',
        'Saved Terms dialog',
        'Saved Terms import preview and completion',
        'setup',
        'capture handoff',
        'processing',
      ],
      focusHandoff: proof.setupHandoff.sourceTextareaFocused,
      savedTermsImportFocus: proof.dom.savedTermsImportPreview.trustReviewFocused
        && proof.dom.savedTermsImportCommit.importButtonFocused,
      processingHandoff: proof.dom.processing.contextFocused,
      isolation: {
        hiddenWindows: proof.isolation.resultWindowHidden
          && proof.isolation.setupWindowHidden
          && proof.isolation.captureWindowHidden,
        profileExcluded: proof.isolation.normalProfileExcluded,
        secretLikeEnvironmentKeys: proof.isolation.inheritedSecretLikeEnvironmentKeys,
        networkTrapRequests: networkTrap.requestCount,
      },
      evidence: proof.evidence,
      claim: proof.claim,
    }));
  } finally {
    await terminateChild(electronMonitor);
    await terminateChild(viteMonitor);
    if (networkTrap) await networkTrap.close();
    if (ownedUserData) removeOwnedUserDataDirectory(ownedUserData);
  }
}

async function waitForResultEvidenceSurface(webContents) {
  await webContents.executeJavaScript(`new Promise((resolveWait, rejectWait) => {
    // The first Vite transform can be materially slower on a cold macOS
    // filesystem; keep this bounded while allowing the real lazy workspace to
    // finish mounting before judging its accessibility semantics.
    const deadline = Date.now() + 20000;
    const check = () => {
      const heading = document.querySelector('#result-headline');
      const main = document.querySelector('main[aria-labelledby="result-headline"]');
      if (
        heading
        && main?.contains(heading)
        && main.querySelector('.result-summary')
        && main.querySelector('.evidence-workspace')
        && main.querySelector('.result-footer')
      ) {
        resolveWait(true);
        return;
      }
      if (Date.now() >= deadline) {
        rejectWait(new Error('Timed out waiting for the named result main evidence surface'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`, true);
}

async function settleEvidenceRendering(webContents) {
  await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await webContents.executeJavaScript(`(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    return true;
  })()`, true);
}

async function setReplyMediaState(webContents, state) {
  await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    media: '',
    features: replyMediaFeatures[state].map((feature) => ({ ...feature })),
  });
  await webContents.executeJavaScript(
    'new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))',
    true,
  );
}

async function focusReplyStatusWithKeyboard(webContents) {
  const prepared = await webContents.executeJavaScript(`(() => {
    const radio = document.querySelector(
      '.reply-status-picker input[name="reply-status"]:checked, .reply-status-picker input[name="reply-status"]',
    );
    if (!radio) return false;
    radio.focus({ preventScroll: true });
    return document.activeElement === radio;
  })()`, true);
  assert.equal(prepared, true, 'reply status radio could not be prepared for native keyboard focus');
  webContents.focus();
  const sendTab = async () => {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await delay(25);
  };
  const replyRadioFocused = () => webContents.executeJavaScript(
    'Boolean(document.activeElement?.matches(\'.reply-status-picker input[name="reply-status"]\'))',
    true,
  );
  await delay(50);
  let departedPreparedRadio = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sendTab();
    if (!await replyRadioFocused()) {
      departedPreparedRadio = true;
      break;
    }
  }
  assert.equal(
    departedPreparedRadio,
    true,
    'Native Tab did not leave the programmatically prepared reply status radio',
  );
  for (let index = 0; index < 40; index += 1) {
    const focused = await replyRadioFocused();
    if (focused) return;
    await sendTab();
  }
  throw new Error('Native Tab did not return to the reply status radio');
}

async function captureEvidence(webContents, evidenceDirectory, filename, files) {
  if (!evidenceDirectory) return;
  const image = await webContents.capturePage();
  const bytes = image.toPNG();
  assert.ok(bytes.length > 0, `${filename} rendered an empty image`);
  writeFileSync(join(evidenceDirectory, filename), bytes);
  files.push(filename);
}

function resultDomProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const deadline = Date.now() + 7_000;
    while (!document.querySelector('#result-headline') && Date.now() < deadline) await wait(25);
    if (!document.querySelector('#result-headline')) throw new Error('Timed out waiting for the completed result fixture');

    for (const trigger of document.querySelectorAll('.disclosure__trigger[aria-expanded="false"]')) {
      trigger.click();
    }
    const processingCompletion = document.querySelector('#result-processing-completion');
    if (processingCompletion?.getAttribute('aria-expanded') === 'false') {
      processingCompletion.click();
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));

    const effectiveLanguage = (element) => {
      for (let current = element; current; current = current.parentElement) {
        if (current.hasAttribute?.('lang')) return current.getAttribute('lang');
      }
      return document.documentElement.getAttribute('lang') || '';
    };
    const rows = (selector) => [...document.querySelectorAll(selector)].map((element) => ({
      text: element.textContent.replace(/\s+/gu, ' ').trim(),
      language: effectiveLanguage(element),
    }));
    const sourcePaper = document.querySelector('.source-paper');
    if (!sourcePaper) throw new Error('Result source paper is unavailable');
    const sourceEvidence = rows('.source-paper .source-evidence');
    const quotes = rows('.result-view q, .result-view blockquote');
    if (sourceEvidence.length === 0 || quotes.length === 0) {
      throw new Error('Result fixture did not render its source/evidence language surfaces');
    }
    const mains = [...document.querySelectorAll('main')];
    const main = mains[0] || null;
    const mainHeading = document.querySelector('#result-headline');
    const mainHeadingStyle = mainHeading ? getComputedStyle(mainHeading) : null;
    const mainHeadingRectangle = mainHeading?.getBoundingClientRect();
    const processingCompletionPanel = document.querySelector(
      '#result-processing-completion-panel',
    );
    return {
      rootLanguage: document.documentElement.getAttribute('lang'),
      sourcePaperLanguage: sourcePaper.getAttribute('lang'),
      mainCount: mains.length,
      mainLabelledBy: main?.getAttribute('aria-labelledby') || '',
      mainContainsHeading: Boolean(main && mainHeading && main.contains(mainHeading)),
      mainHeadingText: mainHeading?.textContent.replace(/\s+/gu, ' ').trim() || '',
      mainHeadingVisible: Boolean(
        mainHeading
        && mainHeadingStyle?.display !== 'none'
        && mainHeadingStyle?.visibility !== 'hidden'
        && Number.parseFloat(mainHeadingStyle?.opacity || '1') > 0
        && mainHeadingRectangle?.width > 0
        && mainHeadingRectangle?.height > 0
      ),
      sourceEvidence,
      quotes,
      processingCompletion: {
        name: processingCompletion?.getAttribute('aria-label') || '',
        expanded: processingCompletion?.getAttribute('aria-expanded') === 'true',
        controls: processingCompletion?.getAttribute('aria-controls') || '',
        panelHidden: Boolean(processingCompletionPanel?.hidden),
        panelRole: processingCompletionPanel?.getAttribute('role') || '',
        panelLabelledBy: processingCompletionPanel?.getAttribute('aria-labelledby') || '',
      },
    };
  })();
}

function resultDisclosuresCollapsedProbe() {
  return (() => {
    const expected = [
      { id: 'result-translation', title: '完整翻译', sentinel: '亲爱的同学' },
      { id: 'result-explanation', title: '补充解释', sentinel: '解释原文' },
      { id: 'result-materials', title: '材料清单', sentinel: '材料原文' },
      { id: 'result-deadlines', title: '截止日期', sentinel: '日期原文' },
      { id: 'result-terms', title: '词语与术语', sentinel: '词语原文' },
      { id: 'result-context', title: '流程背景', sentinel: '背景原文' },
      { id: 'result-sources', title: '官方来源', sentinel: '批准后将访问以下候选官方页面' },
      { id: 'result-verification', title: '待核验', sentinel: '触发核验的原文' },
    ];
    const allIds = [...document.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter(Boolean);
    const idCount = (id) => allIds.filter((candidate) => candidate === id).length;
    const entries = expected.map(({ id, title, sentinel }) => {
      const trigger = document.getElementById(id);
      const heading = document.getElementById(`${id}-heading`);
      const titleNode = document.getElementById(`${id}-title`);
      const meta = document.getElementById(`${id}-meta`);
      const panel = document.getElementById(`${id}-panel`);
      if (!(trigger && heading && titleNode && meta && panel)) {
        throw new Error(`Missing disclosure contract for ${id}`);
      }
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      return {
        id,
        title: titleNode.textContent.replace(/\s+/gu, ' ').trim(),
        meta: meta.textContent.replace(/\s+/gu, ' ').trim(),
        sentinel,
        triggerId: trigger.id,
        headingTag: heading.tagName,
        headingId: heading.id,
        headingOwnsOnlyTrigger: heading.children.length === 1
          && heading.firstElementChild === trigger,
        titleId: titleNode.id,
        labelledBy: trigger.getAttribute('aria-labelledby') || '',
        metaId: meta.id,
        describedBy: trigger.getAttribute('aria-describedby') || '',
        controls: trigger.getAttribute('aria-controls') || '',
        panelId: panel.id,
        panelConnected: panel.isConnected,
        panelHasChildren: panel.childElementCount > 0,
        expanded,
        panelHidden: panel.hidden,
        expandedHiddenInverse: expanded === !panel.hidden,
        panelContainsSentinel: panel.textContent.includes(sentinel),
        titleMatchesFixture: titleNode.textContent.replace(/\s+/gu, ' ').trim() === title,
        panelRole: panel.getAttribute('role') || '',
      };
    });
    const processTrigger = document.getElementById('result-processing-completion');
    const processHeading = document.getElementById('result-processing-completion-heading');
    const processPanel = document.getElementById('result-processing-completion-panel');
    if (!(processTrigger && processHeading && processPanel)) {
      throw new Error('Missing processing-completion disclosure contract');
    }
    const processExpanded = processTrigger.getAttribute('aria-expanded') === 'true';
    const referencedIds = entries.flatMap((entry) => [
      entry.triggerId,
      entry.headingId,
      entry.titleId,
      entry.metaId,
      entry.panelId,
    ]).concat([
      processTrigger.id,
      processHeading.id,
      processPanel.id,
    ]);
    const renderedIds = [...document.querySelectorAll('.result-view .disclosure__trigger')]
      .map((trigger) => trigger.id);
    return {
      entries,
      exactFixtureSet: renderedIds.length === expected.length
        && renderedIds.every((id, index) => id === expected[index].id)
        && entries.every((entry) => entry.titleMatchesFixture),
      uniqueIdReferences: referencedIds.every((id) => idCount(id) === 1),
      uniqueReferenceValues: new Set(referencedIds).size === referencedIds.length,
      commonPanelRegionCount: entries.filter((entry) => entry.panelRole === 'region').length,
      process: {
        name: processTrigger.getAttribute('aria-label') || '',
        triggerId: processTrigger.id,
        headingTag: processHeading.tagName,
        headingId: processHeading.id,
        headingOwnsOnlyTrigger: processHeading.children.length === 1
          && processHeading.firstElementChild === processTrigger,
        controls: processTrigger.getAttribute('aria-controls') || '',
        panelId: processPanel.id,
        panelConnected: processPanel.isConnected,
        panelRole: processPanel.getAttribute('role') || '',
        panelLabelledBy: processPanel.getAttribute('aria-labelledby') || '',
        expanded: processExpanded,
        panelHidden: processPanel.hidden,
        expandedHiddenInverse: processExpanded === !processPanel.hidden,
        panelContainsSentinel: processPanel.textContent.includes('处理阶段已折叠'),
      },
    };
  })();
}

function openDeadlineDisclosureProbe() {
  return (async () => {
    const trigger = document.getElementById('result-deadlines');
    const panel = document.getElementById('result-deadlines-panel');
    const heading = document.getElementById('result-deadlines-heading');
    const title = document.getElementById('result-deadlines-title');
    const meta = document.getElementById('result-deadlines-meta');
    if (!(trigger && panel && heading && title && meta)) {
      throw new Error('Deadline disclosure contract is unavailable');
    }
    window.__slipstreamDeadlineDisclosureTrigger = trigger;
    window.__slipstreamDeadlineDisclosurePanel = panel;
    trigger.focus({ preventScroll: true });
    const focusedBeforeToggle = document.activeElement === trigger;
    trigger.click();
    const focusRetainedAfterToggleEvent = document.activeElement === trigger;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const focusPersistedAfterRendering = document.activeElement === trigger;
    if (!focusPersistedAfterRendering) trigger.focus({ preventScroll: true });
    const style = getComputedStyle(panel);
    const rectangle = panel.getBoundingClientRect();
    return {
      triggerId: trigger.id,
      panelId: panel.id,
      headingId: heading.id,
      titleId: title.id,
      metaId: meta.id,
      title: title.textContent.replace(/\s+/gu, ' ').trim(),
      meta: meta.textContent.replace(/\s+/gu, ' ').trim(),
      sentinel: '日期原文',
      focusedBeforeToggle,
      focusRetainedAfterToggleEvent,
      focusPersistedAfterRendering,
      sameTriggerIdentity: window.__slipstreamDeadlineDisclosureTrigger === trigger,
      triggerFocused: document.activeElement === trigger,
      expanded: trigger.getAttribute('aria-expanded') === 'true',
      panelHidden: panel.hidden,
      panelVisible: !panel.hidden
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rectangle.width > 0
        && rectangle.height > 0,
      panelConnected: panel.isConnected,
      deadlineCardCount: panel.querySelectorAll('.deadline-card').length,
    };
  })();
}

function closeDeadlineDisclosureProbe() {
  return (async () => {
    const trigger = document.getElementById('result-deadlines');
    const panel = document.getElementById('result-deadlines-panel');
    const title = document.getElementById('result-deadlines-title');
    const meta = document.getElementById('result-deadlines-meta');
    if (!(trigger && panel && title && meta)) {
      throw new Error('Deadline disclosure contract disappeared before collapse');
    }
    const sameTriggerIdentity = window.__slipstreamDeadlineDisclosureTrigger === trigger;
    const samePanelIdentity = window.__slipstreamDeadlineDisclosurePanel === panel;
    const focusedBeforeToggle = document.activeElement === trigger;
    trigger.click();
    const focusRetainedAfterToggleEvent = document.activeElement === trigger;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const focusPersistedAfterRendering = document.activeElement === trigger;
    if (!focusPersistedAfterRendering) trigger.focus({ preventScroll: true });
    return {
      title: title.textContent.replace(/\s+/gu, ' ').trim(),
      meta: meta.textContent.replace(/\s+/gu, ' ').trim(),
      sentinel: '日期原文',
      panelId: panel.id,
      sameTriggerIdentity,
      samePanelIdentity,
      focusedBeforeToggle,
      focusRetainedAfterToggleEvent,
      focusPersistedAfterRendering,
      triggerFocused: document.activeElement === trigger,
      expanded: trigger.getAttribute('aria-expanded') === 'true',
      panelHidden: panel.hidden,
      panelConnected: panel.isConnected,
      deadlineCardCount: panel.querySelectorAll('.deadline-card').length,
    };
  })();
}

function openReplyProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.replace(/\s+/gu, ' ').trim().includes('准备英文回复'));
    if (!button) throw new Error('Guided reply trigger is unavailable');
    button.click();
    const deadline = Date.now() + 7_000;
    while (!document.querySelector('.reply-drawer') && Date.now() < deadline) await wait(25);
    const dialog = document.querySelector('.reply-drawer');
    if (!dialog) throw new Error('Timed out waiting for the guided reply dialog');
    dialog.querySelector('input[name="reply-status"][value="in_progress"]')?.click();
    let textarea = null;
    while (Date.now() < deadline) {
      textarea = dialog.querySelector('textarea[aria-label="英文回复草稿"]');
      if (textarea && !textarea.disabled && textarea.value.trim()) break;
      await wait(25);
    }
    if (!textarea || textarea.disabled || !textarea.value.trim()) {
      throw new Error('Guided reply textarea did not become available');
    }
    const effectiveLanguage = (element) => {
      for (let current = element; current; current = current.parentElement) {
        if (current.hasAttribute?.('lang')) return current.getAttribute('lang');
      }
      return document.documentElement.getAttribute('lang') || '';
    };
    const groundingQuotes = [...dialog.querySelectorAll('.reply-grounding q')].map((element) => ({
      text: element.textContent.replace(/\s+/gu, ' ').trim(),
      language: effectiveLanguage(element),
    }));
    if (groundingQuotes.length === 0) throw new Error('Reply grounding quotes are unavailable');
    return {
      textareaLanguage: textarea.getAttribute('lang'),
      textareaEnabled: !textarea.disabled,
      groundingQuotes,
    };
  })();
}

function replyStatusFocusProbe() {
  return (async () => {
    const dialog = document.querySelector('.reply-drawer');
    const picker = dialog?.querySelector('.reply-status-picker');
    const radios = [...(picker?.querySelectorAll('input[name="reply-status"]') || [])];
    const labels = radios.map((radio) => radio.closest('label'));
    const radio = radios.includes(document.activeElement) ? document.activeElement : null;
    const label = radio?.closest('label');
    const secondLabel = labels.find((candidate) => candidate !== label);
    if (!(dialog && picker && radio && label && secondLabel && labels.length === 2 && labels.every(Boolean))) {
      throw new Error('Reply status focus geometry is unavailable');
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));

    const rectangle = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };
    const visiblePaint = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized || normalized === 'none' || normalized === 'transparent') return false;
      return !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/u.test(normalized)
        && !/^color\([^)]*\/\s*0(?:\.0+)?\)$/u.test(normalized);
    };
    const outline = (style) => {
      const width = Number.parseFloat(style.outlineWidth || '0') || 0;
      return {
        color: style.outlineColor,
        offset: Number.parseFloat(style.outlineOffset || '0') || 0,
        style: style.outlineStyle,
        width,
        visible: width > 0
          && style.outlineStyle !== 'none'
          && visiblePaint(style.outlineColor),
      };
    };
    const inputStyle = getComputedStyle(radio);
    const labelStyle = getComputedStyle(label);
    const pickerStyle = getComputedStyle(picker);
    const inputOutline = outline(inputStyle);
    const labelOutline = outline(labelStyle);
    const radioRect = rectangle(radio);
    const labelRect = rectangle(label);
    const orderedLabelRects = labels
      .map((candidate) => rectangle(candidate))
      .sort((left, right) => left.top - right.top);
    const dialogRect = rectangle(dialog);
    const dialogClientRect = {
      left: dialogRect.left + dialog.clientLeft,
      top: dialogRect.top + dialog.clientTop,
      right: dialogRect.left + dialog.clientLeft + dialog.clientWidth,
      bottom: dialogRect.top + dialog.clientTop + dialog.clientHeight,
    };
    const clipRect = {
      left: Math.max(0, dialogClientRect.left),
      top: Math.max(0, dialogClientRect.top),
      right: Math.min(window.innerWidth, dialogClientRect.right),
      bottom: Math.min(window.innerHeight, dialogClientRect.bottom),
    };
    const ringExtent = labelOutline.visible
      ? Math.max(0, labelOutline.width + labelOutline.offset)
      : 0;
    const inside = (inner, outer) => inner.left >= outer.left - 1
      && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1
      && inner.bottom <= outer.bottom + 1;

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      forcedColorsActive: matchMedia('(forced-colors: active)').matches,
      radioFocused: document.activeElement === radio,
      radioFocusVisible: radio.matches(':focus-visible'),
      radioAlignSelf: inputStyle.alignSelf,
      radioJustifySelf: inputStyle.justifySelf,
      radioRect,
      labelRect,
      radioSquare: Math.abs(radioRect.width - radioRect.height) <= 0.5,
      radioInsideLabel: inside(radioRect, labelRect),
      inputOutline,
      labelOutline,
      labelBackground: labelStyle.backgroundColor,
      labelSelected: label.classList.contains('is-selected'),
      labelTextColor: labelStyle.color,
      visibleFocusOutlineCount: Number(inputOutline.visible) + Number(labelOutline.visible),
      cardRingContainment: {
        clipRect,
        dialogClientRect,
        dialogRect,
        labelRect,
        ringExtent,
        dialogScroll: {
          clientHeight: dialog.clientHeight,
          scrollHeight: dialog.scrollHeight,
          scrollTop: dialog.scrollTop,
        },
        left: labelRect.left - ringExtent >= clipRect.left - 1,
        right: labelRect.right + ringExtent <= clipRect.right + 1,
        top: labelRect.top - ringExtent >= clipRect.top - 1,
        bottom: labelRect.bottom + ringExtent <= clipRect.bottom + 1,
      },
      cardRingContained: labelRect.left - ringExtent >= clipRect.left - 1
        && labelRect.right + ringExtent <= clipRect.right + 1
        && labelRect.top - ringExtent >= clipRect.top - 1
        && labelRect.bottom + ringExtent <= clipRect.bottom + 1,
      labelsStacked: Math.abs(orderedLabelRects[0].left - orderedLabelRects[1].left) <= 1
        && orderedLabelRects[1].top >= orderedLabelRects[0].bottom - 1,
      gridColumnCount: pickerStyle.gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
      pageNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      dialogNoHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
      pickerNoHorizontalOverflow: picker.scrollWidth <= picker.clientWidth + 1,
    };
  })();
}

function openSavedTermsProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const workspaceTimeout = 20_000;
    document.querySelector('button[aria-label="关闭回复草稿"]')?.click();
    let deadline = Date.now() + workspaceTimeout;
    while (document.querySelector('.reply-drawer') && Date.now() < deadline) await wait(25);
    const trigger = document.querySelector('.saved-terms-trigger');
    if (!trigger) throw new Error('Saved Terms trigger is unavailable');
    trigger.focus({ preventScroll: true });
    await wait(250);
    trigger.click();
    deadline = Date.now() + workspaceTimeout;
    let card = null;
    while (Date.now() < deadline) {
      card = document.querySelector('.saved-term-card');
      if (card) break;
      if (document.querySelector('[data-workspace-load-failure="saved-terms"]')) {
        throw new Error('Saved Terms workspace failed while preparing the accessibility probe');
      }
      await wait(25);
    }
    if (!card) throw new Error('Sample Saved Term card is unavailable');
    const term = card.querySelector('strong[lang]');
    const evidence = card.querySelector('q [lang]');
    if (!term || !evidence) throw new Error('Saved Term language boundaries are unavailable');
    return {
      termText: term.textContent.trim(),
      termLanguage: term.getAttribute('lang'),
      evidenceText: evidence.textContent.trim(),
      evidenceLanguage: evidence.getAttribute('lang'),
    };
  })();
}

function savedTermsImportPreviewProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const drawer = document.querySelector('.saved-terms-drawer');
    if (!drawer) throw new Error('Saved Terms drawer is unavailable for import preview');
    const importButton = [...drawer.querySelectorAll('button')].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
    ));
    if (!importButton || importButton.disabled) throw new Error('Saved Terms import action is unavailable');
    const termCountBeforeCommit = drawer.querySelectorAll('.saved-term-card').length;
    importButton.click();

    const deadline = Date.now() + 7_000;
    let trustReview = null;
    while (Date.now() < deadline) {
      trustReview = drawer.querySelector('#term-import-trust-review');
      if (trustReview && document.activeElement === trustReview) break;
      await wait(25);
    }
    const preview = drawer.querySelector(
      '.saved-term-transfer__confirm[aria-labelledby="term-import-title"]',
    );
    const previewTitle = drawer.querySelector('#term-import-title');
    const trustTitle = drawer.querySelector('#term-import-trust-title');
    const trustSummary = drawer.querySelector('#term-import-trust-summary');
    const downgradeWarning = drawer.querySelector('#term-import-downgrade-warning');
    const cancelButton = [...(preview?.querySelectorAll('button') || [])].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '取消'
    ));
    const confirmButton = [...(preview?.querySelectorAll('button') || [])].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '确认导入'
    ));
    if (!preview || !previewTitle || !trustReview || !trustTitle || !trustSummary
      || !downgradeWarning || !cancelButton || !confirmButton) {
      throw new Error('Saved Terms import trust preview is incomplete');
    }
    const orderedElements = [...preview.querySelectorAll('*')];
    const describedBy = new Set((confirmButton.getAttribute('aria-describedby') || '').split(/\s+/u).filter(Boolean));
    const trustText = trustReview.textContent.replace(/\s+/gu, ' ').trim();
    const focusStyle = window.getComputedStyle(trustReview);
    const focusRect = trustReview.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    const focusExtent = Number.parseFloat(focusStyle.outlineWidth || '0')
      + Number.parseFloat(focusStyle.outlineOffset || '0');
    const active = document.activeElement;
    return {
      previewVisible: preview.getClientRects().length > 0,
      previewTitleTag: previewTitle.tagName,
      previewTitleText: previewTitle.textContent.replace(/\s+/gu, ' ').trim(),
      trustReviewRole: trustReview.getAttribute('role'),
      trustReviewLabelledBy: trustReview.getAttribute('aria-labelledby'),
      trustReviewFocused: active === trustReview,
      confirmFocused: active === confirmButton,
      activeElementIsLiveOwner: Boolean(
        active?.matches?.('[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])'),
      ),
      trustReviewBeforeActions: orderedElements.indexOf(trustReview) < orderedElements.indexOf(cancelButton),
      cancelBeforeConfirm: orderedElements.indexOf(cancelButton) < orderedElements.indexOf(confirmButton),
      confirmDescribedBySummary: describedBy.has('term-import-trust-summary'),
      confirmDescribedByDowngrade: describedBy.has('term-import-downgrade-warning'),
      trustReviewMentionsEvidenceBoundary: trustText.includes('不会导入原文证据'),
      trustReviewMentionsTrustDowngrade: trustText.includes('来源状态未知'),
      trustReviewMentionsLocalRetention: trustText.includes('本机已有') && trustText.includes('保留'),
      termCountBeforeCommit,
      downgradeWarningFontSize: Number.parseFloat(
        window.getComputedStyle(downgradeWarning).fontSize || '0',
      ),
      focusRingVisible: Number.parseFloat(focusStyle.outlineWidth || '0') >= 3
        && focusStyle.outlineStyle !== 'none',
      focusRingStyle: {
        color: focusStyle.outlineColor,
        offset: focusStyle.outlineOffset,
        style: focusStyle.outlineStyle,
        width: focusStyle.outlineWidth,
      },
      focusRingContained: focusRect.top - focusExtent >= drawerRect.top
        && focusRect.bottom + focusExtent <= drawerRect.bottom,
      nonQuerySearchLive: drawer.querySelector('#saved-term-drawer-search-status')?.getAttribute('aria-live') || '',
      outcomeLiveOwnerCount: [...drawer.querySelectorAll(
        '[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])',
      )].filter((element, index, all) => all.indexOf(element) === index
        && element.textContent.replace(/\s+/gu, ' ').trim().includes('导入完成')).length,
    };
  })();
}

function savedTermsImportCommitProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const drawer = document.querySelector('.saved-terms-drawer');
    const preview = drawer?.querySelector(
      '.saved-term-transfer__confirm[aria-labelledby="term-import-title"]',
    );
    const confirmButton = [...(preview?.querySelectorAll('button') || [])].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '确认导入'
    ));
    if (!drawer || !preview || !confirmButton) throw new Error('Saved Terms import confirmation is unavailable');
    confirmButton.click();

    const outcomeMessage = '导入完成：新增 1 条，更新 0 条；现在共 2 条。';
    const deadline = Date.now() + 7_000;
    let visibleStatus = null;
    let importButton = null;
    while (Date.now() < deadline) {
      visibleStatus = drawer.querySelector('.saved-term-transfer__status');
      importButton = [...drawer.querySelectorAll('button')].find((candidate) => (
        candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
      ));
      if (!drawer.querySelector('#term-import-title')
        && visibleStatus?.textContent.replace(/\s+/gu, ' ').trim() === outcomeMessage
        && document.activeElement === importButton) break;
      await wait(25);
    }

    const liveOwners = [...drawer.querySelectorAll(
      '[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])',
    )].filter((element, index, all) => all.indexOf(element) === index);
    const active = document.activeElement;
    const hiddenAnnouncement = drawer.querySelector('.result-a11y-live');
    return {
      outcomeMessage,
      previewRemoved: !drawer.querySelector('#term-import-title'),
      termCountAfterCommit: drawer.querySelectorAll('.saved-term-card').length,
      importButtonFocused: active === importButton,
      activeElementIsLiveOwner: Boolean(
        active?.matches?.('[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])'),
      ),
      visibleStatusRole: visibleStatus?.getAttribute('role') || '',
      visibleStatusAtomic: visibleStatus?.getAttribute('aria-atomic') || '',
      exactMessageOwnerCount: liveOwners.filter((element) => (
        element.textContent.replace(/\s+/gu, ' ').trim() === outcomeMessage
      )).length,
      hiddenAnnouncementContainsOutcome: Boolean(
        hiddenAnnouncement?.textContent.replace(/\s+/gu, ' ').trim().includes(outcomeMessage),
      ),
      nonQuerySearchLive: drawer.querySelector('#saved-term-drawer-search-status')?.getAttribute('aria-live') || '',
    };
  })();
}

function savedTermsImportReopenProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    let drawer = document.querySelector('.saved-terms-drawer');
    const trigger = document.querySelector('.saved-terms-trigger');
    let importButton = [...(drawer?.querySelectorAll('button') || [])].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
    ));
    if (!drawer || !trigger || !importButton || importButton.disabled) {
      throw new Error('Saved Terms reopen probe cannot start another import preview');
    }
    importButton.focus({ preventScroll: true });
    await wait(50);
    drawer = document.querySelector('.saved-terms-drawer');
    importButton = [...(drawer?.querySelectorAll('button') || [])].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
    ));
    if (!drawer || !importButton || importButton.disabled) {
      throw new Error('Saved Terms import action did not survive intent focus');
    }
    importButton.click();
    let deadline = Date.now() + 7_000;
    let trustReview = null;
    let closeButton = null;
    while (Date.now() < deadline) {
      trustReview = drawer.querySelector('#term-import-trust-review');
      closeButton = drawer.querySelector('button[aria-label="关闭术语库"]:not(:disabled)');
      if (trustReview && document.activeElement === trustReview && closeButton) break;
      await wait(25);
    }
    // The development-only React StrictMode fixture may finish its deliberate
    // lazy-subtree remount on this first stateful interaction. Reacquire that
    // connected instance once; the production file:// gate separately proves
    // that the real packaged import session does not remount.
    if (!drawer.isConnected) {
      drawer = document.querySelector('.saved-terms-drawer');
      importButton = [...(drawer?.querySelectorAll('button') || [])].find((candidate) => (
        candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
      ));
      if (!drawer || !importButton || importButton.disabled) {
        throw new Error('Saved Terms remounted import action is unavailable');
      }
      importButton.focus({ preventScroll: true });
      importButton.click();
      deadline = Date.now() + 7_000;
      trustReview = null;
      closeButton = null;
      while (Date.now() < deadline) {
        trustReview = drawer.querySelector('#term-import-trust-review');
        closeButton = drawer.querySelector('button[aria-label="关闭术语库"]:not(:disabled)');
        if (trustReview && document.activeElement === trustReview && closeButton) break;
        await wait(25);
      }
    }
    const secondPreviewTrustFocused = Boolean(trustReview && document.activeElement === trustReview);
    if (!closeButton) {
      const liveDrawer = document.querySelector('.saved-terms-drawer');
      throw new Error(`Saved Terms close action is unavailable: ${JSON.stringify({
        drawerConnected: Boolean(drawer?.isConnected),
        liveDrawerMatches: liveDrawer === drawer,
        liveSummary: liveDrawer?.querySelector('.saved-terms-drawer__header p:last-child')?.textContent || '',
        liveCloseDisabled: liveDrawer?.querySelector('button[aria-label="关闭术语库"]')?.disabled ?? null,
        liveTrustReview: Boolean(liveDrawer?.querySelector('#term-import-trust-review')),
        liveImportDisabled: [...(liveDrawer?.querySelectorAll('button') || [])].find((candidate) => (
          candidate.textContent.replace(/\s+/gu, ' ').trim() === '导入备份'
        ))?.disabled ?? null,
        activeId: document.activeElement?.id || '',
        activeText: document.activeElement?.textContent?.replace(/\s+/gu, ' ').trim() || '',
        importPreviewRequests: document.documentElement.dataset.demoTermsImportPreviewRequests || '',
      })}`);
    }
    closeButton.click();
    deadline = Date.now() + 7_000;
    while (document.querySelector('.saved-terms-drawer') && Date.now() < deadline) await wait(25);
    while (document.activeElement !== trigger && Date.now() < deadline) await wait(25);
    const closeReturnedToTrigger = document.activeElement === trigger;
    trigger.click();
    deadline = Date.now() + 7_000;
    let search = null;
    while (Date.now() < deadline) {
      drawer = document.querySelector('.saved-terms-drawer');
      search = drawer?.querySelector('#saved-term-drawer-search');
      if (search && document.activeElement === search) break;
      await wait(25);
    }
    return {
      secondPreviewTrustFocused,
      closeReturnedToTrigger,
      reopenedDrawer: Boolean(drawer?.isConnected),
      stalePreviewAbsent: !drawer?.querySelector('#term-import-title'),
      searchFocused: document.activeElement === search,
      staleTransferMessageAbsent: !drawer?.querySelector('.saved-term-transfer__status'),
      termCountAfterReopen: drawer?.querySelectorAll('.saved-term-card').length || 0,
    };
  })();
}

function setupHandoffProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const button = [...document.querySelectorAll('button')].find((candidate) => (
      candidate.textContent.replace(/\s+/gu, ' ').trim().includes('我明确选择只用基础翻译')
    ));
    if (!button) throw new Error('Basic translation setup action is unavailable');
    button.click();
    const deadline = Date.now() + 7_000;
    let textarea = null;
    while (Date.now() < deadline) {
      textarea = document.querySelector('.capture-input textarea[aria-label="要解释的完整原文"]');
      if (textarea && document.activeElement === textarea) break;
      await wait(25);
    }
    return {
      clickedBasicTranslation: true,
      captureReady: Boolean(textarea?.isConnected),
      sourceTextareaFocused: Boolean(textarea && document.activeElement === textarea),
      activeElementLabel: document.activeElement?.getAttribute?.('aria-label') || '',
      testSideFocusManipulation: false,
    };
  })();
}

function processingHandoffProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const waitFor = async (read, label, timeout = 7_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = read();
        if (value) return value;
        await wait(25);
      }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const buttonWithText = (text) => [...document.querySelectorAll('button')].find((button) => (
      button.textContent.replace(/\s+/gu, ' ').trim().includes(text)
    ));

    const captureCard = await waitFor(
      () => document.querySelector('.capture-card'),
      'capture fixture',
    );
    const sampleAction = buttonWithText('载入安全示例');
    if (!sampleAction) throw new Error('Safe sample action is unavailable');
    sampleAction.click();
    const source = await waitFor(
      () => {
        const candidate = captureCard.querySelector('textarea[aria-label="要解释的完整原文"]');
        return candidate?.value.trim() ? candidate : null;
      },
      'safe sample source',
    );
    const processAction = await waitFor(
      () => {
        const candidate = captureCard.querySelector('.process-button');
        return candidate && !candidate.disabled ? candidate : null;
      },
      'enabled processing action',
    );

    let liveRegionMountedEmpty = null;
    let statusOwnerCountAtMount = null;
    let liveOwnerCountAtMount = null;
    let liveObserver = null;
    const announcements = [];
    const mountObserver = new MutationObserver(() => {
      const processingCard = document.querySelector('.processing-card');
      if (!processingCard || liveObserver) return;
      const liveRegion = processingCard.querySelector('[role="status"][aria-live="polite"]');
      if (!liveRegion) return;
      liveRegionMountedEmpty = liveRegion.textContent.trim() === '';
      statusOwnerCountAtMount = processingCard.querySelectorAll('[role="status"]').length;
      liveOwnerCountAtMount = processingCard.querySelectorAll('[aria-live]').length;
      liveObserver = new MutationObserver(() => {
        const message = liveRegion.textContent.trim();
        if (message) announcements.push(message);
      });
      liveObserver.observe(liveRegion, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      mountObserver.disconnect();
    });
    mountObserver.observe(document.body, { childList: true, subtree: true });

    processAction.click();
    const processingCard = await waitFor(
      () => document.querySelector('.processing-card'),
      'processing card',
    );
    const context = await waitFor(
      () => document.querySelector('#processing-context-title'),
      'processing focus context',
    );
    await waitFor(
      () => document.activeElement === context,
      'processing context focus handoff',
    );
    await waitFor(
      () => announcements.includes('正在准备原文…'),
      'initial processing announcement',
    );
    await waitFor(
      () => announcements.includes('正在等待所选服务返回…'),
      'follow-up processing announcement',
      5_000,
    );
    await wait(1_200);

    liveObserver?.disconnect();
    mountObserver.disconnect();
    const visibleStatus = processingCard.querySelector('.processing-status > span[aria-hidden="true"]')
      ?.textContent.trim() || '';
    return {
      safeSampleLoaded: source.value.startsWith('Dear Student,'),
      processActionActivated: Number(document.documentElement.dataset.demoProcessRequests) === 1,
      contextId: context.id,
      contextFocused: document.activeElement === context,
      activeElementId: document.activeElement?.id || '',
      activeElementIsBody: document.activeElement === document.body,
      testSideFocusManipulation: false,
      liveRegionMountedEmpty,
      statusOwnerCount: statusOwnerCountAtMount,
      liveOwnerCount: liveOwnerCountAtMount,
      announcements,
      visibleStatus,
    };
  })();
}

function settingsSaveRetryProbe() {
  return (async () => {
    const wait = (milliseconds) => new Promise((resolveWait) => window.setTimeout(resolveWait, milliseconds));
    const waitFor = async (read, label, timeout = 20_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = read();
        if (value) return value;
        await wait(25);
      }
      throw new Error(`Timed out waiting for ${label}`);
    };

    const openSettings = await waitFor(
      () => document.querySelector('[aria-label="打开设置"]'),
      'Settings trigger for credential save retry',
    );
    openSettings.click();
    const panel = await waitFor(
      () => document.querySelector('.settings-panel'),
      'Settings panel for credential save retry',
    );
    const input = await waitFor(
      () => panel.querySelector('#provider-connection-input'),
      'DeepSeek credential editor for save retry',
    );
    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;
    inputValueSetter.call(input, 'fixture-replacement-credential-never-leaves-runtime');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const saveButton = await waitFor(
      () => {
        const candidate = input.parentElement?.parentElement
          ?.querySelector('.setting-save-button');
        return candidate && !candidate.disabled ? candidate : null;
      },
      'enabled DeepSeek credential save action',
    );
    saveButton.click();
    await waitFor(
      () => input.parentElement?.parentElement
        ?.querySelector('.setting-save-status.is-error'),
      'failed local DeepSeek credential status',
    );
    const recovery = await waitFor(
      () => panel.querySelector('.settings-save-recovery[role="alert"]'),
      'global credential save recovery action',
    );
    const retry = recovery.querySelector('button');
    if (!retry) throw new Error('Credential save retry action is unavailable');
    retry.click();
    const recovered = await waitFor(
      () => panel.querySelector('.settings-save-recovered[role="status"]'),
      'credential save recovery completion',
    );
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    recovered.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));

    const editor = input.parentElement?.parentElement;
    const editorStatus = editor?.querySelector('.setting-save-status');
    const currentSaveButton = editor?.querySelector('.setting-save-button');
    const testButton = panel.querySelector('.provider-connection-test-button');
    const liveOwners = [...panel.querySelectorAll('[role="status"], [role="alert"], [aria-live]')]
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element) => ({
        role: element.getAttribute('role') || '',
        live: element.getAttribute('aria-live') || '',
        text: element.textContent.replace(/\s+/gu, ' ').trim(),
      }))
      .filter((owner) => owner.text);
    const active = document.activeElement;
    return {
      globalRecoveryVisible: recovered.isConnected,
      globalRecoveryText: recovered.textContent.replace(/\s+/gu, ' ').trim(),
      localErrorVisible: Boolean(editor?.querySelector('.setting-save-status.is-error')),
      localStatusText: editorStatus?.textContent.replace(/\s+/gu, ' ').trim() || '',
      draftCleared: input.value === '',
      saveButtonDisabled: Boolean(currentSaveButton?.disabled),
      testButtonEnabled: Boolean(testButton && !testButton.disabled),
      testButtonText: testButton?.textContent.replace(/\s+/gu, ' ').trim() || '',
      testButtonFocused: active === testButton,
      activeElementIsBody: active === document.body,
      activeElementRole: active?.getAttribute?.('role') || active?.tagName?.toLowerCase() || '',
      activeElementIsLiveOwner: Boolean(
        active?.matches?.('[role="status"], [role="alert"], [aria-live]')
      ),
      testSideFocusManipulation: false,
      liveOwners,
      deepseekCredentialWriteRequests: Number(
        document.documentElement.dataset.demoDeepseekCredentialWriteRequests,
      ),
      deepseekCredentialWriteSuccesses: Number(
        document.documentElement.dataset.demoDeepseekCredentialWriteSuccesses,
      ),
    };
  })();
}

async function evaluateProbe(webContents, probe) {
  return webContents.executeJavaScript(`(${probe.toString()})()`, true);
}

function compactAxTree(response) {
  const keptRoles = new Set([
    'RootWebArea',
    'main',
    'region',
    'heading',
    'button',
    'dialog',
    'textbox',
    'searchbox',
    'StaticText',
    'article',
    'note',
    'alert',
    'status',
  ]);
  return (response?.nodes || []).flatMap((node) => {
    const role = typeof node.role?.value === 'string' ? node.role.value : '';
    if (node.ignored === true || !keptRoles.has(role)) return [];
    const properties = Array.isArray(node.properties) ? node.properties : [];
    const property = (name) => properties.find((candidate) => candidate.name === name)?.value;
    const level = property('level')?.value;
    const expanded = property('expanded')?.value;
    const controls = property('controls')?.relatedNodes;
    return [{
      role,
      name: typeof node.name?.value === 'string' ? node.name.value : '',
      description: typeof node.description?.value === 'string' ? node.description.value : '',
      focused: properties.some((candidate) => (
        candidate.name === 'focused' && candidate.value?.value === true
      )),
      level: Number.isInteger(level) ? level : null,
      expanded: typeof expanded === 'boolean' ? expanded : null,
      controls: Array.isArray(controls)
        ? controls.map((relatedNode) => relatedNode.idref).filter(Boolean)
        : [],
    }];
  });
}

async function attachAccessibilityDebugger(webContents) {
  webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Accessibility.enable');
}

async function accessibilityInventory(webContents) {
  return compactAxTree(await webContents.debugger.sendCommand('Accessibility.getFullAXTree'));
}

async function disclosureAccessibilityInventory(webContents) {
  const inventory = await accessibilityInventory(webContents);
  const disclosureNames = new Set([
    '完整翻译',
    '补充解释',
    '材料清单',
    '截止日期',
    '词语与术语',
    '流程背景',
    '官方来源',
    '待核验',
  ]);
  const hiddenContentSentinels = [
    '亲爱的同学',
    '解释原文',
    '材料原文',
    '日期原文',
    '词语原文',
    '背景原文',
    '批准后将访问以下候选官方页面',
    '触发核验的原文',
    '处理阶段已折叠',
  ];
  return inventory.filter((entry) => (
    disclosureNames.has(entry.name)
      || entry.name.startsWith('处理完成 · ')
      || hiddenContentSentinels.some((sentinel) => entry.name.includes(sentinel))
  ));
}

async function writeHarnessOutcome(app, payload, exitCode) {
  await new Promise((resolveWrite) => {
    process.stdout.write(`${outputPrefix}${JSON.stringify(payload)}\n`, resolveWrite);
  });
  app.exit(exitCode);
}

async function runElectronHarness() {
  const {
    app,
    BrowserWindow,
    Menu,
    session,
  } = require('electron');
  let resultWindow = null;
  let setupWindow = null;
  let captureWindow = null;
  let resultDebuggerAttached = false;
  let setupDebuggerAttached = false;
  let captureDebuggerAttached = false;
  try {
    const resultUrl = validateFixtureRendererUrl(process.env[resultUrlEnvironment]);
    const setupUrl = validateFixtureRendererUrl(process.env[setupUrlEnvironment]);
    const captureUrl = validateFixtureRendererUrl(process.env[captureUrlEnvironment]);
    const userDataPath = validateFixtureUserDataPath(process.env[userDataEnvironment]);
    const evidenceDirectory = validateEvidenceDirectory(process.env[evidenceDirEnvironment]);
    const evidenceFiles = [];
    const resultLocation = new URL(resultUrl);
    const setupLocation = new URL(setupUrl);
    const captureLocation = new URL(captureUrl);
    assert.equal(resultLocation.origin, setupLocation.origin);
    assert.equal(resultLocation.origin, captureLocation.origin);
    const rendererOrigin = resultLocation.origin;
    const trapOrigin = `http://127.0.0.1:${resultLocation.searchParams.get('trapPort')}`;
    const trapUrl = `${trapOrigin}/screen-reader-runtime-probe`;
    const sessionDataPath = join(userDataPath, 'session');
    const normalUserDataPath = app.getPath('userData');
    const normalSessionDataPath = app.getPath('sessionData');
    assert.equal(modeBits(userDataPath), 0o700);
    assert.equal(modeBits(sessionDataPath), 0o700);
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', sessionDataPath);
    app.enableSandbox();
    const pathsSetBeforeReady = !app.isReady();
    await app.whenReady();
    Menu.setApplicationMenu(null);

    const fixtureSession = session.defaultSession;
    const fixtureWebContentsIds = new Set();
    let blockedProbeRequests = 0;
    const unexpectedExternalUrls = [];
    fixtureSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    fixtureSession.setPermissionCheckHandler(() => false);
    fixtureSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const requestUrl = new URL(details.url);
        allowed = (
          ['http:', 'ws:'].includes(requestUrl.protocol)
          && requestUrl.hostname === resultLocation.hostname
          && requestUrl.port === resultLocation.port
        ) || requestUrl.protocol === 'data:'
          || (requestUrl.protocol === 'blob:' && requestUrl.origin === rendererOrigin);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        if (details.url.startsWith(trapOrigin)) blockedProbeRequests += 1;
        else if (fixtureWebContentsIds.has(details.webContentsId)) unexpectedExternalUrls.push(details.url);
      }
      callback({ cancel: !allowed });
    });

    let sessionTrapFetchBlocked = false;
    try {
      await fixtureSession.fetch(trapUrl, { cache: 'no-store' });
    } catch {
      sessionTrapFetchBlocked = true;
    }

    const allowedRendererUrls = new Set([resultUrl, setupUrl, captureUrl]);
    const createFixtureWindow = async (url) => {
      const fixtureWindow = new BrowserWindow({
        width: 1106,
        height: 768,
        show: false,
        webPreferences: {
          preload: join(projectRoot, 'scripts', 'ui-fixture-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      fixtureWebContentsIds.add(fixtureWindow.webContents.id);
      fixtureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      fixtureWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
      fixtureWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (!allowedRendererUrls.has(targetUrl)) event.preventDefault();
      });
      await fixtureWindow.loadURL(url);
      return fixtureWindow;
    };

    resultWindow = await createFixtureWindow(resultUrl);
    const resultUrlExact = resultWindow.webContents.getURL() === resultUrl;
    const resultWindowHidden = !resultWindow.isVisible();
    const resultPreferences = resultWindow.webContents.getLastWebPreferences();
    await waitForResultEvidenceSurface(resultWindow.webContents);
    if (evidenceDirectory) {
      await attachAccessibilityDebugger(resultWindow.webContents);
      resultDebuggerAttached = true;
      await settleEvidenceRendering(resultWindow.webContents);
      await captureEvidence(
        resultWindow.webContents,
        evidenceDirectory,
        '01-result-named-main.png',
        evidenceFiles,
      );
    }
    if (!resultDebuggerAttached) {
      await attachAccessibilityDebugger(resultWindow.webContents);
      resultDebuggerAttached = true;
    }
    const domResultDisclosuresCollapsed = await evaluateProbe(
      resultWindow.webContents,
      resultDisclosuresCollapsedProbe,
    );
    const axResultCollapsed = await disclosureAccessibilityInventory(resultWindow.webContents);
    const domDeadlineDisclosureOpen = await evaluateProbe(
      resultWindow.webContents,
      openDeadlineDisclosureProbe,
    );
    const axDeadlineOpen = await disclosureAccessibilityInventory(resultWindow.webContents);
    const domDeadlineDisclosureClosed = await evaluateProbe(
      resultWindow.webContents,
      closeDeadlineDisclosureProbe,
    );
    const axDeadlineClosed = await disclosureAccessibilityInventory(resultWindow.webContents);
    const domResult = await evaluateProbe(resultWindow.webContents, resultDomProbe);
    const renderer = await resultWindow.webContents.executeJavaScript(`(async () => {
      const clipboardResult = await window.api.invoke('clipboard:write', 'fixture-only-screen-reader-probe');
      let rendererTrapFetchBlocked = false;
      try {
        await fetch(${JSON.stringify(trapUrl)}, { cache: 'no-store' });
      } catch {
        rendererTrapFetchBlocked = true;
      }
      return {
        marker: window.slipstreamUiFixture,
        nodeGlobalsUnavailable: typeof require === 'undefined' && typeof process === 'undefined',
        clipboardStubbed: clipboardResult?.fixture === true,
        rendererTrapFetchBlocked,
      };
    })()`, true);

    const axResult = await accessibilityInventory(resultWindow.webContents);
    const originalResultContentSize = resultWindow.getContentSize();
    const originalResultZoomFactor = resultWindow.webContents.getZoomFactor();
    resultWindow.setContentSize(520, 680);
    resultWindow.webContents.setZoomFactor(1);
    await setReplyMediaState(resultWindow.webContents, 'normal');
    const domReply = await evaluateProbe(resultWindow.webContents, openReplyProbe);
    await focusReplyStatusWithKeyboard(resultWindow.webContents);
    const normalReplyStatusFocus = {
      ...await evaluateProbe(resultWindow.webContents, replyStatusFocusProbe),
      zoomFactor: resultWindow.webContents.getZoomFactor(),
    };
    resultWindow.webContents.setZoomFactor(2);
    await setReplyMediaState(resultWindow.webContents, 'normal');
    await focusReplyStatusWithKeyboard(resultWindow.webContents);
    const textScaleReplyStatusFocus = {
      ...await evaluateProbe(resultWindow.webContents, replyStatusFocusProbe),
      zoomFactor: resultWindow.webContents.getZoomFactor(),
    };
    await setReplyMediaState(resultWindow.webContents, 'forced');
    await focusReplyStatusWithKeyboard(resultWindow.webContents);
    const forcedColorsReplyStatusFocus = {
      ...await evaluateProbe(resultWindow.webContents, replyStatusFocusProbe),
      zoomFactor: resultWindow.webContents.getZoomFactor(),
    };
    resultWindow.webContents.setZoomFactor(originalResultZoomFactor);
    resultWindow.setContentSize(...originalResultContentSize);
    await setReplyMediaState(resultWindow.webContents, 'normal');
    const axReply = await accessibilityInventory(resultWindow.webContents);
    const domSavedTerms = await evaluateProbe(resultWindow.webContents, openSavedTermsProbe);
    const axSavedTerms = await accessibilityInventory(resultWindow.webContents);
    const domSavedTermsImportPreview = await evaluateProbe(
      resultWindow.webContents,
      savedTermsImportPreviewProbe,
    );
    const axSavedTermsImportPreview = await accessibilityInventory(resultWindow.webContents);
    const domSavedTermsImportCommit = await evaluateProbe(
      resultWindow.webContents,
      savedTermsImportCommitProbe,
    );
    const axSavedTermsImportCommit = await accessibilityInventory(resultWindow.webContents);
    const domSavedTermsImportReopen = await evaluateProbe(
      resultWindow.webContents,
      savedTermsImportReopenProbe,
    );
    resultWindow.webContents.debugger.detach();
    resultDebuggerAttached = false;
    setupWindow = resultWindow;
    resultWindow = null;

    await setupWindow.loadURL(setupUrl);
    const setupWindowHidden = !setupWindow.isVisible();
    const setupPreferences = setupWindow.webContents.getLastWebPreferences();
    await setupWindow.webContents.executeJavaScript(`new Promise((resolveWait, rejectWait) => {
      const deadline = Date.now() + 7000;
      const check = () => {
        if (document.querySelector('#setup-title')) return resolveWait(true);
        if (Date.now() >= deadline) return rejectWait(new Error('Timed out waiting for setup fixture'));
        window.setTimeout(check, 25);
      };
      check();
    })`, true);
    await attachAccessibilityDebugger(setupWindow.webContents);
    setupDebuggerAttached = true;
    const axSetupBefore = await accessibilityInventory(setupWindow.webContents);
    const setupHandoff = await evaluateProbe(setupWindow.webContents, setupHandoffProbe);
    const axSetupAfter = await accessibilityInventory(setupWindow.webContents);

    captureWindow = await createFixtureWindow(captureUrl);
    const captureWindowHidden = !captureWindow.isVisible();
    const capturePreferences = captureWindow.webContents.getLastWebPreferences();
    if (evidenceDirectory) {
      await attachAccessibilityDebugger(captureWindow.webContents);
      captureDebuggerAttached = true;
      await settleEvidenceRendering(captureWindow.webContents);
    }
    const domProcessing = await evaluateProbe(
      captureWindow.webContents,
      processingHandoffProbe,
    );
    if (evidenceDirectory) {
      await settleEvidenceRendering(captureWindow.webContents);
      await captureEvidence(
        captureWindow.webContents,
        evidenceDirectory,
        '02-processing-status.png',
        evidenceFiles,
      );
    }
    if (!captureDebuggerAttached) {
      await attachAccessibilityDebugger(captureWindow.webContents);
      captureDebuggerAttached = true;
    }
    const axProcessing = await accessibilityInventory(captureWindow.webContents);

    await captureWindow.loadURL(captureUrl);
    captureWindow.setContentSize(520, 680);
    const domSettingsSaveRetry = await evaluateProbe(
      captureWindow.webContents,
      settingsSaveRetryProbe,
    );
    if (evidenceDirectory) {
      await settleEvidenceRendering(captureWindow.webContents);
      await captureEvidence(
        captureWindow.webContents,
        evidenceDirectory,
        '04-after-fix-save-retry-recovered.png',
        evidenceFiles,
      );
    }
    const axSettingsSaveRetry = await accessibilityInventory(captureWindow.webContents);

    const inheritedSecretLikeEnvironmentKeys = Object.keys(process.env)
      .filter(secretLikeEnvironmentName).length;
    const normalProfileExcluded = resolve(normalUserDataPath) !== resolve(userDataPath)
      && resolve(normalSessionDataPath) !== resolve(sessionDataPath)
      && !resolve(userDataPath).startsWith(`${resolve(normalUserDataPath)}${sep}`)
      && !resolve(sessionDataPath).startsWith(`${resolve(normalSessionDataPath)}${sep}`);
    const proof = {
      success: true,
      urls: {
        resultExact: resultUrlExact,
        setupExact: setupWindow.webContents.getURL() === setupUrl,
        captureExact: captureWindow.webContents.getURL() === captureUrl,
        sameLoopbackOrigin: resultLocation.origin === setupLocation.origin
          && resultLocation.origin === captureLocation.origin,
      },
      isolation: {
        userDataIsFixture: app.getPath('userData') === userDataPath,
        userDataMode: modeBits(userDataPath),
        sessionDataIsNested: app.getPath('sessionData').startsWith(`${userDataPath}${sep}`),
        sessionDataMode: modeBits(sessionDataPath),
        normalProfileExcluded,
        pathsSetBeforeReady,
        resultWindowHidden,
        setupWindowHidden,
        captureWindowHidden,
        contextIsolation: resultPreferences.contextIsolation === true
          && setupPreferences.contextIsolation === true
          && capturePreferences.contextIsolation === true,
        nodeIntegrationDisabled: resultPreferences.nodeIntegration === false
          && setupPreferences.nodeIntegration === false
          && capturePreferences.nodeIntegration === false,
        sandboxEnabled: resultPreferences.sandbox === true
          && setupPreferences.sandbox === true
          && capturePreferences.sandbox === true,
        inheritedSecretLikeEnvironmentKeys,
        permissionRequestHandlerDenies: true,
        permissionCheckHandlerDenies: true,
      },
      network: {
        sessionTrapFetchBlocked,
        rendererTrapFetchBlocked: renderer.rendererTrapFetchBlocked,
        blockedProbeRequests,
        unexpectedExternalUrls,
      },
      renderer: {
        marker: renderer.marker,
        nodeGlobalsUnavailable: renderer.nodeGlobalsUnavailable,
        clipboardStubbed: renderer.clipboardStubbed,
      },
      dom: {
        result: domResult,
        resultDisclosuresCollapsed: domResultDisclosuresCollapsed,
        deadlineDisclosureOpen: domDeadlineDisclosureOpen,
        deadlineDisclosureClosed: domDeadlineDisclosureClosed,
        reply: domReply,
        replyStatusFocus: {
          normal: normalReplyStatusFocus,
          textScale: textScaleReplyStatusFocus,
          forcedColors: forcedColorsReplyStatusFocus,
        },
        savedTerms: domSavedTerms,
        savedTermsImportPreview: domSavedTermsImportPreview,
        savedTermsImportCommit: domSavedTermsImportCommit,
        savedTermsImportReopen: domSavedTermsImportReopen,
        processing: domProcessing,
        settingsSaveRetry: domSettingsSaveRetry,
      },
      ax: {
        result: axResult,
        resultCollapsed: axResultCollapsed,
        deadlineOpen: axDeadlineOpen,
        deadlineClosed: axDeadlineClosed,
        reply: axReply,
        savedTerms: axSavedTerms,
        savedTermsImportPreview: axSavedTermsImportPreview,
        savedTermsImportCommit: axSavedTermsImportCommit,
        setupBefore: axSetupBefore,
        setupAfter: axSetupAfter,
        processing: axProcessing,
        settingsSaveRetry: axSettingsSaveRetry,
      },
      setupHandoff,
      evidence: {
        enabled: Boolean(evidenceDirectory),
        directory: evidenceDirectory,
        files: evidenceFiles,
      },
      claim: 'Chromium DOM and Accessibility Tree semantics only; VoiceOver speech was not exercised.',
    };
    await writeHarnessOutcome(app, proof, 0);
  } catch (error) {
    await writeHarnessOutcome(app, {
      success: false,
      error: String(error?.stack || error?.message || error),
    }, 1);
  } finally {
    if (resultDebuggerAttached && resultWindow && !resultWindow.isDestroyed()) {
      resultWindow.webContents.debugger.detach();
    }
    if (setupDebuggerAttached && setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.webContents.debugger.detach();
    }
    if (captureDebuggerAttached && captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.webContents.debugger.detach();
    }
    if (resultWindow && !resultWindow.isDestroyed()) resultWindow.destroy();
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.destroy();
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
  }
}

if (process.versions.electron && process.argv.includes(harnessFlag)) {
  runElectronHarness();
} else {
  runNodeHarness().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
