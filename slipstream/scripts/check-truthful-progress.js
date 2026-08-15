const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'components', 'LoadingOverlay.jsx'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'components', 'FloatingPanel.jsx'),
  'utf8',
);
const resultSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'components', 'ResultDisplay.jsx'),
  'utf8',
);

assert.equal(
  source.includes('setTimeout('),
  false,
  'processing feedback must not advance through fake timed stages',
);
assert.equal(
  source.includes('is-complete'),
  false,
  'planned output checks must not be presented as completed work',
);
assert.match(source, /正在等待所选服务返回/);
assert.match(source, /仍在等待；你可以取消并检查模型设置/);
assert.match(source, /aria-live="polite"/);
assert.match(source, /aria-hidden="true">\{elapsedSeconds\} 秒/);
assert.match(source, /aria-label="当前处理位置"/);
assert.match(source, /aria-label="处理中的原文"/);
assert.match(source, /sourceSummary\.title/);
assert.match(source, /sourceSummary\.detail/);
assert.doesNotMatch(source, /sourcePreview|processing-preview/,
  'the processing surface must not render a raw source excerpt');
assert.match(source, /取消并保留原文/);
assert.match(source, /取消并返回上一份结果/);
assert.match(source, /正在等待应用确认任务已经停止/);
assert.match(source, /还没有确认停止/);
assert.match(source, /重试停止并打开设置/);
assert.match(source, /正在等待停止确认；确认后会打开设置/);
assert.match(source, /aria-busy=\{isCancelling\}/);
assert.match(panelSource, /privacyDisclosure=\{capturePrivacyDisclosure\}/);
assert.match(panelSource, /getProcessingSourceSummary\(sourceType, inputText\.length\)/);
assert.match(panelSource, /sourceSummary=\{processingSourceSummary\}/);
assert.doesNotMatch(panelSource, /inputText\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 160\)/,
  'the processing surface must derive metadata without copying raw source text into a preview');
assert.match(panelSource, /textareaRef\.current\?\.focus/);
const cancelHandler = panelSource.slice(
  panelSource.indexOf('const handleCancelProcessing = useCallback'),
  panelSource.indexOf('const handleEditSource = useCallback'),
);
assert.ok(
  cancelHandler.indexOf('await invoke(IPC_CHANNELS.LLM_CANCEL)')
    < cancelHandler.indexOf('requestCoordinatorRef.current.invalidate()'),
  'processing must not claim cancellation before the main process acknowledges it',
);
assert.match(cancelHandler, /PROCESSING_COMPLETED_DURING_CANCEL_NOTICE/);
assert.match(cancelHandler, /processingCancelFailureMessage/);
const settingsGuardHandler = panelSource.slice(
  panelSource.indexOf('const handleOpenSettingsRequest = useCallback'),
  panelSource.indexOf('const handleResultOrderChange = useCallback'),
);
assert.match(settingsGuardHandler, /status === STATUS\.PROCESSING \|\| isVerifying \|\| isCancellingVerification/,
  'opening settings during active work must enter the guard instead of hiding the task');
assert.match(settingsGuardHandler, /settingsOpenIntentRef\.current = 'analysis'[\s\S]*handleCancelProcessing\(\{ openSettingsAfter: true \}\)/,
  'the user must explicitly choose cancellation before analysis settings can open');
assert.match(panelSource, /role="dialog"[\s\S]*先停止，再更改处理设置[\s\S]*停止任务后打开设置/,
  'the settings guard must explain the safe path and expose a deliberate action');
assert.ok(
  cancelHandler.indexOf('requestCoordinatorRef.current.invalidate()')
    < cancelHandler.indexOf('onOpenSettings(previousLastGood'),
  'settings must open only after acknowledged cancellation invalidates the active task',
);
assert.match(panelSource, /onOpenSettings\(previousLastGood[\s\S]*任务已停止；原文仍保留/,
  'settings entry must confirm which usable content remains after stopping');
assert.match(panelSource, /setVerificationTimeMs\(nextVerificationTimeMs\)/);
assert.doesNotMatch(panelSource, /setProcessingTimeMs\(response\.processingTimeMs \|\| processingTimeMs\)/);
assert.match(resultSource, /formatResultTiming\(\{[\s\S]*?processingTimeMs,[\s\S]*?verificationTimeMs/);
assert.match(resultSource, /completion-button__detail-label/);

console.log('truthful processing feedback check passed');
