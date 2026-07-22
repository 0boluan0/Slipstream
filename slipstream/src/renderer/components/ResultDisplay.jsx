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

const { IPC_CHANNELS } = constants;

const EVIDENCE_COLORS = [
  { solid: '#168C7A', soft: '#E4F4F0' },
  { solid: '#E8740C', soft: '#FFF0DE' },
  { solid: '#2F6FDB', soft: '#E9F0FF' },
  { solid: '#7A43A7', soft: '#F2EAF9' },
  { solid: '#E3A008', soft: '#FFF5D6' },
  { solid: '#C64B68', soft: '#FBEAF0' },
];

const TERM_KIND_LABELS = {
  proper_noun: '名称 / 专有名词',
  abbreviation: '缩写',
  specialist_term: '专业术语',
  institution: '机构名称',
  course: '课程名称',
  policy: '政策名称',
  form: '表格',
  portal: '系统 / 入口',
  other: '常用词语',
};

const VERIFICATION_LABELS = {
  pending: '待核验',
  verified: '已核验',
  failed: '核验失败',
  not_needed: '无需核验',
};

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

function buildEvidenceCatalog(brief, sourceText) {
  const ranges = [];

  [brief.deadlines, brief.materials, brief.nextSteps, brief.terms, brief.contexts].flat().filter(Boolean).forEach((item) => {
    const evidence = Array.isArray(item?.provenance?.evidence) ? item.provenance.evidence : [];
    evidence.forEach((entry) => {
      if (!Number.isSafeInteger(entry?.start) || !Number.isSafeInteger(entry?.end)) return;
      if (entry.start < 0 || entry.end <= entry.start || entry.end > sourceText.length) return;
      const exactQuote = sourceText.slice(entry.start, entry.end);
      if (exactQuote !== entry.quote) return;
      ranges.push({ ...entry, owners: [item] });
    });
  });

  const merged = [];
  ranges
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .forEach((entry) => {
      const previous = merged[merged.length - 1];
      if (!previous || entry.start >= previous.end) {
        merged.push({ ...entry });
        return;
      }
      previous.end = Math.max(previous.end, entry.end);
      previous.quote = sourceText.slice(previous.start, previous.end);
      previous.owners.push(...entry.owners);
    });

  return merged
    .map((entry, index) => ({
      ...entry,
      key: `${entry.start}:${entry.end}`,
      id: index + 1,
      color: EVIDENCE_COLORS[index % EVIDENCE_COLORS.length],
    }));
}

function catalogEntriesFor(item, catalog) {
  const evidence = Array.isArray(item?.provenance?.evidence) ? item.provenance.evidence : [];
  return catalog.filter((entry) => evidence.some((candidate) => (
    Number.isSafeInteger(candidate?.start)
    && Number.isSafeInteger(candidate?.end)
    && candidate.start < entry.end
    && candidate.end > entry.start
  )));
}

function buildActionGroups(brief, catalog) {
  if (brief.nextSteps.length > 0) {
    return brief.nextSteps.slice(0, 5).map((step, index) => {
      const linkedDeadline = brief.deadlines.find((deadline) => deadline.id === step.deadlineId);
      const relatedItems = [step];
      if (index === 0) relatedItems.push(...brief.materials);
      const evidence = relatedItems.flatMap((item) => catalogEntriesFor(item, catalog));
      return {
        id: step.id || `step-${index}`,
        title: step.action,
        detail: step.urgency === 'before_deadline' && linkedDeadline?.condition
          ? linkedDeadline.condition
          : (step.mandatory === true ? '原文明示为必需操作' : step.provenance?.note),
        provenance: step.provenance,
        evidence: [...new Map(evidence.map((entry) => [entry.id, entry])).values()],
      };
    });
  }

  const groups = [];
  if (brief.materials.length > 0) {
    groups.push({
      id: 'materials',
      title: `准备 ${brief.materials.length} 项材料`,
      detail: brief.materials.map((item) => item.name).join('、'),
      provenance: brief.materials[0].provenance,
      evidence: brief.materials.flatMap((item) => catalogEntriesFor(item, catalog)),
    });
  }
  if (brief.deadlines.length > 0) {
    groups.push({
      id: 'deadlines',
      title: `核对截止日期：${brief.deadlines[0].whenText}`,
      detail: brief.deadlines[0].condition,
      provenance: brief.deadlines[0].provenance,
      evidence: brief.deadlines.flatMap((item) => catalogEntriesFor(item, catalog)),
    });
  }
  return groups;
}

function getHeadline(brief) {
  const deadline = brief.deadlines[0];
  const context = brief.contexts.find((item) => item.kind === 'institutional_process');
  if (deadline && context) return `${deadline.whenText}前完成${context.label}`;
  if (brief.nextSteps[0]?.action) return brief.nextSteps[0].action;
  if (brief.explanation?.text) return brief.explanation.text.split(/[。.!?]/)[0];
  return '已生成可追溯的中文解释';
}

function collectCitations(brief) {
  const citations = getAllContentItems(brief).flatMap((item) => item?.provenance?.citations || []);
  return [...new Map(citations.map((citation) => [citation.id || citation.url, citation])).values()];
}

function composeResultText(brief) {
  const sections = [];
  if (brief.translation?.text) sections.push(`完整翻译\n${brief.translation.text}`);
  if (brief.nextSteps.length > 0) sections.push(`行动路径\n${brief.nextSteps.map((step, index) => `${index + 1}. ${step.action}`).join('\n')}`);
  if (brief.terms.length > 0) sections.push(`词语与术语\n${brief.terms.map((term) => `${term.surface}：${term.explanation}`).join('\n')}`);
  return sections.join('\n\n');
}

function shouldGenerateReply(brief) {
  const replyPattern = /回复|回信|reply|respond/i;
  const negativePattern = /(?:无需|不用|不要|请勿|无须).{0,6}(?:回复|回信)|(?:do not|don['’]?t|no need to|not required to).{0,8}(?:reply|respond)/i;
  return brief.nextSteps.some((step) => replyPattern.test(step.action) && !negativePattern.test(step.action));
}

function createReplyTemplate(brief) {
  const institution = brief.terms.find((term) => term.kind === 'institution')?.surface;
  const salutation = institution ? `Dear ${institution},` : 'Dear Sir or Madam,';
  const body = 'Thank you for your email. I am writing in response to your message.\n\n[After completing the requested action, add only the facts you have confirmed here.]';
  return `${salutation}\n\n${body}\n\nBest regards,\n[Your name]`;
}

function collectVerificationTargets(brief) {
  const targets = brief.verifications
    .filter((item) => ['pending', 'failed'].includes(item.status))
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
  onRetry,
  onRecapture,
  onNewCapture,
  onSaveTerm,
  savedTerms,
  onDeleteTerm,
}) {
  const normalizedBrief = useMemo(() => normalizeBrief(brief, result, sourceText), [brief, result, sourceText]);
  const evidenceCatalog = useMemo(() => buildEvidenceCatalog(normalizedBrief, sourceText), [normalizedBrief, sourceText]);
  const actionGroups = useMemo(() => buildActionGroups(normalizedBrief, evidenceCatalog), [normalizedBrief, evidenceCatalog]);
  const citations = useMemo(() => collectCitations(normalizedBrief), [normalizedBrief]);
  const verificationTargets = useMemo(() => collectVerificationTargets(normalizedBrief), [normalizedBrief]);
  const headline = useMemo(() => getHeadline(normalizedBrief), [normalizedBrief]);
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
  const [openSections, setOpenSections] = useState({
    translation: preference === 'translation',
    terms: false,
    context: false,
    sources: false,
    verification: false,
  });
  const sourceRefs = useRef(new Map());
  const resultRefs = useRef(new Map());
  const effectiveEvidence = hoveredEvidence || pinnedEvidence;

  useEffect(() => {
    if (preference === 'translation') {
      setOpenSections((current) => ({ ...current, translation: true }));
    }
  }, [preference]);

  useEffect(() => {
    if (!normalizedBrief.terms.some((term) => term.id === selectedTermId)) {
      setSelectedTermId(normalizedBrief.terms[0]?.id || null);
    }
  }, [normalizedBrief.terms, selectedTermId]);

  useEffect(() => {
    if (!showReplyDraft) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setShowReplyDraft(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showReplyDraft]);

  const focusEvidence = useCallback((id, destination) => {
    setHoveredEvidence(null);
    setPinnedEvidence((current) => (current === id ? null : id));
    const map = destination === 'source' ? sourceRefs.current : resultRefs.current;
    window.requestAnimationFrame(() => map.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

  const toggleSection = useCallback((key) => {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const handleCopyResult = useCallback(async () => {
    try {
      await copyText(composeResultText(normalizedBrief) || result || '');
      setCopyState('success');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  }, [normalizedBrief, result]);

  const handleCopyActions = useCallback(async () => {
    try {
      await copyText(actionGroups.map((group, index) => `${index + 1}. ${group.title}`).join('\n'));
      setActionCopyState('success');
      window.setTimeout(() => setActionCopyState('idle'), 1800);
    } catch {
      setActionCopyState('error');
    }
  }, [actionGroups]);

  const openReplyDraft = useCallback(() => {
    setReplyDraft(createReplyTemplate(normalizedBrief));
    setReplyCopyState('idle');
    setShowReplyDraft(true);
  }, [normalizedBrief]);

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
    const firstEvidence = catalogEntriesFor(term, evidenceCatalog)[0];
    if (firstEvidence) focusEvidence(firstEvidence.id, 'source');
  }, [evidenceCatalog, focusEvidence]);

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
          ref={(node) => {
            if (node) sourceRefs.current.set(entry.id, node);
            else sourceRefs.current.delete(entry.id);
          }}
          role="button"
          tabIndex={0}
          aria-label={`证据 ${entry.id}：${entry.quote}`}
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
  const deadline = normalizedBrief.deadlines[0];
  const replyRequired = shouldGenerateReply(normalizedBrief);
  const officialCount = citations.length;
  const pendingCount = normalizedBrief.verifications.filter((item) => item.status === 'pending').length;
  const failedCount = normalizedBrief.verifications.filter((item) => item.status === 'failed').length;
  const unresolvedCount = pendingCount + failedCount;
  const needsOfficialVerification = unresolvedCount > 0
    || normalizedBrief.contexts.some((item) => item.provenance?.kind === 'pending')
    || normalizedBrief.terms.some((item) => item.provenance?.kind === 'pending');
  const statusLabel = normalizedBrief.status === 'complete'
    ? '原文证据已对齐'
    : normalizedBrief.status === 'translation_only'
      ? '翻译完成 · 行动项待确认'
      : '部分结论待核验';

  return (
    <div className="result-view">
      <section className="result-summary" aria-labelledby="result-headline">
        <div>
          <p className="eyebrow">结论</p>
          <h1 id="result-headline">{headline}</h1>
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

      <main className="evidence-workspace">
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
          <p className="source-help"><MagnifyingGlass size={15} /> 悬停或点按彩色原文，可定位右侧对应结论。</p>
        </section>

        <section className={`insight-column insight-column--${preference}`} aria-labelledby="action-title">
          <div className="action-path" style={{ order: preference === 'action' ? 1 : 2 }}>
            <div className="column-heading">
              <div>
                <p className="eyebrow">原文可追溯</p>
                <h2 id="action-title">行动路径</h2>
              </div>
              <span className={`result-status result-status--${normalizedBrief.status}`}>{statusLabel}</span>
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
                            key={entry.id}
                            ref={(node) => {
                              if (node) resultRefs.current.set(entry.id, node);
                              else resultRefs.current.delete(entry.id);
                            }}
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

          <div className="detail-stack" style={{ order: preference === 'translation' ? 1 : 3 }}>
            <Disclosure
              title="完整翻译"
              meta="按原文顺序"
              Icon={BookOpen}
              open={openSections.translation}
              onToggle={() => toggleSection('translation')}
            >
              <div className="translation-text">{normalizedBrief.translation?.text || '当前结果没有完整翻译。'}</div>
            </Disclosure>

            <Disclosure
              title="专业术语"
              meta={normalizedBrief.terms.length > 0 ? `${normalizedBrief.terms.length} 项 · 点开查看解释` : '未识别到明确术语'}
              Icon={FileText}
              open={openSections.terms}
              onToggle={() => toggleSection('terms')}
            >
              {normalizedBrief.terms.length > 0 ? (
                <div className="term-browser">
                  <ul className="term-list" aria-label="专业术语">
                    {normalizedBrief.terms.map((term) => (
                      <li key={term.id}>
                        <button
                          type="button"
                          aria-pressed={selectedTermId === term.id}
                          className={selectedTermId === term.id ? 'is-selected' : ''}
                          onClick={() => handleSelectTerm(term)}
                        >
                          <span>{term.surface}</span>
                          <small>{TERM_KIND_LABELS[term.kind] || '术语'}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selectedTerm && (
                    <article className="term-detail">
                      <div className="term-detail__heading">
                        <div>
                          <small>{TERM_KIND_LABELS[selectedTerm.kind] || '术语'}</small>
                          <h3>{selectedTerm.surface}</h3>
                        </div>
                        <ProvenanceBadge kind={selectedTerm.provenance?.kind} />
                      </div>
                      <p>{selectedTerm.explanation}</p>
                      {onSaveTerm && (
                        <button type="button" className="text-button" onClick={() => handleSaveTerm(selectedTerm)}>
                          {savedTermId === selectedTerm.id ? <CheckCircle size={17} weight="fill" /> : <BookOpen size={17} />}
                          {savedTermId === selectedTerm.id ? '已保存' : '保存术语'}
                        </button>
                      )}
                    </article>
                  )}
                </div>
              ) : <p className="empty-detail">原文中没有识别出需要单独解释的专业术语。</p>}
            </Disclosure>

            <Disclosure
              title="流程背景"
              meta={normalizedBrief.contexts.length > 0 ? `${normalizedBrief.contexts.length} 条，均标注来源性质` : '原文未提供足够背景'}
              Icon={ListChecks}
              open={openSections.context}
              onToggle={() => toggleSection('context')}
            >
              {normalizedBrief.contexts.length > 0 ? normalizedBrief.contexts.map((context) => (
                <article key={context.id} className="context-card">
                  <div><strong>{context.label}</strong><ProvenanceBadge kind={context.provenance?.kind} /></div>
                  <p>{context.explanation}</p>
                </article>
              )) : <p className="empty-detail">没有添加脱离原文的宽泛背景判断。</p>}
            </Disclosure>

            <Disclosure
              title="官方来源"
              meta={officialCount > 0 ? `已核验 ${officialCount} 个来源` : '未提供官方来源'}
              Icon={officialCount > 0 ? SealCheck : ShieldCheck}
              open={openSections.sources}
              onToggle={() => toggleSection('sources')}
              tone={officialCount > 0 ? 'official' : 'pending'}
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
              {needsOfficialVerification ? (
                <div className="pending-source">
                  <WarningCircle size={20} />
                  <div>
                    <p>{verificationPolicy === 'local-only'
                      ? '当前为仅本地模式，不会访问外部来源。涉及政策、签证或机构流程的内容仍需你自行核验。'
                      : '当前结论只依据捕获原文，尚未接入官方来源核验。涉及政策、签证或机构流程时，请核对相关机构官网。'}</p>
                    {verificationPolicy === 'ask' && verificationTargets.length > 0 && (
                      <div className="verification-targets">
                        <strong>批准后仅访问以下候选官方页面</strong>
                        <ul>
                          {verificationTargets.map((target) => (
                            <li key={target.url}>
                              <code>{target.host}</code>
                              <span>{target.page}</span>
                            </li>
                          ))}
                        </ul>
                        <small>不会发送完整原文；候选地址在核验前不是证据或引用。</small>
                      </div>
                    )}
                    {verificationPolicy === 'ask' && verificationTargets.length === 0 && (
                      <p className="no-verification-target">没有可明确展示的候选官方页面，因此不会发起网络核验。</p>
                    )}
                    {verificationPolicy === 'ask' && verificationTargets.length > 0 && onVerifyOfficialSources && (
                      <button type="button" className="verify-button" onClick={onVerifyOfficialSources} disabled={isVerifying}>
                        <ShieldCheck size={18} weight={isVerifying ? 'regular' : 'fill'} />
                        {isVerifying ? '正在核验官方来源…' : `批准并核验 ${verificationTargets.length} 个来源`}
                      </button>
                    )}
                    {verificationPolicy === 'official-auto' && (
                      <span className="auto-verification-note"><ShieldCheck size={17} />{isVerifying ? '正在自动核验官方来源…' : '自动核验已开启'}</span>
                    )}
                  </div>
                </div>
              ) : officialCount === 0 ? (
                <p className="empty-detail">这份原文没有需要补充官方来源的外部声明。</p>
              ) : null}
            </Disclosure>

            <Disclosure
              title="待核验"
              meta={unresolvedCount > 0
                ? `${pendingCount} 项待核验${failedCount > 0 ? ` · ${failedCount} 项失败` : ''}`
                : '没有待核验或失败项目'}
              Icon={WarningCircle}
              open={openSections.verification}
              onToggle={() => toggleSection('verification')}
              tone={unresolvedCount > 0 ? 'pending' : 'official'}
            >
              {normalizedBrief.verifications.length > 0 ? normalizedBrief.verifications.map((verification) => (
                <article key={verification.id} className="verification-card">
                  <span className={`verification-status verification-status--${verification.status}`}>{VERIFICATION_LABELS[verification.status] || verification.status}</span>
                  <div><strong>{verification.claim}</strong><p>{verification.reason}</p></div>
                </article>
              )) : <p className="empty-detail">没有额外待核验声明。</p>}
            </Disclosure>
          </div>
        </section>
      </main>

      {savedTerms?.length > 0 && (
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
          {replyRequired ? (
            <button type="button" className="primary-button" onClick={openReplyDraft}>
              <PaperPlaneTilt size={21} weight="fill" />生成回复
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={handleCopyActions} disabled={actionGroups.length === 0}>
              {actionCopyState === 'success' ? <CheckCircle size={21} weight="fill" /> : <ListChecks size={21} />}
              {actionCopyState === 'error' ? '复制失败' : actionCopyState === 'success' ? '已复制行动清单' : '复制行动清单'}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={handleCopyResult}>
            {copyState === 'success' ? <CheckCircle size={20} weight="fill" /> : <Copy size={20} />}
            {copyState === 'error' ? '复制失败' : copyState === 'success' ? '已复制结果' : '复制结果'}
          </button>
          <button type="button" className="secondary-button" onClick={onRecapture}>
            <Camera size={20} />重新截图
          </button>
          <button type="button" className="secondary-button secondary-button--quiet" onClick={onRetry}>
            <ArrowCounterClockwise size={19} />重新分析
          </button>
        </div>
        <div className="result-completion">
          <button type="button" className="completion-button" onClick={() => setShowProcess((current) => !current)} aria-expanded={showProcess}>
            <CheckCircle size={20} weight="fill" />
            完成 · {processingTimeMs != null ? `${(processingTimeMs / 1000).toFixed(1)} 秒` : '已处理'} · 查看处理详情
            {showProcess ? <CaretDown size={17} /> : <CaretRight size={17} />}
          </button>
          {showProcess && (
            <div className="completion-popover">
              {PROCESSING_STAGES.map(({ label, detail, Icon }) => (
                <div key={label}><Icon size={18} /><span><strong>{label}</strong><small>{detail}</small></span><CheckCircle size={18} weight="fill" /></div>
              ))}
              <p><Clock size={16} /> 处理阶段已折叠；你可以随时在这里复核。</p>
            </div>
          )}
        </div>
        <button type="button" className="new-capture-button" onClick={onNewCapture}>返回捕获</button>
      </footer>

      {showReplyDraft && (
        <div className="reply-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowReplyDraft(false);
        }}>
          <section className="reply-drawer" role="dialog" aria-modal="true" aria-labelledby="reply-drawer-title">
            <header>
              <div>
                <p className="eyebrow">可编辑草稿</p>
                <h2 id="reply-drawer-title">生成回复</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowReplyDraft(false)} aria-label="关闭回复草稿"><X size={20} /></button>
            </header>
            <div className="reply-safety-note">
              <ShieldCheck size={20} weight="fill" />
              <p><strong>提交完成后再发送。</strong>请先核对收件人、材料与事实；Slipstream 只生成并复制草稿，不会自动发送邮件。</p>
            </div>
            <label>
              <span>英文回复</span>
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
