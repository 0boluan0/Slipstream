#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HARNESS_PROTOCOL = 'SLIPSTREAM_RENDERER_HARNESS_V1';
export const HARNESS_BUNDLE_ID = 'com.slipstream.renderer-harness.v1';
export const HARNESS_MARKER_FILE = 'renderer-harness-v1.marker';
export const DEFAULT_SAMPLES_PER_SCENARIO = 40;
export const DEFAULT_WARMUPS_PER_SCENARIO = 5;
export const MIN_CONTRACT_SAMPLES_PER_SCENARIO = 24;
export const SCENARIOS = Object.freeze(['first-use-setup', 'returning-capture']);

const OUTPUT_PREFIX = `${HARNESS_PROTOCOL}:`;
const TEMP_PREFIX = 'slipstream-renderer-harness-';
const DIAGNOSTIC_DIRECTORY = 'slipstream-renderer-harness-diagnostics';
const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const projectRoot = path.dirname(scriptsDirectory);
const sourceRoot = path.join(projectRoot, 'src');
const harnessTemplateRoot = path.join(scriptsDirectory, 'startup-harness');
let activeChild = null;

function roundMs(value) {
  return Number(value.toFixed(3));
}

export function nearestRankPercentile(values, percentile) {
  assert(Array.isArray(values) && values.length > 0, 'percentile requires values');
  assert(percentile > 0 && percentile <= 1, 'percentile must be in (0, 1]');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

export function summarizeMetric(values, expectedCount) {
  const available = values.filter(Number.isFinite);
  if (available.length === 0) {
    return { count: 0, unavailable: expectedCount };
  }
  return {
    count: available.length,
    unavailable: expectedCount - available.length,
    p50Ms: roundMs(nearestRankPercentile(available, 0.5)),
    p95Ms: roundMs(nearestRankPercentile(available, 0.95)),
    maxMs: roundMs(Math.max(...available)),
  };
}

export function buildCounterbalancedPlan(countPerScenario) {
  assert(Number.isInteger(countPerScenario) && countPerScenario > 0);
  const counts = Object.fromEntries(SCENARIOS.map((scenario) => [scenario, 0]));
  const [first, second] = SCENARIOS;
  const blocks = [
    [first, second, second, first],
    [second, first, first, second],
  ];
  const plan = [];
  let blockIndex = 0;

  while (SCENARIOS.some((scenario) => counts[scenario] < countPerScenario)) {
    for (const scenario of blocks[blockIndex % blocks.length]) {
      if (counts[scenario] >= countPerScenario) continue;
      plan.push(scenario);
      counts[scenario] += 1;
    }
    blockIndex += 1;
  }
  return plan;
}

function parsePositiveInteger(value, name, { allowZero = false } = {}) {
  if (!/^[0-9]+$/u.test(String(value))) throw new Error(`${name} must be an integer`);
  const parsed = Number.parseInt(value, 10);
  if ((!allowZero && parsed < 1) || (allowZero && parsed < 0)) {
    throw new Error(`${name} is outside its allowed range`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    samplesPerScenario: DEFAULT_SAMPLES_PER_SCENARIO,
    warmupsPerScenario: DEFAULT_WARMUPS_PER_SCENARIO,
    smoke: false,
  };
  let samplesExplicit = false;
  let warmupsExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--smoke') {
      options.smoke = true;
      continue;
    }
    if (argument === '--samples') {
      options.samplesPerScenario = parsePositiveInteger(argv[index + 1], '--samples');
      samplesExplicit = true;
      index += 1;
      continue;
    }
    if (argument === '--warmups') {
      options.warmupsPerScenario = parsePositiveInteger(
        argv[index + 1],
        '--warmups',
        { allowZero: true },
      );
      warmupsExplicit = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (options.smoke && !samplesExplicit) options.samplesPerScenario = 2;
  if (options.smoke && !warmupsExplicit) options.warmupsPerScenario = 0;

  if (!options.smoke && options.samplesPerScenario < MIN_CONTRACT_SAMPLES_PER_SCENARIO) {
    throw new Error(
      `full-contract runs require at least ${MIN_CONTRACT_SAMPLES_PER_SCENARIO} samples per scenario`,
    );
  }
  if (options.smoke && options.samplesPerScenario > 4) {
    throw new Error('smoke runs are limited to four samples per scenario');
  }
  return Object.freeze(options);
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function modeBits(stat) {
  return stat.mode & 0o777;
}

export async function assertPrivateDirectory(rootPath, candidatePath, { allowRoot = false } = {}) {
  const resolvedRoot = await fs.realpath(rootPath);
  const lexicalRoot = path.resolve(rootPath);
  const suppliedCandidate = path.resolve(candidatePath);
  let lexicalCandidate;
  if (suppliedCandidate === lexicalRoot) {
    lexicalCandidate = resolvedRoot;
  } else if (isInside(lexicalRoot, suppliedCandidate)) {
    lexicalCandidate = path.join(resolvedRoot, path.relative(lexicalRoot, suppliedCandidate));
  } else {
    lexicalCandidate = suppliedCandidate;
  }
  if ((!allowRoot && !isInside(resolvedRoot, lexicalCandidate))
    || (allowRoot && lexicalCandidate !== resolvedRoot && !isInside(resolvedRoot, lexicalCandidate))) {
    throw new Error('private directory escaped its owner root');
  }

  const rootStat = await fs.lstat(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || modeBits(rootStat) !== 0o700) {
    throw new Error('private owner root is unsafe');
  }

  if (lexicalCandidate !== resolvedRoot) {
    const relative = path.relative(resolvedRoot, lexicalCandidate);
    let cursor = resolvedRoot;
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component);
      const stat = await fs.lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink() || modeBits(stat) !== 0o700) {
        throw new Error('private directory has an unsafe component');
      }
    }
  }
  const resolvedCandidate = await fs.realpath(lexicalCandidate);
  if (resolvedCandidate !== lexicalCandidate) {
    throw new Error('private directory uses a symbolic path');
  }
  return resolvedCandidate;
}

async function createPrivateDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: false, mode: 0o700 });
  await fs.chmod(directoryPath, 0o700);
  return directoryPath;
}

export function buildSafeEnvironment({ homePath, temporaryPath, harness = {} }) {
  const environment = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: homePath,
    TMPDIR: temporaryPath.endsWith(path.sep) ? temporaryPath : `${temporaryPath}${path.sep}`,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ...harness,
  };
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`safe environment value is invalid: ${name}`);
    }
  }
  return Object.freeze(environment);
}

function collectStream(stream, maximumBytes = 256 * 1024) {
  return new Promise((resolve) => {
    let output = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (output.length < maximumBytes) output += chunk.slice(0, maximumBytes - output.length);
    });
    stream.on('end', () => resolve(output));
  });
}

async function runCommand(executable, args, { cwd, env, label }) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const stdoutPromise = collectStream(child.stdout);
  const stderrPromise = collectStream(child.stderr);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (result.code !== 0) {
    const error = new Error(`${label} failed`);
    error.code = 'command-failed';
    error.commandLabel = label;
    error.commandOutput = `${stdout}\n${stderr}`;
    throw error;
  }
  return { stdout, stderr };
}

async function clonePath(sourcePath, destinationPath, environment, label) {
  await runCommand('/bin/cp', ['-cR', sourcePath, destinationPath], {
    cwd: path.dirname(destinationPath),
    env: environment,
    label,
  });
}

async function hashTree(rootPath) {
  const records = [];

  async function visit(directoryPath, relativeDirectory = '') {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        records.push({ type: 'L', relativePath, target: await fs.readlink(fullPath) });
      } else if (entry.isDirectory()) {
        records.push({ type: 'D', relativePath });
        await visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        records.push({ type: 'F', relativePath, fullPath });
      } else {
        throw new Error('payload contains an unsupported filesystem entry');
      }
    }));
  }

  await visit(rootPath);
  const completedRecords = await Promise.all(records.map(async (record) => {
    if (record.type !== 'F') return record;
    const contents = await fs.readFile(record.fullPath);
    return {
      type: record.type,
      relativePath: record.relativePath,
      size: contents.length,
      contentSha256: createHash('sha256').update(contents).digest('hex'),
    };
  }));
  completedRecords.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const hash = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;
  for (const record of completedRecords) {
    if (record.type === 'L') {
      hash.update(`L\0${record.relativePath}\0${record.target}\0`);
    } else if (record.type === 'D') {
      hash.update(`D\0${record.relativePath}\0`);
    } else {
      hash.update(`F\0${record.relativePath}\0${record.size}\0${record.contentSha256}\0`);
      fileCount += 1;
      totalBytes += record.size;
    }
  }
  return Object.freeze({
    sha256: hash.digest('hex'),
    fileCount,
    totalBytes,
  });
}

async function readPlistValue(plistPath, key, environment) {
  const result = await runCommand(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', plistPath],
    { cwd: projectRoot, env: environment, label: `read bundle ${key}` },
  );
  return result.stdout.trim();
}

async function replacePlistValue(plistPath, key, type, value, environment) {
  await runCommand('/usr/bin/plutil', ['-replace', key, `-${type}`, value, plistPath], {
    cwd: projectRoot,
    env: environment,
    label: `set bundle ${key}`,
  });
}

async function removePlistValue(plistPath, key, environment) {
  try {
    await runCommand('/usr/bin/plutil', ['-remove', key, plistPath], {
      cwd: projectRoot,
      env: environment,
      label: `remove bundle ${key}`,
    });
  } catch (error) {
    if (!String(error.commandOutput || '').includes('Could not modify plist')) throw error;
  }
}

async function insertPlistValue(plistPath, key, type, value, environment) {
  await runCommand('/usr/bin/plutil', ['-insert', key, `-${type}`, value, plistPath], {
    cwd: projectRoot,
    env: environment,
    label: `insert bundle ${key}`,
  });
}

async function hashProductionBuildInputs() {
  const hash = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;
  for (const [label, inputPath] of [
    ['renderer', path.join(sourceRoot, 'renderer')],
    ['shared', path.join(sourceRoot, 'shared')],
  ]) {
    const summary = await hashTree(inputPath);
    hash.update(`${label}\0${summary.sha256}\0${summary.fileCount}\0${summary.totalBytes}\0`);
    fileCount += summary.fileCount;
    totalBytes += summary.totalBytes;
  }
  for (const filename of ['vite.config.js', 'package.json', 'package-lock.json']) {
    const contents = await fs.readFile(path.join(projectRoot, filename));
    hash.update(`file\0${filename}\0${contents.length}\0`);
    hash.update(contents);
    fileCount += 1;
    totalBytes += contents.length;
  }
  return Object.freeze({ sha256: hash.digest('hex'), fileCount, totalBytes });
}

async function stageRendererSource(privateRoot, buildEnvironment) {
  const stagingRoot = await createPrivateDirectory(path.join(privateRoot, 'renderer-build'));
  const rendererOutput = path.join(stagingRoot, 'dist', 'renderer');
  const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await runCommand(process.execPath, [
    viteEntry,
    'build',
    path.join(sourceRoot, 'renderer'),
    '--config',
    path.join(projectRoot, 'vite.config.js'),
    '--outDir',
    rendererOutput,
    '--emptyOutDir',
  ], {
    cwd: projectRoot,
    env: buildEnvironment,
    label: 'build production renderer into private output',
  });
  const resolvedOutput = await fs.realpath(rendererOutput);
  const resolvedPrivateRoot = await fs.realpath(privateRoot);
  if (!isInside(resolvedPrivateRoot, resolvedOutput)) {
    throw new Error('renderer build output escaped the private root');
  }
  const indexSource = await fs.readFile(path.join(rendererOutput, 'index.html'), 'utf8');
  if (indexSource.includes(HARNESS_PROTOCOL)) {
    throw new Error('private production renderer unexpectedly contains the harness marker');
  }
  return Object.freeze({ stagingRoot, rendererOutput: resolvedOutput });
}

async function existingRendererForSmoke() {
  const rendererOutput = await fs.realpath(path.join(projectRoot, 'dist', 'renderer'));
  const indexSource = await fs.readFile(path.join(rendererOutput, 'index.html'), 'utf8');
  if (indexSource.includes(HARNESS_PROTOCOL)) {
    throw new Error('existing renderer artifact unexpectedly contains the harness marker');
  }
  return Object.freeze({ rendererOutput });
}

async function buildHarnessApp(privateRoot, rendererOutput, buildEnvironment) {
  const sourceElectronApp = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app');
  const harnessApp = path.join(privateRoot, 'Slipstream Renderer Harness.app');
  await clonePath(sourceElectronApp, harnessApp, buildEnvironment, 'clone Electron application');

  const contentsPath = path.join(harnessApp, 'Contents');
  const resourcesPath = path.join(contentsPath, 'Resources');
  const harnessAppRoot = path.join(resourcesPath, 'app');
  await fs.rm(path.join(resourcesPath, 'default_app.asar'), { force: true });
  await fs.mkdir(harnessAppRoot, { mode: 0o700 });
  await fs.copyFile(
    path.join(harnessTemplateRoot, 'main.cjs'),
    path.join(harnessAppRoot, 'main.cjs'),
  );
  await fs.copyFile(
    path.join(harnessTemplateRoot, 'preload.cjs'),
    path.join(harnessAppRoot, 'preload.cjs'),
  );
  await fs.mkdir(path.join(harnessAppRoot, 'dist'), { mode: 0o700 });
  await clonePath(
    rendererOutput,
    path.join(harnessAppRoot, 'dist', 'renderer'),
    buildEnvironment,
    'clone production renderer bundle',
  );
  await fs.writeFile(path.join(harnessAppRoot, 'package.json'), `${JSON.stringify({
    name: 'slipstream-renderer-harness',
    version: '1.0.0',
    private: true,
    main: 'main.cjs',
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(resourcesPath, HARNESS_MARKER_FILE), `${HARNESS_PROTOCOL}\n`, {
    mode: 0o600,
  });

  const plistPath = path.join(contentsPath, 'Info.plist');
  await replacePlistValue(plistPath, 'CFBundleIdentifier', 'string', HARNESS_BUNDLE_ID, buildEnvironment);
  await replacePlistValue(plistPath, 'CFBundleName', 'string', 'Slipstream Renderer Harness', buildEnvironment);
  await replacePlistValue(
    plistPath,
    'CFBundleDisplayName',
    'string',
    'Slipstream Renderer Harness',
    buildEnvironment,
  );
  await removePlistValue(plistPath, 'ElectronAsarIntegrity', buildEnvironment);
  await removePlistValue(plistPath, 'NSAppTransportSecurity', buildEnvironment);
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    await removePlistValue(plistPath, key, buildEnvironment);
  }
  await insertPlistValue(plistPath, 'LSUIElement', 'bool', 'true', buildEnvironment);
  await insertPlistValue(
    plistPath,
    'SlipstreamRendererHarness',
    'string',
    HARNESS_PROTOCOL,
    buildEnvironment,
  );

  await runCommand('/usr/bin/xattr', ['-cr', harnessApp], {
    cwd: privateRoot,
    env: buildEnvironment,
    label: 'remove copied metadata from isolated harness',
  });
  await runCommand('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', harnessApp], {
    cwd: privateRoot,
    env: buildEnvironment,
    label: 'ad-hoc sign isolated harness',
  });
  return harnessApp;
}

async function verifyBundleIdentity(harnessApp, environment) {
  await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', harnessApp], {
    cwd: path.dirname(harnessApp),
    env: environment,
    label: 'verify isolated harness signature',
  });
  const contentsPath = path.join(harnessApp, 'Contents');
  const resourcesPath = path.join(contentsPath, 'Resources');
  const plistPath = path.join(contentsPath, 'Info.plist');
  const identifier = await readPlistValue(plistPath, 'CFBundleIdentifier', environment);
  const executableName = await readPlistValue(plistPath, 'CFBundleExecutable', environment);
  const marker = await readPlistValue(plistPath, 'SlipstreamRendererHarness', environment);
  const architectureResult = await runCommand(
    '/usr/bin/lipo',
    ['-archs', path.join(contentsPath, 'MacOS', executableName)],
    { cwd: path.dirname(harnessApp), env: environment, label: 'read harness architecture' },
  );
  const signatureResult = await runCommand(
    '/usr/bin/codesign',
    ['-d', '--verbose=4', harnessApp],
    { cwd: path.dirname(harnessApp), env: environment, label: 'read harness signature identity' },
  );
  const signatureDetails = `${signatureResult.stdout}\n${signatureResult.stderr}`;
  const signedIdentifier = signatureDetails.match(/^Identifier=(.+)$/mu)?.[1]?.trim();
  const markerFile = (await fs.readFile(path.join(resourcesPath, HARNESS_MARKER_FILE), 'utf8')).trim();
  if (identifier !== HARNESS_BUNDLE_ID
    || signedIdentifier !== HARNESS_BUNDLE_ID
    || marker !== HARNESS_PROTOCOL
    || markerFile !== HARNESS_PROTOCOL) {
    throw new Error('isolated harness identity verification failed');
  }

  return Object.freeze({
    bundleIdentifier: identifier,
    signedIdentifier,
    architectures: architectureResult.stdout.trim().split(/\s+/u).filter(Boolean).sort(),
    markerSha256: createHash('sha256').update(markerFile).digest('hex'),
    payload: await hashTree(path.join(resourcesPath, 'app')),
    renderer: await hashTree(path.join(resourcesPath, 'app', 'dist', 'renderer')),
    signatureVerified: true,
  });
}

async function createSampleProfile(privateRoot, ordinal, scenario) {
  const profilesRoot = path.join(privateRoot, 'profiles');
  if (!fsSync.existsSync(profilesRoot)) await createPrivateDirectory(profilesRoot);
  const profileRoot = await createPrivateDirectory(path.join(
    profilesRoot,
    `${String(ordinal).padStart(4, '0')}-${scenario}`,
  ));
  const paths = {};
  for (const name of ['home', 'tmp', 'user-data', 'session-data']) {
    paths[name] = await createPrivateDirectory(path.join(profileRoot, name));
    await assertPrivateDirectory(profileRoot, paths[name]);
  }
  if (new Set(Object.values(paths)).size !== 4) throw new Error('sample profile paths overlap');
  return Object.freeze({ profileRoot, paths });
}

function parseHarnessLine(line) {
  if (!line.startsWith(OUTPUT_PREFIX)) return null;
  const payload = JSON.parse(line.slice(OUTPUT_PREFIX.length));
  if (payload.protocol !== HARNESS_PROTOCOL) throw new Error('child protocol mismatch');
  return payload;
}

async function runSample({ executablePath, privateRoot, scenario, ordinal, timeoutMs = 25_000 }) {
  const profile = await createSampleProfile(privateRoot, ordinal, scenario);
  const environment = buildSafeEnvironment({
    homePath: profile.paths.home,
    temporaryPath: profile.paths.tmp,
    harness: {
      SLIPSTREAM_RENDERER_HARNESS_SCENARIO: scenario,
      SLIPSTREAM_RENDERER_HARNESS_PROFILE_ROOT: profile.profileRoot,
      SLIPSTREAM_RENDERER_HARNESS_USER_DATA: profile.paths['user-data'],
      SLIPSTREAM_RENDERER_HARNESS_SESSION_DATA: profile.paths['session-data'],
    },
  });
  const spawnedAt = performance.now();
  const child = spawn(executablePath, [], {
    cwd: profile.paths.home,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  activeChild = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let childFailure = null;
  const receipt = {};
  let domPayload = null;

  child.stderr.on('data', (chunk) => {
    if (stderrBuffer.length < 64 * 1024) stderrBuffer += chunk.slice(0, 64 * 1024 - stderrBuffer.length);
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith(OUTPUT_PREFIX)) continue;
      try {
        const payload = parseHarnessLine(line);
        if (payload.scenario !== scenario) throw new Error('child scenario mismatch');
        const receivedAt = performance.now();
        if (payload.type === 'failure') {
          childFailure = String(payload.reason || 'child failure').slice(0, 160);
        } else if (payload.type === 'milestone') {
          if (!['main-ready', 'did-finish-load', 'dom-ready'].includes(payload.name)) {
            throw new Error('unknown child milestone');
          }
          if (receipt[payload.name]) throw new Error('duplicate child milestone');
          receipt[payload.name] = receivedAt;
          if (payload.name === 'dom-ready') domPayload = payload;
        }
      } catch (error) {
        childFailure = error.message;
      }
    }
  });

  const timer = setTimeout(() => {
    childFailure = 'child readiness timeout';
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1_000).unref();
  }, timeoutMs);
  timer.unref();

  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  if (activeChild === child) activeChild = null;

  try {
    if (exit.code !== 0 || childFailure) {
      const error = new Error(childFailure || 'isolated harness child exited unsuccessfully');
      error.code = 'sample-failed';
      error.sampleScenario = scenario;
      error.sampleOrdinal = ordinal;
      error.commandOutput = stderrBuffer;
      throw error;
    }
    for (const milestone of ['main-ready', 'did-finish-load', 'dom-ready']) {
      if (!Number.isFinite(receipt[milestone])) throw new Error(`missing ${milestone} receipt`);
    }
    if (!(receipt['main-ready'] <= receipt['did-finish-load']
      && receipt['did-finish-load'] <= receipt['dom-ready'])) {
      throw new Error('milestone receipts are out of order');
    }
    if (!domPayload || domPayload.windowVisible !== false || domPayload.unexpectedAdapterCalls !== 0) {
      throw new Error('DOM readiness payload violated the capability contract');
    }
    return Object.freeze({
      scenario,
      spawnToMainReadyReceiptMs: receipt['main-ready'] - spawnedAt,
      spawnToDidFinishLoadReceiptMs: receipt['did-finish-load'] - spawnedAt,
      spawnToDomReadyReceiptMs: receipt['dom-ready'] - spawnedAt,
      didFinishLoadToDomReadyReceiptMs: receipt['dom-ready'] - receipt['did-finish-load'],
      rendererFcpMs: Number.isFinite(domPayload.rendererFcpMs) ? domPayload.rendererFcpMs : null,
      adapterInvokeCounts: domPayload.adapterInvokeCounts,
      adapterSubscriptionCounts: domPayload.adapterSubscriptionCounts,
    });
  } finally {
    await safeRemoveProfile(privateRoot, profile.profileRoot);
  }
}

async function safeRemoveProfile(privateRoot, profileRoot) {
  const resolvedPrivateRoot = await fs.realpath(privateRoot);
  const resolvedProfile = await fs.realpath(profileRoot);
  if (!isInside(path.join(resolvedPrivateRoot, 'profiles'), resolvedProfile)) {
    throw new Error('refusing unsafe profile cleanup');
  }
  await fs.rm(resolvedProfile, { recursive: true, force: false });
}

function mergeAdapterCounts(target, source) {
  for (const [channel, count] of Object.entries(source || {})) {
    target[channel] = (target[channel] || 0) + count;
  }
}

function aggregateScenario(samples) {
  const expectedCount = samples.length;
  const adapterInvokeCounts = {};
  const adapterSubscriptionCounts = {};
  for (const sample of samples) {
    mergeAdapterCounts(adapterInvokeCounts, sample.adapterInvokeCounts);
    mergeAdapterCounts(adapterSubscriptionCounts, sample.adapterSubscriptionCounts);
  }
  return Object.freeze({
    samples: expectedCount,
    spawnToMainReadyReceipt: summarizeMetric(
      samples.map((sample) => sample.spawnToMainReadyReceiptMs),
      expectedCount,
    ),
    spawnToDidFinishLoadReceipt: summarizeMetric(
      samples.map((sample) => sample.spawnToDidFinishLoadReceiptMs),
      expectedCount,
    ),
    spawnToDomReadyReceipt: summarizeMetric(
      samples.map((sample) => sample.spawnToDomReadyReceiptMs),
      expectedCount,
    ),
    didFinishLoadToDomReadyReceipt: summarizeMetric(
      samples.map((sample) => sample.didFinishLoadToDomReadyReceiptMs),
      expectedCount,
    ),
    rendererFirstContentfulPaintSupplemental: summarizeMetric(
      samples.map((sample) => sample.rendererFcpMs),
      expectedCount,
    ),
    fixedAdapterAggregate: {
      invokes: Object.fromEntries(Object.entries(adapterInvokeCounts).sort()),
      subscriptions: Object.fromEntries(Object.entries(adapterSubscriptionCounts).sort()),
      unexpectedCalls: 0,
    },
  });
}

function sanitizedErrorMessage(error, privateRoot = '') {
  let message = String(error?.message || 'renderer startup measurement failed');
  for (const [value, replacement] of [
    [privateRoot, '<private-copy>'],
    [projectRoot, '<project>'],
    [os.homedir(), '<home>'],
  ]) {
    if (value) message = message.split(value).join(replacement);
  }
  message = message
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, '<redacted>')
    .replace(/(?:key|token|secret|password)=[^\s]+/giu, '$1=<redacted>');
  return message.slice(0, 240);
}

async function writeMinimalDiagnostic(error, options, phase, privateRoot) {
  const diagnosticsRoot = path.join(os.tmpdir(), DIAGNOSTIC_DIRECTORY);
  await fs.mkdir(diagnosticsRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(diagnosticsRoot, 0o700);
  const filename = `failure-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
  const diagnosticPath = path.join(diagnosticsRoot, filename);
  const diagnostic = {
    schemaVersion: 1,
    protocol: HARNESS_PROTOCOL,
    recordedAt: new Date().toISOString(),
    phase,
    errorCode: String(error?.code || 'measurement-failed').slice(0, 80),
    message: sanitizedErrorMessage(error, privateRoot),
    commandDetail: error?.commandOutput
      ? sanitizedErrorMessage({ message: error.commandOutput }, privateRoot)
      : null,
    sampleScenario: SCENARIOS.includes(error?.sampleScenario) ? error.sampleScenario : null,
    sampleOrdinal: Number.isInteger(error?.sampleOrdinal) ? error.sampleOrdinal : null,
    mode: options?.smoke ? 'smoke' : 'full-contract',
    samplesPerScenario: options?.samplesPerScenario ?? null,
    platform: process.platform,
    architecture: process.arch,
  };
  await fs.writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { mode: 0o600 });
  return diagnosticPath;
}

async function assertOwnedTempRoot(privateRoot) {
  const resolvedTmp = await fs.realpath(os.tmpdir());
  const resolvedRoot = await fs.realpath(privateRoot);
  if (!isInside(resolvedTmp, resolvedRoot)
    || !path.basename(resolvedRoot).startsWith(TEMP_PREFIX)) {
    throw new Error('refusing unsafe private-copy cleanup');
  }
  const stat = await fs.lstat(resolvedRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || modeBits(stat) !== 0o700) {
    throw new Error('refusing unsafe private-copy cleanup');
  }
  return resolvedRoot;
}

async function safeRemovePrivateRoot(privateRoot) {
  const resolvedRoot = await assertOwnedTempRoot(privateRoot);
  await fs.rm(resolvedRoot, { recursive: true, force: false });
}

async function measure(options) {
  if (process.platform !== 'darwin') {
    throw new Error('the renderer startup harness currently requires macOS');
  }
  const createdPrivateRoot = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  await fs.chmod(createdPrivateRoot, 0o700);
  const privateRoot = await fs.realpath(createdPrivateRoot);
  await assertPrivateDirectory(privateRoot, privateRoot, { allowRoot: true });
  let phase = 'private-copy-setup';
  let diagnosticPath = null;

  try {
    const buildHome = await createPrivateDirectory(path.join(privateRoot, 'build-home'));
    const buildTmp = await createPrivateDirectory(path.join(privateRoot, 'build-tmp'));
    const buildEnvironment = buildSafeEnvironment({ homePath: buildHome, temporaryPath: buildTmp });
    phase = 'private-renderer-build';
    const buildInputsBefore = await hashProductionBuildInputs();
    const staged = options.smoke
      ? await existingRendererForSmoke()
      : await stageRendererSource(privateRoot, buildEnvironment);
    phase = 'isolated-app-build';
    const harnessApp = await buildHarnessApp(privateRoot, staged.rendererOutput, buildEnvironment);
    phase = 'preflight-identity';
    const identityBefore = await verifyBundleIdentity(harnessApp, buildEnvironment);
    const executableName = await readPlistValue(
      path.join(harnessApp, 'Contents', 'Info.plist'),
      'CFBundleExecutable',
      buildEnvironment,
    );
    const executablePath = path.join(harnessApp, 'Contents', 'MacOS', executableName);

    let ordinal = 0;
    phase = 'warmup-sampling';
    for (const scenario of buildCounterbalancedPlan(options.warmupsPerScenario || 1)) {
      if (options.warmupsPerScenario === 0) break;
      ordinal += 1;
      await runSample({ executablePath, privateRoot, scenario, ordinal });
    }

    phase = 'recorded-sampling';
    const samples = Object.fromEntries(SCENARIOS.map((scenario) => [scenario, []]));
    for (const scenario of buildCounterbalancedPlan(options.samplesPerScenario)) {
      ordinal += 1;
      const sample = await runSample({ executablePath, privateRoot, scenario, ordinal });
      samples[scenario].push(sample);
    }

    phase = 'postflight-identity';
    const identityAfter = await verifyBundleIdentity(harnessApp, buildEnvironment);
    assert.deepEqual(identityAfter, identityBefore, 'isolated bundle identity changed during sampling');
    const buildInputsAfter = await hashProductionBuildInputs();
    assert.deepEqual(buildInputsAfter, buildInputsBefore, 'production renderer inputs changed during sampling');
    for (const scenario of SCENARIOS) {
      assert.equal(samples[scenario].length, options.samplesPerScenario);
    }

    const electronPackage = JSON.parse(await fs.readFile(
      path.join(projectRoot, 'node_modules', 'electron', 'package.json'),
      'utf8',
    ));
    const percentileRank = Math.ceil(0.95 * options.samplesPerScenario);
    const result = {
      schemaVersion: 1,
      protocol: HARNESS_PROTOCOL,
      measurementMode: options.smoke ? 'smoke' : 'full-contract',
      measurementContractSatisfied: !options.smoke
        && options.samplesPerScenario >= MIN_CONTRACT_SAMPLES_PER_SCENARIO
        && percentileRank < options.samplesPerScenario,
      releaseClaimEligible: false,
      label: 'Same-machine direct-exec, warm-filesystem, fresh-process/profile, hidden spawn-to-semantic-DOM readiness',
      environment: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        electronVersion: electronPackage.version,
        samplesPerScenario: options.samplesPerScenario,
        warmupsPerScenario: options.warmupsPerScenario,
        rendererArtifactSource: options.smoke
          ? 'existing production-format dist for non-evidence plumbing smoke; source correspondence not asserted'
          : 'current production renderer built directly into a private output directory',
        order: 'alternating ABBA/BAAB counterbalanced blocks',
        percentileMethod: `nearest-rank p95 (rank ${percentileRank} of ${options.samplesPerScenario})`,
        parentEndpoint: 'receipt of isolated child milestone',
        inheritedEnvironmentKeys: Object.keys(buildSafeEnvironment({
          homePath: '<private-home>',
          temporaryPath: '<private-tmp>',
          harness: {
            SLIPSTREAM_RENDERER_HARNESS_SCENARIO: '<fixed-scenario>',
            SLIPSTREAM_RENDERER_HARNESS_PROFILE_ROOT: '<private-profile>',
            SLIPSTREAM_RENDERER_HARNESS_USER_DATA: '<private-user-data>',
            SLIPSTREAM_RENDERER_HARNESS_SESSION_DATA: '<private-session-data>',
          },
        })).sort(),
        rendererNetwork: 'denied',
        permissions: 'denied',
        navigationAndPopups: 'denied',
        window: 'hidden',
        profileIsolation: 'validated 0700 HOME/TMPDIR/userData/sessionData; no symlink components',
      },
      isolatedBundle: {
        bundleIdentifier: identityBefore.bundleIdentifier,
        signedIdentifier: identityBefore.signedIdentifier,
        architectures: identityBefore.architectures,
        signature: 'ad-hoc verified before and after sampling',
        identityUnchanged: true,
        markerSha256: identityBefore.markerSha256,
        payloadManifestSha256: identityBefore.payload.sha256,
        rendererManifestSha256: identityBefore.renderer.sha256,
        productionBuildInputsManifestSha256: buildInputsBefore.sha256,
        productionBuildInputFiles: buildInputsBefore.fileCount,
        rendererFiles: identityBefore.renderer.fileCount,
        rendererBytes: identityBefore.renderer.totalBytes,
      },
      scenarios: Object.fromEntries(SCENARIOS.map((scenario) => [
        scenario,
        aggregateScenario(samples[scenario]),
      ])),
      limitations: [
        ...(options.smoke
          ? ['Smoke mode validates harness plumbing only and does not assert that the existing dist corresponds to current source.']
          : []),
        'Hidden semantic DOM readiness is not compositor-visible readiness.',
        'First Contentful Paint is supplemental and may be unavailable in a hidden window.',
        'This is not a physical cold boot, Finder launch, Gatekeeper, quarantine, translocation, or first install.',
        'The isolated harness is ad-hoc signed; a separate signed and notarized visible pass is required before any release claim.',
        'The renderer bundle-size observation alone is not evidence for or against a user-visible delay.',
      ],
    };
    return result;
  } catch (error) {
    diagnosticPath = await writeMinimalDiagnostic(error, options, phase, privateRoot);
    error.diagnosticPath = diagnosticPath;
    throw error;
  } finally {
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      activeChild.kill('SIGTERM');
      activeChild = null;
    }
    await safeRemovePrivateRoot(privateRoot);
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const result = await measure(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      protocol: HARNESS_PROTOCOL,
      status: 'failed',
      message: sanitizedErrorMessage(error),
      diagnosticPath: error?.diagnosticPath || null,
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
