const PROVIDER_CONNECTION_CANCEL_ACK_MS = 2000;

async function waitForProviderConnectionStop(
  task,
  {
    timeoutMs = PROVIDER_CONNECTION_CANCEL_ACK_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  if (!task) return true;

  let timeoutId;
  const settled = Promise.resolve(task).then(
    () => true,
    () => true,
  );
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimer(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timeoutId !== undefined) clearTimer(timeoutId);
  }
}

module.exports = {
  PROVIDER_CONNECTION_CANCEL_ACK_MS,
  waitForProviderConnectionStop,
};
