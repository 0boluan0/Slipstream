'use strict';

const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ENTRY = path.join(__dirname, 'capture-overlay', 'index.html');
const ENTRY_URL = pathToFileURL(ENTRY).href;
const CHANNEL = 'capture-overlay:action';
let capturing = false;

function cancelled() { return Object.assign(new Error('Capture cancelled'), { isCancellation: true }); }

function selectionRect(value, bounds, imageSize) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) return null;
  const { x, y, width, height } = value;
  if (x < 0 || y < 0 || width < 8 || height < 8
    || x + width > bounds.width + 1 || y + height > bounds.height + 1) return null;
  const left = Math.round(x * imageSize.width / bounds.width);
  const top = Math.round(y * imageSize.height / bounds.height);
  const right = Math.min(imageSize.width, Math.round((x + width) * imageSize.width / bounds.width));
  const bottom = Math.min(imageSize.height, Math.round((y + height) * imageSize.height / bounds.height));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

async function selectRegion({ signal } = {}) {
  if (signal?.aborted) throw cancelled();
  if (capturing) throw new Error('Capture already in progress');
  capturing = true;
  const windows = new Map();
  let sources;
  let cleanupSelection = () => {};
  try {
    const displays = screen.getAllDisplays();
    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    // Snapshots are used only for local selection. The only returned image is
    // the validated crop; whole displays never enter a provider request/file.
    const thumbnails = desktopCapturer.getSources({ types: ['screen'],
      thumbnailSize: {
        width: Math.min(7680, Math.max(...displays.map(display => Math.ceil(display.bounds.width * display.scaleFactor)))),
        height: Math.min(4320, Math.max(...displays.map(display => Math.ceil(display.bounds.height * display.scaleFactor)))),
      } });
    let snapshotTimer;
    let cancelSnapshot;
    try {
      sources = await Promise.race([thumbnails, new Promise((_, reject) => {
        snapshotTimer = setTimeout(() => reject(Object.assign(new Error('Screen snapshot timed out'), { code: 'capture-timeout' })), 15000);
        cancelSnapshot = () => reject(cancelled());
        signal?.addEventListener('abort', cancelSnapshot, { once: true });
        if (signal?.aborted) cancelSnapshot();
      })]);
    } finally { clearTimeout(snapshotTimer); signal?.removeEventListener('abort', cancelSnapshot); }
    if (signal?.aborted) throw cancelled();
    return await new Promise((resolve, reject) => {
      let settled = false;
      let visible = 0;
      const finish = (error, image) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        ipcMain.removeHandler(CHANNEL);
        for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy();
        windows.clear();
        error ? reject(error) : resolve(image);
      };
      const onAbort = () => finish(cancelled());
      const timer = setTimeout(() => finish(Object.assign(new Error('Capture selection timed out'), { code: 'capture-timeout' })), 120000);
      cleanupSelection = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort); ipcMain.removeHandler(CHANNEL);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      ipcMain.handle(CHANNEL, (event, action, payload) => {
        const item = windows.get(event.sender.id);
        if (!item || event.sender !== item.window.webContents
          || event.senderFrame !== item.window.webContents.mainFrame || event.senderFrame.url !== ENTRY_URL) throw new Error('Untrusted capture frame');
        if (action === 'ready') return { image: item.image.toDataURL() };
        if (action === 'visible') {
          if (item.visible) return true;
          item.visible = true; visible += 1;
          if (visible === windows.size) {
            for (const entry of windows.values()) entry.window.showInactive();
            const focused = [...windows.values()].find(entry => entry.display.id === target.id) || [...windows.values()][0];
            focused.window.show(); focused.window.focus();
          }
          return true;
        }
        if (action === 'cancel') { finish(cancelled()); return true; }
        if (action === 'select') {
          const rect = selectionRect(payload, item.display.bounds, item.image.getSize());
          if (!rect) return false;
          const image = item.image.crop(rect).toPNG();
          finish(null, image); return true;
        }
        return false;
      });
      for (const display of displays) {
        const source = sources.find(item => item.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) { finish(new Error('Screen snapshot unavailable')); return; }
        const window = new BrowserWindow({ ...display.bounds, show: false, frame: false, resizable: false,
          movable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
          backgroundColor: '#152025', alwaysOnTop: true,
          webPreferences: { preload: path.join(__dirname, 'capture-overlay', 'preload.js'),
            nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        const item = { window, display, image: source.thumbnail, visible: false };
        windows.set(window.webContents.id, item);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.webContents.on('will-attach-webview', event => event.preventDefault());
        window.on('closed', () => { if (!settled) finish(cancelled()); });
        window.loadFile(ENTRY).catch(() => finish(new Error('Capture view unavailable')));
      }
      if (!windows.size) finish(new Error('No screen available'));
      if (signal?.aborted) onAbort();
    });
  } finally {
    cleanupSelection();
    for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy();
    windows.clear(); sources = null; capturing = false;
  }
}

module.exports = { selectRegion, selectionRect };
