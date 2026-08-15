import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const {
  MAX_OCR_REVIEW_BLOCKS,
  OCR_REVIEW_REASONS,
  assessOcrReview,
  createDestinationSha256,
  createPendingOcrReviewRegistry,
  createSourceSha256,
  isMeaningfulOcrBlock,
  isOcrReviewConfirmed,
} = require('../src/main/ocr-review');
const {
  validateOcrReviewConfirmation,
  validateProcessOptions,
} = require('../src/main/validation');
const {
  OCR_REVIEW_CONFIDENCE_THRESHOLD,
} = require('../src/shared/constants.cjs');
const destinationCjs = require('../src/shared/ocr-review-destination.cjs');
const destinationEsm = await import('../src/shared/ocr-review-destination.mjs');

const {
  createOcrReviewDestinationDescriptor,
  ocrReviewDestinationForSettings,
  serializeOcrReviewDestination,
} = destinationCjs;

assert.equal(
  destinationEsm.serializeOcrReviewDestination,
  serializeOcrReviewDestination,
  'browser and Node adapters must expose the same destination implementation',
);

assert.equal(OCR_REVIEW_CONFIDENCE_THRESHOLD, 0.5);

const sourceText = 'Invoice A-19 costs £24 on 3 August.';
const sourceSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex');
assert.equal(createSourceSha256(sourceText), sourceSha256, 'source binding must hash exact UTF-8 text');
assert.equal(isMeaningfulOcrBlock({ text: '   --  ' }), false);
assert.equal(isMeaningfulOcrBlock({ text: '编号 １９' }), true);

const highCapture = {
  confidence: OCR_REVIEW_CONFIDENCE_THRESHOLD,
  blocks: [
    { text: 'Invoice A-19', confidence: 0.97 },
    { text: '£24', confidence: OCR_REVIEW_CONFIDENCE_THRESHOLD },
    { text: '—', confidence: null },
  ],
};
const highAssessment = assessOcrReview({ source: 'ocr', text: sourceText, capture: highCapture });
assert.deepEqual(highAssessment, {
  required: false,
  sourceSha256,
  reasons: [],
}, 'confidence at the threshold and punctuation-only blocks must stay automatic');
assert.equal(Object.isFrozen(highAssessment), true);
assert.equal(Object.isFrozen(highAssessment.reasons), true);

assert.deepEqual(
  assessOcrReview({ source: 'ocr', text: sourceText, capture: null }).reasons,
  [
    OCR_REVIEW_REASONS.MISSING_CAPTURE,
    OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE,
    OCR_REVIEW_REASONS.MISSING_BLOCKS,
  ],
  'missing OCR metadata must fail closed with stable reasons',
);
assert.equal(validateProcessOptions({
  text: sourceText,
  source: 'ocr',
  capture: [],
}).capture, null, 'array-shaped capture metadata must stay missing after validation');
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: { blocks: [{ text: sourceText, confidence: 0.99 }] },
  }).reasons,
  [OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE],
);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: { confidence: 0.4999, blocks: [{ text: sourceText, confidence: 0.99 }] },
  }).reasons,
  [OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE],
);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: { confidence: 0.99, blocks: [] },
  }).reasons,
  [OCR_REVIEW_REASONS.MISSING_BLOCKS],
  'OCR text without blocks must require review',
);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: {
      confidence: 0.99,
      blocks: [
        { text: 'Invoice A-19' },
        { text: '£24', confidence: 0.2 },
        { text: '--', confidence: null },
        { text: '3 August' },
      ],
    },
  }).reasons,
  [
    OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
    OCR_REVIEW_REASONS.LOW_BLOCK_CONFIDENCE,
  ],
  'any meaningful low/missing-confidence block must require review with deduped reasons',
);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: { confidence: 3, blocks: [{ text: 'Invoice A-19', confidence: -1 }] },
  }).reasons,
  [
    OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE,
    OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
  ],
  'out-of-range confidence is not a valid high-confidence bypass',
);
const normalizedInvalidConfidence = validateProcessOptions({
  text: sourceText,
  source: 'ocr',
  capture: {
    confidence: 3,
    blocks: [{ text: 'Invoice A-19', confidence: -1 }],
  },
}).capture;
assert.equal(normalizedInvalidConfidence.confidence, null);
assert.equal(normalizedInvalidConfidence.blocks[0].confidence, null);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: normalizedInvalidConfidence,
  }).reasons,
  [
    OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE,
    OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
  ],
  'validation must preserve fail-closed invalid confidence semantics for the authoritative gate',
);
assert.deepEqual(
  assessOcrReview({
    source: 'ocr',
    text: sourceText,
    capture: { confidence: 0.99, blocks: [{ text: ' -- ', confidence: 0.99 }] },
  }).reasons,
  [OCR_REVIEW_REASONS.MISSING_BLOCKS],
  'punctuation-only metadata is not a meaningful OCR block',
);
const inaccessibleOverflowBlock = {};
Object.defineProperty(inaccessibleOverflowBlock, 'text', {
  get() {
    throw new Error('OCR review inspected a block beyond its validation boundary');
  },
});
assert.deepEqual(assessOcrReview({
  source: 'ocr',
  text: sourceText,
  capture: {
    confidence: 0.99,
    blocks: [
      ...Array.from({ length: MAX_OCR_REVIEW_BLOCKS }, () => ({
        text: 'bounded block',
        confidence: 0.99,
      })),
      inaccessibleOverflowBlock,
    ],
  },
}).reasons, [
  OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
], 'assessment must not inspect blocks beyond 500 and must fail closed for unseen confidence');
const normalizedOverflow = validateProcessOptions({
  text: sourceText,
  source: 'ocr',
  capture: {
    confidence: 0.99,
    blocks: Array.from({ length: MAX_OCR_REVIEW_BLOCKS + 1 }, () => ({
      text: 'bounded block',
      confidence: 0.99,
    })),
  },
}).capture;
assert.equal(normalizedOverflow.blocks.length, MAX_OCR_REVIEW_BLOCKS);
assert.deepEqual(assessOcrReview({
  source: 'ocr',
  text: sourceText,
  capture: normalizedOverflow,
}).reasons, [
  OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
], 'validation truncation metadata must keep the authoritative gate fail closed');
assert.equal(
  assessOcrReview({ source: 'manual', text: sourceText, capture: null }).required,
  false,
  'the OCR confirmation rule must not gate non-OCR sources',
);
assert.throws(() => validateProcessOptions({
  text: sourceText,
  source: 'manual',
  capture: highCapture,
}), /只有截图 OCR 请求可以携带识别元数据/u,
'non-OCR source labels must not carry capture metadata');

let registryNow = 10_000;
const pendingRegistry = createPendingOcrReviewRegistry({
  ttlMs: 1_000,
  now: () => registryNow,
});
const pendingAssessment = assessOcrReview({
  source: 'ocr',
  text: sourceText,
  capture: { confidence: 0.2, blocks: [{ text: sourceText, confidence: 0.2 }] },
});
const pendingRecord = pendingRegistry.record({ senderId: 7, assessment: pendingAssessment });
assert.equal(JSON.stringify(pendingRecord).includes(sourceText), false, 'pending review state must not retain raw OCR text');
assert.equal(pendingRegistry.match({ senderId: 8, sourceText }).status, 'empty');
assert.equal(pendingRegistry.match({ senderId: 7, sourceText: `${sourceText} ` }).status, 'mismatch');
assert.equal(
  pendingRegistry.match({ senderId: 7, sourceText }).status,
  'matched',
  'the exact sender/source hash must remain gated independent of a later source label',
);
assert.equal(pendingRegistry.consume({ senderId: 7, sourceText }).status, 'consumed');
assert.equal(pendingRegistry.match({ senderId: 7, sourceText }).status, 'empty');
pendingRegistry.record({ senderId: 7, assessment: pendingAssessment });
registryNow += 1_001;
assert.equal(pendingRegistry.match({ senderId: 7, sourceText }).status, 'empty', 'pending review must expire lazily');

const requiredAssessment = assessOcrReview({
  source: 'ocr',
  text: sourceText,
  capture: { confidence: 0.99, blocks: [] },
});
const deepseekDestination = ocrReviewDestinationForSettings({
  activeBackend: 'deepseek',
  deepseekApiKey: 'MUST_NOT_ENTER_DESTINATION_DESCRIPTOR',
}, 'online');
const openaiDestination = ocrReviewDestinationForSettings({
  activeBackend: 'openai',
  openaiApiKey: 'MUST_NOT_ENTER_DESTINATION_DESCRIPTOR',
}, 'online');
const customDestination = ocrReviewDestinationForSettings({
  activeBackend: 'custom',
  customEndpointUrl: 'https://gateway.example/v1/tenant-a',
  customEndpointApiKey: 'MUST_NOT_ENTER_DESTINATION_DESCRIPTOR',
}, 'online');
const changedCustomDestination = ocrReviewDestinationForSettings({
  activeBackend: 'custom',
  customEndpointUrl: 'https://gateway.example/v1/tenant-b',
}, 'online');
const ollamaDestination = ocrReviewDestinationForSettings({
  activeBackend: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434/team-a',
}, 'local');

assert.deepEqual(deepseekDestination, {
  activeBackend: 'deepseek',
  processingLocation: 'online',
  endpoint: '',
});
assert.equal(customDestination.endpoint, 'https://gateway.example/v1/tenant-a');
assert.equal(ollamaDestination.endpoint, 'http://localhost:11434/team-a');
assert.equal(serializeOcrReviewDestination(customDestination).includes('MUST_NOT_ENTER'), false);
assert.throws(() => createOcrReviewDestinationDescriptor({
  activeBackend: 'deepseek',
  processingLocation: 'online',
  endpoint: 'https://api.deepseek.com',
}), /invalid fixed OCR review destination/u);
assert.throws(() => createOcrReviewDestinationDescriptor({
  activeBackend: 'custom',
  processingLocation: 'unknown',
  endpoint: 'https://gateway.example/v1',
}), /invalid custom OCR review destination/u);

const deepseekDestinationSha256 = createDestinationSha256(deepseekDestination);
const openaiDestinationSha256 = createDestinationSha256(openaiDestination);
const customDestinationSha256 = createDestinationSha256(customDestination);
const changedCustomDestinationSha256 = createDestinationSha256(changedCustomDestination);
assert.match(deepseekDestinationSha256, /^[a-f0-9]{64}$/u);
assert.notEqual(deepseekDestinationSha256, openaiDestinationSha256);
assert.notEqual(customDestinationSha256, changedCustomDestinationSha256);

const exactConfirmation = {
  confirmed: true,
  sourceSha256,
  destinationSha256: deepseekDestinationSha256,
};
assert.equal(
  isOcrReviewConfirmed(requiredAssessment, exactConfirmation, deepseekDestinationSha256),
  true,
  'the same exact source and destination must remain authorized',
);
assert.equal(
  isOcrReviewConfirmed(requiredAssessment, exactConfirmation, openaiDestinationSha256),
  false,
  'a DeepSeek receipt must not authorize an OpenAI destination after a settings switch',
);
assert.equal(isOcrReviewConfirmed(requiredAssessment, {
  confirmed: true,
  sourceSha256,
  destinationSha256: customDestinationSha256,
}, changedCustomDestinationSha256), false, 'a custom endpoint path change must invalidate prior consent');
assert.equal(isOcrReviewConfirmed(requiredAssessment, {
  confirmed: true,
  sourceSha256: createSourceSha256(`${sourceText} `),
  destinationSha256: deepseekDestinationSha256,
}, deepseekDestinationSha256), false, 'confirmation for even a one-character source change must not authorize processing');
assert.equal(isOcrReviewConfirmed(requiredAssessment, {
  ...exactConfirmation,
  ignored: true,
}, deepseekDestinationSha256), false, 'extra confirmation fields must fail closed');
assert.equal(isOcrReviewConfirmed(requiredAssessment, {
  confirmed: true,
  sourceSha256: sourceSha256.toUpperCase(),
  destinationSha256: deepseekDestinationSha256,
}, deepseekDestinationSha256), false, 'source hashes must use canonical lowercase hex');
assert.equal(isOcrReviewConfirmed(highAssessment, null), true, 'high-confidence OCR stays automatic');

assert.deepEqual(validateOcrReviewConfirmation(exactConfirmation), exactConfirmation);
assert.equal(Object.prototype.hasOwnProperty.call(validateProcessOptions({
  text: sourceText,
  source: 'ocr',
  capture: highCapture,
}), 'ocrReview'), false);
assert.deepEqual(validateProcessOptions({
  text: sourceText,
  source: 'ocr',
  capture: highCapture,
  ocrReview: exactConfirmation,
}).ocrReview, exactConfirmation);

for (const invalid of [
  undefined,
  null,
  {},
  { confirmed: false, sourceSha256, destinationSha256: deepseekDestinationSha256 },
  { confirmed: true },
  { confirmed: true, sourceSha256 },
  { confirmed: true, sourceSha256, destinationSha256: 'a'.repeat(63) },
  { confirmed: true, sourceSha256: 'a'.repeat(63), destinationSha256: deepseekDestinationSha256 },
  { confirmed: true, sourceSha256: sourceSha256.toUpperCase(), destinationSha256: deepseekDestinationSha256 },
  { confirmed: true, sourceSha256, destinationSha256: deepseekDestinationSha256, extra: true },
]) {
  assert.throws(
    () => validateOcrReviewConfirmation(invalid),
    /OCR 核对确认格式无效/u,
    'malformed OCR confirmation must be rejected strictly',
  );
}
assert.throws(
  () => validateProcessOptions({
    text: sourceText,
    source: 'manual',
    ocrReview: exactConfirmation,
  }),
  /OCR 核对确认格式无效/u,
  'non-OCR requests must not carry an OCR bypass token',
);

const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
assert.match(
  mainSource,
  /OCR_REVIEW_REQUIRED:\s*Object\.freeze\(\{\s*code:\s*'ocr-review-required'/u,
  'the main process must expose the stable OCR review error code',
);

const llmStart = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.LLM_PROCESS');
const llmEnd = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.VERIFICATION_RUN', llmStart);
assert.ok(llmStart >= 0 && llmEnd > llmStart, 'LLM_PROCESS handler boundaries must be discoverable');
const llmHandler = mainSource.slice(llmStart, llmEnd);
const validationIndex = llmHandler.indexOf('const request = validateProcessOptions(options)');
const settingsIndex = llmHandler.indexOf('const settings = store.getAllSettings()');
const locationIndex = llmHandler.indexOf('const requestProcessingLocation = processingLocationForSettings(settings)');
const destinationIndex = llmHandler.indexOf('ocrReviewDestination = createAuthoritativeOcrReviewDestination');
const destinationHashIndex = llmHandler.indexOf('const destinationSha256 = createDestinationSha256');
const requestAssessmentIndex = llmHandler.indexOf('const requestOcrReviewAssessment = assessOcrReview');
const pendingMatchIndex = llmHandler.indexOf('const pendingOcrReview = pendingOcrReviewRegistry.match');
const assessmentIndex = llmHandler.indexOf('const ocrReviewAssessment =');
const gateIndex = llmHandler.indexOf('if (!isOcrReviewConfirmed(');
const claimIndex = llmHandler.indexOf('backgroundTaskHandoffRegistry.claim');
const beginIndex = llmHandler.indexOf("beginBackgroundTask('analysis')");
const providerIndex = llmHandler.indexOf('LLMService.processText');
assert.ok(
  validationIndex >= 0
  && settingsIndex > validationIndex
  && locationIndex > settingsIndex
  && destinationIndex > locationIndex
  && destinationHashIndex > destinationIndex
  && requestAssessmentIndex > destinationHashIndex
  && pendingMatchIndex > requestAssessmentIndex
  && assessmentIndex > pendingMatchIndex
  && gateIndex > assessmentIndex
  && claimIndex > gateIndex
  && beginIndex > gateIndex
  && providerIndex > gateIndex,
  'OCR review must fail closed before handoff claim, analysis task creation, or provider call',
);
assert.match(
  llmHandler.slice(gateIndex, claimIndex),
  /request\.ocrReview,[\s\S]*?destinationSha256/u,
  'the hard gate must bind confirmation to the current authoritative destination hash',
);
assert.match(
  llmHandler.slice(requestAssessmentIndex, pendingMatchIndex),
  /capture:\s*request\.capture/u,
  'the LLM gate must assess only validation-bounded capture metadata',
);
assert.match(
  llmHandler.slice(pendingMatchIndex, gateIndex),
  /pendingOcrReview\.status === 'matched'[\s\S]*?pendingOcrReview\.assessment/u,
  'an exact pending screenshot hash must override an accidentally relabeled request assessment',
);
assert.doesNotMatch(llmHandler.slice(0, gateIndex), /backgroundTaskHandoffRegistry\.claim/u);
assert.doesNotMatch(llmHandler.slice(0, gateIndex), /beginBackgroundTask\('analysis'\)/u);
assert.doesNotMatch(llmHandler.slice(0, gateIndex), /LLMService\.processText/u);
assert.match(
  llmHandler.slice(gateIndex, claimIndex),
  /return userError\(USER_ERRORS\.OCR_REVIEW_REQUIRED,\s*\{\s*ocrReview:\s*ocrReviewAssessment/u,
  'a missing or stale confirmation must return the stable error and authoritative assessment',
);
const consumeIndex = llmHandler.indexOf('pendingOcrReviewRegistry.consume');
assert.ok(consumeIndex > gateIndex && consumeIndex < claimIndex,
  'pending review authority must be consumed only after confirmation and before handoff');

const captureStart = mainSource.indexOf('async function captureScreenshotTask');
const captureEnd = mainSource.indexOf('// --------------- Tray ---------------', captureStart);
assert.ok(captureStart >= 0 && captureEnd > captureStart, 'capture task boundaries must be discoverable');
const captureTask = mainSource.slice(captureStart, captureEnd);
assert.match(
  captureTask,
  /const ocrReview = assessOcrReview\(\{[\s\S]*?source:\s*'ocr',[\s\S]*?text:\s*textPayload\.text,[\s\S]*?capture:/u,
  'screenshot responses must receive a main-process assessment bound to returned text',
);
assert.match(
  captureTask,
  /if \(ocrReview\.required\) \{[\s\S]*?pendingOcrReviewRegistry\.record\(\{ senderId, assessment: ocrReview \}\)/u,
  'review-required screenshots must leave a sender-scoped hash-only pending record',
);
assert.match(
  captureTask,
  /if \(!ocrReview\.required\) \{[\s\S]*?backgroundTaskHandoffRegistry\.arm\([\s\S]*?handoffArmed = true;[\s\S]*?\}/u,
  'only review-free OCR may arm the four-second analysis handoff',
);
assert.match(
  captureTask,
  /taskOutcome = 'success';[\s\S]*?return \{[\s\S]*?ocrReview,[\s\S]*?\};/u,
  'required review must return the assessment while allowing local OCR to finish successfully',
);
assert.match(
  captureTask,
  /if \(backgroundTask && !handoffArmed\) finishBackgroundTask\(backgroundTask, taskOutcome\)/u,
  'an unarmed review-required OCR task must settle honestly instead of waiting for analysis',
);

console.log('OCR review assessment and main-process gate checks passed.');
