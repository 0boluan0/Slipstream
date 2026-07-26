const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const shortcutSource = fs.readFileSync(path.join(root, 'src/main/global-shortcut.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/components/FloatingPanel.jsx'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const constantsSource = fs.readFileSync(path.join(root, 'src/shared/constants.cjs'), 'utf8');

assert.match(constantsSource, /SCREENSHOT_REQUESTED:\s*'screenshot:requested'/);
assert.match(preloadSource, /'screenshot:requested'/);
assert.doesNotMatch(shortcutSource, /captureSelectedRegion|performOCR/, 'F2 must not run a separate capture pipeline');
assert.match(shortcutSource, /IPC_CHANNELS\.SCREENSHOT_REQUESTED/);

assert.match(mainSource, /async function captureScreenshotTask/,
  'button and F2 must converge on a single capture task');
assert.match(mainSource, /mainWindow\.hide\(\)[\s\S]*?captureSelectedRegion/,
  'the always-on-top window must be hidden before native selection starts');
assert.match(mainSource, /finally \{[\s\S]*?restoreWindowAfterCapture/,
  'the window must be restored on success, cancellation and failure');
assert.match(mainSource, /captureAbortController = controller/);
assert.match(mainSource, /if \(captureRequestInFlight\) return userError\(USER_ERRORS\.SCREENSHOT_BUSY\)/);

assert.match(rendererSource, /const lastGoodRef = useRef/,
  'renderer must retain a last-good result snapshot');
assert.match(rendererSource, /const screenshotRunRef = useRef/,
  'renderer must deduplicate button and F2 capture requests');
assert.match(rendererSource, /response\?\.cancelled[\s\S]*?restoreLastGood/,
  'processing cancellation must restore last-good state');
assert.match(rendererSource, /screenshot\?\.cancelled[\s\S]*?restoreLastGood/,
  'screenshot cancellation must restore last-good state');
assert.match(rendererSource, /onCancel=\{handleCancelProcessing\}/,
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

console.log('capture and recovery integrity checks passed');
