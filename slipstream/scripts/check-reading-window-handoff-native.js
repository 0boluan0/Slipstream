'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createTermLibrary } = require('../src/main/term-library');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-window-handoff-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out: ${label}`);
}
const act = (window, action) => window.webContents.executeJavaScript(`window.readingPin.act(${JSON.stringify(action)})`);
const state = async (window) => (await act(window, 'ready')).state;
const findWindow = (title) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === title);
let manager;
let library;
function cleanup() {
  manager?.dispose(); library?.dispose();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  fs.rmSync(work, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  library = createTermLibrary({ BrowserWindow, ipcMain, shell: {}, dialog: {},
    store: createTermCardStore(path.join(work, 'cards')) });
  const settingsWindow = new BrowserWindow({ width: 640, height: 600, show: false });
  await settingsWindow.loadURL('data:text/html,<title>Settings fixture</title><p>Settings fixture</p>');
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture',
      customEndpointUrl: 'http://127.0.0.1:11434/v1' }),
    getMainWindow: () => null, referenceStore: createReadingReferenceStore(path.join(work, 'references')),
    processReadingText: createReadingProcessor(async () => JSON.stringify({
      translation: '三角形有三条边。', terms: [], references: [],
    })),
    onOpenLibrary: () => library.open(),
    onOpenSettings: () => { settingsWindow.show(); settingsWindow.focus(); },
    captureSupported: false,
  });
  assert(manager.openText('A triangle has three sides.').success);
  const reader = findWindow('Slipstream · 阅读卡片');
  await until(async () => (await state(reader)).phase === 'done', 'reader fixture');
  const overlap = { x: 100, y: 100, width: 640, height: 600 };
  reader.setBounds(overlap);
  for (const [action, getUtility] of [
    ['library', () => findWindow('Slipstream · 术语卡片盒')],
    ['settings', () => settingsWindow],
    ['reference-open', () => findWindow('Slipstream · 本文速查')],
  ]) {
    reader.show(); reader.focus();
    await until(() => reader.isFocused(), 'reader focused before handoff');
    assert.equal(reader.isAlwaysOnTop(), true);
    await act(reader, action);
    await until(() => getUtility()?.isVisible(), `${action} shown`);
    const utility = getUtility();
    utility.setBounds(overlap);
    await until(() => utility.isFocused(), `${action} focused`);
    assert.equal(reader.isAlwaysOnTop(), false, `${action}: overlapping reader yields to the opened utility`);
    assert.equal((await state(reader)).topmost, true, `${action}: explicit pin preference is retained`);
    reader.focus();
    await until(() => reader.isFocused() && reader.isAlwaysOnTop(), `${action}: return restores pin preference`);
    console.log(`ok - ${action}: native overlapping utility gets focus, reader yields and refocus restores its pin`);
  }
  await act(reader, 'toggle-top');
  assert.equal(reader.isAlwaysOnTop(), false);
  await act(reader, 'library');
  await until(() => findWindow('Slipstream · 术语卡片盒').isFocused(), 'library focused for unpinned reader');
  reader.focus();
  await until(() => reader.isFocused(), 'unpinned reader refocused');
  assert.equal(reader.isAlwaysOnTop(), false, 'a deliberately unpinned reader stays unpinned after handoff');
  assert.equal((await state(reader)).topmost, false);
  console.log('Native utility handoff passed with overlapping windows and preserved reader pin preference. No live service or user profile used.');
  cleanup(); app.exit(0);
}).catch((error) => { console.error(error); cleanup(); app.exit(1); });
setTimeout(() => { console.error('Window handoff test timed out'); cleanup(); app.exit(1); }, 40000).unref();
