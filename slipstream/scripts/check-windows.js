'use strict';
const assert = require('node:assert/strict');
const { windowsConfig } = require('./build-windows');
const { createReadingPins } = require('../src/main/reading-pins');
const { createSupportDiagnostics } = require('../src/main/support-diagnostics');
const { resolveBuildIdentity, describeBuildIdentity } = require('../src/main/build-identity');
async function check() {
  const config = windowsConfig();
  assert.equal(config.appId, 'com.slipstream.windows-preview');
  assert.equal(config.extraMetadata.main, 'src/main/windows-preview-main.js');
  assert.equal(config.publish, null);
  assert.equal(config.afterPack, null);
  assert.equal(config.afterSign, null);
  assert.deepEqual(config.extraResources, []);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  const identity = resolveBuildIdentity({ isPackaged: true, declaredIdentity: config.extraMetadata.slipstreamBuildIdentity });
  assert.equal(identity, 'windows-preview');
  assert.equal(describeBuildIdentity(identity).isPublicDistribution, false);
  const diagnostics = createSupportDiagnostics({ platform: 'win32', arch: 'x64', buildIdentity: identity });
  assert.equal(diagnostics.system.name, 'Windows');
  assert.equal(diagnostics.system.architectureLabel, 'Intel / AMD（x64）');
  let message;
  const forbidden = () => { throw new Error('Unsupported capture must not touch settings, permissions, windows or OCR'); };
  const manager = createReadingPins({ BrowserWindow: forbidden,
    ipcMain: { handle() {}, removeHandler() {} }, screen: {},
    getSettings: forbidden, getMainWindow: forbidden,
    captureRegion: forbidden, performOCR: forbidden, processReadingText: forbidden,
    requestCapturePermission: forbidden, captureSupported: false,
    onError: value => { message = value; },
  });
  try {
    const result = await manager.capture();
    assert.equal(result.success, false);
    assert.match(message, /复制/);
    assert.equal(result.error, message);
  } finally { manager.dispose(); }
  let openedSettings = 0;
  const windows = createReadingPins({ BrowserWindow: forbidden,
    ipcMain: { handle() {}, removeHandler() {} }, screen: {},
    getSettings: () => ({ setupMode: 'translation-only', activeBackend: 'free_translate' }),
    getMainWindow: forbidden, captureRegion: forbidden, performOCR: forbidden, processReadingText: forbidden,
    requestCapturePermission: forbidden, localOcrSupported: false,
    onOpenSettings: () => { openedSettings += 1; }, onError: value => { message = value; },
  });
  try {
    const result = await windows.capture();
    assert.equal(result.success, false);
    assert.equal(result.error, 'image-reading-required');
    assert.equal(openedSettings, 1);
    assert.match(message, /图片试读/);
  } finally { windows.dispose(); }
  console.log('Windows checks passed: isolated packaging and image setup required before capture; macOS OCR is never invoked.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
