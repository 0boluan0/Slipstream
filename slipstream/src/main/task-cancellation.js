const DEFAULT_CANCELLATION_CONFIRM_TIMEOUT_MS = 2500;

function createTaskSettlement() {
  let resolvePromise;
  let settled = false;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      if (settled) return false;
      settled = true;
      resolvePromise();
      return true;
    },
  };
}

async function waitForTaskSettlements(
  taskPromises,
  timeoutMs = DEFAULT_CANCELLATION_CONFIRM_TIMEOUT_MS,
) {
  const pending = (Array.isArray(taskPromises) ? taskPromises : [])
    .filter((taskPromise) => taskPromise && typeof taskPromise.then === 'function');
  if (pending.length === 0) return true;

  let timeoutId;
  const allSettled = Promise.allSettled(pending).then(() => true);
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const confirmed = await Promise.race([allSettled, timedOut]);
  clearTimeout(timeoutId);
  return confirmed;
}

module.exports = {
  DEFAULT_CANCELLATION_CONFIRM_TIMEOUT_MS,
  createTaskSettlement,
  waitForTaskSettlements,
};
