import { getDeadlineDateOrdinal } from './deadlineUrgency.mjs';
import {
  findPositiveReplyStep,
  getReplyProgressConsistency,
  getReplyRequiredCompletionActionIds,
} from './replyProgress.mjs';

export { getReplyProgressConsistency };

export const EVIDENCE_COLORS = [
  { solid: '#0F766E', soft: '#E4F4F0' },
  { solid: '#B45309', soft: '#FFF0DE' },
  { solid: '#2563EB', soft: '#E9F0FF' },
  { solid: '#7A43A7', soft: '#F2EAF9' },
  { solid: '#8A5A00', soft: '#FFF5D6' },
  { solid: '#BE3659', soft: '#FBEAF0' },
];

const MATERIAL_REQUIREMENT_LABELS = {
  required: '必需',
  conditional: '按条件提供',
  recommended: '建议提供',
  unknown: '要求未明确',
};

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

export function isTranslationOnlyBrief(brief) {
  return brief?.status === 'translation_only';
}

function warningMessage(warning) {
  if (typeof warning === 'string') return warning.trim();
  if (typeof warning?.message === 'string') return warning.message.trim();
  return '';
}

function collectWarningMessages(brief, additionalWarnings = []) {
  const warnings = (Array.isArray(brief?.warnings) ? brief.warnings : [])
    .concat(Array.isArray(additionalWarnings) ? additionalWarnings : [additionalWarnings])
    .map(warningMessage)
    .filter(Boolean);
  return [...new Set(warnings)];
}

function deadlineDetails(deadline) {
  return [
    deadline?.normalizedAt ? `规范时间：${deadline.normalizedAt}` : null,
    deadline?.timezone ? `时区：${deadline.timezone}` : null,
    deadline?.condition ? `条件：${deadline.condition}` : null,
  ].filter(Boolean);
}

function formatDeadline(deadline) {
  const details = deadlineDetails(deadline);
  return `${deadline.whenText}${details.length > 0 ? `（${details.join('；')}）` : ''}`;
}

function formatStep(step, index, deadlines, completedActionIds = null, stepNumberById = new Map()) {
  const linkedDeadline = deadlines.find((deadline) => deadline.id === step.deadlineId);
  const prerequisiteNumbers = (Array.isArray(step?.prerequisiteStepIds) ? step.prerequisiteStepIds : [])
    .map((stepId) => stepNumberById.get(stepId))
    .filter(Number.isSafeInteger);
  const details = (linkedDeadline
    ? [`关联截止：${linkedDeadline.whenText}`, ...deadlineDetails(linkedDeadline)]
    : []).concat(
      prerequisiteNumbers.length > 0 ? [`先完成第 ${prerequisiteNumbers.join('、')} 项`] : [],
    );
  const actionId = step.id || `step-${index}`;
  const progress = completedActionIds instanceof Set
    ? `[${completedActionIds.has(actionId) ? '已完成' : '待完成'}] `
    : '';
  return `${index + 1}. ${progress}${step.action}${details.length > 0 ? `（${details.join('；')}）` : ''}`;
}

function formatMaterial(material) {
  const requirement = MATERIAL_REQUIREMENT_LABELS[material.requirement] || '要求未明确';
  return `- ${material.name}（${[requirement, material.details].filter(Boolean).join('；')}）`;
}

function getContextSections(context) {
  return [
    ['这是什么', context?.whatItIs],
    ['为什么要做', context?.whyItMatters],
    ['你该怎么做', context?.whatToDo],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => ({ label, value: value.trim() }));
}

export function isUserActionStep(step) {
  return step.actor === 'user' && (
    step.mandatory === true || (step.mandatory === false && step.urgency === 'when_triggered')
  );
}

function getAllContentItems(brief) {
  return [brief?.translation, brief?.explanation]
    .concat(
      Array.isArray(brief?.terms) ? brief.terms : [],
      Array.isArray(brief?.contexts) ? brief.contexts : [],
      Array.isArray(brief?.deadlines) ? brief.deadlines : [],
      Array.isArray(brief?.materials) ? brief.materials : [],
      Array.isArray(brief?.nextSteps) ? brief.nextSteps.filter(isUserActionStep) : [],
      Array.isArray(brief?.verifications) ? brief.verifications : [],
    )
    .filter(Boolean);
}

function collectCitations(brief) {
  const citations = getAllContentItems(brief).flatMap((item) => (
    Array.isArray(item?.provenance?.citations) ? item.provenance.citations : []
  ));
  return [...new Map(citations.map((citation) => [citation.id || citation.url, citation])).values()];
}

function collectRetrievalReceipts(brief) {
  const verifications = Array.isArray(brief?.verifications) ? brief.verifications : [];
  const receipts = verifications.flatMap((verification) => (
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

export function composeActionChecklistText(brief, {
  additionalWarnings = [],
  completedActionIds = null,
} = {}) {
  if (isTranslationOnlyBrief(brief)) {
    const warnings = collectWarningMessages(brief, additionalWarnings);
    return [
      '本次仅完成翻译，未生成行动清单。',
      warnings.length > 0 ? `分析提醒\n${warnings.map((message) => `- ${message}`).join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
  }

  const deadlines = Array.isArray(brief?.deadlines) ? brief.deadlines : [];
  const materials = Array.isArray(brief?.materials) ? brief.materials : [];
  const nextSteps = Array.isArray(brief?.nextSteps)
    ? brief.nextSteps.filter(isUserActionStep)
    : [];
  const stepNumberById = new Map(nextSteps.map((step, index) => [step?.id, index + 1]));
  const completedActionIdSet = Array.isArray(completedActionIds)
    ? new Set(completedActionIds)
    : null;
  const warnings = collectWarningMessages(brief, additionalWarnings);
  const sections = [];

  if (nextSteps.length > 0) {
    sections.push(`行动清单\n${nextSteps.map((step, index) => (
      formatStep(step, index, deadlines, completedActionIdSet, stepNumberById)
    )).join('\n')}`);
  }
  if (materials.length > 0) {
    sections.push(`材料清单\n${materials.map(formatMaterial).join('\n')}`);
  }
  if (deadlines.length > 0) {
    sections.push(`截止日期\n${deadlines.map((deadline) => `- ${formatDeadline(deadline)}`).join('\n')}`);
  }
  if (warnings.length > 0) {
    sections.push(`分析提醒\n${warnings.map((message) => `- ${message}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

export function composeCompleteResultText(brief, { additionalWarnings = [] } = {}) {
  const sections = [];
  if (brief?.translation?.text) sections.push(`完整翻译\n${brief.translation.text}`);

  if (isTranslationOnlyBrief(brief)) {
    sections.push('能力边界\n本次仅完成翻译，未生成行动、材料、截止日期或原文证据映射。请勿把空白字段理解为原文没有相关要求。');
    const warnings = collectWarningMessages(brief, additionalWarnings);
    if (warnings.length > 0) {
      sections.push(`分析提醒\n${warnings.map((message) => `- ${message}`).join('\n')}`);
    }
    return sections.join('\n\n');
  }

  if (brief?.explanation?.text) sections.push(`补充解释\n${brief.explanation.text}`);
  const checklist = composeActionChecklistText(brief, { additionalWarnings });
  if (checklist) sections.push(checklist);

  const terms = Array.isArray(brief?.terms) ? brief.terms : [];
  if (terms.length > 0) {
    sections.push(`词语与术语\n${terms.map((term) => `${term.surface}（${TERM_KIND_LABELS[term.kind] || '其他词语'}${term.provenance?.kind === 'pending' ? ' · 待核验' : ''}）：${term.explanation}`).join('\n')}`);
  }

  const contexts = Array.isArray(brief?.contexts) ? brief.contexts : [];
  if (contexts.length > 0) {
    sections.push(`流程背景\n${contexts.map((context) => {
      const details = getContextSections(context);
      const body = details.length > 0
        ? details.map((item) => `${item.label}：${item.value}`).join('\n')
        : context.explanation;
      return `${context.label}${context.provenance?.kind === 'pending' ? '（待核验）' : ''}\n${body}`;
    }).join('\n\n')}`);
  }

  const verifications = Array.isArray(brief?.verifications) ? brief.verifications : [];
  if (verifications.length > 0) {
    sections.push(`核验状态\n${verifications.map((item) => `- ${item.claim}：${VERIFICATION_LABELS[item.status] || item.status}`).join('\n')}`);
  }

  const sourceLines = collectCitations(brief)
    .map((citation) => `- 已核验：${citation.publisher} ${citation.url}`)
    .concat(collectRetrievalReceipts(brief).map((receipt) => {
      const label = receipt.verificationStatus === 'verified'
        ? '用于已核验结论的官方页面'
        : '已找到页面，结论仍需确认';
      return `- ${label}：${receipt.publisher || receipt.host} ${receipt.url}（检索时间：${receipt.retrievedAt}）`;
    }));
  if (sourceLines.length > 0) sections.push(`官方来源\n${[...new Set(sourceLines)].join('\n')}`);

  return sections.join('\n\n');
}

function firstEvidenceQuote(item) {
  const evidence = Array.isArray(item?.provenance?.evidence) ? item.provenance.evidence : [];
  return evidence.find((entry) => typeof entry?.quote === 'string' && entry.quote.trim())?.quote.trim() || null;
}

export function shouldOfferReply(brief) {
  return Boolean(findPositiveReplyStep(brief));
}

export function buildReplyDraft(brief) {
  const replyStep = findPositiveReplyStep(brief);
  if (!replyStep || isTranslationOnlyBrief(brief)) {
    return {
      mode: 'unavailable',
      title: '无法可靠生成回复',
      text: '',
      facts: [],
      replyStepId: null,
      requiredCompletionActionIds: [],
      safetyNote: '原文没有可确认的回复要求。',
    };
  }

  const institution = (Array.isArray(brief?.terms) ? brief.terms : [])
    .find((term) => term.kind === 'institution')?.surface;
  const salutation = institution ? `Dear ${institution},` : 'Dear Sir or Madam,';
  const materials = Array.isArray(brief?.materials) ? brief.materials : [];
  const deadlines = Array.isArray(brief?.deadlines) ? brief.deadlines : [];
  const nonReplySteps = (Array.isArray(brief?.nextSteps) ? brief.nextSteps : [])
    .filter((step) => step !== replyStep && isUserActionStep(step));
  const requiredCompletionActionIds = getReplyRequiredCompletionActionIds(brief, replyStep);
  const deadlineEvidence = new Map(deadlines.map((deadline) => [
    deadline.id,
    firstEvidenceQuote(deadline),
  ]));
  const facts = [];

  materials.forEach((material) => {
    facts.push({ label: 'material', value: firstEvidenceQuote(material) || material.name });
  });
  nonReplySteps.forEach((step) => {
    const value = firstEvidenceQuote(step) || step.action;
    if (step.deadlineId && deadlineEvidence.get(step.deadlineId) === value) return;
    if (!facts.some((fact) => fact.value === value)) facts.push({ label: 'action', value });
  });
  deadlines.forEach((deadline) => {
    const readableDeadline = [deadline.whenText, deadline.condition].filter(Boolean).join(' · ');
    facts.push({ label: 'deadline', value: readableDeadline });
  });
  facts.push({ label: 'reply', value: firstEvidenceQuote(replyStep) || replyStep.action });

  return {
    mode: 'guided',
    title: '先确认事实，再准备英文回复',
    text: '',
    facts,
    salutation,
    hasMaterials: materials.length > 0,
    replyStepId: typeof replyStep.id === 'string' ? replyStep.id : null,
    requiredCompletionActionIds: [...new Set(requiredCompletionActionIds)],
    safetyNote: 'Slipstream 不知道你现实中是否已经完成这些事项。请选择真实状态后，才会生成可复制的草稿。',
  };
}

export function getActionCompletionState(actionGroups = [], completedActionIds = [], replyStepId = null) {
  const validActionIds = new Set((Array.isArray(actionGroups) ? actionGroups : [])
    .map((group) => group?.id)
    .filter((id) => typeof id === 'string' && id.trim()));
  const requestedCompletedIds = completedActionIds instanceof Set
    ? completedActionIds
    : new Set(Array.isArray(completedActionIds) ? completedActionIds : []);
  const completedActionIdSet = new Set([...requestedCompletedIds]
    .filter((id) => validActionIds.has(id)));
  const totalCount = validActionIds.size;
  const completedCount = completedActionIdSet.size;
  return {
    completedActionIdSet,
    totalCount,
    completedCount,
    allActionsComplete: totalCount > 0 && completedCount === totalCount,
    replyActionCompleted: typeof replyStepId === 'string'
      && validActionIds.has(replyStepId)
      && completedActionIdSet.has(replyStepId),
  };
}

export function composeReplyDraft(model, { completionStatus } = {}) {
  if (!model || model.mode !== 'guided') return '';
  if (!['completed', 'in_progress'].includes(completionStatus)) return '';

  const statusLine = completionStatus === 'completed'
    ? model.hasMaterials
      ? 'I confirm that I have completed the requested steps and provided the requested materials.'
      : 'I confirm that I have completed the requested steps.'
    : 'I have not completed the requested steps yet. I will reply again once they are complete.';

  return [
    model.salutation || 'Dear Sir or Madam,',
    '',
    'Thank you for your email.',
    '',
    statusLine,
    '',
    'Please let me know if you need any additional information.',
    '',
    'Best regards,',
    '[Your name]',
  ].join('\n');
}

const REPLY_PLACEHOLDER_PATTERN = /\[(?:your|enter|insert|add|write)[^\]\r\n]{0,72}\]/gi;

export function getReplyDraftPlaceholders(text) {
  const matches = String(text || '').match(REPLY_PLACEHOLDER_PATTERN) || [];
  return [...new Set(matches.map((match) => match.trim()))];
}

const EVIDENCE_TARGET_LABELS = {
  action: '行动项',
  deadline: '截止日期',
  material: '材料要求',
  term: '词语解释',
  context: '流程背景',
  explanation: '补充解释',
  verification: '待核验项',
  detail: '结果详情',
};

export function getEvidenceNavigationAnnouncement(highlight, destination, targetKind) {
  const id = highlight?.id;
  const quote = typeof highlight?.quote === 'string' ? highlight.quote.trim() : '';
  if (destination === 'source') {
    return `已定位到原文证据 ${id}：${quote}`;
  }
  const targetLabel = EVIDENCE_TARGET_LABELS[targetKind] || '对应结果';
  return `已定位到结果中的${targetLabel}：证据 ${id}，${quote}`;
}

function evidenceOwners(brief) {
  return [
    brief.deadlines,
    brief.materials,
    brief.nextSteps.filter(isUserActionStep),
    brief.terms,
    brief.contexts,
    brief.verifications,
    [brief.explanation],
  ].flat().filter(Boolean);
}

/**
 * Build one stable visual highlight for every overlapping source range.
 *
 * `members` deliberately retains each owner's exact evidence object. The merged
 * start/end/quote are only for painting the source once; result cards must use
 * `catalogEntriesFor` so a shorter quote is never replaced by a neighbour's
 * wider overlapping quote.
 */
export function buildEvidenceCatalog(brief, sourceText) {
  const ranges = [];

  evidenceOwners(brief).forEach((owner) => {
    const evidence = Array.isArray(owner?.provenance?.evidence)
      ? owner.provenance.evidence
      : [];
    evidence.forEach((entry) => {
      if (!Number.isSafeInteger(entry?.start) || !Number.isSafeInteger(entry?.end)) return;
      if (entry.start < 0 || entry.end <= entry.start || entry.end > sourceText.length) return;
      if (sourceText.slice(entry.start, entry.end) !== entry.quote) return;
      ranges.push({
        start: entry.start,
        end: entry.end,
        owner,
        evidence: { ...entry },
        sequence: ranges.length,
      });
    });
  });

  const merged = [];
  ranges
    .sort((left, right) => left.start - right.start || right.end - left.end || left.sequence - right.sequence)
    .forEach((range) => {
      const previous = merged[merged.length - 1];
      if (!previous || range.start >= previous.end) {
        merged.push({ start: range.start, end: range.end, members: [range] });
        return;
      }
      previous.end = Math.max(previous.end, range.end);
      previous.members.push(range);
    });

  return merged.map((highlight, index) => ({
    ...highlight,
    quote: sourceText.slice(highlight.start, highlight.end),
    owners: [...new Set(highlight.members.map((member) => member.owner))],
    key: `${highlight.start}:${highlight.end}`,
    id: index + 1,
    color: EVIDENCE_COLORS[index % EVIDENCE_COLORS.length],
  }));
}

export function catalogEntriesFor(item, catalog) {
  const seen = new Set();
  return catalog.flatMap((highlight) => highlight.members.flatMap((member) => {
    if (member.owner !== item) return [];
    const exactKey = `${member.evidence.start}:${member.evidence.end}:${member.evidence.quote}`;
    if (seen.has(exactKey)) return [];
    seen.add(exactKey);
    return [{
      ...member.evidence,
      id: highlight.id,
      key: `${highlight.key}:${member.sequence}`,
      highlightKey: highlight.key,
      color: highlight.color,
    }];
  }));
}

export function getEvidenceResultRoute(highlight, brief, actionGroups) {
  const hasActionOwner = actionGroups.some((group) => (
    group.evidence.some((evidence) => evidence.id === highlight.id)
  ));
  const materialOwner = highlight.owners.find((owner) => brief.materials.includes(owner));
  const deadlineOwner = highlight.owners.find((owner) => brief.deadlines.includes(owner));
  const termOwner = highlight.owners.find((owner) => brief.terms.includes(owner));
  const contextOwner = highlight.owners.find((owner) => brief.contexts.includes(owner));
  const verificationOwner = highlight.owners.find((owner) => brief.verifications.includes(owner));
  const explanationOwner = highlight.owners.includes(brief.explanation);

  return {
    selectedTermId: termOwner?.id || null,
    sections: {
      materials: Boolean(materialOwner),
      deadlines: Boolean(deadlineOwner),
      terms: Boolean(termOwner),
      context: Boolean(contextOwner),
      explanation: explanationOwner,
      verification: Boolean(verificationOwner),
    },
    targetKind: verificationOwner
      ? 'verification'
      : hasActionOwner
        ? 'action'
        : deadlineOwner
          ? 'deadline'
          : materialOwner
            ? 'material'
            : termOwner
              ? 'term'
              : contextOwner
                ? 'context'
                : explanationOwner ? 'explanation' : null,
  };
}

export function buildActionGroups(brief, catalog) {
  const userSteps = brief.nextSteps.filter(isUserActionStep);
  if (userSteps.length > 0) {
    const stepNumberById = new Map(userSteps.map((step, index) => [step.id, index + 1]));
    return userSteps.map((step, index) => {
      const linkedDeadline = brief.deadlines.find((deadline) => deadline.id === step.deadlineId);
      const prerequisiteStepIds = (Array.isArray(step.prerequisiteStepIds)
        ? step.prerequisiteStepIds
        : []).filter((stepId) => stepNumberById.has(stepId));
      return {
        id: step.id || `step-${index}`,
        title: step.action,
        detail: step.urgency === 'before_deadline' && linkedDeadline?.condition
          ? linkedDeadline.condition
          : (step.mandatory === true ? '原文明示为必需操作' : step.provenance?.note),
        provenance: step.provenance,
        evidence: catalogEntriesFor(step, catalog),
        prerequisiteStepIds,
        prerequisiteStepNumbers: prerequisiteStepIds.map((stepId) => stepNumberById.get(stepId)),
      };
    });
  }
  return [];
}

export function hasExactGrounding(item, sourceText) {
  if (!['original', 'inference'].includes(item?.provenance?.kind)) return false;
  const evidence = Array.isArray(item?.provenance?.evidence) ? item.provenance.evidence : [];
  return evidence.length > 0 && evidence.every((entry) => (
    Number.isSafeInteger(entry?.start)
    && Number.isSafeInteger(entry?.end)
    && entry.start >= 0
    && entry.end > entry.start
    && entry.end <= sourceText.length
    && sourceText.slice(entry.start, entry.end) === entry.quote
  ));
}

export function selectPrimaryDeadline(brief, sourceText) {
  const deadlines = (Array.isArray(brief?.deadlines) ? brief.deadlines : [])
    .filter((deadline) => hasExactGrounding(deadline, sourceText));
  if (deadlines.length === 0) {
    return { deadline: null, totalCount: 0, selectionMode: 'none' };
  }

  const groundedSteps = (Array.isArray(brief?.nextSteps) ? brief.nextSteps : [])
    .filter(isUserActionStep)
    .filter((step) => hasExactGrounding(step, sourceText));
  const ranked = deadlines.map((deadline, index) => {
    const linkedSteps = groundedSteps.filter((step) => step.deadlineId === deadline.id);
    const priority = linkedSteps.some((step) => step.actor === 'user' && step.mandatory === true)
      ? 0
      : linkedSteps.some((step) => step.actor === 'user')
        ? 1
        : linkedSteps.length > 0 ? 2 : 3;
    return {
      deadline,
      index,
      priority,
      ordinal: getDeadlineDateOrdinal(deadline),
    };
  });

  const bestPriority = Math.min(...ranked.map((item) => item.priority));
  const candidates = ranked.filter((item) => item.priority === bestPriority);
  const allComparable = candidates.every((item) => item.ordinal !== null);
  const selected = allComparable
    ? [...candidates].sort((left, right) => left.ordinal - right.ordinal || left.index - right.index)[0]
    : candidates[0];

  return {
    deadline: selected.deadline,
    totalCount: deadlines.length,
    selectionMode: deadlines.length === 1
      ? 'only'
      : candidates.length === 1
        ? 'action_priority'
        : allComparable ? 'earliest' : 'source_order',
  };
}

export function getHeadline(brief, sourceText) {
  if (isTranslationOnlyBrief(brief)) return '完整翻译已生成';

  const groundedSteps = brief.nextSteps
    .filter(isUserActionStep)
    .filter((step) => hasExactGrounding(step, sourceText));
  const groundedDeadline = selectPrimaryDeadline(brief, sourceText).deadline;

  if (groundedDeadline?.id) {
    const linkedSteps = groundedSteps.filter((step) => step.deadlineId === groundedDeadline.id);
    const linkedStep = linkedSteps.find((step) => step.urgency === 'before_deadline') || linkedSteps[0];
    if (linkedStep?.action) {
      return linkedStep.action.includes(groundedDeadline.whenText)
        ? linkedStep.action
        : `${groundedDeadline.whenText}前${linkedStep.action}`;
    }
  }

  const groundedStep = groundedSteps[0];
  if (groundedStep?.action) return groundedStep.action;
  if (hasExactGrounding(brief.explanation, sourceText)) {
    return brief.explanation.text.split(/[。.!?]/)[0];
  }
  return '已生成中文解释，请查看证据与待核验标记';
}
