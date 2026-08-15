import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  describeFullDataResetFailure,
  nextFullDataResetSessionCleared,
} from '../src/renderer/utils/fullDataResetFailure.mjs';
import { FULL_DATA_RESET_ERROR_CODES } from '../src/renderer/utils/fullDataResetErrorCodes.mjs';
import { runFullDataReset } from '../src/renderer/utils/fullDataReset.mjs';

const require = createRequire(import.meta.url);
const { createUserDataResetRegistry } = require('../src/main/user-data-reset-registry');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const appSource = read('src/renderer/App.jsx');
const panelSource = read('src/renderer/components/FloatingPanel.jsx');
const settingsSource = read('src/renderer/components/SettingsPanel.jsx');
const resetDialogSource = read('src/renderer/components/SettingsResetDialog.jsx');
const ipcSource = read('src/renderer/hooks/useIpc.js');
const settingsHookSource = read('src/renderer/hooks/useSettings.js');
const resetUtilitySource = read('src/renderer/utils/fullDataReset.mjs');
const mainSource = read('src/main/main.js');
const resetRegistrySource = read('src/main/user-data-reset-registry.js');
const constantsSource = read('src/shared/constants.js');
const constantsCjsSource = read('src/shared/constants.cjs');
const preloadSource = read('preload.js');
const resetHandlerStart = appSource.indexOf('const handleResetAllData = useCallback');
const resetHandlerEnd = appSource.indexOf('\n\n  useEffect(', resetHandlerStart);
const resetHandlerSource = appSource.slice(resetHandlerStart, resetHandlerEnd);

let ticketSequence = 0;
let registryNow = 10_000;
const nextTicket = () => {
  ticketSequence += 1;
  return `reset-ticket-${String(ticketSequence).padStart(32, '0')}`;
};
const createRegistry = () => createUserDataResetRegistry({
  idFactory: nextTicket,
  now: () => registryNow,
  ttlMs: 1_000,
});

// Registry: no-consequence prepare is still mandatory, exact, one-shot and
// sender-bound.
{
  const registry = createRegistry();
  assert.deepEqual(registry.prepare(1, [], null), { status: 'invalid' });
  const prepared = registry.prepare(1, {
    clipboardMode: 'none',
    clipboardConsequenceId: null,
  }, null);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.clipboardStatus, 'not-applicable');
  assert.equal(registry.isLocked(1), true);
  assert.deepEqual(registry.consume(2, prepared.ticket, null), { status: 'invalid-ticket' },
    'a reset ticket must not cross renderer senders');
  assert.equal(registry.isLocked(1), true, 'cross-sender use must not consume the owner ticket');
  assert.deepEqual(registry.consume(1, `${prepared.ticket}-tampered`, null), { status: 'invalid-ticket' });
  assert.equal(registry.isLocked(1), true, 'ticket tampering must leave the exact ticket locked');
  assert.deepEqual(registry.consume(1, prepared.ticket, null), {
    status: 'authorized',
    clipboardStatus: 'not-applicable',
  });
  assert.equal(registry.isLocked(1), false);
  assert.deepEqual(registry.consume(1, prepared.ticket, null), { status: 'invalid-ticket' },
    'an authorized ticket must not replay');
}

// Registry: stale/mismatched renderer IDs never create a ticket, while an
// exact preserve choice pins the consequence until consume.
{
  const registry = createRegistry();
  const active = { id: 'main-current-consequence' };
  assert.deepEqual(registry.prepare(1, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: 'renderer-stale-consequence',
  }, active), {
    status: 'clipboard-consequence-mismatch',
    clipboardConsequence: active,
  });
  assert.equal(registry.isLocked(1), false);
  assert.deepEqual(registry.prepare(1, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: 'stale-extra-id',
  }, null), {
    status: 'clipboard-consequence-mismatch',
    clipboardConsequence: null,
  }, 'an extra stale consequence id must be rejected even when main has no consequence');

  const prepared = registry.prepare(1, {
    clipboardMode: 'preserve',
    clipboardConsequenceId: active.id,
  }, active);
  assert.equal(prepared.status, 'prepared');
  assert.equal(registry.isLocked(1), true,
    'clipboard writes and acknowledgements can dynamically reject while a ticket is live');
  assert.deepEqual(registry.consume(1, prepared.ticket, { id: 'changed-after-prepare' }), {
    status: 'clipboard-consequence-changed',
    clipboardConsequence: { id: 'changed-after-prepare' },
  });
  assert.equal(registry.isLocked(1), false, 'a changed consequence must consume the one-shot ticket');
}

// Registry: abort, expiration and lifecycle cleanup always release the write
// lock rather than stranding clipboard operations.
{
  const registry = createRegistry();
  const first = registry.prepare(1, { clipboardMode: 'none', clipboardConsequenceId: null }, null);
  assert.deepEqual(registry.abort(1, first.ticket), { status: 'aborted' });
  assert.equal(registry.isLocked(1), false);

  const second = registry.prepare(1, { clipboardMode: 'none', clipboardConsequenceId: null }, null);
  registryNow += 1_001;
  assert.deepEqual(registry.consume(1, second.ticket, null), { status: 'expired-ticket' });
  assert.equal(registry.isLocked(1), false, 'TTL expiry must release clipboard writes');

  const third = registry.prepare(1, { clipboardMode: 'none', clipboardConsequenceId: null }, null);
  assert.equal(third.status, 'prepared');
  registry.clearSender(1);
  assert.equal(registry.isLocked(1), false, 'sender teardown must release the ticket');
}

function createRendererTransaction({
  mainConsequence = null,
  commitFailure = null,
  malformedCommit = false,
} = {}) {
  const registry = createRegistry();
  const events = [];
  return {
    registry,
    events,
    prepareReset: async (payload) => {
      events.push('prepare');
      const response = registry.prepare(1, payload, mainConsequence);
      if (response.status === 'prepared') {
        return { ...response, expiresAt: Date.now() + 30_000 };
      }
      return response;
    },
    abortReset: async ({ ticket }) => {
      events.push('abort');
      return registry.abort(1, ticket);
    },
    resetPersistentData: async ({ ticket }) => {
      events.push('commit');
      const authorization = registry.consume(1, ticket, mainConsequence);
      if (authorization.status !== 'authorized') {
        const error = new Error(authorization.status);
        error.clipboardConsequence = authorization.clipboardConsequence;
        throw error;
      }
      if (commitFailure) throw commitFailure;
      return malformedCommit ? undefined : true;
    },
  };
}

// Normal no-consequence path remains none mode, but still follows
// prepare -> session -> commit.
{
  const transaction = createRendererTransaction();
  let preparedPayload = null;
  const prepare = transaction.prepareReset;
  transaction.prepareReset = async (payload) => {
    preparedPayload = payload;
    return prepare(payload);
  };
  const result = await runFullDataReset({
    clipboardMode: 'preserve',
    prepareReset: transaction.prepareReset,
    abortReset: transaction.abortReset,
    purgeSession: async () => {
      transaction.events.push('session');
      return { status: 'cleared' };
    },
    resetPersistentData: transaction.resetPersistentData,
  });
  assert.deepEqual(transaction.events, ['prepare', 'session', 'commit']);
  assert.deepEqual(preparedPayload, { clipboardMode: 'none', clipboardConsequenceId: null });
  assert.deepEqual(result, {
    status: 'cleared',
    sessionCleared: true,
    clipboardStatus: 'not-applicable',
  });
}

// A valid-looking but stale renderer ID is rejected by main before session
// deletion, and the current opaque consequence is carried only as metadata.
{
  const transaction = createRendererTransaction({
    mainConsequence: { id: 'main-current-consequence' },
  });
  let sessionRan = false;
  let mismatchError = null;
  try {
    await runFullDataReset({
      clipboardMode: 'preserve',
      hasClipboardCopyConsequence: true,
      consequenceId: 'renderer-stale-consequence',
      prepareReset: transaction.prepareReset,
      abortReset: transaction.abortReset,
      purgeSession: async () => {
        sessionRan = true;
        return { status: 'cleared' };
      },
      resetPersistentData: transaction.resetPersistentData,
    });
  } catch (error) {
    mismatchError = error;
  }
  assert.equal(mismatchError?.code, FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED);
  assert.deepEqual(mismatchError?.clipboardConsequence, { id: 'main-current-consequence' });
  assert.equal(sessionRan, false);
  assert.deepEqual(transaction.events, ['prepare']);
}

{
  const transaction = createRendererTransaction();
  let sessionRan = false;
  let staleLocalError = null;
  try {
    await runFullDataReset({
      clipboardMode: 'preserve',
      hasClipboardCopyConsequence: true,
      consequenceId: 'renderer-only-stale-consequence',
      prepareReset: transaction.prepareReset,
      abortReset: transaction.abortReset,
      purgeSession: async () => { sessionRan = true; return { status: 'cleared' }; },
      resetPersistentData: transaction.resetPersistentData,
    });
  } catch (error) {
    staleLocalError = error;
  }
  assert.equal(sessionRan, false);
  assert.equal(Object.hasOwn(staleLocalError, 'clipboardConsequence'), true);
  assert.equal(staleLocalError.clipboardConsequence, null,
    'main must be able to authoritatively reject a stale extra renderer id');
}

// Missing local authority and retired clear mode fail before prepare or purge.
for (const scenario of [
  { clipboardMode: 'none', consequenceId: 'known-id', expected: FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CHOICE_REQUIRED },
  { clipboardMode: 'preserve', consequenceId: null, expected: FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CONSEQUENCE_ID_REQUIRED },
  { clipboardMode: 'clear', consequenceId: null, expected: FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CHOICE_REQUIRED, hasConsequence: false },
]) {
  const events = [];
  await assert.rejects(runFullDataReset({
    clipboardMode: scenario.clipboardMode,
    hasClipboardCopyConsequence: scenario.hasConsequence !== false,
    consequenceId: scenario.consequenceId,
    prepareReset: async () => { events.push('prepare'); },
    abortReset: async () => { events.push('abort'); },
    purgeSession: async () => { events.push('session'); return { status: 'cleared' }; },
    resetPersistentData: async () => { events.push('commit'); return true; },
  }), (error) => error.code === scenario.expected);
  assert.deepEqual(events, []);
}

// Malformed, expired and implausibly far-future prepare responses all fail
// closed before session deletion.
for (const response of [
  null,
  [],
  {},
  { status: 'prepared', ticket: 'x'.repeat(32), clipboardStatus: 'not-applicable' },
  { status: 'prepared', ticket: 'x'.repeat(32), clipboardStatus: 'not-applicable', expiresAt: Date.now() - 1 },
  { status: 'prepared', ticket: 'x'.repeat(32), clipboardStatus: 'not-applicable', expiresAt: Date.now() + 30_000.5 },
  { status: 'prepared', ticket: 'x'.repeat(32), clipboardStatus: 'not-applicable', expiresAt: Date.now() + 10 * 60 * 1_000 },
]) {
  let sessionRan = false;
  await assert.rejects(runFullDataReset({
    prepareReset: async () => response,
    abortReset: async () => ({ status: 'aborted' }),
    purgeSession: async () => { sessionRan = true; return { status: 'cleared' }; },
    resetPersistentData: async () => true,
  }), (error) => error.code === FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED);
  assert.equal(sessionRan, false);
}

// Session failure aborts the live ticket; commit failure and malformed commit
// confirmation are both truthfully partial failures.
{
  const transaction = createRendererTransaction();
  await assert.rejects(runFullDataReset({
    prepareReset: transaction.prepareReset,
    abortReset: transaction.abortReset,
    purgeSession: async () => {
      transaction.events.push('session');
      return { status: 'storage-error' };
    },
    resetPersistentData: transaction.resetPersistentData,
  }), (error) => error.code === FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNCONFIRMED
    && error.sessionCleared === false);
  assert.deepEqual(transaction.events, ['prepare', 'session', 'abort']);
  assert.equal(transaction.registry.isLocked(1), false);
}

for (const malformedCommit of [false, true]) {
  const transaction = createRendererTransaction({
    commitFailure: malformedCommit ? null : new Error('offline'),
    malformedCommit,
  });
  let failure = null;
  try {
    await runFullDataReset({
      prepareReset: transaction.prepareReset,
      abortReset: transaction.abortReset,
      purgeSession: async () => {
        transaction.events.push('session');
        return { status: 'cleared' };
      },
      resetPersistentData: transaction.resetPersistentData,
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, FULL_DATA_RESET_ERROR_CODES.PERSISTENT_CLEAR_UNCONFIRMED);
  assert.equal(failure?.sessionCleared, true);
  assert.match(describeFullDataResetFailure(failure), /已在上一次尝试中清除/);
}

// Cumulative partial state is monotonic: after a commit failure, a second
// prepare failure skips session purge and never claims the old data is kept.
{
  const first = createRendererTransaction({ commitFailure: new Error('offline') });
  let purgeCount = 0;
  let firstError = null;
  try {
    await runFullDataReset({
      prepareReset: first.prepareReset,
      abortReset: first.abortReset,
      purgeSession: async () => { purgeCount += 1; return { status: 'cleared' }; },
      resetPersistentData: first.resetPersistentData,
    });
  } catch (error) {
    firstError = error;
  }
  const cumulative = nextFullDataResetSessionCleared(false, firstError);
  assert.equal(cumulative, true);

  let secondError = null;
  try {
    await runFullDataReset({
      sessionAlreadyCleared: cumulative,
      prepareReset: async () => ({}),
      abortReset: async () => ({ status: 'invalid-ticket' }),
      purgeSession: async () => { purgeCount += 1; return { status: 'storage-error' }; },
      resetPersistentData: async () => true,
    });
  } catch (error) {
    secondError = error;
  }
  assert.equal(nextFullDataResetSessionCleared(cumulative, secondError), true);
  assert.equal(purgeCount, 1, 'a partial retry must not purge the already-cleared session again');
  const retryCopy = describeFullDataResetFailure(secondError, { sessionAlreadyCleared: cumulative });
  assert.match(retryCopy, /已在上一次尝试中清除/);
  assert.doesNotMatch(retryCopy, /尚未开始清除应用内数据|保留我的数据/);
}

assert.doesNotMatch(resetUtilitySource, /clearClipboard|acknowledgeClipboardResidue|hasGuardedClipboardCopy/,
  'the reset transaction must not restore clipboard clearing or a clearing registry');
assert.match(resetRegistrySource, /DEFAULT_USER_DATA_RESET_TTL_MS = 30_000[\s\S]*randomBytes\(32\)/,
  'tickets must be unguessable and short-lived');
assert.match(mainSource,
  /USER_DATA_RESET_PREPARE[\s\S]*?userDataResetRegistry\.prepare[\s\S]*?USER_DATA_CLEAR[\s\S]*?userDataResetRegistry\.consume[\s\S]*?store\.resetUserDataAndSettings/,
  'main must authorize before the destructive persistent reset');
assert.match(mainSource,
  /CLIPBOARD_WRITE[\s\S]*?userDataResetRegistry\.isLocked[\s\S]*?APP_CLIPBOARD_RESIDUE_RISK_ACK[\s\S]*?userDataResetRegistry\.isLocked/,
  'writes and acknowledgements must be blocked while a reset ticket is live');
assert.match(mainSource,
  /resetRendererOwnedWorkAfterCrash[\s\S]*?userDataResetRegistry\.clearSender[\s\S]*?mainWindow\.on\('closed'[\s\S]*?userDataResetRegistry\.clearSender[\s\S]*?before-quit[\s\S]*?userDataResetRegistry\.clearAll/,
  'crash, close and quit lifecycle paths must release reset tickets');
assert.match(mainSource, /const activeClipboardConsequence = clipboardResidueRegistry\.get\(senderId\)/,
  'the concurrent hidden-window quit wake-up safeguard must remain intact');

for (const source of [constantsSource, constantsCjsSource]) {
  assert.match(source, /USER_DATA_RESET_PREPARE: 'user-data-reset:prepare'/);
  assert.match(source, /USER_DATA_RESET_ABORT: 'user-data-reset:abort'/);
}
assert.match(preloadSource, /'user-data-reset:prepare'[\s\S]*'user-data-reset:abort'[\s\S]*'user-data:clear'/);

assert.match(resetHandlerSource,
  /resetTransaction[\s\S]*?sessionAlreadyCleared = false[\s\S]*?typeof resetTransaction !== 'function'[\s\S]*?resetTransaction\(\{[\s\S]*?USER_DATA_RESET_PREPARE[\s\S]*?USER_DATA_RESET_ABORT[\s\S]*?purgeSession:[\s\S]*?resetPersistentData:/,
  'App must wire prepare -> conditional session purge -> ticket commit');
assert.doesNotMatch(appSource, /import\(['"]\.\/utils\/fullDataReset\.mjs['"]\)/,
  'destructive confirmation must not start a new module fetch');
assert.doesNotMatch(resetHandlerSource, /APP_RENDERER_RECOVERY_STATUS_GET/,
  'the display-only recovery endpoint must not authorize a destructive reset');
assert.match(resetHandlerSource,
  /normalizeClipboardResidueRisk\(error\?\.clipboardConsequence\)[\s\S]*?publishClipboardResidueRisk/,
  'a main-authoritative mismatch must refresh the visible opaque risk without displaying its id');
assert.match(resetHandlerSource,
  /Object\.hasOwn\(error \|\| \{\}, 'clipboardConsequence'\)[\s\S]*?status: 'copy-error'[\s\S]*?consequenceId: null/,
  'a main-authoritative null mismatch must retire the stale blocking id while preserving a manual-cover warning');
assert.match(settingsHookSource,
  /invoke\(IPC_CHANNELS\.USER_DATA_CLEAR, \{ ticket \}\)[\s\S]*?response\.status !== 'cleared'[\s\S]*?response\.settings[\s\S]*?response\.clipboardStatus/,
  'the commit IPC response must be strictly confirmed before local settings reset');

assert.match(settingsSource,
  /onResetAllData\(\{[\s\S]*?clipboardMode,[\s\S]*?resetTransaction: runFullDataReset,[\s\S]*?sessionAlreadyCleared: resetSessionAlreadyCleared,[\s\S]*?\}\)/,
  'the retryable Settings workspace must provide the already-loaded reset transaction');
assert.match(settingsSource,
  /nextFullDataResetSessionCleared\([\s\S]*?setResetSessionAlreadyCleared\(nextSessionAlreadyCleared\)/,
  'partial reset state must be cumulative within one dialog lifecycle');
const handleResetStart = settingsSource.indexOf('const handleReset = useCallback');
const handleResetEnd = settingsSource.indexOf('\n\n  const containerStyle', handleResetStart);
assert.doesNotMatch(settingsSource.slice(handleResetStart, handleResetEnd),
  /setResetSessionAlreadyCleared\(false\)[\s\S]*?try \{/,
  'a retry must not erase the already-cleared session phase before it runs');
assert.match(settingsSource, /resetSessionAlreadyCleared \? '暂不重试' : '保留我的数据'/);
assert.match(resetDialogSource, /sessionAlreadyCleared[\s\S]*?正在重试剩余清除/);

assert.match(panelSource, /const purgeForFullDataReset = useCallback/);
assert.match(panelSource, /clearSessionRecovery\(recoveryStorage\)/);
assert.match(panelSource, /latestSessionRecoveryRef\.current = null/);
assert.match(panelSource, /clearedSessionRef\.current = null/);
assert.match(panelSource, /lastGoodRef\.current = null/);
assert.match(panelSource, /setInputText\(''\)[\s\S]*setProcessedSourceText\(''\)[\s\S]*setResult\(''\)[\s\S]*setBrief\(null\)/);
assert.match(panelSource,
  /setSavedTermsLoadState\(SAVED_TERMS_LOAD_STATUS\.IDLE[\s\S]*?savedTermsDrawerOpenRef\.current = false[\s\S]*?setSavedTermsDrawerOpen\(false\)[\s\S]*?setSavedTermsSessionGeneration\(\(current\) => current \+ 1\)/,
  'full reset must stop presenting a trusted term snapshot, close Saved Terms, and invalidate its local undo/import session');
assert.doesNotMatch(
  panelSource.slice(
    panelSource.indexOf('const purgeForFullDataReset = useCallback'),
    panelSource.indexOf('const confirmSavedTermsPersistentReset = useCallback'),
  ),
  /updateSavedTerms\(\[\]\)|setSavedTerms\(\[\]\)/,
  'renderer session purge must not claim persistent Saved Terms are empty before main confirms the clear');
assert.match(panelSource,
  /const confirmSavedTermsPersistentReset = useCallback[\s\S]*?updateSavedTerms\(\[\]\)[\s\S]*?SAVED_TERMS_LOAD_STATUS\.READY/,
  'only a confirmed persistent reset may publish a ready empty Saved Terms snapshot');
assert.match(panelSource,
  /<SavedTermsLibrary[\s\S]*?key=\{`saved-terms-session-\$\{savedTermsSessionGeneration\}`\}/,
  'the full-reset generation must remount the retained lazy Saved Terms workspace');
assert.match(panelSource,
  /onFullDataResetControllerChange\?\.\(\{[\s\S]*?purge: purgeForFullDataReset[\s\S]*?confirmPersistentReset: confirmSavedTermsPersistentReset[\s\S]*?recoverAfterPersistentResetFailure: recoverSavedTermsAfterResetFailure/);
assert.match(resetHandlerSource,
  /error\?\.sessionCleared === true[\s\S]*?recoverAfterPersistentResetFailure[\s\S]*?throw error/,
  'a persistent reset failure must re-read Saved Terms instead of leaving a false empty snapshot');
assert.match(resetHandlerSource,
  /confirmPersistentReset\?\.\(\)[\s\S]*?publishClipboardResidueRisk\(null\)/,
  'the renderer may publish ready-empty Saved Terms only after the main reset succeeds');

assert.match(ipcSource, /case IPC_CHANNELS\.USER_DATA_RESET_PREPARE:[\s\S]*?prepareDemoUserDataReset/);
assert.match(ipcSource, /case IPC_CHANNELS\.USER_DATA_RESET_ABORT:[\s\S]*?status: 'aborted'/);
assert.match(ipcSource,
  /case IPC_CHANNELS\.USER_DATA_CLEAR:[\s\S]*?resetPayload\.ticket[\s\S]*?clipboard-consequence-changed[\s\S]*?scheduleDemoResetQuitRequest/,
  'the preview must consume the exact ticket before simulating a slow reset');
assert.match(ipcSource, /demoResetCode === 'slow'[\s\S]*?window\.setTimeout\([\s\S]*?5000/);
assert.match(ipcSource,
  /APP_CLIPBOARD_RESIDUE_RISK_ACK:[\s\S]*?getLiveDemoUserDataResetTicket[\s\S]*?CLIPBOARD_WRITE:[\s\S]*?getLiveDemoUserDataResetTicket/,
  'the preview must model write and acknowledgement blocking during prepare');

console.log('Full data reset checks passed.');
