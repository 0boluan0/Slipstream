'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const electronPath = require('electron');

const HARNESS_FLAG = '--result-stylesheet-deferral-harness';
const OUTPUT_PREFIX = '__SLIPSTREAM_RESULT_STYLESHEET_DEFERRAL__';
const TEMP_PREFIX = 'slipstream-result-stylesheet-deferral-';
const projectRoot = path.join(__dirname, '..');
const rendererRoot = path.join(projectRoot, 'dist', 'renderer');

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
  return directory;
}

function removeOwnedTempRoot(ownedRoot) {
  fs.rmSync(validateOwnedTempRoot(ownedRoot), { recursive: true, force: true });
}

function assertRendererArtifacts() {
  for (const relativePath of [
    'index.html',
    'assets/ResultDisplay.js',
    'assets/ResultDisplay.css',
    'assets/SettingsPanel.js',
    'assets/SettingsPanel.css',
  ]) {
    assert.ok(fs.statSync(path.join(rendererRoot, relativePath)).isFile(),
      `missing production renderer artifact ${relativePath}; run npm run build:renderer`);
  }
}

function sanitizedHarnessEnvironment({ homePath, temporaryPath }) {
  const environment = { HOME: homePath, TMPDIR: temporaryPath };
  for (const key of ['PATH', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  return environment;
}

async function runElectronChild({
  ownedRootPath,
  ownedRootParentPath,
  userDataPath,
  sessionDataPath,
}) {
  const {
    app,
    BrowserWindow,
    session,
  } = require('electron');
  const ownedRoot = validateOwnedTempRoot(ownedRootPath, ownedRootParentPath);
  const renderer = fs.realpathSync(rendererRoot);
  let window = null;
  let outputWritten = false;
  let stage = 'initializing';
  let safetyTimeout = null;
  const resourceRequests = [];
  const externalRequests = [];
  const primaryStylesheetFailuresInjected = {
    result: false,
    settings: false,
  };

  const writeOutcome = (payload, exitCode) => new Promise((resolve) => {
    if (outputWritten) return resolve();
    outputWritten = true;
    process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify(payload)}\n`, () => {
      app.exit(exitCode);
      resolve();
    });
  });

  try {
    for (const candidate of [userDataPath, sessionDataPath, process.env.HOME, process.env.TMPDIR]) {
      const realPath = fs.realpathSync(candidate);
      assert.ok(isInside(ownedRoot, realPath));
      assert.equal(fs.statSync(realPath).mode & 0o777, 0o700);
    }
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', sessionDataPath);
    app.enableSandbox();
    app.commandLine.appendSwitch('disable-background-networking');
    app.commandLine.appendSwitch('disable-component-update');
    app.commandLine.appendSwitch('disable-domain-reliability');
    app.commandLine.appendSwitch('disable-sync');
    await app.whenReady();
    stage = 'configuring-session';
    safetyTimeout = setTimeout(() => {
      void writeOutcome({ error: `Result stylesheet harness timed out during ${stage}` }, 1);
    }, 25_000);

    const harnessSession = session.fromPartition(
      `slipstream-result-stylesheet-deferral-${process.pid}`,
      { cache: false },
    );
    harnessSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    harnessSession.setPermissionCheckHandler(() => false);
    harnessSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        const requestUrl = new URL(details.url);
        if (requestUrl.protocol !== 'file:') {
          externalRequests.push(`${requestUrl.protocol}//${requestUrl.host}`);
          return callback({ cancel: true });
        }
        const requestedPath = fs.realpathSync(fileURLToPath(requestUrl));
        if (requestedPath !== renderer && !isInside(renderer, requestedPath)) {
          externalRequests.push('file://outside-renderer');
          return callback({ cancel: true });
        }
        resourceRequests.push({
          fileName: path.basename(requestedPath),
          path: path.relative(renderer, requestedPath),
          query: requestUrl.search,
          resourceType: details.resourceType,
        });
        const stylesheetNamespace = new Map([
          ['ResultDisplay.css', 'result'],
          ['SettingsPanel.css', 'settings'],
        ]).get(path.basename(requestedPath));
        if (
          stylesheetNamespace
          && requestUrl.search === ''
          && !primaryStylesheetFailuresInjected[stylesheetNamespace]
        ) {
          primaryStylesheetFailuresInjected[stylesheetNamespace] = true;
          return callback({ cancel: true });
        }
        return callback({ cancel: false });
      } catch {
        externalRequests.push('invalid-request');
        return callback({ cancel: true });
      }
    });
    harnessSession.on('will-download', (event) => event.preventDefault());

    window = new BrowserWindow({
      width: 720,
      height: 720,
      show: false,
      webPreferences: {
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());

    stage = 'loading-renderer';
    await window.loadFile(path.join(renderer, 'index.html'));
    stage = 'probing-workspace-assets';
    const rendererProof = await window.webContents.executeJavaScript(`
      (async () => {
        const withTimeout = (promise, label) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(label + ' timed out')),
            12000,
          )),
        ]);
        const stylesheetLinks = (namespace) => [...document.querySelectorAll(
          'link[data-workspace-stylesheet="' + namespace + '"]',
        )];
        const includesRule = (link, selector) => Boolean(link?.sheet)
          && [...link.sheet.cssRules].some((rule) => rule.cssText.includes(selector));
        const initialUrl = window.location.href;
        const initialTimeOrigin = performance.timeOrigin;

        const primaryResultModule = await withTimeout(
          import('./assets/ResultDisplay.js'),
          'primary Result module',
        );
        let resultPrimaryStylesheetRejected = false;
        try {
          await withTimeout(
            primaryResultModule.resultWorkspaceStylesheetReady,
            'primary Result stylesheet',
          );
        } catch {
          resultPrimaryStylesheetRejected = true;
        }
        const resultPrimaryLinksAfterFailure = stylesheetLinks('result').length;
        const retryResultModule = await withTimeout(
          import('./assets/ResultDisplay.js?workspace-attempt=1'),
          'retry Result module',
        );
        await withTimeout(
          retryResultModule.resultWorkspaceStylesheetReady,
          'retry Result stylesheet',
        );
        const resultLinkBeforeSettings = stylesheetLinks('result')[0] || null;
        const settingsLinkCountAfterResultRetry = stylesheetLinks('settings').length;
        const resultProbe = document.createElement('fieldset');
        resultProbe.className = 'reply-status-picker';
        document.body.append(resultProbe);

        const primarySettingsModule = await withTimeout(
          import('./assets/SettingsPanel.js'),
          'primary Settings module',
        );
        let settingsPrimaryStylesheetRejected = false;
        try {
          await withTimeout(
            primarySettingsModule.settingsWorkspaceStylesheetReady,
            'primary Settings stylesheet',
          );
        } catch {
          settingsPrimaryStylesheetRejected = true;
        }
        const settingsPrimaryLinksAfterFailure = stylesheetLinks('settings').length;
        const resultLinkCountAfterSettingsFailure = stylesheetLinks('result').length;
        const resultLinkPreservedAfterSettingsFailure = (
          stylesheetLinks('result')[0] === resultLinkBeforeSettings
        );
        const retrySettingsModule = await withTimeout(
          import('./assets/SettingsPanel.js?workspace-attempt=1'),
          'retry Settings module',
        );
        await withTimeout(
          retrySettingsModule.settingsWorkspaceStylesheetReady,
          'retry Settings stylesheet',
        );
        await new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve)
        ));

        const resultLinks = stylesheetLinks('result');
        const settingsLinks = stylesheetLinks('settings');
        const resultLink = resultLinks[0];
        const settingsLink = settingsLinks[0];
        const settingsProbe = document.createElement('div');
        settingsProbe.className = 'verification-policy';
        document.body.append(settingsProbe);
        const navigationEntries = performance.getEntriesByType('navigation');
        return {
          resultPrimaryStylesheetRejected,
          resultPrimaryLinksAfterFailure,
          resultRetryModuleLoaded: typeof retryResultModule.default === 'function',
          resultLoadedLinkCount: resultLinks.length,
          resultActiveAttempt: resultLink?.dataset.workspaceAttempt || null,
          resultActiveLoaded: resultLink?.dataset.workspaceLoaded || null,
          resultDedicatedRuleLoaded: includesRule(resultLink, '.reply-status-picker'),
          resultAppliedDisplay: getComputedStyle(resultProbe).display,
          settingsPrimaryStylesheetRejected,
          settingsPrimaryLinksAfterFailure,
          settingsRetryModuleLoaded: typeof retrySettingsModule.default === 'function',
          settingsLoadedLinkCount: settingsLinks.length,
          settingsActiveAttempt: settingsLink?.dataset.workspaceAttempt || null,
          settingsActiveLoaded: settingsLink?.dataset.workspaceLoaded || null,
          settingsDedicatedRuleLoaded: includesRule(settingsLink, '.verification-policy'),
          settingsAppliedDisplay: getComputedStyle(settingsProbe).display,
          resultLinkCountAfterSettingsFailure,
          settingsLinkCountAfterResultRetry,
          resultLinkPreservedAfterSettingsFailure,
          resultLinkPreservedAfterSettingsRetry: resultLink === resultLinkBeforeSettings,
          totalWorkspaceStylesheetLinkCount: document.querySelectorAll(
            'link[data-workspace-stylesheet]',
          ).length,
          sameDocument: window.location.href === initialUrl
            && performance.timeOrigin === initialTimeOrigin,
          navigationEntryCount: navigationEntries.length,
          navigationType: navigationEntries[0]?.type || null,
        };
      })()
    `, true);
    stage = 'validating-proof';

    const workspaceRequests = resourceRequests.filter((request) => (
      [
        'ResultDisplay.js',
        'ResultDisplay.css',
        'SettingsPanel.js',
        'SettingsPanel.css',
      ].includes(request.fileName)
    ));
    const requestFor = (fileName, query) => workspaceRequests.find((request) => (
      request.fileName === fileName && request.query === query
    ));
    const resultRequests = workspaceRequests.filter((request) => (
      request.fileName.startsWith('ResultDisplay.')
    ));
    const settingsRequests = workspaceRequests.filter((request) => (
      request.fileName.startsWith('SettingsPanel.')
    ));
    const proof = {
      ...rendererProof,
      resultPrimaryStylesheetFailureInjected: primaryStylesheetFailuresInjected.result,
      resultPrimaryModuleRequest: Boolean(requestFor('ResultDisplay.js', '')),
      resultRetryModuleRequest: Boolean(requestFor(
        'ResultDisplay.js',
        '?workspace-attempt=1',
      )),
      resultPrimaryStylesheetRequest: Boolean(requestFor('ResultDisplay.css', '')),
      resultRetryStylesheetRequest: Boolean(requestFor(
        'ResultDisplay.css',
        '?workspace-attempt=1',
      )),
      resultRequestCount: resultRequests.length,
      resultRequestPaths: [...new Set(resultRequests.map((request) => request.path))].sort(),
      settingsPrimaryStylesheetFailureInjected: primaryStylesheetFailuresInjected.settings,
      settingsPrimaryModuleRequest: Boolean(requestFor('SettingsPanel.js', '')),
      settingsRetryModuleRequest: Boolean(requestFor(
        'SettingsPanel.js',
        '?workspace-attempt=1',
      )),
      settingsPrimaryStylesheetRequest: Boolean(requestFor('SettingsPanel.css', '')),
      settingsRetryStylesheetRequest: Boolean(requestFor(
        'SettingsPanel.css',
        '?workspace-attempt=1',
      )),
      settingsRequestCount: settingsRequests.length,
      settingsRequestPaths: [...new Set(settingsRequests.map((request) => request.path))].sort(),
      externalRequestCount: externalRequests.length,
    };
    await writeOutcome(proof, 0);
  } catch (error) {
    await writeOutcome({ error: error?.stack || error?.message || 'Result stylesheet harness failed' }, 1);
  } finally {
    if (safetyTimeout) clearTimeout(safetyTimeout);
    if (window && !window.isDestroyed()) window.destroy();
  }
}

function runParent() {
  assertRendererArtifacts();
  const ownedRoot = createOwnedTempRoot();
  const homePath = createPrivateDirectory(ownedRoot.realPath, 'home');
  const temporaryPath = createPrivateDirectory(ownedRoot.realPath, 'tmp');
  const userDataPath = createPrivateDirectory(ownedRoot.realPath, 'user-data');
  const sessionDataPath = createPrivateDirectory(ownedRoot.realPath, 'session-data');

  return new Promise((resolve, reject) => {
    const child = spawn(
      electronPath,
      [
        __filename,
        HARNESS_FLAG,
        ownedRoot.realPath,
        path.dirname(ownedRoot.realPath),
        userDataPath,
        sessionDataPath,
      ],
      {
        cwd: projectRoot,
        env: sanitizedHarnessEnvironment({ homePath, temporaryPath }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      try {
        const proofLine = stdout.split(/\r?\n/u)
          .find((line) => line.startsWith(OUTPUT_PREFIX));
        assert.equal(signal, null, `Electron Result stylesheet harness exited by ${signal}`);
        assert.equal(code, 0, stderr || stdout || 'Electron Result stylesheet harness failed');
        assert.ok(proofLine,
          `Electron Result stylesheet harness emitted no proof\n${stdout}\n${stderr}`);
        const proof = JSON.parse(proofLine.slice(OUTPUT_PREFIX.length));
        assert.deepEqual(proof, {
          resultPrimaryStylesheetRejected: true,
          resultPrimaryLinksAfterFailure: 0,
          resultRetryModuleLoaded: true,
          resultLoadedLinkCount: 1,
          resultActiveAttempt: '1',
          resultActiveLoaded: 'true',
          resultDedicatedRuleLoaded: true,
          resultAppliedDisplay: 'grid',
          settingsPrimaryStylesheetRejected: true,
          settingsPrimaryLinksAfterFailure: 0,
          settingsRetryModuleLoaded: true,
          settingsLoadedLinkCount: 1,
          settingsActiveAttempt: '1',
          settingsActiveLoaded: 'true',
          settingsDedicatedRuleLoaded: true,
          settingsAppliedDisplay: 'grid',
          resultLinkCountAfterSettingsFailure: 1,
          settingsLinkCountAfterResultRetry: 0,
          resultLinkPreservedAfterSettingsFailure: true,
          resultLinkPreservedAfterSettingsRetry: true,
          totalWorkspaceStylesheetLinkCount: 2,
          sameDocument: true,
          navigationEntryCount: 1,
          navigationType: 'navigate',
          resultPrimaryStylesheetFailureInjected: true,
          resultPrimaryModuleRequest: true,
          resultRetryModuleRequest: true,
          resultPrimaryStylesheetRequest: true,
          resultRetryStylesheetRequest: true,
          resultRequestCount: 4,
          resultRequestPaths: [
            'assets/ResultDisplay.css',
            'assets/ResultDisplay.js',
          ],
          settingsPrimaryStylesheetFailureInjected: true,
          settingsPrimaryModuleRequest: true,
          settingsRetryModuleRequest: true,
          settingsPrimaryStylesheetRequest: true,
          settingsRetryStylesheetRequest: true,
          settingsRequestCount: 4,
          settingsRequestPaths: [
            'assets/SettingsPanel.css',
            'assets/SettingsPanel.js',
          ],
          externalRequestCount: 0,
        });
        resolve(proof);
      } catch (error) {
        reject(error);
      } finally {
        removeOwnedTempRoot(ownedRoot);
      }
    });
  });
}

if (process.argv.includes(HARNESS_FLAG)) {
  const flagIndex = process.argv.indexOf(HARNESS_FLAG);
  void runElectronChild({
    ownedRootPath: process.argv[flagIndex + 1],
    ownedRootParentPath: process.argv[flagIndex + 2],
    userDataPath: process.argv[flagIndex + 3],
    sessionDataPath: process.argv[flagIndex + 4],
  });
} else {
  runParent()
    .then((proof) => {
      console.log('Result and Settings stylesheet production file-runtime check passed.');
      console.log(JSON.stringify(proof, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
