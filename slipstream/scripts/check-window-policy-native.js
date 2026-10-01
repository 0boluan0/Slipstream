'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { app, BrowserWindow, nativeTheme, screen } = require('electron');
const { DEFAULTS } = require('../src/shared/constants');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-window-policy-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const source = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing main-process seam: ${start}`);
  return source.slice(from, to);
}
const windows = [];
const failures = [];
function cleanup() {
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  fs.rmSync(work, { recursive: true, force: true });
}
function check(label, action) {
  try { action(); console.log(`ok - ${label}`); }
  catch (error) { failures.push(`${label}: ${error.message}`); }
}

app.whenReady().then(() => {
  // Execute the production constructor path up to the actual native window.
  // Stop there to avoid tray, clipboard, OCR, or user-data startup effects.
  const stopped = new Error('constructor-captured');
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const setupMode of ['unconfigured', 'full']) {
      let options;
      let window;
      const context = vm.createContext({
        store: { isStoreReady: () => true }, screen, nativeTheme, process, path, DEFAULTS,
        __dirname: path.join(__dirname, '../src/main'),
        uiFixtureMode: { enabled: false }, uiFixtureCheckMode: false,
        BrowserWindow: function captureOptions(value) {
          options = value;
          window = new BrowserWindow({ ...value, show: false,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
          windows.push(window);
          throw stopped;
        },
      });
      vm.runInContext(between('function createMainWindow(', '\nfunction clampBoundsToWorkArea('), context);
      try { context.createMainWindow({ setupMode }); }
      catch (error) { if (error !== stopped) throw error; }
      check(`${theme} ${setupMode} home stays at normal window level`, () => assert.equal(window.isAlwaysOnTop(), false));
      check(`${theme} ${setupMode} home cannot blend source text through its background`, () => {
        assert.equal(options.transparent, false);
        assert.equal(options.vibrancy, undefined);
        assert.match(window.getBackgroundColor(), /^#(?:ff)?[\da-f]{6}$/i);
      });
      const lifecycle = vm.createContext({
        mainWindow: window, currentWindowMode: 'setup', captureWindowBounds: null,
        screen, DEFAULTS, tray: null, console, showMainWindow() {},
      });
      vm.runInContext(between('function clampBoundsToWorkArea(', '\nasync function hideWindowForCapture('), lifecycle);
      vm.runInContext(between('function getRecoveredCaptureBounds(', '\nfunction applyRecoveredSettings('), lifecycle);
      check(`${theme} returning from setup to home does not pin the window`, () => {
        lifecycle.setWindowMode('capture');
        assert.equal(window.isAlwaysOnTop(), false);
      });
      check(`${theme} storage recovery does not pin the home`, () => {
        lifecycle.promoteRecoveredWindow({ setupMode: 'full' });
        assert.equal(window.isAlwaysOnTop(), false);
      });
      window.destroy();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Native window policy passed: production constructor, theme backgrounds, mode transition and recovery. No user data or live provider used.');
  cleanup();
  app.exit(0);
}).catch((error) => { console.error(error); cleanup(); app.exit(1); });
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Window policy test timed out'); cleanup(); app.exit(1); }, 30000).unref();
