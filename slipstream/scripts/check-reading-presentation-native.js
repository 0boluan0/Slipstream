'use strict';
// Isolated real Electron renderer checks. Never reads the user's screen or calls a provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const before = process.argv.includes('--before');
const inspect = process.argv.includes('--inspect');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? null : path.resolve(process.argv[outputIndex + 1]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-presentation-'));
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash',
  hasDeepseekApiKey: true, languageHint: 'en', clipboardMonitoring: false,
  privacyNoticeSeen: true, screenshotShortcut: 'Alt+Shift+S', clipboardShortcut: 'Alt+C',
  resultOrder: 'translation-first', runtimeStatus: { trayAvailable: true } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const js = code => win.webContents.executeJavaScript(code);
async function until(code, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await js(code)) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
async function paint() {
  await js('document.fonts.ready');
  await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
}
async function shot(name) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
}
function contrast(a, b) {
  function luminance(value) {
    const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
      const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function cleanup(code) { win?.destroy(); fs.rmSync(work, { recursive: true, force: true }); app.exit(code); }
if (!inspect) setTimeout(() => { console.error('Presentation check exceeded 90 seconds'); cleanup(1); }, 90000).unref();
app.whenReady().then(async () => {
  for (const channel of ['settings:get', 'shortcut:status-get', 'app:renderer-recovery-status-get',
    'window:set-mode', 'app:session-risk-update', 'terms:get', 'clipboard:pending-status',
    'app:quit-listener-ready', 'app:settings-listener-ready', 'capture:listener-ready',
    'app:settings-request-handled']) {
    ipcMain.handle(channel, () => {
      if (channel === 'settings:get') return { ...settings };
      if (channel === 'shortcut:status-get') return { allRegistered: true,
        screenshot: { accelerator: 'Alt+Shift+S', registered: true }, clipboard: { accelerator: 'Alt+C', registered: true } };
      if (channel === 'app:renderer-recovery-status-get') return { recovered: false, clipboardResidueRisk: null };
      if (channel === 'terms:get') return [];
      return { status: 'recorded' };
    });
  }
  win = new BrowserWindow({ width: 520, height: 680, minWidth: 400, minHeight: 400, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, '../preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/u.test(details.url) }));
  const entry = path.join(__dirname, '../dist/renderer/index.html');
  const report = [];
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    settings.setupMode = 'full';
    await win.loadFile(entry);
    await until('Boolean(document.querySelector(".reading-capture-primary"))', 'home');
    win.show(); win.focus(); win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 }); await paint();
    const home = await js(`(() => {
      const k = getComputedStyle(document.querySelector('.reading-capture-primary kbd'));
      const header = document.querySelector('.app-header');
      return { foreground: k.color, background: k.backgroundColor,
        dragRegion: getComputedStyle(header).webkitAppRegion,
        headerHeight: header.getBoundingClientRect().height,
        helpCount: document.querySelectorAll('.help-tip__trigger').length };
    })()`);
    const ratio = contrast(home.foreground, home.background);
    report.push({ theme, ...home, shortcutContrast: Number(ratio.toFixed(2)) });
    await shot(`${theme}-home${before ? '-before' : ''}.png`);
    if (!before) {
      assert(ratio >= 4.5, `${theme} shortcut contrast ${ratio.toFixed(2)}:1 below 4.5:1`);
      assert.equal(home.dragRegion, 'drag', 'whole home titlebar must move the window');
      assert(home.headerHeight >= 40, 'titlebar has a usable drag height');
      assert(home.helpCount >= 3, 'home secondary explanations are available on demand');
      assert.equal(await js('getComputedStyle(document.querySelector(".app-header__actions button")).webkitAppRegion'), 'no-drag');
      assert(await js('document.querySelector(".processing-privacy-disclosure").innerText.includes("DeepSeek")'), 'provider stays visible before submitting');
      assert.equal(await js('Array.from(document.querySelectorAll("[role=tooltip]")).filter(e => !e.hidden).length'), 0);
      await js('document.querySelector(".help-tip__trigger").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))');
      await until('Boolean(document.querySelector("[role=tooltip]:not([hidden])"))', 'hover explanation');
      await shot(`${theme}-home-help.png`);
      await js('document.querySelector(".help-tip__trigger").dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }))');
      await until('!document.querySelector("[role=tooltip]:not([hidden])")', 'mouseleave dismissal');
      await js('document.querySelector(".help-tip__trigger").focus()');
      await until('Boolean(document.querySelector("[role=tooltip]:not([hidden])"))', 'keyboard help');
      await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await until('!document.querySelector("[role=tooltip]:not([hidden])")', 'Escape dismissal');
      assert.equal(await js('document.activeElement.className'), 'help-tip__trigger', 'Escape keeps keyboard location');
      await js('document.activeElement.click()');
      await until('Boolean(document.querySelector("[role=tooltip]:not([hidden])"))', 'click help');
      await js('document.querySelector("textarea").focus()');
      await until('!document.querySelector("[role=tooltip]:not([hidden])")', 'blur dismissal');
      for (const [width, height, zoom] of [[520, 680, 1], [400, 520, 1], [400, 520, 2]]) {
        win.setSize(width, height); win.webContents.setZoomFactor(zoom); await paint();
        assert(await js('document.documentElement.scrollWidth <= innerWidth + 1'), `${theme} home reflow at ${width}/${zoom}`);
        assert(await js(`(() => {
          const buttons = Array.from(document.querySelectorAll('.reading-library-trigger'));
          const [a, b] = buttons.map(e => e.getBoundingClientRect());
          return buttons.every(e => e.innerText.trim()) && a.right <= b.left;
        })()`), 'both library buttons stay visibly named and do not overlap');
        await js('document.querySelector(".help-tip__trigger").focus()'); await paint();
        const tip = await js(`(() => { const e = document.querySelector('[role=tooltip]:not([hidden])'); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; })()`);
        assert(tip.left >= 0 && tip.top >= 0 && tip.right <= tip.width + 1 && tip.bottom <= tip.height + 1, `${theme} tooltip fits ${width}/${zoom}: ${JSON.stringify(tip)}`);
        await shot(`${theme}-home-${width}-${zoom}x.png`);
        await js('document.querySelector("textarea").focus()');
      }
    }
    win.webContents.setZoomFactor(1); win.setSize(820, 720);
    settings.setupMode = 'unconfigured';
    await win.loadFile(entry);
    await until('Boolean(document.querySelector("#setup-title"))', 'setup');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 }); await paint();
    const setup = await js(`(() => { const e = document.querySelector('.setup-window-header'); return { dragRegion: e ? getComputedStyle(e).webkitAppRegion : null }; })()`);
    report.push({ theme, setup });
    await shot(`${theme}-setup${before ? '-before' : ''}.png`);
    if (!before) {
      assert.equal(setup.dragRegion, 'drag', 'first-run has a dedicated titlebar');
      for (const [width, height, zoom] of [[400, 520, 1], [400, 520, 2]]) {
        win.setSize(width, height); win.webContents.setZoomFactor(zoom); await paint();
        assert(await js('document.documentElement.scrollWidth <= innerWidth + 1'), `${theme} setup reflow at ${width}/${zoom}`);
        await shot(`${theme}-setup-${width}-${zoom}x.png`);
      }
    }
    win.webContents.setZoomFactor(1); win.setSize(520, 680);
  }
  if (output) fs.writeFileSync(path.join(output, before ? 'before.json' : 'after.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(before ? 'Before evidence recorded; missing help/drag region and contrast failures are reported.' : 'Home/setup presentation passed in real Electron: two themes, hover/focus/click/Escape help, provider disclosure, header drag CSS, 100/200% reflow. OS drag movement is a separate native acceptance check.');
  if (inspect) {
    nativeTheme.themeSource = 'light';
    settings.setupMode = process.argv.includes('--setup') ? 'unconfigured' : 'full';
    win.webContents.setZoomFactor(1); win.setSize(520, 680);
    await win.loadFile(entry); win.show(); win.focus();
    const reportBounds = () => console.log(`Inspection bounds: ${JSON.stringify(win.getBounds())}`);
    win.on('move', reportBounds);
    win.on('resize', reportBounds);
    reportBounds();
    console.log(`Inspection ready in isolated profile ${work}; close the test window to clean up.`);
    win.once('closed', () => { win = null; cleanup(0); });
    return;
  }
  cleanup(0);
}).catch(error => { console.error(error); cleanup(1); });
app.on('window-all-closed', () => {});
