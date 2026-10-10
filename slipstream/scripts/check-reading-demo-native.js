'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const { DEFAULTS } = require('../src/shared/constants.cjs');
const { createUiFixtureRuntime } = require('./ui-fixture-main');
const { parseArguments } = require('./run-ui-fixture');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-demo-check-'));
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await pause(30); }
  throw new Error(`Timed out: ${label}`);
}
let server;
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: path.join(__dirname, '../vite.config.js'),
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  assert.equal(parseArguments([]).fixturePath, '/?demo=reading');
  const rendererUrl = `http://127.0.0.1:${server.httpServer.address().port}${parseArguments([]).fixturePath}`;
  const main = new BrowserWindow({ width: 580, height: 820, show: false,
    webPreferences: { preload: path.join(__dirname, 'ui-fixture-preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false } });
  createUiFixtureRuntime({ DEFAULTS, app, globalShortcut, ipcMain, applicationMenuHasUnsafeDeveloperActions: () => false,
    uiFixtureMode: { enabled: true, rendererUrl, userDataPath: directory }, uiFixtureCheckMode: false,
    getMainWindow: () => main, getTray: () => null }).attachToWindow(main);
  await main.loadURL(rendererUrl);
  const js = code => main.webContents.executeJavaScript(code);
  await until(() => js('document.querySelector(".reading-start")'), 'modern reading home');
  assert.equal(await js('document.querySelector("h1").textContent'), '卡住哪一块，就划哪一块');
  assert.match(await js('document.body.innerText'), /固定回复演示，不连接模型/u);
  assert.doesNotMatch(await js('document.body.innerText'), /eVisa|提交护照|官方核验/u);
  await js('[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="载入数学试读").click()');
  const source = await js('document.querySelector("textarea").value');
  assert.match(source, /nonzero vector/u); assert.match(source, /Av = \\lambda v/u);
  await js('[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="开始阅读").click()');
  const pin = await until(() => BrowserWindow.getAllWindows().find(w => w !== main && w.webContents.getURL().includes('reading-pin/index.html')), 'real reading card');
  const state = () => pin.webContents.executeJavaScript('window.readingPin.act("ready").then(x=>x.state)');
  await until(async () => (await state())?.phase === 'done', 'fixed translation');
  assert.equal((await state()).sourceText, source);
  assert.match((await state()).translation, /非零向量/u);
  assert.match(await pin.webContents.executeJavaScript('document.body.innerText'), /固定回复演示/u);
  await until(() => pin.webContents.executeJavaScript('document.querySelectorAll(".katex").length > 0'), 'rendered mathematics');
  await pin.webContents.executeJavaScript('document.querySelector("button[data-quote=eigenvector]").click()');
  await until(async () => (await state())?.lookupStatus === 'done', 'contextual lookup');
  assert.match((await state()).lookup.meaning, /非零向量/u);
  assert.equal(Object.keys(require.cache).some(file => file.endsWith('/main/llm-service.js')), false,
    'the fixed preview must not load the live provider');
  await pin.webContents.executeJavaScript('document.getElementById("close").click()');
  await until(() => pin.isDestroyed(), 'close reading card');
  main.destroy(); await server.close();
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('Reading demo passed: default modern home, fixed replies, real card, rendered mathematics, lookup and close; no live provider.');
  app.exit(0);
}).catch(async error => {
  console.error(error); await server?.close(); fs.rmSync(directory, { recursive: true, force: true }); app.exit(1);
});
