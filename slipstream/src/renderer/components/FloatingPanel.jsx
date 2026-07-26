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
import {
  completeTaskForGeneration,
  createRequestCoordinator,
} from '../hooks/requestCoordinator.mjs';
import { PREVIEW_ACTION_BRIEF, PREVIEW_CAPTURE, PREVIEW_SOURCE_TEXT } from '../utils/previewData';
import {
  appendUniqueWarning,
  getProcessingConfigSignature,
  isProcessingConfigGenerationCurrent,
  PROCESSING_CONFIG_CHANGED_WARNING,
  resolveSnapshotWarning,
  shouldRestoreLastGoodAfterConfigChange,
  withVerificationApproval,
} from '../utils/processingConfig.mjs';
import { STATUS, IPC_CHANNELS, DEFAULTS } from '../../shared/constants';

const RESULT_DEMO = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('demo') === 'result';
const RESULT_DEMO_APPROVAL_ID = 'a'.repeat(64);
const USER_ERROR_MESSAGES = Object.freeze({
  'processing-busy': '已有任务正在处理，请稍候。',
  'processing-cancelled': '处理已取消。',
  'processing-invalid': '模型返回的内容未通过结构与证据校验。原文和上一份有效结果已保留，请重试或更换模型。',
  'processing-key-missing': '当前在线模型还没有配置 API Key。请打开设置添加后重试，原文已保留。',
  'processing-unauthorized': '当前服务拒绝了连接凭据。请在设置中重新保存并测试凭据；原文和上一份有效结果已保留。',
  'processing-rate-limited': '当前服务暂时限制了请求，或账户额度不足。请稍后重试并检查服务账户；原文和上一份有效结果已保留。',
  'processing-service-unavailable': '当前分析服务暂时不可用。请稍后重试；原文和上一份有效结果已保留。',
  'processing-unreachable': '无法连接当前分析服务。请检查网络或服务地址后重试；原文和上一份有效结果已保留。',
  'ollama-unavailable': '无法连接本机 Ollama。请确认 Ollama 已启动，并检查设置中的服务地址。',
  'ollama-runtime-failed': 'Ollama 已连接，但当前模型无法启动或生成结果。请更新 Ollama、释放内存或更换模型后重试；原文已保留。',
  'model-not-found': '当前模型不存在或尚未下载。请在设置中选择可用模型；使用 Ollama 时请先拉取该模型。',
  'processing-timeout': '模型响应超时。原文和上一份有效结果已保留，可直接重试或改用更快的模型。',
  'processing-failed': '处理失败。原文和上一份有效结果已保留，请检查模型设置和网络连接后重试。',
  'verification-busy': '已有官方核验任务正在处理，请稍候。',
  'verification-approval-invalid': '本次官方核验请求已失效，请重新分析原文后再试。',
  'verification-cancelled': '官方来源核验已取消。',
  'verification-failed': '官方来源核验失败，请稍后重试。',
  'screenshot-busy': '已有截图任务正在处理，请稍候。',
  'screenshot-empty': '没有识别到清晰文字，请重新截图并确保文字清晰。',
  'screenshot-permission-denied': '无法读取屏幕。请到“系统设置 → 隐私与安全性 → 屏幕录制”允许 Slipstream，然后重试。',
  'screenshot-ocr-failed': '截图已完成，但文字识别失败。请重新框选清晰文字；若仍失败，请检查应用安装是否完整。',
  'screenshot-failed': '截图失败。请重新尝试；如果系统没有出现框选光标，请检查屏幕录制权限。',
});
const PROCESSING_FAILURE_MESSAGE = USER_ERROR_MESSAGES['processing-failed'];
const VERIFICATION_FAILURE_MESSAGE = USER_ERROR_MESSAGES['verification-failed'];
const SCREENSHOT_FAILURE_MESSAGE = USER_ERROR_MESSAGES['screenshot-failed'];

function userErrorMessage(response, fallback) {
  return USER_ERROR_MESSAGES[response?.errorCode] || fallback;
}

function captureEventMessage(payload) {
  const message = typeof payload === 'string' ? payload : payload?.error;
  if (message?.startsWith('快捷键冲突：')) return '快捷键被其他应用占用，请在设置里更换。';
  if (message === '没有识别到清晰文字') return USER_ERROR_MESSAGES['screenshot-empty'];
  return SCREENSHOT_FAILURE_MESSAGE;
}

function sourceTooLongWarning(originalLength) {
  const length = Number.isSafeInteger(originalLength) ? originalLength : `超过 ${DEFAULTS.MAX_TEXT_LENGTH}`;
  return `原文共有 ${length} 个字符，超过单次处理上限 ${DEFAULTS.MAX_TEXT_LENGTH}。为避免遗漏，尚未开始分析；请删减为一段完整内容后重试。`;
}

if (RESULT_DEMO) document.documentElement.dataset.previewTheme = 'light';

async function hashSourceText(text) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${text.length}-${(hash >>> 0).toString(16)}`;
}

export default function FloatingPanel({ visible = true, onOpenSettings, settingsController }) {
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
  const [sourceMeta, setSourceMeta] = useState({ truncated: false, originalLength: null });
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationApprovalId, setVerificationApprovalId] = useState(null);
  const debounceRef = useRef(null);
  const requestCoordinatorRef = useRef(null);
  const runProcessingRef = useRef(null);
  const triggerProcessingRef = useRef(null);
  const textareaRef = useRef(null);
  const verificationRunRef = useRef({ token: 0, sourceHash: null });
  const lastGoodRef = useRef(null);
  const screenshotRunRef = useRef({ token: 0, inFlight: false });
  const activeProcessingRef = useRef(null);

  if (!requestCoordinatorRef.current) requestCoordinatorRef.current = createRequestCoordinator();

  const { invoke, on } = useIpc();
  const { clipboardEvent, clearClipboard } = useClipboard();
  const {
    settings,
    updateSettings,
    processingConfigRevision = 0,
    processingConfigGenerationRef,
  } = settingsController;
  const processingConfigSignature = getProcessingConfigSignature(settings);
  const processingConfigChangeKey = `${processingConfigSignature}\u0000${processingConfigRevision}`;
  const processingConfigEffectGeneration = processingConfigRevision;
  const previousProcessingConfigRef = useRef(processingConfigChangeKey);
  const initialProcessingConfigSignatureRef = useRef(processingConfigSignature);
  const previousVerificationPolicyRef = useRef(settings.verificationPolicy);

  const setWindowMode = useCallback((mode) => {
    return invoke(IPC_CHANNELS.WINDOW_SET_MODE || 'window:set-mode', mode).catch(() => false);
  }, [invoke]);

  useEffect(() => {
    if (previousVerificationPolicyRef.current === settings.verificationPolicy) return;
    previousVerificationPolicyRef.current = settings.verificationPolicy;
    setVerificationApprovalId(null);
    lastGoodRef.current = withVerificationApproval(lastGoodRef.current, null);
    if (!isVerifying) return;
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
    };
    invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => false);
    setIsVerifying(false);
  }, [invoke, isVerifying, settings.verificationPolicy]);

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
    setVerificationApprovalId(RESULT_DEMO_APPROVAL_ID);
    lastGoodRef.current = {
      inputText: PREVIEW_SOURCE_TEXT,
      processedSourceText: PREVIEW_SOURCE_TEXT,
      brief: PREVIEW_ACTION_BRIEF,
      result: '',
      sourceType: 'ocr',
      captureMeta: PREVIEW_CAPTURE,
      sourceMeta: { truncated: false, originalLength: PREVIEW_SOURCE_TEXT.length },
      processingTimeMs: 6800,
      verificationApprovalId: RESULT_DEMO_APPROVAL_ID,
      processingConfigSignature: initialProcessingConfigSignatureRef.current,
      warning: '',
    };
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
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (clipboardEvent.error) {
      setError('剪贴板里没有可解释的文本');
      setWarning('');
      setStatus(STATUS.ERROR);
      return undefined;
    }

    const clipboardText = clipboardEvent.text;
    if (!clipboardText?.trim()) return undefined;

    requestCoordinatorRef.current.invalidate();
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
    };
    setVerificationApprovalId(null);
    setIsVerifying(false);
    setInputText(clipboardText);
    setSourceType(clipboardEvent.source === 'ocr' ? 'ocr' : 'clipboard');
    setCaptureMeta({
      confidence: clipboardEvent.confidence ?? null,
      blocks: Array.isArray(clipboardEvent.blocks) ? clipboardEvent.blocks : [],
    });
    setSourceMeta({
      truncated: clipboardEvent.truncated,
      originalLength: clipboardEvent.originalLength,
    });
    setError(null);

    const warnings = [];
    if (clipboardEvent.truncated) warnings.push(sourceTooLongWarning(clipboardEvent.originalLength));
    if (clipboardEvent.source === 'ocr' && typeof clipboardEvent.confidence === 'number' && clipboardEvent.confidence < 0.5) {
      warnings.push(`OCR 识别置信度较低（${Math.round(clipboardEvent.confidence * 100)}%），请先核对原文。`);
    }
    setWarning(warnings.join(' '));

    if (clipboardEvent.truncated) {
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
      return undefined;
    }

    if (settings.clipboardMonitoring || clipboardEvent.source !== 'monitor') {
      debounceRef.current = window.setTimeout(() => {
        triggerProcessingRef.current?.(clipboardText, {
          truncated: clipboardEvent.truncated,
          originalLength: clipboardEvent.originalLength,
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
  }, [clipboardEvent, setWindowMode, settings.clipboardMonitoring]);

  const invalidateVerification = useCallback(() => {
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
    };
    setVerificationApprovalId(null);
    lastGoodRef.current = withVerificationApproval(lastGoodRef.current, null);
    setIsVerifying(false);
  }, []);

  const restoreLastGood = useCallback((message = '') => {
    const snapshot = lastGoodRef.current;
    if (!snapshot) return false;
    setInputText(snapshot.inputText);
    setProcessedSourceText(snapshot.processedSourceText);
    setBrief(snapshot.brief);
    setResult(snapshot.result);
    setSourceType(snapshot.sourceType);
    setCaptureMeta(snapshot.captureMeta);
    setSourceMeta(snapshot.sourceMeta);
    setProcessingTimeMs(snapshot.processingTimeMs);
    setVerificationApprovalId(snapshot.verificationApprovalId);
    setIsVerifying(false);
    setError(null);
    setWarning(resolveSnapshotWarning(snapshot, processingConfigSignature, message));
    setStatus(STATUS.DONE);
    setWindowMode('result');
    return true;
  }, [processingConfigSignature, setWindowMode]);

  useEffect(() => {
    const liveProcessingConfigGeneration = processingConfigGenerationRef?.current
      ?? processingConfigEffectGeneration;
    if (!isProcessingConfigGenerationCurrent(
      processingConfigEffectGeneration,
      liveProcessingConfigGeneration,
    )) return;
    if (previousProcessingConfigRef.current === processingConfigChangeKey) return;
    previousProcessingConfigRef.current = processingConfigChangeKey;
    if (status === STATUS.PROCESSING) {
      const activeProcessing = activeProcessingRef.current;
      if (activeProcessing?.configGeneration === processingConfigEffectGeneration) return;
      const restoreRetry = shouldRestoreLastGoodAfterConfigChange(
        activeProcessing,
        lastGoodRef.current,
      );
      invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => false);
      requestCoordinatorRef.current.invalidate();
      activeProcessingRef.current = null;
      if (restoreRetry && restoreLastGood()) return;
      setStatus(STATUS.IDLE);
      setError(null);
      setWarning(PROCESSING_CONFIG_CHANGED_WARNING);
    } else if (status === STATUS.ERROR) {
      setStatus(STATUS.IDLE);
      setError(null);
      setWarning(PROCESSING_CONFIG_CHANGED_WARNING);
    } else if (status === STATUS.DONE && lastGoodRef.current) {
      if (activeProcessingRef.current
        && activeProcessingRef.current.configGeneration !== processingConfigEffectGeneration) {
        activeProcessingRef.current = null;
      }
      // A failed retry is shown on top of the last valid result as a warning.
      // Reconcile against the configuration that produced that result so A →
      // B → A restores A without carrying B's obsolete failure forward.
      const snapshot = lastGoodRef.current;
      setError(null);
      setWarning(resolveSnapshotWarning(snapshot, processingConfigSignature));
    }
  }, [invoke, processingConfigChangeKey, processingConfigEffectGeneration, processingConfigGenerationRef, processingConfigSignature, restoreLastGood, status]);

  useEffect(() => {
    const unsubscribe = on(IPC_CHANNELS.OCR_ERROR, (payload) => {
      const message = captureEventMessage(payload);
      if (restoreLastGood(message)) return;
      setError(message);
      setStatus(STATUS.ERROR);
      setWindowMode('capture');
    });
    return unsubscribe;
  }, [on, restoreLastGood, setWindowMode]);

  const runProcessing = useCallback(async (task) => {
    const { text, options, warning: taskWarning = '' } = task.payload;
    const requestConfigSignature = processingConfigSignature;
    const requestConfigGeneration = processingConfigGenerationRef?.current
      ?? processingConfigRevision;
    activeProcessingRef.current = {
      taskId: task.id,
      retryOfLastGood: Boolean(options.retryOfLastGood),
      configGeneration: requestConfigGeneration,
    };
    let response;

    try {
      response = await invoke(IPC_CHANNELS.LLM_PROCESS, {
        text,
        backend: settings.activeBackend,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        source: options.source || 'manual',
        capture: options.capture || null,
        truncated: Boolean(options.truncated),
        originalLength: options.originalLength ?? text.length,
        verificationApproved: Boolean(options.verificationApproved),
      });
    } catch {
      response = null;
    }

    const currentConfigGeneration = processingConfigGenerationRef?.current
      ?? processingConfigRevision;
    const generationIsCurrent = isProcessingConfigGenerationCurrent(
      requestConfigGeneration,
      currentConfigGeneration,
    );
    const completionOwnsActiveProcessing = activeProcessingRef.current?.taskId === task.id;
    const restoreLastGoodIfStale = completionOwnsActiveProcessing
      && shouldRestoreLastGoodAfterConfigChange(
        { retryOfLastGood: Boolean(options.retryOfLastGood) },
        lastGoodRef.current,
      );
    const {
      apply,
      next,
      restoreLastGood: restoreStaleLastGood,
    } = completeTaskForGeneration(requestCoordinatorRef.current, task, {
      generationIsCurrent,
      restoreLastGoodIfStale,
    });
    if (!next && completionOwnsActiveProcessing && !restoreStaleLastGood) {
      activeProcessingRef.current = null;
    }
    if (restoreStaleLastGood) restoreLastGood();
    if (apply) {
      const invalidBrief = response?.brief?.status === 'invalid';
      if (response?.success && !invalidBrief && (response.brief || response.text)) {
        const nextBrief = response.brief || null;
        const nextResult = response.text || '';
        const nextCaptureMeta = options.capture || { confidence: null, blocks: [] };
        const nextSourceMeta = {
          truncated: Boolean(options.truncated),
          originalLength: options.originalLength ?? text.length,
        };
        const nextApprovalId = response.verificationSummary?.approvalId || null;
        const nextProcessingTimeMs = response.processingTimeMs || null;
        lastGoodRef.current = {
          inputText: text,
          processedSourceText: text,
          brief: nextBrief,
          result: nextResult,
          sourceType: options.source || 'manual',
          captureMeta: nextCaptureMeta,
          sourceMeta: nextSourceMeta,
          processingTimeMs: nextProcessingTimeMs,
          verificationApprovalId: nextApprovalId,
          processingConfigSignature: requestConfigSignature,
          warning: taskWarning,
        };
        setInputText(text);
        setProcessedSourceText(text);
        setBrief(nextBrief);
        setResult(nextResult);
        setSourceType(options.source || 'manual');
        setCaptureMeta(nextCaptureMeta);
        setSourceMeta(nextSourceMeta);
        setVerificationApprovalId(nextApprovalId);
        setWarning(taskWarning);
        setError(null);
        setStatus(STATUS.DONE);
        setProcessingTimeMs(nextProcessingTimeMs);
        setWindowMode('result');
      } else {
        const failureMessage = invalidBrief
          ? USER_ERROR_MESSAGES['processing-invalid']
          : userErrorMessage(response, PROCESSING_FAILURE_MESSAGE);
        if (response?.cancelled) {
          if (!restoreLastGood()) {
            setError(null);
            setStatus(STATUS.IDLE);
            setWindowMode('capture');
          }
        } else if (!restoreLastGood(failureMessage)) {
          setError(failureMessage);
          setStatus(STATUS.ERROR);
          setVerificationApprovalId(null);
          setWindowMode('capture');
        }
      }
    }

    if (next && runProcessingRef.current) runProcessingRef.current(next);
  }, [invoke, processingConfigGenerationRef, processingConfigRevision, processingConfigSignature, restoreLastGood, setWindowMode, settings.activeBackend, settings.activeModel, settings.customPrompt, settings.languageHint]);

  useEffect(() => {
    runProcessingRef.current = runProcessing;
  }, [runProcessing]);

  const triggerProcessing = useCallback((text, options = {}) => {
    const textToProcess = text || inputText;
    if (!textToProcess?.trim()) return;

    const usesCurrentInput = !text || text === inputText;
    const hasTruncatedOption = Object.prototype.hasOwnProperty.call(options, 'truncated');
    const hasOriginalLengthOption = Object.prototype.hasOwnProperty.call(options, 'originalLength');
    const normalizedOptions = {
      ...options,
      truncated: hasTruncatedOption ? Boolean(options.truncated) : (usesCurrentInput && sourceMeta.truncated),
      originalLength: hasOriginalLengthOption
        ? options.originalLength
        : (usesCurrentInput ? sourceMeta.originalLength : textToProcess.length) ?? textToProcess.length,
    };
    const isSourceTooLong = normalizedOptions.truncated || textToProcess.length > DEFAULTS.MAX_TEXT_LENGTH;
    if (isSourceTooLong) {
      const originalLength = Math.max(
        Number.isSafeInteger(normalizedOptions.originalLength) ? normalizedOptions.originalLength : 0,
        textToProcess.length,
      );
      setSourceMeta({ truncated: true, originalLength });
      setWarning(sourceTooLongWarning(originalLength));
      setError(null);
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
      return;
    }

    const warnings = [];
    if (normalizedOptions.source === 'ocr' && typeof normalizedOptions.capture?.confidence === 'number' && normalizedOptions.capture.confidence < 0.5) {
      warnings.push(`OCR 识别置信度较低（${Math.round(normalizedOptions.capture.confidence * 100)}%），请核对高亮原文。`);
    }

    setSourceMeta({
      truncated: normalizedOptions.truncated,
      originalLength: normalizedOptions.originalLength,
    });
    invalidateVerification();
    setWarning(warnings.join(' '));
    setStatus(STATUS.PROCESSING);
    setError(null);
    setProcessingTimeMs(null);
    const task = requestCoordinatorRef.current.schedule({
      text: textToProcess,
      options: normalizedOptions,
      warning: warnings.join(' '),
    });
    const intendedConfigGeneration = processingConfigGenerationRef?.current
      ?? processingConfigRevision;
    activeProcessingRef.current = {
      taskId: task?.id ?? null,
      retryOfLastGood: Boolean(normalizedOptions.retryOfLastGood),
      configGeneration: intendedConfigGeneration,
    };
    if (task) runProcessing(task);
  }, [inputText, invalidateVerification, processingConfigGenerationRef, processingConfigRevision, runProcessing, setWindowMode, sourceMeta.originalLength, sourceMeta.truncated]);

  useEffect(() => {
    triggerProcessingRef.current = triggerProcessing;
  }, [triggerProcessing]);

  const handleScreenshot = useCallback(async () => {
    if (screenshotRunRef.current.inFlight) return;
    const token = screenshotRunRef.current.token + 1;
    screenshotRunRef.current = { token, inFlight: true };
    requestCoordinatorRef.current.invalidate();
    try {
      setError(null);
      setStatus(STATUS.PROCESSING);
      const screenshot = await invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE);
      if (screenshotRunRef.current.token !== token) return;
      if (screenshot?.cancelled) {
        if (!restoreLastGood()) {
          setError(null);
          setStatus(STATUS.IDLE);
          setWindowMode('capture');
        }
        return;
      }
      if (screenshot?.success && screenshot.text) {
        const capture = {
          confidence: screenshot.confidence ?? null,
          blocks: Array.isArray(screenshot.blocks) ? screenshot.blocks : [],
        };
        const nextSourceMeta = {
          truncated: Boolean(screenshot.truncated),
          originalLength: screenshot.originalLength ?? screenshot.text.length,
        };
        setInputText(screenshot.text);
        setSourceType('ocr');
        setCaptureMeta(capture);
        setSourceMeta(nextSourceMeta);
        if (nextSourceMeta.truncated) {
          const message = sourceTooLongWarning(nextSourceMeta.originalLength);
          if (!restoreLastGood(message)) {
            setWarning(message);
            setStatus(STATUS.IDLE);
            setWindowMode('capture');
          }
          return;
        }
        triggerProcessing(screenshot.text, {
          source: 'ocr',
          capture,
          ...nextSourceMeta,
        });
      } else {
        const message = userErrorMessage(screenshot, SCREENSHOT_FAILURE_MESSAGE);
        if (!restoreLastGood(message)) {
          setError(message);
          setStatus(STATUS.ERROR);
          setWindowMode('capture');
        }
      }
    } catch {
      if (screenshotRunRef.current.token !== token) return;
      if (!restoreLastGood(SCREENSHOT_FAILURE_MESSAGE)) {
        setError(SCREENSHOT_FAILURE_MESSAGE);
        setStatus(STATUS.ERROR);
        setWindowMode('capture');
      }
    } finally {
      if (screenshotRunRef.current.token === token) {
        screenshotRunRef.current = { token, inFlight: false };
      }
    }
  }, [invoke, restoreLastGood, setWindowMode, triggerProcessing]);

  useEffect(() => {
    return on(IPC_CHANNELS.SCREENSHOT_REQUESTED, () => {
      handleScreenshot();
    });
  }, [handleScreenshot, on]);

  const handlePaste = useCallback(async () => {
    try {
      const response = await invoke(IPC_CHANNELS.CLIPBOARD_READ);
      const payload = typeof response === 'string'
        ? { text: response, truncated: false, originalLength: response.length }
        : response;
      if (payload?.text?.trim()) {
        setInputText(payload.text);
        setSourceType('clipboard');
        setCaptureMeta({ confidence: null, blocks: [] });
        setSourceMeta({
          truncated: Boolean(payload.truncated),
          originalLength: payload.originalLength ?? payload.text.length,
        });
        setWarning(payload.truncated ? sourceTooLongWarning(payload.originalLength) : '');
        setError(null);
        setStatus(STATUS.IDLE);
      } else {
        setError('剪贴板里没有可解释的文本');
        setStatus(STATUS.ERROR);
      }
    } catch {
      setError('无法读取剪贴板，请手动粘贴或使用截图功能');
      setStatus(STATUS.ERROR);
    }
  }, [invoke]);

  const handleCancelProcessing = useCallback(() => {
    requestCoordinatorRef.current.invalidate();
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => {});
    invalidateVerification();
    if (!restoreLastGood()) {
      setError(null);
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
    }
  }, [invalidateVerification, invoke, restoreLastGood, setWindowMode]);

  const handleClear = useCallback(() => {
    requestCoordinatorRef.current.invalidate();
    // Clearing/returning to capture abandons the result and every verification
    // approval attached to it. This is intentionally stronger than ordinary
    // cancellation, which keeps the same-source verification retry available.
    invoke(IPC_CHANNELS.LLM_CANCEL, { discardResult: true }).catch(() => {});
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    lastGoodRef.current = null;
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
    setSourceMeta({ truncated: false, originalLength: null });
    invalidateVerification();
    clearClipboard();
    setWindowMode('capture');
  }, [clearClipboard, invalidateVerification, invoke, setWindowMode]);

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
    if (!processedSourceText || !brief || !verificationApprovalId || isVerifying || settings.verificationPolicy !== 'ask') return;
    const token = verificationRunRef.current.token + 1;
    const approvalId = verificationApprovalId;
    let sourceHash = null;
    verificationRunRef.current = { token, sourceHash: null };
    setVerificationApprovalId(null);
    setIsVerifying(true);
    try {
      sourceHash = await hashSourceText(processedSourceText);
      if (verificationRunRef.current.token !== token) return;
      verificationRunRef.current = { token, sourceHash };
      const response = await invoke(IPC_CHANNELS.VERIFICATION_RUN, {
        sourceText: processedSourceText,
        brief,
        approvalId,
      });
      if (verificationRunRef.current.token !== token || verificationRunRef.current.sourceHash !== sourceHash) return;
      if (!response?.success || !response.brief || response.brief.status === 'invalid') {
        const verificationWarning = userErrorMessage(response, VERIFICATION_FAILURE_MESSAGE);
        const nextApprovalId = response?.retryApprovalId || response?.verificationSummary?.approvalId || null;
        setVerificationApprovalId(nextApprovalId);
        lastGoodRef.current = withVerificationApproval(lastGoodRef.current, nextApprovalId);
        setWarning((current) => appendUniqueWarning(current, verificationWarning));
        return;
      }
      const retryApprovalId = response?.retryApprovalId || response.verificationSummary?.approvalId || null;
      setBrief(response.brief);
      setResult(response.text || result);
      setProcessingTimeMs(response.processingTimeMs || processingTimeMs);
      setVerificationApprovalId(retryApprovalId);
      if (lastGoodRef.current) {
        lastGoodRef.current = {
          ...lastGoodRef.current,
          brief: response.brief,
          result: response.text || result,
          processingTimeMs: response.processingTimeMs || processingTimeMs,
          verificationApprovalId: retryApprovalId,
        };
      }
    } catch {
      if (verificationRunRef.current.token !== token || verificationRunRef.current.sourceHash !== sourceHash) return;
      setVerificationApprovalId(approvalId);
      setWarning((current) => appendUniqueWarning(current, VERIFICATION_FAILURE_MESSAGE));
    } finally {
      if (verificationRunRef.current.token === token && verificationRunRef.current.sourceHash === sourceHash) {
        setIsVerifying(false);
      }
    }
  }, [brief, invoke, isVerifying, processedSourceText, processingTimeMs, result, settings.verificationPolicy, verificationApprovalId]);

  const sourceLabel = sourceType === 'ocr'
    ? '截图 OCR'
    : ['clipboard', 'monitor', 'shortcut'].includes(sourceType) ? '剪贴板' : '手动输入';
  const institution = brief?.terms?.find((term) => term.kind === 'institution')?.surface;
  const sourceDescriptor = institution ? `${sourceLabel} · ${institution}` : sourceLabel;
  const isDone = status === STATUS.DONE && brief?.status !== 'invalid' && Boolean(brief || result);
  const isTranslationOnly = brief?.status === 'translation_only'
    || (brief?.responseKind || brief?.analysisProvenance?.responseKind) === 'translation_only';
  const isSourceTooLong = sourceMeta.truncated || inputText.length > DEFAULTS.MAX_TEXT_LENGTH;
  const preference = settings.resultOrder === 'translation-first' ? 'translation' : 'action';
  const isFreeTranslate = settings.activeBackend === 'free_translate';
  const privacyProvider = isDone ? brief?.analysisProvenance?.provider : settings.activeBackend;
  const privacyLabel = privacyProvider === 'ollama'
    ? '本地处理 · 隐私优先'
    : privacyProvider === 'free_translate'
      ? '在线基础翻译 · 会发送原文'
      : privacyProvider
        ? `在线模型 ${privacyProvider} · 会发送原文`
        : '结果处理来源未记录';
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
          {isDone && !isTranslationOnly && (
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
          active={visible}
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
          onVerifyOfficialSources={verificationApprovalId ? verifyOfficialSources : null}
          onOpenExternal={(url) => invoke(IPC_CHANNELS.EXTERNAL_OPEN, url)}
          onConfigureAnalysis={onOpenSettings}
          onRetry={() => triggerProcessing(processedSourceText || inputText, {
            source: sourceType,
            capture: captureMeta,
            ...sourceMeta,
            retryOfLastGood: true,
          })}
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
            <LoadingOverlay visible sourcePreview={sourcePreview} onCancel={handleCancelProcessing} translationOnly={isFreeTranslate} />
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
                    const nextText = event.target.value;
                    const tooLong = nextText.length > DEFAULTS.MAX_TEXT_LENGTH;
                    setInputText(nextText);
                    setSourceType('manual');
                    setCaptureMeta({ confidence: null, blocks: [] });
                    setSourceMeta({
                      truncated: tooLong,
                      originalLength: nextText.length,
                    });
                    setWarning(tooLong ? sourceTooLongWarning(nextText.length) : '');
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

              <button type="button" className="process-button" onClick={() => triggerProcessing()} disabled={!inputText.trim() || isSourceTooLong}>
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
