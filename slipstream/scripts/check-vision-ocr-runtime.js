'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { createOcrEnvironment } = require('../src/main/ocr-environment');
const {
  VISION_OCR_EXPECTED_LINES,
  VISION_OCR_MAX_BLOCKS,
  validateVisionOcrResult,
  writeVisionOcrFixture,
} = require('./vision-ocr-fixture');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_RUNNER = path.join(__dirname, 'ocr-swift-runner.sh');
const BUNDLED_RUNNER_BINARY = path.join(__dirname, 'slipstream-ocr');
const CHECK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function assertMode(targetPath, expectedMode, label) {
  const stat = fs.statSync(targetPath);
  if ((stat.mode & 0o777) !== expectedMode) {
    throw new Error(`${label} permissions are not private`);
  }
  return stat;
}

function createFixtureBlock(text, overrides = {}) {
  return {
    text,
    confidence: overrides.confidence ?? 0.95,
    boundingBox: {
      x: 0.05,
      y: 0.1,
      w: 0.8,
      h: 0.1,
      ...(overrides.boundingBox || {}),
    },
  };
}

function createValidFixtureResult() {
  return {
    text: VISION_OCR_EXPECTED_LINES.join('\n'),
    confidence: 0.95,
    blocks: VISION_OCR_EXPECTED_LINES.map((line) => createFixtureBlock(line)),
  };
}

function assertValidatorRejects(label, result) {
  try {
    validateVisionOcrResult(result, { minimumConfidence: 0.5 });
  } catch (error) {
    const message = String(error?.message || '');
    if (VISION_OCR_EXPECTED_LINES.some((line) => message.includes(line))) {
      throw new Error(`validator counterexample ${label} exposed OCR text`);
    }
    return;
  }
  throw new Error(`validator accepted the ${label} counterexample`);
}

function runValidatorContractChecks() {
  const expectedText = VISION_OCR_EXPECTED_LINES.join('\n');
  const extra = createValidFixtureResult();
  extra.text = `${expectedText}\nUNEXPECTED EXTRA CONTENT`;

  const inserted = createValidFixtureResult();
  inserted.text = [
    VISION_OCR_EXPECTED_LINES[0],
    'UNEXPECTED INSERTION',
    ...VISION_OCR_EXPECTED_LINES.slice(1),
  ].join('\n');

  const repeated = createValidFixtureResult();
  repeated.text = `${expectedText}\n${VISION_OCR_EXPECTED_LINES[0]}`;

  const wrongOrder = createValidFixtureResult();
  wrongOrder.text = [
    VISION_OCR_EXPECTED_LINES[1],
    VISION_OCR_EXPECTED_LINES[0],
    ...VISION_OCR_EXPECTED_LINES.slice(2),
  ].join('\n');

  const missingLine = createValidFixtureResult();
  missingLine.text = VISION_OCR_EXPECTED_LINES.slice(0, -1).join('\n');

  const inconsistentBlocks = createValidFixtureResult();
  inconsistentBlocks.blocks = inconsistentBlocks.blocks.map((block, index) => (
    index === inconsistentBlocks.blocks.length - 1
      ? createFixtureBlock('UNEXPECTED REPLACEMENT')
      : block
  ));

  const blocksWithExtra = createValidFixtureResult();
  blocksWithExtra.blocks = [
    ...blocksWithExtra.blocks,
    createFixtureBlock('UNEXPECTED EXTRA BLOCK'),
  ];

  const blocksWithInsertion = createValidFixtureResult();
  blocksWithInsertion.blocks = [
    blocksWithInsertion.blocks[0],
    createFixtureBlock('UNEXPECTED INSERTED BLOCK'),
    ...blocksWithInsertion.blocks.slice(1),
  ];

  const blocksWithRepetition = createValidFixtureResult();
  blocksWithRepetition.blocks = [
    ...blocksWithRepetition.blocks,
    createFixtureBlock(VISION_OCR_EXPECTED_LINES[0]),
  ];

  const blocksInWrongOrder = createValidFixtureResult();
  blocksInWrongOrder.blocks = [
    blocksInWrongOrder.blocks[1],
    blocksInWrongOrder.blocks[0],
    ...blocksInWrongOrder.blocks.slice(2),
  ];

  const blocksMissingLine = createValidFixtureResult();
  blocksMissingLine.blocks = blocksMissingLine.blocks.slice(0, -1);

  const expectedWords = VISION_OCR_EXPECTED_LINES.join(' ').split(' ');
  const tooManyBlocks = createValidFixtureResult();
  const allowedChunks = expectedWords.slice(0, VISION_OCR_MAX_BLOCKS);
  const finalChunk = expectedWords.slice(VISION_OCR_MAX_BLOCKS).join(' ');
  tooManyBlocks.blocks = [...allowedChunks, finalChunk].map((text) => createFixtureBlock(text));

  const invalidOverallConfidence = createValidFixtureResult();
  invalidOverallConfidence.confidence = 0.49;

  const invalidBlockConfidence = createValidFixtureResult();
  invalidBlockConfidence.blocks = invalidBlockConfidence.blocks.map((block, index) => (
    index === 0 ? createFixtureBlock(block.text, { confidence: 0.49 }) : block
  ));

  const nonFiniteBoundingBox = createValidFixtureResult();
  nonFiniteBoundingBox.blocks = nonFiniteBoundingBox.blocks.map((block, index) => (
    index === 0 ? createFixtureBlock(block.text, { boundingBox: { x: Number.NaN } }) : block
  ));

  const zeroSizeBoundingBox = createValidFixtureResult();
  zeroSizeBoundingBox.blocks = zeroSizeBoundingBox.blocks.map((block, index) => (
    index === 0 ? createFixtureBlock(block.text, { boundingBox: { w: 0 } }) : block
  ));

  const overflowingBoundingBox = createValidFixtureResult();
  overflowingBoundingBox.blocks = overflowingBoundingBox.blocks.map((block, index) => (
    index === 0
      ? createFixtureBlock(block.text, { boundingBox: { x: 0.9, w: 0.2 } })
      : block
  ));

  const counterexamples = [
    ['extra-content', extra],
    ['inserted-content', inserted],
    ['repeated-content', repeated],
    ['wrong-order', wrongOrder],
    ['missing-line', missingLine],
    ['text-block-mismatch', inconsistentBlocks],
    ['blocks-extra-content', blocksWithExtra],
    ['blocks-inserted-content', blocksWithInsertion],
    ['blocks-repeated-content', blocksWithRepetition],
    ['blocks-wrong-order', blocksInWrongOrder],
    ['blocks-missing-line', blocksMissingLine],
    ['excessive-block-count', tooManyBlocks],
    ['overall-confidence', invalidOverallConfidence],
    ['block-confidence', invalidBlockConfidence],
    ['non-finite-bounding-box', nonFiniteBoundingBox],
    ['zero-size-bounding-box', zeroSizeBoundingBox],
    ['overflowing-bounding-box', overflowingBoundingBox],
  ];

  validateVisionOcrResult(createValidFixtureResult(), { minimumConfidence: 0.5 });
  validateVisionOcrResult({
    ...createValidFixtureResult(),
    blocks: [
      'FICTIONAL OCR',
      'NOTICE',
      'Submit the blue form',
      'by Friday',
      'Do not',
      'send payment',
      'Reference Cedar',
      'Seven',
    ].map((text) => createFixtureBlock(text)),
  }, { minimumConfidence: 0.5 });
  for (const [label, result] of counterexamples) assertValidatorRejects(label, result);
}

function assertPrivateEnvironmentDirectory(directory, cacheDir, label) {
  if (
    typeof directory !== 'string'
    || !path.isAbsolute(directory)
    || path.relative(cacheDir, directory).startsWith('..')
  ) {
    throw new Error(`${label} must stay inside the private OCR cache`);
  }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`${label} must be a private real directory`);
  }
}

function runVisionOcrRuntimeCheck() {
  if (process.platform !== 'darwin') {
    throw new Error('positive Apple Vision OCR runtime check requires macOS');
  }
  if (fs.existsSync(BUNDLED_RUNNER_BINARY)) {
    throw new Error('source OCR runtime check cannot run with a bundled OCR binary present');
  }
  runValidatorContractChecks();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-vision-ocr-runtime-'));
  try {
    fs.chmodSync(tempRoot, 0o700);
    assertMode(tempRoot, 0o700, 'Vision OCR temporary root');
    const cacheDir = path.join(tempRoot, 'cache');
    fs.mkdirSync(cacheDir, { mode: 0o700 });
    fs.chmodSync(cacheDir, 0o700);
    assertMode(cacheDir, 0o700, 'Vision OCR compile cache');
    if (fs.readdirSync(cacheDir).length !== 0) {
      throw new Error('Vision OCR compile cache must start empty');
    }

    const { imagePath } = writeVisionOcrFixture(tempRoot);
    assertMode(imagePath, 0o600, 'Vision OCR fixture image');

    const ocrEnvironment = createOcrEnvironment(cacheDir);
    const environmentKeys = Object.keys(ocrEnvironment).sort();
    if (environmentKeys.join(',') !== 'CFFIXED_USER_HOME,HOME,PATH,SLIPSTREAM_OCR_CACHE,TEMP,TMP,TMPDIR') {
      throw new Error('OCR subprocess environment does not match the private allowlist');
    }
    if (ocrEnvironment.CFFIXED_USER_HOME !== ocrEnvironment.HOME) {
      throw new Error('OCR subprocess Foundation HOME must use the private HOME');
    }
    if (
      ocrEnvironment.TMPDIR !== ocrEnvironment.TMP
      || ocrEnvironment.TMPDIR !== ocrEnvironment.TEMP
    ) {
      throw new Error('OCR subprocess temporary directories must share one private path');
    }
    const environmentRoot = path.join(cacheDir, '.environment');
    if (
      path.dirname(ocrEnvironment.HOME) !== environmentRoot
      || path.dirname(ocrEnvironment.TMPDIR) !== environmentRoot
    ) {
      throw new Error('OCR subprocess profile directories must use the private environment root');
    }
    assertPrivateEnvironmentDirectory(environmentRoot, cacheDir, 'OCR environment root');
    assertPrivateEnvironmentDirectory(ocrEnvironment.HOME, cacheDir, 'OCR subprocess HOME');
    assertPrivateEnvironmentDirectory(ocrEnvironment.TMPDIR, cacheDir, 'OCR subprocess temp');

    const startedAt = performance.now();
    const run = spawnSync('/bin/bash', [SOURCE_RUNNER, imagePath], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: ocrEnvironment,
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: CHECK_TIMEOUT_MS,
      windowsHide: true,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    if (run.error) {
      const reason = run.error.code === 'ETIMEDOUT' ? 'timed out' : 'could not start';
      throw new Error(`source Apple Vision OCR runner ${reason}`);
    }
    if (run.status !== 0) {
      throw new Error(`source Apple Vision OCR runner failed with status ${run.status}`);
    }
    if (!run.stderr.includes('[runner] Compiling VisionOCR.swift')) {
      throw new Error('source Apple Vision OCR runner did not perform a cold compile');
    }

    const compiledBinary = path.join(cacheDir, 'slipstream-ocr');
    const versionFile = path.join(cacheDir, 'slipstream-ocr.version');
    if (!assertMode(compiledBinary, 0o700, 'Compiled Vision OCR binary').isFile()) {
      throw new Error('compiled Vision OCR binary is missing');
    }
    if (!assertMode(versionFile, 0o600, 'Vision OCR version marker').isFile()) {
      throw new Error('Vision OCR version marker is missing');
    }

    let result;
    try {
      result = JSON.parse(run.stdout);
    } catch {
      throw new Error('source Apple Vision OCR runner returned invalid JSON');
    }
    const summary = validateVisionOcrResult(result, { minimumConfidence: 0.5 });
    process.stdout.write(`${JSON.stringify({
      arch: process.arch,
      durationMs,
      blockCount: summary.blockCount,
      confidence: Number(summary.confidence.toFixed(3)),
    })}\n`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  runVisionOcrRuntimeCheck();
} catch (error) {
  process.stderr.write(`Vision OCR runtime check failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
}
