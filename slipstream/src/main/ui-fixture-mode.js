const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const UI_FIXTURE_FLAG = '--ui-fixture';
const UI_FIXTURE_RENDERER_URL_ENV = 'SLIPSTREAM_UI_FIXTURE_RENDERER_URL';
const UI_FIXTURE_USER_DATA_ENV = 'SLIPSTREAM_UI_FIXTURE_USER_DATA';
const UI_FIXTURE_USER_DATA_PREFIX = 'slipstream-ui-fixture-';
const LEGACY_DEMO_RESULT_ENV = 'SLIPSTREAM_DEMO_RESULT';
const DISABLED_UI_FIXTURE_MODE = Object.freeze({ enabled: false });
const ALLOWED_FIXTURE_QUERY_KEYS = new Set([
  'demo',
  'connection',
  'connectionCancel',
  'capture',
  'save',
  'credentialDelete',
  'reset',
  'termSave',
  'termDelete',
  'terms',
  'termExport',
  'termImport',
  'diagnostics',
  'clipboard',
  'external',
  'clipboardRead',
  'settings',
  'startupRecovery',
  'rendererRecovery',
  'runtime',
  'verification',
  'process',
  'cancel',
  'quit',
  'backend',
  'monitor',
  'monitorEvents',
  'activeCapture',
  'shortcut',
  'run',
  'fixture',
  'trapPort',
]);
const FIXTURE_QUERY_VALUE_WHITELISTS = Object.freeze({
  connection: Object.freeze([
    'ok',
    'unsupported',
    'unauthorized',
    'unreachable',
    'unreachable-once',
    'timeout',
    'model-not-found',
    'structured-output-invalid',
    'generation-failed',
    'slow',
    'race',
  ]),
  runtime: Object.freeze([
    'tray-unavailable',
    'monitoring-disabled',
    'monitoring-disable-persist-failed',
    'all',
  ]),
  settings: Object.freeze([
    'fail',
    'invalid',
    'timeout',
    'once',
    'timeout-once',
    'corrupt-json',
  ]),
  startupRecovery: Object.freeze(['archive-success']),
  rendererRecovery: Object.freeze(['clipboard-residue']),
  run: Object.freeze([
    'fixture',
    'native-runtime',
    'first-use-capture-text-scale-native',
    'completed-result-text-scale-native',
    'guided-reply-text-scale-native',
    'stacked-status-text-scale-native',
    'settings-transition-native',
    'settings-transition-text-scale-native',
    'settings-draft-discard-native',
    'settings-failed-draft-discard-native',
    'settings-save-retry-native',
    'settings-prompt-draft-recovery-native',
    'reply-copy-settlement-native',
    'clipboard-app-transaction-native',
    'option-c-edit-transition-native',
    'clipboard-quit-clear-settlement-native',
    'manual-clipboard-replacement-native',
    'runtime-degraded-native',
    'startup-recovery-native',
    'clipboard-residue-recovery-native',
    'provider-retry-native',
    'failed-source-retry-native',
    'lazy-workspace-recovery-native',
    'result-stylesheet-recovery-native',
    'settings-stylesheet-collision-native',
    'command-q-safe-exit-native',
    'command-comma-safe-settings-native',
  ]),
});

function normalizedName(value) {
  return String(value).normalize('NFKC').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSecretLikeName(value) {
  const name = normalizedName(value);
  return new Set([
    'sshauthsock',
    'nodeoptions',
    'nodepath',
    'electronrunasnode',
    'dyldinsertlibraries',
    'ldpreload',
  ]).has(name)
    || name.includes('apikey')
    || name.includes('token')
    || name.includes('secret')
    || name.includes('password')
    || name.includes('passwd')
    || name.includes('credential')
    || name.includes('privatekey')
    || name.includes('accesskey')
    || name.includes('authorization')
    || name.includes('authentication')
    || name === 'auth'
    || name.endsWith('auth')
    || name === 'key'
    || name.endsWith('key');
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function validateFixtureRendererUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('UI fixture renderer URL must be a non-empty canonical string');
  }
  if (value.length > 2048) throw new TypeError('UI fixture renderer URL is too long');
  if (value.includes('#')) throw new TypeError('UI fixture renderer URL must not contain a fragment');

  let rendererUrl;
  try {
    rendererUrl = new URL(value);
  } catch {
    throw new TypeError('UI fixture renderer URL is invalid');
  }
  if (rendererUrl.href !== value || rendererUrl.search !== `?${rendererUrl.searchParams.toString()}`) {
    throw new TypeError('UI fixture renderer URL must use its canonical serialization');
  }

  const port = Number(rendererUrl.port);
  if (
    rendererUrl.protocol !== 'http:'
    || rendererUrl.hostname !== '127.0.0.1'
    || !rendererUrl.port
    || !Number.isSafeInteger(port)
    || port <= 1023
    || port > 65535
    || rendererUrl.pathname !== '/'
    || rendererUrl.username
    || rendererUrl.password
  ) {
    throw new TypeError('UI fixture renderer URL must be an unauthenticated loopback HTTP root on a non-privileged port');
  }

  const demoValues = rendererUrl.searchParams.getAll('demo');
  if (demoValues.length !== 1 || !['capture', 'result', 'setup'].includes(demoValues[0])) {
    throw new TypeError('UI fixture renderer URL must select one supported demo');
  }

  const seenKeys = new Set();
  for (const [key, queryValue] of rendererUrl.searchParams) {
    if (!key || containsControlCharacter(key) || containsControlCharacter(queryValue)) {
      throw new TypeError('UI fixture renderer URL contains an invalid query parameter');
    }
    if (!ALLOWED_FIXTURE_QUERY_KEYS.has(key)) {
      throw new TypeError('UI fixture renderer URL contains an unsupported or secret-like query key');
    }
    if (seenKeys.has(key)) throw new TypeError('UI fixture renderer URL must not repeat query keys');
    const allowedValues = FIXTURE_QUERY_VALUE_WHITELISTS[key];
    if (allowedValues && !allowedValues.includes(queryValue)) {
      throw new TypeError(`UI fixture renderer URL contains an unsupported ${key} value`);
    }
    if (
      /sk-[A-Za-z0-9_-]{20,}/iu.test(queryValue)
      || /\bbearer\s+[A-Za-z0-9._~+/-]{8,}/iu.test(queryValue)
      || /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/iu.test(queryValue)
    ) {
      throw new TypeError('UI fixture renderer URL must not contain live credential values');
    }
    seenKeys.add(key);
  }

  const fixtureCheck = rendererUrl.searchParams.get('fixture');
  const trapPortValue = rendererUrl.searchParams.get('trapPort');
  if (fixtureCheck !== null && fixtureCheck !== 'check') {
    throw new TypeError('UI fixture runtime probe must use the supported check mode');
  }
  if (fixtureCheck === 'check') {
    const trapPort = Number(trapPortValue);
    if (
      trapPortValue === null
      || String(trapPort) !== trapPortValue
      || !Number.isSafeInteger(trapPort)
      || trapPort <= 1023
      || trapPort > 65535
      || trapPort === port
    ) {
      throw new TypeError('UI fixture runtime probe requires a distinct canonical loopback trap port');
    }
  } else if (trapPortValue !== null) {
    throw new TypeError('UI fixture trap port is reserved for the runtime probe');
  }

  const firstUseCaptureTextScaleRun = rendererUrl.searchParams.get('run')
    === 'first-use-capture-text-scale-native';
  if (firstUseCaptureTextScaleRun) {
    const fixedScenarioKeys = new Set(['demo', 'fixture', 'trapPort', 'run']);
    if (
      rendererUrl.searchParams.get('demo') !== 'setup'
      || fixtureCheck !== 'check'
      || [...rendererUrl.searchParams.keys()].some((key) => !fixedScenarioKeys.has(key))
      || rendererUrl.searchParams.size !== fixedScenarioKeys.size
    ) {
      throw new TypeError(
        'UI fixture first-use text-scale probe requires the fixed setup check scenario',
      );
    }
  }

  const completedResultTextScaleRun = rendererUrl.searchParams.get('run')
    === 'completed-result-text-scale-native';
  if (completedResultTextScaleRun) {
    const fixedScenarioKeys = new Set(['demo', 'terms', 'fixture', 'trapPort', 'run']);
    if (
      rendererUrl.searchParams.get('demo') !== 'result'
      || rendererUrl.searchParams.get('terms') !== 'sample'
      || fixtureCheck !== 'check'
      || [...rendererUrl.searchParams.keys()].some((key) => !fixedScenarioKeys.has(key))
      || rendererUrl.searchParams.size !== fixedScenarioKeys.size
    ) {
      throw new TypeError(
        'UI fixture completed-result text-scale probe requires the fixed sample result check scenario',
      );
    }
  }

  const guidedReplyTextScaleRun = rendererUrl.searchParams.get('run')
    === 'guided-reply-text-scale-native';
  if (guidedReplyTextScaleRun) {
    const fixedScenarioKeys = new Set(['demo', 'terms', 'fixture', 'trapPort', 'run']);
    if (
      rendererUrl.searchParams.get('demo') !== 'result'
      || rendererUrl.searchParams.get('terms') !== 'sample'
      || fixtureCheck !== 'check'
      || [...rendererUrl.searchParams.keys()].some((key) => !fixedScenarioKeys.has(key))
      || rendererUrl.searchParams.size !== fixedScenarioKeys.size
    ) {
      throw new TypeError(
        'UI fixture guided-reply text-scale probe requires the fixed sample result check scenario',
      );
    }
  }

  const workspaceRecoveryRun = new Set([
    'lazy-workspace-recovery-native',
    'result-stylesheet-recovery-native',
  ]).has(rendererUrl.searchParams.get('run'));
  if (workspaceRecoveryRun) {
    const run = rendererUrl.searchParams.get('run');
    const fixedBusinessSearch = '?demo=result&terms=sample';
    const expectedCheckSearch = `${fixedBusinessSearch}&fixture=check&trapPort=${trapPortValue}`
      + `&run=${run}`;
    const expectedPreviewSearch = `${fixedBusinessSearch}&run=${run}`;
    const isFixedCheck = fixtureCheck === 'check'
      && rendererUrl.search === expectedCheckSearch;
    const isFixedPreview = fixtureCheck === null
      && trapPortValue === null
      && rendererUrl.search === expectedPreviewSearch;
    if (!isFixedCheck && !isFixedPreview) {
      throw new TypeError(
        'UI fixture workspace recovery requires the fixed sample result check or preview scenario',
      );
    }
  }

  const settingsStylesheetCollisionRun = rendererUrl.searchParams.get('run')
    === 'settings-stylesheet-collision-native';
  if (settingsStylesheetCollisionRun) {
    const fixedBusinessSearch = '?demo=result&terms=sample';
    const expectedCheckSearch = `${fixedBusinessSearch}&activeCapture=fixture-screenshot`
      + `&quit=fixture&fixture=check&trapPort=${trapPortValue}`
      + '&run=settings-stylesheet-collision-native';
    const allowedPreviewSearches = new Set([
      `${fixedBusinessSearch}&run=settings-stylesheet-collision-native`,
      `${fixedBusinessSearch}&quit=5000&run=settings-stylesheet-collision-native`,
      `${fixedBusinessSearch}&quit=20000&run=settings-stylesheet-collision-native`,
      `${fixedBusinessSearch}&activeCapture=settings-screenshot`
        + '&run=settings-stylesheet-collision-native',
    ]);
    const isFixedCheck = fixtureCheck === 'check'
      && rendererUrl.search === expectedCheckSearch;
    const isFixedPreview = fixtureCheck === null
      && trapPortValue === null
      && allowedPreviewSearches.has(rendererUrl.search);
    if (!isFixedCheck && !isFixedPreview) {
      throw new TypeError(
        'UI fixture Settings stylesheet collision requires a fixed isolated check or preview scenario',
      );
    }
  }

  const commandQSafeExitRun = rendererUrl.searchParams.get('run')
    === 'command-q-safe-exit-native';
  if (commandQSafeExitRun) {
    const expectedCheckSearch = '?demo=result&terms=sample&quit=ipc'
      + `&fixture=check&trapPort=${trapPortValue}&run=command-q-safe-exit-native`;
    const expectedPreviewSearch = '?demo=result&terms=sample&quit=ipc'
      + '&run=command-q-safe-exit-native';
    const isFixedCheck = fixtureCheck === 'check'
      && rendererUrl.search === expectedCheckSearch;
    const isFixedPreview = fixtureCheck === null
      && trapPortValue === null
      && rendererUrl.search === expectedPreviewSearch;
    if (!isFixedCheck && !isFixedPreview) {
      throw new TypeError(
        'UI fixture Command+Q safe-exit run requires the fixed isolated check or preview scenario',
      );
    }
  }

  const commandCommaSafeSettingsRun = rendererUrl.searchParams.get('run')
    === 'command-comma-safe-settings-native';
  if (commandCommaSafeSettingsRun) {
    const expectedCheckSearch = '?demo=capture&backend=deepseek&process=slow'
      + `&fixture=check&trapPort=${trapPortValue}&run=command-comma-safe-settings-native`;
    const expectedPreviewSearch = '?demo=capture&backend=deepseek&process=slow'
      + '&run=command-comma-safe-settings-native';
    const isFixedCheck = fixtureCheck === 'check'
      && rendererUrl.search === expectedCheckSearch;
    const isFixedPreview = fixtureCheck === null
      && trapPortValue === null
      && rendererUrl.search === expectedPreviewSearch;
    if (!isFixedCheck && !isFixedPreview) {
      throw new TypeError(
        'UI fixture Command+, Settings run requires the fixed isolated check or preview scenario',
      );
    }
  }

  const settingsSaveRetryRun = rendererUrl.searchParams.get('run')
    === 'settings-save-retry-native';
  if (settingsSaveRetryRun) {
    const expectedSearch = '?demo=capture&backend=deepseek&save=credential-once'
      + `&fixture=check&trapPort=${trapPortValue}&run=settings-save-retry-native`;
    if (rendererUrl.search !== expectedSearch) {
      throw new TypeError(
        'UI fixture Settings save retry requires the fixed isolated credential check scenario',
      );
    }
  }

  const settingsPromptDraftRecoveryRun = rendererUrl.searchParams.get('run')
    === 'settings-prompt-draft-recovery-native';
  if (settingsPromptDraftRecoveryRun) {
    const expectedSearch = '?demo=capture&backend=deepseek&save=prompt-twice'
      + `&fixture=check&trapPort=${trapPortValue}&run=settings-prompt-draft-recovery-native`;
    if (rendererUrl.search !== expectedSearch) {
      throw new TypeError(
        'UI fixture Settings prompt draft recovery requires the fixed isolated two-failure check scenario',
      );
    }
  }

  const stackedStatusTextScaleRun = rendererUrl.searchParams.get('run')
    === 'stacked-status-text-scale-native';
  if (stackedStatusTextScaleRun) {
    const fixedBusinessSearch = '?demo=capture&backend=deepseek&monitor=on&shortcut=both-conflict'
      + '&process=slow&monitorEvents=collision&activeCapture=foreground-screenshot'
      + '&rendererRecovery=clipboard-residue';
    const expectedCheckSearch = `${fixedBusinessSearch}&fixture=check&trapPort=${trapPortValue}`
      + '&run=stacked-status-text-scale-native';
    const expectedPreviewSearch = `${fixedBusinessSearch}&run=stacked-status-text-scale-native`;
    const isFixedCheck = fixtureCheck === 'check'
      && rendererUrl.search === expectedCheckSearch;
    const isFixedPreview = fixtureCheck === null
      && trapPortValue === null
      && rendererUrl.search === expectedPreviewSearch;
    if (!isFixedCheck && !isFixedPreview) {
      throw new TypeError(
        'UI fixture stacked-status text-scale run requires the fixed isolated check or preview scenario',
      );
    }
  }

  const startupRecovery = rendererUrl.searchParams.get('startupRecovery');
  if (
    startupRecovery !== null
    && (
      rendererUrl.searchParams.get('demo') !== 'setup'
      || rendererUrl.searchParams.get('settings') !== 'corrupt-json'
    )
  ) {
    throw new TypeError('UI fixture startup recovery requires the fixed corrupt settings setup scenario');
  }

  const rendererRecovery = rendererUrl.searchParams.get('rendererRecovery');
  const rendererRecoveryRun = [
    'clipboard-residue-recovery-native',
    'stacked-status-text-scale-native',
  ].includes(rendererUrl.searchParams.get('run'));
  const rendererRecoveryModeAllowed = rendererUrl.searchParams.get('fixture') === 'check'
    || (
      rendererUrl.searchParams.get('run') === 'stacked-status-text-scale-native'
      && rendererUrl.searchParams.get('fixture') === null
    );
  if (
    rendererRecovery !== null || rendererRecoveryRun
  ) {
    if (
      rendererRecovery !== 'clipboard-residue'
      || !rendererRecoveryRun
      || rendererUrl.searchParams.get('demo') !== 'capture'
      || !rendererRecoveryModeAllowed
    ) {
      throw new TypeError('UI fixture renderer recovery requires the dedicated isolated clipboard residue scenario');
    }
  }

  return rendererUrl.href;
}

function validateFixtureUserDataPath(value, { tempRoot = os.tmpdir() } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError('UI fixture userData path must be absolute');
  }
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot)) {
    throw new TypeError('UI fixture temp root must be absolute');
  }

  let rootPath;
  let candidatePath;
  let candidateStats;
  try {
    rootPath = fs.realpathSync(tempRoot);
    candidateStats = fs.lstatSync(value);
    candidatePath = fs.realpathSync(value);
  } catch {
    throw new TypeError('UI fixture userData path must already exist inside the temp root');
  }

  if (!fs.statSync(rootPath).isDirectory()) {
    throw new TypeError('UI fixture temp root must be a directory');
  }
  if (!candidateStats.isDirectory() || candidateStats.isSymbolicLink()) {
    throw new TypeError('UI fixture userData path must be a real directory');
  }

  const originalBasename = path.basename(path.normalize(value));
  const realBasename = path.basename(candidatePath);
  const generatedNamePattern = new RegExp(`^${UI_FIXTURE_USER_DATA_PREFIX}[A-Za-z0-9]{6}$`);
  if (!generatedNamePattern.test(originalBasename) || !generatedNamePattern.test(realBasename)) {
    throw new TypeError('UI fixture userData path must have the launcher-created prefix');
  }
  if (path.dirname(candidatePath) !== rootPath) {
    throw new TypeError('UI fixture userData path must be a direct child of the real temp root');
  }

  return candidatePath;
}

function sanitizeFixtureEnvironment(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('UI fixture environment must be an object');
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretLikeName(key)) continue;
    Object.defineProperty(sanitized, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return Object.freeze(sanitized);
}

function assertUnusedFixtureDirectory(userDataPath) {
  const stats = fs.statSync(userDataPath);
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error('UI fixture userData directory must belong to the current user');
  }
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    throw new Error('UI fixture userData directory must not be accessible to group or other users');
  }
  if (fs.readdirSync(userDataPath).length !== 0) {
    throw new Error('UI fixture userData directory must be unused');
  }
}

function isUiFixtureRequested({ argv, env } = {}) {
  if (!Array.isArray(argv) || !env || typeof env !== 'object' || Array.isArray(env)) return false;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(env, key);
  return argv.includes(UI_FIXTURE_FLAG)
    || hasOwn(UI_FIXTURE_RENDERER_URL_ENV)
    || hasOwn(UI_FIXTURE_USER_DATA_ENV)
    || hasOwn(LEGACY_DEMO_RESULT_ENV);
}

function resolveUiFixtureMode({ argv, env, isPackaged, tempRoot } = {}) {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === 'string')) {
    throw new TypeError('UI fixture argv must be an array of strings');
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('UI fixture environment must be an object');
  }
  if (typeof isPackaged !== 'boolean') {
    throw new TypeError('UI fixture packaged state must be explicit');
  }

  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(env, key);
  if (hasOwn(LEGACY_DEMO_RESULT_ENV)) {
    throw new Error('SLIPSTREAM_DEMO_RESULT is unsafe; use npm run dev:ui-fixture instead');
  }

  const fixtureRequested = argv.includes(UI_FIXTURE_FLAG)
    || hasOwn(UI_FIXTURE_RENDERER_URL_ENV)
    || hasOwn(UI_FIXTURE_USER_DATA_ENV);
  if (!fixtureRequested) return DISABLED_UI_FIXTURE_MODE;
  if (isPackaged) throw new Error('UI fixture mode is unavailable in packaged builds');
  if (!argv.includes('--dev') || !argv.includes(UI_FIXTURE_FLAG)) {
    throw new Error('UI fixture mode requires both --dev and --ui-fixture');
  }
  if (!hasOwn(UI_FIXTURE_RENDERER_URL_ENV) || !hasOwn(UI_FIXTURE_USER_DATA_ENV)) {
    throw new Error('UI fixture mode requires a complete launcher environment');
  }

  const rendererUrl = validateFixtureRendererUrl(env[UI_FIXTURE_RENDERER_URL_ENV]);
  const userDataPath = validateFixtureUserDataPath(env[UI_FIXTURE_USER_DATA_ENV], { tempRoot });
  assertUnusedFixtureDirectory(userDataPath);
  return Object.freeze({ enabled: true, userDataPath, rendererUrl });
}

module.exports = {
  UI_FIXTURE_FLAG,
  UI_FIXTURE_RENDERER_URL_ENV,
  UI_FIXTURE_USER_DATA_ENV,
  UI_FIXTURE_USER_DATA_PREFIX,
  isUiFixtureRequested,
  resolveUiFixtureMode,
  sanitizeFixtureEnvironment,
  validateFixtureRendererUrl,
  validateFixtureUserDataPath,
};
