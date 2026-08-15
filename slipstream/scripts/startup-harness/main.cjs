'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

const PROTOCOL = 'SLIPSTREAM_RENDERER_HARNESS_V1';
const OUTPUT_PREFIX = `${PROTOCOL}:`;
const SCENARIOS = new Set(['first-use-setup', 'returning-capture']);
const childStartedAt = performance.now();
const scenario = process.env.SLIPSTREAM_RENDERER_HARNESS_SCENARIO;
const profileRoot = process.env.SLIPSTREAM_RENDERER_HARNESS_PROFILE_ROOT;
const userDataPath = process.env.SLIPSTREAM_RENDERER_HARNESS_USER_DATA;
const sessionDataPath = process.env.SLIPSTREAM_RENDERER_HARNESS_SESSION_DATA;
let completed = false;
let windowWasShown = false;

function emit(type, detail = {}) {
  process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify({
    protocol: PROTOCOL,
    type,
    scenario,
    childElapsedMs: Number((performance.now() - childStartedAt).toFixed(3)),
    ...detail,
  })}\n`);
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..';
}

function assertPrivateDirectory(candidatePath, label) {
  if (!candidatePath || !path.isAbsolute(candidatePath)) {
    throw new Error(`${label} is not an absolute path`);
  }
  const resolvedRoot = fs.realpathSync(profileRoot);
  const lexicalRoot = path.resolve(profileRoot);
  const lexicalCandidate = path.resolve(candidatePath);
  if (lexicalRoot !== resolvedRoot) throw new Error('profile root uses a symbolic path');
  if (!isInside(resolvedRoot, lexicalCandidate)) {
    throw new Error(`${label} is outside the private profile root`);
  }
  const relative = path.relative(resolvedRoot, lexicalCandidate);
  let cursor = resolvedRoot;
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} contains an unsafe path component`);
    }
    if ((stat.mode & 0o777) !== 0o700) {
      throw new Error(`${label} permissions are not private`);
    }
  }
  const resolvedCandidate = fs.realpathSync(lexicalCandidate);
  if (resolvedCandidate !== lexicalCandidate) {
    throw new Error(`${label} uses a symbolic path`);
  }
  return resolvedCandidate;
}

function fail(reason) {
  if (completed) return;
  completed = true;
  emit('failure', { reason: String(reason || 'unknown').slice(0, 160) });
  app.exit(1);
}

function installCapabilityDenials(harnessSession, rendererRoot) {
  harnessSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  harnessSession.setPermissionCheckHandler(() => false);
  harnessSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const requestUrl = new URL(details.url);
      if (requestUrl.protocol !== 'file:') return callback({ cancel: true });
      const requestedPath = fs.realpathSync(fileURLToPath(requestUrl));
      if (requestedPath !== rendererRoot && !isInside(rendererRoot, requestedPath)) {
        return callback({ cancel: true });
      }
      return callback({ cancel: false });
    } catch {
      return callback({ cancel: true });
    }
  });
  harnessSession.on('will-download', (event) => event.preventDefault());
}

const readinessProbe = `
(async () => {
  const protocol = 'SLIPSTREAM_RENDERER_HARNESS_V1';
  const scenario = ${JSON.stringify(scenario)};
  const startedAt = performance.now();
  const deadline = startedAt + 15000;
  const nextFrame = () => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 20);
  });
  const isUsable = (element) => {
    if (!element || element.disabled) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  while (performance.now() < deadline) {
    const loadingGone = !document.querySelector('.setup-gate--loading')
      && !document.querySelector('[aria-busy="true"].setup-gate');
    let ready = false;
    let geometry = null;

    if (scenario === 'first-use-setup') {
      const title = document.querySelector('#setup-title');
      const primary = document.querySelector('.setup-primary:not(:disabled)');
      const secondary = document.querySelector('.setup-secondary:not(:disabled)');
      ready = loadingGone && isUsable(title) && isUsable(primary) && isUsable(secondary);
      if (ready) {
        geometry = {
          titleWidth: Math.round(title.getBoundingClientRect().width),
          primaryWidth: Math.round(primary.getBoundingClientRect().width),
          secondaryWidth: Math.round(secondary.getBoundingClientRect().width),
        };
      }
    } else {
      const card = document.querySelector('.capture-card');
      const textarea = document.querySelector('.capture-input textarea:not(:disabled)');
      ready = loadingGone && isUsable(card) && isUsable(textarea) && textarea.tabIndex >= 0;
      if (ready) {
        geometry = {
          cardWidth: Math.round(card.getBoundingClientRect().width),
          textareaWidth: Math.round(textarea.getBoundingClientRect().width),
          textareaHeight: Math.round(textarea.getBoundingClientRect().height),
        };
      }
    }

    if (ready) {
      await nextFrame();
      await nextFrame();
      const adapter = window.slipstreamRendererHarness;
      if (!adapter || adapter.protocol !== protocol || typeof adapter.getSummary !== 'function') {
        throw new Error('fixed adapter is unavailable');
      }
      const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        rendererDomReadyMs: Number(performance.now().toFixed(3)),
        rendererFcpMs: Number.isFinite(firstContentfulPaint?.startTime)
          ? Number(firstContentfulPaint.startTime.toFixed(3))
          : null,
        documentReadyState: document.readyState,
        geometry,
        adapterSummary: adapter.getSummary(),
      };
    }
    await nextFrame();
  }
  throw new Error('semantic DOM readiness timed out');
})()
`;

try {
  if (!SCENARIOS.has(scenario)) throw new Error('scenario is invalid');
  if (!profileRoot || !path.isAbsolute(profileRoot)) throw new Error('profile root is invalid');
  const resolvedRoot = fs.realpathSync(profileRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (rootStat.mode & 0o777) !== 0o700) {
    throw new Error('profile root is not private');
  }
  const privateHome = assertPrivateDirectory(process.env.HOME, 'HOME');
  const privateTmp = assertPrivateDirectory(process.env.TMPDIR, 'TMPDIR');
  const privateUserData = assertPrivateDirectory(userDataPath, 'userData');
  const privateSessionData = assertPrivateDirectory(sessionDataPath, 'sessionData');
  if (new Set([privateHome, privateTmp, privateUserData, privateSessionData]).size !== 4) {
    throw new Error('private paths must be distinct');
  }

  app.setPath('userData', privateUserData);
  app.setPath('sessionData', privateSessionData);
  app.enableSandbox();
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
} catch (error) {
  emit('failure', { reason: String(error?.message || 'profile validation failed').slice(0, 160) });
  process.exit(1);
}

app.whenReady().then(async () => {
  emit('milestone', { name: 'main-ready' });

  const harnessSession = session.fromPartition(`slipstream-renderer-harness-${process.pid}`, {
    cache: false,
  });
  const rendererRoot = fs.realpathSync(path.join(app.getAppPath(), 'dist', 'renderer'));
  installCapabilityDenials(harnessSession, rendererRoot);

  const window = new BrowserWindow({
    width: scenario === 'first-use-setup' ? 820 : 520,
    height: scenario === 'first-use-setup' ? 720 : 680,
    show: false,
    backgroundColor: '#f4f2ed',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
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

  window.on('show', () => {
    windowWasShown = true;
    window.hide();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description) => {
    fail(`renderer load failed (${code}): ${description}`);
  });
  window.on('closed', () => {
    if (!completed) fail('hidden window closed before readiness');
  });

  window.webContents.once('did-finish-load', async () => {
    emit('milestone', { name: 'did-finish-load' });
    try {
      const result = await window.webContents.executeJavaScript(readinessProbe, true);
      if (windowWasShown || window.isVisible()) throw new Error('hidden window became visible');
      if (result?.adapterSummary?.scenario !== scenario) {
        throw new Error('adapter scenario mismatch');
      }
      if (result.adapterSummary.unexpectedCalls.length > 0) {
        throw new Error(`adapter rejected ${result.adapterSummary.unexpectedCalls.length} call(s)`);
      }
      completed = true;
      emit('milestone', {
        name: 'dom-ready',
        rendererDomReadyMs: result.rendererDomReadyMs,
        rendererFcpMs: result.rendererFcpMs,
        documentReadyState: result.documentReadyState,
        geometry: result.geometry,
        adapterInvokeCounts: result.adapterSummary.invokeCounts,
        adapterSubscriptionCounts: result.adapterSummary.subscriptionCounts,
        unexpectedAdapterCalls: 0,
        windowVisible: false,
      });
      window.destroy();
      app.exit(0);
    } catch (error) {
      fail(error?.message || 'semantic DOM readiness failed');
    }
  });

  const indexPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
  await window.loadFile(indexPath);
}).catch((error) => fail(error?.message || 'app readiness failed'));

app.on('before-quit', () => {
  if (!completed) fail('app quit before readiness');
});
