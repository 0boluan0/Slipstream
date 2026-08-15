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
const harnessFlag = '--contrast-preferences-runtime-harness';
const rendererUrlEnvironment = 'SLIPSTREAM_CONTRAST_RENDERER_URL';
const userDataEnvironment = 'SLIPSTREAM_CONTRAST_USER_DATA';
const evidenceDirEnvironment = 'SLIPSTREAM_CONTRAST_EVIDENCE_DIR';
const outputPrefix = '__SLIPSTREAM_CONTRAST_PREFERENCES_RUNTIME__';
const timeoutMs = 40_000;

const mediaRequests = Object.freeze({
  normal: Object.freeze([
    Object.freeze({ name: 'prefers-contrast', value: 'no-preference' }),
    Object.freeze({ name: 'forced-colors', value: 'none' }),
  ]),
  more: Object.freeze([
    Object.freeze({ name: 'prefers-contrast', value: 'more' }),
    Object.freeze({ name: 'forced-colors', value: 'none' }),
  ]),
  forced: Object.freeze([
    Object.freeze({ name: 'prefers-contrast', value: 'no-preference' }),
    Object.freeze({ name: 'forced-colors', value: 'active' }),
  ]),
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function modeBits(path) {
  return statSync(path).mode & 0o777;
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
      throw new Error(`Unknown contrast runtime argument: ${argument}`);
    }
    if (evidenceDirectory !== null || typeof value !== 'string' || !value) {
      throw new Error('--evidence-dir may be provided once with a value');
    }
    evidenceDirectory = validateEvidenceDirectory(value);
  }
  return Object.freeze({ evidenceDirectory });
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
        reject(new Error('Failed to start the contrast preference network trap'));
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
    stdout = `${stdout}${chunk.toString()}`.slice(-150_000);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-150_000);
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
      throw new Error(`Vite exited before the contrast renderer was ready: ${viteMonitor.outcome.stderr}`);
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
  throw new Error('Timed out waiting for the loopback contrast renderer');
}

function parseHarnessProof(outcome) {
  const marker = outcome.stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(outputPrefix));
  const proof = marker ? JSON.parse(marker.slice(outputPrefix.length)) : null;
  assert.equal(
    outcome.code,
    0,
    `Contrast preference Electron harness exited unexpectedly (${outcome.signal || outcome.code})\n${proof?.error || outcome.stderr}`,
  );
  assert.ok(marker, `Contrast preference Electron harness did not emit proof\n${outcome.stdout}`);
  return proof;
}

function assertFocus(probe, label) {
  assert.equal(probe.focus.focused, true, `${label} did not retain focus`);
  assert.equal(probe.focus.focusVisible, true, `${label} did not match :focus-visible`);
  assert.equal(probe.focus.outlineStyle, 'solid', `${label} did not render a solid outline`);
  assert.ok(probe.focus.outlineWidth >= 3, `${label} outline was below 3 CSS pixels`);
  assert.ok(probe.focus.outlineColor.alpha > 0, `${label} outline was transparent`);
}

function assertGeometry(probe, label) {
  assert.equal(probe.geometry.documentNoHorizontalOverflow, true, `${label} overflowed the document`);
  for (const container of probe.geometry.containers) {
    assert.equal(container.noHorizontalOverflow, true, `${label} overflowed ${container.selector}`);
  }
}

function assertPreferenceView(probe, state, view) {
  const label = `${state} ${view}`;
  assert.equal(probe.view, view);
  assert.equal(probe.state, state);
  assert.deepEqual(probe.media, {
    prefersContrastMore: state === 'more',
    prefersContrastNoPreference: state !== 'more',
    forcedColorsActive: state === 'forced',
  }, `${label} media state drifted`);
  assertFocus(probe, label);
  assertGeometry(probe, label);
  assert.ok(Number.isFinite(probe.text.contrastRatio), `${label} text contrast was not measurable`);
  assert.ok(probe.surface.borderWidth >= 1, `${label} key surface had no visible boundary`);
  if (state === 'more' || state === 'forced') {
    assert.ok(
      probe.text.contrastRatio >= 4.5,
      `${label} text contrast was ${probe.text.contrastRatio.toFixed(2)}:1`,
    );
    assert.ok(
      probe.surface.borderContrastRatio >= 3,
      `${label} surface boundary contrast was ${probe.surface.borderContrastRatio.toFixed(2)}:1`,
    );
    for (const backdrop of probe.visibleBackdrops) {
      assert.equal(backdrop.backdropFilter, 'none', `${label} kept backdrop blur on ${backdrop.selector}`);
      assert.equal(backdrop.webkitBackdropFilter, 'none', `${label} kept WebKit backdrop blur on ${backdrop.selector}`);
    }
  }
  if (view === 'reset') {
    assert.ok(probe.visibleBackdrops.length >= 1, `${label} did not probe a visible reset backdrop`);
  }
  if (state === 'forced') {
    assert.notEqual(probe.focus.forcedColorAdjust, 'none', `${label} disabled forced color adjustment on focus`);
    assert.notEqual(probe.surface.forcedColorAdjust, 'none', `${label} disabled forced color adjustment on its surface`);
    assert.notEqual(probe.text.forcedColorAdjust, 'none', `${label} disabled forced color adjustment on text`);
  }
}

function assertRuntimeProof(proof, networkTrap, expectedEvidenceDirectory) {
  assert.equal(proof.success, true, proof.error || 'Contrast preference runtime proof failed');
  assert.equal(proof.rendererUrlExact, true);
  assert.equal(proof.userDataIsFixture, true);
  assert.equal(proof.userDataMode, 0o700);
  assert.equal(proof.sessionDataIsNested, true);
  assert.equal(proof.sessionDataMode, 0o700);
  assert.equal(proof.windowHidden, true);
  assert.equal(proof.contextIsolation, true);
  assert.equal(proof.nodeIntegrationDisabled, true);
  assert.equal(proof.sandboxEnabled, true);
  assert.equal(proof.inheritedSecretsPresent, false);
  assert.equal(proof.sessionTrapFetchBlocked, true);
  assert.equal(proof.blockedRendererExternalRequests, 0);
  assert.deepEqual(proof.blockedRendererExternalUrls, []);
  assert.equal(networkTrap.requestCount, 0, 'the contrast renderer reached the network trap');
  assert.deepEqual(proof.renderer.marker, { enabled: true, isolated: true });
  assert.equal(proof.renderer.nodeGlobalsUnavailable, true);
  assert.equal(proof.renderer.clipboardStubbed, true);
  assert.deepEqual(proof.requestedMedia, mediaRequests);
  assert.equal(proof.keyboardInput.native, true);
  assert.ok(proof.keyboardInput.tabEvents >= 3);
  assert.equal(proof.keyboardInput.allRendererEventsTrusted, true);

  assert.deepEqual(proof.media.normal, {
    prefersContrastMore: false,
    prefersContrastNoPreference: true,
    forcedColorsActive: false,
  });
  assert.deepEqual(proof.media.more, {
    prefersContrastMore: true,
    prefersContrastNoPreference: false,
    forcedColorsActive: false,
  });
  assert.deepEqual(proof.media.forced, {
    prefersContrastMore: false,
    prefersContrastNoPreference: true,
    forcedColorsActive: true,
  });

  for (const state of Object.keys(mediaRequests)) {
    for (const view of ['result', 'settings', 'reset']) {
      assertPreferenceView(proof.states[state][view], state, view);
    }
  }
  assert.equal(proof.states.normal.result.completedActionCount >= 1, true);
  assert.equal(proof.states.forced.result.selectedControl.present, true);
  assert.notEqual(proof.states.forced.result.selectedControl.forcedColorAdjust, 'none');

  assert.equal(proof.evidence.enabled, Boolean(expectedEvidenceDirectory));
  assert.equal(proof.evidence.directory, expectedEvidenceDirectory);
  assert.deepEqual(
    proof.evidence.files,
    expectedEvidenceDirectory
      ? ['result', 'settings', 'reset'].flatMap((view) => (
        Object.keys(mediaRequests).map((state) => `${state}-${view}.png`)
      ))
      : [],
  );
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
    const rendererUrl = validateFixtureRendererUrl(
      `http://127.0.0.1:${rendererPort}/?demo=result&terms=sample&fixture=check&trapPort=${networkTrap.port}&run=native-runtime`,
    );
    const childEnvironment = sanitizeFixtureEnvironment({
      ...process.env,
      DEEPSEEK_API_KEY: 'fixture-secret-must-not-cross',
      OPENAI_API_KEY: 'fixture-secret-must-not-cross',
      ANTHROPIC_API_KEY: 'fixture-secret-must-not-cross',
      SSH_AUTH_SOCK: '/tmp/fixture-authority-must-not-cross',
      NODE_OPTIONS: '--trace-warnings',
    });
    assert.equal(childEnvironment.DEEPSEEK_API_KEY, undefined);
    assert.equal(childEnvironment.OPENAI_API_KEY, undefined);
    assert.equal(childEnvironment.ANTHROPIC_API_KEY, undefined);
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
        ...(evidenceDirectory ? { [evidenceDirEnvironment]: evidenceDirectory } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(
          `Contrast preference Electron harness timed out\n${electronMonitor.stdout}\n${electronMonitor.stderr}`,
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
    console.log('Contrast preference Electron runtime checks passed.');
    console.log(JSON.stringify({
      media: proof.media,
      focus: Object.fromEntries(Object.entries(proof.states).map(([state, views]) => [
        state,
        Object.fromEntries(Object.entries(views).map(([view, result]) => [
          view,
          { focusVisible: result.focus.focusVisible, outlineWidth: result.focus.outlineWidth },
        ])),
      ])),
      evidence: proof.evidence,
      isolation: {
        userDataMode: proof.userDataMode,
        sessionDataMode: proof.sessionDataMode,
        blockedRendererExternalRequests: proof.blockedRendererExternalRequests,
        networkTrapRequests: networkTrap.requestCount,
      },
    }, null, 2));
  } finally {
    await terminateChild(electronMonitor);
    await terminateChild(viteMonitor);
    if (networkTrap) await networkTrap.close();
    if (ownedUserData) removeOwnedUserDataDirectory(ownedUserData);
  }
}

function waitForResultSource() {
  return `new Promise((resolve, reject) => {
    const deadline = Date.now() + 7000;
    const check = () => {
      if (
        document.querySelector('#result-headline')
        && document.querySelector('.deadline-summary')
        && document.querySelectorAll('.action-completion-toggle input[type="checkbox"]').length > 0
      ) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for the completed result contrast fixture'));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`;
}

function waitForSelectorSource(selector, description) {
  return `new Promise((resolve, reject) => {
    const deadline = Date.now() + 7000;
    const check = () => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (target) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(${JSON.stringify(`Timed out waiting for ${description}`)}));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  })`;
}

function pageProbe({ state, view, surfaceSelector, textSelector, focusSelector }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const normalizeColor = (value) => {
    context.clearRect(0, 0, 1, 1);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'copy';
    context.fillStyle = 'rgba(1, 2, 3, 0.004)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alphaByte] = context.getImageData(0, 0, 1, 1).data;
    return {
      red,
      green,
      blue,
      alpha: alphaByte / 255,
      computed: value,
    };
  };

  const composite = (foreground, background) => {
    const alpha = foreground.alpha + (background.alpha * (1 - foreground.alpha));
    if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
    return {
      red: ((foreground.red * foreground.alpha)
        + (background.red * background.alpha * (1 - foreground.alpha))) / alpha,
      green: ((foreground.green * foreground.alpha)
        + (background.green * background.alpha * (1 - foreground.alpha))) / alpha,
      blue: ((foreground.blue * foreground.alpha)
        + (background.blue * background.alpha * (1 - foreground.alpha))) / alpha,
      alpha,
    };
  };

  const effectiveBackground = (element) => {
    const chain = [];
    for (let current = element; current; current = current.parentElement) chain.push(current);
    let result = { red: 255, green: 255, blue: 255, alpha: 1 };
    for (const current of chain.reverse()) {
      result = composite(normalizeColor(getComputedStyle(current).backgroundColor), result);
    }
    return result;
  };

  const opaqueColor = (value, background) => composite(normalizeColor(value), background);
  const luminance = (color) => {
    const linear = [color.red, color.green, color.blue].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const contrast = (first, second) => {
    const firstLuminance = luminance(first);
    const secondLuminance = luminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05)
      / (Math.min(firstLuminance, secondLuminance) + 0.05);
  };

  const visible = (element) => {
    const style = getComputedStyle(element);
    const rectangle = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity) > 0
      && rectangle.width > 0
      && rectangle.height > 0;
  };

  const surface = document.querySelector(surfaceSelector);
  const text = document.querySelector(textSelector);
  const focus = focusSelector ? document.querySelector(focusSelector) : document.activeElement;
  if (!surface || !text || !focus) {
    throw new Error(`Missing ${view} contrast target: ${surfaceSelector}, ${textSelector}, ${focusSelector}`);
  }
  const surfaceStyle = getComputedStyle(surface);
  const surfaceBackground = effectiveBackground(surface);
  const borderColor = opaqueColor(surfaceStyle.borderTopColor, surfaceBackground);
  const textStyle = getComputedStyle(text);
  const textBackground = effectiveBackground(text);
  const textColor = opaqueColor(textStyle.color, textBackground);
  const focusStyle = getComputedStyle(focus);

  const containerSelectors = [
    '.slipstream-shell',
    '.result-view',
    '.evidence-workspace',
    '.settings-panel',
    '.settings-panel__scroll',
    '.settings-reset-dialog',
  ];
  const containers = containerSelectors.flatMap((selector) => {
    const element = document.querySelector(selector);
    if (!element || !visible(element)) return [];
    return [{
      selector,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
    }];
  });

  const visibleBackdrops = [...document.querySelectorAll('[class*="backdrop"]')]
    .filter(visible)
    .map((element) => {
      const style = getComputedStyle(element);
      return {
        selector: `.${[...element.classList].join('.')}`,
        backdropFilter: style.backdropFilter || 'none',
        webkitBackdropFilter: style.webkitBackdropFilter || 'none',
      };
    });

  const checkedControl = document.querySelector('.action-completion-toggle input[type="checkbox"]:checked');
  const checkedStyle = checkedControl ? getComputedStyle(checkedControl) : null;
  const completedActionCount = document.querySelectorAll(
    '.action-completion-toggle input[type="checkbox"]:checked',
  ).length;

  return {
    state,
    view,
    media: {
      prefersContrastMore: matchMedia('(prefers-contrast: more)').matches,
      prefersContrastNoPreference: matchMedia('(prefers-contrast: no-preference)').matches,
      forcedColorsActive: matchMedia('(forced-colors: active)').matches,
    },
    completedActionCount,
    focus: {
      selector: focusSelector || `${focus.tagName.toLowerCase()}.${[...focus.classList].join('.')}`,
      focused: focus === document.activeElement,
      focusVisible: focus.matches(':focus-visible'),
      outlineStyle: focusStyle.outlineStyle,
      outlineWidth: Number.parseFloat(focusStyle.outlineWidth) || 0,
      outlineColor: normalizeColor(focusStyle.outlineColor),
      forcedColorAdjust: focusStyle.forcedColorAdjust,
    },
    surface: {
      selector: surfaceSelector,
      borderWidth: Number.parseFloat(surfaceStyle.borderTopWidth) || 0,
      borderStyle: surfaceStyle.borderTopStyle,
      borderColor: normalizeColor(surfaceStyle.borderTopColor),
      backgroundColor: surfaceBackground,
      borderContrastRatio: contrast(borderColor, surfaceBackground),
      forcedColorAdjust: surfaceStyle.forcedColorAdjust,
    },
    text: {
      selector: textSelector,
      color: normalizeColor(textStyle.color),
      backgroundColor: textBackground,
      contrastRatio: contrast(textColor, textBackground),
      forcedColorAdjust: textStyle.forcedColorAdjust,
    },
    selectedControl: {
      present: Boolean(checkedControl),
      accentColor: checkedStyle?.accentColor || null,
      forcedColorAdjust: checkedStyle?.forcedColorAdjust || null,
    },
    visibleBackdrops,
    geometry: {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentNoHorizontalOverflow:
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      containers,
    },
  };
}

async function settleAnimationFrames(webContents) {
  await webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true,
  );
}

async function setMediaState(webContents, state) {
  await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    media: '',
    features: [],
  });
  await settleAnimationFrames(webContents);
  await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    media: '',
    features: mediaRequests[state].map((feature) => ({ ...feature })),
  });
  await settleAnimationFrames(webContents);
}

async function sendNativeTab(webContents, reverse = false) {
  webContents.focus();
  const modifiers = reverse ? ['shift'] : undefined;
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', ...(modifiers ? { modifiers } : {}) });
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', ...(modifiers ? { modifiers } : {}) });
  await delay(60);
}

async function focusSelectorWithNativeTab(webContents, selector, maximumTabs = 100) {
  let activeMatches = await webContents.executeJavaScript(
    `Boolean(document.activeElement?.matches(${JSON.stringify(selector)}))`,
    true,
  );
  if (activeMatches) {
    await sendNativeTab(webContents);
    await sendNativeTab(webContents, true);
  } else {
    for (let index = 0; index < maximumTabs; index += 1) {
      await sendNativeTab(webContents);
      activeMatches = await webContents.executeJavaScript(
        `Boolean(document.activeElement?.matches(${JSON.stringify(selector)}))`,
        true,
      );
      if (activeMatches) break;
    }
  }
  const result = await webContents.executeJavaScript(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    return {
      focused: Boolean(target && document.activeElement === target),
      focusVisible: Boolean(target?.matches(':focus-visible')),
    };
  })()`, true);
  assert.equal(result.focused, true, `Native Tab did not reach ${selector}`);
  assert.equal(result.focusVisible, true, `Native Tab did not establish focus-visible on ${selector}`);
}

async function captureEvidence(webContents, evidenceDirectory, state, view, files) {
  if (!evidenceDirectory) return;
  const filename = `${state}-${view}.png`;
  const image = await webContents.capturePage();
  writeFileSync(join(evidenceDirectory, filename), image.toPNG());
  files.push(filename);
}

async function probeView(webContents, state, view, selectors) {
  return webContents.executeJavaScript(
    `(${pageProbe.toString()})(${JSON.stringify({ state, view, ...selectors })})`,
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
    const evidenceDirectory = validateEvidenceDirectory(process.env[evidenceDirEnvironment]);
    const rendererLocation = new URL(rendererUrl);
    const rendererOrigin = rendererLocation.origin;
    const sessionDataPath = join(userDataPath, 'session');
    const trapUrl = `http://127.0.0.1:${rendererLocation.searchParams.get('trapPort')}/contrast-runtime-probe`;
    assert.equal(modeBits(userDataPath), 0o700);
    assert.equal(modeBits(sessionDataPath), 0o700);
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
      width: 1106,
      height: 768,
      show: false,
      webPreferences: {
        preload: join(projectRoot, 'scripts', 'ui-fixture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    fixtureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    fixtureWindow.webContents.on('will-navigate', (event, targetUrl) => {
      if (targetUrl !== rendererUrl) event.preventDefault();
    });
    await fixtureWindow.loadURL(rendererUrl);
    await fixtureWindow.webContents.executeJavaScript(waitForResultSource(), true);
    await fixtureWindow.webContents.executeJavaScript(`(() => {
      window.__slipstreamContrastTrustedTabs = [];
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') window.__slipstreamContrastTrustedTabs.push(event.isTrusted);
      }, true);
      return true;
    })()`, true);
    const completion = await fixtureWindow.webContents.executeJavaScript(`(async () => {
      const checkboxes = [...document.querySelectorAll(
        '.action-completion-toggle input[type="checkbox"]'
      )];
      for (const checkbox of checkboxes) {
        if (!checkbox.checked) checkbox.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        total: checkboxes.length,
        checked: document.querySelectorAll(
          '.action-completion-toggle input[type="checkbox"]:checked'
        ).length,
        completePanel: Boolean(document.querySelector('.action-progress.is-complete')),
      };
    })()`, true);
    assert.ok(completion.total >= 1 && completion.checked === completion.total && completion.completePanel);

    const renderer = await fixtureWindow.webContents.executeJavaScript(`(async () => {
      const clipboardResult = await window.api.invoke('clipboard:write', 'fixture-only-contrast-probe');
      return {
        marker: window.slipstreamUiFixture,
        nodeGlobalsUnavailable: typeof require === 'undefined' && typeof process === 'undefined',
        clipboardStubbed: clipboardResult?.fixture === true,
      };
    })()`, true);
    const preferences = fixtureWindow.webContents.getLastWebPreferences();
    const inheritedSecretsPresent = Object.keys(process.env).some((key) => {
      const normalizedName = key.normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLowerCase();
      return normalizedName.includes('apikey')
        || normalizedName.includes('token')
        || normalizedName.includes('secret')
        || normalizedName.includes('password')
        || normalizedName.includes('credential')
        || normalizedName === 'sshauthsock'
        || normalizedName === 'nodeoptions';
    });

    fixtureWindow.webContents.debugger.attach('1.3');
    debuggerAttached = true;
    const states = { normal: {}, more: {}, forced: {} };
    const media = {};
    const evidenceFiles = [];

    await setMediaState(fixtureWindow.webContents, 'normal');
    await focusSelectorWithNativeTab(fixtureWindow.webContents, '.deadline-summary');
    for (const state of Object.keys(mediaRequests)) {
      await setMediaState(fixtureWindow.webContents, state);
      states[state].result = await probeView(fixtureWindow.webContents, state, 'result', {
        surfaceSelector: '.action-progress.is-complete',
        textSelector: '.action-progress.is-complete > span',
        focusSelector: '.deadline-summary',
      });
      media[state] = states[state].result.media;
      await captureEvidence(fixtureWindow.webContents, evidenceDirectory, state, 'result', evidenceFiles);
    }

    await setMediaState(fixtureWindow.webContents, 'normal');
    await fixtureWindow.webContents.executeJavaScript(`(() => {
      const trigger = document.querySelector('button[aria-label="打开设置"]');
      if (!trigger) throw new Error('Result Settings trigger is unavailable');
      trigger.click();
      return true;
    })()`, true);
    await fixtureWindow.webContents.executeJavaScript(
      waitForSelectorSource('.settings-panel', 'Settings panel'),
      true,
    );
    await focusSelectorWithNativeTab(fixtureWindow.webContents, '.settings-return-button');
    for (const state of Object.keys(mediaRequests)) {
      await setMediaState(fixtureWindow.webContents, state);
      states[state].settings = await probeView(fixtureWindow.webContents, state, 'settings', {
        surfaceSelector: '.settings-mode-summary',
        textSelector: '.settings-mode-summary__label strong',
        focusSelector: '.settings-return-button',
      });
      await captureEvidence(fixtureWindow.webContents, evidenceDirectory, state, 'settings', evidenceFiles);
    }

    await setMediaState(fixtureWindow.webContents, 'normal');
    await fixtureWindow.webContents.executeJavaScript(`(() => {
      const trigger = document.querySelector('.settings-reset-trigger');
      if (!trigger || trigger.disabled) throw new Error('Settings reset dialog trigger is unavailable');
      trigger.click();
      return true;
    })()`, true);
    await fixtureWindow.webContents.executeJavaScript(
      waitForSelectorSource('.settings-reset-dialog', 'Settings reset dialog'),
      true,
    );
    await settleAnimationFrames(fixtureWindow.webContents);
    await focusSelectorWithNativeTab(fixtureWindow.webContents, '.settings-reset-cancel');
    const resetFocusReady = await fixtureWindow.webContents.executeJavaScript(`Boolean(
      document.activeElement?.matches('.settings-reset-cancel')
      && document.activeElement.matches(':focus-visible')
    )`, true);
    assert.equal(resetFocusReady, true, 'Native Tab did not establish safe reset-dialog keyboard focus');
    for (const state of Object.keys(mediaRequests)) {
      await setMediaState(fixtureWindow.webContents, state);
      states[state].reset = await probeView(fixtureWindow.webContents, state, 'reset', {
        surfaceSelector: '.settings-reset-dialog',
        textSelector: '.settings-reset-dialog__body > strong',
        focusSelector: '.settings-reset-cancel',
      });
      await captureEvidence(fixtureWindow.webContents, evidenceDirectory, state, 'reset', evidenceFiles);
    }

    const trustedTabs = await fixtureWindow.webContents.executeJavaScript(
      'window.__slipstreamContrastTrustedTabs.slice()',
      true,
    );
    const proof = {
      success: true,
      rendererUrlExact: fixtureWindow.webContents.getURL() === rendererUrl,
      userDataIsFixture: app.getPath('userData') === userDataPath,
      userDataMode: modeBits(userDataPath),
      sessionDataIsNested: app.getPath('sessionData').startsWith(`${userDataPath}/`),
      sessionDataMode: modeBits(sessionDataPath),
      windowHidden: !fixtureWindow.isVisible(),
      contextIsolation: preferences.contextIsolation === true,
      nodeIntegrationDisabled: preferences.nodeIntegration === false,
      sandboxEnabled: preferences.sandbox === true,
      inheritedSecretsPresent,
      sessionTrapFetchBlocked,
      blockedRendererExternalRequests,
      blockedRendererExternalUrls,
      renderer,
      requestedMedia: mediaRequests,
      media,
      states,
      keyboardInput: {
        native: true,
        tabEvents: trustedTabs.length,
        allRendererEventsTrusted: trustedTabs.length > 0 && trustedTabs.every(Boolean),
      },
      evidence: {
        enabled: Boolean(evidenceDirectory),
        directory: evidenceDirectory,
        files: evidenceFiles,
      },
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
