'use strict';

const { mathAssetUrls } = require('./reading-math-assets');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createTermLibrary({ BrowserWindow, ipcMain, shell, dialog, store }) {
  const directory = path.join(__dirname, 'term-library');
  const entry = path.join(directory, 'index.html');
  const entryUrl = pathToFileURL(entry).href;
  let window = null;
  let selectedId = null;
  function open(id = null) {
    selectedId = id;
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      window.webContents.send('term-library:refresh', selectedId);
      return;
    }
    window = new BrowserWindow({ width: 1000, height: 730, minWidth: 640, minHeight: 420,
      title: 'Slipstream · 术语卡片盒', backgroundColor: '#fbfcf9', show: false,
      webPreferences: { preload: path.join(directory, 'preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, partition: 'term-library', spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', message: '卡片还有未保存的修改。',
        buttons: ['继续编辑', '放弃修改并关闭'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice === 1) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const allowed = ['index.html', 'style.css', 'view.js'].map((file) => pathToFileURL(path.join(directory, file)).href);
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.includes(details.url) && !mathAssetUrls.includes(details.url) }));
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = null; });
    void window.loadFile(entry);
  }
  ipcMain.handle('term-library:action', async (event, action, payload) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== entryUrl) throw new Error('Untrusted term library');
    try {
      if (action === 'list') return { ...await store.list(), selectedId };
      if (action === 'edit') {
        const card = await store.edit(payload?.id, payload?.changes, payload?.revision);
        return { card };
      }
      if (action === 'open-folder') {
        if (await shell.openPath(store.directory)) throw new Error('card-open-failed');
        return { success: true };
      }
      if (action === 'open-file') {
        if (await shell.openPath(await store.filePath(payload?.id))) throw new Error('card-open-failed');
        return { success: true };
      }
      if (action === 'reveal-file') { shell.showItemInFolder(await store.filePath(payload?.id)); return { success: true }; }
      throw new Error('Unsupported term library action');
    } catch (error) {
      return { error: error.message === 'card-conflict'
        ? '这张卡片已在别处修改。你的输入仍保留在这里；重新载入后再决定如何合并。'
        : '卡片操作没有完成。请检查本地文件夹后重试。' };
    }
  });
  return { open, dispose() { window?.destroy(); window = null; ipcMain.removeHandler('term-library:action'); } };
}
module.exports = { createTermLibrary };
