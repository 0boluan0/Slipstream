import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Camera,
  ClipboardText,
  GearSix,
  ListChecks,
  Minus,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import ResultDisplay from './ResultDisplay';
import LoadingOverlay from './LoadingOverlay';
import { useIpc } from '../hooks/useIpc';
import { useClipboard } from '../hooks/useClipboard';
import { createRequestCoordinator } from '../hooks/requestCoordinator.mjs';
import { PREVIEW_ACTION_BRIEF, PREVIEW_CAPTURE, PREVIEW_SOURCE_TEXT } from '../utils/previewData';
import { STATUS, IPC_CHANNELS, DEFAULTS } from '../../shared/constants';

const RESULT_DEMO = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('demo') === 'result';

if (RESULT_DEMO) document.documentElement.dataset.previewTheme = 'light';

function getAutomaticVerificationKey(brief) {
  const eligible = (brief?.verifications || []).filter((item) => (
    item.status === 'pending'
    && item.lookup
    && Array.isArray(item.lookup.candidateUrls)
    && item.lookup.candidateUrls.length > 0
  ));
  if (eligible.length === 0) return null;
  const sourceKey = brief.source?.sha256 || brief.source?.id || String(brief.source?.length || 'unknown');
  const requestKey = eligible
    .map((item) => `${item.id}:${item.lookup.candidateUrls.join(',')}`)
    .sort()
    .join('|');
  return `${sourceKey}:${requestKey}`;
}

export default function FloatingPanel({ onOpenSettings, settingsController }) {
  const [inputText, setInputText] = useState('');
  const [processedSourceText, setProcessedSourceText] = useState('');
  const [result, setResult] = useState('');
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [processingTimeMs, setProcessingTimeMs] = useState(null);
  const [savedTerms, setSavedTerms] = useState([]);
  const [warning, setWarning] = useState('');
  const [sourceType, setSourceType] = useState('manual');
  const [captureMeta, setCaptureMeta] = useState({ confidence: null, blocks: [] });
  const [isVerifying, setIsVerifying] = useState(false);
  const debounceRef = useRef(null);
  const requestCoordinatorRef = useRef(null);
  const runProcessingRef = useRef(null);
  const triggerProcessingRef = useRef(null);
  const textareaRef = useRef(null);
  const autoVerificationRef = useRef(null);

  if (!requestCoordinatorRef.current) requestCoordinatorRef.current = createRequestCoordinator();

  const { invoke, on } = useIpc();
  const { clipboardEvent, clearClipboard } = useClipboard();
  const { settings, updateSettings } = settingsController;

  const setWindowMode = useCallback((mode) => {
    return invoke(IPC_CHANNELS.WINDOW_SET_MODE || 'window:set-mode', mode).catch(() => false);
  }, [invoke]);

  useEffect(() => {
    invoke(IPC_CHANNELS.TERMS_GET)
      .then((terms) => setSavedTerms(Array.isArray(terms) ? terms : []))
      .catch(() => {});
  }, [invoke]);

  useEffect(() => {
    if (!RESULT_DEMO) return;
    setInputText(PREVIEW_SOURCE_TEXT);
    setProcessedSourceText(PREVIEW_SOURCE_TEXT);
    setBrief(PREVIEW_ACTION_BRIEF);
    setResult('');
    setCaptureMeta(PREVIEW_CAPTURE);
    setSourceType('ocr');
    setProcessingTimeMs(6800);
    setStatus(STATUS.DONE);
    setWindowMode('result');
  }, [setWindowMode]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [inputText]);

  useEffect(() => {
    if (RESULT_DEMO) return undefined;
    if (clipboardEvent.error) {
      setBrief(null);
      setResult('');
      setError(clipboardEvent.error);
      setWarning('');
      setStatus(STATUS.ERROR);
      return undefined;
    }

    const clipboardText = clipboardEvent.text;
    if (!clipboardText?.trim()) return undefined;

    setInputText(clipboardText);
    setSourceType(clipboardEvent.source === 'ocr' ? 'ocr' : 'clipboard');
    setCaptureMeta({
      confidence: clipboardEvent.confidence ?? null,
      blocks: Array.isArray(clipboardEvent.blocks) ? clipboardEvent.blocks : [],
    });
    setError(null);

    const warnings = [];
    if (clipboardEvent.truncated) warnings.push(`文本过长，只使用前 ${DEFAULTS.MAX_TEXT_LENGTH} 个字符。`);
    if (clipboardEvent.source === 'ocr' && typeof clipboardEvent.confidence === 'number' && clipboardEvent.confidence < 0.5) {
      warnings.push(`OCR 识别置信度较低（${Math.round(clipboardEvent.confidence * 100)}%），请先核对原文。`);
    }
    setWarning(warnings.join(' '));

    if (settings.clipboardMonitoring || clipboardEvent.source !== 'monitor') {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        triggerProcessingRef.current?.(clipboardText, {
          truncated: clipboardEvent.truncated,
          source: clipboardEvent.source,
          capture: {
            confidence: clipboardEvent.confidence ?? null,
            blocks: Array.isArray(clipboardEvent.blocks) ? clipboardEvent.blocks : [],
          },
        });
      }, 400);
    }

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [clipboardEvent, settings.clipboardMonitoring]);

  useEffect(() => {
    const unsubscribe = on(IPC_CHANNELS.OCR_ERROR, (payload) => {
      const message = typeof payload === 'string' ? payload : (payload?.error || '没有识别到清晰文字');
      setBrief(null);
      setResult('');
      setError(message);
      setStatus(STATUS.ERROR);
      setWindowMode('capture');
    });
    return unsubscribe;
  }, [on, setWindowMode]);

  const runProcessing = useCallback(async (task) => {
    const { text, options } = task.payload;
    let response;
    let failure;

    try {
      response = await invoke(IPC_CHANNELS.LLM_PROCESS, {
        text,
        backend: settings.activeBackend,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        source: options.source || 'manual',
        capture: options.capture || null,
        verificationApproved: Boolean(options.verificationApproved),
      });
    } catch (processingError) {
      failure = typeof processingError === 'string' ? processingError : (processingError?.message || '处理失败');
    }

    const { apply, next } = requestCoordinatorRef.current.complete(task);
    if (apply) {
      if (response?.success && (response.brief || response.text)) {
        setProcessedSourceText(text);
        setBrief(response.brief || null);
        setResult(response.text || '');
        setStatus(STATUS.DONE);
        setProcessingTimeMs(response.processingTimeMs || null);
        setWindowMode('result');
      } else {
        setError(failure || response?.error || '处理失败');
        setStatus(STATUS.ERROR);
        setWindowMode('capture');
      }
    }

    if (next && runProcessingRef.current) runProcessingRef.current(next);
  }, [invoke, setWindowMode, settings.activeBackend, settings.activeModel, settings.customPrompt, settings.languageHint]);

  useEffect(() => {
    runProcessingRef.current = runProcessing;
  }, [runProcessing]);

  const triggerProcessing = useCallback((text, options = {}) => {
    let textToProcess = text || inputText;
    if (!textToProcess?.trim()) return;

    const warnings = [];
    if (options.truncated) {
      warnings.push(`文本过长，只使用前 ${DEFAULTS.MAX_TEXT_LENGTH} 个字符。`);
    } else if (textToProcess.length > DEFAULTS.MAX_TEXT_LENGTH) {
      textToProcess = textToProcess.slice(0, DEFAULTS.MAX_TEXT_LENGTH);
      warnings.push(`文本过长，只使用前 ${DEFAULTS.MAX_TEXT_LENGTH} 个字符。`);
    }
    if (options.source === 'ocr' && typeof options.capture?.confidence === 'number' && options.capture.confidence < 0.5) {
      warnings.push(`OCR 识别置信度较低（${Math.round(options.capture.confidence * 100)}%），请核对高亮原文。`);
    }

    setWarning(warnings.join(' '));
    setStatus(STATUS.PROCESSING);
    setError(null);
    setBrief(null);
    setResult('');
    setProcessingTimeMs(null);
    const task = requestCoordinatorRef.current.schedule({ text: textToProcess, options });
    if (task) runProcessing(task);
  }, [inputText, runProcessing]);

  useEffect(() => {
    triggerProcessingRef.current = triggerProcessing;
  }, [triggerProcessing]);

  const handleScreenshot = useCallback(async () => {
    try {
      setError(null);
      setWarning('');
      setStatus(STATUS.PROCESSING);
      const screenshot = await invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE);
      if (screenshot?.cancelled) {
        setStatus(STATUS.IDLE);
        return;
      }
      if (screenshot?.success && screenshot.text) {
        const capture = {
          confidence: screenshot.confidence ?? null,
          blocks: Array.isArray(screenshot.blocks) ? screenshot.blocks : [],
        };
        setInputText(screenshot.text);
        setSourceType('ocr');
        setCaptureMeta(capture);
        triggerProcessing(screenshot.text, { source: 'ocr', capture });
      } else {
        setError(screenshot?.error || '没有识别到清晰文字');
        setStatus(STATUS.ERROR);
      }
    } catch (screenshotError) {
      setError(typeof screenshotError === 'string' ? screenshotError : (screenshotError?.message || '截图失败'));
      setStatus(STATUS.ERROR);
    }
  }, [invoke, triggerProcessing]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await invoke(IPC_CHANNELS.CLIPBOARD_READ);
      if (text) {
        setInputText(text);
        setSourceType('clipboard');
        setCaptureMeta({ confidence: null, blocks: [] });
        setError(null);
      } else {
        setError('剪贴板里没有可解释的文本');
        setStatus(STATUS.ERROR);
      }
    } catch {
      setError('无法读取剪贴板，请手动粘贴或使用截图功能');
      setStatus(STATUS.ERROR);
    }
  }, [invoke]);

  const handleClear = useCallback(() => {
    requestCoordinatorRef.current.invalidate();
    if (status === STATUS.PROCESSING) invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => {});
    setInputText('');
    setProcessedSourceText('');
    setBrief(null);
    setResult('');
    setError(null);
    setWarning('');
    setStatus(STATUS.IDLE);
    setProcessingTimeMs(null);
    setSourceType('manual');
    setCaptureMeta({ confidence: null, blocks: [] });
    setIsVerifying(false);
    clearClipboard();
    setWindowMode('capture');
  }, [clearClipboard, invoke, setWindowMode, status]);

  const handleSaveTerm = useCallback(async (term) => {
    const firstEvidence = term?.provenance?.evidence?.[0];
    const savedTerm = await invoke(IPC_CHANNELS.TERMS_SAVE, {
      term: term.surface,
      definition: term.explanation,
      evidence: firstEvidence?.quote || '',
    });
    setSavedTerms((terms) => [savedTerm, ...terms.filter((item) => item.id !== savedTerm.id)]);
  }, [invoke]);

  const handleDeleteTerm = useCallback(async (id) => {
    await invoke(IPC_CHANNELS.TERMS_DELETE, id);
    setSavedTerms((terms) => terms.filter((term) => term.id !== id));
  }, [invoke]);

  const verifyOfficialSources = useCallback(async () => {
    if (!processedSourceText || isVerifying || settings.verificationPolicy === 'local-only') return;
    setIsVerifying(true);
    setWarning('');
    try {
      const response = await invoke(IPC_CHANNELS.LLM_PROCESS, {
        text: processedSourceText,
        backend: settings.activeBackend,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        source: sourceType,
        capture: captureMeta,
        verificationApproved: true,
      });
      if (!response?.success || !response.brief) throw new Error(response?.error || '官方来源核验失败');
      setBrief(response.brief);
      setResult(response.text || result);
      setProcessingTimeMs(response.processingTimeMs || processingTimeMs);
    } catch (verificationError) {
      setWarning(verificationError?.message || '官方来源核验失败，请稍后重试。');
    } finally {
      setIsVerifying(false);
    }
  }, [captureMeta, invoke, isVerifying, processedSourceText, processingTimeMs, result, settings.activeBackend, settings.activeModel, settings.customPrompt, settings.languageHint, settings.verificationPolicy, sourceType]);

  useEffect(() => {
    if (status !== STATUS.DONE || settings.verificationPolicy !== 'official-auto') return;
    const key = getAutomaticVerificationKey(brief);
    if (!key) return;
    if (autoVerificationRef.current === key) return;
    autoVerificationRef.current = key;
    verifyOfficialSources();
  }, [brief, processedSourceText.length, settings.verificationPolicy, status, verifyOfficialSources]);

  const sourceLabel = sourceType === 'ocr' ? '截图 OCR' : sourceType === 'clipboard' || sourceType === 'monitor' ? '剪贴板' : '手动输入';
  const institution = brief?.terms?.find((term) => term.kind === 'institution')?.surface;
  const sourceDescriptor = institution ? `${sourceLabel} · ${institution}` : sourceLabel;
  const isDone = status === STATUS.DONE && Boolean(brief || result);
  const preference = settings.resultOrder === 'translation-first' ? 'translation' : 'action';
  const isFreeTranslate = settings.activeBackend === 'free_translate';
  const privacyLabel = settings.activeBackend === 'ollama'
    ? '本地处理 · 隐私优先'
    : isFreeTranslate
      ? '在线基础翻译 · 会发送原文'
      : `在线模型 ${settings.activeBackend} · 会发送原文`;
  const sourcePreview = inputText.replace(/\s+/g, ' ').trim().slice(0, 160);
  const capturePlaceholder = settings.clipboardMonitoring
    ? '粘贴英文，或复制后等待自动检测…'
    : '粘贴英文邮件、网页段落或课程材料…';

  return (
    <div className={`slipstream-shell${isDone ? ' is-result' : ' is-capture'}`}>
      <header className="app-header">
        <div className="app-brand" style={{ WebkitAppRegion: 'drag' }}>
          <strong>Slipstream</strong>
          {isDone && <><span className="header-divider" /><span>{sourceDescriptor}</span></>}
        </div>
        <div className="app-header__actions" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className="privacy-status"><ShieldCheck size={18} weight="fill" />{privacyLabel}</span>
          {isDone && (
            <div className="preference-switch" aria-label="结果显示顺序">
              <button type="button" className={preference === 'action' ? 'is-active' : ''} onClick={() => updateSettings('resultOrder', 'action-first').catch(() => {})} aria-pressed={preference === 'action'}>
                <ListChecks size={18} />行动优先
              </button>
              <button type="button" className={preference === 'translation' ? 'is-active' : ''} onClick={() => updateSettings('resultOrder', 'translation-first').catch(() => {})} aria-pressed={preference === 'translation'}>
                <BookOpen size={18} />翻译优先
              </button>
            </div>
          )}
          <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="打开设置" title="设置">
            <GearSix size={23} />
          </button>
          <button type="button" className="icon-button" onClick={() => invoke(IPC_CHANNELS.WINDOW_HIDE)} aria-label="隐藏窗口" title="隐藏窗口">
            <Minus size={22} />
          </button>
        </div>
      </header>

      {isDone ? (
        <ResultDisplay
          brief={brief}
          result={result}
          sourceText={processedSourceText || inputText}
          sourceLabel={sourceDescriptor}
          captureConfidence={captureMeta.confidence}
          warning={warning}
          processingTimeMs={processingTimeMs}
          preference={preference}
          verificationPolicy={settings.verificationPolicy || 'ask'}
          isVerifying={isVerifying}
          onVerifyOfficialSources={verifyOfficialSources}
          onOpenExternal={(url) => invoke(IPC_CHANNELS.EXTERNAL_OPEN, url)}
          onRetry={() => triggerProcessing(processedSourceText || inputText, { source: sourceType, capture: captureMeta })}
          onRecapture={handleScreenshot}
          onNewCapture={handleClear}
          onSaveTerm={handleSaveTerm}
          savedTerms={savedTerms}
          onDeleteTerm={handleDeleteTerm}
        />
      ) : (
        <main className="capture-view">
          {!settings.privacyNoticeSeen && (
            <div className="privacy-notice" role="note">
              <ShieldCheck size={21} weight="fill" />
              <span>只有你主动处理的文字才会发送到所选后端；剪贴板自动检测默认关闭。</span>
              <button type="button" onClick={() => updateSettings('privacyNoticeSeen', true).catch(() => {})}>知道了</button>
            </div>
          )}

          {status === STATUS.PROCESSING ? (
            <LoadingOverlay visible sourcePreview={sourcePreview} onCancel={handleClear} translationOnly={isFreeTranslate} />
          ) : (
            <section className="capture-card">
              <div className="capture-heading">
                <span className="capture-heading__icon"><Sparkle size={24} weight="fill" /></span>
                <div>
                  <p className="eyebrow">捕获英文</p>
                  <h1>{isFreeTranslate ? '快速翻译完整原文' : '在当前工作流里，直接看懂并行动'}</h1>
                  <p>{isFreeTranslate
                    ? '在线基础翻译会发送原文，只按顺序返回翻译，不生成行动路径、术语解释或官方核验。'
                    : '保留完整原文，把翻译、术语和行动结论逐条连回证据。'}</p>
                </div>
              </div>

              {error && (
                <div className="error-card" role="alert">
                  <WarningCircle size={22} weight="fill" />
                  <div><strong>这次没有处理成功</strong><p>{error}</p></div>
                  <div className="error-card__actions">
                    {inputText.trim() && <button type="button" onClick={() => triggerProcessing()}>重试</button>}
                    <button type="button" onClick={handleScreenshot}>重新截图</button>
                    <button type="button" onClick={onOpenSettings}>检查设置</button>
                  </div>
                </div>
              )}

              <label className="capture-input">
                <span>原文</span>
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(event) => {
                    setInputText(event.target.value);
                    setSourceType('manual');
                    setError(null);
                    if (status === STATUS.ERROR) setStatus(STATUS.IDLE);
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      triggerProcessing();
                    }
                  }}
                  placeholder={capturePlaceholder}
                  aria-label="要解释的完整原文"
                />
                {inputText && <button type="button" className="capture-input__clear" onClick={handleClear}>清空</button>}
              </label>

              {warning && <p className="capture-warning"><WarningCircle size={17} />{warning}</p>}

              <div className="capture-methods">
                <button type="button" onClick={handleScreenshot}>
                  <span><Camera size={23} /></span>
                  <strong>框选截图</strong>
                  <small>按 {settings.screenshotShortcut || 'F2'} · 本地 OCR</small>
                </button>
                <button type="button" onClick={handlePaste}>
                  <span><ClipboardText size={23} /></span>
                  <strong>读取剪贴板</strong>
                  <small>复制后按 {settings.clipboardShortcut || 'Option + C'}</small>
                </button>
              </div>

              <button type="button" className="process-button" onClick={() => triggerProcessing()} disabled={!inputText.trim()}>
                <Sparkle size={20} weight="fill" />
                {isFreeTranslate ? '生成完整翻译' : '生成可追溯解释'}
                <ArrowRight size={19} />
              </button>

              <div className="shortcut-help">
                <span><kbd>{settings.screenshotShortcut || 'F2'}</kbd> 截图</span>
                <span><kbd>Command</kbd><kbd>Enter</kbd> 处理</span>
              </div>
            </section>
          )}

          <footer className="capture-footer">
            <ShieldCheck size={17} />
            <span>原文证据保留在本机；官方来源核验只在你允许时进行。</span>
          </footer>
        </main>
      )}
    </div>
  );
}
