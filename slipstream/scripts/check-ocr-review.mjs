import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OCR_REVIEW_REASONS,
  assessOcrReview,
  createOcrReviewConfirmation,
  describeOcrReview,
  requiresOcrReview,
  sha256OcrReviewSource,
} from '../src/renderer/utils/ocrReview.mjs';

const confidentCapture = {
  confidence: 0.92,
  blocks: [
    { text: 'Submit by 28 July', confidence: 0.9 },
    { text: '—', confidence: null },
    { text: '申请编号 A-42', confidence: 0.81 },
  ],
};

assert.deepEqual(assessOcrReview('manual', null), {
  required: false,
  reasons: [],
  confidence: null,
  meaningfulBlockCount: 0,
  lowBlockCount: 0,
  missingBlockConfidenceCount: 0,
});
assert.equal(requiresOcrReview('ocr', confidentCapture), false);
assert.equal(describeOcrReview({ source: 'ocr', capture: confidentCapture }), null);

assert.deepEqual(assessOcrReview('ocr', null), {
  required: true,
  reasons: [
    OCR_REVIEW_REASONS.MISSING_CAPTURE,
    OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE,
    OCR_REVIEW_REASONS.MISSING_BLOCKS,
  ],
  confidence: null,
  meaningfulBlockCount: 0,
  lowBlockCount: 0,
  missingBlockConfidenceCount: 0,
});

assert.deepEqual(assessOcrReview('ocr', {
  confidence: 0.49,
  blocks: [
    { text: 'Total: £1,250', confidence: 0.49 },
    { text: 'Do not reply', confidence: null },
    { text: '!!!', confidence: null },
  ],
}), {
  required: true,
  reasons: [
    OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE,
    OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
    OCR_REVIEW_REASONS.LOW_BLOCK_CONFIDENCE,
  ],
  confidence: 0.49,
  meaningfulBlockCount: 2,
  lowBlockCount: 1,
  missingBlockConfidenceCount: 1,
});

assert.deepEqual(assessOcrReview('ocr', {
  confidence: 0.95,
  blocks: [{ text: 'Only text', confidence: Number.NaN }],
}), {
  required: true,
  reasons: [OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE],
  confidence: 0.95,
  meaningfulBlockCount: 1,
  lowBlockCount: 0,
  missingBlockConfidenceCount: 1,
});

assert.deepEqual(assessOcrReview('ocr', {
  confidence: 3,
  blocks: [{ text: 'Text', confidence: -1 }],
}).reasons, [
  OCR_REVIEW_REASONS.MISSING_OVERALL_CONFIDENCE,
  OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
]);
const arrayShapedBlock = [];
arrayShapedBlock.text = 'not a valid OCR block';
arrayShapedBlock.confidence = 0.99;
assert.deepEqual(assessOcrReview('ocr', {
  confidence: 0.99,
  blocks: [arrayShapedBlock, { text: ' -- ', confidence: 0.99 }],
}).reasons, [OCR_REVIEW_REASONS.MISSING_BLOCKS]);
assert.deepEqual(assessOcrReview('ocr', {
  confidence: 0.99,
  blocks: [{ text: `${'!'.repeat(2_000)}A`, confidence: 0.99 }],
}), {
  required: true,
  reasons: [OCR_REVIEW_REASONS.MISSING_BLOCKS],
  confidence: 0.99,
  meaningfulBlockCount: 0,
  lowBlockCount: 0,
  missingBlockConfidenceCount: 0,
}, 'renderer and main must both ignore meaningful-looking text beyond the 2000-character boundary');

const rendererOverflowBlock = {};
Object.defineProperty(rendererOverflowBlock, 'text', {
  get() {
    throw new Error('renderer OCR assessment traversed beyond 500 blocks');
  },
});
assert.deepEqual(assessOcrReview('ocr', {
  confidence: 0.99,
  blocks: [
    ...Array.from({ length: 500 }, () => ({ text: 'bounded', confidence: 0.99 })),
    rendererOverflowBlock,
  ],
}).reasons, [
  OCR_REVIEW_REASONS.MISSING_BLOCK_CONFIDENCE,
], 'renderer assessment must stay bounded and fail closed for unseen block confidence');

const onlineCopy = describeOcrReview({
  source: 'ocr',
  capture: { confidence: 0.34, blocks: [{ text: 'Deadline 7/28', confidence: 0.34 }] },
  processingLocation: 'online',
  processingProvider: 'deepseek',
});
assert.deepEqual(onlineCopy.reasons, [
  OCR_REVIEW_REASONS.LOW_OVERALL_CONFIDENCE,
  OCR_REVIEW_REASONS.LOW_BLOCK_CONFIDENCE,
]);
assert.match(onlineCopy.detail, /平均把握约为 34%/);
assert.match(onlineCopy.detail, /低于 50%/);
assert.match(onlineCopy.detail, /尚未发送给 DeepSeek/);
assert.doesNotMatch(onlineCopy.detail, /准确率|calibrated/i);
assert.equal(
  onlineCopy.guidance,
  '请重点检查日期、金额、姓名、编号和否定词；可直接修改下方原文，或确认无误后继续。',
);

const localLoopbackCopy = describeOcrReview({
  source: 'ocr',
  capture: { confidence: null, blocks: [] },
  processingLocation: 'local-loopback',
  processingProvider: 'custom',
});
assert.match(localLoopbackCopy.detail, /平均把握/);
assert.match(localLoopbackCopy.detail, /没有收到可逐块核对的 OCR 文字/);
assert.match(localLoopbackCopy.detail, /是否再联网、转发或留存取决于它的配置/);

const freeTranslationCopy = describeOcrReview({
  source: 'ocr',
  capture: { confidence: 0.3, blocks: [{ text: 'Text', confidence: 0.3 }] },
  processingLocation: 'online',
  processingProvider: 'free_translate',
});
assert.match(freeTranslationCopy.detail, /Google Translate 或备用 MyMemory/);

assert.equal(
  await sha256OcrReviewSource('OCR 文本\nA-42'),
  '997673d9edfc577b214ea3ac3035b542b9909875a323d7f34e89f4114ade18d7',
  'the renderer hash must cover the exact UTF-8 JS string without normalization',
);
const confirmation = await createOcrReviewConfirmation('abc', {
  settings: { activeBackend: 'deepseek' },
  processingLocation: 'online',
});
assert.deepEqual(confirmation, {
  confirmed: true,
  sourceSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  destinationSha256: '9f1d5e5ee8fbf6d8a3022ba364a716a5d13d4f27d36ff22f8c67cc2d8dc38b16',
});
assert.equal(Object.isFrozen(confirmation), true);
const loopbackConfirmation = await createOcrReviewConfirmation('abc', {
  settings: {
    activeBackend: 'custom',
    customEndpointUrl: 'http://127.0.0.1:9000/v1',
  },
  processingLocation: 'local-loopback',
});
assert.equal(
  loopbackConfirmation.destinationSha256,
  '9f2f15ca02faddad41dd82ba5010d0636042d1c7c587db317bf1569be32fb6f6',
  'the destination hash must cover the exact shared canonical serialization, including endpoint',
);
assert.notEqual(
  loopbackConfirmation.destinationSha256,
  confirmation.destinationSha256,
  'a confirmation for one processing destination must not authorize another destination',
);
await assert.rejects(() => sha256OcrReviewSource(null), TypeError);
await assert.rejects(
  () => createOcrReviewConfirmation('abc', {
    settings: { activeBackend: 'custom', customEndpointUrl: ' https://example.test/v1' },
    processingLocation: 'online',
  }),
  /invalid OCR review destination endpoint/u,
);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = fs.readFileSync(
  path.join(projectRoot, 'src/renderer/components/FloatingPanel.jsx'),
  'utf8',
);
const reviewHelperSource = fs.readFileSync(
  path.join(projectRoot, 'src/renderer/utils/ocrReview.mjs'),
  'utf8',
);
assert.match(
  reviewHelperSource,
  /createOcrReviewConfirmation[\s\S]*?await import\('\.\.\/\.\.\/shared\/ocr-review-destination\.mjs'\)/u,
  'destination-only code must load at explicit confirmation and remain covered by the existing fail-closed async handler',
);
const triggerStart = rendererSource.indexOf('const triggerProcessing = useCallback');
const triggerEnd = rendererSource.indexOf('const performScreenshotCapture = useCallback', triggerStart);
assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
const triggerSource = rendererSource.slice(triggerStart, triggerEnd);
const rendererAssessmentIndex = triggerSource.indexOf('const localOcrAssessment = assessOcrReview');
const rendererGateIndex = triggerSource.indexOf('if (ocrReviewRequired && !ocrReviewConfirmed)');
const rendererScheduleIndex = triggerSource.indexOf('requestCoordinatorRef.current.schedule');
assert.ok(
  rendererAssessmentIndex >= 0
    && rendererGateIndex > rendererAssessmentIndex
    && rendererScheduleIndex > rendererGateIndex,
  'the renderer must stop review-required OCR before scheduling processing',
);
assert.match(
  triggerSource.slice(rendererAssessmentIndex, rendererGateIndex),
  /isValidOcrReviewConfirmation\(normalizedOptions\.ocrReview\)[\s\S]*?options\.processingConfigSignature === processingConfigSignature[\s\S]*?options\.processingConfigRevision === currentProcessingConfigRevision/u,
  'the renderer must reject legacy, malformed, differently configured, or pre-revision retained consent before scheduling',
);
assert.match(
  rendererSource,
  /capture:\s*hasCaptureOption[\s\S]{0,180}?usesCurrentInput \? captureMeta : null/u,
  'manual submit must retain the current OCR metadata for the central gate',
);
assert.match(
  rendererSource,
  /\.\.\.\(options\.ocrReview \? \{ ocrReview: options\.ocrReview \} : \{\}\)/u,
  'only explicit review confirmation may be added to the IPC request',
);
assert.match(
  rendererSource,
  /confirmationProcessingConfigRevision = processingConfigGenerationRef\?\.current[\s\S]*?createOcrReviewConfirmation\(reviewedText,\s*\{[\s\S]*?settings,[\s\S]*?processingLocation:\s*confirmationProcessingLocation,[\s\S]*?\}\)[\s\S]*?ocrReview:\s*confirmation,[\s\S]*?processingConfigSignature,[\s\S]*?processingConfigRevision:\s*confirmationProcessingConfigRevision/u,
  'explicit confirmation must bind the current source/destination and retain monotonic config ownership for safe retry',
);
const runStart = rendererSource.indexOf('const runProcessing = useCallback');
assert.ok(runStart >= 0 && triggerStart > runStart);
const runSource = rendererSource.slice(runStart, triggerStart);
const authoritativeRejectIndex = runSource.indexOf("failureCode === 'ocr-review-required'");
const ordinaryRestoreIndex = runSource.indexOf('response?.cancelled', authoritativeRejectIndex);
assert.ok(
  authoritativeRejectIndex >= 0 && ordinaryRestoreIndex > authoritativeRejectIndex,
  'an authoritative OCR rejection must be handled before ordinary provider recovery',
);
assert.match(
  runSource.slice(authoritativeRejectIndex, ordinaryRestoreIndex),
  /response\?\.ocrReview[\s\S]*?setOcrReview\(\{[\s\S]*?sourceSha256:[\s\S]*?setStatus\(STATUS\.IDLE\)[\s\S]*?setWindowMode\('capture'\)/u,
  'an authoritative main-process rejection must reopen the editable OCR review instead of entering a retry loop',
);
assert.match(
  rendererSource,
  /if \(ocrReview\) void handleConfirmOcrReview\(\);[\s\S]{0,80}?else triggerProcessing\(\);/u,
  'Command+Enter must confirm the active review instead of bypassing it',
);
assert.match(rendererSource, /完整原文尚未发送|原文尚未交给处理服务/u);
assert.doesNotMatch(rendererSource, /请核对高亮原文/u);

const ipcFixtureSource = fs.readFileSync(
  path.join(projectRoot, 'src/renderer/hooks/useIpc.js'),
  'utf8',
);
assert.match(
  ipcFixtureSource,
  /DEMO_LOW_CONFIDENCE_REVIEW[\s\S]*?required:\s*true,[\s\S]*?sourceSha256:\s*'[a-f0-9]{64}'/u,
  'the browser/native fixture must expose an authoritative-shaped low-confidence review',
);
const processCaseStart = ipcFixtureSource.indexOf('case IPC_CHANNELS.LLM_PROCESS:');
const processCaseEnd = ipcFixtureSource.indexOf('\n    case IPC_CHANNELS.', processCaseStart + 1);
assert.notEqual(processCaseStart, -1, 'the browser/native fixture must implement LLM_PROCESS');
assert.notEqual(processCaseEnd, -1, 'the LLM_PROCESS fixture branch must remain bounded by the next IPC case');
assert.match(
  ipcFixtureSource.slice(processCaseStart, processCaseEnd),
  /demoProcessRequests\s*\+=\s*1/u,
  'the fixture must keep a visible provider-call counter for zero-before-confirm assertions',
);
assert.match(
  ipcFixtureSource,
  /recordDemoProcessPayload[\s\S]*?sourceSha256:[\s\S]*?destinationSha256:/u,
  'native fixture evidence must retain both exact confirmation hashes',
);

console.log('OCR review helper checks passed.');
