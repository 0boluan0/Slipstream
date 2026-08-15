import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  beginClipboardCopy,
  clipboardCopyConsequenceId,
  createClipboardCopyFailureNotice,
  createCopiedClipboardNotice,
  dismissClipboardNotice,
  hasClipboardCopyConsequence,
  markClipboardNoticeAfterTaskExit,
  markCopiedClipboardNoticeOutdated,
  settleClipboardCopyFailure,
  settleClipboardCopySuccess,
} from '../src/renderer/utils/clipboardNotice.mjs';
import { runFullDataReset } from '../src/renderer/utils/fullDataReset.mjs';

const require = createRequire(import.meta.url);
const { createClipboardResidueRegistry } = require('../src/main/clipboard-residue-registry');
const { createUserDataResetRegistry } = require('../src/main/user-data-reset-registry');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function collectSourceFiles(directory, pattern = /\.(?:c?js|mjs|jsx)$/u) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (pattern.test(entry.name)) files.push(absolutePath);
    }
  };
  visit(directory);
  return files.sort();
}

function assertNoForbiddenSource(sourceEntries, forbiddenPatterns) {
  for (const [relativePath, source] of sourceEntries) {
    for (const [pattern, description] of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${relativePath} must not contain ${description}`);
    }
  }
}

function stripJavaScriptComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

// A clipboard consequence is prepared before the native write and becomes
// authoritative only after that write succeeds. Preparing a replacement must
// never discard the consequence of the last confirmed write.
let consequenceSequence = 0;
const consequenceRegistry = createClipboardResidueRegistry({
  idFactory: () => `clipboard-consequence-${consequenceSequence += 1}`,
});

const firstPrepared = consequenceRegistry.prepare(7);
assert.deepEqual(firstPrepared, { id: 'clipboard-consequence-1' });
assert.equal(consequenceRegistry.get(7), null,
  'prepare must not claim that an unsettled native write changed the clipboard');
const firstCommitted = consequenceRegistry.commit(7, firstPrepared.id);
assert.deepEqual(firstCommitted, firstPrepared);
assert.deepEqual(consequenceRegistry.get(7), firstCommitted);

const failedReplacement = consequenceRegistry.prepare(7);
assert.deepEqual(failedReplacement, { id: 'clipboard-consequence-2' });
assert.deepEqual(consequenceRegistry.get(7), firstCommitted,
  'a failed write after prepare must leave the last confirmed consequence active');

const supersedingPreparation = consequenceRegistry.prepare(7);
assert.deepEqual(supersedingPreparation, { id: 'clipboard-consequence-3' });
assert.throws(
  () => consequenceRegistry.commit(7, failedReplacement.id),
  /invalid prepared clipboard-residue consequence/u,
  'a stale preparation must throw without replacing a newer pending write or active consequence',
);
assert.deepEqual(consequenceRegistry.get(7), firstCommitted);

const replacement = consequenceRegistry.commit(7, supersedingPreparation.id);
assert.deepEqual(replacement, supersedingPreparation);
assert.deepEqual(consequenceRegistry.get(7), replacement,
  'only the exact committed preparation may replace the prior consequence');
assert.deepEqual(
  consequenceRegistry.resolve(7, firstCommitted.id),
  { status: 'invalid' },
  'acknowledging a stale consequence id must not release the current write consequence',
);
assert.deepEqual(consequenceRegistry.get(7), replacement);
assert.deepEqual(
  consequenceRegistry.resolve(8, replacement.id),
  { status: 'invalid' },
  'another renderer must not acknowledge the owning renderer consequence',
);
assert.deepEqual(consequenceRegistry.get(7), replacement);
assert.deepEqual(consequenceRegistry.resolve(7, replacement.id), { status: 'acknowledged' });
assert.equal(consequenceRegistry.get(7), null);

const replacedDirectly = consequenceRegistry.replace(9);
assert.deepEqual(replacedDirectly, { id: 'clipboard-consequence-4' });
assert.deepEqual(consequenceRegistry.get(9), replacedDirectly);
assert.equal(consequenceRegistry.get(7), null,
  'sender-bound consequence lookup must not expose another renderer record');

// Full reset pins the exact current consequence before renderer session data
// is purged. The resulting opaque ticket is sender-bound and one-shot.
let resetTicketSequence = 0;
const userDataResetRegistry = createUserDataResetRegistry({
  idFactory: () => `privacy-reset-ticket-${String(resetTicketSequence += 1).padStart(4, '0')}`,
});
const resetConsequence = { id: 'reset-consequence-current' };
assert.deepEqual(
  userDataResetRegistry.prepare(17, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: 'reset-consequence-stale',
  }, resetConsequence),
  {
    status: 'clipboard-consequence-mismatch',
    clipboardConsequence: resetConsequence,
  },
  'reset preparation must reject consent for a stale consequence before issuing a ticket',
);
assert.equal(userDataResetRegistry.isLocked(17), false);

const changedConsequencePreparation = userDataResetRegistry.prepare(17, {
  clipboardMode: 'preserve',
  clipboardConsequenceId: resetConsequence.id,
}, resetConsequence);
assert.equal(changedConsequencePreparation.status, 'prepared');
assert.equal(userDataResetRegistry.isLocked(17), true);
assert.deepEqual(
  userDataResetRegistry.prepare(17, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: resetConsequence.id,
  }, resetConsequence),
  { status: 'busy' },
  'a live reset ticket must lock its sender against a second authorization',
);
assert.deepEqual(
  userDataResetRegistry.consume(17, 'privacy-wrong-reset-ticket', resetConsequence),
  { status: 'invalid-ticket' },
);
assert.equal(userDataResetRegistry.isLocked(17), true,
  'a wrong ticket must not release the live reset lock');
const movedResetConsequence = { id: 'reset-consequence-moved' };
assert.deepEqual(
  userDataResetRegistry.consume(
    17,
    changedConsequencePreparation.ticket,
    movedResetConsequence,
  ),
  {
    status: 'clipboard-consequence-changed',
    clipboardConsequence: movedResetConsequence,
  },
  'persistent reset authorization must fail if the pinned consequence changed',
);
assert.equal(userDataResetRegistry.isLocked(17), false);
assert.deepEqual(
  userDataResetRegistry.consume(
    17,
    changedConsequencePreparation.ticket,
    movedResetConsequence,
  ),
  { status: 'invalid-ticket' },
  'a failed exact ticket must still be consumed so it cannot be replayed',
);

const resetPhases = [];
let consumedResetTicket = null;
const fullResetResult = await runFullDataReset({
  clipboardMode: 'preserve',
  hasClipboardCopyConsequence: true,
  consequenceId: movedResetConsequence.id,
  prepareReset: async (payload) => {
    resetPhases.push('prepare');
    assert.deepEqual(payload, {
      clipboardMode: 'preserve',
      clipboardConsequenceId: movedResetConsequence.id,
    });
    return userDataResetRegistry.prepare(17, payload, movedResetConsequence);
  },
  abortReset: async ({ ticket }) => userDataResetRegistry.abort(17, ticket),
  purgeSession: async () => {
    resetPhases.push('purge-session');
    assert.equal(userDataResetRegistry.isLocked(17), true,
      'the exact reset ticket must remain live while renderer session data is purged');
    return { status: 'cleared' };
  },
  resetPersistentData: async ({ ticket }) => {
    resetPhases.push('consume-ticket');
    consumedResetTicket = ticket;
    const authorization = userDataResetRegistry.consume(17, ticket, movedResetConsequence);
    assert.deepEqual(authorization, {
      status: 'authorized',
      clipboardStatus: 'retained',
    });
    return true;
  },
});
assert.deepEqual(resetPhases, ['prepare', 'purge-session', 'consume-ticket'],
  'exact consequence preparation must precede session purge and one-shot ticket consumption');
assert.deepEqual(fullResetResult, {
  status: 'cleared',
  sessionCleared: true,
  clipboardStatus: 'retained',
});
assert.deepEqual(
  userDataResetRegistry.consume(17, consumedResetTicket, movedResetConsequence),
  { status: 'invalid-ticket' },
  'an authorized reset ticket must not be reusable',
);

// Renderer copy state keeps only bounded consequence metadata. It preserves
// prior confirmed state when a replacement write fails, while stale settlement
// can never replace the currently pending request.
const previousNotice = createCopiedClipboardNotice('reply', {
  consequenceId: 'renderer-consequence-old',
  clearToken: 'legacy-token-must-be-ignored',
  expiresInMs: 60_000,
  text: 'PRIVATE_TEXT_MUST_NOT_ENTER_NOTICE_STATE',
});
assert.equal(previousNotice.status, 'copied');
assert.equal(clipboardCopyConsequenceId(previousNotice), 'renderer-consequence-old');
assert.equal(hasClipboardCopyConsequence(previousNotice), true);
assert.match(previousNotice.detail, /手动覆盖/u);
assert.equal(Object.hasOwn(previousNotice, 'clearToken'), false);
assert.equal(Object.hasOwn(previousNotice, 'expiresAt'), false);
assert.equal(JSON.stringify(previousNotice).includes('PRIVATE_TEXT_MUST_NOT_ENTER_NOTICE_STATE'), false);

const pendingReplacement = beginClipboardCopy({
  kind: 'diagnostics',
  requestId: 41,
  previousNotice,
  text: 'PRIVATE_PENDING_TEXT_MUST_NOT_ENTER_NOTICE_STATE',
});
assert.equal(pendingReplacement.status, 'copying');
assert.equal(hasClipboardCopyConsequence(pendingReplacement), true,
  'a pending replacement must retain the prior confirmed clipboard consequence');
assert.equal(clipboardCopyConsequenceId(pendingReplacement), 'renderer-consequence-old');
assert.equal(Object.hasOwn(pendingReplacement, 'clearToken'), false);
assert.equal(JSON.stringify(pendingReplacement).includes('PRIVATE_PENDING_TEXT_MUST_NOT_ENTER_NOTICE_STATE'), false);

const failedNotice = settleClipboardCopyFailure(pendingReplacement, { requestId: 41 });
assert.equal(failedNotice.kind, 'reply');
assert.equal(failedNotice.status, 'copied');
assert.equal(clipboardCopyConsequenceId(failedNotice), 'renderer-consequence-old');
assert.match(failedNotice.message, /仍可能保留先前内容/u);
assert.equal(Object.hasOwn(failedNotice, 'clearToken'), false);

const staleSuccess = settleClipboardCopySuccess(pendingReplacement, {
  success: true,
  consequenceId: 'renderer-consequence-stale',
}, { requestId: 999 });
assert.equal(staleSuccess, pendingReplacement,
  'a stale native settlement must not replace pending request ownership');

const successfulNotice = settleClipboardCopySuccess(pendingReplacement, {
  success: true,
  consequenceId: 'renderer-consequence-new',
  clearToken: 'forged-legacy-token',
  expiresInMs: 60_000,
  text: 'PRIVATE_SETTLEMENT_TEXT_MUST_NOT_ENTER_NOTICE_STATE',
}, { requestId: 41 });
assert.equal(successfulNotice.status, 'copied');
assert.equal(successfulNotice.kind, 'diagnostics');
assert.equal(clipboardCopyConsequenceId(successfulNotice), 'renderer-consequence-new');
assert.equal(hasClipboardCopyConsequence(successfulNotice), true);
assert.equal(Object.hasOwn(successfulNotice, 'clearToken'), false);
assert.equal(Object.hasOwn(successfulNotice, 'expiresAt'), false);
assert.equal(JSON.stringify(successfulNotice).includes('PRIVATE_SETTLEMENT_TEXT_MUST_NOT_ENTER_NOTICE_STATE'), false);

const copiedReply = createCopiedClipboardNotice('reply', {
  consequenceId: 'renderer-reply-consequence',
});
const outdatedReply = markCopiedClipboardNoticeOutdated(copiedReply, 'reply');
assert.equal(outdatedReply.status, 'outdated');
assert.equal(clipboardCopyConsequenceId(outdatedReply), 'renderer-reply-consequence');
assert.match(outdatedReply.message, /上一版英文回复/u);
const retainedReply = markClipboardNoticeAfterTaskExit(outdatedReply);
assert.equal(retainedReply.status, 'retained');
assert.equal(clipboardCopyConsequenceId(retainedReply), 'renderer-reply-consequence');
assert.match(retainedReply.detail, /手动覆盖/u);
const dismissedReply = dismissClipboardNotice(retainedReply);
assert.equal(dismissedReply.dismissed, true);
assert.equal(clipboardCopyConsequenceId(dismissedReply), 'renderer-reply-consequence',
  'dismissing presentation must not imply that retained clipboard content changed');

const copyFailure = createClipboardCopyFailureNotice('source-link');
assert.equal(copyFailure.status, 'copy-error');
assert.match(copyFailure.detail, /剪贴板没有因这次操作改变/u);
assert.equal(hasClipboardCopyConsequence(copyFailure), false);

const mainSource = read('src/main/main.js');
const registrySource = read('src/main/clipboard-residue-registry.js');
const userDataResetRegistrySource = read('src/main/user-data-reset-registry.js');
const fullDataResetSource = read('src/renderer/utils/fullDataReset.mjs');
const constantsSources = [
  ['src/shared/constants.cjs', read('src/shared/constants.cjs')],
  ['src/shared/constants.js', read('src/shared/constants.js')],
];
const preloadSource = read('preload.js');
const productionMainFiles = collectSourceFiles(path.join(root, 'src/main'));
const productionMainSources = productionMainFiles.map((filePath) => [
  path.relative(root, filePath),
  fs.readFileSync(filePath, 'utf8'),
]);
const rendererFiles = collectSourceFiles(path.join(root, 'src/renderer'));
const rendererSources = rendererFiles.map((filePath) => [
  path.relative(root, filePath),
  fs.readFileSync(filePath, 'utf8'),
]);

assert.equal(
  fs.existsSync(path.join(root, 'src/main/clipboard-clear-registry.js')),
  false,
  'the obsolete conditional-clear registry must not ship in the production source tree',
);
assertNoForbiddenSource(productionMainSources, [
  [/\bclipboard\s*\.\s*clear\s*\(/u, 'a native clipboard.clear call'],
  [/\bclipboardClearRegistry\b/u, 'the obsolete clipboard clear registry'],
  [/\bcreateClipboardClearRegistry\b/u, 'the obsolete clear-registry constructor'],
  [/\bCLIPBOARD_CLEAR_IF_MATCHES\b/u, 'the obsolete conditional-clear IPC constant'],
  [/clipboard:clear-if-matches/u, 'the obsolete conditional-clear IPC channel'],
]);
for (const [relativePath, constantsSource] of constantsSources) {
  assert.doesNotMatch(constantsSource, /\bCLIPBOARD_CLEAR_IF_MATCHES\b|clipboard:clear-if-matches/u,
    `${relativePath} must not expose the retired clear IPC channel`);
}
assert.doesNotMatch(preloadSource, /clipboard:clear-if-matches|CLIPBOARD_CLEAR_IF_MATCHES/u,
  'the production preload must not expose any system-clipboard clear capability');
assertNoForbiddenSource(rendererSources, [
  [/\bclearToken\b/u, 'clipboard clear-token state'],
  [/\bhandleClearClipboard[A-Za-z0-9_]*\b/u, 'a clipboard-clear coordinator'],
  [/data-clipboard-clear-action/u, 'a clipboard-clear user action'],
  [/\bonClearClipboardAndConfirm\b/u, 'a clear-and-confirm exit action'],
  [/\bclipboardConfirmLabel\b/u, 'a clear-and-exit label'],
  [/\bCLIPBOARD_CLEAR_IF_MATCHES\b|clipboard:clear-if-matches/u,
    'the retired conditional-clear IPC channel'],
]);

assert.doesNotMatch(
  stripJavaScriptComments(registrySource),
  /fingerprint|clearToken|receipt|clipboard\.(?:readText|writeText|clear)/iu,
  'the consequence registry must remain metadata-only and clipboard-blind');
assert.doesNotMatch(
  stripJavaScriptComments(userDataResetRegistrySource),
  /preserveClipboard|clearToken|clipboard\.(?:readText|writeText|clear)/iu,
  'the reset-ticket registry must remain metadata-only and clipboard-blind',
);
const rendererPrepareIndex = fullDataResetSource.indexOf('await prepareReset({');
const rendererSessionPurgeIndex = fullDataResetSource.indexOf('await purgeSession()');
const rendererTicketConsumeIndex = fullDataResetSource.indexOf(
  'await resetPersistentData({ ticket: prepared.ticket })',
);
assert.ok(
  rendererPrepareIndex >= 0
    && rendererSessionPurgeIndex > rendererPrepareIndex
    && rendererTicketConsumeIndex > rendererSessionPurgeIndex,
  'renderer reset flow must prepare exact authorization before session purge and ticket consume',
);

const writeHandlerStart = mainSource.indexOf('IPC_CHANNELS.CLIPBOARD_WRITE');
const writeHandlerEnd = mainSource.indexOf('\n  });', writeHandlerStart);
assert.ok(writeHandlerStart >= 0 && writeHandlerEnd > writeHandlerStart,
  'main must expose one bounded clipboard-write handler');
const writeHandlerSource = mainSource.slice(writeHandlerStart, writeHandlerEnd);
const prepareMatch = writeHandlerSource.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*clipboardResidueRegistry\.prepare\(event\.sender\.id\)/u,
);
assert.ok(prepareMatch, 'main must prepare opaque consequence metadata before native write');
const preparedVariable = prepareMatch[1];
const commitPattern = new RegExp(
  `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*clipboardResidueRegistry\\.commit\\(\\s*event\\.sender\\.id,\\s*${preparedVariable}\\.id,?\\s*\\)`,
  'u',
);
const commitMatch = writeHandlerSource.match(commitPattern);
assert.ok(commitMatch, 'main must commit only the exact prepared consequence after native write');
const committedVariable = commitMatch[1];
const prepareIndex = writeHandlerSource.indexOf(prepareMatch[0]);
const nativeWriteIndex = writeHandlerSource.indexOf('clipboard.writeText(text)');
const commitIndex = writeHandlerSource.indexOf(commitMatch[0]);
const writeResetLockIndex = writeHandlerSource.indexOf(
  'userDataResetRegistry.isLocked(event.sender.id)',
);
const writeResetBlockedIndex = writeHandlerSource.indexOf(
  "error.code = 'user-data-reset-pending'",
);
assert.ok(
  writeResetLockIndex >= 0
    && writeResetBlockedIndex > writeResetLockIndex
    && prepareIndex > writeResetBlockedIndex,
  'a live reset ticket must block clipboard writes before consequence prepare or native mutation',
);
assert.ok(prepareIndex >= 0 && nativeWriteIndex > prepareIndex && commitIndex > nativeWriteIndex,
  'main write order must be prepare -> native write -> exact consequence commit');
assert.match(
  writeHandlerSource,
  new RegExp(
    `return\\s*\\{\\s*success:\\s*true,\\s*consequenceId:\\s*${committedVariable}\\.id,?\\s*\\}`,
    'u',
  ),
  'a successful native write must return only success and its opaque consequence id',
);
assert.doesNotMatch(writeHandlerSource, /clearToken|expiresInMs|fingerprint|clipboard\.readText/u,
  'clipboard-write settlement must not mint cleanup authority, fingerprint, TTL, or read-back proof');

const acknowledgementStart = mainSource.indexOf(
  'IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK',
);
const acknowledgementEnd = mainSource.indexOf('\n  });', acknowledgementStart);
assert.ok(acknowledgementStart >= 0 && acknowledgementEnd > acknowledgementStart,
  'main must retain one bounded consequence acknowledgement handler');
const acknowledgementSource = mainSource.slice(acknowledgementStart, acknowledgementEnd);
assert.match(acknowledgementSource, /payload\?\.id|payload\.id/u,
  'consequence acknowledgement must take an explicit opaque id');
assert.match(
  acknowledgementSource,
  /clipboardResidueRegistry\.resolve\(event\.sender\.id,\s*id\)/u,
  'consequence acknowledgement must resolve only the sender-bound exact id',
);
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
  'a live reset ticket must block consequence acknowledgement before registry release',
);

const quitDecisionStart = mainSource.indexOf('IPC_CHANNELS.APP_QUIT_DECISION');
const quitDecisionEnd = mainSource.indexOf('\n  });', quitDecisionStart);
assert.ok(quitDecisionStart >= 0 && quitDecisionEnd > quitDecisionStart,
  'main must expose one bounded quit-decision handler');
const quitDecisionSource = mainSource.slice(quitDecisionStart, quitDecisionEnd);
const quitConsequenceMatch = quitDecisionSource.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*clipboardResidueRegistry\.get\(event\.sender\.id\)/u,
);
assert.ok(quitConsequenceMatch,
  'quit must consult the latest confirmed clipboard consequence even without renderer memory');
assert.match(
  quitDecisionSource,
  new RegExp(
    `payload\\.clipboardConsequenceId\\s*!==\\s*${quitConsequenceMatch[1]}\\.id`,
    'u',
  ),
  'confirmed quit must bind explicit preserve consent to the exact current consequence id',
);
assert.doesNotMatch(quitDecisionSource, /clipboardResidueRiskId|clearToken|clipboard\.clear/u,
  'quit must neither accept the retired residue field nor perform clipboard cleanup');

const resetPrepareStart = mainSource.indexOf('IPC_CHANNELS.USER_DATA_RESET_PREPARE');
const resetPrepareEnd = mainSource.indexOf('\n  });', resetPrepareStart);
assert.ok(resetPrepareStart >= 0 && resetPrepareEnd > resetPrepareStart,
  'main must expose one bounded full-data reset preparation handler');
const resetPrepareSource = mainSource.slice(resetPrepareStart, resetPrepareEnd);
assert.match(
  resetPrepareSource,
  /return\s+userDataResetRegistry\.prepare\(\s*event\.sender\.id,\s*payload,\s*clipboardResidueRegistry\.get\(event\.sender\.id\),?\s*\)/u,
  'reset preparation must bind the requested choice to the exact current consequence',
);
assert.doesNotMatch(resetPrepareSource, /store\.resetUserDataAndSettings|clipboardResidueRegistry\.clearSender/u,
  'preparation must not remove persistent data or release the consequence');

const resetAbortStart = mainSource.indexOf('IPC_CHANNELS.USER_DATA_RESET_ABORT');
const resetAbortEnd = mainSource.indexOf('\n  });', resetAbortStart);
assert.ok(resetAbortStart >= 0 && resetAbortEnd > resetAbortStart,
  'main must expose one bounded reset-ticket abort handler');
const resetAbortSource = mainSource.slice(resetAbortStart, resetAbortEnd);
assert.match(resetAbortSource,
  /return\s+userDataResetRegistry\.abort\(event\.sender\.id,\s*payload\?\.ticket\)/u);

const resetStart = mainSource.indexOf('IPC_CHANNELS.USER_DATA_CLEAR');
const resetEnd = mainSource.indexOf('\n  });', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart,
  'main must expose one bounded full-data reset commit handler');
const resetSource = mainSource.slice(resetStart, resetEnd);
const resetAuthorizationMatch = resetSource.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*userDataResetRegistry\.consume\(\s*event\.sender\.id,\s*payload\?\.ticket,\s*clipboardResidueRegistry\.get\(event\.sender\.id\),?\s*\)/u,
);
assert.ok(resetAuthorizationMatch,
  'full reset commit must consume only a sender-bound one-shot ticket against current consequence');
const resetAuthorizationVariable = resetAuthorizationMatch[1];
const resetConsumeIndex = resetSource.indexOf(resetAuthorizationMatch[0]);
const resetAuthorizedIndex = resetSource.indexOf(
  `${resetAuthorizationVariable}.status !== 'authorized'`,
);
const persistentResetIndex = resetSource.indexOf('store.resetUserDataAndSettings()');
const releaseConsequenceIndex = resetSource.indexOf(
  'clipboardResidueRegistry.clearSender(event.sender.id)',
);
assert.ok(
  resetConsumeIndex >= 0
    && resetAuthorizedIndex > resetConsumeIndex
    && persistentResetIndex > resetAuthorizedIndex
    && releaseConsequenceIndex > persistentResetIndex,
  'ticket authorization must precede persistent deletion and consequence release',
);
assert.match(resetSource,
  new RegExp(`clipboardStatus:\\s*${resetAuthorizationVariable}\\.clipboardStatus`, 'u'));
assert.doesNotMatch(
  resetSource,
  /preserveClipboard|clipboardConsequenceId|clipboardResidueRiskId|clearToken|clipboard\.clear/u,
  'reset commit must accept only its ticket and never restore legacy clipboard cleanup fields',
);

// Reading remains legitimate for explicit Option+C capture and optional
// monitoring. This gate forbids read-to-clear behavior, not those input paths.
assert.match(mainSource, /clipboard\.readText\(\)/u,
  'the no-clear contract must not accidentally remove explicit clipboard capture support');
assert.doesNotMatch(mainSource, /clipboard\.readText\(\)[\s\S]{0,800}?clipboard\s*\.\s*clear\s*\(/u,
  'no clipboard read may feed a conditional cleanup path');

const rendererClipboardWriteInvocations = rendererSources.flatMap(([relativePath, source]) => (
  [...source.matchAll(/invoke\s*\(\s*IPC_CHANNELS\.CLIPBOARD_WRITE\b/gu)]
    .map(() => relativePath)
));
assert.deepEqual(rendererClipboardWriteInvocations, ['src/renderer/App.jsx'],
  'every renderer clipboard write must cross the single App-owned coordinator');

const appSource = read('src/renderer/App.jsx');
const coordinatorStart = appSource.indexOf('const handleClipboardCopy = useCallback');
assert.ok(coordinatorStart >= 0, 'App must retain one clipboard-copy coordinator');
const nextHookStart = appSource.indexOf('\n  const ', coordinatorStart + 1);
const coordinatorSource = appSource.slice(
  coordinatorStart,
  nextHookStart > coordinatorStart ? nextHookStart : appSource.length,
);
const operationLockIndex = coordinatorSource.indexOf('clipboardOperationRef.current = operation;');
const pendingStateIndex = coordinatorSource.indexOf('setClipboardOperation(operation);');
const pendingNoticeIndex = coordinatorSource.indexOf('setClipboardNotice(pendingNotice);');
const rendererWriteIndex = coordinatorSource.indexOf(
  'await invoke(IPC_CHANNELS.CLIPBOARD_WRITE, text)',
);
const releaseIndex = coordinatorSource.lastIndexOf('clipboardOperationRef.current = null;');
assert.ok(
  operationLockIndex >= 0
    && pendingStateIndex > operationLockIndex
    && pendingNoticeIndex > pendingStateIndex
    && rendererWriteIndex > pendingNoticeIndex
    && releaseIndex > rendererWriteIndex,
  'App must lock, publish pending state, write once, settle, and release in that order',
);

let exposedApi = null;
const invokedChannels = [];
const preloadWarnings = [];
vm.runInNewContext(preloadSource, {
  require: (specifier) => {
    assert.equal(specifier, 'electron', 'the production preload must load only the Electron bridge here');
    return {
      contextBridge: {
        exposeInMainWorld: (name, api) => {
          assert.equal(name, 'api');
          exposedApi = api;
        },
      },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          invokedChannels.push({ channel, args });
          return Promise.resolve({ success: true, consequenceId: 'vm-write-consequence' });
        },
        on: () => {},
        removeListener: () => {},
      },
    };
  },
  console: {
    warn: (message) => preloadWarnings.push(message),
  },
}, { filename: path.join(root, 'preload.js') });

assert.ok(exposedApi, 'the production preload must expose its constrained bridge');
assert.deepEqual(
  await exposedApi.invoke('clipboard:write', 'fixture-only write'),
  { success: true, consequenceId: 'vm-write-consequence' },
);
assert.deepEqual(invokedChannels, [{
  channel: 'clipboard:write',
  args: ['fixture-only write'],
}], 'the explicit write channel must still reach ipcRenderer');

await assert.rejects(
  exposedApi.invoke('clipboard:clear-if-matches', 'retired-token'),
  /IPC channel "clipboard:clear-if-matches" not allowed/u,
  'the retired matching-clear channel must be rejected by the production preload',
);
await assert.rejects(
  exposedApi.invoke('clipboard:clear', 'anything'),
  /IPC channel "clipboard:clear" not allowed/u,
  'an unconditional clipboard-clear channel must also remain unavailable',
);
assert.equal(invokedChannels.length, 1,
  'blocked clear requests must never reach ipcRenderer.invoke');
assert.match(preloadWarnings.join('\n'), /clipboard:clear-if-matches/u);
assert.match(preloadWarnings.join('\n'), /clipboard:clear/u);

console.log('Clipboard write-only consequence and no-clear privacy checks passed.');
