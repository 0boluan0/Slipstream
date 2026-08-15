import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  CLIPBOARD_RESIDUE_RISK_COPY,
  clipboardResidueAcknowledgementSucceeded,
  clipboardResidueRiskFromRecoveryStatus,
  clipboardResidueRiskMatches,
  normalizeClipboardResidueRisk,
} from '../src/renderer/utils/clipboardResidueRisk.mjs';

const require = createRequire(import.meta.url);
const { createClipboardResidueRegistry } = require('../src/main/clipboard-residue-registry');
const { createUserDataResetRegistry } = require('../src/main/user-data-reset-registry');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^\s*\/\/.*$/gmu, '');

const rendererRisk = normalizeClipboardResidueRisk({
  id: 'renderer-risk-1',
  legacyCleanupProof: 'must-not-cross-recovery',
  copiedText: 'PRIVATE_RENDERER_RECOVERY_TEXT',
});
assert.deepEqual(rendererRisk, { id: 'renderer-risk-1' });
assert.equal(Object.isFrozen(rendererRisk), true);
assert.equal(normalizeClipboardResidueRisk({ id: '' }), null);
assert.equal(normalizeClipboardResidueRisk({ id: 'x'.repeat(101) }), null);
assert.deepEqual(clipboardResidueRiskFromRecoveryStatus({
  recovered: true,
  clipboardResidueRisk: {
    id: 'renderer-risk-2',
    forgedProof: 'must-not-cross-recovery',
  },
}), { id: 'renderer-risk-2' });
assert.equal(clipboardResidueRiskMatches(rendererRisk, { id: 'renderer-risk-1' }), true);
assert.equal(clipboardResidueRiskMatches(rendererRisk, { id: 'renderer-risk-2' }), false);
assert.equal(clipboardResidueAcknowledgementSucceeded({ status: 'acknowledged' }), true);
assert.equal(clipboardResidueAcknowledgementSucceeded({ status: 'invalid' }), false);
assert.match(CLIPBOARD_RESIDUE_RISK_COPY.detail, /手动覆盖/);
assert.equal(JSON.stringify(rendererRisk).includes('PRIVATE_RENDERER_RECOVERY_TEXT'), false);

let riskIndex = 0;
const registry = createClipboardResidueRegistry({
  idFactory: () => `residue-${riskIndex += 1}`,
});

const prepared = registry.prepare(7);
assert.deepEqual(prepared, { id: 'residue-1' });
assert.equal(registry.get(7), null,
  'prepare alone must not claim that native clipboard state changed');
const firstRisk = registry.commit(7, prepared.id);
assert.deepEqual(firstRisk, prepared);
assert.deepEqual(registry.get(7), firstRisk);

const failedReplacement = registry.prepare(7);
assert.deepEqual(registry.get(7), firstRisk,
  'a write interrupted after prepare must retain the last confirmed consequence');
const newerPreparation = registry.prepare(7);
assert.throws(
  () => registry.commit(7, failedReplacement.id),
  /invalid prepared clipboard-residue consequence/,
  'stale commit must throw and fail closed');
assert.deepEqual(registry.get(7), firstRisk);
const replacement = registry.commit(7, newerPreparation.id);
assert.deepEqual(registry.get(7), replacement);

assert.equal(registry.getInterrupted(7), null);
assert.deepEqual(registry.markInterrupted(7), replacement);
assert.deepEqual(registry.getInterrupted(7), replacement,
  'renderer interruption must retain only the opaque current consequence id');
assert.deepEqual(registry.resolve(8, replacement.id), { status: 'invalid' });
assert.deepEqual(registry.resolve(7, firstRisk.id), { status: 'invalid' });
assert.deepEqual(registry.get(7), replacement,
  'wrong sender or stale id must not release the current consequence');

assert.deepEqual(registry.adoptSender(11), replacement);
assert.equal(registry.get(7), null);
assert.deepEqual(registry.getInterrupted(11), replacement,
  'a replacement renderer must adopt the same interrupted consequence id');
assert.deepEqual(registry.resolve(11, replacement.id), { status: 'acknowledged' });
assert.equal(registry.get(11), null);

registry.replace(11);
registry.clearSender(7);
assert.equal(registry.pendingCount(), 1);
registry.clearSender(11);
assert.equal(registry.pendingCount(), 0);
registry.replace(12);
registry.clearAll();
assert.equal(registry.pendingCount(), 0);

let resetTicketIndex = 0;
const resetRegistry = createUserDataResetRegistry({
  idFactory: () => `residue-reset-ticket-${String(resetTicketIndex += 1).padStart(4, '0')}`,
});
const resetConsequence = { id: 'residue-reset-current' };
assert.deepEqual(
  resetRegistry.prepare(21, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: 'residue-reset-stale',
  }, resetConsequence),
  {
    status: 'clipboard-consequence-mismatch',
    clipboardConsequence: resetConsequence,
  },
  'reset preparation must not issue a ticket for stale clipboard metadata',
);
const changedPreparation = resetRegistry.prepare(21, {
  clipboardMode: 'preserve',
  clipboardConsequenceId: resetConsequence.id,
}, resetConsequence);
assert.equal(changedPreparation.status, 'prepared');
assert.equal(resetRegistry.isLocked(21), true);
assert.deepEqual(
  resetRegistry.prepare(21, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: resetConsequence.id,
  }, resetConsequence),
  { status: 'busy' },
);
assert.deepEqual(
  resetRegistry.consume(22, changedPreparation.ticket, resetConsequence),
  { status: 'invalid-ticket' },
  'another renderer must not consume the owner reset ticket',
);
assert.equal(resetRegistry.isLocked(21), true,
  'a cross-renderer consume attempt must leave the owner lock live');
const nextResetConsequence = { id: 'residue-reset-next' };
assert.deepEqual(
  resetRegistry.consume(21, changedPreparation.ticket, nextResetConsequence),
  {
    status: 'clipboard-consequence-changed',
    clipboardConsequence: nextResetConsequence,
  },
);
assert.equal(resetRegistry.isLocked(21), false);
assert.deepEqual(
  resetRegistry.consume(21, changedPreparation.ticket, nextResetConsequence),
  { status: 'invalid-ticket' },
  'a consequence-change failure must consume its exact ticket permanently',
);
const authorizedPreparation = resetRegistry.prepare(21, {
  clipboardMode: 'preserve',
  clipboardConsequenceId: nextResetConsequence.id,
}, nextResetConsequence);
assert.equal(resetRegistry.isLocked(21), true);
assert.deepEqual(
  resetRegistry.consume(21, authorizedPreparation.ticket, nextResetConsequence),
  { status: 'authorized', clipboardStatus: 'retained' },
);
assert.equal(resetRegistry.isLocked(21), false);
assert.deepEqual(
  resetRegistry.consume(21, authorizedPreparation.ticket, nextResetConsequence),
  { status: 'invalid-ticket' },
  'an authorized reset ticket must remain one-shot',
);

const mainSource = read('src/main/main.js');
const registrySource = read('src/main/clipboard-residue-registry.js');
const resetRegistrySource = read('src/main/user-data-reset-registry.js');
const appSource = read('src/renderer/App.jsx');
const fullDataResetSource = read('src/renderer/utils/fullDataReset.mjs');
const sessionRecoverySource = read('src/renderer/utils/sessionRecovery.mjs');
const sessionRecoveryDialogSource = read('src/renderer/components/SessionRecoveryDialog.jsx');
const residueNoticeSource = read('src/renderer/components/ClipboardResidueRiskNotice.jsx');
const constantsSources = [
  read('src/shared/constants.cjs'),
  read('src/shared/constants.js'),
];
const preloadSource = read('preload.js');

assert.equal(fs.existsSync(path.join(root, 'src/main/clipboard-clear-registry.js')), false,
  'the retired automatic-clear registry must remain absent');
assert.doesNotMatch(
  stripComments(registrySource),
  /clearToken|fingerprint|receipt|clipboard\.(?:readText|writeText|clear)/iu,
  'the crash-surviving registry must remain metadata-only and clipboard-blind');
assert.doesNotMatch(
  stripComments(resetRegistrySource),
  /preserveClipboard|clearToken|clipboard\.(?:readText|writeText|clear)/iu,
  'the reset-ticket registry must remain metadata-only and clipboard-blind',
);
const resetPrepareCallIndex = fullDataResetSource.indexOf('await prepareReset({');
const resetSessionPurgeIndex = fullDataResetSource.indexOf('await purgeSession()');
const resetTicketConsumeCallIndex = fullDataResetSource.indexOf(
  'await resetPersistentData({ ticket: prepared.ticket })',
);
assert.ok(
  resetPrepareCallIndex >= 0
    && resetSessionPurgeIndex > resetPrepareCallIndex
    && resetTicketConsumeCallIndex > resetSessionPurgeIndex,
  'exact reset preparation must precede session purge and one-shot ticket consumption',
);

for (const source of constantsSources) {
  assert.match(source,
    /APP_CLIPBOARD_RESIDUE_RISK_ACK: 'app:clipboard-residue-risk-ack'/);
  assert.doesNotMatch(source, /CLIPBOARD_CLEAR_IF_MATCHES|clipboard:clear-if-matches/);
}
assert.match(preloadSource, /'app:clipboard-residue-risk-ack'/);
assert.doesNotMatch(preloadSource, /clipboard:clear-if-matches/);

const writeStart = mainSource.indexOf('IPC_CHANNELS.CLIPBOARD_WRITE');
const writeEnd = mainSource.indexOf('\n  });', writeStart);
const writeSource = mainSource.slice(writeStart, writeEnd);
const prepareIndex = writeSource.indexOf('clipboardResidueRegistry.prepare(event.sender.id)');
const nativeWriteIndex = writeSource.indexOf('clipboard.writeText(text)');
const commitIndex = writeSource.indexOf('clipboardResidueRegistry.commit(');
const writeResetLockIndex = writeSource.indexOf('userDataResetRegistry.isLocked(event.sender.id)');
const writeResetBlockedIndex = writeSource.indexOf("error.code = 'user-data-reset-pending'");
assert.ok(
  writeResetLockIndex >= 0
    && writeResetBlockedIndex > writeResetLockIndex
    && prepareIndex > writeResetBlockedIndex,
  'a live reset ticket must block native writes before consequence preparation',
);
assert.ok(prepareIndex >= 0 && nativeWriteIndex > prepareIndex && commitIndex > nativeWriteIndex,
  'main must prepare consequence metadata, write natively, then commit the exact preparation');
assert.match(writeSource, /consequenceId: consequence\.id/);
assert.doesNotMatch(writeSource, /clipboard\.readText|clipboard\.clear|expiresInMs/);

const crashResetStart = mainSource.indexOf('function resetRendererOwnedWorkAfterCrash');
const crashResetEnd = mainSource.indexOf('\n}\n\nfunction sendSafeSettingsToRenderer', crashResetStart);
const crashResetSource = mainSource.slice(crashResetStart, crashResetEnd);
assert.match(crashResetSource, /clipboardResidueRegistry\.markInterrupted\(senderId\)/);
assert.doesNotMatch(crashResetSource,
  /clipboardResidueRegistry\.(?:clearSender|clearAll|resolve)/,
  'renderer interruption must preserve its main-owned consequence');

assert.match(mainSource,
  /mainWindow = new BrowserWindow\(windowOptions\);[\s\S]*?const rendererSenderId = mainWindow\.webContents\.id;[\s\S]*?clipboardResidueRegistry\.adoptSender\(rendererSenderId\)/,
  'a replacement window must adopt the exact existing consequence before renderer startup');

const recoveryStart = mainSource.indexOf('IPC_CHANNELS.APP_RENDERER_RECOVERY_STATUS_GET');
const recoveryEnd = mainSource.indexOf('\n  });', recoveryStart);
const recoverySource = mainSource.slice(recoveryStart, recoveryEnd);
assert.match(recoverySource,
  /clipboardResidueRisk: clipboardResidueRegistry\.getInterrupted\(event\.sender\.id\)/);
assert.doesNotMatch(recoverySource, /clipboard\.(?:readText|clear)|fingerprint/);

const acknowledgementStart = mainSource.indexOf('IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK');
const acknowledgementEnd = mainSource.indexOf('\n  });', acknowledgementStart);
const acknowledgementSource = mainSource.slice(acknowledgementStart, acknowledgementEnd);
assert.match(acknowledgementSource, /payload[\s\S]*?\.id/);
assert.match(acknowledgementSource,
  /clipboardResidueRegistry\.resolve\(event\.sender\.id, id\)/);
const acknowledgementResetLockIndex = acknowledgementSource.indexOf(
  'userDataResetRegistry.isLocked(event.sender.id)',
);
const acknowledgementResetBlockedIndex = acknowledgementSource.indexOf(
  "error.code = 'user-data-reset-pending'",
);
const acknowledgementResolveIndex = acknowledgementSource.indexOf(
  'clipboardResidueRegistry.resolve(event.sender.id, id)',
);
assert.ok(
  acknowledgementResetLockIndex >= 0
    && acknowledgementResetBlockedIndex > acknowledgementResetLockIndex
    && acknowledgementResolveIndex > acknowledgementResetBlockedIndex,
  'a live reset ticket must block consequence acknowledgement before release',
);

const quitStart = mainSource.indexOf('IPC_CHANNELS.APP_QUIT_DECISION');
const quitEnd = mainSource.indexOf('\n  });', quitStart);
const quitSource = mainSource.slice(quitStart, quitEnd);
assert.match(quitSource,
  /const activeConsequence = clipboardResidueRegistry\.get\(event\.sender\.id\)/);
assert.match(quitSource,
  /payload\?\.confirmed === true[\s\S]*?payload\.clipboardConsequenceId !== activeConsequence\.id[\s\S]*?status: 'clipboard-consequence-unconfirmed'[\s\S]*?clipboardConsequence: activeConsequence/);
assert.ok(
  quitSource.indexOf("status: 'clipboard-consequence-unconfirmed'")
    < quitSource.indexOf('quitRequestRegistry.decide(event.sender.id, payload)'),
  'exact preserve consent must be validated before consuming the pending quit request');

const resetPrepareStart = mainSource.indexOf('IPC_CHANNELS.USER_DATA_RESET_PREPARE');
const resetPrepareEnd = mainSource.indexOf('\n  });', resetPrepareStart);
assert.ok(resetPrepareStart >= 0 && resetPrepareEnd > resetPrepareStart);
const resetPrepareSource = mainSource.slice(resetPrepareStart, resetPrepareEnd);
assert.match(
  resetPrepareSource,
  /return\s+userDataResetRegistry\.prepare\(\s*event\.sender\.id,\s*payload,\s*clipboardResidueRegistry\.get\(event\.sender\.id\),?\s*\)/u,
  'reset preparation must pin the exact current clipboard consequence before session purge',
);

const resetStart = mainSource.indexOf('IPC_CHANNELS.USER_DATA_CLEAR');
const resetEnd = mainSource.indexOf('\n  });', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart);
const resetSource = mainSource.slice(resetStart, resetEnd);
const resetAuthorizationMatch = resetSource.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*userDataResetRegistry\.consume\(\s*event\.sender\.id,\s*payload\?\.ticket,\s*clipboardResidueRegistry\.get\(event\.sender\.id\),?\s*\)/u,
);
assert.ok(resetAuthorizationMatch,
  'reset commit must consume only the sender-bound one-shot ticket');
const resetAuthorizationVariable = resetAuthorizationMatch[1];
const resetConsumeIndex = resetSource.indexOf(resetAuthorizationMatch[0]);
const resetAuthorizedIndex = resetSource.indexOf(
  `${resetAuthorizationVariable}.status !== 'authorized'`,
);
const resetPersistentDataIndex = resetSource.indexOf('store.resetUserDataAndSettings()');
const resetConsequenceReleaseIndex = resetSource.indexOf(
  'clipboardResidueRegistry.clearSender(event.sender.id)',
);
assert.ok(
  resetConsumeIndex >= 0
    && resetAuthorizedIndex > resetConsumeIndex
    && resetPersistentDataIndex > resetAuthorizedIndex
    && resetConsequenceReleaseIndex > resetPersistentDataIndex,
  'one-shot authorization must precede persistent reset and consequence release',
);
assert.match(resetSource,
  new RegExp(`clipboardStatus:\\s*${resetAuthorizationVariable}\\.clipboardStatus`, 'u'));
assert.doesNotMatch(
  resetSource,
  /preserveClipboard|clipboardConsequenceId|clipboardResidueRiskId|clearToken|clipboard\.clear/u,
  'reset commit must not restore direct clipboard-consent or cleanup fields',
);

const nativeQuitStart = mainSource.indexOf('function requestNativeResidueAwareQuit');
const nativeQuitEnd = mainSource.indexOf('\n}\n\nfunction requestAppQuit', nativeQuitStart);
const nativeQuitSource = mainSource.slice(nativeQuitStart, nativeQuitEnd);
assert.match(nativeQuitSource, /buttons: \['返回并重新载入界面', '保留剪贴板并退出'\]/);
assert.match(nativeQuitSource,
  /const currentConsequence = clipboardResidueRegistry\.getCurrent\(\)[\s\S]*?response === 1 && currentConsequence\?\.id === consequenceSnapshot\.id[\s\S]*?performConfirmedQuit\(\)/,
  'native fallback preserve consent must bind the exact consequence snapshot');
const nativeCatch = nativeQuitSource.slice(nativeQuitSource.indexOf('.catch'));
assert.doesNotMatch(nativeCatch, /performConfirmedQuit\(\)/,
  'dialog failure must never become preserve consent');
assert.match(nativeCatch, /reloadAfterNativeResidueQuitCancel\(targetWindow\)/);

const repeatedCrashStart = mainSource.indexOf("mainWindow.webContents.on('render-process-gone'");
const repeatedCrashEnd = mainSource.indexOf('\n  // Restore saved position', repeatedCrashStart);
const repeatedCrashSource = mainSource.slice(repeatedCrashStart, repeatedCrashEnd);
assert.match(repeatedCrashSource,
  /const crashDialogConsequence = clipboardResidueRegistry\.get\(rendererSenderId\)/);
assert.match(repeatedCrashSource,
  /response === 1[\s\S]*?currentConsequence\?\.id === crashDialogConsequence\?\.id[\s\S]*?performConfirmedQuit\(\)/,
  'repeated-crash preserve choice must match the exact visible consequence');
const repeatedCrashCatch = repeatedCrashSource.slice(repeatedCrashSource.indexOf('}).catch(() => {'));
assert.match(repeatedCrashCatch,
  /if \(clipboardResidueRegistry\.get\(rendererSenderId\)\)[\s\S]*?reloadRenderer\(\);[\s\S]*?return;/,
  'dialog failure with a consequence must attempt recovery instead of quitting');

assert.match(appSource,
  /rendererRecoveryStatusRequestedRef\.current = true;[\s\S]*?APP_RENDERER_RECOVERY_STATUS_GET/);
assert.match(appSource,
  /clipboardResidueRiskMatches\(clipboardResidueRiskRef\.current, operation\)[\s\S]*?clipboardResidueAcknowledgementSucceeded\(response\)[\s\S]*?publishClipboardResidueRisk\(null\)/,
  'only exact successful acknowledgement may remove the visible recovery warning');
assert.match(appSource,
  /status === 'clipboard-consequence-unconfirmed'[\s\S]*?clipboardResidueRiskFromRecoveryStatus\(\{[\s\S]*?clipboardResidueRisk: response\.clipboardConsequence[\s\S]*?publishClipboardResidueRisk\(recoveredRisk\)/,
  'main-authoritative quit rejection must restore missing renderer metadata');

assert.doesNotMatch(sessionRecoverySource, /clipboardResidueRisk|clipboardConsequenceId/,
  'consequence ids must not enter browser-managed same-window recovery storage');
assert.match(sessionRecoveryDialogSource, /clipboardResidueRisk[\s\S]*?session-recovery-safety/);
assert.match(residueNoticeSource, /role="alert"[\s\S]*?aria-live="assertive"/);
assert.match(residueNoticeSource, /data-clipboard-residue-acknowledge/);
assert.doesNotMatch(residueNoticeSource, /data-clipboard-clear-action|onClear/);

console.log('Clipboard renderer-crash residue-risk checks passed.');
