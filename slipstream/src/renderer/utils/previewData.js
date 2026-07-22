const PREVIEW_SOURCE_TEXT = `Dear Student,

Please submit copies of the following identity documents to verify your record:

1. A clear scan of your passport information page.
2. A clear scan of your eVisa share code.

Please reply to this email to confirm that you have submitted the required documents.

All items must be received by 28 July 2026.

Best regards,
University Services`;

function evidenceFor(quote, occurrence = 0) {
  let start = -1;
  let fromIndex = 0;

  for (let index = 0; index <= occurrence; index += 1) {
    start = PREVIEW_SOURCE_TEXT.indexOf(quote, fromIndex);
    if (start === -1) break;
    fromIndex = start + quote.length;
  }

  return {
    quote,
    start,
    end: start + quote.length,
    match: 'exact',
    ambiguous: false,
  };
}

function originalProvenance(...quotes) {
  return {
    kind: 'original',
    confidence: 0.99,
    note: null,
    evidence: quotes.map((quote) => evidenceFor(quote)),
    citations: [],
  };
}

function pendingProvenance(note, ...quotes) {
  return {
    kind: 'pending',
    confidence: 0.68,
    note,
    evidence: quotes.map((quote) => evidenceFor(quote)),
    citations: [],
  };
}

const PREVIEW_ACTION_BRIEF = {
  schemaVersion: 'action-brief.v1',
  status: 'partial',
  source: {
    id: 'preview-university-services-email',
    sha256: null,
    length: PREVIEW_SOURCE_TEXT.length,
    offsetUnit: 'utf16',
    language: 'en',
  },
  targetLanguage: 'zh',
  translation: {
    text: '亲爱的同学：\n\n请提交以下身份证明文件的副本，以核验你的记录：\n1. 护照个人信息页的清晰扫描件。\n2. eVisa share code 的清晰扫描件。\n\n请回复此邮件，确认你已经提交所需文件。\n\n所有材料必须在 2026 年 7 月 28 日前送达。\n\n此致\nUniversity Services',
    provenance: originalProvenance(
      'Please submit copies of the following identity documents to verify your record:',
      'A clear scan of your passport information page.',
      'A clear scan of your eVisa share code.',
      'Please reply to this email to confirm that you have submitted the required documents.',
      'All items must be received by 28 July 2026.',
    ),
  },
  explanation: {
    text: '这是一封身份材料核验邮件。你需要准备两项材料，在截止日期前提交，并回复邮件确认。',
    provenance: originalProvenance(
      'Please submit copies of the following identity documents to verify your record:',
      'Please reply to this email to confirm that you have submitted the required documents.',
      'All items must be received by 28 July 2026.',
    ),
  },
  terms: [
    {
      id: 'term-passport-information-page',
      surface: 'passport information page',
      kind: 'specialist_term',
      explanation: '护照上包含姓名、照片、护照号码、出生日期等个人资料的页面。',
      provenance: originalProvenance('passport information page'),
    },
    {
      id: 'term-evisa-share-code',
      surface: 'eVisa share code',
      kind: 'specialist_term',
      explanation: '英国电子签证系统用于让机构在线核验移民身份的共享代码。代码通常有有效期，提交前应在官方账户中确认。',
      provenance: pendingProvenance('术语含义需要结合英国政府官方说明核验。', 'eVisa share code'),
    },
    {
      id: 'term-university-services',
      surface: 'University Services',
      kind: 'institution',
      explanation: '邮件署名中的学校服务部门名称；原文未给出更具体的办公室。',
      provenance: originalProvenance('University Services'),
    },
  ],
  contexts: [
    {
      id: 'context-identity-check',
      label: '身份材料核验流程',
      kind: 'institutional_process',
      explanation: '邮件要求以文件副本核验学生记录，并要求在提交后通过邮件确认。',
      provenance: originalProvenance(
        'Please submit copies of the following identity documents to verify your record:',
        'Please reply to this email to confirm that you have submitted the required documents.',
      ),
    },
  ],
  deadlines: [
    {
      id: 'deadline-july-28',
      whenText: '2026 年 7 月 28 日',
      normalizedAt: '2026-07-28T23:59:59.000Z',
      timezone: null,
      condition: '所有材料必须在该日期前送达。',
      provenance: originalProvenance('All items must be received by 28 July 2026.'),
    },
  ],
  materials: [
    {
      id: 'material-passport',
      name: '护照个人信息页清晰扫描件',
      requirement: 'required',
      details: null,
      provenance: originalProvenance('A clear scan of your passport information page.'),
    },
    {
      id: 'material-evisa',
      name: 'eVisa share code 清晰扫描件',
      requirement: 'required',
      details: null,
      provenance: originalProvenance('A clear scan of your eVisa share code.'),
    },
  ],
  nextSteps: [
    {
      id: 'step-prepare',
      action: '准备护照个人信息页与 eVisa share code',
      actor: 'user',
      urgency: 'now',
      mandatory: true,
      deadlineId: 'deadline-july-28',
      provenance: originalProvenance(
        'Please submit copies of the following identity documents to verify your record:',
        'A clear scan of your passport information page.',
        'A clear scan of your eVisa share code.',
      ),
    },
    {
      id: 'step-submit',
      action: '在 2026 年 7 月 28 日前提交材料',
      actor: 'user',
      urgency: 'before_deadline',
      mandatory: true,
      deadlineId: 'deadline-july-28',
      provenance: originalProvenance('All items must be received by 28 July 2026.'),
    },
    {
      id: 'step-reply',
      action: '回复邮件，确认材料已经提交',
      actor: 'user',
      urgency: 'when_triggered',
      mandatory: true,
      deadlineId: null,
      provenance: originalProvenance('Please reply to this email to confirm that you have submitted the required documents.'),
    },
  ],
  verifications: [
    {
      id: 'verify-evisa-guidance',
      claim: 'eVisa share code 的具体生成方式与有效期',
      reason: '原邮件没有给出官方说明链接，需在英国政府或学校官方页面核验。',
      status: 'pending',
      lookup: {
        publisher: 'GOV.UK',
        query: 'GOV.UK eVisa share code official guidance',
        candidateUrls: ['https://www.gov.uk/view-prove-immigration-status'],
      },
      provenance: pendingProvenance('等待官方来源。', 'eVisa share code'),
    },
  ],
  warnings: [],
  analysisProvenance: {
    responseKind: 'structured',
    provider: 'preview',
    model: 'action-brief-preview',
    promptVersion: 'action-brief.prompt.v1',
    generatedAt: '2026-07-23T08:00:00.000Z',
  },
};

const PREVIEW_CAPTURE = {
  confidence: 0.98,
  blocks: PREVIEW_SOURCE_TEXT.split('\n')
    .filter(Boolean)
    .map((text, index) => ({ id: `preview-block-${index + 1}`, text })),
};

export { PREVIEW_ACTION_BRIEF, PREVIEW_CAPTURE, PREVIEW_SOURCE_TEXT };
