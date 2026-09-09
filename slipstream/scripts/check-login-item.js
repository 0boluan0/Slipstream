const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getOpenAtLoginState,
  initializeOpenAtLogin,
  setOpenAtLogin,
} = require('../src/main/login-item');

function createNativeApp({
  openAtLogin = false,
  status = 'not-registered',
  wasOpenedAtLogin = false,
  onSet = null,
} = {}) {
  const calls = [];
  let state = { openAtLogin, status, wasOpenedAtLogin };
  return {
    calls,
    state: () => ({ ...state }),
    app: {
      getLoginItemSettings() {
        return { ...state };
      },
      setLoginItemSettings(next) {
        calls.push({ ...next });
        state = onSet
          ? onSet({ ...next }, { ...state })
          : {
              ...state,
              openAtLogin: next.openAtLogin,
              status: next.openAtLogin ? 'enabled' : 'not-registered',
            };
      },
    },
  };
}

function createStore(initial = {}) {
  const values = {
    openAtLogin: true,
    openAtLoginInitialized: false,
    ...initial,
  };
  return {
    values,
    getSettings(key) {
      return values[key];
    },
    setSetting(key, value) {
      values[key] = value;
    },
  };
}

{
  const native = createNativeApp({ wasOpenedAtLogin: false });
  const store = createStore();
  const state = initializeOpenAtLogin({ app: native.app, store, supported: true });
  assert.deepEqual(native.calls, [{ openAtLogin: true }]);
  assert.equal(store.values.openAtLogin, true);
  assert.equal(store.values.openAtLoginInitialized, true);
  assert.equal(state.openAtLogin, true);
}

{
  const native = createNativeApp({ openAtLogin: true, status: 'enabled' });
  const store = createStore();
  const state = initializeOpenAtLogin({ app: native.app, store, supported: true });
  assert.deepEqual(native.calls, [], 'an existing enabled login item must not be registered twice');
  assert.equal(state.openAtLogin, true);
  assert.equal(store.values.openAtLoginInitialized, true);
}

{
  const native = createNativeApp({ openAtLogin: true, status: 'requires-approval' });
  const store = createStore();
  const state = initializeOpenAtLogin({ app: native.app, store, supported: true });
  assert.deepEqual(native.calls, [], 'a login item awaiting approval must not be registered twice');
  assert.equal(state.openAtLogin, false);
  assert.equal(store.values.openAtLogin, false);
  assert.equal(store.values.openAtLoginInitialized, true);
}

{
  const native = createNativeApp({ onSet: (_next, state) => state });
  const store = createStore();
  assert.throws(
    () => initializeOpenAtLogin({ app: native.app, store, supported: true }),
    /login-item-update-failed/,
  );
  assert.deepEqual(native.calls, [{ openAtLogin: true }, { openAtLogin: false }]);
  assert.equal(store.values.openAtLoginInitialized, false,
    'a silent native registration failure must remain retryable');
}

{
  const native = createNativeApp({ openAtLogin: false, wasOpenedAtLogin: true });
  const store = createStore({ openAtLogin: true, openAtLoginInitialized: true });
  const state = initializeOpenAtLogin({ app: native.app, store, supported: true });
  assert.deepEqual(native.calls, [], 'an external macOS choice must not be overwritten at startup');
  assert.equal(store.values.openAtLogin, false);
  assert.equal(state.wasOpenedAtLogin, true);
}

{
  const native = createNativeApp({ openAtLogin: false, status: 'not-found' });
  const store = createStore({ openAtLogin: true, openAtLoginInitialized: true });
  assert.throws(
    () => initializeOpenAtLogin({ app: native.app, store, supported: true }),
    /login-item-not-found/,
  );
  assert.deepEqual(native.calls, [], 'a transient native lookup failure must not overwrite intent');
  assert.equal(store.values.openAtLogin, true);
  assert.equal(store.values.openAtLoginInitialized, true);
}

{
  const native = createNativeApp({
    openAtLogin: true,
    status: 'requires-approval',
    wasOpenedAtLogin: false,
  });
  const store = createStore({ openAtLogin: true, openAtLoginInitialized: true });
  const state = initializeOpenAtLogin({ app: native.app, store, supported: true });
  assert.equal(state.openAtLogin, false);
  assert.equal(state.status, 'requires-approval');
  assert.equal(store.values.openAtLogin, false);
  assert.deepEqual(native.calls, [], 'macOS approval state must be reported, not overwritten');
}

{
  const native = createNativeApp({ openAtLogin: true, status: 'enabled' });
  const store = createStore({ openAtLogin: true, openAtLoginInitialized: true });
  const state = setOpenAtLogin({ app: native.app, store, supported: true, openAtLogin: false });
  assert.deepEqual(native.calls, [{ openAtLogin: false }]);
  assert.equal(store.values.openAtLogin, false);
  assert.equal(state.openAtLogin, false);
}

{
  const native = createNativeApp({ openAtLogin: true, status: 'enabled' });
  const store = createStore({ openAtLogin: true, openAtLoginInitialized: true });
  store.setSetting = () => {
    throw new Error('store-failed');
  };
  assert.throws(
    () => setOpenAtLogin({ app: native.app, store, supported: true, openAtLogin: false }),
    /store-failed/,
  );
  assert.deepEqual(native.calls, [{ openAtLogin: false }, { openAtLogin: true }]);
}

{
  const native = createNativeApp({
    openAtLogin: true,
    status: 'requires-approval',
    onSet: (next, state) => ({
      ...state,
      openAtLogin: next.openAtLogin,
      status: next.openAtLogin ? 'requires-approval' : 'not-registered',
    }),
  });
  const store = createStore({ openAtLogin: false, openAtLoginInitialized: true });
  store.setSetting = () => {
    throw new Error('store-failed');
  };
  assert.throws(
    () => setOpenAtLogin({ app: native.app, store, supported: true, openAtLogin: false }),
    /store-failed/,
  );
  assert.deepEqual(native.calls, [{ openAtLogin: false }, { openAtLogin: true }],
    'rollback must retain a login item that was registered but awaiting approval');
  assert.equal(native.state().status, 'requires-approval');
}

{
  const enabled = createNativeApp({ openAtLogin: true, status: 'unknown' });
  const disabled = createNativeApp({ openAtLogin: false, status: 'unknown' });
  assert.equal(setOpenAtLogin({
    app: enabled.app,
    store: createStore({ openAtLoginInitialized: true }),
    supported: true,
    openAtLogin: true,
  }).openAtLogin, true, 'macOS 12 must use the native boolean when status is unavailable');
  assert.equal(setOpenAtLogin({
    app: disabled.app,
    store: createStore({ openAtLogin: false, openAtLoginInitialized: true }),
    supported: true,
    openAtLogin: false,
  }).openAtLogin, false);
}

{
  const native = createNativeApp();
  const store = createStore();
  assert.deepEqual(getOpenAtLoginState({ app: native.app, supported: false }), {
    openAtLogin: false,
    registered: false,
    status: 'unavailable',
    wasOpenedAtLogin: false,
  });
  initializeOpenAtLogin({ app: native.app, store, supported: false });
  assert.deepEqual(native.calls, [], 'development and fixture runs must not register login items');
}

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
const panelSource = fs.readFileSync(
  path.join(__dirname, '../src/renderer/components/SettingsPanel.jsx'),
  'utf8',
);
assert.match(mainSource, /wasOpenedAtLogin[\s\S]*?shouldStartVisible/);
assert.match(mainSource, /key === 'openAtLogin'[\s\S]*?setOpenAtLogin/);
assert.match(panelSource, /登录时启动 Slipstream/);
assert.match(panelSource, /updateSettings\('openAtLogin', event\.target\.checked\)/);
assert.match(panelSource, /aria-label="登录时启动 Slipstream"/);
assert.match(panelSource, /openAtLoginStatus === 'unavailable'[\s\S]*?disabled=\{settingsSaving \|\| settings\.openAtLoginStatus === 'unavailable'\}/);
assert.match(panelSource, /openAtLoginStatus === 'not-found'[\s\S]*?macOS 暂时无法读取登录项/);
assert.match(panelSource, /将“登录时启动”恢复为开启/,
  'full reset must disclose that the default login item will be restored');

console.log('Login item checks passed.');
