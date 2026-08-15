const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  UI_FIXTURE_FLAG,
  UI_FIXTURE_RENDERER_URL_ENV,
  UI_FIXTURE_USER_DATA_ENV,
  UI_FIXTURE_USER_DATA_PREFIX,
  sanitizeFixtureEnvironment,
  validateFixtureRendererUrl,
  validateFixtureUserDataPath,
} = require('../src/main/ui-fixture-mode');

const projectRoot = path.join(__dirname, '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const DEFAULT_FIXTURE_PATH = '/?demo=capture&backend=openai&connection=slow';
const READY_TIMEOUT_MS = 20_000;
const CLIPBOARD_TRANSACTION_RUN = 'clipboard-app-transaction-native';
const CLIPBOARD_TRANSACTION_HARNESS_FLAG = '--ui-fixture-clipboard-transaction-harness';
const CLIPBOARD_TRANSACTION_PROOF_DATASET = 'uiFixtureClipboardTransactionProof';
const CLIPBOARD_TRANSACTION_OUTPUT_PREFIX = '__SLIPSTREAM_UI_FIXTURE_CLIPBOARD_TRANSACTION__';
const CLIPBOARD_TRANSACTION_TIMEOUT_MS = 20_000;

function validateRelativeFixturePath(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.includes('\\')
    || value.includes('#')
    || value.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/iu.test(value)
  ) {
    throw new TypeError('--path must be a relative root path/query without a fragment');
  }

  const baseUrl = new URL('http://127.0.0.1:49152/');
  const resolved = new URL(value, baseUrl);
  if (resolved.origin !== baseUrl.origin || resolved.username || resolved.password) {
    throw new TypeError('--path must not select another origin or contain authentication');
  }
  return `${resolved.pathname}${resolved.search}`;
}

function parseArguments(argv) {
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let pathSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let pathValue;
    if (argument === '--path') {
      index += 1;
      pathValue = argv[index];
    } else if (argument.startsWith('--path=')) {
      pathValue = argument.slice('--path='.length);
    } else {
      throw new Error(`Unknown UI fixture argument: ${argument}`);
    }
    if (pathSeen || typeof pathValue !== 'string') {
      throw new Error('--path must be provided exactly once with a value');
    }
    pathSeen = true;
    fixturePath = validateRelativeFixturePath(pathValue);
  }
  return Object.freeze({ fixturePath });
}

function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!Number.isInteger(port) || port <= 1023) reject(new Error('Failed to select a non-privileged loopback port'));
        else resolve(port);
      });
    });
  });
}

function createOwnedUserDataDirectory() {
  const createdPath = fs.mkdtempSync(path.join(os.tmpdir(), UI_FIXTURE_USER_DATA_PREFIX));
  fs.chmodSync(createdPath, 0o700);
  const realPath = validateFixtureUserDataPath(createdPath);
  const stats = fs.statSync(realPath);
  return Object.freeze({ realPath, device: stats.dev, inode: stats.ino });
}

function removeOwnedUserDataDirectory(ownedDirectory) {
  if (!ownedDirectory) return;
  try {
    const verifiedPath = validateFixtureUserDataPath(ownedDirectory.realPath);
    const stats = fs.statSync(verifiedPath);
    if (verifiedPath !== ownedDirectory.realPath || stats.dev !== ownedDirectory.device || stats.ino !== ownedDirectory.inode) {
      throw new Error('directory identity changed');
    }
    fs.rmSync(verifiedPath, { force: true, recursive: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`Preserved unverified UI fixture directory: ${error.message}`);
    }
  }
}

function monitorChild(label, command, args, options) {
  const child = spawn(command, args, options);
  let outcome = null;
  const exit = new Promise((resolve) => {
    const finish = (result) => {
      if (outcome) return;
      outcome = Object.freeze(result);
      resolve(outcome);
    };
    child.once('error', (error) => finish({ label, error, code: null, signal: null }));
    child.once('exit', (code, signal) => finish({ label, error: null, code, signal }));
  });
  return {
    child,
    exit,
    get outcome() {
      return outcome;
    },
  };
}

function requestFixturePage(rendererUrl) {
  return new Promise((resolve) => {
    const request = http.get(rendererUrl, { timeout: 750 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isClipboardTransactionFixture(rendererUrl) {
  return new URL(rendererUrl).searchParams.get('run') === CLIPBOARD_TRANSACTION_RUN;
}

async function waitForClipboardTransactionProof(webContents) {
  const deadline = Date.now() + CLIPBOARD_TRANSACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (webContents.isDestroyed()) throw new Error('Clipboard transaction fixture window closed early');
    const serialized = await webContents.executeJavaScript(
      `document.documentElement.dataset.${CLIPBOARD_TRANSACTION_PROOF_DATASET} || null`,
      true,
    );
    if (serialized) return JSON.parse(serialized);
    await delay(25);
  }
  throw new Error('Timed out waiting for the clipboard transaction fixture proof');
}

async function runClipboardTransactionHarness() {
  const {
    app,
    BrowserWindow,
    Menu,
  } = require('electron');
  let fixtureWindow = null;
  let outputWritten = false;
  const writeOutcome = (payload, exitCode) => new Promise((resolve) => {
    if (outputWritten) {
      resolve();
      return;
    }
    outputWritten = true;
    process.stdout.write(`${CLIPBOARD_TRANSACTION_OUTPUT_PREFIX}${JSON.stringify(payload)}\n`, () => {
      app.exit(exitCode);
      resolve();
    });
  });

  try {
    const rendererUrl = validateFixtureRendererUrl(process.env[UI_FIXTURE_RENDERER_URL_ENV]);
    const userDataPath = validateFixtureUserDataPath(process.env[UI_FIXTURE_USER_DATA_ENV]);
    if (!isClipboardTransactionFixture(rendererUrl)) {
      throw new Error('Clipboard transaction harness requires its dedicated fixture run');
    }
    const rendererLocation = new URL(rendererUrl);
    const rendererOrigin = rendererLocation.origin;
    const sessionDataPath = path.join(userDataPath, 'session');
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', sessionDataPath);
    await app.whenReady();
    Menu.setApplicationMenu(null);

    const fixtureSession = require('electron').session.defaultSession;
    let blockedCrossOriginRequests = 0;
    fixtureSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    fixtureSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const requestUrl = new URL(details.url);
        allowed = (
          ['http:', 'ws:'].includes(requestUrl.protocol)
          && requestUrl.hostname === rendererLocation.hostname
          && requestUrl.port === rendererLocation.port
        ) || requestUrl.protocol === 'data:'
          || (requestUrl.protocol === 'blob:' && requestUrl.origin === rendererOrigin);
      } catch {
        allowed = false;
      }
      if (!allowed) blockedCrossOriginRequests += 1;
      callback({ cancel: !allowed });
    });

    const trapPort = rendererLocation.searchParams.get('trapPort');
    let sessionTrapFetchBlocked = false;
    try {
      await fixtureSession.fetch(`http://127.0.0.1:${trapPort}/launcher-isolation-probe`, {
        cache: 'no-store',
      });
    } catch {
      sessionTrapFetchBlocked = true;
    }
    if (!sessionTrapFetchBlocked) {
      throw new Error('Clipboard transaction fixture session reached the network trap');
    }

    fixtureWindow = new BrowserWindow({
      width: 920,
      height: 720,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'ui-fixture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    fixtureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    fixtureWindow.webContents.on('will-navigate', (event, targetUrl) => {
      if (targetUrl !== rendererUrl) event.preventDefault();
    });
    await fixtureWindow.loadURL(rendererUrl);
    const transaction = await waitForClipboardTransactionProof(fixtureWindow.webContents);
    if (transaction.success !== true) {
      throw new Error(transaction.error || 'Clipboard transaction renderer proof failed');
    }
    const preloadClipboardStub = await fixtureWindow.webContents.executeJavaScript(`(async () => {
      const firstInput = 'fixture-only direct alpha';
      const secondInput = 'fixture-only direct beta';
      const first = await window.api.invoke('clipboard:write', firstInput);
      const second = await window.api.invoke('clipboard:write', secondInput);
      let clipboardMutationApiUnavailable = false;
      try {
        await window.api.invoke(['clipboard', 'clear'].join(':'));
      } catch (error) {
        clipboardMutationApiUnavailable = String(error?.message || error)
          .includes('do not expose application IPC');
      }
      const serializedResponses = JSON.stringify([first, second]);
      const validId = (value) => typeof value === 'string'
        && value.length > 0
        && value.length <= 100;
      return {
        writesStubbed: first.fixture === true && second.fixture === true,
        consequenceIdsUnique: validId(first.consequenceId)
          && validId(second.consequenceId)
          && first.consequenceId !== second.consequenceId,
        consequenceIdsOpaque: !first.consequenceId.includes('alpha')
          && !second.consequenceId.includes('beta'),
        firstWriteCreatedConsequence: first.replacedPrevious === false,
        secondWriteReplacedConsequence: second.replacedPrevious === true,
        plaintextAbsentFromResponses: !serializedResponses.includes(firstInput)
          && !serializedResponses.includes(secondInput),
        clipboardMutationApiUnavailable
      };
    })()`, true);
    const preferences = fixtureWindow.webContents.getLastWebPreferences();
    const rendererIsolation = await fixtureWindow.webContents.executeJavaScript(`({
      marker: window.slipstreamUiFixture,
      dataset: document.documentElement.dataset.uiFixture,
      nodeGlobalsUnavailable: typeof require === 'undefined' && typeof process === 'undefined'
    })`, true);
    const inheritedSecretsPresent = Boolean(
      process.env.DEEPSEEK_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY
      || process.env.SSH_AUTH_SOCK
      || process.env.NODE_OPTIONS
    );
    await writeOutcome({
      success: true,
      rendererUrlExact: fixtureWindow.webContents.getURL() === rendererUrl,
      userDataIsFixture: app.getPath('userData') === userDataPath,
      sessionDataIsNested: app.getPath('sessionData').startsWith(`${userDataPath}${path.sep}`),
      contextIsolation: preferences.contextIsolation === true,
      nodeIntegrationDisabled: preferences.nodeIntegration === false,
      sandboxEnabled: preferences.sandbox === true,
      inheritedSecretsPresent,
      sessionTrapFetchBlocked,
      blockedCrossOriginRequests,
      preloadClipboardStub,
      renderer: rendererIsolation,
      transaction,
    }, 0);
  } catch (error) {
    await writeOutcome({ success: false, error: String(error?.message || error) }, 1);
  } finally {
    if (fixtureWindow && !fixtureWindow.isDestroyed()) fixtureWindow.destroy();
  }
}

async function waitForVite(rendererUrl, viteMonitor, getRequestedSignal) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getRequestedSignal()) throw new Error('UI fixture launch interrupted');
    if (viteMonitor.outcome) {
      const detail = viteMonitor.outcome.error?.message
        || viteMonitor.outcome.signal
        || `exit ${viteMonitor.outcome.code}`;
      throw new Error(`Vite exited before becoming ready (${detail})`);
    }
    if (await requestFixturePage(rendererUrl)) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for the UI fixture renderer');
}

function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  if (signal === 'SIGHUP') return 129;
  return 1;
}

function signalChild(monitor, signal) {
  if (!monitor || monitor.outcome) return;
  try {
    monitor.child.kill(signal);
  } catch {
    // The process may have exited between the state check and kill.
  }
}

async function terminateChild(monitor) {
  if (!monitor || monitor.outcome) return true;
  signalChild(monitor, 'SIGTERM');
  await Promise.race([monitor.exit, delay(2_000)]);
  if (!monitor.outcome) {
    signalChild(monitor, 'SIGKILL');
    await Promise.race([monitor.exit, delay(2_000)]);
  }
  return Boolean(monitor.outcome);
}

async function runUiFixture(argv = process.argv.slice(2)) {
  let ownedUserData = null;
  let viteMonitor = null;
  let electronMonitor = null;
  let requestedSignal = null;
  const onSignal = (signal) => {
    requestedSignal ||= signal;
    signalChild(electronMonitor, signal);
    signalChild(viteMonitor, signal);
  };
  const signalHandlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
    const handler = () => onSignal(signal);
    process.on(signal, handler);
    return { signal, handler };
  });

  try {
    const { fixturePath } = parseArguments(argv);
    ownedUserData = createOwnedUserDataDirectory();
    const port = await findAvailableLoopbackPort();
    if (requestedSignal) return signalExitCode(requestedSignal);

    const rendererUrl = validateFixtureRendererUrl(`http://127.0.0.1:${port}${fixturePath}`);
    const childEnvironment = sanitizeFixtureEnvironment(process.env);
    viteMonitor = monitorChild('Vite', process.execPath, [
      viteEntry,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--strictPort',
    ], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: 'inherit',
    });

    await waitForVite(rendererUrl, viteMonitor, () => requestedSignal);
    if (requestedSignal) return signalExitCode(requestedSignal);

    const electronBinary = require('electron');
    const electronArgs = isClipboardTransactionFixture(rendererUrl)
      ? [__filename, CLIPBOARD_TRANSACTION_HARNESS_FLAG]
      : ['.', '--dev', UI_FIXTURE_FLAG];
    electronMonitor = monitorChild('Electron', electronBinary, electronArgs, {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        [UI_FIXTURE_RENDERER_URL_ENV]: rendererUrl,
        [UI_FIXTURE_USER_DATA_ENV]: ownedUserData.realPath,
      },
      stdio: 'inherit',
    });
    console.log(`Native Electron UI fixture ready: ${rendererUrl}`);

    const firstExit = await Promise.race([
      electronMonitor.exit.then((outcome) => ({ source: 'electron', outcome })),
      viteMonitor.exit.then((outcome) => ({ source: 'vite', outcome })),
    ]);
    if (requestedSignal) return signalExitCode(requestedSignal);
    if (firstExit.source === 'vite') {
      const detail = firstExit.outcome.error?.message
        || firstExit.outcome.signal
        || `exit ${firstExit.outcome.code}`;
      throw new Error(`Vite stopped while Electron was running (${detail})`);
    }
    if (firstExit.outcome.error) throw firstExit.outcome.error;
    return firstExit.outcome.code ?? signalExitCode(firstExit.outcome.signal);
  } catch (error) {
    if (!requestedSignal) console.error(`UI fixture launch failed: ${error.message}`);
    return requestedSignal ? signalExitCode(requestedSignal) : 1;
  } finally {
    const electronStopped = await terminateChild(electronMonitor);
    const viteStopped = await terminateChild(viteMonitor);
    if (electronStopped && viteStopped) removeOwnedUserDataDirectory(ownedUserData);
    else console.error('Preserved UI fixture userData because a child process did not stop');
    for (const { signal, handler } of signalHandlers) process.removeListener(signal, handler);
  }
}

if (process.versions.electron && process.argv.includes(CLIPBOARD_TRANSACTION_HARNESS_FLAG)) {
  runClipboardTransactionHarness();
} else if (require.main === module) {
  runUiFixture().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  CLIPBOARD_TRANSACTION_RUN,
  DEFAULT_FIXTURE_PATH,
  createOwnedUserDataDirectory,
  findAvailableLoopbackPort,
  parseArguments,
  removeOwnedUserDataDirectory,
  runUiFixture,
  validateRelativeFixturePath,
};
