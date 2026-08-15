const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { join } = require('node:path');
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
const scriptPath = __filename;
const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const harnessFlag = '--reduced-motion-runtime-harness';
const rendererUrlEnvironment = 'SLIPSTREAM_REDUCED_MOTION_RENDERER_URL';
const userDataEnvironment = 'SLIPSTREAM_REDUCED_MOTION_USER_DATA';
const outputPrefix = '__SLIPSTREAM_REDUCED_MOTION_RUNTIME__';
const timeoutMs = 30_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startNetworkTrap() {
  return new Promise((resolve, reject) => {
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
        reject(new Error('Failed to start the Reduced Motion network trap'));
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

function monitorChild(command, args, options) {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  let outcome = null;
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-100_000);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-100_000);
  });
  const exit = new Promise((resolve) => {
    const finish = (result) => {
      if (outcome) return;
      outcome = Object.freeze({ ...result, stdout, stderr });
      resolve(outcome);
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (viteMonitor.outcome) {
      throw new Error(`Vite exited before the renderer was ready: ${viteMonitor.outcome.stderr}`);
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
  throw new Error('Timed out waiting for the loopback renderer');
}

function parseHarnessProof(outcome) {
  const marker = outcome.stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(outputPrefix));
  const proof = marker ? JSON.parse(marker.slice(outputPrefix.length)) : null;
  assert.equal(
    outcome.code,
    0,
    `Reduced Motion Electron harness exited unexpectedly (${outcome.signal || outcome.code})\n${proof?.error || outcome.stderr}`,
  );
  assert.ok(marker, `Reduced Motion Electron harness did not emit proof\n${outcome.stdout}`);
  return proof;
}

function assertRuntimeProof(proof, networkTrap) {
  assert.equal(proof.success, true, proof.error || 'Reduced Motion runtime proof failed');
  assert.equal(proof.rendererUrlExact, true);
  assert.equal(proof.userDataIsFixture, true);
  assert.equal(proof.sessionDataIsNested, true);
  assert.equal(proof.contextIsolation, true);
  assert.equal(proof.nodeIntegrationDisabled, true);
  assert.equal(proof.sandboxEnabled, true);
  assert.equal(proof.inheritedSecretsPresent, false);
  assert.equal(proof.sessionTrapFetchBlocked, true);
  assert.deepEqual(
    proof.blockedRendererExternalUrls,
    [],
    `renderer attempted blocked requests: ${JSON.stringify(proof.blockedRendererExternalUrls)}`,
  );
  assert.equal(networkTrap.requestCount, 0, 'the isolated renderer reached the network trap');
  assert.deepEqual(proof.renderer.marker, { enabled: true, isolated: true });
  assert.equal(proof.renderer.nodeGlobalsUnavailable, true);
  assert.equal(proof.renderer.clipboardStubbed, true);

  assert.equal(proof.normal.matchMediaMatches, false);
  assert.equal(proof.normal.helperBehavior, 'smooth');
  assert.equal(proof.normal.deadlineScroll.behavior, 'smooth');
  assert.equal(proof.normal.deadlineScroll.block, 'center');
  assert.equal(proof.normal.deadlineScroll.targetConnected, true);
  assert.equal(proof.normal.settings.matchMediaMatches, false);
  assert.equal(proof.normal.settings.linkCount, 1);
  assert.equal(proof.normal.settings.linkLoaded, true);
  assert.equal(proof.normal.settings.dedicatedRuleLoaded, true);
  assert.equal(proof.normal.settings.spinnerAnimationName, 'settings-reset-spin');
  assert.ok(proof.normal.settings.returnTransitionDurationMs >= 100,
    'Settings should retain its ordinary transition without Reduced Motion');

  assert.equal(proof.reduced.matchMediaMatches, true);
  assert.equal(proof.reduced.helperBehavior, 'auto');
  assert.equal(proof.reduced.deadlineScroll.behavior, 'auto');
  assert.equal(proof.reduced.deadlineScroll.block, 'center');
  assert.equal(proof.reduced.deadlineScroll.targetConnected, true);
  assert.equal(proof.reduced.settings.matchMediaMatches, true);
  assert.equal(proof.reduced.settings.linkCount, 1);
  assert.equal(proof.reduced.settings.linkLoaded, true);
  assert.equal(proof.reduced.settings.dedicatedRuleLoaded, true);
  assert.equal(proof.reduced.settings.spinnerAnimationName, 'none');
  assert.ok(
    proof.reduced.settings.returnTransitionDurationMs > 0
      && proof.reduced.settings.returnTransitionDurationMs <= 0.01,
    `unexpected Reduced Motion Settings transition: ${proof.reduced.settings.returnTransitionDuration}`,
  );
  assert.equal(proof.reduced.css.reducedMediaRuleActive, true);
  assert.equal(proof.reduced.css.globalSelectorPresent, true);
  assert.equal(proof.reduced.css.scrollBehavior, 'auto');
  assert.equal(proof.reduced.css.animationIterationCount, '1');
  assert.ok(
    proof.reduced.css.animationDurationMs > 0
      && proof.reduced.css.animationDurationMs <= 0.01,
    `unexpected Reduced Motion animation duration: ${proof.reduced.css.animationDuration}`,
  );
  assert.ok(
    proof.reduced.css.transitionDurationMs > 0
      && proof.reduced.css.transitionDurationMs <= 0.01,
    `unexpected Reduced Motion transition duration: ${proof.reduced.css.transitionDuration}`,
  );
}

async function runNodeHarness() {
  let ownedUserData = null;
  let viteMonitor = null;
  let electronMonitor = null;
  let networkTrap = null;
  try {
    networkTrap = await startNetworkTrap();
    ownedUserData = createOwnedUserDataDirectory();
    const rendererPort = await findAvailableLoopbackPort();
    const rendererUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${rendererPort}/?demo=result&terms=sample&fixture=check&trapPort=${networkTrap.port}&run=native-runtime`,
    );
    const childEnvironment = sanitizeFixtureEnvironment({
      ...process.env,
      DEEPSEEK_API_KEY: 'fixture-secret-must-not-cross',
      OPENAI_API_KEY: 'fixture-secret-must-not-cross',
      SSH_AUTH_SOCK: '/tmp/fixture-authority-must-not-cross',
      NODE_OPTIONS: '--trace-warnings',
    });
    assert.equal(childEnvironment.DEEPSEEK_API_KEY, undefined);
    assert.equal(childEnvironment.OPENAI_API_KEY, undefined);
    assert.equal(childEnvironment.SSH_AUTH_SOCK, undefined);
    assert.equal(childEnvironment.NODE_OPTIONS, undefined);

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
    await waitForRenderer(rendererUrl, viteMonitor);

    const electronBinary = require('electron');
    electronMonitor = monitorChild(electronBinary, [scriptPath, harnessFlag], {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        [rendererUrlEnvironment]: rendererUrl,
        [userDataEnvironment]: ownedUserData.realPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(
          `Reduced Motion Electron harness timed out\n${electronMonitor.stdout}\n${electronMonitor.stderr}`,
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
    assertRuntimeProof(proof, networkTrap);
    console.log('Reduced Motion Electron runtime checks passed.');
    console.log('Covered: production Result and deferred Settings CSS, shared motion helper, and deadline navigation.');
    console.log('Boundary: evidence navigation remains covered by the static gate, not this runtime probe.');
  } finally {
    await terminateChild(electronMonitor);
    await terminateChild(viteMonitor);
    if (networkTrap) await networkTrap.close();
    if (ownedUserData) removeOwnedUserDataDirectory(ownedUserData);
  }
}

function rendererProbeSource() {
  return `(async () => {
    const helper = await import('/utils/motionPreference.mjs');
    const rootStyle = getComputedStyle(document.documentElement);
    const toMilliseconds = (duration) => Math.max(...duration.split(',').map((entry) => {
      const value = entry.trim();
      if (value.endsWith('ms')) return Number.parseFloat(value);
      if (value.endsWith('s')) return Number.parseFloat(value) * 1000;
      return Number.NaN;
    }));
    let reducedMediaRuleActive = false;
    let globalSelectorPresent = false;
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('prefers-reduced-motion')) continue;
        if (!window.matchMedia(rule.conditionText).matches) continue;
        reducedMediaRuleActive = true;
        for (const childRule of rule.cssRules) {
          if (
            childRule.selectorText?.split(',').some((selector) => selector.trim() === '*')
            && childRule.style?.getPropertyValue('scroll-behavior').trim() === 'auto'
            && childRule.style?.getPropertyPriority('scroll-behavior') === 'important'
          ) {
            globalSelectorPresent = true;
          }
        }
      }
    }
    return {
      matchMediaMatches: window.matchMedia(helper.REDUCED_MOTION_QUERY).matches,
      helperBehavior: helper.preferredScrollBehavior(),
      css: {
        reducedMediaRuleActive,
        globalSelectorPresent,
        scrollBehavior: rootStyle.scrollBehavior,
        animationDuration: rootStyle.animationDuration,
        animationDurationMs: toMilliseconds(rootStyle.animationDuration),
        animationIterationCount: rootStyle.animationIterationCount,
        transitionDuration: rootStyle.transitionDuration,
        transitionDurationMs: toMilliseconds(rootStyle.transitionDuration),
      },
    };
  })()`;
}

function installScrollProbeSource() {
  return `(() => {
    if (!window.__slipstreamReducedMotionScrollProbe) {
      const original = Element.prototype.scrollIntoView;
      const calls = [];
      Element.prototype.scrollIntoView = function scrollIntoView(options) {
        calls.push({
          behavior: options?.behavior || null,
          block: options?.block || null,
          targetConnected: this.isConnected,
          targetTag: this.tagName,
          targetClass: typeof this.className === 'string' ? this.className : '',
        });
        return original.call(this, options);
      };
      Object.defineProperty(window, '__slipstreamReducedMotionScrollProbe', {
        configurable: false,
        value: { calls },
        writable: false,
      });
    }
    return true;
  })()`;
}

function triggerDeadlineSource() {
  return `(async () => {
    const probe = window.__slipstreamReducedMotionScrollProbe;
    if (!probe) throw new Error('scrollIntoView probe is unavailable');
    const deadline = document.querySelector('.deadline-summary');
    if (!deadline) throw new Error('result fixture deadline action is unavailable');
    const initialCount = probe.calls.length;
    deadline.click();
    const deadlineAt = Date.now() + 3000;
    while (probe.calls.length === initialCount && Date.now() < deadlineAt) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    if (probe.calls.length === initialCount) {
      throw new Error('deadline action did not call scrollIntoView');
    }
    return probe.calls.at(-1);
  })()`;
}

function waitForResultSource() {
  return `new Promise((resolve, reject) => {
    const deadline = Date.now() + 7000;
    const check = () => {
      if (document.querySelector('#result-headline') && document.querySelector('.deadline-summary')) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for the completed result fixture'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`;
}

function waitForSettingsSource() {
  return `new Promise((resolve, reject) => {
    const trigger = document.querySelector('[data-settings-trigger]');
    if (!trigger) {
      reject(new Error('Settings trigger is unavailable'));
      return;
    }
    trigger.click();
    const deadline = Date.now() + 7000;
    const check = () => {
      if (document.querySelector('.settings-panel .settings-return-button')) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for deferred Settings presentation'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`;
}

function settingsMotionProbeSource() {
  return `(() => {
    const links = [...document.querySelectorAll('link[data-workspace-stylesheet="settings"]')];
    const link = links[0] || null;
    const includesSelector = (rules, selector) => [...rules].some((rule) => {
      if (rule.selectorText?.split(',').some((entry) => entry.trim() === selector)) return true;
      return rule.cssRules ? includesSelector(rule.cssRules, selector) : false;
    });
    const spinner = document.createElement('span');
    spinner.className = 'settings-connection-exit-spinner';
    spinner.hidden = true;
    document.querySelector('.settings-panel').append(spinner);
    const spinnerStyle = getComputedStyle(spinner);
    const returnStyle = getComputedStyle(document.querySelector('.settings-return-button'));
    const durationToMilliseconds = (duration) => {
      const value = duration.split(',')[0].trim();
      if (value.endsWith('ms')) return Number.parseFloat(value);
      if (value.endsWith('s')) return Number.parseFloat(value) * 1000;
      return Number.NaN;
    };
    const proof = {
      matchMediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      linkCount: links.length,
      linkLoaded: link?.dataset.workspaceLoaded === 'true',
      dedicatedRuleLoaded: Boolean(link?.sheet && includesSelector(
        link.sheet.cssRules,
        '.settings-connection-exit-spinner',
      )),
      spinnerAnimationName: spinnerStyle.animationName,
      spinnerAnimationDuration: spinnerStyle.animationDuration,
      returnTransitionDuration: returnStyle.transitionDuration,
      returnTransitionDurationMs: durationToMilliseconds(returnStyle.transitionDuration),
    };
    spinner.remove();
    return proof;
  })()`;
}

function returnFromSettingsSource() {
  return `new Promise((resolve, reject) => {
    const returnButton = document.querySelector('.settings-return-button');
    if (!returnButton) {
      reject(new Error('Settings return action is unavailable'));
      return;
    }
    returnButton.click();
    const deadline = Date.now() + 7000;
    const check = () => {
      if (document.querySelector('#result-headline')) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out returning from Settings to the preserved result'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`;
}

async function settleMediaChange(webContents) {
  await webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true,
  );
}

async function writeHarnessOutcome(app, payload, exitCode) {
  await new Promise((resolve) => {
    process.stdout.write(`${outputPrefix}${JSON.stringify(payload)}\n`, resolve);
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
  let fixtureWindow = null;
  let debuggerAttached = false;
  try {
    const rendererUrl = validateFixtureRendererUrl(process.env[rendererUrlEnvironment]);
    const userDataPath = validateFixtureUserDataPath(process.env[userDataEnvironment]);
    const rendererLocation = new URL(rendererUrl);
    const rendererOrigin = rendererLocation.origin;
    const sessionDataPath = join(userDataPath, 'session');
    const trapUrl = `http://127.0.0.1:${rendererLocation.searchParams.get('trapPort')}/reduced-motion-runtime-probe`;
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', sessionDataPath);
    app.enableSandbox();
    await app.whenReady();
    Menu.setApplicationMenu(null);

    const fixtureSession = session.defaultSession;
    let blockedRendererExternalRequests = 0;
    const blockedRendererExternalUrls = [];
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
      if (
        !allowed
        && details.url !== trapUrl
        && details.webContentsId === fixtureWindow?.webContents.id
      ) {
        blockedRendererExternalRequests += 1;
        blockedRendererExternalUrls.push(details.url);
      }
      callback({ cancel: !allowed });
    });

    let sessionTrapFetchBlocked = false;
    try {
      await fixtureSession.fetch(trapUrl, { cache: 'no-store' });
    } catch {
      sessionTrapFetchBlocked = true;
    }

    fixtureWindow = new BrowserWindow({
      width: 920,
      height: 720,
      show: false,
      webPreferences: {
        preload: join(projectRoot, 'scripts', 'ui-fixture-preload.js'),
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
    await fixtureWindow.webContents.executeJavaScript(waitForResultSource(), true);
    await fixtureWindow.webContents.executeJavaScript(installScrollProbeSource(), true);

    const renderer = await fixtureWindow.webContents.executeJavaScript(`(async () => {
      const clipboardResult = await window.api.invoke('clipboard:write', 'fixture-only-runtime-probe');
      return {
        marker: window.slipstreamUiFixture,
        nodeGlobalsUnavailable: typeof require === 'undefined' && typeof process === 'undefined',
        clipboardStubbed: clipboardResult?.fixture === true,
      };
    })()`, true);
    const preferences = fixtureWindow.webContents.getLastWebPreferences();
    const inheritedSecretsPresent = Object.keys(process.env).some((key) => {
      const normalized = key.normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLowerCase();
      return normalized.includes('apikey')
        || normalized.includes('token')
        || normalized.includes('secret')
        || normalized.includes('password')
        || normalized.includes('credential')
        || normalized === 'sshauthsock'
        || normalized === 'nodeoptions';
    });

    fixtureWindow.webContents.debugger.attach('1.3');
    debuggerAttached = true;
    await fixtureWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    await settleMediaChange(fixtureWindow.webContents);
    const normal = await fixtureWindow.webContents.executeJavaScript(rendererProbeSource(), true);
    normal.deadlineScroll = await fixtureWindow.webContents.executeJavaScript(
      triggerDeadlineSource(),
      true,
    );
    await fixtureWindow.webContents.executeJavaScript(waitForSettingsSource(), true);
    normal.settings = await fixtureWindow.webContents.executeJavaScript(
      settingsMotionProbeSource(),
      true,
    );
    await fixtureWindow.webContents.executeJavaScript(returnFromSettingsSource(), true);

    await fixtureWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await settleMediaChange(fixtureWindow.webContents);
    const reduced = await fixtureWindow.webContents.executeJavaScript(rendererProbeSource(), true);
    reduced.deadlineScroll = await fixtureWindow.webContents.executeJavaScript(
      triggerDeadlineSource(),
      true,
    );
    await fixtureWindow.webContents.executeJavaScript(waitForSettingsSource(), true);
    reduced.settings = await fixtureWindow.webContents.executeJavaScript(
      settingsMotionProbeSource(),
      true,
    );
    await fixtureWindow.webContents.executeJavaScript(returnFromSettingsSource(), true);

    const proof = {
      success: true,
      rendererUrlExact: fixtureWindow.webContents.getURL() === rendererUrl,
      userDataIsFixture: app.getPath('userData') === userDataPath,
      sessionDataIsNested: app.getPath('sessionData').startsWith(`${userDataPath}/`),
      contextIsolation: preferences.contextIsolation === true,
      nodeIntegrationDisabled: preferences.nodeIntegration === false,
      sandboxEnabled: preferences.sandbox === true,
      inheritedSecretsPresent,
      sessionTrapFetchBlocked,
      blockedRendererExternalRequests,
      blockedRendererExternalUrls,
      renderer,
      normal,
      reduced,
    };
    await writeHarnessOutcome(app, proof, 0);
  } catch (error) {
    await writeHarnessOutcome(app, {
      success: false,
      error: String(error?.stack || error?.message || error),
    }, 1);
  } finally {
    if (debuggerAttached && fixtureWindow && !fixtureWindow.isDestroyed()) {
      fixtureWindow.webContents.debugger.detach();
    }
    if (fixtureWindow && !fixtureWindow.isDestroyed()) fixtureWindow.destroy();
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
