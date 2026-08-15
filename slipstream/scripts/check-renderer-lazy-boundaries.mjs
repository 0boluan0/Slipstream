import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRetryableLazyImport,
  isLazyWorkspaceLoadError,
} from '../src/renderer/utils/retryableLazyImport.mjs';
import {
  buildResultStylesheetAttemptUrl,
  getResultStylesheetAttempt,
  loadResultWorkspaceStylesheet,
} from '../src/renderer/components/resultWorkspaceStylesheet.mjs';
import {
  buildSettingsStylesheetAttemptUrl,
  getSettingsStylesheetAttempt,
  loadSettingsWorkspaceStylesheet,
} from '../src/renderer/components/settingsWorkspaceStylesheet.mjs';
import {
  buildSavedTermsStylesheetAttemptUrl,
  getSavedTermsStylesheetAttempt,
  loadSavedTermsWorkspaceStylesheet,
} from '../src/renderer/components/savedTermsWorkspaceStylesheet.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRenderer = (relativePath) => fs.readFileSync(
  path.join(root, 'src/renderer', relativePath),
  'utf8',
);

const appSource = readRenderer('App.jsx');
const indexSource = readRenderer('index.jsx');
const panelSource = readRenderer('components/FloatingPanel.jsx');
const resultSource = readRenderer('components/ResultDisplay.jsx');
const resultStylesheetSource = readRenderer('components/resultWorkspaceStylesheet.mjs');
const resultCssSource = readRenderer('components/ResultDisplay.css');
const settingsSource = readRenderer('components/SettingsPanel.jsx');
const settingsStylesheetSource = readRenderer('components/settingsWorkspaceStylesheet.mjs');
const settingsCssSource = readRenderer('components/SettingsPanel.css');
const savedTermsSource = readRenderer('components/SavedTermsLibrary.jsx');
const savedTermsStylesheetSource = readRenderer(
  'components/savedTermsWorkspaceStylesheet.mjs',
);
const savedTermsCssSource = readRenderer('components/SavedTermsLibrary.css');
const noticeSource = readRenderer('components/ClipboardActionNotice.jsx');
const recoverySource = readRenderer('components/LazyWorkspaceRecovery.jsx');
const cssSource = readRenderer('App.css');
const retryResourceSource = readRenderer('utils/retryableLazyImport.mjs');
const viteConfigPath = path.join(root, 'vite.config.js');
const viteConfigSource = fs.readFileSync(viteConfigPath, 'utf8');
const require = createRequire(import.meta.url);
const { Parser } = require('acorn');
const jsx = require('acorn-jsx');
const RendererParser = Parser.extend(jsx());

const legacySettingsWorkspaceWaitPattern = /function waitForSettingsWorkspaceStyles\(moduleLoader\)[\s\S]*?settingsModule\.settingsWorkspaceStylesheetReady[\s\S]*?then\(\(\) => settingsModule\)/;
const legacySavedTermsWorkspaceWaitPattern = /function waitForSavedTermsWorkspaceStyles\(moduleLoader\)[\s\S]*?savedTermsModule\.savedTermsWorkspaceStylesheetReady[\s\S]*?then\(\(\) => savedTermsModule\)/;

function visit(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, visitor));
    else if (value?.type) visit(value, visitor);
  }
}

function findNamedRendererFunction(source, name) {
  const tree = RendererParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let match = null;
  visit(tree, (node) => {
    if (!match && node.type === 'FunctionDeclaration' && node.id?.name === name) match = node;
  });
  assert.ok(match, `renderer source must retain ${name}()`);
  return match;
}

function removeWorkspaceWaitReturn(source, name) {
  const functionNode = findNamedRendererFunction(source, name);
  const returnNode = functionNode.body.body.find((statement) => statement.type === 'ReturnStatement');
  assert.ok(returnNode?.argument, `${name} must expose a top-level return for the mutation test`);
  return `${source.slice(0, returnNode.start)}${source.slice(returnNode.argument.start)}`;
}

async function assertWorkspaceWaitsForStylesheet(source, {
  functionName,
  readyProperty,
  workspaceName,
}) {
  const functionNode = findNamedRendererFunction(source, functionName);
  const functionSource = source.slice(functionNode.start, functionNode.end);
  const waitForWorkspaceStyles = new Function(`return (${functionSource});`)();
  let resolveStylesheet;
  let loaderCalls = 0;
  const stylesheetReady = new Promise((resolve) => { resolveStylesheet = resolve; });
  const workspaceModule = {
    default: `${workspaceName}Component`,
    [readyProperty]: stylesheetReady,
  };
  const attempt = waitForWorkspaceStyles(() => {
    loaderCalls += 1;
    return Promise.resolve(workspaceModule);
  });
  assert.ok(attempt && typeof attempt.then === 'function',
    `${workspaceName} workspace wait helper must return the React.lazy thenable`);
  assert.equal(loaderCalls, 1,
    `${workspaceName} workspace wait helper must start exactly one module attempt`);
  let settlement = 'pending';
  void attempt.then(() => { settlement = 'fulfilled'; }, () => { settlement = 'rejected'; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settlement, 'pending',
    `${workspaceName} React.lazy attempt must remain pending until its stylesheet settles`);
  resolveStylesheet();
  assert.equal(await attempt, workspaceModule,
    `${workspaceName} React.lazy attempt must resolve to the loaded module after CSS is ready`);
}

const settingsMissingReturnMutation = removeWorkspaceWaitReturn(
  appSource,
  'waitForSettingsWorkspaceStyles',
);
assert.match(settingsMissingReturnMutation, legacySettingsWorkspaceWaitPattern,
  'the legacy Settings text gate must demonstrate its missing-return false pass');
await assert.rejects(
  assertWorkspaceWaitsForStylesheet(settingsMissingReturnMutation, {
    functionName: 'waitForSettingsWorkspaceStyles',
    readyProperty: 'settingsWorkspaceStylesheetReady',
    workspaceName: 'Settings',
  }),
  /must return the React\.lazy thenable/u,
  'the integration gate must reject a Settings wait helper that drops its return',
);

const savedTermsMissingReturnMutation = removeWorkspaceWaitReturn(
  panelSource,
  'waitForSavedTermsWorkspaceStyles',
);
assert.match(savedTermsMissingReturnMutation, legacySavedTermsWorkspaceWaitPattern,
  'the legacy Saved Terms text gate must demonstrate its missing-return false pass');
await assert.rejects(
  assertWorkspaceWaitsForStylesheet(savedTermsMissingReturnMutation, {
    functionName: 'waitForSavedTermsWorkspaceStyles',
    readyProperty: 'savedTermsWorkspaceStylesheetReady',
    workspaceName: 'Saved Terms',
  }),
  /must return the React\.lazy thenable/u,
  'the integration gate must reject a Saved Terms wait helper that drops its return',
);

await assertWorkspaceWaitsForStylesheet(appSource, {
  functionName: 'waitForSettingsWorkspaceStyles',
  readyProperty: 'settingsWorkspaceStylesheetReady',
  workspaceName: 'Settings',
});
await assertWorkspaceWaitsForStylesheet(panelSource, {
  functionName: 'waitForSavedTermsWorkspaceStyles',
  readyProperty: 'savedTermsWorkspaceStylesheetReady',
  workspaceName: 'Saved Terms',
});

let primaryLoaderCalls = 0;
let alternateLoaderCalls = 0;
const retryableResource = createRetryableLazyImport([
  async () => {
    primaryLoaderCalls += 1;
    throw new Error('primary import failure');
  },
  async () => {
    alternateLoaderCalls += 1;
    return { default: 'recovered' };
  },
]);
const primaryAttempt = retryableResource.load();
assert.equal(retryableResource.load(), primaryAttempt,
  'preload and render must observe the same cached module attempt');
await assert.rejects(primaryAttempt, (error) => (
  isLazyWorkspaceLoadError(error)
  && error.cause?.message === 'primary import failure'
));
assert.equal(primaryLoaderCalls, 1);
assert.equal(retryableResource.canRetry(), true);
assert.equal(retryableResource.reset(), true,
  'one explicit retry must advance to the independent loader');
const alternateAttempt = retryableResource.load();
assert.deepEqual(await alternateAttempt, { default: 'recovered' });
assert.equal(alternateLoaderCalls, 1);
assert.equal(retryableResource.canRetry(), false,
  'the loader set must be finite rather than creating unbounded module identities');
assert.equal(retryableResource.reset(), false,
  'an exhausted loader must not cycle back to a cached failed URL');
assert.equal(retryableResource.load(), alternateAttempt,
  'an exhausted loader must retain its settled alternate attempt');

assert.equal(getResultStylesheetAttempt('file:///Applications/Slipstream/ResultDisplay.js'), 0);
assert.equal(getResultStylesheetAttempt(
  'file:///Applications/Slipstream/ResultDisplay.js?workspace-attempt=1',
), 1);
assert.throws(
  () => getResultStylesheetAttempt(
    'file:///Applications/Slipstream/ResultDisplay.js?workspace-attempt=2',
  ),
  /bounded Result stylesheet attempt/u,
  'Result stylesheet attempts must be restricted to the primary and one retry',
);
const primaryResultStylesheetUrl = new URL(buildResultStylesheetAttemptUrl(
  './ResultDisplay.css',
  0,
  'file:///Applications/Slipstream/index.html',
));
const retryResultStylesheetUrl = new URL(buildResultStylesheetAttemptUrl(
  './ResultDisplay.css',
  1,
  'file:///Applications/Slipstream/index.html',
));
assert.equal(primaryResultStylesheetUrl.search, '',
  'the primary Result stylesheet must retain its ordinary URL');
assert.equal(retryResultStylesheetUrl.search, '?workspace-attempt=1',
  'the Result stylesheet retry must use one bounded distinct URL');
assert.equal(primaryResultStylesheetUrl.pathname, retryResultStylesheetUrl.pathname,
  'primary and retry must target the same packaged stylesheet file');
assert.throws(
  () => buildResultStylesheetAttemptUrl(
    'https://example.invalid/ResultDisplay.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Result stylesheet loader must reject an external resource boundary',
);
assert.throws(
  () => buildResultStylesheetAttemptUrl(
    'file:///tmp/untrusted/ResultDisplay.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Result stylesheet loader must reject another local file boundary',
);

function createStylesheetLoaderHarness() {
  const links = [];
  const timers = new Map();
  let nextTimerId = 1;
  const head = {
    append(link) {
      link.isConnected = true;
      links.push(link);
    },
    querySelectorAll(selector) {
      const workspace = selector.match(/data-workspace-stylesheet="([^"]+)"/u)?.[1];
      return links.filter((link) => (
        link.isConnected && link.dataset.workspaceStylesheet === workspace
      ));
    },
  };
  const defaultView = {
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    setTimeout(callback) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
  };
  const documentRef = {
    baseURI: 'file:///Applications/Slipstream/index.html',
    defaultView,
    head,
    createElement(tagName) {
      assert.equal(tagName, 'link');
      return {
        dataset: {},
        href: '',
        isConnected: false,
        onerror: null,
        onload: null,
        rel: '',
        remove() {
          this.isConnected = false;
        },
      };
    },
  };
  return {
    activeLinks: (workspace = 'result') => head.querySelectorAll(
      `link[data-workspace-stylesheet="${workspace}"]`,
    ),
    documentRef,
    pendingTimerCount: () => timers.size,
    runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

const loadedHarness = createStylesheetLoaderHarness();
const pendingStylesheet = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
assert.equal(loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
}), pendingStylesheet,
  'the exact pending Result stylesheet attempt must be shared');
assert.equal(loadedHarness.activeLinks().length, 1);
loadedHarness.activeLinks()[0].onload();
const loadedStylesheet = await pendingStylesheet;
assert.equal(loadedStylesheet.dataset.workspaceLoaded, 'true');
assert.equal(loadedHarness.pendingTimerCount(), 0,
  'a settled Result stylesheet must clear its timeout');
assert.equal(await loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
}), loadedStylesheet,
  'an exact loaded Result stylesheet must be reused without another link');
assert.equal(loadedHarness.activeLinks().length, 1);

const failedHarness = createStylesheetLoaderHarness();
const failedStylesheet = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: failedHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
failedHarness.activeLinks()[0].onerror();
await assert.rejects(failedStylesheet, /failed to load/u);
assert.equal(failedHarness.activeLinks().length, 0,
  'a failed Result stylesheet link must be removed before recovery');
assert.equal(failedHarness.pendingTimerCount(), 0);

const timeoutHarness = createStylesheetLoaderHarness();
const timedOutStylesheet = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: timeoutHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
const timeoutRejection = assert.rejects(timedOutStylesheet, /load timed out/u);
timeoutHarness.runTimers();
await timeoutRejection;
assert.equal(timeoutHarness.activeLinks().length, 0,
  'a never-settling Result stylesheet must time out and remove its link');

const supersededHarness = createStylesheetLoaderHarness();
const supersededPrimary = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: supersededHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
const primaryLink = supersededHarness.activeLinks()[0];
const stalePrimaryOnload = primaryLink.onload;
const supersededRejection = assert.rejects(supersededPrimary, /superseded/u);
const ownedRetry = loadResultWorkspaceStylesheet({
  attempt: 1,
  documentRef: supersededHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
await supersededRejection;
assert.equal(primaryLink.isConnected, false);
assert.equal(supersededHarness.activeLinks().length, 1);
const retryLink = supersededHarness.activeLinks()[0];
assert.equal(retryLink.dataset.workspaceAttempt, '1');
stalePrimaryOnload();
assert.equal(retryLink.dataset.workspaceLoaded, 'false',
  'a stale primary onload callback must not settle the owned retry');
retryLink.onload();
assert.equal(await ownedRetry, retryLink);
assert.equal(retryLink.dataset.workspaceLoaded, 'true');
assert.equal(supersededHarness.activeLinks().length, 1,
  'supersession must leave exactly one loaded retry link');

const isolatedResultDocumentA = createStylesheetLoaderHarness();
const isolatedResultDocumentB = createStylesheetLoaderHarness();
const isolatedResultAttemptA = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedResultDocumentA.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
const isolatedResultAttemptB = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedResultDocumentB.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
assert.notEqual(isolatedResultAttemptA, isolatedResultAttemptB,
  'separate renderer documents must not share a Result stylesheet promise');
assert.equal(isolatedResultDocumentA.activeLinks().length, 1);
assert.equal(isolatedResultDocumentB.activeLinks().length, 1);
const isolatedResultLinkA = isolatedResultDocumentA.activeLinks()[0];
const isolatedResultLinkB = isolatedResultDocumentB.activeLinks()[0];
isolatedResultLinkA.onload();
isolatedResultLinkB.onload();
assert.equal(await isolatedResultAttemptA, isolatedResultLinkA);
assert.equal(await isolatedResultAttemptB, isolatedResultLinkB);

const exactResultHrefHarness = createStylesheetLoaderHarness();
const supersededResultHref = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactResultHrefHarness.documentRef,
  href: './ResultDisplay.css?workspace-load=first',
  timeoutMs: 25,
});
const supersededResultHrefRejection = assert.rejects(
  supersededResultHref,
  /superseded/u,
);
const exactResultHrefAttempt = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactResultHrefHarness.documentRef,
  href: './ResultDisplay.css?workspace-load=second',
  timeoutMs: 25,
});
await supersededResultHrefRejection;
assert.equal(exactResultHrefHarness.activeLinks().length, 1,
  'same-attempt Result requests with distinct hrefs must not share ownership');
assert.equal(
  new URL(exactResultHrefHarness.activeLinks()[0].href).searchParams.get('workspace-load'),
  'second',
);
exactResultHrefHarness.activeLinks()[0].onload();
await exactResultHrefAttempt;

assert.equal(getSettingsStylesheetAttempt('file:///Applications/Slipstream/SettingsPanel.js'), 0);
assert.equal(getSettingsStylesheetAttempt(
  'file:///Applications/Slipstream/SettingsPanel.js?workspace-attempt=1',
), 1);
assert.throws(
  () => getSettingsStylesheetAttempt(
    'file:///Applications/Slipstream/SettingsPanel.js?workspace-attempt=2',
  ),
  /bounded Settings stylesheet attempt/u,
  'Settings stylesheet attempts must be restricted to the primary and one retry',
);
const primarySettingsStylesheetUrl = new URL(buildSettingsStylesheetAttemptUrl(
  './SettingsPanel.css',
  0,
  'file:///Applications/Slipstream/index.html',
));
const retrySettingsStylesheetUrl = new URL(buildSettingsStylesheetAttemptUrl(
  './SettingsPanel.css',
  1,
  'file:///Applications/Slipstream/index.html',
));
assert.equal(primarySettingsStylesheetUrl.search, '',
  'the primary Settings stylesheet must retain its ordinary URL');
assert.equal(retrySettingsStylesheetUrl.search, '?workspace-attempt=1',
  'the Settings stylesheet retry must use one bounded distinct URL');
assert.equal(primarySettingsStylesheetUrl.pathname, retrySettingsStylesheetUrl.pathname,
  'primary and retry must target the same packaged Settings stylesheet file');
assert.throws(
  () => buildSettingsStylesheetAttemptUrl(
    'https://example.invalid/SettingsPanel.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Settings stylesheet loader must reject an external resource boundary',
);
assert.throws(
  () => buildSettingsStylesheetAttemptUrl(
    'file:///tmp/untrusted/SettingsPanel.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Settings stylesheet loader must reject another local file boundary',
);

const loadedSettingsHarness = createStylesheetLoaderHarness();
const pendingSettingsStylesheet = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
assert.equal(loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
}), pendingSettingsStylesheet,
  'the exact pending Settings stylesheet attempt must be shared');
assert.equal(loadedSettingsHarness.activeLinks('settings').length, 1);
loadedSettingsHarness.activeLinks('settings')[0].onload();
const loadedSettingsStylesheet = await pendingSettingsStylesheet;
assert.equal(loadedSettingsStylesheet.dataset.workspaceLoaded, 'true');
assert.equal(loadedSettingsHarness.pendingTimerCount(), 0,
  'a settled Settings stylesheet must clear its timeout');
assert.equal(await loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
}), loadedSettingsStylesheet,
  'an exact loaded Settings stylesheet must be reused without another link');
assert.equal(loadedSettingsHarness.activeLinks('settings').length, 1);

const failedSettingsHarness = createStylesheetLoaderHarness();
const failedSettingsStylesheet = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: failedSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
failedSettingsHarness.activeLinks('settings')[0].onerror();
await assert.rejects(failedSettingsStylesheet, /failed to load/u);
assert.equal(failedSettingsHarness.activeLinks('settings').length, 0,
  'a failed Settings stylesheet link must be removed before recovery');
assert.equal(failedSettingsHarness.pendingTimerCount(), 0);

const timeoutSettingsHarness = createStylesheetLoaderHarness();
const timedOutSettingsStylesheet = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: timeoutSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
const settingsTimeoutRejection = assert.rejects(
  timedOutSettingsStylesheet,
  /load timed out/u,
);
timeoutSettingsHarness.runTimers();
await settingsTimeoutRejection;
assert.equal(timeoutSettingsHarness.activeLinks('settings').length, 0,
  'a never-settling Settings stylesheet must time out and remove its link');

const supersededSettingsHarness = createStylesheetLoaderHarness();
const supersededSettingsPrimary = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: supersededSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
const settingsPrimaryLink = supersededSettingsHarness.activeLinks('settings')[0];
const staleSettingsPrimaryOnload = settingsPrimaryLink.onload;
const settingsSupersededRejection = assert.rejects(
  supersededSettingsPrimary,
  /superseded/u,
);
const ownedSettingsRetry = loadSettingsWorkspaceStylesheet({
  attempt: 1,
  documentRef: supersededSettingsHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
await settingsSupersededRejection;
assert.equal(settingsPrimaryLink.isConnected, false);
assert.equal(supersededSettingsHarness.activeLinks('settings').length, 1);
const settingsRetryLink = supersededSettingsHarness.activeLinks('settings')[0];
assert.equal(settingsRetryLink.dataset.workspaceAttempt, '1');
staleSettingsPrimaryOnload();
assert.equal(settingsRetryLink.dataset.workspaceLoaded, 'false',
  'a stale Settings primary onload callback must not settle the owned retry');
settingsRetryLink.onload();
assert.equal(await ownedSettingsRetry, settingsRetryLink);
assert.equal(settingsRetryLink.dataset.workspaceLoaded, 'true');

const isolatedSettingsDocumentA = createStylesheetLoaderHarness();
const isolatedSettingsDocumentB = createStylesheetLoaderHarness();
const isolatedSettingsAttemptA = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedSettingsDocumentA.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
const isolatedSettingsAttemptB = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedSettingsDocumentB.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
assert.notEqual(isolatedSettingsAttemptA, isolatedSettingsAttemptB,
  'separate renderer documents must not share a Settings stylesheet promise');
assert.equal(isolatedSettingsDocumentA.activeLinks('settings').length, 1);
assert.equal(isolatedSettingsDocumentB.activeLinks('settings').length, 1);
const isolatedSettingsLinkA = isolatedSettingsDocumentA.activeLinks('settings')[0];
const isolatedSettingsLinkB = isolatedSettingsDocumentB.activeLinks('settings')[0];
isolatedSettingsLinkA.onload();
isolatedSettingsLinkB.onload();
assert.equal(await isolatedSettingsAttemptA, isolatedSettingsLinkA);
assert.equal(await isolatedSettingsAttemptB, isolatedSettingsLinkB);

const exactSettingsHrefHarness = createStylesheetLoaderHarness();
const supersededSettingsHref = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactSettingsHrefHarness.documentRef,
  href: './SettingsPanel.css?workspace-load=first',
  timeoutMs: 25,
});
const supersededSettingsHrefRejection = assert.rejects(
  supersededSettingsHref,
  /superseded/u,
);
const exactSettingsHrefAttempt = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactSettingsHrefHarness.documentRef,
  href: './SettingsPanel.css?workspace-load=second',
  timeoutMs: 25,
});
await supersededSettingsHrefRejection;
assert.equal(exactSettingsHrefHarness.activeLinks('settings').length, 1,
  'same-attempt Settings requests with distinct hrefs must not share ownership');
assert.equal(
  new URL(exactSettingsHrefHarness.activeLinks('settings')[0].href)
    .searchParams.get('workspace-load'),
  'second',
);
exactSettingsHrefHarness.activeLinks('settings')[0].onload();
await exactSettingsHrefAttempt;

assert.equal(getSavedTermsStylesheetAttempt(
  'file:///Applications/Slipstream/SavedTermsLibrary.js',
), 0);
assert.equal(getSavedTermsStylesheetAttempt(
  'file:///Applications/Slipstream/SavedTermsLibrary.js?workspace-attempt=1',
), 1);
assert.throws(
  () => getSavedTermsStylesheetAttempt(
    'file:///Applications/Slipstream/SavedTermsLibrary.js?workspace-attempt=2',
  ),
  /bounded Saved Terms stylesheet attempt/u,
  'Saved Terms stylesheet attempts must be restricted to the primary and one retry',
);
const primarySavedTermsStylesheetUrl = new URL(buildSavedTermsStylesheetAttemptUrl(
  './SavedTermsLibrary.css',
  0,
  'file:///Applications/Slipstream/index.html',
));
const retrySavedTermsStylesheetUrl = new URL(buildSavedTermsStylesheetAttemptUrl(
  './SavedTermsLibrary.css',
  1,
  'file:///Applications/Slipstream/index.html',
));
assert.equal(primarySavedTermsStylesheetUrl.search, '',
  'the primary Saved Terms stylesheet must retain its ordinary URL');
assert.equal(retrySavedTermsStylesheetUrl.search, '?workspace-attempt=1',
  'the Saved Terms stylesheet retry must use one bounded distinct URL');
assert.equal(primarySavedTermsStylesheetUrl.pathname, retrySavedTermsStylesheetUrl.pathname,
  'primary and retry must target the same packaged Saved Terms stylesheet file');
assert.throws(
  () => buildSavedTermsStylesheetAttemptUrl(
    'https://example.invalid/SavedTermsLibrary.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Saved Terms stylesheet loader must reject an external resource boundary',
);
assert.throws(
  () => buildSavedTermsStylesheetAttemptUrl(
    'file:///tmp/untrusted/SavedTermsLibrary.css',
    0,
    'file:///Applications/Slipstream/index.html',
  ),
  /renderer boundary/u,
  'the Saved Terms stylesheet loader must reject another local file boundary',
);

const loadedSavedTermsHarness = createStylesheetLoaderHarness();
const pendingSavedTermsStylesheet = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
assert.equal(loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
}), pendingSavedTermsStylesheet,
  'the exact pending Saved Terms stylesheet attempt must be shared');
assert.equal(loadedSavedTermsHarness.activeLinks('saved-terms').length, 1);
loadedSavedTermsHarness.activeLinks('saved-terms')[0].onload();
const loadedSavedTermsStylesheet = await pendingSavedTermsStylesheet;
assert.equal(loadedSavedTermsStylesheet.dataset.workspaceLoaded, 'true');
assert.equal(loadedSavedTermsHarness.pendingTimerCount(), 0,
  'a settled Saved Terms stylesheet must clear its timeout');
assert.equal(await loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: loadedSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
}), loadedSavedTermsStylesheet,
  'an exact loaded Saved Terms stylesheet must be reused without another link');
assert.equal(loadedSavedTermsHarness.activeLinks('saved-terms').length, 1);

const failedSavedTermsHarness = createStylesheetLoaderHarness();
const failedSavedTermsStylesheet = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: failedSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
failedSavedTermsHarness.activeLinks('saved-terms')[0].onerror();
await assert.rejects(failedSavedTermsStylesheet, /failed to load/u);
assert.equal(failedSavedTermsHarness.activeLinks('saved-terms').length, 0,
  'a failed Saved Terms stylesheet link must be removed before recovery');
assert.equal(failedSavedTermsHarness.pendingTimerCount(), 0);

const timeoutSavedTermsHarness = createStylesheetLoaderHarness();
const timedOutSavedTermsStylesheet = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: timeoutSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
const savedTermsTimeoutRejection = assert.rejects(
  timedOutSavedTermsStylesheet,
  /load timed out/u,
);
timeoutSavedTermsHarness.runTimers();
await savedTermsTimeoutRejection;
assert.equal(timeoutSavedTermsHarness.activeLinks('saved-terms').length, 0,
  'a never-settling Saved Terms stylesheet must time out and remove its link');

const supersededSavedTermsHarness = createStylesheetLoaderHarness();
const supersededSavedTermsPrimary = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: supersededSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
const savedTermsPrimaryLink = supersededSavedTermsHarness.activeLinks('saved-terms')[0];
const staleSavedTermsPrimaryOnload = savedTermsPrimaryLink.onload;
const savedTermsSupersededRejection = assert.rejects(
  supersededSavedTermsPrimary,
  /superseded/u,
);
const ownedSavedTermsRetry = loadSavedTermsWorkspaceStylesheet({
  attempt: 1,
  documentRef: supersededSavedTermsHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
await savedTermsSupersededRejection;
assert.equal(savedTermsPrimaryLink.isConnected, false);
assert.equal(supersededSavedTermsHarness.activeLinks('saved-terms').length, 1);
const savedTermsRetryLink = supersededSavedTermsHarness.activeLinks('saved-terms')[0];
assert.equal(savedTermsRetryLink.dataset.workspaceAttempt, '1');
staleSavedTermsPrimaryOnload();
assert.equal(savedTermsRetryLink.dataset.workspaceLoaded, 'false',
  'a stale Saved Terms primary onload callback must not settle the owned retry');
savedTermsRetryLink.onload();
assert.equal(await ownedSavedTermsRetry, savedTermsRetryLink);
assert.equal(savedTermsRetryLink.dataset.workspaceLoaded, 'true');

const isolatedSavedTermsDocumentA = createStylesheetLoaderHarness();
const isolatedSavedTermsDocumentB = createStylesheetLoaderHarness();
const isolatedSavedTermsAttemptA = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedSavedTermsDocumentA.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
const isolatedSavedTermsAttemptB = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: isolatedSavedTermsDocumentB.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
assert.notEqual(isolatedSavedTermsAttemptA, isolatedSavedTermsAttemptB,
  'separate renderer documents must not share a Saved Terms stylesheet promise');
assert.equal(isolatedSavedTermsDocumentA.activeLinks('saved-terms').length, 1);
assert.equal(isolatedSavedTermsDocumentB.activeLinks('saved-terms').length, 1);
const isolatedSavedTermsLinkA = isolatedSavedTermsDocumentA.activeLinks('saved-terms')[0];
const isolatedSavedTermsLinkB = isolatedSavedTermsDocumentB.activeLinks('saved-terms')[0];
isolatedSavedTermsLinkA.onload();
isolatedSavedTermsLinkB.onload();
assert.equal(await isolatedSavedTermsAttemptA, isolatedSavedTermsLinkA);
assert.equal(await isolatedSavedTermsAttemptB, isolatedSavedTermsLinkB);

const exactSavedTermsHrefHarness = createStylesheetLoaderHarness();
const supersededSavedTermsHref = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactSavedTermsHrefHarness.documentRef,
  href: './SavedTermsLibrary.css?workspace-load=first',
  timeoutMs: 25,
});
const supersededSavedTermsHrefRejection = assert.rejects(
  supersededSavedTermsHref,
  /superseded/u,
);
const exactSavedTermsHrefAttempt = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: exactSavedTermsHrefHarness.documentRef,
  href: './SavedTermsLibrary.css?workspace-load=second',
  timeoutMs: 25,
});
await supersededSavedTermsHrefRejection;
assert.equal(exactSavedTermsHrefHarness.activeLinks('saved-terms').length, 1,
  'same-attempt Saved Terms requests with distinct hrefs must not share ownership');
assert.equal(
  new URL(exactSavedTermsHrefHarness.activeLinks('saved-terms')[0].href)
    .searchParams.get('workspace-load'),
  'second',
);
exactSavedTermsHrefHarness.activeLinks('saved-terms')[0].onload();
await exactSavedTermsHrefAttempt;

const coexistingStylesheetHarness = createStylesheetLoaderHarness();
const coexistingResult = loadResultWorkspaceStylesheet({
  attempt: 0,
  documentRef: coexistingStylesheetHarness.documentRef,
  href: './ResultDisplay.css',
  timeoutMs: 25,
});
const coexistingSettings = loadSettingsWorkspaceStylesheet({
  attempt: 0,
  documentRef: coexistingStylesheetHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
const coexistingSavedTerms = loadSavedTermsWorkspaceStylesheet({
  attempt: 0,
  documentRef: coexistingStylesheetHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
assert.equal(coexistingStylesheetHarness.activeLinks('result').length, 1);
assert.equal(coexistingStylesheetHarness.activeLinks('settings').length, 1);
assert.equal(coexistingStylesheetHarness.activeLinks('saved-terms').length, 1);
coexistingStylesheetHarness.activeLinks('result')[0].onload();
coexistingStylesheetHarness.activeLinks('settings')[0].onload();
coexistingStylesheetHarness.activeLinks('saved-terms')[0].onload();
const coexistingResultLink = await coexistingResult;
await coexistingSettings;
await coexistingSavedTerms;
const coexistingSavedTermsRetry = loadSavedTermsWorkspaceStylesheet({
  attempt: 1,
  documentRef: coexistingStylesheetHarness.documentRef,
  href: './SavedTermsLibrary.css',
  timeoutMs: 25,
});
assert.equal(coexistingStylesheetHarness.activeLinks('result')[0], coexistingResultLink,
  'a Saved Terms retry must not remove the loaded Result stylesheet');
assert.equal(coexistingStylesheetHarness.activeLinks('settings').length, 1,
  'a Saved Terms retry must not remove the loaded Settings stylesheet');
assert.equal(coexistingStylesheetHarness.activeLinks('saved-terms').length, 1,
  'a Saved Terms retry must own exactly one Saved Terms link');
coexistingStylesheetHarness.activeLinks('saved-terms')[0].onload();
const coexistingSavedTermsRetryLink = await coexistingSavedTermsRetry;
const coexistingSettingsRetry = loadSettingsWorkspaceStylesheet({
  attempt: 1,
  documentRef: coexistingStylesheetHarness.documentRef,
  href: './SettingsPanel.css',
  timeoutMs: 25,
});
assert.equal(coexistingStylesheetHarness.activeLinks('result')[0], coexistingResultLink,
  'a Settings retry must not remove the loaded Result stylesheet');
assert.equal(
  coexistingStylesheetHarness.activeLinks('saved-terms')[0],
  coexistingSavedTermsRetryLink,
  'a Settings retry must not remove the loaded Saved Terms stylesheet',
);
assert.equal(coexistingStylesheetHarness.activeLinks('settings').length, 1,
  'a Settings retry must own exactly one Settings link');
coexistingStylesheetHarness.activeLinks('settings')[0].onload();
await coexistingSettingsRetry;
assert.equal(coexistingStylesheetHarness.activeLinks('result').length, 1);
assert.equal(coexistingStylesheetHarness.activeLinks('settings').length, 1,
  'the Settings stylesheet namespace must coexist after recovery');
assert.equal(coexistingStylesheetHarness.activeLinks('saved-terms').length, 1,
  'the three workspace stylesheet namespaces must coexist after recovery');

assert.doesNotMatch(appSource, /^import SettingsPanel from/m,
  'SettingsPanel must stay outside the renderer entry graph');
assert.doesNotMatch(appSource, /import\(['"]\.\/utils\/fullDataReset\.mjs['"]\)|from ['"]\.\/utils\/fullDataReset\.mjs['"]/,
  'the reset transaction must stay inside the retryable Settings workspace');
assert.match(settingsSource,
  /import \{ runFullDataReset \} from ['"]\.\.\/utils\/fullDataReset\.mjs['"][\s\S]*?resetTransaction: runFullDataReset/,
  'Settings must load and inject the reset transaction before destructive confirmation');
assert.match(appSource,
  /if \(clipboardOperationRef\.current\)[\s\S]*?typeof resetTransaction !== 'function'[\s\S]*?resetTransaction\(\{/,
  'App must preserve clipboard priority, fail closed on a missing runner, and then orchestrate reset');
assert.match(appSource,
  /SettingsPanel\?workspace-load=settings-fixture-primary[\s\S]*?SettingsPanel\?workspace-load=settings-style-fixture-primary[\s\S]*?SettingsPanel\?workspace-load=settings-style-retry&workspace-attempt=1/,
  'the Settings DEV fixtures must retain separate real JS and CSS primary failures with one bounded retry');
assert.match(appSource,
  /waitForSettingsWorkspaceStyles\(\(\) => import\('\.\/components\/SettingsPanel'\)\)[\s\S]*?importRetryableWorkspaceAsset\('SettingsPanel\.js', 1\)/,
  'production Settings retry must cache-bust its stable emitted workspace asset');
assert.match(appSource,
  /function waitForSettingsWorkspaceStyles\(moduleLoader\)[\s\S]*?settingsModule\.settingsWorkspaceStylesheetReady[\s\S]*?then\(\(\) => settingsModule\)/,
  'Settings presentation must await the Settings-private stylesheet promise before resolving React.lazy');
assert.match(settingsSource,
  /SettingsPanel\.css\?url&no-inline[\s\S]*?export const settingsWorkspaceStylesheetReady = loadSettingsWorkspaceStylesheet[\s\S]*?getSettingsStylesheetAttempt\(import\.meta\.url\)/,
  'the Settings module must start one bounded non-inlined stylesheet attempt during evaluation');
assert.match(settingsStylesheetSource,
  /SETTINGS_STYLESHEET_TIMEOUT_MS = 10000[\s\S]*?activeAttempts = new WeakMap[\s\S]*?workspaceAttempt === String\(attempt\)[\s\S]*?activeAttempts\.get\(documentRef\)[\s\S]*?current\.attempt === attempt[\s\S]*?current\.requestedHref === requestedHref[\s\S]*?current\.promise[\s\S]*?workspaceLoaded = 'true'/,
  'the Settings stylesheet loader must be bounded, document-scoped, exact-href owned, cached, and explicitly settled');
assert.match(settingsStylesheetSource,
  /if \(attempt === 0\) stylesheet\.searchParams\.delete\('workspace-attempt'\)[\s\S]*?workspace-attempt[\s\S]*?current\?\.cancel\?\.\(\)/,
  'the Settings stylesheet must use an ordinary primary URL, one queried retry, and retire superseded ownership');
assert.doesNotMatch(settingsStylesheetSource, /Date\.now|Math\.random|window\.location\.reload/,
  'Settings stylesheet recovery must not create unbounded URLs or reload the renderer');
assert.match(appSource,
  /function preloadSettingsPanel\(\)[\s\S]*?settingsPanelImport\.load\(\)/,
  'Settings must cache each selected module attempt');
assert.match(appSource,
  /function createSettingsPanel\(\)[\s\S]*?React\.lazy\(preloadSettingsPanel\)/,
  'Settings retries must be able to create a fresh React.lazy identity');
assert.match(appSource,
  /if \(!settingsPanelImport\.reset\(\)\) return false;[\s\S]*?Component: createSettingsPanel\(\)/,
  'Settings retry must advance to the finite alternate import and replace the lazy identity');
assert.match(appSource, /retryAvailable=\{settingsPanelImport\.canRetry\(\)\}/,
  'Settings must remove the retry promise when its alternate URL is exhausted');
assert.match(appSource,
  /function prepareSettingsPanel\(\)[\s\S]*?preloadSettingsPanel\(\)\.catch\(\(\) => false\)/,
  'pointer-intent preloading must not create an unhandled chunk rejection');
assert.match(appSource,
  /function SettingsWorkspaceFallback\(\)[\s\S]*?aria-busy="true"[\s\S]*?aria-labelledby="settings-workspace-loading-title"[\s\S]*?tabIndex=\{-1\}[\s\S]*?role="status"/,
  'the Settings boundary must keep a named main landmark, live status, and focus target');
assert.match(appSource,
  /<React\.Suspense fallback=\{<SettingsWorkspaceFallback \/>\}>[\s\S]*?<SettingsPanel/,
  'the Settings workspace must have its contextual fallback');
assert.match(appSource,
  /<LazyWorkspaceBoundary[\s\S]*?key=\{settingsWorkspace\.attempt\}[\s\S]*?<SettingsWorkspaceRecovery[\s\S]*?<React\.Suspense/,
  'the Settings rejection boundary must stay outside its loading boundary');
assert.match(appSource, /onPrepareSettings=\{prepareSettingsPanel\}/,
  'the visible panel should preload Settings on user intent');

assert.doesNotMatch(panelSource, /^import ResultDisplay(?:,| from)/m,
  'ResultDisplay must stay outside the returning capture entry graph');
assert.doesNotMatch(panelSource, /from ['"]\.\.\/utils\/evidenceMapping\.mjs['"]/,
  'Result-only evidence and reply composition must stay outside the returning capture entry graph');
assert.match(panelSource,
  /getReplyProgressConsistencyForBrief[\s\S]*from ['"]\.\.\/utils\/replyProgress\.mjs['"]/,
  'the entry may retain only the compact reply-progress consistency contract');
assert.match(panelSource,
  /ResultDisplay\?workspace-load=result-fixture-primary[\s\S]*?ResultDisplay\?workspace-load=result-style-fixture-primary[\s\S]*?ResultDisplay\?workspace-load=result-style-retry&workspace-attempt=1/,
  'the Result DEV fixtures must retain separate real JS and CSS primary failures with one bounded retry');
assert.match(panelSource,
  /waitForResultWorkspaceStyles\(\(\) => import\('\.\/ResultDisplay'\)\)[\s\S]*?importRetryableWorkspaceAsset\('ResultDisplay\.js', 1\)/,
  'production Result retry must cache-bust its stable emitted workspace asset');
assert.match(panelSource,
  /function waitForResultWorkspaceStyles\(moduleLoader\)[\s\S]*?resultModule\.resultWorkspaceStylesheetReady[\s\S]*?then\(\(\) => resultModule\)/,
  'Result presentation must await the Result-private stylesheet promise before resolving React.lazy');
assert.match(resultSource,
  /ResultDisplay\.css\?url&no-inline[\s\S]*?export const resultWorkspaceStylesheetReady = loadResultWorkspaceStylesheet[\s\S]*?getResultStylesheetAttempt\(import\.meta\.url\)/,
  'the Result module must start one bounded non-inlined stylesheet attempt during evaluation');
assert.match(resultStylesheetSource,
  /RESULT_STYLESHEET_TIMEOUT_MS = 10000[\s\S]*?activeAttempts = new WeakMap[\s\S]*?workspaceAttempt === String\(attempt\)[\s\S]*?activeAttempts\.get\(documentRef\)[\s\S]*?current\.attempt === attempt[\s\S]*?current\.requestedHref === requestedHref[\s\S]*?current\.promise[\s\S]*?workspaceLoaded = 'true'/,
  'the Result stylesheet loader must be bounded, document-scoped, exact-href owned, cached, and explicitly settled');
assert.match(resultStylesheetSource,
  /if \(attempt === 0\) stylesheet\.searchParams\.delete\('workspace-attempt'\)[\s\S]*?workspace-attempt[\s\S]*?current\?\.cancel\?\.\(\)/,
  'the Result stylesheet must use an ordinary primary URL, one queried retry, and retire superseded ownership');
assert.doesNotMatch(resultStylesheetSource, /Date\.now|Math\.random|window\.location\.reload/,
  'Result stylesheet recovery must not create unbounded URLs or reload the renderer');
assert.match(panelSource,
  /function preloadResultDisplay\(\)[\s\S]*?resultDisplayImport\.load\(\)/,
  'Result must cache each selected module attempt');
assert.match(panelSource,
  /function createResultDisplay\(\)[\s\S]*?React\.lazy\(preloadResultDisplay\)/,
  'Result retries must be able to create a fresh React.lazy identity');
assert.match(panelSource,
  /if \(!resultDisplayImport\.reset\(\)\) return false;[\s\S]*?Component: createResultDisplay\(\)/,
  'Result retry must advance to the finite alternate import and replace the lazy identity');
assert.match(panelSource, /retryAvailable=\{resultDisplayImport\.canRetry\(\)\}/,
  'Result must remove the retry promise when its alternate URL is exhausted');
assert.match(panelSource,
  /status === STATUS\.PROCESSING \|\| pendingSessionRecovery \|\| isDone[\s\S]*?preloadResultDisplay\(\)/,
  'the result chunk must begin loading before or as a result becomes visible');
assert.match(panelSource,
  /function ResultWorkspaceFallback\(\)[\s\S]*?aria-labelledby="result-workspace-loading-title"[\s\S]*?aria-busy="true"[\s\S]*?role="status"/,
  'the Result boundary must keep a named main landmark and live progress status');
assert.match(panelSource,
  /<React\.Suspense fallback=\{<ResultWorkspaceFallback \/>\}>[\s\S]*?<ResultDisplay/,
  'the Result workspace must have its contextual fallback');
assert.match(panelSource,
  /<LazyWorkspaceBoundary[\s\S]*?key=\{`result-workspace-\$\{resultWorkspace\.attempt\}`\}[\s\S]*?<ResultWorkspaceRecovery[\s\S]*?<React\.Suspense/,
  'the Result rejection boundary must stay outside its loading boundary');
assert.match(panelSource,
  /settingsReturnFocusElementRef\.current = activeElement;[\s\S]*?settingsReturnFocusRef\.current = status === STATUS\.DONE[\s\S]*?\? 'result'[\s\S]*?: fromNativeMenu \? 'source' : 'settings-trigger';[\s\S]*?onOpenSettings\(\)/,
  'opening Settings from any completed Result surface must retain a return-focus target');
assert.match(panelSource,
  /getElementById\('result-headline'\)[\s\S]*?data-workspace-retry="result"[\s\S]*?result-workspace-loading-title/,
  'returning from Settings must focus the resolved, failed, or loading Result surface');

assert.doesNotMatch(panelSource,
  /^import\s+(?:[^'";]+?\s+from\s+)?['"]\.\/SavedTermsLibrary['"];?$/m,
  'SavedTermsLibrary must stay outside the returning capture entry graph');
assert.match(panelSource,
  /get\('run'\) === 'saved-terms-deferral-native'[\s\S]*?SavedTermsLibrary\?workspace-load=saved-terms-fixture-primary[\s\S]*?SavedTermsLibrary\?workspace-load=saved-terms-retry&workspace-attempt=1/,
  'the Saved Terms DEV fixture must fail its real primary URL and recover through one bounded module and stylesheet attempt');
assert.match(panelSource,
  /waitForSavedTermsWorkspaceStyles\(\(\) => import\('\.\/SavedTermsLibrary'\)\)[\s\S]*?importRetryableWorkspaceAsset\('SavedTermsLibrary\.js', 1\)/,
  'production Saved Terms retry must await CSS around its ordinary import and one bounded stable-asset URL');
assert.match(panelSource,
  /function waitForSavedTermsWorkspaceStyles\(moduleLoader\)[\s\S]*?savedTermsModule\.savedTermsWorkspaceStylesheetReady[\s\S]*?then\(\(\) => savedTermsModule\)/,
  'Saved Terms presentation must await the private stylesheet promise before resolving React.lazy');
assert.match(savedTermsSource,
  /SavedTermsLibrary\.css\?url&no-inline[\s\S]*?export const savedTermsWorkspaceStylesheetReady = loadSavedTermsWorkspaceStylesheet[\s\S]*?getSavedTermsStylesheetAttempt\(import\.meta\.url\)/,
  'the Saved Terms module must start one bounded non-inlined stylesheet attempt during evaluation');
assert.match(savedTermsStylesheetSource,
  /SAVED_TERMS_STYLESHEET_TIMEOUT_MS = 10000[\s\S]*?activeAttempts = new WeakMap[\s\S]*?workspaceAttempt === String\(attempt\)[\s\S]*?activeAttempts\.get\(documentRef\)[\s\S]*?current\.attempt === attempt[\s\S]*?current\.requestedHref === requestedHref[\s\S]*?current\.promise[\s\S]*?workspaceLoaded = 'true'/,
  'the Saved Terms stylesheet loader must be bounded, document-scoped, exact-href owned, cached, and explicitly settled');
assert.match(savedTermsStylesheetSource,
  /if \(attempt === 0\) stylesheet\.searchParams\.delete\('workspace-attempt'\)[\s\S]*?workspace-attempt[\s\S]*?current\?\.cancel\?\.\(\)/,
  'the Saved Terms stylesheet must use an ordinary primary URL, one queried retry, and retire superseded ownership');
assert.doesNotMatch(savedTermsStylesheetSource, /Date\.now|Math\.random|window\.location\.reload/,
  'Saved Terms stylesheet recovery must not create unbounded URLs or reload the renderer');
assert.equal(
  (panelSource.match(/SavedTermsLibrary\?workspace-load=/g) || []).length,
  2,
  'Saved Terms DEV loading must expose only one primary and one retry module identity',
);
assert.match(panelSource,
  /function preloadSavedTermsLibrary\(\)[\s\S]*?savedTermsLibraryImport\.load\(\)/,
  'Saved Terms intent and rendering must share the cached module attempt');
assert.match(panelSource,
  /function prepareSavedTermsLibrary\(\)[\s\S]*?preloadSavedTermsLibrary\(\)\.catch\(\(\) => false\)/,
  'Saved Terms intent preloading must absorb a rejected chunk promise');
assert.match(panelSource,
  /function createSavedTermsLibrary\(\)[\s\S]*?React\.lazy\(preloadSavedTermsLibrary\)/,
  'Saved Terms retry must be able to create a fresh React.lazy identity');
assert.match(panelSource,
  /if \(!savedTermsLibraryImport\.reset\(\)\) return false;[\s\S]*?attempt: current\.attempt \+ 1,[\s\S]*?Component: createSavedTermsLibrary\(\)/,
  'Saved Terms retry must advance once and replace the rejected lazy identity');
assert.match(panelSource, /retryAvailable=\{savedTermsLibraryImport\.canRetry\(\)\}/,
  'Saved Terms recovery must remove its retry action after the bounded URL is exhausted');

assert.match(panelSource,
  /const \[savedTermsWorkspaceMounted, setSavedTermsWorkspaceMounted\] = useState\(false\)/,
  'Saved Terms must begin outside the mounted renderer graph');
assert.doesNotMatch(panelSource, /setSavedTermsWorkspaceMounted\(false\)/,
  'the Saved Terms mount latch must never move backwards during the renderer lifetime');
assert.match(panelSource,
  /const openSavedTerms = useCallback\(\(\) => \{[\s\S]*?savedTermsDrawerOpenRef\.current = true;[\s\S]*?if \(!savedTermsWorkspaceMountedRef\.current\)[\s\S]*?savedTermsWorkspaceMountedRef\.current = true;[\s\S]*?setSavedTermsWorkspaceMounted\(true\);[\s\S]*?setSavedTermsDrawerOpen\(true\)/,
  'opening Saved Terms must synchronously claim modal intent and trip a one-way mount latch');
const closeSavedTermsSource = panelSource.match(
  /const closeSavedTerms = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/,
)?.[1] || '';
assert.match(closeSavedTermsSource, /setSavedTermsDrawerOpen\(false\)/,
  'closing Saved Terms must close the modal');
assert.doesNotMatch(closeSavedTermsSource,
  /setSavedTermsWorkspaceMounted|setSavedTermsSessionGeneration|savedTermsLibraryImport\.reset/,
  'ordinary close must preserve the mounted library instance and its local state');
assert.match(panelSource,
  /invalidateSavedTermsLoadRequest\(\);[\s\S]*?setSavedTermsLoadState\(SAVED_TERMS_LOAD_STATUS\.IDLE,[\s\S]*?setSavedTermsDrawerOpen\(false\);[\s\S]*?setSavedTermsSessionGeneration\(\(current\) => current \+ 1\)/,
  'a pending full-data reset must invalidate stale reads, close Saved Terms, and replace its local-state generation');
assert.match(panelSource,
  /const confirmSavedTermsPersistentReset = useCallback\(\(\) => \{[\s\S]*?invalidateSavedTermsLoadRequest\(\);[\s\S]*?updateSavedTerms\(\[\]\);[\s\S]*?setSavedTermsLoadState\(SAVED_TERMS_LOAD_STATUS\.READY/,
  'only a committed persistent reset may publish the canonical ready-empty Saved Terms state');
assert.match(panelSource,
  /const prepareSavedTermsAccess = useCallback\(\(\) => \{[\s\S]*?prepareSavedTermsLibrary\(\);[\s\S]*?ensureSavedTermsLoaded\(\)\.catch\(\(\) => false\)/,
  'Saved Terms intent must preload both its lazy workspace and persistent data');
assert.match(panelSource,
  /className=\{`saved-terms-trigger saved-terms-trigger--\$\{savedTermsLoadStatus\}`\}[\s\S]*?onPointerEnter=\{prepareSavedTermsAccess\}[\s\S]*?onFocus=\{prepareSavedTermsAccess\}[\s\S]*?onClick=\{openSavedTerms\}/,
  'the visible Saved Terms trigger must preload on pointer and keyboard intent');
assert.match(panelSource,
  /\{savedTermsWorkspaceMounted && \([\s\S]*?<LazyWorkspaceBoundary[\s\S]*?key=\{`saved-terms-workspace-\$\{savedTermsWorkspace\.attempt\}`\}[\s\S]*?<SavedTermsWorkspaceRecovery[\s\S]*?<React\.Suspense[\s\S]*?<SavedTermsWorkspaceFallback[\s\S]*?<SavedTermsLibrary[\s\S]*?key=\{`saved-terms-session-\$\{savedTermsSessionGeneration\}`\}/,
  'the one-way latch must own eager recovery/loading shells around the generation-keyed library');

assert.match(recoverySource,
  /function useSavedTermsModalIsolation\([\s\S]*?useLayoutEffect\(\(\) => \{[\s\S]*?node\.inert = true;[\s\S]*?setAttribute\('aria-hidden', 'true'\)[\s\S]*?MutationObserver[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.key !== 'Tab'[\s\S]*?hiddenSiblings\.forEach[\s\S]*?trigger\.focus/,
  'Saved Terms loading and recovery must eagerly isolate, trap, restore, and return modal focus');
assert.match(recoverySource,
  /function SavedTermsWorkspaceModal\([\s\S]*?id="saved-terms-drawer"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/,
  'Saved Terms loading and recovery must immediately expose the real modal owner');
assert.match(recoverySource,
  /function SavedTermsWorkspaceFallback[\s\S]*?data-workspace-loading['"]?: 'saved-terms'[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
  'the Saved Terms loading modal must own focus and one polite status');
assert.match(recoverySource,
  /function SavedTermsWorkspaceRecovery[\s\S]*?data-workspace-load-failure['"]?: 'saved-terms'[\s\S]*?role="alert"[\s\S]*?data-workspace-retry="saved-terms"[\s\S]*?data-workspace-return="saved-terms"/,
  'the Saved Terms failure modal must retain a finite retry and safe close action');
assert.doesNotMatch(recoverySource,
  /SavedTermsWorkspace(?:Fallback|Recovery)[\s\S]*?window\.location/,
  'Saved Terms loading and recovery must never reload the renderer');

for (const [name, source] of [['App', appSource], ['FloatingPanel', panelSource]]) {
  assert.match(source, /import\.meta\.env\.DEV[\s\S]*?lazy-workspace-recovery-native/,
    `${name} must keep the real-request fixture inside a fixed DEV-only run`);
  assert.doesNotMatch(source, /workspaceFailure/,
    `${name} must not expose a broad workspace-failure query switch`);
}
assert.match(appSource,
  /workspaceFixtureRun = new URLSearchParams\(window\.location\.search\)\.get\('run'\)[\s\S]*?LAZY_WORKSPACE_RECOVERY_FIXTURE[\s\S]*?lazy-workspace-recovery-native[\s\S]*?SETTINGS_STYLESHEET_RECOVERY_FIXTURE[\s\S]*?result-stylesheet-recovery-native/,
  'Settings must keep distinct exact JS- and stylesheet-recovery fixture journeys');
assert.match(panelSource,
  /get\('run'\)[\s\S]*?result-stylesheet-recovery-native/,
  'the Result stylesheet failure must stay inside its separate fixed DEV-only run');

assert.match(viteConfigSource, /apply: 'serve'/,
  'the real-request failure fixture must remain DEV-server only');
assert.match(viteConfigSource,
  /settings-fixture-primary[\s\S]*?result-fixture-primary/,
  'the original workspace fixture must retain the exact Settings and Result module loads');
assert.match(viteConfigSource,
  /RESULT_STYLESHEET_FIXTURE_LOAD = 'result-style-fixture-primary'[\s\S]*?\[RESULT_STYLESHEET_FIXTURE_LOAD\]: '\/components\/ResultDisplay\.css'/,
  'the separate Result stylesheet fixture must retain its exact load marker and CSS path');
assert.match(viteConfigSource,
  /SETTINGS_STYLESHEET_FIXTURE_LOAD = 'settings-style-fixture-primary'[\s\S]*?\[SETTINGS_STYLESHEET_FIXTURE_LOAD\]: '\/components\/SettingsPanel\.css'/,
  'the Settings stylesheet fixture must retain its exact load marker and CSS path');
assert.match(viteConfigSource,
  /SAVED_TERMS_FIXTURE_RUN = 'saved-terms-deferral-native'[\s\S]*?SAVED_TERMS_FIXTURE_LOAD = 'saved-terms-fixture-primary'[\s\S]*?\/components\/SavedTermsLibrary\.jsx/,
  'the Saved Terms fixture must bind only its fixed run and exact primary module path');
assert.match(viteConfigSource,
  /activeFixtureRun === SAVED_TERMS_FIXTURE_RUN[\s\S]*?workspaceLoad === SAVED_TERMS_FIXTURE_LOAD[\s\S]*?url\.pathname !== WORKSPACE_FIXTURE_PATHS\[workspaceLoad\][\s\S]*?statusCode = 503/,
  'the Saved Terms DEV fixture must issue a true 503 only for its active exact request');

const viteConfigFactory = require(viteConfigPath);
const viteConfig = viteConfigFactory({ command: 'serve', mode: 'development' });
const failureFixture = viteConfig.plugins.find((plugin) => (
  plugin?.name === 'slipstream-lazy-workspace-failure-fixture'
));
assert.equal(failureFixture?.apply, 'serve',
  'the real-request failure fixture must remain unavailable to production builds');
let failureMiddleware = null;
failureFixture.configureServer({
  middlewares: {
    use(handler) {
      failureMiddleware = handler;
    },
  },
});
assert.equal(typeof failureMiddleware, 'function');
function dispatchFixtureRequest(url, requestHeaders = {}) {
  let nextCalls = 0;
  let body = '';
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    end(value = '') {
      body = String(value);
    },
  };
  failureMiddleware({ url, headers: requestHeaders }, response, () => { nextCalls += 1; });
  return { body, headers, nextCalls, statusCode: response.statusCode };
}

const savedTermsFixtureRequest = '/components/SavedTermsLibrary.jsx?workspace-load=saved-terms-fixture-primary';
assert.equal(dispatchFixtureRequest(savedTermsFixtureRequest).nextCalls, 1,
  'Saved Terms failure injection must stay inactive without its fixed navigation');
assert.equal(dispatchFixtureRequest('/?run=saved-terms-deferral-native').nextCalls, 1);
assert.deepEqual(dispatchFixtureRequest(savedTermsFixtureRequest), {
  body: 'Fixed lazy workspace fixture failure',
  headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
  nextCalls: 0,
  statusCode: 503,
}, 'the exact Saved Terms primary request must receive a real HTTP 503');
assert.equal(dispatchFixtureRequest(savedTermsFixtureRequest).nextCalls, 1,
  'the fixed Saved Terms primary URL must fail only once per fixture navigation');
assert.equal(dispatchFixtureRequest(
  '/components/ResultDisplay.jsx?workspace-load=saved-terms-fixture-primary',
).nextCalls, 1, 'a mismatched path must not receive the Saved Terms failure');
assert.equal(dispatchFixtureRequest(
  '/components/SavedTermsLibrary.jsx?workspace-load=saved-terms-retry',
).nextCalls, 1, 'the distinct Saved Terms retry URL must remain available');
dispatchFixtureRequest('/?run=lazy-workspace-recovery-native');
assert.equal(dispatchFixtureRequest(savedTermsFixtureRequest).nextCalls, 1,
  'the existing workspace run must not activate the Saved Terms failure');
const resultFixtureRequest = '/components/ResultDisplay.jsx?workspace-load=result-fixture-primary';
assert.deepEqual(dispatchFixtureRequest(resultFixtureRequest), {
  body: 'Fixed lazy workspace fixture failure',
  headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
  nextCalls: 0,
  statusCode: 503,
}, 'the Result primary module request must retain its fixed workspace failure');
assert.equal(dispatchFixtureRequest('/', { 'sec-fetch-dest': 'empty' }).nextCalls, 1,
  'the same-origin renderer isolation probe must pass through the DEV server');
const settingsFixtureRequest = '/components/SettingsPanel.jsx?workspace-load=settings-fixture-primary';
assert.deepEqual(dispatchFixtureRequest(settingsFixtureRequest), {
  body: 'Fixed lazy workspace fixture failure',
  headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
  nextCalls: 0,
  statusCode: 503,
}, 'an unrelated same-origin root probe must not cancel the later Settings failure');
assert.equal(dispatchFixtureRequest('/?run=result-stylesheet-recovery-native').nextCalls, 1);
const resultStylesheetFixtureRequest = '/components/ResultDisplay.css?url&no-inline&workspace-load=result-style-fixture-primary';
assert.deepEqual(dispatchFixtureRequest(resultStylesheetFixtureRequest), {
  body: 'Fixed lazy workspace fixture failure',
  headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
  nextCalls: 0,
  statusCode: 503,
}, 'the separate Result primary stylesheet request must receive a real HTTP 503');
assert.equal(dispatchFixtureRequest(
  '/components/ResultDisplay.jsx?workspace-load=result-style-fixture-primary',
).nextCalls, 1, 'the Result module must remain available while its exact stylesheet fails');
assert.equal(dispatchFixtureRequest(
  '/components/ResultDisplay.css?url&no-inline&workspace-attempt=1',
).nextCalls, 1, 'the Result stylesheet retry URL must remain available');
const settingsStylesheetFixtureRequest = '/components/SettingsPanel.css?url&no-inline&workspace-load=settings-style-fixture-primary';
assert.deepEqual(dispatchFixtureRequest(settingsStylesheetFixtureRequest), {
  body: 'Fixed lazy workspace fixture failure',
  headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
  nextCalls: 0,
  statusCode: 503,
}, 'the separate Settings primary stylesheet request must receive a real HTTP 503');
assert.equal(dispatchFixtureRequest(
  '/components/SettingsPanel.jsx?workspace-load=settings-style-fixture-primary',
).nextCalls, 1, 'the Settings module must remain available while its exact stylesheet fails');
assert.equal(dispatchFixtureRequest(
  '/components/SettingsPanel.css?url&no-inline&workspace-attempt=1',
).nextCalls, 1, 'the Settings stylesheet retry URL must remain available');
assert.match(viteConfigSource, /statusCode = 503/,
  'the DEV server must fail each exact primary module request before Vite transforms it');
assert.match(viteConfigSource,
  /get\('run'\) === LAZY_WORKSPACE_FIXTURE_RUN[\s\S]*?rejectedLoads\.clear\(\)/,
  'each fixed fixture navigation must receive a fresh real module-request failure');
assert.doesNotMatch(retryResourceSource, /Date\.now|Math\.random|failFirstAttempt/,
  'retry resources must use finite static loaders, not synthetic or unbounded cache busting');
assert.match(retryResourceSource,
  /importRetryableWorkspaceAsset[\s\S]*?workspace-attempt[\s\S]*?@vite-ignore/,
  'production retry must import one validated stable asset through a distinct bounded URL');
assert.match(viteConfigSource,
  /\['ResultDisplay', 'SettingsPanel', 'SavedTermsLibrary'\]\.includes\(chunk\.name\)[\s\S]*?assets\/\[name\]\.js/,
  'the three runtime-imported workspace chunks must keep stable physical filenames');
assert.match(viteConfigSource,
  /SettingsPanel\.css[\s\S]*?assets\/SettingsPanel\.css/,
  'the retryable Settings stylesheet must keep a stable physical filename');
assert.match(viteConfigSource,
  /SavedTermsLibrary\.css[\s\S]*?assets\/SavedTermsLibrary\.css/,
  'the retryable Saved Terms stylesheet must keep a stable physical filename');

assert.doesNotMatch(indexSource, /ResultDisplay\.css/,
  'the dedicated Result stylesheet must stay outside the capture entry graph');
assert.doesNotMatch(indexSource, /SettingsPanel\.css/,
  'the Settings-private stylesheet must stay outside the eager renderer entry graph');
assert.doesNotMatch(indexSource, /SavedTermsLibrary\.css/,
  'the Saved Terms-private stylesheet must stay outside the eager renderer entry graph');
assert.match(resultSource, /import resultDisplayStylesheetUrl from '\.\/ResultDisplay\.css\?url&no-inline'/,
  'the Result module must own the URL for its stable non-inlined stylesheet');
assert.match(settingsSource, /import settingsPanelStylesheetUrl from '\.\/SettingsPanel\.css\?url&no-inline'/,
  'the Settings module must own the URL for its stable non-inlined stylesheet');
assert.match(savedTermsSource,
  /import savedTermsLibraryStylesheetUrl from '\.\/SavedTermsLibrary\.css\?url&no-inline'/,
  'the Saved Terms module must own the URL for its stable non-inlined stylesheet');
assert.match(savedTermsSource,
  /import\.meta\.env\.DEV[\s\S]*?saved-terms-style-fixture-primary[\s\S]*?savedTermsLibraryStylesheetHref\.searchParams\.set/,
  'the Saved Terms module must preserve its fixed DEV-only primary stylesheet marker');
assert.match(settingsCssSource, /\.settings-panel__header/,
  'the deferred Settings stylesheet must retain its private shell rules');
assert.match(settingsCssSource, /\.slipstream-textarea,[\s\S]*?\.verification-policy \{/,
  'live Settings-only controls must move into the deferred Settings stylesheet');
assert.doesNotMatch(cssSource, /\.slipstream-textarea,|\.verification-policy \{/,
  'the eager stylesheet must not retain the moved Settings-only control blocks');
for (const selector of [
  '.saved-terms-trigger',
  '.saved-terms-drawer-backdrop',
  '.saved-terms-drawer {',
  '.saved-terms-drawer__header',
  '.saved-terms-drawer__body {',
  '.saved-terms-workspace-state__body',
  '.saved-terms-workspace-state__notice',
  '.saved-terms-workspace-state__actions',
  '.saved-terms-workspace-state__hint',
  '.term-operation-error',
]) {
  assert.ok(cssSource.includes(selector),
    `the eager App stylesheet must retain the Saved Terms shell selector ${selector}`);
}
for (const selector of [
  '.saved-terms-drawer__privacy',
  '.saved-terms-drawer__body--populated',
  '.saved-terms-drawer__empty',
  '.saved-term-library',
  '.saved-term-search',
  '.saved-term-card',
  '.saved-term-copy-actions',
  '.saved-term-undo',
  '.saved-term-error',
  '.saved-term-transfer',
  '.saved-term-import-trust-review',
]) {
  assert.ok(!cssSource.includes(selector),
    `the eager App stylesheet must exclude the Saved Terms-private selector ${selector}`);
  assert.ok(savedTermsCssSource.includes(selector),
    `the deferred Saved Terms stylesheet must retain its private selector ${selector}`);
}
assert.doesNotMatch(savedTermsCssSource,
  /\.saved-terms-trigger|\.saved-terms-drawer-backdrop|^\.saved-terms-drawer\s*\{|\.saved-terms-drawer__header|^\.saved-terms-drawer__body\s*\{|\.saved-terms-workspace-state|\.term-operation-error/m,
  'the deferred Saved Terms stylesheet must not duplicate its eager trigger, modal recovery shell, or shared operation error');
assert.match(cssSource, /\.session-clear-undo__a11y,[\s\S]*?\.result-a11y-live/,
  'the shared Result/Saved-Terms live-region hiding rule must remain eager');
assert.doesNotMatch(resultCssSource, /\.result-a11y-live/,
  'the deferred leaf stylesheet must not own a Saved-Terms dependency');
assert.doesNotMatch(savedTermsCssSource, /\.result-a11y-live/,
  'the deferred Saved Terms stylesheet must not duplicate its eager live-region dependency');
assert.match(resultSource,
  /motionPreference\.mjs\?workspace=result'/,
  'Result motion preference code must stay inside the Result chunk instead of a shared async URL');
assert.match(settingsSource,
  /motionPreference\.mjs\?workspace=settings'/,
  'Settings motion preference code must stay inside the Settings chunk instead of a shared async URL');

assert.match(recoverySource,
  /class LazyWorkspaceBoundary extends React\.Component[\s\S]*?getDerivedStateFromError\(error\)[\s\S]*?isLazyWorkspaceLoadError\(error\)[\s\S]*?React\.cloneElement\(this\.props\.fallback/,
  'rejected lazy imports need an eager error boundary');
assert.match(recoverySource,
  /failureKind: this\.state\.loadFailure \? 'load' : 'unexpected'[\s\S]*?retryAvailable: this\.state\.loadFailure/,
  'unexpected subtree errors must keep the safe escape but must not promise a module retry');
for (const workspace of ['settings', 'result']) {
  assert.match(recoverySource,
    new RegExp(`data-workspace-load-failure="${workspace}"[\\s\\S]*?role="alert"[\\s\\S]*?retryAvailable[\\s\\S]*?data-workspace-retry="${workspace}"`),
    `${workspace} recovery must expose a named main, one alert, and a finite retry action`);
  assert.match(recoverySource,
    new RegExp(`data-workspace-return="${workspace}"`),
    `${workspace} recovery must provide a state-preserving escape action`);
}
assert.match(recoverySource,
  /topLayerSelector = '\[aria-modal="true"\], \[data-app-top-layer\]'[\s\S]*?querySelector\(topLayerSelector\)/,
  'failure focus must yield to any modal/top-layer owner');
assert.match(recoverySource,
  /new MutationObserver[\s\S]*?!document\.querySelector\(topLayerSelector\)[\s\S]*?scheduleFocus\(\)[\s\S]*?observer\.observe\(document\.body/,
  'failure focus must re-arm when a covering top layer closes');
assert.match(recoverySource,
  /target\.focus\(\{ preventScroll: true \}\);[\s\S]*?document\.activeElement === target[\s\S]*?target\.scrollIntoView\(\{[\s\S]*?behavior: 'auto',[\s\S]*?block: 'center',[\s\S]*?inline: 'nearest'/,
  'recovery must reveal the exact focused action after a top layer closes');
assert.doesNotMatch(recoverySource, /window\.location|LLM_|handleRetryProcessing|recoverFreshSettings/,
  'workspace recovery must not reload, resend, or enter destructive settings recovery');
assert.match(cssSource, /\.workspace-load-failure__actions/,
  'workspace recovery styles must stay in the eager renderer stylesheet');

for (const [name, source] of [
  ['App', appSource],
  ['FloatingPanel', panelSource],
  ['ResultDisplay', resultSource],
  ['SettingsPanel', settingsSource],
  ['SavedTermsLibrary', savedTermsSource],
]) {
  assert.match(source, /import ClipboardActionNotice from ['"]\.\/?(?:components\/)?ClipboardActionNotice['"]/,
    `${name} must consume the small eager clipboard notice directly`);
  assert.doesNotMatch(source, /import\s*\{\s*ClipboardActionNotice\s*\}\s*from\s*['"]\.\/ResultDisplay['"]/,
    `${name} must not pull the result workspace back into the eager graph`);
}

assert.match(noticeSource, /export default function ClipboardActionNotice/);
assert.match(noticeSource, /data-clipboard-consequence-ack/,
  'the extracted notice must retain the explicit clipboard consequence action');

console.log('Renderer lazy-boundary checks passed.');
