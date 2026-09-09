'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createTermLibrary } = require('../src/main/term-library');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-library-check-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const store = createTermCardStore(path.join(work, 'cards'));
const preview = process.argv.includes('--preview');
const screenshotIndex = process.argv.indexOf('--screenshot');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
let library;
app.whenReady().then(async () => {
  const first = await store.save({ term: 'conditional expectation', label: '条件期望', meaning: '在已经知道一部分信息的条件下，随机变量的平均值。这里的“条件”决定了哪些情况需要被纳入平均。', context: '这段把观测数据作为已知信息，说明估计结果依赖于我们已经观察到的内容。', source: 'The conditional expectation is defined with respect to the observed data.', kind: 'concept' });
  const second = await store.save({ term: 'random variable', label: '随机变量', meaning: '把随机结果对应到一个数值的规则。', context: '原文区分随机变量和它实际观测到的取值。', source: 'A random variable is distinct from its observed realization.', kind: 'concept' });
  library = createTermLibrary({ BrowserWindow, ipcMain, shell, dialog, store });
  library.open(first.card.id);
  const window = BrowserWindow.getAllWindows()[0];
  const js = (code) => window.webContents.executeJavaScript(code);
  await until(async () => (await js('document.getElementById("term")?.textContent')) === 'conditional expectation', 'saved concept rendered');
  assert.equal(await js('typeof require'), 'undefined');
  assert(await js('fetch("https://example.com").then(()=>false,()=>true)'));
  await js('document.getElementById("edit").click();document.getElementById("notes").value="给定信息后重新计算平均，不能只记中文译名。";document.getElementById("notes").dispatchEvent(new Event("input"))');
  await js(`document.getElementById("connect").value=${JSON.stringify(second.card.id)};document.getElementById("add-link").click();document.getElementById("save").click()`);
  await until(async () => (await store.list()).cards.find((card) => card.id === first.card.id).notes.includes('不能只记'), 'personal note saved');
  await until(async () => await js('document.getElementById("save").disabled'), 'write completed');
  const saved = (await store.list()).cards.find((card) => card.id === first.card.id);
  assert.deepEqual(saved.links, [second.card.id]);
  assert.match(fs.readFileSync(await store.filePath(first.card.id), 'utf8'), /## 关联卡片/);
  await js('document.getElementById("search").value="random variable";document.getElementById("search").dispatchEvent(new Event("input"))');
  assert.equal(await js('document.querySelectorAll(".card-item").length'), 1);
  await js('document.querySelector(".card-item").click()');
  assert.match(await js('document.getElementById("connections").textContent'), /conditional expectation/);
  await js('document.getElementById("search").value="";document.getElementById("search").dispatchEvent(new Event("input"))');
  library.open(first.card.id);
  await until(async () => (await js('document.getElementById("term").textContent')) === 'conditional expectation', 'open existing card');
  if (screenshotIndex >= 0) {
    await pause(150);
    fs.writeFileSync(path.resolve(process.argv[screenshotIndex + 1]), (await window.webContents.capturePage()).toPNG());
  }
  console.log('Term library passed: persisted concepts, local search, personal-note editing, Markdown links, backlinks and sandboxed native UI.');
  if (preview) return;
  await js('document.getElementById("edit").click();document.getElementById("notes").value="尚未保存的输入";document.getElementById("notes").dispatchEvent(new Event("input"))');
  const externalFile = await store.filePath(first.card.id);
  fs.writeFileSync(externalFile, fs.readFileSync(externalFile, 'utf8').replace('不能只记中文译名', '外部编辑留下的内容'));
  await js('document.getElementById("save").click()');
  await until(async () => (await js('document.getElementById("message").textContent')).includes('别处修改'), 'external-edit conflict message');
  assert.equal(await js('document.getElementById("notes").value'), '尚未保存的输入');
  await js('document.getElementById("discard").click()');
  await until(async () => (await js('document.getElementById("notes-reading").textContent')).includes('外部编辑留下的内容'), 'explicit conflict recovery');
  library.dispose();
  const restored = (await createTermCardStore(store.directory).list()).cards;
  assert.equal(restored.length, 2);
  assert(restored.some((card) => card.notes.includes('外部编辑留下的内容')));
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => { console.error(error); library?.dispose(); app.exit(1); });
app.on('window-all-closed', () => {});
if (!preview) setTimeout(() => { console.error('Library test timed out'); app.exit(1); }, 45000).unref();
