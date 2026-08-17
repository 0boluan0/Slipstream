'use strict';

const STARTUP_CHECK_DELAY_MS = 30_000;

function safeVersion(value) {
  const version = String(value || '').trim();
  return /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : '';
}

function createAutoUpdateManager({
  updater,
  enabled,
  getMenuItem,
  onInstallFailed,
  onInstallRequested,
  schedule = setTimeout,
  showMessageBox,
}) {
  let started = false;
  let phase = 'idle';
  let version = '';
  let manualCheck = false;
  let dialogOpen = false;

  function setMenu(label, itemEnabled = true) {
    const item = getMenuItem();
    if (!item) return;
    item.label = label;
    item.enabled = itemEnabled;
  }

  function resetMenu() {
    setMenu('检查更新…', enabled);
  }

  async function show(options) {
    if (dialogOpen) return null;
    dialogOpen = true;
    try {
      return await showMessageBox({ noLink: true, ...options });
    } catch {
      return null;
    } finally {
      dialogOpen = false;
    }
  }

  async function promptInstall() {
    const result = await show({
      type: 'info',
      title: '更新已准备好',
      message: version ? `Slipstream ${version} 已准备好安装` : 'Slipstream 更新已准备好安装',
      detail: '重启前会先经过现有的退出确认，未保存内容不会被静默丢弃。',
      buttons: ['重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result?.response === 0) onInstallRequested();
  }

  async function promptDownload() {
    const result = await show({
      type: 'info',
      title: '发现新版本',
      message: version ? `Slipstream ${version} 可以下载` : 'Slipstream 有新版本可以下载',
      detail: '下载期间可以继续使用。安装前 macOS 会验证更新包签名。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result?.response !== 0 || phase !== 'available') return;
    phase = 'downloading';
    setMenu('正在下载更新…', false);
    try {
      await updater.downloadUpdate();
    } catch {
      handleError();
    }
  }

  function handleError() {
    if (phase === 'idle') return;
    if (phase === 'installing') {
      phase = 'idle';
      version = '';
      manualCheck = false;
      resetMenu();
      onInstallFailed();
      return;
    }
    const shouldReport = manualCheck || phase === 'available' || phase === 'downloading';
    phase = 'idle';
    version = '';
    manualCheck = false;
    resetMenu();
    if (shouldReport) {
      void show({
        type: 'error',
        title: '更新没有完成',
        message: '没有完成更新检查或下载',
        detail: '请检查网络连接后，从 Slipstream 菜单重新检查。现有版本可以继续使用。',
        buttons: ['好'],
        defaultId: 0,
      });
    }
  }

  async function beginCheck(isManual) {
    if (!enabled) return false;
    if (phase === 'available') {
      await promptDownload();
      return true;
    }
    if (phase === 'ready') {
      await promptInstall();
      return true;
    }
    if (phase !== 'idle') return false;

    manualCheck = isManual;
    phase = 'checking';
    setMenu('正在检查更新…', false);
    try {
      await updater.checkForUpdates();
      return true;
    } catch {
      handleError();
      return false;
    }
  }

  function start() {
    if (started) return;
    started = true;
    resetMenu();
    if (!enabled) return;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on('update-not-available', () => {
      if (phase !== 'checking') return;
      const shouldReport = manualCheck;
      phase = 'idle';
      manualCheck = false;
      resetMenu();
      if (shouldReport) {
        void show({
          type: 'info',
          title: '没有可用更新',
          message: 'Slipstream 已经是最新版本',
          buttons: ['好'],
          defaultId: 0,
        });
      }
    });
    updater.on('update-available', (info) => {
      if (phase !== 'checking') return;
      version = safeVersion(info?.version);
      manualCheck = false;
      phase = 'available';
      setMenu(version ? `下载 Slipstream ${version}…` : '下载可用更新…');
      void promptDownload();
    });
    updater.on('download-progress', (progress) => {
      if (phase !== 'downloading') return;
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
      setMenu(`正在下载更新… ${percent}%`, false);
    });
    updater.on('update-downloaded', (info) => {
      version = safeVersion(info?.version) || version;
      phase = 'ready';
      manualCheck = false;
      setMenu(version ? `重启以安装 Slipstream ${version}…` : '重启以安装更新…');
      void promptInstall();
    });
    updater.on('error', handleError);

    const timer = schedule(() => { void beginCheck(false); }, STARTUP_CHECK_DELAY_MS);
    timer?.unref?.();
  }

  function installUpdate() {
    if (!enabled || phase !== 'ready') return false;
    phase = 'installing';
    try {
      updater.quitAndInstall();
      return true;
    } catch {
      phase = 'ready';
      return false;
    }
  }

  return Object.freeze({
    start,
    checkForUpdates: () => beginCheck(true),
    installUpdate,
  });
}

module.exports = { createAutoUpdateManager };
