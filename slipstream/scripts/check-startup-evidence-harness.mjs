import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  HARNESS_MARKER_FILE,
  HARNESS_PROTOCOL,
  SCENARIOS,
  buildSafeEnvironment,
  parseArguments,
  pngDimensions,
  runStartupEvidenceCapture,
} from './capture-startup-evidence.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptsDirectory);
const mainPath = path.join(scriptsDirectory, 'startup-evidence-harness', 'main.cjs');
const preloadPath = path.join(scriptsDirectory, 'startup-evidence-harness', 'preload.cjs');
const runnerPath = path.join(scriptsDirectory, 'capture-startup-evidence.mjs');
const packagePath = path.join(projectRoot, 'package.json');

function assertBefore(source, earlier, later, message) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assert.notEqual(earlierIndex, -1, `missing source contract: ${earlier}`);
  assert.notEqual(laterIndex, -1, `missing source contract: ${later}`);
  assert(earlierIndex < laterIndex, message);
}

function parseCheckArguments(argv) {
  if (argv.length === 0) return { runtime: false };
  if (argv.length === 1 && argv[0] === '--runtime') return { runtime: true };
  throw new Error('usage: node scripts/check-startup-evidence-harness.mjs [--runtime]');
}

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
      else throw new Error(`unsupported production entry: ${entryPath}`);
    }
  }
  await visit(rootPath);
  return files;
}

const options = parseCheckArguments(process.argv.slice(2));
for (const filePath of [mainPath, preloadPath, runnerPath]) {
  const stat = await fs.stat(filePath);
  assert(stat.isFile(), `startup evidence harness file is missing: ${filePath}`);
}

const [mainSource, preloadSource, runnerSource, packageSource] = await Promise.all([
  readSource(mainPath),
  readSource(preloadPath),
  readSource(runnerPath),
  readSource(packagePath),
]);
const packageJson = JSON.parse(packageSource);

assert.equal(
  packageJson.scripts['capture:startup-evidence'],
  'node scripts/capture-startup-evidence.mjs',
);
assert.equal(
  packageJson.scripts['check:startup-evidence-harness'],
  'node scripts/check-startup-evidence-harness.mjs',
);
assert.equal(
  packageJson.scripts['check:startup-evidence-harness:runtime'],
  'node scripts/check-startup-evidence-harness.mjs --runtime',
);
assert.match(
  packageJson.scripts.test,
  /check:startup-evidence-harness/u,
  'the startup evidence isolation gate must remain in the full test suite',
);

const packagedConfiguration = JSON.stringify({
  files: packageJson.build?.files || [],
  extraResources: packageJson.build?.extraResources || [],
});
assert.doesNotMatch(
  packagedConfiguration,
  /startup-evidence-harness|capture-startup-evidence|SLIPSTREAM_STARTUP_EVIDENCE/iu,
  'formal artifacts must not include the private startup evidence harness',
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
    for (const filePath of files) {
      const contents = await fs.readFile(filePath);
      assert.equal(
        contents.includes(Buffer.from(HARNESS_PROTOCOL)),
        false,
        `formal artifact contains the evidence harness marker: ${path.relative(projectRoot, filePath)}`,
      );
      assert.equal(
        contents.includes(Buffer.from(HARNESS_MARKER_FILE)),
        false,
        `formal artifact contains the marker filename: ${path.relative(projectRoot, filePath)}`,
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

assert.match(mainSource, /const \{ app, BrowserWindow, session \} = require\('electron'\)/u);
assert.doesNotMatch(mainSource, /ipcMain|ipcRenderer|desktopCapturer|globalShortcut|\bTray\b|\bdialog\b/u);
assert.doesNotMatch(mainSource, /src\/main|(?:^|\/)preload\.js/u);
assert.match(mainSource, /app\.enableSandbox\(\)/u);
assert.match(mainSource, /width:\s*WIDTH/u);
assert.match(mainSource, /height:\s*HEIGHT/u);
assert.match(mainSource, /useContentSize:\s*true/u);
assert.match(mainSource, /show:\s*false/u);
assert.match(mainSource, /contextIsolation:\s*true/u);
assert.match(mainSource, /nodeIntegration:\s*false/u);
assert.match(mainSource, /sandbox:\s*true/u);
assert.match(mainSource, /webSecurity:\s*true/u);
assert.match(mainSource, /webviewTag:\s*false/u);
assert.match(mainSource, /setPermissionRequestHandler/u);
assert.match(mainSource, /setPermissionCheckHandler/u);
assert.match(mainSource, /urls:\s*\['<all_urls>'\]/u);
assert.match(mainSource, /requestUrl\.protocol !== 'file:'/u);
assert.match(mainSource, /will-download/u);
assert.match(mainSource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u);
assert.match(mainSource, /will-navigate/u);
assert.match(mainSource, /will-redirect/u);
assert.match(mainSource, /will-attach-webview/u);
assert.match(mainSource, /windowWasShown \|\| window\.isVisible\(\)/u);
assert.match(mainSource, /capturePage/u);
assert.match(mainSource, /Number\.isFinite\(devicePixelRatio\)/u);
assert.match(mainSource, /devicePixelRatio < 1/u);
assert.match(mainSource, /devicePixelRatio > 4/u);
assert.match(mainSource, /Math\.round\(WIDTH \* devicePixelRatio\)/u);
assert.match(mainSource, /Math\.round\(HEIGHT \* devicePixelRatio\)/u);
assert.match(mainSource, /rawSize\.width !== expectedRawWidth/u);
assert.match(mainSource, /rawSize\.height !== expectedRawHeight/u);
assert.match(mainSource, /Math\.abs\(horizontalScale - verticalScale\) > scaleTolerance/u);
assert.match(mainSource, /const normalizationApplied = devicePixelRatio !== 1/u);
assert.match(
  mainSource,
  /normalizationApplied\s*\? rawImage\.resize\(\{ width: WIDTH, height: HEIGHT, quality: 'best' \}\)/u,
);
assertBefore(
  mainSource,
  'rawSize.width !== expectedRawWidth',
  'rawImage.resize',
  'raw dimensions must be validated against DPR before normalization',
);
assertBefore(
  mainSource,
  'Math.abs(horizontalScale - verticalScale) > scaleTolerance',
  'rawImage.resize',
  'axis scale consistency must be validated before normalization',
);
assert.match(mainSource, /flag:\s*'wx'/u);
assert.match(mainSource, /await nextFrame\(\);\s*await nextFrame\(\);/u);
assert.match(mainSource, /document\.activeElement === primary/u);
assert.match(mainSource, /document\.activeElement === textarea/u);

assert.match(preloadSource, /const \{ contextBridge \} = require\('electron'\)/u);
assert.doesNotMatch(preloadSource, /ipcRenderer|ipcMain/u);
assert.doesNotMatch(preloadSource, /src\/main|(?:^|\/)preload\.js/u);
assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('api'/u);
assert.match(preloadSource, /return new Promise\(\(\) => \{\}\)/u);
assert.match(preloadSource, /scenario === 'startup-loading'/u);
assert.match(preloadSource, /This evidence-only fixed contract has no native event source/u);
assert.match(preloadSource, /unexpectedCalls/u);

assert.doesNotMatch(runnerSource, /\.\.\.process\.env|Object\.assign\([^)]*process\.env/u);
assert.doesNotMatch(runnerSource, /src[\\/]main|require\([^)]*preload\.js/u);
assert.match(runnerSource, /mode:\s*0o700/u);
assert.match(runnerSource, /fs\.mkdtemp/u);
assert.match(runnerSource, /freshProfilePerScenario:\s*true/u);
assert.match(runnerSource, /distinctHomeTmpUserDataSessionData:\s*true/u);
assert.match(runnerSource, /fs\.cp\(sourceManifest\.resolvedRoot/u);
assert.match(runnerSource, /sourceAfterCopy\.manifestSha256/u);
assert.match(runnerSource, /fsConstants\.COPYFILE_EXCL/u);
assert.match(runnerSource, /flag:\s*'wx'/u);
assert.match(runnerSource, /pngDimensions/u);
assert.match(
  runnerSource,
  /result\.rawWidth, Math\.round\(CAPTURE_WIDTH \* result\.devicePixelRatio\)/u,
);
assert.match(
  runnerSource,
  /result\.rawHeight, Math\.round\(CAPTURE_HEIGHT \* result\.devicePixelRatio\)/u,
);
assert.match(runnerSource, /result\.normalizationApplied, result\.devicePixelRatio !== 1/u);
assert.match(runnerSource, /releaseClaimEligible:\s*false/u);
assert.match(runnerSource, /removePrivateRoot/u);

assert.deepEqual(parseArguments([]), { publish: true });
assert.deepEqual(parseArguments(['--no-publish']), { publish: false });
assert.throws(() => parseArguments(['--output', '/tmp/unsafe']), /usage/u);

const safeEnvironment = buildSafeEnvironment({
  scenario: 'first-use-setup',
  profileRoot: '/private/profile',
  homePath: '/private/profile/home',
  temporaryPath: '/private/profile/tmp',
  userDataPath: '/private/profile/user-data',
  sessionDataPath: '/private/profile/session-data',
  captureRoot: '/private/profile/captures',
  outputPath: '/private/profile/captures/first-use-setup.png',
});
assert.deepEqual(Object.keys(safeEnvironment).sort(), [
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SLIPSTREAM_STARTUP_EVIDENCE_CAPTURE_ROOT',
  'SLIPSTREAM_STARTUP_EVIDENCE_OUTPUT_PATH',
  'SLIPSTREAM_STARTUP_EVIDENCE_PROFILE_ROOT',
  'SLIPSTREAM_STARTUP_EVIDENCE_SCENARIO',
  'SLIPSTREAM_STARTUP_EVIDENCE_SESSION_DATA',
  'SLIPSTREAM_STARTUP_EVIDENCE_USER_DATA',
  'TMPDIR',
]);
assert.equal(safeEnvironment.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
for (const secretName of [
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'NODE_OPTIONS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
]) {
  assert.equal(Object.hasOwn(safeEnvironment, secretName), false);
}

const minimalPngHeader = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(minimalPngHeader, 0);
minimalPngHeader.write('IHDR', 12, 'ascii');
minimalPngHeader.writeUInt32BE(CAPTURE_WIDTH, 16);
minimalPngHeader.writeUInt32BE(CAPTURE_HEIGHT, 20);
assert.deepEqual(pngDimensions(minimalPngHeader), {
  width: CAPTURE_WIDTH,
  height: CAPTURE_HEIGHT,
});
assert.equal(SCENARIOS.length, 3);
assert.deepEqual(SCENARIOS.map((entry) => entry.fileName), [
  '01-startup-loading.png',
  '02-first-use-setup.png',
  '03-returning-capture.png',
]);

if (options.runtime) {
  const proof = await runStartupEvidenceCapture({ publish: false });
  assert.equal(proof.protocol, HARNESS_PROTOCOL);
  assert.equal(proof.releaseClaimEligible, false);
  assert.equal(proof.scenarios.length, SCENARIOS.length);
  for (const scenarioProof of proof.scenarios) {
    assert.equal(scenarioProof.width, CAPTURE_WIDTH);
    assert.equal(scenarioProof.height, CAPTURE_HEIGHT);
    assert(Number.isFinite(scenarioProof.devicePixelRatio));
    assert(scenarioProof.devicePixelRatio >= 1 && scenarioProof.devicePixelRatio <= 4);
    assert.equal(
      scenarioProof.rawWidth,
      Math.round(CAPTURE_WIDTH * scenarioProof.devicePixelRatio),
    );
    assert.equal(
      scenarioProof.rawHeight,
      Math.round(CAPTURE_HEIGHT * scenarioProof.devicePixelRatio),
    );
    assert(
      Math.abs(
        (scenarioProof.rawWidth / CAPTURE_WIDTH)
          - (scenarioProof.rawHeight / CAPTURE_HEIGHT),
      ) <= (1 / Math.min(CAPTURE_WIDTH, CAPTURE_HEIGHT)),
    );
    assert.equal(
      scenarioProof.normalizationApplied,
      scenarioProof.devicePixelRatio !== 1,
    );
    assert.equal(scenarioProof.windowVisible, false);
    assert.equal(scenarioProof.unexpectedAdapterCalls, 0);
    if (scenarioProof.focusExpected) assert.equal(scenarioProof.focusMatched, true);
  }
}

console.log(
  options.runtime
    ? 'Startup evidence harness static and isolated runtime checks passed.'
    : 'Startup evidence harness static isolation checks passed.',
);
