'use strict';

function transitionClipboardMonitoring({
  enabled,
  isActive,
  start,
  stop,
  persist,
  onDisabled = () => {},
  onRollbackError = () => {},
}) {
  if (enabled) {
    if (isActive()) {
      persist(true);
      return;
    }

    start();
    try {
      persist(true);
    } catch (error) {
      try {
        stop();
      } catch (rollbackError) {
        onRollbackError(rollbackError);
      }
      throw error;
    }
    return;
  }

  const wasActive = isActive();
  if (wasActive) stop();
  try {
    persist(false);
  } catch (error) {
    if (wasActive) {
      try {
        start();
      } catch (rollbackError) {
        onRollbackError(rollbackError);
      }
    }
    throw error;
  }
  onDisabled();
}

module.exports = { transitionClipboardMonitoring };
