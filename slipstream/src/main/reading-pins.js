'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { assessOcrReview } = require('./ocr-review');
const { mathAssetUrls } = require('./reading-math-assets');
const { needsMathReview, isMathOnly } = require('../shared/reading-math.cjs');
const { formulaRecognitionAvailable } = require('./formula-recognition');
const { DEFAULTS } = require('../shared/constants.cjs');
const { processingLocationForSettings } = require('../shared/endpoint-location.cjs');
const { validateEndpointUrl, validateOllamaEndpointUrl } = require('./validation');
const { readingTextFromOcr, readingSegments } = require('./reading-document');
const { referenceKey, referenceOccurrences, isNotation } = require('./reading-references');

const ENTRY = path.join(__dirname, 'reading-pin', 'index.html');
const ENTRY_URL = pathToFileURL(ENTRY).href;
const MAX_PINS = 12;

function cardBounds(point, workArea) {
  const width = Math.min(460, workArea.width);
  const height = Math.min(540, workArea.height);
  const proposedX = point.x + width + 18 <= workArea.x + workArea.width
    ? point.x + 18 : point.x - width - 18;
  return {
    width, height,
    x: Math.max(workArea.x, Math.min(proposedX, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(point.y - 80, workArea.y + workArea.height - height)),
  };
}

function readingDestination(settings) {
  if (settings.activeBackend === 'custom') validateEndpointUrl(settings.customEndpointUrl);
  if (settings.activeBackend === 'ollama') validateOllamaEndpointUrl(settings.ollamaBaseUrl);
  const location = processingLocationForSettings(settings);
  if (location === 'unknown') throw new Error('reading-unknown-destination');
  if (settings.activeBackend === 'free_translate') {
    return '文字发送至 Google Translate；必要时使用 MyMemory。截图留在本机。';
  }
  if (settings.activeBackend === 'ollama') return '文字由本机 Ollama 处理。截图留在本机。';
  if (location === 'local-loopback') return '文字交给本机兼容服务；该服务可能继续联网。截图留在本机。';
  const provider = { anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', custom: '已配置的在线服务' }[settings.activeBackend];
  if (!provider) throw new Error('reading-unknown-destination');
  return `文字发送至 ${provider}。截图留在本机。`;
}

function createReadingPins({ BrowserWindow, ipcMain, screen, getSettings, getMainWindow,
  captureRegion, performOCR, processReadingText, recognizeReadingFormulas, requestCapturePermission, canCapture = () => true,
  captureAppName = 'Slipstream', captureSupported = true,
  copyText = () => {}, saveTermCard, referenceStore, onOpenLibrary = () => {}, onOpenSettings = () => {}, onError = () => {}, classifyError = () => '处理没有完成，请重试或检查设置。' }) {
  const pins = new Map();
  let selecting = null;
  let generation = 0;
  let disposed = false;
  let referenceData = { papers: [], activePaperId: null };
  let referenceError = '';
  let referencesLoaded = !referenceStore;

  const paperFor = (pin) => referenceData.papers.find((paper) => paper.id === pin.view.paperId);
  const candidateKey = (entry) => JSON.stringify([referenceKey(entry.symbol), entry.evidence, entry.source]);
  function candidatesFor(pin) {
    if (!pin.view.paperId) return [];
    const saved = new Set((paperFor(pin)?.entries || []).map(candidateKey));
    const candidates = new Map();
    for (const other of pins.values()) {
      if (other.view.paperId !== pin.view.paperId) continue;
      for (const entry of [...(other.referenceCandidates || []), ...other.view.segments.flatMap((segment) => segment.referenceCandidates || [])]) {
        const key = candidateKey(entry);
        if (!saved.has(key)) candidates.set(key, { ...entry, key });
      }
    }
    return [...candidates.values()];
  }

  async function refreshReferences() {
    if (!referenceStore) return;
    try { referenceData = await referenceStore.read(); referenceError = ''; }
    catch { referenceError = '本文速查未能读取。请检查本地文件后重试，已有文件会保留。'; }
    for (const pin of pins.values()) {
      if (!referencesLoaded && !pin.paperChosen) pin.view.paperId = referenceData.activePaperId;
      if (pin.view.paperId && !paperFor(pin)) pin.view.paperId = null;
      if (pin.view.lookup?.reference) pin.view.lookup = referenceLookup(pin, pin.view.lookup.quote);
      publish(pin);
    }
    referencesLoaded = true;
    for (const pin of pins.values()) maybeStart(pin);
  }
  const referencesReady = refreshReferences();

  const alive = (pin) => pins.get(pin.id) === pin && !pin.window.isDestroyed();
  const state = (pin) => {
    const paper = paperFor(pin);
    const entries = paper?.entries || [];
    return { ...pin.view, revision: pin.revision,
      segments: pin.view.segments.map((segment) => {
        const seen = new Set();
        const referenceHits = entries.flatMap((entry) => {
          const key = referenceKey(entry.symbol);
          if (seen.has(key)) return [];
          const hit = referenceOccurrences(segment.source, entry.symbol)[0];
          if (!hit) return [];
          seen.add(key);
          return [{ ...hit, symbol: entry.symbol }];
        });
        return { ...segment, referenceHits };
      }),
      references: { enabled: Boolean(referenceStore), paper: paper ? { ...paper, entries: entries.map((entry) => ({ ...entry,
        sameSymbolCount: entries.filter((other) => referenceKey(other.symbol) === referenceKey(entry.symbol)).length })) } : null,
        papers: referenceData.papers.map(({ id, title, entries: saved }) => ({ id, title, count: saved.length })),
        activePaperId: referenceData.activePaperId, candidates: candidatesFor(pin),
        notice: pin.referenceNotice || referenceError, status: pin.referenceStatus || '',
        undoAvailable: Boolean(pin.referenceUndo), draft: pin.referenceDraft || null } };
  };
  function showPendingCards() {
    if (selecting || disposed) return;
    for (const pin of pins.values()) {
      if (pin.pendingShow && alive(pin)) {
        pin.pendingShow = false;
        if (pin.view.referenceOnly) pin.window.show();
        else pin.window.showInactive();
      }
    }
  }
  function publish(pin) {
    if (alive(pin) && pin.ready) pin.window.webContents.send('reading-pin:state', state(pin));
  }
  function update(pin, patch) {
    if (!alive(pin)) return;
    Object.assign(pin.view, patch);
    if (patch.phase === 'review' && patch.formulaStatus === 'local' && !pin.manuallyResized && !pin.reviewFitted) {
      pin.reviewFitted = true;
      const bounds = pin.window.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
      const height = Math.min(720, area.height);
      pin.window.setBounds({ ...bounds, height, y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) });
    }
    publish(pin);
    if (patch.segments || patch.phase) {
      for (const other of pins.values()) if (other !== pin && other.view.referenceOnly) publish(other);
    }
  }
  function close(pin) {
    pin.controller?.abort();
    pin.lookupController?.abort();
    pin.referenceController?.abort();
    pin.lookupCache?.clear();
    pin.revision += 1;
    pins.delete(pin.id);
    pin.view = {};
    if (!pin.window.isDestroyed()) pin.window.destroy();
    for (const other of pins.values()) if (other.view.referenceOnly) publish(other);
  }

  function createPin(image, referenceOnly = false, paperId = referenceData.activePaperId) {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const window = new BrowserWindow({
      ...cardBounds(point, display.workArea),
      minWidth: Math.min(280, display.workArea.width),
      minHeight: Math.min(220, display.workArea.height),
      title: referenceOnly ? 'Slipstream · 本文速查' : 'Slipstream · 阅读卡片',
      frame: false, resizable: true, show: false, alwaysOnTop: true,
      skipTaskbar: true, backgroundColor: '#f9faf7',
      webPreferences: {
        preload: path.join(__dirname, 'reading-pin', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: 'reading-pins', spellcheck: false,
      },
    });
    const pin = { id: window.webContents.id, window, ready: false, revision: 0, generation, controller: null,
      lookupController: null, lookupCache: new Map(), lookupSequence: 0, manuallyResized: false, fitted: false,
      view: { phase: referenceOnly ? 'references' : 'ocr', referenceOnly, paperId, image, sourceText: '', translation: '', explanations: null,
        segments: [], lookup: null, lookupStatus: '', lookupNotice: '', saveStatus: '', savedCardId: null, collapsed: false,
        notice: '', destination: '', topmost: true, explainSupported: false,
        formulaSupported: Boolean(recognizeReadingFormulas && formulaRecognitionAvailable(getSettings())),
        formulaStatus: '', formulaNotice: '', imageSent: false } };
    pins.set(pin.id, pin);
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const allowedFiles = ['index.html', 'style.css', 'view.js', 'references-view.js', 'references.css',
        ...['PushPin', 'Minus', 'X', 'Copy', 'MagnifyingGlass', 'ArrowClockwise', 'GearSix', 'ArrowsOutSimple'].map((name) => `icons/${name}.svg`)]
        .map((file) => pathToFileURL(path.join(__dirname, 'reading-pin', file)).href);
      callback({ cancel: !allowedFiles.includes(details.url) && !mathAssetUrls.includes(details.url)
        && details.url !== pathToFileURL(path.join(__dirname, '../shared/reading-notation.cjs')).href
        && !details.url.startsWith('data:image/png;base64,') });
    });
    window.on('closed', () => close(pin));
    window.on('page-title-updated', (event) => event.preventDefault());
    window.on('will-resize', () => { pin.manuallyResized = true; });
    window.webContents.on('render-process-gone', () => close(pin));
    window.once('ready-to-show', () => {
      pin.pendingShow = true;
      showPendingCards();
    });
    window.loadFile(ENTRY).catch(() => {
      if (alive(pin)) { close(pin); onError('阅读卡片加载失败，请重新截图。'); }
    });
    return pin;
  }

  function referenceLookup(pin, quote) {
    const saved = (paperFor(pin)?.entries || []).filter((entry) => referenceKey(entry.symbol) === referenceKey(quote));
    const pending = candidatesFor(pin).filter((entry) => referenceKey(entry.symbol) === referenceKey(quote)
      && pin.view.sourceText.includes(entry.evidence)).map((entry) => ({ ...entry, pending: true }));
    const definitions = [...pending, ...saved];
    const only = definitions.length === 1 && !definitions[0].pending ? definitions[0] : null;
    return { quote, contextual: true, reference: true, definitions,
      meaning: only?.meaning || '', note: only?.scope || '', referenceSource: only?.source || '' };
  }

  async function openReferences(paperId, draft) {
    if (!referenceStore || disposed || !canCapture()) return false;
    await referencesReady;
    if (disposed) return false;
    const selectedPaper = paperId === undefined ? referenceData.activePaperId : paperId;
    let pin = [...pins.values()].find((item) => item.view.referenceOnly && item.view.paperId === selectedPaper);
    if (!pin) {
      if (pins.size >= MAX_PINS) { onError('请先关闭一张不用的卡片，再打开本文速查。'); return false; }
      pin = createPin(null, true, selectedPaper);
      pin.paperChosen = true;
    }
    if (draft) pin.referenceDraft = { ...draft, token: Date.now() };
    publish(pin);
    if (pin.ready) pin.window.show();
    return true;
  }

  async function referenceAction(pin, action, payload = {}) {
    if (!referenceStore || disposed) return false;
    await referencesReady;
    if (!alive(pin)) return false;
    try {
      if (action === 'reference-open') return openReferences(pin.view.paperId);
      if (action === 'reference-draft') {
        const lookup = pin.view.lookup;
        return openReferences(pin.view.paperId, { symbol: lookup?.quote || '', meaning: lookup?.meaning || '',
          source: pin.view.sourceText, evidence: '', scope: '', origin: 'manual' });
      }
      if (action === 'reference-refresh') { await refreshReferences(); return true; }
      if (action === 'paper-undo') {
        if (!pin.referenceUndo) return false;
        await referenceStore.restorePaper(pin.referenceUndo);
        pin.view.paperId = pin.referenceUndo.id;
        pin.referenceUndo = null;
        pin.referenceNotice = '已恢复本文速查。';
        await refreshReferences();
        return { state: state(pin), success: true };
      }
      if (action === 'paper-create' || action === 'paper-select') {
        if (action === 'paper-create') {
          const name = payload.title || `阅读 · ${new Date().toLocaleDateString('zh-CN')}`;
          const paper = await referenceStore.create(name);
          pin.view.paperId = paper.id;
        } else {
          await referenceStore.select(payload.paperId || null);
          pin.view.paperId = payload.paperId || null;
        }
        pin.paperChosen = true;
        pin.referenceController?.abort();
        pin.referenceCandidates = [];
        for (const segment of pin.view.segments) delete segment.referenceCandidates;
        pin.lookupController?.abort();
        pin.lookupSequence += 1;
        pin.lookupCache.clear();
        pin.view.lookup = null;
        pin.view.lookupStatus = '';
        pin.referenceNotice = pin.view.paperId ? '之后的新截图沿用这篇阅读；已打开的其他卡片保留各自归属。' : '之后的新截图作为临时阅读。';
      } else {
        const paperId = pin.view.paperId;
        if (payload.paperId !== paperId || !paperId) throw new Error('reference-paper-changed');
        if (action === 'reference-copy') {
          const entry = paperFor(pin)?.entries.find((item) => item.id === payload.id);
          if (!entry) return false;
          copyText(`${entry.symbol} — ${entry.meaning}${entry.scope ? `\n适用位置：${entry.scope}` : ''}${entry.evidence ? `\n\n${entry.evidence}` : ''}`);
          pin.referenceNotice = '已复制定义，公式保留 LaTeX 源格式。';
        } else if (action === 'reference-extract') {
          if (!pin.view.sourceText || !['done', 'partial'].includes(pin.view.phase) || pin.referenceStatus === 'loading') return false;
          const configuration = settingsForReading();
          if (configuration.settings.activeBackend === 'free_translate') { onOpenSettings(); return false; }
          const controller = new AbortController();
          pin.referenceController = controller;
          pin.referenceStatus = 'loading';
          pin.referenceNotice = '正在从这段原文查找明确的定义…';
          const revision = pin.revision;
          const requestGeneration = generation;
          publish(pin);
          try {
            const result = await processReadingText({ text: pin.view.sourceText, kind: 'references', settingsSnapshot: configuration.settings, signal: controller.signal });
            if (!alive(pin) || controller.signal.aborted || pin.view.paperId !== paperId || pin.revision !== revision || generation !== requestGeneration) return false;
            pin.referenceCandidates = result.references || [];
            pin.referenceNotice = pin.referenceCandidates.length ? '已找到定义，请对照原文后留下。' : '这段没有找到明确的符号定义。可以截取定义所在段落，或手动记一条。';
          } finally {
            if (pin.referenceController === controller) { pin.referenceController = null; pin.referenceStatus = ''; }
          }
        } else if (action === 'reference-accept') {
          const entry = candidatesFor(pin).find((item) => item.key === payload.key);
          if (!entry) throw new Error('reference-candidate-changed');
          const input = { ...entry };
          delete input.key;
          await referenceStore.add(paperId, input);
          pin.referenceNotice = '已留在本文速查。';
        } else if (action === 'reference-save') {
          const input = payload.entry;
          if (!input || input.origin !== 'manual') throw new Error('reference-invalid-entry');
          if (payload.id) await referenceStore.edit(paperId, payload.id, input, payload.revision);
          else await referenceStore.add(paperId, input);
          pin.referenceDraft = null;
          pin.referenceNotice = '已保存在本机，下次继续阅读时仍可使用。';
        } else if (action === 'reference-remove') {
          await referenceStore.removeEntry(paperId, payload.id, payload.revision);
          pin.referenceNotice = '已移除这条速查。';
        } else if (action === 'paper-rename') {
          await referenceStore.rename(paperId, payload.title);
        } else if (action === 'paper-remove') {
          if (payload.confirm !== true) return false;
          pin.referenceUndo = await referenceStore.removePaper(paperId);
          pin.referenceNotice = '本文速查已删除。关闭窗口前可以撤销。';
        } else return false;
      }
      await refreshReferences();
      return { state: state(pin), success: true };
    } catch (error) {
      if (alive(pin)) {
        pin.referenceStatus = '';
        pin.referenceNotice = error?.message === 'reference-conflict'
          ? '这条定义已在另一窗口修改。你的输入已保留，请重新打开最新条目后合并。'
          : '这次操作未完成，输入和已保存的定义会保留。请重试。';
        publish(pin);
      }
      return false;
    }
  }

  function settingsForReading() {
    const settings = getSettings();
    if (!settings || !['full', 'translation-only'].includes(settings.setupMode)) {
      throw new Error('reading-setup-required');
    }
    return { settings, destination: readingDestination(settings) };
  }

  async function process(pin, kind, payload = {}, automatic = false) {
    if (!alive(pin) || disposed || ['translating', 'explaining', 'ocr', 'recognizing'].includes(pin.view.phase)) return;
    if (!automatic && payload.revision !== pin.revision) return;
    if (!automatic && pin.generation !== generation) {
      pin.generation = generation;
      pin.revision += 1;
      let destination = '';
      try { destination = settingsForReading().destination; } catch { /* settings can be repaired from this card */ }
      update(pin, { phase: 'review', destination, notice: '处理服务已经改变。请核对新的处理位置后继续。' });
      return;
    }
    let configuration;
    try { configuration = settingsForReading(); } catch {
      update(pin, { phase: 'error', notice: '请先在设置中选择并配置处理方式。' });
      return;
    }
    if (kind === 'explain' && !pin.view.translation) return;
    if (kind === 'explain' && configuration.settings.activeBackend === 'free_translate') {
      onOpenSettings();
      return;
    }
    const source = typeof payload.text === 'string' ? payload.text.trim() : pin.view.sourceText;
    if (!source || source.length > DEFAULTS.MAX_TEXT_LENGTH) {
      update(pin, { notice: `请保留 1–${DEFAULTS.MAX_TEXT_LENGTH} 个字符后继续。` });
      return;
    }
    const controller = new AbortController();
    pin.lookupController?.abort();
    pin.referenceController?.abort();
    pin.referenceCandidates = [];
    pin.referenceStatus = '';
    pin.lookupCache.clear();
    pin.controller = controller;
    const revision = ++pin.revision;
    const requestGeneration = generation;
    const requestPaperId = pin.view.paperId;
    update(pin, { phase: kind === 'translate' ? 'translating' : 'explaining',
      sourceText: source, destination: configuration.destination, notice: '',
      explainSupported: configuration.settings.activeBackend !== 'free_translate',
      ...(kind === 'translate' ? { translation: '', explanations: null, lookup: null, lookupStatus: '', lookupNotice: '' } : {}) });
    try {
      if (kind === 'translate') {
        const segments = payload.retryFailed && pin.view.segments.length
          ? pin.view.segments.map((segment) => ({ ...segment, status: segment.status === 'done' ? 'done' : 'pending' }))
          : readingSegments(source);
        const active = () => alive(pin) && !controller.signal.aborted
          && pin.revision === revision && generation === requestGeneration;
        const report = () => {
          if (active()) update(pin, { segments: segments.map((segment) => ({ ...segment })),
            translation: segments.filter((segment) => segment.status === 'done').map((segment) => segment.translation).join('\n\n') });
        };
        const queue = segments.filter((segment) => segment.status !== 'done');
        report();
        const worker = async () => {
          while (active() && queue.length) {
            const segment = queue.shift();
            if (isMathOnly(segment.source)) {
              segment.translation = segment.source;
              segment.terms = [];
              segment.status = 'done';
              segment.error = '';
              report();
              continue;
            }
            segment.status = 'translating';
            report();
            try {
              const result = await processReadingText({ text: segment.source, kind: 'translate', withTerms: true,
                withReferences: Boolean(referenceStore && requestPaperId),
                settingsSnapshot: configuration.settings, signal: controller.signal });
              if (!active()) return;
              segment.translation = result.translation;
              segment.terms = result.terms || [];
              segment.referenceCandidates = pin.view.paperId === requestPaperId ? result.references || [] : [];
              segment.status = 'done';
              segment.error = '';
            } catch (error) {
              if (!active()) return;
              segment.status = 'error';
              segment.error = error?.message === 'reading-invalid-output'
                ? '这一段的译文不完整，请重试。' : classifyError(error, configuration.settings.activeBackend);
            }
            report();
          }
        };
        await Promise.all([worker(), worker()]);
        if (!active()) return;
        const failed = segments.filter((segment) => segment.status === 'error').length;
        update(pin, { phase: failed ? (pin.view.translation ? 'partial' : 'error') : 'done',
          notice: failed ? `${failed} 段翻译未完成。已完成的译文会保留。` : '' });
        return;
      }
      const result = await processReadingText({ text: source, kind,
        settingsSnapshot: configuration.settings, signal: controller.signal });
      if (!alive(pin) || controller.signal.aborted || pin.revision !== revision || generation !== requestGeneration) return;
      update(pin, { ...result, phase: 'done' });
    } catch (error) {
      if (!alive(pin) || controller.signal.aborted || pin.revision !== revision) return;
      update(pin, { phase: pin.view.translation ? 'done' : 'error',
        notice: error?.message === 'reading-invalid-output' || error instanceof SyntaxError
          ? '返回内容不完整或引用无法匹配原文，请重试。'
          : classifyError(error, configuration.settings.activeBackend) });
    } finally {
      if (pin.controller === controller) pin.controller = null;
    }
  }

  async function lookup(pin, payload) {
    if (!alive(pin) || disposed || !['done', 'partial', 'translating'].includes(pin.view.phase)
      || payload.revision !== pin.revision) return;
    const segment = pin.view.segments.find((item) => item.id === payload.segmentId);
    if (!segment || !Number.isSafeInteger(payload.start) || !Number.isSafeInteger(payload.end)
      || payload.start < 0 || payload.end <= payload.start || payload.end > segment.source.length
      || payload.end - payload.start > 1500) throw new Error('Invalid reading selection');
    const quote = segment.source.slice(payload.start, payload.end);
    if (!quote.trim()) return;
    const local = referenceLookup(pin, quote);
    if (paperFor(pin) && (local.definitions.length || isNotation(quote))) {
      pin.lookupController?.abort();
      pin.lookupSequence += 1;
      update(pin, { lookup: local, lookupStatus: 'done', lookupNotice: '', saveStatus: '', savedCardId: null });
      return;
    }
    if (pin.generation !== generation) {
      update(pin, { lookupStatus: 'error', lookupNotice: '处理服务已改变。重新翻译后可查询词句。' });
      return;
    }
    const configuration = settingsForReading();
    pin.lookupController?.abort();
    const sequence = ++pin.lookupSequence;
    const key = `${payload.segmentId}:${payload.start}:${payload.end}`;
    const cached = pin.lookupCache.get(key);
    update(pin, { lookup: cached || { quote }, lookupStatus: cached ? 'done' : 'loading', lookupNotice: '', saveStatus: '', savedCardId: null });
    if (cached) return;
    const controller = new AbortController();
    pin.lookupController = controller;
    try {
      const result = await processReadingText({ text: pin.view.sourceText, kind: 'lookup', selection: quote,
        settingsSnapshot: configuration.settings, signal: controller.signal });
      if (!alive(pin) || controller.signal.aborted || sequence !== pin.lookupSequence || pin.generation !== generation) return;
      pin.lookupCache.set(key, result.lookup);
      if (pin.lookupCache.size > 30) pin.lookupCache.delete(pin.lookupCache.keys().next().value);
      update(pin, { lookup: result.lookup, lookupStatus: 'done' });
    } catch (error) {
      if (!alive(pin) || controller.signal.aborted || sequence !== pin.lookupSequence) return;
      update(pin, { lookupStatus: 'error', lookupNotice: error?.message === 'reading-invalid-output' || error instanceof SyntaxError
        ? '这次解释未能匹配所选原文，请重试。' : classifyError(error, configuration.settings.activeBackend) });
    } finally {
      if (pin.lookupController === controller) pin.lookupController = null;
    }
  }

  function maybeStart(pin) {
    if (referencesLoaded && pin.ready && pin.view.phase === 'waiting') void process(pin, 'translate', {}, true);
  }

  function openText(text) {
    if (disposed || !canCapture()) return { success: false, errorCode: 'reading-busy' };
    if (selecting) return { success: false, errorCode: 'reading-capture-pending' };
    if (typeof text !== 'string' || !text.trim() || text.length > DEFAULTS.MAX_TEXT_LENGTH) {
      return { success: false, errorCode: 'reading-invalid-input' };
    }
    if (pins.size >= MAX_PINS) return { success: false, errorCode: 'reading-card-limit' };
    let configuration;
    try { configuration = settingsForReading(); } catch {
      return { success: false, errorCode: 'reading-setup-required' };
    }
    const pin = createPin(null);
    update(pin, { sourceText: text.trim(), phase: 'waiting', destination: configuration.destination,
      formulaSupported: false, explainSupported: configuration.settings.activeBackend !== 'free_translate' });
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.hide();
    maybeStart(pin);
    return { success: true, pinned: true };
  }

  async function recognizeFormulas(pin, draft) {
    if (!alive(pin) || disposed || !recognizeReadingFormulas
      || !['done', 'partial', 'error', 'review'].includes(pin.view.phase)) return false;
    if (pin.generation !== generation) {
      pin.generation = generation;
      pin.revision += 1;
      update(pin, { phase: 'review', notice: '处理服务已经改变，请核对后再次选择识别公式。' });
      return false;
    }
    const settings = getSettings();
    if (!formulaRecognitionAvailable(settings)) return false;
    const controller = new AbortController();
    pin.lookupController?.abort();
    pin.lookupSequence += 1;
    pin.lookupCache.clear();
    pin.controller = controller;
    const revision = ++pin.revision;
    const requestGeneration = generation;
    update(pin, { phase: 'recognizing', formulaStatus: 'loading', imageSent: true,
      ...(typeof draft === 'string' ? { sourceText: draft } : {}),
      lookup: null, lookupStatus: '', lookupNotice: '', notice: '',
      formulaNotice: '正在向 DeepSeek 发送本次截图，转写文字与公式…' });
    const active = () => alive(pin) && !controller.signal.aborted
      && pin.revision === revision && generation === requestGeneration;
    try {
      const result = await recognizeReadingFormulas({ image: pin.view.image, settingsSnapshot: settings, signal: controller.signal });
      if (!active()) return false;
      update(pin, { sourceText: result.text, phase: 'review', formulaStatus: 'done', segments: [], translation: '',
        formulaNotice: result.uncertain.length ? `需要核对：${result.uncertain.join('；')}` : '转写已完成。请对照原图检查符号、上下标和公式边界。',
        notice: '公式识别结果待核对。确认后才会翻译与解释。' });
      return true;
    } catch (error) {
      if (!active()) return false;
      update(pin, { phase: 'review', formulaStatus: 'error',
        formulaNotice: error?.message === 'formula-invalid-output' || error instanceof SyntaxError
          ? '公式转写不完整，原识别文字已保留。可重试或手动校正。'
          : `公式识别未完成。${classifyError(error, 'deepseek')}` });
      return false;
    } finally {
      if (pin.controller === controller) pin.controller = null;
    }
  }

  async function capture() {
    if (disposed || !canCapture()) return { success: false, cancelled: true };
    if (!captureSupported) {
      const error = 'Windows 预览暂不支持截图识字。请复制英文后使用剪贴板阅读，或粘贴文字开始阅读。';
      onError(error);
      return { success: false, error };
    }
    if (selecting) return { success: false, error: '框选正在进行，请先完成或按 Esc 取消。' };
    if (pins.size >= MAX_PINS) {
      onError(`已经有 ${MAX_PINS} 张阅读卡片，请关闭不用的卡片后再截图。`);
      return { success: false, cancelled: true };
    }
    try { settingsForReading(); } catch {
      onOpenSettings();
      return { success: false, cancelled: true };
    }
    const controller = new AbortController();
    selecting = controller;
    let file = null;
    let hidden = [];
    let pin = null;
    try {
      const permission = await requestCapturePermission();
      if (!permission.granted) {
        onError(`请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 ${captureAppName}，然后完全退出并重新打开应用。若开关已经打开，请先重启当前应用。`);
        return { success: false, cancelled: true };
      }
      if (controller.signal.aborted || disposed) return { success: false, cancelled: true };
      hidden = [...pins.values()].map((item) => item.window);
      const main = getMainWindow();
      if (main && !main.isDestroyed()) hidden.push(main);
      hidden = hidden.filter((window) => window.isVisible());
      for (const window of hidden) window.hide();
      // Let the window server remove the cards before the native selector snapshots the screen.
      await new Promise((resolve) => setTimeout(resolve, 80));
      file = await captureRegion(undefined, { signal: controller.signal });
      if (controller.signal.aborted || disposed) return { success: false, cancelled: true };
      if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new Error('reading-image-too-large');
      const image = `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`;
      pin = createPin(image);
      pin.controller = controller;
      for (const window of hidden) {
        if (window !== main && !window.isDestroyed()) window.showInactive();
      }
      hidden = [];
      // The selection mutex can be released while this card performs OCR.
      if (selecting === controller) selecting = null;
      showPendingCards();
      const ocr = await performOCR(file, { signal: controller.signal });
      if (!alive(pin) || controller.signal.aborted) return { success: true, pinned: true };
      if (typeof ocr.text !== 'string' || !ocr.text.trim()) {
        update(pin, { phase: 'error', notice: '没有识别到清晰文字，请重新框选一段英文。' });
      } else if (ocr.text.length > DEFAULTS.MAX_TEXT_LENGTH) {
        update(pin, { phase: 'error', notice: '这次框选的文字太多，请缩小到一段或一页后重试。' });
      } else {
        const document = readingTextFromOcr(ocr);
        const review = assessOcrReview({ source: 'ocr', text: ocr.text, capture: ocr });
        pin.controller = null;
        let destination = '';
        try { destination = settingsForReading().destination; } catch { /* continue through explicit review */ }
        const changed = pin.generation !== generation;
        const mathReview = needsMathReview(document.text);
        const localFormula = ocr.formulaOcr;
        const formulaIssue = localFormula?.status === 'failed' || (localFormula?.status === 'unavailable' && mathReview);
        const formulaNotice = localFormula?.count
          ? `已在本机识别 ${localFormula.count} 处公式${localFormula.uncertain ? `（${localFormula.uncertain} 处需留意）` : ''}。请对照原图核对。`
          : formulaIssue ? '本地公式识别组件未就绪，本次只完成了文字识别。若原文包含公式，请先对照截图校正。' : '';
        pin.generation = generation;
        update(pin, { sourceText: document.text, destination,
          formulaNotice, formulaStatus: localFormula?.count ? 'local' : '',
          formulaSupported: Boolean(recognizeReadingFormulas && formulaRecognitionAvailable(getSettings())),
          phase: review.required || changed || document.layoutReview || mathReview || formulaIssue ? 'review' : 'waiting',
          notice: review.required ? '部分文字识别不够清楚。请对照截图核对，确认前不会发送文字。'
            : document.layoutReview ? '这张截图可能包含多栏或表格。请对照截图确认阅读顺序，或重新框选其中一栏。'
            : formulaNotice || (mathReview ? '检测到数学符号。请对照原始截图核对符号、上下标和分式。'
              : changed ? '处理服务已经改变，请核对处理位置后继续。' : '') });
        maybeStart(pin);
      }
      return { success: true, pinned: true };
    } catch (error) {
      if (controller.signal.aborted || error?.isCancellation) return { success: false, cancelled: true };
      if (pin && alive(pin)) {
        update(pin, { phase: 'error', notice: '文字识别没有完成，请重新框选清晰的一段英文。' });
        return { success: true, pinned: true };
      }
      onError(error.code === 'capture-timeout' ? '框选等待时间较长，已结束本次截图。请按快捷键重新框选。'
        : '截图没有完成，请重试。若仍然失败，可在设置中检查屏幕录制权限。');
      return { success: false, cancelled: true };
    } finally {
      if (file) { try { await fs.unlink(file); } catch { /* temporary cleanup is retried at application exit */ } }
      for (const window of hidden) if (!disposed && !window.isDestroyed()) window.showInactive();
      if (selecting === controller) selecting = null;
      showPendingCards();
      if (pin?.controller === controller) pin.controller = null;
    }
  }

  ipcMain.handle('reading-pin:action', (event, action, payload) => {
    const pin = pins.get(event.sender.id);
    if (!pin || event.sender !== pin.window.webContents
      || event.senderFrame !== pin.window.webContents.mainFrame
      || event.senderFrame.url !== ENTRY_URL) throw new Error('Untrusted reading card');
    if (action === 'ready') {
      pin.ready = true;
      setImmediate(() => { if (alive(pin)) maybeStart(pin); });
      return { state: state(pin) };
    }
    if (action === 'close') { close(pin); return true; }
    if (action.startsWith('reference-') || action.startsWith('paper-')) return referenceAction(pin, action, payload);
    if (action === 'library') { onOpenLibrary(pin.view.savedCardId); return true; }
    if (action === 'recognize-formulas') {
      if (!payload || payload.revision !== pin.revision || payload.sendImage !== true) return false;
      if (payload.text !== undefined && (typeof payload.text !== 'string' || payload.text.length > DEFAULTS.MAX_TEXT_LENGTH)) return false;
      return recognizeFormulas(pin, payload.text);
    }
    if (action === 'save-term') {
      if (!saveTermCard || pin.view.lookupStatus !== 'done' || !pin.view.lookup?.meaning || pin.view.saveStatus === 'saving') return false;
      const sequence = pin.lookupSequence;
      const lookup = { ...pin.view.lookup };
      const term = pin.view.segments.flatMap((segment) => segment.terms || []).find((item) => item.quote === lookup.quote);
      const source = lookup.reference ? lookup.referenceSource : pin.view.sourceText;
      const hit = lookup.reference ? referenceOccurrences(source, lookup.quote)[0] : null;
      const input = { term: hit ? source.slice(hit.start, hit.end) : lookup.quote, label: term?.label || '', meaning: lookup.meaning,
        context: lookup.note || '', source, kind: lookup.contextual ? 'concept' : 'translation' };
      update(pin, { saveStatus: 'saving' });
      return saveTermCard(input).then((result) => {
        if (alive(pin) && pin.lookupSequence === sequence) update(pin, { saveStatus: 'saved', savedCardId: result.card.id });
        return true;
      }).catch(() => {
        if (alive(pin) && pin.lookupSequence === sequence) update(pin, { saveStatus: 'error', lookupNotice: '卡片未能保存到本地，请重试。' });
        return false;
      });
    }
    if (action === 'collapse') {
      const collapsed = !pin.view.collapsed;
      if (collapsed) {
        pin.expandedBounds = pin.window.getBounds();
        pin.window.setMinimumSize(Math.min(280, pin.expandedBounds.width), 46);
        pin.window.setSize(pin.expandedBounds.width, 46);
        pin.window.setResizable(false);
      } else {
        const bounds = pin.window.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const height = Math.min(pin.expandedBounds.height, area.height);
        pin.window.setResizable(true);
        pin.window.setMinimumSize(Math.min(280, area.width), Math.min(220, area.height));
        pin.window.setBounds({ ...bounds, height, y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) });
      }
      update(pin, { collapsed });
      return { state: state(pin) };
    }
    if (action === 'fit') {
      if (pin.fitted || pin.manuallyResized || pin.view.collapsed || pin.view.phase !== 'done'
        || !Number.isFinite(payload?.height)) return false;
      pin.fitted = true;
      const bounds = pin.window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const height = Math.round(Math.max(Math.min(280, area.height), Math.min(payload.height, 720, area.height)));
      pin.window.setBounds({ ...bounds, height, y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) });
      return true;
    }
    if (action === 'copy') {
      if (pin.view.phase !== 'done' || !pin.view.translation) return false;
      copyText(pin.view.translation);
      return true;
    }
    if (action === 'review') {
      if (!['done', 'partial', 'error'].includes(pin.view.phase)) return false;
      pin.lookupController?.abort();
      pin.referenceController?.abort();
      pin.referenceStatus = '';
      update(pin, { phase: 'review', lookup: null, lookupStatus: '', lookupNotice: '', notice: '' });
      return true;
    }
    if (action === 'dismiss-lookup') {
      pin.lookupController?.abort();
      pin.lookupSequence += 1;
      update(pin, { lookup: null, lookupStatus: '', lookupNotice: '' });
      return true;
    }
    if (action === 'lookup') {
      if (!payload || typeof payload !== 'object') throw new Error('Invalid reading selection');
      return lookup(pin, payload);
    }
    if (action === 'toggle-top') {
      pin.window.setAlwaysOnTop(!pin.view.topmost, 'floating');
      update(pin, { topmost: !pin.view.topmost });
      return { state: state(pin) };
    }
    if (action === 'translate' || action === 'explain') {
      if (!payload || typeof payload !== 'object' || !Number.isSafeInteger(payload.revision)
        || (payload.text !== undefined && (typeof payload.text !== 'string' || payload.text.length > DEFAULTS.MAX_TEXT_LENGTH))) {
        throw new Error('Invalid reading request');
      }
      void process(pin, action, payload);
      return true;
    }
    if (action === 'retake') { void capture().then((result) => { if (result.pinned && alive(pin)) close(pin); }); return true; }
    if (action === 'settings') { onOpenSettings(); return true; }
    throw new Error('Unsupported reading action');
  });

  function invalidateProcessing() {
    generation += 1;
    for (const pin of pins.values()) {
      if (pin.view.referenceOnly) continue;
      update(pin, { formulaSupported: Boolean(recognizeReadingFormulas && formulaRecognitionAvailable(getSettings())) });
      pin.lookupController?.abort();
      pin.referenceController?.abort();
      pin.referenceStatus = '';
      pin.lookupSequence += 1;
      pin.lookupCache.clear();
      if (pin.view.lookupStatus === 'loading') update(pin, { lookupStatus: 'error', lookupNotice: '处理服务已改变，请重新翻译后查询。' });
      if (pin.view.phase === 'ocr' || pin.view.phase === 'done' || pin.view.phase === 'partial') continue;
      pin.controller?.abort();
      pin.controller = null;
      pin.revision += 1;
      update(pin, { phase: 'review', notice: '处理服务已经改变；继续前请重新核对处理位置。' });
      setImmediate(() => {
        if (!alive(pin) || pin.view.phase !== 'review') return;
        let destination = '';
        try { destination = settingsForReading().destination; } catch { /* settings can be repaired */ }
        pin.generation = generation;
        update(pin, { destination });
      });
    }
  }

  function clear() {
    generation += 1;
    selecting?.abort();
    for (const pin of [...pins.values()]) close(pin);
  }
  return { capture, openText, openReferences, invalidateProcessing, clear,
    dispose() { disposed = true; clear(); ipcMain.removeHandler('reading-pin:action'); },
  };
}

module.exports = { createReadingPins, cardBounds, readingDestination };
