import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Copy,
  FileText,
  ListChecks,
  MagnifyingGlass,
  PaperPlaneTilt,
  SealCheck,
  ShieldCheck,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import constants from '../../shared/constants';
import { PROCESSING_STAGES } from './LoadingOverlay';
import {
  EVIDENCE_COLORS,
  buildReplyDraft,
  buildActionGroups,
  buildEvidenceCatalog,
  catalogEntriesFor,
  composeActionChecklistText,
  composeCompleteResultText,
  getEvidenceNavigationAnnouncement,
  getEvidenceResultRoute,
  getHeadline,
  hasExactGrounding,
  isTranslationOnlyBrief,
  shouldOfferReply,
} from '../utils/evidenceMapping.mjs';
import './ResultDisplay.css';

const { IPC_CHANNELS } = constants;

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

async function copyText(text) {
  if (window.api?.invoke) return window.api.invoke(IPC_CHANNELS.CLIPBOARD_WRITE, text);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  throw new Error('Clipboard is unavailable.');
}

function Disclosure({ title, meta, Icon, open, onToggle, tone = 'neutral', children }) {
  return (
    <section className={`disclosure disclosure--${tone}`}>
      <button type="button" className="disclosure__trigger" onClick={onToggle} aria-expanded={open}>
        <span className="disclosure__title">
          <Icon size={19} weight="regular" />
          <span>{title}</span>
          {meta && <small>{meta}</small>}
        </span>
        {open ? <CaretDown size={18} /> : <CaretRight size={18} />}
      </button>
      {open && <div className="disclosure__content">{children}</div>}
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
  processingTimeMs,
  preference,
  verificationPolicy,
  isVerifying,
  onVerifyOfficialSources,
  onOpenExternal,
  onConfigureAnalysis,
  onRetry,
  onRecapture,
  onNewCapture,
  onSaveTerm,
  savedTerms,
  onDeleteTerm,
}) {
  const normalizedBrief = useMemo(() => normalizeBrief(brief, result, sourceText), [brief, result, sourceText]);
  const isTranslationOnly = isTranslationOnlyBrief(normalizedBrief);
  const evidenceCatalog = useMemo(
    () => (isTranslationOnly ? [] : buildEvidenceCatalog(normalizedBrief, sourceText)),
    [isTranslationOnly, normalizedBrief, sourceText],
  );
  const actionGroups = useMemo(
    () => (isTranslationOnly ? [] : buildActionGroups(normalizedBrief, evidenceCatalog)),
    [isTranslationOnly, normalizedBrief, evidenceCatalog],
  );
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
  const replyDraftModel = useMemo(() => buildReplyDraft(normalizedBrief), [normalizedBrief]);
  const completionStages = isTranslationOnly ? TRANSLATION_PROCESSING_STAGES : PROCESSING_STAGES;
  const effectivePreference = isTranslationOnly ? 'translation' : preference;
  const [hoveredEvidence, setHoveredEvidence] = useState(null);
  const [pinnedEvidence, setPinnedEvidence] = useState(null);
  const [selectedTermId, setSelectedTermId] = useState(normalizedBrief.terms[0]?.id || null);
  const [copyState, setCopyState] = useState('idle');
  const [actionCopyState, setActionCopyState] = useState('idle');
  const [savedTermId, setSavedTermId] = useState(null);
  const [showProcess, setShowProcess] = useState(false);
  const [showReplyDraft, setShowReplyDraft] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyCopyState, setReplyCopyState] = useState('idle');
  const [evidenceAnnouncement, setEvidenceAnnouncement] = useState('');
  const [mobilePane, setMobilePane] = useState('action');
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
  const sourceRefs = useRef(new Map());
  const resultRefs = useRef(new Map());
  const headlineRef = useRef(null);
  const replyTriggerRef = useRef(null);
  const replyDialogRef = useRef(null);
  const effectiveEvidence = hoveredEvidence || pinnedEvidence;

  useEffect(() => {
    if (!active) return undefined;
    window.requestAnimationFrame(() => headlineRef.current?.focus({ preventScroll: true }));
    return undefined;
  }, [active]);

  useEffect(() => {
    if (isTranslationOnly || preference === 'translation') {
      setOpenSections((current) => ({ ...current, translation: true }));
    }
  }, [isTranslationOnly, preference]);

  useEffect(() => {
    if (!normalizedBrief.terms.some((term) => term.id === selectedTermId)) {
      setSelectedTermId(normalizedBrief.terms[0]?.id || null);
    }
  }, [normalizedBrief.terms, selectedTermId]);

  useEffect(() => {
    if (!showReplyDraft) return undefined;
    const dialog = replyDialogRef.current;
    const trigger = replyTriggerRef.current;
    const background = dialog?.closest('.result-view');
    const hiddenSiblings = background
      ? [...background.children].filter((node) => !node.classList.contains('reply-drawer-backdrop'))
      : [];
    const previousAria = hiddenSiblings.map((node) => node.getAttribute('aria-hidden'));
    hiddenSiblings.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowReplyDraft(false);
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', handleDialogKeyDown);
    window.requestAnimationFrame(() => dialog?.querySelector('textarea')?.focus());
    return () => {
      dialog?.removeEventListener('keydown', handleDialogKeyDown);
      hiddenSiblings.forEach((node, index) => {
        node.inert = false;
        if (previousAria[index] === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previousAria[index]);
      });
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [showReplyDraft]);

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
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const handleCopyResult = useCallback(async () => {
    try {
      await copyText(composeCompleteResultText(normalizedBrief, {
        additionalWarnings: warning ? [warning] : [],
      }) || result || '');
      setCopyState('success');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  }, [normalizedBrief, result, warning]);

  const handleCopyActions = useCallback(async () => {
    try {
      await copyText(composeActionChecklistText(normalizedBrief, {
        additionalWarnings: warning ? [warning] : [],
      }));
      setActionCopyState('success');
      window.setTimeout(() => setActionCopyState('idle'), 1800);
    } catch {
      setActionCopyState('error');
    }
  }, [normalizedBrief, warning]);

  const openReplyDraft = useCallback(() => {
    setReplyDraft(replyDraftModel.text);
    setReplyCopyState('idle');
    setShowReplyDraft(true);
  }, [replyDraftModel]);

  const handleConfigureAnalysis = useCallback(() => {
    if (onConfigureAnalysis) {
      onConfigureAnalysis();
      return;
    }
    document.querySelector('button[aria-label="打开设置"]')?.click();
  }, [onConfigureAnalysis]);

  const handleCopyReply = useCallback(async () => {
    try {
      await copyText(replyDraft);
      setReplyCopyState('success');
      window.setTimeout(() => setReplyCopyState('idle'), 1800);
    } catch {
      setReplyCopyState('error');
    }
  }, [replyDraft]);

  const handleSelectTerm = useCallback((term) => {
    setSelectedTermId(term.id);
  }, []);

  const handleSaveTerm = useCallback(async (term) => {
    if (!onSaveTerm) return;
    await onSaveTerm(term);
    setSavedTermId(term.id);
    window.setTimeout(() => setSavedTermId(null), 1800);
  }, [onSaveTerm]);

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
          aria-label={`证据 ${entry.id}：${entry.quote}`}
          aria-controls="result-insight"
          aria-describedby="evidence-navigation-status"
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
  const selectedTermVerification = selectedTerm?.verificationId
    ? normalizedBrief.verifications.find((item) => item.id === selectedTerm.verificationId) || null
    : null;
  const deadline = isTranslationOnly ? null : normalizedBrief.deadlines[0];
  const replyRequired = !isTranslationOnly && shouldOfferReply(normalizedBrief);
  const officialCount = citations.length;
  const pendingCount = normalizedBrief.verifications.filter((item) => item.status === 'pending').length;
  const retrievedCount = normalizedBrief.verifications.filter((item) => item.status === 'retrieved').length;
  const failedCount = normalizedBrief.verifications.filter((item) => item.status === 'failed').length;
  const unresolvedCount = pendingCount + retrievedCount + failedCount;
  const hasPriorVerificationAttempt = retrievedCount > 0 || failedCount > 0;
  const canRequestOfficialSources = verificationTargets.length > 0 || govUkDiscoveryPlans.length > 0;
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
              aria-label={`${label}，证据 ${entry.id}：${entry.quote}`}
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
              <q>{entry.quote}</q>
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
              <span>{citation.title || citation.publisher}</span>
              {citation.quote && <q>{citation.quote}</q>}
              <code>{citation.url}</code>
            </div>
            {onOpenExternal && (
              <button type="button" className="text-button" onClick={() => onOpenExternal(citation.url)}>
                <ArrowSquareOut size={15} />打开
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="result-view">
      <p id="evidence-navigation-status" className="result-a11y-live" aria-live="polite" aria-atomic="true">
        {evidenceAnnouncement}
      </p>
      <section className="result-summary" aria-labelledby="result-headline">
        <div>
          <p className="eyebrow">{isTranslationOnly ? '翻译结果' : '结论'}</p>
          <h1 id="result-headline" ref={headlineRef} tabIndex={-1}>{headline}</h1>
        </div>
        <div className="summary-meta" aria-label="关键信息">
          {deadline && (
            <span><CalendarBlank size={18} /> 截止日期 · {deadline.whenText}</span>
          )}
          {replyRequired && (
            <span><FileText size={18} /> 需要回复</span>
          )}
        </div>
      </section>

      {warning && (
        <div className="inline-warning" role="note">
          <WarningCircle size={18} weight="fill" />
          <span>{warning}</span>
        </div>
      )}

      <main className="evidence-workspace" data-mobile-pane={mobilePane}>
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
            {isTranslationOnly ? <BookOpen size={17} /> : <ListChecks size={17} />}
            {isTranslationOnly ? '完整翻译' : '行动与解释'}
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
          <div className="source-paper" lang={normalizedBrief.source?.language || 'en'}>
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
                  <ListChecks size={19} weight="fill" />配置智能分析
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
          <div className="action-path" style={{ order: preference === 'action' ? 1 : 2 }}>
            <div className="column-heading">
              <div>
                <p className="eyebrow">原文可追溯</p>
                <h2 id="action-title">行动路径</h2>
              </div>
              <span className={`result-status result-status--${displayStatus}`}>{statusLabel}</span>
            </div>

            <ol className="action-groups">
              {actionGroups.map((group, groupIndex) => {
                const stepColor = group.evidence[0]?.color || EVIDENCE_COLORS[groupIndex % EVIDENCE_COLORS.length];
                return (
                  <li key={group.id} className="action-group" style={{ '--step-color': stepColor.solid, '--step-soft': stepColor.soft }}>
                    <div className="action-group__heading">
                      <span className="action-step-number">{groupIndex + 1}</span>
                      <div>
                        <h3>{group.title}</h3>
                        {group.detail && <p>{group.detail}</p>}
                      </div>
                      <ProvenanceBadge kind={group.provenance?.kind} />
                    </div>

                    <div className="evidence-list">
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
                            aria-label={`行动项原文，证据 ${entry.id}：${entry.quote}`}
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
                            <q>{entry.quote}</q>
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

          <div className="translation-detail" style={{ order: preference === 'translation' ? 1 : 2 }}>
            <Disclosure
              title="完整翻译"
              meta="按原文顺序"
              Icon={BookOpen}
              open={openSections.translation}
              onToggle={() => toggleSection('translation')}
            >
              <div className="translation-text">{normalizedBrief.translation?.text || '当前结果没有完整翻译。'}</div>
            </Disclosure>
          </div>

          <div className="detail-stack" style={{ order: 3 }}>
            {normalizedBrief.explanation?.text && (
              <Disclosure
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
              title="截止日期"
              meta={normalizedBrief.deadlines.length > 0 ? `${normalizedBrief.deadlines.length} 项 · 单独连回原文` : '原文未给出截止日期'}
              Icon={CalendarBlank}
              open={openSections.deadlines}
              onToggle={() => toggleSection('deadlines')}
            >
              {normalizedBrief.deadlines.length > 0 ? normalizedBrief.deadlines.map((deadlineItem) => (
                <article key={deadlineItem.id} className="deadline-card">
                  <div className="deadline-card__heading">
                    <div>
                      <small>截止日期</small>
                      <strong>{deadlineItem.whenText}</strong>
                    </div>
                    <ProvenanceBadge kind={deadlineItem.provenance?.kind} />
                  </div>
                  {deadlineItem.condition && <p>{deadlineItem.condition}</p>}
                  {renderLinkedEvidence(deadlineItem, '日期原文', 'deadline')}
                </article>
              )) : <p className="empty-detail">原文没有可确认的截止日期。</p>}
            </Disclosure>

            <Disclosure
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
                          <span>{term.surface}</span>
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
                          <h3>{selectedTerm.surface}</h3>
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
                        <button type="button" className="text-button" onClick={() => handleSaveTerm(selectedTerm)}>
                          {savedTermId === selectedTerm.id ? <CheckCircle size={17} weight="fill" /> : <BookOpen size={17} />}
                          {savedTermId === selectedTerm.id ? '已保存' : '保存术语'}
                        </button>
                      )}
                    </article>
                  )}
                </div>
              ) : <p className="empty-detail">原文中没有识别出需要单独解释的陌生词语、名称、表格、系统入口或专业概念。</p>}
            </Disclosure>

            <Disclosure
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
              title="官方来源"
              meta={unconfirmedRetrievalReceipts.length > 0
                ? `已找到 ${unconfirmedRetrievalReceipts.length} 个页面 · 结论仍需确认`
                : officialCount > 0 && unresolvedCount > 0
                  ? `${officialCount} 个来源已核验 · ${unresolvedCount} 项仍待确认`
                  : officialCount > 0
                    ? `已核验 ${officialCount} 个来源`
                    : verifiedRetrievalReceipts.length > 0
                      ? `${verifiedRetrievalReceipts.length} 个官方页面支持已核验结论`
                      : '未提供官方来源'}
              Icon={(officialCount > 0 || verifiedRetrievalReceipts.length > 0) && unresolvedCount === 0 ? SealCheck : ShieldCheck}
              open={openSections.sources}
              onToggle={() => toggleSection('sources')}
              tone={(officialCount > 0 || verifiedRetrievalReceipts.length > 0) && unresolvedCount === 0 ? 'official' : 'pending'}
            >
              {citations.map((citation) => (
                <article key={citation.id || citation.url} className="source-citation">
                  <SealCheck size={20} weight="fill" />
                  <div>
                    <strong>{citation.title}</strong>
                    <span>{citation.publisher}</span>
                    {citation.quote && <blockquote>{citation.quote.slice(0, 180)}</blockquote>}
                    <code>{citation.url}</code>
                  </div>
                  <div className="citation-actions">
                    {onOpenExternal && <button type="button" className="text-button" onClick={() => onOpenExternal(citation.url)}><ArrowSquareOut size={16} />打开来源</button>}
                    <button type="button" className="text-button" onClick={() => copyText(citation.url)}><Copy size={16} />复制链接</button>
                  </div>
                </article>
              ))}
              {retrievalReceipts.map((receipt) => (
                <article key={`${receipt.url}:${receipt.retrievedAt || ''}`} className="source-receipt">
                  <FileText size={20} />
                  <div>
                    <strong>{receipt.publisher || receipt.host}</strong>
                    <span>{receipt.claim}</span>
                    {receipt.excerpt && <blockquote>{receipt.excerpt.slice(0, 180)}</blockquote>}
                    <code>{receipt.url}</code>
                    <time dateTime={receipt.retrievedAt}>检索时间：{receipt.retrievedAt}</time>
                    <small>{receipt.verificationStatus === 'verified'
                      ? '用于已核验结论的官方页面'
                      : '已找到官方页面，结论仍需确认'}</small>
                  </div>
                  <div className="citation-actions">
                    {onOpenExternal && <button type="button" className="text-button" onClick={() => onOpenExternal(receipt.url)}><ArrowSquareOut size={16} />打开页面</button>}
                    <button type="button" className="text-button" onClick={() => copyText(receipt.url)}><Copy size={16} />复制链接</button>
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
                    {verificationPolicy === 'ask' && verificationTargets.length > 0 && (
                      <div className="verification-targets">
                        <strong>批准后将访问以下候选官方页面</strong>
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
                    {verificationPolicy === 'ask' && govUkDiscoveryPlans.length > 0 && (
                      <div className="verification-targets">
                        <strong>批准后将用最小检索词在 GOV.UK 查找最多 3 个页面</strong>
                        <ul>
                          {govUkDiscoveryPlans.map((plan) => (
                            <li key={`${plan.publisher}:${plan.query}`}>
                              <code>最小检索词</code>
                              <span>{plan.query}</span>
                            </li>
                          ))}
                        </ul>
                        <small>不会发送完整原文；仅向 GOV.UK Search 发送上面显示的最小检索词。提交前请确认检索词不含个人信息。找到页面不等于结论已核验。</small>
                      </div>
                    )}
                    {verificationPolicy === 'ask' && !canRequestOfficialSources && (
                      <p className="no-verification-target">没有可明确展示的候选官方页面，也没有受支持的 GOV.UK 检索计划，因此不会发起网络查找。</p>
                    )}
                    {verificationPolicy === 'ask' && canRequestOfficialSources && onVerifyOfficialSources && (
                      <button type="button" className="verify-button" onClick={onVerifyOfficialSources} disabled={isVerifying}>
                        <ShieldCheck size={18} weight={isVerifying ? 'regular' : 'fill'} />
                        {isVerifying
                          ? '正在查找官方页面…'
                          : hasPriorVerificationAttempt ? '批准并重新查找官方来源' : '批准并查找官方来源'}
                      </button>
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
                  </div>
                </article>
              )) : <p className="empty-detail">没有额外待核验声明。</p>}
            </Disclosure>

            {normalizedBrief.warnings.length > 0 && (
              <Disclosure
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
      </main>

      {!isTranslationOnly && savedTerms?.length > 0 && (
        <aside className="saved-term-strip" aria-label="最近保存的术语">
          <span>最近保存</span>
          {savedTerms.slice(0, 4).map((item) => (
            <span key={item.id} className="saved-term-chip">
              {item.term}
              <button type="button" onClick={() => onDeleteTerm?.(item.id)} aria-label={`删除术语 ${item.term}`}>删除</button>
            </span>
          ))}
        </aside>
      )}

      <footer className="result-footer">
        <div className="result-actions">
          {!isTranslationOnly && (replyRequired ? (
              <button ref={replyTriggerRef} type="button" className="primary-button" onClick={openReplyDraft}>
                <PaperPlaneTilt size={21} weight="fill" />填写回复模板
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={handleCopyActions} disabled={actionGroups.length === 0 && normalizedBrief.materials.length === 0 && normalizedBrief.deadlines.length === 0}>
                {actionCopyState === 'success' ? <CheckCircle size={21} weight="fill" /> : <ListChecks size={21} />}
                {actionCopyState === 'error' ? '复制失败' : actionCopyState === 'success' ? '已复制行动清单' : '复制行动清单'}
              </button>
            ))}
          <button type="button" className="secondary-button" onClick={handleCopyResult}>
            {copyState === 'success' ? <CheckCircle size={20} weight="fill" /> : <Copy size={20} />}
            {copyState === 'error' ? '复制失败' : copyState === 'success' ? '已复制结果' : '复制结果'}
          </button>
          <button type="button" className="secondary-button" onClick={onRecapture}>
            <Camera size={20} />重新截图
          </button>
          <button type="button" className="secondary-button secondary-button--quiet" onClick={onRetry}>
            <ArrowCounterClockwise size={19} />{isTranslationOnly ? '重新翻译' : '重新分析'}
          </button>
        </div>
        <div className="result-completion">
          <button type="button" className="completion-button" onClick={() => setShowProcess((current) => !current)} aria-expanded={showProcess}>
            <CheckCircle size={20} weight="fill" />
            {isTranslationOnly ? '翻译完成' : '完成'} · {processingTimeMs != null ? `${(processingTimeMs / 1000).toFixed(1)} 秒` : '已处理'} · 查看处理详情
            {showProcess ? <CaretDown size={17} /> : <CaretRight size={17} />}
          </button>
          {showProcess && (
            <div className="completion-popover">
              {completionStages.map(({ label, detail, Icon }) => (
                <div key={label}><Icon size={18} /><span><strong>{label}</strong><small>{detail}</small></span><CheckCircle size={18} weight="fill" /></div>
              ))}
              <p><Clock size={16} /> {isTranslationOnly
                ? '本次没有执行行动提取或证据映射。'
                : '处理阶段已折叠；你可以随时在这里复核。'}</p>
            </div>
          )}
        </div>
        <button type="button" className="new-capture-button" onClick={onNewCapture}>返回捕获</button>
      </footer>

      {showReplyDraft && (
        <div className="reply-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowReplyDraft(false);
        }}>
          <section ref={replyDialogRef} className="reply-drawer" role="dialog" aria-modal="true" aria-labelledby="reply-drawer-title" tabIndex={-1}>
            <header>
              <div>
                <p className="eyebrow">可编辑 · 不会自动发送</p>
                <h2 id="reply-drawer-title">{replyDraftModel.title}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowReplyDraft(false)} aria-label="关闭回复草稿"><X size={20} /></button>
            </header>
            <div className="reply-safety-note">
              <ShieldCheck size={20} weight="fill" />
              <p><strong>不要直接发送占位内容。</strong>{replyDraftModel.safetyNote}</p>
            </div>
            {replyDraftModel.facts.length > 0 && (
              <div className="reply-grounding" aria-label="回复模板依据">
                <strong>模板依据</strong>
                <ul>
                  {replyDraftModel.facts.map((fact, index) => (
                    <li key={`${fact.label}:${index}`}><span>{fact.label}</span><q>{fact.value}</q></li>
                  ))}
                </ul>
              </div>
            )}
            <label>
              <span>英文回复模板</span>
              <textarea value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} aria-label="英文回复草稿" autoFocus />
            </label>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setShowReplyDraft(false)}>关闭</button>
              <button type="button" className="primary-button" onClick={handleCopyReply} disabled={!replyDraft.trim()}>
                {replyCopyState === 'success' ? <CheckCircle size={19} weight="fill" /> : <Copy size={19} />}
                {replyCopyState === 'error' ? '复制失败' : replyCopyState === 'success' ? '已复制回复' : '复制回复'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
