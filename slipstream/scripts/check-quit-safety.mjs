import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_QUIT_RISK,
  describeQuitRisk,
  hasQuitRisk,
  mergeQuitRisks,
  normalizeQuitRisk,
} from '../src/renderer/utils/quitSafety.mjs';

const require = createRequire(import.meta.url);
const { createQuitRequestRegistry } = require('../src/main/quit-request');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

assert.deepEqual(normalizeQuitRisk(), EMPTY_QUIT_RISK);
assert.deepEqual(normalizeQuitRisk({ activeAnalysis: true, unknown: true }), {
  ...EMPTY_QUIT_RISK,
  activeAnalysis: true,
});
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasPendingClipboardAcknowledgement'), true);
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasClipboardCopyConsequence'), true);
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasClipboardResidueRisk'), true);
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasPromptDraft'), true,
  'an advanced-instructions draft must be represented independently from connection fields');
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasPendingClipboardClear'), false);
assert.equal(Object.hasOwn(EMPTY_QUIT_RISK, 'hasGuardedClipboardCopy'), false);

assert.deepEqual(mergeQuitRisks(
  { hasSourceDraft: true, hasClipboardCopyConsequence: true },
  { hasResult: true, hasResetRecovery: true, settingsSaving: true },
), {
  ...EMPTY_QUIT_RISK,
  hasSourceDraft: true,
  hasResult: true,
  hasClipboardCopyConsequence: true,
  hasResetRecovery: true,
  settingsSaving: true,
});
assert.equal(hasQuitRisk(EMPTY_QUIT_RISK), false);
for (const key of [
  'hasPendingClipboardWrite',
  'hasPendingClipboardAcknowledgement',
  'hasClipboardCopyConsequence',
  'hasClipboardResidueRisk',
]) {
  assert.equal(hasQuitRisk({ [key]: true }), true, `${key} must prevent automatic quit`);
}
assert.equal(hasQuitRisk({ hasPromptDraft: true }), true,
  'an unsaved prompt must prevent renderer-side automatic quit');

assert.deepEqual(describeQuitRisk(), {
  title: '可以安全退出',
  items: ['当前没有尚未处理的会话内容；Slipstream 正在完成退出。'],
  confirmLabel: '退出 Slipstream',
  safeLabel: '继续使用 Slipstream',
  busy: false,
});

const activeCopy = describeQuitRisk({
  activeAnalysis: true,
  activeAnalysisLocation: 'online',
  hasSourceDraft: true,
});
assert.equal(activeCopy.title, '退出会停止当前任务');
assert.equal(activeCopy.confirmLabel, '停止任务并退出');
assert.match(activeCopy.items.join(' '), /在线服务可能已经接收原文并产生费用/);

const localActiveCopy = describeQuitRisk({
  activeAnalysis: true,
  activeAnalysisLocation: 'local',
});
assert.match(localActiveCopy.items.join(' '), /原文没有发送给在线模型服务/);
assert.doesNotMatch(localActiveCopy.items.join(' '), /产生费用/);

const loopbackActiveCopy = describeQuitRisk({
  activeAnalysis: true,
  activeAnalysisLocation: 'local-loopback',
});
assert.match(loopbackActiveCopy.items.join(' '), /本机回环服务/);
assert.match(loopbackActiveCopy.items.join(' '), /取决于自己的配置/);
assert.doesNotMatch(loopbackActiveCopy.items.join(' '), /在线服务可能已经接收/);

const localProviderTestCopy = describeQuitRisk({
  activeProviderTest: true,
  activeProviderTestLocation: 'local',
});
assert.match(localProviderTestCopy.items.join(' '), /不会产生在线模型调用费用/);

assert.equal(mergeQuitRisks(
  { activeAnalysis: true, activeAnalysisLocation: 'local' },
  { activeAnalysis: true, activeAnalysisLocation: 'online' },
).activeAnalysisLocation, 'online');

const promptDraftCopy = describeQuitRisk({ hasPromptDraft: true });
assert.equal(promptDraftCopy.title, '退出会丢失未保存内容');
assert.equal(promptDraftCopy.busy, false);
assert.match(promptDraftCopy.items.join(' '), /未保存的高级分析说明会丢失/);
assert.match(promptDraftCopy.items.join(' '), /已经保存的说明与其他配置不受影响/);
assert.doesNotMatch(promptDraftCopy.items.join(' '), /API Key、服务地址或模型草稿/,
  'prompt-only quit copy must not falsely claim that connection fields will be lost');

const savingPromptCopy = describeQuitRisk({ hasPromptDraft: true, settingsSaving: true });
assert.equal(savingPromptCopy.busy, true);
assert.match(savingPromptCopy.items.join(' '), /设置仍在保存/);
assert.match(savingPromptCopy.busyMessage, /保存失败，草稿会继续保留/,
  'an unsettled prompt save must block destructive quit and explain failure recovery');

const pendingWrite = describeQuitRisk({ hasPendingClipboardWrite: true });
assert.equal(pendingWrite.title, '正在确认剪贴板复制');
assert.equal(pendingWrite.busy, true);
assert.equal(pendingWrite.confirmLabel, '等待复制完成');
assert.equal(pendingWrite.safeLabel, '取消退出并等待复制');
assert.match(pendingWrite.busyMessage, /完成前不会退出/);

const pendingAcknowledgement = describeQuitRisk({
  hasPendingClipboardAcknowledgement: true,
});
assert.equal(pendingAcknowledgement.title, '正在确认手动覆盖');
assert.equal(pendingAcknowledgement.busy, true);
assert.equal(pendingAcknowledgement.confirmLabel, '等待确认完成');
assert.equal(pendingAcknowledgement.safeLabel, '取消退出并等待确认');
assert.match(pendingAcknowledgement.items.join(' '), /收到明确结果前不会退出/);
assert.doesNotMatch(pendingAcknowledgement.items.join(' '), /主进程|编号/,
  'quit copy must explain the safeguard without exposing implementation jargon');

const clipboardConsequence = describeQuitRisk({ hasClipboardCopyConsequence: true });
assert.equal(clipboardConsequence.title, '退出前确认系统剪贴板后果');
assert.equal(clipboardConsequence.confirmLabel, '保留当前剪贴板并退出');
assert.equal(clipboardConsequence.safeLabel, '继续使用 Slipstream');
assert.equal(clipboardConsequence.busy, false);
assert.match(clipboardConsequence.items.join(' '), /不会读取、清除或覆盖/);

const residueConsequence = describeQuitRisk({ hasClipboardResidueRisk: true });
assert.equal(residueConsequence.confirmLabel, '保留当前剪贴板并退出');
assert.equal(residueConsequence.safeLabel, '返回并检查剪贴板');
assert.match(residueConsequence.items.join(' '), /界面中断前/);

const clipboardAndTask = describeQuitRisk({
  activeAnalysis: true,
  hasSourceDraft: true,
  hasClipboardCopyConsequence: true,
});
assert.equal(clipboardAndTask.title, '退出会停止当前任务');
assert.equal(clipboardAndTask.confirmLabel, '保留当前剪贴板并停止任务');

const resetPending = describeQuitRisk({
  resetInProgress: true,
  hasClipboardCopyConsequence: true,
});
assert.equal(resetPending.title, '清除完成后退出');
assert.equal(resetPending.confirmLabel, '等待清除完成');
assert.equal(resetPending.safeLabel, '取消退出并等待清除');
assert.equal(resetPending.busy, true);

const resetRecovery = describeQuitRisk({
  hasClipboardCopyConsequence: true,
  hasResetRecovery: true,
});
assert.equal(resetRecovery.confirmLabel, '保留当前剪贴板、放弃剩余清除并退出');
assert.equal(resetRecovery.safeLabel, '继续处理剩余清除');
assert.equal(resetRecovery.busy, false);

let sequence = 0;
const registry = createQuitRequestRegistry({ idFactory: () => `quit-${sequence += 1}` });
assert.deepEqual(registry.request(7), { requestId: 'quit-1' });
assert.deepEqual(registry.request(7), { requestId: 'quit-1' });
assert.equal(registry.hasPending(7), true);
assert.deepEqual(registry.getPending(7), { requestId: 'quit-1' });
assert.equal(registry.getPending(8), null);
assert.throws(() => registry.getPending(0), /invalid quit-request sender/);
assert.deepEqual(registry.decide(8, { requestId: 'quit-1', confirmed: true }), { status: 'invalid' });
assert.deepEqual(registry.decide(7, { requestId: 'stale', confirmed: true }), { status: 'invalid' });
assert.equal(registry.hasPending(7), true);
assert.deepEqual(registry.decide(7, { requestId: 'quit-1', confirmed: false }), { status: 'cancelled' });
assert.equal(registry.getPending(7), null);
assert.deepEqual(registry.request(7), { requestId: 'quit-2' });
assert.deepEqual(registry.decide(7, { requestId: 'quit-2', confirmed: true }), { status: 'confirmed' });
assert.equal(registry.getPending(7), null);
assert.deepEqual(registry.request(7), { requestId: 'quit-3' });
registry.clearSender(7);
assert.equal(registry.getPending(7), null);
assert.deepEqual(registry.request(7), { requestId: 'quit-4' });
registry.clear();
assert.equal(registry.getPending(7), null);

const mainSource = read('src/main/main.js');
const appSource = read('src/renderer/App.jsx');
const dialogSource = read('src/renderer/components/AppQuitDialog.jsx');
const panelSource = read('src/renderer/components/FloatingPanel.jsx');
const settingsSource = read('src/renderer/components/SettingsPanel.jsx');
const preloadSource = read('preload.js');
const sharedConstants = read('src/shared/constants.js');

const requestQuitStart = mainSource.indexOf('function requestAppQuit()');
const requestQuitEnd = mainSource.indexOf('\n}\n\nfunction resetRendererOwnedWorkAfterCrash', requestQuitStart);
assert.ok(requestQuitStart >= 0 && requestQuitEnd > requestQuitStart);
const requestQuitSource = mainSource.slice(requestQuitStart, requestQuitEnd);
assert.match(
  mainSource,
  /id: 'app-quit',[\s\S]{0,160}?label: '退出 Slipstream',[\s\S]{0,160}?accelerator: 'Command\+Q',[\s\S]{0,160}?click: requestAppQuit/,
  'the standard macOS quit accelerator must route through the guarded request path',
);
assert.doesNotMatch(
  mainSource,
  /id: 'app-quit',[\s\S]{0,220}?role: ['"]quit['"]/,
  'the app-menu quit item must not replace its guarded click handler with Electron role quit',
);
assert.match(requestQuitSource,
  /const request = quitRequestRegistry\.request\(senderId\);[\s\S]*?mainWindow\.webContents\.send\(IPC_CHANNELS\.APP_QUIT_REQUESTED, request\)/,
  'every native quit gesture must re-send the same pending request so an early lost event can recover');
assert.match(requestQuitSource,
  /const request = quitRequestRegistry\.request\(senderId\);[\s\S]{0,500}?clipboardResidueRegistry\.get\(senderId\)[\s\S]{0,500}?showMainWindow\(\)/,
  'a hidden window must be shown when main owns a clipboard consequence, even before the renderer risk effect catches up');
assert.match(requestQuitSource,
  /!rendererQuitRiskKnown[\s\S]{0,180}?rendererHasQuitRisk[\s\S]{0,180}?showMainWindow\(\)/,
  'unknown or reported renderer risk must continue to reveal the quit decision');

const quitDecisionStart = mainSource.indexOf('IPC_CHANNELS.APP_QUIT_DECISION');
const quitDecisionEnd = mainSource.indexOf('\n  });', quitDecisionStart);
const quitDecisionSource = mainSource.slice(quitDecisionStart, quitDecisionEnd);
assert.match(quitDecisionSource,
  /const activeConsequence = clipboardResidueRegistry\.get\(event\.sender\.id\)/);
assert.match(quitDecisionSource,
  /payload\?\.confirmed === true[\s\S]*?payload\.clipboardConsequenceId !== activeConsequence\.id[\s\S]*?status: 'clipboard-consequence-unconfirmed'/,
  'preserve-and-exit must bind to the exact current consequence id before consuming the quit request');
assert.ok(
  quitDecisionSource.indexOf("status: 'clipboard-consequence-unconfirmed'")
    < quitDecisionSource.indexOf('quitRequestRegistry.decide(event.sender.id, payload)'),
);

assert.match(appSource,
  /const clipboardQuitRisk = useMemo\(\(\) => normalizeQuitRisk\(\{[\s\S]*?hasPendingClipboardWrite: clipboardWritePending,[\s\S]*?hasPendingClipboardAcknowledgement: clipboardAcknowledgementPending,[\s\S]*?hasClipboardCopyConsequence: hasClipboardConsequence,[\s\S]*?hasClipboardResidueRisk/,
  'App must publish every preserve-only clipboard risk independently of the visible page');
assert.match(appSource, /mergeQuitRisks\(panelQuitRisk, settingsQuitRisk, clipboardQuitRisk\)/);
assert.match(appSource,
  /const refreshImmediateQuitRisk = useCallback[\s\S]*?panelQuitRiskRef\.current,[\s\S]*?settingsQuitRiskRef\.current,[\s\S]*?hasPendingClipboardWrite:[\s\S]*?hasClipboardResidueRisk:/,
  'App must synchronously merge live workspace and clipboard risks before an OS quit request can auto-confirm');
assert.match(appSource,
  /const handleSettingsQuitRiskChange = useCallback[\s\S]*?settingsQuitRiskRef\.current = next;[\s\S]*?refreshImmediateQuitRisk\(\);[\s\S]*?setSettingsQuitRisk\(next\)/,
  'Settings risk publication must update the synchronous quit guard before scheduling React state');
const sessionRiskRefresh = appSource.indexOf('const currentRisk = refreshImmediateQuitRisk();');
const sessionRiskEffectStart = appSource.lastIndexOf('useEffect(() => {', sessionRiskRefresh);
const sessionRiskEffectEnd = appSource.indexOf('\n\n  useEffect(() => {', sessionRiskEffectStart);
const sessionRiskEffectSource = appSource.slice(sessionRiskEffectStart, sessionRiskEffectEnd);
assert.ok(sessionRiskRefresh >= 0
  && sessionRiskEffectStart >= 0
  && sessionRiskEffectEnd > sessionRiskEffectStart,
  'App must retain a passive main-process session-risk notification effect');
assert.match(sessionRiskEffectSource, /IPC_CHANNELS\.APP_SESSION_RISK_UPDATE/,
  'the synchronous risk refresh must feed the main-process session-risk notification');
assert.doesNotMatch(sessionRiskEffectSource, /QuitRiskRef\.current\s*=/,
  'the passive session-risk effect must never overwrite synchronous quit-risk refs from stale React state');
assert.match(sessionRiskEffectSource,
  /const currentRisk = refreshImmediateQuitRisk\(\);[\s\S]*?hasRisk: hasQuitRisk\(currentRisk\)/,
  'the passive session-risk notification must re-read synchronous refs instead of publishing stale React state');

const automaticGuardStart = appSource.indexOf('const canAutomaticallyConfirmQuit = useCallback');
const automaticGuardEnd = appSource.indexOf('\n\n  const confirmQuitRequestAutomatically', automaticGuardStart);
const automaticGuardSource = appSource.slice(automaticGuardStart, automaticGuardEnd);
assert.match(automaticGuardSource, /const operation = clipboardOperationRef\.current/);
assert.match(automaticGuardSource, /hasClipboardCopyConsequence\(clipboardNoticeRef\.current\)/);
assert.match(automaticGuardSource,
  /!operation[\s\S]*?!hasCurrentConsequence[\s\S]*?!hasQuitRisk\(currentRisk\)/,
  'automatic quit must reject pending writes, pending acknowledgements, and retained consequences');

const rendererDecisionStart = appSource.indexOf('const handleQuitDecision = useCallback');
const rendererDecisionEnd = appSource.indexOf('\n\n  useEffect(() => {', rendererDecisionStart);
const rendererDecisionSource = appSource.slice(rendererDecisionStart, rendererDecisionEnd);
assert.match(rendererDecisionSource,
  /const currentConsequenceId = clipboardResidueRiskRef\.current\?\.id[\s\S]*?clipboardCopyConsequenceId\(clipboardNoticeRef\.current\)/);
assert.match(rendererDecisionSource,
  /confirmed && currentConsequenceId[\s\S]*?clipboardConsequenceId: currentConsequenceId/,
  'explicit preserve-and-exit must send the exact visible current consequence id');
assert.match(rendererDecisionSource,
  /status === 'clipboard-consequence-unconfirmed'[\s\S]*?publishClipboardResidueRisk\(recoveredRisk\)/,
  'main-authoritative rejection must restore missing consequence metadata');

assert.match(panelSource,
  /onQuitRiskChange\?\.\(\{[\s\S]*?activeAnalysis:[\s\S]*?hasSourceDraft:[\s\S]*?hasResult:[\s\S]*?hasReplyWork:/);
assert.match(panelSource, /useLayoutEffect\(\(\) => \{\s*onQuitRiskChange\?\.\(\{/,
  'workspace risks must reach the app-level quit guard in the same layout commit');
assert.match(panelSource, /useLayoutEffect\(\(\) => \(\) => onQuitRiskChange\?\.\(\{\}\)/,
  'workspace quit-risk cleanup must clear the app-level guard in the unmount layout commit');
assert.match(settingsSource,
  /onQuitRiskChange\?\.\(\{[\s\S]*?activeProviderTest:[\s\S]*?hasConnectionDraft: hasUnsavedConnectionDraft,[\s\S]*?hasPromptDraft: hasUnsavedPromptDraft,[\s\S]*?resetInProgress: isResetting,[\s\S]*?hasResetRecovery: Boolean\(resetError\),[\s\S]*?settingsSaving: settingsSaving \|\| isRetryingSave/,
  'Settings must publish prompt drafts and unsettled persistence as distinct quit risks');
assert.match(settingsSource, /useLayoutEffect\(\(\) => \{\s*onQuitRiskChange\?\.\(\{/,
  'visible Settings drafts must reach the app-level quit guard in the same layout commit');

assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /data-quit-safe/);
assert.match(dialogSource, /event\.key === 'Escape'/);
assert.match(dialogSource, /event\.key !== 'Tab'/);
assert.match(dialogSource, /node\.inert = true/);
assert.match(dialogSource,
  /if \(!pending\) return undefined;[\s\S]*?dialogRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  'pending quit must move focus off disabled actions and onto the busy dialog root');
assert.match(dialogSource, /className="app-quit-dialog__safe"[\s\S]*?disabled=\{pending\}/);
assert.match(dialogSource, /className="app-quit-dialog__confirm"[\s\S]*?disabled=\{pending \|\| copy\.busy\}/);
assert.doesNotMatch(dialogSource, /onClearClipboardAndConfirm|clipboardConfirmLabel|app-quit-dialog__clipboard/,
  'the quit dialog must expose only cancel and explicit preserve-and-exit');
assert.match(dialogSource, /退出确认不会复制、记录或发送原文、结果、API Key 或服务地址/);

assert.match(preloadSource, /'app:quit-decision'/);
assert.match(preloadSource, /'app:quit-listener-ready'/);
assert.match(preloadSource, /'app:session-risk-update'/);
assert.match(preloadSource, /'app:quit-requested'/);
assert.match(sharedConstants, /APP_QUIT_REQUESTED: 'app:quit-requested'/);
assert.match(sharedConstants, /APP_QUIT_LISTENER_READY: 'app:quit-listener-ready'/);
assert.match(sharedConstants, /APP_QUIT_DECISION: 'app:quit-decision'/);
assert.match(sharedConstants, /APP_SESSION_RISK_UPDATE: 'app:session-risk-update'/);
const quitListenerEffectStart = appSource.lastIndexOf(
  'useEffect(() => {',
  appSource.indexOf('IPC_CHANNELS.APP_QUIT_LISTENER_READY'),
);
const quitListenerEffectEnd = appSource.indexOf('\n\n  const handleQuitDecision', quitListenerEffectStart);
const quitListenerEffectSource = appSource.slice(quitListenerEffectStart, quitListenerEffectEnd);
assert.ok(quitListenerEffectStart >= 0 && quitListenerEffectEnd > quitListenerEffectStart,
  'App must retain the quit-listener readiness effect');
assert.ok(
  quitListenerEffectSource.indexOf('on(IPC_CHANNELS.APP_QUIT_REQUESTED')
    < quitListenerEffectSource.indexOf('invoke(IPC_CHANNELS.APP_QUIT_LISTENER_READY)'),
  'App must subscribe before pulling a pending quit request');
assert.match(quitListenerEffectSource,
  /invoke\(IPC_CHANNELS\.APP_QUIT_LISTENER_READY\)[\s\S]*?\.catch\(\(\) => false\)/,
  'the listener-ready handshake must request replay after subscription');
assert.doesNotMatch(quitListenerEffectSource,
  /invoke\(IPC_CHANNELS\.APP_QUIT_LISTENER_READY\)[\s\S]*?\.then\(receiveQuitRequest\)/,
  'a delayed handshake response must not inject an already settled request id');
assert.match(quitListenerEffectSource,
  /lastSettledQuitRequestIdRef\.current === requestId/,
  'queued duplicate events must not reopen a request after it settles');
assert.match(quitListenerEffectSource,
  /quitRequestIdRef\.current === requestId/,
  'an active request replay must be a no-op');
assert.ok(
  quitListenerEffectSource.indexOf('quitRequestIdRef.current === requestId')
    < quitListenerEffectSource.indexOf('setQuitDialogVisible(false)'),
  'an active request replay must be deduplicated before it can hide the current dialog');
assert.match(mainSource,
  /IPC_CHANNELS\.APP_QUIT_LISTENER_READY[\s\S]{0,500}?quitRequestRegistry\.getPending\(event\.sender\.id\)[\s\S]{0,500}?event\.sender\.send\(IPC_CHANNELS\.APP_QUIT_REQUESTED, pendingRequest\)/,
  'main must replay the sender-bound pending request after the renderer listener is ready');
assert.match(mainSource,
  /function assertTrustedQuitIpc\(event\)[\s\S]{0,500}?event\.sender !== mainWindow\.webContents[\s\S]{0,300}?event\.senderFrame !== mainWindow\.webContents\.mainFrame/,
  'quit IPC must be restricted to the live main frame as well as a trusted URL');

console.log('Quit safety checks passed.');
