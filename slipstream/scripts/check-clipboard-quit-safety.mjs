import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  describeQuitRisk,
  hasQuitRisk,
  normalizeQuitRisk,
} from '../src/renderer/utils/quitSafety.mjs';

const require = createRequire(import.meta.url);
const { createClipboardResidueRegistry } = require('../src/main/clipboard-residue-registry');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

let idSequence = 0;
const registry = createClipboardResidueRegistry({
  idFactory: () => `clipboard-consequence-${idSequence += 1}`,
});

const prepared = registry.prepare(7);
assert.equal(registry.get(7), null);
const committed = registry.commit(7, prepared.id);
assert.deepEqual(committed, prepared);
assert.deepEqual(registry.get(7), committed);
assert.deepEqual(registry.resolve(7, 'wrong-id'), { status: 'invalid' });
assert.deepEqual(registry.resolve(8, committed.id), { status: 'invalid' });
assert.deepEqual(registry.get(7), committed,
  'wrong sender/id acknowledgement must leave the consequence live');

assert.deepEqual(registry.markInterrupted(7), committed);
assert.deepEqual(registry.getInterrupted(7), committed);
assert.deepEqual(registry.adoptSender(11), committed);
assert.equal(registry.get(7), null);
assert.deepEqual(registry.get(11), committed,
  'renderer replacement must retain the same opaque consequence id');
assert.deepEqual(registry.resolve(11, committed.id), { status: 'acknowledged' });

for (const key of [
  'hasPendingClipboardWrite',
  'hasPendingClipboardAcknowledgement',
  'hasClipboardCopyConsequence',
  'hasClipboardResidueRisk',
]) {
  assert.equal(hasQuitRisk({ [key]: true }), true);
}
const normalizedLegacy = normalizeQuitRisk({
  hasPendingClipboardClear: true,
  hasGuardedClipboardCopy: true,
});
assert.equal(hasQuitRisk(normalizedLegacy), false,
  'retired automatic-clear risk names must not survive normalization');

const pendingWrite = describeQuitRisk({ hasPendingClipboardWrite: true });
assert.equal(pendingWrite.busy, true);
assert.equal(pendingWrite.confirmLabel, '等待复制完成');

const pendingAcknowledgement = describeQuitRisk({
  hasPendingClipboardAcknowledgement: true,
  hasClipboardCopyConsequence: true,
});
assert.equal(pendingAcknowledgement.busy, true);
assert.equal(pendingAcknowledgement.confirmLabel, '等待确认完成');
assert.match(pendingAcknowledgement.busyMessage, /完成前不会退出/);

const currentConsequence = describeQuitRisk({ hasClipboardCopyConsequence: true });
assert.equal(currentConsequence.busy, false);
assert.equal(currentConsequence.confirmLabel, '保留当前剪贴板并退出');
assert.equal(currentConsequence.safeLabel, '继续使用 Slipstream');

const interruptedConsequence = describeQuitRisk({ hasClipboardResidueRisk: true });
assert.equal(interruptedConsequence.confirmLabel, '保留当前剪贴板并退出');
assert.equal(interruptedConsequence.safeLabel, '返回并检查剪贴板');
assert.match(interruptedConsequence.items.join(' '), /不会检查、清除或覆盖/);

const mainSource = read('src/main/main.js');
const appSource = read('src/renderer/App.jsx');
const dialogSource = read('src/renderer/components/AppQuitDialog.jsx');
const quitSafetySource = read('src/renderer/utils/quitSafety.mjs');
const replyLifecycleSource = read('src/renderer/utils/replyClipboardLifecycle.mjs');
const sourceNoticeSource = read('src/renderer/utils/sourceActionNotice.mjs');

const writeStart = mainSource.indexOf('IPC_CHANNELS.CLIPBOARD_WRITE');
const writeEnd = mainSource.indexOf('\n  });', writeStart);
const writeSource = mainSource.slice(writeStart, writeEnd);
const prepareIndex = writeSource.indexOf('clipboardResidueRegistry.prepare(event.sender.id)');
const nativeWriteIndex = writeSource.indexOf('clipboard.writeText(text)');
const commitIndex = writeSource.indexOf('clipboardResidueRegistry.commit(');
assert.ok(prepareIndex >= 0 && nativeWriteIndex > prepareIndex && commitIndex > nativeWriteIndex,
  'native copy must remain prepare -> write -> exact commit');
assert.match(writeSource, /consequenceId: consequence\.id/);

const quitStart = mainSource.indexOf('IPC_CHANNELS.APP_QUIT_DECISION');
const quitEnd = mainSource.indexOf('\n  });', quitStart);
const quitSource = mainSource.slice(quitStart, quitEnd);
assert.match(quitSource,
  /activeConsequence[\s\S]*?payload\.clipboardConsequenceId !== activeConsequence\.id/);
assert.match(quitSource, /status: 'clipboard-consequence-unconfirmed'/);
assert.ok(
  quitSource.indexOf('payload.clipboardConsequenceId !== activeConsequence.id')
    < quitSource.indexOf('quitRequestRegistry.decide(event.sender.id, payload)'),
  'exact preserve acknowledgement must precede quit-request consumption');

assert.match(appSource,
  /const clipboardAcknowledgementPending = clipboardOperation\?\.type === 'acknowledge'/);
assert.match(appSource,
  /hasPendingClipboardAcknowledgement: clipboardAcknowledgementPending/);
assert.match(appSource,
  /hasClipboardCopyConsequence: hasClipboardConsequence/);
assert.match(appSource,
  /hasClipboardResidueRisk/);
assert.match(appSource,
  /clipboardCopyConsequenceId\(clipboardNoticeRef\.current\)[\s\S]*?clipboardConsequenceId: currentConsequenceId/);
assert.match(appSource,
  /APP_CLIPBOARD_RESIDUE_RISK_ACK[\s\S]*?id: consequenceId/,
  'manual-overwrite acknowledgement must bind the exact opaque consequence id');

for (const [relativePath, source] of [
  ['src/renderer/utils/quitSafety.mjs', quitSafetySource],
  ['src/renderer/utils/replyClipboardLifecycle.mjs', replyLifecycleSource],
  ['src/renderer/utils/sourceActionNotice.mjs', sourceNoticeSource],
  ['src/renderer/components/AppQuitDialog.jsx', dialogSource],
]) {
  assert.doesNotMatch(source,
    /clearToken|hasGuardedClipboardCopy|hasPendingClipboardClear|onClearClipboardAndConfirm|clipboardConfirmLabel/,
    `${relativePath} must not retain the retired automatic-clear protocol`);
}
assert.doesNotMatch(dialogSource, /app-quit-dialog__clipboard/);
assert.match(dialogSource, /className="app-quit-dialog__safe"/);
assert.match(dialogSource, /className="app-quit-dialog__confirm"/);

console.log('Clipboard quit-safety checks passed.');
