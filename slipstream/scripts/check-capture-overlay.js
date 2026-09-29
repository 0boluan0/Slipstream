'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const main = path.join(__dirname, '../src/main');
const entry = require('node:url').pathToFileURL(path.join(main, 'capture-overlay/index.html')).href;
const bounds = { x: -1440, y: 0, width: 1440, height: 900 };
let handlers, windows, snapshots, loadFailure;
const image = { isEmpty: () => false, getSize: () => ({ width: 2880, height: 1800 }), toDataURL: () => 'data:image/png;base64,fixture',
  crop: rect => ({ toPNG: () => Buffer.from(JSON.stringify(rect)) }) };
class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.destroyed = false;
    this.webContents = new EventEmitter(); this.webContents.id = windows.length + 1;
    this.webContents.mainFrame = { url: entry }; this.webContents.setWindowOpenHandler = () => {};
    windows.push(this);
  }
  loadFile() { return loadFailure ? Promise.reject(new Error('load failed')) : Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit('closed'); }
  isDestroyed() { return this.destroyed; }
  setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} showInactive() {} show() {} focus() {}
}
function load() {
  handlers = new Map(); windows = []; snapshots = Promise.resolve([{ display_id: '1', thumbnail: image }]); loadFailure = false;
  const fake = { BrowserWindow: Window, desktopCapturer: { getSources: () => snapshots },
    ipcMain: { handle: (key, handler) => handlers.set(key, handler), removeHandler: key => handlers.delete(key) },
    screen: { getAllDisplays: () => [{ id: 1, scaleFactor: 2, bounds }], getDisplayNearestPoint: () => ({ id: 1 }), getCursorScreenPoint: () => ({ x: -100, y: 50 }) } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(main, 'capture-overlay.js'), 'utf8'), {
    module, exports: module.exports, __dirname: main, require: name => name === 'electron' ? fake : require(name),
    Buffer, setTimeout, clearTimeout,
  });
  return module.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function run() {
  let api = load();
  assert.deepEqual(JSON.parse(JSON.stringify(api.selectionRect({ x: 10, y: 20, width: 100, height: 60 }, bounds, image.getSize()))), { x: 20, y: 40, width: 200, height: 120 });
  for (const rect of [{ x: -1, y: 2, width: 30, height: 30 }, { x: 1, y: 2, width: 7, height: 50 }, { x: 1400, y: 2, width: 80, height: 50 }, { x: NaN, y: 2, width: 30, height: 30 }]) assert.equal(api.selectionRect(rect, bounds, image.getSize()), null);
  const selected = api.selectRegion(); await tick();
  const handler = handlers.get('capture-overlay:action'), window = windows[0];
  assert.equal(window.options.webPreferences.sandbox, true); assert.equal(window.options.webPreferences.nodeIntegration, false);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.throws(() => handler({ ...event, senderFrame: { url: entry } }, 'select', {}), /Untrusted/u);
  assert.equal(handler(event, 'select', { x: -10, y: 20, width: 100, height: 50 }), false);
  handler(event, 'select', { x: 10, y: 20, width: 100, height: 60 });
  assert.deepEqual(JSON.parse((await selected).toString()), { x: 20, y: 40, width: 200, height: 120 });
  assert.equal(handlers.size, 0); assert.equal(window.isDestroyed(), true);
  api = load(); snapshots = new Promise(() => {});
  const controller = new AbortController(), waiting = api.selectRegion({ signal: controller.signal }); controller.abort();
  await assert.rejects(waiting, error => error.isCancellation === true);
  snapshots = Promise.resolve([{ display_id: '1', thumbnail: image }]);
  const next = api.selectRegion(); await tick();
  handlers.get('capture-overlay:action')({ sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }, 'cancel');
  await assert.rejects(next, error => error.isCancellation === true); assert.equal(handlers.size, 0);
  api = load(); loadFailure = true;
  await assert.rejects(api.selectRegion(), /view unavailable/u); assert.equal(handlers.size, 0);
  console.log('capture crop scaling, sender trust, cancellation and cleanup checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
