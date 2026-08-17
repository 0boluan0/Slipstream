const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createAutoUpdateManager } = require('../src/main/auto-update');

const settle = () => new Promise((resolve) => setImmediate(resolve));

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCount = 0;
    this.downloadCount = 0;
    this.installArguments = null;
  }

  async checkForUpdates() {
    this.checkCount += 1;
  }

  async downloadUpdate() {
    this.downloadCount += 1;
  }

  quitAndInstall(...args) {
    this.installArguments = args;
  }
}

async function main() {
  const updater = new FakeUpdater();
  const menuItem = { enabled: true, label: '' };
  const scheduled = [];
  const dialogs = [];
  const responses = [];
  let installRequestCount = 0;
  const manager = createAutoUpdateManager({
    updater,
    enabled: true,
    getMenuItem: () => menuItem,
    onInstallRequested: () => { installRequestCount += 1; },
    schedule: (callback) => {
      scheduled.push(callback);
      return { unref() {} };
    },
    showMessageBox: async (options) => {
      dialogs.push(options);
      return { response: responses.shift() ?? 1 };
    },
  });

  manager.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(scheduled.length, 1);
  assert.equal(menuItem.label, '检查更新…');

  scheduled[0]();
  await settle();
  assert.equal(updater.checkCount, 1);
  updater.emit('update-not-available');
  await settle();
  assert.equal(dialogs.length, 0, 'automatic current-version checks must stay quiet');

  await manager.checkForUpdates();
  updater.emit('update-not-available');
  await settle();
  assert.match(dialogs.at(-1).message, /已经是最新版本/);

  const secret = 'private-update-url-token';
  await manager.checkForUpdates();
  updater.emit('error', new Error(secret));
  await settle();
  assert.doesNotMatch(JSON.stringify(dialogs.at(-1)), new RegExp(secret));
  assert.match(dialogs.at(-1).message, /没有完成更新检查/);

  responses.push(0);
  await manager.checkForUpdates();
  updater.emit('update-available', { version: '1.0.6' });
  await settle();
  assert.equal(updater.downloadCount, 1);
  updater.emit('download-progress', { percent: 42.7 });
  assert.equal(menuItem.label, '正在下载更新… 43%');
  assert.equal(menuItem.enabled, false);

  responses.push(0);
  updater.emit('update-downloaded', { version: '1.0.6' });
  await settle();
  assert.equal(installRequestCount, 1,
    'restart must request the existing guarded quit path instead of installing directly');
  assert.equal(updater.installArguments, null);
  assert.equal(manager.installUpdate(), true);
  assert.deepEqual(updater.installArguments, []);

  let installFailureCount = 0;
  const failingInstallUpdater = new FakeUpdater();
  const failingInstallManager = createAutoUpdateManager({
    updater: failingInstallUpdater,
    enabled: true,
    getMenuItem: () => ({ enabled: true, label: '' }),
    onInstallRequested() {},
    onInstallFailed: () => { installFailureCount += 1; },
    schedule: () => ({ unref() {} }),
    showMessageBox: async () => ({ response: 1 }),
  });
  failingInstallManager.start();
  await failingInstallManager.checkForUpdates();
  failingInstallUpdater.emit('update-available', { version: '1.0.6' });
  await settle();
  failingInstallUpdater.emit('update-downloaded', { version: '1.0.6' });
  await settle();
  assert.equal(failingInstallManager.installUpdate(), true);
  failingInstallUpdater.emit('error', new Error('native install failed'));
  assert.equal(installFailureCount, 1,
    'an asynchronous native install failure must fall back to the committed quit');

  const rejectedDialogs = [];
  const rejectedDialogUpdater = new FakeUpdater();
  const rejectedDialogManager = createAutoUpdateManager({
    updater: rejectedDialogUpdater,
    enabled: true,
    getMenuItem: () => ({ enabled: true, label: '' }),
    onInstallRequested() {},
    onInstallFailed() {},
    schedule: () => ({ unref() {} }),
    showMessageBox: async () => { throw new Error('dialog-failed'); },
  });
  const onUnhandledRejection = (error) => rejectedDialogs.push(error);
  process.on('unhandledRejection', onUnhandledRejection);
  rejectedDialogManager.start();
  await rejectedDialogManager.checkForUpdates();
  rejectedDialogUpdater.emit('update-available', { version: '1.0.6' });
  await settle();
  await settle();
  process.off('unhandledRejection', onUnhandledRejection);
  assert.deepEqual(rejectedDialogs, [], 'native dialog failures must not become unhandled rejections');

  const disabledUpdater = new FakeUpdater();
  const disabledMenuItem = { enabled: true, label: '' };
  const disabledManager = createAutoUpdateManager({
    updater: disabledUpdater,
    enabled: false,
    getMenuItem: () => disabledMenuItem,
    onInstallRequested() {},
    onInstallFailed() {},
    schedule() { throw new Error('disabled updater must not schedule a check'); },
    async showMessageBox() { throw new Error('disabled updater must not show a dialog'); },
  });
  disabledManager.start();
  assert.equal(disabledMenuItem.enabled, false);
  assert.equal(await disabledManager.checkForUpdates(), false);
  assert.equal(disabledUpdater.checkCount, 0);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
  assert.match(mainSource,
    /id: 'app-check-for-updates',[\s\S]{0,220}?click: requestAppUpdateCheck/,
    'the native macOS menu must expose a discoverable update check');
  assert.match(mainSource,
    /function requestUpdateInstall\(\)[\s\S]{0,180}?updateInstallRequested = true;[\s\S]{0,180}?requestAppQuit\(\)/,
    'restart-to-install must enter the existing guarded quit flow');
  assert.match(mainSource,
    /function performConfirmedQuit[\s\S]{0,900}?updateInstallRequested[\s\S]{0,260}?installUpdate\(\)[\s\S]{0,160}?app\.quit\(\)/,
    'only the committed quit path may hand off to the updater, with normal quit as fallback');
  assert.match(mainSource,
    /function showUpdateMessageBox[\s\S]{0,300}?mainWindow\.isVisible\(\)[\s\S]{0,100}?!mainWindow\.isMinimized\(\)[\s\S]{0,180}?dialog\.showMessageBox\(options\)/,
    'hidden or minimized windows must not own an invisible update sheet');
  assert.match(mainSource,
    /const decision = quitRequestRegistry\.decide[\s\S]{0,220}?decision\.status !== 'confirmed'[\s\S]{0,120}?cancelUpdateInstallRequest\(\)/,
    'invalid quit decisions must clear a pending update-install intent');
  assert.match(mainSource,
    /function resetRendererOwnedWorkAfterCrash[\s\S]{0,900}?quitRequestRegistry\.clearSender\(senderId\);[\s\S]{0,100}?cancelUpdateInstallRequest\(\)/,
    'a renderer crash must clear an uncommitted update-install intent');
  assert.match(mainSource,
    /mainWindow\.on\('closed'[\s\S]{0,900}?quitRequestRegistry\.clearSender\(rendererSenderId\);[\s\S]{0,160}?!app\.isQuitting[\s\S]{0,100}?cancelUpdateInstallRequest\(\)/,
    'a non-quitting window teardown must clear an uncommitted update-install intent');

  console.log('Auto-update checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
