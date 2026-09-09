'use strict';

// Opt-in interactive smoke: real screen selection, real local OCR and the
// production basic translator. Only the fictional sample should be selected.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReadingPins } = require('../src/main/reading-pins');
const { DEFAULTS } = require('../src/shared/constants.cjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-live-'));
app.setName('Slipstream Reading Check');
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
let manager;
let sourceWindow;
let captures = 0;
app.whenReady().then(async () => {
  sourceWindow = new BrowserWindow({ width: 900, height: 530, title: 'Slipstream · English reading sample',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const html = `<!doctype html><html><meta charset="utf-8"><body style="margin:44px;background:#fafaf5;color:#203529;font-family:-apple-system,sans-serif">
    <div style="font-size:13px;color:#536955">SLIPSTREAM · SCREEN READING</div>
    <h1 style="font-size:26px">按 Option + Shift + S，框选下面的英文</h1>
    <a href="https://slipstream.test/capture" style="color:#226b4f">开始框选</a>
    <p style="font-size:13px;color:#536955">这是虚构阅读样例。框选后的文字将发送至 Google Translate，必要时使用 MyMemory。</p>
    <article style="background:white;border:1px solid #d6dfd0;border-radius:12px;padding:25px;margin-top:28px;font:23px/1.7 Georgia">
      Correlation does not imply causation.<br>
      An observed association between two variables may be explained by a common cause.<br>
      The estimate is conditional on the observed data.
    </article>
    <p style="font-size:13px;color:#536955">阅读卡片可以拖动、调整大小和置顶。用完按 Esc 关闭。关闭这个样例窗口结束测试。</p>
    </body></html>`;
  await sourceWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  manager = createReadingPins({ BrowserWindow, ipcMain, screen,
    getSettings: () => ({ setupMode: 'translation-only', activeBackend: 'free_translate', activeModel: 'google-translate' }),
    getMainWindow: () => null,
    captureRegion: (_file, options) => {
      console.log('Native screen selection requested.');
      return require('../src/main/screenshot-service')
        .captureSelectedRegion(path.join(work, `capture-${++captures}.png`), options);
    },
    performOCR: require('../src/main/ocr-service').performOCR,
    processReadingText: async (options) => {
      const result = await require('../src/main/llm-service').processReadingText(options);
      console.log(`Live translation completed: ${options.text.length} source characters, ${result.translation.length} translated characters.`);
      return result;
    },
    requestCapturePermission: async () => ({ granted: true }),
    onError: (message) => dialog.showMessageBox({ message, buttons: ['好'] }),
    onOpenSettings: () => dialog.showMessageBox({ message: '此交互测试使用基础翻译。完整应用可在设置中配置模型。', buttons: ['好'] }),
  });
  const registered = globalShortcut.register(DEFAULTS.SCREENSHOT_SHORTCUT, () => void manager.capture());
  sourceWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
    if (event.url === 'https://slipstream.test/capture') void manager.capture();
  });
  if (!registered) throw new Error('Screenshot shortcut is already registered by another application.');
  sourceWindow.on('closed', () => app.quit());
  console.log('Live screen-reading check ready. The production screenshot shortcut is registered; select only the fictional English sample.');
}).catch((error) => { console.error(error.message); app.exit(1); });
app.on('before-quit', () => { globalShortcut.unregisterAll(); manager?.dispose(); });
app.on('will-quit', () => fs.rmSync(work, { recursive: true, force: true }));
