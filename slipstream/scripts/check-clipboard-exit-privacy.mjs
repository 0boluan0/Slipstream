import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beginClipboardCopy,
  createCopiedClipboardNotice,
  markClipboardNoticeAfterTaskExit,
  settleClipboardCopyFailure,
} from '../src/renderer/utils/clipboardNotice.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const copiedReply = createCopiedClipboardNotice('reply', {
  success: true,
  consequenceId: 'reply-consequence',
});
const retainedReply = markClipboardNoticeAfterTaskExit(copiedReply);
assert.deepEqual(retainedReply, {
  kind: 'reply',
  status: 'retained',
  consequenceId: 'reply-consequence',
  taskExited: true,
  dismissed: false,
  message: '任务已结束，系统剪贴板仍保留英文回复',
  detail: 'Slipstream 不会自动读取、清除或覆盖；使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
});
assert.equal(markClipboardNoticeAfterTaskExit(retainedReply), retainedReply,
  'repeated exit and undo cycles must retain the exact consequence id');

const settingsCopy = createCopiedClipboardNotice('diagnostics', {
  success: true,
  consequenceId: 'diagnostics-consequence',
});
assert.equal(markClipboardNoticeAfterTaskExit(settingsCopy), settingsCopy,
  'ending a result task must not erase a settings-owned clipboard consequence');
const savedTermPending = beginClipboardCopy({
  kind: 'saved-term-combined',
  requestId: 51,
  previousNotice: settingsCopy,
});
assert.equal(markClipboardNoticeAfterTaskExit(savedTermPending), savedTermPending,
  'ending a result task must not relabel a non-task clipboard operation');
assert.equal(savedTermPending.previousConsequence.consequenceId, 'diagnostics-consequence');

const pendingReplacement = beginClipboardCopy({
  kind: 'actions',
  requestId: 52,
  previousNotice: retainedReply,
});
const failedReplacement = settleClipboardCopyFailure(pendingReplacement, { requestId: 52 });
assert.equal(failedReplacement.consequenceId, 'reply-consequence');
assert.equal(failedReplacement.status, 'retained');
assert.match(failedReplacement.message, /仍可能保留先前内容/);
assert.match(failedReplacement.detail, /手动覆盖/);

const resultSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/ResultDisplay.jsx'),
  'utf8',
);
const noticeSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/ClipboardActionNotice.jsx'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/FloatingPanel.jsx'),
  'utf8',
);
const appSource = fs.readFileSync(path.join(root, 'src/renderer/App.jsx'), 'utf8');
const settingsSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/SettingsPanel.jsx'),
  'utf8',
);
const savedTermsSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/SavedTermsLibrary.jsx'),
  'utf8',
);
const cssSource = fs.readFileSync(path.join(root, 'src/renderer/App.css'), 'utf8');

assert.match(noticeSource, /export default function ClipboardActionNotice/);
assert.match(noticeSource,
  /const actionable = \['copied', 'outdated', 'retained', 'copy-error'\]\.includes\(notice\.status\)[\s\S]*?typeof notice\.consequenceId === 'string'/,
  'the notice must expose acknowledgement only for a concrete consequence id');
assert.match(noticeSource, /data-clipboard-consequence-ack/);
assert.match(noticeSource, /我已手动覆盖/);
assert.match(noticeSource, /此按钮不会读取或更改剪贴板/);
assert.match(resultSource, /import ClipboardActionNotice from '\.\/ClipboardActionNotice'/,
  'the deferred result workspace must consume the eager clipboard safety notice');

assert.match(appSource,
  /const \[clipboardNotice, setClipboardNoticeState\] = useState\(\{ status: 'idle' \}\)/);
assert.match(appSource,
  /const setClipboardNotice = useCallback\(\(nextOrUpdater\)[\s\S]*?clipboardNoticeRef\.current = next;[\s\S]*?setClipboardNoticeState\(next\)/,
  'clipboard consequence must have one synchronous App owner across navigation');
assert.match(panelSource,
  /setClipboardNotice\(\(current\) => markClipboardNoticeAfterTaskExit\(current\)\)/);
assert.match(panelSource, /!isDone && \[[\s\S]*?'copying'[\s\S]*?'copy-error'/,
  'pending and late failed writes must remain visible after task exit');
assert.match(panelSource,
  /notice=\{clipboardNotice\}[\s\S]*?onAcknowledge=\{handleAcknowledgeClipboardConsequence\}/);
assert.match(panelSource,
  /handleUndoClear[\s\S]*?reconcileReplyClipboardNotice\(current/,
  'Undo must reconcile the same consequence id without another clipboard write');

assert.match(appSource,
  /<FloatingPanel[\s\S]*?clipboardNotice=\{clipboardNotice\}[\s\S]*?onClipboardCopy=\{handleClipboardCopy\}/);
assert.match(appSource,
  /<SettingsPanel[\s\S]*?clipboardNotice=\{clipboardNotice\}[\s\S]*?onWriteClipboard=\{handleWriteClipboard\}/);
assert.match(settingsSource,
  /<ClipboardActionNotice[\s\S]*?notice=\{clipboardNotice\}[\s\S]*?onAcknowledge=\{onAcknowledgeClipboardConsequence\}/);
assert.match(panelSource,
  /<SavedTermsLibrary[\s\S]*?clipboardNotice=\{clipboardNotice\}[\s\S]*?onWriteClipboard=/);
assert.match(savedTermsSource,
  /<ClipboardActionNotice[\s\S]*?notice=\{clipboardNotice\}[\s\S]*?onAcknowledge=\{onAcknowledgeClipboardConsequence\}/);

const navigationStart = appSource.indexOf('const openSettings =');
const navigationEnd = appSource.indexOf('const handleHiddenCaptureRequest', navigationStart);
assert.ok(navigationStart >= 0 && navigationEnd > navigationStart);
assert.doesNotMatch(appSource.slice(navigationStart, navigationEnd), /setClipboardNotice/,
  'switching task and Settings must not reset the global consequence');
assert.match(cssSource, /\.clipboard-privacy-notice--retained/);
assert.match(cssSource, /\.clipboard-privacy-notice--copy-error/);

for (const [relativePath, source] of [
  ['ResultDisplay.jsx', resultSource],
  ['FloatingPanel.jsx', panelSource],
  ['SettingsPanel.jsx', settingsSource],
  ['SavedTermsLibrary.jsx', savedTermsSource],
]) {
  assert.doesNotMatch(source,
    /data-clipboard-clear-action|onClearClipboardCopy|createClipboardClearFailureNotice/,
    `${relativePath} must not expose an automatic-clear action`);
}

console.log('Clipboard exit privacy checks passed.');
