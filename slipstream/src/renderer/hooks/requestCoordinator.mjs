export function createRequestCoordinator() {
  let sequence = 0;
  let active = false;
  let pending = null;
  const suppressed = new Set();

  return {
    schedule(payload) {
      const task = { id: ++sequence, payload };
      if (active) {
        pending = task;
        return null;
      }
      active = true;
      return task;
    },
    complete(task) {
      const next = pending;
      pending = null;
      active = Boolean(next);
      const wasSuppressed = suppressed.delete(task.id);
      return { apply: task.id === sequence && !wasSuppressed, next };
    },
    suppress(task) {
      suppressed.add(task.id);
    },
    invalidate() {
      sequence += 1;
      pending = null;
      suppressed.clear();
    },
  };
}

export function completeTaskForGeneration(coordinator, task, {
  generationIsCurrent,
  restoreLastGoodIfStale = false,
}) {
  const stale = generationIsCurrent !== true;
  if (stale) coordinator.suppress(task);
  const completion = coordinator.complete(task);
  return {
    ...completion,
    stale,
    restoreLastGood: stale && Boolean(restoreLastGoodIfStale),
  };
}
