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

const POSITIVE_REPLY_PATTERN = /回复|回信|reply|respond/i;
const NEGATIVE_REPLY_PATTERN = /(?:无需|不用|不必|不要|请勿|无须|可不).{0,10}(?:回复|回信)|(?:回复|回信).{0,8}(?:不是|并非).{0,6}(?:必须|必要)|(?:do not|don['’]?t|no need to|not required to).{0,12}(?:reply|respond)|(?:reply|respond).{0,12}(?:isn['’]?t|is not|not).{0,8}(?:required|necessary)|(?:reply|respond).{0,8}(?:is )?optional/i;

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

function formatStep(step, index, deadlines) {
  const linkedDeadline = deadlines.find((deadline) => deadline.id === step.deadlineId);
  const details = linkedDeadline
    ? [`关联截止：${linkedDeadline.whenText}`, ...deadlineDetails(linkedDeadline)]
    : [];
  return `${index + 1}. ${step.action}${details.length > 0 ? `（${details.join('；')}）` : ''}`;
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

function getAllContentItems(brief) {
  return [brief?.translation, brief?.explanation]
    .concat(
      Array.isArray(brief?.terms) ? brief.terms : [],
      Array.isArray(brief?.contexts) ? brief.contexts : [],
      Array.isArray(brief?.deadlines) ? brief.deadlines : [],
      Array.isArray(brief?.materials) ? brief.materials : [],
      Array.isArray(brief?.nextSteps) ? brief.nextSteps : [],
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

export function composeActionChecklistText(brief, { additionalWarnings = [] } = {}) {
  if (isTranslationOnlyBrief(brief)) {
    const warnings = collectWarningMessages(brief, additionalWarnings);
    return [
      '本次仅完成翻译，未生成行动清单。',
      warnings.length > 0 ? `分析提醒\n${warnings.map((message) => `- ${message}`).join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
  }

  const deadlines = Array.isArray(brief?.deadlines) ? brief.deadlines : [];
  const materials = Array.isArray(brief?.materials) ? brief.materials : [];
  const nextSteps = Array.isArray(brief?.nextSteps) ? brief.nextSteps : [];
  const warnings = collectWarningMessages(brief, additionalWarnings);
  const sections = [];

  if (nextSteps.length > 0) {
    sections.push(`行动清单\n${nextSteps.map((step, index) => formatStep(step, index, deadlines)).join('\n')}`);
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

function positiveReplyStep(brief) {
  const steps = Array.isArray(brief?.nextSteps) ? brief.nextSteps : [];
  return steps.find((step) => (
    step?.actor === 'user'
    && step?.mandatory === true
    && POSITIVE_REPLY_PATTERN.test(step?.action || '')
    && !NEGATIVE_REPLY_PATTERN.test(step?.action || '')
  )) || null;
}

export function shouldOfferReply(brief) {
  return Boolean(positiveReplyStep(brief));
}

export function buildReplyDraft(brief) {
  const replyStep = positiveReplyStep(brief);
  if (!replyStep || isTranslationOnlyBrief(brief)) {
    return {
      mode: 'unavailable',
      title: '无法可靠生成回复',
      text: '',
      facts: [],
      safetyNote: '原文没有可确认的回复要求。',
    };
  }

  const institution = (Array.isArray(brief?.terms) ? brief.terms : [])
    .find((term) => term.kind === 'institution')?.surface;
  const salutation = institution ? `Dear ${institution},` : 'Dear Sir or Madam,';
  const materials = Array.isArray(brief?.materials) ? brief.materials : [];
  const deadlines = Array.isArray(brief?.deadlines) ? brief.deadlines : [];
  const nonReplySteps = (Array.isArray(brief?.nextSteps) ? brief.nextSteps : [])
    .filter((step) => step !== replyStep);
  const facts = [];

  materials.forEach((material) => {
    facts.push({ label: 'Requested item', value: firstEvidenceQuote(material) || material.name });
  });
  nonReplySteps.forEach((step) => {
    const value = firstEvidenceQuote(step) || step.action;
    if (!facts.some((fact) => fact.value === value)) facts.push({ label: 'Requested action', value });
  });
  deadlines.forEach((deadline) => {
    facts.push({ label: 'Deadline noted', value: formatDeadline(deadline) });
  });
  facts.push({ label: 'Reply requested', value: firstEvidenceQuote(replyStep) || replyStep.action });

  const preparationNotes = facts.map((fact) => `[${fact.label}: ${fact.value}]`).join('\n');
  const text = [
    salutation,
    '',
    'Thank you for your email.',
    '',
    preparationNotes,
    '',
    '[Write only what is true about what you have completed. Do not say that anything was submitted, attached, or completed unless you have verified it.]',
    '',
    'Best regards,',
    '[Your name]',
  ].join('\n');

  return {
    mode: 'template',
    title: '需按实际情况填写的回复模板',
    text,
    facts,
    safetyNote: '系统不知道你实际完成了哪些事项，因此只提供基于原文要求的可编辑模板，不会代你声明已提交或已附上材料。',
  };
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
    brief.nextSteps,
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
  if (brief.nextSteps.length > 0) {
    return brief.nextSteps.map((step, index) => {
      const linkedDeadline = brief.deadlines.find((deadline) => deadline.id === step.deadlineId);
      return {
        id: step.id || `step-${index}`,
        title: step.action,
        detail: step.urgency === 'before_deadline' && linkedDeadline?.condition
          ? linkedDeadline.condition
          : (step.mandatory === true ? '原文明示为必需操作' : step.provenance?.note),
        provenance: step.provenance,
        evidence: catalogEntriesFor(step, catalog),
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

export function getHeadline(brief, sourceText) {
  if (isTranslationOnlyBrief(brief)) return '完整翻译已生成';

  const groundedSteps = brief.nextSteps.filter((step) => hasExactGrounding(step, sourceText));
  const groundedDeadline = brief.deadlines.find((deadline) => hasExactGrounding(deadline, sourceText));

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
