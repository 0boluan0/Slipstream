export function createRequestCoordinator() {
  let sequence = 0;
  let active = false;
  let pending = null;

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
      return { apply: task.id === sequence, next };
    },
    invalidate() {
      sequence += 1;
      pending = null;
    },
  };
}
