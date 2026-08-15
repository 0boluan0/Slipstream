const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const shortcutSource = fs.readFileSync(path.join(root, 'src/main/global-shortcut.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/components/FloatingPanel.jsx'), 'utf8');
const loadingOverlaySource = fs.readFileSync(path.join(root, 'src/renderer/components/LoadingOverlay.jsx'), 'utf8');
const resultDisplaySource = fs.readFileSync(path.join(root, 'src/renderer/components/ResultDisplay.jsx'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const constantsSource = fs.readFileSync(path.join(root, 'src/shared/constants.cjs'), 'utf8');
const ipcSource = fs.readFileSync(path.join(root, 'src/renderer/hooks/useIpc.js'), 'utf8');
const clipboardHookSource = fs.readFileSync(path.join(root, 'src/renderer/hooks/useClipboard.js'), 'utf8');
const appStyles = fs.readFileSync(path.join(root, 'src/renderer/App.css'), 'utf8');
const permissionDiagnosticSource = fs.readFileSync(path.join(root, 'scripts/check-screen-permission-runtime.js'), 'utf8');
const safeSampleSource = fs.readFileSync(path.join(root, 'src/renderer/utils/safeSampleSource.js'), 'utf8');
const previewDataSource = fs.readFileSync(path.join(root, 'src/renderer/utils/previewData.js'), 'utf8');

assert.match(constantsSource, /SCREENSHOT_REQUESTED:\s*'screenshot:requested'/);
assert.match(preloadSource, /'screenshot:requested'/);
assert.match(constantsSource, /CAPTURE_INGRESS_LISTENER_READY:\s*'capture:listener-ready'/,
  'capture readiness must have one shared IPC channel');
assert.match(preloadSource, /'capture:listener-ready'/,
  'the isolated renderer must be allowed to announce capture listener readiness');
assert.match(constantsSource, /SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS:\s*'system:open-screen-recording-settings'/);
assert.match(preloadSource, /'system:open-screen-recording-settings'/);
assert.doesNotMatch(shortcutSource, /captureSelectedRegion|performOCR/, 'F2 must not run a separate capture pipeline');
assert.match(shortcutSource, /IPC_CHANNELS\.SCREENSHOT_REQUESTED/);
assert.match(shortcutSource, /function registerShortcuts\(dispatchCapture, settings = \{\}\)/,
  'global shortcuts must accept only the main-owned capture dispatcher');
assert.doesNotMatch(shortcutSource, /\bmainWindow\b|webContents\.send|\.show\(\)|\.focus\(\)/,
  'global shortcuts must never reveal, focus, or send directly to a renderer');
assert.match(shortcutSource,
  /if \(!payload\.text\.trim\(\)\)[\s\S]*?dispatchCapture\(\{[\s\S]*?CLIPBOARD_TEXT_CHANGED[\s\S]*?error: '剪贴板里没有可解释的文本'/,
  'empty clipboard errors must cross the same readiness-aware dispatcher');

assert.match(mainSource, /createCaptureIngressRegistry\(\)/,
  'main must own an in-memory capture ingress registry');
assert.match(mainSource, /registerShortcuts\(dispatchCaptureIngress, settings\)/,
  'configured shortcuts must stay wired to the readiness-aware dispatcher');
assert.match(mainSource,
  /function dispatchCaptureIngress\(event\)[\s\S]*?explicitShortcut[\s\S]*?showMainWindow\(\)[\s\S]*?captureIngressRegistry\.dispatch\(senderId, event, deliverCaptureIngress\)/,
  'explicit shortcuts must request the guarded reveal before entering the registry');
assert.match(mainSource,
  /captureIngressRegistry\.begin\(rendererSenderId\)[\s\S]*?did-start-navigation[\s\S]*?captureIngressRegistry\.markNotReady\(rendererSenderId\)/,
  'main-frame creation and navigation must reset capture listener readiness');
assert.match(mainSource,
  /ipcMain\.handle\(IPC_CHANNELS\.CAPTURE_INGRESS_LISTENER_READY,[\s\S]*?assertTrustedCaptureIngressIpc\(event\)[\s\S]*?captureIngressRegistry\.markReady\(event\.sender\.id, deliverCaptureIngress\)/,
  'only the current trusted renderer may release a pending capture');
const clipboardMonitorSource = mainSource.match(
  /function startClipboardMonitoring\(\) \{[\s\S]*?\n\}\n\nfunction stopClipboardMonitoring/,
)?.[0] || '';
assert.ok(clipboardMonitorSource, 'clipboard monitoring ingress must remain statically inspectable');
assert.match(clipboardMonitorSource,
  /dispatchCaptureIngress\(\{[\s\S]*?CLIPBOARD_TEXT_CHANGED[\s\S]*?source: 'monitor'/,
  'passive clipboard monitoring must use the bounded capture dispatcher');
assert.doesNotMatch(clipboardMonitorSource, /showMainWindow|\.show\(\)|\.focus\(\)/,
  'passive clipboard monitoring must not reveal or focus the app');

assert.match(clipboardHookSource, /on\(IPC_CHANNELS\.CLIPBOARD_TEXT_CHANGED/,
  'the clipboard capture listener must subscribe in the renderer');
assert.match(rendererSource, /on\(IPC_CHANNELS\.SCREENSHOT_REQUESTED/,
  'the screenshot capture listener must subscribe in the renderer');
assert.match(rendererSource,
  /const announceReady = async \(\) => \{[\s\S]*?invoke\(IPC_CHANNELS\.CAPTURE_INGRESS_LISTENER_READY\)[\s\S]*?response\?\.ready === true[\s\S]*?window\.setTimeout\(announceReady, 250\)/,
  'a failed capture readiness handshake must retry until main confirms readiness');
assert.match(rendererSource,
  /void Promise\.resolve\(\)\.then\(announceReady\)/,
  'renderer readiness must be deferred until capture subscription effects have installed');
assert.match(rendererSource,
  /return \(\) => \{[\s\S]*?cancelled = true;[\s\S]*?window\.clearTimeout\(retryTimer\)/,
  'unmount must cancel a pending capture readiness retry');
assert.ok(
  rendererSource.indexOf('useClipboard()')
    < rendererSource.indexOf('on(IPC_CHANNELS.SCREENSHOT_REQUESTED')
    && rendererSource.indexOf('on(IPC_CHANNELS.SCREENSHOT_REQUESTED')
      < rendererSource.indexOf('invoke(IPC_CHANNELS.CAPTURE_INGRESS_LISTENER_READY'),
  'clipboard and screenshot subscriptions must be declared before the readiness handshake',
);

assert.match(mainSource, /async function captureScreenshotTask/,
  'button and F2 must converge on a single capture task');
assert.match(permissionDiagnosticSource, /systemPreferences\.getMediaAccessStatus\('screen'\)/,
  'the read-only diagnostic must use the same native macOS permission status as capture preflight');
assert.match(mainSource, /mainWindow\.hide\(\)[\s\S]*?captureSelectedRegion/,
  'the always-on-top window must be hidden before native selection starts');
assert.match(mainSource, /finally \{[\s\S]*?restoreWindowAfterCapture/,
  'the window must be restored on success, cancellation and failure');
assert.match(mainSource, /captureAbortController = controller/);
assert.match(mainSource, /if \(captureRequestInFlight\) return userError\(USER_ERRORS\.SCREENSHOT_BUSY\)/);
assert.match(mainSource, /backgroundTask = beginBackgroundTask\('capture'\)[\s\S]*?windowState = await hideWindowForCapture\(\)/,
  'tray ownership must exist before native selection hides the renderer');
assert.match(mainSource, /phase = 'ocr'[\s\S]*?handoffBackgroundTask\(backgroundTask, 'ocr'\)[\s\S]*?OCRService\.performOCR/,
  'capture and local OCR must share one background task without an intermediate completion');
assert.match(mainSource, /backgroundTaskHandoffRegistry\.arm\(\{[\s\S]*?sourceText: textPayload\.text,[\s\S]*?handoffArmed = true/,
  'successful OCR must enter a bounded analysis handoff instead of announcing premature completion');
assert.match(mainSource, /backgroundTaskHandoffRegistry\.claim\(\{[\s\S]*?sourceKind: request\.source,[\s\S]*?handoffBackgroundTask\(pendingOcrHandoff\.task, 'analysis'\)/,
  'matching OCR analysis must claim the same background task identity');
assert.match(mainSource, /if \(backgroundTask && !handoffArmed\) finishBackgroundTask\(backgroundTask, taskOutcome\)/,
  'capture failures and cancellation must settle, while armed OCR success waits for analysis');
assert.match(mainSource, /const initialPermissionStatus = getScreenRecordingAccessStatus\(\)[\s\S]*?SCREENSHOT_PERMISSION_DENIED[\s\S]*?windowState = await hideWindowForCapture\(\)/,
  'known permission denial must be reported before hiding the app or starting selection');
assert.match(mainSource, /catch \(error\) \{[\s\S]*?getScreenRecordingAccessStatus\(\)[\s\S]*?SCREENSHOT_PERMISSION_DENIED[\s\S]*?error\?\.isCancellation/,
  'a denial that occurs during the macOS prompt must not be mistaken for ordinary selection cancellation');
assert.match(mainSource, /const SCREEN_RECORDING_SETTINGS_URL = 'x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_ScreenCapture'/,
  'screen recording recovery must target the fixed macOS privacy pane');
assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS[\s\S]*?assertTrustedIpc\(event\)[\s\S]*?shell\.openExternal\(SCREEN_RECORDING_SETTINGS_URL/,
  'only a trusted renderer may open the fixed screen recording settings page');

assert.match(rendererSource, /const lastGoodRef = useRef/,
  'renderer must retain a last-good result snapshot');
assert.match(rendererSource, /const screenshotRunRef = useRef/,
  'renderer must deduplicate button and F2 capture requests');
assert.match(rendererSource, /const \[processingPhase, setProcessingPhase\] = useState\(PROCESSING_PHASE\.ANALYSIS\)/,
  'ordinary manual and clipboard processing must begin in the analysis phase');
assert.match(rendererSource, /setProcessingPhase\(PROCESSING_PHASE\.CAPTURE\)[\s\S]*?requestAnimationFrame[\s\S]*?IPC_CHANNELS\.SCREENSHOT_CAPTURE/,
  'renderer must paint and announce the local capture phase before native screenshot selection starts');
assert.match(rendererSource, /setProcessingPhase\(PROCESSING_PHASE\.ANALYSIS\)[\s\S]*?requestCoordinatorRef\.current\.schedule/,
  'renderer must switch to analysis before scheduling any LLM work');
assert.match(rendererSource, /processingPhase === PROCESSING_PHASE\.CAPTURE[\s\S]*?SCREENSHOT_CAPTURE_SOURCE_SUMMARY/,
  'capture must use a fixed source summary instead of stale or private source text');
assert.match(rendererSource, /processingPhase === PROCESSING_PHASE\.CAPTURE[\s\S]*?SCREENSHOT_CAPTURE_PRIVACY_DISCLOSURE/,
  'capture must disclose that selection and OCR happen locally');
const captureSummary = rendererSource.match(
  /const SCREENSHOT_CAPTURE_SOURCE_SUMMARY = Object\.freeze\(\{[\s\S]*?\}\);/,
)?.[0] || '';
assert.ok(captureSummary, 'capture source summary must remain statically inspectable');
assert.doesNotMatch(captureSummary, /inputText|processedSourceText|screenshot\.text|clipboard/i,
  'capture status must never interpolate private source or clipboard content');
assert.match(loadingOverlaySource, /phase = 'analysis'/);
assert.match(loadingOverlaySource, /框选截图并在本机识别文字/);
assert.match(loadingOverlaySource, /截图与 OCR 仅在本机进行|本机识别文字/,
  'capture overlay must communicate the local OCR boundary');
assert.match(loadingOverlaySource, /提醒不会包含截图或识别文字/,
  'background progress copy must explicitly exclude private screenshot and OCR content');
assert.match(rendererSource, /response\?\.cancelled[\s\S]*?restoreLastGood/,
  'processing cancellation must restore last-good state');
assert.match(rendererSource, /screenshot\?\.cancelled[\s\S]*?restoreLastGood/,
  'screenshot cancellation must restore last-good state');
assert.match(rendererSource, /onCancel=\{\(\) => handleCancelProcessing\(\)\}/,
  'ordinary cancellation must not clear the source text');
assert.match(rendererSource, /previousProcessingConfigRef/,
  'changing the processing provider must invalidate a stale failure without discarding the source');
assert.match(rendererSource, /status === STATUS\.DONE && lastGoodRef\.current[\s\S]*?resolveSnapshotWarning\(snapshot, processingConfigSignature\)/,
  'changing provider after a failed retry must remove the old provider error from a preserved result');
assert.match(rendererSource, /status === STATUS\.PROCESSING[\s\S]*?shouldRestoreLastGoodAfterConfigChange[\s\S]*?if \(restoreRetry && restoreLastGood\(\)\) return/,
  'a config change during a same-source retry must restore the last result instead of dropping it');
assert.match(rendererSource, /processingConfigSignature: requestConfigSignature/,
  'last-good results must remember the exact processing configuration that produced them');
assert.match(rendererSource, /setWarning\(resolveSnapshotWarning\(snapshot, processingConfigSignature, message\)\)/,
  'restoring a last-good result must reconcile it against the current processing configuration');
assert.match(rendererSource, /const invalidateVerification = useCallback[\s\S]*?setVerificationApprovalId\(null\)[\s\S]*?withVerificationApproval\(lastGoodRef\.current, null\)/,
  'starting a retry must not let a restored result reuse an approval invalidated by main');
assert.match(rendererSource, /processingConfigChangeKey = `\$\{processingConfigSignature\}\\u0000\$\{processingConfigRevision\}`/,
  'renderer must invalidate in-flight work when a hidden credential is rotated');
assert.match(rendererSource, /settings\.verificationPolicy/,
  'verification policy changes must invalidate processing that could access official sources');
assert.match(rendererSource, /previousVerificationPolicyRef[\s\S]*?setVerificationApprovalId\(null\)[\s\S]*?withVerificationApproval\(lastGoodRef\.current, null\)[\s\S]*?verificationRunRef\.current = \{[\s\S]*?IPC_CHANNELS\.LLM_CANCEL[\s\S]*?setIsVerifying\(false\)/,
  'changing verification policy must abort and invalidate an active official-source lookup');
assert.match(rendererSource, /const nextApprovalId = response\?\.retryApprovalId[\s\S]*?setVerificationApprovalId\(nextApprovalId\)[\s\S]*?withVerificationApproval\(lastGoodRef\.current, nextApprovalId\)/,
  'verification failure must mirror a consumed or refreshed approval into the last-good snapshot');

for (const code of [
  'processing-key-missing',
  'ollama-unavailable',
  'ollama-runtime-failed',
  'model-not-found',
  'processing-timeout',
  'processing-invalid',
  'screenshot-permission-denied',
  'screenshot-ocr-failed',
]) {
  assert.match(mainSource, new RegExp(`code: '${code}'`), `missing safe processing error ${code}`);
  assert.match(rendererSource, new RegExp(`'${code}':`), `renderer does not map ${code}`);
}
assert.match(mainSource, /function classifyProcessingError/);
assert.match(mainSource, /retryApprovalId/,
  'verification failures must return a retry approval without rerunning the LLM');
assert.match(rendererSource, /response\?\.retryApprovalId/,
  'renderer must retain a verification retry approval');
assert.match(rendererSource, /captureErrorCode === 'screenshot-permission-denied'/);
assert.match(rendererSource, /打开屏幕录制设置/);
assert.match(rendererSource, /返回后重新截图/);
assert.match(rendererSource, /IPC_CHANNELS\.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS/,
  'permission recovery must open the macOS pane instead of the app settings');
assert.match(rendererSource, /status === STATUS\.DONE[\s\S]*?setWarning\(message\)[\s\S]*?setError\(message\)/,
  'failure to open System Settings must remain visible in both capture and preserved-result states');
assert.match(rendererSource, /restoreLastGood\(message, screenshot\?\.errorCode \|\| null\)/,
  'a failed recapture must preserve both the last result and its permission recovery');
assert.match(rendererSource, /screenRecordingPermissionDenied=\{isScreenshotPermissionError\}/);
assert.match(resultDisplaySource, /screenRecordingPermissionDenied[\s\S]*?打开屏幕录制设置[\s\S]*?返回后重新截图/,
  'permission recovery must remain actionable when the last valid result is restored');
assert.match(rendererSource, /permissionRecoveryButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  'keyboard focus must move to the permission recovery action without jumping the page');
assert.match(rendererSource, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/,
  'permission recovery must remain visible when it is inserted above the previous focus target');
assert.match(appStyles, /\.error-card__actions button:focus-visible/);
assert.match(appStyles, /\.inline-warning__actions button:focus-visible/);
assert.match(appStyles, /@media \(max-width: 520px\)[\s\S]*\.error-card\.is-permission-recovery/);
assert.match(appStyles, /@media \(max-width: 720px\)[\s\S]*\.inline-warning__actions/);

assert.match(ipcSource, /\['capture', 'result', 'setup'\]/,
  'development preview must support the empty capture path');
assert.match(ipcSource, /demoCaptureCode === 'permission-denied'/,
  'development preview must reproduce the permission recovery path');
assert.match(ipcSource, /demoCaptureCode === 'slow' \? 30000/,
  'development preview must keep the local capture phase inspectable');
assert.match(ipcSource, /demoCaptureCode === 'ocr-fail'[\s\S]*?demoCaptureFailuresRemaining/,
  'development preview must reproduce persistent and fail-once OCR errors');
assert.match(ipcSource, /if \(demoScreenshotPending\)[\s\S]*?pending\.resolve\(\{ success: false, cancelled: true \}\)/,
  'the delayed screenshot fixture must preserve the production cancellation contract');
assert.match(rendererSource, /载入安全示例/);
assert.match(rendererSource, /虚构示例已载入，不包含你的数据/);
const exampleHandler = rendererSource.match(
  /const handleLoadExample = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[[^\]]*\]\);/,
)?.[0] || '';
assert.ok(exampleHandler, 'the safe example handler must remain statically inspectable');
assert.match(exampleHandler, /setInputText\(PREVIEW_SOURCE_TEXT\)/,
  'the example must use the grounded preview source');
assert.match(exampleHandler, /setSourceType\('sample'\)/);
assert.match(exampleHandler, /setSelectionRange\(0, 0\)[\s\S]*?scrollTop = 0/,
  'the loaded example must begin at the first line when focus moves into the editor');
assert.match(exampleHandler, /focus\(\{ preventScroll: true \}\)/,
  'loading the safe example should not jump the surrounding capture page');
assert.doesNotMatch(exampleHandler, /triggerProcessing|IPC_CHANNELS\.LLM_PROCESS/,
  'loading the example must never submit or process it automatically');
assert.match(safeSampleSource, /Please generate the eVisa share code within one day of this email/,
  'the safe sample must keep an actionable near-term generation deadline');
assert.match(safeSampleSource, /All items must be received within two days of this email/,
  'the safe sample must keep a separate submission deadline');
assert.ok(
  safeSampleSource.indexOf('within one day') < safeSampleSource.indexOf('within two days'),
  'the safe sample must present its dependent deadlines in action order',
);
assert.doesNotMatch(safeSampleSource, /\b(?:19|20)\d{2}\b/,
  'the user-facing safe sample must not age into an already-overdue fixed year');
assert.doesNotMatch(previewDataSource, /calendarDate:\s*'\d{4}-\d{2}-\d{2}'/,
  'relative fictional deadlines must not invent absolute calendar dates');
assert.match(previewDataSource,
  /id: 'deadline-within-one-day',[\s\S]*?whenText: '收到邮件后一天内',[\s\S]*?calendarDate: null/,
  'the first fictional deadline must stay relative and grounded');
assert.match(previewDataSource,
  /id: 'deadline-within-two-days',[\s\S]*?whenText: '收到邮件后两天内',[\s\S]*?calendarDate: null/,
  'the submission deadline must stay relative and grounded');
assert.match(previewDataSource,
  /id: 'step-submit',[\s\S]*?deadlineId: 'deadline-within-two-days',[\s\S]*?prerequisiteStepIds: \['step-generate-share-code', 'step-prepare-passport'\]/,
  'the timeless sample must preserve generate-and-prepare before submit');
assert.match(previewDataSource,
  /id: 'step-reply',[\s\S]*?prerequisiteStepIds: \['step-submit'\]/,
  'the timeless sample must preserve submit before reply');
assert.match(rendererSource, /source: options\.source \|\| \(usesCurrentInput \? sourceType : 'manual'\)/,
  'manual submission must preserve whether the current source came from a sample or clipboard');
assert.match(appStyles, /\.capture-sample button:focus-visible/);
assert.match(appStyles, /@media \(max-width: 520px\)[\s\S]*\.capture-sample/);

console.log('capture and recovery integrity checks passed');
