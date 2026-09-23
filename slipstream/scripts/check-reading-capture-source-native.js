'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { captureSource } = require('../src/main/reading-capture-source');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-source-scope-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Capture source scope check timed out.'); app.exit(1); }, 60000).unref();
const store = createReadingReferenceStore(path.join(work, 'references'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7MY4AAAAASUVORK5CYII=', 'base64');
let manager;
let frontWindow;
let captureNumber = 0;
const cards = () => BrowserWindow.getAllWindows().filter((window) => window.getTitle() === 'Slipstream · 阅读卡片');
const state = (window) => window.webContents.executeJavaScript('window.readingPin.act("ready").then(r => r.state)');
const act = (window, action, payload) => window.webContents.executeJavaScript(
  `window.readingPin.act(${JSON.stringify(action)}, ${JSON.stringify(payload)})`);
async function capture() {
  const before = new Set(cards());
  assert((await manager.capture()).pinned);
  const card = cards().find((window) => !before.has(window));
  assert(card);
  await card.webContents.executeJavaScript('document.fonts.ready');
  return card;
}

app.whenReady().then(async () => {
  const calibration = await store.create('Calibration');
  frontWindow = { bundleId: 'com.apple.Preview', title: 'simclr.pdf' };
  manager = createReadingPins({ BrowserWindow, ipcMain, screen, referenceStore: store,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' }),
    getMainWindow: () => null, getCaptureWindow: async () => frontWindow,
    requestCapturePermission: async () => ({ granted: true }),
    captureRegion: async () => {
      const file = path.join(work, `${++captureNumber}.png`);
      fs.writeFileSync(file, png);
      return file;
    },
    performOCR: async () => ({ text: 'We compare representations.', confidence: 0.3,
      blocks: [{ text: 'We compare representations.', confidence: 0.3,
        boundingBox: { x: 0.1, y: 0.4, w: 0.7, h: 0.1 } }] }),
    processReadingText: async () => ({ translation: '我们比较表征。', terms: [], references: [] }),
    onError: (message) => { throw new Error(message); },
  });
  const first = await capture();
  assert.equal((await state(first)).paperId, null, 'first SimCLR capture cannot inherit Calibration');
  assert.match((await state(first)).references.notice, /新文档/);
  await act(first, 'paper-create', { title: 'SimCLR' });
  const simclr = (await state(first)).paperId;
  assert(simclr && simclr !== calibration.id);
  assert.equal((await store.read()).papers.find((paper) => paper.id === simclr).sourceKey, captureSource(frontWindow).key);

  const second = await capture();
  assert.equal((await state(second)).paperId, simclr, 'the same PDF recovers its paper');
  frontWindow = { bundleId: 'com.apple.Preview', title: 'calibration.pdf' };
  const third = await capture();
  assert.equal((await state(third)).paperId, null, 'another PDF must start temporary');
  await act(third, 'paper-select', { paperId: calibration.id });
  assert.equal((await state(third)).paperId, calibration.id);
  const fourth = await capture();
  assert.equal((await state(fourth)).paperId, calibration.id, 'selecting an existing paper binds the PDF');
  frontWindow = { bundleId: 'com.apple.Preview', title: 'simclr.pdf' };
  const fifth = await capture();
  assert.equal((await state(fifth)).paperId, simclr, 'returning to the first PDF restores its own paper');
  frontWindow = null;
  const sixth = await capture();
  assert.equal((await state(sixth)).paperId, null, 'an unknown window cannot borrow the last paper');
  assert.equal((await state(second)).paperId, simclr, 'existing cards retain their original paper');
  console.log('Native capture source scope passed: new and unknown windows temporary, bind on choice, same PDF reuse, cross-PDF isolation.');
  manager.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(error);
  manager?.dispose();
  app.exit(1);
});
