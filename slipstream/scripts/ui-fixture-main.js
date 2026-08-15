const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveUiFixtureMode,
  sanitizeFixtureEnvironment,
} = require('../src/main/ui-fixture-mode');

const UNSUPPORTED_UI_FIXTURE_ENV_KEYS = Object.freeze([
  'SLIPSTREAM_UI_FIXTURE_REQUEST',
  'SLIPSTREAM_UI_FIXTURE_MODE',
]);

function initializeUiFixture({ app, argv, env }) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(env, key);
  const unsupportedKey = UNSUPPORTED_UI_FIXTURE_ENV_KEYS.find(hasOwn);
  if (unsupportedKey) {
    throw new Error(`${unsupportedKey} is unsafe; use npm run dev:ui-fixture instead`);
  }

  const uiFixtureMode = resolveUiFixtureMode({
    argv,
    env,
    isPackaged: app.isPackaged,
  });
  const uiFixtureCheckMode = uiFixtureMode.enabled
    && new URL(uiFixtureMode.rendererUrl).searchParams.get('fixture') === 'check';

  if (uiFixtureMode.enabled) {
    const sanitizedEnvironment = sanitizeFixtureEnvironment(env);
    for (const key of Object.keys(env)) {
      if (!(key in sanitizedEnvironment)) delete env[key];
    }
    fs.mkdirSync(uiFixtureMode.userDataPath, { recursive: true });
    const sessionDataPath = path.join(uiFixtureMode.userDataPath, 'session-data');
    fs.mkdirSync(sessionDataPath, { recursive: true });
    app.setPath('userData', uiFixtureMode.userDataPath);
    app.setPath('sessionData', sessionDataPath);
  }

  return Object.freeze({ uiFixtureMode, uiFixtureCheckMode });
}

function createUiFixtureStore({ createBlockedStartupSettings }) {
  let settings = null;

  const requireReadySettings = () => {
    if (!settings) throw new Error('UI fixture settings were read before initialization');
    return settings;
  };

  return Object.freeze({
    initializeStore() {
      if (!settings) settings = createBlockedStartupSettings();
      return Object.freeze({ state: 'ready', reason: null });
    },
    isStoreReady() {
      return settings !== null;
    },
    getAllSettings() {
      return { ...requireReadySettings() };
    },
    getSettings(key) {
      return requireReadySettings()[key];
    },
    setSetting(key, value) {
      const currentSettings = requireReadySettings();
      if (!Object.prototype.hasOwnProperty.call(currentSettings, key)) {
        throw new TypeError('UI fixture setting is not supported');
      }
      currentSettings[key] = value;
    },
  });
}

function createUiFixtureRuntime({
  DEFAULTS,
  app,
  applicationMenuHasUnsafeDeveloperActions,
  getApplicationQuitMenuState = () => null,
  getApplicationSettingsMenuState = () => null,
  hasPendingApplicationSettingsRequest = () => false,
  triggerApplicationSettingsMenu = () => false,
  globalShortcut,
  ipcMain,
  uiFixtureMode,
  uiFixtureCheckMode,
  getMainWindow,
  getTray,
}) {
  if (!uiFixtureMode?.enabled) throw new TypeError('UI fixture runtime requires enabled fixture mode');
  if (typeof getMainWindow !== 'function' || typeof getTray !== 'function') {
    throw new TypeError('UI fixture runtime requires live mainWindow and tray getters');
  }

function registerCommandQSafeExitTrustedInputHandler(fixtureWindow) {
  const fixtureUrl = new URL(uiFixtureMode.rendererUrl);
  if (
    !uiFixtureMode.enabled
    || !uiFixtureCheckMode
    || !fixtureWindow
    || fixtureWindow.isDestroyed()
    || !isCommandQSafeExitCheckFixtureUrl(fixtureUrl)
  ) return;

  const fixtureWebContents = fixtureWindow.webContents;
  if (fixtureWebContents.isDestroyed()) return;
  const expectedSteps = Object.freeze([
    Object.freeze({ step: 1, kind: 'key', key: 'q', modifiers: Object.freeze(['meta']) }),
    Object.freeze({ step: 2, kind: 'key', key: 'Escape', modifiers: Object.freeze([]) }),
    Object.freeze({ step: 3, kind: 'key', key: 'q', modifiers: Object.freeze(['meta']) }),
    Object.freeze({ step: 4, kind: 'mouse' }),
    Object.freeze({ step: 5, kind: 'mouse' }),
  ]);
  uiFixtureCommandQSafeExitProbe = {
    expectedSteps: expectedSteps.length,
    acceptedSteps: 0,
    rejectedSteps: 0,
    nextStep: 1,
    complete: false,
    commandQInputs: 0,
    escapeInputs: 0,
    mouseInputs: 0,
    requestCount: 0,
    requestSentCount: 0,
    listenerReadyCount: 0,
    pendingReplayCount: 0,
    riskUpdateCount: 0,
    menuInvocationCount: 0,
    acceleratorActivationCount: 0,
    cancelDecisionCount: 0,
    mismatchDecisionCount: 0,
    confirmedDecisionCount: 0,
    confirmedQuitCount: 0,
    beforeQuitCount: 0,
    nativeTerminateActionCount: 0,
    cleanupStarted: false,
    cleanupComplete: false,
    isolation: null,
    rendererProof: Object.freeze({}),
  };

  ipcMain.handle(UI_FIXTURE_TRUSTED_INPUT_CHANNEL, async (event, payload) => {
    const reject = (message) => {
      uiFixtureCommandQSafeExitProbe.rejectedSteps += 1;
      throw new TypeError(message);
    };
    if (
      !uiFixtureMode.enabled
      || !uiFixtureCheckMode
      || fixtureWindow.isDestroyed()
      || fixtureWebContents.isDestroyed()
      || event.sender !== fixtureWebContents
      || event.senderFrame !== fixtureWebContents.mainFrame
      || event.sender.getURL() !== uiFixtureMode.rendererUrl
      || event.senderFrame.url !== uiFixtureMode.rendererUrl
      || !isCommandQSafeExitCheckFixtureUrl(new URL(event.senderFrame.url))
      || !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
    ) return reject('Untrusted Command+Q fixture input sender');

    const expected = expectedSteps[uiFixtureCommandQSafeExitProbe.acceptedSteps];
    const payloadKeys = Object.keys(payload).sort();
    if (
      uiFixtureCommandQSafeExitProbe.complete
      || !expected
      || !Number.isSafeInteger(payload.step)
      || payload.step !== expected.step
      || payload.kind !== expected.kind
    ) return reject('Out-of-sequence Command+Q fixture input');

    fixtureWebContents.focus();
    if (expected.kind === 'key') {
      const modifiers = Array.isArray(payload.modifiers) ? payload.modifiers : null;
      if (
        payloadKeys.join(',') !== 'key,kind,modifiers,step'
        || payload.key !== expected.key
        || !modifiers
        || modifiers.length !== expected.modifiers.length
        || modifiers.some((modifier, index) => modifier !== expected.modifiers[index])
      ) return reject('Invalid Command+Q fixture key payload');
      const input = {
        type: expected.key === 'q' ? 'rawKeyDown' : 'keyDown',
        keyCode: expected.key === 'q' ? 'Q' : expected.key,
      };
      if (expected.modifiers.length > 0) input.modifiers = [...expected.modifiers];
      fixtureWebContents.sendInputEvent(input);
      fixtureWebContents.sendInputEvent({
        type: 'keyUp',
        keyCode: expected.key === 'q' ? 'Q' : expected.key,
        ...(expected.modifiers.length > 0 ? { modifiers: [...expected.modifiers] } : {}),
      });
      if (expected.key === 'q') uiFixtureCommandQSafeExitProbe.commandQInputs += 1;
      else uiFixtureCommandQSafeExitProbe.escapeInputs += 1;
      if (expected.key === 'q') {
        // WebContents input does not traverse macOS menu accelerators. Send
        // the native terminate responder action instead of forging a menu
        // click or calling the quit-request function directly.
        require('electron').Menu.sendActionToFirstResponder('terminate:');
        uiFixtureCommandQSafeExitProbe.nativeTerminateActionCount += 1;
      }
    } else {
      const [contentWidth, contentHeight] = fixtureWindow.getContentSize();
      const zoomFactor = fixtureWebContents.getZoomFactor();
      const viewportWidth = Math.floor(contentWidth / zoomFactor);
      const viewportHeight = Math.floor(contentHeight / zoomFactor);
      if (
        payloadKeys.join(',') !== 'kind,step,x,y'
        || !Number.isSafeInteger(payload.x)
        || !Number.isSafeInteger(payload.y)
        || payload.x < 0
        || payload.y < 0
        || payload.x >= viewportWidth
        || payload.y >= viewportHeight
      ) return reject('Invalid Command+Q fixture mouse payload');
      const x = Math.round(payload.x * zoomFactor);
      const y = Math.round(payload.y * zoomFactor);
      for (const input of [
        { type: 'mouseMove', x, y },
        { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
        { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
      ]) fixtureWebContents.sendInputEvent(input);
      uiFixtureCommandQSafeExitProbe.mouseInputs += 1;
    }
    uiFixtureCommandQSafeExitProbe.acceptedSteps += 1;
    uiFixtureCommandQSafeExitProbe.nextStep = uiFixtureCommandQSafeExitProbe.acceptedSteps + 1;
    uiFixtureCommandQSafeExitProbe.complete = uiFixtureCommandQSafeExitProbe.acceptedSteps
      === expectedSteps.length;
    return Object.freeze({
      accepted: true,
      step: expected.step,
      complete: uiFixtureCommandQSafeExitProbe.complete,
    });
  });
}

function commandQSafeExitFailure(message) {
  if (uiFixtureCommandQSafeExitOutputWritten) return;
  uiFixtureCommandQSafeExitOutputWritten = true;
  if (uiFixtureCommandQSafeExitWatchdog !== null) clearTimeout(uiFixtureCommandQSafeExitWatchdog);
  fs.writeSync(process.stdout.fd, `${COMMAND_Q_SAFE_EXIT_OUTPUT_PREFIX}${JSON.stringify({
    success: false,
    error: message,
  })}\n`);
  app.exit(1);
}

function startCommandQSafeExitWatchdog() {
  if (!uiFixtureCommandQSafeExitProbe || uiFixtureCommandQSafeExitWatchdog !== null) return;
  uiFixtureCommandQSafeExitWatchdog = setTimeout(() => {
    commandQSafeExitFailure('Command+Q safe-exit fixture watchdog expired before actual will-quit');
  }, 20_000);
}

function snapshotCommandQSafeExitIsolation() {
  const fixtureWindow = getMainWindow();
  const preferences = fixtureWindow && !fixtureWindow.isDestroyed()
    ? fixtureWindow.webContents.getLastWebPreferences()
    : null;
  const menuState = getApplicationQuitMenuState();
  return Object.freeze({
    rendererUrlExact: Boolean(fixtureWindow && !fixtureWindow.isDestroyed()
      && fixtureWindow.webContents.getURL() === uiFixtureMode.rendererUrl),
    contextIsolation: preferences?.contextIsolation === true,
    nodeIntegrationDisabled: preferences?.nodeIntegration === false,
    sandboxEnabled: preferences?.sandbox === true,
    inheritedSecretsPresent: Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY || process.env.SSH_AUTH_SOCK || process.env.NODE_OPTIONS),
    blockedRendererExternalRequests: uiFixtureBlockedRendererExternalRequests,
    applicationQuitMenu: Object.freeze({
      exists: menuState?.exists === true,
      acceleratorIsCommandQ: menuState?.accelerator === 'Command+Q',
      handlerAttached: menuState?.handlerAttached === true,
    }),
  });
}

function recordCommandQSafeExitLifecycle(partial) {
  if (!uiFixtureCommandQSafeExitProbe) {
    // Exact manual previews exercise the production path too, but intentionally
    // have no automated proof sink or watchdog.
    return false;
  }
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('Command+Q safe-exit lifecycle must be an object');
  }
  const counterKeys = [
    'requestCount', 'requestSentCount', 'listenerReadyCount', 'pendingReplayCount',
    'riskUpdateCount', 'menuInvocationCount', 'acceleratorActivationCount', 'cancelDecisionCount',
    'mismatchDecisionCount', 'confirmedDecisionCount', 'confirmedQuitCount',
    'beforeQuitCount', 'nativeTerminateActionCount',
  ];
  for (const key of counterKeys) {
    if (partial[key] === undefined) continue;
    if (!Number.isSafeInteger(partial[key]) || partial[key] < 0) {
      throw new TypeError(`Invalid Command+Q safe-exit counter: ${key}`);
    }
    uiFixtureCommandQSafeExitProbe[key] += partial[key];
  }
  for (const key of ['cleanupStarted', 'cleanupComplete']) {
    if (partial[key] === undefined) continue;
    if (typeof partial[key] !== 'boolean') {
      throw new TypeError(`Invalid Command+Q safe-exit boolean: ${key}`);
    }
    uiFixtureCommandQSafeExitProbe[key] = partial[key];
  }
  if (partial.cleanupComplete === true) {
    uiFixtureCommandQSafeExitProbe.isolation = snapshotCommandQSafeExitIsolation();
  }
  if (partial.rendererProof !== undefined) {
    if (!partial.rendererProof || typeof partial.rendererProof !== 'object'
      || Array.isArray(partial.rendererProof)) {
      throw new TypeError('Invalid Command+Q safe-exit renderer proof');
    }
    const allowedRendererProofKeys = new Set([
      'bridgeAvailable', 'bridgeFrozen', 'otherFixtureApisIsolated',
      'dialogOpenedAfterFirstCommand', 'escapeClosedDialog', 'processSurvivedCancel',
      'activeReadyReplayed', 'replayKeptSingleDialog', 'settledReadyDidNotReplay',
      'dialogOpenedAfterSecondCommand', 'firstConfirmAttempted', 'mismatchStayedOpen',
      'secondConfirmAttempted',
    ]);
    const sanitized = {};
    for (const [key, value] of Object.entries(partial.rendererProof)) {
      if (!allowedRendererProofKeys.has(key) || typeof value !== 'boolean') {
        throw new TypeError('Command+Q safe-exit renderer proof must contain approved booleans only');
      }
      sanitized[key] = value;
    }
    uiFixtureCommandQSafeExitProbe.rendererProof = Object.freeze({
      ...uiFixtureCommandQSafeExitProbe.rendererProof,
      ...sanitized,
    });
  }
  return true;
}

function emitCommandQSafeExitProof() {
  if (!uiFixtureCommandQSafeExitProbe) return false;
  if (uiFixtureCommandQSafeExitOutputWritten) return false;
  const probe = uiFixtureCommandQSafeExitProbe;
  const isolation = probe?.isolation || snapshotCommandQSafeExitIsolation();
  const requiredRendererProof = [
    'bridgeAvailable', 'bridgeFrozen', 'otherFixtureApisIsolated',
    'dialogOpenedAfterFirstCommand', 'escapeClosedDialog', 'processSurvivedCancel',
    'activeReadyReplayed', 'replayKeptSingleDialog', 'settledReadyDidNotReplay',
    'dialogOpenedAfterSecondCommand', 'firstConfirmAttempted', 'mismatchStayedOpen',
    'secondConfirmAttempted',
  ];
  const lifecycleReady = Boolean(probe)
    && probe.expectedSteps === 5 && probe.acceptedSteps === 5 && probe.rejectedSteps === 0
    && probe.complete === true && probe.commandQInputs === 2 && probe.escapeInputs === 1
    && probe.mouseInputs === 2 && probe.requestCount >= 2 && probe.requestSentCount >= 2
    && probe.riskUpdateCount >= 1 && probe.cancelDecisionCount === 1
    && probe.mismatchDecisionCount === 1 && probe.confirmedDecisionCount === 1
    && probe.confirmedQuitCount === 1 && probe.beforeQuitCount === 1
    && probe.nativeTerminateActionCount === 2
    && probe.cleanupStarted === true && probe.cleanupComplete === true
    && requiredRendererProof.every((key) => probe.rendererProof[key] === true)
    && isolation.rendererUrlExact && isolation.contextIsolation
    && isolation.nodeIntegrationDisabled && isolation.sandboxEnabled
    && !isolation.inheritedSecretsPresent && isolation.blockedRendererExternalRequests === 0
    && isolation.applicationQuitMenu.exists
    && isolation.applicationQuitMenu.acceleratorIsCommandQ
    && isolation.applicationQuitMenu.handlerAttached;
  uiFixtureCommandQSafeExitOutputWritten = true;
  if (uiFixtureCommandQSafeExitWatchdog !== null) clearTimeout(uiFixtureCommandQSafeExitWatchdog);
  const payload = lifecycleReady
    ? { success: true, isolation, lifecycle: { ...probe, rendererProof: { ...probe.rendererProof } } }
    : { success: false, error: 'Command+Q safe-exit lifecycle was incomplete', isolation,
      lifecycle: probe ? { ...probe, rendererProof: { ...probe.rendererProof } } : null };
  fs.writeSync(process.stdout.fd, `${COMMAND_Q_SAFE_EXIT_OUTPUT_PREFIX}${JSON.stringify(payload)}\n`);
  return lifecycleReady;
}

function recordCommandCommaSafeSettingsLifecycle(partial) {
  if (!uiFixtureCommandCommaSettingsProbe) return false;
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('Command+, Settings lifecycle must be an object');
  }
  const counterKeys = [
    'menuInvocationCount',
    'acceleratorActivationCount',
    'requestCount',
    'requestSentCount',
    'listenerReadyCount',
    'pendingReplayCount',
    'acknowledgedCount',
    'invalidAcknowledgementCount',
  ];
  for (const key of counterKeys) {
    if (partial[key] === undefined) continue;
    if (!Number.isSafeInteger(partial[key]) || partial[key] < 0) {
      throw new TypeError(`Invalid Command+, Settings counter: ${key}`);
    }
    uiFixtureCommandCommaSettingsProbe[key] += partial[key];
  }
  return true;
}

function commandCommaSafeSettingsFailure(message) {
  if (uiFixtureCommandCommaSettingsProbe?.outputWritten) return;
  if (uiFixtureCommandCommaSettingsProbe) {
    uiFixtureCommandCommaSettingsProbe.outputWritten = true;
  }
  fs.writeSync(process.stdout.fd, `${COMMAND_COMMA_SAFE_SETTINGS_OUTPUT_PREFIX}${JSON.stringify({
    success: false,
    error: message,
    lifecycle: uiFixtureCommandCommaSettingsProbe
      ? { ...uiFixtureCommandCommaSettingsProbe, outputWritten: undefined }
      : null,
  })}\n`);
  app.exit(1);
}


const UI_FIXTURE_RENDERER_RECOVERY_STATUS_CHANNEL = 'slipstream-ui-fixture:renderer-recovery-status-get';
const UI_FIXTURE_CLIPBOARD_RESIDUE_ACK_CHANNEL = 'slipstream-ui-fixture:clipboard-residue-risk-ack';
const UI_FIXTURE_TRUSTED_INPUT_CHANNEL = 'slipstream-ui-fixture:trusted-input';
const COMPLETED_RESULT_TRUSTED_INPUT_RUN = 'completed-result-text-scale-native';
const GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN = 'guided-reply-text-scale-native';
const SETTINGS_STYLESHEET_COLLISION_TRUSTED_INPUT_RUN = 'settings-stylesheet-collision-native';
const COMMAND_Q_SAFE_EXIT_TRUSTED_INPUT_RUN = 'command-q-safe-exit-native';
const COMMAND_COMMA_SAFE_SETTINGS_RUN = 'command-comma-safe-settings-native';
const COMMAND_Q_SAFE_EXIT_OUTPUT_PREFIX = '__SLIPSTREAM_UI_FIXTURE_COMMAND_Q_SAFE_EXIT__';
const COMMAND_COMMA_SAFE_SETTINGS_OUTPUT_PREFIX = '__SLIPSTREAM_UI_FIXTURE_COMMAND_COMMA_SETTINGS__';
let uiFixtureClipboardResidueProbe = null;
let uiFixtureTrustedInputProbe = null;
let uiFixtureBlockedRendererExternalRequests = 0;
let uiFixtureCommandQSafeExitProbe = null;
let uiFixtureCommandQSafeExitWatchdog = null;
let uiFixtureCommandQSafeExitOutputWritten = false;
let uiFixtureCommandCommaSettingsProbe = null;

function isCompletedResultTrustedInputFixtureUrl(fixtureUrl) {
  const trapPort = fixtureUrl.searchParams.get('trapPort');
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
    && fixtureUrl.search
      === `?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${COMPLETED_RESULT_TRUSTED_INPUT_RUN}`;
}

function isGuidedReplyTextScaleTrustedInputFixtureUrl(fixtureUrl) {
  const trapPort = fixtureUrl.searchParams.get('trapPort');
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
    && fixtureUrl.search
      === `?demo=result&terms=sample&fixture=check&trapPort=${trapPort}&run=${GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN}`;
}

function isSettingsStylesheetCollisionTrustedInputFixtureUrl(fixtureUrl) {
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
}

function isCommandQSafeExitFixtureUrl(fixtureUrl) {
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
}

function isCommandQSafeExitCheckFixtureUrl(fixtureUrl) {
  return isCommandQSafeExitFixtureUrl(fixtureUrl)
    && fixtureUrl.searchParams.get('fixture') === 'check';
}

function isCommandCommaSafeSettingsFixtureUrl(fixtureUrl) {
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
}

function isCommandCommaSafeSettingsCheckFixtureUrl(fixtureUrl) {
  return isCommandCommaSafeSettingsFixtureUrl(fixtureUrl)
    && fixtureUrl.searchParams.get('fixture') === 'check';
}

function registerUiFixtureTrustedInputHandler(fixtureWindow) {
  const fixtureUrl = new URL(uiFixtureMode.rendererUrl);
  const fixtureRun = fixtureUrl.searchParams.get('run');
  const isCompletedResultRun = isCompletedResultTrustedInputFixtureUrl(fixtureUrl);
  const isGuidedReplyRun = isGuidedReplyTextScaleTrustedInputFixtureUrl(fixtureUrl);
  const isSettingsStylesheetCollisionRun = isSettingsStylesheetCollisionTrustedInputFixtureUrl(
    fixtureUrl,
  );
  if (
    !uiFixtureMode.enabled
    || !uiFixtureCheckMode
    || !fixtureWindow
    || fixtureWindow.isDestroyed()
    || (!isCompletedResultRun && !isGuidedReplyRun && !isSettingsStylesheetCollisionRun)
  ) return;

  const fixtureWebContents = fixtureWindow.webContents;
  if (fixtureWebContents.isDestroyed()) return;

  const completedResultExpectedInputSteps = Object.freeze([
    ...Array.from({ length: 19 }, (_value, index) => Object.freeze({
      step: index + 1,
      kind: 'mouse',
    })),
    Object.freeze({ step: 20, kind: 'key', key: 'Tab' }),
    Object.freeze({ step: 21, kind: 'key', key: 'Tab' }),
    Object.freeze({ step: 22, kind: 'key', key: 'Escape' }),
    Object.freeze({ step: 23, kind: 'mouse' }),
    Object.freeze({ step: 24, kind: 'mouse' }),
  ]);
  const guidedReplyExpectedInputSteps = Object.freeze([
    Object.freeze({ step: 1, kind: 'mouse' }),
    Object.freeze({ step: 2, kind: 'mouse' }),
    Object.freeze({ step: 3, kind: 'mouse' }),
    Object.freeze({ step: 4, kind: 'fixed-text', action: 'replace-placeholder' }),
    Object.freeze({ step: 5, kind: 'mouse' }),
    Object.freeze({ step: 6, kind: 'fixed-text', action: 'edit-after-copy' }),
    Object.freeze({ step: 7, kind: 'mouse' }),
    Object.freeze({ step: 8, kind: 'mouse' }),
    ...Array.from({ length: 9 }, (_value, index) => Object.freeze({
      step: index + 9,
      kind: 'key',
      key: 'Tab',
    })),
    Object.freeze({ step: 18, kind: 'key', key: 'Escape' }),
  ]);
  const settingsStylesheetCollisionExpectedInputSteps = Object.freeze([
    Object.freeze({ step: 1, kind: 'key', key: 'Escape' }),
  ]);
  const expectedInputSteps = isCompletedResultRun
    ? completedResultExpectedInputSteps
    : isGuidedReplyRun
      ? guidedReplyExpectedInputSteps
      : settingsStylesheetCollisionExpectedInputSteps;
  uiFixtureTrustedInputProbe = {
    expectedSteps: expectedInputSteps.length,
    acceptedSteps: 0,
    rejectedSteps: 0,
    nextStep: 1,
    complete: false,
    mouseActions: 0,
    mouseInputEvents: 0,
    keyActions: 0,
    keyInputEvents: 0,
  };
  if (isGuidedReplyRun) {
    uiFixtureTrustedInputProbe.fixedTextActions = 0;
    uiFixtureTrustedInputProbe.fixedTextCharacters = 0;
  }

  ipcMain.handle(UI_FIXTURE_TRUSTED_INPUT_CHANNEL, async (event, payload) => {
    if (
      !uiFixtureMode.enabled
      || !uiFixtureCheckMode
      || fixtureWindow.isDestroyed()
      || fixtureWebContents.isDestroyed()
      || event.sender !== fixtureWebContents
      || event.senderFrame !== fixtureWebContents.mainFrame
      || event.sender.getURL() !== uiFixtureMode.rendererUrl
      || event.senderFrame.url !== uiFixtureMode.rendererUrl
      || (fixtureRun === COMPLETED_RESULT_TRUSTED_INPUT_RUN
        ? !isCompletedResultTrustedInputFixtureUrl(new URL(event.senderFrame.url))
        : fixtureRun === GUIDED_REPLY_TEXT_SCALE_TRUSTED_INPUT_RUN
          ? !isGuidedReplyTextScaleTrustedInputFixtureUrl(new URL(event.senderFrame.url))
          : !isSettingsStylesheetCollisionTrustedInputFixtureUrl(
            new URL(event.senderFrame.url),
          ))
    ) {
      throw new Error('Untrusted completed-result fixture input sender');
    }
    const rejectInput = (message) => {
      uiFixtureTrustedInputProbe.rejectedSteps += 1;
      throw new TypeError(message);
    };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rejectInput('Invalid completed-result fixture input payload');
    }

    const payloadKeys = Object.keys(payload).sort();
    const expectedStep = expectedInputSteps[uiFixtureTrustedInputProbe.acceptedSteps];
    if (
      uiFixtureTrustedInputProbe.complete
      || !expectedStep
      || !Number.isSafeInteger(payload.step)
      || payload.step !== expectedStep.step
      || payload.kind !== expectedStep.kind
    ) {
      return rejectInput('Out-of-sequence completed-result fixture input');
    }
    if (expectedStep.kind === 'mouse') {
      const [contentWidth, contentHeight] = fixtureWindow.getContentSize();
      const zoomFactor = fixtureWebContents.getZoomFactor();
      const viewportWidth = Math.floor(contentWidth / zoomFactor);
      const viewportHeight = Math.floor(contentHeight / zoomFactor);
      if (
        payloadKeys.join(',') !== 'kind,step,x,y'
        || !Number.isSafeInteger(payload.x)
        || !Number.isSafeInteger(payload.y)
        || payload.x < 0
        || payload.y < 0
        || payload.x >= viewportWidth
        || payload.y >= viewportHeight
      ) {
        return rejectInput('Invalid completed-result fixture mouse payload');
      }
      fixtureWebContents.focus();
      const inputX = Math.round(payload.x * zoomFactor);
      const inputY = Math.round(payload.y * zoomFactor);
      for (const input of [
        { type: 'mouseMove', x: inputX, y: inputY },
        {
          type: 'mouseDown',
          x: inputX,
          y: inputY,
          button: 'left',
          clickCount: 1,
        },
        {
          type: 'mouseUp',
          x: inputX,
          y: inputY,
          button: 'left',
          clickCount: 1,
        },
      ]) {
        fixtureWebContents.sendInputEvent(input);
        uiFixtureTrustedInputProbe.mouseInputEvents += 1;
      }
      uiFixtureTrustedInputProbe.mouseActions += 1;
    } else if (expectedStep.kind === 'key') {
      if (
        payloadKeys.join(',') !== 'key,kind,step'
        || payload.key !== expectedStep.key
        || !['Tab', 'Escape'].includes(payload.key)
      ) {
        return rejectInput('Invalid completed-result fixture key payload');
      }
      fixtureWebContents.focus();
      fixtureWebContents.sendInputEvent({ type: 'keyDown', keyCode: payload.key });
      fixtureWebContents.sendInputEvent({ type: 'keyUp', keyCode: payload.key });
      uiFixtureTrustedInputProbe.keyActions += 1;
      uiFixtureTrustedInputProbe.keyInputEvents += 2;
    } else {
      if (
        !isGuidedReplyRun
        || payloadKeys.join(',') !== 'action,kind,step'
        || payload.action !== expectedStep.action
        || !['replace-placeholder', 'edit-after-copy'].includes(payload.action)
      ) {
        return rejectInput('Invalid guided-reply fixed text payload');
      }
      const fixedText = payload.action === 'replace-placeholder'
        ? 'Fixture User'
        : '\nFixture follow-up edit.';
      fixtureWebContents.focus();
      await fixtureWebContents.insertText(fixedText);
      uiFixtureTrustedInputProbe.fixedTextActions += 1;
      uiFixtureTrustedInputProbe.fixedTextCharacters += fixedText.length;
    }
    uiFixtureTrustedInputProbe.acceptedSteps += 1;
    uiFixtureTrustedInputProbe.nextStep = uiFixtureTrustedInputProbe.acceptedSteps + 1;
    uiFixtureTrustedInputProbe.complete = uiFixtureTrustedInputProbe.acceptedSteps
      === expectedInputSteps.length;
    return {
      accepted: true,
      kind: expectedStep.kind,
      step: expectedStep.step,
      ...(expectedStep.action ? { action: expectedStep.action } : {}),
      complete: uiFixtureTrustedInputProbe.complete,
    };
  });
}

function registerUiFixtureRecoveryHandlers() {
  const fixtureUrl = new URL(uiFixtureMode.rendererUrl);
  const fixtureRun = fixtureUrl.searchParams.get('run');
  if (
    ![
      'clipboard-residue-recovery-native',
      'stacked-status-text-scale-native',
    ].includes(fixtureRun)
    || fixtureUrl.searchParams.get('rendererRecovery') !== 'clipboard-residue'
  ) return;

  uiFixtureClipboardResidueProbe = {
    activeRisk: Object.freeze({ id: crypto.randomUUID() }),
    storedRiskKeys: Object.freeze(['id']),
    statusRequests: 0,
    invalidAcknowledgements: 0,
    acknowledgedRisks: 0,
    rendererReloads: 0,
  };

  const assertFixtureSender = (event) => {
    if (
      !uiFixtureMode.enabled
      || !getMainWindow()
      || getMainWindow().isDestroyed()
      || event.sender !== getMainWindow().webContents
      || event.sender.getURL() !== uiFixtureMode.rendererUrl
    ) {
      throw new Error('Untrusted UI fixture recovery sender');
    }
  };

  ipcMain.handle(UI_FIXTURE_RENDERER_RECOVERY_STATUS_CHANNEL, (event) => {
    assertFixtureSender(event);
    uiFixtureClipboardResidueProbe.statusRequests += 1;
    return {
      recovered: true,
      clipboardResidueRisk: uiFixtureClipboardResidueProbe.activeRisk
        ? { id: uiFixtureClipboardResidueProbe.activeRisk.id }
        : null,
    };
  });

  ipcMain.handle(UI_FIXTURE_CLIPBOARD_RESIDUE_ACK_CHANNEL, (event, payload) => {
    assertFixtureSender(event);
    const id = payload && typeof payload === 'object' ? payload.id : null;
    if (
      !uiFixtureClipboardResidueProbe.activeRisk
      || typeof id !== 'string'
      || id !== uiFixtureClipboardResidueProbe.activeRisk.id
    ) {
      uiFixtureClipboardResidueProbe.invalidAcknowledgements += 1;
      return { status: 'invalid' };
    }
    uiFixtureClipboardResidueProbe.activeRisk = null;
    uiFixtureClipboardResidueProbe.acknowledgedRisks += 1;
    return { status: 'acknowledged' };
  });
}

async function finishCommandQSafeExitRuntimeCheck() {
  try {
    const rendererProof = await getMainWindow().webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 6000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const bridge = window.slipstreamUiFixtureQuit;
        const input = window.slipstreamUiFixtureInput;
        if (!bridge || !input || typeof bridge.listenerReady !== 'function'
          || typeof bridge.updateRisk !== 'function'
          || typeof bridge.decide !== 'function' || typeof bridge.onRequested !== 'function'
          || typeof input.keyPress !== 'function' || typeof input.mouseClick !== 'function') {
          throw new Error('Dedicated Command+Q fixture bridge is unavailable');
        }
        await waitFor(() => document.querySelector('#result-headline'), 'result fixture');
        await waitFor(() => document.hasFocus(), 'active native fixture window');
        await bridge.updateRisk({ hasRisk: true });
        const safeApiRejected = await window.api.invoke('app:quit-decision').then(
          () => false,
          () => true,
        );
        const clickCenter = async (step, target, label) => {
          if (!(target instanceof HTMLElement) || target.disabled) {
            throw new Error('Missing enabled ' + label);
          }
          const rect = target.getBoundingClientRect();
          await input.mouseClick(
            step,
            Math.floor(rect.left + rect.width / 2),
            Math.floor(rect.top + rect.height / 2),
          );
        };
        await input.keyPress(1, 'q', ['meta']);
        const firstDialog = await waitFor(
          () => document.querySelector('.app-quit-dialog'),
          'first quit confirmation',
        );
        let activeReplayObserved = false;
        const stopActiveReplayObservation = bridge.onRequested(() => {
          activeReplayObserved = true;
        });
        const activeReadyResponse = await bridge.listenerReady();
        await waitFor(() => activeReplayObserved, 'active pending quit replay');
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        const activeReadyReplayed = activeReadyResponse?.status === 'ready'
          && activeReadyResponse.replayed === true;
        const replayedDialog = document.querySelector('.app-quit-dialog');
        const replayKeptSingleDialog = document.querySelectorAll('.app-quit-dialog').length === 1
          && firstDialog.isConnected
          && replayedDialog === firstDialog
          && replayedDialog instanceof HTMLElement
          && replayedDialog.textContent?.includes('继续使用 Slipstream');
        stopActiveReplayObservation?.();
        await input.keyPress(2, 'Escape');
        await waitFor(
          () => !document.querySelector('.app-quit-dialog'),
          'Escape to cancel the first quit confirmation',
        );
        const settledReadyResponse = await bridge.listenerReady();
        await delay(100);
        const settledReadyDidNotReplay = settledReadyResponse?.status === 'ready'
          && settledReadyResponse.replayed === false
          && !document.querySelector('.app-quit-dialog');
        const processSurvivedCancel = document.querySelector('#result-headline') !== null;
        await input.keyPress(3, 'q', ['meta']);
        const secondDialog = await waitFor(
          () => document.querySelector('.app-quit-dialog'),
          'second quit confirmation',
        );
        await clickCenter(4, secondDialog.querySelector('.app-quit-dialog__confirm'), 'first confirm');
        const mismatchDialog = await waitFor(
          () => document.querySelector('.app-quit-dialog__error')
            ? document.querySelector('.app-quit-dialog')
            : null,
          'clipboard consequence mismatch confirmation',
        );
        return {
          bridgeAvailable: true,
          bridgeFrozen: Object.isFrozen(bridge) && Object.isFrozen(input),
          otherFixtureApisIsolated: safeApiRejected,
          dialogOpenedAfterFirstCommand: firstDialog instanceof HTMLElement,
          activeReadyReplayed,
          replayKeptSingleDialog,
          escapeClosedDialog: true,
          settledReadyDidNotReplay,
          processSurvivedCancel,
          dialogOpenedAfterSecondCommand: secondDialog instanceof HTMLElement,
          firstConfirmAttempted: true,
          mismatchStayedOpen: mismatchDialog instanceof HTMLElement,
          secondConfirmAttempted: true,
        };
      })()
    `, true);
    recordCommandQSafeExitLifecycle({ rendererProof });
    await getMainWindow().webContents.executeJavaScript(`
      (async () => {
        const target = document.querySelector('.app-quit-dialog__confirm');
        if (!(target instanceof HTMLElement) || target.disabled) {
          throw new Error('Missing enabled second confirm');
        }
        const rect = target.getBoundingClientRect();
        await window.slipstreamUiFixtureInput.mouseClick(
          5,
          Math.floor(rect.left + rect.width / 2),
          Math.floor(rect.top + rect.height / 2),
        );
      })()
    `, true);
  } catch (error) {
    commandQSafeExitFailure(String(error?.message || 'Command+Q safe-exit renderer automation failed'));
  }
}

async function finishCommandCommaSafeSettingsRuntimeCheck() {
  try {
    const fixtureWindow = getMainWindow();
    if (!fixtureWindow || fixtureWindow.isDestroyed() || fixtureWindow.webContents.isDestroyed()) {
      throw new Error('Command+, Settings fixture window is unavailable');
    }
    const initialRendererProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 10000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const bridge = window.slipstreamUiFixtureSettingsMenu;
        if (!bridge || typeof bridge.listenerReady !== 'function'
          || typeof bridge.handled !== 'function' || typeof bridge.onRequested !== 'function'
          || typeof bridge.faults !== 'function') {
          throw new Error('Dedicated Command+, Settings fixture bridge is unavailable');
        }
        const settingsPanel = await waitFor(
          () => document.querySelector('.settings-panel'),
          'pre-listener pending Settings replay',
        );
        const initialAcknowledgementRetry = await waitFor(() => {
          const faults = bridge.faults();
          return faults?.handledResponsesDropped === 1
            && faults?.handledInvalidResponsesDelivered === 1
            && faults?.handledFirstConsumedStatus === 'acknowledged'
            ? faults
            : null;
        }, 'idempotent invalid ACK retry after consumed-response drop');
        const modelInput = await waitFor(
          () => settingsPanel.querySelector('#provider-model-input:not(:disabled)'),
          'enabled model input',
        );
        const scrollport = settingsPanel.querySelector('.settings-panel__scroll');
        if (!(scrollport instanceof HTMLElement) || !(modelInput instanceof HTMLInputElement)) {
          throw new Error('Settings identity controls are unavailable');
        }
        const safeApiRejected = await window.api.invoke('app:settings-listener-ready').then(
          () => false,
          () => true,
        );
        const originalModel = modelInput.value;
        const draftModel = originalModel + '-fixture-draft';
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (typeof valueSetter !== 'function') throw new Error('Native input setter is unavailable');
        valueSetter.call(modelInput, draftModel);
        modelInput.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(
          () => modelInput.value === draftModel
            && [...settingsPanel.querySelectorAll('.setting-save-status')]
              .some((status) => status.textContent?.includes('有未保存的更改')),
          'unsaved Settings draft',
        );
        modelInput.focus({ preventScroll: true });
        const maximumScrollTop = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
        scrollport.scrollTop = Math.min(maximumScrollTop, Math.max(1, modelInput.offsetTop - 80));
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        window.__slipstreamCommandCommaSettingsFixture = {
          settingsPanel,
          modelInput,
          scrollport,
          originalModel,
          draftModel,
          scrollTop: scrollport.scrollTop,
        };
        return {
          bridgeAvailable: true,
          bridgeFrozen: Object.isFrozen(bridge),
          otherFixtureApisIsolated: safeApiRejected,
          initialPendingReplayOpenedSettings: settingsPanel instanceof HTMLElement,
          initialAcknowledgementConsumedBeforeDrop:
            initialAcknowledgementRetry.handledResponsesDropped === 1,
          initialAcknowledgementRetryWasInvalid:
            initialAcknowledgementRetry.handledInvalidResponsesDelivered === 1,
          unsavedDraftPrepared: modelInput.value === draftModel,
          focusedDraftPrepared: document.activeElement === modelInput,
        };
      })()
    `, true);

    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Application Settings menu handler could not be invoked');
    }
    const existingSettingsProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 8000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        await delay(150);
        const state = window.__slipstreamCommandCommaSettingsFixture;
        const currentPanel = document.querySelector('.settings-panel');
        const currentInput = document.querySelector('#provider-model-input');
        if (!state || currentPanel !== state.settingsPanel || currentInput !== state.modelInput) {
          throw new Error('Repeated Settings command remounted the workspace');
        }
        const samePanelIdentity = currentPanel === state.settingsPanel && currentPanel.isConnected;
        const sameInputIdentity = currentInput === state.modelInput && currentInput.isConnected;
        const draftPreserved = currentInput.value === state.draftModel;
        const focusPreserved = document.activeElement === currentInput;
        const scrollPreserved = Math.abs(state.scrollport.scrollTop - state.scrollTop) <= 1;
        if (!samePanelIdentity || !sameInputIdentity || !draftPreserved
          || !focusPreserved || !scrollPreserved) {
          throw new Error('Repeated Settings command changed draft, focus, scroll, or DOM identity');
        }
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        valueSetter.call(currentInput, state.originalModel);
        currentInput.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(
          () => currentInput.value === state.originalModel
            && ![...currentPanel.querySelectorAll('.setting-save-status')]
              .some((status) => status.textContent?.includes('有未保存的更改')),
          'clean restored Settings draft',
        );
        const returnButton = currentPanel.querySelector('[data-quit-return-focus]');
        if (!(returnButton instanceof HTMLButtonElement) || returnButton.disabled) {
          throw new Error('Settings return action is unavailable');
        }
        returnButton.click();
        await waitFor(() => !document.querySelector('.settings-panel'), 'return from Settings');
        const sampleButton = await waitFor(
          () => [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('载入安全示例')),
          'safe sample action',
        );
        sampleButton.click();
        const source = await waitFor(
          () => {
            const candidate = document.querySelector('textarea[aria-label="要解释的完整原文"]');
            return candidate?.value ? candidate : null;
          },
          'fixed fictional source',
        );
        const processButton = await waitFor(
          () => {
            const candidate = document.querySelector('.process-button');
            return candidate && !candidate.disabled ? candidate : null;
          },
          'enabled process action',
        );
        processButton.click();
        const processingCard = await waitFor(
          () => document.querySelector('.processing-card'),
          'slow processing task',
        );
        const settingsTrigger = document.querySelector('[data-settings-trigger]');
        if (!(settingsTrigger instanceof HTMLButtonElement) || settingsTrigger.disabled) {
          throw new Error('Settings trigger is unavailable during processing');
        }
        settingsTrigger.focus({ preventScroll: true });
        window.__slipstreamCommandCommaSettingsFixture.processingCard = processingCard;
        window.__slipstreamCommandCommaSettingsFixture.settingsTrigger = settingsTrigger;
        return {
          samePanelIdentity,
          sameInputIdentity,
          draftPreserved,
          focusPreserved,
          scrollPreserved,
          settingsClosedWithoutWrite: true,
          fixedFictionalSourceLoaded: source.value.length > 0,
          processingStarted: processingCard instanceof HTMLElement,
          processingFocusPrepared: document.activeElement === settingsTrigger,
        };
      })()
    `, true);

    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Processing Settings menu handler could not be invoked');
    }
    const firstGuardProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 8000;
        let guard = null;
        while (Date.now() < deadline && !guard) {
          guard = document.querySelector('.processing-settings-guard');
          if (!guard) await delay(25);
        }
        if (!(guard instanceof HTMLElement)) throw new Error('Processing Settings guard did not open');
        while (Date.now() < deadline && !guard.contains(document.activeElement)) {
          await delay(25);
        }
        if (!guard.contains(document.activeElement)) {
          throw new Error('Processing Settings guard did not take focus');
        }
        const state = window.__slipstreamCommandCommaSettingsFixture;
        if (!state?.processingCard?.isConnected || document.querySelector('.settings-panel')) {
          throw new Error('Settings command hid or replaced the active processing task');
        }
        state.processingGuard = guard;
        return {
          guardOpened: true,
          guardIsModal: guard.getAttribute('role') === 'dialog'
            && guard.getAttribute('aria-modal') === 'true',
          activeTaskPreserved: state.processingCard.isConnected,
          settingsStayedClosed: !document.querySelector('.settings-panel'),
          guardOwnedFocus: guard.contains(document.activeElement),
        };
      })()
    `, true);

    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Repeated processing Settings menu handler could not be invoked');
    }
    const finalRendererProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 8000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        await delay(150);
        const state = window.__slipstreamCommandCommaSettingsFixture;
        const currentGuard = document.querySelector('.processing-settings-guard');
        const repeatedGuardKeptIdentity = currentGuard === state?.processingGuard
          && currentGuard?.isConnected
          && document.querySelectorAll('.processing-settings-guard').length === 1;
        if (!repeatedGuardKeptIdentity) {
          throw new Error('Repeated Settings command duplicated or remounted the processing guard');
        }
        const continueButton = currentGuard.querySelector('[data-settings-guard-focus]');
        if (!(continueButton instanceof HTMLButtonElement) || continueButton.disabled) {
          throw new Error('Continue-task action is unavailable');
        }
        continueButton.click();
        await waitFor(
          () => !document.querySelector('.processing-settings-guard'),
          'processing guard dismissal',
        );
        await waitFor(
          () => document.activeElement === state.settingsTrigger,
          'focus restoration to the initiating Settings control',
        );
        const readCounter = (name) => {
          const value = Number(document.documentElement.dataset[name]);
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error('Invalid fixture counter: ' + name);
          }
          return value;
        };
        const counters = {
          processRequests: readCounter('demoProcessRequests'),
          settingsWrites: readCounter('demoSettingsWriteRequests'),
          providerConnectionRequests: readCounter('demoProviderConnectionRequests'),
          credentialDeletes: readCounter('demoCredentialDeleteRequests'),
          credentialWrites: readCounter('demoDeepseekCredentialWriteRequests'),
          customPromptWrites: readCounter('demoCustomPromptWriteRequests'),
          clipboardWrites: readCounter('demoClipboardWriteRequests'),
          nativeClipboardWrites: readCounter('demoNativeClipboardWriteStubs'),
          screenshotRequests: readCounter('demoScreenshotCaptureRequests'),
        };
        if (counters.processRequests !== 1
          || Object.entries(counters).some(([name, value]) => name !== 'processRequests' && value !== 0)) {
          throw new Error('Command+, Settings journey caused an unexpected application side effect');
        }
        return {
          repeatedGuardKeptIdentity,
          guardDismissed: true,
          focusRestoredToInitiatingControl: document.activeElement === state.settingsTrigger,
          activeTaskStillVisible: state.processingCard.isConnected,
          settingsStayedClosed: !document.querySelector('.settings-panel'),
          counters,
        };
      })()
    `, true);

    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Stop-and-open Settings menu handler could not be invoked');
    }
    const stopAndOpenProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 8000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const state = window.__slipstreamCommandCommaSettingsFixture;
        const guard = await waitFor(
          () => document.querySelector('.processing-settings-guard'),
          'stop-and-open processing guard',
        );
        await waitFor(
          () => guard.contains(document.activeElement),
          'stop-and-open guard focus',
        );
        const stopAndOpen = guard.querySelector('.primary-button');
        if (!(stopAndOpen instanceof HTMLButtonElement) || stopAndOpen.disabled) {
          throw new Error('Stop-and-open Settings action is unavailable');
        }
        let transitionMutationSequence = 0;
        let processingRemovalMutationOrder = null;
        let settingsInsertionMutationOrder = null;
        const mutationContains = (node, target, selector) => {
          if (!(node instanceof Node)) return false;
          if (target && (node === target || node.contains(target))) return true;
          return node instanceof Element
            && (node.matches(selector) || Boolean(node.querySelector(selector)));
        };
        const recordTransitionMutations = (mutations) => {
          for (const mutation of mutations) {
            transitionMutationSequence += 1;
            if (processingRemovalMutationOrder === null
              && [...mutation.removedNodes].some((node) => (
                mutationContains(node, state.processingCard, '.processing-card')
              ))) {
              processingRemovalMutationOrder = transitionMutationSequence;
            }
            if (settingsInsertionMutationOrder === null
              && [...mutation.addedNodes].some((node) => (
                mutationContains(node, null, '.settings-panel')
              ))) {
              settingsInsertionMutationOrder = transitionMutationSequence;
            }
          }
        };
        const transitionObserver = new MutationObserver(recordTransitionMutations);
        transitionObserver.observe(document.documentElement, { childList: true, subtree: true });
        stopAndOpen.click();
        await waitFor(
          () => !document.querySelector('.processing-card'),
          'stopped processing surface',
        );
        const settingsPanel = await waitFor(
          () => document.querySelector('.settings-panel'),
          'Settings after confirmed task stop',
        );
        await delay(0);
        recordTransitionMutations(transitionObserver.takeRecords());
        transitionObserver.disconnect();
        const processingRemovalObservedBeforeSettingsInsertion = Number.isSafeInteger(
          processingRemovalMutationOrder,
        ) && Number.isSafeInteger(settingsInsertionMutationOrder)
          && processingRemovalMutationOrder < settingsInsertionMutationOrder
          && !document.querySelector('.processing-card');
        if (!processingRemovalObservedBeforeSettingsInsertion) {
          throw new Error('Settings appeared before the processing UI was observably removed');
        }
        const returnButton = settingsPanel.querySelector('[data-quit-return-focus]');
        if (!(returnButton instanceof HTMLButtonElement) || returnButton.disabled) {
          throw new Error('Settings return action after task stop is unavailable');
        }
        returnButton.click();
        await waitFor(() => !document.querySelector('.settings-panel'), 'return after task stop');
        await waitFor(
          () => document.activeElement === state.settingsTrigger,
          'return focus after task stop',
        );
        return {
          stopAndOpenGuardOwnedFocus: guard.contains(document.activeElement) || !guard.isConnected,
          activeTaskStoppedBeforeSettings: processingRemovalObservedBeforeSettingsInsertion,
          processingRemovalObservedBeforeSettingsInsertion,
          settingsOpenedAfterConfirmedStop: settingsPanel instanceof HTMLElement
            && processingRemovalObservedBeforeSettingsInsertion,
          returnedFromSettingsAfterStop: true,
          stopAndOpenFocusRestored: document.activeElement === state.settingsTrigger,
        };
      })()
    `, true);

    const idleFocusPrepared = await fixtureWindow.webContents.executeJavaScript(`
      (() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        return document.activeElement === document.body
          || document.activeElement === document.documentElement;
      })()
    `, true);
    if (!idleFocusPrepared) throw new Error('Could not prepare a no-control Settings focus origin');
    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('No-control Settings menu handler could not be invoked');
    }
    const idleFallbackProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 8000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const settingsPanel = await waitFor(
          () => document.querySelector('.settings-panel'),
          'Settings from no-control focus origin',
        );
        const returnButton = settingsPanel.querySelector('[data-quit-return-focus]');
        if (!(returnButton instanceof HTMLButtonElement) || returnButton.disabled) {
          throw new Error('No-control Settings return action is unavailable');
        }
        returnButton.click();
        await waitFor(() => !document.querySelector('.settings-panel'), 'no-control Settings return');
        const source = await waitFor(
          () => document.querySelector('textarea[aria-label="要解释的完整原文"]'),
          'source after no-control Settings return',
        );
        await waitFor(
          () => document.activeElement === source,
          'semantic source focus after no-control Settings return',
        );
        return {
          bodyAndHtmlRejectedAsFocusOrigin: true,
          noControlSettingsOpened: true,
          semanticSourceFocusRestored: document.activeElement === source,
        };
      })()
    `, true);

    const completionRacePreparation = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 8000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const processButton = await waitFor(
          () => {
            const candidate = document.querySelector('.process-button');
            return candidate && !candidate.disabled ? candidate : null;
          },
          'second process action',
        );
        processButton.click();
        const processingCard = await waitFor(
          () => document.querySelector('.processing-card'),
          'second processing task',
        );
        const settingsTrigger = document.querySelector('[data-settings-trigger]');
        if (!(settingsTrigger instanceof HTMLButtonElement) || settingsTrigger.disabled) {
          throw new Error('Second Settings focus origin is unavailable');
        }
        settingsTrigger.focus({ preventScroll: true });
        window.__slipstreamCommandCommaSettingsFixture.completionProcessingCard = processingCard;
        window.__slipstreamCommandCommaSettingsFixture.completionSettingsTrigger = settingsTrigger;
        return {
          secondProcessingStarted: processingCard instanceof HTMLElement,
          secondProcessingFocusPrepared: document.activeElement === settingsTrigger,
        };
      })()
    `, true);
    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Completion-race Settings menu handler could not be invoked');
    }
    const completionRaceProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 10000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const state = window.__slipstreamCommandCommaSettingsFixture;
        const guard = await waitFor(
          () => document.querySelector('.processing-settings-guard'),
          'completion-race processing guard',
        );
        await waitFor(
          () => guard.contains(document.activeElement),
          'completion-race guard focus',
        );
        const resultHeadline = await waitFor(
          () => document.getElementById('result-headline'),
          'task completion while Settings guard remains open',
        );
        const guardStayedOpenThroughCompletion = guard.isConnected
          && !document.querySelector('.settings-panel');
        if (!guardStayedOpenThroughCompletion) {
          throw new Error('Completion race dismissed the guard or opened Settings implicitly');
        }
        const completionAwareCopy = {
          eyebrow: guard.querySelector('.eyebrow')?.textContent?.trim() || '',
          title: guard.querySelector('#processing-settings-guard-title')?.textContent?.trim() || '',
          detail: guard.querySelector('#processing-settings-guard-detail')?.textContent?.trim() || '',
          continueLabel: guard.querySelector('[data-settings-guard-focus]')?.textContent?.trim() || '',
          settingsLabel: guard.querySelector('.primary-button')?.textContent?.trim() || '',
          closeLabel: guard.querySelector('.icon-button')?.getAttribute('aria-label') || '',
        };
        if (completionAwareCopy.eyebrow !== '任务已经完成'
          || completionAwareCopy.title !== '结果已保留；仍要打开设置吗？'
          || !completionAwareCopy.detail.includes('结果仍在当前窗口')
          || completionAwareCopy.continueLabel !== '查看结果'
          || completionAwareCopy.settingsLabel !== '打开设置'
          || completionAwareCopy.closeLabel !== '关闭设置提示并查看结果') {
          throw new Error('Completion-race Settings guard retained stale in-progress copy');
        }
        const stopAndOpen = guard.querySelector('.primary-button');
        if (!(stopAndOpen instanceof HTMLButtonElement) || stopAndOpen.disabled) {
          throw new Error('Completion-race Settings action is unavailable');
        }
        stopAndOpen.click();
        const settingsPanel = await waitFor(
          () => document.querySelector('.settings-panel'),
          'Settings after completion won the race',
        );
        const returnButton = settingsPanel.querySelector('[data-quit-return-focus]');
        if (!(returnButton instanceof HTMLButtonElement) || returnButton.disabled) {
          throw new Error('Completion-race Settings return action is unavailable');
        }
        returnButton.click();
        await waitFor(() => !document.querySelector('.settings-panel'), 'completion-race Settings return');
        const returnedHeadline = await waitFor(
          () => document.getElementById('result-headline'),
          'retained result after completion-race Settings return',
        );
        await waitFor(
          () => document.activeElement === state.completionSettingsTrigger
            || document.activeElement === returnedHeadline,
          'completion-race return focus',
        );
        const readCounter = (name) => {
          const value = Number(document.documentElement.dataset[name]);
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error('Invalid fixture counter: ' + name);
          }
          return value;
        };
        const counters = {
          processRequests: readCounter('demoProcessRequests'),
          settingsWrites: readCounter('demoSettingsWriteRequests'),
          providerConnectionRequests: readCounter('demoProviderConnectionRequests'),
          credentialDeletes: readCounter('demoCredentialDeleteRequests'),
          credentialWrites: readCounter('demoDeepseekCredentialWriteRequests'),
          customPromptWrites: readCounter('demoCustomPromptWriteRequests'),
          clipboardWrites: readCounter('demoClipboardWriteRequests'),
          nativeClipboardWrites: readCounter('demoNativeClipboardWriteStubs'),
          screenshotRequests: readCounter('demoScreenshotCaptureRequests'),
        };
        if (counters.processRequests !== 2
          || Object.entries(counters).some(([name, value]) => name !== 'processRequests' && value !== 0)) {
          throw new Error('Extended Command+, Settings journey caused an unexpected side effect');
        }
        const faults = await window.slipstreamUiFixtureSettingsMenu.faults();
        if (!Number.isSafeInteger(faults?.listenerReadyAttempts)
          || faults.listenerReadyAttempts < 3
          || !Number.isSafeInteger(faults?.listenerReadyFailuresInjected)
          || faults.listenerReadyFailuresInjected < 2
          || faults?.listenerReadyAcceptedCount !== 1
          || !Number.isSafeInteger(faults?.listenerReadyAcceptedDelayMs)
          || faults.listenerReadyAcceptedDelayMs < 225
          || faults?.handledFailuresInjected !== 1
          || faults?.handledResponsesDropped !== 1
          || faults?.handledInvalidResponsesDelivered !== 1
          || faults?.handledFirstConsumedStatus !== 'acknowledged') {
          throw new Error('Settings READY timer retry or ACK failure injection was not observed');
        }
        return {
          completionWonBeforeChoice: resultHeadline instanceof HTMLElement,
          completionGuardStayedOpen: guardStayedOpenThroughCompletion,
          completionGuardCopyUpdated: completionAwareCopy.eyebrow === '任务已经完成'
            && completionAwareCopy.title === '结果已保留；仍要打开设置吗？'
            && completionAwareCopy.detail.includes('结果仍在当前窗口'),
          completionGuardActionsUpdated: completionAwareCopy.continueLabel === '查看结果'
            && completionAwareCopy.settingsLabel === '打开设置'
            && completionAwareCopy.closeLabel === '关闭设置提示并查看结果',
          completionChoiceOpenedSettings: true,
          completionResultRetained: returnedHeadline instanceof HTMLElement,
          completionReturnFocusRestored: document.activeElement === state.completionSettingsTrigger
            || document.activeElement === returnedHeadline,
          listenerReadyAttempts: faults.listenerReadyAttempts,
          listenerReadyFailuresInjected: faults.listenerReadyFailuresInjected,
          listenerReadyAcceptedCount: faults.listenerReadyAcceptedCount,
          listenerReadyAcceptedDelayMs: faults.listenerReadyAcceptedDelayMs,
          listenerReadyRetryRecovered: faults.listenerReadyAttempts >= 3
            && faults.listenerReadyFailuresInjected >= 2
            && faults.listenerReadyAcceptedCount === 1
            && faults.listenerReadyAcceptedDelayMs >= 225,
          acknowledgementRetryRecovered: faults.handledFailuresInjected === 1,
          acknowledgementConsumedBeforeResponseDrop: faults.handledResponsesDropped === 1
            && faults.handledFirstConsumedStatus === 'acknowledged',
          acknowledgementRetrySettledAsInvalid:
            faults.handledInvalidResponsesDelivered === 1,
          counters,
        };
      })()
    `, true);

    const lateCompletionPreparation = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 10000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const retry = await waitFor(
          () => [...document.querySelectorAll('button.secondary-button--quiet')]
            .find((button) => button.textContent?.includes('重新分析')),
          'late-cancel completion retry action',
        );
        retry.click();
        const processingCard = await waitFor(
          () => document.querySelector('.processing-card'),
          'third processing task',
        );
        const settingsTrigger = document.querySelector('[data-settings-trigger]');
        if (!(settingsTrigger instanceof HTMLButtonElement) || settingsTrigger.disabled) {
          throw new Error('Late-cancel completion Settings focus origin is unavailable');
        }
        settingsTrigger.focus({ preventScroll: true });
        const state = window.__slipstreamCommandCommaSettingsFixture;
        state.lateCompletionSettingsTrigger = settingsTrigger;
        return {
          lateCompletionProcessingStarted: processingCard instanceof HTMLElement
            && Number(document.documentElement.dataset.demoProcessRequests) === 3,
          lateCompletionProcessingFocusPrepared: document.activeElement === settingsTrigger,
        };
      })()
    `, true);
    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Late-cancel completion Settings menu handler could not be invoked');
    }
    const lateCompletionProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 10000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const readCounter = (name) => {
          const value = Number(document.documentElement.dataset[name]);
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error('Invalid fixture counter: ' + name);
          }
          return value;
        };
        const readTimeline = () => {
          const timeline = JSON.parse(
            document.documentElement.dataset.demoCommandCommaTimeline || '[]',
          );
          if (!Array.isArray(timeline) || timeline.some((entry, index) => (
            entry?.sequence !== index + 1 || typeof entry?.event !== 'string'
          ))) throw new Error('Invalid Command+, cancellation timeline');
          return timeline;
        };
        const eventSequence = (timeline, event) => (
          timeline.find((entry) => entry.event === event)?.sequence ?? null
        );
        let settingsObserved = Boolean(document.querySelector('.settings-panel'));
        const settingsObserver = new MutationObserver(() => {
          settingsObserved ||= Boolean(document.querySelector('.settings-panel'));
        });
        settingsObserver.observe(document.documentElement, { childList: true, subtree: true });
        const guard = await waitFor(
          () => document.querySelector('.processing-settings-guard'),
          'late-cancel completion guard',
        );
        await waitFor(() => guard.contains(document.activeElement), 'late-cancel guard focus');
        const stopAndOpen = guard.querySelector('.primary-button');
        if (!(stopAndOpen instanceof HTMLButtonElement) || stopAndOpen.disabled) {
          throw new Error('Late-cancel stop-and-open action is unavailable');
        }
        stopAndOpen.click();
        const pendingResultHeadline = await waitFor(() => {
          const headline = document.getElementById('result-headline');
          const timeline = readTimeline();
          return headline
            && eventSequence(timeline, 'process-3-succeeded') !== null
            && eventSequence(timeline, 'cancel-2-failed') === null
            ? headline
            : null;
        }, 'result while the Settings cancellation request is still pending');
        const pendingTimeline = readTimeline();
        const resultObservedBeforeCancelFailure = pendingResultHeadline instanceof HTMLElement
          && readCounter('demoCommandCommaCancelRequests') === 2
          && readCounter('demoCommandCommaCancelFailures') === 0
          && eventSequence(pendingTimeline, 'process-3-succeeded') !== null
          && eventSequence(pendingTimeline, 'cancel-2-failed') === null;
        await waitFor(
          () => readCounter('demoCommandCommaCancelFailures') === 1
            && eventSequence(readTimeline(), 'cancel-2-failed') !== null,
          'late Settings cancellation failure',
        );
        const warning = await waitFor(
          () => {
            const candidate = document.querySelector('.inline-warning');
            return candidate?.textContent?.includes(
              '停止请求未能确认，但任务随后完成；结果已显示，未自动打开设置。',
            ) ? candidate : null;
          },
          'honest late-cancel completion warning',
        );
        await waitFor(
          () => document.activeElement === pendingResultHeadline,
          'late-cancel result focus',
        );
        const settledTimeline = readTimeline();
        const processSucceededBeforeCancelFailed = Number.isSafeInteger(
          eventSequence(settledTimeline, 'process-3-succeeded'),
        ) && eventSequence(settledTimeline, 'process-3-succeeded')
          < eventSequence(settledTimeline, 'cancel-2-failed');
        const lateCancelSettingsStayedClosed = !settingsObserved
          && !document.querySelector('.settings-panel');
        const lateCancelWarningHonest = warning.textContent.includes('未自动打开设置');
        const lateCancelResultFocusRestored = document.activeElement === pendingResultHeadline;

        const ordinaryRetry = [...document.querySelectorAll('button.secondary-button--quiet')]
          .find((button) => button.textContent?.includes('重新分析'));
        if (!(ordinaryRetry instanceof HTMLButtonElement) || ordinaryRetry.disabled) {
          throw new Error('Post-late-cancel retry action is unavailable');
        }
        ordinaryRetry.click();
        const ordinaryProcessing = await waitFor(
          () => Number(document.documentElement.dataset.demoProcessRequests) === 4
            ? document.querySelector('.processing-card')
            : null,
          'post-late-cancel ordinary processing task',
        );
        const ordinaryCancel = ordinaryProcessing.querySelector('.processing-cancel-button');
        if (!(ordinaryCancel instanceof HTMLButtonElement) || ordinaryCancel.disabled) {
          throw new Error('Post-late-cancel ordinary stop action is unavailable');
        }
        const ordinaryCancelWasNotSettingsLabeled = !ordinaryCancel.textContent.includes('打开设置')
          && !ordinaryCancel.getAttribute('aria-label')?.includes('打开设置');
        ordinaryCancel.click();
        await waitFor(
          () => eventSequence(readTimeline(), 'cancel-3-succeeded') !== null
            && eventSequence(readTimeline(), 'process-4-cancelled') !== null,
          'post-late-cancel ordinary cancellation',
        );
        const restoredResult = await waitFor(
          () => document.getElementById('result-headline'),
          'result after post-late-cancel ordinary cancellation',
        );
        await delay(100);
        settingsObserved ||= Boolean(document.querySelector('.settings-panel'));
        const lateCancelIntentClearedBeforeNextTask = ordinaryCancelWasNotSettingsLabeled
          && restoredResult instanceof HTMLElement
          && !settingsObserved
          && !document.querySelector('.settings-panel');
        settingsObserver.disconnect();

        const clearAndReturn = document.querySelector('.new-capture-button');
        if (!(clearAndReturn instanceof HTMLButtonElement) || clearAndReturn.disabled) {
          throw new Error('Clear-and-return action is unavailable before failure settlement');
        }
        clearAndReturn.click();
        const emptySource = await waitFor(
          () => {
            const candidate = document.querySelector('textarea[aria-label="要解释的完整原文"]');
            return candidate instanceof HTMLTextAreaElement && candidate.value === ''
              ? candidate
              : null;
          },
          'empty source before failure settlement',
        );
        const sampleButton = await waitFor(
          () => [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('载入安全示例')),
          'failure-settlement safe sample action',
        );
        sampleButton.click();
        const failureSource = await waitFor(
          () => emptySource.value ? emptySource : null,
          'failure-settlement retained source',
        );
        const processButton = await waitFor(
          () => {
            const candidate = document.querySelector('.process-button');
            return candidate && !candidate.disabled ? candidate : null;
          },
          'failure-settlement process action',
        );
        processButton.click();
        const failureProcessing = await waitFor(
          () => Number(document.documentElement.dataset.demoProcessRequests) === 5
            ? document.querySelector('.processing-card')
            : null,
          'fifth processing task',
        );
        const settingsTrigger = document.querySelector('[data-settings-trigger]');
        if (!(settingsTrigger instanceof HTMLButtonElement) || settingsTrigger.disabled) {
          throw new Error('Failure-settlement Settings focus origin is unavailable');
        }
        settingsTrigger.focus({ preventScroll: true });
        const state = window.__slipstreamCommandCommaSettingsFixture;
        state.failureSourceText = failureSource.value;
        return {
          resultObservedWhileCancelPending: resultObservedBeforeCancelFailure,
          lateCancelProcessSettledBeforeFailure: processSucceededBeforeCancelFailed,
          lateCancelSettingsStayedClosed,
          lateCancelResultRetained: pendingResultHeadline.isConnected
            || restoredResult instanceof HTMLElement,
          lateCancelWarningHonest,
          lateCancelResultFocusRestored,
          lateCancelIntentClearedBeforeNextTask,
          failureSettlementFreshSourcePrepared: failureSource.value.length > 0,
          failureSettlementProcessingStarted: failureProcessing instanceof HTMLElement,
          failureSettlementFocusPrepared: document.activeElement === settingsTrigger,
        };
      })()
    `, true);
    if (triggerApplicationSettingsMenu() !== true) {
      throw new Error('Failure-settlement Settings menu handler could not be invoked');
    }
    const failedCompletionProof = await fixtureWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeout = 10000) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          const diagnostic = label === 'cancellation failure before ordinary task failure'
            ? '; timeline=' + (document.documentElement.dataset.demoCommandCommaTimeline || '[]')
              + '; cancelRequests=' + (document.documentElement.dataset.demoCommandCommaCancelRequests || '?')
              + '; processRequests=' + (document.documentElement.dataset.demoProcessRequests || '?')
              + '; processing=' + Boolean(document.querySelector('.processing-card'))
              + '; error=' + Boolean(document.getElementById('processing-error-card'))
            : '';
          throw new Error('Timed out waiting for ' + label + diagnostic);
        };
        const readCounter = (name) => {
          const value = Number(document.documentElement.dataset[name]);
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error('Invalid fixture counter: ' + name);
          }
          return value;
        };
        const readTimeline = () => {
          const timeline = JSON.parse(
            document.documentElement.dataset.demoCommandCommaTimeline || '[]',
          );
          if (!Array.isArray(timeline) || timeline.some((entry, index) => (
            entry?.sequence !== index + 1 || typeof entry?.event !== 'string'
          ))) throw new Error('Invalid Command+, cancellation timeline');
          return timeline;
        };
        const eventSequence = (timeline, event) => (
          timeline.find((entry) => entry.event === event)?.sequence ?? null
        );
        let settingsObserved = Boolean(document.querySelector('.settings-panel'));
        const settingsObserver = new MutationObserver(() => {
          settingsObserved ||= Boolean(document.querySelector('.settings-panel'));
        });
        settingsObserver.observe(document.documentElement, { childList: true, subtree: true });
        const guard = await waitFor(
          () => document.querySelector('.processing-settings-guard'),
          'ordinary-failure settlement guard',
        );
        await waitFor(() => guard.contains(document.activeElement), 'failure guard focus');
        const stopAndOpen = guard.querySelector('.primary-button');
        if (!(stopAndOpen instanceof HTMLButtonElement) || stopAndOpen.disabled) {
          throw new Error('Failure-settlement stop-and-open action is unavailable');
        }
        stopAndOpen.click();
        const cancelError = await waitFor(
          () => document.querySelector('.processing-cancel-error'),
          'cancellation failure before ordinary task failure',
        );
        const failurePendingTimeline = readTimeline();
        const cancelFailedBeforeProcessSettlement = cancelError instanceof HTMLElement
          && document.querySelector('.processing-card') instanceof HTMLElement
          && eventSequence(failurePendingTimeline, 'cancel-4-failed') !== null
          && eventSequence(failurePendingTimeline, 'process-5-failed') === null;
        const cancellationFailureCopyHonest = cancelError.textContent.includes(
          '在线服务可能仍在处理并产生费用',
        );
        const errorCard = await waitFor(
          () => document.getElementById('processing-error-card'),
          'ordinary processing failure after cancellation failure',
        );
        const source = await waitFor(
          () => document.querySelector('textarea[aria-label="要解释的完整原文"]'),
          'retained source after ordinary processing failure',
        );
        await waitFor(
          () => document.activeElement === errorCard,
          'ordinary failure explanation focus',
        );
        const settledTimeline = readTimeline();
        const cancelFailurePrecededOrdinaryFailure = Number.isSafeInteger(
          eventSequence(settledTimeline, 'cancel-4-failed'),
        ) && eventSequence(settledTimeline, 'cancel-4-failed')
          < eventSequence(settledTimeline, 'process-5-failed');
        const ordinaryFailureSettingsStayedClosed = !settingsObserved
          && !document.querySelector('.settings-panel');
        const ordinaryFailureErrorRetained = errorCard.textContent.includes(
          '当前分析服务暂时不可用',
        );
        const ordinaryFailureSourceRetained = source.value
          === window.__slipstreamCommandCommaSettingsFixture.failureSourceText;
        const ordinaryFailureFocusedError = document.activeElement === errorCard;

        const retry = [...errorCard.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === '重试');
        if (!(retry instanceof HTMLButtonElement) || retry.disabled) {
          throw new Error('Ordinary-failure retry action is unavailable');
        }
        retry.click();
        const nextProcessing = await waitFor(
          () => Number(document.documentElement.dataset.demoProcessRequests) === 6
            ? document.querySelector('.processing-card')
            : null,
          'next task after ordinary failure',
        );
        const ordinaryCancel = nextProcessing.querySelector('.processing-cancel-button');
        if (!(ordinaryCancel instanceof HTMLButtonElement) || ordinaryCancel.disabled) {
          throw new Error('Next-task ordinary stop action is unavailable');
        }
        const nextCancelWasNotSettingsLabeled = !ordinaryCancel.textContent.includes('打开设置')
          && !ordinaryCancel.getAttribute('aria-label')?.includes('打开设置');
        ordinaryCancel.click();
        await waitFor(
          () => eventSequence(readTimeline(), 'cancel-5-succeeded') !== null
            && eventSequence(readTimeline(), 'process-6-cancelled') !== null,
          'next-task ordinary cancellation',
        );
        const returnedSource = await waitFor(
          () => {
            const candidate = document.querySelector('textarea[aria-label="要解释的完整原文"]');
            return candidate instanceof HTMLTextAreaElement
              && candidate.value === window.__slipstreamCommandCommaSettingsFixture.failureSourceText
              ? candidate
              : null;
          },
          'source after next-task ordinary cancellation',
        );
        await waitFor(
          () => document.activeElement === returnedSource,
          'source focus after next-task ordinary cancellation',
        );
        await delay(100);
        settingsObserved ||= Boolean(document.querySelector('.settings-panel'));
        settingsObserver.disconnect();
        const failureIntentClearedBeforeNextCancel = nextCancelWasNotSettingsLabeled
          && !settingsObserved
          && !document.querySelector('.settings-panel')
          && returnedSource instanceof HTMLTextAreaElement;
        const counters = {
          processRequests: readCounter('demoProcessRequests'),
          settingsWrites: readCounter('demoSettingsWriteRequests'),
          providerConnectionRequests: readCounter('demoProviderConnectionRequests'),
          credentialDeletes: readCounter('demoCredentialDeleteRequests'),
          credentialWrites: readCounter('demoDeepseekCredentialWriteRequests'),
          customPromptWrites: readCounter('demoCustomPromptWriteRequests'),
          clipboardWrites: readCounter('demoClipboardWriteRequests'),
          nativeClipboardWrites: readCounter('demoNativeClipboardWriteStubs'),
          screenshotRequests: readCounter('demoScreenshotCaptureRequests'),
        };
        const cancellationCounters = {
          requests: readCounter('demoCommandCommaCancelRequests'),
          successes: readCounter('demoCommandCommaCancelSuccesses'),
          failures: readCounter('demoCommandCommaCancelFailures'),
        };
        const acknowledgementFaults = await window.slipstreamUiFixtureSettingsMenu.faults();
        if (counters.processRequests !== 6
          || Object.entries(counters).some(([name, value]) => name !== 'processRequests' && value !== 0)
          || cancellationCounters.requests !== 5
          || cancellationCounters.successes !== 3
          || cancellationCounters.failures !== 2
          || acknowledgementFaults?.handledRequests !== 10
          || acknowledgementFaults?.handledResponsesDropped !== 1
          || acknowledgementFaults?.handledInvalidResponsesDelivered !== 1
          || acknowledgementFaults?.handledFirstConsumedStatus !== 'acknowledged') {
          throw new Error('Command+, cancellation settlement counters were incomplete');
        }
        return {
          cancelFailureObservedWhileTaskActive: cancelFailedBeforeProcessSettlement,
          cancellationFailureCopyHonest,
          cancelFailurePrecededOrdinaryFailure,
          ordinaryFailureSettingsStayedClosed,
          ordinaryFailureErrorRetained,
          ordinaryFailureSourceRetained,
          ordinaryFailureFocusedError,
          failureIntentClearedBeforeNextCancel,
          nextOrdinaryCancelSettingsStayedClosed: !settingsObserved
            && !document.querySelector('.settings-panel'),
          nextOrdinaryCancelReturnedToSource: returnedSource.isConnected
            && document.activeElement === returnedSource,
          acknowledgementRequests: acknowledgementFaults.handledRequests,
          acknowledgementResponseDroppedAfterConsumption:
            acknowledgementFaults.handledResponsesDropped === 1
            && acknowledgementFaults.handledFirstConsumedStatus === 'acknowledged',
          acknowledgementInvalidRetryDelivered:
            acknowledgementFaults.handledInvalidResponsesDelivered === 1,
          counters,
          cancellationCounters,
        };
      })()
    `, true);

    const acknowledgementDeadline = Date.now() + 5000;
    while (
      hasPendingApplicationSettingsRequest()
      && Date.now() < acknowledgementDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const lifecycle = uiFixtureCommandCommaSettingsProbe;
    const settingsRequestPending = hasPendingApplicationSettingsRequest();
    const menuState = getApplicationSettingsMenuState();
    const preferences = fixtureWindow.webContents.getLastWebPreferences();
    const windowCount = require('electron').BrowserWindow.getAllWindows()
      .filter((candidate) => !candidate.isDestroyed()).length;
    const lifecycleReady = lifecycle?.menuInvocationCount === 9
      && lifecycle.acceleratorActivationCount === 0
      && lifecycle.requestCount === 9
      && lifecycle.requestSentCount === 10
      && lifecycle.listenerReadyCount === 1
      && lifecycle.pendingReplayCount === 1
      && lifecycle.acknowledgedCount === 9
      && lifecycle.invalidAcknowledgementCount === 1;
    if (!lifecycleReady) throw new Error('Command+, Settings lifecycle was incomplete');
    if (settingsRequestPending) throw new Error('Command+, Settings request stayed pending after ACK retry');
    if (
      menuState?.exists !== true
      || menuState?.id !== 'app-settings'
      || menuState?.label !== '设置…'
      || menuState?.accelerator !== 'Command+,'
      || menuState?.handlerAttached !== true
    ) throw new Error('Application Settings menu wiring is invalid');
    if (windowCount !== 1) throw new Error('Command+, Settings created an extra BrowserWindow');
    if (uiFixtureBlockedRendererExternalRequests !== 0) {
      throw new Error('Command+, Settings renderer attempted an external request');
    }
    if (applicationMenuHasUnsafeDeveloperActions()) {
      throw new Error('Application menu exposed unsafe developer actions');
    }
    const payload = {
      success: true,
      isolation: {
        rendererUrlExact: fixtureWindow.webContents.getURL() === uiFixtureMode.rendererUrl,
        userDataIsFixture: app.getPath('userData') === uiFixtureMode.userDataPath,
        sessionDataIsNested: app.getPath('sessionData')
          .startsWith(`${uiFixtureMode.userDataPath}${path.sep}`),
        contextIsolation: preferences.contextIsolation === true,
        nodeIntegrationDisabled: preferences.nodeIntegration === false,
        sandboxEnabled: preferences.sandbox === true,
        inheritedSecretsPresent: Boolean(
          process.env.DEEPSEEK_API_KEY
          || process.env.OPENAI_API_KEY
          || process.env.ANTHROPIC_API_KEY
          || process.env.SSH_AUTH_SOCK
          || process.env.NODE_OPTIONS
        ),
        blockedRendererExternalRequests: uiFixtureBlockedRendererExternalRequests,
        windowCount,
      },
      applicationSettingsMenu: {
        id: menuState.id,
        label: menuState.label,
        accelerator: menuState.accelerator,
        handlerAttached: menuState.handlerAttached,
      },
      lifecycle: {
        menuInvocationCount: lifecycle.menuInvocationCount,
        acceleratorActivationCount: lifecycle.acceleratorActivationCount,
        requestCount: lifecycle.requestCount,
        requestSentCount: lifecycle.requestSentCount,
        listenerReadyCount: lifecycle.listenerReadyCount,
        pendingReplayCount: lifecycle.pendingReplayCount,
        acknowledgedCount: lifecycle.acknowledgedCount,
        invalidAcknowledgementCount: lifecycle.invalidAcknowledgementCount,
        requestPendingAfterRetry: settingsRequestPending,
        menuHandlerCoverage: true,
        physicalAcceleratorCausality: false,
      },
      renderer: {
        ...initialRendererProof,
        ...existingSettingsProof,
        ...firstGuardProof,
        ...finalRendererProof,
        ...stopAndOpenProof,
        ...idleFallbackProof,
        ...completionRacePreparation,
        ...completionRaceProof,
        ...lateCompletionPreparation,
        ...lateCompletionProof,
        ...failedCompletionProof,
      },
    };
    lifecycle.outputWritten = true;
    process.stdout.write(
      `${COMMAND_COMMA_SAFE_SETTINGS_OUTPUT_PREFIX}${JSON.stringify(payload)}\n`,
      () => app.exit(0),
    );
  } catch (error) {
    commandCommaSafeSettingsFailure(
      String(error?.message || 'Command+, Settings renderer automation failed'),
    );
  }
}

async function finishUiFixtureRuntimeCheck() {
  const outputPrefix = '__SLIPSTREAM_UI_FIXTURE_CHECK__';
  try {
    const fixtureUrl = new URL(uiFixtureMode.rendererUrl);
    const trapPort = Number(fixtureUrl.searchParams.get('trapPort'));
    const trapUrl = `http://127.0.0.1:${trapPort}/slipstream-ui-fixture-network-trap`;
    const fixtureRun = fixtureUrl.searchParams.get('run') || 'native-runtime';
    if (fixtureRun === COMMAND_Q_SAFE_EXIT_TRUSTED_INPUT_RUN) {
      await finishCommandQSafeExitRuntimeCheck();
      return;
    }
    if (fixtureRun === COMMAND_COMMA_SAFE_SETTINGS_RUN) {
      await finishCommandCommaSafeSettingsRuntimeCheck();
      return;
    }
    if (fixtureRun === 'clipboard-residue-recovery-native') {
      const initialRequestDeadline = Date.now() + 6000;
      while (
        uiFixtureClipboardResidueProbe?.statusRequests < 1
        && Date.now() < initialRequestDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (uiFixtureClipboardResidueProbe?.statusRequests !== 1) {
        throw new Error('Clipboard residue fixture did not request main-owned recovery state before reload');
      }
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Clipboard residue fixture renderer reload timed out'));
        }, 6000);
        getMainWindow().webContents.once('did-finish-load', () => {
          clearTimeout(timeout);
          resolve();
        });
        uiFixtureClipboardResidueProbe.rendererReloads += 1;
        getMainWindow().webContents.reload();
      });
    }
    let textScaleKeyboardModalityPrimed = false;
    let clipboardResidueFocusOwnedBeforeKeyboardPriming = false;
    let workspaceRecoveryFocusOwnedBeforeKeyboardPriming = false;
    if ([
      'first-use-capture-text-scale-native',
      'completed-result-text-scale-native',
      'guided-reply-text-scale-native',
      'stacked-status-text-scale-native',
      'settings-transition-text-scale-native',
      'settings-draft-discard-native',
      'clipboard-residue-recovery-native',
      'result-stylesheet-recovery-native',
      'settings-stylesheet-collision-native',
    ].includes(fixtureRun)) {
      const keyboardReadySelector = fixtureRun === 'first-use-capture-text-scale-native'
        ? '#setup-title'
        : fixtureRun === 'completed-result-text-scale-native'
          ? '#result-headline'
          : fixtureRun === 'guided-reply-text-scale-native'
            ? '#result-headline'
          : fixtureRun === 'stacked-status-text-scale-native'
            ? '.foreground-status-center[data-pending-capture-count="2"][data-operational-status-count="2"]'
            : fixtureRun === 'clipboard-residue-recovery-native'
              ? '#clipboard-residue-risk-title'
              : fixtureRun === 'result-stylesheet-recovery-native'
                ? '[data-workspace-load-failure="result"] [data-workspace-retry="result"]'
              : fixtureRun === 'settings-stylesheet-collision-native'
                ? '#result-headline'
        : '[aria-label="打开设置"]';
      const keyboardReadyTimeout = fixtureRun === 'stacked-status-text-scale-native'
        ? 12_000
        : 10_000;
      await getMainWindow().webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const deadline = Date.now() + ${keyboardReadyTimeout};
          const check = () => {
            if (document.querySelector(${JSON.stringify(keyboardReadySelector)})) {
              resolve(true);
              return;
            }
            if (Date.now() >= deadline) {
              reject(new Error('Timed out waiting to prime native keyboard modality'));
              return;
            }
            window.setTimeout(check, 25);
          };
          check();
        })
      `, true);
      if (fixtureRun === 'clipboard-residue-recovery-native') {
        clipboardResidueFocusOwnedBeforeKeyboardPriming = await getMainWindow().webContents
          .executeJavaScript(`
            new Promise((resolve, reject) => {
              const deadline = Date.now() + 6000;
              const check = () => {
                const title = document.querySelector('#clipboard-residue-risk-title');
                if (title && document.activeElement === title) {
                  resolve(true);
                  return;
                }
                if (Date.now() >= deadline) {
                  reject(new Error('Clipboard residue title did not own initial recovery focus'));
                  return;
                }
                window.setTimeout(check, 25);
              };
              check();
            })
          `, true);
      }
      if (fixtureRun === 'result-stylesheet-recovery-native') {
        workspaceRecoveryFocusOwnedBeforeKeyboardPriming = await getMainWindow().webContents
          .executeJavaScript(`
            new Promise((resolve, reject) => {
              const deadline = Date.now() + 6000;
              const check = () => {
                const retry = document.querySelector(
                  '[data-workspace-load-failure="result"] [data-workspace-retry="result"]'
                );
                if (retry && document.activeElement === retry) {
                  resolve(true);
                  return;
                }
                if (Date.now() >= deadline) {
                  reject(new Error('Result stylesheet failure retry did not own initial recovery focus'));
                  return;
                }
                window.setTimeout(check, 25);
              };
              check();
            })
          `, true);
      }
      getMainWindow().webContents.focus();
      getMainWindow().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      getMainWindow().webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      if (fixtureRun === 'result-stylesheet-recovery-native') {
        getMainWindow().webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'Tab',
          modifiers: ['shift'],
        });
        getMainWindow().webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: 'Tab',
          modifiers: ['shift'],
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      textScaleKeyboardModalityPrimed = await getMainWindow().webContents.executeJavaScript(`
        (() => {
          const exactTarget = ${JSON.stringify(
    fixtureRun === 'result-stylesheet-recovery-native',
  )}
            ? document.querySelector(
              '[data-workspace-load-failure="result"] [data-workspace-retry="result"]'
            )
            : null;
          return Boolean(
          document.activeElement
          && document.activeElement !== document.body
          && document.activeElement.matches(':focus-visible')
          && (!exactTarget || document.activeElement === exactTarget)
          );
        })()
      `, true);
      if (!textScaleKeyboardModalityPrimed) {
        throw new Error('Native text-scale fixture did not establish visible keyboard focus');
      }
    }
    const renderer = await getMainWindow().webContents.executeJavaScript(`
      (async () => {
        const fixtureRun = ${JSON.stringify(fixtureRun)};
        const nativeKeyboardModalityPrimed = ${JSON.stringify(textScaleKeyboardModalityPrimed)};
        const nativeRecoveryFocusOwnedBeforeKeyboardPriming = ${JSON.stringify(
    clipboardResidueFocusOwnedBeforeKeyboardPriming,
  )};
        const nativeWorkspaceRecoveryFocusOwnedBeforeKeyboardPriming = ${JSON.stringify(
    workspaceRecoveryFocusOwnedBeforeKeyboardPriming,
  )};
        const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
        const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
        const elementSnapshot = (element) => {
          if (!(element instanceof Element)) return null;
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || '',
            role: element.getAttribute('role') || '',
            className: typeof element.className === 'string' ? element.className : '',
            connected: element.isConnected,
          };
        };
        const waitFor = async (read, label, timeout = 6000, diagnose = null) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await delay(25);
          }
          let detail = { activeElement: elementSnapshot(document.activeElement) };
          if (typeof diagnose === 'function') {
            try {
              detail = { ...detail, ...diagnose() };
            } catch (error) {
              detail.diagnosticError = String(error?.message || error);
            }
          }
          throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(detail));
        };
        const ensure = (condition, message) => {
          if (!condition) throw new Error(message);
        };
        const click = (target) => {
          ensure(target, 'Missing click target');
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
          }));
        };
        const pressKey = (key, shiftKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', {
          key,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }));
        const focusEvidenceWithinDialog = (dialog, target, label) => {
          ensure(dialog instanceof HTMLElement, 'Missing dialog for ' + label);
          ensure(target instanceof HTMLElement, 'Missing focus target for ' + label);
          const dialogRect = dialog.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const ringExtent = 4;
          const scrollport = {
            left: dialogRect.left + dialog.clientLeft,
            top: dialogRect.top + dialog.clientTop,
            right: dialogRect.left + dialog.clientLeft + dialog.clientWidth,
            bottom: dialogRect.top + dialog.clientTop + dialog.clientHeight,
          };
          const tolerance = 1;
          const focused = document.activeElement === target;
          const ringVisible = focused
            && targetRect.left - ringExtent >= scrollport.left - tolerance
            && targetRect.top - ringExtent >= scrollport.top - tolerance
            && targetRect.right + ringExtent <= scrollport.right + tolerance
            && targetRect.bottom + ringExtent <= scrollport.bottom + tolerance;
          const pageNoHorizontalOverflow = document.documentElement.scrollWidth
            <= document.documentElement.clientWidth + tolerance
            && document.body.scrollWidth <= document.body.clientWidth + tolerance;
          return {
            label,
            focused,
            ringVisible,
            dialogNoHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + tolerance,
            pageNoHorizontalOverflow,
            ringExtent,
            target: {
              left: targetRect.left,
              top: targetRect.top,
              right: targetRect.right,
              bottom: targetRect.bottom,
            },
            scrollport,
          };
        };

        const rectSnapshot = (element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const visibleScrollport = (element) => {
          const rect = element.getBoundingClientRect();
          const left = rect.left + element.clientLeft;
          const top = rect.top + element.clientTop;
          return {
            left: Math.max(0, left),
            top: Math.max(0, top),
            right: Math.min(window.innerWidth, left + element.clientWidth),
            bottom: Math.min(window.innerHeight, top + element.clientHeight),
          };
        };
        const alignTargetInScrollport = (
          target,
          scrollport,
          { block = 'center', inset = 0 } = {},
        ) => {
          ensure(target instanceof HTMLElement, 'Missing target for scroll alignment');
          ensure(scrollport instanceof HTMLElement, 'Missing scrollport for scroll alignment');
          const targetRect = target.getBoundingClientRect();
          const port = visibleScrollport(scrollport);
          const portHeight = Math.max(1, port.bottom - port.top);
          const safeInset = Math.max(0, inset);
          let desiredTop;
          if (block === 'start') desiredTop = port.top + safeInset;
          else if (block === 'end') desiredTop = port.bottom - safeInset - targetRect.height;
          else {
            const availableHeight = Math.max(1, portHeight - safeInset * 2);
            desiredTop = targetRect.height <= availableHeight
              ? port.top + safeInset + (availableHeight - targetRect.height) / 2
              : port.top + safeInset;
          }
          const before = readScrollPosition(scrollport);
          const requestedTop = before.top + targetRect.top - desiredTop;
          // One owner-scoped scroll write mirrors a user moving the known
          // scroll surface without involving inert or range-less ancestors.
          scrollport.scrollTop = requestedTop;
          return {
            block,
            inset: safeInset,
            before,
            requestedTop,
            after: readScrollPosition(scrollport),
            target: rectSnapshot(target),
            scrollport: port,
          };
        };
        const pageHasNoHorizontalOverflow = () => {
          const tolerance = 1;
          return document.documentElement.scrollWidth
              <= document.documentElement.clientWidth + tolerance
            && document.body.scrollWidth <= document.body.clientWidth + tolerance
            && document.querySelector('.app-root')?.scrollWidth
              <= document.querySelector('.app-root')?.clientWidth + tolerance
            && document.querySelector('.app-session-surface')?.scrollWidth
              <= document.querySelector('.app-session-surface')?.clientWidth + tolerance;
        };
        const horizontalContainment = (target, scrollport, ringExtent = 0) => {
          const rect = target.getBoundingClientRect();
          const port = visibleScrollport(scrollport);
          const tolerance = 1;
          return rect.left - ringExtent >= port.left - tolerance
            && rect.right + ringExtent <= port.right + tolerance;
        };
        const fullyVisibleIn = (target, scrollport, ringExtent = 0) => {
          const rect = target.getBoundingClientRect();
          const port = visibleScrollport(scrollport);
          const tolerance = 1;
          return rect.left - ringExtent >= port.left - tolerance
            && rect.right + ringExtent <= port.right + tolerance
            && rect.top - ringExtent >= port.top - tolerance
            && rect.bottom + ringExtent <= port.bottom + tolerance;
        };
        const intersectsVertically = (target, scrollport) => {
          const rect = target.getBoundingClientRect();
          const port = visibleScrollport(scrollport);
          return rect.bottom > port.top + 1 && rect.top < port.bottom - 1;
        };
        const overlapArea = (first, second) => {
          const horizontal = Math.max(0, Math.min(first.right, second.right)
            - Math.max(first.left, second.left));
          const vertical = Math.max(0, Math.min(first.bottom, second.bottom)
            - Math.max(first.top, second.top));
          return horizontal * vertical;
        };
        const waitForStableEvidence = async (
          read,
          ready,
          label,
          { timeout = 2000, requiredFrames = 3 } = {},
        ) => {
          const deadline = Date.now() + timeout;
          let lastSnapshot = null;
          let lastSnapshotKey = null;
          let stableReadyFrames = 0;
          while (Date.now() < deadline) {
            await nextFrame();
            const snapshot = read();
            const snapshotKey = JSON.stringify(snapshot);
            const isReady = ready(snapshot) === true;
            if (isReady && snapshotKey === lastSnapshotKey) stableReadyFrames += 1;
            else stableReadyFrames = isReady ? 1 : 0;
            lastSnapshot = snapshot;
            lastSnapshotKey = snapshotKey;
            if (stableReadyFrames >= requiredFrames) return snapshot;
          }
          throw new Error(
            'Timed out waiting for stable ' + label + ': '
              + JSON.stringify({
                activeElement: elementSnapshot(document.activeElement),
                lastSnapshot,
                requiredFrames,
              }),
          );
        };
        const readScrollPosition = (scrollport) => ({
          connected: scrollport.isConnected,
          top: scrollport.scrollTop,
          left: scrollport.scrollLeft,
          scrollHeight: scrollport.scrollHeight,
          scrollWidth: scrollport.scrollWidth,
          clientHeight: scrollport.clientHeight,
          clientWidth: scrollport.clientWidth,
        });
        const scrollChainSnapshot = (target, stopAt) => {
          const chain = [];
          let current = target.parentElement;
          while (current instanceof HTMLElement && chain.length < 8) {
            const style = getComputedStyle(current);
            chain.push({
              tag: current.tagName.toLowerCase(),
              id: current.id || '',
              className: typeof current.className === 'string'
                ? current.className.slice(0, 160)
                : '',
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              rect: rectSnapshot(current),
              scroll: readScrollPosition(current),
            });
            if (current === stopAt) break;
            current = current.parentElement;
          }
          return chain;
        };
        const waitForStableScrollPosition = (
          scrollport,
          { top, left = 0 },
          label,
        ) => waitForStableEvidence(
          () => readScrollPosition(scrollport),
          (snapshot) => {
            const expectedTop = top === 'maximum'
              ? Math.max(0, snapshot.scrollHeight - snapshot.clientHeight)
              : top;
            return snapshot.connected
              && Math.abs(snapshot.top - expectedTop) <= 1
              && Math.abs(snapshot.left - left) <= 1;
          },
          label,
        );
        const waitForStableTargetGeometry = (target, scrollport, label) => waitForStableEvidence(
          () => ({
            targetConnected: target.isConnected,
            scrollportConnected: scrollport.isConnected,
            rect: rectSnapshot(target),
            scrollport: visibleScrollport(scrollport),
            scroll: readScrollPosition(scrollport),
            horizontallyContained: horizontalContainment(target, scrollport),
            verticallyReachable: intersectsVertically(target, scrollport),
            pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
            scrollportNoHorizontalOverflow: scrollport.scrollWidth
              <= scrollport.clientWidth + 1,
          }),
          (snapshot) => snapshot.targetConnected
            && snapshot.scrollportConnected
            && snapshot.horizontallyContained
            && snapshot.verticallyReachable
            && snapshot.pageNoHorizontalOverflow
            && snapshot.scrollportNoHorizontalOverflow,
          label,
        );
        const readRevealEvidence = (
          target,
          scrollport,
          label,
          canFocus,
          alignment,
        ) => {
          const focusStyle = getComputedStyle(target);
          const outlineWidth = canFocus ? Number.parseFloat(focusStyle.outlineWidth) || 0 : 0;
          const outlineOffset = canFocus ? Number.parseFloat(focusStyle.outlineOffset) || 0 : 0;
          const ringRendered = canFocus
            ? outlineWidth > 0
              && focusStyle.outlineStyle !== 'none'
              && focusStyle.outlineColor !== 'transparent'
            : null;
          const ringExtent = canFocus ? outlineWidth + Math.max(0, outlineOffset) : 0;
          return {
            label,
            targetConnected: target.isConnected,
            scrollportConnected: scrollport.isConnected,
            focused: canFocus ? document.activeElement === target : null,
            horizontallyContained: horizontalContainment(target, scrollport),
            verticallyReachable: intersectsVertically(target, scrollport),
            fullyVisible: fullyVisibleIn(target, scrollport),
            ringRendered,
            ringExtent,
            outline: canFocus ? {
              width: outlineWidth,
              offset: outlineOffset,
              style: focusStyle.outlineStyle,
              color: focusStyle.outlineColor,
            } : null,
            ringVisible: canFocus
              ? ringRendered && fullyVisibleIn(target, scrollport, ringExtent)
              : null,
            pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
            scrollportNoHorizontalOverflow: scrollport.scrollWidth <= scrollport.clientWidth + 1,
            scrollTop: scrollport.scrollTop,
            scrollLeft: scrollport.scrollLeft,
            rect: rectSnapshot(target),
            scrollport: visibleScrollport(scrollport),
            scrollChain: scrollChainSnapshot(target, scrollport),
            alignment,
          };
        };
        const revealGeometryReady = (evidence) => evidence.targetConnected
          && evidence.scrollportConnected
          && evidence.horizontallyContained
          && evidence.verticallyReachable
          && evidence.pageNoHorizontalOverflow
          && evidence.scrollportNoHorizontalOverflow;
        const revealEvidence = async (
          target,
          scrollport,
          label,
          {
            focus = true,
            focusBeforeAlign = false,
            requireFocusVisible = true,
          } = {},
        ) => {
          ensure(target instanceof HTMLElement, 'Missing target for ' + label);
          ensure(scrollport instanceof HTMLElement, 'Missing scrollport for ' + label);
          const canFocus = focus && !target.matches(':disabled');
          let focusApplied = false;
          const applyFocusOnce = () => {
            ensure(!focusApplied, 'Repeated focus request for ' + label);
            target.focus({ preventScroll: true });
            focusApplied = true;
          };
          // Focus exactly once. The bounded sampler below observes ownership; it
          // never repairs a product focus loss by repeatedly calling focus().
          if (canFocus && focusBeforeAlign) applyFocusOnce();
          const alignment = alignTargetInScrollport(target, scrollport);
          const scrolledEvidence = await waitForStableEvidence(
            () => readRevealEvidence(target, scrollport, label, false, alignment),
            revealGeometryReady,
            label + ' scroll geometry',
          );
          if (!canFocus) return scrolledEvidence;
          if (!focusBeforeAlign) applyFocusOnce();
          return waitForStableEvidence(
            () => readRevealEvidence(target, scrollport, label, true, alignment),
            (evidence) => revealGeometryReady(evidence)
              && evidence.focused
              && (!requireFocusVisible || evidence.ringRendered),
            label + ' focused geometry',
          );
        };
        const cssPaintIsVisible = (value) => {
          const normalized = String(value || '').trim().toLowerCase();
          if (!normalized || normalized === 'none' || normalized === 'transparent') return false;
          return !/^rgba\\([^)]*,\\s*0(?:\\.0+)?\\)$/u.test(normalized)
            && !/^color\\([^)]*\\/\\s*0(?:\\.0+)?\\)$/u.test(normalized);
        };
        const readFocusedControlEvidence = (target, renderedTarget, scrollport, label) => {
          const focusStyle = getComputedStyle(renderedTarget);
          const outlineWidth = Number.parseFloat(focusStyle.outlineWidth) || 0;
          const outlineOffset = Number.parseFloat(focusStyle.outlineOffset) || 0;
          const outlineRendered = outlineWidth > 0
            && focusStyle.outlineStyle !== 'none'
            && cssPaintIsVisible(focusStyle.outlineColor);
          const boxShadowRendered = focusStyle.boxShadow !== 'none'
            && cssPaintIsVisible(focusStyle.boxShadow);
          const focused = document.activeElement === target;
          const focusVisible = target.matches(':focus-visible');
          const ringRendered = focused
            && focusVisible
            && (outlineRendered || boxShadowRendered);
          const ringExtent = outlineRendered
            ? outlineWidth + Math.max(0, outlineOffset)
            : boxShadowRendered ? 4 : 0;
          return {
            label,
            targetConnected: target.isConnected,
            renderedTargetConnected: renderedTarget.isConnected,
            scrollportConnected: scrollport.isConnected,
            focused,
            focusVisible,
            ringRendered,
            ringVisible: ringRendered
              && fullyVisibleIn(renderedTarget, scrollport, ringExtent),
            horizontallyContained: horizontalContainment(renderedTarget, scrollport),
            verticallyReachable: intersectsVertically(renderedTarget, scrollport),
            fullyVisible: fullyVisibleIn(renderedTarget, scrollport),
            pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
            scrollportNoHorizontalOverflow: scrollport.scrollWidth
              <= scrollport.clientWidth + 1,
            ringExtent,
            outline: {
              width: outlineWidth,
              offset: outlineOffset,
              style: focusStyle.outlineStyle,
              color: focusStyle.outlineColor,
            },
            boxShadow: focusStyle.boxShadow,
            scrollTop: scrollport.scrollTop,
            scrollLeft: scrollport.scrollLeft,
            target: rectSnapshot(target),
            renderedTarget: rectSnapshot(renderedTarget),
            scrollport: visibleScrollport(scrollport),
          };
        };
        const focusedControlGeometryReady = (
          evidence,
          { requireFullyVisible = true } = {},
        ) => evidence.targetConnected
          && evidence.renderedTargetConnected
          && evidence.scrollportConnected
          && evidence.horizontallyContained
          && evidence.verticallyReachable
          && (!requireFullyVisible || evidence.fullyVisible)
          && evidence.pageNoHorizontalOverflow
          && evidence.scrollportNoHorizontalOverflow;
        const focusedControlEvidence = async (
          target,
          scrollport,
          label,
          {
            focusTarget = true,
            visualTarget = null,
            requireFullyVisible = true,
            requireFocusVisible = true,
          } = {},
        ) => {
          ensure(target instanceof HTMLElement, 'Missing focus target for ' + label);
          ensure(scrollport instanceof HTMLElement, 'Missing focus scrollport for ' + label);
          const renderedTarget = visualTarget instanceof HTMLElement ? visualTarget : target;
          // Reveal the same element whose visual ring is measured. Controls such as
          // radios render their focus cue on a wrapping label that is materially
          // larger than the input itself at 200% text scale.
          alignTargetInScrollport(renderedTarget, scrollport);
          await waitForStableEvidence(
            () => readFocusedControlEvidence(target, renderedTarget, scrollport, label),
            (evidence) => focusedControlGeometryReady(
              evidence,
              { requireFullyVisible },
            ),
            label + ' scroll geometry',
          );
          if (focusTarget) {
            ensure(!target.matches(':disabled'), 'Disabled focus target for ' + label);
            // As with revealEvidence, focus once and only observe thereafter.
            target.focus({ preventScroll: true });
          }
          return waitForStableEvidence(
            () => readFocusedControlEvidence(target, renderedTarget, scrollport, label),
            (evidence) => focusedControlGeometryReady(
              evidence,
              { requireFullyVisible },
            )
              && evidence.focused
              && (!requireFocusVisible || (
                evidence.focusVisible
                && evidence.ringRendered
                && (!requireFullyVisible || evidence.ringVisible)
              )),
            label + ' focused geometry',
          );
        };
        const findButton = (root, text) => [...root.querySelectorAll('button')]
          .find((button) => button.textContent?.includes(text));

        const deadline = Date.now() + 5000;
        const isFirstUseCaptureTextScaleRun = fixtureRun
          === 'first-use-capture-text-scale-native';
        const isCompletedResultTextScaleRun = fixtureRun
          === 'completed-result-text-scale-native';
        const isGuidedReplyTextScaleRun = fixtureRun
          === 'guided-reply-text-scale-native';
        const isStackedStatusTextScaleRun = fixtureRun
          === 'stacked-status-text-scale-native';
        const isLazyWorkspaceRecoveryRun = fixtureRun
          === 'lazy-workspace-recovery-native';
        const isResultStylesheetRecoveryRun = fixtureRun
          === 'result-stylesheet-recovery-native';
        const isSettingsStylesheetCollisionRun = fixtureRun
          === 'settings-stylesheet-collision-native';
        const isWorkspaceRecoveryRun = isLazyWorkspaceRecoveryRun
          || isResultStylesheetRecoveryRun;
        const trustedInputBridge = isCompletedResultTextScaleRun
          || isGuidedReplyTextScaleRun
          || isSettingsStylesheetCollisionRun
          ? window.slipstreamUiFixtureInput
          : null;
        const trustedInputEvidence = {
          rejectedStep: null,
          mouse: [],
          keyboard: [],
          fixedText: [],
          escape: null,
        };
        const targetCenterHit = (target, label) => {
          ensure(target instanceof HTMLElement, 'Missing trusted input target for ' + label);
          const rects = [...target.getClientRects()];
          ensure(rects.length > 0, 'Zero-size trusted input target for ' + label);
          for (let rectIndex = 0; rectIndex < rects.length; rectIndex += 1) {
            const rect = rects[rectIndex];
            if (rect.width <= 0 || rect.height <= 0) continue;
            const x = Math.floor(rect.left + rect.width / 2);
            const y = Math.floor(rect.top + rect.height / 2);
            if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === target || target.contains(hit))) {
              return {
                x,
                y,
                hitTag: hit.tagName.toLowerCase(),
                rectIndex,
              };
            }
          }
          throw new Error('Trusted input point did not hit ' + label);
        };
        const dispatchTrustedClick = async (
          step,
          target,
          scrollport,
          label,
          { focusBeforeClick = true } = {},
        ) => {
          ensure(
            trustedInputBridge && typeof trustedInputBridge.mouseClick === 'function',
            'Completed-result trusted input bridge is unavailable',
          );
          await revealEvidence(target, scrollport, label, { focus: focusBeforeClick });
          const point = targetCenterHit(target, label);
          let observedEvent = null;
          target.addEventListener('click', (event) => {
            observedEvent = {
              isTrusted: event.isTrusted,
              type: event.type,
              targetOwned: event.target === target || target.contains(event.target),
              clientX: event.clientX,
              clientY: event.clientY,
            };
          }, { capture: true, once: true });
          const response = await trustedInputBridge.mouseClick(step, point.x, point.y);
          await waitFor(() => observedEvent, 'trusted click event for ' + label);
          ensure(
            response?.accepted === true
              && response.kind === 'mouse'
              && response.step === step
              && observedEvent.isTrusted === true
              && observedEvent.type === 'click'
              && observedEvent.targetOwned === true
              && observedEvent.clientX === point.x
              && observedEvent.clientY === point.y,
            'Native mouse input was not trusted for ' + label,
          );
          const evidence = {
            label,
            step,
            point,
            ...observedEvent,
          };
          trustedInputEvidence.mouse.push(evidence);
          return evidence;
        };
        const dispatchTrustedKey = async (step, key, dialog, label) => {
          ensure(
            trustedInputBridge && typeof trustedInputBridge.keyPress === 'function',
            'Completed-result trusted input bridge is unavailable',
          );
          const activeTarget = document.activeElement;
          ensure(
            activeTarget instanceof HTMLElement
              && dialog instanceof HTMLElement
              && dialog.contains(activeTarget),
            key + ' target is not owned by ' + label,
          );
          const point = targetCenterHit(activeTarget, label + ' active target');
          let observedEvent = null;
          window.addEventListener('keydown', (event) => {
            if (event.key !== key) return;
            observedEvent = {
              isTrusted: event.isTrusted,
              key: event.key,
              activeTargetOwned: dialog.contains(document.activeElement),
              eventTargetOwned: event.target === activeTarget
                || activeTarget.contains(event.target),
            };
          }, { capture: true, once: true });
          const response = await trustedInputBridge.keyPress(step, key);
          await waitFor(() => observedEvent, 'trusted ' + key + ' event for ' + label);
          let focusMoved = null;
          let focusRemainedOwned = null;
          let focusVisible = null;
          if (key === 'Tab') {
            const movedTarget = await waitFor(
              () => {
                const candidate = document.activeElement;
                return candidate instanceof HTMLElement
                  && candidate !== activeTarget
                  && dialog.contains(candidate)
                  ? candidate
                  : null;
              },
              'trusted Tab focus move for ' + label,
            );
            focusMoved = movedTarget !== activeTarget;
            focusRemainedOwned = dialog.contains(movedTarget);
            focusVisible = movedTarget.matches(':focus-visible');
          }
          ensure(
            response?.accepted === true
              && response.kind === 'key'
              && response.step === step
              && observedEvent.isTrusted === true
              && observedEvent.key === key
              && observedEvent.activeTargetOwned === true
              && observedEvent.eventTargetOwned === true
              && (key !== 'Tab' || (
                focusMoved === true
                  && focusRemainedOwned === true
                  && focusVisible === true
              )),
            'Native ' + key + ' input was not trusted for ' + label,
          );
          const evidence = {
            label,
            step,
            point,
            ...observedEvent,
            focusMoved,
            focusRemainedOwned,
            focusVisible,
          };
          trustedInputEvidence.keyboard.push(evidence);
          if (key === 'Escape') trustedInputEvidence.escape = evidence;
          return evidence;
        };
        const dispatchTrustedFixedText = async (
          step,
          action,
          textarea,
          selectionStart,
          selectionEnd,
          label,
        ) => {
          ensure(textarea instanceof HTMLTextAreaElement, 'Missing textarea for ' + label);
          const bridgeMethod = action === 'replace-placeholder'
            ? trustedInputBridge?.replacePlaceholder
            : trustedInputBridge?.editAfterCopy;
          ensure(typeof bridgeMethod === 'function', 'Guided-reply fixed text bridge is unavailable');
          ensure(
            Number.isSafeInteger(selectionStart)
              && Number.isSafeInteger(selectionEnd)
              && selectionStart >= 0
              && selectionEnd >= selectionStart
              && selectionEnd <= textarea.value.length,
            'Invalid fixed text selection for ' + label,
          );
          const textareaScrollport = textarea.closest('[role="dialog"]');
          ensure(textareaScrollport instanceof HTMLElement,
            'Missing guided-reply scrollport for ' + label);
          await revealEvidence(
            textarea,
            textareaScrollport,
            label,
            { requireFocusVisible: false },
          );
          textarea.setSelectionRange(selectionStart, selectionEnd, 'none');
          const beforeValue = textarea.value;
          const fixedText = action === 'replace-placeholder'
            ? 'Fixture User'
            : String.fromCharCode(10) + 'Fixture follow-up edit.';
          const expectedValue = beforeValue.slice(0, selectionStart)
            + fixedText
            + beforeValue.slice(selectionEnd);
          let observedEvent = null;
          textarea.addEventListener('input', (event) => {
            observedEvent = {
              isTrusted: event.isTrusted,
              inputType: event.inputType || '',
              targetOwned: event.target === textarea,
            };
          }, { capture: true, once: true });
          const response = await bridgeMethod(step);
          await waitFor(
            () => observedEvent && textarea.value === expectedValue,
            'trusted fixed text for ' + label,
          );
          ensure(
            response?.accepted === true
              && response.kind === 'fixed-text'
              && response.step === step
              && response.action === action
              && observedEvent.isTrusted === true
              && observedEvent.targetOwned === true
              && textarea.value === expectedValue,
            'Fixed guided-reply text was not delivered as trusted input for ' + label,
          );
          const evidence = {
            label,
            step,
            action,
            isTrusted: observedEvent.isTrusted,
            inputType: observedEvent.inputType,
            targetOwned: observedEvent.targetOwned,
            insertedCharacterCount: fixedText.length,
            selectionStart,
            selectionEnd,
          };
          trustedInputEvidence.fixedText.push(evidence);
          return evidence;
        };
        const isSettingsTextScaleRun = fixtureRun === 'settings-transition-text-scale-native';
        const isSettingsTransitionRun = [
          'settings-transition-native',
          'settings-transition-text-scale-native',
          'settings-draft-discard-native',
        ].includes(fixtureRun);
        const isFailedDraftDiscardRun = fixtureRun === 'settings-failed-draft-discard-native';
        const isReplyCopySettlementRun = fixtureRun === 'reply-copy-settlement-native';
        const isOptionCEditTransitionRun = fixtureRun === 'option-c-edit-transition-native';
        const isRuntimeDegradedRun = fixtureRun === 'runtime-degraded-native';
        const isStartupRecoveryRun = fixtureRun === 'startup-recovery-native';
        const isClipboardResidueRecoveryRun = fixtureRun === 'clipboard-residue-recovery-native';
        const isProviderRetryRun = fixtureRun === 'provider-retry-native';
        const isSettingsSaveRetryRun = fixtureRun === 'settings-save-retry-native';
        const isSettingsPromptDraftRecoveryRun = fixtureRun
          === 'settings-prompt-draft-recovery-native';
        const isFailedSourceRetryRun = fixtureRun === 'failed-source-retry-native';
        const isManualClipboardReplacementRun = fixtureRun
          === 'manual-clipboard-replacement-native';
        const readySelector = isStartupRecoveryRun
          ? '.startup-recovery'
          : isFirstUseCaptureTextScaleRun
            ? '#setup-title'
          : isSettingsPromptDraftRecoveryRun
            ? '#setup-title'
          : isSettingsTransitionRun
            || isFailedDraftDiscardRun
            || isProviderRetryRun
            || isSettingsSaveRetryRun
          ? '[aria-label="打开设置"]'
          : isCompletedResultTextScaleRun
            || isGuidedReplyTextScaleRun
            || isReplyCopySettlementRun
            || isFailedSourceRetryRun
            || isSettingsStylesheetCollisionRun
            ? '.result-footer'
            : isWorkspaceRecoveryRun
              ? '[data-workspace-load-failure="result"]'
            : isStackedStatusTextScaleRun
              ? '.foreground-status-center[data-pending-capture-count="2"][data-operational-status-count="2"]'
            : isOptionCEditTransitionRun
              || isRuntimeDegradedRun
              || isClipboardResidueRecoveryRun
              || isManualClipboardReplacementRun
              ? 'textarea[aria-label="要解释的完整原文"]'
              : '#setup-title';
        while (!document.querySelector(readySelector) && Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        ensure(document.querySelector(readySelector), 'Fixture renderer did not become ready');
        let settingsIpcRejected = false;
        try {
          await window.api.invoke('settings:get');
        } catch {
          settingsIpcRejected = true;
        }
        const clipboardResponse = isClipboardResidueRecoveryRun
          || isStackedStatusTextScaleRun
          || isManualClipboardReplacementRun
          || isWorkspaceRecoveryRun
          || isSettingsStylesheetCollisionRun
          ? { fixture: true, skipped: true }
          : await window.api.invoke('clipboard:write', 'fixture-only text');
        const sameOriginResponse = await fetch(location.origin + '/', { cache: 'no-store' });
        let settingsTransition = null;
        let replyCopySettlement = null;
        let optionCEditTransition = null;
        let runtimeDegraded = null;
        let startupRecovery = null;
        let clipboardResidueRecovery = null;
        let providerRetry = null;
        let settingsSaveRetry = null;
        let settingsPromptDraftRecovery = null;
        let failedDraftDiscard = null;
        let failedSourceRetry = null;
        let firstUseCaptureTextScale = null;
        let completedResultTextScale = null;
        let guidedReplyTextScale = null;
        let stackedStatusTextScale = null;
        let lazyWorkspaceRecovery = null;
        let settingsStylesheetCollision = null;
        let manualClipboardReplacement = null;

        if (isManualClipboardReplacementRun) {
          const readCounter = (datasetKey) => {
            const value = Number(document.documentElement.dataset[datasetKey]);
            ensure(Number.isSafeInteger(value) && value >= 0,
              'Invalid manual clipboard fixture counter ' + datasetKey);
            return value;
          };
          const readProcessRequests = () => readCounter('demoProcessRequests');
          const clipboardDecisionDiagnostic = () => {
            const region = document.querySelector('.clipboard-monitor-queue');
            return {
              region: Boolean(region),
              title: Boolean(region?.querySelector('#clipboard-monitor-queue-title')),
              detail: Boolean(region?.querySelector('#clipboard-monitor-queue-detail')),
              replace: Boolean(region?.querySelector('.clipboard-monitor-queue__accept')),
              buttonCount: region?.querySelectorAll('button').length || 0,
              activeElement: elementSnapshot(document.activeElement),
            };
          };
          const waitForStableManualFocus = (target, label) => waitForStableEvidence(
            () => ({
              activeElement: elementSnapshot(document.activeElement),
              target: elementSnapshot(target),
              focused: document.activeElement === target,
            }),
            (snapshot) => snapshot.target?.connected === true && snapshot.focused,
            label,
          );
          const sourceInput = await waitFor(
            () => document.querySelector('textarea[aria-label="要解释的完整原文"]'),
            'manual clipboard source textarea',
          );
          const textareaValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          ).set;
          const draft = 'Fixture unsent application draft. Keep this exact text safe.';
          textareaValueSetter.call(sourceInput, draft);
          sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(
            () => sourceInput.value === draft && readProcessRequests() === 0,
            'unsent draft before manual clipboard read',
          );

          const readButton = await waitFor(
            () => {
              const candidate = findButton(document, '读取剪贴板');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'manual clipboard read action',
          );
          readButton.focus({ preventScroll: true });
          ensure(document.activeElement === readButton,
            'manual clipboard read action did not own pre-read focus');
          click(readButton);

          const firstDecision = await waitFor(
            () => {
              const region = document.querySelector('.clipboard-monitor-queue');
              const title = region?.querySelector('#clipboard-monitor-queue-title');
              const detail = region?.querySelector('#clipboard-monitor-queue-detail');
              const replace = region?.querySelector('.clipboard-monitor-queue__accept');
              const keep = [...(region?.querySelectorAll('button') || [])]
                .find((button) => button !== replace);
              return region && title && detail && replace && keep
                ? { region, title, detail, replace, keep }
                : null;
            },
            'rendered manual clipboard replacement decision',
            6000,
            clipboardDecisionDiagnostic,
          );
          await waitForStableManualFocus(
            firstDecision.title,
            'manual clipboard replacement decision focus',
          );
          const firstDecisionText = firstDecision.region.textContent || '';
          const firstReadPreservedDraft = sourceInput.value === draft;
          const firstDecisionFocused = document.activeElement === firstDecision.title;
          const firstReadRequestSettled = Boolean(await waitFor(
            () => readButton.getAttribute('aria-busy') !== 'true' && readButton,
            'first manual clipboard read request settlement',
          ));
          const firstDecisionExplicit = firstDecisionText.includes('确认替换')
            && firstDecision.replace.textContent.includes('替换')
            && firstDecision.keep.textContent.includes('继续编辑原文');
          const firstDecisionNoAutoProcess = firstDecisionText.includes('不会自动处理')
            && firstDecisionText.includes('发送给模型')
            && readProcessRequests() === 0
            && !document.querySelector('.processing-card');
          ensure(firstReadPreservedDraft && firstReadRequestSettled,
            'first manual clipboard read overwrote the draft or did not settle');
          ensure(firstDecisionExplicit,
            'manual clipboard read did not expose an explicit keep or replace decision');
          ensure(firstDecisionNoAutoProcess,
            'manual clipboard decision did not state or honor the no-processing contract');

          click(firstDecision.keep);
          const readButtonReadyAfterKeep = () => {
            const candidate = findButton(document, '读取剪贴板');
            return candidate === readButton
              && !candidate.disabled
              && candidate.getAttribute('aria-busy') !== 'true'
              && !document.querySelector('.clipboard-monitor-queue')
              && sourceInput.value === draft
              ? candidate
              : null;
          };
          const settledReadButton = await waitFor(
            readButtonReadyAfterKeep,
            'enabled manual read action with exact draft after Keep',
          );
          await waitForStableManualFocus(
            settledReadButton,
            'manual read action focus after Keep',
          );
          const keepPreservedExactDraft = sourceInput.value === draft;
          const keepRestoredExactFocus = document.activeElement === readButton;
          const keepReadActionEnabled = settledReadButton.disabled === false
            && settledReadButton.getAttribute('aria-busy') !== 'true';
          const keepDidNotProcess = readProcessRequests() === 0
            && !document.querySelector('.processing-card');
          ensure(
            keepPreservedExactDraft
              && keepRestoredExactFocus
              && keepReadActionEnabled
              && keepDidNotProcess,
            'Keep did not preserve the exact draft, focus, enabled read action, and idle state',
          );

          const stableReadButtonEvidence = await waitForStableEvidence(
            () => ({
              activeElement: elementSnapshot(document.activeElement),
              button: elementSnapshot(readButtonReadyAfterKeep()),
              sameButton: readButtonReadyAfterKeep() === settledReadButton,
              focused: document.activeElement === settledReadButton,
            }),
            (snapshot) => snapshot.button?.connected === true
              && snapshot.sameButton
              && snapshot.focused,
            'enabled manual read action before the second read',
          );
          const stableReadButton = readButtonReadyAfterKeep();
          ensure(stableReadButtonEvidence.sameButton && stableReadButton === settledReadButton,
            'manual read action identity changed while settling after Keep');
          click(stableReadButton);
          const secondDecision = await waitFor(
            () => {
              const region = document.querySelector('.clipboard-monitor-queue');
              const title = region?.querySelector('#clipboard-monitor-queue-title');
              const replace = region?.querySelector('.clipboard-monitor-queue__accept');
              return region && title && replace
                ? { region, title, replace }
                : null;
            },
            'second manual clipboard replacement decision',
            6000,
            clipboardDecisionDiagnostic,
          );
          await waitForStableManualFocus(
            secondDecision.title,
            'second manual clipboard replacement decision focus',
          );
          const secondReadPreservedExactDraft = sourceInput.value === draft;
          const secondDecisionFocused = document.activeElement === secondDecision.title;
          ensure(secondReadPreservedExactDraft && readProcessRequests() === 0,
            'second manual clipboard read changed or processed the unsent draft');
          click(secondDecision.replace);

          const replacementNotice = await waitFor(
            () => {
              const notice = document.querySelector('.capture-warning[role="status"]');
              const text = notice?.textContent || '';
              return sourceInput.value.startsWith('Dear Student,')
                && sourceInput.value.includes('passport information page')
                && sourceInput.value.endsWith('University Services')
                && text.includes('已用剪贴板文字替换当前原文')
                && text.includes('尚未开始处理')
                ? notice
                : null;
            },
            'truthful manual clipboard replacement notice',
          );
          await delay(300);
          const replacementText = replacementNotice.textContent || '';
          const replacementNoticeVisible = replacementNotice.isConnected;
          const replacementLoadedClipboardPreview = sourceInput.value !== draft
            && sourceInput.value.startsWith('Dear Student,')
            && sourceInput.value.includes('eVisa share code')
            && sourceInput.value.endsWith('University Services');
          const replacementFocusedSource = document.activeElement === sourceInput;
          const replacementNoticeTruthful = replacementText.includes(
            '已用剪贴板文字替换当前原文',
          ) && replacementText.includes('尚未开始处理')
            && replacementText.includes('请先检查内容');
          const finalProcessRequests = readProcessRequests();
          const noProcessingOrClipboardWrite = finalProcessRequests === 0
            && readCounter('demoClipboardWriteRequests') === 0
            && readCounter('demoNativeClipboardWriteStubs') === 0
            && !document.querySelector('.processing-card');
          ensure(replacementLoadedClipboardPreview,
            'Replace did not load the deterministic clipboard preview');
          ensure(replacementFocusedSource,
            'Replace did not return focus to the loaded source');
          ensure(replacementNoticeTruthful,
            'Replace did not render a truthful not-yet-processed notice');
          ensure(noProcessingOrClipboardWrite,
            'manual clipboard replacement triggered processing or a clipboard write');

          const replacementSnapshot = sourceInput.value;
          const clearButton = await waitFor(
            () => {
              const candidate = findButton(document, '清空');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'manual clipboard clear action',
          );
          click(clearButton);
          const activeUndoButton = await waitFor(
            () => {
              const candidate = findButton(document, '撤销清空');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'Clear Undo action before the guarded read',
          );
          await waitForStableManualFocus(
            activeUndoButton,
            'Clear Undo action focus before the guarded read',
          );
          const clearUndoReadButton = await waitFor(
            () => {
              const candidate = findButton(document, '读取剪贴板');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'manual read action during Clear Undo',
          );
          click(clearUndoReadButton);
          const clearUndoDecision = await waitFor(
            () => {
              const region = document.querySelector('.clipboard-monitor-queue');
              const title = region?.querySelector('#clipboard-monitor-queue-title');
              const detail = region?.querySelector('#clipboard-monitor-queue-detail');
              const replace = region?.querySelector('.clipboard-monitor-queue__accept');
              const keep = [...(region?.querySelectorAll('button') || [])]
                .find((button) => button !== replace);
              const undoStatus = document.querySelector('.session-clear-undo');
              const decisionText = region?.textContent || '';
              const undoText = undoStatus?.textContent || '';
              return region && title && detail && replace && keep && undoStatus
                && decisionText.includes('清空撤销')
                && decisionText.includes('撤销倒计时已暂停')
                && decisionText.includes('从剩余时间继续')
                && undoText.includes('撤销倒计时已暂停')
                && activeUndoButton.disabled
                ? { region, title, detail, replace, keep, undoStatus }
                : null;
            },
            'paused Clear Undo manual replacement decision',
            6000,
            clipboardDecisionDiagnostic,
          );
          await waitForStableManualFocus(
            clearUndoDecision.title,
            'paused Clear Undo manual replacement decision focus',
          );
          const pausedStatusText = clearUndoDecision.undoStatus.textContent || '';
          const pausedCopyTruthful = pausedStatusText.includes('撤销倒计时已暂停')
            && pausedStatusText.includes('剩余')
            && clearUndoDecision.detail.textContent.includes('从剩余时间继续');
          const undoDisabledDuringDecision = activeUndoButton.disabled;
          const clearUndoDecisionFocused = document.activeElement === clearUndoDecision.title;
          const pausedDecisionWaitMs = 10_500;
          await delay(pausedDecisionWaitMs);
          const heldPastExpiryEvidence = await waitForStableEvidence(
            () => ({
              decisionConnected: clearUndoDecision.region.isConnected,
              undoConnected: activeUndoButton.isConnected,
              undoDisabled: activeUndoButton.disabled,
              sourceEmpty: sourceInput.value === '',
              activeElement: elementSnapshot(document.activeElement),
              title: elementSnapshot(clearUndoDecision.title),
              titleFocused: document.activeElement === clearUndoDecision.title,
              pausedStatusUnchanged: (clearUndoDecision.undoStatus.textContent || '')
                === pausedStatusText,
            }),
            (snapshot) => snapshot.decisionConnected
              && snapshot.undoConnected
              && snapshot.undoDisabled
              && snapshot.sourceEmpty
              && snapshot.titleFocused
              && snapshot.pausedStatusUnchanged,
            'held Clear Undo decision after original expiry',
          );
          const heldPastExpiry = heldPastExpiryEvidence.decisionConnected
            && heldPastExpiryEvidence.undoConnected
            && heldPastExpiryEvidence.undoDisabled
            && heldPastExpiryEvidence.sourceEmpty
            && heldPastExpiryEvidence.titleFocused
            && heldPastExpiryEvidence.pausedStatusUnchanged;
          ensure(heldPastExpiry,
            'Clear Undo or its manual replacement decision expired while the countdown was paused');

          click(clearUndoDecision.keep);
          const resumedUndoButton = await waitFor(
            () => {
              const candidate = findButton(document, '撤销清空');
              return candidate === activeUndoButton
                && !candidate.disabled
                && !document.querySelector('.clipboard-monitor-queue')
                ? candidate
                : null;
            },
            'resumed Clear Undo after Keep',
          );
          await waitForStableManualFocus(
            resumedUndoButton,
            'resumed Clear Undo focus after Keep',
          );
          const keepFocusedEnabledUndo = resumedUndoButton === activeUndoButton
            && document.activeElement === activeUndoButton
            && !activeUndoButton.disabled;
          click(resumedUndoButton);
          const restoredSource = await waitFor(
            () => sourceInput.value === replacementSnapshot
              && !document.querySelector('.session-clear-undo')
              ? sourceInput
              : null,
            'exact source restoration after paused Clear Undo',
          );
          await waitForStableManualFocus(
            restoredSource,
            'restored source focus after paused Clear Undo',
          );
          const clearUndoRestoredExactSource = sourceInput.value === replacementSnapshot;
          const clearUndoFocusedRestoredSource = document.activeElement === sourceInput;
          const clearUndoNoAutomaticProcessing = readProcessRequests() === 0
            && readCounter('demoClipboardWriteRequests') === 0
            && readCounter('demoNativeClipboardWriteStubs') === 0
            && !document.querySelector('.processing-card');
          ensure(
            pausedCopyTruthful
              && undoDisabledDuringDecision
              && clearUndoDecisionFocused
              && keepFocusedEnabledUndo
              && clearUndoRestoredExactSource
              && clearUndoFocusedRestoredSource
              && clearUndoNoAutomaticProcessing,
            'paused Clear Undo did not retain truthful ownership and exact restoration',
          );

          manualClipboardReplacement = {
            firstRead: {
              preservedExactDraft: firstReadPreservedDraft,
              decisionFocused: firstDecisionFocused,
              requestSettled: firstReadRequestSettled,
              decisionExplicit: firstDecisionExplicit,
              noAutomaticProcessing: firstDecisionNoAutoProcess,
              replaceLabel: firstDecision.replace.textContent.trim(),
              keepLabel: firstDecision.keep.textContent.trim(),
            },
            keep: {
              preservedExactDraft: keepPreservedExactDraft,
              restoredExactFocus: keepRestoredExactFocus,
              readActionEnabled: keepReadActionEnabled,
              noAutomaticProcessing: keepDidNotProcess,
            },
            secondRead: {
              preservedExactDraft: secondReadPreservedExactDraft,
              decisionFocused: secondDecisionFocused,
            },
            replace: {
              loadedClipboardPreview: replacementLoadedClipboardPreview,
              focusedSource: replacementFocusedSource,
              noticeVisible: replacementNoticeVisible,
              noticeTruthful: replacementNoticeTruthful,
              noAutomaticProcessing: noProcessingOrClipboardWrite,
            },
            clearUndoPause: {
              decisionFocused: clearUndoDecisionFocused,
              pausedCopyTruthful,
              undoDisabledDuringDecision,
              heldPastOriginalExpiry: heldPastExpiry,
              pausedDecisionWaitMs,
              keepFocusedEnabledUndo,
              restoredExactSource: clearUndoRestoredExactSource,
              focusedRestoredSource: clearUndoFocusedRestoredSource,
              noAutomaticProcessing: clearUndoNoAutomaticProcessing,
            },
            processRequests: finalProcessRequests,
            clipboardWriteRequests: readCounter('demoClipboardWriteRequests'),
            nativeClipboardWriteStubs: readCounter('demoNativeClipboardWriteStubs'),
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        }

        if (isSettingsStylesheetCollisionRun) {
          const initialDocumentUrl = window.location.href;
          const initialDocumentTimeOrigin = performance.timeOrigin;
          const readCollisionCounter = (datasetKey) => {
            const value = Number(document.documentElement.dataset[datasetKey]);
            ensure(Number.isSafeInteger(value) && value >= 0,
              'Invalid Settings stylesheet collision counter ' + datasetKey);
            return value;
          };
          const readCollisionCounters = () => ({
            processRequests: readCollisionCounter('demoProcessRequests'),
            screenshotCaptureRequests: readCollisionCounter(
              'demoScreenshotCaptureRequests',
            ),
            screenshotShortcutEvents: readCollisionCounter(
              'demoScreenshotShortcutEvents',
            ),
            settingsWrites: readCollisionCounter('demoSettingsWriteRequests'),
            credentialWrites: readCollisionCounter(
              'demoDeepseekCredentialWriteRequests',
            ),
            customPromptWrites: readCollisionCounter('demoCustomPromptWriteRequests'),
            credentialDeletes: readCollisionCounter('demoCredentialDeleteRequests'),
            providerConnectionRequests: readCollisionCounter(
              'demoProviderConnectionRequests',
            ),
            clipboardWrites: readCollisionCounter('demoClipboardWriteRequests'),
            nativeClipboardWrites: readCollisionCounter(
              'demoNativeClipboardWriteStubs',
            ),
            quitRequests: readCollisionCounter('demoQuitRequests'),
            quitDecisionRequests: readCollisionCounter('demoQuitDecisionRequests'),
            quitConfirmedDecisions: readCollisionCounter(
              'demoQuitConfirmedDecisions',
            ),
          });
          const isVisible = (element) => {
            if (!(element instanceof HTMLElement) || element.hidden) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && rect.width > 0
              && rect.height > 0;
          };
          const readGateState = async () => {
            const response = await fetch(
              '/__slipstream-fixture__/settings-stylesheet-collision/state',
              { cache: 'no-store' },
            );
            ensure(response.ok, 'Settings stylesheet collision state endpoint failed');
            return response.json();
          };
          const waitForGateState = async (ready, label, timeout = 6000) => {
            const gateDeadline = Date.now() + timeout;
            let lastState = null;
            while (Date.now() < gateDeadline) {
              lastState = await readGateState();
              if (ready(lastState)) return lastState;
              await delay(25);
            }
            throw new Error(
              'Timed out waiting for ' + label + ': ' + JSON.stringify(lastState),
            );
          };
          const readResultSignature = (resultView) => {
            ensure(resultView instanceof HTMLElement,
              'Settings collision requires the preserved Result workspace');
            const sourceClone = resultView.querySelector('.source-paper')?.cloneNode(true);
            sourceClone?.querySelectorAll('.source-evidence__number')
              .forEach((number) => number.remove());
            const signature = {
              headline: resultView.querySelector('#result-headline')?.textContent?.trim() || '',
              source: sourceClone?.textContent?.trim() || '',
              actionCount: resultView.querySelectorAll(
                '.action-group input[type="checkbox"]',
              ).length,
            };
            ensure(
              signature.headline.includes('收到邮件后一天内')
                && signature.headline.includes('eVisa share code')
                && signature.source.startsWith('Dear Student,')
                && signature.source.endsWith('University Services')
                && signature.actionCount === 4,
              'Settings collision did not start from the deterministic sample Result',
            );
            return JSON.stringify(signature);
          };
          const readQuitIsolation = (layer) => {
            const root = layer?.closest('.app-root');
            const background = root
              ? [...root.children].filter((node) => node !== layer)
              : [];
            return {
              backgroundCount: background.length,
              allInert: background.length > 0
                && background.every((node) => node.inert === true),
              allAriaHidden: background.length > 0
                && background.every((node) => node.getAttribute('aria-hidden') === 'true'),
            };
          };
          const initialResult = await waitFor(
            () => {
              const candidate = document.querySelector('.result-view');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'initial Result before Settings stylesheet collision',
          );
          const initialResultSignature = readResultSignature(initialResult);
          const initialCounters = readCollisionCounters();
          ensure(
            Object.values(initialCounters).every((value) => value === 0),
            'Settings stylesheet collision started with App side effects: '
              + JSON.stringify(initialCounters),
          );
          ensure(
            trustedInputBridge && typeof trustedInputBridge.keyPress === 'function',
            'Settings stylesheet collision trusted input bridge is unavailable',
          );

          const armResponse = await fetch(
            '/__slipstream-fixture__/settings-stylesheet-collision/arm',
            { cache: 'no-store' },
          );
          ensure(armResponse.status === 204,
            'Settings stylesheet collision gate was not armed exactly once');
          const armedGateState = await waitForGateState(
            (state) => state.armCount === 1 && state.armed === true && state.held === false,
            'armed Settings stylesheet collision gate',
          );
          const settingsTrigger = initialResult.closest('.slipstream-shell')
            ?.querySelector('[aria-label="打开设置"]');
          ensure(settingsTrigger instanceof HTMLButtonElement && !settingsTrigger.disabled,
            'Settings collision could not find the enabled Settings trigger');
          click(settingsTrigger);

          const loadingMain = await waitFor(
            () => document.getElementById('settings-workspace-loading-title')?.closest('main'),
            'Settings loading main before the stylesheet collision',
          );
          const loadingFocus = await waitForStableEvidence(
            () => ({
              main: elementSnapshot(loadingMain),
              activeElement: elementSnapshot(document.activeElement),
              focused: document.activeElement === loadingMain,
              ariaBusy: loadingMain.getAttribute('aria-busy'),
              visible: isVisible(loadingMain),
            }),
            (evidence) => evidence.main?.connected === true
              && evidence.focused
              && evidence.ariaBusy === 'true'
              && evidence.visible,
            'Settings loading focus before App Quit',
          );
          const heldGateState = await waitForGateState(
            (state) => state.armCount === 1
              && state.heldCount === 1
              && state.armed === true
              && state.held === true,
            'held Settings stylesheet response',
          );

          let observedQuitEscape = null;
          const observeQuitEscape = (event) => {
            const layer = document.querySelector('[data-app-top-layer="quit"]');
            const activeTarget = document.activeElement;
            if (
              event.key !== 'Escape'
              || !(layer instanceof HTMLElement)
              || !(activeTarget instanceof HTMLElement)
              || !layer.contains(activeTarget)
            ) return;
            observedQuitEscape = {
              isTrusted: event.isTrusted,
              key: event.key,
              activeTargetOwned: true,
              eventTargetOwned: event.target === activeTarget
                || activeTarget.contains(event.target),
              activeTarget: elementSnapshot(activeTarget),
            };
          };
          // Register before AppQuit mounts so this observer precedes the dialog's
          // LIFO stopImmediatePropagation handler without weakening that handler.
          window.addEventListener('keydown', observeQuitEscape, true);
          window.dispatchEvent(new Event('slipstream:fixture-quit-request'));
          const quitLayer = await waitFor(
            () => document.querySelector('[data-app-top-layer="quit"]'),
            'App Quit over Settings loading',
          );
          const quitDialog = quitLayer.querySelector('[role="alertdialog"]');
          const quitSafe = quitLayer.querySelector('[data-quit-safe]');
          ensure(
            quitDialog instanceof HTMLElement
              && quitSafe instanceof HTMLButtonElement
              && quitDialog.getAttribute('aria-modal') === 'true',
            'App Quit did not expose its modal alertdialog contract',
          );
          const quitLoadingFocus = await waitForStableEvidence(
            () => ({
              activeElement: elementSnapshot(document.activeElement),
              safe: elementSnapshot(quitSafe),
              exactSafeFocus: document.activeElement === quitSafe,
              topLayerCount: document.querySelectorAll(
                '[data-app-top-layer="quit"]',
              ).length,
              loadingConnected: loadingMain.isConnected,
              loadingVisible: isVisible(loadingMain),
              isolation: readQuitIsolation(quitLayer),
            }),
            (evidence) => evidence.exactSafeFocus
              && evidence.topLayerCount === 1
              && evidence.loadingConnected
              && evidence.loadingVisible
              && evidence.isolation.allInert
              && evidence.isolation.allAriaHidden,
            'App Quit ownership over Settings loading',
          );
          const quitText = quitDialog.textContent || '';
          ensure(
            quitText.includes('退出会丢失当前结果')
              && quitText.includes('当前结果与对应原文只保留在这次会话中'),
            'App Quit did not describe the preserved Result consequence',
          );
          const quitCountersBeforeFailure = readCollisionCounters();
          ensure(
            quitCountersBeforeFailure.quitRequests === 1
              && quitCountersBeforeFailure.quitDecisionRequests === 0
              && quitCountersBeforeFailure.quitConfirmedDecisions === 0,
            'App Quit did not wait for an explicit decision over Settings loading',
          );

          const releaseResponse = await fetch(
            '/__slipstream-fixture__/settings-stylesheet-collision/release',
            { cache: 'no-store' },
          );
          ensure(releaseResponse.status === 204,
            'Settings stylesheet collision response was not manually released');
          const settingsFailure = await waitFor(
            () => document.querySelector('[data-workspace-load-failure="settings"]'),
            'Settings stylesheet failure under App Quit',
          );
          const failureRetry = settingsFailure.querySelector('[data-workspace-retry="settings"]');
          ensure(failureRetry instanceof HTMLButtonElement && !failureRetry.disabled,
            'Settings stylesheet failure did not retain an enabled Retry action');
          const failureUnderQuit = await waitForStableEvidence(
            () => ({
              activeElement: elementSnapshot(document.activeElement),
              exactSafeFocus: document.activeElement === quitSafe,
              safeConnected: quitSafe.isConnected,
              loadingConnected: loadingMain.isConnected,
              failureConnected: settingsFailure.isConnected,
              failureVisible: isVisible(settingsFailure),
              retryConnected: failureRetry.isConnected,
              retryVisible: isVisible(failureRetry),
              retryEnabled: !failureRetry.disabled,
              retryInert: Boolean(failureRetry.closest('[inert]')),
              retryFocused: document.activeElement === failureRetry,
              topLayerCount: document.querySelectorAll(
                '[data-app-top-layer="quit"]',
              ).length,
              isolation: readQuitIsolation(quitLayer),
            }),
            (evidence) => evidence.exactSafeFocus
              && evidence.safeConnected
              && !evidence.loadingConnected
              && evidence.failureConnected
              && evidence.failureVisible
              && evidence.retryConnected
              && evidence.retryVisible
              && evidence.retryEnabled
              && evidence.retryInert
              && !evidence.retryFocused
              && evidence.topLayerCount === 1
              && evidence.isolation.allInert
              && evidence.isolation.allAriaHidden,
            'App Quit ownership after Settings loading became failure',
          );
          const preservedResultDuringFailure = document.querySelector('.result-view');
          ensure(
            preservedResultDuringFailure instanceof HTMLElement
              && !isVisible(preservedResultDuringFailure)
              && readResultSignature(preservedResultDuringFailure)
                === initialResultSignature
              && !document.querySelector('.settings-panel'),
            'Settings failure did not preserve the exact hidden Result or exposed unstyled Settings',
          );

          const escapePoint = targetCenterHit(quitSafe, 'App Quit safe action');
          const escapeResponse = await trustedInputBridge.keyPress(1, 'Escape');
          await waitFor(
            () => observedQuitEscape,
            'trusted App Quit Escape observation',
          );
          ensure(
            escapeResponse?.accepted === true
              && escapeResponse.kind === 'key'
              && escapeResponse.step === 1
              && escapeResponse.complete === true
              && observedQuitEscape.isTrusted === true
              && observedQuitEscape.key === 'Escape'
              && observedQuitEscape.activeTargetOwned === true
              && observedQuitEscape.eventTargetOwned === true,
            'Native Escape was not trusted and owned by App Quit',
          );
          const quitEscapeEvidence = {
            label: 'App Quit over Settings stylesheet failure',
            step: 1,
            point: escapePoint,
            ...observedQuitEscape,
          };
          trustedInputEvidence.keyboard.push(quitEscapeEvidence);
          trustedInputEvidence.escape = quitEscapeEvidence;
          window.removeEventListener('keydown', observeQuitEscape, true);
          await waitFor(
            () => !document.querySelector('[data-app-top-layer="quit"]'),
            'App Quit dismissal over Settings stylesheet failure',
          );
          const recoveryFocus = await waitForStableEvidence(
            () => readFocusedControlEvidence(
              failureRetry,
              failureRetry,
              settingsFailure,
              'Settings Retry after cancelling App Quit',
            ),
            (evidence) => focusedControlGeometryReady(evidence)
              && evidence.focused
              && evidence.focusVisible
              && evidence.ringRendered
              && evidence.ringVisible,
            'natural Settings Retry reveal after cancelling App Quit',
          );
          const backgroundRestored = [...document.querySelector('.app-root').children]
            .every((node) => node.inert !== true && node.getAttribute('aria-hidden') !== 'true');
          const quitCountersAfterCancel = readCollisionCounters();
          ensure(
            backgroundRestored
              && document.activeElement === failureRetry
              && recoveryFocus.focusVisible
              && recoveryFocus.ringRendered
              && recoveryFocus.ringVisible
              && quitCountersAfterCancel.quitRequests === 1
              && quitCountersAfterCancel.quitDecisionRequests === 1
              && quitCountersAfterCancel.quitConfirmedDecisions === 0,
            'Cancelling App Quit did not restore exact visible Settings Retry focus',
          );

          const countersBeforeCapture = readCollisionCounters();
          ensure(
            countersBeforeCapture.screenshotShortcutEvents === 0
              && countersBeforeCapture.screenshotCaptureRequests === 0
              && countersBeforeCapture.processRequests === 0,
            'Retry or App Quit unexpectedly started capture before the shortcut',
          );

          window.dispatchEvent(new Event('slipstream:fixture-quit-request'));
          const captureQuitLayer = await waitFor(
            () => document.querySelector('[data-app-top-layer="quit"]'),
            'App Quit before queued Settings screenshot',
          );
          const captureQuitSafe = captureQuitLayer.querySelector('[data-quit-safe]');
          await waitFor(
            () => document.activeElement === captureQuitSafe,
            'App Quit safe focus before queued Settings screenshot',
          );
          window.dispatchEvent(new Event('slipstream:fixture-screenshot-request'));
          const queuedCaptureUnderQuit = await waitForStableEvidence(
            () => {
              const counters = readCollisionCounters();
              return {
                activeElement: elementSnapshot(document.activeElement),
                exactSafeFocus: document.activeElement === captureQuitSafe,
                topLayerCount: document.querySelectorAll(
                  '[data-app-top-layer="quit"]',
                ).length,
                failureConnected: settingsFailure.isConnected,
                failureVisible: isVisible(settingsFailure),
                retryInert: Boolean(failureRetry.closest('[inert]')),
                counters,
              };
            },
            (evidence) => evidence.exactSafeFocus
              && evidence.topLayerCount === 1
              && evidence.failureConnected
              && evidence.failureVisible
              && evidence.retryInert
              && evidence.counters.screenshotShortcutEvents === 1
              && evidence.counters.screenshotCaptureRequests === 0
              && evidence.counters.processRequests === 0
              && evidence.counters.quitRequests === 2
              && evidence.counters.quitDecisionRequests === 1,
            'queued screenshot held below App Quit',
          );
          click(captureQuitSafe);
          await waitFor(
            () => !document.querySelector('[data-app-top-layer="quit"]'),
            'second App Quit cancellation before screenshot takeover',
          );
          const captureTakeoverStarted = await waitFor(
            () => {
              const counters = readCollisionCounters();
              const failureRemoved = !document.querySelector(
                '[data-workspace-load-failure="settings"]',
              );
              return counters.screenshotShortcutEvents === 1
                && counters.screenshotCaptureRequests === 1
                && counters.processRequests === 1
                && failureRemoved
                ? { counters, failureRemoved }
                : null;
            },
            'single screenshot takeover after cancelling App Quit',
          );
          const capturedResult = await waitFor(
            () => {
              const candidate = document.querySelector('.result-view');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'completed Result after Settings screenshot takeover',
          );
          await waitForStableEvidence(
            () => ({
              result: elementSnapshot(capturedResult),
              visible: isVisible(capturedResult),
              counters: readCollisionCounters(),
            }),
            (evidence) => evidence.result?.connected === true
              && evidence.visible
              && evidence.counters.screenshotShortcutEvents === 1
              && evidence.counters.screenshotCaptureRequests === 1
              && evidence.counters.processRequests === 1,
            'settled screenshot takeover Result',
          );

          const reopenedSettingsTrigger = capturedResult.closest('.slipstream-shell')
            ?.querySelector('[aria-label="打开设置"]');
          ensure(
            reopenedSettingsTrigger instanceof HTMLButtonElement
              && !reopenedSettingsTrigger.disabled,
            'Screenshot Result did not expose Settings for the no-replay check',
          );
          click(reopenedSettingsTrigger);
          const reopenedFailure = await waitFor(
            () => document.querySelector('[data-workspace-load-failure="settings"]'),
            'reopened Settings stylesheet failure',
          );
          const reopenedRetry = reopenedFailure.querySelector(
            '[data-workspace-retry="settings"]',
          );
          await waitFor(
            () => document.activeElement === reopenedRetry,
            'reopened Settings Retry exact focus',
          );
          const countersBeforeRetry = readCollisionCounters();
          click(reopenedRetry);
          const settingsPanel = await waitFor(
            () => {
              const candidate = document.querySelector('.settings-panel');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'retried Settings after screenshot takeover',
          );
          const settingsReturn = await waitFor(
            () => {
              const candidate = settingsPanel.querySelector('[data-quit-return-focus]');
              return candidate && document.activeElement === candidate ? candidate : null;
            },
            'retried Settings exact return focus after screenshot takeover',
          );
          const settingsReturnFocus = await focusedControlEvidence(
            settingsReturn,
            settingsPanel,
            'retried Settings return after screenshot takeover',
            { focusTarget: false },
          );
          await delay(350);
          const countersAfterRetry = readCollisionCounters();
          const settingsStayedVisibleAfterRetry = isVisible(settingsPanel);
          ensure(
            countersAfterRetry.screenshotShortcutEvents
                === countersBeforeRetry.screenshotShortcutEvents
              && countersAfterRetry.screenshotCaptureRequests
                === countersBeforeRetry.screenshotCaptureRequests
              && countersAfterRetry.processRequests === countersBeforeRetry.processRequests
              && countersAfterRetry.screenshotShortcutEvents === 1
              && countersAfterRetry.screenshotCaptureRequests === 1
              && countersAfterRetry.processRequests === 1
              && settingsStayedVisibleAfterRetry,
            'Retrying Settings replayed the settled screenshot request',
          );
          const settingsStylesheetLinks = [...document.querySelectorAll(
            'link[data-workspace-stylesheet="settings"]',
          )];
          const activeSettingsStylesheet = settingsStylesheetLinks[0];
          let privateSettingsRuleLoaded = false;
          try {
            privateSettingsRuleLoaded = activeSettingsStylesheet?.sheet
              ? [...activeSettingsStylesheet.sheet.cssRules].some((rule) => (
                rule.cssText.includes('.settings-panel__header')
              ))
              : false;
          } catch {
            privateSettingsRuleLoaded = false;
          }
          ensure(
            settingsStylesheetLinks.length === 1
              && activeSettingsStylesheet.dataset.workspaceLoaded === 'true'
              && activeSettingsStylesheet.dataset.workspaceAttempt === '1'
              && privateSettingsRuleLoaded,
            'Settings retry did not restore one parsed private stylesheet',
          );
          click(settingsReturn);
          const finalResult = await waitFor(
            () => {
              const candidate = document.querySelector('.result-view');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'Result after leaving retried Settings',
          );

          const finalSettingsTrigger = finalResult.closest('.slipstream-shell')
            ?.querySelector('[aria-label="打开设置"]');
          ensure(
            finalSettingsTrigger instanceof HTMLButtonElement
              && !finalSettingsTrigger.disabled,
            'Final Result did not expose Settings for confirmed-quit capture dropping',
          );
          click(finalSettingsTrigger);
          const finalSettingsPanel = await waitFor(
            () => {
              const candidate = document.querySelector('.settings-panel');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'loaded Settings before confirmed-quit capture dropping',
          );
          window.dispatchEvent(new Event('slipstream:fixture-quit-request'));
          const confirmedQuitLayer = await waitFor(
            () => document.querySelector('[data-app-top-layer="quit"]'),
            'App Quit before confirmed capture dropping',
          );
          const confirmedQuitSafe = confirmedQuitLayer.querySelector('[data-quit-safe]');
          const confirmedQuitAction = confirmedQuitLayer.querySelector(
            '.app-quit-dialog__confirm',
          );
          await waitFor(
            () => document.activeElement === confirmedQuitSafe,
            'App Quit safe focus before confirmed capture dropping',
          );
          window.dispatchEvent(new Event('slipstream:fixture-screenshot-request'));
          const queuedCaptureBeforeConfirm = await waitForStableEvidence(
            () => ({
              exactSafeFocus: document.activeElement === confirmedQuitSafe,
              settingsConnected: finalSettingsPanel.isConnected,
              settingsVisible: isVisible(finalSettingsPanel),
              settingsInert: Boolean(finalSettingsPanel.closest('[inert]')),
              counters: readCollisionCounters(),
            }),
            (evidence) => evidence.exactSafeFocus
              && evidence.settingsConnected
              && evidence.settingsVisible
              && evidence.settingsInert
              && evidence.counters.screenshotShortcutEvents === 2
              && evidence.counters.screenshotCaptureRequests === 1
              && evidence.counters.processRequests === 1
              && evidence.counters.quitRequests === 3
              && evidence.counters.quitDecisionRequests === 2,
            'second queued screenshot held before confirmed Quit',
          );
          ensure(
            confirmedQuitAction instanceof HTMLButtonElement
              && !confirmedQuitAction.disabled,
            'Confirmed Quit action was unavailable for pending capture dropping',
          );
          click(confirmedQuitAction);
          await waitFor(
            () => !document.querySelector('[data-app-top-layer="quit"]'),
            'confirmed App Quit settlement',
          );
          const quitPreviewNotice = await waitFor(
            () => {
              const candidate = document.querySelector('.app-quit-preview-notice');
              return candidate?.textContent?.includes('真实应用此时会按上述说明安全退出')
                ? candidate
                : null;
            },
            'confirmed App Quit preview consequence',
          );
          await delay(350);
          const finalCounters = readCollisionCounters();
          const confirmedCaptureDrop = {
            queued: queuedCaptureBeforeConfirm,
            previewNoticeVisible: isVisible(quitPreviewNotice),
            captureDidNotStart: finalCounters.screenshotCaptureRequests === 1
              && finalCounters.processRequests === 1,
            counters: finalCounters,
          };
          const finalGateState = await waitForGateState(
            (state) => state.armCount === 1
              && state.heldCount === 1
              && state.manualReleaseCount === 1
              && state.watchdogReleaseCount === 0
              && state.failureCount === 1
              && state.armed === false
              && state.held === false,
            'settled Settings stylesheet collision gate',
          );
          const navigationEntries = performance.getEntriesByType('navigation');
          const externalResourceEntries = performance.getEntriesByType('resource')
            .filter((entry) => {
              try {
                const resourceUrl = new URL(entry.name, window.location.href);
                return !['data:', 'blob:'].includes(resourceUrl.protocol)
                  && resourceUrl.origin !== window.location.origin;
              } catch {
                return true;
              }
            });
          const sameDocument = window.location.href === initialDocumentUrl
            && performance.timeOrigin === initialDocumentTimeOrigin;
          const noReload = navigationEntries.length === 1
            && navigationEntries[0].type === 'navigate'
            && sameDocument;
          ensure(
            finalResult
              && finalCounters.processRequests === 1
              && finalCounters.screenshotCaptureRequests === 1
              && finalCounters.screenshotShortcutEvents === 2
              && finalCounters.quitRequests === 3
              && finalCounters.quitDecisionRequests === 3
              && finalCounters.quitConfirmedDecisions === 1
              && finalCounters.settingsWrites === 0
              && finalCounters.credentialWrites === 0
              && finalCounters.customPromptWrites === 0
              && finalCounters.credentialDeletes === 0
              && finalCounters.providerConnectionRequests === 0
              && finalCounters.clipboardWrites === 0
              && finalCounters.nativeClipboardWrites === 0,
            'Settings stylesheet collision produced duplicate or unrelated side effects: '
              + JSON.stringify(finalCounters),
          );
          ensure(noReload && externalResourceEntries.length === 0,
            'Settings stylesheet collision navigated or requested an external resource');
          ensure(
            nativeKeyboardModalityPrimed
              && window.innerWidth === 200
              && window.innerHeight === 200,
            'Settings stylesheet collision did not retain its exact 200x200 CSS viewport',
          );

          settingsStylesheetCollision = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            loading: {
              focus: loadingFocus,
              gate: armedGateState,
              heldGate: heldGateState,
            },
            quitOverLoading: {
              focus: quitLoadingFocus,
              role: quitDialog.getAttribute('role'),
              ariaModal: quitDialog.getAttribute('aria-modal'),
              truthfulResultConsequence: true,
              counters: quitCountersBeforeFailure,
            },
            failureUnderQuit: {
              ...failureUnderQuit,
              preservedResultUnchanged: true,
              unstyledSettingsHidden: true,
            },
            quitCancel: {
              trustedEscape: quitEscapeEvidence,
              backgroundRestored,
              retryFocus: recoveryFocus,
              counters: quitCountersAfterCancel,
            },
            captureTakeover: {
              queuedUnderQuit: queuedCaptureUnderQuit,
              ...captureTakeoverStarted,
              completedResult: Boolean(capturedResult),
            },
            retryNoReplay: {
              countersBeforeRetry,
              countersAfterRetry,
              settingsStayedVisible: settingsStayedVisibleAfterRetry,
              settingsReturnFocus,
              privateStylesheetLoaded: privateSettingsRuleLoaded,
              stylesheetLinkCount: settingsStylesheetLinks.length,
            },
            confirmedCaptureDrop,
            gate: finalGateState,
            counters: finalCounters,
            navigation: {
              sameDocument,
              urlUnchanged: window.location.href === initialDocumentUrl,
              timeOriginUnchanged: performance.timeOrigin === initialDocumentTimeOrigin,
              noReload,
              entryCount: navigationEntries.length,
              type: navigationEntries[0]?.type || '',
            },
            externalResourceRequestCount: externalResourceEntries.length,
            trustedInput: trustedInputEvidence,
          };
        }

        if (isWorkspaceRecoveryRun) {
          const initialDocumentUrl = window.location.href;
          const initialDocumentTimeOrigin = performance.timeOrigin;
          const readWorkspaceCounter = (datasetKey) => {
            const value = Number(document.documentElement.dataset[datasetKey]);
            ensure(Number.isSafeInteger(value) && value >= 0,
              'Invalid workspace recovery counter ' + datasetKey);
            return value;
          };
          const isVisible = (element) => {
            if (!(element instanceof HTMLElement) || element.hidden) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && rect.width > 0
              && rect.height > 0;
          };
          const accessibleName = (element) => {
            const directLabel = element.getAttribute('aria-label')?.trim() || '';
            if (directLabel) return directLabel;
            return (element.getAttribute('aria-labelledby') || '')
              .split(/\\s+/u)
              .filter(Boolean)
              .map((id) => document.getElementById(id)?.textContent?.trim() || '')
              .filter(Boolean)
              .join(' ');
          };
          const readVisibleMain = () => [...document.querySelectorAll('main')]
            .filter(isVisible);
          const readProductFocusEvidence = async (target, scrollport, label) => {
            ensure(target instanceof HTMLElement, 'Missing product focus target for ' + label);
            ensure(scrollport instanceof HTMLElement,
              'Missing product focus scrollport for ' + label);
            const alignment = alignTargetInScrollport(target, scrollport);
            return waitForStableEvidence(
              () => ({
                ...readFocusedControlEvidence(target, target, scrollport, label),
                alignment,
              }),
              (evidence) => focusedControlGeometryReady(evidence)
                && evidence.focused
                && (!isResultStylesheetRecoveryRun || (
                  evidence.focusVisible
                  && evidence.ringRendered
                  && evidence.ringVisible
                )),
              label,
            );
          };
          const readFailureEvidence = async (workspace) => {
            const failure = await waitFor(
              () => document.querySelector(
                '[data-workspace-load-failure="' + workspace + '"]',
              ),
              workspace + ' workspace load failure',
            );
            await waitFor(
              () => failure.contains(document.activeElement),
              workspace + ' workspace recovery focus',
            );
            const visibleMains = readVisibleMain();
            const main = visibleMains[0];
            const visibleAlerts = [...document.querySelectorAll('[role="alert"]')]
              .filter(isVisible);
            const retryAction = failure.querySelector('[data-workspace-retry]');
            const returnAction = failure.querySelector('[data-workspace-return]');
            const name = main ? accessibleName(main) : '';
            ensure(visibleMains.length === 1,
              workspace + ' failure must expose exactly one visible main landmark');
            ensure(main === failure || main.contains(failure),
              workspace + ' failure marker must be owned by its main landmark');
            ensure(main.getAttribute('role') !== 'alert' && name.length > 0,
              workspace + ' failure main must retain its named main semantics');
            ensure(
              visibleAlerts.length === 1
                && visibleAlerts[0] !== main
                && main.contains(visibleAlerts[0]),
              workspace + ' failure must expose one alert inside the named main',
            );
            ensure(
              retryAction instanceof HTMLButtonElement
                && !retryAction.disabled
                && isVisible(retryAction),
              workspace + ' failure retry action must be visible and enabled',
            );
            ensure(document.activeElement === retryAction,
              workspace + ' failure must focus its exact retry action');
            const retryFocusEvidence = await readProductFocusEvidence(
              retryAction,
              failure,
              workspace + ' workspace retry focus',
            );
            return {
              mainCount: visibleMains.length,
              mainNamed: name.length > 0,
              mainRolePreserved: main.getAttribute('role') !== 'alert',
              alertCount: visibleAlerts.length,
              alertWithinMain: main.contains(visibleAlerts[0]),
              focusOwned: failure.contains(document.activeElement),
              exactRetryFocus: document.activeElement === retryAction,
              focusTargetIsBody: document.activeElement === document.body,
              focusTargetTag: document.activeElement?.tagName?.toLowerCase() || '',
              retryFocusEvidence,
              retryActionVisible: isVisible(retryAction),
              retryActionEnabled: !retryAction.disabled,
              returnActionVisible: isVisible(returnAction),
              returnActionEnabled: returnAction instanceof HTMLButtonElement
                && !returnAction.disabled,
            };
          };
          const readResultSignature = (resultView, { requireVisible = true } = {}) => {
            ensure(
              resultView instanceof HTMLElement
                && (!requireVisible || isVisible(resultView)),
              'Result signature requires the expected result main',
            );
            const headline = resultView.querySelector('#result-headline')?.textContent?.trim() || '';
            const sourceClone = resultView.querySelector('.source-paper')?.cloneNode(true);
            sourceClone?.querySelectorAll('.source-evidence__number')
              .forEach((number) => number.remove());
            const source = sourceClone?.textContent?.trim() || '';
            const actionToggles = [...resultView.querySelectorAll(
              '.action-group input[type="checkbox"]',
            )];
            ensure(
              headline.includes('收到邮件后一天内')
                && headline.includes('eVisa share code')
                && source.startsWith('Dear Student,')
                && source.endsWith('University Services')
                && actionToggles.length === 4,
              'Lazy recovery did not restore the deterministic sample result',
            );
            return JSON.stringify({
              headline,
              source,
              actionCompletion: actionToggles.map((toggle) => toggle.checked),
            });
          };
          const readNamedMainEvidence = (main, label) => {
            ensure(main instanceof HTMLElement && isVisible(main),
              'Missing visible ' + label + ' main');
            const visibleMains = readVisibleMain();
            const name = accessibleName(main);
            ensure(visibleMains.length === 1 && visibleMains[0] === main,
              label + ' must be the only visible main landmark');
            ensure(name.length > 0, label + ' main must have an accessible name');
            return {
              mainCount: visibleMains.length,
              mainNamed: name.length > 0,
              focusOwned: main.contains(document.activeElement),
              focusTargetIsBody: document.activeElement === document.body,
            };
          };

          const resultFailure = await readFailureEvidence('result');
          const resultRetry = document.querySelector(
            '[data-workspace-load-failure="result"] [data-workspace-retry]',
          );
          click(resultRetry);
          const recoveredResult = await waitFor(
            () => {
              const candidate = document.querySelector('.result-view');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'retried result workspace',
          );
          await waitFor(
            () => !document.querySelector('[data-workspace-load-failure="result"]'),
            'result workspace failure dismissal',
          );
          await waitFor(
            () => {
              const headline = recoveredResult.querySelector('#result-headline');
              return headline && document.activeElement === headline ? headline : null;
            },
            'retried result workspace exact headline focus',
          );
          const recoveredResultHeadline = recoveredResult.querySelector('#result-headline');
          const recoveredResultFocusEvidence = await readProductFocusEvidence(
            recoveredResultHeadline,
            recoveredResult,
            'retried result workspace headline focus',
          );
          const recoveredResultMain = readNamedMainEvidence(
            recoveredResult,
            'retried result workspace',
          );
          const resultSignature = readResultSignature(recoveredResult);
          const processRequestsAfterResultRetry = readWorkspaceCounter('demoProcessRequests');
          ensure(processRequestsAfterResultRetry === 0,
            'Retrying the Result workspace must not repeat analysis');
          const resultStylesheetLinks = [...document.querySelectorAll(
            'link[data-workspace-stylesheet="result"]',
          )];
          const activeResultStylesheet = resultStylesheetLinks[0];
          const dedicatedResultRuleLoaded = activeResultStylesheet?.sheet
            ? [...activeResultStylesheet.sheet.cssRules].some((rule) => (
              rule.cssText.includes('.reply-status-picker')
            ))
            : false;
          ensure(
            resultStylesheetLinks.length === 1
              && activeResultStylesheet.dataset.workspaceLoaded === 'true'
              && activeResultStylesheet.dataset.workspaceAttempt === '1'
              && dedicatedResultRuleLoaded,
            'Recovered Result must own exactly one parsed retry stylesheet',
          );
          const resultStylesheetRequests = performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((resourceName) => {
              try {
                return new URL(resourceName, window.location.href).pathname
                  .endsWith('/components/ResultDisplay.css');
              } catch {
                return false;
              }
            });
          if (isResultStylesheetRecoveryRun) {
            const stylesheetRequestUrls = resultStylesheetRequests.map((name) => new URL(name));
            const primaryStylesheetRequest = stylesheetRequestUrls.find((url) => (
              url.searchParams.get('workspace-load') === 'result-style-fixture-primary'
              && !url.searchParams.has('workspace-attempt')
            ));
            const retryStylesheetRequest = stylesheetRequestUrls.find((url) => (
              url.searchParams.get('workspace-attempt') === '1'
            ));
            ensure(
              primaryStylesheetRequest
                && retryStylesheetRequest
                && primaryStylesheetRequest.pathname === retryStylesheetRequest.pathname,
              'Result stylesheet recovery must use the ordinary primary and one queried retry URL',
            );
          }

          let unstyledSettingsFrameObserved = false;
          const settingsPresentationReady = () => {
            const links = [...document.querySelectorAll(
              'link[data-workspace-stylesheet="settings"]',
            )];
            const activeLink = links[0];
            let privateRuleLoaded = false;
            try {
              privateRuleLoaded = activeLink?.sheet
                ? [...activeLink.sheet.cssRules].some((rule) => (
                  rule.cssText.includes('.settings-panel__header')
                ))
                : false;
            } catch {
              privateRuleLoaded = false;
            }
            return links.length === 1
              && activeLink.dataset.workspaceLoaded === 'true'
              && privateRuleLoaded;
          };
          const observeSettingsPresentation = () => {
            const candidate = document.querySelector('.settings-panel');
            if (candidate instanceof HTMLElement
              && isVisible(candidate)
              && !settingsPresentationReady()) {
              unstyledSettingsFrameObserved = true;
            }
          };
          const settingsPresentationObserver = new MutationObserver(observeSettingsPresentation);
          settingsPresentationObserver.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          const settingsTrigger = recoveredResult.closest('.slipstream-shell')
            ?.querySelector('[aria-label="打开设置"]');
          ensure(settingsTrigger instanceof HTMLButtonElement && !settingsTrigger.disabled,
            'Recovered result did not expose the Settings trigger');
          click(settingsTrigger);
          const settingsFailure = await readFailureEvidence('settings');
          ensure(settingsFailure.returnActionVisible && settingsFailure.returnActionEnabled,
            'Settings failure must offer a safe return to the preserved result');
          const preservedResultDuringFailure = document.querySelector('.result-view');
          ensure(
            preservedResultDuringFailure instanceof HTMLElement
              && !isVisible(preservedResultDuringFailure),
            'Settings failure must retain the hidden result workspace',
          );
          const preservedResultSignature = readResultSignature(
            preservedResultDuringFailure,
            { requireVisible: false },
          );
          ensure(preservedResultSignature === resultSignature,
            'Settings load failure changed the preserved result');
          ensure(!document.querySelector('.settings-panel'),
            'Settings stylesheet failure exposed an unstyled Settings workspace');

          const settingsRetry = document.querySelector(
            '[data-workspace-load-failure="settings"] [data-workspace-retry]',
          );
          click(settingsRetry);
          const settingsMain = await waitFor(
            () => {
              const candidate = document.querySelector('.settings-panel');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'retried Settings workspace',
          );
          await waitFor(
            () => !document.querySelector('[data-workspace-load-failure="settings"]'),
            'Settings workspace failure dismissal',
          );
          await waitFor(
            () => {
              const returnButton = settingsMain.querySelector('[data-quit-return-focus]');
              return returnButton && document.activeElement === returnButton
                ? returnButton
                : null;
            },
            'retried Settings workspace exact return focus',
          );
          observeSettingsPresentation();
          settingsPresentationObserver.disconnect();
          ensure(!unstyledSettingsFrameObserved,
            'Settings workspace mounted before its private stylesheet was parsed');
          const settingsStylesheetLinks = [...document.querySelectorAll(
            'link[data-workspace-stylesheet="settings"]',
          )];
          const activeSettingsStylesheet = settingsStylesheetLinks[0];
          const privateSettingsRuleLoaded = activeSettingsStylesheet?.sheet
            ? [...activeSettingsStylesheet.sheet.cssRules].some((rule) => (
              rule.cssText.includes('.settings-panel__header')
            ))
            : false;
          ensure(
            settingsStylesheetLinks.length === 1
              && activeSettingsStylesheet.dataset.workspaceLoaded === 'true'
              && activeSettingsStylesheet.dataset.workspaceAttempt === '1'
              && privateSettingsRuleLoaded,
            'Recovered Settings must own exactly one parsed retry stylesheet',
          );
          const settingsStylesheetRequests = performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((resourceName) => {
              try {
                return new URL(resourceName, window.location.href).pathname
                  .endsWith('/components/SettingsPanel.css');
              } catch {
                return false;
              }
            });
          const settingsStylesheetRequestUrls = settingsStylesheetRequests
            .map((name) => new URL(name));
          const settingsPrimaryStylesheetRequests = settingsStylesheetRequestUrls.filter((url) => (
            url.searchParams.get('workspace-load') === 'settings-style-fixture-primary'
            && !url.searchParams.has('workspace-attempt')
          ));
          const settingsRetryStylesheetRequests = settingsStylesheetRequestUrls.filter((url) => (
            url.searchParams.get('workspace-attempt') === '1'
          ));
          if (isResultStylesheetRecoveryRun) {
            ensure(
              settingsPrimaryStylesheetRequests.length === 1
                && settingsRetryStylesheetRequests.length === 1
                && settingsPrimaryStylesheetRequests[0].pathname
                  === settingsRetryStylesheetRequests[0].pathname,
              'Settings stylesheet recovery must use one ordinary primary and one queried retry URL',
            );
          }
          const settingsReturn = settingsMain.querySelector('[data-quit-return-focus]');
          const recoveredSettingsFocusEvidence = await readProductFocusEvidence(
            settingsReturn,
            settingsMain,
            'retried Settings workspace return focus',
          );
          const recoveredSettingsMain = readNamedMainEvidence(
            settingsMain,
            'retried Settings workspace',
          );
          const settingsWriteRequests = readWorkspaceCounter('demoSettingsWriteRequests');
          ensure(settingsWriteRequests === 0,
            'Retrying the Settings workspace must not write settings');
          ensure(settingsReturn instanceof HTMLButtonElement && !settingsReturn.disabled,
            'Recovered Settings workspace did not expose its return action');
          click(settingsReturn);
          const returnedResult = await waitFor(
            () => {
              const candidate = document.querySelector('.result-view');
              return candidate && isVisible(candidate) ? candidate : null;
            },
            'preserved result after leaving Settings',
          );
          const returnedResultHeadline = await waitFor(
            () => {
              const headline = returnedResult.querySelector('#result-headline');
              return headline && document.activeElement === headline ? headline : null;
            },
            'returned result workspace exact headline focus',
          );
          const returnedResultFocusEvidence = await readProductFocusEvidence(
            returnedResultHeadline,
            returnedResult,
            'returned result workspace headline focus',
          );
          const returnedResultMain = readNamedMainEvidence(
            returnedResult,
            'returned result workspace',
          );
          const returnedResultSignature = readResultSignature(returnedResult);
          ensure(returnedResultSignature === resultSignature,
            'Returning from Settings did not preserve the same result');

          const navigationEntries = performance.getEntriesByType('navigation');
          const externalResourceEntries = performance.getEntriesByType('resource')
            .filter((entry) => {
              try {
                const resourceUrl = new URL(entry.name, window.location.href);
                return !['data:', 'blob:'].includes(resourceUrl.protocol)
                  && resourceUrl.origin !== window.location.origin;
              } catch {
                return true;
              }
            });
          const sameDocument = window.location.href === initialDocumentUrl
            && performance.timeOrigin === initialDocumentTimeOrigin;
          const urlUnchanged = window.location.href === initialDocumentUrl;
          const timeOriginUnchanged = performance.timeOrigin === initialDocumentTimeOrigin;
          const noReload = navigationEntries.length === 1
            && navigationEntries[0].type === 'navigate'
            && sameDocument;
          const sideEffectRequests = {
            settingsWrites: readWorkspaceCounter('demoSettingsWriteRequests'),
            credentialWrites: readWorkspaceCounter('demoDeepseekCredentialWriteRequests'),
            customPromptWrites: readWorkspaceCounter('demoCustomPromptWriteRequests'),
            credentialDeletes: readWorkspaceCounter('demoCredentialDeleteRequests'),
            modelRequests: readWorkspaceCounter('demoProviderConnectionRequests'),
            processingRequests: readWorkspaceCounter('demoProcessRequests'),
            screenshotRequests: readWorkspaceCounter('demoScreenshotCaptureRequests'),
            clipboardWrites: readWorkspaceCounter('demoClipboardWriteRequests'),
            nativeClipboardWrites: readWorkspaceCounter('demoNativeClipboardWriteStubs'),
          };
          ensure(noReload, 'Lazy workspace recovery unexpectedly reloaded or navigated');
          ensure(externalResourceEntries.length === 0,
            'Lazy workspace recovery requested an external renderer resource');
          ensure(Object.values(sideEffectRequests).every((count) => count === 0),
            'Lazy workspace recovery performed an unrelated product side effect');
          if (isResultStylesheetRecoveryRun) {
            ensure(
              nativeKeyboardModalityPrimed
                && nativeWorkspaceRecoveryFocusOwnedBeforeKeyboardPriming
                && window.innerWidth === 200
                && window.innerHeight === 200,
              'Stylesheet recovery must retain exact recovery focus at a 200x200 CSS viewport',
            );
          }

          lazyWorkspaceRecovery = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            resultFailure,
            resultRetry: {
              succeeded: true,
              failureRemoved: !document.querySelector(
                '[data-workspace-load-failure="result"]',
              ),
              restoredSampleResult: Boolean(resultSignature),
              processRequests: processRequestsAfterResultRetry,
              focusEvidence: recoveredResultFocusEvidence,
              ...recoveredResultMain,
            },
            resultStylesheet: {
              activeAttempt: activeResultStylesheet.dataset.workspaceAttempt,
              dedicatedRuleLoaded: dedicatedResultRuleLoaded,
              loadedLinkCount: resultStylesheetLinks.length,
              requestCount: resultStylesheetRequests.length,
              primaryFailureInjected: isResultStylesheetRecoveryRun,
              usedQueriedRetry: resultStylesheetRequests.some((name) => (
                new URL(name).searchParams.get('workspace-attempt') === '1'
              )),
            },
            settingsFailure: {
              ...settingsFailure,
              preservedResultMounted: preservedResultDuringFailure.isConnected,
              preservedResultUnchanged: preservedResultSignature === resultSignature,
            },
            settingsRetry: {
              succeeded: true,
              failureRemoved: !document.querySelector(
                '[data-workspace-load-failure="settings"]',
              ),
              settingsWriteRequests,
              focusEvidence: recoveredSettingsFocusEvidence,
              ...recoveredSettingsMain,
            },
            settingsStylesheet: {
              activeAttempt: activeSettingsStylesheet.dataset.workspaceAttempt,
              privateRuleLoaded: privateSettingsRuleLoaded,
              loadedLinkCount: settingsStylesheetLinks.length,
              requestCount: settingsStylesheetRequests.length,
              primaryRequestCount: settingsPrimaryStylesheetRequests.length,
              retryRequestCount: settingsRetryStylesheetRequests.length,
              primaryFailureInjected: isResultStylesheetRecoveryRun,
              usedQueriedRetry: settingsRetryStylesheetRequests.length === 1,
              unstyledFrameObserved: unstyledSettingsFrameObserved,
            },
            returnedResult: {
              sameResult: returnedResultSignature === resultSignature,
              processRequests: readWorkspaceCounter('demoProcessRequests'),
              focusEvidence: returnedResultFocusEvidence,
              ...returnedResultMain,
            },
            navigation: {
              sameDocument,
              urlUnchanged,
              timeOriginUnchanged,
              noReload,
              entryCount: navigationEntries.length,
              type: navigationEntries[0]?.type || '',
            },
            textScale: {
              exactViewport: window.innerWidth === 200 && window.innerHeight === 200,
              nativeKeyboardModalityPrimed,
              initialRetryFocusOwned:
                nativeWorkspaceRecoveryFocusOwnedBeforeKeyboardPriming,
            },
            sideEffectRequests,
            externalResourceRequestCount: externalResourceEntries.length,
          };
        }

        if (isFirstUseCaptureTextScaleRun) {
          const setupGate = await waitFor(
            () => document.querySelector('.setup-gate'),
            'first-use choice scrollport',
          );
          setupGate.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            setupGate,
            { top: 0, left: 0 },
            'first-use choice origin',
          );
          const setupCard = setupGate.querySelector('.setup-card');
          const setupChoices = [...setupGate.querySelectorAll('.setup-choice')];
          const firstUseTitle = setupGate.querySelector('#setup-title')?.textContent || '';
          const fullChoiceButton = findButton(setupGate, '配置完整分析');
          const basicChoiceButton = findButton(setupGate, '我明确选择只用基础翻译');
          const setupPrivacy = setupGate.querySelector('.setup-privacy');
          ensure(setupCard, 'First-use choice card is missing');
          ensure(setupChoices.length === 2, 'First-use screen must expose exactly two choices');
          ensure(fullChoiceButton && basicChoiceButton, 'First-use choice actions are missing');
          ensure(setupPrivacy, 'First-use processing privacy disclosure is missing');

          const fullChoiceRect = rectSnapshot(setupChoices[0]);
          const basicChoiceRect = rectSnapshot(setupChoices[1]);
          const choicesStacked = basicChoiceRect.top >= fullChoiceRect.bottom - 1;
          const setupRegionsNoHorizontalOverflow = [
            setupGate,
            setupCard,
            setupGate.querySelector('.setup-choice-grid'),
            ...setupChoices,
          ].every((region) => region.scrollWidth <= region.clientWidth + 1);
          const setupRegionsHorizontallyContained = [
            setupCard,
            ...setupChoices,
            fullChoiceButton,
            basicChoiceButton,
            setupPrivacy,
          ].every((region) => horizontalContainment(region, setupGate));
          ensure(pageHasNoHorizontalOverflow(), 'First-use screen introduced page-level horizontal overflow');
          ensure(setupRegionsNoHorizontalOverflow,
            'First-use screen introduced a horizontally scrolling region');
          ensure(setupRegionsHorizontallyContained,
            'First-use content is clipped outside its scrollport');
          ensure(choicesStacked, 'First-use choices did not reflow into one vertical column');
          ensure(setupGate.scrollHeight > setupGate.clientHeight,
            'First-use 200% scenario did not preserve the expected vertical scroll path');

          const setupFocusEvidence = {
            fullChoice: await revealEvidence(
              fullChoiceButton,
              setupGate,
              'first-use full-analysis choice',
            ),
            basicChoice: await revealEvidence(
              basicChoiceButton,
              setupGate,
              'first-use basic-translation choice',
            ),
          };
          const setupPrivacyEvidence = await revealEvidence(
            setupPrivacy,
            setupGate,
            'first-use privacy disclosure',
            { focus: false },
          );
          const setupFocusVisible = Object.values(setupFocusEvidence).every((evidence) => (
            evidence.focused
            && evidence.horizontallyContained
            && evidence.verticallyReachable
            && evidence.fullyVisible
            && evidence.ringVisible
            && evidence.pageNoHorizontalOverflow
            && evidence.scrollportNoHorizontalOverflow
          ));
          ensure(setupFocusVisible,
            'A first-use choice or its focus ring is clipped at 200%: '
              + JSON.stringify(setupFocusEvidence));
          ensure(
            setupPrivacyEvidence.horizontallyContained
              && setupPrivacyEvidence.verticallyReachable
              && setupPrivacyEvidence.pageNoHorizontalOverflow
              && setupPrivacyEvidence.scrollportNoHorizontalOverflow,
            'First-use privacy disclosure is not vertically reachable without horizontal clipping',
          );
          ensure(
            setupPrivacy.textContent.includes('基础翻译会发送给 Google / MyMemory')
              && setupPrivacy.textContent.includes('剪贴板自动检测默认关闭'),
            'First-use privacy disclosure lost its destination or default-state explanation',
          );
          const setupUsedOnlyVerticalScroll = setupGate.scrollTop > 0
            && Math.abs(setupGate.scrollLeft) <= 1;
          ensure(setupUsedOnlyVerticalScroll,
            'First-use privacy disclosure did not remain reachable by vertical scrolling alone');

          await revealEvidence(
            basicChoiceButton,
            setupGate,
            'first-use basic-translation activation',
          );
          ensure(document.activeElement === basicChoiceButton,
            'Basic-translation choice did not retain focus before activation');
          click(basicChoiceButton);

          const shell = await waitFor(
            () => {
              const candidate = document.querySelector('.slipstream-shell.is-capture');
              return candidate?.getBoundingClientRect().width > 0 ? candidate : null;
            },
            'capture shell after the first-use choice',
          );
          const header = await waitFor(
            () => {
              const candidate = shell.querySelector('.app-header');
              const rect = candidate?.getBoundingClientRect();
              return rect?.width > 0 && rect?.height > 0 ? candidate : null;
            },
            'capture header after the first-use choice',
          );
          const captureView = await waitFor(
            () => shell.querySelector('.capture-view'),
            'capture scrollport after the first-use choice',
          );
          const captureCard = await waitFor(
            () => captureView.querySelector('.capture-card'),
            'capture card after the first-use choice',
          );
          const brand = await waitFor(
            () => {
              const candidate = header.querySelector('.app-brand strong');
              const rect = candidate?.getBoundingClientRect();
              return rect?.width > 0 && rect?.height > 0 ? candidate : null;
            },
            'rendered capture brand after the first-use choice',
          );
          const savedTerms = header.querySelector('button[aria-label^="打开术语库"]');
          const settingsButton = header.querySelector('button[aria-label="打开设置"]');
          const hideButton = header.querySelector('button[aria-label^="隐藏窗口"]');
          ensure(brand?.textContent?.trim() === 'Slipstream', 'Capture header brand is missing');
          ensure(savedTerms && settingsButton && hideButton,
            'Capture header is missing Saved Terms, Settings, or Hide');

          const headerTargets = [brand, savedTerms, settingsButton, hideButton];
          const headerRects = headerTargets.map(rectSnapshot);
          const headerItemsContained = headerTargets.every((target) => fullyVisibleIn(target, header));
          const headerItemsDoNotOverlap = headerRects.every((rect, index) => (
            headerRects.slice(index + 1).every((candidate) => overlapArea(rect, candidate) <= 1)
          ));
          const headerNoHorizontalOverflow = header.scrollWidth <= header.clientWidth + 1
            && header.querySelector('.app-header__actions').scrollWidth
              <= header.querySelector('.app-header__actions').clientWidth + 1;
          ensure(pageHasNoHorizontalOverflow(), 'Capture header introduced page-level horizontal overflow');
          ensure(headerNoHorizontalOverflow, 'Capture header introduced horizontal scrolling');
          ensure(headerItemsContained, 'Capture header clipped a brand or primary action');
          ensure(headerItemsDoNotOverlap, 'Capture header brand and primary actions overlap');

          const rectStayedStable = (before, after) => [
            'left', 'top', 'right', 'bottom', 'width', 'height',
          ].every((key) => Math.abs(before[key] - after[key]) <= 1);
          const initialHeaderRect = rectSnapshot(header);
          const initialBrandRect = rectSnapshot(brand);
          const headerFocusEvidence = {};
          for (const [key, target, label] of [
            ['savedTerms', savedTerms, 'capture Saved Terms'],
            ['settings', settingsButton, 'capture Settings'],
            ['hide', hideButton, 'capture Hide'],
          ]) {
            const evidence = await revealEvidence(target, header, label);
            const stableHeader = await waitForStableEvidence(
              () => ({
                header: rectSnapshot(header),
                brand: rectSnapshot(brand),
                windowScroll: { x: window.scrollX, y: window.scrollY },
                documentScroll: {
                  left: document.documentElement.scrollLeft,
                  top: document.documentElement.scrollTop,
                },
                bodyScroll: {
                  left: document.body.scrollLeft,
                  top: document.body.scrollTop,
                },
                scrollingElement: {
                  left: document.scrollingElement.scrollLeft,
                  top: document.scrollingElement.scrollTop,
                },
                headerScroll: { left: header.scrollLeft, top: header.scrollTop },
              }),
              (snapshot) => snapshot.windowScroll.x === 0
                && snapshot.windowScroll.y === 0
                && snapshot.documentScroll.left === 0
                && snapshot.documentScroll.top === 0
                && snapshot.bodyScroll.left === 0
                && snapshot.bodyScroll.top === 0
                && snapshot.scrollingElement.left === 0
                && snapshot.scrollingElement.top === 0
                && snapshot.headerScroll.left === 0
                && snapshot.headerScroll.top === 0,
              label + ' stable header geometry',
            );
            const headerRectAfterFocus = stableHeader.header;
            const brandRectAfterFocus = stableHeader.brand;
            const scrollStayedAtOrigin = stableHeader.windowScroll.x === 0
              && stableHeader.windowScroll.y === 0
              && stableHeader.documentScroll.left === 0
              && stableHeader.documentScroll.top === 0
              && stableHeader.bodyScroll.left === 0
              && stableHeader.bodyScroll.top === 0
              && stableHeader.scrollingElement.left === 0
              && stableHeader.scrollingElement.top === 0
              && stableHeader.headerScroll.left === 0
              && stableHeader.headerScroll.top === 0;
            headerFocusEvidence[key] = {
              ...evidence,
              keyboardModalityPrimed: nativeKeyboardModalityPrimed,
              headerGeometryStable: rectStayedStable(initialHeaderRect, headerRectAfterFocus),
              brandGeometryStable: rectStayedStable(initialBrandRect, brandRectAfterFocus),
              scrollStayedAtOrigin,
              headerRectAfterFocus,
              brandRectAfterFocus,
            };
          }
          const headerFocusVisible = Object.values(headerFocusEvidence).every((evidence) => (
            evidence.focused
            && evidence.horizontallyContained
            && evidence.verticallyReachable
            && evidence.fullyVisible
            && evidence.ringVisible
            && evidence.pageNoHorizontalOverflow
            && evidence.scrollportNoHorizontalOverflow
            && evidence.keyboardModalityPrimed
            && evidence.headerGeometryStable
            && evidence.brandGeometryStable
            && evidence.scrollStayedAtOrigin
          ));
          ensure(headerFocusVisible,
            'Keyboard focus clipped, shifted, or scrolled the capture header at 200%: '
              + JSON.stringify({ initialHeaderRect, initialBrandRect, headerFocusEvidence }));

          const privacyNotice = await waitFor(
            () => captureView.querySelector('.privacy-notice[role="note"]'),
            'first capture privacy notice',
          );
          const privacyAcknowledge = findButton(privacyNotice, '知道了');
          const sourceInput = captureCard.querySelector('textarea[aria-label="要解释的完整原文"]');
          const sampleButton = findButton(captureCard, '载入安全示例');
          const captureMethodButtons = [...captureCard.querySelectorAll('.capture-methods > button')];
          const screenshotButton = captureMethodButtons.find((button) => button.textContent?.includes('框选截图'));
          const clipboardButton = captureMethodButtons.find((button) => button.textContent?.includes('读取剪贴板'));
          const processingLocation = captureCard.querySelector('[aria-label="提交前的处理位置"]');
          const processingLocationButton = findButton(processingLocation, '更改处理方式');
          const processButton = captureCard.querySelector('.process-button');
          const shortcutHelp = captureCard.querySelector('.shortcut-help');
          ensure(
            privacyAcknowledge
              && sourceInput
              && sampleButton
              && screenshotButton
              && clipboardButton
              && processingLocation
              && processingLocationButton
              && processButton
              && shortcutHelp,
            'First capture screen is missing one or more primary controls',
          );
          ensure(
            privacyNotice.textContent.includes('只有你主动处理的文字才会发送')
              && privacyNotice.textContent.includes('剪贴板自动检测默认关闭'),
            'First capture privacy notice is incomplete',
          );
          const emptyInputVerified = sourceInput.value.length === 0;
          const emptyGenerateDisabled = processButton.disabled;
          ensure(emptyInputVerified, 'First capture input is not empty');
          ensure(emptyGenerateDisabled, 'Empty capture must keep Generate disabled');
          ensure(
            shortcutHelp.textContent.includes('截图') && shortcutHelp.textContent.includes('处理'),
            'Capture keyboard shortcut help is incomplete',
          );
          ensure(captureView.scrollHeight > captureView.clientHeight,
            'Capture surface did not preserve a vertical scroll path at 200%');

          const captureInitialFocusEvidence = {
            privacyAcknowledge: await revealEvidence(
              privacyAcknowledge,
              captureView,
              'first-capture privacy acknowledgement',
            ),
            sourceInput: await revealEvidence(sourceInput, captureView, 'empty capture input'),
            sample: await revealEvidence(sampleButton, captureView, 'safe sample action'),
            screenshot: await revealEvidence(screenshotButton, captureView, 'screenshot action'),
            clipboard: await revealEvidence(clipboardButton, captureView, 'clipboard action'),
            processingLocation: await revealEvidence(
              processingLocationButton,
              captureView,
              'processing-location action',
            ),
          };
          const disabledProcessEvidence = await revealEvidence(
            processButton,
            captureView,
            'disabled Generate action',
            { focus: false },
          );
          const shortcutEvidence = await revealEvidence(
            shortcutHelp,
            captureView,
            'capture shortcut help',
            { focus: false },
          );
          const privacyNoticeEvidence = await revealEvidence(
            privacyNotice,
            captureView,
            'first capture privacy notice',
            { focus: false },
          );
          const captureInitialFocusVisible = Object.values(captureInitialFocusEvidence)
            .every((evidence) => (
              evidence.focused
              && evidence.horizontallyContained
              && evidence.verticallyReachable
              && evidence.fullyVisible
              && evidence.ringVisible
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
            ));
          const captureInitialPassiveReachable = [
            disabledProcessEvidence,
            shortcutEvidence,
            privacyNoticeEvidence,
          ].every((evidence) => (
            evidence.horizontallyContained
              && evidence.verticallyReachable
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
          ));
          const captureRegionsNoHorizontalOverflow = [shell, captureView, captureCard]
            .every((region) => region.scrollWidth <= region.clientWidth + 1);
          ensure(captureInitialFocusVisible,
            'An empty-capture control or its focus ring is clipped at 200%: '
              + JSON.stringify(captureInitialFocusEvidence));
          ensure(captureInitialPassiveReachable,
            'Empty-capture supporting content is not vertically reachable without horizontal clipping');
          ensure(captureRegionsNoHorizontalOverflow && pageHasNoHorizontalOverflow(),
            'Empty capture introduced horizontal overflow');
          ensure(Math.abs(captureView.scrollLeft) <= 1,
            'Empty capture required horizontal scrolling to reach a primary control');

          await revealEvidence(
            sampleButton,
            captureView,
            'safe sample activation',
            { focus: false },
          );
          click(sampleButton);
          await waitFor(
            () => sourceInput.value.trim() && !processButton.disabled,
            'loaded safe sample and enabled Generate action',
          );
          const clearButton = findButton(captureCard, '清空');
          const sourceCount = captureCard.querySelector('.capture-input__label-row small');
          const sampleLoadedNotice = captureCard.querySelector('.capture-sample-loaded[role="status"]');
          ensure(clearButton && sourceCount && sampleLoadedNotice,
            'Loaded safe sample did not expose Clear, count, and safety confirmation');
          const safeSampleTextCorrect = sourceInput.value.startsWith('Dear Student,')
            && sourceInput.value.includes('University Services');
          const sourceCountCorrect = sourceCount.textContent.includes(String(sourceInput.value.length));
          const sampleSafetyCopyVisible = sampleLoadedNotice.textContent.includes('虚构示例已载入')
            && sampleLoadedNotice.textContent.includes('只有点击生成才会开始处理');
          ensure(safeSampleTextCorrect, 'Safe sample text is incomplete or unexpected');
          ensure(sourceCountCorrect, 'Safe sample character count does not match the input');
          ensure(sampleSafetyCopyVisible, 'Safe sample did not retain its no-auto-processing explanation');
          ensure(!processButton.disabled, 'Loaded safe sample did not enable Generate');
          ensure(processButton.textContent.includes('生成完整翻译'),
            'Basic-translation setup did not expose the matching Generate label');

          const captureLoadedFocusEvidence = {
            sourceInput: await revealEvidence(sourceInput, captureView, 'loaded safe sample input'),
            clear: await revealEvidence(clearButton, captureView, 'clear safe sample'),
            process: await revealEvidence(processButton, captureView, 'enabled Generate action'),
          };
          const sampleLoadedEvidence = await revealEvidence(
            sampleLoadedNotice,
            captureView,
            'safe sample confirmation',
            { focus: false },
          );
          const captureLoadedFocusVisible = Object.values(captureLoadedFocusEvidence)
            .every((evidence) => (
              evidence.focused
              && evidence.horizontallyContained
              && evidence.verticallyReachable
              && evidence.fullyVisible
              && evidence.ringVisible
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
            ));
          const loadedNoHorizontalOverflow = [shell, captureView, captureCard]
            .every((region) => region.scrollWidth <= region.clientWidth + 1)
            && pageHasNoHorizontalOverflow()
            && Math.abs(captureView.scrollLeft) <= 1;
          ensure(captureLoadedFocusVisible,
            'A loaded-sample control or its focus ring is clipped at 200%: '
              + JSON.stringify(captureLoadedFocusEvidence));
          ensure(
            sampleLoadedEvidence.horizontallyContained
              && sampleLoadedEvidence.verticallyReachable
              && sampleLoadedEvidence.pageNoHorizontalOverflow
              && sampleLoadedEvidence.scrollportNoHorizontalOverflow,
            'Safe sample confirmation is not vertically reachable without horizontal clipping',
          );
          ensure(loadedNoHorizontalOverflow, 'Loaded safe sample introduced horizontal overflow');
          ensure(Number(document.documentElement.dataset.demoProcessRequests) === 0,
            'Loading the safe sample unexpectedly started processing');

          firstUseCaptureTextScale = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            setup: {
              title: firstUseTitle,
              choicesStacked,
              choiceCount: setupChoices.length,
              regionsNoHorizontalOverflow: setupRegionsNoHorizontalOverflow,
              regionsHorizontallyContained: setupRegionsHorizontallyContained,
              verticalScrollOnly: setupUsedOnlyVerticalScroll,
              privacyDisclosureComplete: true,
              privacyReachable: setupPrivacyEvidence.verticallyReachable,
              allFocusEvidenceVisible: setupFocusVisible,
              focusEvidence: setupFocusEvidence,
            },
            header: {
              brandVisible: brand.textContent.trim() === 'Slipstream',
              itemsContained: headerItemsContained,
              itemsDoNotOverlap: headerItemsDoNotOverlap,
              noHorizontalOverflow: headerNoHorizontalOverflow,
              allFocusEvidenceVisible: headerFocusVisible,
              focusEvidence: headerFocusEvidence,
              rects: {
                brand: headerRects[0],
                savedTerms: headerRects[1],
                settings: headerRects[2],
                hide: headerRects[3],
              },
            },
            emptyCapture: {
              firstPrivacyNoticeVisible: true,
              firstPrivacyNoticeComplete: true,
              inputEmpty: emptyInputVerified,
              generateDisabled: disabledProcessEvidence.rect.width > 0 && emptyGenerateDisabled,
              shortcutHelpComplete: true,
              verticalScrollOnly: Math.abs(captureView.scrollLeft) <= 1,
              regionsNoHorizontalOverflow: captureRegionsNoHorizontalOverflow,
              allFocusEvidenceVisible: captureInitialFocusVisible,
              passiveContentReachable: captureInitialPassiveReachable,
              focusEvidence: captureInitialFocusEvidence,
              passiveEvidence: {
                privacyNotice: privacyNoticeEvidence,
                generate: disabledProcessEvidence,
                shortcutHelp: shortcutEvidence,
              },
            },
            loadedSample: {
              textCorrect: safeSampleTextCorrect,
              clearVisible: Boolean(clearButton),
              countCorrect: sourceCountCorrect,
              safetyCopyVisible: sampleSafetyCopyVisible,
              generateEnabled: !processButton.disabled,
              generateLabelCorrect: processButton.textContent.includes('生成完整翻译'),
              noAutoProcess: Number(document.documentElement.dataset.demoProcessRequests) === 0,
              noHorizontalOverflow: loadedNoHorizontalOverflow,
              allFocusEvidenceVisible: captureLoadedFocusVisible,
              focusEvidence: captureLoadedFocusEvidence,
              sampleNoticeEvidence: sampleLoadedEvidence,
            },
          };
        }

        if (isStackedStatusTextScaleRun) {
          const shell = await waitFor(
            () => document.querySelector('.slipstream-shell.has-foreground-status'),
            'stacked-status shell scroll owner',
          );
          const statusCenter = await waitFor(
            () => shell.querySelector(
              '.foreground-status-center[data-pending-capture-count="2"]'
                + '[data-operational-status-count="2"]',
            ),
            'four-state foreground status center',
          );
          const header = shell.querySelector('.app-header');
          const screenshotStatus = statusCenter.querySelector(
            '.clipboard-monitor-queue.is-screenshot-request',
          );
          const clipboardStatus = [...statusCenter.querySelectorAll('.clipboard-monitor-queue')]
            .find((candidate) => !candidate.classList.contains('is-screenshot-request'));
          const shortcutStatus = statusCenter.querySelector('.shortcut-readiness-alert');
          const monitoringStatus = statusCenter.querySelector('.clipboard-monitoring-live');
          const captureView = shell.querySelector('.capture-view');
          let coreTask = null;
          let coreHeading = null;
          let coreCancel = null;
          ensure(header, 'Stacked-status fixture is missing its header');
          ensure(screenshotStatus, 'Stacked-status fixture is missing the pending screenshot card');
          ensure(clipboardStatus, 'Stacked-status fixture is missing the pending clipboard card');
          ensure(shortcutStatus, 'Stacked-status fixture is missing shortcut readiness');
          ensure(monitoringStatus, 'Stacked-status fixture is missing monitoring status');
          ensure(captureView, 'Stacked-status fixture did not preserve the core capture task');
          ensure(statusCenter.dataset.pendingCaptureCount === '2',
            'Stacked-status fixture did not expose exactly two pending captures');
          ensure(statusCenter.dataset.operationalStatusCount === '2',
            'Stacked-status fixture did not expose exactly two operational statuses');

          const statusEntries = [
            { key: 'screenshot', card: screenshotStatus },
            { key: 'clipboard', card: clipboardStatus },
            { key: 'shortcut', card: shortcutStatus },
            { key: 'monitoring', card: monitoringStatus },
          ];
          const expectedOrder = statusEntries.map(({ key }) => key);
          const preAckAllStatusesMounted = statusEntries.every(({ card }) => card.isConnected);
          const preAckCountsMatch = statusCenter.dataset.pendingCaptureCount === '2'
            && statusCenter.dataset.operationalStatusCount === '2';
          ensure(preAckAllStatusesMounted && preAckCountsMatch,
            'Recovery phase did not retain all four foreground statuses before acknowledgement');
          const followsInDocument = (earlier, later) => Boolean(
            earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING
          );
          const recoveryBridge = window.slipstreamUiFixtureRecovery;
          ensure(
            typeof recoveryBridge?.getStatus === 'function'
              && typeof recoveryBridge?.acknowledge === 'function',
            'Stacked-status clipboard residue recovery bridge is unavailable',
          );
          const residueNotice = await waitFor(
            () => shell.querySelector('[data-clipboard-residue-risk="true"]'),
            'stacked-status clipboard residue warning',
          );
          const residueTitle = residueNotice.querySelector('#clipboard-residue-risk-title');
          const residueAcknowledgeAction = residueNotice.querySelector(
            '[data-clipboard-residue-acknowledge]',
          );
          ensure(residueNotice.getAttribute('role') === 'alert',
            'Stacked-status clipboard residue warning lost its alert semantics');
          ensure(
            residueTitle
              && residueTitle.tabIndex === -1
              && residueAcknowledgeAction
              && !residueAcknowledgeAction.disabled,
            'Stacked-status clipboard residue warning is missing its title or acknowledgement action',
          );
          const residueBeforeHeader = followsInDocument(residueNotice, header);
          const residueRect = rectSnapshot(residueNotice);
          const initialHeaderRect = rectSnapshot(header);
          const residueDoesNotOverlapHeader = residueRect.bottom <= initialHeaderRect.top + 1
            && overlapArea(residueRect, initialHeaderRect) <= 1;
          ensure(residueBeforeHeader && residueDoesNotOverlapHeader,
            'Clipboard residue recovery must precede the header without overlap');
          const recoveryFocusInitiallyOwned = residueNotice.contains(document.activeElement);
          const residueTitleFocusEvidence = await focusedControlEvidence(
            residueTitle,
            shell,
            'clipboard residue warning title',
          );
          const residueActionFocusEvidence = await focusedControlEvidence(
            residueAcknowledgeAction,
            shell,
            'clipboard residue acknowledgement action',
          );
          const recoveryFocusEvidenceComplete = [
            residueTitleFocusEvidence,
            residueActionFocusEvidence,
          ].every((evidence) => (
            evidence.focused
              && evidence.focusVisible
              && evidence.ringRendered
              && evidence.ringVisible
              && evidence.horizontallyContained
              && evidence.verticallyReachable
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
          ));
          ensure(
            recoveryFocusInitiallyOwned
              && recoveryFocusEvidenceComplete,
            'Clipboard residue recovery focus or its computed ring was not fully owned and visible',
          );
          const recoveryStatusBeforeAcknowledgement = await recoveryBridge.getStatus();
          const recoveredRiskId = recoveryStatusBeforeAcknowledgement
            ?.clipboardResidueRisk?.id;
          ensure(
            recoveryStatusBeforeAcknowledgement?.recovered === true
              && typeof recoveredRiskId === 'string'
              && recoveredRiskId.length > 0
              && !document.body.textContent?.includes(recoveredRiskId),
            'Stacked-status recovery did not preserve opaque main-owned residue state',
          );
          click(residueAcknowledgeAction);
          await waitFor(
            () => !document.querySelector('[data-clipboard-residue-risk="true"]'),
            'stacked-status clipboard residue acknowledgement',
          );
          const recoveryStatusAfterAcknowledgement = await recoveryBridge.getStatus();
          const residueAcknowledged = recoveryStatusAfterAcknowledgement?.recovered === true
            && recoveryStatusAfterAcknowledgement.clipboardResidueRisk === null;
          ensure(residueAcknowledged,
            'Stacked-status clipboard residue acknowledgement did not release main-owned risk');
          const screenshotTitle = screenshotStatus.querySelector('#pending-screenshot-title');
          await waitFor(
            () => screenshotTitle && document.activeElement === screenshotTitle,
            'pending screenshot focus after clipboard residue acknowledgement',
          );
          const screenshotTitleFocusEvidence = await focusedControlEvidence(
            screenshotTitle,
            shell,
            'pending screenshot title after recovery',
            { focusTarget: false },
          );
          ensure(
            screenshotTitleFocusEvidence.focused
              && screenshotTitleFocusEvidence.focusVisible
              && screenshotTitleFocusEvidence.ringRendered
              && screenshotTitleFocusEvidence.ringVisible,
            'Pending screenshot title did not receive a visible focus handoff after recovery',
          );
          const captureCard = captureView.querySelector('.capture-card');
          const sourceInput = captureCard?.querySelector('textarea[aria-label="要解释的完整原文"]');
          const safeSampleAction = captureCard ? findButton(captureCard, '载入安全示例') : null;
          ensure(captureCard && sourceInput && safeSampleAction,
            'Stacked-status fixture could not prepare a safe in-memory processing task');
          click(safeSampleAction);
          await waitFor(
            () => sourceInput.value.trim(),
            'stacked-status safe sample source',
          );
          const processAction = await waitFor(
            () => {
              const candidate = captureCard.querySelector('.process-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'stacked-status enabled process action',
          );
          click(processAction);
          coreTask = await waitFor(
            () => shell.querySelector('.processing-card'),
            'stacked-status active processing task',
          );
          coreHeading = coreTask.querySelector('h2');
          coreCancel = coreTask.querySelector('.processing-cancel-button');
          ensure(coreHeading && coreCancel,
            'Stacked-status fixture did not preserve the processing heading and cancel action');
          const postProcessFourStatusesRetained = statusEntries.every(({ card }) => card.isConnected)
            && statusCenter.dataset.pendingCaptureCount === '2'
            && statusCenter.dataset.operationalStatusCount === '2';
          const processingStartedFromSafeSample = sourceInput.value.startsWith('Dear Student,');
          ensure(postProcessFourStatusesRetained && processingStartedFromSafeSample,
            'Safe fixture processing did not preserve all four foreground statuses');
          const statusDomPriorityCorrect = statusEntries
            .slice(0, -1)
            .every(({ card }, index) => followsInDocument(card, statusEntries[index + 1].card));
          const wholeFlowDomPriorityCorrect = followsInDocument(header, screenshotStatus)
            && followsInDocument(monitoringStatus, coreTask);
          ensure(statusDomPriorityCorrect && wholeFlowDomPriorityCorrect,
            'Stacked-status DOM order did not preserve header, capture decisions, operational status, then task');

          const isActiveVerticalScrollOwner = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return rect.width > 0
              && rect.height > 0
              && ['auto', 'scroll'].includes(style.overflowY)
              && element.scrollHeight > element.clientHeight + 1;
          };
          const verticalScrollOwners = [...document.body.querySelectorAll('*')]
            .filter(isActiveVerticalScrollOwner);
          const shellStyle = getComputedStyle(shell);
          const statusCenterStyle = getComputedStyle(statusCenter);
          const shellIsOnlyVerticalScrollOwner = verticalScrollOwners.length === 1
            && verticalScrollOwners[0] === shell;
          const statusCenterIsNotScrollable = !isActiveVerticalScrollOwner(statusCenter)
            && !['auto', 'scroll'].includes(statusCenterStyle.overflowY);
          ensure(['auto', 'scroll'].includes(shellStyle.overflowY),
            'Stacked-status shell is not the declared vertical scroll owner');
          ensure(shellIsOnlyVerticalScrollOwner,
            'Stacked-status fixture exposed competing vertical scroll owners: '
              + verticalScrollOwners.map((element) => element.className || element.tagName).join(', '));
          ensure(statusCenterIsNotScrollable,
            'Foreground status center must group statuses without creating nested vertical scrolling');

          shell.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            shell,
            { top: 0, left: 0 },
            'stacked-status origin',
          );
          const scrollTopAtOrigin = shell.scrollTop;
          const shellMaximumScrollTop = shell.scrollHeight - shell.clientHeight;
          ensure(shellMaximumScrollTop > 0,
            'Stacked-status shell did not expose a positive vertical scroll range');
          shell.scrollTo({ top: shellMaximumScrollTop, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            shell,
            { top: 'maximum', left: 0 },
            'stacked-status maximum',
          );
          const scrollTopAtMaximum = shell.scrollTop;
          const shellReachedMaximum = Math.abs(scrollTopAtMaximum - shellMaximumScrollTop) <= 1;
          ensure(Math.abs(scrollTopAtOrigin) <= 1 && shellReachedMaximum,
            'Stacked-status shell could not move from origin to its positive maximum scroll position');
          ensure(Math.abs(shell.scrollLeft) <= 1,
            'Stacked-status shell required horizontal scrolling');
          shell.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            shell,
            { top: 0, left: 0 },
            'stacked-status restored origin',
          );

          const flowElements = [header, ...statusEntries.map(({ card }) => card), coreTask];
          const flowRects = flowElements.map(rectSnapshot);
          const flowDoesNotOverlap = flowRects.slice(0, -1).every((rect, index) => (
            rect.bottom <= flowRects[index + 1].top + 1
              && overlapArea(rect, flowRects[index + 1]) <= 1
          ));
          ensure(flowDoesNotOverlap,
            'Header, foreground statuses, and active task overlap in the shared scroll sequence');

          const passiveEvidence = {};
          passiveEvidence.header = await revealEvidence(
            header,
            shell,
            'stacked-status header',
            { focus: false },
          );
          for (const { key, card } of statusEntries) {
            passiveEvidence[key] = await revealEvidence(
              card,
              shell,
              key + ' status card',
              { focus: false },
            );
          }
          passiveEvidence.coreHeading = await revealEvidence(
            coreHeading,
            shell,
            'active processing heading',
            { focus: false },
          );
          const allPassiveContentReachable = Object.values(passiveEvidence)
            .every((evidence) => (
              evidence.horizontallyContained
                && evidence.verticallyReachable
                && evidence.fullyVisible
                && evidence.pageNoHorizontalOverflow
                && evidence.scrollportNoHorizontalOverflow
            ));
          ensure(allPassiveContentReachable,
            'A stacked status or the active task heading could not be fully revealed: '
              + JSON.stringify(passiveEvidence));

          const actionGroups = Object.fromEntries(statusEntries.map(({ key, card }) => [
            key,
            [...card.querySelectorAll('button')],
          ]));
          ensure(actionGroups.screenshot.length === 2,
            'Pending screenshot status must expose both stop-and-capture and continue actions');
          ensure(actionGroups.clipboard.length === 2,
            'Pending clipboard status must expose process and continue actions');
          ensure(actionGroups.shortcut.length === 1,
            'Shortcut readiness must expose exactly one repair action');
          ensure(actionGroups.monitoring.length === 1,
            'Monitoring status must expose exactly one stop action');
          const allStatusActions = statusEntries.flatMap(({ key }) => actionGroups[key]);
          const actionKeyboardGroups = [...statusCenter.querySelectorAll('button')].map((button) => {
            const owner = statusEntries.find(({ card }) => card.contains(button));
            return owner?.key || 'unknown';
          });
          const keyboardGroupPriority = actionKeyboardGroups.filter(
            (key, index) => index === 0 || key !== actionKeyboardGroups[index - 1],
          );
          const expectedEnabledKeyboardOrder = expectedOrder.filter((key) => key !== 'clipboard');
          const enabledKeyboardGroupPriority = [...statusCenter.querySelectorAll('button:not(:disabled)')]
            .map((button) => statusEntries.find(({ card }) => card.contains(button))?.key || 'unknown')
            .filter((key, index, values) => index === 0 || key !== values[index - 1]);
          const keyboardPriorityCorrect = JSON.stringify(keyboardGroupPriority)
            === JSON.stringify(expectedOrder)
            && JSON.stringify(enabledKeyboardGroupPriority)
              === JSON.stringify(expectedEnabledKeyboardOrder)
            && allStatusActions.every((button) => button.disabled || button.tabIndex === 0)
            && allStatusActions.every((button) => button.tabIndex <= 0);
          ensure(keyboardPriorityCorrect,
            'Stacked-status keyboard order did not match screenshot, clipboard, shortcut, monitoring');

          const actionFocusEvidence = {};
          const disabledActionEvidence = {};
          for (const { key } of statusEntries) {
            for (let index = 0; index < actionGroups[key].length; index += 1) {
              const action = actionGroups[key][index];
              const label = key + ' action ' + (index + 1);
              if (action.disabled) {
                disabledActionEvidence[label] = await revealEvidence(
                  action,
                  shell,
                  label,
                  { focus: false },
                );
              } else {
                actionFocusEvidence[label] = await focusedControlEvidence(
                  action,
                  shell,
                  label,
                );
              }
              ensure(Math.abs(shell.scrollLeft) <= 1,
                label + ' required horizontal scrolling');
            }
          }
          actionFocusEvidence.coreCancel = await focusedControlEvidence(
            coreCancel,
            shell,
            'active processing cancel action',
          );
          const allEnabledActionsFocusVisible = Object.values(actionFocusEvidence)
            .every((evidence) => (
              evidence.focused
                && evidence.focusVisible
                && evidence.ringRendered
                && evidence.ringVisible
                && evidence.horizontallyContained
                && evidence.verticallyReachable
                && evidence.pageNoHorizontalOverflow
                && evidence.scrollportNoHorizontalOverflow
            ));
          const allDisabledActionsReachable = Object.values(disabledActionEvidence)
            .every((evidence) => (
              evidence.horizontallyContained
                && evidence.verticallyReachable
                && evidence.fullyVisible
                && evidence.pageNoHorizontalOverflow
                && evidence.scrollportNoHorizontalOverflow
            ));
          ensure(allEnabledActionsFocusVisible,
            'A stacked-status action or its computed focus ring was clipped: '
              + JSON.stringify(actionFocusEvidence));
          ensure(allDisabledActionsReachable,
            'A disabled stacked-status action was not fully revealable: '
              + JSON.stringify(disabledActionEvidence));

          const cardBodyFor = (card) => card.querySelector('.clipboard-monitor-queue__body')
            || card.querySelector(':scope > span:not(.clipboard-monitor-queue__actions)');
          const actionPairsDoNotOverlap = Object.values(actionGroups).every((actions) => (
            actions.every((action, actionIndex) => actions.slice(actionIndex + 1)
              .every((otherAction) => overlapArea(
                action.getBoundingClientRect(),
                otherAction.getBoundingClientRect(),
              ) <= 1))
          ));
          const actionsDoNotOverlapCardCopy = statusEntries.every(({ key, card }) => {
            const body = cardBodyFor(card);
            return body && actionGroups[key].every((action) => overlapArea(
              action.getBoundingClientRect(),
              body.getBoundingClientRect(),
            ) <= 1);
          });
          ensure(actionPairsDoNotOverlap && actionsDoNotOverlapCardCopy,
            'Stacked-status actions overlap each other or their explanatory copy');

          const horizontalRegions = [
            shell,
            statusCenter,
            captureView,
            coreTask,
            ...statusEntries.map(({ card }) => card),
            ...allStatusActions,
            coreCancel,
          ];
          const regionsHaveNoHorizontalOverflow = horizontalRegions.every((region) => (
            region.scrollWidth <= region.clientWidth + 1
          ));
          const regionsHorizontallyContained = horizontalRegions
            .filter((region) => region !== shell)
            .every((region) => horizontalContainment(region, shell));
          ensure(regionsHaveNoHorizontalOverflow && regionsHorizontallyContained
            && pageHasNoHorizontalOverflow(),
          'Stacked-status shared scroll sequence introduced horizontal overflow or clipping');

          const readSafeCounter = (name) => {
            const value = Number(document.documentElement.dataset[name]);
            ensure(Number.isSafeInteger(value) && value >= 0,
              'Missing stacked-status fixture counter ' + name);
            return value;
          };
          const appCounters = {
            processRequests: readSafeCounter('demoProcessRequests'),
            screenshotCaptureRequests: readSafeCounter('demoScreenshotCaptureRequests'),
            clipboardWriteRequests: readSafeCounter('demoClipboardWriteRequests'),
            nativeClipboardWriteStubs: readSafeCounter('demoNativeClipboardWriteStubs'),
            providerConnectionRequests: readSafeCounter('demoProviderConnectionRequests'),
            credentialDeleteRequests: readSafeCounter('demoCredentialDeleteRequests'),
            credentialDeleteSuccesses: readSafeCounter('demoCredentialDeleteSuccesses'),
            deepseekCredentialWriteRequests: readSafeCounter('demoDeepseekCredentialWriteRequests'),
            deepseekCredentialWriteSuccesses: readSafeCounter('demoDeepseekCredentialWriteSuccesses'),
            quitRequests: readSafeCounter('demoQuitRequests'),
            quitDecisionRequests: readSafeCounter('demoQuitDecisionRequests'),
            quitConfirmedDecisions: readSafeCounter('demoQuitConfirmedDecisions'),
          };
          ensure(appCounters.processRequests === 1,
            'Stacked-status collision must retain exactly one in-flight fixture process');
          ensure(Object.entries(appCounters).every(([name, value]) => (
            name === 'processRequests' ? value === 1 : value === 0
          )), 'Stacked-status fixture triggered an unrelated app side effect: '
            + JSON.stringify(appCounters));

          stackedStatusTextScale = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            counts: {
              pendingCaptureCount: Number(statusCenter.dataset.pendingCaptureCount),
              operationalStatusCount: Number(statusCenter.dataset.operationalStatusCount),
              statusCardCount: statusEntries.length,
              actionCount: allStatusActions.length,
              enabledActionCount: allStatusActions.filter((action) => !action.disabled).length,
              disabledActionCount: allStatusActions.filter((action) => action.disabled).length,
            },
            order: {
              expected: expectedOrder,
              dom: statusEntries.map(({ key }) => key),
              keyboardGroups: keyboardGroupPriority,
              expectedEnabledKeyboardGroups: expectedEnabledKeyboardOrder,
              enabledKeyboardGroups: enabledKeyboardGroupPriority,
              statusDomPriorityCorrect,
              wholeFlowDomPriorityCorrect,
              keyboardPriorityCorrect,
            },
            recovery: {
              warningRole: residueNotice.getAttribute('role'),
              titleTabIndex: residueTitle.tabIndex,
              recoveryFocusInitiallyOwned,
              recoveryFocusEvidenceComplete,
              residueBeforeHeader,
              residueDoesNotOverlapHeader,
              residueAcknowledged,
              preAckAllStatusesMounted,
              preAckCountsMatch,
              warningRemovedAfterAcknowledgement: !residueNotice.isConnected,
              opaqueIdNotRendered: !document.body.textContent?.includes(recoveredRiskId),
              titleFocusEvidence: residueTitleFocusEvidence,
              actionFocusEvidence: residueActionFocusEvidence,
              screenshotTitleFocusEvidence,
              geometry: {
                warning: residueRect,
                header: initialHeaderRect,
              },
            },
            scrolling: {
              shellOverflowY: shellStyle.overflowY,
              statusCenterOverflowY: statusCenterStyle.overflowY,
              shellIsOnlyVerticalScrollOwner,
              statusCenterIsNotScrollable,
              scrollOwnerClasses: verticalScrollOwners.map(
                (element) => String(element.className || element.tagName),
              ),
              clientHeight: shell.clientHeight,
              scrollHeight: shell.scrollHeight,
              maximumScrollTop: shellMaximumScrollTop,
              scrollTopAtOrigin,
              scrollTopAtMaximum,
              reachedMaximum: shellReachedMaximum,
              scrollLeftStayedZero: Math.abs(shell.scrollLeft) <= 1,
            },
            layout: {
              flowDoesNotOverlap,
              actionPairsDoNotOverlap,
              actionsDoNotOverlapCardCopy,
              regionsHaveNoHorizontalOverflow,
              regionsHorizontallyContained,
              pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
              allPassiveContentReachable,
              coreMounted: coreTask.isConnected,
              coreHeading: coreHeading.textContent?.replace(/\\s+/gu, ' ').trim() || '',
              coreCancelVisible: coreCancel.isConnected,
              postProcessFourStatusesRetained,
              processingStartedFromSafeSample,
              flowRects,
            },
            passiveEvidence,
            focusEvidence: actionFocusEvidence,
            disabledActionEvidence,
            allEnabledActionsFocusVisible,
            allDisabledActionsReachable,
            nativeKeyboardModalityPrimed,
            applicationIpcRejected: settingsIpcRejected,
            fixtureClipboardStubbed: clipboardResponse?.fixture === true,
            appCounters,
          };
        }

        if (isGuidedReplyTextScaleRun) {
          const shell = await waitFor(
            () => document.querySelector('.slipstream-shell.is-result'),
            'guided-reply result shell',
          );
          const resultView = await waitFor(
            () => shell.querySelector('.result-view'),
            'guided-reply result scrollport',
          );
          const replyTrigger = await waitFor(
            () => findButton(resultView, '准备英文回复'),
            'guided-reply trigger',
          );
          ensure(
            trustedInputBridge
              && typeof trustedInputBridge.mouseClick === 'function'
              && typeof trustedInputBridge.keyPress === 'function'
              && typeof trustedInputBridge.replacePlaceholder === 'function'
              && typeof trustedInputBridge.editAfterCopy === 'function',
            'Guided-reply trusted input bridge is incomplete',
          );

          let rejectedOutOfSequenceStep = false;
          try {
            await trustedInputBridge.replacePlaceholder(1);
          } catch {
            rejectedOutOfSequenceStep = true;
          }
          ensure(
            rejectedOutOfSequenceStep,
            'Guided-reply trusted input gate accepted an out-of-sequence fixed text step',
          );
          trustedInputEvidence.rejectedStep = {
            step: 1,
            kind: 'fixed-text',
            action: 'replace-placeholder',
            rejected: true,
            nextAcceptedStep: 1,
          };

          const readGuidedReplyCounter = (name) => {
            const value = Number(document.documentElement.dataset[name]);
            ensure(
              Number.isSafeInteger(value) && value >= 0,
              'Missing guided-reply App counter ' + name,
            );
            return value;
          };
          const readGuidedReplyCounters = () => ({
            clipboardWriteRequests: readGuidedReplyCounter('demoClipboardWriteRequests'),
            nativeClipboardWriteStubs: readGuidedReplyCounter(
              'demoNativeClipboardWriteStubs',
            ),
            processRequests: readGuidedReplyCounter('demoProcessRequests'),
            screenshotCaptureRequests: readGuidedReplyCounter(
              'demoScreenshotCaptureRequests',
            ),
            providerConnectionRequests: readGuidedReplyCounter(
              'demoProviderConnectionRequests',
            ),
            credentialDeleteRequests: readGuidedReplyCounter(
              'demoCredentialDeleteRequests',
            ),
            deepseekCredentialWriteRequests: readGuidedReplyCounter(
              'demoDeepseekCredentialWriteRequests',
            ),
            quitRequests: readGuidedReplyCounter('demoQuitRequests'),
          });
          const appCountersBefore = readGuidedReplyCounters();
          ensure(
            Object.values(appCountersBefore).every((value) => value === 0),
            'Guided-reply scenario started with App side effects',
          );

          const targetMinimumEvidence = (dialog) => {
            const targets = [
              ...dialog.querySelectorAll('button'),
              ...dialog.querySelectorAll('.reply-status-picker > label'),
              ...dialog.querySelectorAll('.reply-progress-mismatch label'),
              ...dialog.querySelectorAll('details > summary'),
              ...dialog.querySelectorAll('textarea'),
            ];
            return targets.map((target, index) => {
              const rect = rectSnapshot(target);
              return {
                index,
                tag: target.tagName.toLowerCase(),
                label: target.getAttribute('aria-label')
                  || target.textContent?.replace(/\\s+/gu, ' ').trim().slice(0, 80)
                  || target.getAttribute('name')
                  || '',
                width: rect.width,
                height: rect.height,
                meetsMinimum: rect.width >= 32 && rect.height >= 32,
              };
            });
          };
          const drawerLayoutEvidence = (dialog) => {
            const footer = dialog.querySelector(':scope > footer');
            const previous = footer?.previousElementSibling;
            ensure(footer && previous, 'Guided-reply footer or preceding content is missing');
            const footerRect = rectSnapshot(footer);
            const previousRect = rectSnapshot(previous);
            const footerStyle = getComputedStyle(footer);
            return {
              pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
              drawerNoHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
              footerNoHorizontalOverflow: footer.scrollWidth <= footer.clientWidth + 1,
              drawerScrollLeftStayedZero: Math.abs(dialog.scrollLeft) <= 1,
              footerPosition: footerStyle.position,
              footerDoesNotOverlapPrevious: footerRect.top >= previousRect.bottom - 1,
              footerRect,
              previousRect,
            };
          };
          const blockedFooterReachabilityEvidence = async (dialog) => {
            const footer = dialog.querySelector(':scope > footer');
            const summary = footer?.querySelector('.reply-copy-block-summary');
            const closeAction = [...(footer?.querySelectorAll('button') || [])]
              .find((button) => button.textContent?.trim() === '关闭');
            const copyAction = footer?.querySelector('[data-reply-copy-action]');
            ensure(
              footer && summary && closeAction && copyAction && copyAction.disabled,
              'Guided-reply blocked footer is missing its summary or actions',
            );

            dialog.scrollLeft = 0;
            dialog.scrollTop = 0;
            await waitForStableScrollPosition(
              dialog,
              { top: 0, left: 0 },
              'guided-reply blocked footer origin',
            );
            const scrollTopAtOrigin = dialog.scrollTop;
            const maximumScrollTop = Math.max(0, dialog.scrollHeight - dialog.clientHeight);
            let scrollLeftStayedZero = Math.abs(dialog.scrollLeft) <= 1;
            dialog.scrollTop = maximumScrollTop;
            await waitForStableScrollPosition(
              dialog,
              { top: 'maximum', left: 0 },
              'guided-reply blocked footer maximum',
            );
            const scrollTopAtMaximum = dialog.scrollTop;
            scrollLeftStayedZero = scrollLeftStayedZero && Math.abs(dialog.scrollLeft) <= 1;
            const reachedMaximum = maximumScrollTop > 0
              && Math.abs(scrollTopAtMaximum - maximumScrollTop) <= 1;

            alignTargetInScrollport(footer, dialog, { block: 'end' });
            const footerGeometry = await waitForStableEvidence(
              () => ({
                footerConnected: footer.isConnected,
                summaryConnected: summary.isConnected,
                closeConnected: closeAction.isConnected,
                copyConnected: copyAction.isConnected,
                scroll: readScrollPosition(dialog),
                summaryRect: rectSnapshot(summary),
                closeRect: rectSnapshot(closeAction),
                copyRect: rectSnapshot(copyAction),
                summaryHorizontallyContained: horizontalContainment(summary, dialog),
                summaryVerticallyReachable: intersectsVertically(summary, dialog),
                closeHorizontallyContained: horizontalContainment(closeAction, dialog),
                closeVerticallyReachable: intersectsVertically(closeAction, dialog),
                copyHorizontallyContained: horizontalContainment(copyAction, dialog),
                copyVerticallyReachable: intersectsVertically(copyAction, dialog),
                pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
              }),
              (snapshot) => snapshot.footerConnected
                && snapshot.summaryConnected
                && snapshot.closeConnected
                && snapshot.copyConnected
                && Math.abs(snapshot.scroll.left) <= 1
                && snapshot.summaryHorizontallyContained
                && snapshot.summaryVerticallyReachable
                && snapshot.closeHorizontallyContained
                && snapshot.closeVerticallyReachable
                && snapshot.copyHorizontallyContained
                && snapshot.copyVerticallyReachable
                && snapshot.pageNoHorizontalOverflow,
              'guided-reply blocked footer geometry',
            );
            scrollLeftStayedZero = scrollLeftStayedZero && Math.abs(dialog.scrollLeft) <= 1;
            const summaryRect = footerGeometry.summaryRect;
            const closeRect = footerGeometry.closeRect;
            const copyRect = footerGeometry.copyRect;
            const summaryEvidence = {
              horizontallyContained: horizontalContainment(summary, dialog),
              verticallyReachable: intersectsVertically(summary, dialog),
              rect: summaryRect,
            };
            const closeEvidence = {
              horizontallyContained: horizontalContainment(closeAction, dialog),
              verticallyReachable: intersectsVertically(closeAction, dialog),
              centerHit: targetCenterHit(closeAction, 'guided-reply blocked Close action'),
              rect: closeRect,
            };
            const copyEvidence = {
              disabled: copyAction.disabled,
              horizontallyContained: horizontalContainment(copyAction, dialog),
              verticallyReachable: intersectsVertically(copyAction, dialog),
              centerHit: targetCenterHit(copyAction, 'guided-reply blocked Copy action'),
              rect: copyRect,
            };
            return {
              scrolling: {
                scrollTopAtOrigin,
                maximumScrollTop,
                scrollTopAtMaximum,
                reachedMaximum,
                scrollLeftStayedZero,
              },
              summary: summaryEvidence,
              close: closeEvidence,
              copy: copyEvidence,
              closeCopyOverlapArea: overlapArea(closeRect, copyRect),
            };
          };
          const backgroundState = () => [...shell.children]
            .filter((node) => !node.classList.contains('reply-drawer-backdrop'))
            .map((node) => ({
              className: String(node.className || node.tagName),
              inert: node.inert,
              ariaHidden: node.getAttribute('aria-hidden'),
            }));

          await dispatchTrustedClick(
            1,
            replyTrigger,
            resultView,
            'guided-reply open',
            { focusBeforeClick: false },
          );
          const replyDrawer = await waitFor(
            () => document.querySelector('.reply-drawer'),
            'guided-reply drawer',
          );
          const completedRadio = replyDrawer.querySelector(
            'input[name="reply-status"][value="completed"]',
          );
          const completedLabel = completedRadio?.closest('label');
          const inProgressRadio = replyDrawer.querySelector(
            'input[name="reply-status"][value="in_progress"]',
          );
          ensure(
            completedRadio && completedLabel && inProgressRadio,
            'Guided-reply status choices are missing',
          );
          await waitFor(
            () => document.activeElement === completedRadio,
            'guided-reply initial radio focus',
          );
          const initialRadioFocus = await focusedControlEvidence(
            completedRadio,
            replyDrawer,
            'guided-reply initial completed radio',
            { focusTarget: false, visualTarget: completedLabel },
          );
          const initialRadioHit = targetCenterHit(
            completedLabel,
            'guided-reply initial completed status target',
          );
          const initialBackgroundState = backgroundState();
          const backgroundIsolated = initialBackgroundState.length > 0
            && initialBackgroundState.every((state) => (
              state.inert === true && state.ariaHidden === 'true'
            ));
          ensure(
            backgroundIsolated
              && initialRadioFocus.focused
              && initialRadioFocus.focusVisible
              && initialRadioFocus.ringRendered
              && initialRadioFocus.ringVisible
              && initialRadioFocus.fullyVisible
              && initialRadioFocus.horizontallyContained
              && initialRadioFocus.pageNoHorizontalOverflow
              && initialRadioFocus.scrollportNoHorizontalOverflow,
            'Guided-reply initial radio focus was hidden, clipped, or outside the modal scrollport: '
              + JSON.stringify({ initialRadioFocus, initialBackgroundState }),
          );

          await dispatchTrustedClick(
            2,
            completedLabel,
            replyDrawer,
            'guided-reply completed status',
            { focusBeforeClick: false },
          );
          const mismatch = await waitFor(
            () => replyDrawer.querySelector('#reply-progress-mismatch[role="alert"]'),
            'guided-reply progress mismatch warning',
          );
          const overrideCheckbox = mismatch.querySelector('input[type="checkbox"]');
          const overrideLabel = overrideCheckbox?.closest('label');
          const replyTextarea = replyDrawer.querySelector('textarea[aria-label="英文回复草稿"]');
          const copyAction = replyDrawer.querySelector('[data-reply-copy-action]');
          const blockSummaryBeforeOverride = replyDrawer.querySelector(
            '.reply-copy-block-summary',
          )?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
          ensure(
            completedRadio.checked
              && mismatch.textContent.includes('完成声明与当前行动记录不一致')
              && overrideCheckbox
              && overrideLabel
              && replyTextarea
              && copyAction
              && copyAction.disabled
              && blockSummaryBeforeOverride.includes('确认进度差异')
              && blockSummaryBeforeOverride.includes('填写'),
            'Completed claim did not expose both progress and placeholder copy blockers',
          );
          const mismatchTargetEvidence = targetMinimumEvidence(replyDrawer);
          ensure(
            mismatchTargetEvidence.every((evidence) => evidence.meetsMinimum),
            'Guided-reply mismatch state contains an interaction target smaller than 32px: '
              + JSON.stringify(mismatchTargetEvidence),
          );
          const blockedFooterLayout = drawerLayoutEvidence(replyDrawer);
          const blockedFooterReachability = await blockedFooterReachabilityEvidence(replyDrawer);
          ensure(
            blockedFooterLayout.pageNoHorizontalOverflow
              && blockedFooterLayout.drawerNoHorizontalOverflow
              && blockedFooterLayout.footerNoHorizontalOverflow
              && blockedFooterLayout.drawerScrollLeftStayedZero
              && blockedFooterLayout.footerPosition === 'static'
              && blockedFooterLayout.footerDoesNotOverlapPrevious
              && blockedFooterReachability.scrolling.scrollTopAtOrigin <= 1
              && blockedFooterReachability.scrolling.reachedMaximum
              && blockedFooterReachability.scrolling.scrollLeftStayedZero
              && blockedFooterReachability.summary.horizontallyContained
              && blockedFooterReachability.summary.verticallyReachable
              && blockedFooterReachability.close.horizontallyContained
              && blockedFooterReachability.close.verticallyReachable
              && Number.isSafeInteger(blockedFooterReachability.close.centerHit.x)
              && Number.isSafeInteger(blockedFooterReachability.close.centerHit.y)
              && blockedFooterReachability.copy.disabled
              && blockedFooterReachability.copy.horizontallyContained
              && blockedFooterReachability.copy.verticallyReachable
              && Number.isSafeInteger(blockedFooterReachability.copy.centerHit.x)
              && Number.isSafeInteger(blockedFooterReachability.copy.centerHit.y)
              && blockedFooterReachability.closeCopyOverlapArea === 0,
            'Guided-reply blocked-state footer overflowed, overlaid content, or stayed sticky: '
              + JSON.stringify({ blockedFooterLayout, blockedFooterReachability }),
          );

          await dispatchTrustedClick(
            3,
            overrideLabel,
            replyDrawer,
            'guided-reply progress override',
            { focusBeforeClick: false },
          );
          await waitFor(
            () => overrideCheckbox.checked === true,
            'guided-reply progress override acknowledgement',
          );
          const placeholderWarning = replyDrawer.querySelector(
            '#reply-placeholder-warning[role="alert"]',
          );
          const blockSummaryAfterOverride = replyDrawer.querySelector(
            '.reply-copy-block-summary',
          )?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
          ensure(
            placeholderWarning
              && placeholderWarning.textContent.includes('[Your name]')
              && copyAction.disabled
              && !blockSummaryAfterOverride.includes('确认进度差异')
              && blockSummaryAfterOverride.includes('填写'),
            'Progress override incorrectly bypassed the unresolved placeholder blocker',
          );

          const placeholderStart = replyTextarea.value.indexOf('[Your name]');
          ensure(placeholderStart >= 0, 'Guided-reply draft lost its fixed placeholder');
          await dispatchTrustedFixedText(
            4,
            'replace-placeholder',
            replyTextarea,
            placeholderStart,
            placeholderStart + '[Your name]'.length,
            'guided-reply fixed placeholder replacement',
          );
          await waitFor(
            () => !replyDrawer.querySelector('#reply-placeholder-warning')
              && !copyAction.disabled,
            'guided-reply placeholder settlement',
          );
          const trustedReplacementApplied = replyTextarea.value.includes('Fixture User')
            && !replyTextarea.value.includes('[Your name]');
          ensure(
            trustedReplacementApplied,
            'Fixed placeholder replacement did not reach the controlled reply draft',
          );

          await dispatchTrustedClick(
            5,
            copyAction,
            replyDrawer,
            'guided-reply copy',
            { focusBeforeClick: false },
          );
          const copiedNotice = await waitFor(
            () => replyDrawer.querySelector(
              '[data-clipboard-kind="reply"][data-clipboard-status="copied"]',
            ),
            'guided-reply copied notice',
          );
          const copiedNoticeVisibleAtCopy = copiedNotice.isConnected
            && copiedNotice.getAttribute('data-clipboard-status') === 'copied';
          await waitFor(
            () => copyAction.textContent?.includes('已复制回复'),
            'guided-reply copied action state',
          );
          const copiedDraft = replyTextarea.value;

          await dispatchTrustedFixedText(
            6,
            'edit-after-copy',
            replyTextarea,
            replyTextarea.value.length,
            replyTextarea.value.length,
            'guided-reply fixed post-copy edit',
          );
          const outdatedEvidence = await waitForStableEvidence(
            () => {
              const notice = replyDrawer.querySelector(
                '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
              );
              return {
                copiedNoticeCleared: !replyDrawer.querySelector(
                  '[data-clipboard-kind="reply"][data-clipboard-status="copied"]',
                ),
                noticeConnected: Boolean(notice?.isConnected),
                noticeStatus: notice?.getAttribute('data-clipboard-status') || '',
                noticeMentionsDraft: notice?.textContent?.includes('草稿') === true,
                postCopyEditApplied: replyTextarea.value
                  === copiedDraft + String.fromCharCode(10) + 'Fixture follow-up edit.',
              };
            },
            (snapshot) => Object.values(snapshot).every(Boolean),
            'guided-reply outdated notice and committed fixed edit',
          );
          const outdatedNotice = replyDrawer.querySelector(
            '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
          );
          ensure(
            copiedNoticeVisibleAtCopy
              && outdatedEvidence.copiedNoticeCleared
              && outdatedNotice.isConnected
              && outdatedEvidence.noticeConnected
              && outdatedEvidence.noticeStatus === 'outdated'
              && outdatedEvidence.noticeMentionsDraft
              && outdatedEvidence.postCopyEditApplied,
            'Post-copy fixed edit did not produce the outdated clipboard notice',
          );

          const footerLayout = drawerLayoutEvidence(replyDrawer);
          const settledTargetEvidence = targetMinimumEvidence(replyDrawer);
          ensure(
            footerLayout.pageNoHorizontalOverflow
              && footerLayout.drawerNoHorizontalOverflow
              && footerLayout.footerNoHorizontalOverflow
              && footerLayout.drawerScrollLeftStayedZero
              && footerLayout.footerPosition === 'static'
              && footerLayout.footerDoesNotOverlapPrevious
              && settledTargetEvidence.every((evidence) => evidence.meetsMinimum),
            'Guided-reply footer overflowed, overlaid content, stayed sticky, or exposed a target below 32px: '
              + JSON.stringify({ footerLayout, settledTargetEvidence }),
          );

          const footerClose = [...replyDrawer.querySelectorAll(':scope > footer button')]
            .find((button) => button.textContent?.trim() === '关闭');
          ensure(footerClose, 'Guided-reply footer close action is missing');
          await dispatchTrustedClick(
            7,
            footerClose,
            replyDrawer,
            'guided-reply footer close',
            { focusBeforeClick: false },
          );
          await waitFor(
            () => !document.querySelector('.reply-drawer'),
            'guided-reply first dismissal',
          );
          await waitFor(
            () => document.activeElement === replyTrigger,
            'guided-reply first trigger focus restoration',
          );
          const firstCloseReturnedToExactTrigger = document.activeElement === replyTrigger;
          const firstCloseBackgroundRestored = backgroundState().every((state) => (
            state.inert === false && state.ariaHidden === null
          ));

          await dispatchTrustedClick(
            8,
            replyTrigger,
            resultView,
            'guided-reply reopen',
            { focusBeforeClick: false },
          );
          const reopenedDrawer = await waitFor(
            () => document.querySelector('.reply-drawer'),
            'reopened guided-reply drawer',
          );
          const reopenedCompletedRadio = reopenedDrawer.querySelector(
            'input[name="reply-status"][value="completed"]',
          );
          const reopenedTextarea = reopenedDrawer.querySelector(
            'textarea[aria-label="英文回复草稿"]',
          );
          await waitFor(
            () => document.activeElement === reopenedCompletedRadio,
            'reopened guided-reply initial focus',
          );
          const reopenedStateRetained = Boolean(
            reopenedCompletedRadio?.checked
              && reopenedDrawer.querySelector('.reply-progress-mismatch input[type="checkbox"]')
                ?.checked
              && reopenedTextarea?.value === replyTextarea.value
              && !reopenedDrawer.querySelector('#reply-placeholder-warning')
              && reopenedDrawer.querySelector(
                '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
              ),
          );
          ensure(reopenedStateRetained, 'Guided-reply state was not retained across close and reopen');

          const focusableSelector = [
            'button:not([disabled])',
            'textarea:not([disabled])',
            'input:not([disabled])',
            'details > summary',
            '[href]',
            '[tabindex]:not([tabindex="-1"])',
          ].join(', ');
          const reopenedFocusable = [...reopenedDrawer.querySelectorAll(focusableSelector)]
            .filter((node) => !node.hasAttribute('hidden'));
          // querySelectorAll reports both radios, but a native radio group contributes
          // only its checked member to sequential keyboard navigation. Prove the
          // actual nine-step loop with native Tab input instead of treating the ten
          // selector matches as ten browser Tab stops.
          const nativeTabStopCount = 9;
          const initialLoopTarget = document.activeElement;
          const tabFocusEvidence = [];
          for (let index = 0; index < nativeTabStopCount; index += 1) {
            const step = index + 9;
            await dispatchTrustedKey(
              step,
              'Tab',
              reopenedDrawer,
              'guided-reply Tab ' + (index + 1),
            );
            const activeTarget = document.activeElement;
            const visualTarget = activeTarget.matches('input[type="radio"], input[type="checkbox"]')
              ? activeTarget.closest('label')
              : activeTarget;
            const focusEvidence = await focusedControlEvidence(
              activeTarget,
              reopenedDrawer,
              'guided-reply Tab ' + (index + 1),
              { focusTarget: false, visualTarget },
            );
            const identity = activeTarget.getAttribute('aria-label')
              || activeTarget.getAttribute('value')
              || activeTarget.textContent?.replace(/\\s+/gu, ' ').trim().slice(0, 80)
              || activeTarget.tagName.toLowerCase();
            tabFocusEvidence.push({ identity, ...focusEvidence });
          }
          const tabStayedContained = tabFocusEvidence.every((evidence) => (
            evidence.focused
              && evidence.focusVisible
              && evidence.ringRendered
              && evidence.ringVisible
              && evidence.horizontallyContained
              && evidence.verticallyReachable
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
          ));
          const tabLoopReturnedToInitial = document.activeElement === initialLoopTarget;
          ensure(
            tabStayedContained && tabLoopReturnedToInitial,
            'Guided-reply native Tab loop escaped or clipped modal focus: '
              + JSON.stringify({ tabLoopReturnedToInitial, tabFocusEvidence }),
          );

          await dispatchTrustedKey(
            18,
            'Escape',
            reopenedDrawer,
            'guided-reply Escape',
          );
          await waitFor(
            () => !document.querySelector('.reply-drawer'),
            'guided-reply Escape dismissal',
          );
          await waitFor(
            () => document.activeElement === replyTrigger,
            'guided-reply Escape trigger focus restoration',
          );
          const escapeReturnedToExactTrigger = document.activeElement === replyTrigger;
          const escapeBackgroundRestored = backgroundState().every((state) => (
            state.inert === false && state.ariaHidden === null
          ));
          const appCountersAfter = readGuidedReplyCounters();
          const onlyExpectedClipboardWrite = appCountersAfter.clipboardWriteRequests === 1
            && appCountersAfter.nativeClipboardWriteStubs === 1
            && Object.entries(appCountersAfter).every(([name, value]) => (
              ['clipboardWriteRequests', 'nativeClipboardWriteStubs'].includes(name)
                ? value === 1
                : value === 0
            ));
          ensure(
            onlyExpectedClipboardWrite,
            'Guided-reply journey triggered an unexpected App side effect: '
              + JSON.stringify(appCountersAfter),
          );
          ensure(
            trustedInputEvidence.rejectedStep?.rejected === true
              && trustedInputEvidence.mouse.length === 6
              && trustedInputEvidence.mouse.every((evidence) => evidence.isTrusted)
              && trustedInputEvidence.fixedText.length === 2
              && trustedInputEvidence.fixedText.every((evidence) => evidence.isTrusted)
              && trustedInputEvidence.keyboard.length === 10
              && trustedInputEvidence.keyboard.slice(0, nativeTabStopCount).every((evidence) => (
                evidence.key === 'Tab'
                  && evidence.focusMoved
                  && evidence.focusRemainedOwned
                  && evidence.focusVisible
              ))
              && trustedInputEvidence.escape?.step === 18
              && trustedInputEvidence.escape?.isTrusted === true,
            'Guided-reply journey did not preserve its complete trusted-input sequence',
          );

          guidedReplyTextScale = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            initialFocus: {
              radioVisible: initialRadioFocus.fullyVisible,
              ringVisible: initialRadioFocus.ringVisible,
              centerHit: initialRadioHit,
              evidence: initialRadioFocus,
            },
            modal: {
              backgroundIsolated,
              firstCloseBackgroundRestored,
              escapeBackgroundRestored,
              firstCloseReturnedToExactTrigger,
              escapeReturnedToExactTrigger,
              reopenedStateRetained,
              selectorMatchCount: reopenedFocusable.length,
              nativeTabStopCount,
              tabStayedContained,
              tabLoopReturnedToInitial,
              tabFocusEvidence,
            },
            blockers: {
              mismatchVisible: Boolean(mismatch),
              copyDisabledBeforeOverride: true,
              overrideConfirmed: overrideCheckbox.checked,
              placeholderStillBlockedAfterOverride: Boolean(placeholderWarning),
              trustedReplacementApplied,
              copyEnabledAfterReplacement: !copyAction.disabled,
              copiedNoticeVisible: copiedNoticeVisibleAtCopy,
              copiedNoticeClearedAfterEdit: outdatedEvidence.copiedNoticeCleared,
              postCopyEditApplied: outdatedEvidence.postCopyEditApplied,
              outdatedNoticeVisible: Boolean(outdatedNotice),
              blockSummaryBeforeOverride,
              blockSummaryAfterOverride,
            },
            layout: {
              blockedFooter: blockedFooterLayout,
              blockedFooterReachability,
              footer: footerLayout,
              mismatchTargets: mismatchTargetEvidence,
              settledTargets: settledTargetEvidence,
            },
            appCounters: {
              before: appCountersBefore,
              after: appCountersAfter,
              onlyExpectedClipboardWrite,
            },
            trustedInteractions: trustedInputEvidence,
          };
        }

        if (isCompletedResultTextScaleRun) {
          const shell = await waitFor(
            () => document.querySelector('.slipstream-shell.is-result'),
            'completed result shell',
          );
          const header = await waitFor(
            () => shell.querySelector('.app-header'),
            'completed result header',
          );
          const resultView = await waitFor(
            () => shell.querySelector('.result-view'),
            'completed result scrollport',
          );
          const workspace = await waitFor(
            () => resultView.querySelector('.evidence-workspace'),
            'completed result workspace',
          );
          const mobileSwitch = workspace.querySelector('.mobile-workspace-switch');
          const sourcePane = workspace.querySelector('.source-column');
          const actionPane = workspace.querySelector('.insight-column');
          const footer = resultView.querySelector('.result-footer');
          const headline = resultView.querySelector('#result-headline');
          const deadlineSummary = resultView.querySelector('.deadline-summary');
          const replyStatus = resultView.querySelector('.summary-reply-status');
          ensure(
            mobileSwitch
              && sourcePane
              && actionPane
              && footer
              && headline
              && deadlineSummary
              && replyStatus,
            'Completed result is missing a primary workspace, summary, or footer region',
          );
          ensure(
            headline.textContent.includes('收到邮件后一天内')
              && headline.textContent.includes('eVisa share code'),
            'Completed result did not use the deterministic preview headline',
          );
          const sourcePaper = sourcePane.querySelector('.source-paper');
          const expectedPreviewSource = [
            'Dear Student,',
            '',
            'Please submit copies of the following identity documents to verify your record:',
            '',
            '1. A clear scan of your passport information page.',
            '2. A clear scan of your eVisa share code.',
            '',
            'Please reply to this email to confirm that you have submitted the required documents.',
            '',
            'Please generate the eVisa share code within one day of this email so it is ready for submission.',
            '',
            'All items must be received within two days of this email.',
            '',
            'Best regards,',
            'University Services',
          ].join(String.fromCharCode(10));
          const sourceTextClone = sourcePaper?.cloneNode(true);
          sourceTextClone?.querySelectorAll('.source-evidence__number')
            .forEach((number) => number.remove());
          const renderedSourceText = sourceTextClone?.textContent?.trim() || '';
          const sourceMatchesPreview = renderedSourceText === expectedPreviewSource;
          ensure(
            sourceMatchesPreview,
            'Completed result did not use the deterministic preview source: '
              + JSON.stringify({
                actual: renderedSourceText,
                expected: expectedPreviewSource,
              }),
          );
          const readCompletedResultAppCounter = (name) => {
            const value = Number(document.documentElement.dataset[name]);
            ensure(
              Number.isSafeInteger(value) && value >= 0,
              'Missing completed-result App counter ' + name,
            );
            return value;
          };
          const readCompletedResultAppCounters = () => ({
            clipboardWriteRequests: readCompletedResultAppCounter(
              'demoClipboardWriteRequests',
            ),
            processRequests: readCompletedResultAppCounter('demoProcessRequests'),
            screenshotCaptureRequests: readCompletedResultAppCounter(
              'demoScreenshotCaptureRequests',
            ),
            credentialDeleteRequests: readCompletedResultAppCounter(
              'demoCredentialDeleteRequests',
            ),
            credentialDeleteSuccesses: readCompletedResultAppCounter(
              'demoCredentialDeleteSuccesses',
            ),
            deepseekCredentialWriteRequests: readCompletedResultAppCounter(
              'demoDeepseekCredentialWriteRequests',
            ),
            deepseekCredentialWriteSuccesses: readCompletedResultAppCounter(
              'demoDeepseekCredentialWriteSuccesses',
            ),
            providerConnectionRequests: readCompletedResultAppCounter(
              'demoProviderConnectionRequests',
            ),
            quitRequests: readCompletedResultAppCounter('demoQuitRequests'),
            quitDecisionRequests: readCompletedResultAppCounter(
              'demoQuitDecisionRequests',
            ),
            quitConfirmedDecisions: readCompletedResultAppCounter(
              'demoQuitConfirmedDecisions',
            ),
          });
          const appCountersBefore = readCompletedResultAppCounters();
          ensure(
            Object.values(appCountersBefore).every((value) => value === 0),
            'Completed-result scenario started with App side effects',
          );
          ensure(
            trustedInputBridge && typeof trustedInputBridge.keyPress === 'function',
            'Completed-result trusted input bridge is unavailable',
          );
          let rejectedOutOfSequenceStep = false;
          try {
            await trustedInputBridge.keyPress(1, 'Escape');
          } catch {
            rejectedOutOfSequenceStep = true;
          }
          ensure(
            rejectedOutOfSequenceStep,
            'Completed-result trusted input gate accepted an out-of-sequence step',
          );
          trustedInputEvidence.rejectedStep = {
            step: 1,
            kind: 'key',
            key: 'Escape',
            rejected: true,
            nextAcceptedStep: 1,
          };

          const initialResultGeometry = {
            pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
            shellNoHorizontalOverflow: shell.scrollWidth <= shell.clientWidth + 1,
            resultNoHorizontalOverflow: resultView.scrollWidth <= resultView.clientWidth + 1,
            workspaceNoHorizontalOverflow: workspace.scrollWidth <= workspace.clientWidth + 1,
            workspaceRect: rectSnapshot(workspace),
            workspaceClientHeight: workspace.clientHeight,
            workspaceScrollHeight: workspace.scrollHeight,
          };
          const naturalWorkspaceNonzero = initialResultGeometry.workspaceRect.height > 0
            && initialResultGeometry.workspaceClientHeight > 0
            && initialResultGeometry.workspaceScrollHeight > 0;
          ensure(
            initialResultGeometry.pageNoHorizontalOverflow
              && initialResultGeometry.shellNoHorizontalOverflow
              && initialResultGeometry.resultNoHorizontalOverflow
              && initialResultGeometry.workspaceNoHorizontalOverflow,
            'Completed result introduced horizontal overflow before interaction',
          );
          ensure(naturalWorkspaceNonzero, 'Completed result workspace collapsed to zero height');

          resultView.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            resultView,
            { top: 0, left: 0 },
            'completed result summary origin',
          );
          const summaryEvidence = {
            headline: await revealEvidence(
              headline,
              resultView,
              'completed result headline',
              { focus: false },
            ),
            deadline: await revealEvidence(
              deadlineSummary,
              resultView,
              'completed result deadline',
            ),
            reply: await revealEvidence(
              replyStatus,
              resultView,
              'completed result reply requirement',
              { focus: false },
            ),
          };
          ensure(
            Object.values(summaryEvidence).every((evidence) => (
              evidence.horizontallyContained
                && evidence.verticallyReachable
                && evidence.fullyVisible
                && evidence.pageNoHorizontalOverflow
                && evidence.scrollportNoHorizontalOverflow
            )),
            'Completed result headline, deadline, or reply requirement was not reachable',
          );
          const initialReplyStatusText = replyStatus.textContent.trim();
          ensure(
            summaryEvidence.deadline.focused
              && summaryEvidence.deadline.ringRendered
              && summaryEvidence.deadline.ringVisible,
            'Completed result deadline focus ring was clipped',
          );

          const paneButtons = [...mobileSwitch.querySelectorAll('button')];
          const sourcePaneButton = paneButtons.find((button) => (
            button.textContent?.includes('原文证据')
          ));
          const actionPaneButton = paneButtons.find((button) => (
            button.textContent?.includes('行动与解释')
          ));
          ensure(
            paneButtons.length === 2 && sourcePaneButton && actionPaneButton,
            'Completed result must expose exactly two real mobile pane controls',
          );
          ensure(
            workspace.dataset.mobilePane === 'action'
              && actionPaneButton.getAttribute('aria-pressed') === 'true',
            'Completed result did not start on the action pane',
          );
          const paneFocusEvidence = {
            sourceSwitch: await revealEvidence(
              sourcePaneButton,
              resultView,
              'source pane switch',
            ),
            actionSwitch: await revealEvidence(
              actionPaneButton,
              resultView,
              'action pane switch',
            ),
          };
          await dispatchTrustedClick(
            1,
            sourcePaneButton,
            resultView,
            'source pane switch',
          );
          await waitFor(
            () => workspace.dataset.mobilePane === 'source'
              && sourcePaneButton.getAttribute('aria-pressed') === 'true',
            'real source pane switch',
          );
          const sourcePaneRect = rectSnapshot(sourcePane);
          const sourcePaneActive = sourcePaneRect.width > 0
            && sourcePaneRect.height > 0
            && getComputedStyle(sourcePane).display !== 'none';
          const actionPaneHiddenForSource = getComputedStyle(actionPane).display === 'none';
          const sourcePaneNoHorizontalOverflow = sourcePane.scrollWidth <= sourcePane.clientWidth + 1
            && workspace.scrollWidth <= workspace.clientWidth + 1
            && resultView.scrollWidth <= resultView.clientWidth + 1
            && pageHasNoHorizontalOverflow();
          ensure(
            sourcePaneActive && actionPaneHiddenForSource && sourcePaneNoHorizontalOverflow,
            'Real source pane switch did not expose a contained source pane',
          );

          await dispatchTrustedClick(
            2,
            actionPaneButton,
            resultView,
            'action pane switch',
          );
          await waitFor(
            () => workspace.dataset.mobilePane === 'action'
              && actionPaneButton.getAttribute('aria-pressed') === 'true',
            'real action pane switch',
          );
          const actionPaneRect = rectSnapshot(actionPane);
          const actionPaneActive = actionPaneRect.width > 0
            && actionPaneRect.height > 0
            && getComputedStyle(actionPane).display !== 'none';
          const sourcePaneHiddenForAction = getComputedStyle(sourcePane).display === 'none';
          const actionPaneNoHorizontalOverflow = actionPane.scrollWidth <= actionPane.clientWidth + 1
            && workspace.scrollWidth <= workspace.clientWidth + 1
            && resultView.scrollWidth <= resultView.clientWidth + 1
            && pageHasNoHorizontalOverflow();
          ensure(
            actionPaneActive && sourcePaneHiddenForAction && actionPaneNoHorizontalOverflow,
            'Real action pane switch did not expose a contained action pane',
          );

          const firstActionEvidence = actionPane.querySelector(
            'button[data-evidence-target="action"][aria-controls="source-evidence-2"]',
          );
          ensure(firstActionEvidence, 'Completed result has no linked action evidence control');
          await dispatchTrustedClick(
            3,
            firstActionEvidence,
            resultView,
            'action-to-source evidence control',
          );
          const linkedSourceEvidence = await waitFor(
            () => workspace.dataset.mobilePane === 'source'
              && document.activeElement?.matches('mark.source-evidence[role="button"]')
              ? document.activeElement
              : null,
            'action-to-source evidence navigation',
          );
          await dispatchTrustedClick(
            4,
            linkedSourceEvidence,
            resultView,
            'source-to-action evidence control',
          );
          await waitFor(
            () => workspace.dataset.mobilePane === 'action'
              && document.activeElement?.matches('[data-evidence-target]'),
            'source-to-action evidence navigation',
          );
          const linkedEvidenceRoundTrip = true;

          const headerPreferenceButtons = [...header.querySelectorAll(
            '.preference-switch button',
          )];
          const savedTermsTrigger = await waitFor(
            () => {
              const candidate = header.querySelector(
                'button.saved-terms-trigger[aria-controls="saved-terms-drawer"]',
              );
              return candidate?.getAttribute('aria-label')
                ?.includes('已保存 1 个术语') ? candidate : null;
            },
            'sample Saved Terms trigger',
          );
          const settingsButton = header.querySelector('button[aria-label="打开设置"]');
          const hideButton = header.querySelector('button[aria-label^="隐藏窗口"]');
          const headerControls = [
            ...headerPreferenceButtons,
            savedTermsTrigger,
            settingsButton,
            hideButton,
          ];
          ensure(
            headerPreferenceButtons.length === 2 && headerControls.every(Boolean),
            'Completed result header is missing preference, terms, settings, or hide controls',
          );
          const headerControlRects = headerControls.map(rectSnapshot);
          const headerControlsPositive = headerControlRects.every((rect) => (
            rect.width > 0 && rect.height > 0
          ));
          const headerControlsDoNotOverlap = headerControlRects.every((rect, index) => (
            headerControlRects.slice(index + 1).every((candidate) => (
              overlapArea(rect, candidate) <= 1
            ))
          ));
          const visualControlFollows = (previous, next) => (
            next.top >= previous.bottom - 1
              || (
                Math.abs(next.top - previous.top) <= 1
                && next.left >= previous.right - 1
              )
          );
          const headerVisualDomOrder = headerControlRects.slice(1).every((rect, index) => (
            visualControlFollows(headerControlRects[index], rect)
          ));
          const headerNoHorizontalOverflow = header.scrollWidth <= header.clientWidth + 1
            && header.querySelector('.app-header__actions').scrollWidth
              <= header.querySelector('.app-header__actions').clientWidth + 1
            && pageHasNoHorizontalOverflow();
          ensure(
            headerControlsPositive
              && headerControlsDoNotOverlap
              && headerVisualDomOrder
              && headerNoHorizontalOverflow,
            'Completed result header controls are clipped, overlapping, or visually reordered',
          );
          const headerFocusEvidence = {};
          for (const [key, target] of [
            ['actionPreference', headerPreferenceButtons[0]],
            ['translationPreference', headerPreferenceButtons[1]],
            ['savedTerms', savedTermsTrigger],
            ['settings', settingsButton],
            ['hide', hideButton],
          ]) {
            headerFocusEvidence[key] = await revealEvidence(
              target,
              header,
              'completed result header ' + key,
            );
          }
          const headerFocusVisible = Object.values(headerFocusEvidence).every((evidence) => (
            evidence.focused
              && evidence.fullyVisible
              && evidence.ringRendered
              && evidence.ringVisible
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
          ));
          ensure(
            nativeKeyboardModalityPrimed && headerFocusVisible,
            'Completed result header lost real keyboard focus visibility',
          );

          const footerButtonsBeforeCompletion = [...footer.querySelectorAll('button')];
          const prepareReply = findButton(footer, '准备英文回复');
          const copyActions = footer.querySelector('[data-actions-copy-action]');
          const copyResult = footer.querySelector('[data-result-copy-action]');
          const editSource = findButton(footer, '修正原文');
          const recapture = findButton(footer, '重新截图');
          const reanalyze = findButton(footer, '重新分析');
          const processingCompletion = footer.querySelector('.completion-button');
          const returnBeforeCompletion = footer.querySelector('.new-capture-button');
          const footerControlEntries = [
            ['prepareReply', prepareReply],
            ['copyActions', copyActions],
            ['copyResult', copyResult],
            ['editSource', editSource],
            ['recapture', recapture],
            ['reanalyze', reanalyze],
            ['processingCompletion', processingCompletion],
            ['returnBeforeCompletion', returnBeforeCompletion],
          ];
          const expectedFooterControls = footerControlEntries.map(([, button]) => button);
          ensure(
            footerButtonsBeforeCompletion.length === expectedFooterControls.length
              && expectedFooterControls.every((button) => button && !button.disabled),
            'Completed result footer did not expose its full enabled action set',
          );
          const footerActionsPositive = expectedFooterControls.every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          ensure(footerActionsPositive, 'A completed result footer action was not rendered');
          resultView.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          await waitForStableScrollPosition(
            resultView,
            { top: 0, left: 0 },
            'completed result footer origin',
          );
          const outerScrollBefore = {
            top: resultView.scrollTop,
            left: resultView.scrollLeft,
          };
          const footerFocusEvidence = {};
          for (const [key, button] of footerControlEntries) {
            footerFocusEvidence[key] = await revealEvidence(
              button,
              resultView,
              'completed result footer ' + key,
            );
          }
          const footerFocusVisible = Object.values(footerFocusEvidence).every((evidence) => (
            evidence.focused
              && evidence.fullyVisible
              && evidence.ringRendered
              && evidence.ringVisible
              && evidence.pageNoHorizontalOverflow
              && evidence.scrollportNoHorizontalOverflow
          ));
          const outerScrollAfterFooterReveal = {
            top: resultView.scrollTop,
            left: resultView.scrollLeft,
          };
          const outerResultVerticalScrollChanged = outerScrollAfterFooterReveal.top
            > outerScrollBefore.top;
          const outerResultScrollLeftStayedZero = Math.abs(outerScrollBefore.left) <= 1
            && Math.abs(outerScrollAfterFooterReveal.left) <= 1;
          ensure(
            footerFocusVisible
              && outerResultVerticalScrollChanged
              && outerResultScrollLeftStayedZero,
            'Completed result footer controls were not focus-visible through vertical-only scrolling: '
              + JSON.stringify({
                footerFocusEvidence,
                outerScrollBefore,
                outerScrollAfterFooterReveal,
                outerResultVerticalScrollChanged,
                outerResultScrollLeftStayedZero,
              }),
          );

          const actionCheckboxSelector = '.action-completion-toggle input[type="checkbox"]';
          const initialActionCheckboxes = [...actionPane.querySelectorAll(actionCheckboxSelector)];
          ensure(
            initialActionCheckboxes.length === 4
              && initialActionCheckboxes.every((checkbox) => !checkbox.disabled && !checkbox.checked),
            'Preview result did not expose four enabled incomplete action checkboxes',
          );
          const checkboxRoundTrips = [];
          for (let index = 0; index < initialActionCheckboxes.length; index += 1) {
            const currentCheckbox = () => actionPane.querySelectorAll(actionCheckboxSelector)[index];
            const firstCheckboxStep = 5 + index * 3;
            await revealEvidence(
              currentCheckbox(),
              resultView,
              'action completion checkbox ' + String(index + 1),
            );
            await dispatchTrustedClick(
              firstCheckboxStep,
              currentCheckbox(),
              resultView,
              'action completion checkbox ' + String(index + 1) + ' check',
            );
            await waitFor(() => currentCheckbox()?.checked, 'checked action ' + String(index + 1));
            await dispatchTrustedClick(
              firstCheckboxStep + 1,
              currentCheckbox(),
              resultView,
              'action completion checkbox ' + String(index + 1) + ' reverse',
            );
            await waitFor(
              () => currentCheckbox() && !currentCheckbox().checked,
              'reversed action ' + String(index + 1),
            );
            await dispatchTrustedClick(
              firstCheckboxStep + 2,
              currentCheckbox(),
              resultView,
              'action completion checkbox ' + String(index + 1) + ' recheck',
            );
            await waitFor(
              () => currentCheckbox()?.checked,
              'rechecked action ' + String(index + 1),
            );
            checkboxRoundTrips.push(true);
          }
          const completedCheckboxes = [...actionPane.querySelectorAll(actionCheckboxSelector)];
          const allActionCheckboxesChecked = completedCheckboxes.length === 4
            && completedCheckboxes.every((checkbox) => checkbox.checked);
          const allActionCheckboxesReversible = checkboxRoundTrips.length === 4
            && checkboxRoundTrips.every(Boolean);
          const actionProgress = actionPane.querySelector('.action-progress[role="status"]');
          const statusBadge = actionPane.querySelector('.result-status--partial');
          const pendingVerificationTrigger = [...actionPane.querySelectorAll(
            '.disclosure__trigger',
          )].find((button) => button.textContent?.includes('待核验'));
          ensure(
            allActionCheckboxesChecked
              && allActionCheckboxesReversible
              && actionProgress?.querySelector('strong')?.textContent
                ?.includes('你已标记全部 4 项完成')
              && actionProgress?.querySelector('small')?.textContent
                ?.includes('这是你的自报记录')
              && actionProgress?.querySelector('small')?.textContent
                ?.includes('不代表 Slipstream 已验证现实结果')
              && statusBadge?.textContent?.includes('部分结论待核验')
              && pendingVerificationTrigger?.textContent?.includes('1 项待核验'),
            'Self-reported completion incorrectly changed partial or unverified result truth',
          );

          const completedReturn = await waitFor(
            () => {
              const candidate = footer.querySelector(
                '.new-capture-button.new-capture-button--complete',
              );
              return candidate?.textContent?.includes('完成并返回') ? candidate : null;
            },
            'completed task return action',
          );
          const completedReturnUndoConsequence = completedReturn.getAttribute('aria-label')
            ?.includes('10 秒内可撤销');
          const processingCompletionStillDistinct = processingCompletion.isConnected
            && processingCompletion !== completedReturn
            && processingCompletion.textContent?.includes('处理完成')
            && !processingCompletion.textContent?.includes('完成并返回');
          ensure(
            completedReturnUndoConsequence && processingCompletionStillDistinct,
            'Task completion obscured processing completion or its reversible exit consequence',
          );
          const completedFocusEvidence = {
            actionCheckbox: await revealEvidence(
              completedCheckboxes[0],
              resultView,
              'completed action checkbox',
            ),
            reanalyze: footerFocusEvidence.reanalyze,
            processingCompletion: await revealEvidence(
              processingCompletion,
              resultView,
              'processing completion disclosure',
            ),
            completedReturn: await revealEvidence(
              completedReturn,
              resultView,
              'completed task return action',
            ),
          };
          ensure(
            Object.values({ ...paneFocusEvidence, ...completedFocusEvidence })
              .every((evidence) => (
                evidence.focused
                  && evidence.fullyVisible
                  && evidence.ringRendered
                  && evidence.ringVisible
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow
              )),
            'A representative completed-result focus ring was clipped after reveal: '
              + JSON.stringify({ paneFocusEvidence, completedFocusEvidence }),
          );

          const deadlineDisclosureTrigger = actionPane.querySelector(
            'button#result-deadlines.disclosure__trigger',
          );
          const deadlineDisclosureHeading = actionPane.querySelector(
            '#result-deadlines-heading.disclosure__heading',
          );
          const deadlineDisclosureTitle = actionPane.querySelector('#result-deadlines-title');
          const deadlineDisclosureMeta = actionPane.querySelector('#result-deadlines-meta');
          const deadlineDisclosurePanel = actionPane.querySelector(
            '#result-deadlines-panel.disclosure__content',
          );
          ensure(
            deadlineDisclosureTrigger
              && deadlineDisclosureHeading
              && deadlineDisclosureTitle
              && deadlineDisclosureMeta
              && deadlineDisclosurePanel,
            'Completed result is missing the connected deadline disclosure contract',
          );
          const deadlineDisclosureIds = {
            trigger: deadlineDisclosureTrigger.id,
            panel: deadlineDisclosurePanel.id,
            heading: deadlineDisclosureHeading.id,
            title: deadlineDisclosureTitle.id,
            meta: deadlineDisclosureMeta.id,
            ariaControls: deadlineDisclosureTrigger.getAttribute('aria-controls') || '',
            ariaLabelledBy: deadlineDisclosureTrigger.getAttribute('aria-labelledby') || '',
            ariaDescribedBy: deadlineDisclosureTrigger.getAttribute('aria-describedby') || '',
            headingOwnsTrigger: deadlineDisclosureHeading.tagName === 'H2'
              && deadlineDisclosureHeading.children.length === 1
              && deadlineDisclosureHeading.firstElementChild === deadlineDisclosureTrigger,
          };
          const deadlineDisclosureInitial = {
            ariaExpanded: deadlineDisclosureTrigger.getAttribute('aria-expanded'),
            panelHidden: deadlineDisclosurePanel.hidden,
            panelConnected: deadlineDisclosurePanel.isConnected,
            triggerWasNotFocused: document.activeElement !== deadlineDisclosureTrigger,
          };
          ensure(
            deadlineDisclosureIds.trigger === 'result-deadlines'
              && deadlineDisclosureIds.panel === 'result-deadlines-panel'
              && deadlineDisclosureIds.heading === 'result-deadlines-heading'
              && deadlineDisclosureIds.title === 'result-deadlines-title'
              && deadlineDisclosureIds.meta === 'result-deadlines-meta'
              && deadlineDisclosureIds.ariaControls === deadlineDisclosureIds.panel
              && deadlineDisclosureIds.ariaLabelledBy === deadlineDisclosureIds.title
              && deadlineDisclosureIds.ariaDescribedBy === deadlineDisclosureIds.meta
              && deadlineDisclosureIds.headingOwnsTrigger
              && deadlineDisclosureInitial.ariaExpanded === 'false'
              && deadlineDisclosureInitial.panelHidden
              && deadlineDisclosureInitial.panelConnected
              && deadlineDisclosureInitial.triggerWasNotFocused,
            'Completed result deadline disclosure did not begin as one connected collapsed H2 control: '
              + JSON.stringify({
                ids: deadlineDisclosureIds,
                initial: deadlineDisclosureInitial,
              }),
          );

          const exerciseDeadlineDisclosure = async () => {
            await dispatchTrustedClick(
              23,
              deadlineDisclosureTrigger,
              resultView,
              'deadline disclosure open',
              { focusBeforeClick: false },
            );
          await waitFor(
            () => deadlineDisclosureTrigger.getAttribute('aria-expanded') === 'true'
              && !deadlineDisclosurePanel.hidden,
            'real deadline disclosure open',
          );
          const deadlineCards = [...deadlineDisclosurePanel.querySelectorAll('.deadline-card')];
          const deadlineCardTexts = deadlineCards.map((card) => (
            card.textContent?.replace(/\\s+/gu, ' ').trim() || ''
          ));
          const deadlineOpenNaturalFocusRetained = document.activeElement
            === deadlineDisclosureTrigger;
          const deadlineOpenSameTrigger = actionPane.querySelector('#result-deadlines')
            === deadlineDisclosureTrigger;
          const deadlineOpenSamePanel = actionPane.querySelector('#result-deadlines-panel')
            === deadlineDisclosurePanel;
          const deadlineOpenFocusEvidence = await focusedControlEvidence(
            deadlineDisclosureTrigger,
            resultView,
            'open deadline disclosure trigger',
            { focusTarget: false, requireFocusVisible: false },
          );
          const deadlineOpenNoHorizontalOverflow = deadlineDisclosurePanel.scrollWidth
              <= deadlineDisclosurePanel.clientWidth + 1
            && actionPane.scrollWidth <= actionPane.clientWidth + 1
            && resultView.scrollWidth <= resultView.clientWidth + 1
            && pageHasNoHorizontalOverflow();
          const deadlineDisclosureOpen = {
            ariaExpanded: deadlineDisclosureTrigger.getAttribute('aria-expanded'),
            panelHidden: deadlineDisclosurePanel.hidden,
            panelConnected: deadlineDisclosurePanel.isConnected,
            sameTrigger: deadlineOpenSameTrigger,
            samePanel: deadlineOpenSamePanel,
            focusRetained: deadlineOpenNaturalFocusRetained,
            cardCount: deadlineCards.length,
            cardTexts: deadlineCardTexts,
            noHorizontalOverflow: deadlineOpenNoHorizontalOverflow,
            focusEvidence: deadlineOpenFocusEvidence,
          };
          ensure(
            deadlineDisclosureOpen.ariaExpanded === 'true'
              && !deadlineDisclosureOpen.panelHidden
              && deadlineDisclosureOpen.panelConnected
              && deadlineDisclosureOpen.sameTrigger
              && deadlineDisclosureOpen.samePanel
              && deadlineDisclosureOpen.focusRetained
              && deadlineDisclosureOpen.cardCount === 2
              && deadlineDisclosureOpen.cardTexts.some((text) => (
                text.includes('收到邮件后一天内')
              ))
              && deadlineDisclosureOpen.cardTexts.some((text) => (
                text.includes('收到邮件后两天内')
              ))
              && deadlineDisclosureOpen.noHorizontalOverflow
              && deadlineOpenFocusEvidence.focused
              && deadlineOpenFocusEvidence.horizontallyContained
              && deadlineOpenFocusEvidence.verticallyReachable
              && deadlineOpenFocusEvidence.pageNoHorizontalOverflow
              && deadlineOpenFocusEvidence.scrollportNoHorizontalOverflow,
            'Native deadline open did not retain one reachable pointer-focused trigger and two fictional cards: '
              + JSON.stringify(deadlineDisclosureOpen),
          );

          await dispatchTrustedClick(
            24,
            deadlineDisclosureTrigger,
            resultView,
            'deadline disclosure close',
            { focusBeforeClick: false },
          );
          await waitFor(
            () => deadlineDisclosureTrigger.getAttribute('aria-expanded') === 'false'
              && deadlineDisclosurePanel.hidden,
            'real deadline disclosure close',
          );
          const deadlineClosedNaturalFocusRetained = document.activeElement
            === deadlineDisclosureTrigger;
          const deadlineClosedFocusEvidence = await focusedControlEvidence(
            deadlineDisclosureTrigger,
            resultView,
            'closed deadline disclosure trigger',
            { focusTarget: false, requireFocusVisible: false },
          );
          const deadlineClosedNoHorizontalOverflow = actionPane.scrollWidth
              <= actionPane.clientWidth + 1
            && resultView.scrollWidth <= resultView.clientWidth + 1
            && pageHasNoHorizontalOverflow();
          const deadlineDisclosureClosed = {
            ariaExpanded: deadlineDisclosureTrigger.getAttribute('aria-expanded'),
            panelHidden: deadlineDisclosurePanel.hidden,
            panelConnected: deadlineDisclosurePanel.isConnected,
            sameTrigger: actionPane.querySelector('#result-deadlines')
              === deadlineDisclosureTrigger,
            samePanel: actionPane.querySelector('#result-deadlines-panel')
              === deadlineDisclosurePanel,
            focusRetained: deadlineClosedNaturalFocusRetained,
            cardCount: deadlineDisclosurePanel.querySelectorAll('.deadline-card').length,
            noHorizontalOverflow: deadlineClosedNoHorizontalOverflow,
            focusEvidence: deadlineClosedFocusEvidence,
          };
          ensure(
            deadlineDisclosureClosed.ariaExpanded === 'false'
              && deadlineDisclosureClosed.panelHidden
              && deadlineDisclosureClosed.panelConnected
              && deadlineDisclosureClosed.sameTrigger
              && deadlineDisclosureClosed.samePanel
              && deadlineDisclosureClosed.focusRetained
              && deadlineDisclosureClosed.cardCount === 2
              && deadlineDisclosureClosed.noHorizontalOverflow
              && deadlineClosedFocusEvidence.focused
              && deadlineClosedFocusEvidence.horizontallyContained
              && deadlineClosedFocusEvidence.verticallyReachable
              && deadlineClosedFocusEvidence.pageNoHorizontalOverflow
              && deadlineClosedFocusEvidence.scrollportNoHorizontalOverflow,
            'Native deadline close replaced its panel or lost its reachable pointer focus: '
              + JSON.stringify(deadlineDisclosureClosed),
          );
          return {
            ids: deadlineDisclosureIds,
            initial: deadlineDisclosureInitial,
            open: deadlineDisclosureOpen,
            closed: deadlineDisclosureClosed,
          };
          };

          const backgroundStateBeforeDrawer = new Map(
            [...shell.children].map((node) => [node, {
              inert: node.inert,
              ariaHidden: node.getAttribute('aria-hidden'),
            }]),
          );
          await dispatchTrustedClick(
            17,
            savedTermsTrigger,
            header,
            'Saved Terms trigger',
          );
          const termsDrawer = await waitFor(
            () => {
              const candidate = document.querySelector('#saved-terms-drawer');
              if (!candidate) return null;
              ensure(
                !candidate.matches('[data-workspace-load-failure="saved-terms"]')
                  && !candidate.querySelector('[data-workspace-load-failure="saved-terms"]'),
                'Saved Terms lazy workspace failed while opening the sample drawer',
              );
              return candidate.querySelector('#saved-term-drawer-search')
                && candidate.querySelector('.saved-term-search__field')
                && candidate.querySelector('.saved-terms-drawer__header')
                && candidate.querySelector('#saved-terms-drawer-title')
                && candidate.querySelector('button[aria-label="关闭术语库"]')
                ? candidate
                : null;
            },
            'resolved Saved Terms drawer at 200 percent',
          );
          const termsBackdrop = termsDrawer.closest('.saved-terms-drawer-backdrop');
          const termsSearch = termsDrawer.querySelector('#saved-term-drawer-search');
          const termsSearchField = termsDrawer.querySelector('.saved-term-search__field');
          const termsHeader = termsDrawer.querySelector('.saved-terms-drawer__header');
          const termsBody = termsDrawer.querySelector('.saved-terms-drawer__body');
          const termsList = termsDrawer.querySelector('.saved-term-library');
          const termsTitle = termsDrawer.querySelector('#saved-terms-drawer-title');
          const termsClose = termsDrawer.querySelector('button[aria-label="关闭术语库"]');
          ensure(
            termsBackdrop
              && termsSearch
              && termsSearchField
              && termsHeader
              && termsBody
              && termsList
              && termsTitle
              && termsClose,
            'Saved Terms drawer is missing its search, list, header, body, or close control',
          );
          await waitFor(
            () => document.activeElement === termsSearch,
            'Saved Terms search auto-focus',
          );
          const searchAutoFocused = document.activeElement === termsSearch;
          const backgroundNodes = [...shell.children].filter((node) => node !== termsBackdrop);
          const backgroundIsolated = backgroundNodes.every((node) => (
            node.inert === true && node.getAttribute('aria-hidden') === 'true'
          ));
          const triggerOwnedByInertBackground = Boolean(savedTermsTrigger.closest('[inert]'));
          ensure(
            termsDrawer.getAttribute('role') === 'dialog'
              && termsDrawer.getAttribute('aria-modal') === 'true'
              && backgroundIsolated
              && triggerOwnedByInertBackground,
            'Saved Terms drawer did not exclusively own modal interaction',
          );

          await waitFor(
            () => fullyVisibleIn(termsSearchField, termsDrawer, 5),
            'complete auto-focused Saved Terms search ring',
          );
          const searchStyle = getComputedStyle(termsSearchField);
          const searchOutlineWidth = Number.parseFloat(searchStyle.outlineWidth) || 0;
          const searchOutlineOffset = Number.parseFloat(searchStyle.outlineOffset) || 0;
          const searchRingExtent = searchOutlineWidth + Math.max(0, searchOutlineOffset);
          const searchRingRendered = searchOutlineWidth > 0
            && searchStyle.outlineStyle !== 'none'
            && searchStyle.outlineColor !== 'transparent';
          const colorOpen = searchStyle.outlineColor.indexOf('(');
          const colorClose = searchStyle.outlineColor.lastIndexOf(')');
          const colorComponents = colorOpen >= 0 && colorClose > colorOpen
            ? searchStyle.outlineColor.slice(colorOpen + 1, colorClose)
              .split(/[ ,/]+/u)
              .filter(Boolean)
            : null;
          const searchRingOpaque = searchRingRendered
            && (!colorComponents || colorComponents.length < 4
              || Number(colorComponents[3]) >= 0.999);
          const searchFocusEvidence = {
            label: 'Saved Terms search',
            focused: searchAutoFocused,
            horizontallyContained: horizontalContainment(termsSearchField, termsDrawer),
            verticallyReachable: intersectsVertically(termsSearchField, termsDrawer),
            fullyVisible: fullyVisibleIn(termsSearchField, termsDrawer),
            ringRendered: searchRingRendered,
            ringExtent: searchRingExtent,
            ringVisible: searchRingRendered
              && fullyVisibleIn(termsSearchField, termsDrawer, searchRingExtent),
            ringOpaque: searchRingOpaque,
            outline: {
              width: searchOutlineWidth,
              offset: searchOutlineOffset,
              style: searchStyle.outlineStyle,
              color: searchStyle.outlineColor,
            },
            pageNoHorizontalOverflow: pageHasNoHorizontalOverflow(),
            scrollportNoHorizontalOverflow: termsDrawer.scrollWidth
              <= termsDrawer.clientWidth + 1,
            rect: rectSnapshot(termsSearchField),
            scrollport: visibleScrollport(termsDrawer),
          };
          const drawerHeaderRect = rectSnapshot(termsHeader);
          const drawerTitleRect = rectSnapshot(termsTitle);
          const drawerCloseRect = rectSnapshot(termsClose);
          const drawerSearchRect = rectSnapshot(termsSearchField);
          const drawerPrimaryGeometryPositive = [
            drawerHeaderRect,
            drawerTitleRect,
            drawerCloseRect,
            drawerSearchRect,
          ].every((rect) => rect.width > 0 && rect.height > 0);
          const drawerPrimaryGeometryContained = [termsHeader, termsTitle, termsClose, termsSearchField]
            .every((element) => horizontalContainment(element, termsDrawer));
          ensure(
            searchFocusEvidence.focused
              && searchFocusEvidence.fullyVisible
              && searchFocusEvidence.ringRendered
              && searchFocusEvidence.ringExtent > 0
              && searchFocusEvidence.ringVisible
              && searchFocusEvidence.ringOpaque
              && drawerPrimaryGeometryPositive
              && drawerPrimaryGeometryContained,
            'Saved Terms search did not render a complete opaque ring inside the drawer: '
              + JSON.stringify({
                searchFocusEvidence,
                drawerPrimaryGeometryPositive,
                drawerPrimaryGeometryContained,
                drawerHeaderRect,
                drawerTitleRect,
                drawerCloseRect,
                drawerSearchRect,
              }),
          );

          const sampleCard = termsDrawer.querySelector('.saved-term-card');
          const sampleCopy = sampleCard?.querySelector(
            '[data-saved-term-copy-action="combined"]',
          );
          const sampleRemove = sampleCard?.querySelector(
            '[data-saved-term-remove-id]',
          );
          const termsFooter = termsDrawer.querySelector('.saved-term-transfer');
          const exportAction = findButton(termsFooter, '导出备份');
          const importAction = findButton(termsFooter, '导入备份');
          ensure(
            sampleCard?.textContent?.includes('passport information page')
              && sampleCopy
              && sampleRemove
              && termsFooter
              && exportAction
              && importAction
              && !sampleCopy.disabled
              && !sampleRemove.disabled
              && !exportAction.disabled
              && !importAction.disabled,
            'Saved Terms sample controls or backup actions are missing',
          );
          const termsDrawerStyle = getComputedStyle(termsDrawer);
          const termsBodyStyle = getComputedStyle(termsBody);
          const termsListStyle = getComputedStyle(termsList);
          const drawerScrollOwnership = {
            outerOverflowY: termsDrawerStyle.overflowY,
            bodyOverflowY: termsBodyStyle.overflowY,
            listOverflowY: termsListStyle.overflowY,
            outerHasVerticalRange: termsDrawer.scrollHeight > termsDrawer.clientHeight + 1,
            bodyHasVerticalRange: termsBody.scrollHeight > termsBody.clientHeight + 1,
            listHasVerticalRange: termsList.scrollHeight > termsList.clientHeight + 1,
          };
          drawerScrollOwnership.singleVerticalOwner =
            drawerScrollOwnership.outerOverflowY === 'auto'
            && drawerScrollOwnership.bodyOverflowY === 'visible'
            && drawerScrollOwnership.listOverflowY === 'visible'
            && drawerScrollOwnership.outerHasVerticalRange
            && !drawerScrollOwnership.bodyHasVerticalRange
            && !drawerScrollOwnership.listHasVerticalRange;
          ensure(
            drawerScrollOwnership.singleVerticalOwner,
            'Saved Terms did not expose one bounded vertical scroll owner at 200 percent: '
              + JSON.stringify(drawerScrollOwnership),
          );
          const drawerScrollBefore = {
            top: termsDrawer.scrollTop,
            left: termsDrawer.scrollLeft,
          };
          const revealDrawerEvidence = (target, label) => revealEvidence(
            target,
            termsDrawer,
            label,
            { focusBeforeAlign: true },
          );
          const drawerFocusEvidence = {
            sampleCopy: await revealDrawerEvidence(
              sampleCopy,
              'Saved Terms sample copy control',
            ),
            sampleRemove: await revealDrawerEvidence(
              sampleRemove,
              'Saved Terms sample remove control',
            ),
            exportAction: await revealDrawerEvidence(
              exportAction,
              'Saved Terms export action',
            ),
            importAction: await revealDrawerEvidence(
              importAction,
              'Saved Terms import action',
            ),
          };
          const drawerScrollAfter = {
            top: termsDrawer.scrollTop,
            left: termsDrawer.scrollLeft,
          };
          const drawerVerticalScrollChanged = drawerScrollAfter.top > drawerScrollBefore.top;
          const drawerScrollLeftStayedZero = Math.abs(drawerScrollBefore.left) <= 1
            && Math.abs(drawerScrollAfter.left) <= 1;
          const drawerNoHorizontalOverflow = [
            termsDrawer,
            termsBody,
            termsList,
            sampleCard,
            termsFooter,
            termsFooter.querySelector('.saved-term-transfer__actions'),
          ].every((region) => region.scrollWidth <= region.clientWidth + 1)
            && pageHasNoHorizontalOverflow();
          const drawerFooterReachable = intersectsVertically(termsFooter, termsDrawer)
            && drawerFocusEvidence.exportAction.fullyVisible
            && drawerFocusEvidence.importAction.fullyVisible;
          ensure(
            drawerVerticalScrollChanged
              && drawerScrollLeftStayedZero
              && drawerNoHorizontalOverflow
              && drawerFooterReachable
              && Object.values(drawerFocusEvidence).every((evidence) => (
                evidence.focused
                  && evidence.fullyVisible
                  && evidence.ringRendered
                  && evidence.ringVisible
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow
              )),
            'Saved Terms sample and footer were not reachable through vertical-only drawer scrolling: '
              + JSON.stringify({
                drawerScrollBefore,
                drawerScrollAfter,
                drawerVerticalScrollChanged,
                drawerScrollLeftStayedZero,
                drawerNoHorizontalOverflow,
                drawerFooterReachable,
                drawerFocusEvidence,
                termsFooterRect: rectSnapshot(termsFooter),
                termsDrawerScrollport: visibleScrollport(termsDrawer),
              }),
          );

          const savedTermsBeforeImport = [...termsDrawer.querySelectorAll('.saved-term-card')]
            .map((card) => card.textContent?.trim() || '');
          ensure(
            savedTermsBeforeImport.length === 1
              && savedTermsBeforeImport[0].includes('passport information page'),
            'Saved Terms import-preview fixture did not begin with exactly one sample term',
          );
          await dispatchTrustedClick(
            18,
            importAction,
            termsDrawer,
            'Saved Terms import preview',
          );
          const importTrustReview = await waitFor(
            () => termsDrawer.querySelector('#term-import-trust-review'),
            'Saved Terms import trust review',
          );
          const importPreview = importTrustReview.closest('.saved-term-transfer__confirm');
          const importTitle = importPreview?.querySelector('h3#term-import-title');
          const importTrustTitle = importTrustReview.querySelector('#term-import-trust-title');
          const importTrustSummary = importTrustReview.querySelector('#term-import-trust-summary');
          const importDowngradeWarning = importTrustReview.querySelector(
            '#term-import-downgrade-warning',
          );
          const importSummaryValues = [...(importPreview?.querySelectorAll(
            '.saved-term-import-summary strong',
          ) || [])].map((value) => value.textContent?.trim() || '');
          const importCancel = importPreview ? findButton(importPreview, '取消') : null;
          const importConfirm = importPreview ? findButton(importPreview, '确认导入') : null;
          ensure(
            importPreview
              && importTitle
              && importTrustTitle
              && importTrustSummary
              && importDowngradeWarning
              && importCancel
              && importConfirm
              && importSummaryValues.join(',') === '1,0,1,2'
              && importDowngradeWarning.textContent?.includes('1 条')
              && importDowngradeWarning.textContent?.includes('来源状态未知'),
            'Saved Terms import preview did not expose the deterministic downgraded-trust review',
          );
          await waitFor(
            () => document.activeElement === importTrustReview,
            'Saved Terms trust review focus handoff',
          );
          const importTrustAutoFocused = document.activeElement === importTrustReview;
          const importConfirmInitiallyFocused = document.activeElement === importConfirm;
          const importTrustLabelled = importTrustReview.getAttribute('role') === 'note'
            && importTrustReview.getAttribute('tabindex') === '-1'
            && importTrustReview.getAttribute('aria-labelledby') === 'term-import-trust-title'
            && document.getElementById('term-import-trust-title') === importTrustTitle;
          const importConfirmDescriptionIds = (importConfirm.getAttribute('aria-describedby') || '')
            .split(/\\s+/u)
            .filter(Boolean);
          const importConfirmDescriptionNodes = importConfirmDescriptionIds
            .map((id) => document.getElementById(id));
          const importConfirmDescribedByTrust = importConfirmDescriptionIds.includes(
            'term-import-trust-summary',
          )
            && importConfirmDescriptionIds.includes('term-import-downgrade-warning')
            && importConfirmDescriptionNodes.every((node) => (
              node instanceof HTMLElement && importTrustReview.contains(node)
            ));
          const warningPrecedesConfirm = Boolean(
            importDowngradeWarning.compareDocumentPosition(importConfirm)
              & Node.DOCUMENT_POSITION_FOLLOWING,
          );
          const importTrustFocusEvidence = {
            ...await focusedControlEvidence(
              importTrustReview,
              termsDrawer,
              'Saved Terms import trust review',
              { focusTarget: false, requireFullyVisible: false },
            ),
            fullyVisible: fullyVisibleIn(importTrustReview, termsDrawer),
          };
          const importTrustScrollLeftBefore = termsDrawer.scrollLeft;
          alignTargetInScrollport(importTrustReview, termsDrawer, {
            block: 'start',
            inset: importTrustFocusEvidence.ringExtent + 1,
          });
          const importTrustTopEvidence = await waitForStableEvidence(
            () => {
              const rect = rectSnapshot(importTrustReview);
              const port = visibleScrollport(termsDrawer);
              return {
                rect,
                port,
                scroll: readScrollPosition(termsDrawer),
                ringReachable: rect.top - importTrustFocusEvidence.ringExtent
                  >= port.top - 1,
                horizontalRingVisible: horizontalContainment(
                  importTrustReview,
                  termsDrawer,
                  importTrustFocusEvidence.ringExtent,
                ),
              };
            },
            (snapshot) => snapshot.ringReachable
              && snapshot.horizontalRingVisible
              && Math.abs(snapshot.scroll.left) <= 1,
            'Saved Terms import trust top ring geometry',
          );
          const importTrustTopRingReachable = importTrustTopEvidence.ringReachable;
          const importTrustTopHorizontalRingVisible = importTrustTopEvidence
            .horizontalRingVisible;
          alignTargetInScrollport(importTrustReview, termsDrawer, {
            block: 'end',
            inset: importTrustFocusEvidence.ringExtent + 1,
          });
          const importTrustBottomEvidence = await waitForStableEvidence(
            () => {
              const rect = rectSnapshot(importTrustReview);
              const port = visibleScrollport(termsDrawer);
              return {
                rect,
                port,
                scroll: readScrollPosition(termsDrawer),
                ringReachable: rect.bottom + importTrustFocusEvidence.ringExtent
                  <= port.bottom + 1,
                horizontalRingVisible: horizontalContainment(
                  importTrustReview,
                  termsDrawer,
                  importTrustFocusEvidence.ringExtent,
                ),
              };
            },
            (snapshot) => snapshot.ringReachable
              && snapshot.horizontalRingVisible
              && Math.abs(snapshot.scroll.left) <= 1,
            'Saved Terms import trust bottom ring geometry',
          );
          const importTrustBottomRingReachable = importTrustBottomEvidence.ringReachable;
          const importTrustBottomHorizontalRingVisible = importTrustBottomEvidence
            .horizontalRingVisible;
          const importTrustRingPerimeterReachable = importTrustFocusEvidence.ringRendered
            && importTrustTopRingReachable
            && importTrustBottomRingReachable
            && importTrustTopHorizontalRingVisible
            && importTrustBottomHorizontalRingVisible
            && Math.abs(importTrustScrollLeftBefore) <= 1
            && Math.abs(termsDrawer.scrollLeft) <= 1;
          importTrustFocusEvidence.topRingReachable = importTrustTopRingReachable;
          importTrustFocusEvidence.bottomRingReachable = importTrustBottomRingReachable;
          importTrustFocusEvidence.horizontalRingVisible = importTrustTopHorizontalRingVisible
            && importTrustBottomHorizontalRingVisible;
          importTrustFocusEvidence.ringPerimeterReachable = importTrustRingPerimeterReachable;
          importTrustFocusEvidence.scrollLeftStayedZero = Math.abs(importTrustScrollLeftBefore) <= 1
            && Math.abs(termsDrawer.scrollLeft) <= 1;
          ensure(
            importTrustAutoFocused
              && !importConfirmInitiallyFocused
              && importTrustLabelled
              && importConfirmDescribedByTrust
              && warningPrecedesConfirm
              && importTrustFocusEvidence.focused
              && importTrustFocusEvidence.focusVisible
              && importTrustFocusEvidence.ringRendered
              && importTrustFocusEvidence.horizontallyContained
              && importTrustFocusEvidence.verticallyReachable
              && importTrustFocusEvidence.ringPerimeterReachable
              && importTrustFocusEvidence.scrollLeftStayedZero
              && importTrustFocusEvidence.pageNoHorizontalOverflow
              && importTrustFocusEvidence.scrollportNoHorizontalOverflow,
            'Saved Terms import trust review was not the labelled, visible decision focus: '
              + JSON.stringify({
                importTrustAutoFocused,
                importConfirmInitiallyFocused,
                importTrustLabelled,
                importConfirmDescriptionIds,
                importConfirmDescribedByTrust,
                warningPrecedesConfirm,
                importTrustFocusEvidence,
              }),
          );

          await dispatchTrustedClick(
            19,
            importCancel,
            termsDrawer,
            'Saved Terms import cancel',
          );
          await waitFor(
            () => !termsDrawer.querySelector('#term-import-trust-review'),
            'Saved Terms import preview cancellation',
          );
          await waitFor(
            () => document.activeElement === importAction,
            'Saved Terms import action focus restoration',
          );
          const savedTermsAfterCancel = [...termsDrawer.querySelectorAll('.saved-term-card')]
            .map((card) => card.textContent?.trim() || '');
          const importCancellationMessage = '已取消导入；术语库没有变化。';
          const importCancellationLiveOwners = [...new Set([
            ...termsDrawer.querySelectorAll('[role="status"], [role="alert"], [aria-live]'),
          ])].filter((node) => (
            node.textContent?.trim() === importCancellationMessage
              && node.getAttribute('aria-live') !== 'off'
          ));
          const importCancellation = {
            message: importCancellationMessage,
            liveOwnerCount: importCancellationLiveOwners.length,
            termCountBefore: savedTermsBeforeImport.length,
            termCountAfter: savedTermsAfterCancel.length,
            termsUnchanged: JSON.stringify(savedTermsAfterCancel)
              === JSON.stringify(savedTermsBeforeImport),
            previewRemoved: !termsDrawer.querySelector('#term-import-trust-review')
              && !findButton(termsDrawer, '确认导入'),
            focusReturnedToImport: document.activeElement === importAction,
          };
          ensure(
            importCancellation.liveOwnerCount === 1
              && importCancellation.termCountBefore === 1
              && importCancellation.termCountAfter === 1
              && importCancellation.termsUnchanged
              && importCancellation.previewRemoved
              && importCancellation.focusReturnedToImport,
            'Saved Terms import cancellation did not leave one unchanged, announced term state: '
              + JSON.stringify(importCancellation),
          );

          await dispatchTrustedKey(20, 'Tab', termsDrawer, 'Saved Terms Tab 1');
          await dispatchTrustedKey(21, 'Tab', termsDrawer, 'Saved Terms Tab 2');
          await dispatchTrustedKey(22, 'Escape', termsDrawer, 'Saved Terms drawer');
          await waitFor(
            () => !document.querySelector('#saved-terms-drawer'),
            'Saved Terms Escape dismissal',
          );
          await waitFor(
            () => document.activeElement === savedTermsTrigger,
            'Saved Terms trigger focus restoration',
          );
          const savedTermsFocusReturnedToTrigger = document.activeElement === savedTermsTrigger;
          const backgroundStateRestored = [...backgroundStateBeforeDrawer.entries()]
            .every(([node, state]) => (
              node.inert === state.inert
                && node.getAttribute('aria-hidden') === state.ariaHidden
          ));
          ensure(backgroundStateRestored, 'Saved Terms dismissal did not restore background state');
          const deadlineDisclosureProof = await exerciseDeadlineDisclosure();
          const appCountersAfter = readCompletedResultAppCounters();
          ensure(
            Object.values(appCountersAfter).every((value) => value === 0),
            'Completed-result inspection activated an App action',
          );
          ensure(
            trustedInputEvidence.rejectedStep?.rejected === true
              && trustedInputEvidence.rejectedStep?.nextAcceptedStep === 1
              && trustedInputEvidence.mouse.length === 21
              && trustedInputEvidence.mouse.every((evidence) => (
                evidence.isTrusted
                  && evidence.targetOwned
                  && evidence.type === 'click'
                  && evidence.clientX === evidence.point.x
                  && evidence.clientY === evidence.point.y
              ))
              && trustedInputEvidence.keyboard.length === 3
              && trustedInputEvidence.keyboard.every((evidence) => (
                evidence.isTrusted
                  && evidence.eventTargetOwned
                  && evidence.activeTargetOwned
              ))
              && trustedInputEvidence.keyboard.slice(0, 2).every((evidence) => (
                evidence.key === 'Tab'
                  && evidence.focusMoved
                  && evidence.focusRemainedOwned
                  && evidence.focusVisible
              ))
              && trustedInputEvidence.escape?.isTrusted === true
              && trustedInputEvidence.escape?.key === 'Escape'
              && trustedInputEvidence.escape?.step === 22,
            'Completed-result native interactions were not fully trusted',
          );

          completedResultTextScale = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            preview: {
              sourceMatchesPreview,
              headline: headline.textContent.trim(),
              actionCount: completedCheckboxes.length,
            },
            appCounters: {
              before: appCountersBefore,
              after: appCountersAfter,
            },
            trustedInteractions: trustedInputEvidence,
            geometry: {
              ...initialResultGeometry,
              naturalWorkspaceNonzero,
              sourcePaneRect,
              actionPaneRect,
              sourcePaneNoHorizontalOverflow,
              actionPaneNoHorizontalOverflow,
            },
            summary: {
              headlineText: headline.textContent.trim(),
              deadlineText: deadlineSummary.textContent.trim(),
              replyText: initialReplyStatusText,
              evidence: summaryEvidence,
            },
            disclosures: {
              deadline: deadlineDisclosureProof,
            },
            panes: {
              buttonCount: paneButtons.length,
              sourcePaneActive,
              actionPaneHiddenForSource,
              actionPaneActive,
              sourcePaneHiddenForAction,
              linkedEvidenceRoundTrip,
              outerResultVerticalScrollChanged,
              outerResultScrollLeftStayedZero,
              focusEvidence: paneFocusEvidence,
            },
            header: {
              controlCount: headerControls.length,
              controlsPositive: headerControlsPositive,
              controlsDoNotOverlap: headerControlsDoNotOverlap,
              visualDomOrder: headerVisualDomOrder,
              noHorizontalOverflow: headerNoHorizontalOverflow,
              keyboardModalityPrimed: nativeKeyboardModalityPrimed,
              allFocusEvidenceVisible: headerFocusVisible,
              focusEvidence: headerFocusEvidence,
              rects: headerControlRects,
            },
            actions: {
              checkboxCount: completedCheckboxes.length,
              allEnabled: completedCheckboxes.every((checkbox) => !checkbox.disabled),
              allChecked: allActionCheckboxesChecked,
              allReversible: allActionCheckboxesReversible,
              partialStatusRetained: Boolean(statusBadge),
              pendingVerificationRetained: Boolean(pendingVerificationTrigger),
              selfReportedAllComplete: actionProgress.querySelector('strong')
                .textContent.includes('你已标记全部 4 项完成'),
              selfReportedCopyHonest: actionProgress.querySelector('small')
                .textContent.includes('这是你的自报记录')
                && actionProgress.querySelector('small')
                  .textContent.includes('不代表 Slipstream 已验证现实结果'),
              completedReturnLabel: completedReturn.textContent.trim(),
              completedReturnUndoConsequence,
              processingCompletionStillDistinct,
              processingCompletionLabel: processingCompletion.textContent.trim(),
              focusEvidence: completedFocusEvidence,
            },
            footer: {
              buttonCount: footerButtonsBeforeCompletion.length,
              allEnabled: footerButtonsBeforeCompletion.every((button) => !button.disabled),
              allPositive: footerActionsPositive,
              labels: footerButtonsBeforeCompletion.map((button) => button.textContent.trim()),
              reanalyzeVisible: rectSnapshot(reanalyze).width > 0
                && rectSnapshot(reanalyze).height > 0,
              allFocusEvidenceVisible: footerFocusVisible,
              focusEvidence: footerFocusEvidence,
            },
            savedTerms: {
              role: termsDrawer.getAttribute('role'),
              ariaModal: termsDrawer.getAttribute('aria-modal'),
              backgroundIsolated,
              triggerOwnedByInertBackground,
              searchAutoFocused,
              searchFocusEvidence,
              primaryGeometryPositive: drawerPrimaryGeometryPositive,
              primaryGeometryContained: drawerPrimaryGeometryContained,
              scrollOwnership: drawerScrollOwnership,
              sampleCopyReachable: drawerFocusEvidence.sampleCopy.fullyVisible,
              sampleRemoveReachable: drawerFocusEvidence.sampleRemove.fullyVisible,
              exportReachable: drawerFocusEvidence.exportAction.fullyVisible,
              importReachable: drawerFocusEvidence.importAction.fullyVisible,
              outerVerticalScrollChanged: drawerVerticalScrollChanged,
              outerScrollLeftStayedZero: drawerScrollLeftStayedZero,
              noHorizontalOverflow: drawerNoHorizontalOverflow,
              footerReachable: drawerFooterReachable,
              importTrustPreview: {
                title: importTitle.textContent.trim(),
                summaryValues: importSummaryValues,
                downgradedProvenanceCount: 1,
                autoFocused: importTrustAutoFocused,
                confirmInitiallyFocused: importConfirmInitiallyFocused,
                labelled: importTrustLabelled,
                confirmDescriptionIds: importConfirmDescriptionIds,
                confirmDescribedByTrust: importConfirmDescribedByTrust,
                warningPrecedesConfirm,
                focusEvidence: importTrustFocusEvidence,
              },
              importCancellation,
              escapeClosed: !document.querySelector('#saved-terms-drawer'),
              focusReturnedToTrigger: savedTermsFocusReturnedToTrigger,
              backgroundStateRestored,
              focusEvidence: drawerFocusEvidence,
            },
          };
        }

        if (isSettingsTransitionRun) {
          const textScaleFocusEvidence = {};
          const recordTextScaleFocus = (key, dialog, target) => {
            if (!isSettingsTextScaleRun) return;
            textScaleFocusEvidence[key] = focusEvidenceWithinDialog(dialog, target, key);
          };
          click(document.querySelector('[aria-label="打开设置"]'));
          const panel = await waitFor(
            () => document.querySelector('.settings-panel'),
            'Settings panel',
          );
          const input = await waitFor(
            () => document.querySelector('#provider-connection-input'),
            'provider connection input',
          );
          const inputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          ).set;
          const returnButton = panel.querySelector('[data-quit-return-focus]');
          ensure(returnButton, 'Settings return action is missing');
          let settingsShellTextScale = null;
          let saveButton = null;
          if (isSettingsTextScaleRun) {
            const scrollport = await waitFor(
              () => panel.querySelector('.settings-panel__scroll'),
              'Settings shell scrollport',
            );
            ensure(
              window.innerWidth === 200 && window.innerHeight === 200,
              'Settings shell fixture did not expose an exact 200x200 CSS viewport: '
                + window.innerWidth + 'x' + window.innerHeight,
            );
            const requireShellTarget = (target, label) => {
              ensure(target instanceof HTMLElement, 'Missing Settings shell target: ' + label);
              return target;
            };
            const checkedRadio = (group, label) => requireShellTarget(
              group?.querySelector('[role="radio"][aria-checked="true"]'),
              label,
            );
            const analysisLocationGroup = requireShellTarget(
              panel.querySelector('.analysis-location-options[role="radiogroup"]'),
              'analysis location radiogroup',
            );
            const onlineProviderGroup = requireShellTarget(
              panel.querySelector('.backend-options[role="radiogroup"]'),
              'online provider radiogroup',
            );
            const verificationGroup = requireShellTarget(
              panel.querySelector('.verification-policy[role="radiogroup"]'),
              'verification radiogroup',
            );
            const analysisLocationRadio = checkedRadio(
              analysisLocationGroup,
              'checked analysis location radio',
            );
            const onlineProviderRadio = checkedRadio(
              onlineProviderGroup,
              'checked online provider radio',
            );
            const verificationRadio = checkedRadio(
              verificationGroup,
              'checked verification radio',
            );
            const modelInput = requireShellTarget(
              panel.querySelector('#provider-model-input'),
              'model input',
            );
            const connectionTestButton = await waitFor(
              () => {
                const candidate = panel.querySelector('.provider-connection-test-button');
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled shell connection test action',
            );
            const secondarySummary = requireShellTarget(
              panel.querySelector('.secondary-settings > summary'),
              'secondary Settings summary',
            );
            const advancedSummary = requireShellTarget(
              panel.querySelector('.secondary-settings__advanced-summary'),
              'advanced Settings summary',
            );
            const monitoringSwitch = requireShellTarget(
              panel.querySelector('.clipboard-monitor-toggle input[role="switch"]'),
              'clipboard monitoring switch',
            );
            const monitoringSwitchVisual = requireShellTarget(
              monitoringSwitch.nextElementSibling,
              'clipboard monitoring switch ring',
            );
            const clipboardShortcut = requireShellTarget(
              panel.querySelector('#clipboard-shortcut-control.shortcut-recorder'),
              'clipboard shortcut recorder',
            );
            const screenshotShortcut = requireShellTarget(
              panel.querySelector('#screenshot-shortcut-control.shortcut-recorder'),
              'screenshot shortcut recorder',
            );
            const supportRefresh = await waitFor(
              () => {
                const candidate = panel.querySelector(
                  '.support-diagnostics__actions button.secondary',
                );
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled support refresh control',
            );
            const supportCopy = await waitFor(
              () => {
                const candidate = panel.querySelector(
                  '[data-support-diagnostics-copy-action]',
                );
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled support copy control',
            );
            const resetButton = requireShellTarget(
              panel.querySelector(
                '.settings-reset-trigger, button[aria-label="恢复默认设置"]',
              ),
              'full data reset control',
            );
            const shellFocusEvidence = {};
            const recordShellFocus = async (
              key,
              target,
              targetScrollport = scrollport,
              options = {},
            ) => {
              const evidence = await focusedControlEvidence(
                target,
                targetScrollport,
                key,
                options,
              );
              evidence.shellScrollLeft = scrollport.scrollLeft;
              shellFocusEvidence[key] = evidence;
            };
            await recordShellFocus('return', returnButton, panel);
            await recordShellFocus('locationRadio', analysisLocationRadio);
            await recordShellFocus('providerRadio', onlineProviderRadio);
            await recordShellFocus('credentialInput', input);
            await recordShellFocus('modelInput', modelInput);
            await recordShellFocus('connectionTest', connectionTestButton);
            await recordShellFocus('secondarySummary', secondarySummary);
            await recordShellFocus(
              'monitoringSwitch',
              monitoringSwitch,
              scrollport,
              { visualTarget: monitoringSwitchVisual },
            );
            await recordShellFocus('verificationRadio', verificationRadio);
            await recordShellFocus('clipboardShortcutRecorder', clipboardShortcut);
            await recordShellFocus('screenshotShortcutRecorder', screenshotShortcut);
            await recordShellFocus('supportRefresh', supportRefresh);
            await recordShellFocus('supportCopy', supportCopy);
            await recordShellFocus('reset', resetButton);

            inputValueSetter.call(input, 'fixture-not-a-real-secret');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            saveButton = await waitFor(
              () => {
                const candidate = input.parentElement?.parentElement
                  ?.querySelector('.setting-save-button');
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled connection save action',
            );
            await recordShellFocus('credentialSave', saveButton);

            const modeSummary = requireShellTarget(
              panel.querySelector('.settings-mode-summary'),
              'mode summary',
            );
            const modeSummaryLabel = requireShellTarget(
              modeSummary.querySelector('.settings-mode-summary__label'),
              'mode summary label',
            );
            const modeSummaryDetail = requireShellTarget(
              modeSummary.querySelector('.settings-mode-summary__detail'),
              'mode summary detail',
            );
            alignTargetInScrollport(modeSummary, scrollport);
            await waitForStableTargetGeometry(
              modeSummary,
              scrollport,
              'settings mode summary geometry',
            );
            const modeSummaryLabelRect = rectSnapshot(modeSummaryLabel);
            const modeSummaryDetailRect = rectSnapshot(modeSummaryDetail);
            const modeSummaryGeometry = {
              label: modeSummaryLabelRect,
              detail: modeSummaryDetailRect,
              stacked: modeSummaryDetailRect.top >= modeSummaryLabelRect.bottom - 1,
            };

            const privacyBadge = requireShellTarget(
              analysisLocationGroup.querySelector('em'),
              'analysis location privacy badge',
            );
            const privacyTitle = requireShellTarget(
              privacyBadge.closest('[role="radio"]')?.querySelector('strong'),
              'analysis location privacy title',
            );
            alignTargetInScrollport(privacyBadge, scrollport);
            await waitForStableTargetGeometry(
              privacyBadge,
              scrollport,
              'settings privacy badge geometry',
            );
            const privacyBadgeRect = rectSnapshot(privacyBadge);
            const privacyTitleRect = rectSnapshot(privacyTitle);
            const privacyBadgeGeometry = {
              badge: privacyBadgeRect,
              title: privacyTitleRect,
              intersectionArea: overlapArea(privacyBadgeRect, privacyTitleRect),
            };

            const settingEditorRows = [...panel.querySelectorAll('.setting-editor-actions')];
            ensure(settingEditorRows.length >= 2, 'Settings shell is missing editor action rows');
            const settingEditorEvidence = settingEditorRows.map((row, index) => {
              const status = requireShellTarget(
                row.querySelector(':scope > .setting-save-status'),
                'setting editor status ' + index,
              );
              const buttons = [...row.querySelectorAll('button')];
              ensure(buttons.length > 0, 'Setting editor row has no save action: ' + index);
              const controlRegion = row.querySelector(':scope > div') || buttons[0];
              const rowRect = rectSnapshot(row);
              const statusRect = rectSnapshot(status);
              const controlRect = rectSnapshot(controlRegion);
              const buttonRects = buttons.map(rectSnapshot);
              return {
                index,
                row: rowRect,
                status: statusRect,
                controls: controlRect,
                buttons: buttonRects,
                stacked: controlRect.top >= statusRect.bottom - 1,
                meaningfulStatusWidth: statusRect.width >= 72,
                meaningfulControlWidth: controlRect.width >= 72,
                meaningfulButtonWidths: buttonRects.every((rect) => rect.width >= 64),
                textNotClipped: status.scrollWidth <= status.clientWidth + 1
                  && buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
                noHorizontalOverflow: row.scrollWidth <= row.clientWidth + 1,
              };
            });
            const settingEditorsGeometry = {
              rowCount: settingEditorEvidence.length,
              rows: settingEditorEvidence,
              allRowsStacked: settingEditorEvidence.every((row) => row.stacked),
              allWidthsMeaningful: settingEditorEvidence.every((row) => (
                row.meaningfulStatusWidth
                  && row.meaningfulControlWidth
                  && row.meaningfulButtonWidths
              )),
              allTextVisible: settingEditorEvidence.every((row) => row.textNotClipped),
              noHorizontalOverflow: settingEditorEvidence
                .every((row) => row.noHorizontalOverflow),
            };

            const supportGrid = requireShellTarget(
              panel.querySelector('.support-diagnostics__grid'),
              'support diagnostics grid',
            );
            alignTargetInScrollport(supportGrid, scrollport);
            await waitForStableTargetGeometry(
              supportGrid,
              scrollport,
              'settings support grid geometry',
            );
            const supportCards = [...supportGrid.querySelectorAll(':scope > div')];
            ensure(supportCards.length >= 4, 'Support diagnostics grid is incomplete');
            const supportCardRects = supportCards.map(rectSnapshot);
            const supportTextEvidence = supportCards.flatMap((card, cardIndex) => (
              [...card.querySelectorAll('strong, small')].map((target) => {
                const style = getComputedStyle(target);
                return {
                  cardIndex,
                  tag: target.tagName.toLowerCase(),
                  whiteSpace: style.whiteSpace,
                  overflowWrap: style.overflowWrap,
                  wraps: style.whiteSpace !== 'nowrap'
                    && ['anywhere', 'break-word'].includes(style.overflowWrap),
                  noClipping: target.scrollWidth <= target.clientWidth + 1,
                  rect: rectSnapshot(target),
                };
              })
            ));
            const supportGridColumns = getComputedStyle(supportGrid)
              .gridTemplateColumns.split(' ').filter(Boolean);
            const supportGridGeometry = {
              computedColumns: supportGridColumns,
              cardCount: supportCards.length,
              cards: supportCardRects,
              oneColumn: supportGridColumns.length === 1
                && supportCardRects.every((rect) => (
                  Math.abs(rect.left - supportCardRects[0].left) <= 1
                    && Math.abs(rect.right - supportCardRects[0].right) <= 1
                )),
              cardsVerticallyStacked: supportCardRects.every((rect, index) => (
                index === 0 || rect.top >= supportCardRects[index - 1].bottom - 1
              )),
              strongSmallWrap: supportTextEvidence.length >= supportCards.length * 2
                && supportTextEvidence.every((textEvidence) => textEvidence.wraps),
              strongSmallNoClipping: supportTextEvidence
                .every((textEvidence) => textEvidence.noClipping),
              noHorizontalOverflow: supportGrid.scrollWidth <= supportGrid.clientWidth + 1,
              textEvidence: supportTextEvidence,
            };

            alignTargetInScrollport(advancedSummary, scrollport);
            await waitForStableTargetGeometry(
              advancedSummary,
              scrollport,
              'settings advanced summary geometry',
            );
            const advancedSummaryRect = rectSnapshot(advancedSummary);
            const advancedSummaryGeometry = {
              rect: advancedSummaryRect,
              minimumHeight: 32,
              meetsMinimumHeight: advancedSummaryRect.height >= 32,
              noHorizontalClipping: advancedSummary.scrollWidth
                <= advancedSummary.clientWidth + 1,
            };
            const defectSpecificLayoutPasses = modeSummaryGeometry.stacked
              && privacyBadgeGeometry.intersectionArea === 0
              && settingEditorsGeometry.allRowsStacked
              && settingEditorsGeometry.allWidthsMeaningful
              && settingEditorsGeometry.allTextVisible
              && settingEditorsGeometry.noHorizontalOverflow
              && supportGridGeometry.oneColumn
              && supportGridGeometry.cardsVerticallyStacked
              && supportGridGeometry.strongSmallWrap
              && supportGridGeometry.strongSmallNoClipping
              && supportGridGeometry.noHorizontalOverflow
              && advancedSummaryGeometry.meetsMinimumHeight
              && advancedSummaryGeometry.noHorizontalClipping;
            const layoutEvidence = {
              modeSummary: modeSummaryGeometry,
              privacyBadge: privacyBadgeGeometry,
              settingEditors: settingEditorsGeometry,
              supportGrid: supportGridGeometry,
              advancedSummary: advancedSummaryGeometry,
              allDefectSpecificGeometryPasses: defectSpecificLayoutPasses,
            };
            ensure(
              defectSpecificLayoutPasses,
              'Settings shell retained a known 200x200 layout defect: '
                + JSON.stringify(layoutEvidence),
            );

            const majorSectionTargets = {
              modeSummary,
              analysisLocation: panel.querySelector('.analysis-location-section'),
              onlineProvider: panel.querySelector('.online-provider-section'),
              translationFallback: panel.querySelector('.translation-fallback'),
              credentialEditor: input,
              modelEditor: modelInput,
              connectionTest: panel.querySelector('.provider-connection-card'),
              secondarySettings: panel.querySelector('.secondary-settings'),
              monitoring: panel.querySelector('.clipboard-monitoring-setting'),
              verification: verificationGroup,
              shortcuts: panel.querySelector('.shortcut-settings'),
              support: panel.querySelector('.support-diagnostics'),
              reset: resetButton,
            };
            const sectionEvidence = {};
            for (const [key, target] of Object.entries(majorSectionTargets)) {
              requireShellTarget(target, key + ' major section');
              const evidence = await revealEvidence(
                target,
                scrollport,
                key,
                { focus: false },
              );
              evidence.shellScrollLeft = scrollport.scrollLeft;
              sectionEvidence[key] = evidence;
            }

            const radioGroupTargets = {
              analysisLocation: analysisLocationGroup,
              onlineProvider: onlineProviderGroup,
              verification: verificationGroup,
            };
            const radioGroups = Object.fromEntries(
              Object.entries(radioGroupTargets).map(([key, group]) => {
                const radios = [...group.querySelectorAll('[role="radio"]')];
                const checked = radios.filter(
                  (radio) => radio.getAttribute('aria-checked') === 'true',
                );
                const tabStops = radios.filter((radio) => radio.tabIndex === 0);
                return [key, {
                  label: group.getAttribute('aria-label'),
                  radioCount: radios.length,
                  checkedCount: checked.length,
                  tabStopCount: tabStops.length,
                  checkedText: checked[0]?.textContent?.trim() || '',
                  tabStopText: tabStops[0]?.textContent?.trim() || '',
                  tabStopMatchesChecked: checked.length === 1
                    && tabStops.length === 1
                    && checked[0] === tabStops[0],
                }];
              }),
            );
            const pageNoHorizontalOverflow = pageHasNoHorizontalOverflow();
            const scrollportNoHorizontalOverflow = scrollport.scrollWidth
              <= scrollport.clientWidth + 1;
            const scrollLeftStayedZero = Object.values(shellFocusEvidence)
              .every((evidence) => Math.abs(evidence.shellScrollLeft) <= 1)
              && Object.values(sectionEvidence)
                .every((evidence) => Math.abs(evidence.shellScrollLeft) <= 1);
            const allSectionsReachable = Object.values(sectionEvidence)
              .every((evidence) => (
                evidence.verticallyReachable
                  && evidence.horizontallyContained
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow
              ));
            const allFocusEvidenceVisible = Object.values(shellFocusEvidence)
              .every((evidence) => (
                evidence.focused
                  && evidence.focusVisible
                  && evidence.ringRendered
                  && evidence.ringVisible
                  && evidence.horizontallyContained
                  && evidence.verticallyReachable
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow
              ));
            const allRadioGroupsHaveAuthoritativeTabStop = Object.values(radioGroups)
              .every((group) => group.tabStopMatchesChecked);
            ensure(
              pageNoHorizontalOverflow
                && scrollportNoHorizontalOverflow
                && scrollLeftStayedZero
                && allSectionsReachable
                && allFocusEvidenceVisible
                && allRadioGroupsHaveAuthoritativeTabStop,
              'Settings shell was not fully reachable at 200x200 CSS pixels: '
                + JSON.stringify({
                  pageNoHorizontalOverflow,
                  scrollportNoHorizontalOverflow,
                  scrollLeftStayedZero,
                  allSectionsReachable,
                  allFocusEvidenceVisible,
                  allRadioGroupsHaveAuthoritativeTabStop,
                  sectionEvidence,
                  shellFocusEvidence,
                  radioGroups,
                }),
            );
            settingsShellTextScale = {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              scrollport: {
                clientWidth: scrollport.clientWidth,
                clientHeight: scrollport.clientHeight,
                scrollWidth: scrollport.scrollWidth,
                scrollHeight: scrollport.scrollHeight,
                maxScrollTop: Math.max(0, scrollport.scrollHeight - scrollport.clientHeight),
              },
              pageNoHorizontalOverflow,
              scrollportNoHorizontalOverflow,
              scrollLeftStayedZero,
              allSectionsReachable,
              allFocusEvidenceVisible,
              allRadioGroupsHaveAuthoritativeTabStop,
              sectionEvidence,
              focusEvidence: shellFocusEvidence,
              radioGroups,
              layoutEvidence,
            };
          } else {
            inputValueSetter.call(input, 'fixture-not-a-real-secret');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            saveButton = await waitFor(
              () => {
                const candidate = input.parentElement?.parentElement
                  ?.querySelector('.setting-save-button');
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled connection save action',
            );
          }
          const editedSibling = [...panel.children].find((node) => node.contains(input));
          ensure(editedSibling, 'Connection editor is not a direct Settings region');
          const originalSiblingState = {
            inert: editedSibling.inert,
            ariaHidden: editedSibling.getAttribute('aria-hidden'),
          };
          editedSibling.inert = true;
          editedSibling.setAttribute('aria-hidden', 'false');
          click(returnButton);

          const draftDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'draft transition dialog',
          );
          const draftBackdrop = draftDialog.parentElement;
          const draftSafe = draftDialog.querySelector('[data-settings-draft-safe]');
          const draftConfirm = draftDialog.querySelector('.settings-draft-exit-discard');
          await waitFor(() => document.activeElement === draftSafe, 'draft safe focus');
          recordTextScaleFocus('draftInitialSafe', draftDialog, draftSafe);
          const isolatedSiblings = [...panel.children].filter((node) => node !== draftBackdrop);
          const backgroundIsolated = isolatedSiblings.every((node) => (
            node.inert === true && node.getAttribute('aria-hidden') === 'true'
          ));
          const panelRect = panel.getBoundingClientRect();
          const draftRect = draftDialog.getBoundingClientRect();
          const backdropHit = document.elementFromPoint(panelRect.left + 4, panelRect.top + 4);
          const pointerBlocked = backdropHit === draftBackdrop || draftBackdrop.contains(backdropHit);
          const geometryContained = draftRect.left >= panelRect.left - 1
            && draftRect.right <= panelRect.right + 1
            && draftRect.top >= panelRect.top - 1
            && draftRect.bottom <= panelRect.bottom + 1
            && draftDialog.scrollWidth <= draftDialog.clientWidth + 1;

          window.dispatchEvent(new Event('slipstream:fixture-quit-request'));
          const appQuitLayer = await waitFor(
            () => document.querySelector('[data-app-top-layer="quit"]'),
            'AppQuit layer above draft transition',
            5000,
            () => ({
              demoQuitRequests: document.documentElement.dataset.demoQuitRequests || null,
              demoQuitDecisionRequests:
                document.documentElement.dataset.demoQuitDecisionRequests || null,
              demoQuitConfirmedDecisions:
                document.documentElement.dataset.demoQuitConfirmedDecisions || null,
              draftStillPresent: Boolean(document.querySelector('#settings-draft-exit-dialog')),
            }),
          );
          const appQuitCountersBeforeDismissal = {
            requests: Number(document.documentElement.dataset.demoQuitRequests || 0),
            decisions: Number(document.documentElement.dataset.demoQuitDecisionRequests || 0),
            confirmed: Number(document.documentElement.dataset.demoQuitConfirmedDecisions || 0),
          };
          ensure(
            appQuitCountersBeforeDismissal.requests === 1
              && appQuitCountersBeforeDismissal.decisions === 0
              && appQuitCountersBeforeDismissal.confirmed === 0,
            'AppQuit did not remain pending for the explicit user decision: '
              + JSON.stringify(appQuitCountersBeforeDismissal),
          );
          const appQuitSafe = appQuitLayer.querySelector('[data-quit-safe]');
          await waitFor(
            () => document.activeElement === appQuitSafe,
            'AppQuit focus above the draft transition',
          );
          pressKey('Escape');
          await waitFor(
            () => !document.querySelector('[data-app-top-layer="quit"]'),
            'AppQuit dismissal',
          );
          ensure(document.querySelector('#settings-draft-exit-dialog'),
            'AppQuit Escape also dismissed the underlying draft transition');
          await waitFor(() => document.activeElement === draftSafe, 'draft focus after AppQuit');

          draftConfirm.focus({ preventScroll: true });
          pressKey('Tab');
          ensure(document.activeElement === draftSafe, 'forward Tab did not wrap to the safe action');
          recordTextScaleFocus('draftTabFirstAction', draftDialog, draftSafe);
          draftSafe.focus({ preventScroll: true });
          pressKey('Tab', true);
          ensure(document.activeElement === draftConfirm, 'reverse Tab did not wrap to the final action');
          recordTextScaleFocus('draftShiftTabLastAction', draftDialog, draftConfirm);
          pressKey('Escape');
          await waitFor(
            () => !document.querySelector('#settings-draft-exit-dialog'),
            'draft transition dismissal',
          );
          await waitFor(() => document.activeElement === returnButton, 'exact draft trigger restoration');
          const priorSiblingRestored = editedSibling.inert === true
            && editedSibling.getAttribute('aria-hidden') === 'false';
          editedSibling.inert = originalSiblingState.inert;
          if (originalSiblingState.ariaHidden === null) editedSibling.removeAttribute('aria-hidden');
          else editedSibling.setAttribute('aria-hidden', originalSiblingState.ariaHidden);

          const baseTransitionEvidence = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            draftRole: draftDialog.getAttribute('role'),
            draftAriaModal: draftDialog.getAttribute('aria-modal'),
            backgroundIsolated,
            pointerBlocked,
            geometryContained,
            appQuitLifo: true,
            appQuitRequestDelivered: appQuitCountersBeforeDismissal.requests === 1,
            appQuitStayedPendingForExplicitDecision:
              appQuitCountersBeforeDismissal.decisions === 0
              && appQuitCountersBeforeDismissal.confirmed === 0,
            tabWrappedBothDirections: true,
            priorSiblingRestored,
          };

          if (fixtureRun === 'settings-draft-discard-native') {
            const settingsScrollport = panel.querySelector('.settings-panel__scroll');
            ensure(settingsScrollport, 'Settings draft-discard scrollport is missing');
            const deepSeekOption = [...panel.querySelectorAll('.backend-option-button')]
              .find((button) => button.textContent?.includes('DeepSeek'));
            const openAiOption = [...panel.querySelectorAll('.backend-option-button')]
              .find((button) => button.textContent?.includes('OpenAI'));
            ensure(deepSeekOption, 'DeepSeek backend choice is missing');
            ensure(openAiOption, 'OpenAI backend choice is missing');
            ensure(
              deepSeekOption.getAttribute('aria-checked') === 'true'
                && deepSeekOption.tabIndex === 0
                && openAiOption.getAttribute('aria-checked') === 'false'
                && openAiOption.tabIndex === -1,
              'DeepSeek was not the authoritative checked backend before ArrowRight',
            );
            const driveBackendArrowRight = () => {
              ensure(
                document.activeElement === deepSeekOption,
                'ArrowRight did not start from the authoritative DeepSeek radio',
              );
              const defaultPrevented = !deepSeekOption.dispatchEvent(new KeyboardEvent(
                'keydown',
                {
                  key: 'ArrowRight',
                  bubbles: true,
                  cancelable: true,
                },
              ));
              ensure(defaultPrevented, 'online provider radiogroup did not own ArrowRight');
              const targetedOpenAi = document.activeElement === openAiOption;
              ensure(targetedOpenAi, 'ArrowRight did not move focus from DeepSeek to OpenAI');
              return { owned: defaultPrevented, targetedOpenAi };
            };
            await focusedControlEvidence(
              deepSeekOption,
              settingsScrollport,
              'DeepSeek provider before keyboard transition',
            );
            const firstArrowRight = driveBackendArrowRight();
            const cancelledDiscardDialog = await waitFor(
              () => document.querySelector('#settings-draft-exit-dialog'),
              'first keyboard backend discard dialog',
            );
            await waitFor(
              () => document.activeElement
                === cancelledDiscardDialog.querySelector('[data-settings-draft-safe]'),
              'first keyboard backend dialog safe focus',
            );
            click(cancelledDiscardDialog.querySelector('[data-settings-draft-safe]'));
            await waitFor(
              () => !document.querySelector('#settings-draft-exit-dialog'),
              'cancelled keyboard backend dialog dismissal',
            );
            await waitFor(
              () => document.activeElement === deepSeekOption
                && deepSeekOption.getAttribute('aria-checked') === 'true'
                && deepSeekOption.tabIndex === 0
                && openAiOption.getAttribute('aria-checked') === 'false'
                && openAiOption.tabIndex === -1,
              'authoritative DeepSeek focus after cancelling keyboard backend switch',
            );
            const cancelFocusEvidence = await focusedControlEvidence(
              deepSeekOption,
              settingsScrollport,
              'cancelledBackendAuthoritativeDeepSeek',
              { focusTarget: false },
            );
            const cancelState = {
              deepSeekFocused: document.activeElement === deepSeekOption,
              deepSeekChecked: deepSeekOption.getAttribute('aria-checked') === 'true',
              deepSeekTabIndex: deepSeekOption.tabIndex,
              openAiChecked: openAiOption.getAttribute('aria-checked') === 'true',
              openAiTabIndex: openAiOption.tabIndex,
              focusEvidence: cancelFocusEvidence,
            };

            const secondArrowRight = driveBackendArrowRight();
            const confirmedDiscardDialog = await waitFor(
              () => document.querySelector('#settings-draft-exit-dialog'),
              'repeated keyboard backend discard dialog',
            );
            click(confirmedDiscardDialog.querySelector('.settings-draft-exit-discard'));
            await waitFor(
              () => !document.querySelector('#settings-draft-exit-dialog'),
              'confirmed keyboard draft discard dismissal',
            );
            await waitFor(
              () => input.value === '' && saveButton.disabled,
              'discarded visible connection draft',
            );
            const saveRecovery = await waitFor(
              () => document.querySelector('.settings-save-recovery[role="alert"]'),
              'backend save failure recovery',
            );
            await waitFor(
              () => document.activeElement === deepSeekOption
                && deepSeekOption.getAttribute('aria-checked') === 'true'
                && deepSeekOption.tabIndex === 0
                && openAiOption.getAttribute('aria-checked') === 'false'
                && openAiOption.tabIndex === -1,
              'authoritative DeepSeek focus after failed backend save',
            );
            const failureFocusEvidence = await focusedControlEvidence(
              deepSeekOption,
              settingsScrollport,
              'failedBackendAuthoritativeDeepSeek',
              { focusTarget: false },
            );
            ensure(
              failureFocusEvidence.focused
                && failureFocusEvidence.focusVisible
                && failureFocusEvidence.ringRendered
                && failureFocusEvidence.ringVisible,
              'failed backend save did not leave a visible ring on authoritative DeepSeek: '
                + JSON.stringify(failureFocusEvidence),
            );
            const failureState = {
              deepSeekFocused: document.activeElement === deepSeekOption,
              deepSeekChecked: deepSeekOption.getAttribute('aria-checked') === 'true',
              deepSeekTabIndex: deepSeekOption.tabIndex,
              openAiChecked: openAiOption.getAttribute('aria-checked') === 'true',
              openAiTabIndex: openAiOption.tabIndex,
              focusEvidence: failureFocusEvidence,
            };
            const editorStatus = input.parentElement?.parentElement
              ?.querySelector('.setting-save-status');
            const testButton = panel.querySelector('.provider-connection-test-button');
            ensure(testButton, 'provider validation action is missing after draft discard');
            ensure(
              !editorStatus?.textContent?.includes('未保存')
                && !testButton.disabled
                && !testButton.textContent?.includes('请先保存当前输入'),
              'discarded visible draft disagrees with parent dirty-state ownership',
            );
            settingsTransition = {
              ...baseTransitionEvidence,
              discardResetVisibleDraft: input.value === '',
              discardClearedDirtyState: saveButton.disabled,
              discardTestUsesSavedConfiguration: !testButton.disabled,
              discardFailureKeptSavedBackend: deepSeekOption.getAttribute('aria-checked') === 'true',
              discardFailureRecoveryVisible: saveRecovery.isConnected,
              keyboardBackendDiscard: {
                firstArrowRightOwned: firstArrowRight.owned,
                firstArrowRightTargetedOpenAi: firstArrowRight.targetedOpenAi,
                cancelledOnce: true,
                cancel: cancelState,
                secondArrowRightOwned: secondArrowRight.owned,
                secondArrowRightTargetedOpenAi: secondArrowRight.targetedOpenAi,
                confirmedDiscard: true,
                saveOnceFailureVisible: saveRecovery.isConnected,
                failure: failureState,
              },
            };
          } else {
            inputValueSetter.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitFor(
              () => input.value === '' && saveButton.disabled,
              'cleared fixture-only connection draft',
            );
            const testButton = await waitFor(
              () => {
                const candidate = document.querySelector('.provider-connection-test-button');
                return candidate && !candidate.disabled ? candidate : null;
              },
              'enabled provider validation action',
            );
            click(testButton);
            await waitFor(
              () => document.querySelector('.provider-connection-progress') && input.disabled,
              'owned provider validation',
            );
            const resetButton = panel.querySelector('button[aria-label="恢复默认设置"]');
            ensure(
              resetButton,
              'full reset action is missing; Settings buttons=' + [...panel.querySelectorAll('button')]
                .map((button) => button.getAttribute('aria-label') || button.textContent?.trim())
                .filter(Boolean)
                .join('|'),
            );
            await waitFor(
              () => resetButton.disabled,
              'full reset lock during provider validation (text=' + resetButton.textContent?.trim() + ')',
            );
            click(returnButton);
            const connectionDialog = await waitFor(
              () => document.querySelector('#settings-connection-exit-dialog'),
              'connection transition dialog',
            );
            const connectionSafe = connectionDialog.querySelector('[data-settings-connection-safe]');
            await waitFor(() => document.activeElement === connectionSafe, 'connection safe focus');
            click(connectionDialog.querySelector('.settings-draft-exit-discard'));
            await waitFor(
              () => connectionDialog.dataset.status === 'cancelling'
                && connectionDialog.getAttribute('aria-busy') === 'true'
                && document.activeElement === connectionDialog,
              'connection cancellation ownership',
            );
            pressKey('Escape');
            ensure(document.querySelector('#settings-connection-exit-dialog'),
              'busy Escape dismissed the connection transition');
            await waitFor(
              () => connectionDialog.dataset.status === 'error',
              'connection stop failure',
            );
            const errorNotice = await waitFor(
              () => {
                const candidate = connectionDialog.querySelector('.settings-transition-dialog__notice.is-error');
                return candidate && document.activeElement === candidate ? candidate : null;
              },
              'focused connection stop failure',
            );
            ensure(errorNotice.getAttribute('role') === 'alert', 'stop failure is not announced');
            recordTextScaleFocus('errorNotice', connectionDialog, errorNotice);
            if (isSettingsTextScaleRun) {
              const errorActions = [...connectionDialog.querySelectorAll(
                '.settings-transition-dialog__actions button:not([disabled])',
              )];
              ensure(errorActions.length >= 2, 'connection stop failure did not expose both actions');
              pressKey('Tab');
              await waitFor(
                () => document.activeElement === errorActions[0],
                'first connection stop failure action',
              );
              recordTextScaleFocus('errorTabFirstAction', connectionDialog, errorActions[0]);
              errorNotice.focus({ preventScroll: true });
              pressKey('Tab', true);
              await waitFor(
                () => document.activeElement === errorActions[errorActions.length - 1],
                'last connection stop failure action',
              );
              recordTextScaleFocus(
                'errorShiftTabLastAction',
                connectionDialog,
                errorActions[errorActions.length - 1],
              );
            }
            ensure(input.disabled && resetButton.disabled,
              'connection controls unlocked before the provider task settled');
            await waitFor(
              () => connectionDialog.dataset.status === 'completed',
              'late provider result replacing the stale stop warning',
              5000,
            );
            const completedDescription = connectionDialog.querySelector('[id$="-description"]');
            await waitFor(
              () => document.activeElement === completedDescription,
              'focused retained provider result notice',
            );
            recordTextScaleFocus('completedNotice', connectionDialog, completedDescription);
            if (isSettingsTextScaleRun) {
              const completedActions = [...connectionDialog.querySelectorAll(
                '.settings-transition-dialog__actions button:not([disabled])',
              )];
              ensure(completedActions.length > 0, 'completed connection state has no review action');
              pressKey('Tab');
              await waitFor(
                () => document.activeElement === completedActions[0],
                'completed connection first action',
              );
              recordTextScaleFocus('completedTabAction', connectionDialog, completedActions[0]);
            }
            ensure(!input.disabled, 'connection editor stayed locked after the task settled');
            click(connectionDialog.querySelector('[data-settings-connection-safe]'));
            await waitFor(
              () => !document.querySelector('#settings-connection-exit-dialog'),
              'completed connection transition dismissal',
            );
            const result = await waitFor(
              () => {
                const candidate = document.querySelector('.provider-connection-result');
                return candidate && document.activeElement === candidate ? candidate : null;
              },
              'provider result focus restoration',
            );

            settingsTransition = {
              ...baseTransitionEvidence,
              busyEscapeConsumed: true,
              stopFailureFocused: true,
              lateCompletionSurfaced: true,
              controlsLockedUntilSettled: true,
              completedResultFocused: result === document.activeElement,
              ...(isSettingsTextScaleRun ? {
                textScaleNative: {
                  viewport: { width: window.innerWidth, height: window.innerHeight },
                  shell: settingsShellTextScale,
                  noHorizontalOverflow: Object.values(textScaleFocusEvidence)
                    .every((evidence) => evidence.pageNoHorizontalOverflow)
                    && document.documentElement.scrollWidth
                      <= document.documentElement.clientWidth + 1,
                  dialogsNoHorizontalOverflow: Object.values(textScaleFocusEvidence)
                    .every((evidence) => evidence.dialogNoHorizontalOverflow),
                  allFocusEvidenceVisible: Object.values(textScaleFocusEvidence)
                    .every((evidence) => (
                      evidence.focused && evidence.ringVisible
                    )),
                  focusEvidence: textScaleFocusEvidence,
                },
              } : {}),
            };
          }
        }

        if (isSettingsSaveRetryRun) {
          click(document.querySelector('[aria-label="打开设置"]'));
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
          const fictionalCredential = 'fixture-replacement-credential-never-leaves-runtime';
          inputValueSetter.call(input, fictionalCredential);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const saveButton = await waitFor(
            () => {
              const candidate = input.parentElement?.parentElement
                ?.querySelector('.setting-save-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled DeepSeek credential save action',
          );
          click(saveButton);

          const initialLocalError = await waitFor(
            () => input.parentElement?.parentElement
              ?.querySelector('.setting-save-status.is-error'),
            'failed local DeepSeek credential status',
          );
          const initialGlobalError = await waitFor(
            () => panel.querySelector('.settings-save-recovery[role="alert"]'),
            'global credential save recovery action',
          );
          const retryButton = [...initialGlobalError.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('重试保存刚才的设置'));
          ensure(retryButton && !retryButton.disabled,
            'Credential save retry action is unavailable');
          const initialFailureVisible = initialLocalError.isConnected
            && initialGlobalError.isConnected;
          const readCounter = (name) => Number(document.documentElement.dataset[name]);
          const initialWriteRequests = readCounter('demoDeepseekCredentialWriteRequests');
          const initialWriteSuccesses = readCounter('demoDeepseekCredentialWriteSuccesses');
          ensure(initialWriteRequests === 1 && initialWriteSuccesses === 0,
            'Credential save retry fixture did not fail exactly its first write');

          click(retryButton);
          await waitFor(
            () => panel.querySelector('.settings-save-recovered[role="status"]'),
            'credential save recovery completion',
          );
          const finalState = await waitFor(
            () => {
              const currentInput = panel.querySelector('#provider-connection-input');
              const editor = currentInput?.parentElement?.parentElement;
              const currentSaveButton = editor?.querySelector('.setting-save-button');
              const providerTestButton = panel.querySelector('.provider-connection-test-button');
              const recoveryStatus = panel.querySelector(
                '.settings-save-recovered[role="status"]',
              );
              const writeRequests = readCounter('demoDeepseekCredentialWriteRequests');
              const writeSuccesses = readCounter('demoDeepseekCredentialWriteSuccesses');
              const reconciled = currentInput?.value === ''
                && currentSaveButton?.disabled === true
                && !editor?.querySelector('.setting-save-status.is-error')
                && providerTestButton
                && !providerTestButton.disabled
                && !providerTestButton.textContent?.includes('请先保存')
                && !panel.querySelector('.settings-save-recovery')
                && recoveryStatus
                && document.activeElement === providerTestButton
                && writeRequests === 2
                && writeSuccesses === 1;
              return reconciled ? {
                currentInput,
                editor,
                currentSaveButton,
                providerTestButton,
                recoveryStatus,
                writeRequests,
                writeSuccesses,
              } : null;
            },
            'fully reconciled credential save retry state',
            7000,
          );
          await new Promise((resolveFrame) => window.requestAnimationFrame(
            () => window.requestAnimationFrame(resolveFrame),
          ));

          const activeElement = document.activeElement;
          const localStatus = finalState.editor.querySelector('.setting-save-status');
          const liveOwnerElements = [...panel.querySelectorAll(
            '[role="status"], [role="alert"], [aria-live]',
          )];
          const liveOwners = liveOwnerElements.map((element) => ({
            role: element.getAttribute('role') || '',
            live: element.getAttribute('aria-live') || '',
            className: typeof element.className === 'string' ? element.className : '',
            text: (element.textContent || '').replace(/\\s+/gu, ' ').trim().slice(0, 160),
          }));
          const localErrorAbsent = !finalState.editor.querySelector(
            '.setting-save-status.is-error',
          );
          const globalErrorAbsent = !panel.querySelector('.settings-save-recovery');
          const providerTestPromptAbsent = !finalState.providerTestButton.textContent
            ?.includes('请先保存');
          const activeElementIsLiveRegion = Boolean(activeElement?.matches?.(
            '[role="status"], [role="alert"], [aria-live]',
          ));
          ensure(localErrorAbsent, 'Recovered credential editor retained its local error');
          ensure(globalErrorAbsent, 'Recovered Settings retained its global save error');
          ensure(finalState.recoveryStatus.isConnected,
            'Recovered Settings did not retain its recovery status');
          ensure(finalState.currentInput.value === '',
            'Recovered credential editor retained the fictional draft');
          ensure(finalState.currentSaveButton.disabled,
            'Recovered credential save action remained enabled');
          ensure(!finalState.providerTestButton.disabled && providerTestPromptAbsent,
            'Recovered provider test remained blocked on an unsaved credential');
          ensure(
            activeElement === finalState.providerTestButton
              && !finalState.providerTestButton.disabled
              && activeElement !== document.body
              && !activeElementIsLiveRegion,
            'Recovered credential save did not hand focus to the enabled provider test',
          );
          ensure(finalState.writeRequests === 2 && finalState.writeSuccesses === 1,
            'Credential save retry did not perform exactly two writes with one success');

          settingsSaveRetry = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            initialFailureVisible,
            retryActionVisible: Boolean(retryButton),
            initialCredentialWriteRequests: initialWriteRequests,
            initialCredentialWriteSuccesses: initialWriteSuccesses,
            deepseekCredentialWriteRequests: finalState.writeRequests,
            deepseekCredentialWriteSuccesses: finalState.writeSuccesses,
            localErrorAbsent,
            localStatusText: (localStatus?.textContent || '').replace(/\\s+/gu, ' ').trim(),
            draftCleared: finalState.currentInput.value === '',
            fictionalCredentialAbsentFromInputs: ![...panel.querySelectorAll('input')]
              .some((candidate) => candidate.value === fictionalCredential),
            saveButtonDisabled: finalState.currentSaveButton.disabled,
            providerTestEnabled: !finalState.providerTestButton.disabled,
            providerTestText: (finalState.providerTestButton.textContent || '')
              .replace(/\\s+/gu, ' ').trim(),
            providerTestPromptAbsent,
            globalErrorAbsent,
            recoveryStatusPresent: finalState.recoveryStatus.isConnected,
            recoveryStatusRole: finalState.recoveryStatus.getAttribute('role'),
            recoveryStatusText: (finalState.recoveryStatus.textContent || '')
              .replace(/\\s+/gu, ' ').trim(),
            providerTestFocused: activeElement === finalState.providerTestButton,
            activeElementIsEnabledProviderTestButton: activeElement
              === finalState.providerTestButton && !finalState.providerTestButton.disabled,
            activeElementIsBody: activeElement === document.body,
            activeElementIsLiveRegion,
            activeElement: {
              tagName: activeElement?.tagName?.toLowerCase() || '',
              id: activeElement?.id || '',
              className: typeof activeElement?.className === 'string'
                ? activeElement.className
                : '',
              role: activeElement?.getAttribute?.('role') || '',
            },
            testSideFocusManipulation: false,
            liveOwnerCount: liveOwners.length,
            liveOwnerFailureTextAbsent: liveOwners.every(
              (owner) => !owner.text.includes('保存失败'),
            ),
            liveOwners,
          };
        }

        if (isSettingsPromptDraftRecoveryRun) {
          const readCounter = (name) => Number(document.documentElement.dataset[name]);
          const openPromptEditor = async () => {
            const settingsEntry = document.querySelector('[aria-label="打开设置"]');
            const setupEntry = findButton(document, '配置完整分析');
            const entry = [settingsEntry, setupEntry].find((candidate) => (
              candidate
              && !candidate.disabled
              && candidate.getClientRects().length > 0
            ));
            ensure(entry, 'Settings entry is missing for prompt draft recovery');
            entry.focus({ preventScroll: true });
            ensure(document.activeElement === entry,
              'Prompt recovery Settings entry did not own focus before activation');
            entry.click();
            const panel = await waitFor(
              () => document.querySelector('.settings-panel'),
              'Settings panel for prompt draft recovery',
            );
            const secondary = panel.querySelector('.secondary-settings');
            ensure(secondary, 'Secondary Settings disclosure is missing');
            if (!secondary.open) click(secondary.querySelector('.secondary-settings__summary'));
            await waitFor(() => secondary.open, 'open secondary Settings disclosure');
            const advanced = panel.querySelector('.secondary-settings__advanced');
            ensure(advanced, 'Advanced prompt disclosure is missing');
            if (!advanced.open) {
              click(advanced.querySelector('.secondary-settings__advanced-summary'));
            }
            await waitFor(() => advanced.open, 'open advanced prompt disclosure');
            const textarea = await waitFor(
              () => panel.querySelector('#custom-prompt-input'),
              'custom prompt textarea',
            );
            const returnButton = panel.querySelector('[data-quit-return-focus]');
            ensure(returnButton, 'Settings return action is missing for prompt recovery');
            return {
              advanced,
              advancedSummary: advanced.querySelector('.secondary-settings__advanced-summary'),
              panel,
              secondary,
              textarea,
              returnButton,
            };
          };
          const activateFocusedControl = (target, label) => {
            ensure(target instanceof HTMLElement, 'Missing focused control for ' + label);
            target.focus({ preventScroll: true });
            const focusedBeforeActivation = document.activeElement === target;
            ensure(focusedBeforeActivation,
              label + ' did not own focus before activation');
            target.click();
            return focusedBeforeActivation;
          };
          const textareaValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          ).set;
          const replacePromptDraft = (textarea, value) => {
            textareaValueSetter.call(textarea, value);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          };
          const persistedPromptS = 'Fixture persisted prompt S: keep {{text}} and {{languageHint}}.';
          const promptA = 'Fixture prompt A: preserve {{text}} and {{languageHint}}.';
          const promptB = 'Fixture prompt B: discard this local revision explicitly.';
          const initial = await openPromptEditor();
          ensure(
            readCounter('demoSettingsWriteRequests') === 0
              && readCounter('demoSettingsWriteSuccesses') === 0
              && readCounter('demoCustomPromptWriteRequests') === 0
              && readCounter('demoCustomPromptWriteSuccesses') === 0,
            'Opening the custom prompt editor performed an implicit settings write',
          );

          const connectionTestButton = await waitFor(
            () => {
              const candidate = initial.panel.querySelector(
                '.provider-connection-test-button',
              );
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled first-use provider test before prompt editing',
          );
          activateFocusedControl(connectionTestButton, 'first-use provider test');
          await waitFor(
            () => initial.panel.querySelector(
              '.provider-connection-result[data-status="connected"]',
            ),
            'successful first-use provider test',
          );
          const fullEnableButton = await waitFor(
            () => {
              const candidate = initial.panel.querySelector('.full-analysis-enable-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled first-use full-analysis completion action',
          );
          const firstUseConnectionReady = Boolean(connectionTestButton);
          const firstUseEnableInitiallyEnabled = !fullEnableButton.disabled;

          replacePromptDraft(initial.textarea, promptA);
          const dirtySaveButton = await waitFor(
            () => {
              const candidate = initial.panel.querySelector(
                '.prompt-editor .setting-save-button',
              );
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled custom prompt save action',
          );
          const firstUseEnableRemainedActionable = !fullEnableButton.disabled;
          const firstUseEnableStartedFromTriggerFocus = activateFocusedControl(
            fullEnableButton,
            'first-use full-analysis completion action',
          );
          const firstUseEnableDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'first-use completion custom prompt guard',
          );
          const firstUseEnableGuardVisible = Boolean(firstUseEnableDialog);
          const firstUseEnableDidNotWrite = readCounter('demoSettingsWriteRequests') === 0
            && readCounter('demoCustomPromptWriteRequests') === 0;
          click(firstUseEnableDialog.querySelector('[data-settings-draft-safe]'));
          await waitFor(
            () => !document.querySelector('#settings-draft-exit-dialog'),
            'first-use completion custom prompt guard cancellation',
          );
          await waitFor(
            () => document.activeElement === fullEnableButton,
            'first-use completion trigger focus restoration',
          );
          const firstUseEnableGuardCancelled = initial.textarea.value === promptA
            && initial.panel.isConnected;
          const firstUseEnableGuardRestoredTriggerFocus = document.activeElement
            === fullEnableButton;
          const firstUseEnableAttemptStayedInSettings = initial.panel.isConnected
            && !document.querySelector('.setup-gate');
          ensure(
            firstUseConnectionReady
              && firstUseEnableInitiallyEnabled
              && firstUseEnableRemainedActionable
              && firstUseEnableStartedFromTriggerFocus
              && firstUseEnableGuardVisible
              && firstUseEnableGuardCancelled
              && firstUseEnableGuardRestoredTriggerFocus
              && firstUseEnableAttemptStayedInSettings
              && firstUseEnableDidNotWrite,
            'First-use completion bypassed an unsaved custom prompt',
          );

          initial.textarea.focus({ preventScroll: true });
          pressKey('Escape');
          const escapeDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'custom prompt Escape guard',
          );
          const escapeNoImplicitWrite = readCounter('demoSettingsWriteRequests') === 0
            && readCounter('demoCustomPromptWriteRequests') === 0;
          ensure(escapeNoImplicitWrite,
            'Escape from an unsaved custom prompt performed an implicit write');
          click(escapeDialog.querySelector('[data-settings-draft-safe]'));
          await waitFor(
            () => !document.querySelector('#settings-draft-exit-dialog'),
            'custom prompt Escape guard cancellation',
          );
          await waitFor(
            () => document.activeElement === initial.textarea,
            'custom prompt focus restoration after Escape guard cancellation',
          );
          const escapeCancelPreservedDraft = initial.textarea.value === promptA;
          const escapeCancelRestoredPromptFocus = document.activeElement === initial.textarea;
          ensure(
            escapeCancelPreservedDraft && escapeCancelRestoredPromptFocus,
            'Cancelling the Escape guard did not preserve the custom prompt and its focus',
          );

          const returnActionStartedFromReturnFocus = activateFocusedControl(
            initial.returnButton,
            'Settings return action',
          );
          const returnDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'custom prompt return guard',
          );
          const returnNoImplicitWrite = readCounter('demoSettingsWriteRequests') === 0
            && readCounter('demoCustomPromptWriteRequests') === 0;
          ensure(returnNoImplicitWrite,
            'Returning from an unsaved custom prompt performed an implicit write');
          click(returnDialog.querySelector('[data-settings-draft-safe]'));
          await waitFor(
            () => !document.querySelector('#settings-draft-exit-dialog'),
            'custom prompt return guard cancellation',
          );
          await waitFor(
            () => document.activeElement === initial.returnButton,
            'Settings return focus restoration after return guard cancellation',
          );
          const returnCancelPreservedDraft = initial.textarea.value === promptA;
          const returnCancelRestoredReturnFocus = document.activeElement === initial.returnButton;
          const escapeAndReturnFocusAreDistinct = escapeCancelRestoredPromptFocus
            && returnCancelRestoredReturnFocus
            && initial.textarea !== initial.returnButton;
          ensure(
            returnCancelPreservedDraft
              && returnActionStartedFromReturnFocus
              && returnCancelRestoredReturnFocus
              && escapeAndReturnFocusAreDistinct,
            'Return and Escape guards did not restore their distinct expected focus targets',
          );

          click(dirtySaveButton);
          const localFailure = await waitFor(
            () => initial.panel.querySelector(
              '.prompt-editor .setting-save-status.is-error',
            ),
            'custom prompt local save failure',
          );
          const globalFailure = await waitFor(
            () => initial.panel.querySelector('.settings-save-recovery[role="alert"]'),
            'custom prompt global save recovery',
          );
          const retryButton = findButton(globalFailure, '重试保存刚才的设置');
          ensure(retryButton && !retryButton.disabled,
            'Custom prompt generic retry action is unavailable');
          const firstFailureRequestCount = readCounter('demoCustomPromptWriteRequests');
          const firstFailureSuccessCount = readCounter('demoCustomPromptWriteSuccesses');
          const firstFailurePreservedDraft = initial.textarea.value === promptA;
          const firstFailureLocalErrorVisible = localFailure.isConnected;
          const firstFailureGlobalErrorVisible = globalFailure.isConnected;
          ensure(
            firstFailureRequestCount === 1
              && firstFailureSuccessCount === 0
              && firstFailurePreservedDraft
              && firstFailureLocalErrorVisible
              && firstFailureGlobalErrorVisible,
            'Custom prompt did not preserve its first failed explicit save',
          );

          replacePromptDraft(initial.textarea, persistedPromptS);
          await waitFor(
            () => {
              const saveButton = initial.panel.querySelector(
                '.prompt-editor .setting-save-button',
              );
              return saveButton?.disabled === true
                && !initial.panel.querySelector('.prompt-editor .setting-save-status.is-error');
            },
            'custom prompt local restoration to persisted value',
          );
          await waitFor(
            () => !initial.panel.querySelector('.settings-save-recovery[role="alert"]'),
            'global custom prompt retry removal after restoring persisted value',
          );
          const failedRetryClearedOnPersistedRestore = !findButton(
            initial.panel,
            '重试保存刚才的设置',
          ) && !initial.panel.querySelector('.settings-save-recovery');
          const persistedRestoreDidNotWrite = readCounter('demoSettingsWriteRequests') === 1
            && readCounter('demoSettingsWriteSuccesses') === 0
            && readCounter('demoCustomPromptWriteRequests') === 1
            && readCounter('demoCustomPromptWriteSuccesses') === 0;
          ensure(failedRetryClearedOnPersistedRestore && persistedRestoreDidNotWrite,
            'Restoring persisted prompt S retained or replayed the failed prompt A receipt');

          activateFocusedControl(initial.returnButton, 'unguarded persisted prompt return');
          await waitFor(
            () => !document.querySelector('.settings-panel'),
            'unguarded return after restoring persisted prompt',
          );
          const persistedRestoreLeftWithoutGuard = !document.querySelector(
            '#settings-draft-exit-dialog',
          );
          const restored = await openPromptEditor();
          await delay(100);
          const persistedRestoreSurvivedReopen = restored.textarea.value === persistedPromptS;
          const failedRetryAbsentAfterReopen = !findButton(
            restored.panel,
            '重试保存刚才的设置',
          ) && !restored.panel.querySelector('.settings-save-recovery');
          const failedPromptANotRevived = readCounter('demoCustomPromptWriteRequests') === 1
            && readCounter('demoCustomPromptWriteSuccesses') === 0;
          ensure(
            persistedRestoreLeftWithoutGuard
              && persistedRestoreSurvivedReopen
              && failedRetryAbsentAfterReopen
              && failedPromptANotRevived,
            'Failed prompt A revived after leaving and reopening persisted prompt S',
          );

          replacePromptDraft(restored.textarea, promptA);
          const secondSaveButton = await waitFor(
            () => {
              const candidate = restored.panel.querySelector(
                '.prompt-editor .setting-save-button',
              );
              return candidate && !candidate.disabled ? candidate : null;
            },
            'second explicit custom prompt save action',
          );
          click(secondSaveButton);
          const secondLocalFailure = await waitFor(
            () => restored.panel.querySelector(
              '.prompt-editor .setting-save-status.is-error',
            ),
            'second custom prompt local save failure',
          );
          const secondGlobalFailure = await waitFor(
            () => restored.panel.querySelector('.settings-save-recovery[role="alert"]'),
            'second custom prompt global save recovery',
          );
          const secondRetryButton = findButton(
            secondGlobalFailure,
            '重试保存刚才的设置',
          );
          ensure(
            secondLocalFailure
              && secondRetryButton
              && readCounter('demoCustomPromptWriteRequests') === 2
              && readCounter('demoCustomPromptWriteSuccesses') === 0,
            'Second custom prompt failure did not retain a retryable receipt',
          );
          activateFocusedControl(restored.advancedSummary, 'advanced prompt disclosure collapse');
          await waitFor(() => !restored.advanced.open, 'collapsed advanced prompt disclosure');
          const retryStartedWhileAdvancedCollapsed = !restored.advanced.open;
          click(secondRetryButton);
          await waitFor(
            () => restored.panel.querySelector('.settings-save-recovered[role="status"]'),
            'collapsed custom prompt generic retry completion',
          );
          const recovered = await waitFor(
            () => {
              const textarea = restored.panel.querySelector('#custom-prompt-input');
              const saveButton = restored.panel.querySelector(
                '.prompt-editor .setting-save-button',
              );
              const ready = restored.secondary.open
                && restored.advanced.open
                && textarea?.value === promptA
                && textarea.getClientRects().length > 0
                && saveButton?.disabled === true
                && !restored.panel.querySelector('.prompt-editor .setting-save-status.is-error')
                && !restored.panel.querySelector('.settings-save-recovery')
                && document.activeElement === textarea
                && readCounter('demoSettingsWriteRequests') === 3
                && readCounter('demoSettingsWriteSuccesses') === 1
                && readCounter('demoCustomPromptWriteRequests') === 3
                && readCounter('demoCustomPromptWriteSuccesses') === 1;
              return ready ? { textarea, saveButton } : null;
            },
            'routed custom prompt retry from collapsed disclosure',
            7000,
          );
          const retrySucceeded = Boolean(restored.panel.querySelector(
            '.settings-save-recovered[role="status"]',
          ))
            && recovered.textarea.value === promptA
            && recovered.saveButton.disabled;
          const retryOpenedAdvancedPrompt = restored.secondary.open && restored.advanced.open;
          const retryFocusedPrompt = document.activeElement === recovered.textarea;
          const retryFocusedVisiblePrompt = retryFocusedPrompt
            && recovered.textarea.getClientRects().length > 0;
          ensure(
            retryStartedWhileAdvancedCollapsed
              && retrySucceeded
              && retryOpenedAdvancedPrompt
              && retryFocusedVisiblePrompt,
            'Collapsed custom prompt retry did not open and route to useful prompt focus',
          );

          replacePromptDraft(recovered.textarea, promptB);
          await waitFor(
            () => !restored.panel.querySelector('.prompt-editor .setting-save-button')?.disabled,
            'discardable custom prompt B draft',
          );
          activateFocusedControl(restored.returnButton, 'prompt B return action');
          const discardDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'custom prompt B explicit discard guard',
          );
          const discardButton = discardDialog.querySelector('.settings-draft-exit-discard');
          ensure(discardButton && !discardButton.disabled,
            'Second custom prompt draft has no explicit discard action');
          click(discardButton);
          await waitFor(
            () => !document.querySelector('.settings-panel'),
            'Settings close after explicit custom prompt discard',
          );

          const reopened = await openPromptEditor();
          await delay(100);
          const retryActionAfterDiscard = findButton(
            reopened.panel,
            '重试保存刚才的设置',
          );
          const reopenedShowsSavedA = reopened.textarea.value === promptA;
          const discardedBAbsent = reopened.textarea.value !== promptB;
          const retryDidNotRevive = !retryActionAfterDiscard
            && !reopened.panel.querySelector('.settings-save-recovery');
          const discardDidNotWrite = readCounter('demoSettingsWriteRequests') === 3
            && readCounter('demoSettingsWriteSuccesses') === 1
            && readCounter('demoCustomPromptWriteRequests') === 3
            && readCounter('demoCustomPromptWriteSuccesses') === 1;
          const reopenedSaveDisabled = reopened.panel.querySelector(
            '.prompt-editor .setting-save-button',
          )?.disabled === true;
          ensure(
            reopenedShowsSavedA
              && discardedBAbsent
              && retryDidNotRevive
              && discardDidNotWrite
              && reopenedSaveDisabled,
            'Discarded prompt revision returned or revived a failed save after reopening',
          );

          settingsPromptDraftRecovery = {
            firstUseConnectionReady,
            firstUseEnableInitiallyEnabled,
            firstUseEnableRemainedActionable,
            firstUseEnableStartedFromTriggerFocus,
            firstUseEnableGuardVisible,
            firstUseEnableGuardCancelled,
            firstUseEnableGuardRestoredTriggerFocus,
            firstUseEnableAttemptStayedInSettings,
            firstUseEnableDidNotWrite,
            escapeGuardVisible: Boolean(escapeDialog),
            escapeNoImplicitWrite,
            escapeCancelPreservedDraft,
            escapeCancelRestoredPromptFocus,
            returnGuardVisible: Boolean(returnDialog),
            returnNoImplicitWrite,
            returnCancelPreservedDraft,
            returnActionStartedFromReturnFocus,
            returnCancelRestoredReturnFocus,
            escapeAndReturnFocusAreDistinct,
            firstFailurePreservedDraft,
            firstFailureLocalErrorVisible,
            firstFailureGlobalErrorVisible,
            firstFailureRequestCount,
            firstFailureSuccessCount,
            failedRetryClearedOnPersistedRestore,
            persistedRestoreDidNotWrite,
            persistedRestoreLeftWithoutGuard,
            persistedRestoreSurvivedReopen,
            failedRetryAbsentAfterReopen,
            failedPromptANotRevived,
            retryStartedWhileAdvancedCollapsed,
            retrySucceeded,
            retryOpenedAdvancedPrompt,
            retryFocusedPrompt,
            retryFocusedVisiblePrompt,
            reopenedShowsSavedA,
            discardedBAbsent,
            retryDidNotRevive,
            discardDidNotWrite,
            reopenedSaveDisabled,
            settingsWriteRequests: readCounter('demoSettingsWriteRequests'),
            settingsWriteSuccesses: readCounter('demoSettingsWriteSuccesses'),
            customPromptWriteRequests: readCounter('demoCustomPromptWriteRequests'),
            customPromptWriteSuccesses: readCounter('demoCustomPromptWriteSuccesses'),
          };
        }

        if (isFailedDraftDiscardRun) {
          click(document.querySelector('[aria-label="打开设置"]'));
          const panel = await waitFor(
            () => document.querySelector('.settings-panel'),
            'Settings panel for failed credential draft discard',
          );
          const input = await waitFor(
            () => panel.querySelector('#provider-connection-input'),
            'DeepSeek credential editor for failed draft discard',
          );
          const inputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          ).set;
          const discardedDraft = 'fixture-replacement-must-never-store';
          inputValueSetter.call(input, discardedDraft);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const saveButton = await waitFor(
            () => {
              const candidate = input.parentElement?.parentElement
                ?.querySelector('.setting-save-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled DeepSeek credential save action',
          );
          click(saveButton);

          const failedEditorStatus = await waitFor(
            () => {
              const candidate = input.parentElement?.parentElement
                ?.querySelector('.setting-save-status.is-error');
              return candidate?.textContent?.includes('保存失败') ? candidate : null;
            },
            'failed DeepSeek credential save status',
          );
          const initialRecovery = await waitFor(
            () => panel.querySelector('.settings-save-recovery[role="alert"]'),
            'generic recovery for failed DeepSeek credential save',
          );
          const initialFailureVisible = failedEditorStatus.isConnected
            && initialRecovery.isConnected;
          const readCounter = (name) => Number(document.documentElement.dataset[name]);
          const initialWriteRequests = readCounter('demoDeepseekCredentialWriteRequests');
          const initialWriteSuccesses = readCounter('demoDeepseekCredentialWriteSuccesses');
          ensure(initialWriteRequests === 1 && initialWriteSuccesses === 0,
            'fixture did not fail exactly the first replacement credential write');

          const openAiOption = [...panel.querySelectorAll('.backend-option-button')]
            .find((button) => button.textContent?.includes('OpenAI'));
          ensure(openAiOption, 'OpenAI target choice is missing after failed credential save');
          click(openAiOption);
          const discardDialog = await waitFor(
            () => document.querySelector('#settings-draft-exit-dialog'),
            'failed credential draft discard decision',
          );
          const discardAction = discardDialog.querySelector('.settings-draft-exit-discard');
          ensure(
            discardAction?.textContent?.includes('放弃草稿并切换到 OpenAI'),
            'failed credential draft did not require an explicit discard decision',
          );
          click(discardAction);
          await waitFor(
            () => !document.querySelector('#settings-draft-exit-dialog'),
            'failed credential draft discard completion',
          );
          await waitFor(
            () => openAiOption.getAttribute('aria-checked') === 'true',
            'successful OpenAI target switch after failed draft discard',
          );
          await waitFor(
            () => !panel.querySelector('.settings-save-recovery[role="alert"]'),
            'removal of abandoned credential recovery action',
          );
          await delay(100);

          const currentInput = panel.querySelector('#provider-connection-input');
          const genericRetry = [...panel.querySelectorAll('button')]
            .find((button) => button.textContent?.includes('重试保存刚才的设置'));
          const finalWriteRequests = readCounter('demoDeepseekCredentialWriteRequests');
          const finalWriteSuccesses = readCounter('demoDeepseekCredentialWriteSuccesses');
          const abandonedDraftAbsent = currentInput?.value !== discardedDraft
            && ![...panel.querySelectorAll('input')]
              .some((candidate) => candidate.value === discardedDraft);
          const targetSwitchSucceeded = openAiOption.getAttribute('aria-checked') === 'true';
          ensure(abandonedDraftAbsent, 'discarded credential draft remained in a visible editor');
          ensure(!genericRetry && !panel.querySelector('.settings-save-recovery'),
            'abandoned credential still exposed the generic retry path');
          ensure(finalWriteRequests === 1 && finalWriteSuccesses === 0,
            'abandoned DeepSeek credential was retried or persisted after discard');
          ensure(targetSwitchSucceeded, 'target backend did not switch after discarding the draft');

          failedDraftDiscard = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            initialFailureVisible,
            explicitDiscardRequired: discardAction.textContent.includes('放弃草稿并切换到 OpenAI'),
            visibleDraftCleared: abandonedDraftAbsent,
            genericRecoveryRemoved: !genericRetry && !panel.querySelector('.settings-save-recovery'),
            abandonedCredentialNotRetried: finalWriteRequests === 1,
            abandonedCredentialNotPersisted: finalWriteSuccesses === 0,
            targetSwitchSucceeded,
            deepseekCredentialWriteRequests: finalWriteRequests,
            deepseekCredentialWriteSuccesses: finalWriteSuccesses,
          };
        }

        if (isRuntimeDegradedRun) {
          const alert = await waitFor(
            () => document.querySelector('.app-runtime-alert[role="alert"]'),
            'degraded runtime alert',
          );
          const alertText = alert.textContent || '';
          const expectedMessages = [
            '菜单栏入口暂时不可用',
            '剪贴板自动检测已安全保持关闭',
            '本次自动检测没有启动，但关闭状态未能保存',
          ];
          const allMessagesVisible = expectedMessages.every((message) => alertText.includes(message));
          ensure(allMessagesVisible, 'degraded runtime alert omitted one or more fixed conditions');
          const sourceInput = await waitFor(
            () => document.querySelector('textarea[aria-label="要解释的完整原文"]'),
            'capture source below degraded runtime alert',
          );
          const processButton = document.querySelector('.process-button');
          const sessionSurface = document.querySelector('.app-session-surface');
          ensure(processButton && sessionSurface, 'degraded runtime alert hid the main capture actions');
          const alertRect = alert.getBoundingClientRect();
          const sourceRect = sourceInput.getBoundingClientRect();
          const processRect = processButton.getBoundingClientRect();
          const sessionRect = sessionSurface.getBoundingClientRect();
          const alertWithinViewport = alertRect.left >= -1
            && alertRect.right <= window.innerWidth + 1
            && alertRect.top >= -1
            && alertRect.bottom <= window.innerHeight + 1;
          const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth + 1
            && document.body.scrollWidth <= window.innerWidth + 1;
          const captureControlsReachable = sourceRect.width > 0
            && sourceRect.height > 0
            && processRect.width > 0
            && processRect.height > 0
            && sessionRect.height > 200;
          ensure(alertWithinViewport, 'degraded runtime alert escaped the native viewport');
          ensure(noHorizontalOverflow, 'degraded runtime alert introduced horizontal overflow');
          ensure(captureControlsReachable, 'degraded runtime alert collapsed the capture surface');
          runtimeDegraded = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            role: alert.getAttribute('role'),
            titleVisible: alertText.includes('部分后台功能没有启动'),
            allMessagesVisible,
            alertWithinViewport,
            noHorizontalOverflow,
            captureControlsReachable,
            sessionSurfaceHeight: sessionRect.height,
          };
        }

        if (isStartupRecoveryRun) {
          const recoveryScreen = await waitFor(
            () => document.querySelector('.startup-recovery'),
            'blocked startup recovery screen',
          );
          const blockedText = recoveryScreen.textContent || '';
          const initialBlockedReasonVisible = blockedText.includes('本机设置文件无法解析');
          const setupHiddenWhileBlocked = !document.querySelector('#setup-title');
          ensure(initialBlockedReasonVisible, 'corrupt settings reason was not shown');
          ensure(setupHiddenWhileBlocked, 'first-use setup appeared before recovery completed');

          const freshRecoveryButton = recoveryScreen.querySelector('.startup-recovery-fresh');
          click(freshRecoveryButton);
          const initialConfirmation = await waitFor(
            () => document.querySelector('.startup-recovery-confirm'),
            'second startup recovery step',
          );
          const initialConfirmationHeading = initialConfirmation.querySelector(
            '#startup-recovery-confirm-title',
          );
          await waitFor(
            () => document.activeElement === initialConfirmationHeading,
            'startup recovery confirmation focus entry',
          );
          const confirmationEntryFocused = document.activeElement === initialConfirmationHeading;
          const simulatedTopLayer = document.createElement('div');
          simulatedTopLayer.dataset.appTopLayer = 'fixture-quit';
          document.body.append(simulatedTopLayer);
          pressKey('Escape');
          const topLayerEscapePreservedConfirmation = initialConfirmation.isConnected;
          simulatedTopLayer.remove();
          ensure(
            topLayerEscapePreservedConfirmation,
            'startup recovery consumed Escape beneath the app top layer',
          );
          pressKey('Escape');
          await waitFor(
            () => !document.querySelector('.startup-recovery-confirm'),
            'startup recovery Escape return',
          );
          const returnedFreshRecoveryButton = await waitFor(
            () => document.querySelector('.startup-recovery-fresh'),
            'restored startup recovery trigger',
          );
          await waitFor(
            () => document.activeElement === returnedFreshRecoveryButton,
            'startup recovery trigger focus restoration',
          );
          const escapeClosedConfirmation = !document.querySelector('.startup-recovery-confirm');
          const escapeReturnedToFreshTrigger = document.activeElement === returnedFreshRecoveryButton;

          click(returnedFreshRecoveryButton);
          const confirmation = await waitFor(
            () => document.querySelector('.startup-recovery-confirm'),
            'reopened startup recovery confirmation',
          );
          await waitFor(
            () => document.activeElement === confirmation.querySelector(
              '#startup-recovery-confirm-title',
            ),
            'reopened startup recovery confirmation focus entry',
          );
          const checkbox = confirmation.querySelector('input[type="checkbox"]');
          const confirmButton = confirmation.querySelector('.startup-recovery-confirm-button');
          ensure(checkbox && confirmButton, 'startup recovery confirmation controls are missing');
          const confirmationStepVisible = confirmation.isConnected;
          const confirmationGuarded = confirmButton.disabled && checkbox.checked === false;
          ensure(confirmationGuarded, 'destructive startup recovery was not confirmation-gated');
          click(checkbox);
          await waitFor(
            () => !confirmation.querySelector('.startup-recovery-confirm-button')?.disabled,
            'acknowledged startup recovery confirmation',
          );
          click(confirmation.querySelector('.startup-recovery-confirm-button'));
          const busyButton = await waitFor(
            () => {
              const candidate = document.querySelector('.startup-recovery-confirm-button');
              return candidate?.getAttribute('aria-busy') === 'true' ? candidate : null;
            },
            'busy startup recovery action',
          );
          const busyStatus = document.querySelector('.startup-recovery-status');
          const busyStateVisible = busyButton.disabled
            && busyStatus?.textContent?.includes('正在归档并建立全新设置');
          ensure(busyStateVisible, 'startup recovery did not expose its archival busy state');

          const recoveryNotice = await waitFor(
            () => document.querySelector('.setup-recovery-notice'),
            'startup recovery success notice',
          );
          await waitFor(
            () => document.activeElement === recoveryNotice,
            'focus handoff to startup recovery success notice',
          );
          const noticeText = recoveryNotice.textContent || '';
          const expectedBackupFileName = 'slipstream-settings.corrupt-20260728.json';
          const backupFileNameSafe = noticeText.includes(expectedBackupFileName)
            && !noticeText.includes('/')
            && !noticeText.includes('\\\\');
          const oldDataLeakAbsent = !noticeText.includes('fixture-secret-must-not-cross')
            && !noticeText.includes('/Users/')
            && !noticeText.includes('archive-only');
          const requestCount = Number(
            document.documentElement.dataset.demoStartupRecoveryRequests,
          );
          const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth + 1
            && document.body.scrollWidth <= window.innerWidth + 1;
          ensure(requestCount === 1, 'startup recovery did not issue exactly one reset request');
          ensure(backupFileNameSafe, 'startup recovery exposed more than a safe archive basename');
          ensure(oldDataLeakAbsent, 'startup recovery notice exposed fixture-only private data');
          ensure(noHorizontalOverflow, 'startup recovery introduced horizontal overflow');
          startupRecovery = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            initialBlockedReasonVisible,
            setupHiddenWhileBlocked,
            confirmationStepVisible,
            confirmationGuarded,
            confirmationEntryFocused,
            topLayerEscapePreservedConfirmation,
            escapeClosedConfirmation,
            escapeReturnedToFreshTrigger,
            busyStateVisible,
            recoveryScreenRemoved: !document.querySelector('.startup-recovery'),
            setupTitle: document.querySelector('#setup-title')?.textContent || '',
            recoveryNoticeVisible: recoveryNotice.isConnected,
            recoveryNoticeRole: recoveryNotice.getAttribute('role'),
            recoveryNoticeFocused: document.activeElement === recoveryNotice,
            backupFileNameSafe,
            oldDataLeakAbsent,
            noHorizontalOverflow,
            recoveryRequests: requestCount,
          };
        }

        if (isClipboardResidueRecoveryRun) {
          const recoveryBridge = window.slipstreamUiFixtureRecovery;
          ensure(
            typeof recoveryBridge?.getStatus === 'function'
              && typeof recoveryBridge?.acknowledge === 'function',
            'clipboard residue fixture recovery bridge is unavailable',
          );
          const residueNotice = await waitFor(
            () => document.querySelector('[data-clipboard-residue-risk="true"]'),
            'clipboard residue recovery warning after renderer reload',
          );
          const residueTitle = residueNotice.querySelector('#clipboard-residue-risk-title');
          ensure(residueTitle && residueTitle.tabIndex === -1,
            'clipboard residue recovery warning title is not the focus target');
          ensure(nativeRecoveryFocusOwnedBeforeKeyboardPriming,
            'clipboard residue warning did not initially hand focus to its title');
          const warningFocusEvidence = await focusedControlEvidence(
            residueTitle,
            residueNotice.closest('.slipstream-shell'),
            'clipboard residue warning title after renderer reload',
          );
          const warningFocused = nativeRecoveryFocusOwnedBeforeKeyboardPriming
            && warningFocusEvidence.focused
            && residueNotice.contains(document.activeElement);
          ensure(
            warningFocusEvidence.focused
              && warningFocusEvidence.focusVisible
              && warningFocusEvidence.ringRendered
              && warningFocusEvidence.ringVisible,
            'clipboard residue warning title focus ring is not fully visible after reload: '
              + JSON.stringify(warningFocusEvidence),
          );
          const statusBeforeAcknowledgement = await recoveryBridge.getStatus();
          const recoveredRiskId = statusBeforeAcknowledgement?.clipboardResidueRisk?.id;
          ensure(
            statusBeforeAcknowledgement?.recovered === true
              && typeof recoveredRiskId === 'string'
              && recoveredRiskId.length > 0,
            'main-owned clipboard residue metadata did not survive renderer reload',
          );
          const noticeText = residueNotice.textContent || '';
          const warningExplainsManualOverwriteOnly = noticeText.includes(
            '系统剪贴板可能仍有上次复制的内容',
          )
            && noticeText.includes('不会读取、清除或覆盖')
            && noticeText.includes('手动覆盖');
          const noAutomaticClipboardAction = !document.querySelector(
            '[data-clipboard-clear-action]',
          )
            && ![...residueNotice.querySelectorAll('button')]
              .some((button) => button.textContent?.includes('清除'));
          const opaqueIdNotRendered = !document.body.textContent?.includes(recoveredRiskId);
          const copiedContentNotRendered = !document.body.textContent?.includes('fixture-only text');
          ensure(warningExplainsManualOverwriteOnly,
            'clipboard residue warning did not explain manual overwrite handling');
          ensure(noAutomaticClipboardAction,
            'clipboard residue recovery exposed an automatic clipboard action');
          ensure(opaqueIdNotRendered,
            'clipboard residue recovery exposed its opaque main-owned id');
          ensure(copiedContentNotRendered,
            'clipboard residue recovery exposed fixture clipboard content');

          const wrongAcknowledgement = await recoveryBridge.acknowledge({
            id: 'fixture-wrong-residue-risk',
            text: 'must-be-stripped-by-preload',
            unexpectedCapability: 'must-be-stripped-by-preload',
          });
          await delay(50);
          const invalidAcknowledgementPreservedWarning = wrongAcknowledgement?.status === 'invalid'
            && residueNotice.isConnected;
          ensure(invalidAcknowledgementPreservedWarning,
            'non-matching clipboard residue acknowledgement released the warning');

          const acknowledgeAction = residueNotice.querySelector(
            '[data-clipboard-residue-acknowledge]',
          );
          ensure(
            acknowledgeAction
              && acknowledgeAction.textContent?.includes('我已检查或手动覆盖')
              && !acknowledgeAction.disabled,
            'clipboard residue warning has no explicit handling acknowledgement',
          );
          click(acknowledgeAction);
          await waitFor(
            () => !document.querySelector('[data-clipboard-residue-risk="true"]'),
            'clipboard residue warning removal after exact acknowledgement',
          );
          const statusAfterAcknowledgement = await recoveryBridge.getStatus();
          const exactAcknowledgementReleasedRisk = statusAfterAcknowledgement?.recovered === true
            && statusAfterAcknowledgement.clipboardResidueRisk === null;
          ensure(exactAcknowledgementReleasedRisk,
            'exact clipboard residue acknowledgement did not release main-owned risk');

          const clipboardWriteRequests = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          const nativeClipboardWriteStubs = Number(
            document.documentElement.dataset.demoNativeClipboardWriteStubs,
          );
          const clipboardCountersAreSafeIntegers = [
            clipboardWriteRequests,
            nativeClipboardWriteStubs,
          ].every((value) => Number.isSafeInteger(value) && value >= 0);
          const noClipboardOperations = clipboardCountersAreSafeIntegers
            && clipboardWriteRequests === 0
            && nativeClipboardWriteStubs === 0;
          ensure(noClipboardOperations,
            'clipboard residue recovery attempted a clipboard operation');

          clipboardResidueRecovery = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            navigationType: performance.getEntriesByType('navigation')[0]?.type || '',
            warningRole: residueNotice.getAttribute('role'),
            warningFocused,
            warningFocusTargetId: residueTitle.id,
            warningInitiallyFocused: nativeRecoveryFocusOwnedBeforeKeyboardPriming,
            warningFocusEvidence,
            warningExplainsManualOverwriteOnly,
            noAutomaticClipboardAction,
            opaqueIdNotRendered,
            copiedContentNotRendered,
            invalidAcknowledgementPreservedWarning,
            exactAcknowledgementReleasedRisk,
            warningRemovedAfterAcknowledgement: !residueNotice.isConnected,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
              && document.body.scrollWidth <= window.innerWidth + 1,
            noClipboardOperations,
            clipboardCountersAreSafeIntegers,
            clipboardWriteRequests,
            nativeClipboardWriteStubs,
          };
        }

        if (isProviderRetryRun) {
          click(document.querySelector('[aria-label="打开设置"]'));
          const panel = await waitFor(
            () => document.querySelector('.settings-panel'),
            'Settings panel for provider retry',
          );
          const deepSeekOption = [...panel.querySelectorAll('.backend-option-button')]
            .find((button) => button.textContent?.includes('DeepSeek'));
          const credentialInput = panel.querySelector('#provider-connection-input');
          const modelInput = panel.querySelector('#provider-model-input');
          const testButton = await waitFor(
            () => {
              const candidate = panel.querySelector('.provider-connection-test-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled provider connection test',
          );
          ensure(deepSeekOption && credentialInput && modelInput,
            'saved DeepSeek fixture configuration is incomplete');
          const savedConfigurationBefore = {
            backendChecked: deepSeekOption.getAttribute('aria-checked'),
            credentialPlaceholder: credentialInput.getAttribute('placeholder'),
            model: modelInput.value,
          };
          ensure(savedConfigurationBefore.backendChecked === 'true',
            'provider retry fixture did not start on saved DeepSeek');
          ensure(savedConfigurationBefore.credentialPlaceholder === '已保存，输入新值可替换',
            'provider retry fixture exposed or omitted the saved credential state');

          click(testButton);
          await waitFor(
            () => panel.querySelector('.provider-connection-progress'),
            'first provider connection test',
          );
          const failedResult = await waitFor(
            () => panel.querySelector('.provider-connection-result[data-status="failed"]'),
            'first unreachable provider result',
          );
          await waitFor(
            () => document.activeElement === failedResult,
            'focus handoff to failed provider result',
          );
          const failedResultFocused = document.activeElement === failedResult;
          const firstFailureVisible = failedResult.textContent?.includes('无法连接服务')
            && failedResult.textContent?.includes('先确认网络与服务状态');
          ensure(firstFailureVisible, 'first provider test did not show unreachable recovery');
          const retryButton = [...failedResult.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === '重新测试连接');
          ensure(retryButton && !retryButton.disabled, 'unreachable provider result has no retry action');

          click(retryButton);
          await waitFor(
            () => panel.querySelector('.provider-connection-progress') && !failedResult.isConnected,
            'second provider connection test',
          );
          const connectedResult = await waitFor(
            () => panel.querySelector('.provider-connection-result[data-status="connected"]'),
            'successful provider retry result',
          );
          await waitFor(
            () => document.activeElement === connectedResult,
            'focus handoff to successful provider result',
          );
          const savedConfigurationAfter = {
            backendChecked: deepSeekOption.getAttribute('aria-checked'),
            credentialPlaceholder: credentialInput.getAttribute('placeholder'),
            model: modelInput.value,
          };
          const requestCount = Number(
            document.documentElement.dataset.demoProviderConnectionRequests,
          );
          const savedConfigurationPreserved = JSON.stringify(savedConfigurationAfter)
            === JSON.stringify(savedConfigurationBefore);
          const successVisible = connectedResult.textContent?.includes('完整分析能力验证通过');
          ensure(requestCount === 2, 'provider retry did not issue exactly two test requests');
          ensure(savedConfigurationPreserved, 'provider retry changed the saved configuration');
          ensure(successVisible, 'provider retry did not show the successful result');
          providerRetry = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            firstFailureVisible,
            failedResultFocused,
            retryActionVisible: Boolean(retryButton),
            successVisible,
            successResultFocused: document.activeElement === connectedResult,
            savedConfigurationPreserved,
            providerConnectionRequests: requestCount,
          };
        }

        if (isFailedSourceRetryRun) {
          const replacementSource = 'Fixture source B: upload the signed tenancy declaration within five working days.';
          const correctedReplacementSource = 'Fixture corrected source B: upload the signed tenancy declaration within three working days.';
          const readProcessRequests = () => Number(
            document.documentElement.dataset.demoProcessRequests,
          );
          const readProcessPayloads = () => JSON.parse(
            document.documentElement.dataset.demoProcessPayloads || '[]',
          );
          const initialSourcePaper = await waitFor(
            () => document.querySelector('.source-paper'),
            'initial valid source A',
          );
          const sourceABefore = initialSourcePaper.textContent || '';
          const initialAVisible = sourceABefore.includes('Dear Student')
            && sourceABefore.includes('passport information page')
            && !sourceABefore.includes(replacementSource);
          ensure(initialAVisible, 'failed-source fixture did not start with valid result A');

          const recaptureAction = [...document.querySelectorAll('.result-footer button')]
            .find((button) => button.textContent?.trim() === '重新截图');
          ensure(recaptureAction && !recaptureAction.disabled,
            'valid result A did not expose a new screenshot action');
          click(recaptureAction);
          await waitFor(
            () => readProcessRequests() === 1 && document.querySelector('.processing-card'),
            'first processing request for replacement source B',
          );

          const failedWarning = await waitFor(
            () => {
              const candidate = document.querySelector('.inline-warning[role="alert"]');
              const text = candidate?.textContent || '';
              return text.includes('当前显示的是上一份有效结果')
                && text.includes('刚才未成功处理的原文只在当前会话内存中保留')
                ? candidate
                : null;
            },
            'failed replacement source recovery on result A',
            7000,
          );
          const sourcePaperAfterFailure = document.querySelector('.source-paper');
          const sourceAAfter = sourcePaperAfterFailure?.textContent || '';
          const previousAVisibleAfterFailure = sourceAAfter === sourceABefore
            && !sourceAAfter.includes(replacementSource);
          ensure(previousAVisibleAfterFailure,
            'failed replacement source B displaced the visible valid result A');

          const warningActions = [...failedWarning.querySelectorAll('button')];
          const failedAttemptNoticeVisible = failedWarning.isConnected;
          const retryActionBeforeReview = warningActions.find(
            (button) => button.textContent?.trim() === '重试刚才的原文',
          );
          const reviewAction = warningActions.find(
            (button) => button.textContent?.trim() === '查看并修正刚才的原文',
          );
          ensure(retryActionBeforeReview && !retryActionBeforeReview.disabled,
            'failed replacement source did not expose a direct retry action');
          ensure(reviewAction && !reviewAction.disabled,
            'failed replacement source did not expose a review-and-correct action');

          const firstPayloads = readProcessPayloads();
          ensure(firstPayloads.length === 1,
            'failed replacement source fixture did not record exactly one first payload');
          const firstPayload = firstPayloads[0];
          const expectedCapture = {
            confidence: 0.91,
            blocks: [{
              id: 'fixture-source-b-block-1',
              text: replacementSource,
              confidence: 0.91,
              boundingBox: { x: 18, y: 24, width: 420, height: 36 },
            }],
          };
          const firstPayloadIsB = firstPayload.text === replacementSource
            && firstPayload.source === 'ocr'
            && firstPayload.truncated === false
            && firstPayload.originalLength === replacementSource.length
            && JSON.stringify(firstPayload.capture) === JSON.stringify(expectedCapture);
          ensure(firstPayloadIsB,
            'first failed processing payload did not preserve source B capture metadata');

          click(reviewAction);
          const reviewTextarea = await waitFor(
            () => {
              const candidate = document.querySelector(
                'textarea[aria-label="要解释的完整原文"]',
              );
              return candidate?.value === replacementSource ? candidate : null;
            },
            'retained replacement source B review textarea',
          );
          const reviewSourceBVisible = reviewTextarea.value === replacementSource;
          const textareaValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          ).set;
          textareaValueSetter.call(reviewTextarea, correctedReplacementSource);
          reviewTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          const correctedSourceBVisible = Boolean(await waitFor(
            () => reviewTextarea.value === correctedReplacementSource && reviewTextarea,
            'corrected retained replacement source B prime',
          ));
          const returnToPreviousResult = [...document.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === '先返回上一份结果');
          ensure(returnToPreviousResult && !returnToPreviousResult.disabled,
            'reviewing replacement source B did not preserve a return path to result A');
          ensure(readProcessRequests() === 1,
            'reviewing retained source B unexpectedly submitted another processing request');
          click(returnToPreviousResult);
          const restoredWarning = await waitFor(
            () => {
              const candidate = document.querySelector('.inline-warning[role="alert"]');
              const text = candidate?.textContent || '';
              const restoredSource = document.querySelector('.source-paper')?.textContent || '';
              return restoredSource === sourceABefore
                && text.includes('重试修正后的原文')
                && text.includes('查看并修正刚才的原文')
                ? candidate
                : null;
            },
            'result A and retained source B recovery actions after review',
          );
          const restoredWarningActions = [...restoredWarning.querySelectorAll('button')];
          const retryAction = restoredWarningActions.find(
            (button) => button.textContent?.trim() === '重试修正后的原文',
          );
          const restoredReviewAction = restoredWarningActions.find(
            (button) => button.textContent?.trim() === '查看并修正刚才的原文',
          );
          const reviewReturnRestoredA = document.querySelector('.source-paper')?.textContent
            === sourceABefore;
          const reviewReturnRestoredActions = Boolean(
            retryAction && !retryAction.disabled
              && restoredReviewAction && !restoredReviewAction.disabled,
          );
          const reviewDidNotSubmit = readProcessRequests() === 1;
          ensure(reviewReturnRestoredA,
            'returning from retained source B review did not restore result A');
          ensure(reviewReturnRestoredActions,
            'returning from retained source B review lost its retry or review action');
          ensure(reviewDidNotSubmit,
            'reviewing and returning from source B changed the processing request count');

          click(retryAction);
          await waitFor(
            () => readProcessRequests() === 2 && document.querySelector('.processing-card'),
            'second processing request for retained source B',
          );
          const successfulSourcePaper = await waitFor(
            () => {
              const candidate = document.querySelector('.source-paper');
              return document.querySelector('.result-footer')
                && candidate?.textContent?.includes(correctedReplacementSource)
                ? candidate
                : null;
            },
            'successful corrected retained source B result',
            7000,
          );
          const finalPayloads = readProcessPayloads();
          ensure(finalPayloads.length === 2,
            'retry of retained source B issued an unexpected number of processing requests');
          const secondPayload = finalPayloads[1];
          const retryPayloadMatchesCorrectedB = secondPayload.text === correctedReplacementSource
            && secondPayload.text !== replacementSource
            && secondPayload.text !== sourceABefore
            && secondPayload.source === 'manual'
            && secondPayload.capture === null
            && secondPayload.truncated === false
            && secondPayload.originalLength === correctedReplacementSource.length;
          ensure(retryPayloadMatchesCorrectedB,
            'retry did not submit corrected source B with truthful manual metadata');
          ensure(successfulSourcePaper.textContent.includes(correctedReplacementSource),
            'successful retry did not promote corrected source B into the visible result');

          failedSourceRetry = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            initialAVisible,
            previousAVisibleAfterFailure,
            failedAttemptNoticeVisible,
            retryActionVisible: Boolean(retryActionBeforeReview),
            reviewActionVisible: Boolean(reviewAction),
            reviewSourceBVisible,
            correctedSourceBVisible,
            reviewReturnRestoredA,
            reviewReturnRestoredActions,
            reviewDidNotSubmit,
            firstPayloadIsB,
            retryPayloadMatchesCorrectedB,
            successfulCorrectedBVisible: successfulSourcePaper.textContent.includes(
              correctedReplacementSource,
            ),
            source: secondPayload.source,
            truncated: secondPayload.truncated,
            originalLength: secondPayload.originalLength,
            captureMetadataCleared: secondPayload.capture === null,
            processRequests: readProcessRequests(),
          };
        }

        if (isOptionCEditTransitionRun) {
          const readProcessRequests = () => Number(
            document.documentElement.dataset.demoProcessRequests,
          );
          const sourceInput = await waitFor(
            () => {
              const candidate = document.querySelector(
                'textarea[aria-label="要解释的完整原文"]',
              );
              return candidate?.value.trim() && readProcessRequests() === 0
                ? candidate
                : null;
            },
            'single delayed Option+C source before dispatch',
          );
          const capturedSource = sourceInput.value;
          const editedSource = capturedSource
            + '\\n\\nFixture correction entered before delayed dispatch.';
          sourceInput.focus({ preventScroll: true });
          const textareaValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          ).set;
          textareaValueSetter.call(sourceInput, editedSource);
          sourceInput.dispatchEvent(new Event('input', { bubbles: true }));

          const editedInput = await waitFor(
            () => {
              const candidate = document.querySelector(
                'textarea[aria-label="要解释的完整原文"]',
              );
              return candidate?.value === editedSource && readProcessRequests() === 0
                ? candidate
                : null;
            },
            'edited Option+C source before delayed dispatch',
          );
          const pauseNotice = await waitFor(
            () => {
              const candidate = document.querySelector('.capture-warning');
              return candidate?.textContent?.includes('修改后的文字没有自动发送')
                && candidate.textContent.includes('生成按钮')
                && candidate.textContent.includes('Command+Enter')
                ? candidate
                : null;
            },
            'visible manual-submit notice after source edit',
          );
          const pauseStyle = window.getComputedStyle(pauseNotice);
          const pauseRect = pauseNotice.getBoundingClientRect();
          const pauseNoticeVisible = pauseNotice.isConnected
            && pauseStyle.display !== 'none'
            && pauseStyle.visibility !== 'hidden'
            && Number(pauseStyle.opacity || 1) > 0
            && pauseRect.width > 0
            && pauseRect.height > 0;

          await delay(550);
          const requestsAfterDelayedWindow = readProcessRequests();
          ensure(requestsAfterDelayedWindow === 0,
            'edited Option+C source dispatched the stale captured original');
          ensure(editedInput.value === editedSource,
            'edited Option+C source changed while automatic dispatch was paused');
          ensure(!document.querySelector('.processing-card'),
            'edited Option+C source entered processing before explicit submit');
          ensure(pauseNoticeVisible,
            'manual-submit pause notice was not visibly rendered');

          const processAction = document.querySelector('.process-button');
          ensure(processAction && !processAction.disabled,
            'edited source did not retain an explicit processing action');
          click(processAction);
          await waitFor(
            () => readProcessRequests() === 1
              && document.querySelector('.processing-card'),
            'one explicit edited-source processing request',
          );
          await waitFor(
            () => document.querySelector('.result-footer'),
            'edited-source result',
            7000,
          );
          ensure(readProcessRequests() === 1,
            'explicit edited-source processing started more than once');

          const editSourceAction = [...document.querySelectorAll('.result-footer button')]
            .find((button) => button.textContent?.includes('修正原文'));
          ensure(editSourceAction, 'result did not expose source correction');
          click(editSourceAction);
          const reopenedInput = await waitFor(
            () => {
              const candidate = document.querySelector(
                'textarea[aria-label="要解释的完整原文"]',
              );
              return candidate?.value === editedSource ? candidate : null;
            },
            'processed edited source reopened from result',
          );
          const finalProcessRequests = readProcessRequests();
          ensure(finalProcessRequests === 1,
            'reopening the processed edited source changed the request count');

          optionCEditTransition = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            captureArrivedBeforeDispatch: Boolean(capturedSource.trim()),
            editedDuringTransition: editedSource !== capturedSource,
            staleRequestBlocked: requestsAfterDelayedWindow === 0,
            pauseNoticeVisible,
            pauseNoticeExplainsManualSubmit: pauseNotice.textContent.includes('修改后的文字没有自动发送')
              && pauseNotice.textContent.includes('生成按钮')
              && pauseNotice.textContent.includes('Command+Enter'),
            latestDraftPreserved: editedInput.value === editedSource,
            explicitSubmitStartedOnce: finalProcessRequests === 1,
            reopenedEditedSource: reopenedInput.value === editedSource,
            staleCapturedSourceRejected: reopenedInput.value !== capturedSource,
            processRequests: finalProcessRequests,
          };
        }

        if (isReplyCopySettlementRun) {
          const buttonWithText = (root, text) => [...root.querySelectorAll('button')]
            .find((button) => button.textContent?.trim().includes(text));
          const isRendered = (target) => {
            if (!target?.isConnected) return false;
            const style = window.getComputedStyle(target);
            const rect = target.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity || 1) > 0
              && rect.width > 0
              && rect.height > 0
              && rect.right > 0
              && rect.bottom > 0
              && rect.left < window.innerWidth
              && rect.top < window.innerHeight;
          };
          const officialSources = await waitFor(
            () => buttonWithText(document, '官方来源'),
            'official sources disclosure',
          );
          click(officialSources);
          const approveOfficialSources = await waitFor(
            () => buttonWithText(document, '批准并查找官方来源'),
            'fixture-only official source approval',
          );
          click(approveOfficialSources);
          await waitFor(
            () => document.querySelector('[data-source-link-copy-action]'),
            'retrieved official source copy action',
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
          ensure(inProgressStatus, 'Copyable real reply status is missing');
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
          const copyableDraft = replyTextarea.value.replace('[Your name]', 'Fixture User');
          textareaValueSetter.call(replyTextarea, copyableDraft);
          replyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          const copyReply = await waitFor(
            () => {
              const candidate = document.querySelector('[data-reply-copy-action]');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled guided reply copy action',
          );
          const originalDraft = replyTextarea.value;
          click(copyReply);
          const pendingCopy = await waitFor(
            () => {
              const candidate = document.querySelector('[data-reply-copy-action]');
              return candidate?.disabled
                && candidate.getAttribute('aria-busy') === 'true'
                && candidate.textContent?.includes('正在复制')
                ? candidate
                : null;
            },
            'pending and disabled guided reply copy action',
          );
          const pendingNotice = await waitFor(
            () => {
              const candidate = document.querySelector(
                '[data-clipboard-kind="reply"][data-clipboard-status="copying"]',
              );
              return candidate?.textContent?.includes('复制')
                && candidate.textContent.includes('英文回复')
                ? candidate
                : null;
            },
            'pending guided reply copy notice',
          );
          const pendingActionDisabled = pendingCopy.disabled;
          const pendingActionBusy = pendingCopy.getAttribute('aria-busy') === 'true';
          const pendingNoticeVisible = pendingNotice.isConnected;
          const newerDraft = originalDraft + String.fromCharCode(10, 10) + 'Fixture-only newer draft.';
          textareaValueSetter.call(replyTextarea, newerDraft);
          replyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(
            () => {
              const candidate = document.querySelector('textarea[aria-label="英文回复草稿"]');
              return candidate?.isConnected && candidate.value === newerDraft ? candidate : null;
            },
            'newer guided reply draft',
          );
          await delay(150);
          const controlledReplyTextarea = document.querySelector(
            'textarea[aria-label="英文回复草稿"]',
          );
          ensure(
            controlledReplyTextarea?.isConnected && controlledReplyTextarea.value === newerDraft,
            'Newer reply draft did not reach controlled state',
          );
          click(document.querySelector('[aria-label="关闭回复草稿"]'));
          await waitFor(
            () => !document.querySelector('.reply-drawer'),
            'guided reply drawer dismissal',
          );
          const resultCopyAction = await waitFor(
            () => document.querySelector('[data-result-copy-action]'),
            'serialized result copy action',
          );
          const actionsCopyAction = await waitFor(
            () => document.querySelector('[data-actions-copy-action]'),
            'serialized actions copy action',
          );
          const sourceLinkCopyActions = [...document.querySelectorAll('[data-source-link-copy-action]')];
          const crossEntryCopyActions = [
            resultCopyAction,
            actionsCopyAction,
            ...sourceLinkCopyActions,
          ];
          ensure(
            crossEntryCopyActions.every((action) => action.disabled),
            'A non-reply clipboard entry stayed enabled while the reply write was pending',
          );
          const resultCopyDisabledWhileReplyPending = resultCopyAction.disabled;
          const actionsCopyDisabledWhileReplyPending = actionsCopyAction.disabled;
          const sourceLinksDisabledWhileReplyPending = sourceLinkCopyActions
            .every((action) => action.disabled);
          const writesBeforeCrossEntryClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesBeforeCrossEntryClicks === 1,
            'Reply fixture did not own exactly one pending clipboard write before cross-entry clicks',
          );
          crossEntryCopyActions.forEach((action) => action.click());
          await delay(100);
          const writesAfterCrossEntryClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesAfterCrossEntryClicks === writesBeforeCrossEntryClicks,
            'A disabled cross-entry copy action started another clipboard write',
          );
          const exitTask = await waitFor(
            () => buttonWithText(document, '清空并返回'),
            'task exit action before clipboard settlement',
          );
          click(exitTask);
          const undoTaskExit = await waitFor(
            () => buttonWithText(document, '撤销清空'),
            'task-exit Undo action before clipboard settlement',
          );
          const taskExitPending = await waitFor(
            () => {
              const candidate = document.querySelector(
                '[data-clipboard-kind="reply"][data-clipboard-status="copying"]',
              );
              return candidate?.textContent?.includes('任务已结束，正在确认')
                && candidate.textContent.includes('英文回复是否复制')
                ? candidate
                : null;
            },
            'task-exit clipboard settlement notice',
          );
          const taskExitedBeforeSettlement = taskExitPending.isConnected
            && undoTaskExit.isConnected;

          const savedTermsTrigger = await waitFor(
            () => document.querySelector('button[aria-label^="打开术语库"]'),
            'saved terms trigger during clipboard settlement',
          );
          click(savedTermsTrigger);
          const pendingTermsDrawer = await waitFor(
            () => {
              const candidate = document.querySelector('#saved-terms-drawer');
              return candidate?.querySelector('[data-saved-term-copy-action]')
                ? candidate
                : null;
            },
            'resolved saved terms drawer during clipboard settlement',
          );
          const savedTermCopyActions = [...pendingTermsDrawer.querySelectorAll(
            '[data-saved-term-copy-action]',
          )];
          ensure(
            savedTermCopyActions.length >= 3,
            'Fixture sample term did not expose every copy variant',
          );
          ensure(
            savedTermCopyActions.every((action) => action.disabled),
            'A saved-term copy action stayed enabled while the reply write was pending',
          );
          const savedTermCopiesDisabledWhileReplyPending = savedTermCopyActions
            .every((action) => action.disabled);
          const writesBeforeSavedTermClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesBeforeSavedTermClicks === 1,
            'Saved terms did not inherit the sole pending reply clipboard write',
          );
          savedTermCopyActions.forEach((action) => action.click());
          await delay(100);
          const writesAfterSavedTermClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesAfterSavedTermClicks === writesBeforeSavedTermClicks,
            'A disabled saved-term copy action started another clipboard write',
          );
          click(pendingTermsDrawer.querySelector('button[aria-label="关闭术语库"]'));
          await waitFor(
            () => !document.querySelector('#saved-terms-drawer'),
            'saved terms dismissal during clipboard settlement',
          );

          click(await waitFor(
            () => document.querySelector('button[aria-label="打开设置"]'),
            'Settings trigger during clipboard settlement',
          ));
          const clipboardSettingsPanel = await waitFor(
            () => document.querySelector('.settings-panel'),
            'Settings during clipboard settlement',
          );
          const connectionTestAction = await waitFor(
            () => {
              const candidate = clipboardSettingsPanel.querySelector('.provider-connection-test-button');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled fixture connection test during clipboard settlement',
          );
          click(connectionTestAction);
          const diagnosticsCopyAction = await waitFor(
            () => {
              const candidate = clipboardSettingsPanel.querySelector(
                '[data-support-diagnostics-copy-action]',
              );
              return candidate?.disabled
                && candidate.getAttribute('aria-busy') === 'true'
                && candidate.textContent?.includes('正在确认剪贴板复制')
                ? candidate
                : null;
            },
            'disabled diagnostics copy during reply clipboard settlement',
          );
          const recoveryCommandCopyActions = await waitFor(
            () => {
              const candidates = [...clipboardSettingsPanel.querySelectorAll(
                '[data-connection-recovery-copy-action="true"]',
              )];
              return candidates.length >= 2
                && candidates.every((candidate) => (
                  candidate.disabled && candidate.getAttribute('aria-busy') === 'true'
                ))
                ? candidates
                : null;
            },
            'disabled recovery command copies during reply clipboard settlement',
          );
          const diagnosticsCopyDisabledWhileReplyPending = diagnosticsCopyAction.disabled;
          const recoveryCommandsDisabledWhileReplyPending = recoveryCommandCopyActions
            .every((action) => action.disabled);
          const writesBeforeSettingsClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesBeforeSettingsClicks === 1,
            'Settings did not inherit the sole pending reply clipboard write',
          );
          [diagnosticsCopyAction, ...recoveryCommandCopyActions]
            .forEach((action) => action.click());
          await delay(100);
          const writesAfterSettingsClicks = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            writesAfterSettingsClicks === writesBeforeSettingsClicks,
            'A disabled Settings copy action started another clipboard write',
          );

          const retainedNotice = await waitFor(
            () => clipboardSettingsPanel.querySelector(
              '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
            ),
            'globally retained late clipboard success in Settings',
            7000,
          );
          ensure(isRendered(retainedNotice), 'Late clipboard success is not visible in Settings');
          const settingsNoAutomaticClipboardAction = !retainedNotice.querySelector(
            '[data-clipboard-clear-action]',
          );
          ensure(
            settingsNoAutomaticClipboardAction
              && retainedNotice.textContent?.includes('手动覆盖'),
            'Settings did not preserve the retained reply consequence without automatic clearing',
          );
          const lateSuccessRetainedGlobally = retainedNotice.isConnected;
          const retainedConsequenceVisibleInSettings = isRendered(retainedNotice);
          click(clipboardSettingsPanel.querySelector('[data-quit-return-focus]'));
          await waitFor(
            () => !document.querySelector('.settings-panel'),
            'return from Settings with retained clipboard authority',
          );

          click(await waitFor(
            () => document.querySelector('button[aria-label^="打开术语库"]'),
            'saved terms trigger with retained clipboard authority',
          ));
          const retainedTermsDrawer = await waitFor(
            () => {
              const candidate = document.querySelector('#saved-terms-drawer');
              return candidate?.querySelector(
                '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
              ) ? candidate : null;
            },
            'resolved saved terms drawer with retained clipboard authority',
          );
          const retainedTermsNotice = await waitFor(
            () => retainedTermsDrawer.querySelector(
              '[data-clipboard-kind="reply"][data-clipboard-status="retained"]',
            ),
            'retained clipboard authority in saved terms',
          );
          ensure(isRendered(retainedTermsNotice), 'Retained clipboard success is not visible in saved terms');
          const savedTermsNoAutomaticClipboardAction = !retainedTermsNotice.querySelector(
            '[data-clipboard-clear-action]',
          );
          ensure(
            savedTermsNoAutomaticClipboardAction
              && retainedTermsNotice.textContent?.includes('手动覆盖'),
            'Saved Terms did not preserve the retained reply consequence without automatic clearing',
          );
          const retainedConsequenceVisibleInSavedTerms = isRendered(retainedTermsNotice);
          click(retainedTermsDrawer.querySelector('button[aria-label="关闭术语库"]'));
          await waitFor(
            () => !document.querySelector('#saved-terms-drawer'),
            'saved terms dismissal with retained clipboard authority',
          );

          const restoredUndoTaskExit = await waitFor(
            () => buttonWithText(document, '撤销清空'),
            'restored task-exit Undo action after clipboard surface checks',
          );
          click(restoredUndoTaskExit);
          const reconciledReplyEvidence = await waitForStableEvidence(
            () => {
              const replyNotices = [...document.querySelectorAll('[data-clipboard-kind="reply"]')];
              const notice = replyNotices.find((candidate) => (
                ['retained', 'outdated'].includes(
                  candidate.getAttribute('data-clipboard-status') || '',
                )
              ));
              return {
                resultFooterConnected: Boolean(document.querySelector('.result-footer')?.isConnected),
                noticeConnected: Boolean(notice?.isConnected),
                noticeStatus: notice?.getAttribute('data-clipboard-status') || '',
                noticeMentionsReply: notice?.textContent?.includes('英文回复') === true,
                replyNoticeStatuses: replyNotices.map((candidate) => (
                  candidate.getAttribute('data-clipboard-status') || ''
                )),
              };
            },
            (snapshot) => snapshot.resultFooterConnected
              && snapshot.noticeConnected
              && ['retained', 'outdated'].includes(snapshot.noticeStatus)
              && snapshot.noticeMentionsReply,
            'restored Result and reply clipboard consequence after Undo',
            { timeout: 7000 },
          );
          const reconciledReplyNotice = document.querySelector(
            '[data-clipboard-kind="reply"][data-clipboard-status="retained"], '
              + '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
          );
          ensure(
            reconciledReplyEvidence.noticeMentionsReply
              && reconciledReplyNotice?.textContent?.includes('英文回复'),
            'Undo did not preserve the earlier reply clipboard consequence',
          );
          const undoPreservedReplyConsequence = Boolean(reconciledReplyNotice);
          const restoredPrepareReply = await waitFor(
            () => buttonWithText(document, '准备英文回复'),
            'restored guided reply action',
          );
          click(restoredPrepareReply);
          const restoredTextarea = await waitFor(
            () => document.querySelector('textarea[aria-label="英文回复草稿"]'),
            'restored guided reply draft',
          );
          ensure(restoredTextarea.value === newerDraft, 'Undo did not restore the newer reply draft');
          const visibleReplyConsequence = await waitFor(
            () => document.querySelector(
              '[data-clipboard-kind="reply"][data-clipboard-status="retained"], '
                + '[data-clipboard-kind="reply"][data-clipboard-status="outdated"]',
            ),
            'visible clipboard consequence after Undo',
          );
          const replyNoAutomaticClipboardAction = !visibleReplyConsequence.querySelector(
            '[data-clipboard-clear-action]',
          );
          ensure(
            replyNoAutomaticClipboardAction
              && visibleReplyConsequence.textContent?.includes('英文回复'),
            'Retained reply consequence exposed an automatic clipboard action',
          );
          click(document.querySelector('[aria-label="关闭回复草稿"]'));
          await waitFor(
            () => !document.querySelector('.reply-drawer'),
            'restored guided reply drawer dismissal',
          );
          const followupResultCopy = await waitFor(
            () => {
              const candidate = document.querySelector('[data-result-copy-action]');
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled result copy for consequence acknowledgement',
          );
          click(followupResultCopy);
          const copiedResultNotice = await waitFor(
            () => document.querySelector(
              '[data-clipboard-kind="result"][data-clipboard-status="copied"]',
            ),
            'result copy consequence requiring manual overwrite',
          );
          const followupResultConsequenceVisible = copiedResultNotice.isConnected;
          const manualOverwriteAcknowledgement = await waitFor(
            () => {
              const candidate = copiedResultNotice.querySelector(
                '[data-clipboard-consequence-ack]',
              );
              return candidate && !candidate.disabled ? candidate : null;
            },
            'enabled manual-overwrite acknowledgement for result copy',
          );
          ensure(
            manualOverwriteAcknowledgement
              && !manualOverwriteAcknowledgement.disabled
              && manualOverwriteAcknowledgement.textContent?.includes('我已手动覆盖')
              && copiedResultNotice.textContent?.includes('不会读取或更改剪贴板')
              && !copiedResultNotice.querySelector('[data-clipboard-clear-action]'),
            'Result copy consequence did not require manual-overwrite acknowledgement',
          );
          const writesBeforeAcknowledgement = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          click(manualOverwriteAcknowledgement);
          const acknowledgedNotice = await waitFor(
            () => document.querySelector(
              '[data-clipboard-kind="result"][data-clipboard-status="acknowledged"]',
            ),
            'confirmed manual clipboard overwrite acknowledgement',
          );
          const writesAfterAcknowledgement = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          ensure(
            acknowledgedNotice.textContent?.includes('已确认你在其他位置复制了新内容')
              && acknowledgedNotice.textContent?.includes('没有读取、清除或覆盖系统剪贴板')
              && writesAfterAcknowledgement === writesBeforeAcknowledgement,
            'Manual-overwrite acknowledgement changed the clipboard or hid its consequence',
          );
          const clipboardWriteRequests = Number(
            document.documentElement.dataset.demoClipboardWriteRequests,
          );
          const nativeClipboardWriteStubs = Number(
            document.documentElement.dataset.demoNativeClipboardWriteStubs,
          );
          ensure(
            Number.isSafeInteger(clipboardWriteRequests)
              && Number.isSafeInteger(nativeClipboardWriteStubs)
              && clipboardWriteRequests === 2
              && nativeClipboardWriteStubs === 2,
            'Clipboard consequence fixture did not use exactly two isolated writes',
          );
          replyCopySettlement = {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            pendingActionDisabled,
            pendingActionBusy,
            pendingNoticeVisible,
            editedBeforeSettlement: newerDraft !== originalDraft,
            resultCopyDisabledWhileReplyPending,
            actionsCopyDisabledWhileReplyPending,
            sourceLinkCopyCountWhileReplyPending: sourceLinkCopyActions.length,
            sourceLinksDisabledWhileReplyPending,
            savedTermCopyCountWhileReplyPending: savedTermCopyActions.length,
            savedTermCopiesDisabledWhileReplyPending,
            diagnosticsCopyDisabledWhileReplyPending,
            recoveryCommandCopyCountWhileReplyPending: recoveryCommandCopyActions.length,
            recoveryCommandsDisabledWhileReplyPending,
            crossEntryClicksRejected: writesAfterCrossEntryClicks === writesBeforeCrossEntryClicks,
            writesBeforeCrossEntryClicks,
            writesAfterCrossEntryClicks,
            writesAfterSavedTermClicks,
            writesAfterSettingsClicks,
            taskExitedBeforeSettlement,
            lateSuccessRetainedGlobally,
            retainedConsequenceVisibleInSettings,
            settingsNoAutomaticClipboardAction,
            retainedConsequenceVisibleInSavedTerms,
            savedTermsNoAutomaticClipboardAction,
            undoRestoredNewerDraft: restoredTextarea.value === newerDraft,
            undoPreservedReplyConsequence,
            replyNoAutomaticClipboardAction,
            followupResultConsequenceVisible,
            manualOverwriteAcknowledgementVisible: Boolean(manualOverwriteAcknowledgement),
            manualOverwriteAcknowledged: acknowledgedNotice.getAttribute('data-clipboard-status')
              === 'acknowledged',
            acknowledgementDidNotWrite: writesAfterAcknowledgement
              === writesBeforeAcknowledgement,
            clipboardWriteRequests,
            nativeClipboardWriteStubs,
          };
        }

        return {
          marker: window.slipstreamUiFixture,
          dataset: document.documentElement.dataset.uiFixture,
          setupTitle: document.querySelector('#setup-title')?.textContent || '',
          settingsIpcRejected,
          clipboardStubbed: clipboardResponse?.fixture === true,
          trustedInputBridgeAvailable: Boolean(window.slipstreamUiFixtureInput),
          sameOriginFetchAllowed: sameOriginResponse.ok,
          nodeGlobalsUnavailable: typeof require === 'undefined' && typeof process === 'undefined',
          settingsTransition,
          replyCopySettlement,
          optionCEditTransition,
          runtimeDegraded,
          startupRecovery,
          clipboardResidueRecovery,
          providerRetry,
          settingsSaveRetry,
          settingsPromptDraftRecovery,
          failedDraftDiscard,
          failedSourceRetry,
          firstUseCaptureTextScale,
          completedResultTextScale,
          guidedReplyTextScale,
          stackedStatusTextScale,
          lazyWorkspaceRecovery,
          settingsStylesheetCollision,
          manualClipboardReplacement,
        };
      })()
    `, true);
    if (fixtureRun === 'stacked-status-text-scale-native') {
      let wideShortProof = null;
      try {
        getMainWindow().setContentSize(800, 400);
        await new Promise((resolve) => setTimeout(resolve, 100));
        wideShortProof = await getMainWindow().webContents.executeJavaScript(`
          (async () => {
            const delay = (milliseconds) => new Promise(
              (resolve) => window.setTimeout(resolve, milliseconds)
            );
            await new Promise((resolve) => window.requestAnimationFrame(
              () => window.requestAnimationFrame(resolve)
            ));
            const ensure = (condition, message) => {
              if (!condition) throw new Error(message);
            };
            const shell = document.querySelector('.slipstream-shell.has-foreground-status');
            const statusCenter = shell?.querySelector(
              '.foreground-status-center[data-pending-capture-count="2"]'
                + '[data-operational-status-count="2"]'
            );
            const header = shell?.querySelector('.app-header');
            const screenshot = statusCenter?.querySelector(
              '.clipboard-monitor-queue.is-screenshot-request'
            );
            const clipboard = [...(statusCenter?.querySelectorAll(
              '.clipboard-monitor-queue'
            ) || [])].find((candidate) => !candidate.classList.contains('is-screenshot-request'));
            const shortcut = statusCenter?.querySelector('.shortcut-readiness-alert');
            const monitoring = statusCenter?.querySelector('.clipboard-monitoring-live');
            const core = shell?.querySelector('.processing-card');
            const coreHeading = core?.querySelector('h2');
            const coreCancel = core?.querySelector('.processing-cancel-button');
            ensure(window.innerWidth === 400 && window.innerHeight === 200,
              'Wide-short fixture did not expose an exact 400x200 CSS viewport');
            ensure(
              shell && statusCenter && header && screenshot && clipboard
                && shortcut && monitoring && core && coreHeading && coreCancel,
              'Wide-short fixture lost a status or the active processing task'
            );

            const rectOf = (element) => {
              const rect = element.getBoundingClientRect();
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              };
            };
            const pageNoHorizontalOverflow = () => (
              document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
                && document.body.scrollWidth <= document.body.clientWidth + 1
                && shell.scrollWidth <= shell.clientWidth + 1
            );
            const nextFrame = () => new Promise(
              (resolve) => window.requestAnimationFrame(resolve)
            );
            const waitForStableEvidence = async (read, ready, label) => {
              const deadline = Date.now() + 2000;
              let lastSnapshot = null;
              let lastKey = null;
              let stableFrames = 0;
              while (Date.now() < deadline) {
                await nextFrame();
                const snapshot = read();
                const key = JSON.stringify(snapshot);
                const isReady = ready(snapshot) === true;
                if (isReady && key === lastKey) stableFrames += 1;
                else stableFrames = isReady ? 1 : 0;
                lastSnapshot = snapshot;
                lastKey = key;
                if (stableFrames >= 3) return snapshot;
              }
              throw new Error(
                'Timed out waiting for stable ' + label + ': '
                  + JSON.stringify({ lastSnapshot, requiredFrames: 3 })
              );
            };
            const readScrollPosition = (scrollport) => ({
              connected: scrollport.isConnected,
              top: scrollport.scrollTop,
              left: scrollport.scrollLeft,
              scrollHeight: scrollport.scrollHeight,
              scrollWidth: scrollport.scrollWidth,
              clientHeight: scrollport.clientHeight,
              clientWidth: scrollport.clientWidth,
            });
            const waitForStableScrollPosition = (scrollport, top, label) => (
              waitForStableEvidence(
                () => readScrollPosition(scrollport),
                (snapshot) => {
                  const expectedTop = top === 'maximum'
                    ? Math.max(0, snapshot.scrollHeight - snapshot.clientHeight)
                    : top;
                  return snapshot.connected
                    && Math.abs(snapshot.top - expectedTop) <= 1
                    && Math.abs(snapshot.left) <= 1;
                },
                label
              )
            );
            const visibleScrollport = (scrollport) => {
              const rect = scrollport.getBoundingClientRect();
              const left = rect.left + scrollport.clientLeft;
              const top = rect.top + scrollport.clientTop;
              return {
                left: Math.max(0, left),
                top: Math.max(0, top),
                right: Math.min(window.innerWidth, left + scrollport.clientWidth),
                bottom: Math.min(window.innerHeight, top + scrollport.clientHeight),
              };
            };
            const fullyVisibleIn = (target, scrollport, inset = 0) => {
              const rect = target.getBoundingClientRect();
              const port = visibleScrollport(scrollport);
              return rect.left - inset >= port.left - 1
                && rect.top - inset >= port.top - 1
                && rect.right + inset <= port.right + 1
                && rect.bottom + inset <= port.bottom + 1;
            };
            const alignTargetInScrollport = (target, scrollport) => {
              const rect = target.getBoundingClientRect();
              const port = visibleScrollport(scrollport);
              const availableHeight = Math.max(1, port.bottom - port.top);
              const desiredTop = rect.height <= availableHeight
                ? port.top + (availableHeight - rect.height) / 2
                : port.top;
              scrollport.scrollTop = scrollport.scrollTop + rect.top - desiredTop;
            };
            const cssPaintIsVisible = (value) => {
              const normalized = String(value || '').trim().toLowerCase();
              return normalized
                && normalized !== 'none'
                && normalized !== 'transparent'
                && !/^rgba\\([^)]*,\\s*0(?:\\.0+)?\\)$/u.test(normalized);
            };
            const readRevealEvidence = (target, scrollport, label, focusTarget) => {
              const style = getComputedStyle(target);
              const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
              const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
              const outlineRendered = outlineWidth > 0
                && style.outlineStyle !== 'none'
                && cssPaintIsVisible(style.outlineColor);
              const shadowRendered = style.boxShadow !== 'none'
                && cssPaintIsVisible(style.boxShadow);
              const focused = focusTarget ? document.activeElement === target : null;
              const focusVisible = focusTarget ? target.matches(':focus-visible') : null;
              const ringRendered = focusTarget
                ? focused && focusVisible && (outlineRendered || shadowRendered)
                : null;
              const ringExtent = outlineRendered
                ? outlineWidth + Math.max(0, outlineOffset)
                : shadowRendered ? 4 : 0;
              return {
                label,
                focused,
                focusVisible,
                ringRendered,
                ringVisible: focusTarget
                  ? ringRendered && fullyVisibleIn(target, scrollport, ringExtent)
                  : null,
                fullyVisible: fullyVisibleIn(target, scrollport),
                pageNoHorizontalOverflow: pageNoHorizontalOverflow(),
                scrollportNoHorizontalOverflow: scrollport.scrollWidth
                  <= scrollport.clientWidth + 1,
                scrollTop: scrollport.scrollTop,
                scrollLeft: scrollport.scrollLeft,
                rect: rectOf(target),
                scrollport: visibleScrollport(scrollport),
              };
            };
            const revealEvidence = async (
              target,
              scrollport,
              label,
              { focus = true } = {}
            ) => {
              alignTargetInScrollport(target, scrollport);
              await waitForStableEvidence(
                () => readRevealEvidence(target, scrollport, label, false),
                (evidence) => evidence.fullyVisible
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow,
                label + ' scroll geometry'
              );
              if (!focus || target.matches(':disabled')) {
                return readRevealEvidence(target, scrollport, label, false);
              }
              target.focus({ preventScroll: true });
              return waitForStableEvidence(
                () => readRevealEvidence(target, scrollport, label, true),
                (evidence) => evidence.focused
                  && evidence.focusVisible
                  && evidence.ringRendered
                  && evidence.ringVisible
                  && evidence.fullyVisible
                  && evidence.pageNoHorizontalOverflow
                  && evidence.scrollportNoHorizontalOverflow,
                label + ' focused geometry'
              );
            };
            const reveal = async (target, label, focusTarget = false) => {
              ensure(target instanceof HTMLElement, 'Missing wide-short target ' + label);
              const evidence = await revealEvidence(
                target,
                shell,
                'wide-short ' + label,
                { focus: focusTarget },
              );
              const focusVisible = focusTarget ? target.matches(':focus-visible') : null;
              return {
                ...evidence,
                label,
                focusVisible,
                pageNoHorizontalOverflow: pageNoHorizontalOverflow(),
                shellScrollLeft: shell.scrollLeft,
                rect: rectOf(target),
              };
            };
            const activeVerticalScrollOwners = [...document.body.querySelectorAll('*')]
              .filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return rect.width > 0
                  && rect.height > 0
                  && ['auto', 'scroll'].includes(style.overflowY)
                  && element.scrollHeight > element.clientHeight + 1;
              });
            const shellIsOnlyVerticalScrollOwner = activeVerticalScrollOwners.length === 1
              && activeVerticalScrollOwners[0] === shell;
            const statusCenterIsNotScrollable = !['auto', 'scroll'].includes(
              getComputedStyle(statusCenter).overflowY
            );
            ensure(shellIsOnlyVerticalScrollOwner && statusCenterIsNotScrollable,
              'Wide-short fixture exposed nested or competing vertical scroll owners');

            shell.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            await waitForStableScrollPosition(
              shell,
              0,
              'wide-short origin',
            );
            const maximumScrollTop = shell.scrollHeight - shell.clientHeight;
            shell.scrollTo({ top: maximumScrollTop, left: 0, behavior: 'auto' });
            await waitForStableScrollPosition(
              shell,
              'maximum',
              'wide-short maximum',
            );
            const reachedMaximum = maximumScrollTop > 0
              && Math.abs(shell.scrollTop - maximumScrollTop) <= 1;
            ensure(reachedMaximum && Math.abs(shell.scrollLeft) <= 1,
              'Wide-short fixture could not traverse the shared vertical scroll range');
            shell.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            await waitForStableScrollPosition(
              shell,
              0,
              'wide-short restored origin',
            );

            const statusEntries = [
              ['screenshot', screenshot],
              ['clipboard', clipboard],
              ['shortcut', shortcut],
              ['monitoring', monitoring],
            ];
            const flow = [header, ...statusEntries.map((entry) => entry[1]), core];
            const flowRects = flow.map(rectOf);
            const flowDoesNotOverlap = flowRects.slice(0, -1).every(
              (rect, index) => rect.bottom <= flowRects[index + 1].top + 1
            );
            ensure(flowDoesNotOverlap,
              'Wide-short header, statuses, or core task overlap');

            const passiveEvidence = {
              header: await reveal(header, 'wide-short header'),
            };
            for (const [key, card] of statusEntries) {
              passiveEvidence[key] = await reveal(card, 'wide-short ' + key + ' status');
            }
            passiveEvidence.coreHeading = await reveal(coreHeading, 'wide-short core heading');
            const allPassiveContentReachable = Object.values(passiveEvidence).every(
              (evidence) => evidence.fullyVisible
                && evidence.pageNoHorizontalOverflow
                && Math.abs(evidence.shellScrollLeft) <= 1
            );
            ensure(allPassiveContentReachable,
              'Wide-short passive content was not vertically reachable without horizontal overflow');

            const allStatusActions = statusEntries.flatMap(
              ([, card]) => [...card.querySelectorAll('button')]
            );
            ensure(allStatusActions.length === 6,
              'Wide-short fixture did not retain all six status actions');
            const focusEvidence = {};
            const disabledEvidence = {};
            for (let index = 0; index < allStatusActions.length; index += 1) {
              const action = allStatusActions[index];
              const label = 'status action ' + (index + 1);
              if (action.disabled) disabledEvidence[label] = await reveal(action, label);
              else focusEvidence[label] = await reveal(action, label, true);
            }
            focusEvidence.coreCancel = await reveal(coreCancel, 'wide-short core cancel', true);
            const allEnabledActionsFocusVisible = Object.values(focusEvidence).every(
              (evidence) => evidence.focused
                && evidence.focusVisible
                && evidence.ringRendered
                && evidence.ringVisible
                && evidence.pageNoHorizontalOverflow
                && Math.abs(evidence.shellScrollLeft) <= 1
            );
            const allDisabledActionsReachable = Object.values(disabledEvidence).every(
              (evidence) => evidence.fullyVisible
                && evidence.pageNoHorizontalOverflow
                && Math.abs(evidence.shellScrollLeft) <= 1
            );
            ensure(allEnabledActionsFocusVisible && allDisabledActionsReachable,
              'Wide-short status or core action was clipped or lost visible keyboard focus');
            ensure(pageNoHorizontalOverflow(),
              'Wide-short fixture introduced horizontal overflow');

            return {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              counts: {
                pendingCaptureCount: Number(statusCenter.dataset.pendingCaptureCount),
                operationalStatusCount: Number(statusCenter.dataset.operationalStatusCount),
                actionCount: allStatusActions.length,
                enabledActionCount: allStatusActions.filter((action) => !action.disabled).length,
                disabledActionCount: allStatusActions.filter((action) => action.disabled).length,
              },
              shell: {
                overflowY: getComputedStyle(shell).overflowY,
                shellIsOnlyVerticalScrollOwner,
                statusCenterIsNotScrollable,
                clientWidth: shell.clientWidth,
                clientHeight: shell.clientHeight,
                scrollWidth: shell.scrollWidth,
                scrollHeight: shell.scrollHeight,
                maximumScrollTop,
                reachedMaximum,
                noHorizontalOverflow: pageNoHorizontalOverflow(),
              },
              layout: {
                flowDoesNotOverlap,
                allPassiveContentReachable,
                allEnabledActionsFocusVisible,
                allDisabledActionsReachable,
                coreMounted: core.isConnected,
                coreCancelVisible: coreCancel.isConnected,
                fourStatusesRetained: statusEntries.every(([, card]) => card.isConnected),
                flowRects,
              },
              passiveEvidence,
              focusEvidence,
              disabledEvidence,
              appCounters: {
                processRequests: Number(document.documentElement.dataset.demoProcessRequests),
                screenshotCaptureRequests: Number(
                  document.documentElement.dataset.demoScreenshotCaptureRequests
                ),
                clipboardWriteRequests: Number(
                  document.documentElement.dataset.demoClipboardWriteRequests
                ),
                nativeClipboardWriteStubs: Number(
                  document.documentElement.dataset.demoNativeClipboardWriteStubs
                ),
              },
            };
          })()
        `, true);
      } finally {
        getMainWindow().setContentSize(400, 400);
        getMainWindow().webContents.setZoomFactor(2);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const restoredViewport = await getMainWindow().webContents.executeJavaScript(`
        ({ width: window.innerWidth, height: window.innerHeight })
      `, true);
      const [restoredContentWidth, restoredContentHeight] = getMainWindow().getContentSize();
      if (
        !wideShortProof
        || restoredContentWidth !== 400
        || restoredContentHeight !== 400
        || restoredViewport.width !== 200
        || restoredViewport.height !== 200
        || getMainWindow().webContents.getZoomFactor() !== 2
      ) {
        throw new Error('Wide-short fixture did not restore the exact 400x400 native baseline');
      }
      renderer.stackedStatusWideShort = {
        ...wideShortProof,
        restoredBaseline: {
          contentSize: { width: restoredContentWidth, height: restoredContentHeight },
          viewport: restoredViewport,
          zoomFactor: getMainWindow().webContents.getZoomFactor(),
        },
      };
    }
    let sessionTrapFetchBlocked = false;
    try {
      await getMainWindow().webContents.session.fetch(trapUrl, {
        bypassCustomProtocolHandlers: true,
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      sessionTrapFetchBlocked = true;
    }
    const preferences = getMainWindow().webContents.getLastWebPreferences();
    const [contentWidth, contentHeight] = getMainWindow().getContentSize();
    const windowBounds = getMainWindow().getBounds();
    const payload = {
      success: true,
      isPackaged: app.isPackaged,
      rendererUrlExact: getMainWindow().webContents.getURL() === uiFixtureMode.rendererUrl,
      userDataIsFixture: app.getPath('userData') === uiFixtureMode.userDataPath,
      sessionDataIsNested: app.getPath('sessionData').startsWith(`${uiFixtureMode.userDataPath}${path.sep}`),
      contextIsolation: preferences.contextIsolation === true,
      nodeIntegrationDisabled: preferences.nodeIntegration === false,
      sandboxEnabled: preferences.sandbox === true,
      trayCreated: Boolean(getTray()),
      shortcutsRegistered: [DEFAULTS.CLIPBOARD_SHORTCUT, DEFAULTS.SCREENSHOT_SHORTCUT]
        .some((accelerator) => globalShortcut.isRegistered(accelerator)),
      applicationMenuSafe: !applicationMenuHasUnsafeDeveloperActions(),
      inheritedSecretsPresent: Boolean(
        process.env.DEEPSEEK_API_KEY
        || process.env.OPENAI_API_KEY
        || process.env.ANTHROPIC_API_KEY
        || process.env.SSH_AUTH_SOCK
        || process.env.NODE_OPTIONS
      ),
      sessionTrapFetchBlocked,
      blockedRendererExternalRequests: uiFixtureBlockedRendererExternalRequests,
      trustedInputState: uiFixtureTrustedInputProbe
        ? { ...uiFixtureTrustedInputProbe }
        : null,
      fixtureRecoveryState: uiFixtureClipboardResidueProbe
        ? {
            storedRiskKeys: [...uiFixtureClipboardResidueProbe.storedRiskKeys],
            activeRisk: Boolean(uiFixtureClipboardResidueProbe.activeRisk),
            statusRequests: uiFixtureClipboardResidueProbe.statusRequests,
            invalidAcknowledgements: uiFixtureClipboardResidueProbe.invalidAcknowledgements,
            acknowledgedRisks: uiFixtureClipboardResidueProbe.acknowledgedRisks,
            rendererReloads: uiFixtureClipboardResidueProbe.rendererReloads,
          }
        : null,
      nativeWindow: {
        backgroundThrottlingDisabled: getMainWindow().webContents.backgroundThrottling === false,
        contentSize: { width: contentWidth, height: contentHeight },
        bounds: { width: windowBounds.width, height: windowBounds.height },
        zoomFactor: getMainWindow().webContents.getZoomFactor(),
      },
      renderer,
    };
    process.stdout.write(`${outputPrefix}${JSON.stringify(payload)}\n`, () => app.exit(0));
  } catch (error) {
    const payload = { success: false, error: String(error?.message || 'fixture check failed') };
    process.stdout.write(`${outputPrefix}${JSON.stringify(payload)}\n`, () => app.exit(1));
  }
}


  function attachToWindow(fixtureWindow, { isTextScaleNativeFixture = false } = {}) {
    if (!fixtureWindow || fixtureWindow.isDestroyed()) {
      throw new TypeError('UI fixture runtime requires a live BrowserWindow');
    }

    if (uiFixtureCheckMode) fixtureWindow.webContents.backgroundThrottling = false;
    registerUiFixtureRecoveryHandlers();
    registerUiFixtureTrustedInputHandler(fixtureWindow);
    registerCommandQSafeExitTrustedInputHandler(fixtureWindow);

    const fixtureUrl = new URL(uiFixtureMode.rendererUrl);
    const isCommandCommaSafeSettingsCheck = isCommandCommaSafeSettingsCheckFixtureUrl(fixtureUrl);
    uiFixtureBlockedRendererExternalRequests = 0;
    fixtureWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      try {
        const requestUrl = new URL(details.url);
        const localRendererRequest = ['http:', 'ws:'].includes(requestUrl.protocol)
          && requestUrl.hostname === fixtureUrl.hostname
          && requestUrl.port === fixtureUrl.port;
        const rendererOwnedResource = requestUrl.protocol === 'data:'
          || (requestUrl.protocol === 'blob:' && requestUrl.origin === fixtureUrl.origin);
        const cancel = !localRendererRequest && !rendererOwnedResource;
        if (cancel && details.webContentsId === fixtureWindow.webContents.id) {
          uiFixtureBlockedRendererExternalRequests += 1;
        }
        callback({ cancel });
      } catch {
        if (details.webContentsId === fixtureWindow.webContents.id) {
          uiFixtureBlockedRendererExternalRequests += 1;
        }
        callback({ cancel: true });
      }
    });

    if (isCommandCommaSafeSettingsCheck) {
      uiFixtureCommandCommaSettingsProbe = {
        menuInvocationCount: 0,
        acceleratorActivationCount: 0,
        requestCount: 0,
        requestSentCount: 0,
        listenerReadyCount: 0,
        pendingReplayCount: 0,
        acknowledgedCount: 0,
        invalidAcknowledgementCount: 0,
        outputWritten: false,
      };
      // Invoke the actual MenuItem handler before the renderer has loaded. Its
      // opaque request must survive the listener gap and replay after the
      // renderer subscribes and announces readiness.
      if (triggerApplicationSettingsMenu() !== true) {
        commandCommaSafeSettingsFailure('Initial application Settings menu invocation failed');
        return;
      }
    }

    if (uiFixtureCheckMode || isTextScaleNativeFixture) {
      fixtureWindow.webContents.once('did-finish-load', () => {
        const isCommandQSafeExitCheck = isCommandQSafeExitCheckFixtureUrl(
          new URL(uiFixtureMode.rendererUrl),
        );
        if (isTextScaleNativeFixture) {
          fixtureWindow.setContentSize(400, 400);
          fixtureWindow.webContents.setZoomFactor(2);
        }
        if (isCommandQSafeExitCheck) {
          // A macOS menu accelerator is only delivered to an active native
          // window. All other fixture-check windows remain hidden.
          fixtureWindow.show();
          fixtureWindow.focus();
          fixtureWindow.webContents.focus();
        }
        if (uiFixtureCheckMode) {
          if (isCommandQSafeExitCheck) {
            startCommandQSafeExitWatchdog();
          }
          setTimeout(
            () => finishUiFixtureRuntimeCheck(),
            isTextScaleNativeFixture ? 100 : 50,
          );
        }
      });
    }
  }

  return Object.freeze({
    attachToWindow,
    isCommandQSafeExitFixture: () => isCommandQSafeExitFixtureUrl(
      new URL(uiFixtureMode.rendererUrl),
    ),
    isCommandCommaSafeSettingsFixture: () => isCommandCommaSafeSettingsFixtureUrl(
      new URL(uiFixtureMode.rendererUrl),
    ),
    recordCommandQSafeExitLifecycle,
    emitCommandQSafeExitProof,
    recordCommandCommaSafeSettingsLifecycle,
  });
}

module.exports = {
  createUiFixtureRuntime,
  createUiFixtureStore,
  initializeUiFixture,
};
