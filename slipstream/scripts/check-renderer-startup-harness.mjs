import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SAMPLES_PER_SCENARIO,
  DEFAULT_WARMUPS_PER_SCENARIO,
  HARNESS_MARKER_FILE,
  HARNESS_PROTOCOL,
  MIN_CONTRACT_SAMPLES_PER_SCENARIO,
  SCENARIOS,
  assertPrivateDirectory,
  buildCounterbalancedPlan,
  buildSafeEnvironment,
  nearestRankPercentile,
  parseArguments,
  summarizeMetric,
} from './measure-renderer-startup.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptsDirectory);
const mainPath = path.join(scriptsDirectory, 'startup-harness', 'main.cjs');
const preloadPath = path.join(scriptsDirectory, 'startup-harness', 'preload.cjs');
const runnerPath = path.join(scriptsDirectory, 'measure-renderer-startup.mjs');
const packagePath = path.join(projectRoot, 'package.json');

async function readSource(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function listFiles(rootPath) {
  const files = [];
  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  await visit(rootPath);
  return files;
}

for (const filePath of [mainPath, preloadPath, runnerPath]) {
  const stat = await fs.stat(filePath);
  assert(stat.isFile(), `renderer startup harness file is missing: ${filePath}`);
}

const [mainSource, preloadSource, runnerSource, packageSource] = await Promise.all([
  readSource(mainPath),
  readSource(preloadPath),
  readSource(runnerPath),
  readSource(packagePath),
]);
const packageJson = JSON.parse(packageSource);

assert.equal(
  packageJson.scripts['measure:renderer-startup'],
  'node scripts/measure-renderer-startup.mjs',
  'the full renderer startup measurement command must stay explicit',
);
assert.equal(
  packageJson.scripts['measure:renderer-startup:smoke'],
  'node scripts/measure-renderer-startup.mjs --smoke',
  'the non-evidence smoke command must stay explicit',
);
assert.equal(
  packageJson.scripts['check:renderer-startup-harness'],
  'node scripts/check-renderer-startup-harness.mjs',
);
assert.match(
  packageJson.scripts.test,
  /check:renderer-startup-harness/u,
  'the isolation gate must remain in the full test suite',
);

const packagedConfiguration = JSON.stringify({
  files: packageJson.build?.files || [],
  extraResources: packageJson.build?.extraResources || [],
});
assert.doesNotMatch(
  packagedConfiguration,
  /startup-harness|measure-renderer-startup|renderer-harness-v1|SLIPSTREAM_RENDERER_HARNESS/iu,
  'formal artifacts must not include the private renderer harness',
);
assert.doesNotMatch(
  JSON.stringify(packageJson.build?.files || []),
  /scripts(?:\/\*\*\/\*|\/\*|\/\*\*)/iu,
  'formal build files must not broadly include scripts',
);

for (const productionPath of [
  path.join(projectRoot, 'src', 'main'),
  path.join(projectRoot, 'preload.js'),
  path.join(projectRoot, 'dist'),
]) {
  try {
    const stat = await fs.stat(productionPath);
    const files = stat.isDirectory() ? await listFiles(productionPath) : [productionPath];
    const contentsByFile = await Promise.all(files.map(async (filePath) => ({
      filePath,
      contents: await fs.readFile(filePath),
    })));
    for (const { filePath, contents } of contentsByFile) {
      assert.equal(
        contents.includes(Buffer.from(HARNESS_PROTOCOL)),
        false,
        `formal artifact contains the harness marker: ${path.relative(projectRoot, filePath)}`,
      );
      assert.equal(
        contents.includes(Buffer.from(HARNESS_MARKER_FILE)),
        false,
        `formal artifact contains the harness marker filename: ${path.relative(projectRoot, filePath)}`,
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

assert.match(mainSource, /const \{ app, BrowserWindow, session \} = require\('electron'\)/u);
assert.doesNotMatch(mainSource, /ipcMain|ipcRenderer|\bTray\b|globalShortcut|desktopCapturer|\bdialog\b/u);
assert.doesNotMatch(mainSource, /src\/main|(?:^|\/)preload\.js/u);
assert.match(mainSource, /app\.enableSandbox\(\)/u);
assert.match(mainSource, /show:\s*false/u);
assert.match(mainSource, /sandbox:\s*true/u);
assert.match(mainSource, /contextIsolation:\s*true/u);
assert.match(mainSource, /nodeIntegration:\s*false/u);
assert.match(mainSource, /webSecurity:\s*true/u);
assert.match(mainSource, /backgroundThrottling:\s*false/u);
assert.match(mainSource, /setPermissionRequestHandler/u);
assert.match(mainSource, /setPermissionCheckHandler/u);
assert.match(mainSource, /urls:\s*\['<all_urls>'\]/u);
assert.match(mainSource, /requestUrl\.protocol !== 'file:'/u);
assert.match(mainSource, /fs\.realpathSync\(fileURLToPath\(requestUrl\)\)/u);
assert.match(mainSource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u);
assert.match(mainSource, /will-navigate/u);
assert.match(mainSource, /will-redirect/u);
assert.match(mainSource, /will-attach-webview/u);
assert.match(mainSource, /windowWasShown \|\| window\.isVisible\(\)/u);
assert.match(mainSource, /unexpectedCalls\.length > 0/u);
assert.match(mainSource, /await nextFrame\(\);\s*await nextFrame\(\);/u);

assert.match(preloadSource, /const \{ contextBridge \} = require\('electron'\)/u);
assert.doesNotMatch(preloadSource, /ipcRenderer|ipcMain/u);
assert.doesNotMatch(preloadSource, /src\/main|(?:^|\/)preload\.js/u);
assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('api'/u);
assert.match(preloadSource, /fixed contract/u);
assert.match(preloadSource, /unexpectedCalls/u);
assert.match(preloadSource, /setupMode: scenario === 'first-use-setup'/u);

assert.doesNotMatch(runnerSource, /\.\.\.process\.env|Object\.assign\([^)]*process\.env/u);
assert.doesNotMatch(runnerSource, /src[\\/]main|require\([^)]*preload\.js/u);
assert.doesNotMatch(runnerSource, /clonePath\([^)]*node_modules/su);
assert.match(runnerSource, /path\.join\(sourceRoot, 'renderer'\)/u);
assert.match(runnerSource, /path\.join\(sourceRoot, 'shared'\)/u);
assert.match(runnerSource, /production renderer inputs changed during sampling/u);
assert.match(runnerSource, /options\.smoke\s*\? await existingRendererForSmoke\(\)/u);
assert.match(runnerSource, /Smoke mode validates harness plumbing only/u);
assert.match(runnerSource, /'--verify', '--deep', '--strict'/u);
assert.match(runnerSource, /'\/usr\/bin\/xattr', \['-cr', harnessApp\]/u);
assert.match(runnerSource, /assert\.deepEqual\(identityAfter, identityBefore/u);
assert.match(runnerSource, /mode: 0o700/u);
assert.match(runnerSource, /isSymbolicLink\(\)/u);
assert.match(runnerSource, /alternating ABBA\/BAAB counterbalanced blocks/u);
assert.match(runnerSource, /releaseClaimEligible: false/u);

assert(DEFAULT_SAMPLES_PER_SCENARIO >= 40);
assert(DEFAULT_WARMUPS_PER_SCENARIO >= 1);
assert(MIN_CONTRACT_SAMPLES_PER_SCENARIO >= 24);
const fullOptions = parseArguments([]);
assert.equal(fullOptions.samplesPerScenario, DEFAULT_SAMPLES_PER_SCENARIO);
assert.equal(fullOptions.warmupsPerScenario, DEFAULT_WARMUPS_PER_SCENARIO);
assert.equal(fullOptions.smoke, false);
const smokeOptions = parseArguments(['--smoke']);
assert.equal(smokeOptions.samplesPerScenario, 2);
assert.equal(smokeOptions.warmupsPerScenario, 0);
assert.equal(smokeOptions.smoke, true);
assert.throws(
  () => parseArguments(['--samples', String(MIN_CONTRACT_SAMPLES_PER_SCENARIO - 1)]),
  /full-contract runs require/u,
);

const [firstScenario, secondScenario] = SCENARIOS;
assert.deepEqual(buildCounterbalancedPlan(4), [
  firstScenario,
  secondScenario,
  secondScenario,
  firstScenario,
  secondScenario,
  firstScenario,
  firstScenario,
  secondScenario,
]);
const defaultPlan = buildCounterbalancedPlan(DEFAULT_SAMPLES_PER_SCENARIO);
assert.equal(defaultPlan.length, DEFAULT_SAMPLES_PER_SCENARIO * SCENARIOS.length);
for (const scenario of SCENARIOS) {
  assert.equal(defaultPlan.filter((entry) => entry === scenario).length, DEFAULT_SAMPLES_PER_SCENARIO);
}

const orderedValues = Array.from({ length: DEFAULT_SAMPLES_PER_SCENARIO }, (_, index) => index + 1);
const p95 = nearestRankPercentile(orderedValues, 0.95);
assert.equal(p95, 38);
assert.notEqual(p95, Math.max(...orderedValues));
assert.deepEqual(summarizeMetric(orderedValues, orderedValues.length), {
  count: DEFAULT_SAMPLES_PER_SCENARIO,
  unavailable: 0,
  p50Ms: 20,
  p95Ms: 38,
  maxMs: 40,
});
assert.deepEqual(summarizeMetric([null, null], 2), { count: 0, unavailable: 2 });

const safeEnvironment = buildSafeEnvironment({
  homePath: '/private/home',
  temporaryPath: '/private/tmp',
  harness: { SLIPSTREAM_RENDERER_HARNESS_SCENARIO: 'first-use-setup' },
});
assert.deepEqual(Object.keys(safeEnvironment).sort(), [
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SLIPSTREAM_RENDERER_HARNESS_SCENARIO',
  'TMPDIR',
]);
assert.equal(Object.hasOwn(safeEnvironment, 'DEEPSEEK_API_KEY'), false);

const privateTestRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'renderer-harness-path-test-'));
await fs.chmod(privateTestRoot, 0o700);
try {
  const childPath = path.join(privateTestRoot, 'child');
  const linkPath = path.join(privateTestRoot, 'link');
  await fs.mkdir(childPath, { mode: 0o700 });
  await fs.symlink(childPath, linkPath);
  assert.equal(await assertPrivateDirectory(privateTestRoot, childPath), await fs.realpath(childPath));
  await assert.rejects(
    assertPrivateDirectory(privateTestRoot, linkPath),
    /unsafe component|symbolic path/u,
  );
} finally {
  await fs.rm(privateTestRoot, { recursive: true, force: false });
}

console.log('Capability-minimized renderer startup harness isolation checks passed.');
