import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  BookOpen,
  CalendarBlank,
  Camera,
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  CloudArrowUp,
  Copy,
  FileText,
  HardDrives,
  ListChecks,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimpleLine,
  SealCheck,
  ShieldCheck,
  WarningCircle,
  X,
} from '../phosphorIcons';
import { PROCESSING_STAGES } from './LoadingOverlay';
import {
  EVIDENCE_COLORS,
  buildReplyDraft,
  buildActionGroups,
  buildEvidenceCatalog,
  catalogEntriesFor,
  composeReplyDraft,
  composeActionChecklistText,
  composeCompleteResultText,
  getActionCompletionState,
  getEvidenceNavigationAnnouncement,
  getEvidenceResultRoute,
  getHeadline,
  getReplyDraftPlaceholders,
  getReplyProgressConsistency,
  hasExactGrounding,
  isTranslationOnlyBrief,
  selectPrimaryDeadline,
  shouldOfferReply,
} from '../utils/evidenceMapping.mjs';
import { formatResultTiming } from '../utils/resultTiming.mjs';
import {
  describeDeadlineUrgency,
  millisecondsUntilNextLocalDay,
} from '../utils/deadlineUrgency.mjs';
import { hasSavedTerm } from '../utils/savedTerms.mjs';
import {
  createEmptyReplyDraftState,
  createReplyModelIdentity,
  sanitizeReplyDraftState,
} from '../utils/replyDraftState.mjs';
import {
  createClipboardCopyFailureNotice,
  dismissClipboardNotice,
  markCopiedClipboardNoticeOutdated,
} from '../utils/clipboardNotice.mjs';
import {
  createSourceOpenFailureNotice,
  createSourceOpenPendingNotice,
  createSourceOpenSuccessNotice,
} from '../utils/sourceActionNotice.mjs';
import { preferredScrollBehavior } from '../utils/motionPreference.mjs?workspace=result';
import {
  getActionBriefSourceLanguageTag,
  getContentLanguageTag,
  inferTextLanguageTag,
} from '../utils/languageBoundary.mjs';
import ClipboardActionNotice from './ClipboardActionNotice';
import resultDisplayStylesheetUrl from './ResultDisplay.css?url&no-inline';
import {
  getResultStylesheetAttempt,
  loadResultWorkspaceStylesheet,
} from './resultWorkspaceStylesheet.mjs';

const resultDisplayModuleUrl = new URL(import.meta.url);
const resultDisplayStylesheetHref = new URL(resultDisplayStylesheetUrl, document.baseURI);
if (
  import.meta.env.DEV
  && resultDisplayModuleUrl.searchParams.get('workspace-load')
    === 'result-style-fixture-primary'
) {
  resultDisplayStylesheetHref.searchParams.set(
    'workspace-load',
    'result-style-fixture-primary',
  );
}
export const resultWorkspaceStylesheetReady = loadResultWorkspaceStylesheet({
  attempt: getResultStylesheetAttempt(import.meta.url),
  href: resultDisplayStylesheetHref.href,
});

const TERM_KIND_LABELS = {
  proper_noun: '名称 / 专有名词',
  abbreviation: '缩写',
  specialist_term: '专业术语',
  general_term: '普通词语',
  institution: '机构名称',
  course: '课程名称',
  policy: '政策名称',
  form: '表格',
  portal: '系统 / 入口',
  other: '其他词语',
};

const VERIFICATION_LABELS = {
  pending: '待核验',
  retrieved: '已找到官方页面，结论仍需确认',
  verified: '已核验',
  failed: '核验失败',
  not_needed: '无需核验',
};

const MATERIAL_REQUIREMENT_LABELS = {
  required: '必需',
  conditional: '按条件提供',
  recommended: '建议提供',
  unknown: '要求未明确',
};

const REPLY_FACT_LABELS = {
  material: '对方要求的材料',
  action: '对方要求的操作',
  deadline: '截止日期',
  reply: '回复要求',
};

const TRANSLATION_PROCESSING_STAGES = [
  { label: '读取完整原文', detail: '保留段落、日期与信息顺序', Icon: BookOpen },
  { label: '生成完整翻译', detail: '本次没有生成行动、材料或证据映射', Icon: FileText },
];

function parseLegacyResult(result, sourceText) {
  const lines = String(result || '').split('\n');
  const firstHeading = lines.findIndex((line) => /^\s*(?:#{1,6}\s*)?\*{0,2}1[.、:：]/.test(line));
  const secondHeading = lines.findIndex((line) => /^\s*(?:#{1,6}\s*)?\*{0,2}2[.、:：]/.test(line));
  const translationStart = firstHeading >= 0 ? firstHeading + 1 : 0;
  const translationEnd = secondHeading >= 0 ? secondHeading : lines.length;
  const translationText = lines.slice(translationStart, translationEnd).join('\n').trim() || String(result || '').trim();
  const termLines = secondHeading >= 0 ? lines.slice(secondHeading + 1) : [];
  const terms = termLines
    .map((line, index) => {
      const cleaned = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (!cleaned || /^(无|none)[。.]?$/i.test(cleaned)) return null;
      const parts = cleaned.split(/\s*(?:[:：]|\s[-—]\s)\s*/);
      const surface = parts.shift()?.replace(/\*\*/g, '').trim();
      if (!surface) return null;
      return {
        id: `legacy-term-${index}`,
        surface,
        kind: 'other',
        explanation: parts.join('：') || '模型未提供单独解释。',
        provenance: { kind: 'pending', confidence: null, note: '旧版文本结果未提供精确证据位置。', evidence: [], citations: [] },
      };
    })
    .filter(Boolean);

  return {
    schemaVersion: 'legacy-text',
    status: 'translation_only',
    source: { length: sourceText.length, language: 'unknown' },
    targetLanguage: 'zh',
    translation: translationText
      ? { text: translationText, provenance: { kind: 'pending', confidence: null, note: '旧版文本结果', evidence: [], citations: [] } }
      : null,
    explanation: null,
    terms,
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    warnings: [],
    analysisProvenance: { responseKind: 'legacy-text' },
  };
}

function normalizeBrief(brief, result, sourceText) {
  const base = brief && typeof brief === 'object' ? brief : parseLegacyResult(result, sourceText);
  return {
    ...base,
    terms: Array.isArray(base.terms) ? base.terms : [],
    contexts: Array.isArray(base.contexts) ? base.contexts : [],
    deadlines: Array.isArray(base.deadlines) ? base.deadlines : [],
    materials: Array.isArray(base.materials) ? base.materials : [],
    nextSteps: Array.isArray(base.nextSteps) ? base.nextSteps : [],
    verifications: Array.isArray(base.verifications) ? base.verifications : [],
    warnings: Array.isArray(base.warnings) ? base.warnings : [],
  };
}

function getAllContentItems(brief) {
  return [brief.translation, brief.explanation]
    .concat(brief.terms, brief.contexts, brief.deadlines, brief.materials, brief.nextSteps, brief.verifications)
    .filter(Boolean);
}

function collectCitations(brief) {
  const citations = getAllContentItems(brief).flatMap((item) => item?.provenance?.citations || []);
  return [...new Map(citations.map((citation) => [citation.id || citation.url, citation])).values()];
}

function collectRetrievalReceipts(brief) {
  const receipts = brief.verifications.flatMap((verification) => (
    Array.isArray(verification.retrievals)
      ? verification.retrievals.map((receipt) => ({
        ...receipt,
        claim: verification.claim,
        verificationStatus: verification.status,
      }))
      : []
  )).map((receipt) => {
    try {
      const parsed = new URL(receipt.url);
      if (parsed.protocol !== 'https:') return null;
      return { ...receipt, url: parsed.href, host: parsed.hostname };
    } catch {
      return null;
    }
  }).filter(Boolean);
  return [...new Map(receipts
    .map((receipt) => [`${receipt.url}:${receipt.retrievedAt || ''}`, receipt])).values()];
}

function collectVerificationTargets(brief) {
  const targets = brief.verifications
    .filter((item) => ['pending', 'retrieved', 'failed'].includes(item.status))
    .flatMap((item) => (Array.isArray(item.lookup?.candidateUrls) ? item.lookup.candidateUrls : []))
    .map((url) => {
      try {
        const parsed = new URL(url);
        return {
          url: parsed.href,
          host: parsed.hostname,
          page: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/',
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return [...new Map(targets.map((target) => [target.url, target])).values()];
}

function normalizeGovUkPublisher(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
  return ['gov uk', 'uk government'].includes(normalized) ? 'GOV.UK' : null;
}

function collectGovUkDiscoveryPlans(brief) {
  const plans = brief.verifications
    .filter((item) => ['pending', 'retrieved', 'failed'].includes(item.status))
    .map((item) => {
      const candidateUrls = Array.isArray(item.lookup?.candidateUrls) ? item.lookup.candidateUrls : [];
      const publisher = normalizeGovUkPublisher(item.lookup?.publisher);
      const query = typeof item.lookup?.query === 'string' ? item.lookup.query.trim() : '';
      if (candidateUrls.length > 0 || !publisher || !query) return null;
      return { publisher, query };
    })
    .filter(Boolean);
  return [...new Map(plans.map((plan) => [`${plan.publisher}:${plan.query}`, plan])).values()];
}

function getContextSections(context) {
  const sections = [
    ['这是什么', context?.whatItIs],
    ['为什么要做', context?.whyItMatters],
    ['你该怎么做', context?.whatToDo],
  ].filter(([, value]) => typeof value === 'string' && value.trim());
  return sections.map(([label, value]) => ({ label, value: value.trim() }));
}

function isClipboardWritePendingError(error) {
  return error?.code === 'clipboard-write-pending'
    || error?.message === 'clipboard-write-pending';
}

function Disclosure({ id, title, meta, Icon, open, onToggle, triggerRef, tone = 'neutral', children }) {
  const headingId = `${id}-heading`;
  const titleId = `${id}-title`;
  const metaId = meta ? `${id}-meta` : undefined;
  const panelId = `${id}-panel`;
  return (
    <section className={`disclosure disclosure--${tone}`}>
      <h2 id={headingId} className="disclosure__heading">
        <button
          id={id}
          ref={triggerRef}
          type="button"
          className="disclosure__trigger"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={titleId}
          aria-describedby={metaId}
        >
          <span className="disclosure__title">
            <Icon size={19} weight="regular" aria-hidden="true" />
            <span id={titleId}>{title}</span>
            {meta && <small id={metaId}>{meta}</small>}
          </span>
          {open
            ? <CaretDown size={18} aria-hidden="true" />
            : <CaretRight size={18} aria-hidden="true" />}
        </button>
      </h2>
      <div id={panelId} className="disclosure__content" hidden={!open}>{children}</div>
    </section>
  );
}

function ProvenanceBadge({ kind }) {
  if (kind === 'official') return <span className="provenance provenance--official">官方核验</span>;
  if (kind === 'original') return <span className="provenance provenance--original">原文明示</span>;
  if (kind === 'inference') return <span className="provenance provenance--inference">基于原文推断</span>;
  return <span className="provenance provenance--pending">待核验</span>;
}

export default function ResultDisplay({
  active = true,
  brief,
  result,
  sourceText,
  sourceLabel,
  captureConfidence,
  warning,
  warningRecovery = null,
  failedProcessingAttemptAvailable = false,
  onReviewFailedProcessingAttempt,
  processingTimeMs,
  verificationTimeMs,
  processingPrivacyDisclosure = null,
  preference,
  verificationPolicy,
  isVerifying,
  isCancellingVerification = false,
  onVerifyOfficialSources,
  onCancelVerification,
  onOpenExternal,
  screenRecordingPermissionDenied = false,
  onOpenScreenRecordingSettings,
  onConfigureAnalysis,
  onConfigureRecovery,
  onRetry,
  retryLabel,
  onEditSource,
  hasSourceEditDraft = false,
  onRecapture,
  onNewCapture,
  newCaptureButtonRef,
  onSaveTerm,
  savedTerms,
  savedTermsLoadStatus = 'idle',
  savedTermsLoadErrorCode = '',
  completedActionIds = [],
  onToggleActionCompletion,
  onWriteClipboard,
  onCopyReply,
  onAcknowledgeClipboardConsequence,
  clipboardNotice: controlledClipboardNotice,
  onClipboardNoticeChange,
  replyDialogOpen: controlledReplyDialogOpen,
  replyFocusRequest = 0,
  replyCaptureNotice = '',
  replyCapturePending = false,
  onReplyDialogOpenChange,
  replyDraftState: controlledReplyDraftState = null,
  onReplyDraftStateChange,
  replyCopyPending = false,
  clipboardWritePending = false,
}) {
  const normalizedBrief = useMemo(() => normalizeBrief(brief, result, sourceText), [brief, result, sourceText]);
  const sourceLanguage = normalizedBrief.source?.language;
  const sourceLanguageTag = getActionBriefSourceLanguageTag(sourceLanguage);
  const isTranslationOnly = isTranslationOnlyBrief(normalizedBrief);
  const deadlineSelection = useMemo(
    () => (isTranslationOnly
      ? { deadline: null, totalCount: 0, selectionMode: 'none' }
      : selectPrimaryDeadline(normalizedBrief, sourceText)),
    [isTranslationOnly, normalizedBrief, sourceText],
  );
  const deadline = deadlineSelection.deadline;
  const evidenceCatalog = useMemo(
    () => (isTranslationOnly ? [] : buildEvidenceCatalog(normalizedBrief, sourceText)),
    [isTranslationOnly, normalizedBrief, sourceText],
  );
  const actionGroups = useMemo(
    () => (isTranslationOnly ? [] : buildActionGroups(normalizedBrief, evidenceCatalog)),
    [isTranslationOnly, normalizedBrief, evidenceCatalog],
  );
  const replyDraftModel = useMemo(() => buildReplyDraft(normalizedBrief), [normalizedBrief]);
  const replyDraftModelIdentity = useMemo(
    () => createReplyModelIdentity(replyDraftModel),
    [replyDraftModel],
  );
  const initialReplyDraftState = useMemo(() => (
    sanitizeReplyDraftState(controlledReplyDraftState, {
      expectedModelIdentity: replyDraftModelIdentity,
    }) || createEmptyReplyDraftState(replyDraftModelIdentity)
  ), [controlledReplyDraftState, replyDraftModelIdentity]);
  const actionCompletionState = useMemo(
    () => getActionCompletionState(actionGroups, completedActionIds, replyDraftModel.replyStepId),
    [actionGroups, completedActionIds, replyDraftModel.replyStepId],
  );
  const completedActionIdSet = actionCompletionState.completedActionIdSet;
  const completedActionCount = actionCompletionState.completedCount;
  const allActionsComplete = actionCompletionState.allActionsComplete;
  const replyActionCompleted = actionCompletionState.replyActionCompleted;
  const citations = useMemo(() => collectCitations(normalizedBrief), [normalizedBrief]);
  const retrievalReceipts = useMemo(() => collectRetrievalReceipts(normalizedBrief), [normalizedBrief]);
  const unconfirmedRetrievalReceipts = useMemo(
    () => retrievalReceipts.filter((receipt) => receipt.verificationStatus !== 'verified'),
    [retrievalReceipts],
  );
  const verifiedRetrievalReceipts = useMemo(
    () => retrievalReceipts.filter((receipt) => receipt.verificationStatus === 'verified'),
    [retrievalReceipts],
  );
  const verificationTargets = useMemo(() => collectVerificationTargets(normalizedBrief), [normalizedBrief]);
  const govUkDiscoveryPlans = useMemo(() => collectGovUkDiscoveryPlans(normalizedBrief), [normalizedBrief]);
  const headline = useMemo(() => getHeadline(normalizedBrief, sourceText), [normalizedBrief, sourceText]);
  const completionStages = isTranslationOnly ? TRANSLATION_PROCESSING_STAGES : PROCESSING_STAGES;
  const effectivePreference = isTranslationOnly ? 'translation' : preference;
  const [hoveredEvidence, setHoveredEvidence] = useState(null);
  const [pinnedEvidence, setPinnedEvidence] = useState(null);
  const [selectedTermId, setSelectedTermId] = useState(normalizedBrief.terms[0]?.id || null);
  const [copyState, setCopyState] = useState('idle');
  const [actionCopyState, setActionCopyState] = useState('idle');
  const [termOperation, setTermOperation] = useState({ kind: null, id: null });
  const [termError, setTermError] = useState(null);
  const [termAnnouncement, setTermAnnouncement] = useState('');
  const [showProcess, setShowProcess] = useState(false);
  const [localReplyDialogOpen, setLocalReplyDialogOpen] = useState(false);
  const replyDialogOpen = controlledReplyDialogOpen ?? localReplyDialogOpen;
  const [replyDraft, setReplyDraft] = useState(initialReplyDraftState.draft);
  const [replyCompletionStatus, setReplyCompletionStatus] = useState(
    initialReplyDraftState.completionStatus,
  );
  const [replyProgressOverrideConfirmed, setReplyProgressOverrideConfirmed] = useState(
    initialReplyDraftState.overrideConfirmed,
  );
  const [replySelection, setReplySelection] = useState(initialReplyDraftState.selection);
  const [replyCopyState, setReplyCopyState] = useState('idle');
  const [localClipboardNotice, setLocalClipboardNotice] = useState({ status: 'idle' });
  const [sourceOpenNotice, setSourceOpenNotice] = useState({ status: 'idle' });
  const hasControlledClipboardNotice = controlledClipboardNotice !== undefined;
  const clipboardNotice = hasControlledClipboardNotice ? controlledClipboardNotice : localClipboardNotice;
  const setClipboardNotice = onClipboardNoticeChange || setLocalClipboardNotice;
  const [sourceAction, setSourceAction] = useState({ kind: null, url: null, status: 'idle' });
  const [deadlineReferenceNow, setDeadlineReferenceNow] = useState(() => new Date());
  const [evidenceAnnouncement, setEvidenceAnnouncement] = useState('');
  const [mobilePane, setMobilePane] = useState('action');
  const [expandedCompletedActionIds, setExpandedCompletedActionIds] = useState([]);
  const [openSections, setOpenSections] = useState({
    translation: isTranslationOnly || preference === 'translation',
    explanation: false,
    materials: false,
    deadlines: false,
    terms: false,
    context: false,
    sources: false,
    verification: false,
    warnings: false,
  });
  const replyPlaceholders = useMemo(
    () => getReplyDraftPlaceholders(replyDraft),
    [replyDraft],
  );
  const replyProgressConsistency = useMemo(
    () => getReplyProgressConsistency(replyDraftModel, completedActionIdSet),
    [completedActionIdSet, replyDraftModel],
  );
  const replyMissingActionNumbers = useMemo(() => {
    const stepNumberById = new Map(actionGroups.map((group, index) => [group.id, index + 1]));
    return replyProgressConsistency.remainingActionIds
      .map((id) => stepNumberById.get(id))
      .filter(Number.isSafeInteger);
  }, [actionGroups, replyProgressConsistency.remainingActionIds]);
  const replyCompletedClaimMismatch = replyCompletionStatus === 'completed'
    && replyProgressConsistency.requiredCount > 0
    && !replyProgressConsistency.isComplete;
  const replyCopyBlocked = replyCompletionStatus === 'unconfirmed'
    || !replyDraft.trim()
    || replyPlaceholders.length > 0
    || (replyCompletedClaimMismatch && !replyProgressOverrideConfirmed);
  const replyCopyDescriptionIds = [
    replyCompletedClaimMismatch && !replyProgressOverrideConfirmed ? 'reply-progress-mismatch' : null,
    replyPlaceholders.length > 0 ? 'reply-placeholder-warning' : null,
  ].filter(Boolean).join(' ') || undefined;
  const replyCopyBlockSummary = replyCompletionStatus === 'unconfirmed'
    ? '先选择真实状态'
    : [
      replyCompletedClaimMismatch && !replyProgressOverrideConfirmed ? '确认进度差异' : null,
      replyPlaceholders.length > 0 ? `填写 ${replyPlaceholders.length} 处内容` : null,
    ].filter(Boolean).join('，');
  const sourceRefs = useRef(new Map());
  const resultRefs = useRef(new Map());
  const headlineRef = useRef(null);
  const permissionRecoveryRef = useRef(null);
  const replyTriggerRef = useRef(null);
  const replyDialogRef = useRef(null);
  const replyTextareaRef = useRef(null);
  const replySelectionRef = useRef(initialReplyDraftState.selection);
  const replyCapturePendingRef = useRef(replyCapturePending);
  const replyCopyInFlightRef = useRef(false);
  const resultCopyResetTimerRef = useRef(null);
  const actionCopyResetTimerRef = useRef(null);
  const replyDraftModelIdentityRef = useRef(replyDraftModelIdentity);
  const lastReportedReplyDraftStateRef = useRef(JSON.stringify(initialReplyDraftState));
  const officialSourcesTriggerRef = useRef(null);
  const deadlineDisclosureRef = useRef(null);
  const verificationApprovalRef = useRef(null);
  const verificationCancellationFocusRef = useRef(false);
  const effectiveEvidence = hoveredEvidence || pinnedEvidence;
  const sourceActionBusy = ['opening', 'copying'].includes(sourceAction.status);
  const deadlineUrgency = useMemo(
    () => describeDeadlineUrgency(deadline, deadlineReferenceNow),
    [deadline, deadlineReferenceNow],
  );
  const writeClipboard = useCallback(
    (text, kind) => {
      if (onWriteClipboard) return onWriteClipboard(text, { kind });
      const error = new Error('clipboard-write-unavailable');
      error.code = 'clipboard-write-unavailable';
      return Promise.reject(error);
    },
    [onWriteClipboard],
  );

  useEffect(() => () => {
    if (resultCopyResetTimerRef.current) window.clearTimeout(resultCopyResetTimerRef.current);
    if (actionCopyResetTimerRef.current) window.clearTimeout(actionCopyResetTimerRef.current);
  }, []);
  const requestReplyDialogOpen = useCallback((nextOpen) => {
    const open = nextOpen === true;
    if (controlledReplyDialogOpen === undefined) setLocalReplyDialogOpen(open);
    onReplyDialogOpenChange?.(open);
  }, [controlledReplyDialogOpen, onReplyDialogOpenChange]);
  const rememberReplySelection = useCallback(() => {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    const nextSelection = {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? textarea.selectionStart ?? 0,
      direction: textarea.selectionDirection || 'none',
    };
    replySelectionRef.current = nextSelection;
    setReplySelection(nextSelection);
  }, []);
  const closeReplyDraft = useCallback(() => {
    rememberReplySelection();
    requestReplyDialogOpen(false);
  }, [rememberReplySelection, requestReplyDialogOpen]);

  replyCapturePendingRef.current = replyCapturePending;

  useEffect(() => {
    if (!active) return undefined;
    window.requestAnimationFrame(() => headlineRef.current?.focus({ preventScroll: true }));
    return undefined;
  }, [active]);

  useEffect(() => {
    if (!deadlineUrgency) return undefined;
    const timer = window.setTimeout(
      () => setDeadlineReferenceNow(new Date()),
      millisecondsUntilNextLocalDay(deadlineReferenceNow),
    );
    return () => window.clearTimeout(timer);
  }, [deadlineReferenceNow, deadlineUrgency]);

  useEffect(() => {
    if (!active || !screenRecordingPermissionDenied) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      permissionRecoveryRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, screenRecordingPermissionDenied]);

  useEffect(() => {
    if (isTranslationOnly || preference === 'translation') {
      setOpenSections((current) => ({ ...current, translation: true }));
    }
  }, [isTranslationOnly, preference]);

  useEffect(() => {
    if (!hasControlledClipboardNotice) setLocalClipboardNotice({ status: 'idle' });
    setSourceAction({ kind: null, url: null, status: 'idle' });
    setSourceOpenNotice({ status: 'idle' });
  }, [hasControlledClipboardNotice, normalizedBrief]);

  useEffect(() => {
    if (!verificationCancellationFocusRef.current || isVerifying || isCancellingVerification) return undefined;
    verificationCancellationFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => verificationApprovalRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [isCancellingVerification, isVerifying]);

  useEffect(() => {
    if (!normalizedBrief.terms.some((term) => term.id === selectedTermId)) {
      setSelectedTermId(normalizedBrief.terms[0]?.id || null);
    }
  }, [normalizedBrief.terms, selectedTermId]);

  useEffect(() => {
    const modelChanged = replyDraftModelIdentityRef.current !== replyDraftModelIdentity;
    const next = sanitizeReplyDraftState(controlledReplyDraftState, {
      expectedModelIdentity: replyDraftModelIdentity,
    }) || createEmptyReplyDraftState(replyDraftModelIdentity);
    const nextKey = JSON.stringify(next);
    replyDraftModelIdentityRef.current = replyDraftModelIdentity;
    if (!modelChanged && nextKey === lastReportedReplyDraftStateRef.current) return;
    lastReportedReplyDraftStateRef.current = nextKey;
    const selectionChanged = replySelection.start !== next.selection.start
      || replySelection.end !== next.selection.end
      || replySelection.direction !== next.selection.direction;
    if (
      replyDraft !== next.draft
      || replyCompletionStatus !== next.completionStatus
      || replyProgressOverrideConfirmed !== next.overrideConfirmed
      || selectionChanged
    ) {
      setReplyDraft(next.draft);
      setReplyCompletionStatus(next.completionStatus);
      setReplyProgressOverrideConfirmed(next.overrideConfirmed);
      replySelectionRef.current = next.selection;
      setReplySelection(next.selection);
      setReplyCopyState('idle');
    }
    if (modelChanged) requestReplyDialogOpen(false);
  }, [
    controlledReplyDraftState,
    replyCompletionStatus,
    replyDraft,
    replyDraftModelIdentity,
    replyProgressOverrideConfirmed,
    replySelection,
    requestReplyDialogOpen,
  ]);

  useEffect(() => {
    const next = sanitizeReplyDraftState({
      modelIdentity: replyDraftModelIdentity,
      draft: replyDraft,
      completionStatus: replyCompletionStatus,
      overrideConfirmed: replyProgressOverrideConfirmed,
      selection: replySelection,
    });
    lastReportedReplyDraftStateRef.current = JSON.stringify(next);
    onReplyDraftStateChange?.(next);
  }, [
    onReplyDraftStateChange,
    replyCompletionStatus,
    replyDraft,
    replyDraftModelIdentity,
    replyProgressOverrideConfirmed,
    replySelection,
  ]);

  useEffect(() => {
    if (!replyDialogOpen) return undefined;
    const dialog = replyDialogRef.current;
    const trigger = replyTriggerRef.current;
    const backdrop = dialog?.closest('.reply-drawer-backdrop');
    const shell = dialog?.closest('.slipstream-shell');
    const hiddenSiblings = new Map();
    const hideBehindDialog = (node) => {
      if (!(node instanceof HTMLElement) || node === backdrop || hiddenSiblings.has(node)) return;
      hiddenSiblings.set(node, {
        inert: node.inert,
        ariaHidden: node.getAttribute('aria-hidden'),
      });
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    };
    [...(shell?.children || [])].forEach(hideBehindDialog);
    const observer = shell ? new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach(hideBehindDialog);
      });
    }) : null;
    observer?.observe(shell, { childList: true });

    let tabFocusScrollFrame = null;
    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeReplyDraft();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      if (tabFocusScrollFrame !== null) {
        window.cancelAnimationFrame(tabFocusScrollFrame);
      }
      tabFocusScrollFrame = window.requestAnimationFrame(() => {
        const activeTarget = document.activeElement;
        if (!(activeTarget instanceof HTMLElement) || !dialog.contains(activeTarget)) return;
        const visualTarget = activeTarget.matches('input[type="radio"], input[type="checkbox"]')
          ? activeTarget.closest('label') || activeTarget
          : activeTarget;
        visualTarget.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'nearest',
        });
      });
    };
    dialog?.addEventListener('keydown', handleDialogKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      const textarea = replyTextareaRef.current;
      const resumeTextarea = replyFocusRequest > 0 && textarea && !textarea.disabled;
      const target = resumeTextarea
        ? textarea
        : dialog?.querySelector('input[name="reply-status"]:checked, input[name="reply-status"]');
      if (!target?.isConnected || target.closest('[inert]')) return;
      target.focus({ preventScroll: true, focusVisible: true });
      if (document.activeElement === target) {
        target.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'nearest',
        });
      }
      if (resumeTextarea) {
        const { start, end, direction } = replySelectionRef.current;
        textarea.setSelectionRange(
          Math.min(start, textarea.value.length),
          Math.min(end, textarea.value.length),
          direction,
        );
      }
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (tabFocusScrollFrame !== null) {
        window.cancelAnimationFrame(tabFocusScrollFrame);
      }
      observer?.disconnect();
      dialog?.removeEventListener('keydown', handleDialogKeyDown);
      hiddenSiblings.forEach((previous, node) => {
        if (!node.isConnected) return;
        node.inert = previous.inert;
        if (previous.ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previous.ariaHidden);
      });
      if (replyCapturePendingRef.current) return;
      window.requestAnimationFrame(() => {
        if (!trigger?.isConnected || trigger.closest('[inert]')) return;
        trigger.focus({ preventScroll: true });
      });
    };
  }, [closeReplyDraft, replyDialogOpen, replyFocusRequest]);

  const registerResultRef = useCallback((id, node) => {
    if (!node) return;
    const nodes = resultRefs.current.get(id) || new Set();
    nodes.add(node);
    resultRefs.current.set(id, nodes);
  }, []);

  const focusEvidence = useCallback((id, destination) => {
    setHoveredEvidence(null);
    setPinnedEvidence((current) => (current === id ? null : id));
    setMobilePane(destination === 'source' ? 'source' : 'action');
    const entry = evidenceCatalog.find((candidate) => candidate.id === id) || null;
    let preferredResultTarget = null;
    if (destination === 'result' && entry) {
      const route = getEvidenceResultRoute(entry, normalizedBrief, actionGroups);
      setOpenSections((current) => {
        const next = { ...current };
        Object.entries(route.sections).forEach(([section, shouldOpen]) => {
          if (shouldOpen) next[section] = true;
        });
        return next;
      });
      if (route.selectedTermId) {
        setSelectedTermId(route.selectedTermId);
      }
      preferredResultTarget = route.targetKind;
    }
    const map = destination === 'source' ? sourceRefs.current : resultRefs.current;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const stored = map.get(id);
        const connected = stored instanceof Set
          ? [...stored].filter((node) => node?.isConnected)
          : (stored?.isConnected ? [stored] : []);
        const target = preferredResultTarget
          ? connected.find((node) => node.dataset.evidenceTarget === preferredResultTarget) || connected[0]
          : connected[0];
        target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
        target?.focus({ preventScroll: true });
        if (entry && target) {
          setEvidenceAnnouncement(getEvidenceNavigationAnnouncement(
            entry,
            destination,
            preferredResultTarget,
          ));
        }
      });
    });
  }, [actionGroups, evidenceCatalog, normalizedBrief]);

  const toggleSection = useCallback((key) => {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const openDeadlineDetails = useCallback(() => {
    setMobilePane('action');
    setOpenSections((current) => ({ ...current, deadlines: true }));
    const announcement = deadlineSelection.totalCount <= 1
      ? '已展开截止日期及其原文依据。'
      : deadlineSelection.selectionMode === 'earliest'
        ? `已展开全部 ${deadlineSelection.totalCount} 项截止日期；顶部优先显示最早的可确认期限。`
        : deadlineSelection.selectionMode === 'action_priority'
          ? `已展开全部 ${deadlineSelection.totalCount} 项截止日期；顶部优先显示与用户必做行动关联的期限。`
          : `已展开全部 ${deadlineSelection.totalCount} 项截止日期；部分期限无法可靠比较，已保留原文顺序，请逐项核对。`;
    setEvidenceAnnouncement(announcement);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        deadlineDisclosureRef.current?.scrollIntoView({
          behavior: preferredScrollBehavior(),
          block: 'center',
        });
        deadlineDisclosureRef.current?.focus({ preventScroll: true });
      });
    });
  }, [deadlineSelection.selectionMode, deadlineSelection.totalCount]);

  const openOfficialVerificationPlan = useCallback(() => {
    setOpenSections((current) => ({ ...current, sources: true }));
    setEvidenceAnnouncement('已展开官方核验方案；请先核对候选页面或最小检索词，再决定是否批准。');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = verificationApprovalRef.current || officialSourcesTriggerRef.current;
        target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const cancelOfficialVerification = useCallback(() => {
    if (!onCancelVerification || isCancellingVerification) return;
    verificationCancellationFocusRef.current = true;
    onCancelVerification();
  }, [isCancellingVerification, onCancelVerification]);

  const handleAcknowledgeClipboardConsequence = useCallback(async () => {
    const { consequenceId, kind } = clipboardNotice;
    if (!consequenceId || !onAcknowledgeClipboardConsequence) return;
    try {
      await onAcknowledgeClipboardConsequence(consequenceId);
    } catch {
      // The app-level coordinator owns exact consequence settlement and failure copy.
    } finally {
      if (kind === 'source-link') {
        setSourceAction({ kind: null, url: null, status: 'idle' });
      }
    }
  }, [clipboardNotice, onAcknowledgeClipboardConsequence]);

  const handleCopyResult = useCallback(async () => {
    if (clipboardWritePending) return;
    if (resultCopyResetTimerRef.current) {
      window.clearTimeout(resultCopyResetTimerRef.current);
      resultCopyResetTimerRef.current = null;
    }
    setCopyState('copying');
    try {
      const settledNotice = await writeClipboard(composeCompleteResultText(normalizedBrief, {
        additionalWarnings: warning ? [warning] : [],
      }) || result || '', 'result');
      setClipboardNotice(settledNotice);
      setCopyState('success');
      resultCopyResetTimerRef.current = window.setTimeout(() => {
        setCopyState('idle');
        resultCopyResetTimerRef.current = null;
      }, 1800);
    } catch (error) {
      if (isClipboardWritePendingError(error)) {
        setCopyState('idle');
        return;
      }
      if (!error?.clipboardManaged) {
        setClipboardNotice((current) => createClipboardCopyFailureNotice('result', current));
      }
      setCopyState('error');
    }
  }, [clipboardWritePending, normalizedBrief, result, setClipboardNotice, warning, writeClipboard]);

  const handleCopyActions = useCallback(async () => {
    if (clipboardWritePending) return;
    if (actionCopyResetTimerRef.current) {
      window.clearTimeout(actionCopyResetTimerRef.current);
      actionCopyResetTimerRef.current = null;
    }
    setActionCopyState('copying');
    try {
      const settledNotice = await writeClipboard(composeActionChecklistText(normalizedBrief, {
        additionalWarnings: warning ? [warning] : [],
        completedActionIds: [...completedActionIdSet],
      }), 'actions');
      setClipboardNotice(settledNotice);
      setActionCopyState('success');
      actionCopyResetTimerRef.current = window.setTimeout(() => {
        setActionCopyState('idle');
        actionCopyResetTimerRef.current = null;
      }, 1800);
    } catch (error) {
      if (isClipboardWritePendingError(error)) {
        setActionCopyState('idle');
        return;
      }
      if (!error?.clipboardManaged) {
        setClipboardNotice((current) => createClipboardCopyFailureNotice('actions', current));
      }
      setActionCopyState('error');
    }
  }, [clipboardWritePending, completedActionIdSet, normalizedBrief, setClipboardNotice, warning, writeClipboard]);

  const handleToggleCompletedEvidence = useCallback((actionId) => {
    setExpandedCompletedActionIds((current) => (
      current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId]
    ));
  }, []);

  const handleActionCompletionChange = useCallback((actionId) => {
    setExpandedCompletedActionIds((current) => current.filter((id) => id !== actionId));
    const affectsCompletedReply = replyCompletionStatus === 'completed'
      && replyProgressConsistency.requiredActionIds.includes(actionId);
    if (affectsCompletedReply) {
      setReplyProgressOverrideConfirmed(false);
      setReplyCopyState('idle');
    }
    setClipboardNotice((current) => {
      const actionNotice = markCopiedClipboardNoticeOutdated(current, 'actions');
      return affectsCompletedReply
        ? markCopiedClipboardNoticeOutdated(actionNotice, 'reply')
        : actionNotice;
    });
    onToggleActionCompletion?.(actionId);
  }, [
    onToggleActionCompletion,
    replyCompletionStatus,
    replyProgressConsistency.requiredActionIds,
    setClipboardNotice,
  ]);

  const handleOpenSource = useCallback(async (url) => {
    if (!onOpenExternal || sourceActionBusy) return;
    setSourceAction({ kind: 'open', url, status: 'opening' });
    setSourceOpenNotice(createSourceOpenPendingNotice());
    try {
      const opened = await onOpenExternal(url);
      if (opened !== true) throw new Error('External open was not confirmed.');
      setSourceAction({ kind: 'open', url, status: 'success' });
      setSourceOpenNotice(createSourceOpenSuccessNotice());
    } catch {
      setSourceAction({ kind: 'open', url, status: 'error' });
      setSourceOpenNotice(createSourceOpenFailureNotice());
    }
  }, [onOpenExternal, sourceActionBusy]);

  const handleCopySourceLink = useCallback(async (url) => {
    if (sourceActionBusy || clipboardWritePending) return;
    setSourceOpenNotice({ status: 'idle' });
    setSourceAction({ kind: 'copy', url, status: 'copying' });
    try {
      const settledNotice = await writeClipboard(url, 'source-link');
      setSourceAction({ kind: 'copy', url, status: 'success' });
      setClipboardNotice(settledNotice);
    } catch (error) {
      if (isClipboardWritePendingError(error)) {
        setSourceAction({ kind: null, url: null, status: 'idle' });
        return;
      }
      setSourceAction({ kind: 'copy', url, status: 'error' });
      if (!error?.clipboardManaged) {
        setClipboardNotice((current) => createClipboardCopyFailureNotice('source-link', current));
      }
    }
  }, [clipboardWritePending, setClipboardNotice, sourceActionBusy, writeClipboard]);

  const sourceActionLabel = (kind, url, fallback) => {
    if (sourceAction.kind !== kind || sourceAction.url !== url) return fallback;
    if (sourceAction.status === 'opening') return '正在打开…';
    if (sourceAction.status === 'copying') return '正在复制…';
    if (sourceAction.status === 'success') return kind === 'open' ? '已交给浏览器' : '已复制链接';
    if (sourceAction.status === 'error') return kind === 'open' ? '打开失败 · 重试' : '复制失败 · 重试';
    return fallback;
  };

  const sourceActionIcon = (kind, url, fallbackIcon) => (
    sourceAction.kind === kind && sourceAction.url === url && sourceAction.status === 'success'
      ? <CheckCircle size={16} weight="fill" />
      : fallbackIcon
  );

  const openReplyDraft = useCallback(() => {
    setReplyCopyState('idle');
    requestReplyDialogOpen(true);
  }, [requestReplyDialogOpen]);

  const handleReplyStatusChange = useCallback((completionStatus) => {
    setReplyCompletionStatus(completionStatus);
    setReplyProgressOverrideConfirmed(false);
    setReplyDraft(composeReplyDraft(replyDraftModel, { completionStatus }));
    setReplyCopyState('idle');
    setClipboardNotice((current) => markCopiedClipboardNoticeOutdated(current, 'reply'));
  }, [replyDraftModel, setClipboardNotice]);

  const handleConfigureAnalysis = useCallback(() => {
    if (onConfigureAnalysis) {
      onConfigureAnalysis();
      return;
    }
    document.querySelector('button[aria-label="打开设置"]')?.click();
  }, [onConfigureAnalysis]);

  const handleCopyReply = useCallback(async () => {
    if (replyCopyBlocked || clipboardWritePending || replyCopyInFlightRef.current) return;
    replyCopyInFlightRef.current = true;
    setReplyCopyState('copying');
    try {
      const settledNotice = onCopyReply
        ? await onCopyReply({
          draft: replyDraft,
          modelIdentity: replyDraftModelIdentity,
        })
        : await writeClipboard(replyDraft, 'reply').then((copied) => {
          setClipboardNotice(copied);
          return copied;
        });
      if (settledNotice?.status === 'copied') {
        setReplyCopyState('success');
        window.setTimeout(() => setReplyCopyState('idle'), 1800);
      } else {
        setReplyCopyState('idle');
      }
    } catch (error) {
      if (isClipboardWritePendingError(error)) {
        setReplyCopyState('idle');
        return;
      }
      if (!onCopyReply) {
        setClipboardNotice((current) => createClipboardCopyFailureNotice('reply', current));
      }
      setReplyCopyState('error');
    } finally {
      replyCopyInFlightRef.current = false;
    }
  }, [
    onCopyReply,
    replyCopyBlocked,
    clipboardWritePending,
    replyDraft,
    replyDraftModelIdentity,
    setClipboardNotice,
    writeClipboard,
  ]);

  const handleSelectTerm = useCallback((term) => {
    setSelectedTermId(term.id);
  }, []);

  useEffect(() => {
    if (savedTermsLoadStatus !== 'ready') return;
    setTermError((current) => (current?.scope === 'save' ? null : current));
  }, [savedTermsLoadStatus]);

  const handleSaveTerm = useCallback(async (term) => {
    const savedTermsLoadPending = savedTermsLoadStatus === 'idle'
      || savedTermsLoadStatus === 'loading';
    const termAlreadySaved = savedTermsLoadStatus === 'ready'
      && hasSavedTerm(savedTerms, term.surface);
    if (!onSaveTerm || termOperation.kind || savedTermsLoadPending || termAlreadySaved) return;
    setTermOperation({ kind: 'save', id: term.id });
    setTermError(null);
    try {
      const outcome = await onSaveTerm(term);
      setTermAnnouncement(outcome?.status === 'already-saved'
        ? `术语 ${term.surface} 已在术语库中`
        : `已保存术语 ${term.surface}`);
    } catch (error) {
      setTermError({
        scope: 'save',
        id: term.id,
        message: [
          'saved-terms-mutation-unconfirmed',
          'saved-terms-invalid-mutation-response',
          'saved-terms-invalid-import-response',
        ].includes(error?.code)
          ? '最近一次术语更改仍未确认；重新读取并核对前，不会继续保存当前术语。'
          : [
            'saved-terms-load-failed',
            'saved-terms-invalid-response',
            'saved-terms-load-stale',
          ].includes(error?.code)
            ? '术语表仍未读取成功；没有更改任何术语，可以直接重试。'
            : '暂时无法保存这个术语；解释仍保留在当前结果中，可以直接重试。',
      });
    } finally {
      setTermOperation({ kind: null, id: null });
    }
  }, [onSaveTerm, savedTerms, savedTermsLoadStatus, termOperation.kind]);

  const renderSource = () => {
    if (evidenceCatalog.length === 0) return sourceText;
    const nodes = [];
    let cursor = 0;
    evidenceCatalog.forEach((entry) => {
      if (entry.start < cursor) return;
      if (entry.start > cursor) nodes.push(sourceText.slice(cursor, entry.start));
      const active = effectiveEvidence === entry.id;
      const muted = Boolean(effectiveEvidence && !active);
      nodes.push(
        <mark
          key={entry.id}
          id={`source-evidence-${entry.id}`}
          ref={(node) => {
            if (node) sourceRefs.current.set(entry.id, node);
            else sourceRefs.current.delete(entry.id);
          }}
          role="button"
          tabIndex={0}
          aria-controls="result-insight"
          lang={getContentLanguageTag(entry.quote, sourceLanguage)}
          className={`source-evidence${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
          style={{ '--evidence-color': entry.color.solid, '--evidence-soft': entry.color.soft }}
          onMouseEnter={() => setHoveredEvidence(entry.id)}
          onMouseLeave={() => setHoveredEvidence(null)}
          onFocus={() => setHoveredEvidence(entry.id)}
          onBlur={() => setHoveredEvidence(null)}
          onClick={() => focusEvidence(entry.id, 'result')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              focusEvidence(entry.id, 'result');
            }
          }}
        >
          <span className="source-evidence__number" aria-hidden="true">{entry.id}</span>
          {sourceText.slice(entry.start, entry.end)}
        </mark>,
      );
      cursor = entry.end;
    });
    if (cursor < sourceText.length) nodes.push(sourceText.slice(cursor));
    return nodes;
  };

  const selectedTerm = normalizedBrief.terms.find((term) => term.id === selectedTermId) || null;
  const savedTermsLoadPending = savedTermsLoadStatus === 'idle'
    || savedTermsLoadStatus === 'loading';
  const savedTermsLoadFailed = savedTermsLoadStatus === 'error';
  const savedTermsReconciliationRequired = [
    'saved-terms-mutation-unconfirmed',
    'saved-terms-invalid-mutation-response',
    'saved-terms-invalid-import-response',
  ].includes(savedTermsLoadErrorCode);
  const selectedTermSaved = savedTermsLoadStatus === 'ready'
    && hasSavedTerm(savedTerms, selectedTerm?.surface);
  const selectedTermSaving = termOperation.kind === 'save' && termOperation.id === selectedTerm?.id;
  const selectedTermSaveLabel = selectedTermSaved
    ? '已保存到术语表'
    : savedTermsLoadPending
      ? '正在确认是否已保存…'
      : selectedTermSaving
        ? savedTermsLoadFailed
          ? '正在检查并保存…'
          : '正在保存…'
        : savedTermsLoadFailed
          ? '重试检查并保存'
          : '保存到术语表';
  const selectedTermVerification = selectedTerm?.verificationId
    ? normalizedBrief.verifications.find((item) => item.id === selectedTerm.verificationId) || null
    : null;
  const replyRequired = !isTranslationOnly && shouldOfferReply(normalizedBrief);
  const officialCount = citations.length;
  const pendingCount = normalizedBrief.verifications.filter((item) => item.status === 'pending').length;
  const retrievedCount = normalizedBrief.verifications.filter((item) => item.status === 'retrieved').length;
  const failedCount = normalizedBrief.verifications.filter((item) => item.status === 'failed').length;
  const unresolvedCount = pendingCount + retrievedCount + failedCount;
  const hasPriorVerificationAttempt = retrievedCount > 0 || failedCount > 0;
  const canRequestOfficialSources = verificationTargets.length > 0 || govUkDiscoveryPlans.length > 0;
  const showLookupApproval = verificationPolicy === 'ask'
    && canRequestOfficialSources
    && (Boolean(onVerifyOfficialSources) || isVerifying);
  const verificationPlanCount = verificationTargets.length + govUkDiscoveryPlans.length;
  const verificationApprovalUnavailable = verificationPolicy === 'ask'
    && canRequestOfficialSources
    && !showLookupApproval;
  const unresolvedMeta = [
    pendingCount > 0 ? `${pendingCount} 项待核验` : null,
    retrievedCount > 0 ? `${retrievedCount} 项已找到页面待确认` : null,
    failedCount > 0 ? `${failedCount} 项失败` : null,
  ].filter(Boolean).join(' · ') || '没有待核验或失败项目';
  const needsOfficialVerification = unresolvedCount > 0
    || normalizedBrief.contexts.some((item) => item.provenance?.kind === 'pending')
    || normalizedBrief.terms.some((item) => item.provenance?.kind === 'pending');
  const explanationIsGrounded = !normalizedBrief.explanation || hasExactGrounding(normalizedBrief.explanation, sourceText);
  const displayStatus = normalizedBrief.status === 'complete' && !explanationIsGrounded
    ? 'partial'
    : normalizedBrief.status;
  const statusLabel = displayStatus === 'complete'
    ? '原文证据已对齐'
    : displayStatus === 'translation_only'
      ? '仅完成翻译'
      : '部分结论待核验';
  const officialSourcesMeta = unconfirmedRetrievalReceipts.length > 0
    ? `已找到 ${unconfirmedRetrievalReceipts.length} 个页面 · 结论仍需确认`
    : officialCount > 0 && unresolvedCount > 0
      ? `${officialCount} 个来源已核验 · ${unresolvedCount} 项仍待确认`
      : officialCount > 0
        ? `已核验 ${officialCount} 个来源`
        : verifiedRetrievalReceipts.length > 0
          ? `${verifiedRetrievalReceipts.length} 个官方页面支持已核验结论`
          : showLookupApproval
            ? `${verificationPlanCount} 项可查找 · 需你批准`
            : verificationPolicy === 'local-only' && needsOfficialVerification
              ? '仅本地 · 不会联网'
              : '未提供官方来源';
  const verificationPlanActionLabel = verificationPolicy === 'local-only'
    ? '查看仅本地核验限制'
    : showLookupApproval
      ? '查看并批准官方核验'
      : canRequestOfficialSources
        ? '查看核验状态与恢复方式'
        : '查看为何无法自动核验';
  const completionTimingLabel = formatResultTiming({
    processingTimeMs,
    verificationTimeMs,
    translationOnly: isTranslationOnly,
  });
  const processingCompletionLabel = isTranslationOnly ? '翻译完成' : '处理完成';
  const completionButtonLabel = `${processingCompletionLabel} · ${completionTimingLabel} · 查看处理详情`;
  const processingLocation = processingPrivacyDisclosure?.location || 'unknown';
  const ProcessingLocationIcon = processingLocation === 'local'
    ? ShieldCheck
    : processingLocation === 'local-loopback'
      ? HardDrives
      : CloudArrowUp;

  const renderLinkedEvidence = (item, label, targetKind = 'detail') => {
    const entries = catalogEntriesFor(item, evidenceCatalog);
    if (entries.length === 0) {
      return (
        <div className="unverified-card unverified-card--compact">
          <WarningCircle size={16} />
          <span>没有可定位的原文片段，请将此项视为待核验。</span>
        </div>
      );
    }
    return (
      <div className="evidence-list evidence-list--compact">
        {entries.map((entry) => {
          const active = effectiveEvidence === entry.id;
          const muted = Boolean(effectiveEvidence && !active);
          return (
            <button
              type="button"
              key={entry.key}
              ref={(node) => registerResultRef(entry.id, node)}
              data-evidence-target={targetKind}
              aria-controls={`source-evidence-${entry.id}`}
              className={`evidence-card${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
              style={{ '--evidence-color': entry.color.solid, '--evidence-soft': entry.color.soft }}
              onMouseEnter={() => setHoveredEvidence(entry.id)}
              onMouseLeave={() => setHoveredEvidence(null)}
              onFocus={() => setHoveredEvidence(entry.id)}
              onBlur={() => setHoveredEvidence(null)}
              onClick={() => focusEvidence(entry.id, 'source')}
            >
              <span className="evidence-card__number">{entry.id}</span>
              <span className="evidence-card__label">{label}</span>
              <q lang={getContentLanguageTag(entry.quote, sourceLanguage)}>{entry.quote}</q>
            </button>
          );
        })}
      </div>
    );
  };

  const renderVerificationCitations = (verification) => {
    const verificationCitations = Array.isArray(verification?.provenance?.citations)
      ? verification.provenance.citations
      : [];
    if (verificationCitations.length === 0) return null;
    return (
      <div className="verification-citations" aria-label="核验引用">
        <strong>官方引用</strong>
        {verificationCitations.map((citation) => (
          <div key={citation.id || citation.url} className="verification-citation">
            <SealCheck size={17} weight="fill" />
            <div>
              <span lang={inferTextLanguageTag(citation.title || citation.publisher)}>{citation.title || citation.publisher}</span>
              {citation.quote && <q lang={inferTextLanguageTag(citation.quote)}>{citation.quote}</q>}
              <code>{citation.url}</code>
            </div>
            {onOpenExternal && (
              <button
                type="button"
                className="text-button source-action-button"
                onClick={() => handleOpenSource(citation.url)}
                disabled={sourceActionBusy}
                aria-busy={sourceAction.kind === 'open' && sourceAction.url === citation.url && sourceAction.status === 'opening'}
              >
                {sourceActionIcon('open', citation.url, <ArrowSquareOut size={15} />)}
                {sourceActionLabel('open', citation.url, '打开')}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <main className="result-view" aria-labelledby="result-headline">
      <p id="evidence-navigation-status" className="result-a11y-live" aria-live="polite" aria-atomic="true">
        {evidenceAnnouncement}
      </p>
      <section className="result-summary">
        <div>
          <p className="eyebrow">{isTranslationOnly ? '翻译结果' : '结论'}</p>
          <h1 id="result-headline" ref={headlineRef} tabIndex={-1}>{headline}</h1>
        </div>
        <div className="summary-meta" aria-label="关键信息">
          {deadline && (
            <button
              type="button"
              className={`deadline-summary${deadlineUrgency ? ` deadline-summary--${deadlineUrgency.tone}` : ''}`}
              onClick={openDeadlineDetails}
            >
              <CalendarBlank size={18} aria-hidden="true" />
              <span className="deadline-summary__copy">
                {deadlineUrgency && <strong>{deadlineUrgency.label}</strong>}
                <small className={!deadlineUrgency ? 'is-only' : ''}>
                  <span>{deadlineSelection.selectionMode === 'earliest'
                    ? '最早截止'
                    : deadlineSelection.selectionMode === 'action_priority' ? '优先截止' : '截止日期'} · </span>
                  <span lang={getContentLanguageTag(deadline.whenText, sourceLanguage)}>{deadline.whenText}</span>
                  {deadlineSelection.totalCount > 1 && <span>{` · 共 ${deadlineSelection.totalCount} 项`}</span>}
                </small>
                <span className="result-a11y-live">，查看全部截止日期</span>
              </span>
              <CaretRight className="deadline-summary__arrow" size={13} aria-hidden="true" />
            </button>
          )}
          {replyRequired && (
            <span className={`summary-reply-status${replyActionCompleted ? ' is-complete' : ''}`}>
              {replyActionCompleted
                ? <CheckCircle size={18} weight="fill" aria-hidden="true" />
                : <FileText size={18} aria-hidden="true" />}
              {replyActionCompleted ? '回复已标记完成' : '需要回复'}
            </span>
          )}
        </div>
      </section>

      {warning && (
        <div
          className={`inline-warning${screenRecordingPermissionDenied || warningRecovery || failedProcessingAttemptAvailable ? ' is-actionable' : ''}`}
          role={screenRecordingPermissionDenied || warningRecovery || failedProcessingAttemptAvailable ? 'alert' : 'note'}
        >
          <WarningCircle size={18} weight="fill" />
          <div className="inline-warning__content">
            <span>{warning}</span>
            {screenRecordingPermissionDenied && (
              <div className="inline-warning__actions">
                <button ref={permissionRecoveryRef} type="button" onClick={onOpenScreenRecordingSettings}>
                  <ArrowSquareOut size={14} />打开屏幕录制设置
                </button>
                <button type="button" onClick={onRecapture}>返回后重新截图</button>
              </div>
            )}
            {!screenRecordingPermissionDenied && (warningRecovery || failedProcessingAttemptAvailable) && (
              <div className="inline-warning__actions">
                {warningRecovery?.priority === 'configure' && (
                  <button type="button" className="is-primary" onClick={onConfigureRecovery}>
                    {warningRecovery.actionLabel}
                  </button>
                )}
                {onRetry && (
                  <button
                    type="button"
                    className={warningRecovery?.priority === 'retry' || !warningRecovery ? 'is-primary' : undefined}
                    onClick={onRetry}
                  >
                    {retryLabel || '重新分析'}
                  </button>
                )}
                {failedProcessingAttemptAvailable && onReviewFailedProcessingAttempt && (
                  <button type="button" onClick={onReviewFailedProcessingAttempt}>
                    查看并修正刚才的原文
                  </button>
                )}
                {warningRecovery && warningRecovery.priority !== 'configure' && (
                  <button type="button" onClick={onConfigureRecovery}>
                    {warningRecovery.actionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="evidence-workspace" data-mobile-pane={mobilePane}>
        <div className="mobile-workspace-switch" aria-label="结果视图">
          <button
            type="button"
            aria-pressed={mobilePane === 'source'}
            onClick={() => setMobilePane('source')}
          >
            <BookOpen size={17} />原文证据
          </button>
          <button
            type="button"
            aria-pressed={mobilePane === 'action'}
            onClick={() => setMobilePane('action')}
          >
            {isTranslationOnly || effectivePreference === 'translation'
              ? <BookOpen size={17} />
              : <ListChecks size={17} />}
            {isTranslationOnly
              ? '完整翻译'
              : effectivePreference === 'translation' ? '翻译与行动' : '行动与解释'}
          </button>
        </div>
        <section className="source-column" aria-labelledby="source-title">
          <div className="column-heading">
            <div>
              <p className="eyebrow">证据</p>
              <h2 id="source-title">完整原文</h2>
            </div>
            <div className="source-quality">
              <span>{sourceLabel}</span>
              {typeof captureConfidence === 'number' && <span>OCR {Math.round(captureConfidence * 100)}%</span>}
            </div>
          </div>
          <div className="source-paper" lang={sourceLanguageTag}>
            {renderSource()}
          </div>
          <p className="source-help">
            {isTranslationOnly
              ? <><BookOpen size={15} /> 本次仅完成翻译，没有生成彩色证据映射。</>
              : <><MagnifyingGlass size={15} /> 悬停或点按彩色原文，可定位右侧对应结论。</>}
          </p>
        </section>

        <section
          id="result-insight"
          className={`insight-column insight-column--${effectivePreference}${isTranslationOnly ? ' insight-column--translation-only' : ''}`}
          aria-labelledby={isTranslationOnly ? 'translation-only-title' : 'action-title'}
        >
          {isTranslationOnly ? (
            <div className="translation-only-result">
              <section className="result-capability-boundary" aria-labelledby="translation-only-title">
                <div>
                  <p className="eyebrow">本次能力边界</p>
                  <h2 id="translation-only-title">本次只完成了完整翻译</h2>
                  <p>没有生成行动、材料、截止日期或原文证据映射。这里的空白不代表原文没有这些要求。</p>
                </div>
                <button type="button" className="primary-button" onClick={handleConfigureAnalysis}>
                  <ListChecks size={19} weight="fill" />配置完整分析
                </button>
              </section>

              <section className="translation-only-copy" aria-labelledby="translation-copy-title">
                <div className="column-heading">
                  <div>
                    <p className="eyebrow">按原文顺序</p>
                    <h2 id="translation-copy-title">完整翻译</h2>
                  </div>
                  <span className="result-status result-status--translation_only">仅完成翻译</span>
                </div>
                <div className="translation-text">{normalizedBrief.translation?.text || '当前结果没有完整翻译。'}</div>
              </section>

              {normalizedBrief.warnings.length > 0 && (
                <section className="translation-only-warnings" aria-labelledby="translation-warning-title">
                  <h3 id="translation-warning-title"><WarningCircle size={18} />请留意</h3>
                  <ul>
                    {normalizedBrief.warnings.map((briefWarning, index) => (
                      <li key={briefWarning?.code || index}>
                        {typeof briefWarning === 'string' ? briefWarning : briefWarning?.message || '翻译结果包含需要留意的项目。'}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <>
          {(preference === 'translation'
            ? ['translation', 'action']
            : ['action', 'translation']).map((primarySection) => primarySection === 'action' ? (
          <div key="action" className="action-path">
            <div className="column-heading">
              <div>
                <p className="eyebrow">原文可追溯</p>
                <h2 id="action-title">行动路径</h2>
              </div>
              <span className={`result-status result-status--${displayStatus}`}>{statusLabel}</span>
            </div>

            {actionGroups.length > 0 && (
              <div className={`action-progress${allActionsComplete ? ' is-complete' : ''}`} role="status" aria-live="polite" aria-atomic="true">
                <span>
                  {allActionsComplete
                    ? <CheckCircle size={18} weight="fill" aria-hidden="true" />
                    : <ListChecks size={18} weight="bold" aria-hidden="true" />}
                  <strong>{allActionsComplete
                    ? `你已标记全部 ${actionGroups.length} 项完成`
                    : `你已标记 ${completedActionCount} / ${actionGroups.length} 项完成`}</strong>
                </span>
                <small id="action-progress-help">{allActionsComplete
                  ? '这是你的自报记录，不代表 Slipstream 已验证现实结果。若现实中也已办妥，可用底部“完成并返回”；清空后 10 秒内可撤销。'
                  : '这是你的当前窗口记录，不代表 Slipstream 已验证现实进度；可随时取消标记。'}</small>
              </div>
            )}

            <ol className="action-groups">
              {actionGroups.map((group, groupIndex) => {
                const stepColor = group.evidence[0]?.color || EVIDENCE_COLORS[groupIndex % EVIDENCE_COLORS.length];
                const isComplete = completedActionIdSet.has(group.id);
                const canCollapseCompletedEvidence = isComplete && group.evidence.length > 0;
                const completedEvidenceExpanded = canCollapseCompletedEvidence
                  && expandedCompletedActionIds.includes(group.id);
                const evidenceRegionId = `action-evidence-${groupIndex}`;
                const prerequisiteStepIds = Array.isArray(group.prerequisiteStepIds)
                  ? group.prerequisiteStepIds
                  : [];
                const incompletePrerequisiteNumbers = prerequisiteStepIds
                  .map((stepId, prerequisiteIndex) => (
                    completedActionIdSet.has(stepId)
                      ? null
                      : group.prerequisiteStepNumbers?.[prerequisiteIndex]
                  ))
                  .filter(Number.isSafeInteger);
                return (
                  <li
                    key={group.id}
                    className={`action-group${isComplete ? ' is-complete' : ''}${canCollapseCompletedEvidence && !completedEvidenceExpanded ? ' is-evidence-collapsed' : ''}`}
                    style={{ '--step-color': stepColor.solid, '--step-soft': stepColor.soft }}
                  >
                    <div className="action-group__heading">
                      <span className="action-step-number" aria-hidden="true">
                        {isComplete ? <CheckCircle size={17} weight="fill" /> : groupIndex + 1}
                      </span>
                      <div>
                        <h3>{group.title}</h3>
                        {group.detail && <p>{group.detail}</p>}
                        {prerequisiteStepIds.length > 0 && (
                          <p
                            className={`action-group__dependency${incompletePrerequisiteNumbers.length === 0 ? ' is-satisfied' : ''}${isComplete && incompletePrerequisiteNumbers.length > 0 ? ' has-progress-conflict' : ''}`}
                            aria-live="polite"
                          >
                            {isComplete && incompletePrerequisiteNumbers.length > 0
                              ? `进度需核对：第 ${incompletePrerequisiteNumbers.join('、')} 项尚未标记完成`
                              : incompletePrerequisiteNumbers.length > 0
                                ? `建议顺序：先完成第 ${incompletePrerequisiteNumbers.join('、')} 项`
                              : `前置步骤已标记完成 · 第 ${group.prerequisiteStepNumbers.join('、')} 项`}
                          </p>
                        )}
                        {canCollapseCompletedEvidence && (
                          <button
                            type="button"
                            className="completed-evidence-toggle"
                            aria-expanded={completedEvidenceExpanded}
                            aria-controls={evidenceRegionId}
                            onClick={() => handleToggleCompletedEvidence(group.id)}
                          >
                            {completedEvidenceExpanded
                              ? <CaretDown size={14} weight="bold" aria-hidden="true" />
                              : <CaretRight size={14} weight="bold" aria-hidden="true" />}
                            {completedEvidenceExpanded
                              ? '收起原文依据'
                              : `查看原文依据 · ${group.evidence.length} 条`}
                          </button>
                        )}
                      </div>
                      <div className="action-group__meta">
                        <ProvenanceBadge kind={group.provenance?.kind} />
                        <label className="action-completion-toggle">
                          <input
                            type="checkbox"
                            checked={isComplete}
                            onChange={() => handleActionCompletionChange(group.id)}
                            aria-describedby="action-progress-help"
                          />
                          <span>{isComplete ? '已标记完成' : '标记完成'}</span>
                        </label>
                      </div>
                    </div>

                    <div
                      id={evidenceRegionId}
                      className="evidence-list"
                      hidden={canCollapseCompletedEvidence && !completedEvidenceExpanded}
                    >
                      {group.evidence.length > 0 ? group.evidence.map((entry) => {
                        const active = effectiveEvidence === entry.id;
                        const muted = Boolean(effectiveEvidence && !active);
                        return (
                          <button
                            type="button"
                            key={entry.key}
                            ref={(node) => registerResultRef(entry.id, node)}
                            data-evidence-target="action"
                            aria-controls={`source-evidence-${entry.id}`}
                            className={`evidence-card${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
                            style={{ '--evidence-color': entry.color.solid, '--evidence-soft': entry.color.soft }}
                            onMouseEnter={() => setHoveredEvidence(entry.id)}
                            onMouseLeave={() => setHoveredEvidence(null)}
                            onFocus={() => setHoveredEvidence(entry.id)}
                            onBlur={() => setHoveredEvidence(null)}
                            onClick={() => focusEvidence(entry.id, 'source')}
                          >
                            <span className="evidence-card__number">{entry.id}</span>
                            <span className="evidence-card__label">原文明示</span>
                            <q lang={getContentLanguageTag(entry.quote, sourceLanguage)}>{entry.quote}</q>
                          </button>
                        );
                      }) : (
                        <div className="unverified-card">
                          <WarningCircle size={18} />
                          <span>没有可定位的原文证据，请将这条结论视为待核验。</span>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {actionGroups.length === 0 && (
              <div className="translation-only-state">
                <BookOpen size={21} />
                <div><strong>当前结果只有基础翻译</strong><p>未生成或推断行动路径，也没有添加缺少证据的彩色编号。</p></div>
              </div>
            )}
          </div>

          ) : (
          <div key="translation" className="translation-detail">
            <Disclosure
              id="result-translation"
              title="完整翻译"
              meta="按原文顺序"
              Icon={BookOpen}
              open={openSections.translation}
              onToggle={() => toggleSection('translation')}
            >
              <div className="translation-text">{normalizedBrief.translation?.text || '当前结果没有完整翻译。'}</div>
            </Disclosure>
          </div>
          ))}

          <div className="detail-stack">
            {normalizedBrief.explanation?.text && (
              <Disclosure
                id="result-explanation"
                title="补充解释"
                meta={hasExactGrounding(normalizedBrief.explanation, sourceText) ? '已连回原文证据' : '待核验 · 不作为顶部结论'}
                Icon={BookOpen}
                open={openSections.explanation}
                onToggle={() => toggleSection('explanation')}
                tone={hasExactGrounding(normalizedBrief.explanation, sourceText) ? 'neutral' : 'pending'}
              >
                <article className="explanation-card">
                  <div><ProvenanceBadge kind={normalizedBrief.explanation.provenance?.kind} /></div>
                  <p>{normalizedBrief.explanation.text}</p>
                  {renderLinkedEvidence(normalizedBrief.explanation, '解释原文')}
                </article>
              </Disclosure>
            )}

            <Disclosure
              id="result-materials"
              title="材料清单"
              meta={normalizedBrief.materials.length > 0 ? `${normalizedBrief.materials.length} 项 · 分别标注要求与证据` : '原文未列出材料'}
              Icon={FileText}
              open={openSections.materials}
              onToggle={() => toggleSection('materials')}
            >
              {normalizedBrief.materials.length > 0 ? normalizedBrief.materials.map((material) => (
                <article key={material.id} className="material-card">
                  <div>
                    <strong>{material.name}</strong>
                    <span className={`material-requirement material-requirement--${material.requirement}`}>
                      {MATERIAL_REQUIREMENT_LABELS[material.requirement] || '要求未明确'}
                    </span>
                  </div>
                  {material.details && <p>{material.details}</p>}
                  {renderLinkedEvidence(material, '材料原文')}
                </article>
              )) : <p className="empty-detail">原文没有列出可确认的材料要求。</p>}
            </Disclosure>

            <Disclosure
              id="result-deadlines"
              title="截止日期"
              meta={normalizedBrief.deadlines.length > 0 ? `${normalizedBrief.deadlines.length} 项 · 单独连回原文` : '原文未给出截止日期'}
              Icon={CalendarBlank}
              open={openSections.deadlines}
              onToggle={() => toggleSection('deadlines')}
              triggerRef={deadlineDisclosureRef}
            >
              {normalizedBrief.deadlines.length > 0 ? normalizedBrief.deadlines.map((deadlineItem) => {
                const itemUrgency = describeDeadlineUrgency(deadlineItem, deadlineReferenceNow);
                const isPrimaryDeadline = deadlineSelection.totalCount > 1 && deadlineItem.id === deadline?.id;
                return (
                  <article key={deadlineItem.id} className={`deadline-card${isPrimaryDeadline ? ' is-primary' : ''}`}>
                    <div className="deadline-card__heading">
                      <div>
                        <small>{isPrimaryDeadline ? '顶部优先提醒' : '截止日期'}</small>
                        <strong lang={getContentLanguageTag(deadlineItem.whenText, sourceLanguage)}>{deadlineItem.whenText}</strong>
                      </div>
                      <div className="deadline-card__status">
                        {itemUrgency && (
                          <span className={`deadline-card__urgency deadline-card__urgency--${itemUrgency.tone}`}>
                            {itemUrgency.label}
                          </span>
                        )}
                        <ProvenanceBadge kind={deadlineItem.provenance?.kind} />
                      </div>
                    </div>
                    {deadlineItem.condition && <p>{deadlineItem.condition}</p>}
                    {renderLinkedEvidence(deadlineItem, '日期原文', 'deadline')}
                  </article>
                );
              }) : <p className="empty-detail">原文没有可确认的截止日期。</p>}
            </Disclosure>

            <Disclosure
              id="result-terms"
              title="词语与术语"
              meta={normalizedBrief.terms.length > 0 ? `${normalizedBrief.terms.length} 项 · 区分词语、名称与专业概念` : '未识别到需单独解释的词语'}
              Icon={FileText}
              open={openSections.terms}
              onToggle={() => toggleSection('terms')}
            >
              {normalizedBrief.terms.length > 0 ? (
                <div className="term-browser">
                  <ul className="term-list" aria-label="词语与术语">
                    {normalizedBrief.terms.map((term) => (
                      <li key={term.id}>
                        <button
                          type="button"
                          aria-pressed={selectedTermId === term.id}
                          className={selectedTermId === term.id ? 'is-selected' : ''}
                          onClick={() => handleSelectTerm(term)}
                        >
                          <span lang={getContentLanguageTag(term.surface, sourceLanguage)}>{term.surface}</span>
                          <small>{TERM_KIND_LABELS[term.kind] || '其他词语'}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selectedTerm && (
                    <article className="term-detail">
                      <div className="term-detail__heading">
                        <div>
                          <small>{TERM_KIND_LABELS[selectedTerm.kind] || '其他词语'}</small>
                          <h3 lang={getContentLanguageTag(selectedTerm.surface, sourceLanguage)}>{selectedTerm.surface}</h3>
                        </div>
                        <ProvenanceBadge kind={selectedTerm.provenance?.kind} />
                      </div>
                      <p>{selectedTerm.explanation}</p>
                      {selectedTerm.provenance?.kind === 'pending' && (
                        <div className="knowledge-verification-note">
                          <WarningCircle size={15} />
                          <span>{selectedTermVerification
                          ? `对应待核验项：${selectedTermVerification.claim}`
                            : '这项解释仍待核验，当前没有可安全执行的官方查询。'}</span>
                        </div>
                      )}
                      {renderLinkedEvidence(selectedTerm, '词语原文')}
                      {onSaveTerm && (
                        <>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => handleSaveTerm(selectedTerm)}
                            disabled={selectedTermSaved || selectedTermSaving || savedTermsLoadPending}
                            aria-busy={selectedTermSaving || savedTermsLoadPending}
                          >
                            {selectedTermSaved ? <CheckCircle size={17} weight="fill" /> : <BookOpen size={17} />}
                            {selectedTermSaveLabel}
                          </button>
                          {savedTermsLoadFailed
                            && !(termError?.scope === 'save' && termError.id === selectedTerm.id) && (
                            <p className="term-operation-error" role="status">
                              {savedTermsReconciliationRequired
                                ? '暂时无法确认最近一次术语更改是否完成。请重试读取并核对实际状态。'
                                : '术语表读取失败；还没有更改任何术语。你可以重试检查并保存。'}
                            </p>
                          )}
                          {termError?.scope === 'save' && termError.id === selectedTerm.id && (
                            <p className="term-operation-error" role="alert">{termError.message}</p>
                          )}
                        </>
                      )}
                    </article>
                  )}
                </div>
              ) : <p className="empty-detail">原文中没有识别出需要单独解释的陌生词语、名称、表格、系统入口或专业概念。</p>}
            </Disclosure>

            <Disclosure
              id="result-context"
              title="流程背景"
              meta={normalizedBrief.contexts.length > 0 ? `${normalizedBrief.contexts.length} 条，均标注来源性质` : '原文未提供足够背景'}
              Icon={ListChecks}
              open={openSections.context}
              onToggle={() => toggleSection('context')}
            >
              {normalizedBrief.contexts.length > 0 ? normalizedBrief.contexts.map((context) => {
                const sections = getContextSections(context);
                const linkedVerification = context.verificationId
                  ? normalizedBrief.verifications.find((item) => item.id === context.verificationId) || null
                  : null;
                return (
                  <article key={context.id} className="context-card">
                    <div><strong>{context.label}</strong><ProvenanceBadge kind={context.provenance?.kind} /></div>
                    {sections.length > 0 ? (
                      <dl className="context-sections">
                        {sections.map((section) => (
                          <div key={section.label}>
                            <dt>{section.label}</dt>
                            <dd>{section.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : <p>{context.explanation}</p>}
                    {context.provenance?.kind === 'pending' && (
                      <div className="knowledge-verification-note">
                        <WarningCircle size={15} />
                        <span>{linkedVerification
                          ? `对应待核验项：${linkedVerification.claim}`
                          : '这段流程说明仍待核验，当前没有可安全执行的官方查询。'}</span>
                      </div>
                    )}
                    {renderLinkedEvidence(context, '背景原文')}
                  </article>
                );
              }) : <p className="empty-detail">没有添加脱离原文的宽泛背景判断。</p>}
            </Disclosure>

            <Disclosure
              id="result-sources"
              title="官方来源"
              meta={officialSourcesMeta}
              Icon={(officialCount > 0 || verifiedRetrievalReceipts.length > 0) && unresolvedCount === 0 ? SealCheck : ShieldCheck}
              open={openSections.sources}
              onToggle={() => toggleSection('sources')}
              triggerRef={officialSourcesTriggerRef}
              tone={(officialCount > 0 || verifiedRetrievalReceipts.length > 0) && unresolvedCount === 0 ? 'official' : 'pending'}
            >
              {citations.map((citation) => (
                <article key={citation.id || citation.url} className="source-citation">
                  <SealCheck size={20} weight="fill" />
                  <div>
                    <strong lang={inferTextLanguageTag(citation.title)}>{citation.title}</strong>
                    <span>{citation.publisher}</span>
                    {citation.quote && <blockquote lang={inferTextLanguageTag(citation.quote)}>{citation.quote.slice(0, 180)}</blockquote>}
                    <code>{citation.url}</code>
                  </div>
                  <div className="citation-actions">
                    {onOpenExternal && (
                      <button
                        type="button"
                        className="text-button source-action-button"
                        onClick={() => handleOpenSource(citation.url)}
                        disabled={sourceActionBusy}
                        aria-busy={sourceAction.kind === 'open' && sourceAction.url === citation.url && sourceAction.status === 'opening'}
                      >
                        {sourceActionIcon('open', citation.url, <ArrowSquareOut size={16} />)}
                        {sourceActionLabel('open', citation.url, '打开来源')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button source-action-button"
                      data-source-link-copy-action
                      data-clipboard-write-action="source-link"
                      onClick={() => handleCopySourceLink(citation.url)}
                      disabled={sourceActionBusy || clipboardWritePending}
                      aria-busy={sourceAction.kind === 'copy' && sourceAction.url === citation.url && sourceAction.status === 'copying'}
                    >
                      {sourceActionIcon('copy', citation.url, <Copy size={16} />)}
                      {sourceAction.kind === 'copy' && sourceAction.url === citation.url
                        ? sourceActionLabel('copy', citation.url, '复制链接')
                        : clipboardWritePending ? '等待当前复制…' : '复制链接'}
                    </button>
                  </div>
                </article>
              ))}
              {retrievalReceipts.map((receipt) => (
                <article key={`${receipt.url}:${receipt.retrievedAt || ''}`} className="source-receipt">
                  <FileText size={20} />
                  <div>
                    <strong>{receipt.publisher || receipt.host}</strong>
                    <span>{receipt.claim}</span>
                    {receipt.excerpt && <blockquote lang={inferTextLanguageTag(receipt.excerpt)}>{receipt.excerpt.slice(0, 180)}</blockquote>}
                    <code>{receipt.url}</code>
                    <time dateTime={receipt.retrievedAt}>检索时间：{receipt.retrievedAt}</time>
                    <small>{receipt.verificationStatus === 'verified'
                      ? '用于已核验结论的官方页面'
                      : '已找到官方页面，结论仍需确认'}</small>
                  </div>
                  <div className="citation-actions">
                    {onOpenExternal && (
                      <button
                        type="button"
                        className="text-button source-action-button"
                        onClick={() => handleOpenSource(receipt.url)}
                        disabled={sourceActionBusy}
                        aria-busy={sourceAction.kind === 'open' && sourceAction.url === receipt.url && sourceAction.status === 'opening'}
                      >
                        {sourceActionIcon('open', receipt.url, <ArrowSquareOut size={16} />)}
                        {sourceActionLabel('open', receipt.url, '打开页面')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button source-action-button"
                      data-source-link-copy-action
                      data-clipboard-write-action="source-link"
                      onClick={() => handleCopySourceLink(receipt.url)}
                      disabled={sourceActionBusy || clipboardWritePending}
                      aria-busy={sourceAction.kind === 'copy' && sourceAction.url === receipt.url && sourceAction.status === 'copying'}
                    >
                      {sourceActionIcon('copy', receipt.url, <Copy size={16} />)}
                      {sourceAction.kind === 'copy' && sourceAction.url === receipt.url
                        ? sourceActionLabel('copy', receipt.url, '复制链接')
                        : clipboardWritePending ? '等待当前复制…' : '复制链接'}
                    </button>
                  </div>
                </article>
              ))}
              {needsOfficialVerification ? (
                <div className="pending-source">
                  <WarningCircle size={20} />
                  <div>
                    <p>{verificationPolicy === 'local-only'
                      ? '当前为仅本地模式，不会访问外部来源。涉及政策、签证或机构流程的内容仍需你自行核验。'
                      : unconfirmedRetrievalReceipts.length > 0
                        ? '已读取候选官方页面，但页面检索不等于语义确认；相关结论仍保持待核验。'
                        : '当前结论只依据捕获原文，尚未读取官方来源。涉及政策、签证或机构流程时，请核对相关机构官网。'}</p>
                    {showLookupApproval && verificationTargets.length > 0 && (
                      <div className="verification-targets">
                        <strong>{hasPriorVerificationAttempt
                          ? '再次批准将访问以下候选官方页面'
                          : '批准后将访问以下候选官方页面'}</strong>
                        <ul>
                          {verificationTargets.map((target) => (
                            <li key={target.url}>
                              <code>{target.host}</code>
                              <span>{target.page}</span>
                            </li>
                          ))}
                        </ul>
                        <small>访问这些页面时仅使用候选地址和最小检索词；所选模型仍按顶部隐私提示处理原文。候选地址在核验前不是证据或引用。</small>
                      </div>
                    )}
                    {showLookupApproval && govUkDiscoveryPlans.length > 0 && (
                      <div className="verification-targets">
                        <strong>{hasPriorVerificationAttempt
                          ? '再次批准将用最小检索词在 GOV.UK 查找最多 3 个页面'
                          : '批准后将用最小检索词在 GOV.UK 查找最多 3 个页面'}</strong>
                        <ul>
                          {govUkDiscoveryPlans.map((plan) => (
                            <li key={`${plan.publisher}:${plan.query}`}>
                              <code>最小检索词</code>
                              <span lang={inferTextLanguageTag(plan.query)}>{plan.query}</span>
                            </li>
                          ))}
                        </ul>
                        <small>不会发送完整原文；仅向 GOV.UK Search 发送上面显示的最小检索词。提交前请确认检索词不含个人信息。找到页面不等于结论已核验。</small>
                      </div>
                    )}
                    {verificationPolicy === 'ask' && !canRequestOfficialSources && (
                      <p className="no-verification-target">没有可明确展示的候选官方页面，也没有受支持的 GOV.UK 检索计划，因此不会发起网络查找。</p>
                    )}
                    {verificationApprovalUnavailable && (
                      <div className="verification-recovery" role="note">
                        <strong>这份核验批准已失效</strong>
                        <span>原文和当前结果仍保留；重新分析后会生成一份新的、可预览的核验方案。</span>
                        {onRetry && (
                          <button type="button" onClick={onRetry} disabled={isVerifying}>
                            <ArrowCounterClockwise size={15} />重新分析并生成核验方案
                          </button>
                        )}
                      </div>
                    )}
                    {showLookupApproval && (
                      <div className="verification-actions">
                        <button
                          ref={verificationApprovalRef}
                          type="button"
                          className="verify-button"
                          onClick={onVerifyOfficialSources}
                          disabled={isVerifying || !onVerifyOfficialSources}
                          aria-busy={isVerifying}
                          aria-live="polite"
                        >
                          <ShieldCheck size={18} weight={isVerifying ? 'regular' : 'fill'} />
                          {isVerifying
                            ? '正在查找官方页面…'
                            : hasPriorVerificationAttempt ? '批准并重新查找官方来源' : '批准并查找官方来源'}
                        </button>
                        {isVerifying && onCancelVerification && (
                          <button
                            type="button"
                            className="verification-cancel-button"
                            onClick={cancelOfficialVerification}
                            disabled={isCancellingVerification}
                            aria-busy={isCancellingVerification}
                          >
                            <X size={16} />{isCancellingVerification ? '正在停止…' : '取消查找'}
                          </button>
                        )}
                      </div>
                    )}
                    {verificationPolicy === 'official-auto' && (
                      <span className="auto-verification-note"><ShieldCheck size={17} />自动查找会在每次新分析中运行；找到页面不等于结论已核验</span>
                    )}
                  </div>
                </div>
              ) : officialCount === 0 && retrievalReceipts.length === 0 ? (
                <p className="empty-detail">这份原文没有需要补充官方来源的外部声明。</p>
              ) : null}
            </Disclosure>

            <Disclosure
              id="result-verification"
              title="待核验"
              meta={unresolvedMeta}
              Icon={WarningCircle}
              open={openSections.verification}
              onToggle={() => toggleSection('verification')}
              tone={unresolvedCount > 0 ? 'pending' : 'official'}
            >
              {normalizedBrief.verifications.length > 0 ? normalizedBrief.verifications.map((verification) => (
                <article key={verification.id} className="verification-card">
                  <span className={`verification-status verification-status--${verification.status}`}>{VERIFICATION_LABELS[verification.status] || verification.status}</span>
                  <div className="verification-card__body">
                    <strong>{verification.claim}</strong>
                    <p>{verification.reason}</p>
                    {catalogEntriesFor(verification, evidenceCatalog).length > 0
                      ? renderLinkedEvidence(verification, '触发核验的原文', 'verification')
                      : verification.provenance?.kind !== 'official' && (
                        <div className="unverified-card unverified-card--compact">
                          <WarningCircle size={16} />
                          <span>这条核验声明没有可定位的原文片段。</span>
                        </div>
                      )}
                    {renderVerificationCitations(verification)}
                    {['pending', 'retrieved', 'failed'].includes(verification.status) && needsOfficialVerification && (
                      <button type="button" className="verification-plan-link" onClick={openOfficialVerificationPlan}>
                        <ShieldCheck size={16} />{verificationPlanActionLabel}
                      </button>
                    )}
                  </div>
                </article>
              )) : <p className="empty-detail">没有额外待核验声明。</p>}
            </Disclosure>

            {normalizedBrief.warnings.length > 0 && (
              <Disclosure
                id="result-warnings"
                title="分析提醒"
                meta={`${normalizedBrief.warnings.length} 项`}
                Icon={WarningCircle}
                open={openSections.warnings}
                onToggle={() => toggleSection('warnings')}
                tone="pending"
              >
                <div className="brief-warning-list">
                  {normalizedBrief.warnings.map((briefWarning, index) => (
                    <article key={briefWarning?.code || index} className="brief-warning">
                      <WarningCircle size={17} />
                      <span>{typeof briefWarning === 'string' ? briefWarning : briefWarning?.message || '分析结果包含需要留意的项目。'}</span>
                    </article>
                  ))}
                </div>
              </Disclosure>
            )}
          </div>
            </>
          )}
        </section>
      </div>

      <p className="result-a11y-live" role="status" aria-live="polite">{termAnnouncement}</p>

      {!replyDialogOpen && (
        <ClipboardActionNotice
          notice={clipboardNotice}
          onAcknowledge={handleAcknowledgeClipboardConsequence}
          onDismiss={() => {
            setClipboardNotice((current) => dismissClipboardNotice(current));
          }}
        />
      )}

      <ClipboardActionNotice
        notice={sourceOpenNotice}
        onDismiss={() => setSourceOpenNotice({ status: 'idle' })}
      />

      <footer className="result-footer">
        <div className="result-actions">
          {!isTranslationOnly && (
            <>
              {replyRequired && (
              <button
                ref={replyTriggerRef}
                type="button"
                className={replyActionCompleted ? 'secondary-button' : 'primary-button'}
                onClick={openReplyDraft}
              >
                <PaperPlaneTilt size={21} weight="fill" />
                {replyActionCompleted ? '再次准备英文回复' : '准备英文回复'}
              </button>
              )}
              <button
                type="button"
                className={replyRequired ? 'secondary-button' : 'primary-button'}
                data-actions-copy-action
                data-clipboard-write-action="actions"
                onClick={handleCopyActions}
                disabled={clipboardWritePending || (actionGroups.length === 0 && normalizedBrief.materials.length === 0 && normalizedBrief.deadlines.length === 0)}
                aria-busy={actionCopyState === 'copying'}
              >
                {actionCopyState === 'success' ? <CheckCircle size={21} weight="fill" /> : <ListChecks size={21} />}
                {actionCopyState === 'copying'
                  ? '正在复制…'
                  : clipboardWritePending
                    ? '等待当前复制…'
                    : actionCopyState === 'error' ? '复制失败' : actionCopyState === 'success' ? '已复制行动清单' : '复制行动清单'}
              </button>
            </>
          )}
          <button
            type="button"
            className="secondary-button"
            data-result-copy-action
            data-clipboard-write-action="result"
            onClick={handleCopyResult}
            disabled={clipboardWritePending}
            aria-busy={copyState === 'copying'}
          >
            {copyState === 'success' ? <CheckCircle size={20} weight="fill" /> : <Copy size={20} />}
            {copyState === 'copying'
              ? '正在复制…'
              : clipboardWritePending
                ? '等待当前复制…'
                : copyState === 'error' ? '复制失败' : copyState === 'success' ? '已复制结果' : '复制结果'}
          </button>
          <button type="button" className="secondary-button" onClick={onEditSource}>
            <PencilSimpleLine size={20} />{hasSourceEditDraft ? '继续修正原文' : '修正原文'}
          </button>
          <button type="button" className="secondary-button" onClick={onRecapture}>
            <Camera size={20} />重新截图
          </button>
          <button type="button" className="secondary-button secondary-button--quiet" onClick={onRetry}>
            <ArrowCounterClockwise size={19} />{retryLabel || (isTranslationOnly ? '重新翻译' : '重新分析')}
          </button>
        </div>
        <div className="result-completion">
          <h2 id="result-processing-completion-heading" className="completion-heading">
            <button
              id="result-processing-completion"
              type="button"
              className="completion-button"
              onClick={() => setShowProcess((current) => !current)}
              aria-expanded={showProcess}
              aria-controls="result-processing-completion-panel"
              aria-label={completionButtonLabel}
            >
              <CheckCircle size={20} weight="fill" aria-hidden="true" />
              {processingCompletionLabel} · {completionTimingLabel}
              <span className="completion-button__detail-label"> · 查看处理详情</span>
              {showProcess
                ? <CaretDown size={17} aria-hidden="true" />
                : <CaretRight size={17} aria-hidden="true" />}
            </button>
          </h2>
          <div
            id="result-processing-completion-panel"
            className="completion-popover"
            role="region"
            aria-labelledby="result-processing-completion"
            hidden={!showProcess}
          >
            {completionStages.map(({ label, detail, Icon }) => (
              <div key={label}>
                <Icon size={18} aria-hidden="true" />
                <span><strong>{label}</strong><small>{detail}</small></span>
                <CheckCircle size={18} weight="fill" aria-hidden="true" />
              </div>
            ))}
            {processingPrivacyDisclosure && (
              <div
                className={`completion-privacy completion-privacy--${processingLocation}`}
                role="note"
                aria-label="这份结果的处理位置"
              >
                <ProcessingLocationIcon size={18} weight="fill" aria-hidden="true" />
                <span>
                  <strong>{processingPrivacyDisclosure.resultTitle}</strong>
                  <small>{processingPrivacyDisclosure.resultDetail}</small>
                </span>
              </div>
            )}
            <p><Clock size={16} aria-hidden="true" /> {isTranslationOnly
              ? '本次没有执行行动提取或证据映射。'
              : '处理阶段已折叠；你可以随时在这里复核。'}</p>
          </div>
        </div>
        <button
          ref={newCaptureButtonRef}
          type="button"
          className={`new-capture-button${allActionsComplete ? ' new-capture-button--complete' : ''}`}
          onClick={onNewCapture}
          aria-label={allActionsComplete
            ? '完成任务并清空当前原文和结果，返回捕获；10 秒内可撤销'
            : '清空当前原文和结果并返回捕获，10 秒内可撤销'}
          title={allActionsComplete ? '完成任务并返回，10 秒内可撤销' : '清空当前内容，10 秒内可撤销'}
        >
          {allActionsComplete && <CheckCircle size={17} weight="fill" aria-hidden="true" />}
          {allActionsComplete ? '完成并返回' : '清空并返回'}
        </button>
      </footer>

      {replyDialogOpen && createPortal((
        <div className="reply-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeReplyDraft();
        }}>
          <section ref={replyDialogRef} className="reply-drawer" role="dialog" aria-modal="true" aria-labelledby="reply-drawer-title" tabIndex={-1}>
            <header>
              <div>
                <p className="eyebrow">可编辑 · 不会自动发送</p>
                <h2 id="reply-drawer-title">{replyDraftModel.title}</h2>
              </div>
              <button type="button" className="icon-button" onClick={closeReplyDraft} aria-label="关闭回复草稿"><X size={20} /></button>
            </header>
            {replyCaptureNotice && (
              <div className="reply-capture-notice" role="status" aria-live="polite">
                <ShieldCheck size={19} weight="fill" aria-hidden="true" />
                <span>
                  <strong>新的捕获请求已安全保留</strong>
                  <small>{replyCaptureNotice}</small>
                </span>
              </div>
            )}
            <div className="reply-safety-note">
              <ShieldCheck size={20} weight="fill" />
              <p>
                <strong>{replyCompletionStatus === 'completed'
                  ? '草稿会声明你已经完成。'
                  : replyCompletionStatus === 'in_progress'
                    ? '草稿不会声称已经完成。'
                    : '先确认真实状态。'}</strong>
                {replyCompletionStatus === 'completed'
                  ? '只有在你确实完成原文要求并提供所需材料时，才复制这封回复。'
                  : replyCompletionStatus === 'in_progress'
                    ? '这封回复会明确说明仍在处理中，并承诺完成后再次确认。'
                    : replyDraftModel.safetyNote}
              </p>
            </div>
            {actionGroups.length > 0 && (
              <div className="reply-progress-context" role="note">
                <ListChecks size={18} weight="bold" aria-hidden="true" />
                <span>
                  行动路径中已标记 {completedActionCount} / {actionGroups.length} 项完成。
                  {replyProgressConsistency.requiredCount > 0 && (
                    <> 回复前要求的行动为 {replyProgressConsistency.completedCount} / {replyProgressConsistency.requiredCount} 项；回复本身不计入前置进度。</>
                  )}
                  这只是你的当前窗口记录，回复状态仍请按现实进度选择。
                </span>
              </div>
            )}
            <fieldset className="reply-status-picker">
              <legend>你现在的真实状态</legend>
              <label className={replyCompletionStatus === 'completed' ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="reply-status"
                  value="completed"
                  checked={replyCompletionStatus === 'completed'}
                  onChange={() => handleReplyStatusChange('completed')}
                  aria-describedby={replyCompletedClaimMismatch ? 'reply-progress-mismatch' : undefined}
                />
                <span>
                  <strong>我已完成原文要求</strong>
                  <small>生成确认已完成、已提供所需材料的回复。</small>
                </span>
              </label>
              <label className={replyCompletionStatus === 'in_progress' ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="reply-status"
                  value="in_progress"
                  checked={replyCompletionStatus === 'in_progress'}
                  onChange={() => handleReplyStatusChange('in_progress')}
                />
                <span>
                  <strong>我还没有完成</strong>
                  <small>生成一封说明仍在处理、完成后会再次确认的回复。</small>
                </span>
              </label>
            </fieldset>
            {replyCompletedClaimMismatch && (
              <div id="reply-progress-mismatch" className="reply-progress-mismatch" role="alert">
                <WarningCircle size={19} weight="fill" aria-hidden="true" />
                <div>
                  <strong>完成声明与当前行动记录不一致</strong>
                  <p>
                    回复前仍有 {replyProgressConsistency.remainingActionIds.length} 项未标记完成
                    {replyMissingActionNumbers.length > 0 ? `（第 ${replyMissingActionNumbers.join('、')} 项）` : ''}。
                    如果记录反映现实进度，请改选“我还没有完成”。
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={replyProgressOverrideConfirmed}
                      onChange={(event) => {
                        setReplyProgressOverrideConfirmed(event.target.checked);
                        setReplyCopyState('idle');
                      }}
                    />
                    <span>
                      <strong>我确认清单尚未更新，现实中已经完成原文要求</strong>
                      <small>这只解除本次回复的复制限制，不会自动把行动项标记完成。</small>
                    </span>
                  </label>
                </div>
              </div>
            )}
            {replyDraftModel.facts.length > 0 && (
              <details className="reply-grounding">
                <summary>查看草稿依据的原文要求 · {replyDraftModel.facts.length} 项</summary>
                <ul>
                  {replyDraftModel.facts.map((fact, index) => (
                    <li key={`${fact.label}:${index}`}>
                      <span>{REPLY_FACT_LABELS[fact.label] || '原文要求'}</span>
                      <q lang={getContentLanguageTag(fact.value, sourceLanguage)}>{fact.value}</q>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <label>
              <span>英文回复草稿 · 复制前可以继续修改</span>
              <textarea
                ref={replyTextareaRef}
                value={replyDraft}
                onChange={(event) => {
                  setReplyDraft(event.target.value);
                  const nextSelection = {
                    start: event.target.selectionStart ?? 0,
                    end: event.target.selectionEnd ?? event.target.selectionStart ?? 0,
                    direction: event.target.selectionDirection || 'none',
                  };
                  replySelectionRef.current = nextSelection;
                  setReplySelection(nextSelection);
                  setReplyCopyState('idle');
                  setClipboardNotice((current) => markCopiedClipboardNoticeOutdated(current, 'reply'));
                }}
                onSelect={rememberReplySelection}
                aria-label="英文回复草稿"
                aria-describedby={replyPlaceholders.length > 0 ? 'reply-placeholder-warning' : undefined}
                lang="en"
                placeholder="请先选择上方的真实完成状态"
                disabled={replyCompletionStatus === 'unconfirmed'}
              />
            </label>
            {replyPlaceholders.length > 0 && (
              <div id="reply-placeholder-warning" className="reply-placeholder-warning" role="alert">
                <WarningCircle size={19} weight="fill" aria-hidden="true" />
                <span>
                  <strong>还有 {replyPlaceholders.length} 处需要填写</strong>
                  <small>请把 {replyPlaceholders.join('、')} 替换成真实内容；填写完成后才能复制。</small>
                </span>
              </div>
            )}
            <ClipboardActionNotice
              notice={clipboardNotice}
              onAcknowledge={handleAcknowledgeClipboardConsequence}
              onDismiss={() => {
                setClipboardNotice((current) => dismissClipboardNotice(current));
              }}
              inline
            />
            <footer>
              {replyCopyBlockSummary && (
                <span className="reply-copy-block-summary" role="status" aria-live="polite">
                  复制前还需：{replyCopyBlockSummary}
                </span>
              )}
              <button type="button" className="secondary-button" onClick={closeReplyDraft}>关闭</button>
              <button
                type="button"
                className="primary-button"
                data-reply-copy-action
                onClick={handleCopyReply}
                disabled={replyCopyBlocked || clipboardWritePending || replyCopyState === 'copying'}
                aria-busy={replyCopyPending || replyCopyState === 'copying'}
                aria-describedby={replyCopyDescriptionIds}
              >
                {replyCopyState === 'success' ? <CheckCircle size={19} weight="fill" /> : <Copy size={19} />}
                {replyCopyPending || replyCopyState === 'copying'
                  ? '正在复制…'
                  : clipboardWritePending
                    ? '等待当前复制…'
                  : replyCopyState === 'error'
                    ? '复制失败'
                    : replyCopyState === 'success' ? '已复制回复' : '复制回复'}
              </button>
            </footer>
          </section>
        </div>
      ), document.querySelector('.slipstream-shell') || document.body)}
    </main>
  );
}
