const { contextBridge, ipcRenderer } = require('electron');

const FIXTURE_CLIPBOARD_WRITE_CHANNEL = 'clipboard:write';
const CLIPBOARD_TRANSACTION_RUN = 'clipboard-app-transaction-native';
const CLIPBOARD_TRANSACTION_PROOF_DATASET = 'uiFixtureClipboardTransactionProof';
const FIXTURE_RENDERER_RECOVERY_STATUS_CHANNEL = 'slipstream-ui-fixture:renderer-recovery-status-get';
const FIXTURE_CLIPBOARD_RESIDUE_ACK_CHANNEL = 'slipstream-ui-fixture:clipboard-residue-risk-ack';
const FIXTURE_TRUSTED_INPUT_CHANNEL = 'slipstream-ui-fixture:trusted-input';
const COMPLETED_RESULT_TRUSTED_INPUT_RUN = 'completed-result-text-scale-native';
const GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN = 'guided-reply-text-scale-native';
const SETTINGS_STYLESHEET_COLLISION_TRUSTED_INPUT_RUN = 'settings-stylesheet-collision-native';
const COMMAND_Q_SAFE_EXIT_TRUSTED_INPUT_RUN = 'command-q-safe-exit-native';
const COMMAND_COMMA_SAFE_SETTINGS_RUN = 'command-comma-safe-settings-native';
const APP_SESSION_RISK_UPDATE_CHANNEL = 'app:session-risk-update';
const APP_QUIT_REQUESTED_CHANNEL = 'app:quit-requested';
const APP_QUIT_LISTENER_READY_CHANNEL = 'app:quit-listener-ready';
const APP_QUIT_DECISION_CHANNEL = 'app:quit-decision';
const APP_SETTINGS_REQUESTED_CHANNEL = 'app:settings-requested';
const APP_SETTINGS_LISTENER_READY_CHANNEL = 'app:settings-listener-ready';
const APP_SETTINGS_REQUEST_HANDLED_CHANNEL = 'app:settings-request-handled';
let fixtureClipboardSequence = 0;
let fixtureClipboardConsequenceId = null;
const FIXTURE_SETTINGS_READY_ACCEPT_AFTER_MS = 225;
let fixtureSettingsHandledFailuresRemaining = 1;
let fixtureSettingsReadyFirstAttemptAt = null;
let fixtureSettingsReadyAttempts = 0;
let fixtureSettingsReadyFailuresInjected = 0;
let fixtureSettingsReadyAcceptedCount = 0;
let fixtureSettingsReadyAcceptedDelayMs = null;
let fixtureSettingsHandledFailuresInjected = 0;
let fixtureSettingsHandledResponsesDropped = 0;
let fixtureSettingsHandledInvalidResponsesDelivered = 0;
let fixtureSettingsHandledRequests = 0;
let fixtureSettingsFirstConsumedStatus = null;

function writeFixtureClipboard() {
  fixtureClipboardSequence += 1;
  const replacedPrevious = fixtureClipboardConsequenceId !== null;
  const consequenceId = `fixture-consequence-${Date.now().toString(36)}-${fixtureClipboardSequence}`;
  fixtureClipboardConsequenceId = consequenceId;
  return {
    success: true,
    consequenceId,
    replacedPrevious,
    fixture: true,
  };
}

function isTrustedInputFixtureForRun(expectedRun) {
  try {
    const fixtureUrl = new URL(globalThis.location.href);
    const trapPort = fixtureUrl.searchParams.get('trapPort');
    const expectedSearch = `?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${expectedRun}`;
    return fixtureUrl.protocol === 'http:'
      && fixtureUrl.hostname === '127.0.0.1'
      && fixtureUrl.username === ''
      && fixtureUrl.password === ''
      && /^\d{4,5}$/u.test(fixtureUrl.port)
      && Number(fixtureUrl.port) > 1023
      && Number(fixtureUrl.port) <= 65535
      && fixtureUrl.pathname === '/'
      && fixtureUrl.hash === ''
      && /^\d{4,5}$/u.test(trapPort || '')
      && Number(trapPort) > 1023
      && Number(trapPort) <= 65535
      && trapPort !== fixtureUrl.port
      && fixtureUrl.search === expectedSearch;
  } catch {
    return false;
  }
}

function isCompletedResultTrustedInputFixture() {
  return isTrustedInputFixtureForRun(COMPLETED_RESULT_TRUSTED_INPUT_RUN);
}

function isGuidedReplyTextScaleTrustedInputFixture() {
  return isTrustedInputFixtureForRun(GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN);
}

function isSettingsStylesheetCollisionTrustedInputFixture() {
  try {
    const fixtureUrl = new URL(globalThis.location.href);
    const trapPort = fixtureUrl.searchParams.get('trapPort');
    const expectedSearch = '?demo=result&terms=sample&activeCapture=fixture-screenshot'
      + `&quit=fixture&fixture=check&trapPort=${trapPort}`
      + `&run=${SETTINGS_STYLESHEET_COLLISION_TRUSTED_INPUT_RUN}`;
    return fixtureUrl.protocol === 'http:'
      && fixtureUrl.hostname === '127.0.0.1'
      && fixtureUrl.username === ''
      && fixtureUrl.password === ''
      && /^\d{4,5}$/u.test(fixtureUrl.port)
      && Number(fixtureUrl.port) > 1023
      && Number(fixtureUrl.port) <= 65535
      && fixtureUrl.pathname === '/'
      && fixtureUrl.hash === ''
      && /^\d{4,5}$/u.test(trapPort || '')
      && Number(trapPort) > 1023
      && Number(trapPort) <= 65535
      && trapPort !== fixtureUrl.port
      && fixtureUrl.search === expectedSearch;
  } catch {
    return false;
  }
}

function isCommandQSafeExitFixture() {
  try {
    const fixtureUrl = new URL(globalThis.location.href);
    const trapPort = fixtureUrl.searchParams.get('trapPort');
    const expectedCheckSearch = '?demo=result&terms=sample&quit=ipc&fixture=check'
      + `&trapPort=${trapPort}&run=${COMMAND_Q_SAFE_EXIT_TRUSTED_INPUT_RUN}`;
    const expectedPreviewSearch = '?demo=result&terms=sample&quit=ipc'
      + `&run=${COMMAND_Q_SAFE_EXIT_TRUSTED_INPUT_RUN}`;
    return fixtureUrl.protocol === 'http:'
      && fixtureUrl.hostname === '127.0.0.1'
      && fixtureUrl.username === ''
      && fixtureUrl.password === ''
      && /^\d{4,5}$/u.test(fixtureUrl.port)
      && Number(fixtureUrl.port) > 1023
      && Number(fixtureUrl.port) <= 65535
      && fixtureUrl.pathname === '/'
      && fixtureUrl.hash === ''
      && (
        (/^\d{4,5}$/u.test(trapPort || '')
          && Number(trapPort) > 1023
          && Number(trapPort) <= 65535
          && trapPort !== fixtureUrl.port
          && fixtureUrl.search === expectedCheckSearch)
        || (trapPort === null && fixtureUrl.search === expectedPreviewSearch)
      );
  } catch {
    return false;
  }
}

function isCommandQSafeExitCheckFixture() {
  return isCommandQSafeExitFixture()
    && new URL(globalThis.location.href).searchParams.get('fixture') === 'check';
}

function isCommandCommaSafeSettingsFixture() {
  try {
    const fixtureUrl = new URL(globalThis.location.href);
    const trapPort = fixtureUrl.searchParams.get('trapPort');
    const expectedCheckSearch = '?demo=capture&backend=deepseek&process=slow&fixture=check'
      + `&trapPort=${trapPort}&run=${COMMAND_COMMA_SAFE_SETTINGS_RUN}`;
    const expectedPreviewSearch = '?demo=capture&backend=deepseek&process=slow'
      + `&run=${COMMAND_COMMA_SAFE_SETTINGS_RUN}`;
    return fixtureUrl.protocol === 'http:'
      && fixtureUrl.hostname === '127.0.0.1'
      && fixtureUrl.username === ''
      && fixtureUrl.password === ''
      && /^\d{4,5}$/u.test(fixtureUrl.port)
      && Number(fixtureUrl.port) > 1023
      && Number(fixtureUrl.port) <= 65535
      && fixtureUrl.pathname === '/'
      && fixtureUrl.hash === ''
      && (
        (/^\d{4,5}$/u.test(trapPort || '')
          && Number(trapPort) > 1023
          && Number(trapPort) <= 65535
          && trapPort !== fixtureUrl.port
          && fixtureUrl.search === expectedCheckSearch)
        || (trapPort === null && fixtureUrl.search === expectedPreviewSearch)
      );
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld('slipstreamUiFixture', Object.freeze({
  enabled: true,
  isolated: true,
}));

contextBridge.exposeInMainWorld('slipstreamUiFixtureRecovery', Object.freeze({
  getStatus: () => ipcRenderer.invoke(FIXTURE_RENDERER_RECOVERY_STATUS_CHANNEL),
  acknowledge: (payload) => ipcRenderer.invoke(FIXTURE_CLIPBOARD_RESIDUE_ACK_CHANNEL, {
    id: payload && typeof payload === 'object' ? payload.id : null,
  }),
}));

if (isCompletedResultTrustedInputFixture()) {
  contextBridge.exposeInMainWorld('slipstreamUiFixtureInput', Object.freeze({
    mouseClick: (step, x, y) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'mouse',
      step,
      x,
      y,
    }),
    keyPress: (step, key) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'key',
      step,
      key,
    }),
  }));
} else if (isGuidedReplyTextScaleTrustedInputFixture()) {
  contextBridge.exposeInMainWorld('slipstreamUiFixtureInput', Object.freeze({
    mouseClick: (step, x, y) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'mouse',
      step,
      x,
      y,
    }),
    keyPress: (step, key) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'key',
      step,
      key,
    }),
    replacePlaceholder: (step) => ipcRenderer.invoke(
      FIXTURE_TRUSTED_INPUT_CHANNEL,
      { kind: 'fixed-text', step, action: 'replace-placeholder' },
    ),
    editAfterCopy: (step) => ipcRenderer.invoke(
      FIXTURE_TRUSTED_INPUT_CHANNEL,
      { kind: 'fixed-text', step, action: 'edit-after-copy' },
    ),
  }));
} else if (isSettingsStylesheetCollisionTrustedInputFixture()) {
  contextBridge.exposeInMainWorld('slipstreamUiFixtureInput', Object.freeze({
    keyPress: (step, key) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'key',
      step,
      key,
    }),
  }));
} else if (isCommandQSafeExitCheckFixture()) {
  contextBridge.exposeInMainWorld('slipstreamUiFixtureInput', Object.freeze({
    keyPress: (step, key, modifiers = []) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'key',
      step,
      key,
      modifiers,
    }),
    mouseClick: (step, x, y) => ipcRenderer.invoke(FIXTURE_TRUSTED_INPUT_CHANNEL, {
      kind: 'mouse',
      step,
      x,
      y,
    }),
  }));

}

if (isCommandQSafeExitFixture()) {
  // This intentionally exposes only the four IPC capabilities exercised by
  // the native safe-exit path. All general fixture APIs remain inert stubs.
  contextBridge.exposeInMainWorld('slipstreamUiFixtureQuit', Object.freeze({
    listenerReady: () => ipcRenderer.invoke(APP_QUIT_LISTENER_READY_CHANNEL),
    updateRisk: (payload) => ipcRenderer.invoke(APP_SESSION_RISK_UPDATE_CHANNEL, payload),
    decide: (payload) => ipcRenderer.invoke(APP_QUIT_DECISION_CHANNEL, payload),
    onRequested: (callback) => {
      if (typeof callback !== 'function') throw new TypeError('Quit request listener must be a function');
      const listener = (_event, payload) => {
        const requestId = payload?.requestId;
        if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 100) {
          callback(Object.freeze({ requestId }));
        }
      };
      ipcRenderer.on(APP_QUIT_REQUESTED_CHANNEL, listener);
      return () => ipcRenderer.removeListener(APP_QUIT_REQUESTED_CHANNEL, listener);
    },
  }));
}

if (isCommandCommaSafeSettingsFixture()) {
  // Keep this bridge scoped to the exact native Settings scenario. The
  // general fixture API remains unable to invoke application IPC.
  contextBridge.exposeInMainWorld('slipstreamUiFixtureSettingsMenu', Object.freeze({
    listenerReady: () => {
      const attemptAt = Date.now();
      if (fixtureSettingsReadyFirstAttemptAt === null) {
        fixtureSettingsReadyFirstAttemptAt = attemptAt;
      }
      fixtureSettingsReadyAttempts += 1;
      const attemptDelayMs = attemptAt - fixtureSettingsReadyFirstAttemptAt;
      // React StrictMode synchronously mounts this effect twice in development.
      // Reject every early attempt, rather than only the first one, so neither
      // synchronous setup can accidentally satisfy READY. The first production
      // IPC invocation must therefore come from App's 250 ms retry timer.
      if (attemptDelayMs < FIXTURE_SETTINGS_READY_ACCEPT_AFTER_MS) {
        fixtureSettingsReadyFailuresInjected += 1;
        return Promise.reject(new Error('Injected Settings listener-ready failure'));
      }
      return ipcRenderer.invoke(APP_SETTINGS_LISTENER_READY_CHANNEL).then((result) => {
        fixtureSettingsReadyAcceptedCount += 1;
        if (fixtureSettingsReadyAcceptedDelayMs === null) {
          fixtureSettingsReadyAcceptedDelayMs = Date.now() - fixtureSettingsReadyFirstAttemptAt;
        }
        return result;
      });
    },
    handled: (payload) => {
      fixtureSettingsHandledRequests += 1;
      const dropConsumedResponse = fixtureSettingsHandledFailuresRemaining > 0;
      if (dropConsumedResponse) {
        fixtureSettingsHandledFailuresRemaining -= 1;
      }
      return ipcRenderer.invoke(APP_SETTINGS_REQUEST_HANDLED_CHANNEL, {
        requestId: payload && typeof payload === 'object' ? payload.requestId : null,
      }).then((response) => {
        if (dropConsumedResponse) {
          fixtureSettingsHandledFailuresInjected += 1;
          fixtureSettingsHandledResponsesDropped += 1;
          fixtureSettingsFirstConsumedStatus = response?.status ?? null;
          return Promise.reject(new Error('Dropped consumed Settings acknowledgement response'));
        }
        if (response?.status === 'invalid') {
          fixtureSettingsHandledInvalidResponsesDelivered += 1;
        }
        return response;
      });
    },
    faults: () => Object.freeze({
      listenerReadyAttempts: fixtureSettingsReadyAttempts,
      listenerReadyFailuresInjected: fixtureSettingsReadyFailuresInjected,
      listenerReadyAcceptedCount: fixtureSettingsReadyAcceptedCount,
      listenerReadyAcceptedDelayMs: fixtureSettingsReadyAcceptedDelayMs,
      handledFailuresInjected: fixtureSettingsHandledFailuresInjected,
      handledRequests: fixtureSettingsHandledRequests,
      handledResponsesDropped: fixtureSettingsHandledResponsesDropped,
      handledInvalidResponsesDelivered: fixtureSettingsHandledInvalidResponsesDelivered,
      handledFirstConsumedStatus: fixtureSettingsFirstConsumedStatus,
    }),
    onRequested: (callback) => {
      if (typeof callback !== 'function') {
        throw new TypeError('Settings request listener must be a function');
      }
      const listener = (_event, payload) => {
        const requestId = payload?.requestId;
        if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 100) {
          callback(Object.freeze({ requestId }));
        }
      };
      ipcRenderer.on(APP_SETTINGS_REQUESTED_CHANNEL, listener);
      return () => ipcRenderer.removeListener(APP_SETTINGS_REQUESTED_CHANNEL, listener);
    },
  }));
}

contextBridge.exposeInMainWorld('api', Object.freeze({
  invoke: async (channel) => {
    if (channel === FIXTURE_CLIPBOARD_WRITE_CHANNEL) {
      return writeFixtureClipboard();
    }
    throw new Error('Native UI fixtures do not expose application IPC.');
  },
  on: () => () => {},
}));

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitFor(read, label, timeout = 7_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function click(target) {
  ensure(target, 'Missing fixture click target');
  target.click();
}

function buttonWithText(root, text) {
  return [...root.querySelectorAll('button')]
    .find((button) => button.textContent?.trim().includes(text));
}

function readCounter(name) {
  const value = Number(document.documentElement.dataset[name]);
  ensure(Number.isSafeInteger(value) && value >= 0, `Missing fixture counter ${name}`);
  return value;
}

function hasNoAutomaticClipboardAction(notice) {
  if (!notice) return false;
  const actionButtons = [...notice.querySelectorAll('button')];
  return actionButtons.every((button) => {
    const label = button.textContent?.replace(/\s+/gu, ' ').trim() || '';
    const isAllowedAction = button.matches(
      '[data-clipboard-consequence-ack], .clipboard-privacy-notice__dismiss',
    );
    return isAllowedAction
      && !label.includes('自动清除')
      && !label.includes('安全清除')
      && !/清除.*剪贴板/u.test(label);
  });
}

async function verifyBlockedNetworkProbe() {
  const trapPort = new URLSearchParams(location.search).get('trapPort');
  ensure(/^\d{4,5}$/u.test(trapPort || ''), 'Missing canonical fixture network trap port');
  try {
    await fetch(`http://127.0.0.1:${trapPort}/clipboard-transaction-probe`, {
      cache: 'no-store',
      method: 'GET',
    });
    return false;
  } catch {
    return true;
  }
}

async function runClipboardTransactionCheck() {
  const sessionTrapFetchBlocked = await verifyBlockedNetworkProbe();
  ensure(sessionTrapFetchBlocked, 'Fixture cross-origin network probe was not blocked');
  await waitFor(() => document.querySelector('.result-footer'), 'result fixture');

  const officialSources = await waitFor(
    () => buttonWithText(document, '官方来源'),
    'official sources disclosure',
  );
  click(officialSources);
  const approveOfficialSources = await waitFor(
    () => buttonWithText(document, '批准并查找官方来源'),
    'official source approval',
  );
  click(approveOfficialSources);
  await waitFor(
    () => document.querySelector('[data-source-link-copy-action]'),
    'retrieved source copy action',
  );

  const prepareReply = await waitFor(
    () => buttonWithText(document, '准备英文回复'),
    'guided reply action',
  );
  click(prepareReply);
  const replyDrawer = await waitFor(
    () => document.querySelector('.reply-drawer'),
    'guided reply drawer',
  );
  const inProgressStatus = replyDrawer.querySelector('input[name="reply-status"][value="in_progress"]');
  ensure(inProgressStatus, 'Copyable guided reply status is missing');
  click(inProgressStatus);
  const replyTextarea = await waitFor(
    () => {
      const candidate = document.querySelector('textarea[aria-label="英文回复草稿"]');
      return candidate && !candidate.disabled && candidate.value.trim() ? candidate : null;
    },
    'copyable guided reply draft',
  );
  const textareaValueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  ).set;
  textareaValueSetter.call(replyTextarea, replyTextarea.value.replace('[Your name]', 'Fixture User'));
  replyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  const replyCopy = await waitFor(
    () => {
      const candidate = document.querySelector('[data-reply-copy-action]');
      return candidate && !candidate.disabled ? candidate : null;
    },
    'enabled guided reply copy action',
  );
  click(replyCopy);
  const pendingReplyAction = await waitFor(
    () => {
      const candidate = document.querySelector('[data-reply-copy-action]');
      return candidate?.disabled && candidate.getAttribute('aria-busy') === 'true'
        ? candidate
        : null;
    },
    'pending guided reply action',
  );
  const pendingReplyNotice = await waitFor(
    () => document.querySelector('[data-clipboard-kind="reply"][data-clipboard-status="copying"]'),
    'pending guided reply notice',
  );
  const pendingReplyActionDisabled = pendingReplyAction.disabled;
  const pendingReplyActionBusy = pendingReplyAction.getAttribute('aria-busy') === 'true';
  const pendingNoticeVisible = pendingReplyNotice.isConnected;
  ensure(hasNoAutomaticClipboardAction(pendingReplyNotice),
    'Pending clipboard write exposed an automatic clipboard action');
  click(document.querySelector('[aria-label="关闭回复草稿"]'));
  await waitFor(() => !document.querySelector('.reply-drawer'), 'guided reply dismissal');

  const resultCopy = await waitFor(
    () => document.querySelector('[data-result-copy-action]'),
    'result copy action',
  );
  const actionsCopy = await waitFor(
    () => document.querySelector('[data-actions-copy-action]'),
    'actions copy action',
  );
  const sourceCopies = [...document.querySelectorAll('[data-source-link-copy-action]')];
  const taskCopyActions = [resultCopy, actionsCopy, ...sourceCopies];
  ensure(sourceCopies.length >= 1, 'No official source copy action was reachable');
  ensure(taskCopyActions.every((action) => action.disabled),
    'A result, action, or source copy stayed enabled during the reply write');
  const resultCopyDisabled = resultCopy.disabled;
  const actionsCopyDisabled = actionsCopy.disabled;
  const sourceCopiesDisabled = sourceCopies.every((action) => action.disabled);

  const writesBeforeCompetingClicks = readCounter('demoClipboardWriteRequests');
  ensure(writesBeforeCompetingClicks === 1, 'Delayed reply did not own the sole clipboard request');
  taskCopyActions.forEach((action) => action.click());

  const exitTask = await waitFor(
    () => buttonWithText(document, '清空并返回'),
    'task exit action before clipboard settlement',
  );
  click(exitTask);
  const undoTaskExit = await waitFor(
    () => buttonWithText(document, '撤销清空'),
    'task-exit Undo action before clipboard settlement',
  );
  const taskExitPendingNotice = await waitFor(
    () => {
      const candidate = document.querySelector(
        '[data-clipboard-kind="reply"][data-clipboard-status="copying"]',
      );
      return candidate?.textContent?.includes('任务已结束，正在确认') ? candidate : null;
    },
    'task-exit clipboard consequence notice',
  );
  const taskExitedBeforeSettlement = taskExitPendingNotice.isConnected && undoTaskExit.isConnected;

  click(document.querySelector('button[aria-label^="打开术语库"]'));
  const savedTermsDrawer = await waitFor(
    () => {
      const candidate = document.querySelector('#saved-terms-drawer');
      return candidate?.querySelector('[data-saved-term-copy-action]') ? candidate : null;
    },
    'resolved Saved Terms drawer',
  );
  const savedTermCopies = [...savedTermsDrawer.querySelectorAll('[data-saved-term-copy-action]')];
  ensure(savedTermCopies.length >= 3, 'Fixture Saved Terms copy variants were not reachable');
  ensure(savedTermCopies.every((action) => action.disabled),
    'A Saved Terms copy stayed enabled during the reply write');
  const savedTermCopiesDisabled = savedTermCopies.every((action) => action.disabled);
  savedTermCopies.forEach((action) => action.click());
  click(savedTermsDrawer.querySelector('button[aria-label="关闭术语库"]'));
  await waitFor(() => !document.querySelector('#saved-terms-drawer'), 'Saved Terms dismissal');

  click(document.querySelector('button[aria-label="打开设置"]'));
  const settingsPanel = await waitFor(
    () => document.querySelector('.settings-panel'),
    'Settings panel',
  );
  const diagnosticsCopy = await waitFor(
    () => settingsPanel.querySelector('[data-support-diagnostics-copy-action]'),
    'Settings diagnostics copy',
  );
  ensure(diagnosticsCopy.disabled && diagnosticsCopy.getAttribute('aria-busy') === 'true',
    'Settings diagnostics copy was not locked by the reply write');
  const diagnosticsCopyDisabled = diagnosticsCopy.disabled;

  const connectionTest = await waitFor(
    () => {
      const candidate = settingsPanel.querySelector('.provider-connection-test-button');
      return candidate && !candidate.disabled ? candidate : null;
    },
    'enabled fixture connection test',
  );
  click(connectionTest);
  const recoveryCopies = await waitFor(
    () => {
      const candidates = [...settingsPanel.querySelectorAll(
        '[data-connection-recovery-copy-action="true"]',
      )];
      return candidates.length >= 1 ? candidates : null;
    },
    'Settings recovery command copies',
  );
  ensure(recoveryCopies.every((action) => (
    action.disabled && action.getAttribute('aria-busy') === 'true'
  )), 'A Settings recovery copy was not locked by the reply write');
  const recoveryCopiesDisabled = recoveryCopies.every((action) => action.disabled);
  const settingsCopyActions = [diagnosticsCopy, ...recoveryCopies];
  settingsCopyActions.forEach((action) => action.click());
  await delay(75);

  ensure(document.querySelector('[data-clipboard-kind="reply"][data-clipboard-status="copying"]'),
    'Delayed reply settled before all cross-view exclusions were checked');
  const writesAfterCompetingClicks = readCounter('demoClipboardWriteRequests');
  ensure(writesAfterCompetingClicks === writesBeforeCompetingClicks,
    'A competing App clipboard entry started a second write');
  const nativeWriteStubsWhilePending = readCounter('demoNativeClipboardWriteStubs');
  ensure(nativeWriteStubsWhilePending === 0,
    'Delayed native clipboard stub settled before the pending exclusion proof completed');

  const retainedSettingsNotice = await waitFor(
    () => settingsPanel.querySelector(
      '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
    ),
    'retained reply consequence in Settings',
    7_000,
  );
  const settingsNoAutomaticClipboardAction = hasNoAutomaticClipboardAction(
    retainedSettingsNotice,
  );
  const retainedConsequenceVisibleInSettings = retainedSettingsNotice.isConnected;
  ensure(
    settingsNoAutomaticClipboardAction
      && retainedSettingsNotice.textContent?.includes('手动覆盖'),
    'Settings did not preserve the reply consequence as manual-overwrite only',
  );
  ensure(readCounter('demoClipboardWriteRequests') === 1,
    'Reply settlement changed the logical clipboard request count');
  ensure(readCounter('demoNativeClipboardWriteStubs') === 1,
    'Reply settlement did not use exactly one in-memory native write stub');

  click(settingsPanel.querySelector('[data-quit-return-focus]'));
  await waitFor(() => !document.querySelector('.settings-panel'), 'Settings dismissal');
  click(document.querySelector('button[aria-label^="打开术语库"]'));
  const retainedTermsDrawer = await waitFor(
    () => {
      const candidate = document.querySelector('#saved-terms-drawer');
      return candidate?.querySelector(
        '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
      ) ? candidate : null;
    },
    'resolved Saved Terms drawer with retained reply consequence',
  );
  const retainedTermsNotice = await waitFor(
    () => retainedTermsDrawer.querySelector(
      '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
    ),
    'retained reply consequence in Saved Terms',
  );
  const savedTermsNoAutomaticClipboardAction = hasNoAutomaticClipboardAction(
    retainedTermsNotice,
  );
  const retainedConsequenceVisibleInSavedTerms = retainedTermsNotice.isConnected;
  ensure(
    savedTermsNoAutomaticClipboardAction
      && retainedTermsNotice.textContent?.includes('手动覆盖'),
    'Saved Terms exposed more than manual-overwrite handling for the reply consequence',
  );
  click(retainedTermsDrawer.querySelector('button[aria-label="关闭术语库"]'));
  await waitFor(
    () => !document.querySelector('#saved-terms-drawer'),
    'Saved Terms dismissal with retained reply consequence',
  );

  const restoredUndoTaskExit = await waitFor(
    () => buttonWithText(document, '撤销清空'),
    'restored task-exit Undo action',
  );
  click(restoredUndoTaskExit);
  await waitFor(() => document.querySelector('.result-footer'), 'restored result after Undo');
  const replyConsequenceAfterUndo = await waitFor(
    () => document.querySelector(
      '[data-clipboard-kind="reply"][data-clipboard-status="retained"], '
        + '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
    ),
    'reply consequence after Undo',
  );
  ensure(
    hasNoAutomaticClipboardAction(replyConsequenceAfterUndo),
    'Undo restored an automatic clipboard action',
  );

  const followupResultCopy = await waitFor(
    () => {
      const candidate = document.querySelector('[data-result-copy-action]');
      return candidate && !candidate.disabled ? candidate : null;
    },
    'enabled result copy replacing the reply consequence',
  );
  click(followupResultCopy);
  const copiedResultNotice = await waitFor(
    () => document.querySelector(
      '[data-clipboard-kind="result"][data-clipboard-status="copied"]',
    ),
    'replacement result clipboard consequence',
    7_000,
  );
  const followupCopyReplacedPriorConsequence = !document.querySelector(
    '[data-clipboard-kind="reply"]',
  ) && hasNoAutomaticClipboardAction(copiedResultNotice);
  ensure(
    followupCopyReplacedPriorConsequence,
    'A later result copy did not replace the earlier reply consequence',
  );

  const manualOverwriteAcknowledgement = await waitFor(
    () => {
      const candidate = copiedResultNotice.querySelector('[data-clipboard-consequence-ack]');
      return candidate && !candidate.disabled ? candidate : null;
    },
    'manual-overwrite acknowledgement for the replacement consequence',
  );
  ensure(
    manualOverwriteAcknowledgement.textContent?.includes('我已手动覆盖')
      && copiedResultNotice.textContent?.includes('不会读取或更改剪贴板'),
    'Replacement consequence did not require an explicit manual-overwrite acknowledgement',
  );
  const writesBeforeAcknowledgement = readCounter('demoClipboardWriteRequests');
  click(manualOverwriteAcknowledgement);
  const acknowledgedNotice = await waitFor(
    () => document.querySelector(
      '[data-clipboard-kind="result"][data-clipboard-status="acknowledged"]',
    ),
    'exact replacement consequence acknowledgement',
  );
  const writesAfterAcknowledgement = readCounter('demoClipboardWriteRequests');
  const exactConsequenceAcknowledged = acknowledgedNotice.textContent
    ?.includes('已确认你在其他位置复制了新内容');
  ensure(
    exactConsequenceAcknowledged
      && writesAfterAcknowledgement === writesBeforeAcknowledgement,
    'Manual-overwrite acknowledgement did not settle the exact current consequence',
  );

  return {
    success: true,
    sessionTrapFetchBlocked,
    secretTextAbsent: !document.body.textContent?.includes('fixture-secret-must-not-cross'),
    pendingReplyActionDisabled,
    pendingReplyActionBusy,
    pendingNoticeVisible,
    resultCopyDisabled,
    actionsCopyDisabled,
    sourceCopyCount: sourceCopies.length,
    sourceCopiesDisabled,
    savedTermCopyCount: savedTermCopies.length,
    savedTermCopiesDisabled,
    diagnosticsCopyCount: 1,
    diagnosticsCopyDisabled,
    recoveryCopyCount: recoveryCopies.length,
    recoveryCopiesDisabled,
    competingClicksRejected: writesAfterCompetingClicks === writesBeforeCompetingClicks,
    writesBeforeCompetingClicks,
    writesAfterCompetingClicks,
    nativeWriteStubsWhilePending,
    taskExitedBeforeSettlement,
    replyConsequenceRetainedAcrossViews: retainedConsequenceVisibleInSettings
      && retainedConsequenceVisibleInSavedTerms,
    settingsNoAutomaticClipboardAction,
    savedTermsNoAutomaticClipboardAction,
    undoPreservedReplyConsequence: Boolean(replyConsequenceAfterUndo),
    followupCopyReplacedPriorConsequence,
    manualOverwriteAcknowledgementVisible: Boolean(manualOverwriteAcknowledgement),
    exactConsequenceAcknowledged: Boolean(exactConsequenceAcknowledged),
    acknowledgementDidNotWrite: writesAfterAcknowledgement === writesBeforeAcknowledgement,
    clipboardWriteRequests: readCounter('demoClipboardWriteRequests'),
    nativeClipboardWriteStubs: readCounter('demoNativeClipboardWriteStubs'),
  };
}

function publishClipboardTransactionProof(proof) {
  document.documentElement.dataset[CLIPBOARD_TRANSACTION_PROOF_DATASET] = JSON.stringify(proof);
}

function maybeRunClipboardTransactionCheck() {
  if (new URLSearchParams(location.search).get('run') !== CLIPBOARD_TRANSACTION_RUN) return;
  runClipboardTransactionCheck()
    .then((proof) => publishClipboardTransactionProof(proof))
    .catch((error) => publishClipboardTransactionProof({
      success: false,
      error: String(error?.message || error),
    }));
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', maybeRunClipboardTransactionCheck, { once: true });
} else {
  maybeRunClipboardTransactionCheck();
}
