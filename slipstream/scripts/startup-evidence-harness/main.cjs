'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

const PROTOCOL = 'SLIPSTREAM_STARTUP_EVIDENCE_HARNESS_V1';
const OUTPUT_PREFIX = `${PROTOCOL}:`;
const MARKER_FILE = '.slipstream-startup-evidence-harness-v1';
const WIDTH = 520;
const HEIGHT = 680;
const SCENARIOS = new Set([
  'startup-loading',
  'first-use-setup',
  'returning-capture',
]);
const scenario = process.env.SLIPSTREAM_STARTUP_EVIDENCE_SCENARIO;
const profileRoot = process.env.SLIPSTREAM_STARTUP_EVIDENCE_PROFILE_ROOT;
const userDataPath = process.env.SLIPSTREAM_STARTUP_EVIDENCE_USER_DATA;
const sessionDataPath = process.env.SLIPSTREAM_STARTUP_EVIDENCE_SESSION_DATA;
const captureRoot = process.env.SLIPSTREAM_STARTUP_EVIDENCE_CAPTURE_ROOT;
const outputPath = process.env.SLIPSTREAM_STARTUP_EVIDENCE_OUTPUT_PATH;
let completed = false;
let windowWasShown = false;

function emit(type, detail = {}) {
  process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify({
    protocol: PROTOCOL,
    type,
    scenario,
    ...detail,
  })}\n`);
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function assertPrivateDirectory(candidatePath, label) {
  if (!candidatePath || !path.isAbsolute(candidatePath)) {
    throw new Error(`${label} is not an absolute path`);
  }
  const resolvedRoot = fs.realpathSync(profileRoot);
  const lexicalCandidate = path.resolve(candidatePath);
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

function assertOutputTarget() {
  const resolvedCaptureRoot = assertPrivateDirectory(captureRoot, 'capture root');
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error('capture output path is invalid');
  }
  const lexicalOutput = path.resolve(outputPath);
  if (!isInside(resolvedCaptureRoot, lexicalOutput)) {
    throw new Error('capture output is outside the private capture root');
  }
  if (path.dirname(lexicalOutput) !== resolvedCaptureRoot) {
    throw new Error('capture output must be a direct child of its private root');
  }
  const expectedName = `${scenario}.png`;
  if (path.basename(lexicalOutput) !== expectedName || fs.existsSync(lexicalOutput)) {
    throw new Error('capture output target is not fresh and scenario-owned');
  }
  return lexicalOutput;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('capture output is not a PNG');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('capture output has no leading IHDR chunk');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function fail(reason) {
  if (completed) return;
  completed = true;
  emit('failure', { reason: String(reason || 'unknown').slice(0, 180) });
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
  const protocol = 'SLIPSTREAM_STARTUP_EVIDENCE_HARNESS_V1';
  const scenario = ${JSON.stringify(scenario)};
  const startedAt = performance.now();
  const deadline = startedAt + (scenario === 'startup-loading' ? 2500 : 15000);
  const notBefore = startedAt + (scenario === 'startup-loading' ? 180 : 0);
  const devicePixelRatio = Number(window.devicePixelRatio);
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio < 1 || devicePixelRatio > 4) {
    throw new Error('renderer devicePixelRatio is outside the evidence contract');
  }
  const nextFrame = () => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 25);
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
    const loading = document.querySelector('.setup-gate--loading[aria-busy="true"]');
    let ready = false;
    let semanticTarget = '';
    let focusExpected = false;
    let focusMatched = false;
    let geometry = null;

    if (scenario === 'startup-loading') {
      ready = performance.now() >= notBefore && isUsable(loading);
      semanticTarget = '.setup-gate--loading[aria-busy="true"]';
      geometry = ready ? {
        width: Math.round(loading.getBoundingClientRect().width),
        height: Math.round(loading.getBoundingClientRect().height),
      } : null;
    } else if (scenario === 'first-use-setup') {
      const title = document.querySelector('#setup-title');
      const primary = document.querySelector('.setup-primary:not(:disabled)');
      const secondary = document.querySelector('.setup-secondary:not(:disabled)');
      focusExpected = true;
      focusMatched = document.activeElement === primary;
      ready = !loading
        && isUsable(title)
        && isUsable(primary)
        && isUsable(secondary)
        && focusMatched;
      semanticTarget = '#setup-title + two enabled choices';
      geometry = ready ? {
        titleWidth: Math.round(title.getBoundingClientRect().width),
        primaryWidth: Math.round(primary.getBoundingClientRect().width),
        secondaryWidth: Math.round(secondary.getBoundingClientRect().width),
      } : null;
    } else {
      const card = document.querySelector('.capture-card');
      const textarea = document.querySelector('.capture-input textarea:not(:disabled)');
      focusExpected = true;
      focusMatched = document.activeElement === textarea;
      ready = !loading
        && isUsable(card)
        && isUsable(textarea)
        && textarea.tabIndex >= 0
        && focusMatched;
      semanticTarget = '.capture-card + enabled textarea';
      geometry = ready ? {
        cardWidth: Math.round(card.getBoundingClientRect().width),
        textareaWidth: Math.round(textarea.getBoundingClientRect().width),
        textareaHeight: Math.round(textarea.getBoundingClientRect().height),
      } : null;
    }

    if (ready) {
      await nextFrame();
      await nextFrame();
      const adapter = window.slipstreamStartupEvidenceHarness;
      if (!adapter || adapter.protocol !== protocol || typeof adapter.getSummary !== 'function') {
        throw new Error('fixed startup evidence adapter is unavailable');
      }
      const adapterSummary = adapter.getSummary();
      if (scenario === 'startup-loading' && !adapterSummary.settingsRequestPending) {
        throw new Error('loading evidence did not retain the settings request');
      }
      return {
        documentReadyState: document.readyState,
        devicePixelRatio,
        semanticTarget,
        focusExpected,
        focusMatched,
        geometry,
        adapterSummary,
      };
    }
    await nextFrame();
  }
  throw new Error('startup evidence semantic readiness timed out');
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
  assertOutputTarget();

  app.setPath('userData', privateUserData);
  app.setPath('sessionData', privateSessionData);
  app.enableSandbox();
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
} catch (error) {
  emit('failure', { reason: String(error?.message || 'profile validation failed').slice(0, 180) });
  process.exit(1);
}

const safetyTimeout = setTimeout(() => fail('startup evidence capture timed out'), 20000);

app.whenReady().then(async () => {
  const appRoot = fs.realpathSync(app.getAppPath());
  const markerPath = path.join(appRoot, MARKER_FILE);
  if (!fs.statSync(markerPath).isFile()) throw new Error('private harness marker is missing');

  const harnessSession = session.fromPartition(`slipstream-startup-evidence-${process.pid}`, {
    cache: false,
  });
  const rendererRoot = fs.realpathSync(path.join(appRoot, 'dist', 'renderer'));
  installCapabilityDenials(harnessSession, rendererRoot);

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    backgroundColor: '#f4f2ed',
    webPreferences: {
      preload: path.join(appRoot, 'preload.cjs'),
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

  const [contentWidth, contentHeight] = window.getContentSize();
  if (contentWidth !== WIDTH || contentHeight !== HEIGHT) {
    throw new Error('hidden window content dimensions are incorrect');
  }
  window.webContents.setZoomFactor(1);
  window.on('show', () => {
    windowWasShown = true;
    window.hide();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame) fail(`renderer load failed (${code}): ${description}`);
  });
  window.on('closed', () => {
    if (!completed) fail('hidden evidence window closed before capture');
  });

  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(readinessProbe, true);
      if (windowWasShown || window.isVisible()) throw new Error('hidden window became visible');
      if (result?.adapterSummary?.scenario !== scenario) {
        throw new Error('adapter scenario mismatch');
      }
      if (result.adapterSummary.unexpectedCalls.length > 0) {
        throw new Error(`adapter rejected ${result.adapterSummary.unexpectedCalls.length} call(s)`);
      }

      const rawImage = await window.webContents.capturePage({
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
      });
      const rawSize = rawImage.getSize();
      const devicePixelRatio = result.devicePixelRatio;
      if (
        !Number.isFinite(devicePixelRatio)
        || devicePixelRatio < 1
        || devicePixelRatio > 4
      ) {
        throw new Error('capture devicePixelRatio is outside the evidence contract');
      }
      const expectedRawWidth = Math.round(WIDTH * devicePixelRatio);
      const expectedRawHeight = Math.round(HEIGHT * devicePixelRatio);
      if (rawSize.width !== expectedRawWidth || rawSize.height !== expectedRawHeight) {
        throw new Error('raw capturePage dimensions do not match content size and DPR');
      }
      const horizontalScale = rawSize.width / WIDTH;
      const verticalScale = rawSize.height / HEIGHT;
      const scaleTolerance = 1 / Math.min(WIDTH, HEIGHT);
      if (Math.abs(horizontalScale - verticalScale) > scaleTolerance) {
        throw new Error('raw capturePage axes use inconsistent scale factors');
      }
      const normalizationApplied = devicePixelRatio !== 1;
      const image = normalizationApplied
        ? rawImage.resize({ width: WIDTH, height: HEIGHT, quality: 'best' })
        : rawImage;
      const normalizedSize = image.getSize();
      if (normalizedSize.width !== WIDTH || normalizedSize.height !== HEIGHT) {
        throw new Error('validated Retina capture did not normalize to the evidence size');
      }
      const png = image.toPNG();
      const dimensions = pngDimensions(png);
      if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) {
        throw new Error('normalized PNG dimensions are incorrect');
      }

      fs.writeFileSync(outputPath, png, { flag: 'wx', mode: 0o600 });
      completed = true;
      clearTimeout(safetyTimeout);
      emit('success', {
        width: dimensions.width,
        height: dimensions.height,
        rawWidth: rawSize.width,
        rawHeight: rawSize.height,
        devicePixelRatio,
        normalizationApplied,
        byteLength: png.length,
        documentReadyState: result.documentReadyState,
        semanticTarget: result.semanticTarget,
        focusExpected: result.focusExpected,
        focusMatched: result.focusMatched,
        geometry: result.geometry,
        adapterInvokeCounts: result.adapterSummary.invokeCounts,
        adapterSubscriptionCounts: result.adapterSummary.subscriptionCounts,
        unexpectedAdapterCalls: 0,
        windowVisible: false,
      });
      window.destroy();
      app.exit(0);
    } catch (error) {
      fail(error?.message || 'startup evidence capture failed');
    }
  });

  const indexPath = path.join(rendererRoot, 'index.html');
  await window.loadFile(indexPath);
}).catch((error) => fail(error?.message || 'app readiness failed'));

app.on('before-quit', () => {
  if (!completed) fail('app quit before evidence capture');
});
