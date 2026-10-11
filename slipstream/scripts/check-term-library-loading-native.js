'use strict';

// Real manager and renderer, with controlled local list replies; no user cards or API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createTermLibrary } = require('../src/main/term-library');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-library-loading-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const evidenceIndex = process.argv.indexOf('--evidence-dir');
const output = evidenceIndex < 0 ? null : path.resolve(process.argv[evidenceIndex + 1]);
if (output) fs.mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label) {
  for (let i = 0; i < 200; i++) { if (await test()) return; await pause(10); }
  throw new Error(`Timed out: ${label}`);
}
let library;
const checks = [];
const cards = ['short', 'long'].map(id => ({ id, term: `${id} explanation`, label: id,
  meaning: '用于验证异步卡片选择的本地固定内容。', context: '', notes: '',
  source: 'Let $x=1$.', links: [], kind: 'concept', created: '2026-10-11T00:00:00.000Z',
  revision: `revision-${id}` }));
const pending = [];
const edits = [];
const result = { cards, unreadable: 0, directory: work };
const store = { directory: work,
  list: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  edit: async (id, changes) => {
    edits.push({ id, changes });
    return { ...cards.find(card => card.id === id), ...changes, revision: 'saved-revision' };
  },
};
app.whenReady().then(async () => {
  app.dock?.hide();
  function HiddenWindow(options) {
    const window = new BrowserWindow({ ...options, show: false,
      webPreferences: { ...options.webPreferences, backgroundThrottling: false } });
    window.show = window.showInactive = window.focus = () => {};
    return window;
  }
  library = createTermLibrary({ BrowserWindow: HiddenWindow, ipcMain, store,
    shell: { openPath: async () => '', showItemInFolder() {} }, dialog: {} });
  library.open('short');
  const window = BrowserWindow.getAllWindows()[0];
  const js = code => window.webContents.executeJavaScript(code);
  const state = () => js(`({term: document.getElementById('term').textContent,
    notes: document.getElementById('notes').value, message: document.getElementById('message').textContent,
    saveDisabled: document.getElementById('save').disabled,
    editStatus: document.getElementById('edit-status').textContent,
    readMode: document.getElementById('card').classList.contains('read-mode')})`);
  const saved = async () => { const value = await state(); return value.readMode && value.editStatus === '已保存在本地'; };
  const settle = () => js('new Promise(resolve => setTimeout(resolve, 60))');
  const waitPending = length => until(() => pending.length === length, `list ${length}`);
  const select = term => js(`[...document.querySelectorAll('.card-item')].find(node => node.querySelector('strong').textContent === ${JSON.stringify(term)}).click()`);
  await waitPending(1);
  library.open('long');
  await waitPending(2);
  pending[1].resolve(result);
  await until(async () => (await state()).term === 'long explanation', 'newer initial selection');
  pending[0].resolve(result);
  await settle();
  assert.equal((await state()).term, 'long explanation');
  checks.push('late initial load cannot replace the newer external open');

  library.open('long');
  await waitPending(3);
  library.open('short');
  await waitPending(4);
  pending[3].resolve(result);
  await until(async () => (await state()).term === 'short explanation', 'latest external selection');
  pending[2].resolve(result);
  await settle();
  assert.equal((await state()).term, 'short explanation');
  checks.push('out-of-order external opens keep the latest card');

  await js('document.getElementById("refresh").click()');
  await waitPending(5);
  await select('long explanation');
  pending[4].resolve(result);
  await settle();
  assert.equal((await state()).term, 'long explanation');
  checks.push('local card selection supersedes a pending refresh');

  await js('document.getElementById("refresh").click()');
  await waitPending(6);
  await js(`document.getElementById('edit').click(); document.getElementById('notes').value = '新的本地笔记';
    document.getElementById('notes').dispatchEvent(new Event('input')); document.getElementById('save').click();`);
  await until(saved, 'saved local edits');
  pending[5].resolve(result);
  await settle();
  assert.equal((await state()).notes, '新的本地笔记');
  checks.push('editing and saving invalidate an older list snapshot after dirty clears');

  await js('document.getElementById("refresh").click()');
  await waitPending(7);
  await js(`document.getElementById('edit').click(); document.getElementById('notes').value = '尚未保存的笔记';
    document.getElementById('notes').dispatchEvent(new Event('input'));`);
  pending[6].resolve(result);
  await settle();
  assert.equal((await state()).notes, '尚未保存的笔记');
  assert.equal((await state()).saveDisabled, false);
  checks.push('pending refresh preserves unsaved input');
  await js('document.getElementById("save").click()');
  await until(saved, 'save before error checks');

  library.open('long');
  await waitPending(8);
  await select('short explanation');
  pending[7].reject(new Error('controlled stale disk failure'));
  await settle();
  assert.equal((await state()).message, '');
  assert.equal((await state()).term, 'short explanation');
  checks.push('late list errors cannot override the newer local selection');
  await js('document.getElementById("refresh").click()');
  await waitPending(9);
  pending[8].reject(new Error('controlled current disk failure'));
  await until(async () => (await state()).message.includes('卡片操作没有完成'), 'current list error');
  checks.push('current list failure remains visible');

  await js(`document.getElementById('edit').click(); document.getElementById('notes').value = '应放弃的笔记';
    document.getElementById('notes').dispatchEvent(new Event('input'));
    document.getElementById('refresh').click(); document.getElementById('discard').click();`);
  await waitPending(10);
  const beforeDiscardSave = edits.length;
  assert.equal((await state()).saveDisabled, true);
  await js('document.getElementById("save").click()');
  await settle();
  assert.equal(edits.length, beforeDiscardSave, 'discarded input must not be written while reload waits');
  await js(`document.getElementById('notes').value = '放弃后重新输入的笔记';
    document.getElementById('notes').dispatchEvent(new Event('input')); document.getElementById('save').click();`);
  await until(saved, 'new input after discard remains saveable');
  assert.equal(edits.length, beforeDiscardSave + 1);
  assert.equal(edits.at(-1).changes.notes, '放弃后重新输入的笔记');
  pending[9].resolve(result);
  await settle();
  assert.equal((await state()).notes, '放弃后重新输入的笔记');
  checks.push('discard prevents writes of abandoned input while new input remains saveable');
  assert(BrowserWindow.getAllWindows().every(item => !item.isVisible()));
  if (output) {
    fs.writeFileSync(path.join(output, 'loading.json'), JSON.stringify({ checks, state: await state(), apiCalls: 0 }, null, 2));
    fs.writeFileSync(path.join(output, 'loading.png'), (await window.webContents.capturePage()).toPNG());
  }
  console.log(`Term library loading passed: ${checks.join('; ')}. No visible windows, user cards or API.`);
  library.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch(error => { console.error(error); library?.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(1); });
setTimeout(() => { console.error('Term library loading test timed out'); library?.dispose(); app.exit(1); }, 15000).unref();
