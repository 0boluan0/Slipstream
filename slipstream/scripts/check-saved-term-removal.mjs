import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSavedTermRemovalState,
  SAVED_TERM_REMOVAL_PHASES,
  transitionSavedTermRemoval,
} from '../src/renderer/utils/savedTermRemoval.mjs';

const termA = { id: 41, term: 'CAS', createdAt: '2026-07-27T09:00:00.000Z' };
const termB = { id: 42, term: 'passport information page', createdAt: '2026-07-27T09:01:00.000Z' };

const idle = createSavedTermRemovalState();
assert.deepEqual(idle, { phase: SAVED_TERM_REMOVAL_PHASES.IDLE, term: null });

const deletingA = transitionSavedTermRemoval(idle, { type: 'delete-start', term: termA });
assert.deepEqual(deletingA, { phase: SAVED_TERM_REMOVAL_PHASES.DELETING, term: termA });
assert.equal(
  transitionSavedTermRemoval(deletingA, { type: 'delete-start', term: termB }),
  deletingA,
  'a second pointer gesture must not start another deletion while the first is in flight',
);

const undoA = transitionSavedTermRemoval(deletingA, { type: 'delete-success' });
assert.deepEqual(undoA, { phase: SAVED_TERM_REMOVAL_PHASES.UNDO, term: termA });
assert.equal(
  transitionSavedTermRemoval(undoA, { type: 'delete-start', term: termB }),
  undoA,
  'a pending recovery right must not be overwritten by another deletion',
);

const restoringA = transitionSavedTermRemoval(undoA, { type: 'restore-start' });
assert.deepEqual(restoringA, { phase: SAVED_TERM_REMOVAL_PHASES.RESTORING, term: termA });
assert.equal(
  transitionSavedTermRemoval(restoringA, { type: 'delete-start', term: termB }),
  restoringA,
  'another deletion must remain blocked while restoration is in flight',
);
assert.deepEqual(
  transitionSavedTermRemoval(restoringA, { type: 'restore-failure' }),
  undoA,
  'a restore failure must preserve the exact pending term and its recovery right',
);
assert.deepEqual(
  transitionSavedTermRemoval(restoringA, { type: 'restore-success' }),
  idle,
  'a successful undo must release the deletion lock',
);
assert.deepEqual(
  transitionSavedTermRemoval(undoA, { type: 'dismiss' }),
  idle,
  'explicitly keeping the deletion must release the deletion lock',
);
assert.deepEqual(
  transitionSavedTermRemoval(deletingA, { type: 'delete-failure' }),
  idle,
  'a failed delete must return to an immediately retryable state',
);
assert.equal(
  transitionSavedTermRemoval(idle, { type: 'delete-success' }),
  idle,
  'stale async completions must not create an undo transaction',
);

const componentUrl = new URL('../src/renderer/components/SavedTermsLibrary.jsx', import.meta.url);
const cssUrl = new URL(
  '../src/renderer/components/SavedTermsLibrary.css',
  import.meta.url,
);
const [componentSource, cssSource] = await Promise.all([
  readFile(componentUrl, 'utf8'),
  readFile(cssUrl, 'utf8'),
]);

const refMutation = componentSource.indexOf('removalRef.current = next;');
const stateMutation = componentSource.indexOf('setRemoval(next);', refMutation);
const deleteGuard = componentSource.indexOf("if (!dispatchRemoval({ type: 'delete-start', term })) return;");
const deleteInvocation = componentSource.indexOf('await onDeleteTerm(term);', deleteGuard);
assert.ok(refMutation >= 0 && refMutation < stateMutation,
  'the deletion lock must update synchronously before React schedules a render');
assert.ok(deleteGuard >= 0 && deleteGuard < deleteInvocation,
  'the synchronous transaction guard must run before persistent deletion begins');
assert.match(componentSource, /disabled=\{removalPending \|\| transferPending \|\| transferActive/,
  'all remaining remove controls must stay disabled while a deletion is unresolved');
assert.match(componentSource, /data-saved-term-remove-id=\{term\.id\}/,
  'remove controls need stable identities for deterministic focus restoration');
assert.match(componentSource, /ref=\{undoButtonRef\}[\s\S]*撤销删除/,
  'the pending transaction must expose a focusable Undo action');
assert.match(componentSource, /requestAnimationFrame\(\(\) => undoButtonRef\.current\?\.focus\(\)\)/,
  'successful deletion must move focus to Undo');
assert.match(componentSource, /先撤销或保留这次删除，再移除其他术语/,
  'the pending transaction must explain why another removal is unavailable');
assert.match(componentSource, /className="saved-term-undo__keep"[\s\S]*保留删除/,
  'discarding the recovery right must be an explicit, visible choice');
assert.match(componentSource, /exactControl \|\| controls\.find\(\(node\) => !node\.disabled\)[\s\S]*target\?\.focus\(\)/,
  'Undo and Keep must restore focus to a useful library control');
assert.match(componentSource, /无法确认是否已恢复.*可能已经完成，也可能没有完成.*重新读取术语库/s,
  'an unconfirmed restore must require a fresh persistent read instead of preserving a stale undo claim');
assert.match(cssSource, /\.saved-term-undo__keep[\s\S]*border: 1px solid var\(--border-secondary\)/,
  'the explicit Keep action must remain visually secondary to Undo');

console.log('Saved-term removal transaction checks passed.');
