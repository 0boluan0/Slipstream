'use strict';

// Real Electron layout and local card storage; no user cards or provider requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createTermLibrary } = require('../src/main/term-library');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-library-layout-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let library;
const failures = [];
const evidence = [];
const contrastEvidence = [];
const evidenceIndex = process.argv.indexOf('--evidence-dir');
const evidenceDirectory = evidenceIndex < 0 ? null : path.resolve(process.argv[evidenceIndex + 1]);
if (evidenceDirectory) fs.mkdirSync(evidenceDirectory, { recursive: true });
const sizes = [[1000, 730, 1], [640, 420, 1], [1000, 730, 2], [640, 420, 2]];
setTimeout(() => { console.error('Library layout test timed out'); app.exit(1); }, 45000).unref();
async function until(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await pause(20);
  }
  throw new Error(`Timed out: ${label}`);
}

app.whenReady().then(async () => {
  app.dock?.hide();
  function HiddenWindow(options) {
    const window = new BrowserWindow({ ...options, show: false,
      webPreferences: { ...options.webPreferences, backgroundThrottling: false } });
    window.show = window.showInactive = window.focus = () => {};
    return window;
  }
  const store = createTermCardStore(path.join(work, 'cards'));
  library = createTermLibrary({ BrowserWindow: HiddenWindow, ipcMain, store,
    shell: { openPath: async () => '', showItemInFolder() {} }, dialog: {} });
  library.open();
  const window = BrowserWindow.getAllWindows()[0];
  const js = (code) => window.webContents.executeJavaScript(code);
  await until(() => js('Boolean(document.querySelector("#empty:not([hidden])"))'), 'empty library');

  async function inspect(label) {
    const dimensions = await js(`(() => {
      const main = document.querySelector('main');
      const article = document.getElementById('card');
      const content = article.hidden ? document.getElementById('empty') : article;
      const workspace = document.querySelector('.workspace');
      const scroller = getComputedStyle(main).overflowY === 'visible' ? workspace : main;
      scroller.scrollTop = scroller.scrollHeight;
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      const box = scroller.getBoundingClientRect(), end = content.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, rootHeight: document.scrollingElement.scrollHeight,
        rootWidth: document.scrollingElement.scrollWidth, rootScrollTop: document.scrollingElement.scrollTop,
        mainHeight: main.clientHeight,
        mainScrollHeight: scroller.scrollHeight, mainScrollTop: scroller.scrollTop,
        scrollViewportHeight: scroller.clientHeight,
        trailingBlank: box.bottom - end.bottom, contentBottom: end.bottom,
        mainBottom: box.bottom, mainTop: box.top,
        contentHeight: end.height, sourceMath: document.querySelectorAll('#source .katex').length,
        empty: article.hidden };
    })()`);
    evidence.push({ label, ...dimensions });
    try {
      assert(dimensions.rootHeight <= dimensions.height + 1, `${label}: the outer window must not scroll below its bounded content (${JSON.stringify(dimensions)})`);
      assert(dimensions.rootWidth <= dimensions.width + 1, `${label}: the outer window must not scroll horizontally`);
      assert.equal(dimensions.rootScrollTop, 0, `${label}: dragging the outer scrollbar must never move the document into blank space`);
      if (dimensions.mainScrollTop > 0) {
        const allowedPadding = dimensions.empty ? 52 : 32;
        assert(dimensions.trailingBlank <= allowedPadding, `${label}: scrolling to the bottom leaves ${dimensions.trailingBlank}px below the card`);
        assert(dimensions.contentBottom > dimensions.mainTop, `${label}: actual content must remain visible at the scroll end`);
      }
      assert(dimensions.scrollViewportHeight > 80, `${label}: card detail must remain usable`);
      if (!dimensions.empty) assert(dimensions.sourceMath > 0, `${label}: source formulas must remain rendered`);
    } catch (error) { failures.push(error.message); }
    if (evidenceDirectory && /1000x730-100%|640x420-200%/.test(label)) {
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(evidenceDirectory, `${label}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const [width, height, scale] of sizes) {
      window.setSize(width, height);
      window.webContents.setZoomFactor(scale);
      await pause(30);
      await inspect(`${theme}-${width}x${height}-${scale * 100}%-empty`);
    }
  }
  const short = (await store.save({ term: 'conditional expectation', label: '条件期望',
    meaning: '已知部分信息时的平均值。', context: '原文把观测作为条件。',
    source: 'The conditional expectation is $E[X \\mid Y]$.', kind: 'concept' })).card;
  const long = (await store.save({ term: 'long explanation', label: '长解释',
    meaning: ('这一段用于验证真实长卡片的滚动结束位置。\\(x^2\\)\n\n').repeat(100),
    context: '比较长短卡片切换时的实际滚动范围。',
    source: 'This long explanation ends with $E[X \\mid Y]$.', kind: 'concept' })).card;
  for (let number = 0; number < 24; number++) {
    await store.save({ term: `fixture ${number}`, label: `测试卡片 ${number}`,
      meaning: '用于验证列表滚动。', context: '', source: `A fixture ${number} is local.`, kind: 'concept' });
  }
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const [width, height, scale] of sizes) {
      window.setSize(width, height);
      window.webContents.setZoomFactor(scale);
      await pause(50);
      for (const card of [short, long, short]) {
        library.open(card.id);
        await until(async () => (await js('document.getElementById("term").textContent')) === card.term, 'selected card');
        await inspect(`${theme}-${width}x${height}-${scale * 100}%-${card === short ? 'short' : 'long'}`);
      }
      await js('document.getElementById("edit").click()');
      await inspect(`${theme}-${width}x${height}-${scale * 100}%-editing`);
      await js('document.getElementById("edit").click()');
      const listEnd = await js(`(() => {
        const list = document.getElementById('card-list');
        list.scrollTop = list.scrollHeight;
        return { blank: list.getBoundingClientRect().bottom - list.lastElementChild.getBoundingClientRect().bottom,
          height: list.clientHeight, scrollTop: list.scrollTop, rootScrollTop: document.scrollingElement.scrollTop };
      })()`);
      assert(listEnd.scrollTop > 0 && listEnd.height > 20, 'the card list must remain independently scrollable');
      assert(listEnd.blank <= 5 && listEnd.blank >= -1, 'the card list must end at its final card');
      assert.equal(listEnd.rootScrollTop, 0, 'scrolling the list must not move the outer window');
      const contrasts = await js(`(() => {
        const luminance = (color) => color.match(/[\\d.]+/g).slice(0, 3).map(Number)
          .map(value => (value /= 255) <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
        return [...document.querySelectorAll('.eyebrow, .muted, .storage-note, aside label, .card-item span, #source, .read-value, button:not(:disabled)')]
          .filter(node => node.getClientRects().length).map(node => {
            let ancestor = node, background;
            while (ancestor) {
              background = getComputedStyle(ancestor).backgroundColor;
              if (!background.endsWith(', 0)')) break;
              ancestor = ancestor.parentElement;
            }
            const text = luminance(getComputedStyle(node).color), paper = luminance(background);
            return { selector: node.id || node.className || node.tagName, ratio: (Math.max(text, paper) + .05) / (Math.min(text, paper) + .05) };
          });
      })()`);
      for (const contrast of contrasts) assert(contrast.ratio >= 4.5, `${theme}: ${contrast.selector} contrast is ${contrast.ratio.toFixed(2)}:1`);
      contrastEvidence.push({ theme, width, height, scale, minimum: Math.min(...contrasts.map(item => item.ratio)) });
    }
  }
  await js(`document.getElementById('edit').click();
    document.getElementById('notes').value = '编辑后保留本地笔记。';
    document.getElementById('notes').dispatchEvent(new Event('input'));
    document.getElementById('connect').value = ${JSON.stringify(long.id)};
    document.getElementById('add-link').click(); document.getElementById('save').click();`);
  await until(async () => (await store.list()).cards.find(card => card.id === short.id).notes === '编辑后保留本地笔记。', 'saved edits');
  await until(() => js('document.getElementById("card").classList.contains("read-mode")'), 'read mode after save');
  assert.deepEqual((await store.list()).cards.find(card => card.id === short.id).links, [long.id]);
  library.open(long.id);
  await until(async () => (await js('document.getElementById("connections").textContent')).includes('conditional expectation'), 'backlink');
  const storedCards = (await store.list()).cards;
  assert.equal(storedCards.length, 26);
  assert.equal(storedCards.find(card => card.id === short.id).source, short.source);
  if (evidenceDirectory) fs.writeFileSync(path.join(evidenceDirectory, 'layout.json'), JSON.stringify({ evidence, contrastEvidence, failures }, null, 2));
  assert.equal(failures.length, 0, failures.join('\n'));
  assert(BrowserWindow.getAllWindows().every((item) => !item.isVisible()));
  console.log(`Term library layout passed: ${evidence.length} layouts; short/long cards, empty state, editing, narrow windows, 100/200% zoom, light/dark contrast, saved notes, links and formulas; no visible windows.`);
  library.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(0);
}).catch((error) => { console.error(error); library?.dispose(); fs.rmSync(work, { recursive: true, force: true }); app.exit(1); });
