'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { createTermLibrary } = require('../src/main/term-library');
const { testProviderReadiness } = require('../src/main/provider-readiness');
const before = process.argv.includes('--before');
const windowsUi = process.platform === 'win32' || process.argv.includes('--windows-ui');
const work = process.env.SLIPSTREAM_READING_HOME_WORK
  || fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-reading-home-'));
function cleanupWork() {
  if (!process.env.SLIPSTREAM_READING_HOME_WORK) fs.rmSync(work, { recursive: true, force: true });
}
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
nativeTheme.themeSource = 'dark';
const settings = { setupMode: 'full', activeBackend: 'deepseek', activeModel: 'deepseek-v4-flash',
  hasDeepseekApiKey: true, languageHint: 'en', clipboardMonitoring: false,
  privacyNoticeSeen: true, screenshotShortcut: 'Alt+Shift+S', clipboardShortcut: 'Alt+C',
  resultOrder: 'translation-first', runtimeStatus: { trayAvailable: true } };
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await predicate()) return; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
let main;
let pins;
let library;
let providerCalls = 0;
let screenRequests = 0;
let rejectTextHandoff = false;
let rejectSetupTrial = false;
const invocations = [];
const quitDecisions = [];
let lastQuitRisk = true;
const js = (code) => main.webContents.executeJavaScript(code);
async function shot(window, name) {
  if (!output) return;
  await window.webContents.executeJavaScript('document.fonts.ready');
  await pause(180);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
}
const stateOf = (window) => window.webContents.executeJavaScript('window.readingPin.act("ready").then(r => r.state)');
setTimeout(() => { console.error('Reading home check exceeded 90 seconds'); app.exit(1); }, 90000).unref();
app.whenReady().then(async () => {
  const store = createTermCardStore(path.join(work, 'cards'));
  library = createTermLibrary({ BrowserWindow, ipcMain, shell: { showItemInFolder() {} }, dialog: {}, store });
  const provider = createReadingProcessor(async (...args) => {
    providerCalls += 1;
    const input = JSON.parse(args[4]);
    if (input.candidates) return JSON.stringify({ keep: input.candidates.map((_term, index) => index) });
    if (input.selection === 'confounder') return JSON.stringify({ quote: input.selection,
      meaning: '混杂变量是同时影响处理与结果的变量。', note: '本段用它说明关联不一定意味着因果效应。' });
    if (input.selection) return JSON.stringify({ quote: input.selection,
      meaning: '相关关系描述两个变量在统计上一起变化的程度，不能单凭这种共同变化判断因果。',
      note: '这段指出，共同原因也可能让两个变量一起变化。' });
    const second = input.excerpt.includes('confounder');
    return JSON.stringify({ translation: second
      ? '混杂变量同时影响处理与结果，因此即使处理没有因果效应，也可能观察到关联。'
      : '相关关系并不意味着因果关系。两个变量之间观察到的关联，可能由一个共同原因来解释。',
    terms: second ? [{ quote: 'confounder', label: '混杂变量', role: 'core' }, { quote: 'causal effect', label: '因果效应', role: 'core' }]
      : [{ quote: 'Correlation', label: '相关关系', role: 'core' }, { quote: 'causation', label: '因果关系', role: 'core' }] });
  });
  pins = createReadingPins({ BrowserWindow, ipcMain, screen, getSettings: () => settings, getMainWindow: () => main,
    referenceStore: createReadingReferenceStore(path.join(work, 'references')),
    processReadingText: provider, saveTermCard: input => store.save(input), onOpenLibrary: id => library.open(id),
    requestCapturePermission: async () => { screenRequests += 1; return { granted: false }; },
    captureRegion: async () => { throw new Error('Screenshot fixture must not read the screen'); },
    performOCR: async () => { throw new Error('Pasted reading must not request OCR'); },
  });
  const channels = ['settings:get', 'shortcut:status-get', 'app:renderer-recovery-status-get', 'window:set-mode',
    'app:session-risk-update', 'terms:get', 'clipboard:pending-status', 'app:quit-listener-ready',
    'app:settings-listener-ready', 'capture:listener-ready', 'app:settings-request-handled',
    'reading:open-text', 'reading:library-open', 'reading:references-open', 'screenshot:capture', 'llm:process',
    'settings:set', 'provider:connection-test', 'app:quit-decision'];
  for (const channel of channels) ipcMain.handle(channel, (_event, value, settingValue) => {
    invocations.push(channel);
    if (channel === 'app:session-risk-update') { lastQuitRisk = value.hasRisk; return true; }
    if (channel === 'app:quit-decision') { quitDecisions.push(value); return { status: 'preview-confirmed' }; }
    if (channel === 'settings:get') return { ...settings };
    if (channel === 'settings:set') {
      settings[value] = settingValue;
      return { status: 'saved', key: value, customEndpointApiKeyCleared: false };
    }
    if (channel === 'provider:connection-test') return testProviderReadiness({ ...settings }, {
      testProviderConnection: async () => ({ status: 'connected', code: 'ok' }),
      processReadingText: rejectSetupTrial
        ? async () => { throw new Error('reading-invalid-output'); } : provider,
    });
    if (channel === 'shortcut:status-get') return { allRegistered: true,
      screenshot: { accelerator: 'Alt+Shift+S', registered: true }, clipboard: { accelerator: 'Alt+C', registered: true } };
    if (channel === 'app:renderer-recovery-status-get') return { recovered: false, clipboardResidueRisk: null };
    if (channel === 'terms:get') return [];
    if (channel === 'reading:open-text') return rejectTextHandoff
      ? { success: false, errorCode: 'reading-busy' } : pins.openText(value);
    if (channel === 'reading:library-open') { library.open(); return true; }
    if (channel === 'reading:references-open') return pins.openReferences();
    if (channel === 'screenshot:capture') { screenRequests += 1; return { success: false, cancelled: true }; }
    if (channel === 'llm:process') throw new Error('Reading home must open a reading card');
    return { status: 'recorded' };
  });
  const preload = path.join(work, 'preload.js');
  fs.writeFileSync(preload, fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8')
    .replace('platform: process.platform,', `platform: '${windowsUi ? 'win32' : 'darwin'}',`));
  main = new BrowserWindow({ width: 520, height: 680, frame: false, show: false,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  main.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/u.test(details.url) }));
  const entry = before
    ? path.join(os.homedir(), 'Applications/Slipstream 阅读预览.app/Contents/Resources/app.asar/dist/renderer/index.html')
    : path.join(__dirname, '../dist/renderer/index.html');
  await main.loadFile(entry);
  await until(() => js('Boolean(document.querySelector(".capture-card"))'), 'reading home');
  main.showInactive();
  if (before) {
    await shot(main, '01-reading-home-before.png');
    library.dispose(); pins.dispose(); main.destroy(); cleanupWork(); app.exit(0); return;
  }
  assert.equal(await js('document.querySelector("h1").textContent'), '读懂原文，留下概念');
  if (windowsUi) {
    assert.equal(await js('document.querySelector(".reading-capture-primary") === null'), true);
    assert(await js('document.body.textContent.includes("Windows 预览暂不支持截图识字")'));
    assert(await js('document.body.textContent.includes("Alt+C")'));
    assert.equal(await js('document.querySelector(".capture-permission-note") === null'), true);
  } else {
    assert(await js('document.querySelector(".reading-capture-primary").getBoundingClientRect().bottom < document.querySelector("textarea").getBoundingClientRect().top'));
  }
  await shot(main, '02-reading-home.png');
  await js('document.querySelector(".capture-sample button").click()');
  assert.match(await js('document.querySelector("textarea").value'), /Correlation/);
  assert.equal(providerCalls, 0, 'loading an example must not request a model');
  assert.equal(pins.openText('').success, false);
  assert.equal(pins.openText('x'.repeat(10001)).success, false);
  rejectTextHandoff = true;
  await js('document.querySelector(".process-button").click()');
  await until(() => js('Boolean(document.querySelector("#processing-error-card"))'), 'handoff failure');
  assert.match(await js('document.querySelector("textarea").value'), /Correlation/, 'failed handoff retains the source');
  assert.equal(providerCalls, 0);
  rejectTextHandoff = false;
  await js('document.querySelector(".process-button").click()');
  await until(() => BrowserWindow.getAllWindows().length === 2, 'reading card');
  const pin = BrowserWindow.getAllWindows().find(window => window !== main);
  await until(async () => (await stateOf(pin)).phase === 'done', 'translated paragraphs');
  assert.equal(screenRequests, 0, 'pasted reading must not request screen permission or capture');
  assert.equal(invocations.includes('llm:process'), false);
  assert.equal(await pin.webContents.executeJavaScript('document.getElementById("tab-image").hidden'), true);
  await pin.webContents.executeJavaScript('document.getElementById("tab-translation").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))');
  assert.equal(await pin.webContents.executeJavaScript('document.activeElement.id'), 'tab-parallel');
  await pin.webContents.executeJavaScript('document.getElementById("tab-translation").click()');
  assert.equal(await js('document.querySelector("textarea").value'), '', 'accepted text transfers into the independent card');
  await pin.webContents.executeJavaScript('document.querySelector(".term-chip").click()');
  await until(async () => (await stateOf(pin)).lookupStatus === 'done', 'contextual term explanation');
  assert(await pin.webContents.executeJavaScript('document.getElementById("save-term").getBoundingClientRect().bottom <= document.querySelector("footer").getBoundingClientRect().top'), 'save stays visible in a compact reading card');
  pin.setSize(460, 660);
  await shot(pin, '03-reading-concept.png');
  await pin.webContents.executeJavaScript('document.getElementById("save-term").click()');
  await until(async () => (await stateOf(pin)).saveStatus === 'saved', 'explicit card save');
  pins.clear(); main.showInactive();
  await js(`document.querySelector('[aria-label="打开本地术语卡片盒"]').click()`);
  await until(() => BrowserWindow.getAllWindows().length === 2, 'local card box');
  const box = BrowserWindow.getAllWindows().find(window => window !== main);
  await until(() => box.webContents.executeJavaScript('document.body.textContent.includes("Correlation")'), 'saved card visible');
  await shot(box, '04-reading-card-box.png');
  assert.equal((await store.list()).cards.length, 1);
  library.dispose();
  await js(`document.querySelector('[aria-label="打开按论文保留的本文速查"]').click()`);
  await until(() => BrowserWindow.getAllWindows().length === 2, 'paper references from home');
  const references = BrowserWindow.getAllWindows().find(window => window !== main);
  await until(() => references.webContents.executeJavaScript('!document.getElementById("reference-content").hidden'), 'reference window rendered');
  references.close();
  main.setSize(400, 400); main.webContents.setZoomFactor(2);
  await pause(200);
  assert(await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'home must reflow at 200%');
  await shot(main, '05-reading-home-200.png');
  main.webContents.setZoomFactor(1); main.setSize(820, 720);
  Object.assign(settings, { setupMode: 'unconfigured', activeBackend: 'free_translate', activeModel: 'google-translate' });
  await main.loadFile(entry);
  await until(() => js('Boolean(document.querySelector("#setup-title"))'), 'first use');
  await shot(main, '06-reading-setup.png');
  assert(await js('document.body.textContent.includes("专业阅读")'));
  if (windowsUi) {
    assert(await js('document.body.textContent.includes("Windows 预览暂不支持截图识字")'));
    assert.equal(await js('document.body.textContent.includes("截图读译文")'), false);
  }
  await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('配置阅读服务')).click()`);
  await until(() => js('Boolean(document.querySelector(".settings-panel"))'), 'reading setup settings');
  await js(`Array.from(document.querySelectorAll('[role="radio"]')).find(b => b.textContent.includes('使用在线分析服务')).click()`);
  await until(() => js(`Boolean(Array.from(document.querySelectorAll('[role="radio"]')).find(b => b.textContent.includes('DeepSeek')))`), 'provider choices');
  await js(`Array.from(document.querySelectorAll('[role="radio"]')).find(b => b.textContent.includes('DeepSeek')).click()`);
  await until(() => js('document.querySelector(".provider-connection-test-button")?.disabled === false'), 'saved provider ready');
  await js('document.querySelector(".provider-connection-test-button").click()');
  await until(() => js('Boolean(document.querySelector(".reading-setup-sample"))'), 'actual reading result through main IPC and renderer');
  assert.equal(settings.setupMode, 'unconfigured', 'a completed trial must wait for explicit activation');
  assert(await js('document.querySelector(".reading-setup-sample").textContent.includes("混杂变量是同时影响处理与结果的变量")'));
  await shot(main, '07-reading-setup-result.png');

  rejectSetupTrial = true;
  await js('document.querySelector(".provider-connection-test-button").click()');
  await until(() => js('document.querySelector(".provider-connection-result")?.dataset.status === "failed"'), 'failed reading trial');
  assert.equal(await js('Boolean(document.querySelector(".reading-setup-sample"))'), false, 'a failed retry must remove the previous model result');
  assert.equal(await js('document.querySelector(".full-analysis-enable-button").disabled'), true);
  rejectSetupTrial = false;
  await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重新试读').click()`);
  await until(() => js('Boolean(document.querySelector(".reading-setup-sample"))'), 'recovered reading trial');

  main.setSize(400, 400); main.webContents.setZoomFactor(2);
  await pause(120);
  assert(await js('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'trial results must reflow at 200%');
  assert(await js('Array.from(document.querySelectorAll(".reading-setup-sample")).every(e => e.scrollWidth <= e.clientWidth + 1)'));
  main.webContents.setZoomFactor(1); main.setSize(820, 720);
  const callsBeforeActivation = providerCalls;
  await js('document.querySelector(".full-analysis-enable-button").click()');
  await until(() => js('Boolean(document.querySelector(".capture-card"))'), 'activated reading home');
  assert.equal(settings.setupMode, 'full');
  assert.equal(providerCalls, callsBeforeActivation, 'activation must not submit a user excerpt or start another trial');
  await until(() => lastQuitRisk === false, 'settled reading home');
  assert.equal(pins.openText('Correlation does not imply causation.').success, true);
  assert.equal(main.isVisible(), false, 'reading hides the home window');
  assert.equal(await js('document.visibilityState'), 'hidden');
  const quitRequest = { requestId: 'hidden-reading-home-quit' };
  const quitStarted = Date.now();
  main.webContents.send('app:quit-requested', quitRequest);
  main.webContents.send('app:quit-requested', quitRequest);
  await until(() => quitDecisions.length > 0, 'quit decision while the reading home is hidden');
  assert.deepEqual(quitDecisions, [{ ...quitRequest, confirmed: true }], 'repeated native quit requests settle once');
  assert.equal(main.isVisible(), false, 'safe reading quit must not flash the home window');
  console.log(`Hidden reading home settled quit in ${Date.now() - quitStarted} ms without a paint or showing the window.`);
  console.log('Reading home passed: platform-specific capture entry, explicit sample loading, text to independent reading card, no screen permission for text, contextual lookup, local save and correct card-box entry, first use and 200% reflow. Model responses are illustrative fixtures; all state is temporary.');
  pins.dispose(); main.destroy(); cleanupWork(); app.exit(0);
}).catch(error => { console.error(error); library?.dispose(); pins?.dispose(); cleanupWork(); app.exit(1); });
app.on('window-all-closed', () => {});
