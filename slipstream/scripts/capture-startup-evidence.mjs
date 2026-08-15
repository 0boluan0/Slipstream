import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_PROTOCOL = 'SLIPSTREAM_STARTUP_EVIDENCE_HARNESS_V1';
export const HARNESS_MARKER_FILE = '.slipstream-startup-evidence-harness-v1';
export const CAPTURE_WIDTH = 520;
export const CAPTURE_HEIGHT = 680;
export const SCENARIOS = Object.freeze([
  Object.freeze({ scenario: 'startup-loading', fileName: '01-startup-loading.png' }),
  Object.freeze({ scenario: 'first-use-setup', fileName: '02-first-use-setup.png' }),
  Object.freeze({ scenario: 'returning-capture', fileName: '03-returning-capture.png' }),
]);

const require = createRequire(import.meta.url);
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptsDirectory);
const workspaceRoot = path.dirname(projectRoot);
const harnessSourceRoot = path.join(scriptsDirectory, 'startup-evidence-harness');
const rendererSourceRoot = path.join(projectRoot, 'dist', 'renderer');
const evidenceDirectory = path.join(
  workspaceRoot,
  'docs',
  'ux-evidence',
  '2026-07-31-startup-readiness-performance',
);
const PROOF_FILE_NAME = '05-startup-evidence-proof.json';
const PRIVATE_ROOT_PREFIX = 'slipstream-startup-evidence-';
const CHILD_OUTPUT_PREFIX = `${HARNESS_PROTOCOL}:`;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;

async function createPrivateDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { mode: 0o700 });
  await fs.chmod(directoryPath, 0o700);
  return directoryPath;
}

async function assertDirectoryNoSymlink(directoryPath, label, expectedMode = null) {
  const lexicalPath = path.resolve(directoryPath);
  const stat = await fs.lstat(lexicalPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} is not a direct directory`);
  }
  if (expectedMode !== null && (stat.mode & 0o777) !== expectedMode) {
    throw new Error(`${label} permissions are not ${expectedMode.toString(8)}`);
  }
  const resolvedPath = await fs.realpath(lexicalPath);
  if (resolvedPath !== lexicalPath) throw new Error(`${label} uses a symbolic path`);
  return resolvedPath;
}

async function listSafeFiles(rootPath) {
  const resolvedRoot = await assertDirectoryNoSymlink(rootPath, 'renderer source');
  const files = [];

  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentPath, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error('renderer source contains a symbolic link');
      if (stat.isDirectory()) await visit(entryPath);
      else if (stat.isFile()) files.push(entryPath);
      else throw new Error('renderer source contains an unsupported entry');
    }
  }

  await visit(resolvedRoot);
  return { resolvedRoot, files };
}

async function rendererManifest(rootPath) {
  const { resolvedRoot, files } = await listSafeFiles(rootPath);
  const manifest = [];
  let byteLength = 0;
  for (const filePath of files) {
    const bytes = await fs.readFile(filePath);
    byteLength += bytes.length;
    manifest.push({
      path: path.relative(resolvedRoot, filePath).split(path.sep).join('/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const manifestSha256 = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
  return {
    resolvedRoot,
    files: manifest,
    fileCount: manifest.length,
    byteLength,
    manifestSha256,
  };
}

async function makeTreePrivate(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await makeTreePrivate(entryPath);
      await fs.chmod(entryPath, 0o700);
    } else if (entry.isFile()) {
      await fs.chmod(entryPath, 0o600);
    } else {
      throw new Error('private app copy contains an unsupported entry');
    }
  }));
  await fs.chmod(rootPath, 0o700);
}

async function copyPrivateApp(privateRoot) {
  const sourceManifest = await rendererManifest(rendererSourceRoot);
  const appRoot = await createPrivateDirectory(path.join(privateRoot, 'app'));
  const privateRendererRoot = path.join(appRoot, 'dist', 'renderer');
  await fs.mkdir(path.dirname(privateRendererRoot), { recursive: true, mode: 0o700 });
  await fs.cp(sourceManifest.resolvedRoot, privateRendererRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
  });

  const sourceAfterCopy = await rendererManifest(rendererSourceRoot);
  assert.equal(
    sourceAfterCopy.manifestSha256,
    sourceManifest.manifestSha256,
    'renderer source changed while preparing startup evidence',
  );
  const copiedManifest = await rendererManifest(privateRendererRoot);
  assert.deepEqual(
    copiedManifest.files,
    sourceManifest.files,
    'private renderer copy does not match the current dist',
  );

  const packageJson = JSON.stringify({
    name: 'slipstream-startup-evidence-private',
    version: '0.0.0',
    private: true,
    main: 'main.cjs',
  });
  await fs.writeFile(path.join(appRoot, 'package.json'), packageJson, {
    flag: 'wx',
    mode: 0o600,
  });
  await fs.copyFile(
    path.join(harnessSourceRoot, 'main.cjs'),
    path.join(appRoot, 'main.cjs'),
    fsConstants.COPYFILE_EXCL,
  );
  await fs.copyFile(
    path.join(harnessSourceRoot, 'preload.cjs'),
    path.join(appRoot, 'preload.cjs'),
    fsConstants.COPYFILE_EXCL,
  );
  await fs.writeFile(path.join(appRoot, HARNESS_MARKER_FILE), `${HARNESS_PROTOCOL}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await makeTreePrivate(appRoot);

  return {
    appRoot,
    renderer: {
      source: 'slipstream/dist/renderer',
      fileCount: sourceManifest.fileCount,
      byteLength: sourceManifest.byteLength,
      manifestSha256: sourceManifest.manifestSha256,
    },
  };
}

export function buildSafeEnvironment({
  scenario,
  profileRoot,
  homePath,
  temporaryPath,
  userDataPath,
  sessionDataPath,
  captureRoot,
  outputPath,
}) {
  return {
    HOME: homePath,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    SLIPSTREAM_STARTUP_EVIDENCE_CAPTURE_ROOT: captureRoot,
    SLIPSTREAM_STARTUP_EVIDENCE_OUTPUT_PATH: outputPath,
    SLIPSTREAM_STARTUP_EVIDENCE_PROFILE_ROOT: profileRoot,
    SLIPSTREAM_STARTUP_EVIDENCE_SCENARIO: scenario,
    SLIPSTREAM_STARTUP_EVIDENCE_SESSION_DATA: sessionDataPath,
    SLIPSTREAM_STARTUP_EVIDENCE_USER_DATA: userDataPath,
    TMPDIR: temporaryPath,
  };
}

export function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buffer.length >= 24, 'PNG is too short');
  assert(buffer.subarray(0, 8).equals(signature), 'PNG signature is invalid');
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR', 'PNG has no leading IHDR chunk');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function createScenarioProfile(privateRoot, scenario) {
  const profilesRoot = path.join(privateRoot, 'profiles');
  try {
    await createPrivateDirectory(profilesRoot);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const profileRoot = await createPrivateDirectory(path.join(profilesRoot, scenario));
  const homePath = await createPrivateDirectory(path.join(profileRoot, 'home'));
  const temporaryPath = await createPrivateDirectory(path.join(profileRoot, 'tmp'));
  const userDataPath = await createPrivateDirectory(path.join(profileRoot, 'user-data'));
  const sessionDataPath = await createPrivateDirectory(path.join(profileRoot, 'session-data'));
  const captureRoot = await createPrivateDirectory(path.join(profileRoot, 'captures'));
  const outputPath = path.join(captureRoot, `${scenario}.png`);
  return {
    profileRoot,
    homePath,
    temporaryPath,
    userDataPath,
    sessionDataPath,
    captureRoot,
    outputPath,
  };
}

function runChild({ electronExecutable, appRoot, env, scenario }) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExecutable, [appRoot], {
      cwd: appRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrBytes = 0;
    let stderrLineCount = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1000).unref();
    }, 25000);

    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length <= MAX_CHILD_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      stderrLineCount += chunk.toString('utf8').split('\n').length - 1;
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const messages = stdout
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(CHILD_OUTPUT_PREFIX))
        .map((line) => JSON.parse(line.slice(CHILD_OUTPUT_PREFIX.length)));
      const success = messages.findLast((message) => message.type === 'success');
      const failure = messages.findLast((message) => message.type === 'failure');
      if (code !== 0 || !success) {
        reject(new Error(
          `startup evidence child failed for ${scenario} `
          + `(code=${String(code)}, signal=${String(signal)}, `
          + `reason=${failure?.reason || 'no structured result'}, `
          + `stderrBytes=${stderrBytes}, stderrLines=${stderrLineCount})`,
        ));
        return;
      }
      resolve({ ...success, stderrBytes, stderrLineCount });
    });
  });
}

async function captureScenario({ electronExecutable, appRoot, privateRoot, entry }) {
  const profile = await createScenarioProfile(privateRoot, entry.scenario);
  const env = buildSafeEnvironment({ scenario: entry.scenario, ...profile });
  const result = await runChild({
    electronExecutable,
    appRoot,
    env,
    scenario: entry.scenario,
  });
  const png = await fs.readFile(profile.outputPath);
  const dimensions = pngDimensions(png);
  assert.deepEqual(dimensions, { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT });
  assert.equal(result.width, CAPTURE_WIDTH);
  assert.equal(result.height, CAPTURE_HEIGHT);
  assert(Number.isFinite(result.devicePixelRatio));
  assert(result.devicePixelRatio >= 1 && result.devicePixelRatio <= 4);
  assert.equal(result.rawWidth, Math.round(CAPTURE_WIDTH * result.devicePixelRatio));
  assert.equal(result.rawHeight, Math.round(CAPTURE_HEIGHT * result.devicePixelRatio));
  assert(
    Math.abs(
      (result.rawWidth / CAPTURE_WIDTH) - (result.rawHeight / CAPTURE_HEIGHT),
    ) <= (1 / Math.min(CAPTURE_WIDTH, CAPTURE_HEIGHT)),
  );
  assert.equal(result.normalizationApplied, result.devicePixelRatio !== 1);
  assert.equal(result.windowVisible, false);
  assert.equal(result.unexpectedAdapterCalls, 0);
  if (result.focusExpected) assert.equal(result.focusMatched, true);

  return {
    entry,
    png,
    proof: {
      scenario: entry.scenario,
      file: entry.fileName,
      width: dimensions.width,
      height: dimensions.height,
      rawWidth: result.rawWidth,
      rawHeight: result.rawHeight,
      devicePixelRatio: result.devicePixelRatio,
      normalizationApplied: result.normalizationApplied,
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      semanticTarget: result.semanticTarget,
      documentReadyState: result.documentReadyState,
      focusExpected: result.focusExpected,
      focusMatched: result.focusMatched,
      geometry: result.geometry,
      windowVisible: result.windowVisible,
      unexpectedAdapterCalls: result.unexpectedAdapterCalls,
      adapterInvokeCounts: result.adapterInvokeCounts,
      adapterSubscriptionCounts: result.adapterSubscriptionCounts,
    },
  };
}

async function ensureEvidenceDirectory() {
  const evidenceParent = path.dirname(evidenceDirectory);
  await assertDirectoryNoSymlink(evidenceParent, 'UX evidence parent');
  try {
    await createPrivateDirectory(evidenceDirectory);
    await fs.chmod(evidenceDirectory, 0o755);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const resolvedDirectory = await assertDirectoryNoSymlink(
    evidenceDirectory,
    'startup evidence directory',
  );
  if (resolvedDirectory !== path.resolve(evidenceDirectory)) {
    throw new Error('startup evidence directory is not the expected target');
  }
  return resolvedDirectory;
}

async function assertFreshEvidenceTargets(outputDirectory) {
  for (const fileName of [...SCENARIOS.map((entry) => entry.fileName), PROOF_FILE_NAME]) {
    const targetPath = path.join(outputDirectory, fileName);
    if (path.dirname(targetPath) !== outputDirectory) throw new Error('unsafe evidence filename');
    try {
      await fs.lstat(targetPath);
      throw new Error(`refusing to overwrite existing evidence: ${fileName}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function publishEvidence(captures, proof) {
  const outputDirectory = await ensureEvidenceDirectory();
  await assertFreshEvidenceTargets(outputDirectory);
  for (const capture of captures) {
    const targetPath = path.join(outputDirectory, capture.entry.fileName);
    await fs.writeFile(targetPath, capture.png, { flag: 'wx', mode: 0o644 });
    const written = await fs.readFile(targetPath);
    assert.deepEqual(pngDimensions(written), {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
    });
    assert.equal(
      createHash('sha256').update(written).digest('hex'),
      capture.proof.sha256,
    );
  }

  const proofText = `${JSON.stringify(proof, null, 2)}\n`;
  assert.doesNotMatch(
    proofText,
    /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|BEGIN (?:RSA )?PRIVATE KEY)/u,
    'proof unexpectedly contains secret-like material',
  );
  await fs.writeFile(path.join(outputDirectory, PROOF_FILE_NAME), proofText, {
    flag: 'wx',
    mode: 0o644,
  });
}

async function removePrivateRoot(privateRoot) {
  const resolvedTemporaryRoot = await fs.realpath(os.tmpdir());
  const resolvedPrivateRoot = await fs.realpath(privateRoot);
  if (
    path.dirname(resolvedPrivateRoot) !== resolvedTemporaryRoot
    || !path.basename(resolvedPrivateRoot).startsWith(PRIVATE_ROOT_PREFIX)
  ) {
    throw new Error('refusing to remove an unowned private root');
  }
  await fs.rm(resolvedPrivateRoot, { recursive: true, force: false, maxRetries: 2 });
}

export async function runStartupEvidenceCapture({ publish = true } = {}) {
  const electronExecutable = path.resolve(require('electron'));
  await fs.access(electronExecutable, fsConstants.X_OK);
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const privateRoot = await fs.mkdtemp(path.join(temporaryRoot, PRIVATE_ROOT_PREFIX));
  await fs.chmod(privateRoot, 0o700);

  try {
    const { appRoot, renderer } = await copyPrivateApp(privateRoot);
    const captures = [];
    for (const entry of SCENARIOS) {
      captures.push(await captureScenario({
        electronExecutable,
        appRoot,
        privateRoot,
        entry,
      }));
    }

    const proof = {
      protocol: HARNESS_PROTOCOL,
      generatedAt: new Date().toISOString(),
      evidenceScope: 'hidden renderer startup-state screenshots from the current local dist',
      releaseClaimEligible: false,
      renderer,
      isolation: {
        privateTemporaryRootMode: '0700',
        freshProfilePerScenario: true,
        distinctHomeTmpUserDataSessionData: true,
        rendererNetworkDenied: true,
        permissionsDenied: true,
        downloadsDenied: true,
        navigationRedirectsPopupsWebviewsDenied: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        hiddenWindow: true,
        contentSize: `${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`,
        outputCreatedWithoutOverwrite: true,
      },
      scenarios: captures.map((capture) => capture.proof),
      limitations: [
        'Hidden capture does not prove Finder, Gatekeeper, compositor-visible, or first-install launch behavior.',
        'The renderer is the current local dist and is not a signed or notarized release artifact.',
        'The fixed in-memory preload exposes no production IPC or native capabilities.',
      ],
    };

    if (publish) await publishEvidence(captures, proof);
    return proof;
  } finally {
    await removePrivateRoot(privateRoot);
  }
}

export function parseArguments(argv) {
  if (argv.length === 0) return { publish: true };
  if (argv.length === 1 && argv[0] === '--no-publish') return { publish: false };
  throw new Error('usage: node scripts/capture-startup-evidence.mjs [--no-publish]');
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const options = parseArguments(process.argv.slice(2));
  runStartupEvidenceCapture(options)
    .then((proof) => process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`Startup evidence capture failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
