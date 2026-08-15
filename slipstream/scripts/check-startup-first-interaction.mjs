import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const mainSource = fs.readFileSync(
  new URL('../src/main/main.js', import.meta.url),
  'utf8',
);
const setupSource = fs.readFileSync(
  new URL('../src/renderer/components/SetupGate.jsx', import.meta.url),
  'utf8',
);
const panelSource = fs.readFileSync(
  new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
));

const require = createRequire(import.meta.url);
const { Parser } = require('acorn');

const legacyQueuedRevealPattern = /if \(!uiFixtureMode\.enabled && !mainWindowInitialLoadReady\) \{[\s\S]*?mainWindowRevealRequested = true;[\s\S]*?return;/;
const legacyInitialLoadPattern = /webContents\.once\('did-finish-load',[\s\S]*?mainWindowInitialLoadReady = true;[\s\S]*?const shouldStartVisible = !store\.isStoreReady\(\)[\s\S]*?store\.getSettings\('startMinimized'\) !== true[\s\S]*?\|\| !tray;[\s\S]*?showMainWindow\(\)/;
const legacyProductionFailurePattern = /startupWindow\.loadFile\(indexPath\)\.catch\(\(\) => \{[\s\S]*?dialog\.showMessageBox\(\{[\s\S]*?title: 'Slipstream 无法启动'[\s\S]*?buttons: \['重新尝试', '退出 Slipstream'\][\s\S]*?cancelId: 1[\s\S]*?performConfirmedQuit\(\)/;

function visit(node, visitor, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, visitor, nextAncestors));
    else if (value?.type) visit(value, visitor, nextAncestors);
  }
}

function parseMainSource(source) {
  return Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
}

function findNamedFunction(source, name) {
  let match = null;
  let declaration = null;
  visit(parseMainSource(source), (node, ancestors) => {
    if (!match && node.type === 'FunctionDeclaration' && node.id?.name === name) {
      match = node;
      declaration = node;
    }
    if (
      !match
      && node.type === 'VariableDeclarator'
      && node.id?.name === name
      && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)
    ) {
      match = node.init;
      declaration = [...ancestors].reverse().find((ancestor) => (
        ancestor.type === 'VariableDeclaration'
      ));
    }
  });
  assert.ok(match, `production source must retain ${name}()`);
  assert.ok(declaration, `production source must retain the ${name} declaration`);
  return { node: match, source: source.slice(declaration.start, declaration.end) };
}

function findInitialLoadCallback(source) {
  let match = null;
  visit(parseMainSource(source), (node) => {
    if (
      !match
      && node.type === 'CallExpression'
      && node.callee?.type === 'MemberExpression'
      && node.callee.property?.name === 'once'
      && node.arguments?.[0]?.value === 'did-finish-load'
    ) match = node.arguments[1];
  });
  assert.ok(match, 'production source must retain its one-shot first-load listener');
  return source.slice(match.start, match.end);
}

function createMainWindowDouble() {
  const calls = { clear: 0, focus: 0, refresh: 0, restore: 0, show: 0 };
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    focus: () => { calls.focus += 1; },
    restore: () => { calls.restore += 1; },
    show: () => { calls.show += 1; },
  };
  return { calls, window };
}

function assertShowMainWindowQueuesUntilReady(source) {
  const { source: functionSource } = findNamedFunction(source, 'showMainWindow');
  const { calls, window } = createMainWindowDouble();
  const harness = new Function(
    'app',
    'mainWindow',
    'uiFixtureMode',
    'clearCompletedTaskPresentation',
    'refreshTrayPresentation',
    `
      let mainWindowInitialLoadReady = false;
      let mainWindowRevealRequested = false;
      ${functionSource}
      return {
        run: showMainWindow,
        revealRequested: () => mainWindowRevealRequested,
      };
    `,
  )(
    { isQuitting: false },
    window,
    { enabled: false },
    () => { calls.clear += 1; },
    () => { calls.refresh += 1; },
  );
  harness.run();
  assert.deepEqual(calls, { clear: 0, focus: 0, refresh: 0, restore: 0, show: 0 },
    'showMainWindow must not reveal or mutate a formal window before first load');
  assert.equal(harness.revealRequested(), true,
    'showMainWindow must retain the early user reveal intent');
}

function assertShortcutCaptureUsesQueuedStartupPath(source) {
  const { source: showSource } = findNamedFunction(source, 'showMainWindow');
  const { source: dispatchSource } = findNamedFunction(source, 'dispatchCaptureIngress');
  const { calls, window } = createMainWindowDouble();
  const dispatched = [];
  let sendCalls = 0;
  const app = { isQuitting: false };
  window.webContents = { id: 71 };
  const harness = new Function(
    'app',
    'mainWindow',
    'uiFixtureMode',
    'clearCompletedTaskPresentation',
    'refreshTrayPresentation',
    'createMainWindow',
    'getStartupSettings',
    'captureIngressRegistry',
    'deliverCaptureIngress',
    `
      let mainWindowInitialLoadReady = false;
      let mainWindowRevealRequested = false;
      let captureIngressSenderId = null;
      ${showSource}
      ${dispatchSource}
      return {
        run: dispatchCaptureIngress,
        revealRequested: () => mainWindowRevealRequested,
      };
    `,
  )(
    app,
    window,
    { enabled: false },
    () => { calls.clear += 1; },
    () => { calls.refresh += 1; },
    () => { throw new Error('existing startup window must be retained'); },
    () => ({}),
    {
      dispatch: (senderId, event) => {
        dispatched.push({ senderId, event });
        return { delivered: false, queued: true };
      },
    },
    () => {
      sendCalls += 1;
      return true;
    },
  );

  const event = {
    channel: 'screenshot:requested',
    payload: { source: 'shortcut' },
  };
  assert.deepEqual(harness.run(event), { delivered: false, queued: true });
  assert.deepEqual(dispatched, [{ senderId: 71, event }],
    'a cold-start shortcut must enter the bounded capture ingress registry');
  assert.deepEqual(calls, { clear: 0, focus: 0, refresh: 0, restore: 0, show: 0 },
    'a cold-start shortcut must not expose or focus the window before first load');
  assert.equal(sendCalls, 0,
    'a cold-start shortcut must not bypass the registry delivery boundary');
  assert.equal(harness.revealRequested(), true,
    'a shortcut must retain its readiness-aware reveal intent');

  const monitorEvent = {
    channel: 'clipboard:text-changed',
    payload: { text: 'passive monitor text', source: 'monitor' },
  };
  assert.deepEqual(harness.run(monitorEvent), { delivered: false, queued: true });
  assert.deepEqual(dispatched.at(-1), { senderId: 71, event: monitorEvent },
    'passive clipboard monitoring must use the same bounded ingress registry');
  assert.deepEqual(calls, { clear: 0, focus: 0, refresh: 0, restore: 0, show: 0 },
    'passive clipboard monitoring must never reveal or focus the app window');

  app.isQuitting = true;
  assert.equal(harness.run(event), false,
    'capture ingress must become a strict no-op after committed quit');
  assert.equal(dispatched.length, 2,
    'committed quit must not queue another capture event');
  assert.deepEqual(calls, { clear: 0, focus: 0, refresh: 0, restore: 0, show: 0 },
    'committed quit must not reveal or focus the app window');
}

function runInitialLoadCallback(source, {
  appQuitting = false,
  destroyed = false,
  revealRequested = false,
  startMinimized = true,
  storageReady = true,
  trayAvailable = true,
  windowStillOwned = true,
} = {}) {
  const callbackSource = findInitialLoadCallback(source);
  let showCalls = 0;
  const startupWindow = { isDestroyed: () => destroyed };
  const otherWindow = { isDestroyed: () => false };
  const harness = new Function(
    'app',
    'startupWindow',
    'mainWindow',
    'store',
    'tray',
    'showMainWindow',
    'initialRevealRequested',
    `
      let mainWindowInitialLoadReady = false;
      let mainWindowRevealRequested = initialRevealRequested;
      const callback = (${callbackSource});
      return {
        callback,
        initialLoadReady: () => mainWindowInitialLoadReady,
        revealRequested: () => mainWindowRevealRequested,
      };
    `,
  )(
    { isQuitting: appQuitting },
    startupWindow,
    windowStillOwned ? startupWindow : otherWindow,
    {
      isStoreReady: () => storageReady,
      getSettings: (key) => {
        assert.equal(key, 'startMinimized');
        return startMinimized;
      },
    },
    trayAvailable ? {} : null,
    () => { showCalls += 1; },
    revealRequested,
  );
  harness.callback();
  return {
    initialLoadReady: harness.initialLoadReady(),
    revealRequested: harness.revealRequested(),
    showCalls,
  };
}

function assertInitialLoadRevealPolicy(source) {
  assert.deepEqual(runInitialLoadCallback(source), {
    initialLoadReady: true,
    revealRequested: false,
    showCalls: 0,
  }, 'start-minimized must stay hidden after a successful first load when tray recovery exists');
  for (const scenario of [
    { startMinimized: false },
    { storageReady: false },
    { trayAvailable: false },
    { revealRequested: true },
  ]) {
    assert.equal(runInitialLoadCallback(source, scenario).showCalls, 1,
      'the production first-load callback must reveal every user-recovery startup case');
  }
  for (const scenario of [
    { appQuitting: true },
    { destroyed: true },
    { windowStillOwned: false },
  ]) {
    assert.equal(runInitialLoadCallback(source, scenario).showCalls, 0,
      'a stale or quitting first-load callback must never reveal a window');
  }
}

async function assertProductionRetryReloadsRenderer(source) {
  const { source: functionSource } = findNamedFunction(source, 'loadProductionRenderer');
  let loadCalls = 0;
  let quitCalls = 0;
  let clearCalls = 0;
  let resolveDialog = null;
  const startupWindow = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false },
    loadFile: () => {
      loadCalls += 1;
      if (loadCalls === 1) return Promise.reject(new Error('fixture load failure'));
      return new Promise(() => {});
    },
  };
  const harness = new Function(
    'app',
    'startupWindow',
    'indexPath',
    'settingsRequestRegistry',
    'rendererSenderId',
    'dialog',
    'performConfirmedQuit',
    `
      let rendererLoadFailureDialogOpen = false;
      ${functionSource}
      return { loadProductionRenderer };
    `,
  )(
    { isQuitting: false },
    startupWindow,
    '/Applications/Slipstream/dist/renderer/index.html',
    { clearSender: () => { clearCalls += 1; } },
    17,
    { showMessageBox: () => new Promise((resolve) => { resolveDialog = resolve; }) },
    () => { quitCalls += 1; },
  );
  harness.loadProductionRenderer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 1, 'production startup must attempt the packaged renderer once');
  assert.equal(typeof resolveDialog, 'function',
    'a rejected production load must transfer ownership to the native recovery dialog');
  resolveDialog({ response: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 2,
    'choosing Retry in the native startup dialog must call loadProductionRenderer again');
  assert.equal(quitCalls, 0, 'Retry must not quit the app');
  assert.equal(clearCalls, 2,
    'failed-load and retry boundaries must each clear stale renderer-owned Settings intent');
}

const unconditionalShowMutation = mainSource.replace(
  'function showMainWindow() {',
  'function showMainWindow() {\n  mainWindow.show();',
);
assert.notEqual(unconditionalShowMutation, mainSource);
assert.match(unconditionalShowMutation, legacyQueuedRevealPattern,
  'the legacy text gate must demonstrate its unconditional-show false pass');
assert.throws(
  () => assertShowMainWindowQueuesUntilReady(unconditionalShowMutation),
  /must not reveal or mutate/u,
  'the executable gate must reject an unconditional pre-load show mutation',
);

const unconditionalInitialLoadMutation = mainSource.replace(
  'if (revealWasRequested || shouldStartVisible) showMainWindow();',
  'showMainWindow();',
);
assert.notEqual(unconditionalInitialLoadMutation, mainSource);
assert.match(unconditionalInitialLoadMutation, legacyInitialLoadPattern,
  'the legacy text gate must demonstrate its unconditional first-load false pass');
assert.throws(
  () => assertInitialLoadRevealPolicy(unconditionalInitialLoadMutation),
  /start-minimized must stay hidden/u,
  'the executable gate must reject an unconditional first-load reveal mutation',
);

const missingRetryMutation = mainSource.replace(
  '            loadProductionRenderer();\n            return;',
  '            return;',
);
assert.notEqual(missingRetryMutation, mainSource);
assert.match(missingRetryMutation, legacyProductionFailurePattern,
  'the legacy text gate must demonstrate its missing-Retry-call false pass');
await assert.rejects(
  assertProductionRetryReloadsRenderer(missingRetryMutation),
  /must call loadProductionRenderer again/u,
  'the executable gate must reject a Retry branch that never reloads the renderer',
);

assertShowMainWindowQueuesUntilReady(mainSource);
assertShortcutCaptureUsesQueuedStartupPath(mainSource);
assertInitialLoadRevealPolicy(mainSource);
await assertProductionRetryReloadsRenderer(mainSource);

assert.match(
  mainSource,
  /show: uiFixtureMode\.enabled \? !uiFixtureCheckMode : false/,
  'formal BrowserWindows must not appear before their renderer is loaded',
);
assert.match(
  mainSource,
  legacyQueuedRevealPattern,
  'early user reveal intents must queue instead of exposing a blank window',
);
assert.match(
  mainSource,
  legacyInitialLoadPattern,
  'the first completed renderer load must be the single formal startup reveal gate',
);
assert.match(
  mainSource,
  legacyProductionFailurePattern,
  'a formal renderer load failure must offer a native retry-or-quit path',
);
assert.match(mainSource, /此处不会显示文件位置、设置内容或 API Key/,
  'the native failure copy must state its privacy-safe diagnostic boundary');
assert.doesNotMatch(
  mainSource,
  /message:\s*`[^`]*\$\{indexPath\}|detail:\s*`[^`]*\$\{indexPath\}/,
  'the native startup error must never interpolate the private installation path',
);

assert.match(setupSource, /const recommendedCtaRef = useRef\(null\)/);
assert.match(
  setupSource,
  /loading[\s\S]*?\|\| recoveryNotice[\s\S]*?recommendedCtaFocusClaimedRef\.current[\s\S]*?document\.querySelector\('\[aria-modal="true"\]'\)[\s\S]*?target\.focus\(\{ preventScroll: true \}\)/,
  'first-use focus must wait for validated settings and yield to recovery or a modal',
);
assert.match(setupSource, /ref=\{recommendedCtaRef\}[\s\S]*?className="setup-primary"/,
  'the deterministic first-use target must be the recommended CTA');

assert.match(panelSource, /const initialCaptureFocusPendingRef = useRef\(visible\)/,
  'only a panel that mounts visible may claim cold-start focus');
assert.match(
  panelSource,
  /initialCaptureFocusPendingRef\.current[\s\S]*?\|\| !visible[\s\S]*?\|\| setupIncomplete[\s\S]*?status !== STATUS\.IDLE[\s\S]*?\|\| hasForegroundFocusOwner[\s\S]*?document\.querySelector\('\[aria-modal="true"\]'\)[\s\S]*?focusAvailableElement\(target\)[\s\S]*?initialCaptureFocusPendingRef\.current = false/,
  'configured cold-start focus must yield to every foreground decision before focusing the source textarea',
);
assert.match(
  panelSource,
  /const wasVisible = previousVisibleRef\.current;[\s\S]*?if \(!visible\) \{[\s\S]*?settingsReturnFocusReadyRef\.current = false;[\s\S]*?if \(wasVisible === false\) settingsReturnFocusReadyRef\.current = true;[\s\S]*?const enteredAfterSetup = settingsReturnFocusReadyRef\.current[\s\S]*?const setupHandoff = !settingsDestination && !settingsElement/,
  'a real hidden-to-visible transition must arm the setup-to-capture focus handoff',
);
assert.match(
  panelSource,
  /if \(setupHandoff && \([\s\S]*?!taskSurfaceVisibleRef\.current[\s\S]*?statusRef\.current !== STATUS\.IDLE[\s\S]*?foregroundCaptureDecisionBlockingRef\.current[\s\S]*?\)\) return;[\s\S]*?destination === 'source'\) \{[\s\S]*?focusTransferred = focusAvailableElement\(textareaRef\.current\);[\s\S]*?if \(focusTransferred\) \{[\s\S]*?settingsReturnFocusReadyRef\.current = false/,
  'the setup handoff must wait for the idle task surface and clear only after source focus lands',
);

assert.equal(
  packageJson.scripts['check:startup-first-interaction'],
  'node scripts/check-startup-first-interaction.mjs',
  'package scripts must expose the focused startup interaction gate',
);
assert.match(
  packageJson.scripts.test,
  /check:startup-first-interaction/,
  'the startup first-interaction gate must stay in the full offline suite',
);
assert.equal(
  packageJson.scripts['check:capture-ingress-readiness'],
  'node scripts/check-capture-ingress-readiness.mjs',
  'package scripts must expose the capture ingress readiness gate',
);
assert.match(
  packageJson.scripts.test,
  /check:capture-ingress-readiness/,
  'the capture ingress readiness gate must stay in the full offline suite',
);

console.log('Startup first-interaction checks passed.');
