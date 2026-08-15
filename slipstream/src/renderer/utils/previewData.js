import { createTranslationOnlyPreview } from './translationOnlyPreview.mjs';
import { SAFE_SAMPLE_SOURCE_TEXT } from './safeSampleSource';

const PREVIEW_SOURCE_TEXT = SAFE_SAMPLE_SOURCE_TEXT;

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

function inferenceProvenance(...quotes) {
  return {
    kind: 'inference',
    confidence: 0.9,
    note: '解释仅概括原文明示的要求，不补充外部流程事实。',
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
    text: '亲爱的同学：\n\n请提交以下身份证明文件的副本，以核验你的记录：\n1. 护照个人信息页的清晰扫描件。\n2. eVisa share code 的清晰扫描件。\n\n请回复此邮件，确认你已经提交所需文件。\n\n请在收到邮件后一天内生成 eVisa share code，以便提交。\n\n所有材料必须在收到邮件后两天内送达。\n\n此致\nUniversity Services',
    provenance: originalProvenance(
      'Please submit copies of the following identity documents to verify your record:',
      'A clear scan of your passport information page.',
      'A clear scan of your eVisa share code.',
      'Please reply to this email to confirm that you have submitted the required documents.',
      'Please generate the eVisa share code within one day of this email so it is ready for submission.',
      'All items must be received within two days of this email.',
    ),
  },
  explanation: {
    text: '这是一封身份材料核验邮件。你需要先生成 eVisa share code，再按后一个截止日期提交两项材料并回复确认。',
    provenance: originalProvenance(
      'Please submit copies of the following identity documents to verify your record:',
      'Please reply to this email to confirm that you have submitted the required documents.',
      'Please generate the eVisa share code within one day of this email so it is ready for submission.',
      'All items must be received within two days of this email.',
    ),
  },
  terms: [
    {
      id: 'term-passport-information-page',
      surface: 'passport information page',
      kind: 'specialist_term',
      explanation: '护照上包含姓名、照片、护照号码、出生日期等个人资料的页面。',
      verificationId: null,
      provenance: originalProvenance('passport information page'),
    },
    {
      id: 'term-evisa-share-code',
      surface: 'eVisa share code',
      kind: 'specialist_term',
      explanation: '英国电子签证系统用于让机构在线核验移民身份的共享代码。代码通常有有效期，提交前应在官方账户中确认。',
      verificationId: 'verify-evisa-guidance',
      provenance: pendingProvenance('术语含义需要结合英国政府官方说明核验。', 'eVisa share code'),
    },
    {
      id: 'term-received',
      surface: 'received',
      kind: 'general_term',
      explanation: '这里不是“你发出去”就算完成，而是材料必须在所述期限内被对方收到。',
      verificationId: null,
      provenance: inferenceProvenance('All items must be received within two days of this email.'),
    },
    {
      id: 'term-university-services',
      surface: 'University Services',
      kind: 'institution',
      explanation: '邮件署名中的学校服务部门名称；原文未给出更具体的办公室。',
      verificationId: null,
      provenance: originalProvenance('University Services'),
    },
  ],
  contexts: [
    {
      id: 'context-identity-check',
      label: '身份材料核验流程',
      kind: 'institutional_process',
      explanation: '学校要求通过两项身份证明材料核对学生记录；你要先生成 eVisa share code，再提交材料并回复确认。',
      whatItIs: '学校要求你提交两项身份证明材料，用来核对学生记录。',
      whyItMatters: '这是邮件明确要求的记录核验步骤；原文没有说明不完成会有什么后果。',
      whatToDo: '在收到邮件后一天内生成 eVisa share code，再在收到邮件后两天内提交两项材料，然后回复确认。',
      verificationId: null,
      provenance: inferenceProvenance(
        'Please submit copies of the following identity documents to verify your record:',
        'Please generate the eVisa share code within one day of this email so it is ready for submission.',
        'All items must be received within two days of this email.',
        'Please reply to this email to confirm that you have submitted the required documents.',
      ),
    },
  ],
  deadlines: [
    {
      id: 'deadline-within-one-day',
      whenText: '收到邮件后一天内',
      calendarDate: null,
      normalizedAt: null,
      timezone: null,
      condition: '需要在该期限内生成 eVisa share code，以便提交。',
      provenance: originalProvenance('Please generate the eVisa share code within one day of this email so it is ready for submission.'),
    },
    {
      id: 'deadline-within-two-days',
      whenText: '收到邮件后两天内',
      calendarDate: null,
      normalizedAt: null,
      timezone: null,
      condition: '所有材料必须在该期限内送达。',
      provenance: originalProvenance('All items must be received within two days of this email.'),
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
      id: 'step-generate-share-code',
      action: '在收到邮件后一天内生成 eVisa share code',
      actor: 'user',
      urgency: 'before_deadline',
      mandatory: true,
      deadlineId: 'deadline-within-one-day',
      prerequisiteStepIds: [],
      provenance: originalProvenance('Please generate the eVisa share code within one day of this email so it is ready for submission.'),
    },
    {
      id: 'step-prepare-passport',
      action: '准备护照个人信息页清晰扫描件',
      actor: 'user',
      urgency: 'now',
      mandatory: true,
      deadlineId: 'deadline-within-two-days',
      prerequisiteStepIds: [],
      provenance: originalProvenance('A clear scan of your passport information page.'),
    },
    {
      id: 'step-submit',
      action: '在收到邮件后两天内提交材料',
      actor: 'user',
      urgency: 'before_deadline',
      mandatory: true,
      deadlineId: 'deadline-within-two-days',
      prerequisiteStepIds: ['step-generate-share-code', 'step-prepare-passport'],
      provenance: originalProvenance('All items must be received within two days of this email.'),
    },
    {
      id: 'step-reply',
      action: '回复邮件，确认材料已经提交',
      actor: 'user',
      urgency: 'when_triggered',
      mandatory: true,
      deadlineId: null,
      prerequisiteStepIds: ['step-submit'],
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
      retrievals: [],
      provenance: pendingProvenance('等待官方来源。', 'A clear scan of your eVisa share code.'),
    },
  ],
  warnings: [],
  analysisProvenance: {
    responseKind: 'structured',
    provider: 'ollama',
    model: 'action-brief-preview',
    processingTimeMs: null,
    processingLocation: 'local',
    promptVersion: 'action-brief.prompt.v2',
    generatedAt: '2026-07-23T08:00:00.000Z',
  },
};

const PREVIEW_TRANSLATION_BRIEF = createTranslationOnlyPreview({
  sourceText: PREVIEW_SOURCE_TEXT,
  translation: PREVIEW_ACTION_BRIEF.translation.text,
  sourceId: 'preview-university-services-email',
  generatedAt: '2026-07-27T08:00:00.000Z',
});

const PREVIEW_CAPTURE = {
  confidence: 0.98,
  blocks: PREVIEW_SOURCE_TEXT.split('\n')
    .filter(Boolean)
    .map((text, index) => ({ id: `preview-block-${index + 1}`, text, confidence: 0.98 })),
};

export {
  PREVIEW_ACTION_BRIEF,
  PREVIEW_CAPTURE,
  PREVIEW_SOURCE_TEXT,
  PREVIEW_TRANSLATION_BRIEF,
};
