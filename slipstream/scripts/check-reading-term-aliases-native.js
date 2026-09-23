'use strict';

// An offscreen renderer regression, not a real-desktop acceptance test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-term-aliases-'));
app.setPath('userData', path.join(work, 'profile'));
app.on('window-all-closed', () => {});
let manager;
setTimeout(() => { console.error('Term alias renderer check timed out'); app.exit(1); }, 15000).unref();
const excerpts = ['We define the maximum mean discrepancy (MMD) as follows.',
  'An empirical estimate of the MMD is obtained.', 'Choose an MMD function class.'];
const quotes = ['maximum mean discrepancy (MMD)', 'MMD', 'MMD function class'];
const js = (window, code) => window.webContents.executeJavaScript(code);
const state = (window) => js(window, 'window.readingPin.act("ready").then(result => result.state)');
async function until(predicate) {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Term alias state did not settle');
}
app.whenReady().then(async () => {
  app.dock?.hide();
  function OffscreenWindow(options) {
    const window = new BrowserWindow({ ...options, show: false });
    window.show = window.showInactive = window.focus = () => {};
    return window;
  }
  const processReadingText = createReadingProcessor(async (...args) => {
    const input = JSON.parse(args[4]);
    if (input.selection) return JSON.stringify({ quote: input.selection, meaning: '原文中所选概念的解释。', note: '' });
    const index = excerpts.indexOf(input.excerpt);
    assert(index >= 0);
    return JSON.stringify({ translation: '这一段的译文。', terms: [{ quote: quotes[index], role: 'core',
      label: index === 2 ? 'MMD 函数类' : index === 0 ? '最大均值差异（MMD）' : '最大均值差异' }] });
  });
  manager = createReadingPins({ BrowserWindow: OffscreenWindow, ipcMain, screen, processReadingText,
    getMainWindow: () => null, captureSupported: false,
    getSettings: () => ({ setupMode: 'full', activeBackend: 'custom', activeModel: 'fixture', customEndpointUrl: 'http://127.0.0.1:11434/v1' }) });
  manager.openText(excerpts.join('\n\n'));
  const window = BrowserWindow.getAllWindows()[0];
  await until(async () => (await state(window)).phase === 'done');
  assert.equal((await state(window)).segments.length, 3);
  assert.deepEqual(await js(window, 'Array.from(document.querySelectorAll(".term-chip"), node => node.getAttribute("aria-label"))'),
    ['解释 最大均值差异（MMD） · maximum mean discrepancy (MMD)', '解释 MMD 函数类 · MMD function class']);
  await js(window, 'document.querySelector(".term-chip").click()');
  await until(async () => (await state(window)).lookupStatus === 'done');
  assert.equal((await state(window)).lookup.quote, quotes[0]);
  const current = await state(window), start = excerpts[1].indexOf('MMD');
  await js(window, `window.readingPin.act('lookup', ${JSON.stringify({ revision: current.revision, segmentId: 1, start, end: start + 3 })})`);
  await until(async () => (await state(window)).lookupStatus === 'done');
  assert.equal((await state(window)).lookup.quote, 'MMD', 'a removed duplicate button must not disable manual lookup at that occurrence');
  assert(BrowserWindow.getAllWindows().every((item) => !item.isVisible()), 'this background check must not display a window');
  console.log('Term alias renderer passed: two distinct buttons, three paragraphs, exact button/manual lookup, no visible windows.');
  manager.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch((error) => { console.error(error); manager?.dispose(); app.exit(1); });
