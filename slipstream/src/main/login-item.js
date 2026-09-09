const LOGIN_ITEM_STATUSES = new Set([
  'not-registered',
  'enabled',
  'requires-approval',
  'not-found',
]);

function unavailableState() {
  return {
    openAtLogin: false,
    registered: false,
    status: 'unavailable',
    wasOpenedAtLogin: false,
  };
}

function getOpenAtLoginState({ app, supported }) {
  if (!supported) return unavailableState();
  try {
    const state = app.getLoginItemSettings();
    const status = LOGIN_ITEM_STATUSES.has(state.status) ? state.status : 'unknown';
    const registered = state.openAtLogin === true
      || status === 'enabled'
      || status === 'requires-approval';
    return {
      openAtLogin: registered && status !== 'requires-approval',
      registered,
      status,
      wasOpenedAtLogin: state.wasOpenedAtLogin === true,
    };
  } catch {
    return unavailableState();
  }
}

function transitionSucceeded(state, requested) {
  if (state.status === 'unavailable' || state.status === 'not-found') return false;
  return requested ? state.registered : !state.registered;
}

function persistState(store, state) {
  store.setSetting('openAtLogin', state.openAtLogin);
  store.setSetting('openAtLoginInitialized', true);
}

function restoreState(store, app, previous) {
  try {
    store.setSetting('openAtLogin', previous.stored);
    store.setSetting('openAtLoginInitialized', previous.initialized);
  } catch {
    // The original persistence error remains authoritative.
  }
  try {
    app.setLoginItemSettings({ openAtLogin: previous.native.registered });
  } catch {
    // Best-effort rollback keeps the original failure visible.
  }
}

function applyOpenAtLogin({ app, store, supported, openAtLogin }) {
  const previous = {
    initialized: store.getSettings('openAtLoginInitialized') === true,
    native: getOpenAtLoginState({ app, supported }),
    stored: store.getSettings('openAtLogin'),
  };
  if (previous.native.status === 'unavailable') throw new Error('login-item-unavailable');

  try {
    app.setLoginItemSettings({ openAtLogin });
    const current = getOpenAtLoginState({ app, supported });
    if (!transitionSucceeded(current, openAtLogin)) throw new Error('login-item-update-failed');
    persistState(store, current);
    return current;
  } catch (error) {
    restoreState(store, app, previous);
    throw error;
  }
}

function initializeOpenAtLogin({ app, store, supported }) {
  if (!supported) return unavailableState();
  const native = getOpenAtLoginState({ app, supported });
  if (native.status === 'unavailable') throw new Error('login-item-unavailable');
  if (native.status === 'not-found') throw new Error('login-item-not-found');
  const initialized = store.getSettings('openAtLoginInitialized') === true;
  const requested = store.getSettings('openAtLogin') !== false;

  if (
    initialized
    || native.registered
    || (!requested && transitionSucceeded(native, false))
  ) {
    persistState(store, native);
    return native;
  }
  return applyOpenAtLogin({ app, store, supported, openAtLogin: requested });
}

function setOpenAtLogin({ app, store, supported, openAtLogin }) {
  if (typeof openAtLogin !== 'boolean') throw new TypeError('openAtLogin must be boolean');
  if (!supported) throw new Error('login-item-unavailable');

  const current = getOpenAtLoginState({ app, supported });
  if (current.status === 'unavailable') throw new Error('login-item-unavailable');
  if (transitionSucceeded(current, openAtLogin)) {
    persistState(store, current);
    return current;
  }
  return applyOpenAtLogin({ app, store, supported, openAtLogin });
}

module.exports = {
  getOpenAtLoginState,
  initializeOpenAtLogin,
  setOpenAtLogin,
};
