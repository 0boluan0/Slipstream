import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  createPendingClipboardItem,
  describePendingClipboard,
  pendingClipboardPreview,
  shouldHoldClipboardCapture,
  shouldHoldMonitoredClipboard,
} from '../src/renderer/utils/clipboardMonitorQueue.mjs';

const require = createRequire(import.meta.url);
const {
  createClipboardPendingTrayPresentation,
  normalizeClipboardPendingStatus,
} = require('../src/main/clipboard-pending-status.js');

assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: true, status: 'idle', hasInput: false,
}), false, 'an empty idle capture should still auto-process monitored clipboard text');
assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: true, status: 'processing', hasInput: true,
}), true, 'a running task must be protected from monitored clipboard replacement');
assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: true, status: 'done', hasResult: true,
}), true, 'a completed result must remain visible until the user chooses to replace it');
assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: true, status: 'idle', hasInput: true,
}), true, 'an unsubmitted source draft must not be overwritten by automatic monitoring');
assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: true, status: 'done', isVerifying: true,
}), true, 'official-source verification must not be displaced by a new clipboard event');
assert.equal(shouldHoldMonitoredClipboard({
  source: 'monitor', monitoringEnabled: false, status: 'done', hasResult: true,
}), false, 'a stale monitor event is ignored by the caller once monitoring is disabled');
assert.equal(shouldHoldClipboardCapture({
  source: 'shortcut', monitoringEnabled: true, status: 'done', hasResult: true,
}), true, 'an explicit clipboard shortcut must wait instead of replacing protected content');

const first = createPendingClipboardItem({ text: 'first', originalLength: 5 });
const latest = createPendingClipboardItem({ text: 'latest', originalLength: 6 }, first);
assert.equal(first.receivedCount, 1);
assert.equal(latest.receivedCount, 2);
assert.equal(latest.text, 'latest', 'only the latest monitored clipboard payload should be retained');
assert.equal(createPendingClipboardItem({ text: 'bounded' }, { receivedCount: 999 }).receivedCount, 999);
assert.equal(pendingClipboardPreview('  one\n two  '), 'one two');
assert.equal(pendingClipboardPreview('abcdefgh', 5), 'abcd…');
assert.match(describePendingClipboard(latest, { busy: true }).title, /连续检测到 2 段/);
assert.match(describePendingClipboard(latest, { busy: true }).detail, /当前任务不会被替换/);
const shortcut = createPendingClipboardItem({ text: 'chosen', source: 'shortcut' }, latest);
assert.equal(shortcut.source, 'shortcut');
assert.match(describePendingClipboard(shortcut, { busy: true }).title, /快捷键捕获/);
const sourceEditDecision = describePendingClipboard(shortcut, {
  foregroundReason: 'source-edit',
});
assert.match(sourceEditDecision.title, /原文修正决定/);
assert.match(sourceEditDecision.detail, /未保存的修正没有改变/);
assert.equal(sourceEditDecision.actionLabel, '放弃修正并处理');
assert.equal(sourceEditDecision.ignoreLabel, '继续修正');
const sourceDraftDecision = describePendingClipboard(shortcut, {
  foregroundReason: 'source-draft',
});
assert.equal(sourceDraftDecision.actionLabel, '放弃草稿并处理');
assert.equal(sourceDraftDecision.ignoreLabel, '继续编辑原文');
const clearUndoDecision = describePendingClipboard(shortcut, {
  foregroundReason: 'clear-undo',
});
assert.equal(clearUndoDecision.actionLabel, '放弃撤销并处理');
assert.equal(clearUndoDecision.ignoreLabel, '保留撤销机会');
const quitDecision = describePendingClipboard(shortcut, {
  foregroundReason: 'app-decision',
});
assert.match(quitDecision.detail, /确认层背后/);
const clipboardResidueDecision = describePendingClipboard(shortcut, {
  foregroundReason: 'clipboard-residue',
});
assert.match(clipboardResidueDecision.title, /剪贴板检查/);
assert.match(clipboardResidueDecision.detail, /手动覆盖/);
const protectedShortcut = createPendingClipboardItem({ text: 'automatic', source: 'monitor' }, shortcut);
assert.equal(protectedShortcut.text, 'chosen', 'automatic monitoring must not replace an explicit waiting shortcut capture');
assert.equal(protectedShortcut.skippedAutomaticCount, 1);

assert.deepEqual(normalizeClipboardPendingStatus({ pending: false, count: 99 }), { pending: false, count: 0 });
assert.deepEqual(normalizeClipboardPendingStatus({ pending: true, count: 0 }), { pending: true, count: 1 });
assert.deepEqual(normalizeClipboardPendingStatus({ pending: true, count: 2000 }), { pending: true, count: 999 });
const tray = createClipboardPendingTrayPresentation({ pending: true, count: 3 });
assert.equal(tray.trayTitle, '•');
assert.match(tray.statusLabel, /仅保留最近一段/);
assert.equal(tray.actionLabel, '显示等待内容');

const panelSource = fs.readFileSync(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
const preloadSource = fs.readFileSync(new URL('../preload.js', import.meta.url), 'utf8');
const ipcSource = fs.readFileSync(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');
const quitSource = fs.readFileSync(new URL('../src/renderer/utils/quitSafety.mjs', import.meta.url), 'utf8');
const privacyDoc = fs.readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
const releaseDoc = fs.readFileSync(new URL('../../docs/RELEASE.md', import.meta.url), 'utf8');

assert.match(panelSource, /shouldHoldClipboardCapture\(\{/);
assert.match(panelSource, /clipboardMonitoringEnabledRef\.current/);
assert.match(panelSource, /const previousPending = pendingClipboardRef\.current;[\s\S]{0,180}createPendingClipboardItem\(clipboardEvent, previousPending, \{[\s\S]{0,120}replyDraftProtected/);
assert.match(panelSource, /pendingClipboardCopy\.actionLabel/);
assert.match(panelSource, /describePendingClipboard\(pendingClipboardItem/);
assert.match(panelSource, /pendingClipboardDecisionStillBlocking/);
assert.match(panelSource, /focusAvailableElement\(pendingClipboardStatusRef\.current\)/);
assert.match(panelSource, /focusAvailableElement\(document\.getElementById\('result-headline'\)\)/);
assert.match(panelSource, /pendingClipboardRef\.current = null/);
assert.match(panelSource, /IPC_CHANNELS\.CLIPBOARD_PENDING_STATUS/);
assert.match(panelSource, /hasPendingClipboard: Boolean\(pendingClipboardItem\)/);
assert.match(mainSource, /normalizeClipboardPendingStatus\(payload\)/);
assert.match(mainSource, /pending\.actionLabel/);
assert.match(preloadSource, /'clipboard:pending-status'/);
assert.match(ipcSource, /monitorEvents/);
assert.match(ipcSource, /foreground-clipboard/);
assert.match(ipcSource, /source: 'monitor'/);
assert.match(quitSource, /系统剪贴板不会被清除/);
assert.match(privacyDoc, /only the latest waiting copy is retained in renderer memory/);
assert.match(privacyDoc, /macOS menu receives only a waiting flag and count, never the waiting text/);
assert.match(releaseDoc, /new copy cannot silently replace a task, draft, verification, or completed result/);

console.log('Clipboard monitor collision checks passed.');
