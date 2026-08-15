import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  describeProcessingRecovery,
  processingFailureMessage,
  processingFailureCode,
} from '../src/renderer/utils/processingRecovery.mjs';
import {
  FAILED_PROCESSING_ATTEMPT_NOTICE,
  appendFailedProcessingAttemptNotice,
  createFailedProcessingAttempt,
  failedProcessingAttemptMatches,
  failedProcessingAttemptOptions,
  prepareFailedProcessingAttemptRetry,
  removeFailedProcessingAttemptNotice,
} from '../src/renderer/utils/failedProcessingAttempt.mjs';

const unauthorized = describeProcessingRecovery('processing-unauthorized', 'deepseek');
assert.equal(unauthorized.kind, 'credentials');
assert.equal(unauthorized.entryTarget, 'processing-credentials');
assert.equal(unauthorized.priority, 'configure');
assert.match(unauthorized.actionLabel, /API Key/);
assert.match(unauthorized.notice, /原文和上一份有效结果仍在主面板/);

const missingModel = describeProcessingRecovery('model-not-found', 'ollama');
assert.equal(missingModel.kind, 'model');
assert.equal(missingModel.entryTarget, 'processing-model');
assert.equal(missingModel.priority, 'configure');

const localConnection = describeProcessingRecovery('ollama-unavailable', 'ollama');
assert.equal(localConnection.entryTarget, 'processing-connection');
assert.match(localConnection.actionLabel, /连接地址/);

const cloudConnection = describeProcessingRecovery('processing-unreachable', 'openai');
assert.equal(cloudConnection.entryTarget, 'processing-test');

const transient = describeProcessingRecovery('processing-service-unavailable', 'deepseek');
assert.equal(transient.kind, 'transient');
assert.equal(transient.priority, 'retry');
assert.equal(transient.entryTarget, 'processing-test');

const freeTranslationFailure = describeProcessingRecovery(
  'processing-service-unavailable',
  'free_translate',
);
assert.equal(freeTranslationFailure.kind, 'translation-service');
assert.equal(freeTranslationFailure.priority, 'retry');
assert.equal(freeTranslationFailure.entryTarget, 'full-analysis');
assert.match(freeTranslationFailure.actionLabel, /本机或在线分析/);
assert.match(freeTranslationFailure.notice, /没有可验证的账户设置/);
assert.match(
  processingFailureMessage(
    'processing-service-unavailable',
    'free_translate',
    'generic',
  ),
  /Google Translate 与备用 MyMemory/,
);
assert.match(
  processingFailureMessage('processing-rate-limited', 'free_translate', 'generic'),
  /无需检查 API Key/,
);
assert.equal(
  processingFailureMessage('processing-service-unavailable', 'deepseek', 'generic'),
  'generic',
);

assert.equal(describeProcessingRecovery('verification-failed', 'deepseek'), null);
assert.equal(processingFailureCode({ errorCode: 'processing-unauthorized' }), 'processing-unauthorized');
assert.equal(processingFailureCode({}, true), 'processing-invalid');
assert.equal(processingFailureCode(null), 'processing-failed');

const previousResult = {
  inputText: 'Previous source A',
  processedSourceText: 'Previous source A',
  brief: { headline: 'Previous result A' },
};
const replacementCapture = {
  confidence: 0.91,
  blocks: [{ text: 'Replacement source B', boundingBox: { x: 1, y: 2, w: 3, h: 4 } }],
};
const replacementPayload = {
  text: 'Replacement source B',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'a'.repeat(64),
      destinationSha256: 'd'.repeat(64),
    },
    processingConfigSignature: 'deepseek\u0000model-a\u0000true\u0000prompt-a\u0000policy-a',
    processingConfigRevision: 7,
    truncated: true,
    originalLength: 24000,
  },
};
const failedReplacement = createFailedProcessingAttempt(replacementPayload, previousResult);
assert.deepEqual(failedReplacement, {
  text: 'Replacement source B',
  source: 'ocr',
  capture: replacementCapture,
  ocrReview: {
    confirmed: true,
    sourceSha256: 'a'.repeat(64),
    destinationSha256: 'd'.repeat(64),
  },
  processingConfigSignature: 'deepseek\u0000model-a\u0000true\u0000prompt-a\u0000policy-a',
  processingConfigRevision: 7,
  truncated: true,
  originalLength: 24000,
});
replacementCapture.blocks[0].boundingBox.x = 99;
assert.equal(failedReplacement.capture.blocks[0].boundingBox.x, 1,
  'the in-memory retry must own a stable copy of OCR metadata');
replacementPayload.options.ocrReview.sourceSha256 = 'b'.repeat(64);
assert.equal(failedReplacement.ocrReview.sourceSha256, 'a'.repeat(64),
  'the in-memory retry must own a stable copy of the OCR confirmation');
replacementPayload.options.processingConfigSignature = 'changed-after-clone';
replacementPayload.options.processingConfigRevision = 99;
assert.equal(
  failedReplacement.processingConfigSignature,
  'deepseek\u0000model-a\u0000true\u0000prompt-a\u0000policy-a',
  'the in-memory retry must retain the exact processing configuration that received consent',
);
assert.equal(failedReplacement.processingConfigRevision, 7,
  'the in-memory retry must retain the monotonic config revision that received consent');
assert.equal(createFailedProcessingAttempt({
  text: 'Previous source A',
  options: { source: 'clipboard' },
}, previousResult), null, 'the visible result source does not need a duplicate failure slot');
const highConfidenceAttempt = createFailedProcessingAttempt({
  text: 'High-confidence OCR replacement',
  options: {
    source: 'ocr',
    capture: {
      confidence: 0.9,
      blocks: [{ text: 'High-confidence OCR replacement', confidence: 0.9 }],
    },
  },
}, previousResult);
assert.equal(Object.prototype.hasOwnProperty.call(highConfidenceAttempt, 'ocrReview'), false);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    failedProcessingAttemptOptions(highConfidenceAttempt),
    'ocrReview',
  ),
  false,
  'high-confidence OCR retries must omit the strict confirmation field when none was required',
);
const malformedConfirmationAttempt = createFailedProcessingAttempt({
  text: 'OCR replacement with malformed confirmation',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'c'.repeat(64),
      destinationSha256: 'e'.repeat(64),
      unexpected: true,
    },
    processingConfigSignature: 'config-c',
    processingConfigRevision: 7,
  },
}, previousResult);
assert.equal(
  Object.prototype.hasOwnProperty.call(malformedConfirmationAttempt, 'ocrReview'),
  false,
  'retry state must not repair an invalid confirmation by dropping unexpected fields',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(malformedConfirmationAttempt, 'processingConfigSignature'),
  false,
  'an invalid receipt must not retain a detached processing configuration signature',
);
const missingDestinationConfirmationAttempt = createFailedProcessingAttempt({
  text: 'OCR replacement with legacy confirmation',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'c'.repeat(64),
    },
    processingConfigSignature: 'config-c',
    processingConfigRevision: 7,
  },
}, previousResult);
assert.equal(
  Object.prototype.hasOwnProperty.call(missingDestinationConfirmationAttempt, 'ocrReview'),
  false,
  'the legacy two-field receipt must not survive into a retry',
);
const missingSignatureAttempt = createFailedProcessingAttempt({
  text: 'OCR replacement without receipt config ownership',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'c'.repeat(64),
      destinationSha256: 'e'.repeat(64),
    },
    processingConfigRevision: 7,
  },
}, previousResult);
assert.equal(
  Object.prototype.hasOwnProperty.call(missingSignatureAttempt, 'ocrReview'),
  false,
  'a receipt without a nonempty bounded config signature must not be preserved',
);
const oversizedSignatureAttempt = createFailedProcessingAttempt({
  text: 'OCR replacement with oversized config ownership',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'c'.repeat(64),
      destinationSha256: 'e'.repeat(64),
    },
    processingConfigSignature: 'x'.repeat(100_001),
    processingConfigRevision: 7,
  },
}, previousResult);
assert.equal(
  Object.prototype.hasOwnProperty.call(oversizedSignatureAttempt, 'ocrReview'),
  false,
  'unbounded config data must not enter the memory-only receipt slot',
);
const missingRevisionAttempt = createFailedProcessingAttempt({
  text: 'OCR replacement without monotonic config ownership',
  options: {
    source: 'ocr',
    capture: replacementCapture,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'c'.repeat(64),
      destinationSha256: 'e'.repeat(64),
    },
    processingConfigSignature: 'config-c',
  },
}, previousResult);
assert.equal(
  Object.prototype.hasOwnProperty.call(missingRevisionAttempt, 'ocrReview'),
  false,
  'a receipt without a monotonic config revision must not survive into retry state',
);

const failedOptions = failedProcessingAttemptOptions(failedReplacement);
assert.deepEqual(failedOptions, {
  source: 'ocr',
  capture: failedReplacement.capture,
  ocrReview: failedReplacement.ocrReview,
  processingConfigSignature: failedReplacement.processingConfigSignature,
  processingConfigRevision: failedReplacement.processingConfigRevision,
  truncated: true,
  originalLength: 24000,
  retryOfLastGood: true,
});
assert.deepEqual(
  prepareFailedProcessingAttemptRetry(failedReplacement),
  {
    text: failedReplacement.text,
    modified: false,
    options: failedOptions,
  },
  'an untouched retained attempt must retry exact source B with its OCR metadata',
);
assert.deepEqual(
  prepareFailedProcessingAttemptRetry(failedReplacement, {
    baseSourceText: failedReplacement.text,
    text: 'Corrected replacement source B prime',
  }),
  {
    text: 'Corrected replacement source B prime',
    modified: true,
    options: {
      source: 'manual',
      capture: null,
      truncated: false,
      originalLength: 36,
      retryOfLastGood: true,
    },
  },
  'a corrected B draft must be the retry payload and must not retain stale OCR metadata',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    prepareFailedProcessingAttemptRetry(failedReplacement, {
      baseSourceText: failedReplacement.text,
      text: 'Corrected replacement source B prime',
    }).options,
    'ocrReview',
  ),
  false,
  'a manual correction must omit, not null out, the strict OCR confirmation field',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    prepareFailedProcessingAttemptRetry(failedReplacement, {
      baseSourceText: failedReplacement.text,
      text: 'Corrected replacement source B prime',
    }).options,
    'processingConfigSignature',
  ),
  false,
  'a manual correction must also drop the config signature paired with the stale receipt',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    prepareFailedProcessingAttemptRetry(failedReplacement, {
      baseSourceText: failedReplacement.text,
      text: 'Corrected replacement source B prime',
    }).options,
    'processingConfigRevision',
  ),
  false,
  'a manual correction must also drop the monotonic config revision paired with the receipt',
);
assert.deepEqual(
  prepareFailedProcessingAttemptRetry(failedReplacement, {
    baseSourceText: 'Previous source A',
    text: 'Edited previous source A',
  }),
  {
    text: failedReplacement.text,
    modified: false,
    options: failedOptions,
  },
  'an unrelated A correction must not replace retained source B',
);
assert.equal(
  prepareFailedProcessingAttemptRetry(failedReplacement, {
    baseSourceText: failedReplacement.text,
    text: '   ',
  }),
  null,
  'an empty corrected draft must reopen review instead of silently retrying original B',
);
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  failedOptions,
), true, 'the primary retry must retain source, OCR and truncation ownership');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  'A different replacement',
  failedOptions,
), false, 'a genuinely new source must supersede the previous failed attempt');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    capture: {
      ...failedOptions.capture,
      confidence: 0.73,
    },
  },
), false, 'the same OCR text from a new capture must replace stale confidence and blocks');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'b'.repeat(64),
      destinationSha256: 'd'.repeat(64),
    },
  },
), false, 'the same OCR capture with a different confirmation hash must not match');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    ocrReview: {
      confirmed: true,
      sourceSha256: 'a'.repeat(64),
      destinationSha256: 'f'.repeat(64),
    },
  },
), false, 'the same OCR source receipt must not match a different destination hash');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    processingConfigSignature: 'deepseek\u0000model-b\u0000true\u0000prompt-a\u0000policy-a',
  },
), false, 'the same reviewed OCR source must stop matching after processing configuration changes');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    // Models, provider, endpoint, and credential-presence flags may all
    // return to the prior value; the revision must still prevent consent
    // issued before D → E → D from reviving.
    processingConfigRevision: failedOptions.processingConfigRevision + 2,
  },
), false, 'a destination round trip must not revive an older matching signature');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    // Replacing a redacted credential can leave every value-based signature
    // field unchanged while the processing authority has still changed.
    processingConfigRevision: failedOptions.processingConfigRevision + 1,
  },
), false, 'same-signature credential replacement must invalidate retained consent');
assert.equal(failedProcessingAttemptMatches(
  failedReplacement,
  failedReplacement.text,
  {
    ...failedOptions,
    ocrReview: null,
  },
), false, 'an OCR retry must not silently lose its review confirmation');
assert.match(FAILED_PROCESSING_ATTEMPT_NOTICE, /上一份有效结果/);
assert.match(FAILED_PROCESSING_ATTEMPT_NOTICE, /当前会话内存/);
assert.match(FAILED_PROCESSING_ATTEMPT_NOTICE, /未写入历史/);
assert.equal(
  appendFailedProcessingAttemptNotice(
    appendFailedProcessingAttemptNotice('Transient failure.', failedReplacement),
    failedReplacement,
  ).split(FAILED_PROCESSING_ATTEMPT_NOTICE).length,
  2,
  'the A/B recovery boundary must not duplicate its warning after configuration changes',
);
assert.equal(
  removeFailedProcessingAttemptNotice(`Existing warning. ${FAILED_PROCESSING_ATTEMPT_NOTICE}`),
  'Existing warning.',
  'clearing B must not leave a false retained-source claim inside Undo',
);

const floatingPanel = fs.readFileSync(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8');
const resultDisplay = fs.readFileSync(new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url), 'utf8');
const failedAttemptUtility = fs.readFileSync(new URL('../src/renderer/utils/failedProcessingAttempt.mjs', import.meta.url), 'utf8');
const settingsPanel = fs.readFileSync(new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url), 'utf8');
const demoIpc = fs.readFileSync(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');

assert.match(floatingPanel, /processingErrorCode/);
assert.match(floatingPanel, /handleOpenProcessingRecovery/);
assert.match(floatingPanel, /processingRecovery\.actionLabel/);
assert.match(resultDisplay, /warningRecovery/);
assert.match(resultDisplay, /onConfigureRecovery/);
assert.match(settingsPanel, /processing-credentials/);
assert.match(settingsPanel, /processing-model/);
assert.match(settingsPanel, /processing-test/);
assert.match(demoIpc, /endsWith\('-once'\)/);
assert.match(demoIpc, /processing-unauthorized/);
assert.match(floatingPanel, /const \[failedProcessingAttempt, setFailedProcessingAttemptState\] = useState\(null\)/);
assert.match(floatingPanel, /failedProcessingAttemptRef = useRef\(null\)/);
assert.match(floatingPanel,
  /currentProcessingConfigRevision = processingConfigGenerationRef\?\.current[\s\S]*?options\.processingConfigSignature === processingConfigSignature[\s\S]*?options\.processingConfigRevision === currentProcessingConfigRevision/,
  'retained OCR consent must match both current config values and the monotonic config revision');
assert.match(failedAttemptUtility,
  /processingConfigRevision[\s\S]*?cloneProcessingConfigRevision[\s\S]*?normalized\.processingConfigRevision/,
  'failed-attempt memory must own and compare the monotonic config revision');
assert.match(floatingPanel, /createFailedProcessingAttempt\(\{[\s\S]*?text: textToProcess,[\s\S]*?options: normalizedOptions,[\s\S]*?lastGoodRef\.current/,
  'a replacement attempt must be captured before processing can fail or configuration can change');
assert.match(floatingPanel, /const triggerProcessing[\s\S]*?const nextAttempt = createFailedProcessingAttempt[\s\S]*?setFailedProcessingAttempt\(nextAttempt\)[\s\S]*?clearTimeout\(sessionRecoveryWriteTimerRef\.current\)[\s\S]*?latestSessionRecoveryRef\.current = null[\s\S]*?clearSessionRecovery\(storage\)[\s\S]*?replaceSessionRecoveryWithLastGood\(lastGoodRef\.current, storage\)[\s\S]*?setSourceMeta/,
  'creating the memory-only B slot must synchronously evict any ordinary draft record that already contains B');
assert.match(floatingPanel, /response\?\.success[\s\S]*?setFailedProcessingAttempt\(null\)[\s\S]*?const nextBrief/,
  'a successful replacement must clear the in-memory failed source');
assert.match(floatingPanel, /const handleRetryProcessing[\s\S]*?prepareFailedProcessingAttemptRetry\(attempt, sourceEditDraft\)[\s\S]*?triggerProcessing\(retry\.text, retry\.options\)/,
  'the result retry must submit B or its retained correction instead of the visible A result source');
assert.match(floatingPanel, /const handleReviewFailedProcessingAttempt[\s\S]*?const attempt = failedProcessingAttemptRef\.current[\s\S]*?openSourceEditDraft\(attempt\.text, sourceEditDraft\)[\s\S]*?setIsEditingSource\(true\)/,
  'reviewing B must transfer it into the existing reversible correction flow');
const reviewHandler = floatingPanel.match(/const handleReviewFailedProcessingAttempt[\s\S]*?\n {2}}, \[/)?.[0] || '';
assert.doesNotMatch(reviewHandler, /setFailedProcessingAttempt\(null\)/,
  'review must retain B identity so returning to A can reopen the same correction or retry it');
assert.match(floatingPanel, /const hasFailedAttemptEditDraft = hasModifiedSourceEditDraft\([\s\S]*?failedProcessingAttempt\?\.text[\s\S]*?onEditSource=\{hasFailedAttemptEditDraft[\s\S]*?handleReviewFailedProcessingAttempt[\s\S]*?: handleEditSource\}/,
  'returning to A must keep a modified B draft discoverable instead of replacing it with an A draft');
assert.match(floatingPanel, /hasFailedAttemptEditDraft \? '重试修正后的原文' : '重试刚才的原文'/,
  'the result action must disclose whether retry will submit corrected B or the original retained B');
assert.match(floatingPanel, /const handleClear[\s\S]*?setFailedProcessingAttempt\(null\)/,
  'starting over must discard B');
assert.match(floatingPanel, /warning: removeFailedProcessingAttemptNotice\(warning\)/,
  'the clear snapshot must not revive a discarded B claim through Undo');
assert.match(floatingPanel, /const recoveryWarning = recoverySnapshot[\s\S]*?removeFailedProcessingAttemptNotice[\s\S]*?createSessionRecoveryRecord\(\{[\s\S]*?warning: recoveryWarning/,
  'renderer interruption recovery must not persist B or a stale claim that B survived');
assert.match(floatingPanel, /const replaceSessionRecoveryWithLastGood[\s\S]*?createSessionRecoveryRecord\(\{[\s\S]*?inputText: cleanSnapshot\.inputText[\s\S]*?warning: cleanWarning[\s\S]*?processingErrorCode: null[\s\S]*?writeSessionRecovery\(storage, record\)/,
  'the deterministic replacement record must contain clean A without B retry state');
assert.match(floatingPanel, /const restoreLastGood[\s\S]*?failedProcessingAttemptRef\.current[\s\S]*?clearTimeout\(sessionRecoveryWriteTimerRef\.current\)[\s\S]*?sessionRecoveryWriteTimerRef\.current = null[\s\S]*?latestSessionRecoveryRef\.current = null[\s\S]*?clearSessionRecovery\(storage\)[\s\S]*?replaceSessionRecoveryWithLastGood\(snapshot, storage\)[\s\S]*?revokeDelayedCaptureDispatch/,
  'restoreLastGood must cancel delayed B, clear an already-written B, and synchronously replace it before restoring A');
assert.match(floatingPanel, /const recoverySnapshot = failedProcessingAttempt \? lastGoodRef\.current : null[\s\S]*?inputText: recoverySnapshot \? cleanRecoverySnapshot\.inputText : inputText[\s\S]*?status: recoverySnapshot \? STATUS\.DONE : status[\s\S]*?warning: recoveryWarning,[\s\S]*?processingErrorCode: recoverySnapshot \? null : processingErrorCode[\s\S]*?lastGood: cleanRecoverySnapshot[\s\S]*?isEditingSource: recoverySnapshot \? false : isEditingSource[\s\S]*?sourceEditDraft: recoverySnapshot \? null : sourceEditDraft/,
  'later recovery effects must persist only clean A while B owns processing, result recovery, or correction');
assert.match(floatingPanel, /const purgeForFullDataReset[\s\S]*?setFailedProcessingAttempt\(null\)/,
  'full-data reset must discard B');
assert.match(floatingPanel, /failedProcessingAttemptAvailable=\{Boolean\(failedProcessingAttempt\)\}/);
assert.match(floatingPanel, /onRetry=\{setupIncomplete[\s\S]*?: handleRetryProcessing\}/);
assert.match(resultDisplay, /查看并修正刚才的原文/);
assert.doesNotMatch(failedAttemptUtility, /localStorage|sessionStorage|indexedDB|IPC_CHANNELS|invoke|fetch/,
  'the failed B source must remain renderer-memory-only and never gain a persistence or network path');

console.log('Processing failure recovery checks passed.');
