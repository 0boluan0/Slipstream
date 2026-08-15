const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronPath = require('electron');

const HARNESS_FLAG = '--workspace-module-retry-harness';
const OUTPUT_PREFIX = '__SLIPSTREAM_WORKSPACE_MODULE_RETRY__';
const TEMP_PREFIX = 'slipstream-workspace-module-retry-';

function createOwnedTempRoot() {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  fs.chmodSync(created, 0o700);
  const realPath = fs.realpathSync(created);
  const stats = fs.statSync(realPath);
  return Object.freeze({ realPath, device: stats.dev, inode: stats.ino });
}

function validateOwnedTempRoot(candidate) {
  const realPath = fs.realpathSync(candidate.realPath || candidate);
  const stats = fs.statSync(realPath);
  const expectedParent = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(realPath), expectedParent);
  assert.match(path.basename(realPath), new RegExp(`^${TEMP_PREFIX}[A-Za-z0-9]{6}$`, 'u'));
  assert.ok(stats.isDirectory());
  if (candidate.realPath) {
    assert.equal(realPath, candidate.realPath);
    assert.equal(stats.dev, candidate.device);
    assert.equal(stats.ino, candidate.inode);
  }
  return realPath;
}

function removeOwnedTempRoot(ownedRoot) {
  const verified = validateOwnedTempRoot(ownedRoot);
  fs.rmSync(verified, { recursive: true, force: true });
}

function writeHarnessPage(root) {
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Workspace module retry</title>',
    { encoding: 'utf8', mode: 0o600 },
  );
}

function writeWorkspaceModule(root) {
  fs.writeFileSync(
    path.join(root, 'workspace.js'),
    'globalThis.__workspaceModuleLoads = (globalThis.__workspaceModuleLoads || 0) + 1; export default "recovered";\n',
    { encoding: 'utf8', mode: 0o600 },
  );
}

function writeWorkspaceStylesheet(root) {
  fs.writeFileSync(
    path.join(root, 'workspace.css'),
    '.workspace-style-probe { color: rgb(12, 34, 56); }\n',
    { encoding: 'utf8', mode: 0o600 },
  );
}

function importProbeSource(specifier) {
  return `import(${JSON.stringify(specifier)}).then((module) => ({ ok: true, value: module.default })).catch(() => ({ ok: false }))`;
}

function stylesheetProbeSource(specifier) {
  return `(() => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ${JSON.stringify(specifier)};
    link.dataset.workspaceStylesheetProbe = 'true';
    link.onload = () => resolve({ ok: true, href: link.href });
    link.onerror = () => {
      link.remove();
      resolve({ ok: false, href: link.href });
    };
    document.head.append(link);
  }))()`;
}

async function runElectronHarness(rootArgument) {
  const {
    app,
    BrowserWindow,
    session,
  } = require('electron');
  const root = validateOwnedTempRoot(rootArgument);
  const userData = path.join(root, 'user-data');
  const sessionData = path.join(root, 'session-data');
  fs.mkdirSync(userData, { mode: 0o700 });
  fs.mkdirSync(sessionData, { mode: 0o700 });
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);

  let window = null;
  let outputWritten = false;
  const writeOutcome = (payload, exitCode) => new Promise((resolve) => {
    if (outputWritten) return resolve();
    outputWritten = true;
    process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify(payload)}\n`, () => {
      app.exit(exitCode);
      resolve();
    });
  });

  try {
    await app.whenReady();
    let blockedExternalRequests = 0;
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        allowed = ['file:', 'data:', 'blob:'].includes(new URL(details.url).protocol);
      } catch {
        allowed = false;
      }
      if (!allowed) blockedExternalRequests += 1;
      callback({ cancel: !allowed });
    });

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });
    await window.loadFile(path.join(root, 'index.html'));
    const timeOriginBefore = await window.webContents.executeJavaScript('performance.timeOrigin', true);
    const firstAttempt = await window.webContents.executeJavaScript(
      importProbeSource('./workspace.js'),
      true,
    );
    assert.equal(firstAttempt.ok, false, 'the missing primary module must fail');

    writeWorkspaceModule(root);
    const repeatedUrlAttempt = await window.webContents.executeJavaScript(
      importProbeSource('./workspace.js'),
      true,
    );
    assert.equal(repeatedUrlAttempt.ok, false,
      'Chromium must retain the failed primary URL in its module map');

    const queriedAttempt = await window.webContents.executeJavaScript(
      importProbeSource('./workspace.js?workspace-attempt=1'),
      true,
    );
    const moduleLoads = await window.webContents.executeJavaScript(
      'globalThis.__workspaceModuleLoads || 0',
      true,
    );
    assert.deepEqual(queriedAttempt, { ok: true, value: 'recovered' });
    assert.equal(moduleLoads, 1);

    const stylesheetPrimary = await window.webContents.executeJavaScript(
      stylesheetProbeSource('./workspace.css'),
      true,
    );
    assert.equal(stylesheetPrimary.ok, false,
      'the missing primary stylesheet must fail before a retry exists');

    writeWorkspaceStylesheet(root);
    const stylesheetRetry = await window.webContents.executeJavaScript(
      stylesheetProbeSource('./workspace.css?workspace-attempt=1'),
      true,
    );
    assert.equal(stylesheetRetry.ok, true,
      'a queried stylesheet retry must load the restored local file');
    const stylesheetEvidence = await window.webContents.executeJavaScript(`(() => {
      const probe = document.createElement('div');
      probe.className = 'workspace-style-probe';
      document.body.append(probe);
      const links = [...document.querySelectorAll('link[data-workspace-stylesheet-probe="true"]')];
      const loadedUrl = new URL(links[0]?.href || document.baseURI);
      return {
        appliedColor: getComputedStyle(probe).color,
        loadedLinkCount: links.length,
        retryAttempt: loadedUrl.searchParams.get('workspace-attempt'),
        retryPathMatches: loadedUrl.pathname.endsWith('/workspace.css'),
      };
    })()`, true);
    assert.deepEqual(stylesheetEvidence, {
      appliedColor: 'rgb(12, 34, 56)',
      loadedLinkCount: 1,
      retryAttempt: '1',
      retryPathMatches: true,
    });

    const timeOriginAfter = await window.webContents.executeJavaScript('performance.timeOrigin', true);
    assert.equal(timeOriginAfter, timeOriginBefore, 'retry must not reload the renderer');
    assert.equal(blockedExternalRequests, 0);

    await writeOutcome({
      primaryFailed: true,
      sameUrlStayedFailed: true,
      queriedRetrySucceeded: true,
      stylesheetPrimaryFailed: true,
      stylesheetQueriedRetrySucceeded: true,
      stylesheetRuleApplied: true,
      stylesheetLoadedLinkCount: 1,
      rendererTimeOriginPreserved: true,
      moduleLoads,
      blockedExternalRequests,
    }, 0);
  } catch (error) {
    await writeOutcome({ error: error?.message || 'Workspace module retry harness failed' }, 1);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
}

function sanitizedHarnessEnvironment() {
  const environment = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  return environment;
}

function runParent() {
  const ownedRoot = createOwnedTempRoot();
  writeHarnessPage(ownedRoot.realPath);

  return new Promise((resolve, reject) => {
    const child = spawn(
      electronPath,
      [__filename, HARNESS_FLAG, ownedRoot.realPath],
      {
        cwd: __dirname,
        env: sanitizedHarnessEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      try {
        const proofLine = stdout.split(/\r?\n/u)
          .find((line) => line.startsWith(OUTPUT_PREFIX));
        assert.equal(signal, null, `Electron retry harness exited by ${signal}`);
        assert.equal(code, 0, stderr || 'Electron retry harness failed');
        assert.ok(proofLine, 'Electron retry harness emitted no proof');
        const proof = JSON.parse(proofLine.slice(OUTPUT_PREFIX.length));
        assert.deepEqual(proof, {
          primaryFailed: true,
          sameUrlStayedFailed: true,
          queriedRetrySucceeded: true,
          stylesheetPrimaryFailed: true,
          stylesheetQueriedRetrySucceeded: true,
          stylesheetRuleApplied: true,
          stylesheetLoadedLinkCount: 1,
          rendererTimeOriginPreserved: true,
          moduleLoads: 1,
          blockedExternalRequests: 0,
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
  const rootIndex = process.argv.indexOf(HARNESS_FLAG) + 1;
  void runElectronHarness(process.argv[rootIndex]);
} else {
  runParent()
    .then((proof) => {
      console.log('Workspace module retry Electron runtime check passed.');
      console.log(JSON.stringify(proof, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
