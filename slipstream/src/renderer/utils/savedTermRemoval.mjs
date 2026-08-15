export const SAVED_TERM_REMOVAL_PHASES = Object.freeze({
  IDLE: 'idle',
  DELETING: 'deleting',
  UNDO: 'undo',
  RESTORING: 'restoring',
});

export function createSavedTermRemovalState() {
  return { phase: SAVED_TERM_REMOVAL_PHASES.IDLE, term: null };
}

export function transitionSavedTermRemoval(state, action) {
  const current = state || createSavedTermRemovalState();
  const type = action?.type;

  if (type === 'delete-start') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.IDLE || !action.term) return current;
    return { phase: SAVED_TERM_REMOVAL_PHASES.DELETING, term: action.term };
  }

  if (type === 'delete-success') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.DELETING) return current;
    return { phase: SAVED_TERM_REMOVAL_PHASES.UNDO, term: current.term };
  }

  if (type === 'delete-failure') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.DELETING) return current;
    return createSavedTermRemovalState();
  }

  if (type === 'restore-start') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.UNDO) return current;
    return { phase: SAVED_TERM_REMOVAL_PHASES.RESTORING, term: current.term };
  }

  if (type === 'restore-success') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.RESTORING) return current;
    return createSavedTermRemovalState();
  }

  if (type === 'restore-failure') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.RESTORING) return current;
    return { phase: SAVED_TERM_REMOVAL_PHASES.UNDO, term: current.term };
  }

  if (type === 'dismiss' || type === 'sync-restored') {
    if (current.phase !== SAVED_TERM_REMOVAL_PHASES.UNDO) return current;
    return createSavedTermRemovalState();
  }

  return current;
}
