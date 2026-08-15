import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowSquareOut,
  BookOpen,
  Camera,
  CircleNotch,
  ClipboardText,
  CloudArrowUp,
  FileText,
  GearSix,
  HardDrives,
  ListChecks,
  Minus,
  PencilSimpleLine,
  ShieldCheck,
  WarningCircle,
  X,
} from '../phosphorIcons';
import ClipboardActionNotice from './ClipboardActionNotice';
import LoadingOverlay from './LoadingOverlay';
import SessionRecoveryDialog from './SessionRecoveryDialog';
import ClipboardResidueRiskNotice from './ClipboardResidueRiskNotice';
import {
  LazyWorkspaceBoundary,
  ResultWorkspaceRecovery,
  SavedTermsWorkspaceFallback,
  SavedTermsWorkspaceRecovery,
} from './LazyWorkspaceRecovery';
import { useIpc } from '@renderer-ipc';
import { useClipboard } from '../hooks/useClipboard';
import {
  completeTaskForGeneration,
  createRequestCoordinator,
} from '../hooks/requestCoordinator.mjs';
import { PREVIEW_ACTION_BRIEF, PREVIEW_CAPTURE, PREVIEW_SOURCE_TEXT } from '@preview-data';
import { getReplyProgressConsistencyForBrief } from '../utils/replyProgress.mjs';
import {
  hasSavedTerm,
  isCanonicalSavedTerm,
  isCanonicalSavedTerms,
  isSavedTermsImportCommitConsistent,
  isSavedTermsImportPlanSummaryConsistent,
  isValidSavedTermsImportSummary,
  savedTermKey,
  upsertSavedTerm,
} from '../utils/savedTerms.mjs';
import {
  hasMeaningfulReplyDraftState,
  sanitizeReplyDraftState,
} from '../utils/replyDraftState.mjs';
import {
  hasModifiedSourceEditDraft,
  openSourceEditDraft,
  updateSourceEditDraft,
} from '../utils/sourceEditDraft.mjs';
import {
  getProcessingPrivacyDisclosure,
  getProcessingSourceSummary,
  normalizeProcessingLocation,
  PROCESSING_LOCATIONS,
  processingProviderLabel,
  processingLocationForSettings,
  resolveResultProcessingSnapshot,
} from '../utils/processingPrivacy.mjs';
import {
  assessOcrReview,
  createOcrReviewConfirmation,
  describeOcrReview,
} from '../utils/ocrReview.mjs';
import {
  describeProcessingRecovery,
  processingFailureMessage,
  processingFailureCode,
} from '../utils/processingRecovery.mjs';
import { describeClipboardMonitoring } from '../utils/clipboardMonitoringConsent.mjs';
import {
  createPendingClipboardItem,
  describePendingClipboard,
  pendingClipboardPreview,
  shouldHoldClipboardCapture,
} from '../utils/clipboardMonitorQueue.mjs';
import {
  describePendingScreenshotRequest,
  getForegroundCaptureBlockReason,
  isForegroundCaptureDecisionBlocking,
} from '../utils/foregroundCaptureGuard.mjs';
import { getSourceLimitState, sourceLimitWarning } from '../utils/sourceLimit.mjs';
import { describeShortcutReadiness } from '../utils/shortcutReadiness.mjs';
import { ownsDelayedCaptureDispatch } from '../utils/captureAutoSubmit.mjs';
import {
  createRetryableLazyImport,
  importRetryableWorkspaceAsset,
} from '../utils/retryableLazyImport.mjs';
import {
  dismissClipboardNotice,
  markClipboardNoticeAfterTaskExit,
  markCopiedClipboardNoticeOutdated,
} from '../utils/clipboardNotice.mjs';
import {
  beginReplyClipboardCopy,
  reconcileReplyClipboardNotice,
  settleReplyClipboardCopyFailure,
  settleReplyClipboardCopySuccess,
} from '../utils/replyClipboardLifecycle.mjs';
import shortcutAccelerator from '../../shared/shortcut-accelerator.mjs';

const { displayShortcutAccelerator } = shortcutAccelerator;
import {
  PROCESSING_CANCELLED_RESULT_NOTICE,
  PROCESSING_CANCELLED_SOURCE_NOTICE,
  PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE,
  PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE,
  PROCESSING_COMPLETED_BEFORE_SETTINGS_NOTICE,
  PROCESSING_COMPLETED_DURING_CANCEL_NOTICE,
  processingCancelFailureMessage,
  processingSettingsGuardMessage,
} from '../utils/processingCancellation.mjs';
import {
  CLEAR_UNDO_WINDOW_MS,
  createClearedSessionSnapshot,
  getClearUndoSecondsRemaining,
  pauseClearUndoWindow,
  prepareClearedSessionRestore,
  resumeClearUndoWindow,
} from '../utils/clearedSession.mjs';
import {
  classifyClipboardReadAttempt,
  isCurrentClipboardReadAttempt,
} from '../utils/clipboardReadAttempt.mjs';
import { inferTextLanguageTag } from '../utils/languageBoundary.mjs';
import {
  SESSION_RECOVERY_WRITE_DELAY_MS,
  clearSessionRecovery,
  createSessionRecoveryRecord,
  prepareSessionRecoveryRestore,
  readSessionRecovery,
  writeSessionRecovery,
} from '../utils/sessionRecovery.mjs';
import {
  appendFailedProcessingAttemptNotice,
  createFailedProcessingAttempt,
  failedProcessingAttemptMatches,
  isValidOcrReviewConfirmation,
  prepareFailedProcessingAttemptRetry,
  removeFailedProcessingAttemptNotice,
} from '../utils/failedProcessingAttempt.mjs';
import {
  appendUniqueWarning,
  getProcessingConfigSignature,
  isProcessingConfigGenerationCurrent,
  PROCESSING_CONFIG_CHANGED_WARNING,
  resolveSnapshotWarning,
  SETUP_INCOMPLETE_WARNING,
  shouldRestoreLastGoodAfterConfigChange,
  withVerificationApproval,
} from '../utils/processingConfig.mjs';
import { STATUS, IPC_CHANNELS, DEFAULTS } from '../../shared/constants';

const LAZY_WORKSPACE_RECOVERY_FIXTURE = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('run') === 'lazy-workspace-recovery-native';
const RESULT_STYLESHEET_RECOVERY_FIXTURE = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('run')
    === 'result-stylesheet-recovery-native';
function waitForResultWorkspaceStyles(moduleLoader) {
  return moduleLoader().then((resultModule) => (
    Promise.resolve(resultModule.resultWorkspaceStylesheetReady)
      .then(() => resultModule)
  ));
}

const resultDisplayImport = createRetryableLazyImport(
  import.meta.env.DEV
    ? [
      LAZY_WORKSPACE_RECOVERY_FIXTURE
        ? () => waitForResultWorkspaceStyles(
          () => import('./ResultDisplay?workspace-load=result-fixture-primary'),
        )
        : RESULT_STYLESHEET_RECOVERY_FIXTURE
          ? () => waitForResultWorkspaceStyles(
            () => import('./ResultDisplay?workspace-load=result-style-fixture-primary'),
          )
        : () => waitForResultWorkspaceStyles(() => import('./ResultDisplay')),
      () => waitForResultWorkspaceStyles(
        () => import('./ResultDisplay?workspace-load=result-style-retry&workspace-attempt=1'),
      ),
    ]
    : [
      () => waitForResultWorkspaceStyles(() => import('./ResultDisplay')),
      () => waitForResultWorkspaceStyles(
        () => importRetryableWorkspaceAsset('ResultDisplay.js', 1),
      ),
    ],
);

function preloadResultDisplay() {
  return resultDisplayImport.load();
}

function createResultDisplay() {
  return React.lazy(preloadResultDisplay);
}

const SAVED_TERMS_DEFERRAL_FIXTURE = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('run') === 'saved-terms-deferral-native';
function waitForSavedTermsWorkspaceStyles(moduleLoader) {
  return moduleLoader().then((savedTermsModule) => (
    Promise.resolve(savedTermsModule.savedTermsWorkspaceStylesheetReady)
      .then(() => savedTermsModule)
  ));
}

const savedTermsLibraryImport = createRetryableLazyImport(
  import.meta.env.DEV
    ? [
      SAVED_TERMS_DEFERRAL_FIXTURE
        ? () => waitForSavedTermsWorkspaceStyles(
          () => import('./SavedTermsLibrary?workspace-load=saved-terms-fixture-primary'),
        )
        : () => waitForSavedTermsWorkspaceStyles(() => import('./SavedTermsLibrary')),
      () => waitForSavedTermsWorkspaceStyles(
        () => import('./SavedTermsLibrary?workspace-load=saved-terms-retry&workspace-attempt=1'),
      ),
    ]
    : [
      () => waitForSavedTermsWorkspaceStyles(() => import('./SavedTermsLibrary')),
      () => waitForSavedTermsWorkspaceStyles(
        () => importRetryableWorkspaceAsset('SavedTermsLibrary.js', 1),
      ),
    ],
);

function preloadSavedTermsLibrary() {
  return savedTermsLibraryImport.load();
}

function prepareSavedTermsLibrary() {
  void preloadSavedTermsLibrary().catch(() => false);
}

function createSavedTermsLibrary() {
  return React.lazy(preloadSavedTermsLibrary);
}

const SAVED_TERMS_LOAD_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});
const SAVED_TERMS_RECONCILIATION_ERROR_CODES = new Set([
  'saved-terms-mutation-unconfirmed',
  'saved-terms-invalid-mutation-response',
  'saved-terms-invalid-import-response',
]);
const SAVED_TERMS_CONFIRMED_IMPORT_NOOP_CODES = new Set(['preview-expired']);
const SAVED_TERMS_IMPORT_PREVIEW_FAILURE_CODES = new Set([
  'file-too-large',
  'no-usable-terms',
  'read-failed',
  'invalid-json',
  'invalid-format',
  'unsupported-format',
  'invalid-terms',
  'preview-expired',
]);
const SAVED_TERMS_IMPORT_SUMMARY_FIELDS = Object.freeze([
  'existingCount',
  'incomingCount',
  'newCount',
  'updatedCount',
  'unchangedCount',
  'capacitySkippedCount',
  'totalAfter',
  'invalidCount',
  'duplicateCount',
  'ignoredEvidenceCount',
  'downgradedProvenanceCount',
]);

function hasValidSavedTermsImportFileName(response) {
  return typeof response?.fileName === 'string'
    && response.fileName.trim().length > 0
    && response.fileName.length <= 255;
}

function isValidSavedTermsImportPreview(response, existingTerms) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  if (response.status !== 'ready') return false;
  if (typeof response.previewId !== 'string'
    || response.previewId.length === 0
    || response.previewId.length > 100) return false;
  if (!hasValidSavedTermsImportFileName(response)) return false;
  if (!Array.isArray(response.examples)
    || response.examples.length > 5
    || response.examples.some((term) => (
      typeof term !== 'string' || !term.trim() || term.length > 200
    ))) return false;
  return isValidSavedTermsImportSummary(response.summary)
    && isSavedTermsImportPlanSummaryConsistent(
      existingTerms,
      response.planTerms,
      response.summary,
    )
    && response.examples.length === Math.min(5, response.planTerms.length)
    && response.examples.every((term, index) => term === response.planTerms[index].term);
}

function isValidSavedTermsImportCommit(response, existingTerms, preview) {
  return Boolean(
    response
    && typeof response === 'object'
    && !Array.isArray(response)
    && response.status === 'imported'
    && hasValidSavedTermsImportFileName(response)
    && isCanonicalSavedTerms(response.savedTerms)
    && isValidSavedTermsImportSummary(response.summary, response.savedTerms.length)
    && preview?.previewId
    && response.fileName === preview.fileName
    && SAVED_TERMS_IMPORT_SUMMARY_FIELDS.every((field) => (
      response.summary[field] === preview.summary?.[field]
    ))
    && isSavedTermsImportCommitConsistent(
      existingTerms,
      preview.planTerms,
      response.savedTerms,
      response.summary,
    )
  );
}

function createSavedTermsLoadError(code = 'saved-terms-load-failed') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function ResultWorkspaceFallback() {
  const headingRef = useRef(null);

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main
      className="capture-view result-workspace-loading"
      aria-labelledby="result-workspace-loading-title"
      aria-busy="true"
    >
      <section className="processing-card">
        <p className="eyebrow">分析已完成</p>
        <h1 id="result-workspace-loading-title" ref={headingRef} tabIndex={-1}>
          正在准备可追溯结果…
        </h1>
        <p className="processing-status" role="status" aria-live="polite">
          <CircleNotch size={18} className="spin" aria-hidden="true" />
          <span>原文和分析结果已保留，正在载入结果视图。</span>
        </p>
      </section>
    </main>
  );
}

const RESULT_DEMO = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('demo') === 'result';
const RESULT_DEMO_APPROVAL_ID = 'a'.repeat(64);
const PROCESSING_PHASE = Object.freeze({
  CAPTURE: 'capture',
  ANALYSIS: 'analysis',
});
const SCREENSHOT_CAPTURE_SOURCE_SUMMARY = Object.freeze({
  title: '截图区域 · 等待框选',
  detail: '尚未读取正文；这里只显示来源阶段，不会展示截图或识别文字。',
});
const SCREENSHOT_CAPTURE_PRIVACY_DISCLOSURE = Object.freeze({
  location: 'local',
  activeTitle: '截图与 OCR 仅在本机进行',
  activeDetail: '系统框选和文字识别不会发送给模型；识别完成后才会进入所选处理方式。',
});
const USER_ERROR_MESSAGES = Object.freeze({
  'processing-busy': '已有任务正在处理，请稍候。',
  'processing-cancelled': '处理已取消。',
  'processing-invalid': '模型返回的内容未通过结构与证据校验。原文和上一份有效结果已保留，请重试或更换模型。',
  'ocr-review-required': '这段截图文字需要先核对；原文尚未交给处理服务。请确认或修改后再试。',
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
const VERIFICATION_CANCELLED_NOTICE = '你已停止官方来源查找；当前原文和结果仍保留，可以重新批准后再试。';
const VERIFICATION_CANCEL_FAILED_NOTICE = '暂时无法停止官方来源查找；任务仍在继续，你可以隐藏窗口后等待完成。';
const VERIFICATION_COMPLETED_DURING_CANCEL_NOTICE = '官方来源查找在停止请求生效前已经完成；结果已更新。';
const SCREENSHOT_FAILURE_MESSAGE = USER_ERROR_MESSAGES['screenshot-failed'];
const EDITED_SOURCE_MANUAL_SUBMIT_WARNING = '你已修改原文。修改后的文字没有自动发送；请点击下方的生成按钮或按 Command+Enter 处理。';

function userErrorMessage(response, fallback) {
  return USER_ERROR_MESSAGES[response?.errorCode] || fallback;
}

function captureEventMessage(payload) {
  const message = typeof payload === 'string' ? payload : payload?.error;
  if (message?.startsWith('快捷键冲突：')) return '快捷键被其他应用占用，请在设置里更换。';
  if (message === '没有识别到清晰文字') return USER_ERROR_MESSAGES['screenshot-empty'];
  return SCREENSHOT_FAILURE_MESSAGE;
}

function resultOrderLabel(value) {
  return value === 'translation-first' ? '翻译优先' : '行动优先';
}

function focusAvailableElement(node) {
  if (!node?.isConnected || node.closest?.('[inert]')) return false;
  node.focus({ preventScroll: true });
  if (document.activeElement !== node) return false;
  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return document.activeElement === node;
}

function restorableActiveElement() {
  const node = document.activeElement;
  if (
    !(node instanceof HTMLElement)
    || node === document.body
    || node === document.documentElement
    || !node.isConnected
    || node.closest?.('[inert]')
  ) return null;
  return node;
}

function resultFocusTarget() {
  return document.getElementById('result-headline')
    || document.querySelector('[data-workspace-retry="result"]')
    || document.getElementById('result-workspace-loading-title');
}

function settledTaskFocusTarget() {
  return resultFocusTarget()
    || document.getElementById('ocr-review-title')
    || document.getElementById('processing-error-card')
    || document.querySelector('textarea[aria-label="要解释的完整原文"]');
}

if (RESULT_DEMO) document.documentElement.dataset.previewTheme = 'light';

function getSessionRecoveryStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

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

export default function FloatingPanel({
  visible = true,
  captureDecisionBlocked = false,
  onOpenSettings,
  onPrepareSettings,
  onQuitRiskChange,
  clipboardNotice: controlledClipboardNotice,
  clipboardOperationPending = false,
  onClipboardNoticeChange,
  onClipboardCopy,
  onAcknowledgeClipboardConsequence,
  onFullDataResetControllerChange,
  onHiddenCaptureRequest,
  onPendingCaptureSettled,
  approvedCaptureRequest,
  onApprovedCaptureConsumed,
  rendererRecovered = false,
  clipboardResidueRisk = null,
  clipboardResidueRiskPending = false,
  clipboardResidueRiskError = '',
  onAcknowledgeClipboardResidueRisk,
  runtimeAlertMessages = [],
  onSessionRecoveryPendingChange,
  settingsMenuRequest = null,
  onSettingsMenuRequestHandled,
  settingsController,
}) {
  const [inputText, setInputText] = useState('');
  const [processedSourceText, setProcessedSourceText] = useState('');
  const [result, setResult] = useState('');
  const [brief, setBrief] = useState(null);
  const [completedActionIds, setCompletedActionIds] = useState([]);
  const [localClipboardNotice, setLocalClipboardNotice] = useState({ status: 'idle' });
  const [error, setError] = useState(null);
  const [captureErrorCode, setCaptureErrorCode] = useState(null);
  const [processingErrorCode, setProcessingErrorCode] = useState(null);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [processingPhase, setProcessingPhase] = useState(PROCESSING_PHASE.ANALYSIS);
  const [processingTimeMs, setProcessingTimeMs] = useState(null);
  const [verificationTimeMs, setVerificationTimeMs] = useState(null);
  const [savedTerms, setSavedTerms] = useState([]);
  const [savedTermsLoadStatus, setSavedTermsLoadStatus] = useState(SAVED_TERMS_LOAD_STATUS.IDLE);
  const [savedTermsLoadError, setSavedTermsLoadError] = useState('');
  const [savedTermsLoadErrorCode, setSavedTermsLoadErrorCode] = useState('');
  const [savedTermsDrawerOpen, setSavedTermsDrawerOpen] = useState(false);
  const [savedTermsWorkspaceMounted, setSavedTermsWorkspaceMounted] = useState(false);
  const [savedTermsSessionGeneration, setSavedTermsSessionGeneration] = useState(0);
  const [savedTermsWorkspace, setSavedTermsWorkspace] = useState(() => ({
    attempt: 0,
    Component: createSavedTermsLibrary(),
  }));
  const SavedTermsLibrary = savedTermsWorkspace.Component;
  const [warning, setWarning] = useState('');
  const [sourceType, setSourceType] = useState('manual');
  const [captureMeta, setCaptureMeta] = useState({ confidence: null, blocks: [] });
  const [ocrReview, setOcrReview] = useState(null);
  const [isConfirmingOcrReview, setIsConfirmingOcrReview] = useState(false);
  const [sourceMeta, setSourceMeta] = useState({ truncated: false, originalLength: null });
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCancellingVerification, setIsCancellingVerification] = useState(false);
  const [verificationApprovalId, setVerificationApprovalId] = useState(null);
  const [clearedSession, setClearedSession] = useState(null);
  const [clearedSessionSecondsRemaining, setClearedSessionSecondsRemaining] = useState(0);
  const [resultOrderSaveError, setResultOrderSaveError] = useState(null);
  const [isSavingResultOrder, setIsSavingResultOrder] = useState(false);
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [sourceEditDraft, setSourceEditDraft] = useState(null);
  const [isCancellingProcessing, setIsCancellingProcessing] = useState(false);
  const [activeProcessingSnapshot, setActiveProcessingSnapshot] = useState(null);
  const [processingCancelError, setProcessingCancelError] = useState('');
  const [processingSettingsGuardOpen, setProcessingSettingsGuardOpen] = useState(false);
  const [settingsOpenIntent, setSettingsOpenIntent] = useState(null);
  const [sourceLimitActionNotice, setSourceLimitActionNotice] = useState('');
  const [clipboardMonitoringStopStatus, setClipboardMonitoringStopStatus] = useState('idle');
  const [clipboardMonitoringStopError, setClipboardMonitoringStopError] = useState('');
  const [clipboardMonitoringOffNotice, setClipboardMonitoringOffNotice] = useState('');
  const [pendingClipboardItem, setPendingClipboardItem] = useState(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [pendingScreenshotRequest, setPendingScreenshotRequest] = useState(null);
  const [clipboardQueueAnnouncement, setClipboardQueueAnnouncement] = useState('');
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [replyFocusRequest, setReplyFocusRequest] = useState(0);
  const [replyDraftState, setReplyDraftState] = useState(null);
  const [replyCopyPending, setReplyCopyPending] = useState(false);
  const [failedProcessingAttempt, setFailedProcessingAttemptState] = useState(null);
  const [resultWorkspace, setResultWorkspace] = useState(() => ({
    attempt: 0,
    Component: createResultDisplay(),
  }));
  const ResultDisplay = resultWorkspace.Component;
  const [pendingSessionRecovery, setPendingSessionRecovery] = useState(() => (
    RESULT_DEMO ? null : readSessionRecovery(getSessionRecoveryStorage())
  ));
  const resetResultWorkspace = useCallback(() => {
    if (!resultDisplayImport.reset()) return false;
    setResultWorkspace((current) => ({
      attempt: current.attempt + 1,
      Component: createResultDisplay(),
    }));
    return true;
  }, []);
  const initialSessionRecoveryPendingRef = useRef(Boolean(pendingSessionRecovery));
  const rendererRecoveryNoticeHandledRef = useRef(false);
  const clipboardNotice = controlledClipboardNotice ?? localClipboardNotice;
  const debounceRef = useRef(null);
  const delayedCaptureDispatchRef = useRef({
    currentToken: 0,
    ownerToken: null,
    ownerSourceRevision: null,
  });
  const sourceRevisionRef = useRef(0);
  const taskSurfaceVisibleRef = useRef(visible);
  const previousVisibleRef = useRef(visible);
  const initialCaptureFocusPendingRef = useRef(visible);
  const statusRef = useRef(status);
  const requestCoordinatorRef = useRef(null);
  const runProcessingRef = useRef(null);
  const triggerProcessingRef = useRef(null);
  const textareaRef = useRef(null);
  const ocrReviewHeadingRef = useRef(null);
  const processingContextRef = useRef(null);
  const ordinaryErrorFocusHandledRef = useRef(false);
  const savedTermsTriggerRef = useRef(null);
  const savedTermsDrawerOpenRef = useRef(false);
  const savedTermsWorkspaceMountedRef = useRef(false);
  const savedTermsRef = useRef([]);
  const savedTermsImportPreviewRef = useRef(null);
  const savedTermsLoadRef = useRef({
    epoch: 0,
    status: SAVED_TERMS_LOAD_STATUS.IDLE,
    promise: null,
    error: null,
  });
  const savedTermsMutationRef = useRef(null);
  const savedTermsReconciliationErrorCodeRef = useRef('');
  const permissionRecoveryButtonRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const processingSettingsGuardRef = useRef(null);
  const settingsGuardReturnFocusRef = useRef(null);
  const settingsReturnFocusElementRef = useRef(null);
  const settingsReturnFocusReadyRef = useRef(false);
  const settingsMenuActionRef = useRef(null);
  const verificationRunRef = useRef({ token: 0, sourceHash: null, cancelRequested: false });
  const verificationSettingsSettlementRef = useRef(null);
  const lastGoodRef = useRef(null);
  const screenshotRunRef = useRef({ token: 0, inFlight: false });
  const screenshotRequestHandlerRef = useRef(null);
  const activeProcessingRef = useRef(null);
  const processingCancelRunRef = useRef({
    token: 0,
    pending: false,
    failedTaskId: null,
    failedScreenshotToken: null,
  });
  const settingsOpenIntentRef = useRef(null);
  const settingsReturnFocusRef = useRef(null);
  const clearedSessionRef = useRef(null);
  const clearUndoTimerRef = useRef(null);
  const clearUndoPauseOwnerRef = useRef(null);
  const clearUndoButtonRef = useRef(null);
  const clearUndoRegionRef = useRef(null);
  const resultReturnButtonRef = useRef(null);
  const clipboardReadButtonRef = useRef(null);
  const clipboardReadReturnFocusRef = useRef(null);
  const clipboardReadRequestRef = useRef(null);
  const sessionRecoveryReadyRef = useRef(!pendingSessionRecovery);
  const sessionRecoveryWriteTimerRef = useRef(null);
  const latestSessionRecoveryRef = useRef(null);
  const clipboardMonitoringStatusRef = useRef(null);
  const pendingScreenshotStatusRef = useRef(null);
  const pendingClipboardStatusRef = useRef(null);
  const pendingClipboardRef = useRef(null);
  const pendingManualClipboardFocusTokenRef = useRef(null);
  const focusedManualClipboardTokenRef = useRef(null);
  const clipboardNoticeRef = useRef(clipboardNotice);
  const clipboardEventGuardRef = useRef(null);
  const foregroundCaptureDecisionBlockingRef = useRef(false);
  const pendingClipboardDecisionStillBlockingRef = useRef(false);
  const foregroundCaptureContextRef = useRef(null);
  const replyDialogOpenRef = useRef(false);
  const replyDraftStateRef = useRef(null);
  const replyCompletionClaimCurrentRef = useRef(true);
  const replyCopyRequestRef = useRef(null);
  const replyTaskGenerationRef = useRef(1);
  const failedProcessingAttemptRef = useRef(null);
  const clipboardReadRunRef = useRef(0);
  const clipboardMonitoringEnabledRef = useRef(false);
  const hiddenCaptureRequestSequenceRef = useRef(0);
  const approvedCaptureHandledRef = useRef(null);
  const previousForegroundCaptureBlockingRef = useRef(false);
  const previousForegroundClipboardBlockingRef = useRef(false);

  if (!requestCoordinatorRef.current) requestCoordinatorRef.current = createRequestCoordinator();

  const revokePendingSettingsNavigation = useCallback(() => {
    settingsOpenIntentRef.current = null;
    setSettingsOpenIntent(null);
    verificationSettingsSettlementRef.current = null;
    settingsReturnFocusRef.current = null;
    settingsReturnFocusElementRef.current = null;
    settingsReturnFocusReadyRef.current = false;
  }, []);

  const settleFailedScreenshotCancellation = useCallback((screenshotToken) => {
    if (processingCancelRunRef.current.failedScreenshotToken !== screenshotToken) return false;
    processingCancelRunRef.current = {
      ...processingCancelRunRef.current,
      failedScreenshotToken: null,
    };
    const cancelledSettingsIntent = settingsOpenIntentRef.current === 'analysis';
    if (cancelledSettingsIntent) revokePendingSettingsNavigation();
    setProcessingCancelError('');
    if (cancelledSettingsIntent) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusAvailableElement(settledTaskFocusTarget());
        });
      });
    }
    return true;
  }, [revokePendingSettingsNavigation]);

  const setFailedProcessingAttempt = useCallback((attempt) => {
    failedProcessingAttemptRef.current = attempt || null;
    setFailedProcessingAttemptState(attempt || null);
    return attempt || null;
  }, []);

  const revokeDelayedCaptureDispatch = useCallback(({ sourceReplaced = false } = {}) => {
    const currentOwnership = delayedCaptureDispatchRef.current;
    const revokedPending = debounceRef.current !== null || (
      Number.isSafeInteger(currentOwnership.ownerToken)
      && currentOwnership.ownerToken === currentOwnership.currentToken
    );
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const nextToken = delayedCaptureDispatchRef.current.currentToken + 1;
    delayedCaptureDispatchRef.current = {
      currentToken: nextToken,
      ownerToken: null,
      ownerSourceRevision: null,
    };
    if (sourceReplaced) {
      sourceRevisionRef.current += 1;
      clipboardReadRunRef.current += 1;
    }
    return {
      currentToken: nextToken,
      sourceRevision: sourceRevisionRef.current,
      revokedPending,
    };
  }, []);

  const setClipboardNotice = useCallback((nextOrUpdater) => {
    const current = clipboardNoticeRef.current;
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(current)
      : nextOrUpdater;
    clipboardNoticeRef.current = next;
    if (onClipboardNoticeChange) onClipboardNoticeChange(next);
    else setLocalClipboardNotice(next);
    return next;
  }, [onClipboardNoticeChange]);

  const markTaskClipboardCopiesOutdated = useCallback(() => {
    setClipboardNotice((current) => markCopiedClipboardNoticeOutdated(
      markCopiedClipboardNoticeOutdated(current, 'result'),
      'actions',
    ));
  }, [setClipboardNotice]);

  const { invoke, on } = useIpc();
  const { clipboardEvent, clearClipboard } = useClipboard();

  const updateSavedTerms = useCallback((nextOrUpdater) => {
    const current = savedTermsRef.current;
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(current)
      : nextOrUpdater;
    const normalized = Array.isArray(next) ? next : [];
    savedTermsRef.current = normalized;
    setSavedTerms(normalized);
    return normalized;
  }, []);

  const setSavedTermsLoadState = useCallback((status, {
    epoch = savedTermsLoadRef.current.epoch,
    promise = null,
    error = null,
  } = {}) => {
    let resolvedError = error;
    if (status === SAVED_TERMS_LOAD_STATUS.READY) {
      savedTermsReconciliationErrorCodeRef.current = '';
    } else if (status === SAVED_TERMS_LOAD_STATUS.ERROR) {
      const incomingCode = error?.code || '';
      if (SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(incomingCode)) {
        savedTermsReconciliationErrorCodeRef.current = incomingCode;
      } else if (savedTermsReconciliationErrorCodeRef.current) {
        resolvedError = createSavedTermsLoadError(
          savedTermsReconciliationErrorCodeRef.current,
        );
      }
    }
    savedTermsLoadRef.current = { epoch, status, promise, error: resolvedError };
    setSavedTermsLoadStatus(status);
    const errorCode = status === SAVED_TERMS_LOAD_STATUS.ERROR
      ? resolvedError?.code || ''
      : '';
    setSavedTermsLoadErrorCode(errorCode);
    setSavedTermsLoadError(status === SAVED_TERMS_LOAD_STATUS.ERROR
      ? SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(errorCode)
        ? '无法确认最近一次术语更改是否完成。请重新读取这台 Mac 上的术语后再继续。'
        : '暂时无法读取已保存术语。已保存内容仍保留在这台 Mac。'
      : '');
    return resolvedError;
  }, []);

  const ensureSavedTermsLoaded = useCallback(({ force = false } = {}) => {
    const current = savedTermsLoadRef.current;
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.READY) {
      return Promise.resolve(savedTermsRef.current);
    }
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.LOADING && current.promise) {
      return current.promise;
    }
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.ERROR) {
      return Promise.reject(current.error || createSavedTermsLoadError());
    }

    const epoch = current.epoch + 1;
    const request = invoke(IPC_CHANNELS.TERMS_GET)
      .then((terms) => {
        if (!isCanonicalSavedTerms(terms)) {
          throw createSavedTermsLoadError('saved-terms-invalid-response');
        }
        if (savedTermsLoadRef.current.epoch !== epoch) {
          throw createSavedTermsLoadError('saved-terms-load-stale');
        }
        const normalized = updateSavedTerms(terms);
        setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.READY, { epoch });
        return normalized;
      })
      .catch((cause) => {
        if (savedTermsLoadRef.current.epoch !== epoch) {
          throw createSavedTermsLoadError('saved-terms-load-stale');
        }
        const error = typeof cause?.code === 'string' && cause.code.startsWith('saved-terms-')
          ? cause
          : createSavedTermsLoadError();
        const publishedError = setSavedTermsLoadState(
          SAVED_TERMS_LOAD_STATUS.ERROR,
          { epoch, error },
        );
        throw publishedError || error;
      });

    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.LOADING, { epoch, promise: request });
    return request;
  }, [invoke, setSavedTermsLoadState, updateSavedTerms]);

  const retrySavedTermsLoad = useCallback(
    () => ensureSavedTermsLoaded({ force: true }),
    [ensureSavedTermsLoaded],
  );

  const invalidateSavedTermsLoadRequest = useCallback(() => {
    const current = savedTermsLoadRef.current;
    savedTermsLoadRef.current = {
      ...current,
      epoch: current.epoch + 1,
      promise: null,
    };
  }, []);

  const runSavedTermsMutation = useCallback(async (kind, operation, commit) => {
    if (savedTermsMutationRef.current) {
      const error = new Error('saved-terms-operation-pending');
      error.code = 'saved-terms-operation-pending';
      throw error;
    }
    if (savedTermsLoadRef.current.status !== SAVED_TERMS_LOAD_STATUS.READY) {
      throw createSavedTermsLoadError();
    }

    invalidateSavedTermsLoadRequest();
    const owner = {
      epoch: savedTermsLoadRef.current.epoch,
      kind,
    };
    savedTermsMutationRef.current = owner;
    try {
      const response = await operation();
      if (
        savedTermsMutationRef.current !== owner
        || savedTermsLoadRef.current.epoch !== owner.epoch
      ) {
        throw createSavedTermsLoadError('saved-terms-operation-stale');
      }
      commit?.(response);
      return response;
    } catch (cause) {
      if (
        savedTermsMutationRef.current === owner
        && savedTermsLoadRef.current.epoch === owner.epoch
      ) {
        const error = SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(cause?.code)
          ? cause
          : createSavedTermsLoadError('saved-terms-mutation-unconfirmed');
        setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
          epoch: owner.epoch,
          error,
        });
        throw error;
      }
      throw cause;
    } finally {
      if (savedTermsMutationRef.current === owner) savedTermsMutationRef.current = null;
    }
  }, [invalidateSavedTermsLoadRequest, setSavedTermsLoadState]);

  const commitSavedTermResponse = useCallback((savedTerm, expected = {}) => {
    const expectedKey = savedTermKey(expected.term);
    const responseMatchesRequest = (!expectedKey || savedTermKey(savedTerm) === expectedKey)
      && (expected.id == null || savedTerm?.id === expected.id);
    if (!isCanonicalSavedTerm(savedTerm) || !responseMatchesRequest) {
      const error = createSavedTermsLoadError('saved-terms-invalid-mutation-response');
      setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
        epoch: savedTermsLoadRef.current.epoch,
        error,
      });
      throw error;
    }
    updateSavedTerms((terms) => upsertSavedTerm(terms, savedTerm));
  }, [setSavedTermsLoadState, updateSavedTerms]);

  const {
    settings,
    updateSettings,
    discardFailedSettings,
    processingConfigRevision = 0,
    processingConfigGenerationRef,
    shortcutStatus,
  } = settingsController;
  const processingRecovery = describeProcessingRecovery(processingErrorCode, settings.activeBackend);
  const setupIncomplete = settings.setupMode === 'unconfigured';
  const processingConfigSignature = getProcessingConfigSignature(settings);
  const processingConfigChangeKey = `${processingConfigSignature}\u0000${processingConfigRevision}`;
  const processingConfigEffectGeneration = processingConfigRevision;
  const previousProcessingConfigRef = useRef(processingConfigChangeKey);
  const initialProcessingConfigSignatureRef = useRef(processingConfigSignature);
  const previousVerificationPolicyRef = useRef(settings.verificationPolicy);

  pendingClipboardRef.current = pendingClipboardItem;
  clipboardNoticeRef.current = clipboardNotice;
  taskSurfaceVisibleRef.current = visible;
  statusRef.current = status;
  clipboardMonitoringEnabledRef.current = settings.clipboardMonitoring === true;
  replyDialogOpenRef.current = replyDialogOpen;
  replyDraftStateRef.current = replyDraftState;
  const manualClipboardReadPending = pendingClipboardItem?.source === 'manual-read';
  const replyProgressConsistency = getReplyProgressConsistencyForBrief(
    brief,
    completedActionIds,
  );
  const replyCompletionClaimCurrent = replyDraftState?.completionStatus !== 'completed'
    || replyDraftState.overrideConfirmed === true
    || replyProgressConsistency.requiredCount === 0
    || replyProgressConsistency.isComplete;
  replyCompletionClaimCurrentRef.current = replyCompletionClaimCurrent;
  clipboardEventGuardRef.current = {
    status,
    hasInput: Boolean(inputText.trim()),
    hasResult: status === STATUS.DONE || Boolean(lastGoodRef.current),
    isEditingSource,
    isVerifying: isVerifying || isCancellingVerification,
    hasSessionRecovery: Boolean(pendingSessionRecovery),
    hasForegroundDecision: Boolean(
      captureDecisionBlocked
      || pendingSessionRecovery
      || clipboardResidueRisk
      || savedTermsDrawerOpen
      || processingSettingsGuardOpen
      || clearedSession
      || replyDialogOpen
      || manualClipboardReadPending
    ),
  };
  const baseForegroundCaptureContext = {
    appDecisionBlocked: captureDecisionBlocked,
    hasSessionRecovery: Boolean(pendingSessionRecovery),
    hasClipboardResidueRisk: Boolean(clipboardResidueRisk),
    savedTermsOpen: savedTermsDrawerOpen,
    hasActiveDecision: processingSettingsGuardOpen,
    hasReplyDraft: replyDialogOpen,
    isEditingSource,
    hasClearedSessionUndo: Boolean(clearedSession),
    hasSourceDraft: status !== STATUS.DONE && Boolean(inputText.trim()),
  };
  const baseForegroundCaptureReason = getForegroundCaptureBlockReason(
    baseForegroundCaptureContext,
  );
  const foregroundCaptureContext = {
    ...baseForegroundCaptureContext,
    hasActiveDecision: processingSettingsGuardOpen || manualClipboardReadPending,
  };
  foregroundCaptureContextRef.current = foregroundCaptureContext;
  const foregroundCaptureReason = getForegroundCaptureBlockReason(foregroundCaptureContext);
  const foregroundCaptureDecisionBlocking = isForegroundCaptureDecisionBlocking(
    foregroundCaptureReason,
    foregroundCaptureContext,
  );
  const hasForegroundFocusOwner = foregroundCaptureDecisionBlocking
    || Boolean(pendingScreenshotRequest)
    || Boolean(pendingClipboardItem)
    || Boolean(approvedCaptureRequest);
  const pendingScreenshotDecisionStillBlocking = Boolean(
    pendingScreenshotRequest
    && (
      foregroundCaptureDecisionBlocking
      || isForegroundCaptureDecisionBlocking(
        pendingScreenshotRequest.reason,
        foregroundCaptureContext,
      )
    )
  );
  const pendingClipboardDecisionStillBlocking = Boolean(
    pendingClipboardItem && (
      (
        foregroundCaptureDecisionBlocking
        && !(
          manualClipboardReadPending
          && foregroundCaptureReason === 'active-decision'
          && !isForegroundCaptureDecisionBlocking(
            baseForegroundCaptureReason,
            baseForegroundCaptureContext,
          )
        )
      )
      || (pendingScreenshotRequest && !manualClipboardReadPending)
    )
  );
  foregroundCaptureDecisionBlockingRef.current = foregroundCaptureDecisionBlocking;
  pendingClipboardDecisionStillBlockingRef.current = pendingClipboardDecisionStillBlocking;

  useLayoutEffect(() => {
    const focusToken = pendingManualClipboardFocusTokenRef.current;
    if (
      !visible
      || !manualClipboardReadPending
      || pendingClipboardDecisionStillBlocking
      || !Number.isSafeInteger(focusToken)
      || focusedManualClipboardTokenRef.current === focusToken
    ) return;
    if (focusAvailableElement(pendingClipboardStatusRef.current)) {
      focusedManualClipboardTokenRef.current = focusToken;
    }
  }, [
    manualClipboardReadPending,
    pendingClipboardDecisionStillBlocking,
    pendingClipboardItem,
    visible,
  ]);

  useEffect(() => {
    if (
      !visible
      || foregroundCaptureDecisionBlocking
      || status === STATUS.PROCESSING
    ) {
      revokeDelayedCaptureDispatch();
    }
  }, [
    foregroundCaptureDecisionBlocking,
    revokeDelayedCaptureDispatch,
    status,
    visible,
  ]);

  const handleReplyDialogOpenChange = useCallback((nextOpen) => {
    const open = nextOpen === true;
    replyDialogOpenRef.current = open;
    if (open) {
      foregroundCaptureDecisionBlockingRef.current = true;
      revokeDelayedCaptureDispatch();
    }
    setReplyDialogOpen(open);
  }, [revokeDelayedCaptureDispatch]);

  const handleReplyDraftStateChange = useCallback((nextState) => {
    const sanitized = sanitizeReplyDraftState(nextState);
    replyDraftStateRef.current = sanitized;
    setReplyDraftState(sanitized);
  }, []);

  const resumeReplyDraft = useCallback(() => {
    revokeDelayedCaptureDispatch();
    replyDialogOpenRef.current = true;
    foregroundCaptureDecisionBlockingRef.current = true;
    setReplyFocusRequest((current) => current + 1);
    setReplyDialogOpen(true);
  }, [revokeDelayedCaptureDispatch]);

  useEffect(() => {
    setClipboardNotice((current) => reconcileReplyClipboardNotice(current, {
      replyDraftState,
      completionClaimCurrent: replyCompletionClaimCurrent,
      taskActive: status === STATUS.DONE && (
        !Number.isSafeInteger(current?.taskGeneration)
        || current.taskGeneration === replyTaskGenerationRef.current
      ),
    }));
  }, [replyCompletionClaimCurrent, replyDraftState, setClipboardNotice, status]);

  useEffect(() => {
    if (
      !initialCaptureFocusPendingRef.current
      || !visible
      || setupIncomplete
      || status !== STATUS.IDLE
      || hasForegroundFocusOwner
    ) return undefined;

    let cancelled = false;
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (
          cancelled
          || !taskSurfaceVisibleRef.current
          || statusRef.current !== STATUS.IDLE
          || foregroundCaptureDecisionBlockingRef.current
          || document.querySelector('[aria-modal="true"]')
        ) return;
        const target = textareaRef.current;
        const activeElement = document.activeElement;
        if (
          activeElement
          && activeElement !== document.body
          && activeElement !== document.documentElement
          && activeElement !== target
        ) {
          initialCaptureFocusPendingRef.current = false;
          return;
        }
        if (focusAvailableElement(target)) {
          initialCaptureFocusPendingRef.current = false;
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [hasForegroundFocusOwner, setupIncomplete, status, visible]);

  useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;
    if (!visible) {
      settingsReturnFocusReadyRef.current = false;
      return undefined;
    }
    if (wasVisible === false) settingsReturnFocusReadyRef.current = true;

    const settingsDestination = settingsReturnFocusRef.current;
    const settingsElement = settingsReturnFocusElementRef.current;
    const hasSettingsHandoff = Boolean(settingsDestination || settingsElement);
    const enteredAfterSetup = settingsReturnFocusReadyRef.current
      && status === STATUS.IDLE
      && !hasForegroundFocusOwner;
    // Explicit Settings handoffs are only eligible once the panel has really
    // left Settings and become visible again. Closing the processing guard
    // while cancellation is still pending must not consume the destination.
    if (hasSettingsHandoff && !settingsReturnFocusReadyRef.current) return undefined;
    if (!hasSettingsHandoff && !enteredAfterSetup) return undefined;

    const destination = settingsDestination || 'source';
    const setupHandoff = !settingsDestination && !settingsElement;
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (setupHandoff && (
          !taskSurfaceVisibleRef.current
          || statusRef.current !== STATUS.IDLE
          || foregroundCaptureDecisionBlockingRef.current
        )) return;
        let focusTransferred = false;
        if (manualClipboardReadPending) {
          focusTransferred = focusAvailableElement(pendingClipboardStatusRef.current);
        } else if (settingsElement && focusAvailableElement(settingsElement)) {
          focusTransferred = true;
        } else if (destination === 'source') {
          focusTransferred = focusAvailableElement(textareaRef.current);
        }
        else if (destination === 'result') focusTransferred = focusAvailableElement(resultFocusTarget());
        else if (destination === 'review') {
          focusTransferred = focusAvailableElement(ocrReviewHeadingRef.current);
        }
        else if (destination === 'error') {
          focusTransferred = focusAvailableElement(document.getElementById('processing-error-card'));
        }
        else focusTransferred = focusAvailableElement(settingsTriggerRef.current);
        // Clear a handoff only after focus actually lands. If dependencies
        // cancel either animation frame, the next effect pass retries instead
        // of silently losing the original Command+, destination.
        if (focusTransferred) {
          if (settingsReturnFocusRef.current === settingsDestination) {
            settingsReturnFocusRef.current = null;
          }
          if (settingsReturnFocusElementRef.current === settingsElement) {
            settingsReturnFocusElementRef.current = null;
          }
          settingsReturnFocusReadyRef.current = false;
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [hasForegroundFocusOwner, manualClipboardReadPending, status, visible]);

  useLayoutEffect(() => {
    if (
      !visible
      || status !== STATUS.PROCESSING
      || hasForegroundFocusOwner
    ) return;
    focusAvailableElement(processingContextRef.current);
  }, [hasForegroundFocusOwner, status, visible]);

  useLayoutEffect(() => {
    if (status !== STATUS.ERROR) {
      ordinaryErrorFocusHandledRef.current = false;
      return undefined;
    }
    if (
      ordinaryErrorFocusHandledRef.current
      || !visible
      || hasForegroundFocusOwner
      || captureErrorCode === 'screenshot-permission-denied'
    ) return undefined;

    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (
          statusRef.current !== STATUS.ERROR
          || !taskSurfaceVisibleRef.current
          || document.querySelector('[aria-modal="true"]')
        ) return;
        if (focusAvailableElement(document.getElementById('processing-error-card'))) {
          ordinaryErrorFocusHandledRef.current = true;
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [captureErrorCode, error, hasForegroundFocusOwner, status, visible]);

  useEffect(() => {
    if (status === STATUS.DONE || !replyDialogOpenRef.current) return;
    replyDialogOpenRef.current = false;
    setReplyDialogOpen(false);
  }, [status]);

  useEffect(() => {
    if (!processingSettingsGuardOpen) return undefined;
    const dialog = processingSettingsGuardRef.current;
    const trigger = settingsGuardReturnFocusRef.current || settingsTriggerRef.current;
    const textarea = textareaRef.current;
    const settingsTrigger = settingsTriggerRef.current;
    const shell = dialog?.closest('.slipstream-shell');
    const hiddenSiblings = shell
      ? [...shell.children].filter((node) => !node.classList.contains('processing-settings-guard-backdrop'))
      : [];
    const previousAria = hiddenSiblings.map((node) => node.getAttribute('aria-hidden'));
    hiddenSiblings.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        revokePendingSettingsNavigation();
        setProcessingSettingsGuardOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => dialog?.querySelector('[data-settings-guard-focus]')?.focus());
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      hiddenSiblings.forEach((node, index) => {
        node.inert = false;
        if (previousAria[index] === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previousAria[index]);
      });
      if (
        !settingsOpenIntentRef.current
        && !settingsReturnFocusRef.current
        && !settingsReturnFocusElementRef.current
      ) {
        window.requestAnimationFrame(() => {
          if (focusAvailableElement(trigger)) return;
          const fallback = settledTaskFocusTarget()
            || textarea
            || settingsTrigger;
          focusAvailableElement(fallback);
        });
      }
      settingsGuardReturnFocusRef.current = null;
    };
  }, [processingSettingsGuardOpen, revokePendingSettingsNavigation]);

  const setWindowMode = useCallback((mode) => {
    return invoke(IPC_CHANNELS.WINDOW_SET_MODE || 'window:set-mode', mode).catch(() => false);
  }, [invoke]);

  const discardClearedSession = useCallback(({ restoreFocus = false } = {}) => {
    if (clearUndoTimerRef.current) {
      window.clearTimeout(clearUndoTimerRef.current);
      clearUndoTimerRef.current = null;
    }
    const undoHadFocus = clearUndoRegionRef.current?.contains(document.activeElement);
    clearUndoPauseOwnerRef.current = null;
    clearedSessionRef.current = null;
    setClearedSession(null);
    setClearedSessionSecondsRemaining(0);
    if (restoreFocus && undoHadFocus) {
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const armClearedSessionUndo = useCallback((snapshot) => {
    discardClearedSession();
    const expiresAt = Date.now() + CLEAR_UNDO_WINDOW_MS;
    const pendingUndo = {
      snapshot,
      kind: snapshot.brief || snapshot.result ? 'result' : 'draft',
      expiresAt,
    };
    clearedSessionRef.current = pendingUndo;
    setClearedSession(pendingUndo);
    setClearedSessionSecondsRemaining(getClearUndoSecondsRemaining(expiresAt));
    clearUndoTimerRef.current = window.setTimeout(() => {
      if (clearedSessionRef.current === pendingUndo) {
        discardClearedSession({ restoreFocus: true });
      }
    }, CLEAR_UNDO_WINDOW_MS);
    window.requestAnimationFrame(() => clearUndoButtonRef.current?.focus({ preventScroll: true }));
  }, [discardClearedSession]);

  const pauseClearedSessionUndo = useCallback((attemptToken) => {
    const current = clearedSessionRef.current;
    const paused = pauseClearUndoWindow(current);
    if (!paused || paused === current) return null;
    if (clearUndoTimerRef.current) {
      window.clearTimeout(clearUndoTimerRef.current);
      clearUndoTimerRef.current = null;
    }
    const owner = Object.freeze({ attemptToken, session: paused });
    clearUndoPauseOwnerRef.current = owner;
    clearedSessionRef.current = paused;
    setClearedSession(paused);
    setClearedSessionSecondsRemaining(
      getClearUndoSecondsRemaining(paused.remainingMs, 0),
    );
    return owner;
  }, []);

  const resumeClearedSessionUndo = useCallback((owner = clearUndoPauseOwnerRef.current) => {
    if (
      !owner
      || clearUndoPauseOwnerRef.current !== owner
      || clearedSessionRef.current !== owner.session
      || owner.attemptToken !== clipboardReadRunRef.current
    ) return false;
    const resumedAt = Date.now();
    const resumed = resumeClearUndoWindow(owner.session, resumedAt);
    if (!resumed || resumed === owner.session) return false;
    const remainingMs = resumed.expiresAt - resumedAt;
    clearUndoPauseOwnerRef.current = null;
    clearedSessionRef.current = resumed;
    setClearedSession(resumed);
    setClearedSessionSecondsRemaining(
      getClearUndoSecondsRemaining(resumed.expiresAt, resumedAt),
    );
    clearUndoTimerRef.current = window.setTimeout(() => {
      if (clearedSessionRef.current === resumed) {
        discardClearedSession({ restoreFocus: true });
      }
    }, remainingMs);
    return true;
  }, [discardClearedSession]);

  useEffect(() => () => {
    if (clearUndoTimerRef.current) window.clearTimeout(clearUndoTimerRef.current);
    clearUndoPauseOwnerRef.current = null;
  }, []);

  useEffect(() => {
    if (RESULT_DEMO) {
      clearSessionRecovery(getSessionRecoveryStorage());
      return undefined;
    }
    const flushSessionRecovery = () => {
      if (!sessionRecoveryReadyRef.current) return;
      const storage = getSessionRecoveryStorage();
      if (latestSessionRecoveryRef.current) {
        // Flush the latest user-state snapshot without extending its privacy
        // lifetime. A real state change creates a new record and timestamp;
        // an idle heartbeat or pagehide must not turn 30 minutes into forever.
        writeSessionRecovery(storage, latestSessionRecoveryRef.current);
      } else {
        clearSessionRecovery(storage);
      }
    };
    const heartbeat = window.setInterval(flushSessionRecovery, 5 * 60 * 1000);
    window.addEventListener('pagehide', flushSessionRecovery);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', flushSessionRecovery);
      if (sessionRecoveryWriteTimerRef.current) {
        window.clearTimeout(sessionRecoveryWriteTimerRef.current);
      }
    };
  }, []);

  const clearedSessionExpiresAt = clearedSession?.expiresAt ?? null;
  useEffect(() => {
    if (!clearedSessionExpiresAt) return undefined;
    const updateRemainingTime = () => {
      setClearedSessionSecondsRemaining(
        getClearUndoSecondsRemaining(clearedSessionExpiresAt),
      );
    };
    updateRemainingTime();
    const interval = window.setInterval(updateRemainingTime, 250);
    return () => window.clearInterval(interval);
  }, [clearedSessionExpiresAt]);

  useEffect(() => {
    if (previousVerificationPolicyRef.current === settings.verificationPolicy) return;
    previousVerificationPolicyRef.current = settings.verificationPolicy;
    setVerificationApprovalId(null);
    lastGoodRef.current = withVerificationApproval(lastGoodRef.current, null);
    if (!isVerifying) return;
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => false);
    setIsVerifying(false);
    setIsCancellingVerification(false);
  }, [invoke, isVerifying, settings.verificationPolicy]);

  useEffect(() => {
    if (!visible) return;
    void ensureSavedTermsLoaded().catch(() => false);
  }, [ensureSavedTermsLoaded, visible]);

  useEffect(() => {
    if (!rendererRecovered || rendererRecoveryNoticeHandledRef.current) return;
    rendererRecoveryNoticeHandledRef.current = true;
    if (!initialSessionRecoveryPendingRef.current) {
      setWarning('界面已从意外中断中重新载入；没有找到可恢复的临时原文或结果。');
    }
  }, [rendererRecovered]);

  useEffect(() => {
    onSessionRecoveryPendingChange?.(Boolean(pendingSessionRecovery));
    return () => onSessionRecoveryPendingChange?.(false);
  }, [onSessionRecoveryPendingChange, pendingSessionRecovery]);

  useEffect(() => {
    if (!visible) {
      savedTermsDrawerOpenRef.current = false;
      setSavedTermsDrawerOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!RESULT_DEMO) return;
    setInputText(PREVIEW_SOURCE_TEXT);
    setProcessedSourceText(PREVIEW_SOURCE_TEXT);
    setBrief(PREVIEW_ACTION_BRIEF);
    setCompletedActionIds([]);
    setResult('');
    setCaptureMeta(PREVIEW_CAPTURE);
    setSourceType('ocr');
    setProcessingTimeMs(6800);
    setVerificationTimeMs(null);
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
      verificationTimeMs: null,
      verificationApprovalId: RESULT_DEMO_APPROVAL_ID,
      processingConfigSignature: initialProcessingConfigSignatureRef.current,
      processingLocation: PREVIEW_ACTION_BRIEF.analysisProvenance.processingLocation,
      processingProvider: PREVIEW_ACTION_BRIEF.analysisProvenance.provider,
      warning: '',
      completedActionIds: [],
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

  useLayoutEffect(() => {
    if (!ocrReview) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      ocrReviewHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ocrReview]);

  useEffect(() => {
    if (
      ocrReview
      || sourceType !== 'ocr'
      || !inputText.trim()
      || status === STATUS.PROCESSING
      || status === STATUS.DONE
    ) return;
    const assessment = assessOcrReview(sourceType, captureMeta);
    if (!assessment.required) return;
    setOcrReview({
      sourceText: inputText,
      capture: captureMeta,
      sourceSha256: null,
      assessment,
    });
  }, [captureMeta, inputText, ocrReview, sourceType, status]);

  useEffect(() => {
    if (captureErrorCode !== 'screenshot-permission-denied' || status !== STATUS.ERROR) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      permissionRecoveryButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [captureErrorCode, status]);

  const applyClipboardPayload = useCallback((payload, { delayMs = 400 } = {}) => {
    const clipboardText = payload?.text;
    if (!clipboardText?.trim()) return false;

    const dispatchOwnership = revokeDelayedCaptureDispatch({ sourceReplaced: true });
    discardClearedSession();
    requestCoordinatorRef.current.invalidate();
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    setVerificationApprovalId(null);
    setIsVerifying(false);
    setIsCancellingVerification(false);
    setSourceLimitActionNotice('');
    setOcrReview(null);
    setIsConfirmingOcrReview(false);
    setInputText(clipboardText);
    const nextSourceType = payload.source === 'ocr' ? 'ocr' : 'clipboard';
    setSourceType(nextSourceType);
    setCaptureMeta({
      confidence: payload.confidence ?? null,
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
    });
    setSourceMeta({
      truncated: payload.truncated,
      originalLength: payload.originalLength,
    });
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);

    setWarning('');

    if (payload.truncated) {
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
      return true;
    }

    const ownerToken = dispatchOwnership.currentToken;
    const ownerSourceRevision = dispatchOwnership.sourceRevision;
    delayedCaptureDispatchRef.current = {
      currentToken: ownerToken,
      ownerToken,
      ownerSourceRevision,
    };
    debounceRef.current = window.setTimeout(() => {
      const currentOwnership = delayedCaptureDispatchRef.current;
      const ownsDispatch = currentOwnership.ownerToken === ownerToken
        && currentOwnership.ownerSourceRevision === ownerSourceRevision
        && ownsDelayedCaptureDispatch({
          ownerToken,
          currentToken: currentOwnership.currentToken,
          ownerSourceRevision: currentOwnership.ownerSourceRevision,
          currentSourceRevision: sourceRevisionRef.current,
          visible: taskSurfaceVisibleRef.current,
          foregroundBlocked: foregroundCaptureDecisionBlockingRef.current
            || clipboardEventGuardRef.current?.hasForegroundDecision === true
            || clipboardEventGuardRef.current?.isEditingSource === true
            || replyDialogOpenRef.current,
          processing: statusRef.current === STATUS.PROCESSING
            || activeProcessingRef.current !== null,
        });
      if (!ownsDispatch) {
        if (currentOwnership.ownerToken === ownerToken) revokeDelayedCaptureDispatch();
        return;
      }
      // Consume the one-shot owner before processing can synchronously schedule,
      // replace, or otherwise mutate the current source.
      revokeDelayedCaptureDispatch();
      triggerProcessingRef.current?.(clipboardText, {
        truncated: payload.truncated,
        originalLength: payload.originalLength,
        source: payload.source,
        capture: {
          confidence: payload.confidence ?? null,
          blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
        },
      });
    }, delayMs);
    return true;
  }, [discardClearedSession, revokeDelayedCaptureDispatch, setWindowMode]);

  const announceHiddenCaptureRequest = useCallback((kind) => {
    hiddenCaptureRequestSequenceRef.current += 1;
    onHiddenCaptureRequest?.({
      id: `settings-capture-${hiddenCaptureRequestSequenceRef.current}`,
      kind,
    });
  }, [onHiddenCaptureRequest]);

  useEffect(() => {
    revokeDelayedCaptureDispatch();
    const isMonitoredClipboard = clipboardEvent.source === 'monitor';
    if (isMonitoredClipboard && !clipboardMonitoringEnabledRef.current) return undefined;
    const hiddenShortcutCapture = !visible && clipboardEvent.source === 'shortcut';
    const shouldHoldCapture = !visible || shouldHoldClipboardCapture({
      source: clipboardEvent.source,
      monitoringEnabled: clipboardMonitoringEnabledRef.current,
      ...clipboardEventGuardRef.current,
      hasForegroundDecision: Boolean(
        clipboardEventGuardRef.current?.hasForegroundDecision
        || foregroundCaptureDecisionBlockingRef.current
        || savedTermsDrawerOpenRef.current
        || replyDialogOpenRef.current
      ),
    });
    if (clipboardEvent.error) {
      if (!visible) {
        if (hiddenShortcutCapture) announceHiddenCaptureRequest('clipboard-error');
        clearClipboard();
        return undefined;
      }
      if (clipboardEvent.source === 'shortcut' && shouldHoldCapture) {
        setClipboardQueueAnnouncement('剪贴板里没有可处理的文字；当前原文、任务和结果没有改变。');
        clearClipboard();
        return undefined;
      }
      setCaptureErrorCode(null);
      setProcessingErrorCode(null);
      setError('剪贴板里没有可解释的文本');
      setWarning('');
      setStatus(STATUS.ERROR);
      return undefined;
    }

    const clipboardText = clipboardEvent.text;
    if (!clipboardText?.trim()) return undefined;

    if (shouldHoldCapture) {
      const replyDraftProtected = replyDialogOpenRef.current
        || pendingClipboardRef.current?.replyDraftProtected === true;
      const previousPending = pendingClipboardRef.current;
      const next = createPendingClipboardItem(clipboardEvent, previousPending, {
        replyDraftProtected,
      });
      const manualReadDecisionPreserved = previousPending?.source === 'manual-read'
        && clipboardEvent.source !== 'manual-read'
        && next.source === 'manual-read';
      pendingClipboardRef.current = next;
      setPendingClipboardItem(next);
      const shortcutCapture = clipboardEvent.source === 'shortcut';
      const keptExplicitCapture = clipboardEvent.source === 'monitor' && next.source === 'shortcut';
      setClipboardQueueAnnouncement(manualReadDecisionPreserved
        ? `${shortcutCapture ? '快捷键捕获' : '自动检测'}未保留；手动读取确认未变，请先选择替换或保留。`
        : replyDraftProtected
        ? '新的复制文字已安全保留；回复草稿、选择状态和光标位置都没有改变。关闭草稿后，再决定是否放弃草稿并处理新文字。'
        : keptExplicitCapture
        ? '自动检测到另一段复制文字；当前任务和你通过快捷键选定的等待内容都没有改变。'
        : shortcutCapture
          ? '快捷键捕获了新的复制文字；当前内容未被替换，请在任务完成后确认是否处理。'
          : next.receivedCount > 1
            ? `连续检测到 ${next.receivedCount} 段复制文字；当前内容未被替换，仅保留最新一段等待处理。`
            : '检测到新的复制文字；当前内容未被替换，新文字正在等待处理。');
      if (
        shortcutCapture
        && visible
        && !foregroundCaptureDecisionBlockingRef.current
      ) {
        window.requestAnimationFrame(() => {
          if (foregroundCaptureDecisionBlockingRef.current || replyDialogOpenRef.current) return;
          focusAvailableElement(pendingClipboardStatusRef.current);
        });
      }
      if (hiddenShortcutCapture) announceHiddenCaptureRequest('clipboard');
      clearClipboard();
      return undefined;
    }

    applyClipboardPayload(clipboardEvent);

    return () => {
      revokeDelayedCaptureDispatch();
    };
  }, [announceHiddenCaptureRequest, applyClipboardPayload, clearClipboard, clipboardEvent, revokeDelayedCaptureDispatch, visible]);

  const invalidateVerification = useCallback(() => {
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    setVerificationApprovalId(null);
    lastGoodRef.current = withVerificationApproval(lastGoodRef.current, null);
    setIsVerifying(false);
    setIsCancellingVerification(false);
  }, []);

  const replaceSessionRecoveryWithLastGood = useCallback((snapshot, storage) => {
    if (!snapshot) return;
    const cleanSnapshot = {
      ...snapshot,
      warning: removeFailedProcessingAttemptNotice(snapshot.warning),
    };
    const cleanWarning = removeFailedProcessingAttemptNotice(setupIncomplete
      ? resolveSnapshotWarning(
        cleanSnapshot,
        processingConfigSignature,
        '',
        SETUP_INCOMPLETE_WARNING,
      )
      : resolveSnapshotWarning(cleanSnapshot, processingConfigSignature));
    const record = createSessionRecoveryRecord({
      inputText: cleanSnapshot.inputText,
      processedSourceText: cleanSnapshot.processedSourceText,
      brief: cleanSnapshot.brief,
      result: cleanSnapshot.result,
      captureMeta: cleanSnapshot.captureMeta,
      sourceMeta: cleanSnapshot.sourceMeta,
      status: STATUS.DONE,
      warning: cleanWarning,
      processingErrorCode: null,
      processingTimeMs: cleanSnapshot.processingTimeMs,
      verificationTimeMs: cleanSnapshot.verificationTimeMs,
      sourceType: cleanSnapshot.sourceType,
      lastGood: cleanSnapshot,
      completedActionIds: cleanSnapshot.completedActionIds || [],
      verificationApprovalId: cleanSnapshot.verificationApprovalId,
      isEditingSource: false,
      sourceEditDraft: null,
      isVerifying: false,
      replyDraftState: replyDraftStateRef.current,
    });
    latestSessionRecoveryRef.current = record;
    if (record) writeSessionRecovery(storage, record);
  }, [processingConfigSignature, setupIncomplete]);

  const restoreLastGood = useCallback((message = '', captureIssueCode = null, processingIssueCode = null) => {
    const snapshot = lastGoodRef.current;
    if (!snapshot) return false;
    if (
      !RESULT_DEMO
      && failedProcessingAttemptRef.current
      && sessionRecoveryReadyRef.current
    ) {
      if (sessionRecoveryWriteTimerRef.current) {
        window.clearTimeout(sessionRecoveryWriteTimerRef.current);
        sessionRecoveryWriteTimerRef.current = null;
      }
      latestSessionRecoveryRef.current = null;
      const storage = getSessionRecoveryStorage();
      // The in-flight record may already contain B. Clear it before any A
      // restoration state is exposed, then synchronously replace it with A.
      clearSessionRecovery(storage);
      replaceSessionRecoveryWithLastGood(snapshot, storage);
    }
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    setOcrReview(null);
    setIsConfirmingOcrReview(false);
    setInputText(snapshot.inputText);
    setProcessedSourceText(snapshot.processedSourceText);
    setBrief(snapshot.brief);
    setCompletedActionIds(snapshot.completedActionIds || []);
    setResult(snapshot.result);
    setSourceType(snapshot.sourceType);
    setCaptureMeta(snapshot.captureMeta);
    setSourceMeta(snapshot.sourceMeta);
    setProcessingTimeMs(snapshot.processingTimeMs);
    setVerificationTimeMs(snapshot.verificationTimeMs ?? null);
    setVerificationApprovalId(snapshot.verificationApprovalId);
    setIsVerifying(false);
    setIsCancellingVerification(false);
    setCaptureErrorCode(captureIssueCode);
    setProcessingErrorCode(processingIssueCode);
    setError(null);
    if (setupIncomplete) {
      setWarning(appendFailedProcessingAttemptNotice(resolveSnapshotWarning(
        snapshot,
        processingConfigSignature,
        message,
        SETUP_INCOMPLETE_WARNING,
      ), failedProcessingAttemptRef.current));
    } else {
      setWarning(resolveSnapshotWarning(snapshot, processingConfigSignature, message));
      setWarning((current) => appendFailedProcessingAttemptNotice(
        current,
        failedProcessingAttemptRef.current,
      ));
    }
    setStatus(STATUS.DONE);
    setIsEditingSource(false);
    setWindowMode('result');
    return true;
  }, [processingConfigSignature, replaceSessionRecoveryWithLastGood, revokeDelayedCaptureDispatch, setWindowMode, setupIncomplete]);

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
      // A capture-only OCR request has not crossed the model boundary yet.
      // Let it finish and submit against the newest saved configuration.
      if (!activeProcessing) return;
      if (activeProcessing?.configGeneration === processingConfigEffectGeneration) return;
      const restoreRetry = shouldRestoreLastGoodAfterConfigChange(
        activeProcessing,
        lastGoodRef.current,
      );
      const cancelToken = processingCancelRunRef.current.token + 1;
      processingCancelRunRef.current = {
        token: cancelToken,
        pending: true,
        failedTaskId: null,
        failedScreenshotToken: null,
      };
      setIsCancellingProcessing(true);
      setProcessingCancelError('');
      // Suppress the obsolete result and discard any intent queued under the
      // old configuration, but retain the visible task/location until main
      // confirms the request has settled.
      requestCoordinatorRef.current.invalidate();
      void (async () => {
        let acknowledged = false;
        try {
          acknowledged = await invoke(IPC_CHANNELS.LLM_CANCEL) === true;
        } catch {
          acknowledged = false;
        }
        if (processingCancelRunRef.current.token !== cancelToken) return;
        processingCancelRunRef.current = {
          ...processingCancelRunRef.current,
          pending: false,
        };
        setIsCancellingProcessing(false);
        if (activeProcessingRef.current?.taskId !== activeProcessing.taskId) return;
        if (!acknowledged) {
          setProcessingCancelError(processingCancelFailureMessage(
            activeProcessing.processingLocation ?? PROCESSING_LOCATIONS.UNKNOWN,
          ));
          return;
        }
        activeProcessingRef.current = null;
        setActiveProcessingSnapshot(null);
        if (restoreRetry && restoreLastGood()) return;
        setStatus(STATUS.IDLE);
        setError(null);
        setProcessingErrorCode(null);
        setWarning(setupIncomplete ? SETUP_INCOMPLETE_WARNING : PROCESSING_CONFIG_CHANGED_WARNING);
      })();
    } else if (status === STATUS.ERROR) {
      setStatus(STATUS.IDLE);
      setError(null);
      setProcessingErrorCode(null);
      setWarning(setupIncomplete ? SETUP_INCOMPLETE_WARNING : PROCESSING_CONFIG_CHANGED_WARNING);
    } else if (status === STATUS.DONE && lastGoodRef.current) {
      if (activeProcessingRef.current
        && activeProcessingRef.current.configGeneration !== processingConfigEffectGeneration) {
        activeProcessingRef.current = null;
        setActiveProcessingSnapshot(null);
      }
      // A failed retry is shown on top of the last valid result as a warning.
      // Reconcile against the configuration that produced that result so A →
      // B → A restores A without carrying B's obsolete failure forward.
      const snapshot = lastGoodRef.current;
      setError(null);
      setProcessingErrorCode(null);
      const snapshotWarning = setupIncomplete
        ? resolveSnapshotWarning(
          snapshot,
          processingConfigSignature,
          '',
          SETUP_INCOMPLETE_WARNING,
        )
        : resolveSnapshotWarning(snapshot, processingConfigSignature);
      setWarning(appendFailedProcessingAttemptNotice(
        snapshotWarning,
        failedProcessingAttemptRef.current,
      ));
    }
  }, [invoke, processingConfigChangeKey, processingConfigEffectGeneration, processingConfigGenerationRef, processingConfigSignature, restoreLastGood, setupIncomplete, status]);

  useEffect(() => {
    const unsubscribe = on(IPC_CHANNELS.OCR_ERROR, (payload) => {
      const message = captureEventMessage(payload);
      if (restoreLastGood(message)) return;
      setCaptureErrorCode(null);
      setProcessingErrorCode(null);
      setError(message);
      setStatus(STATUS.ERROR);
      setWindowMode('capture');
    });
    return unsubscribe;
  }, [on, restoreLastGood, setWindowMode]);

  const runProcessing = useCallback(async (task) => {
    const {
      text,
      options,
      warning: taskWarning = '',
      configGeneration: intendedConfigGeneration,
      configSignature: intendedConfigSignature,
    } = task.payload;
    const requestConfigSignature = intendedConfigSignature ?? processingConfigSignature;
    const requestConfigGeneration = intendedConfigGeneration
      ?? processingConfigGenerationRef?.current
      ?? processingConfigRevision;
    const requestProcessingLocation = normalizeProcessingLocation(options.processingLocation);
    const requestProcessingProvider = options.processingProvider || settings.activeBackend;
    const requestProcessingSnapshot = Object.freeze({
      taskId: task.id,
      retryOfLastGood: Boolean(options.retryOfLastGood),
      configGeneration: requestConfigGeneration,
      processingLocation: requestProcessingLocation,
      processingProvider: requestProcessingProvider,
    });
    activeProcessingRef.current = requestProcessingSnapshot;
    setActiveProcessingSnapshot(requestProcessingSnapshot);
    if (!RESULT_DEMO && sessionRecoveryReadyRef.current && !lastGoodRef.current) {
      if (sessionRecoveryWriteTimerRef.current) {
        window.clearTimeout(sessionRecoveryWriteTimerRef.current);
        sessionRecoveryWriteTimerRef.current = null;
      }
      const activeRecoveryRecord = createSessionRecoveryRecord({
        inputText: text,
        processedSourceText: text,
        captureMeta: options.capture || { confidence: null, blocks: [] },
        sourceMeta: {
          truncated: Boolean(options.truncated),
          originalLength: options.originalLength ?? text.length,
        },
        status: STATUS.PROCESSING,
        warning: taskWarning,
        sourceType: options.source || 'manual',
        processingLocation: requestProcessingSnapshot.processingLocation,
        processingProvider: requestProcessingSnapshot.processingProvider,
      });
      latestSessionRecoveryRef.current = activeRecoveryRecord;
      if (activeRecoveryRecord) {
        writeSessionRecovery(getSessionRecoveryStorage(), activeRecoveryRecord);
      }
    }
    let response;

    try {
      response = await invoke(IPC_CHANNELS.LLM_PROCESS, {
        text,
        backend: requestProcessingProvider,
        model: settings.activeModel,
        promptTemplate: settings.customPrompt,
        languageHint: settings.languageHint,
        source: options.source || 'manual',
        capture: options.capture || null,
        truncated: Boolean(options.truncated),
        originalLength: options.originalLength ?? text.length,
        verificationApproved: Boolean(options.verificationApproved),
        ...(options.ocrReview ? { ocrReview: options.ocrReview } : {}),
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
    const completedAfterCancelFailure = completionOwnsActiveProcessing
      && processingCancelRunRef.current.failedTaskId === task.id;
    const completedAfterSettingsCancelFailure = completedAfterCancelFailure
      && settingsOpenIntentRef.current === 'analysis';
    const restoreLastGoodIfStale = completionOwnsActiveProcessing
      && shouldRestoreLastGoodAfterConfigChange(
        { retryOfLastGood: Boolean(options.retryOfLastGood) },
        lastGoodRef.current,
      );
    const {
      apply,
      next,
      stale,
      restoreLastGood: restoreStaleLastGood,
    } = completeTaskForGeneration(requestCoordinatorRef.current, task, {
      generationIsCurrent,
      restoreLastGoodIfStale,
    });
    if (!next && completionOwnsActiveProcessing) {
      activeProcessingRef.current = null;
      setActiveProcessingSnapshot(null);
    }
    if (!next && restoreStaleLastGood) restoreLastGood();
    else if (!next && stale && completionOwnsActiveProcessing) {
      setError(null);
      setProcessingErrorCode(null);
      setStatus(STATUS.IDLE);
      setWarning(setupIncomplete ? SETUP_INCOMPLETE_WARNING : PROCESSING_CONFIG_CHANGED_WARNING);
      setWindowMode('capture');
    }
    if (apply) {
      const invalidBrief = response?.brief?.status === 'invalid';
      if (response?.success && !invalidBrief && (response.brief || response.text)) {
        setFailedProcessingAttempt(null);
        const reportedProcessingLocation = response?.brief?.analysisProvenance?.processingLocation
          ?? response?.processingLocation;
        const nextProcessingLocation = reportedProcessingLocation == null
          ? requestProcessingLocation
          : normalizeProcessingLocation(reportedProcessingLocation);
        const nextBrief = response.brief
          ? {
              ...response.brief,
              analysisProvenance: {
                ...response.brief.analysisProvenance,
                processingLocation: nextProcessingLocation,
              },
            }
          : null;
        const nextResult = response.text || '';
        const nextCaptureMeta = options.capture || { confidence: null, blocks: [] };
        const nextSourceMeta = {
          truncated: Boolean(options.truncated),
          originalLength: options.originalLength ?? text.length,
        };
        const nextApprovalId = response.verificationSummary?.approvalId || null;
        const nextProcessingTimeMs = response.processingTimeMs || null;
        const completedWarning = completedAfterCancelFailure
          ? appendUniqueWarning(
            taskWarning,
            completedAfterSettingsCancelFailure
              ? PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE
              : PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE,
          )
          : taskWarning;
        replyTaskGenerationRef.current += 1;
        replyDraftStateRef.current = null;
        replyDialogOpenRef.current = false;
        lastGoodRef.current = {
          inputText: text,
          processedSourceText: text,
          brief: nextBrief,
          result: nextResult,
          sourceType: options.source || 'manual',
          captureMeta: nextCaptureMeta,
          sourceMeta: nextSourceMeta,
          processingTimeMs: nextProcessingTimeMs,
          verificationTimeMs: null,
          verificationApprovalId: nextApprovalId,
          processingConfigSignature: requestConfigSignature,
          processingLocation: nextProcessingLocation,
          processingProvider: requestProcessingProvider,
          warning: completedWarning,
          completedActionIds: [],
        };
        setInputText(text);
        setOcrReview(null);
        setProcessedSourceText(text);
        markTaskClipboardCopiesOutdated();
        setBrief(nextBrief);
        setCompletedActionIds([]);
        setReplyDraftState(null);
        setReplyDialogOpen(false);
        setResult(nextResult);
        setSourceType(options.source || 'manual');
        setCaptureMeta(nextCaptureMeta);
        setSourceMeta(nextSourceMeta);
        setVerificationApprovalId(nextApprovalId);
        setWarning(completedWarning);
        setError(null);
        setProcessingErrorCode(null);
        setStatus(STATUS.DONE);
        setProcessingTimeMs(nextProcessingTimeMs);
        setVerificationTimeMs(null);
        setIsEditingSource(false);
        setSourceEditDraft(null);
        setWindowMode('result');
      } else {
        const failureCode = processingFailureCode(response, invalidBrief);
        const failureMessage = invalidBrief
          ? USER_ERROR_MESSAGES['processing-invalid']
          : processingFailureMessage(
            failureCode,
            requestProcessingProvider,
            userErrorMessage(response, PROCESSING_FAILURE_MESSAGE),
          );
        if (failureCode === 'ocr-review-required') {
          const localOcrAssessment = assessOcrReview('ocr', options.capture);
          const authoritativeOcrAssessment = response?.ocrReview
            && typeof response.ocrReview === 'object'
            && response.ocrReview.required === true
            ? response.ocrReview
            : null;
          const reasons = [...new Set([
            ...(Array.isArray(authoritativeOcrAssessment?.reasons)
              ? authoritativeOcrAssessment.reasons
              : []),
            ...(Array.isArray(localOcrAssessment.reasons)
              ? localOcrAssessment.reasons
              : []),
          ])];
          setInputText(text);
          setOcrReview({
            sourceText: text,
            capture: options.capture || null,
            sourceSha256: /^[a-f0-9]{64}$/u.test(
              authoritativeOcrAssessment?.sourceSha256 || '',
            )
              ? authoritativeOcrAssessment.sourceSha256
              : null,
            assessment: {
              ...localOcrAssessment,
              required: true,
              reasons,
            },
          });
          setSourceType('ocr');
          setCaptureMeta(options.capture || { confidence: null, blocks: [] });
          setSourceMeta({
            truncated: Boolean(options.truncated),
            originalLength: options.originalLength ?? text.length,
          });
          invalidateVerification();
          setWarning('');
          setCaptureErrorCode(null);
          setProcessingErrorCode(null);
          setError(null);
          statusRef.current = STATUS.IDLE;
          setStatus(STATUS.IDLE);
          setVerificationApprovalId(null);
          setIsEditingSource(false);
          setSourceEditDraft(null);
          setWindowMode('capture');
        } else if (response?.cancelled) {
          if (!restoreLastGood()) {
            setError(null);
            setProcessingErrorCode(null);
            setStatus(STATUS.IDLE);
            setWindowMode('capture');
          }
        } else if (!restoreLastGood(failureMessage, null, failureCode)) {
          setError(failureMessage);
          setProcessingErrorCode(failureCode);
          setStatus(STATUS.ERROR);
          setVerificationApprovalId(null);
          setWindowMode('capture');
        }
      }
    }

    if (completionOwnsActiveProcessing) {
      if (completedAfterCancelFailure) {
        processingCancelRunRef.current = {
          ...processingCancelRunRef.current,
          failedTaskId: null,
        };
        if (completedAfterSettingsCancelFailure) {
          revokePendingSettingsNavigation();
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              focusAvailableElement(settledTaskFocusTarget());
            });
          });
        }
      }
      setIsCancellingProcessing(false);
      setProcessingCancelError('');
    }

    if (next && runProcessingRef.current) runProcessingRef.current(next);
  }, [invalidateVerification, invoke, markTaskClipboardCopiesOutdated, processingConfigGenerationRef, processingConfigRevision, processingConfigSignature, restoreLastGood, revokePendingSettingsNavigation, setFailedProcessingAttempt, setWindowMode, settings.activeBackend, settings.activeModel, settings.customPrompt, settings.languageHint, setupIncomplete]);

  useEffect(() => {
    runProcessingRef.current = runProcessing;
  }, [runProcessing]);

  const triggerProcessing = useCallback((text, options = {}) => {
    revokeDelayedCaptureDispatch();
    if (pendingClipboardRef.current?.source === 'manual-read') {
      setClipboardQueueAnnouncement('请先决定是否用刚读取的剪贴板文字替换当前原文；尚未开始处理。');
      window.requestAnimationFrame(() => {
        focusAvailableElement(pendingClipboardStatusRef.current);
      });
      return;
    }
    const textToProcess = text || inputText;
    if (!textToProcess?.trim()) return;
    if (settings.setupMode === 'unconfigured') {
      settingsReturnFocusRef.current = status === STATUS.DONE ? 'result' : 'source';
      onOpenSettings(
        '完整分析配置尚未完成；当前原文和上一份结果仍在主面板。完成验证并启用后，返回即可继续处理。',
        'full-analysis',
      );
      return;
    }
    const taskProcessingLocation = processingLocationForSettings(settings);
    if (taskProcessingLocation === PROCESSING_LOCATIONS.UNKNOWN) {
      settingsReturnFocusRef.current = status === STATUS.DONE ? 'result' : 'source';
      onOpenSettings(
        '无法确认当前服务是本机回环还是在线地址；原文和上一份结果仍在主面板。请重新保存并验证连接后再提交。',
        'processing-connection',
      );
      return;
    }
    const currentProcessingConfigRevision = processingConfigGenerationRef?.current
      ?? processingConfigRevision;

    const usesCurrentInput = !text || text === inputText;
    const hasTruncatedOption = Object.prototype.hasOwnProperty.call(options, 'truncated');
    const hasOriginalLengthOption = Object.prototype.hasOwnProperty.call(options, 'originalLength');
    const hasCaptureOption = Object.prototype.hasOwnProperty.call(options, 'capture');
    const normalizedOptions = {
      ...options,
      source: options.source || (usesCurrentInput ? sourceType : 'manual'),
      capture: hasCaptureOption
        ? options.capture
        : usesCurrentInput ? captureMeta : null,
      truncated: hasTruncatedOption ? Boolean(options.truncated) : (usesCurrentInput && sourceMeta.truncated),
      originalLength: hasOriginalLengthOption
        ? options.originalLength
        : (usesCurrentInput ? sourceMeta.originalLength : textToProcess.length) ?? textToProcess.length,
      processingLocation: taskProcessingLocation,
      processingProvider: settings.activeBackend,
      processingConfigSignature,
      processingConfigRevision: currentProcessingConfigRevision,
    };
    const limitState = getSourceLimitState({
      textLength: textToProcess.length,
      originalLength: normalizedOptions.originalLength,
      truncated: normalizedOptions.truncated,
      sourceType: normalizedOptions.source,
      limit: DEFAULTS.MAX_TEXT_LENGTH,
    });
    if (limitState.blocked) {
      setSourceMeta({
        truncated: normalizedOptions.truncated,
        originalLength: limitState.originalLength,
      });
      setSourceLimitActionNotice('');
      setWarning('');
      setError(null);
      setProcessingErrorCode(null);
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
      return;
    }

    const localOcrAssessment = assessOcrReview(
      normalizedOptions.source,
      normalizedOptions.capture,
    );
    const authoritativeOcrAssessment = options.ocrReviewAssessment
      && typeof options.ocrReviewAssessment === 'object'
      ? options.ocrReviewAssessment
      : null;
    const ocrReviewRequired = localOcrAssessment.required
      || authoritativeOcrAssessment?.required === true;
    const ocrReviewConfirmed = isValidOcrReviewConfirmation(normalizedOptions.ocrReview)
      && options.processingConfigSignature === processingConfigSignature
      && options.processingConfigRevision === currentProcessingConfigRevision;
    if (ocrReviewRequired && !ocrReviewConfirmed) {
      const reasons = [...new Set([
        ...(Array.isArray(authoritativeOcrAssessment?.reasons)
          ? authoritativeOcrAssessment.reasons
          : []),
        ...(Array.isArray(localOcrAssessment.reasons)
          ? localOcrAssessment.reasons
          : []),
      ])];
      setOcrReview({
        sourceText: textToProcess,
        capture: normalizedOptions.capture,
        sourceSha256: /^[a-f0-9]{64}$/.test(authoritativeOcrAssessment?.sourceSha256 || '')
          ? authoritativeOcrAssessment.sourceSha256
          : null,
        assessment: {
          ...localOcrAssessment,
          required: true,
          reasons,
        },
      });
      setSourceMeta({
        truncated: normalizedOptions.truncated,
        originalLength: normalizedOptions.originalLength,
      });
      invalidateVerification();
      setWarning('');
      setCaptureErrorCode(null);
      setProcessingErrorCode(null);
      setError(null);
      statusRef.current = STATUS.IDLE;
      setStatus(STATUS.IDLE);
      setWindowMode('capture');
      return;
    }

    const retainedAttempt = failedProcessingAttemptRef.current;
    if (!failedProcessingAttemptMatches(retainedAttempt, textToProcess, normalizedOptions)) {
      const nextAttempt = createFailedProcessingAttempt({
        text: textToProcess,
        options: normalizedOptions,
      }, lastGoodRef.current);
      setFailedProcessingAttempt(nextAttempt);
      if (
        nextAttempt
        && lastGoodRef.current
        && !RESULT_DEMO
        && sessionRecoveryReadyRef.current
      ) {
        if (sessionRecoveryWriteTimerRef.current) {
          window.clearTimeout(sessionRecoveryWriteTimerRef.current);
          sessionRecoveryWriteTimerRef.current = null;
        }
        latestSessionRecoveryRef.current = null;
        const storage = getSessionRecoveryStorage();
        // Clipboard and manual input may have scheduled B as an ordinary draft
        // before it became the memory-only replacement attempt. Remove that
        // record immediately instead of waiting for the next recovery effect.
        clearSessionRecovery(storage);
        replaceSessionRecoveryWithLastGood(lastGoodRef.current, storage);
      }
    }

    const warnings = [];

    setSourceMeta({
      truncated: normalizedOptions.truncated,
      originalLength: normalizedOptions.originalLength,
    });
    invalidateVerification();
    const inheritsPendingScreenshotCancellation = screenshotRunRef.current.inFlight
      && processingCancelRunRef.current.pending;
    const inheritsFailedScreenshotCancellation = screenshotRunRef.current.inFlight
      && processingCancelRunRef.current.failedScreenshotToken === screenshotRunRef.current.token;
    if (!inheritsPendingScreenshotCancellation && !inheritsFailedScreenshotCancellation) {
      processingCancelRunRef.current = {
        token: processingCancelRunRef.current.token + 1,
        pending: false,
        failedTaskId: null,
        failedScreenshotToken: null,
      };
      setIsCancellingProcessing(false);
      setProcessingCancelError('');
    }
    setWarning(warnings.join(' '));
    setProcessingPhase(PROCESSING_PHASE.ANALYSIS);
    statusRef.current = STATUS.PROCESSING;
    setStatus(STATUS.PROCESSING);
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);
    setProcessingTimeMs(null);
    setVerificationTimeMs(null);
    const intendedConfigGeneration = currentProcessingConfigRevision;
    const task = requestCoordinatorRef.current.schedule({
      text: textToProcess,
      options: normalizedOptions,
      warning: warnings.join(' '),
      configGeneration: intendedConfigGeneration,
      configSignature: processingConfigSignature,
    });
    if (task && inheritsFailedScreenshotCancellation) {
      processingCancelRunRef.current = {
        ...processingCancelRunRef.current,
        failedTaskId: task.id,
        failedScreenshotToken: null,
      };
    }
    if (task) runProcessing(task);
  }, [captureMeta, inputText, invalidateVerification, onOpenSettings, processingConfigGenerationRef, processingConfigRevision, processingConfigSignature, replaceSessionRecoveryWithLastGood, revokeDelayedCaptureDispatch, runProcessing, setFailedProcessingAttempt, setWindowMode, settings, sourceMeta.originalLength, sourceMeta.truncated, sourceType, status]);

  useEffect(() => {
    triggerProcessingRef.current = triggerProcessing;
  }, [triggerProcessing]);

  const handleConfirmOcrReview = useCallback(async () => {
    if (!ocrReview || isConfirmingOcrReview) return false;
    const reviewedText = textareaRef.current?.value ?? inputText;
    if (!reviewedText.trim()) return false;
    if (reviewedText !== ocrReview.sourceText) {
      setOcrReview(null);
      setSourceType('manual');
      setCaptureMeta({ confidence: null, blocks: [] });
      setSourceMeta({ truncated: false, originalLength: reviewedText.length });
      setWarning(EDITED_SOURCE_MANUAL_SUBMIT_WARNING);
      return false;
    }

    setIsConfirmingOcrReview(true);
    try {
      const confirmationProcessingConfigRevision = processingConfigGenerationRef?.current
        ?? processingConfigRevision;
      const confirmationProcessingLocation = processingLocationForSettings(settings);
      if (confirmationProcessingLocation === PROCESSING_LOCATIONS.UNKNOWN) {
        triggerProcessing(reviewedText, {
          source: 'ocr',
          capture: ocrReview.capture,
          truncated: sourceMeta.truncated,
          originalLength: sourceMeta.originalLength ?? reviewedText.length,
        });
        return false;
      }
      const confirmation = await createOcrReviewConfirmation(reviewedText, {
        settings,
        processingLocation: confirmationProcessingLocation,
      });
      const currentText = textareaRef.current?.value ?? inputText;
      if (currentText !== reviewedText) {
        setOcrReview(null);
        setSourceType('manual');
        setCaptureMeta({ confidence: null, blocks: [] });
        setSourceMeta({ truncated: false, originalLength: currentText.length });
        setWarning(EDITED_SOURCE_MANUAL_SUBMIT_WARNING);
        return false;
      }
      if (
        ocrReview.sourceSha256
        && confirmation.sourceSha256 !== ocrReview.sourceSha256
      ) {
        setWarning('无法确认当前原文仍与这次截图一致；尚未发送。请重新截图后再试。');
        return false;
      }
      triggerProcessing(reviewedText, {
        source: 'ocr',
        capture: ocrReview.capture,
        truncated: sourceMeta.truncated,
        originalLength: sourceMeta.originalLength ?? reviewedText.length,
        ocrReview: confirmation,
        processingConfigSignature,
        processingConfigRevision: confirmationProcessingConfigRevision,
      });
      return true;
    } catch {
      setWarning('暂时无法在本机确认这次核对；原文尚未发送。请重新截图后再试。');
      return false;
    } finally {
      setIsConfirmingOcrReview(false);
    }
  }, [inputText, isConfirmingOcrReview, ocrReview, processingConfigGenerationRef, processingConfigRevision, processingConfigSignature, settings, sourceMeta.originalLength, sourceMeta.truncated, triggerProcessing]);

  const performScreenshotCapture = useCallback(async () => {
    if (screenshotRunRef.current.inFlight) return;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    setPendingScreenshotRequest(null);
    discardClearedSession();
    const token = screenshotRunRef.current.token + 1;
    screenshotRunRef.current = { token, inFlight: true };
    requestCoordinatorRef.current.invalidate();
    try {
      setCaptureErrorCode(null);
      setProcessingErrorCode(null);
      setError(null);
      setProcessingPhase(PROCESSING_PHASE.CAPTURE);
      statusRef.current = STATUS.PROCESSING;
      setStatus(STATUS.PROCESSING);
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      });
      if (screenshotRunRef.current.token !== token) return;
      const screenshot = await invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE);
      if (screenshotRunRef.current.token !== token) return;
      if (screenshot?.cancelled) {
        settleFailedScreenshotCancellation(token);
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
        setOcrReview(null);
        setIsConfirmingOcrReview(false);
        setInputText(screenshot.text);
        setSourceLimitActionNotice('');
        setSourceType('ocr');
        setCaptureMeta(capture);
        setSourceMeta(nextSourceMeta);
        if (nextSourceMeta.truncated) {
          const message = sourceLimitWarning(getSourceLimitState({
            textLength: screenshot.text.length,
            ...nextSourceMeta,
            sourceType: 'ocr',
            limit: DEFAULTS.MAX_TEXT_LENGTH,
          }));
          if (!restoreLastGood(message)) {
            setWarning('');
            setStatus(STATUS.IDLE);
            setWindowMode('capture');
          }
          settleFailedScreenshotCancellation(token);
          return;
        }
        triggerProcessing(screenshot.text, {
          source: 'ocr',
          capture,
          ocrReviewAssessment: screenshot.ocrReview || null,
          ...nextSourceMeta,
        });
        settleFailedScreenshotCancellation(token);
      } else {
        settleFailedScreenshotCancellation(token);
        const message = userErrorMessage(screenshot, SCREENSHOT_FAILURE_MESSAGE);
        if (!restoreLastGood(message, screenshot?.errorCode || null)) {
          setCaptureErrorCode(screenshot?.errorCode || null);
          setProcessingErrorCode(null);
          setError(message);
          setStatus(STATUS.ERROR);
          setWindowMode('capture');
        }
      }
    } catch {
      if (screenshotRunRef.current.token !== token) return;
      settleFailedScreenshotCancellation(token);
      if (!restoreLastGood(SCREENSHOT_FAILURE_MESSAGE)) {
        setCaptureErrorCode(null);
        setProcessingErrorCode(null);
        setError(SCREENSHOT_FAILURE_MESSAGE);
        setStatus(STATUS.ERROR);
        setWindowMode('capture');
      }
    } finally {
      if (screenshotRunRef.current.token === token) {
        screenshotRunRef.current = { token, inFlight: false };
      }
    }
  }, [discardClearedSession, invoke, restoreLastGood, revokeDelayedCaptureDispatch, setWindowMode, settleFailedScreenshotCancellation, triggerProcessing]);

  const handleScreenshot = useCallback(() => {
    revokeDelayedCaptureDispatch();
    if (screenshotRunRef.current.inFlight) {
      setClipboardQueueAnnouncement('截图框选已经在进行；没有启动第二次截图。');
      return false;
    }
    if (!visible) {
      setPendingScreenshotRequest((current) => ({
        status: current?.status === 'stopping' ? 'stopping' : 'waiting',
        reason: setupIncomplete ? 'setup' : 'settings',
        receivedCount: Math.min(99, Number(current?.receivedCount || 0) + 1),
        replyDraftProtected: replyDialogOpenRef.current
          || current?.replyDraftProtected === true,
      }));
      setClipboardQueueAnnouncement(setupIncomplete
        ? '截图请求已保留；先选择处理方式，进入主面板后仍需由你明确开始。'
        : '设置仍然保留；截图请求会在你返回主面板后开始。');
      announceHiddenCaptureRequest('screenshot');
      return false;
    }
    const guard = clipboardEventGuardRef.current || {};
    const captureIsBusy = guard.status === STATUS.PROCESSING || guard.isVerifying;
    const liveForegroundContext = {
      ...(foregroundCaptureContextRef.current || {}),
      savedTermsOpen: savedTermsDrawerOpenRef.current,
      hasReplyDraft: replyDialogOpenRef.current,
    };
    const liveForegroundReason = getForegroundCaptureBlockReason(liveForegroundContext);
    const liveDecisionBlocking = isForegroundCaptureDecisionBlocking(
      liveForegroundReason,
      liveForegroundContext,
    );
    const queueReason = liveDecisionBlocking
      ? liveForegroundReason
      : captureIsBusy ? 'active-work' : liveForegroundReason;
    if (queueReason) {
      setPendingScreenshotRequest((current) => ({
        status: current?.status === 'stopping' ? 'stopping' : 'waiting',
        reason: queueReason,
        receivedCount: Math.min(99, Number(current?.receivedCount || 0) + 1),
        replyDraftProtected: replyDialogOpenRef.current
          || current?.replyDraftProtected === true,
      }));
      setClipboardQueueAnnouncement(
        replyDialogOpenRef.current
          ? '截图请求已安全保留；回复草稿、选择状态和光标位置都没有改变。关闭草稿后，再决定是否放弃草稿并截图。'
          : liveDecisionBlocking
            ? '截图请求正在等待；先完成当前确认，Slipstream 不会从确认层背后打开框选。'
          : '截图请求正在等待；当前任务、原文和结果都没有改变；撤销机会也仍然保留。',
      );
      if (!liveDecisionBlocking) {
        window.requestAnimationFrame(() => {
          if (foregroundCaptureDecisionBlockingRef.current || replyDialogOpenRef.current) return;
          focusAvailableElement(pendingScreenshotStatusRef.current);
        });
      }
      return false;
    }
    performScreenshotCapture();
    return true;
  }, [
    announceHiddenCaptureRequest,
    performScreenshotCapture,
    revokeDelayedCaptureDispatch,
    setupIncomplete,
    visible,
  ]);
  screenshotRequestHandlerRef.current = handleScreenshot;

  const handleOpenScreenRecordingSettings = useCallback(async () => {
    revokeDelayedCaptureDispatch();
    try {
      await invoke(IPC_CHANNELS.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS);
    } catch {
      const message = '无法自动打开系统设置。请手动前往“系统设置 → 隐私与安全性 → 屏幕录制”，允许 Slipstream 后返回重试。';
      setCaptureErrorCode('screenshot-permission-denied');
      setProcessingErrorCode(null);
      if (status === STATUS.DONE) setWarning(message);
      else setError(message);
    }
  }, [invoke, revokeDelayedCaptureDispatch, status]);

  useEffect(() => {
    return on(IPC_CHANNELS.SCREENSHOT_REQUESTED, () => {
      screenshotRequestHandlerRef.current?.();
    });
  }, [on]);

  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
      return undefined;
    }
    let cancelled = false;
    let retryTimer = null;
    // Defer the handshake until both capture subscriptions above have been
    // installed. Cancellation also avoids announcing the discarded first
    // effect pass used by React StrictMode in development.
    const announceReady = async () => {
      if (cancelled) return false;
      try {
        const response = await invoke(IPC_CHANNELS.CAPTURE_INGRESS_LISTENER_READY);
        if (cancelled || response?.ready === true) return true;
      } catch {
        if (cancelled) return false;
      }
      retryTimer = window.setTimeout(announceReady, 250);
      return false;
    };
    void Promise.resolve().then(announceReady);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [invoke]);

  const commitManualClipboardRead = useCallback((payload, { confirmedReplacement = false } = {}) => {
    if (!payload?.text?.trim()) return false;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    discardClearedSession();
    setOcrReview(null);
    setIsConfirmingOcrReview(false);
    setInputText(payload.text);
    if (isEditingSource) {
      setSourceEditDraft((current) => updateSourceEditDraft(
        current,
        payload.text,
        processedSourceText || inputText,
      ));
    }
    setSourceLimitActionNotice('');
    setSourceType('clipboard');
    setCaptureMeta({ confidence: null, blocks: [] });
    setSourceMeta({
      truncated: Boolean(payload.truncated),
      originalLength: payload.originalLength ?? payload.text.length,
    });
    setWarning(isEditingSource
      ? '已用剪贴板文字替换当前修正；上一份结果仍保留，尚未重新处理。'
      : confirmedReplacement
        ? '已用剪贴板文字替换当前原文；尚未开始处理，请先检查内容。'
        : '剪贴板文字已载入；尚未开始处理，请先检查内容。');
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);
    statusRef.current = STATUS.IDLE;
    setStatus(STATUS.IDLE);
    setWindowMode('capture');
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
    });
    return true;
  }, [
    discardClearedSession,
    inputText,
    isEditingSource,
    processedSourceText,
    revokeDelayedCaptureDispatch,
    setWindowMode,
  ]);

  const handlePaste = useCallback(async () => {
    if (clipboardReadRequestRef.current !== null) return false;
    clipboardReadReturnFocusRef.current = document.activeElement;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    const attemptToken = clipboardReadRunRef.current;
    const clearUndoPauseOwner = pauseClearedSessionUndo(attemptToken);
    let keepClearUndoPaused = false;
    clipboardReadRequestRef.current = attemptToken;
    setIsReadingClipboard(true);
    try {
      const response = await invoke(IPC_CHANNELS.CLIPBOARD_READ);
      const outcome = classifyClipboardReadAttempt(
        response,
        attemptToken,
        clipboardReadRunRef.current,
      );
      if (outcome.status === 'stale') return;
      if (outcome.status === 'ready') {
        const { payload } = outcome;
        const foregroundReason = getForegroundCaptureBlockReason(
          foregroundCaptureContextRef.current || {},
        );
        if (foregroundReason) {
          const next = createPendingClipboardItem({
            ...payload,
            source: 'manual-read',
            foregroundReason,
          }, pendingClipboardRef.current);
          pendingClipboardRef.current = next;
          pendingManualClipboardFocusTokenRef.current = attemptToken;
          setPendingClipboardItem(next);
          keepClearUndoPaused = Boolean(clearUndoPauseOwner);
          setClipboardQueueAnnouncement(
            '剪贴板文字已读取；当前内容未变。请选择替换或保留。',
          );
        } else {
          commitManualClipboardRead(payload);
        }
      } else {
        setCaptureErrorCode(null);
        setProcessingErrorCode(null);
        setError('剪贴板里没有可解释的文本');
        setStatus(STATUS.ERROR);
      }
    } catch {
      if (!isCurrentClipboardReadAttempt(attemptToken, clipboardReadRunRef.current)) return;
      setCaptureErrorCode(null);
      setProcessingErrorCode(null);
      setError('无法读取剪贴板，请手动粘贴或使用截图功能');
      setStatus(STATUS.ERROR);
    } finally {
      if (clearUndoPauseOwner && !keepClearUndoPaused) {
        resumeClearedSessionUndo(clearUndoPauseOwner);
      }
      if (clipboardReadRequestRef.current === attemptToken) {
        clipboardReadRequestRef.current = null;
        setIsReadingClipboard(false);
      }
    }
    return true;
  }, [
    commitManualClipboardRead,
    invoke,
    pauseClearedSessionUndo,
    resumeClearedSessionUndo,
    revokeDelayedCaptureDispatch,
  ]);

  const handleSourceLimitRecovery = useCallback(() => {
    const limitState = getSourceLimitState({
      textLength: inputText.length,
      originalLength: sourceMeta.originalLength,
      truncated: sourceMeta.truncated,
      sourceType,
      limit: DEFAULTS.MAX_TEXT_LENGTH,
    });
    if (!limitState.blocked) return;
    if (limitState.recovery === 'recapture') {
      handleScreenshot();
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    if (limitState.recovery === 'manual-paste') {
      textarea.setSelectionRange(0, inputText.length);
      setSourceLimitActionNotice('当前前缀已选中；剪贴板内容没有改变。按 Command+V 即可用完整原文替换。');
      return;
    }

    textarea.setSelectionRange(DEFAULTS.MAX_TEXT_LENGTH, inputText.length);
    setSourceLimitActionNotice(
      `已选中从第 ${DEFAULTS.MAX_TEXT_LENGTH + 1} 个字符开始的 ${limitState.overflowLength} 个超出字符；删除或改写后即可继续。`,
    );
  }, [handleScreenshot, inputText, sourceMeta.originalLength, sourceMeta.truncated, sourceType]);

  const handleLoadExample = useCallback(() => {
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    discardClearedSession();
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setOcrReview(null);
    setIsConfirmingOcrReview(false);
    setInputText(PREVIEW_SOURCE_TEXT);
    setSourceLimitActionNotice('');
    setSourceType('sample');
    setCaptureMeta({ confidence: null, blocks: [] });
    setSourceMeta({ truncated: false, originalLength: PREVIEW_SOURCE_TEXT.length });
    setWarning('');
    setError(null);
    setStatus(STATUS.IDLE);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
    });
  }, [discardClearedSession, revokeDelayedCaptureDispatch]);

  const handleCancelProcessing = useCallback(async ({ openSettingsAfter = false } = {}) => {
    if (processingCancelRunRef.current.pending) return;
    const taskId = activeProcessingRef.current?.taskId ?? null;
    const screenshotToken = screenshotRunRef.current.inFlight
      ? screenshotRunRef.current.token
      : null;
    if (taskId === null && screenshotToken === null) {
      if (openSettingsAfter) {
        settingsOpenIntentRef.current = null;
        setSettingsOpenIntent(null);
        verificationSettingsSettlementRef.current = null;
        if (!settingsReturnFocusRef.current) {
          settingsReturnFocusRef.current = lastGoodRef.current ? 'result' : 'source';
        }
        onOpenSettings(lastGoodRef.current
          ? '任务已经完成；当前结果仍保留，返回主面板后可以继续查看。'
          : '当前任务已经结束；原文仍保留，返回主面板后可以继续处理。');
      }
      return;
    }

    if (openSettingsAfter) {
      settingsOpenIntentRef.current = 'analysis';
      setSettingsOpenIntent('analysis');
    }
    const token = processingCancelRunRef.current.token + 1;
    const previousLastGood = lastGoodRef.current;
    processingCancelRunRef.current = {
      token,
      pending: true,
      failedTaskId: null,
      failedScreenshotToken: null,
    };
    setIsCancellingProcessing(true);
    setProcessingCancelError('');

    let acknowledged = false;
    try {
      acknowledged = await invoke(IPC_CHANNELS.LLM_CANCEL) === true;
    } catch {
      acknowledged = false;
    }

    if (processingCancelRunRef.current.token !== token) return;
    processingCancelRunRef.current = {
      ...processingCancelRunRef.current,
      pending: false,
    };
    setIsCancellingProcessing(false);
    const shouldOpenSettings = settingsOpenIntentRef.current === 'analysis';

    const activeTaskId = activeProcessingRef.current?.taskId ?? null;
    const analysisStillActive = taskId !== null && activeTaskId === taskId;
    const screenshotStillActive = screenshotToken !== null && (
      (screenshotRunRef.current.inFlight && screenshotRunRef.current.token === screenshotToken)
      || activeTaskId !== null
    );
    const targetStillActive = analysisStillActive || screenshotStillActive;
    const completedWithNewResult = Boolean(
      lastGoodRef.current && lastGoodRef.current !== previousLastGood,
    );

    if (!acknowledged) {
      if (targetStillActive) {
        const analysisStartedFromScreenshot = taskId === null
          && screenshotToken !== null
          && activeTaskId !== null;
        processingCancelRunRef.current = {
          ...processingCancelRunRef.current,
          failedTaskId: analysisStillActive || analysisStartedFromScreenshot
            ? activeTaskId
            : null,
          failedScreenshotToken: screenshotStillActive && activeTaskId === null
            ? screenshotToken
            : null,
        };
        const cancellationLocation = screenshotStillActive && activeTaskId === null
          ? PROCESSING_LOCATIONS.LOCAL
          : activeProcessingRef.current?.processingLocation
            ?? processingLocationForSettings(settings);
        setProcessingCancelError(processingCancelFailureMessage(cancellationLocation));
      } else if (completedWithNewResult) {
        setWarning((current) => appendUniqueWarning(
          current,
          shouldOpenSettings
            ? PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE
            : PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE,
        ));
        if (shouldOpenSettings) {
          revokePendingSettingsNavigation();
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              focusAvailableElement(settledTaskFocusTarget());
            });
          });
        }
      } else if (shouldOpenSettings) {
        revokePendingSettingsNavigation();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            focusAvailableElement(settledTaskFocusTarget());
          });
        });
      }
      return;
    }

    setProcessingCancelError('');
    if (completedWithNewResult && !targetStillActive) {
      setWarning((current) => appendUniqueWarning(
        current,
        shouldOpenSettings
          ? PROCESSING_COMPLETED_BEFORE_SETTINGS_NOTICE
          : PROCESSING_COMPLETED_DURING_CANCEL_NOTICE,
      ));
      if (shouldOpenSettings) {
        revokePendingSettingsNavigation();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            focusAvailableElement(settledTaskFocusTarget());
          });
        });
      }
      return;
    }

    requestCoordinatorRef.current.invalidate();
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    setActiveProcessingSnapshot(null);
    processingCancelRunRef.current = {
      ...processingCancelRunRef.current,
      failedTaskId: null,
      failedScreenshotToken: null,
    };
    invalidateVerification();
    if (!restoreLastGood(PROCESSING_CANCELLED_RESULT_NOTICE)) {
      setError(null);
      setWarning(PROCESSING_CANCELLED_SOURCE_NOTICE);
      setStatus(STATUS.IDLE);
      setIsEditingSource(false);
      setWindowMode('capture');
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
      });
    }
    if (shouldOpenSettings) {
      settingsOpenIntentRef.current = null;
      setSettingsOpenIntent(null);
      if (!settingsReturnFocusRef.current) {
        settingsReturnFocusRef.current = previousLastGood ? 'result' : 'source';
      }
      onOpenSettings(previousLastGood
        ? '任务已停止；上一份结果仍保留，返回主面板后可以继续查看。'
        : '任务已停止；原文仍保留，返回主面板后可以继续处理。');
    }
  }, [invalidateVerification, invoke, onOpenSettings, restoreLastGood, revokePendingSettingsNavigation, setWindowMode, settings]);

  const handleEditSource = useCallback(() => {
    const currentSource = processedSourceText || inputText;
    if (!currentSource.trim()) return;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    const nextEditDraft = openSourceEditDraft(currentSource, sourceEditDraft);
    const reusableDraft = nextEditDraft.text;
    const draftWasModified = reusableDraft !== currentSource;
    if (isVerifying) invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => false);
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    setIsVerifying(false);
    setIsCancellingVerification(false);
    setSourceEditDraft(nextEditDraft);
    setInputText(reusableDraft);
    setSourceLimitActionNotice('');
    if (draftWasModified) {
      setSourceType('manual');
      setCaptureMeta({ confidence: null, blocks: [] });
      setSourceMeta({
        truncated: false,
        originalLength: reusableDraft.length,
      });
    }
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);
    setWarning('');
    setStatus(STATUS.IDLE);
    setIsEditingSource(true);
    setWindowMode('capture');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    });
  }, [inputText, invoke, isVerifying, processedSourceText, revokeDelayedCaptureDispatch, setWindowMode, sourceEditDraft]);

  const handleReviewFailedProcessingAttempt = useCallback(() => {
    const attempt = failedProcessingAttemptRef.current;
    if (!attempt?.text?.trim()) return;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    const nextEditDraft = openSourceEditDraft(attempt.text, sourceEditDraft);
    const reusableDraft = nextEditDraft.text;
    const draftWasModified = reusableDraft !== attempt.text;
    if (isVerifying) invoke(IPC_CHANNELS.LLM_CANCEL).catch(() => false);
    invalidateVerification();
    setSourceEditDraft(nextEditDraft);
    setInputText(reusableDraft);
    setSourceLimitActionNotice('');
    setSourceType(draftWasModified ? 'manual' : attempt.source);
    setCaptureMeta(draftWasModified
      ? { confidence: null, blocks: [] }
      : attempt.capture || { confidence: null, blocks: [] });
    setSourceMeta(draftWasModified
      ? { truncated: false, originalLength: reusableDraft.length }
      : {
          truncated: Boolean(attempt.truncated),
          originalLength: attempt.originalLength,
        });
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);
    setWarning('已将刚才的原文打开为当前窗口的修正草稿，未写入历史。修改不会自动发送；上一份有效结果仍可随时返回。');
    setStatus(STATUS.IDLE);
    setIsEditingSource(true);
    setWindowMode('capture');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    });
  }, [invalidateVerification, invoke, isVerifying, revokeDelayedCaptureDispatch, setWindowMode, sourceEditDraft]);

  const handleReturnToResult = useCallback(() => {
    restoreLastGood();
  }, [restoreLastGood]);

  const handleClear = useCallback(() => {
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    setFailedProcessingAttempt(null);
    latestSessionRecoveryRef.current = null;
    clearSessionRecovery(getSessionRecoveryStorage());
    const snapshot = createClearedSessionSnapshot({
      inputText,
      processedSourceText,
      brief,
      result,
      captureMeta,
      sourceMeta,
      status,
      warning: removeFailedProcessingAttemptNotice(warning),
      error,
      captureErrorCode,
      processingErrorCode,
      processingTimeMs,
      verificationTimeMs,
      sourceType,
      lastGood: lastGoodRef.current,
      verificationApprovalId,
      isEditingSource,
      sourceEditDraft,
      completedActionIds,
      replyDraftState: replyDraftStateRef.current,
    });
    if (inputText.trim() || processedSourceText.trim() || brief || result) {
      armClearedSessionUndo(snapshot);
    } else {
      discardClearedSession();
    }
    setClipboardNotice((current) => markClipboardNoticeAfterTaskExit(current));
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
    setActiveProcessingSnapshot(null);
    lastGoodRef.current = null;
    replyDraftStateRef.current = null;
    replyDialogOpenRef.current = false;
    setInputText('');
    setOcrReview(null);
    setIsConfirmingOcrReview(false);
    setSourceLimitActionNotice('');
    setProcessedSourceText('');
    setBrief(null);
    setCompletedActionIds([]);
    setReplyDraftState(null);
    setReplyDialogOpen(false);
    setResult('');
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setError(null);
    setWarning('');
    setStatus(STATUS.IDLE);
    setProcessingTimeMs(null);
    setVerificationTimeMs(null);
    setIsEditingSource(false);
    setSourceEditDraft(null);
    setSourceType('manual');
    setCaptureMeta({ confidence: null, blocks: [] });
    setSourceMeta({ truncated: false, originalLength: null });
    invalidateVerification();
    clearClipboard();
    setWindowMode('capture');
  }, [
    armClearedSessionUndo,
    brief,
    completedActionIds,
    captureErrorCode,
    captureMeta,
    clearClipboard,
    discardClearedSession,
    error,
    inputText,
    isEditingSource,
    invalidateVerification,
    invoke,
    processedSourceText,
    processingErrorCode,
    processingTimeMs,
    revokeDelayedCaptureDispatch,
    result,
    setClipboardNotice,
    setFailedProcessingAttempt,
    setWindowMode,
    sourceMeta,
    sourceEditDraft,
    sourceType,
    status,
    verificationApprovalId,
    verificationTimeMs,
    warning,
  ]);

  const handleAcknowledgeClipboardConsequence = useCallback(async () => {
    const { consequenceId } = clipboardNoticeRef.current;
    if (!consequenceId) return { status: 'invalid' };
    if (onAcknowledgeClipboardConsequence) {
      try {
        return await onAcknowledgeClipboardConsequence(consequenceId);
      } catch {
        return { status: 'error' };
      }
    }
    return { status: 'unavailable' };
  }, [onAcknowledgeClipboardConsequence]);

  const handleWriteClipboard = useCallback((text, { kind } = {}) => {
    if (clipboardOperationPending || replyCopyRequestRef.current) {
      const error = new Error('clipboard-write-pending');
      error.code = 'clipboard-write-pending';
      return Promise.reject(error);
    }
    if (onClipboardCopy) return onClipboardCopy({ kind, text });
    const error = new Error('clipboard-write-unavailable');
    error.code = 'clipboard-write-unavailable';
    return Promise.reject(error);
  }, [clipboardOperationPending, onClipboardCopy]);

  const handleCopyReply = useCallback(async ({ draft, modelIdentity } = {}) => {
    if (clipboardOperationPending || replyCopyRequestRef.current) {
      const error = new Error('clipboard-write-pending');
      error.code = 'clipboard-write-pending';
      throw error;
    }
    const taskGeneration = replyTaskGenerationRef.current;
    if (onClipboardCopy) {
      let activeRequestId = null;
      try {
        return await onClipboardCopy({
          kind: 'reply',
          text: draft,
          onBegin: ({ requestId, previousNotice }) => {
            const pendingNotice = beginReplyClipboardCopy({
              requestId,
              taskGeneration,
              modelIdentity,
              draft,
              previousNotice,
            });
            if (!pendingNotice) return null;
            activeRequestId = requestId;
            replyCopyRequestRef.current = { requestId, taskGeneration };
            setReplyCopyPending(true);
            return pendingNotice;
          },
          onSuccess: ({ requestId, response, notice }) => settleReplyClipboardCopySuccess(
            notice,
            response,
            {
              requestId,
              replyDraftState: replyDraftStateRef.current,
              completionClaimCurrent: replyCompletionClaimCurrentRef.current,
              taskActive: clipboardEventGuardRef.current?.status === STATUS.DONE
                && replyTaskGenerationRef.current === taskGeneration,
            },
          ),
          onFailure: ({ requestId, notice }) => settleReplyClipboardCopyFailure(notice, {
            requestId,
            replyDraftState: replyDraftStateRef.current,
            completionClaimCurrent: replyCompletionClaimCurrentRef.current,
            taskActive: clipboardEventGuardRef.current?.status === STATUS.DONE
              && replyTaskGenerationRef.current === taskGeneration,
          }),
        });
      } catch (error) {
        if (error?.code === 'clipboard-write-pending') throw error;
        throw new Error('reply-copy-failed');
      } finally {
        if (activeRequestId && replyCopyRequestRef.current?.requestId === activeRequestId) {
          replyCopyRequestRef.current = null;
          setReplyCopyPending(false);
        }
      }
    }

    throw new Error('reply-copy-unavailable');
  }, [clipboardOperationPending, onClipboardCopy]);

  const purgeForFullDataReset = useCallback(() => {
    if (clipboardOperationPending || replyCopyRequestRef.current) {
      return { status: 'clipboard-write-pending' };
    }
    if (savedTermsMutationRef.current) {
      return { status: 'terms-operation-pending' };
    }
    const recoveryStorage = getSessionRecoveryStorage();
    if (!recoveryStorage || !clearSessionRecovery(recoveryStorage)) {
      return { status: 'storage-error' };
    }

    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    if (clearUndoTimerRef.current) {
      window.clearTimeout(clearUndoTimerRef.current);
      clearUndoTimerRef.current = null;
    }
    if (sessionRecoveryWriteTimerRef.current) {
      window.clearTimeout(sessionRecoveryWriteTimerRef.current);
      sessionRecoveryWriteTimerRef.current = null;
    }

    latestSessionRecoveryRef.current = null;
    sessionRecoveryReadyRef.current = true;
    setFailedProcessingAttempt(null);
    clearUndoPauseOwnerRef.current = null;
    clearedSessionRef.current = null;
    pendingClipboardRef.current = null;
    clipboardReadRequestRef.current = null;
    clipboardReadReturnFocusRef.current = null;
    lastGoodRef.current = null;
    replyDraftStateRef.current = null;
    replyDialogOpenRef.current = false;
    requestCoordinatorRef.current.invalidate();
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    setActiveProcessingSnapshot(null);
    processingCancelRunRef.current = {
      token: processingCancelRunRef.current.token + 1,
      pending: false,
      failedTaskId: null,
      failedScreenshotToken: null,
    };
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    settingsOpenIntentRef.current = null;
    approvedCaptureHandledRef.current = null;
    replyTaskGenerationRef.current += 1;
    replyCopyRequestRef.current = null;
    savedTermsImportPreviewRef.current = null;
    invalidateSavedTermsLoadRequest();
    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.IDLE, {
      epoch: savedTermsLoadRef.current.epoch,
    });

    invoke(IPC_CHANNELS.LLM_CANCEL, { discardResult: true }).catch(() => false);
    clearClipboard();
    setInputText('');
    setProcessedSourceText('');
    setResult('');
    setBrief(null);
    setCompletedActionIds([]);
    setReplyDraftState(null);
    setReplyCopyPending(false);
    setReplyDialogOpen(false);
    setError(null);
    setCaptureErrorCode(null);
    setProcessingErrorCode(null);
    setStatus(STATUS.IDLE);
    setProcessingTimeMs(null);
    setVerificationTimeMs(null);
    savedTermsDrawerOpenRef.current = false;
    setSavedTermsDrawerOpen(false);
    setSavedTermsSessionGeneration((current) => current + 1);
    setWarning('');
    setSourceType('manual');
    setCaptureMeta({ confidence: null, blocks: [] });
    setSourceMeta({ truncated: false, originalLength: null });
    setIsVerifying(false);
    setIsCancellingVerification(false);
    setVerificationApprovalId(null);
    setClearedSession(null);
    setClearedSessionSecondsRemaining(0);
    setResultOrderSaveError(null);
    setIsSavingResultOrder(false);
    setIsEditingSource(false);
    setSourceEditDraft(null);
    setIsCancellingProcessing(false);
    setProcessingCancelError('');
    setProcessingSettingsGuardOpen(false);
    setSettingsOpenIntent(null);
    setSourceLimitActionNotice('');
    setClipboardMonitoringStopStatus('idle');
    setClipboardMonitoringStopError('');
    setClipboardMonitoringOffNotice('');
    setPendingClipboardItem(null);
    setIsReadingClipboard(false);
    setPendingScreenshotRequest(null);
    setClipboardQueueAnnouncement('');
    setPendingSessionRecovery(null);
    return { status: 'cleared' };
  }, [
    clearClipboard,
    clipboardOperationPending,
    invalidateSavedTermsLoadRequest,
    invoke,
    revokeDelayedCaptureDispatch,
    setFailedProcessingAttempt,
    setSavedTermsLoadState,
  ]);

  const confirmSavedTermsPersistentReset = useCallback(() => {
    savedTermsImportPreviewRef.current = null;
    invalidateSavedTermsLoadRequest();
    updateSavedTerms([]);
    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.READY, {
      epoch: savedTermsLoadRef.current.epoch,
    });
    return { status: 'ready-empty' };
  }, [invalidateSavedTermsLoadRequest, setSavedTermsLoadState, updateSavedTerms]);

  const recoverSavedTermsAfterResetFailure = useCallback(async () => {
    savedTermsReconciliationErrorCodeRef.current = 'saved-terms-mutation-unconfirmed';
    try {
      return await retrySavedTermsLoad();
    } catch {
      const error = createSavedTermsLoadError('saved-terms-mutation-unconfirmed');
      setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
        epoch: savedTermsLoadRef.current.epoch,
        error,
      });
      throw error;
    }
  }, [retrySavedTermsLoad, setSavedTermsLoadState]);

  useEffect(() => {
    onFullDataResetControllerChange?.({
      purge: purgeForFullDataReset,
      confirmPersistentReset: confirmSavedTermsPersistentReset,
      recoverAfterPersistentResetFailure: recoverSavedTermsAfterResetFailure,
    });
    return () => onFullDataResetControllerChange?.(null);
  }, [
    confirmSavedTermsPersistentReset,
    onFullDataResetControllerChange,
    purgeForFullDataReset,
    recoverSavedTermsAfterResetFailure,
  ]);

  const handleUndoClear = useCallback(() => {
    const restored = prepareClearedSessionRestore(clearedSessionRef.current?.snapshot);
    if (!restored) return;
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    discardClearedSession();
    requestCoordinatorRef.current.invalidate();
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    setActiveProcessingSnapshot(null);
    invoke(IPC_CHANNELS.LLM_CANCEL, { discardResult: true }).catch(() => {});
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    setInputText(restored.inputText || '');
    setSourceLimitActionNotice('');
    setProcessedSourceText(restored.processedSourceText || '');
    setBrief(restored.brief || null);
    setCompletedActionIds(restored.completedActionIds || restored.lastGood?.completedActionIds || []);
    setResult(restored.result || '');
    setCaptureMeta(restored.captureMeta || { confidence: null, blocks: [] });
    setSourceMeta(restored.sourceMeta || { truncated: false, originalLength: null });
    setStatus(restored.status || STATUS.IDLE);
    setWarning(restored.warning || '');
    setError(restored.error || null);
    setCaptureErrorCode(restored.captureErrorCode || null);
    setProcessingErrorCode(restored.processingErrorCode || null);
    setProcessingTimeMs(restored.processingTimeMs || null);
    setVerificationTimeMs(restored.verificationTimeMs || null);
    setSourceType(restored.sourceType || 'manual');
    setIsEditingSource(Boolean(restored.isEditingSource));
    setSourceEditDraft(restored.sourceEditDraft || null);
    const restoredReplyDraftState = restored.replyDraftState || null;
    replyDraftStateRef.current = restoredReplyDraftState;
    setReplyDraftState(restoredReplyDraftState);
    replyDialogOpenRef.current = false;
    setReplyDialogOpen(false);
    setVerificationApprovalId(null);
    setIsVerifying(false);
    setIsCancellingVerification(false);
    lastGoodRef.current = restored.lastGood;
    const restoredResult = restored.status === STATUS.DONE && Boolean(restored.brief || restored.result);
    setClipboardNotice((current) => reconcileReplyClipboardNotice(current, {
      replyDraftState: restoredReplyDraftState,
      taskActive: restoredResult && (
        !Number.isSafeInteger(current?.taskGeneration)
        || current.taskGeneration === replyTaskGenerationRef.current
      ),
    }));
    setWindowMode(restoredResult ? 'result' : 'capture');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!restoredResult) textareaRef.current?.focus({ preventScroll: true });
      });
    });
  }, [discardClearedSession, invoke, revokeDelayedCaptureDispatch, setClipboardNotice, setWindowMode]);

  useEffect(() => {
    if (!pendingSessionRecovery) return;
    invoke(IPC_CHANNELS.LLM_CANCEL, { discardResult: true }).catch(() => false);
  }, [invoke, pendingSessionRecovery]);

  const handleDiscardSessionRecovery = useCallback(() => {
    clearSessionRecovery(getSessionRecoveryStorage());
    latestSessionRecoveryRef.current = null;
    sessionRecoveryReadyRef.current = true;
    onSessionRecoveryPendingChange?.(false);
    setPendingSessionRecovery(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [onSessionRecoveryPendingChange]);

  const handleRetryProcessing = useCallback(() => {
    const attempt = failedProcessingAttemptRef.current;
    const retry = prepareFailedProcessingAttemptRetry(attempt, sourceEditDraft);
    if (attempt && retry) {
      triggerProcessing(retry.text, retry.options);
      return;
    }
    if (attempt) {
      handleReviewFailedProcessingAttempt();
      return;
    }
    triggerProcessing(processedSourceText || inputText, {
      source: sourceType,
      capture: captureMeta,
      ...sourceMeta,
      retryOfLastGood: true,
    });
  }, [
    captureMeta,
    handleReviewFailedProcessingAttempt,
    inputText,
    processedSourceText,
    sourceEditDraft,
    sourceMeta,
    sourceType,
    triggerProcessing,
  ]);

  const handleRestoreSessionRecovery = useCallback(() => {
    const restored = prepareSessionRecoveryRestore(pendingSessionRecovery);
    if (!restored) {
      handleDiscardSessionRecovery();
      return;
    }
    revokeDelayedCaptureDispatch({ sourceReplaced: true });
    clearSessionRecovery(getSessionRecoveryStorage());
    latestSessionRecoveryRef.current = null;
    sessionRecoveryReadyRef.current = true;
    onSessionRecoveryPendingChange?.(false);
    setPendingSessionRecovery(null);
    discardClearedSession();
    requestCoordinatorRef.current.invalidate();
    screenshotRunRef.current = {
      token: screenshotRunRef.current.token + 1,
      inFlight: false,
    };
    activeProcessingRef.current = null;
    setActiveProcessingSnapshot(null);
    processingCancelRunRef.current = {
      token: processingCancelRunRef.current.token + 1,
      pending: false,
      failedTaskId: null,
      failedScreenshotToken: null,
    };
    verificationRunRef.current = {
      token: verificationRunRef.current.token + 1,
      sourceHash: null,
      cancelRequested: false,
    };
    setInputText(restored.inputText || '');
    setProcessedSourceText(restored.processedSourceText || '');
    setBrief(restored.brief || null);
    setCompletedActionIds(restored.completedActionIds || restored.lastGood?.completedActionIds || []);
    setResult(restored.result || '');
    setCaptureMeta(restored.captureMeta || { confidence: null, blocks: [] });
    setSourceMeta(restored.sourceMeta || { truncated: false, originalLength: null });
    setStatus(restored.status || STATUS.IDLE);
    setWarning(restored.warning || '');
    setError(null);
    setCaptureErrorCode(null);
    setProcessingErrorCode(restored.processingErrorCode || null);
    setProcessingTimeMs(restored.processingTimeMs || null);
    setVerificationTimeMs(restored.verificationTimeMs || null);
    setSourceType(restored.sourceType || 'manual');
    setIsEditingSource(Boolean(restored.isEditingSource));
    setSourceEditDraft(restored.sourceEditDraft || null);
    replyDraftStateRef.current = restored.replyDraftState || null;
    setReplyDraftState(restored.replyDraftState || null);
    replyDialogOpenRef.current = false;
    setReplyDialogOpen(false);
    setVerificationApprovalId(null);
    setIsVerifying(false);
    setIsCancellingVerification(false);
    setIsCancellingProcessing(false);
    setProcessingCancelError('');
    lastGoodRef.current = restored.lastGood;
    const restoredResult = restored.status === STATUS.DONE && Boolean(restored.brief || restored.result);
    setWindowMode(restoredResult ? 'result' : 'capture');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!restoredResult) textareaRef.current?.focus({ preventScroll: true });
      });
    });
  }, [
    discardClearedSession,
    handleDiscardSessionRecovery,
    onSessionRecoveryPendingChange,
    pendingSessionRecovery,
    revokeDelayedCaptureDispatch,
    setWindowMode,
  ]);

  const handleToggleActionCompletion = useCallback((actionId) => {
    if (typeof actionId !== 'string' || !actionId) return;
    setCompletedActionIds((current) => {
      const next = current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId];
      if (lastGoodRef.current) {
        lastGoodRef.current = {
          ...lastGoodRef.current,
          completedActionIds: next,
        };
      }
      return next;
    });
  }, []);

  const handleSaveTerm = useCallback(async (term) => {
    const knownTerms = await ensureSavedTermsLoaded({
      force: savedTermsLoadRef.current.status === SAVED_TERMS_LOAD_STATUS.ERROR,
    });
    if (hasSavedTerm(knownTerms, term?.surface)) {
      return { status: 'already-saved', term };
    }
    const firstEvidence = term?.provenance?.evidence?.[0];
    const savedTerm = await runSavedTermsMutation(
      'save',
      () => invoke(IPC_CHANNELS.TERMS_SAVE, {
        term: term.surface,
        termKind: term.kind,
        provenanceKind: term.provenance?.kind,
        definition: term.explanation,
        evidence: firstEvidence?.quote || '',
      }),
      (response) => commitSavedTermResponse(response, { term: term.surface }),
    );
    return { status: 'saved', term: savedTerm };
  }, [commitSavedTermResponse, ensureSavedTermsLoaded, invoke, runSavedTermsMutation]);

  const handleDeleteTerm = useCallback(async (term) => {
    return runSavedTermsMutation(
      'delete',
      async () => {
        const deleted = await invoke(IPC_CHANNELS.TERMS_DELETE, term.id);
        if (deleted !== true) throw new Error('saved-terms-delete-unconfirmed');
        return term;
      },
      () => updateSavedTerms((terms) => terms.filter((item) => item.id !== term.id)),
    );
  }, [invoke, runSavedTermsMutation, updateSavedTerms]);

  const handleRestoreTerm = useCallback(async (term) => {
    return runSavedTermsMutation(
      'restore',
      () => invoke(IPC_CHANNELS.TERMS_SAVE, {
        id: term.id,
        createdAt: term.createdAt,
        term: term.term,
        termKind: term.termKind,
        provenanceKind: term.provenanceKind,
        definition: term.explanation,
        evidence: term.evidence,
      }),
      (response) => commitSavedTermResponse(response, { id: term.id, term: term.term }),
    );
  }, [commitSavedTermResponse, invoke, runSavedTermsMutation]);

  const handleExportTerms = useCallback(() => invoke(IPC_CHANNELS.TERMS_EXPORT), [invoke]);

  const handlePreviewTermImport = useCallback(async () => {
    const response = await invoke(IPC_CHANNELS.TERMS_IMPORT_PREVIEW);
    if (isValidSavedTermsImportPreview(response, savedTermsRef.current)) {
      savedTermsImportPreviewRef.current = {
        previewId: response.previewId,
        fileName: response.fileName,
        summary: { ...response.summary },
        planTerms: response.planTerms.map((term) => ({ ...term })),
      };
      return Object.fromEntries(
        Object.entries(response).filter(([key]) => key !== 'planTerms'),
      );
    }
    savedTermsImportPreviewRef.current = null;
    if (response?.status === 'cancelled') return response;
    if (
      response?.status === 'failed'
      && SAVED_TERMS_IMPORT_PREVIEW_FAILURE_CODES.has(response?.code)
    ) {
      return response;
    }
    throw createSavedTermsLoadError('saved-terms-invalid-import-preview-response');
  }, [invoke]);

  const handleCommitTermImport = useCallback(async (previewId) => {
    const preview = savedTermsImportPreviewRef.current;
    const existingTerms = savedTermsRef.current.map((term) => ({ ...term }));
    try {
      return await runSavedTermsMutation(
        'import',
        () => invoke(IPC_CHANNELS.TERMS_IMPORT_COMMIT, previewId),
        (response) => {
          if (response?.status === 'imported') {
            if (preview?.previewId !== previewId
              || !isValidSavedTermsImportCommit(response, existingTerms, preview)) {
              const error = createSavedTermsLoadError('saved-terms-invalid-import-response');
              setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
                epoch: savedTermsLoadRef.current.epoch,
                error,
              });
              throw error;
            }
            updateSavedTerms(response.savedTerms);
            return;
          }
          if (
            response?.status !== 'failed'
            || !SAVED_TERMS_CONFIRMED_IMPORT_NOOP_CODES.has(response?.code)
          ) {
            throw createSavedTermsLoadError('saved-terms-invalid-import-response');
          }
        },
      );
    } finally {
      if (savedTermsImportPreviewRef.current?.previewId === previewId) {
        savedTermsImportPreviewRef.current = null;
      }
    }
  }, [invoke, runSavedTermsMutation, setSavedTermsLoadState, updateSavedTerms]);

  const resetSavedTermsWorkspace = useCallback(() => {
    if (!savedTermsLibraryImport.reset()) return false;
    setSavedTermsWorkspace((current) => ({
      attempt: current.attempt + 1,
      Component: createSavedTermsLibrary(),
    }));
    return true;
  }, []);

  const openSavedTerms = useCallback(() => {
    revokeDelayedCaptureDispatch();
    void ensureSavedTermsLoaded().catch(() => false);
    savedTermsDrawerOpenRef.current = true;
    foregroundCaptureDecisionBlockingRef.current = true;
    if (!savedTermsWorkspaceMountedRef.current) {
      savedTermsWorkspaceMountedRef.current = true;
      setSavedTermsWorkspaceMounted(true);
    }
    setSavedTermsDrawerOpen(true);
  }, [ensureSavedTermsLoaded, revokeDelayedCaptureDispatch]);

  const prepareSavedTermsAccess = useCallback(() => {
    prepareSavedTermsLibrary();
    void ensureSavedTermsLoaded().catch(() => false);
  }, [ensureSavedTermsLoaded]);

  const closeSavedTerms = useCallback(() => {
    savedTermsDrawerOpenRef.current = false;
    setSavedTermsDrawerOpen(false);
  }, []);

  const verifyOfficialSources = useCallback(async () => {
    if (!processedSourceText || !brief || !verificationApprovalId || isVerifying || settings.verificationPolicy !== 'ask') return;
    const token = verificationRunRef.current.token + 1;
    const approvalId = verificationApprovalId;
    let sourceHash = null;
    verificationRunRef.current = { token, sourceHash: null, cancelRequested: false };
    verificationSettingsSettlementRef.current = null;
    const settleSettingsIntent = (outcome) => {
      if (
        settingsOpenIntentRef.current === 'verification'
        && verificationSettingsSettlementRef.current?.token === token
      ) {
        verificationSettingsSettlementRef.current = { token, outcome };
      }
    };
    setVerificationApprovalId(null);
    setIsVerifying(true);
    setIsCancellingVerification(false);
    try {
      sourceHash = await hashSourceText(processedSourceText);
      if (verificationRunRef.current.token !== token) return;
      const cancelRequestedBeforeInvoke = verificationRunRef.current.cancelRequested;
      verificationRunRef.current = { token, sourceHash, cancelRequested: cancelRequestedBeforeInvoke };
      if (cancelRequestedBeforeInvoke) {
        setVerificationApprovalId(approvalId);
        lastGoodRef.current = withVerificationApproval(lastGoodRef.current, approvalId);
        setWarning((current) => appendUniqueWarning(current, VERIFICATION_CANCELLED_NOTICE));
        settleSettingsIntent('cancelled');
        return;
      }
      const response = await invoke(IPC_CHANNELS.VERIFICATION_RUN, {
        sourceText: processedSourceText,
        brief,
        approvalId,
      });
      if (verificationRunRef.current.token !== token || verificationRunRef.current.sourceHash !== sourceHash) return;
      const cancellationRequested = verificationRunRef.current.cancelRequested;
      if (!response?.success || !response.brief || response.brief.status === 'invalid') {
        const verificationWarning = cancellationRequested || response?.cancelled
          ? VERIFICATION_CANCELLED_NOTICE
          : userErrorMessage(response, VERIFICATION_FAILURE_MESSAGE);
        const nextApprovalId = response?.retryApprovalId || response?.verificationSummary?.approvalId || null;
        setVerificationApprovalId(nextApprovalId);
        lastGoodRef.current = withVerificationApproval(lastGoodRef.current, nextApprovalId);
        setWarning((current) => appendUniqueWarning(current, verificationWarning));
        settleSettingsIntent(
          cancellationRequested || response?.cancelled ? 'cancelled' : 'settled-without-result',
        );
        return;
      }
      const retryApprovalId = response?.retryApprovalId || response.verificationSummary?.approvalId || null;
      const nextVerificationTimeMs = response.processingTimeMs || null;
      markTaskClipboardCopiesOutdated();
      setBrief(response.brief);
      setResult(response.text || result);
      setVerificationTimeMs(nextVerificationTimeMs);
      setVerificationApprovalId(retryApprovalId);
      if (cancellationRequested) {
        setWarning((current) => appendUniqueWarning(current, VERIFICATION_COMPLETED_DURING_CANCEL_NOTICE));
      }
      settleSettingsIntent('completed');
      if (lastGoodRef.current) {
        lastGoodRef.current = {
          ...lastGoodRef.current,
          brief: response.brief,
          result: response.text || result,
          verificationTimeMs: nextVerificationTimeMs,
          verificationApprovalId: retryApprovalId,
        };
      }
    } catch {
      if (verificationRunRef.current.token !== token || verificationRunRef.current.sourceHash !== sourceHash) return;
      setVerificationApprovalId(approvalId);
      lastGoodRef.current = withVerificationApproval(lastGoodRef.current, approvalId);
      setWarning((current) => appendUniqueWarning(
        current,
        verificationRunRef.current.cancelRequested ? VERIFICATION_CANCELLED_NOTICE : VERIFICATION_FAILURE_MESSAGE,
      ));
      settleSettingsIntent(
        verificationRunRef.current.cancelRequested ? 'cancelled' : 'settled-without-result',
      );
    } finally {
      if (verificationRunRef.current.token === token && verificationRunRef.current.sourceHash === sourceHash) {
        setIsVerifying(false);
        setIsCancellingVerification(false);
      }
    }
  }, [brief, invoke, isVerifying, markTaskClipboardCopiesOutdated, processedSourceText, result, settings.verificationPolicy, verificationApprovalId]);

  const cancelOfficialVerification = useCallback(() => {
    if (!isVerifying || isCancellingVerification) return;
    const token = verificationRunRef.current.token;
    verificationRunRef.current = {
      ...verificationRunRef.current,
      cancelRequested: true,
    };
    setIsCancellingVerification(true);
    const handleUnconfirmedCancellation = () => {
      if (verificationRunRef.current.token !== token) return;
      verificationRunRef.current = {
        ...verificationRunRef.current,
        cancelRequested: false,
      };
      setIsCancellingVerification(false);
      setWarning((current) => appendUniqueWarning(current, VERIFICATION_CANCEL_FAILED_NOTICE));
    };
    invoke(IPC_CHANNELS.LLM_CANCEL)
      .then((acknowledged) => {
        if (acknowledged !== true) handleUnconfirmedCancellation();
      })
      .catch(handleUnconfirmedCancellation);
  }, [invoke, isCancellingVerification, isVerifying]);

  const handleProceedPendingScreenshot = useCallback(() => {
    if (!pendingScreenshotRequest || isCancellingProcessing || isCancellingVerification) return false;
    if (pendingScreenshotDecisionStillBlocking || replyDialogOpenRef.current) {
      if (foregroundCaptureReason && foregroundCaptureReason !== pendingScreenshotRequest.reason) {
        setPendingScreenshotRequest((current) => current
          ? { ...current, reason: foregroundCaptureReason }
          : null);
      }
      setClipboardQueueAnnouncement('请先完成当前确认；截图请求仍在等待，没有打开框选。');
      return false;
    }
    onPendingCaptureSettled?.({ kind: 'screenshot' });
    const captureIsBusy = status === STATUS.PROCESSING || isVerifying;
    if (!captureIsBusy) {
      setClipboardQueueAnnouncement('已确认开始截图；当前有效结果会保留到新结果成功生成。');
      performScreenshotCapture();
      return true;
    }
    setPendingScreenshotRequest((current) => current ? { ...current, status: 'stopping' } : null);
    setClipboardQueueAnnouncement('正在安全停止当前任务；只有停止被确认或任务先完成后，才会开始截图框选。');
    if (isVerifying) {
      cancelOfficialVerification();
      return true;
    }
    if (status === STATUS.PROCESSING) {
      handleCancelProcessing();
      return true;
    }
    return true;
  }, [
    cancelOfficialVerification,
    handleCancelProcessing,
    isCancellingProcessing,
    isCancellingVerification,
    isVerifying,
    pendingScreenshotRequest,
    pendingScreenshotDecisionStillBlocking,
    foregroundCaptureReason,
    onPendingCaptureSettled,
    performScreenshotCapture,
    status,
  ]);

  const handleIgnorePendingScreenshot = useCallback(() => {
    if (!pendingScreenshotRequest || pendingScreenshotRequest.status === 'stopping') return false;
    const ignoredReason = pendingScreenshotRequest.reason;
    const shouldResumeReplyDraft = pendingScreenshotRequest.replyDraftProtected === true
      && !foregroundCaptureReason;
    onPendingCaptureSettled?.({ kind: 'screenshot' });
    setPendingScreenshotRequest(null);
    setClipboardQueueAnnouncement(shouldResumeReplyDraft
      ? '已忽略等待中的截图请求；回复草稿、选择状态和光标位置保持不变。'
      : '已忽略等待中的截图请求；当前原文、任务和结果没有改变。');
    if (shouldResumeReplyDraft) {
      resumeReplyDraft();
      return true;
    }
    window.requestAnimationFrame(() => {
      if (ignoredReason === 'source-edit' || ignoredReason === 'source-draft') {
        focusAvailableElement(textareaRef.current);
      } else if (ignoredReason === 'clear-undo') {
        focusAvailableElement(clearUndoButtonRef.current);
      } else if (status === STATUS.DONE) {
        focusAvailableElement(resultReturnButtonRef.current || settingsTriggerRef.current);
      } else {
        focusAvailableElement(textareaRef.current);
      }
    });
    return true;
  }, [
    foregroundCaptureReason,
    onPendingCaptureSettled,
    pendingScreenshotRequest,
    resumeReplyDraft,
    status,
  ]);

  useEffect(() => {
    const wasBlocking = previousForegroundCaptureBlockingRef.current;
    previousForegroundCaptureBlockingRef.current = pendingScreenshotDecisionStillBlocking;
    if (!pendingScreenshotRequest) return undefined;
    if (pendingScreenshotRequest.status === 'stopping') return undefined;

    if (
      foregroundCaptureReason
      && foregroundCaptureReason !== pendingScreenshotRequest.reason
    ) {
      setPendingScreenshotRequest((current) => current
        ? { ...current, reason: foregroundCaptureReason }
        : null);
    } else if (
      !foregroundCaptureReason
      && ['source-edit', 'source-draft', 'clear-undo'].includes(pendingScreenshotRequest.reason)
    ) {
      setPendingScreenshotRequest((current) => current
        ? { ...current, reason: 'foreground-resolved' }
        : null);
      setClipboardQueueAnnouncement('刚才的前台操作已经结束；截图请求仍在等待，当前内容没有改变。');
    }
    if (pendingScreenshotDecisionStillBlocking || !wasBlocking) return undefined;

    setClipboardQueueAnnouncement('当前确认已经结束；截图请求仍在等待，现在由你决定是否开始。');

    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (foregroundCaptureDecisionBlockingRef.current || replyDialogOpenRef.current) return;
        focusAvailableElement(pendingScreenshotStatusRef.current);
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [
    foregroundCaptureReason,
    pendingScreenshotDecisionStillBlocking,
    pendingScreenshotRequest,
  ]);

  useEffect(() => {
    if (pendingScreenshotRequest?.status !== 'stopping') return undefined;
    if (
      status === STATUS.PROCESSING
      || isCancellingProcessing
      || isVerifying
      || isCancellingVerification
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setClipboardQueueAnnouncement('当前任务已经安全停止或完成；开始截图框选。');
      performScreenshotCapture();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    isCancellingProcessing,
    isCancellingVerification,
    isVerifying,
    pendingScreenshotRequest?.status,
    performScreenshotCapture,
    status,
  ]);

  const handleOpenSettingsRequest = useCallback((origin = 'control') => {
    const fromNativeMenu = origin === 'native-menu';
    const activeElement = fromNativeMenu ? restorableActiveElement() : null;
    revokeDelayedCaptureDispatch();
    if (
      status === STATUS.PROCESSING
      || isCancellingProcessing
      || isVerifying
      || isCancellingVerification
    ) {
      settingsGuardReturnFocusRef.current = activeElement || settingsTriggerRef.current;
      setProcessingSettingsGuardOpen(true);
      return;
    }
    settingsReturnFocusElementRef.current = activeElement;
    settingsReturnFocusRef.current = status === STATUS.DONE
      ? 'result'
      : fromNativeMenu ? 'source' : 'settings-trigger';
    onOpenSettings();
  }, [
    isCancellingProcessing,
    isCancellingVerification,
    isVerifying,
    onOpenSettings,
    revokeDelayedCaptureDispatch,
    status,
  ]);

  useEffect(() => {
    const requestId = settingsMenuRequest?.requestId;
    if (!requestId) return;
    if (settingsMenuActionRef.current === requestId) {
      onSettingsMenuRequestHandled?.(requestId);
      return;
    }
    settingsMenuActionRef.current = requestId;
    if (visible && !hasForegroundFocusOwner) {
      handleOpenSettingsRequest('native-menu');
    }
    // Existing top-layer decisions are strict no-ops; they never become a
    // delayed Settings navigation after the user resolves another choice.
    onSettingsMenuRequestHandled?.(requestId);
  }, [
    handleOpenSettingsRequest,
    hasForegroundFocusOwner,
    onSettingsMenuRequestHandled,
    settingsMenuRequest,
    visible,
  ]);

  const handleOpenProcessingRecovery = useCallback(() => {
    revokeDelayedCaptureDispatch();
    settingsReturnFocusRef.current = status === STATUS.DONE ? 'result' : 'source';
    if (!processingRecovery) {
      onOpenSettings();
      return;
    }
    onOpenSettings(processingRecovery.notice, processingRecovery.entryTarget);
  }, [onOpenSettings, processingRecovery, revokeDelayedCaptureDispatch, status]);

  const handleConfigureFullAnalysis = useCallback(() => {
    revokeDelayedCaptureDispatch();
    settingsReturnFocusRef.current = status === STATUS.DONE ? 'result' : 'source';
    onOpenSettings(
      '当前基础翻译、原文和上一份有效结果仍在主面板。选择完整分析的运行位置，完成验证后即可返回继续处理。',
      'full-analysis',
    );
  }, [onOpenSettings, revokeDelayedCaptureDispatch, status]);

  const handleOpenShortcutSettings = useCallback(() => {
    revokeDelayedCaptureDispatch();
    if (status === STATUS.PROCESSING || isVerifying || isCancellingVerification) {
      setProcessingSettingsGuardOpen(true);
      return;
    }
    settingsReturnFocusRef.current = status === STATUS.DONE ? null : 'settings-trigger';
    onOpenSettings('', 'shortcuts');
  }, [isCancellingVerification, isVerifying, onOpenSettings, revokeDelayedCaptureDispatch, status]);

  const handleDismissProcessingSettingsGuard = useCallback(() => {
    revokePendingSettingsNavigation();
    setProcessingSettingsGuardOpen(false);
  }, [revokePendingSettingsNavigation]);

  const handleStopAndOpenSettings = useCallback(() => {
    const returnFocusElement = settingsGuardReturnFocusRef.current;
    const returnFocusDestination = status === STATUS.DONE
      ? 'result'
      : ocrReview
        ? 'review'
        : status === STATUS.ERROR ? 'error' : lastGoodRef.current ? 'result' : 'source';
    revokePendingSettingsNavigation();
    settingsReturnFocusElementRef.current = returnFocusElement;
    settingsReturnFocusRef.current = returnFocusDestination;
    setProcessingSettingsGuardOpen(false);
    if (isVerifying || isCancellingVerification) {
      verificationSettingsSettlementRef.current = {
        token: verificationRunRef.current.token,
        outcome: 'pending',
      };
      settingsOpenIntentRef.current = 'verification';
      setSettingsOpenIntent('verification');
      cancelOfficialVerification();
      return;
    }
    const hasActiveProcessingTarget = activeProcessingRef.current?.taskId != null
      || screenshotRunRef.current.inFlight;
    if (!hasActiveProcessingTarget) {
      onOpenSettings(status === STATUS.DONE
        ? '任务已经完成；当前结果仍保留，返回主面板后可以继续查看。'
        : ocrReview
          ? '任务已停在发送前复核；原文仍保留，返回主面板后可以继续核对。'
          : status === STATUS.ERROR
            ? '当前处理已经结束；原文和问题说明仍保留，返回主面板后可以继续处理。'
            : '当前任务已经结束；原文仍保留，返回主面板后可以继续处理。');
      return;
    }
    settingsOpenIntentRef.current = 'analysis';
    setSettingsOpenIntent('analysis');
    if (!isCancellingProcessing) handleCancelProcessing({ openSettingsAfter: true });
  }, [cancelOfficialVerification, handleCancelProcessing, isCancellingProcessing, isCancellingVerification, isVerifying, ocrReview, onOpenSettings, revokePendingSettingsNavigation, status]);

  useEffect(() => {
    if (settingsOpenIntentRef.current !== 'verification') return;
    if (isVerifying || isCancellingVerification) return;
    const settlement = verificationSettingsSettlementRef.current;
    settingsOpenIntentRef.current = null;
    setSettingsOpenIntent(null);
    verificationSettingsSettlementRef.current = null;
    if (
      !settlement
      || settlement.token !== verificationRunRef.current.token
      || settlement.outcome === 'pending'
      || settlement.outcome === 'completed'
    ) {
      // A completion-winning or superseded verification keeps the newly
      // updated result visible. It must not honor a stale Settings intent.
      revokePendingSettingsNavigation();
      window.requestAnimationFrame(() => {
        focusAvailableElement(document.getElementById('result-headline'));
      });
      return;
    }
    onOpenSettings('官方来源查找已经停止或完成；当前结果仍保留。');
  }, [isCancellingVerification, isVerifying, onOpenSettings, revokePendingSettingsNavigation]);

  const handleResultOrderChange = useCallback(async (nextOrder) => {
    if (isSavingResultOrder || nextOrder === settings.resultOrder) return false;
    setIsSavingResultOrder(true);
    try {
      await updateSettings('resultOrder', nextOrder);
      setResultOrderSaveError(null);
      return true;
    } catch {
      setResultOrderSaveError({
        requested: nextOrder,
        current: settings.resultOrder,
      });
      return false;
    } finally {
      setIsSavingResultOrder(false);
    }
  }, [isSavingResultOrder, settings.resultOrder, updateSettings]);

  const clipboardMonitoringCopy = describeClipboardMonitoring(settings);
  const shortcutReadinessCopy = describeShortcutReadiness(shortcutStatus);

  const handleProcessPendingClipboard = useCallback(() => {
    const item = pendingClipboardRef.current;
    const guard = clipboardEventGuardRef.current || {};
    if (!item || guard.status === STATUS.PROCESSING || guard.isVerifying) return false;
    const isManualRead = item.source === 'manual-read';
    if (
      (isManualRead && pendingClipboardDecisionStillBlockingRef.current)
      || (!isManualRead && (
        foregroundCaptureDecisionBlockingRef.current
        || replyDialogOpenRef.current
      ))
    ) {
      setClipboardQueueAnnouncement('请先完成当前确认；复制文字仍在等待，没有开始新的处理。');
      return false;
    }
    onPendingCaptureSettled?.({ kind: 'clipboard' });
    pendingClipboardRef.current = null;
    setPendingClipboardItem(null);
    if (isManualRead) {
      clipboardReadReturnFocusRef.current = null;
      setClipboardQueueAnnouncement('已替换原文；尚未处理，请检查后再生成。');
      return commitManualClipboardRead(item, { confirmedReplacement: true });
    }
    setClipboardQueueAnnouncement('开始处理等待中的复制文字；此前的当前内容已安全保留，只有新任务成功后才会替换结果。');
    applyClipboardPayload(item, { delayMs: 0 });
    return true;
  }, [applyClipboardPayload, commitManualClipboardRead, onPendingCaptureSettled]);

  useEffect(() => {
    const requestId = approvedCaptureRequest?.id;
    if (!visible || !requestId || approvedCaptureHandledRef.current === requestId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const started = approvedCaptureRequest.kind === 'clipboard'
        ? handleProcessPendingClipboard()
        : approvedCaptureRequest.kind === 'screenshot'
          ? handleProceedPendingScreenshot()
          : false;
      if (!started) return;
      approvedCaptureHandledRef.current = requestId;
      onApprovedCaptureConsumed?.(approvedCaptureRequest);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    approvedCaptureRequest,
    handleProceedPendingScreenshot,
    handleProcessPendingClipboard,
    onApprovedCaptureConsumed,
    visible,
  ]);

  const handleIgnorePendingClipboard = useCallback(() => {
    const item = pendingClipboardRef.current;
    if (!item) return;
    const isManualRead = item.source === 'manual-read';
    const ignoredReason = isManualRead
      ? baseForegroundCaptureReason || item.foregroundReason
      : foregroundCaptureReason;
    const shouldResumeReplyDraft = item.replyDraftProtected === true && !ignoredReason;
    onPendingCaptureSettled?.({ kind: 'clipboard' });
    pendingClipboardRef.current = null;
    setPendingClipboardItem(null);
    setClipboardQueueAnnouncement(isManualRead
      ? '已保留当前原文；剪贴板文字已丢弃，未开始处理。'
      : shouldResumeReplyDraft
        ? '已忽略等待中的复制文字；回复草稿、选择状态和光标位置保持不变。'
        : '已忽略等待中的复制文字；当前原文、任务和结果没有改变。');
    if (shouldResumeReplyDraft) {
      resumeReplyDraft();
      return;
    }
    const exactReturnTarget = isManualRead ? clipboardReadReturnFocusRef.current : null;
    clipboardReadReturnFocusRef.current = null;
    if (isManualRead) resumeClearedSessionUndo();
    window.requestAnimationFrame(() => {
      if (ignoredReason === 'clear-undo') {
        focusAvailableElement(clearUndoButtonRef.current);
      } else if (
        exactReturnTarget?.isConnected
        && !exactReturnTarget.closest?.('[inert]')
      ) {
        focusAvailableElement(exactReturnTarget);
      } else if (ignoredReason === 'source-edit' || ignoredReason === 'source-draft') {
        focusAvailableElement(textareaRef.current);
      } else if (clipboardMonitoringStatusRef.current) {
        focusAvailableElement(clipboardMonitoringStatusRef.current);
      } else if (status === STATUS.DONE) {
        focusAvailableElement(document.getElementById('result-headline'));
      } else {
        focusAvailableElement(textareaRef.current);
      }
    });
  }, [
    baseForegroundCaptureReason,
    foregroundCaptureReason,
    onPendingCaptureSettled,
    resumeClearedSessionUndo,
    resumeReplyDraft,
    status,
  ]);

  useEffect(() => {
    const wasBlocking = previousForegroundClipboardBlockingRef.current;
    previousForegroundClipboardBlockingRef.current = pendingClipboardDecisionStillBlocking;
    if (
      !pendingClipboardItem
      || pendingClipboardDecisionStillBlocking
      || !wasBlocking
    ) return undefined;

    setClipboardQueueAnnouncement('当前确认已经结束；复制文字仍在等待，现在由你决定是否处理。');
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (foregroundCaptureDecisionBlockingRef.current || replyDialogOpenRef.current) return;
        focusAvailableElement(pendingClipboardStatusRef.current);
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [pendingClipboardDecisionStillBlocking, pendingClipboardItem]);

  const handleStopClipboardMonitoring = useCallback(async () => {
    if (clipboardMonitoringStopStatus === 'stopping' || !settings.clipboardMonitoring) return false;
    setClipboardMonitoringStopStatus('stopping');
    setClipboardMonitoringStopError('');
    try {
      await updateSettings('clipboardMonitoring', false);
      const discardedWaiting = pendingClipboardRef.current?.source === 'monitor';
      if (discardedWaiting) {
        pendingClipboardRef.current = null;
        setPendingClipboardItem(null);
        setClipboardQueueAnnouncement('自动检测已关闭；等待处理的新复制文字已丢弃，当前任务和结果没有改变。');
      }
      setClipboardMonitoringOffNotice(discardedWaiting
        ? '自动检测已关闭；等待处理的新复制文字已丢弃。若当前任务已经开始，它仍会继续。'
        : '自动检测已关闭；今后复制不会自动处理。若刚才已有任务开始，它仍会继续。');
      setClipboardMonitoringStopStatus('idle');
      window.requestAnimationFrame(() => {
        clipboardMonitoringStatusRef.current?.focus({ preventScroll: true });
      });
      return true;
    } catch {
      discardFailedSettings(['clipboardMonitoring']);
      const consequence = clipboardMonitoringCopy.kind === 'online'
        ? `新复制的文字仍会自动发送给 ${clipboardMonitoringCopy.destination}`
        : '新复制的文字仍会在这台 Mac 上自动分析';
      setClipboardMonitoringStopError(`没有关闭自动检测；${consequence}。请重试关闭。`);
      setClipboardMonitoringStopStatus('error');
      return false;
    }
  }, [
    clipboardMonitoringCopy.destination,
    clipboardMonitoringCopy.kind,
    clipboardMonitoringStopStatus,
    discardFailedSettings,
    settings.clipboardMonitoring,
    updateSettings,
  ]);

  useEffect(() => {
    if (
      settings.clipboardMonitoring
      || !pendingClipboardRef.current
      || pendingClipboardRef.current.source !== 'monitor'
    ) return;
    pendingClipboardRef.current = null;
    setPendingClipboardItem(null);
    setClipboardQueueAnnouncement('自动检测已关闭；等待处理的新复制文字已丢弃，当前内容没有改变。');
  }, [settings.clipboardMonitoring]);

  useEffect(() => {
    invoke(IPC_CHANNELS.CLIPBOARD_PENDING_STATUS, {
      pending: Boolean(pendingClipboardItem),
      count: pendingClipboardItem?.receivedCount || 0,
    }).catch(() => false);
  }, [invoke, pendingClipboardItem]);

  useEffect(() => {
    if (settings.clipboardMonitoring) {
      setClipboardMonitoringOffNotice('');
      return;
    }
    if (clipboardMonitoringStopStatus === 'error') setClipboardMonitoringStopStatus('idle');
    if (clipboardMonitoringStopError) setClipboardMonitoringStopError('');
  }, [
    clipboardMonitoringStopError,
    clipboardMonitoringStopStatus,
    settings.clipboardMonitoring,
  ]);

  const sourceLabel = sourceType === 'sample'
    ? '虚构示例'
    : sourceType === 'ocr'
    ? '截图 OCR'
    : ['clipboard', 'monitor', 'shortcut'].includes(sourceType) ? '剪贴板' : '手动输入';
  const institution = brief?.terms?.find((term) => term.kind === 'institution')?.surface;
  const sourceDescriptor = institution ? `${sourceLabel} · ${institution}` : sourceLabel;
  const isDone = status === STATUS.DONE && brief?.status !== 'invalid' && Boolean(brief || result);
  const processingSettingsGuardTaskSettled = processingSettingsGuardOpen
    && status !== STATUS.PROCESSING
    && !isCancellingProcessing
    && !isVerifying
    && !isCancellingVerification;
  const processingSettingsGuardSettlement = !processingSettingsGuardTaskSettled
    ? null
    : isDone
      ? 'result'
      : ocrReview
        ? 'review'
        : status === STATUS.ERROR ? 'error' : 'source';
  const processingSettingsGuardSettledCopy = {
    result: {
      eyebrow: '任务已经完成',
      title: '结果已保留；仍要打开设置吗？',
      closeLabel: '关闭设置提示并查看结果',
      detail: '任务已在你选择前完成，结果仍在当前窗口。你可以先查看结果，也可以继续打开设置。',
      outcomeTitle: '结果不会丢失或重新处理',
      outcomeDetail: '打开设置不会隐藏这份结果；返回主面板后可以继续查看。',
      continueLabel: '查看结果',
    },
    review: {
      eyebrow: '任务需要复核',
      title: '原文已保留；仍要打开设置吗？',
      closeLabel: '关闭设置提示并复核原文',
      detail: '任务已在你选择前停在发送前复核，原文尚未交给处理服务。你可以先核对内容，也可以继续打开设置。',
      outcomeTitle: '原文尚未发送或丢失',
      outcomeDetail: '返回主面板后仍会停在复核步骤，不会自动重新处理。',
      continueLabel: '复核原文',
    },
    error: {
      eyebrow: '任务已经结束',
      title: '这次没有处理成功；仍要打开设置吗？',
      closeLabel: '关闭设置提示并查看问题',
      detail: '处理已经结束，原文和问题说明仍在当前窗口。你可以先查看恢复建议，也可以继续打开设置。',
      outcomeTitle: '错误与原文都已保留',
      outcomeDetail: '返回主面板后仍会显示这次问题，不会自动重试或覆盖原文。',
      continueLabel: '查看问题',
    },
    source: {
      eyebrow: '任务已经结束',
      title: '原文已保留；仍要打开设置吗？',
      closeLabel: '关闭设置提示并返回原文',
      detail: '任务已在你选择前停止或取消，原文仍在当前窗口。你可以继续处理，也可以打开设置。',
      outcomeTitle: '原文仍在当前窗口',
      outcomeDetail: '打开设置不会自动处理或丢弃原文；返回主面板后可以继续。',
      continueLabel: '返回原文',
    },
  }[processingSettingsGuardSettlement] || null;

  useEffect(() => {
    if (status === STATUS.PROCESSING || pendingSessionRecovery || isDone) {
      void preloadResultDisplay().catch(() => false);
    }
  }, [isDone, pendingSessionRecovery, status]);
  const isTranslationOnly = brief?.status === 'translation_only'
    || (brief?.responseKind || brief?.analysisProvenance?.responseKind) === 'translation_only';
  const sourceLimitState = getSourceLimitState({
    textLength: inputText.length,
    originalLength: sourceMeta.originalLength,
    truncated: sourceMeta.truncated,
    sourceType,
    limit: DEFAULTS.MAX_TEXT_LENGTH,
  });
  const isSourceTooLong = sourceLimitState.blocked;
  const isScreenshotPermissionError = captureErrorCode === 'screenshot-permission-denied';
  const preference = settings.resultOrder === 'translation-first' ? 'translation' : 'action';
  const hasVisibleSourceEditDraft = hasModifiedSourceEditDraft(
    sourceEditDraft,
    processedSourceText || inputText,
  );
  const hasFailedAttemptEditDraft = hasModifiedSourceEditDraft(
    sourceEditDraft,
    failedProcessingAttempt?.text || '',
  );
  const hasSourceEditDraft = hasVisibleSourceEditDraft || hasFailedAttemptEditDraft;
  const handleReviewSourceFromResultFailure = useCallback(() => {
    resetResultWorkspace();
    if (hasFailedAttemptEditDraft) handleReviewFailedProcessingAttempt();
    else handleEditSource();
  }, [
    handleEditSource,
    handleReviewFailedProcessingAttempt,
    hasFailedAttemptEditDraft,
    resetResultWorkspace,
  ]);
  const completedProcessingSnapshot = isDone
    ? resolveResultProcessingSnapshot(brief, lastGoodRef.current)
    : null;
  const privacyProvider = isDone
    ? completedProcessingSnapshot.provider
    : activeProcessingSnapshot?.processingProvider || settings.activeBackend;
  const isFreeTranslate = privacyProvider === 'free_translate';
  const privacyProcessingLocation = isDone
    ? completedProcessingSnapshot.location
    : activeProcessingSnapshot?.processingLocation
      ?? processingLocationForSettings(settings);
  const privacyDisclosure = getProcessingPrivacyDisclosure(privacyProvider, {
    processingLocation: privacyProcessingLocation,
  });
  const capturePrivacyDisclosure = status === STATUS.PROCESSING
    && processingPhase === PROCESSING_PHASE.CAPTURE
    ? SCREENSHOT_CAPTURE_PRIVACY_DISCLOSURE
    : privacyDisclosure;
  const ocrReviewCopy = ocrReview
    ? describeOcrReview({
        source: 'ocr',
        capture: ocrReview.capture,
        processingLocation: privacyProcessingLocation,
        processingProvider: privacyProvider,
      })
    : null;
  const ocrReviewProviderLabel = processingProviderLabel(
    privacyProvider,
    privacyProcessingLocation,
  );
  const ocrReviewActionLabel = privacyProcessingLocation === PROCESSING_LOCATIONS.ONLINE
    ? `已核对，发送给 ${ocrReviewProviderLabel}`
    : privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK
      ? '已核对，交给这台 Mac 上的服务'
      : privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL
        ? '已核对，交给本机模型'
        : '已核对，继续生成';
  const ocrReviewDestination = privacyProcessingLocation === PROCESSING_LOCATIONS.ONLINE
    ? `核对后，完整原文将发送给 ${ocrReviewProviderLabel}。`
    : privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK
      ? '核对后，完整原文将交给这台 Mac 上的兼容服务。'
      : privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL
        ? '核对后，完整原文将交给本机模型。'
        : '核对后，完整原文才会开始处理。';
  const processingSourceSummary = processingPhase === PROCESSING_PHASE.CAPTURE
    ? SCREENSHOT_CAPTURE_SOURCE_SUMMARY
    : getProcessingSourceSummary(sourceType, inputText.length);
  const clipboardQueueBusy = status === STATUS.PROCESSING
    || isCancellingProcessing
    || isVerifying
    || isCancellingVerification;
  const screenshotQueueStopping = pendingScreenshotRequest?.status === 'stopping';
  const screenshotQueueCopy = pendingScreenshotRequest
    ? describePendingScreenshotRequest(pendingScreenshotRequest, {
      busy: clipboardQueueBusy,
      decisionStillBlocking: pendingScreenshotDecisionStillBlocking,
      stopRequestPending: isCancellingProcessing || isCancellingVerification,
    })
    : null;
  const pendingClipboardCopy = pendingClipboardItem
    ? describePendingClipboard(pendingClipboardItem, {
      busy: clipboardQueueBusy,
      foregroundReason: manualClipboardReadPending
        ? baseForegroundCaptureReason || pendingClipboardItem.foregroundReason
        : pendingScreenshotRequest
          ? 'active-decision'
          : foregroundCaptureReason,
    })
    : null;
  const pendingClipboardTextPreview = pendingClipboardItem
    ? pendingClipboardPreview(pendingClipboardItem.text)
    : '';
  const pendingCaptureStatusCount = Number(Boolean(pendingScreenshotRequest))
    + Number(Boolean(pendingClipboardItem && pendingClipboardCopy));
  const hasRuntimeAlerts = Array.isArray(runtimeAlertMessages) && runtimeAlertMessages.length > 0;
  const operationalStatusCount = Number(Boolean(shortcutReadinessCopy))
    + Number(Boolean(settings.clipboardMonitoring || clipboardMonitoringOffNotice))
    + Number(hasRuntimeAlerts);
  const hasForegroundWarning = pendingCaptureStatusCount > 0
    || Boolean(shortcutReadinessCopy)
    || Boolean(clipboardMonitoringStopError)
    || hasRuntimeAlerts;
  const panelOwnsClipboardResidueRisk = Boolean(
    visible
    && clipboardResidueRisk
    && !pendingSessionRecovery
    && onAcknowledgeClipboardResidueRisk,
  );
  const hasForegroundStatus = panelOwnsClipboardResidueRisk
    || pendingCaptureStatusCount > 0
    || operationalStatusCount > 0;
  const replyHasPendingScreenshot = Boolean(
    pendingScreenshotRequest
    && (
      pendingScreenshotRequest.replyDraftProtected === true
      || pendingScreenshotRequest.reason === 'reply-draft'
    )
  );
  const replyHasPendingClipboard = pendingClipboardItem?.replyDraftProtected === true;
  const replyCapturePending = replyHasPendingScreenshot || replyHasPendingClipboard;
  const replyCaptureNotice = replyHasPendingScreenshot && replyHasPendingClipboard
    ? '截图和复制文字都在等待；草稿没有改变。请先关闭草稿，再选择继续编辑或明确放弃草稿开始新任务。'
    : replyHasPendingScreenshot
      ? '截图请求正在等待；草稿没有改变。请先关闭草稿，再选择继续编辑或明确放弃草稿并截图。'
      : replyHasPendingClipboard
        ? '新的复制文字正在等待；草稿没有改变。请先关闭草稿，再选择继续编辑或明确放弃草稿并处理。'
        : '';
  const capturePlaceholder = settings.clipboardMonitoring
    ? '粘贴英文，或复制后等待自动检测…'
    : '粘贴英文邮件、网页段落或课程材料…';
  const sourceDescriptionIds = [
    ocrReviewCopy ? 'ocr-review-detail' : null,
    ocrReviewCopy ? 'ocr-review-destination' : null,
    sourceLimitState.blocked ? 'source-limit-message' : null,
    sourceLimitActionNotice ? 'source-limit-action-status' : null,
  ].filter(Boolean).join(' ') || undefined;
  const hideWindowLabel = status === STATUS.PROCESSING || isVerifying
    ? '隐藏窗口，任务会继续'
    : '隐藏窗口';
  const savedTermsTriggerLabel = savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.READY
    ? `打开术语库，已保存 ${savedTerms.length} 个术语`
    : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.ERROR
      ? '打开术语库，暂时无法读取已保存术语，可打开后重试'
      : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.LOADING
        ? '打开术语库，正在读取已保存术语'
        : '打开术语库，尚未读取已保存术语';

  useEffect(() => {
    if (RESULT_DEMO || pendingSessionRecovery || !sessionRecoveryReadyRef.current) return undefined;
    // While a replacement source is owned by the special failure slot, keep
    // interruption recovery anchored to A in every view (processing, result,
    // or correction). This also lets the user return to A and reopen the same
    // B correction without turning the memory-only slot into durable history.
    const recoverySnapshot = failedProcessingAttempt ? lastGoodRef.current : null;
    const cleanRecoverySnapshot = recoverySnapshot
      ? {
          ...recoverySnapshot,
          warning: removeFailedProcessingAttemptNotice(recoverySnapshot.warning),
        }
      : lastGoodRef.current;
    const recoveryWarning = recoverySnapshot
      ? removeFailedProcessingAttemptNotice(setupIncomplete
        ? resolveSnapshotWarning(
          cleanRecoverySnapshot,
          processingConfigSignature,
          '',
          SETUP_INCOMPLETE_WARNING,
        )
        : resolveSnapshotWarning(cleanRecoverySnapshot, processingConfigSignature))
      : removeFailedProcessingAttemptNotice(warning);
    const recoveryProcessingProvider = recoverySnapshot
      ? cleanRecoverySnapshot?.processingProvider
      : status === STATUS.PROCESSING
        ? activeProcessingSnapshot?.processingProvider
        : cleanRecoverySnapshot?.processingProvider
          ?? brief?.analysisProvenance?.provider;
    const recoveryProcessingLocation = recoverySnapshot
      ? cleanRecoverySnapshot?.processingLocation
      : status === STATUS.PROCESSING
        ? activeProcessingSnapshot?.processingLocation
        : cleanRecoverySnapshot?.processingLocation
          ?? brief?.analysisProvenance?.processingLocation;
    const record = createSessionRecoveryRecord({
      inputText: recoverySnapshot ? cleanRecoverySnapshot.inputText : inputText,
      processedSourceText: recoverySnapshot
        ? cleanRecoverySnapshot.processedSourceText
        : processedSourceText,
      brief: recoverySnapshot ? cleanRecoverySnapshot.brief : brief,
      result: recoverySnapshot ? cleanRecoverySnapshot.result : result,
      captureMeta: recoverySnapshot ? cleanRecoverySnapshot.captureMeta : captureMeta,
      sourceMeta: recoverySnapshot ? cleanRecoverySnapshot.sourceMeta : sourceMeta,
      status: recoverySnapshot ? STATUS.DONE : status,
      warning: recoveryWarning,
      processingErrorCode: recoverySnapshot ? null : processingErrorCode,
      processingTimeMs: recoverySnapshot
        ? cleanRecoverySnapshot.processingTimeMs
        : processingTimeMs,
      verificationTimeMs: recoverySnapshot
        ? cleanRecoverySnapshot.verificationTimeMs
        : verificationTimeMs,
      sourceType: recoverySnapshot ? cleanRecoverySnapshot.sourceType : sourceType,
      processingLocation: recoveryProcessingLocation,
      processingProvider: recoveryProcessingProvider,
      lastGood: cleanRecoverySnapshot,
      completedActionIds: recoverySnapshot
        ? cleanRecoverySnapshot.completedActionIds || []
        : completedActionIds,
      verificationApprovalId: recoverySnapshot
        ? cleanRecoverySnapshot.verificationApprovalId
        : verificationApprovalId,
      isEditingSource: recoverySnapshot ? false : isEditingSource,
      sourceEditDraft: recoverySnapshot ? null : sourceEditDraft,
      isVerifying: recoverySnapshot ? false : isVerifying,
      replyDraftState,
    });
    latestSessionRecoveryRef.current = record;
    if (sessionRecoveryWriteTimerRef.current) {
      window.clearTimeout(sessionRecoveryWriteTimerRef.current);
    }
    sessionRecoveryWriteTimerRef.current = window.setTimeout(() => {
      const storage = getSessionRecoveryStorage();
      if (record) writeSessionRecovery(storage, record);
      else clearSessionRecovery(storage);
      sessionRecoveryWriteTimerRef.current = null;
    }, SESSION_RECOVERY_WRITE_DELAY_MS);
    return () => {
      if (sessionRecoveryWriteTimerRef.current) {
        window.clearTimeout(sessionRecoveryWriteTimerRef.current);
        sessionRecoveryWriteTimerRef.current = null;
      }
    };
  }, [
    activeProcessingSnapshot,
    brief,
    captureMeta,
    completedActionIds,
    failedProcessingAttempt,
    inputText,
    isEditingSource,
    isVerifying,
    pendingSessionRecovery,
    processedSourceText,
    processingConfigSignature,
    processingErrorCode,
    processingTimeMs,
    result,
    replyDraftState,
    sourceEditDraft,
    sourceMeta,
    sourceType,
    status,
    setupIncomplete,
    verificationApprovalId,
    verificationTimeMs,
    warning,
  ]);

  useLayoutEffect(() => {
    onQuitRiskChange?.({
      activeAnalysis: status === STATUS.PROCESSING || isCancellingProcessing,
      activeAnalysisLocation: processingPhase === PROCESSING_PHASE.CAPTURE
        ? PROCESSING_LOCATIONS.LOCAL
        : activeProcessingSnapshot?.processingLocation
          ?? processingLocationForSettings(settings),
      activeVerification: isVerifying || isCancellingVerification,
      hasSourceDraft: (!isDone && Boolean(
        inputText.trim()
        || sourceEditDraft?.text?.trim()
        || processedSourceText.trim()
      )) || pendingSessionRecovery?.kind === 'draft',
      hasResult: isDone || pendingSessionRecovery?.kind === 'result'
        || pendingSessionRecovery?.kind === 'edit' || Boolean(
        isEditingSource && (lastGoodRef.current?.brief || lastGoodRef.current?.result)
      ),
      hasReplyWork: hasMeaningfulReplyDraftState(replyDraftState)
        || hasMeaningfulReplyDraftState(pendingSessionRecovery?.payload?.replyDraftState),
      hasPendingClipboard: Boolean(pendingClipboardItem),
      hasPendingCapture: Boolean(pendingScreenshotRequest),
      hasClearedSessionUndo: Boolean(clearedSession),
      settingsSaving: Boolean(settingsController.settingsSaving || isSavingResultOrder),
    });
  }, [
    clearedSession,
    activeProcessingSnapshot,
    inputText,
    isCancellingProcessing,
    isCancellingVerification,
    isDone,
    isEditingSource,
    isSavingResultOrder,
    isVerifying,
    onQuitRiskChange,
    pendingClipboardItem,
    pendingScreenshotRequest,
    pendingSessionRecovery,
    processedSourceText,
    processingPhase,
    replyDraftState,
    settings,
    settingsController.settingsSaving,
    sourceEditDraft?.text,
    status,
  ]);

  useLayoutEffect(() => () => onQuitRiskChange?.({}), [onQuitRiskChange]);

  return (
    <div className={`slipstream-shell${isDone ? ' is-result' : ' is-capture'}${hasForegroundStatus ? ' has-foreground-status' : ''}`}>
      {pendingSessionRecovery && (
        <SessionRecoveryDialog
          record={pendingSessionRecovery}
          clipboardResidueRisk={clipboardResidueRisk}
          onRestore={handleRestoreSessionRecovery}
          onDiscard={handleDiscardSessionRecovery}
        />
      )}
      {panelOwnsClipboardResidueRisk && (
        <ClipboardResidueRiskNotice
          pending={clipboardResidueRiskPending}
          error={clipboardResidueRiskError}
          onAcknowledge={onAcknowledgeClipboardResidueRisk}
        />
      )}
      <header className="app-header">
        <div className="app-brand" style={{ WebkitAppRegion: 'drag' }}>
          <strong>Slipstream</strong>
          {isDone && <><span className="header-divider" /><span>{sourceDescriptor}</span></>}
        </div>
        <div className="app-header__actions" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className="privacy-status">
            {privacyDisclosure.location === 'local'
              ? <ShieldCheck size={18} weight="fill" />
              : privacyDisclosure.location === 'local-loopback'
                ? <HardDrives size={18} weight="fill" />
                : <CloudArrowUp size={18} weight="fill" />}
            {privacyDisclosure.headerLabel}
          </span>
          {isDone && !isTranslationOnly && (
            <div className="preference-switch" aria-label="结果显示顺序" aria-busy={isSavingResultOrder}>
              <button type="button" className={preference === 'action' ? 'is-active' : ''} onClick={() => handleResultOrderChange('action-first')} aria-pressed={preference === 'action'} disabled={isSavingResultOrder}>
                <ListChecks size={18} />行动优先
              </button>
              <button type="button" className={preference === 'translation' ? 'is-active' : ''} onClick={() => handleResultOrderChange('translation-first')} aria-pressed={preference === 'translation'} disabled={isSavingResultOrder}>
                <BookOpen size={18} />翻译优先
              </button>
            </div>
          )}
          <button
            ref={savedTermsTriggerRef}
            type="button"
            className={`saved-terms-trigger saved-terms-trigger--${savedTermsLoadStatus}`}
            onPointerEnter={prepareSavedTermsAccess}
            onFocus={prepareSavedTermsAccess}
            onClick={openSavedTerms}
            aria-haspopup="dialog"
            aria-expanded={savedTermsDrawerOpen}
            aria-controls="saved-terms-drawer"
            aria-label={savedTermsTriggerLabel}
            aria-busy={savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.LOADING}
          >
            <BookOpen size={18} weight="fill" />
            <span>术语库</span>
            <strong aria-hidden="true">
              {savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.READY
                ? savedTerms.length
                : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.LOADING
                  ? <CircleNotch size={12} className="spin" />
                  : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.ERROR
                    ? <WarningCircle size={12} weight="fill" />
                    : '—'}
            </strong>
          </button>
          <button
            ref={settingsTriggerRef}
            type="button"
            className="icon-button"
            data-settings-trigger
            onPointerEnter={onPrepareSettings}
            onFocus={onPrepareSettings}
            onClick={handleOpenSettingsRequest}
            aria-label="打开设置"
            aria-haspopup={status === STATUS.PROCESSING || isVerifying ? 'dialog' : undefined}
            aria-expanded={processingSettingsGuardOpen || undefined}
            title="设置"
          >
            <GearSix size={23} />
          </button>
          <button type="button" className="icon-button" onClick={() => invoke(IPC_CHANNELS.WINDOW_HIDE)} aria-label={hideWindowLabel} title={hideWindowLabel}>
            <Minus size={22} />
          </button>
        </div>
      </header>

      {(pendingCaptureStatusCount > 0 || operationalStatusCount > 0) && (
        <section
          className="foreground-status-center"
          aria-labelledby="foreground-status-center-title"
          data-pending-capture-count={pendingCaptureStatusCount}
          data-operational-status-count={operationalStatusCount}
        >
          <header className="foreground-status-center__summary">
            {hasForegroundWarning
              ? <WarningCircle size={17} weight="fill" aria-hidden="true" />
              : <ShieldCheck size={17} weight="fill" aria-hidden="true" />}
            <span>
              <strong id="foreground-status-center-title">
                {pendingCaptureStatusCount > 0
                  ? `${pendingCaptureStatusCount} 项捕获请求待处理`
                  : `${operationalStatusCount} 项运行状态`}
              </strong>
              <small>
                {pendingCaptureStatusCount > 0 && operationalStatusCount > 0
                  ? `先处理捕获请求；下方还有 ${operationalStatusCount} 项运行状态。`
                  : pendingCaptureStatusCount > 0
                    ? '当前内容保持不变；按优先顺序处理下方请求。'
                    : '这些状态不会替你开始新的处理。'}
              </small>
            </span>
          </header>

          {pendingScreenshotRequest && (
            <div className="clipboard-monitor-queue-region">
              <section
                className="clipboard-monitor-queue is-screenshot-request"
                role="region"
                aria-labelledby="pending-screenshot-title"
                aria-describedby="pending-screenshot-detail"
                aria-busy={screenshotQueueStopping}
              >
                {screenshotQueueStopping
                  ? <CircleNotch className="pending-screenshot-spinner" size={19} weight="bold" aria-hidden="true" />
                  : <Camera size={19} weight="fill" aria-hidden="true" />}
                <span className="clipboard-monitor-queue__body">
                  <strong
                    ref={pendingScreenshotStatusRef}
                    id="pending-screenshot-title"
                    tabIndex={-1}
                    aria-describedby="pending-screenshot-detail"
                  >
                    {screenshotQueueCopy?.title}
                  </strong>
                  <small id="pending-screenshot-detail">{screenshotQueueCopy?.detail}</small>
                </span>
                <span className="clipboard-monitor-queue__actions">
                  <button
                    type="button"
                    className="clipboard-monitor-queue__accept"
                    onClick={handleProceedPendingScreenshot}
                    disabled={
                      isCancellingProcessing
                      || isCancellingVerification
                      || pendingScreenshotDecisionStillBlocking
                      || screenshotQueueCopy?.actionDisabled
                    }
                    aria-busy={isCancellingProcessing || isCancellingVerification}
                  >
                    {screenshotQueueCopy?.actionLabel}
                  </button>
                  {screenshotQueueCopy?.showIgnoreAction && (
                    <button
                      type="button"
                      onClick={handleIgnorePendingScreenshot}
                      disabled={pendingScreenshotDecisionStillBlocking}
                    >
                      {screenshotQueueCopy.ignoreLabel}
                    </button>
                  )}
                </span>
              </section>
            </div>
          )}

          {pendingClipboardItem && pendingClipboardCopy && (
            <div className="clipboard-monitor-queue-region">
              <section
                className="clipboard-monitor-queue"
                role="region"
                aria-labelledby="clipboard-monitor-queue-title"
                aria-describedby="clipboard-monitor-queue-detail clipboard-monitor-queue-preview"
              >
                <ClipboardText size={19} weight="fill" aria-hidden="true" />
                <span className="clipboard-monitor-queue__body">
                  <strong
                    ref={pendingClipboardStatusRef}
                    id="clipboard-monitor-queue-title"
                    tabIndex={-1}
                    aria-describedby="clipboard-monitor-queue-detail clipboard-monitor-queue-preview"
                  >
                    {pendingClipboardCopy.title}
                  </strong>
                  <small id="clipboard-monitor-queue-detail">{pendingClipboardCopy.detail}</small>
                  <span
                    id="clipboard-monitor-queue-preview"
                    className="clipboard-monitor-queue__preview"
                    lang={inferTextLanguageTag(pendingClipboardTextPreview)}
                  >
                    “{pendingClipboardTextPreview}”
                  </span>
                </span>
                <span className="clipboard-monitor-queue__actions">
                  <button
                    type="button"
                    className="clipboard-monitor-queue__accept"
                    onClick={handleProcessPendingClipboard}
                    disabled={clipboardQueueBusy || pendingClipboardDecisionStillBlocking}
                    aria-describedby="clipboard-monitor-queue-detail"
                  >
                    {pendingClipboardCopy.actionLabel}
                  </button>
                  <button
                    type="button"
                    onClick={handleIgnorePendingClipboard}
                    disabled={pendingClipboardDecisionStillBlocking}
                  >
                    {pendingClipboardCopy.ignoreLabel}
                  </button>
                </span>
              </section>
            </div>
          )}

          {Array.isArray(runtimeAlertMessages) && runtimeAlertMessages.length > 0 && (
            <div
              className="app-runtime-alert foreground-runtime-alert"
              role={panelOwnsClipboardResidueRisk ? 'note' : 'alert'}
              aria-live={panelOwnsClipboardResidueRisk ? undefined : 'assertive'}
            >
              <strong>部分后台功能没有启动</strong>
              <span>{runtimeAlertMessages.join(' ')}</span>
            </div>
          )}

          {shortcutReadinessCopy && (
            <div className="shortcut-readiness-region">
              <section
                className="shortcut-readiness-alert"
                role={panelOwnsClipboardResidueRisk ? 'note' : 'alert'}
                aria-labelledby="shortcut-readiness-title"
                aria-describedby="shortcut-readiness-detail"
              >
                <WarningCircle size={19} weight="fill" aria-hidden="true" />
                <span>
                  <strong id="shortcut-readiness-title">{shortcutReadinessCopy.title}</strong>
                  <small id="shortcut-readiness-detail">{shortcutReadinessCopy.detail}</small>
                </span>
                <button type="button" onClick={handleOpenShortcutSettings}>修改快捷键</button>
              </section>
            </div>
          )}

          {settings.clipboardMonitoring && (
            <div className="clipboard-monitoring-live-region">
              <div
                className={`clipboard-monitoring-live is-${clipboardMonitoringCopy.kind}${clipboardMonitoringStopError ? ' is-error' : ''}`}
                role={clipboardMonitoringStopError ? 'alert' : 'status'}
                aria-live={panelOwnsClipboardResidueRisk
                  ? 'off'
                  : clipboardMonitoringStopError ? 'assertive' : 'polite'}
              >
                {clipboardMonitoringCopy.kind === 'local'
                  ? <ShieldCheck size={19} weight="fill" aria-hidden="true" />
                  : <CloudArrowUp size={19} weight="fill" aria-hidden="true" />}
                <span
                  ref={clipboardMonitoringStatusRef}
                  className="clipboard-monitoring-live__body"
                  tabIndex={-1}
                >
                  <strong>{clipboardMonitoringCopy.activeTitle}</strong>
                  <small>
                    {clipboardMonitoringStopError
                      || `${clipboardMonitoringCopy.activeDetail} 关闭只影响今后复制；已经开始的任务仍会继续。`}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={handleStopClipboardMonitoring}
                  disabled={clipboardMonitoringStopStatus === 'stopping' || settingsController.settingsSaving}
                  aria-busy={clipboardMonitoringStopStatus === 'stopping'}
                >
                  {clipboardMonitoringStopStatus === 'stopping'
                    ? '正在关闭…'
                    : clipboardMonitoringStopError ? '重试关闭' : '关闭自动检测'}
                </button>
              </div>
            </div>
          )}

          {!settings.clipboardMonitoring && clipboardMonitoringOffNotice && (
            <div className="clipboard-monitoring-live-region">
              <div className="clipboard-monitoring-stopped" role="status">
                <ShieldCheck size={18} weight="fill" aria-hidden="true" />
                <span ref={clipboardMonitoringStatusRef} tabIndex={-1}>{clipboardMonitoringOffNotice}</span>
                <button type="button" onClick={() => setClipboardMonitoringOffNotice('')} aria-label="关闭自动检测已关闭提示">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <span className="clipboard-monitor-queue-announcer" role="status" aria-live="polite">
        {clipboardQueueAnnouncement}
      </span>

      {processingSettingsGuardOpen && (
        <div
          className="processing-settings-guard-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleDismissProcessingSettingsGuard();
          }}
        >
          <section
            ref={processingSettingsGuardRef}
            className="processing-settings-guard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="processing-settings-guard-title"
            aria-describedby="processing-settings-guard-detail"
            tabIndex={-1}
          >
            <header>
              <span className="processing-settings-guard__icon" aria-hidden="true">
                <GearSix size={22} weight="fill" />
              </span>
              <div>
                <p className="eyebrow">
                  {processingSettingsGuardSettledCopy?.eyebrow || '当前任务仍在进行'}
                </p>
                <h2 id="processing-settings-guard-title">
                  {processingSettingsGuardSettledCopy?.title || '先停止，再更改处理设置'}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={handleDismissProcessingSettingsGuard}
                aria-label={processingSettingsGuardSettledCopy?.closeLabel
                  || '关闭设置提示并继续当前任务'}
              >
                <X size={19} />
              </button>
            </header>
            <p id="processing-settings-guard-detail">
              {processingSettingsGuardSettledCopy?.detail
                || (isVerifying || isCancellingVerification
                ? '已批准的官方来源请求可能已经发出。为避免丢失核验收据，需要等待任务停止或完成，再打开设置。'
                : processingSettingsGuardMessage(
                  capturePrivacyDisclosure.location,
                  Boolean(lastGoodRef.current),
                ))}
            </p>
            <div className="processing-settings-guard__outcome" role="note">
              <ShieldCheck size={18} weight="fill" aria-hidden="true" />
              <span>
                <strong>
                  {processingSettingsGuardSettledCopy?.outcomeTitle
                    || '不会直接切换或丢弃当前任务'}
                </strong>
                <small>
                  {processingSettingsGuardSettledCopy?.outcomeDetail
                    || '只有应用确认停止后才会打开设置；若任务先完成，会先保留并显示结果。'}
                </small>
              </span>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                data-settings-guard-focus
                onClick={handleDismissProcessingSettingsGuard}
              >
                {processingSettingsGuardSettledCopy?.continueLabel
                  || (isVerifying || isCancellingVerification ? '继续等待核验' : '继续当前任务')}
              </button>
              <button type="button" className="primary-button" onClick={handleStopAndOpenSettings}>
                {processingSettingsGuardSettledCopy
                  ? '打开设置'
                  : isVerifying || isCancellingVerification
                    ? '停止核验后打开设置'
                    : '停止任务后打开设置'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {isDone && resultOrderSaveError && (
        <div className="result-order-save-error" role="alert">
          <WarningCircle size={19} weight="fill" />
          <span>
            <strong>显示顺序没有保存</strong>
            <small>
              没有保存“{resultOrderLabel(resultOrderSaveError.requested)}”；当前仍按“{resultOrderLabel(resultOrderSaveError.current)}”显示。
            </small>
          </span>
          <button
            type="button"
            onClick={() => handleResultOrderChange(resultOrderSaveError.requested)}
            disabled={isSavingResultOrder}
            aria-busy={isSavingResultOrder}
          >
            {isSavingResultOrder ? '正在重新保存…' : `重试保存${resultOrderLabel(resultOrderSaveError.requested)}`}
          </button>
          <button
            type="button"
            className="result-order-save-error__dismiss"
            onClick={() => setResultOrderSaveError(null)}
            aria-label="关闭显示顺序保存错误"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {!isDone && [
        'copying',
        'copied',
        'outdated',
        'retained',
        'copy-error',
        'acknowledged',
      ]
        .includes(clipboardNotice.status) && (
        <ClipboardActionNotice
          notice={clipboardNotice}
          onAcknowledge={handleAcknowledgeClipboardConsequence}
          onDismiss={() => setClipboardNotice((current) => dismissClipboardNotice(current))}
        />
      )}

      {clearedSession && (
        <div ref={clearUndoRegionRef} className="session-clear-undo" role="status" aria-live="polite">
          <span>
            <strong>{clearedSession.kind === 'result' ? '上一份原文和结果已清空' : '输入内容已清空'}</strong>
            <small aria-hidden="true">
              {Number.isFinite(clearedSession.remainingMs)
                ? `仅在内存保留 · 撤销倒计时已暂停（剩余 ${clearedSessionSecondsRemaining} 秒）· 先决定是否替换。`
                : `仅在内存保留 · 还可撤销 ${clearedSessionSecondsRemaining} 秒 · 不会写入历史记录。`}
            </small>
            <span className="session-clear-undo__a11y">
              {Number.isFinite(clearedSession.remainingMs)
                ? `内容仅在内存保留；撤销倒计时已暂停，剩余 ${clearedSessionSecondsRemaining} 秒。选择保留后会继续倒计时。`
                : '内容仅在内存保留 10 秒，不会写入历史记录。'}
            </span>
          </span>
          <button
            ref={clearUndoButtonRef}
            type="button"
            onClick={handleUndoClear}
            disabled={manualClipboardReadPending}
          >
            <ArrowCounterClockwise size={16} weight="bold" />撤销清空
          </button>
          <button
            type="button"
            className="session-clear-undo__dismiss"
            onClick={() => discardClearedSession({ restoreFocus: true })}
            aria-label="关闭撤销提示"
            disabled={manualClipboardReadPending}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {isDone ? (
        <LazyWorkspaceBoundary
          key={`result-workspace-${resultWorkspace.attempt}`}
          fallback={(
            <ResultWorkspaceRecovery
              onRetry={resetResultWorkspace}
              onReviewSource={handleReviewSourceFromResultFailure}
              retryAvailable={resultDisplayImport.canRetry()}
              reviewSourceLabel={hasFailedAttemptEditDraft
                ? '检查刚才的原文'
                : '返回修正原文'}
            />
          )}
        >
          <React.Suspense fallback={<ResultWorkspaceFallback />}>
            <ResultDisplay
            active={visible}
            brief={brief}
            result={result}
            sourceText={processedSourceText || inputText}
            sourceLabel={sourceDescriptor}
            captureConfidence={captureMeta.confidence}
            warning={warning}
            warningRecovery={processingRecovery}
            failedProcessingAttemptAvailable={Boolean(failedProcessingAttempt)}
            onReviewFailedProcessingAttempt={handleReviewFailedProcessingAttempt}
            processingTimeMs={processingTimeMs}
            verificationTimeMs={verificationTimeMs}
            processingPrivacyDisclosure={privacyDisclosure}
            preference={preference}
            verificationPolicy={settings.verificationPolicy || 'ask'}
            isVerifying={isVerifying}
            isCancellingVerification={isCancellingVerification}
            onVerifyOfficialSources={verificationApprovalId ? verifyOfficialSources : null}
            onCancelVerification={cancelOfficialVerification}
            onOpenExternal={(url) => invoke(IPC_CHANNELS.EXTERNAL_OPEN, url)}
            screenRecordingPermissionDenied={isScreenshotPermissionError}
            onOpenScreenRecordingSettings={handleOpenScreenRecordingSettings}
            onConfigureAnalysis={handleConfigureFullAnalysis}
            onConfigureRecovery={handleOpenProcessingRecovery}
            onRetry={setupIncomplete
              ? handleConfigureFullAnalysis
              : handleRetryProcessing}
            retryLabel={setupIncomplete
              ? '继续配置完整分析'
              : failedProcessingAttempt
                ? hasFailedAttemptEditDraft ? '重试修正后的原文' : '重试刚才的原文'
              : isTranslationOnly && !isFreeTranslate
                ? '用完整分析重新处理'
                : undefined}
            onEditSource={hasFailedAttemptEditDraft
              ? handleReviewFailedProcessingAttempt
              : handleEditSource}
            hasSourceEditDraft={hasSourceEditDraft}
            onRecapture={handleScreenshot}
            onNewCapture={handleClear}
            newCaptureButtonRef={resultReturnButtonRef}
            onSaveTerm={handleSaveTerm}
            savedTerms={savedTerms}
            savedTermsLoadStatus={savedTermsLoadStatus}
            savedTermsLoadErrorCode={savedTermsLoadErrorCode}
            completedActionIds={completedActionIds}
            onToggleActionCompletion={handleToggleActionCompletion}
            onWriteClipboard={handleWriteClipboard}
            onCopyReply={handleCopyReply}
            onAcknowledgeClipboardConsequence={onAcknowledgeClipboardConsequence}
            clipboardNotice={clipboardNotice}
            onClipboardNoticeChange={setClipboardNotice}
            replyDialogOpen={replyDialogOpen}
            replyFocusRequest={replyFocusRequest}
            replyCaptureNotice={replyCaptureNotice}
            replyCapturePending={replyCapturePending}
            onReplyDialogOpenChange={handleReplyDialogOpenChange}
            replyDraftState={replyDraftState}
            onReplyDraftStateChange={handleReplyDraftStateChange}
            replyCopyPending={replyCopyPending}
              clipboardWritePending={clipboardOperationPending}
            />
          </React.Suspense>
        </LazyWorkspaceBoundary>
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
            <LoadingOverlay
              visible
              contextRef={processingContextRef}
              sourceSummary={processingSourceSummary}
              onCancel={() => handleCancelProcessing()}
              privacyDisclosure={capturePrivacyDisclosure}
              returnsToPreviousResult={Boolean(lastGoodRef.current)}
              isCancelling={isCancellingProcessing}
              cancelError={processingCancelError}
              opensSettingsAfterCancel={settingsOpenIntent === 'analysis'}
              translationOnly={isFreeTranslate}
              phase={processingPhase}
            />
          ) : (
            <section className="capture-card">
              <div className="capture-heading">
                <span className="capture-heading__icon">
                  {isEditingSource
                    ? <PencilSimpleLine size={24} weight="fill" />
                    : <FileText size={24} weight="fill" />}
                </span>
                <div>
                  <p className="eyebrow">{isEditingSource ? '修正原文' : '捕获英文'}</p>
                  <h1>{isEditingSource
                    ? '核对并修正识别文本'
                    : isFreeTranslate ? '快速翻译完整原文' : '在当前工作流里，直接看懂并行动'}</h1>
                  <p>{isEditingSource
                    ? '上一份结果仍在内存保留；只有修正后的原文生成成功，才会替换它。'
                    : isFreeTranslate
                      ? '在线基础翻译会发送原文，只按顺序返回翻译，不生成行动路径、术语解释或官方核验。'
                      : '保留完整原文，把翻译、术语和行动结论逐条连回证据。'}</p>
                </div>
              </div>

              {!inputText.trim() && !isEditingSource && !isFreeTranslate && (
                <ol className="capture-start-steps" aria-label="第一次使用步骤">
                  <li>放入一段完整英文</li>
                  <li>确认下方发送位置</li>
                  <li>生成后点彩色原文核对依据</li>
                </ol>
              )}

              {error && (
                <div
                  id="processing-error-card"
                  className={`error-card${isScreenshotPermissionError ? ' is-permission-recovery' : ''}`}
                  role="alert"
                  tabIndex={-1}
                >
                  <WarningCircle size={22} weight="fill" />
                  <div>
                    <strong>{isScreenshotPermissionError ? '需要允许屏幕录制' : '这次没有处理成功'}</strong>
                    <p>{error}</p>
                    {isScreenshotPermissionError && (
                      <ol className="permission-recovery-steps">
                        <li>打开系统设置，并在“屏幕录制”中允许 Slipstream。</li>
                        <li>若 macOS 要求退出并重新打开应用，请按提示完成。</li>
                        <li>回到 Slipstream，再次框选需要识别的文字。</li>
                      </ol>
                    )}
                  </div>
                  <div className="error-card__actions">
                    {isScreenshotPermissionError ? (
                      <>
                        <button ref={permissionRecoveryButtonRef} type="button" className="error-card__primary" onClick={handleOpenScreenRecordingSettings}>
                          <ArrowSquareOut size={14} />打开屏幕录制设置
                        </button>
                        <button type="button" onClick={handleScreenshot}>返回后重新截图</button>
                      </>
                    ) : (
                      <>
                        {processingRecovery?.priority === 'configure' && (
                          <button type="button" className="error-card__primary" onClick={handleOpenProcessingRecovery}>
                            {processingRecovery.actionLabel}
                          </button>
                        )}
                        {inputText.trim() && (
                          <button
                            type="button"
                            className={processingRecovery?.priority === 'retry' ? 'error-card__primary' : undefined}
                            onClick={() => {
                              if (ocrReview) void handleConfirmOcrReview();
                              else triggerProcessing();
                            }}
                          >
                            {ocrReview ? '重新核对并继续' : '重试'}
                          </button>
                        )}
                        {processingRecovery?.priority !== 'configure' && (
                          <button type="button" onClick={handleOpenProcessingRecovery}>
                            {processingRecovery?.actionLabel || '检查设置'}
                          </button>
                        )}
                        <button type="button" onClick={handleScreenshot}>重新截图</button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {ocrReviewCopy && (
                <section
                  className="ocr-review-notice"
                  role="region"
                  aria-labelledby="ocr-review-title"
                  aria-describedby="ocr-review-detail ocr-review-destination"
                >
                  <div className="ocr-review-notice__heading">
                    <span className="ocr-review-notice__icon" aria-hidden="true">
                      <WarningCircle size={21} weight="fill" />
                    </span>
                    <span>
                      <small>发送前复核</small>
                      <h2 id="ocr-review-title" ref={ocrReviewHeadingRef} tabIndex={-1}>
                        {ocrReviewCopy.title}
                      </h2>
                    </span>
                  </div>
                  <p id="ocr-review-detail">{ocrReviewCopy.detail}</p>
                  <p className="ocr-review-notice__guidance">{ocrReviewCopy.guidance}</p>
                  <p id="ocr-review-destination" className="ocr-review-notice__destination">
                    {privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL
                      ? <ShieldCheck size={17} weight="fill" aria-hidden="true" />
                      : privacyProcessingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK
                        ? <HardDrives size={17} weight="fill" aria-hidden="true" />
                        : <CloudArrowUp size={17} weight="fill" aria-hidden="true" />}
                    <span>
                      <strong>原文尚未交给处理服务</strong>
                      <small>{ocrReviewDestination}</small>
                    </span>
                  </p>
                </section>
              )}

              <label className="capture-input">
                <span className="capture-input__label-row">
                  <span>原文</span>
                  {inputText && (
                    <small className={sourceLimitState.blocked ? 'is-over-limit' : ''} aria-hidden="true">
                      {sourceLimitState.countLabel}
                    </small>
                  )}
                </span>
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(event) => {
                    const { revokedPending } = revokeDelayedCaptureDispatch({
                      sourceReplaced: true,
                    });
                    discardClearedSession();
                    const nextText = event.target.value;
                    const dismissedOcrReview = Boolean(ocrReview);
                    setOcrReview(null);
                    setIsConfirmingOcrReview(false);
                    setInputText(nextText);
                    setSourceLimitActionNotice('');
                    if (isEditingSource) {
                      setSourceEditDraft((current) => updateSourceEditDraft(
                        current,
                        nextText,
                        processedSourceText || inputText,
                      ));
                    }
                    setSourceType('manual');
                    setCaptureMeta({ confidence: null, blocks: [] });
                    setSourceMeta({
                      truncated: false,
                      originalLength: nextText.length,
                    });
                    setWarning((current) => (
                      dismissedOcrReview
                        || revokedPending
                        || current === EDITED_SOURCE_MANUAL_SUBMIT_WARNING
                        ? EDITED_SOURCE_MANUAL_SUBMIT_WARNING
                        : ''
                    ));
                    setCaptureErrorCode(null);
                    setProcessingErrorCode(null);
                    setError(null);
                    if (status === STATUS.ERROR) setStatus(STATUS.IDLE);
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      if (ocrReview) void handleConfirmOcrReview();
                      else triggerProcessing();
                    }
                  }}
                  placeholder={capturePlaceholder}
                  aria-label="要解释的完整原文"
                  aria-describedby={sourceDescriptionIds}
                  lang={inputText.trim() ? inferTextLanguageTag(inputText) : undefined}
                />
                {inputText && (
                  <button
                    type="button"
                    className="capture-input__clear"
                    onClick={handleClear}
                    disabled={manualClipboardReadPending}
                  >
                    清空
                  </button>
                )}
              </label>

              {ocrReviewCopy && (
                <div className="ocr-review-actions" aria-label="截图文字复核操作">
                  <button
                    type="button"
                    className="ocr-review-actions__confirm"
                    onClick={() => void handleConfirmOcrReview()}
                    disabled={isConfirmingOcrReview || !inputText.trim() || isSourceTooLong || setupIncomplete}
                  >
                    {isConfirmingOcrReview
                      ? <CircleNotch size={18} className="spin" aria-hidden="true" />
                      : <ShieldCheck size={18} weight="fill" aria-hidden="true" />}
                    {isConfirmingOcrReview ? '正在本机确认…' : ocrReviewActionLabel}
                  </button>
                  <button
                    type="button"
                    className="ocr-review-actions__recapture"
                    onClick={handleScreenshot}
                    disabled={isConfirmingOcrReview}
                  >
                    <Camera size={18} aria-hidden="true" />
                    重新截图
                  </button>
                </div>
              )}

              {sourceLimitState.blocked && (
                <div id="source-limit-message" className="source-limit-message" role="alert">
                  <WarningCircle size={19} weight="fill" aria-hidden="true" />
                  <span>
                    <strong>{sourceLimitState.title}</strong>
                    <small>{sourceLimitState.detail}</small>
                  </span>
                  <button type="button" onClick={handleSourceLimitRecovery}>
                    {sourceLimitState.recovery === 'recapture'
                      ? '重新框选较小区域'
                      : sourceLimitState.recovery === 'manual-paste'
                        ? '选择当前前缀并手动粘贴全文'
                        : '定位超出部分'}
                  </button>
                </div>
              )}

              {sourceLimitActionNotice && (
                <p id="source-limit-action-status" className="source-limit-action-status" role="status" aria-live="polite">
                  <ShieldCheck size={17} weight="fill" aria-hidden="true" />
                  {sourceLimitActionNotice}
                </p>
              )}

              {!inputText.trim() && (
                <div className="capture-sample" role="note">
                  <span className="capture-sample__icon"><FileText size={19} /></span>
                  <span>
                    <strong>先用安全示例体验</strong>
                    <small>载入一封虚构英文邮件先看看效果；不会读取剪贴板，也不会自动处理。</small>
                  </span>
                  <button type="button" onClick={handleLoadExample}>载入安全示例（不会生成）</button>
                </div>
              )}

              {sourceType === 'sample' && inputText.trim() && (
                <p className="capture-sample-loaded" role="status" aria-live="polite">
                  <ShieldCheck size={16} weight="fill" />
                  虚构示例已载入，不包含你的数据。你可以先阅读或修改；只有点击生成才会开始处理。
                </p>
              )}

              {warning && (
                <p className="capture-warning" role="status" aria-live="polite" aria-atomic="true">
                  <WarningCircle size={17} />
                  {warning}
                </p>
              )}

              {isEditingSource && (
                <p className="capture-edit-status" role="status">
                  <ShieldCheck size={17} weight="fill" />
                  生成失败也不会丢失上一份结果或这次修改，你可以回来继续修正。
                </p>
              )}

              {setupIncomplete && (
                <div className="setup-incomplete-notice" role="alert">
                  <WarningCircle size={19} weight="fill" aria-hidden="true" />
                  <span>
                    <strong>完整分析配置尚未完成</strong>
                    <small>原文已保留。完成服务与模型验证前，不会发送或生成新的分析结果。</small>
                  </span>
                  <button type="button" onClick={handleConfigureFullAnalysis}>继续配置</button>
                </div>
              )}

              {!ocrReviewCopy && (
                <div className="capture-methods">
                  <button type="button" onClick={handleScreenshot}>
                    <span><Camera size={23} /></span>
                    <strong>框选截图</strong>
                    <small>按 {displayShortcutAccelerator(settings.screenshotShortcut || DEFAULTS.SCREENSHOT_SHORTCUT)} · 本地 OCR</small>
                  </button>
                  <button
                    ref={clipboardReadButtonRef}
                    type="button"
                    onClick={handlePaste}
                    disabled={isReadingClipboard || manualClipboardReadPending}
                    aria-busy={isReadingClipboard}
                  >
                    <span>
                      {isReadingClipboard
                        ? <CircleNotch size={23} className="spin" aria-hidden="true" />
                        : <ClipboardText size={23} />}
                    </span>
                    <strong>{isReadingClipboard ? '正在读取剪贴板…' : '读取剪贴板'}</strong>
                    <small>
                      {manualClipboardReadPending
                        ? '先选择替换或保留当前原文'
                        : `复制后按 ${displayShortcutAccelerator(settings.clipboardShortcut || DEFAULTS.CLIPBOARD_SHORTCUT)}`}
                    </small>
                  </button>
                </div>
              )}

              {!ocrReviewCopy && (
                <p className="capture-permission-note" role="note">
                  <ShieldCheck size={16} weight="fill" aria-hidden="true" />
                  <span>首次框选截图时，macOS 可能请求屏幕录制权限；截图和 OCR 都在本机进行。直接粘贴或读取剪贴板无需此权限。</span>
                </p>
              )}

              <div
                className={`processing-privacy-disclosure processing-privacy-disclosure--${capturePrivacyDisclosure.location}`}
                role="note"
                aria-live="polite"
                aria-label="提交前的处理位置"
              >
                {capturePrivacyDisclosure.location === 'local'
                  ? <ShieldCheck size={20} weight="fill" />
                  : capturePrivacyDisclosure.location === 'local-loopback'
                    ? <HardDrives size={20} weight="fill" />
                    : <CloudArrowUp size={20} weight="fill" />}
                <span>
                  <strong>{capturePrivacyDisclosure.title}</strong>
                  <small>{capturePrivacyDisclosure.detail}</small>
                </span>
                <button type="button" onClick={handleOpenSettingsRequest}>更改处理方式</button>
              </div>

              {!ocrReviewCopy && (
                <button
                  type="button"
                  className="process-button"
                  onClick={() => triggerProcessing()}
                  disabled={
                    !inputText.trim()
                    || isSourceTooLong
                    || setupIncomplete
                    || manualClipboardReadPending
                  }
                >
                  {isEditingSource
                    ? isFreeTranslate ? '用修正原文重新翻译' : '用修正原文重新生成'
                    : isFreeTranslate ? '生成完整翻译' : '生成可追溯解释'}
                  <ArrowRight size={19} />
                </button>
              )}

              {isEditingSource && (
                <button
                  type="button"
                  className="capture-return-result"
                  onClick={handleReturnToResult}
                  disabled={manualClipboardReadPending}
                >
                  <ArrowCounterClockwise size={17} />先返回上一份结果
                </button>
              )}

              <div className="shortcut-help">
                <span><kbd>{displayShortcutAccelerator(settings.screenshotShortcut || DEFAULTS.SCREENSHOT_SHORTCUT)}</kbd> 截图</span>
                <span><kbd>Command</kbd><kbd>Enter</kbd> {ocrReviewCopy ? '核对并继续' : '处理'}</span>
              </div>
            </section>
          )}

          <footer className="capture-footer">
            {capturePrivacyDisclosure.location === 'local'
              ? <ShieldCheck size={17} />
              : capturePrivacyDisclosure.location === 'local-loopback'
                ? <HardDrives size={17} />
                : <CloudArrowUp size={17} />}
            <span>{capturePrivacyDisclosure.footer}</span>
          </footer>
        </main>
      )}

      {savedTermsWorkspaceMounted && (
        <LazyWorkspaceBoundary
          key={`saved-terms-workspace-${savedTermsWorkspace.attempt}`}
          fallback={(
            <SavedTermsWorkspaceRecovery
              open={savedTermsDrawerOpen}
              openStateRef={savedTermsDrawerOpenRef}
              triggerRef={savedTermsTriggerRef}
              onRetry={resetSavedTermsWorkspace}
              onClose={closeSavedTerms}
              retryAvailable={savedTermsLibraryImport.canRetry()}
            />
          )}
        >
          <React.Suspense
            fallback={(
              <SavedTermsWorkspaceFallback
                open={savedTermsDrawerOpen}
                openStateRef={savedTermsDrawerOpenRef}
                triggerRef={savedTermsTriggerRef}
                onClose={closeSavedTerms}
              />
            )}
          >
            <SavedTermsLibrary
              key={`saved-terms-session-${savedTermsSessionGeneration}`}
              open={savedTermsDrawerOpen}
              openStateRef={savedTermsDrawerOpenRef}
              onClose={closeSavedTerms}
              triggerRef={savedTermsTriggerRef}
              savedTerms={savedTerms}
              loadStatus={savedTermsLoadStatus}
              loadError={savedTermsLoadError}
              loadErrorCode={savedTermsLoadErrorCode}
              onRetryLoad={retrySavedTermsLoad}
              onDeleteTerm={handleDeleteTerm}
              onRestoreTerm={handleRestoreTerm}
              onExportTerms={handleExportTerms}
              onPreviewImport={handlePreviewTermImport}
              onCommitImport={handleCommitTermImport}
              clipboardNotice={clipboardNotice}
              clipboardWritePending={clipboardOperationPending}
              onWriteClipboard={(kind, text) => handleWriteClipboard(text, { kind })}
              onAcknowledgeClipboardConsequence={handleAcknowledgeClipboardConsequence}
              onDismissClipboardNotice={() => {
                setClipboardNotice((current) => dismissClipboardNotice(current));
              }}
            />
          </React.Suspense>
        </LazyWorkspaceBoundary>
      )}
    </div>
  );
}
