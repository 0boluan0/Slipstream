import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPendingClipboardItem,
  describePendingClipboard,
  shouldHoldClipboardCapture,
} from '../src/renderer/utils/clipboardMonitorQueue.mjs';

assert.equal(shouldHoldClipboardCapture({
  source: 'manual-read',
  status: 'idle',
  hasInput: false,
}), false, 'an explicit manual read may populate an empty idle capture directly');
assert.equal(shouldHoldClipboardCapture({
  source: 'manual-read',
  status: 'idle',
  hasInput: true,
}), true, 'an explicit manual read must wait before replacing a source draft');
assert.equal(shouldHoldClipboardCapture({
  source: 'manual-read',
  status: 'done',
  hasResult: true,
}), true, 'an explicit manual read must wait before replacing a completed result');

const monitor = createPendingClipboardItem({ text: 'automatic copy', source: 'monitor' });
const shortcut = createPendingClipboardItem({ text: 'shortcut copy', source: 'shortcut' }, monitor);
const manualRead = createPendingClipboardItem({
  text: 'explicit manual read',
  source: 'manual-read',
}, shortcut);

assert.equal(monitor.source, 'monitor');
assert.equal(shortcut.source, 'shortcut');
assert.equal(manualRead.source, 'manual-read', 'manual reads must remain distinguishable from shortcut and monitor captures');
assert.equal(manualRead.text, 'explicit manual read');
const clearUndoManualRead = createPendingClipboardItem({
  text: 'explicit manual read during clear undo',
  source: 'manual-read',
  foregroundReason: 'clear-undo',
});
assert.equal(clearUndoManualRead.foregroundReason, 'clear-undo');

const afterMonitor = createPendingClipboardItem({
  text: 'later automatic copy',
  source: 'monitor',
}, manualRead);
const afterShortcut = createPendingClipboardItem({
  text: 'later shortcut copy',
  source: 'shortcut',
}, afterMonitor);

assert.equal(afterMonitor.source, 'manual-read');
assert.equal(afterMonitor.text, 'explicit manual read', 'automatic monitoring must not overwrite a waiting manual read');
assert.equal(afterShortcut.source, 'manual-read');
assert.equal(afterShortcut.text, 'explicit manual read', 'a later shortcut capture must not overwrite a waiting manual read');
assert.equal(afterShortcut.skippedAutomaticCount, 2);

const manualForegroundCases = [
  ['source-edit', '未保存的修正未变', '放弃修正并替换'],
  ['source-draft', '原文草稿未变', '放弃草稿并替换'],
  ['clear-undo', '撤销倒计时已暂停', '结束撤销并替换'],
];

for (const [foregroundReason, unchangedCopy, actionLabel] of manualForegroundCases) {
  const copy = describePendingClipboard(manualRead, { foregroundReason });
  assert.match(copy.title, /手动读取的文字/);
  assert.match(copy.detail, new RegExp(unchangedCopy));
  assert.match(copy.detail, /确认替换/);
  assert.match(copy.detail, /不会自动处理或发送给模型/);
  assert.equal(copy.actionLabel, actionLabel);
}

const retainedClearUndoCopy = describePendingClipboard(clearUndoManualRead);
assert.match(retainedClearUndoCopy.detail, /从剩余时间继续/);
assert.equal(retainedClearUndoCopy.ignoreLabel, '保留撤销机会');

const genericManualCopy = describePendingClipboard(manualRead);
assert.match(genericManualCopy.title, /手动读取/);
assert.equal(genericManualCopy.actionLabel, '替换当前内容');
assert.match(genericManualCopy.detail, /不会自动处理或发送给模型/);

const busyManualCopy = describePendingClipboard(manualRead, { busy: true });
assert.match(busyManualCopy.title, /手动读取/);
assert.equal(busyManualCopy.actionLabel, '替换当前内容');

const shortcutSourceEditCopy = describePendingClipboard(shortcut, {
  foregroundReason: 'source-edit',
});
assert.equal(shortcutSourceEditCopy.actionLabel, '放弃修正并处理');
assert.match(shortcutSourceEditCopy.detail, /处理新文字并成功生成结果后/);
const monitoredBusyCopy = describePendingClipboard(monitor, { busy: true });
assert.equal(monitoredBusyCopy.actionLabel, '处理新文字');
assert.match(monitoredBusyCopy.title, /新的复制文字正在等待/);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  path.resolve(scriptDir, '../src/renderer/components/FloatingPanel.jsx'),
  'utf8',
);
const sliceCallback = (startNeedle, endNeedle) => {
  const start = panelSource.indexOf(startNeedle);
  const end = panelSource.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle} must remain inspectable`);
  return panelSource.slice(start, end);
};

const commitSource = sliceCallback(
  'const commitManualClipboardRead = useCallback(',
  'const handlePaste = useCallback(',
);
assert.match(commitSource, /if \(!payload\?\.text\?\.trim\(\)\) return false/);
assert.match(commitSource, /discardClearedSession\(\)/);
assert.match(commitSource, /setSourceEditDraft\(\(current\) => updateSourceEditDraft/);
assert.match(commitSource, /尚未开始处理，请先检查内容/);
assert.doesNotMatch(commitSource, /triggerProcessing|applyClipboardPayload/);

const readSource = sliceCallback(
  'const handlePaste = useCallback(async () => {',
  'const handleSourceLimitRecovery',
);
assert.match(readSource, /clipboardReadReturnFocusRef\.current = document\.activeElement/);
assert.match(readSource, /source: 'manual-read'/);
assert.match(readSource, /pauseClearedSessionUndo\(attemptToken\)/);
assert.match(readSource, /pendingManualClipboardFocusTokenRef\.current = attemptToken/);
assert.match(readSource, /setPendingClipboardItem\(next\)/);
assert.match(readSource, /当前内容未变/);
assert.doesNotMatch(readSource, /discardClearedSession\(\)/);
assert.doesNotMatch(readSource, /triggerProcessing|applyClipboardPayload/);
assert.doesNotMatch(readSource,
  /requestAnimationFrame\([\s\S]{0,240}?pendingClipboardStatusRef\.current/,
  'manual replacement focus must be owned after the decision DOM commits, not by a one-shot frame');
const protectedReadSource = readSource.slice(
  0,
  readSource.indexOf('} else {\n          commitManualClipboardRead(payload);'),
);
assert.doesNotMatch(
  protectedReadSource,
  /setCaptureErrorCode\(null\)|setProcessingErrorCode\(null\)/,
  'starting or deferring a useful manual read must preserve the current recovery context',
);
const failedReadSource = readSource.slice(readSource.indexOf('      } else {'));
assert.match(failedReadSource, /setCaptureErrorCode\(null\)/);
assert.match(failedReadSource, /setProcessingErrorCode\(null\)/);

const clipboardEventSource = sliceCallback(
  "const isMonitoredClipboard = clipboardEvent.source === 'monitor';",
  'const invalidateVerification = useCallback',
);
assert.match(clipboardEventSource, /manualReadDecisionPreserved/);
assert.match(clipboardEventSource, /shortcutCapture \? '快捷键捕获' : '自动检测'/);
assert.match(clipboardEventSource, /未保留；手动读取确认未变，请先选择替换或保留/);

const acceptSource = sliceCallback(
  'const handleProcessPendingClipboard = useCallback(',
  'useEffect(() => {\n    const requestId = approvedCaptureRequest?.id;',
);
assert.match(acceptSource, /const isManualRead = item\.source === 'manual-read'/);
assert.match(acceptSource, /commitManualClipboardRead\(item, \{ confirmedReplacement: true \}\)/);
assert.match(acceptSource, /尚未处理，请检查后再生成/);

const keepSource = sliceCallback(
  'const handleIgnorePendingClipboard = useCallback(',
  'useEffect(() => {\n    const wasBlocking = previousForegroundClipboardBlockingRef.current;',
);
assert.match(keepSource, /剪贴板文字已丢弃，未开始处理/);
assert.match(keepSource, /clipboardReadReturnFocusRef\.current/);
assert.match(keepSource, /exactReturnTarget\?\.isConnected/);
assert.match(keepSource, /resumeClearedSessionUndo\(\)/);
assert.ok(
  keepSource.indexOf("ignoredReason === 'clear-undo'")
    < keepSource.indexOf('exactReturnTarget?.isConnected'),
  'Keep during Clear Undo must return focus to the resumed Undo before the read trigger',
);

assert.match(panelSource, /disabled=\{isReadingClipboard \|\| manualClipboardReadPending\}/);
assert.match(panelSource, /\|\| manualClipboardReadPending\n\s+\}/);
assert.match(panelSource,
  /useLayoutEffect\(\(\) => \{\s*const focusToken = pendingManualClipboardFocusTokenRef\.current;[\s\S]*?focusAvailableElement\(pendingClipboardStatusRef\.current\)[\s\S]*?focusedManualClipboardTokenRef\.current = focusToken/,
  'a committed manual replacement decision must synchronously claim focus exactly once per read');

console.log('Manual clipboard read contract checks passed.');
