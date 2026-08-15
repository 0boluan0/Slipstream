const LLMService = require('./llm-service');
const { analyzeModelOutput } = require('./analysis');
const {
  CONNECTION_CODES,
  CONNECTION_STATUSES,
  testProviderConnection,
} = require('./provider-connection');
const { CUSTOM_ENDPOINT_ERROR_CODES } = require('./custom-endpoint-fetch');

const COMPATIBILITY_PROCESS_SENTENCE = 'At the fictional Alderbridge Institute, the invented Northstar Intake is an institutional filing process: applicants must submit the signed Wren-7 Intake Form through the LanternGate portal, and the portal receipt is the process record confirming that the submission entered the intake.';
const COMPATIBILITY_PROCESS_REASON_SENTENCE = 'The LanternGate portal receipt matters because it is the Northstar Intake process record confirming that the submission entered the intake.';
const COMPATIBILITY_PROCESS_PASSAGE = `${COMPATIBILITY_PROCESS_SENTENCE} ${COMPATIBILITY_PROCESS_REASON_SENTENCE}`;
const COMPATIBILITY_STATUS_SENTENCE = 'Registration remains provisional until this fictional intake process is complete.';
const COMPATIBILITY_ORDINARY_PHRASE_SENTENCE = 'The ordinary status phrase "on hold" appears in this fictional process: if the LanternGate portal displays it, pause before sending another copy and reply to ask which required item is missing.';
const COMPATIBILITY_SUBMIT_SENTENCE = 'Please submit the signed Wren-7 Intake Form through the LanternGate portal by 5:00 PM on 30 September 2099.';
const COMPATIBILITY_REPLY_SENTENCE = 'Reply to confirm receipt.';
const COMPATIBILITY_DEADLINE_PHRASE = '5:00 PM on 30 September 2099';
const COMPATIBILITY_MATERIAL_PHRASE = 'signed Wren-7 Intake Form';
const COMPATIBILITY_SUBMIT_ACTION_PHRASE = 'submit the signed Wren-7 Intake Form through the LanternGate portal';
const COMPATIBILITY_REPLY_ACTION_PHRASE = 'Reply to confirm receipt';
const COMPATIBILITY_FORM_TERM_ANCHOR = 'Wren-7 Intake Form';
const COMPATIBILITY_PORTAL_TERM_ANCHOR = 'LanternGate portal';
const COMPATIBILITY_GENERAL_TERM_SPECS = [
  { surface: 'on hold', sentence: COMPATIBILITY_ORDINARY_PHRASE_SENTENCE },
  { surface: 'provisional', sentence: COMPATIBILITY_STATUS_SENTENCE },
];
const FULL_ANALYSIS_COMPATIBILITY_SOURCE = [
  'Every name, organization, form, portal, and event in this message is fictional.',
  COMPATIBILITY_PROCESS_SENTENCE,
  COMPATIBILITY_PROCESS_REASON_SENTENCE,
  COMPATIBILITY_STATUS_SENTENCE,
  COMPATIBILITY_ORDINARY_PHRASE_SENTENCE,
  COMPATIBILITY_SUBMIT_SENTENCE,
  COMPATIBILITY_REPLY_SENTENCE,
].join(' ');

function failed(code) {
  return { status: CONNECTION_STATUSES.FAILED, code };
}

function connected() {
  return { status: CONNECTION_STATUSES.CONNECTED, code: CONNECTION_CODES.OK };
}

function exactSourceEvidenceQuotes(item) {
  return Array.isArray(item?.provenance?.evidence)
    ? item.provenance.evidence
      .filter((evidence) => (
        evidence?.match === 'exact'
        && typeof evidence?.quote === 'string'
        && FULL_ANALYSIS_COMPATIBILITY_SOURCE.includes(evidence.quote)
      ))
      .map((evidence) => evidence.quote)
    : [];
}

function evidenceContainsTextWithinSentence(item, sentence, requiredText) {
  return exactSourceEvidenceQuotes(item).some((quote) => (
    sentence.includes(quote) && quote.includes(requiredText)
  ));
}

function evidenceCoversSentenceAnchors(item, sentence, anchors) {
  const quotes = exactSourceEvidenceQuotes(item).filter((quote) => sentence.includes(quote));
  return anchors.every((anchor) => quotes.some((quote) => quote.includes(anchor)));
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSubmitMeaning(value) {
  const text = value || '';
  return /(?:\u63d0\u4ea4|\u9012\u4ea4|\u4e0a\u4ea4|\u4ea4\u4ed8|\u5448\u4ea4|\u9001\u4ea4|submit|deliver|file)/iu.test(text)
    && !/(?:do\s+not|don't|must\s+not|should\s+not|not\s+to|never|avoid(?:\s+\w+){0,3}|refrain\s+from)\s+[^.!?]{0,40}(?:submit|deliver|file)/iu.test(text)
    && !/(?:\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u53ef|\u65e0\u9700|\u4e0d\u5fc5|\u5207\u52ff|\u52ff|\u522b)\s*[^\uff0c\u3002\uff1b;]{0,20}(?:\u63d0\u4ea4|\u9012\u4ea4|\u4e0a\u4ea4|\u4ea4\u4ed8|\u5448\u4ea4|\u9001\u4ea4)/u.test(text);
}

function hasReplyMeaning(value) {
  const text = value || '';
  return /(?:\u56de\u590d|\u56de\u8986|\u56de\u4fe1|\u7b54\u590d|\u7b54\u8986|\u56de\u51fd|reply|respond|write\s+back)/iu.test(text)
    && !/(?:do\s+not|don't|must\s+not|should\s+not|not\s+to|never|avoid(?:\s+\w+){0,3}|refrain\s+from)\s+[^.!?]{0,40}(?:reply|replying|respond|write\s+back)/iu.test(text)
    && !/(?:\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u53ef|\u65e0\u9700|\u4e0d\u5fc5|\u5207\u52ff|\u52ff|\u522b)\s*[^\uff0c\u3002\uff1b;]{0,20}(?:\u56de\u590d|\u56de\u8986|\u56de\u4fe1|\u7b54\u590d|\u7b54\u8986|\u56de\u51fd)/u.test(text);
}

function hasReceiptConfirmationMeaning(value) {
  const text = value || '';
  const confirmsReceipt = (
    /(?:\u786e\u8ba4|\u78ba\u8a8d|\u544a\u77e5|\u901a\u77e5|confirm|acknowledge|notify|tell)/iu.test(text)
    && /(?:\u6536\u5230|\u6536\u6089|\u63a5\u6536|\u6536\u4ef6|receipt|received|receiving)/iu.test(text)
  ) || /acknowledge(?:ment)?\s+(?:of\s+)?receipt/iu.test(text);
  return confirmsReceipt
    && !/(?:do\s+not|don't|must\s+not|should\s+not|not\s+to|never|avoid(?:\s+\w+){0,3}|refrain\s+from)\s+[^.!?]{0,40}(?:confirm|acknowledge|notify|reply|respond)/iu.test(text)
    && !/(?:\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u53ef|\u65e0\u9700|\u4e0d\u5fc5|\u5207\u52ff|\u52ff|\u522b)\s*[^\uff0c\u3002\uff1b;]{0,20}(?:\u786e\u8ba4|\u78ba\u8a8d|\u544a\u77e5|\u901a\u77e5|\u56de\u590d|\u56de\u8986|\u56de\u4fe1|\u7b54\u590d|\u7b54\u8986|\u56de\u51fd)/u.test(text);
}

function hasProcessMeaning(value) {
  const text = value || '';
  return /(?:\u6d41\u7a0b|\u7a0b\u5e8f|process|filing)/iu.test(text)
    && !/(?:is|are)\s+not(?:\s+\w+){0,3}\s+(?:a\s+|an\s+|the\s+)?(?:process|filing)/iu.test(text)
    && !/(?:\u4e0d\u662f|\u5e76\u975e|\u4e0d\u5c5e\u4e8e)[^\uff0c\u3002\uff1b;]{0,16}(?:\u6d41\u7a0b|\u7a0b\u5e8f)/u.test(text);
}

function hasRecordMeaning(value) {
  return /(?:\u6536\u636e|\u6536\u64da|\u51ed\u8bc1|\u6191\u8b49|\u51ed\u636e|\u6191\u64da|\u8bb0\u5f55|\u8a18\u9304|\u7559\u75d5|\u8ffd\u8e2a|\u8ffd\u8e64|\u8ddf\u8e2a|receipt|record|proof|evidence|track|trace)/iu.test(value || '');
}

function hasConfirmationMeaning(value) {
  const text = value || '';
  return /(?:\u786e\u8ba4|\u78ba\u8a8d|\u8bc1\u660e|\u8b49\u660e|\u8868\u660e|\u663e\u793a|\u986f\u793a|\u8fdb\u5165|\u9032\u5165|\u7eb3\u5165|\u7d0d\u5165|\u53d7\u7406|\u63a5\u6536|\u6536\u5230|\u5df2\u63d0\u4ea4|\u63d0\u4ea4\u6210\u529f|\u53ef\u67e5|\u53ef\u8ffd|confirm|entered|received|accepted|submitted|processed)/iu.test(text)
    && !/(?:does?\s+not|is\s+not|never|fails?\s+to)\s+[^.!?]{0,40}(?:confirm|show|prove|record|track|indicate)/iu.test(text)
    && !/(?:confirm|prove|show|indicate)\s+(?:nothing|none)\b/iu.test(text)
    && !/(?:merely|just)\s+(?:words?|terms?)|unrelated|irrelevant/iu.test(text)
    && !/(?:\u4e0d\u80fd|\u65e0\u6cd5|\u4e0d\u4f1a|\u4e0d\u8868\u793a|\u5e76\u975e|\u7edd\u975e)[^\uff0c\u3002\uff1b;]{0,20}(?:\u786e\u8ba4|\u78ba\u8a8d|\u8bc1\u660e|\u8b49\u660e|\u8868\u660e|\u8fdb\u5165|\u9032\u5165|\u53d7\u7406)/u.test(text)
    && !/(?:\u65e0\u5173|\u7121\u95dc|\u53ea\u662f[^\uff0c\u3002\uff1b;]{0,12}(?:\u8bcd|\u8a5e|\u5b57))/u.test(text);
}

function hasSubmitWithRepresentativeTargets(value) {
  const text = typeof value === 'string' ? value : '';
  return text.split(/[.!?;\u3002\uff01\uff1f\uff1b]+/u).some((clause) => (
    hasSubmitMeaning(clause)
    && clause.toLowerCase().includes('wren-7')
    && clause.toLowerCase().includes('lanterngate')
  ));
}

function hasRepresentativeTranslation(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const lower = text.toLowerCase();
  const chineseCharacterCount = (text.match(/[\u3400-\u9fff]/gu) || []).length;
  const hasDate = /30\s+september\s+2099/iu.test(text)
    || /2099\s*\u5e74\s*9\s*\u6708\s*30\s*\u65e5/u.test(text);
  const hasTime = /5(?::00)?\s*p\.?m\.?/iu.test(text)
    || /17(?::00)?/u.test(text)
    || /\u4e0b\u5348\s*5(?::00)?\s*(?:\u70b9|\u9ede)?/u.test(text);
  const rejectsFiller = /(?:\u65e0\u5173|\u7121\u95dc|\u586b\u5145|\u7f57\u5217|\u7f85\u5217|\u5173\u952e\u8bcd|\u95dc\u9375\u8a5e|\u6ca1\u6709\u7ffb\u8bd1|\u6c92\u6709\u7ffb\u8b6f|\u5e76\u975e\u7ffb\u8bd1|\u4e26\u975e\u7ffb\u8b6f|irrelevant|filler|keyword\s+list|not\s+a\s+translation)/iu.test(text);
  return text.length >= 40
    && chineseCharacterCount >= 20
    && !rejectsFiller
    && lower.includes('northstar intake')
    && lower.includes('wren-7')
    && lower.includes('lanterngate')
    && /(?:\u865a\u6784|\u865b\u69cb|fictional|invented)/iu.test(text)
    && /(?:\u6682\u5b9a|\u66ab\u5b9a|\u4e34\u65f6|\u81e8\u6642|\u5c1a\u672a\u6700\u7ec8|\u5c1a\u672a\u6700\u7d42|\u6682\u505c|\u66ab\u505c|\u6682\u7f13|\u66ab\u7de9|\u6401\u7f6e|on\s+hold|provisional|not\s+final|pending)/iu.test(text)
    && hasSubmitWithRepresentativeTargets(text)
    && (hasReplyMeaning(text) || hasReceiptConfirmationMeaning(text))
    && hasProcessMeaning(text)
    && hasRecordMeaning(text)
    && hasConfirmationMeaning(text)
    && hasDate
    && hasTime;
}

function hasDeadlineMeaning(value) {
  const text = value || '';
  return /5:00\s*PM/iu.test(text)
    && /30\s+September\s+2099/iu.test(text)
    && !/(?:not|no|never)\s+[^.!?]{0,20}5:00\s*PM/iu.test(text);
}

function hasTermExplanationMeaning(term, expectedSurface) {
  const explanation = term?.explanation || '';
  if (
    /(?:\u65e0\u5173|\u7121\u95dc|\u7edd\u975e|\u7d55\u975e|\u4e0d\u7528\u4e8e|\u4e0d\u7528\u65bc)/u.test(explanation)
    || /(?:unrelated|irrelevant|not\s+related|merely\s+(?:a\s+)?word)/iu.test(explanation)
    || /(?:\u4e0d\u662f|\u5e76\u4e0d\u662f|\u5e76\u975e|\u4e0d\u8868\u793a|\u4e0d\u610f\u5473\u7740)[^\uff0c\u3002\uff1b;]{0,20}(?:\u6682\u505c|\u66ab\u505c|\u6682\u5b9a|\u66ab\u5b9a|\u8868\u683c?|\u8868\u5355|\u8868\u55ae|\u95e8\u6237|\u9580\u6236)/u.test(explanation)
    || /(?:is\s+not|isn't|does\s+not\s+mean|doesn't\s+mean|not\s+really)\s+[^.!?]{0,24}(?:temporary|provisional|pause|hold|form|portal)/iu.test(explanation)
  ) return false;
  if (expectedSurface === 'on hold') {
    return /(?:\u6682\u505c|\u66ab\u505c|\u6682\u7f13|\u66ab\u7de9|\u6401\u7f6e|\u7b49\u5f85|\u505c\u4e0b|hold|pause|wait|delay)/iu.test(explanation);
  }
  if (expectedSurface === 'provisional') {
    return /(?:\u6682\u5b9a|\u66ab\u5b9a|\u4e34\u65f6|\u81e8\u6642|\u5c1a\u672a\u6700\u7ec8|\u5c1a\u672a\u6700\u7d42|\u5f85\u5b8c\u6210|not\s+final|temporary|provisional|pending)/iu.test(explanation);
  }
  if (expectedSurface === COMPATIBILITY_FORM_TERM_ANCHOR) {
    return /(?:\u8868\u683c?|\u8868\u5355|\u8868\u55ae|\u7533\u8bf7|\u7533\u8acb|\u7b7e\u5b57|\u7c3d\u5b57|\u7b7e\u7f72|\u7c3d\u7f72|\u63d0\u4ea4|form|application|sign|submit)/iu.test(explanation);
  }
  if (expectedSurface === COMPATIBILITY_PORTAL_TERM_ANCHOR) {
    return /(?:\u95e8\u6237|\u9580\u6236|\u5e73\u53f0|\u5e73\u81fa|\u7cfb\u7edf|\u7cfb\u7d71|\u7f51\u7ad9|\u7db2\u7ad9|\u63d0\u4ea4|portal|platform|system|site|submit)/iu.test(explanation);
  }
  return false;
}

function isGroundedTerm(term, kind, expectedSurface, sentence) {
  const surface = typeof term?.surface === 'string' ? term.surface.trim() : '';
  return term?.kind === kind
    && surface.toLowerCase() === expectedSurface.toLowerCase()
    && isNonEmptyText(term?.explanation)
    && hasTermExplanationMeaning(term, expectedSurface)
    && evidenceContainsTextWithinSentence(term, sentence, expectedSurface);
}

function getRepresentativeStructuredBriefChecks(brief) {
  const deadline = Array.isArray(brief?.deadlines)
    ? brief.deadlines.find((candidate) => (
      hasDeadlineMeaning(candidate?.whenText)
      && evidenceContainsTextWithinSentence(
        candidate,
        COMPATIBILITY_SUBMIT_SENTENCE,
        COMPATIBILITY_DEADLINE_PHRASE,
      )
    ))
    : null;
  const material = Array.isArray(brief?.materials)
    ? brief.materials.find((candidate) => (
      candidate?.requirement === 'required'
      && isNonEmptyText(candidate?.name)
      && [COMPATIBILITY_FORM_TERM_ANCHOR, COMPATIBILITY_MATERIAL_PHRASE]
        .some((allowedName) => candidate.name.trim().toLowerCase() === allowedName.toLowerCase())
      && evidenceContainsTextWithinSentence(
        candidate,
        COMPATIBILITY_SUBMIT_SENTENCE,
        COMPATIBILITY_MATERIAL_PHRASE,
      )
    ))
    : null;
  const submitAction = Array.isArray(brief?.nextSteps)
    ? brief.nextSteps.find((step) => (
      step?.actor === 'user'
      && step?.mandatory === true
      && step?.deadlineId === deadline?.id
      && isNonEmptyText(step?.action)
      && hasSubmitWithRepresentativeTargets(step.action)
      && evidenceContainsTextWithinSentence(
        step,
        COMPATIBILITY_SUBMIT_SENTENCE,
        COMPATIBILITY_SUBMIT_ACTION_PHRASE,
      )
    ))
    : null;
  const replyAction = Array.isArray(brief?.nextSteps)
    ? brief.nextSteps.find((step) => (
      step?.actor === 'user'
      && step?.mandatory === true
      && step?.deadlineId === null
      && isNonEmptyText(step?.action)
      && hasReceiptConfirmationMeaning(step.action)
      && evidenceContainsTextWithinSentence(
        step,
        COMPATIBILITY_REPLY_SENTENCE,
        COMPATIBILITY_REPLY_ACTION_PHRASE,
      )
    ))
    : null;
  const institutionalProcessContexts = Array.isArray(brief?.contexts)
    ? brief.contexts.filter((context) => context?.kind === 'institutional_process')
    : [];
  const hasProcessEvidence = (context) => evidenceCoversSentenceAnchors(
    context,
    COMPATIBILITY_PROCESS_PASSAGE,
    [
      'Northstar Intake',
      'institutional filing process',
      'portal receipt',
      'process record',
    ],
  );
  const processContextEvidence = institutionalProcessContexts.some(hasProcessEvidence);
  const processContext = institutionalProcessContexts.find((context) => (
      isNonEmptyText(context?.label)
      && /(?:\u6d41\u7a0b|\u7a0b\u5e8f|\u63d0\u4ea4|\u5f52\u6863|\u6b78\u6a94|process|filing|intake|submission)/iu
        .test(context.label)
      && `${context.label} ${context.whatItIs || ''}`.toLowerCase().includes('northstar intake')
      && hasProcessMeaning(context?.whatItIs)
      && isNonEmptyText(context?.whyItMatters)
      && context.whyItMatters.trim().length >= 6
      && hasRecordMeaning(context.whyItMatters)
      && hasConfirmationMeaning(context.whyItMatters)
      && /(?:northstar\s+intake|\u6d41\u7a0b|\u7a0b\u5e8f|process|intake)/iu.test(context.whyItMatters)
      && hasSubmitWithRepresentativeTargets(context?.whatToDo)
      && hasProcessEvidence(context)
  )) || null;
  const representativeProcessContext = processContext || institutionalProcessContexts[0] || null;

  return {
    validBrief: brief?.status === 'complete',
    structuredResponse: brief?.analysisProvenance?.responseKind === 'structured',
    translation: hasRepresentativeTranslation(brief?.translation?.text),
    deadline: Boolean(deadline),
    material: Boolean(material),
    submitAction: Boolean(submitAction),
    replyAction: Boolean(replyAction),
    generalTerm: Array.isArray(brief?.terms)
      && brief.terms.some((term) => (
        COMPATIBILITY_GENERAL_TERM_SPECS.some((spec) => (
          isGroundedTerm(term, 'general_term', spec.surface, spec.sentence)
        ))
      )),
    professionalTerm: Array.isArray(brief?.terms)
      && brief.terms.some((term) => (
        isGroundedTerm(
          term,
          'form',
          COMPATIBILITY_FORM_TERM_ANCHOR,
          COMPATIBILITY_PROCESS_SENTENCE,
        )
        || isGroundedTerm(
          term,
          'portal',
          COMPATIBILITY_PORTAL_TERM_ANCHOR,
          COMPATIBILITY_PROCESS_SENTENCE,
        )
      )),
    processContext: Boolean(processContext),
    processContextEvidence,
    contextWhatItIs: isNonEmptyText(representativeProcessContext?.whatItIs),
    contextWhyItMatters: isNonEmptyText(representativeProcessContext?.whyItMatters),
    contextWhatToDo: isNonEmptyText(representativeProcessContext?.whatToDo),
  };
}

function isRepresentativeStructuredBrief(brief) {
  return Object.values(getRepresentativeStructuredBriefChecks(brief)).every(Boolean);
}

function compatibilityErrorCode(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return CONNECTION_CODES.CANCELLED;

  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED) {
    return CONNECTION_CODES.REDIRECT_REJECTED;
  }
  if (status === 401 || status === 403 || code === 'invalid_api_key' || code === 'authentication_error') {
    return CONNECTION_CODES.UNAUTHORIZED;
  }
  if (status === 429 || code.includes('rate_limit') || code.includes('insufficient_quota')) {
    return CONNECTION_CODES.RATE_LIMITED;
  }
  if (
    code === 'model_not_found'
    || /model[^\n]*(not found|does not exist|\u4e0d\u5b58\u5728|\u672a\u627e\u5230)/i.test(message)
    || status === 404
  ) {
    return CONNECTION_CODES.MODEL_NOT_FOUND;
  }
  if (message.includes('\u9700\u8981\u5148\u6dfb\u52a0 api key') || message.includes('\u8bf7\u5148\u914d\u7f6e\u81ea\u5b9a\u4e49\u670d\u52a1\u5730\u5740')) {
    return CONNECTION_CODES.MISSING_CREDENTIALS;
  }
  if (
    code === 'etimedout'
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('\u6a21\u578b\u54cd\u5e94\u8d85\u65f6')
  ) {
    return CONNECTION_CODES.TIMEOUT;
  }
  if (
    code === 'econnrefused'
    || code === 'enotfound'
    || code === 'eai_again'
    || message.includes('fetch failed')
    || message.includes('failed to connect')
    || message.includes('network error')
    || message.includes('socket')
  ) {
    return CONNECTION_CODES.UNREACHABLE;
  }
  return CONNECTION_CODES.GENERATION_FAILED;
}

async function testFullAnalysisCompatibility(settings, dependencies = {}) {
  const processText = dependencies.processText || LLMService.processText;
  const analyzeOutput = dependencies.analyzeModelOutput || analyzeModelOutput;
  const signal = dependencies.signal;

  try {
    const response = await processText({
      text: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
      backend: settings?.activeBackend,
      model: settings?.activeModel,
      languageHint: 'en',
      ignoreCustomPrompt: true,
      settingsSnapshot: settings,
      signal,
    });
    if (signal?.aborted) return failed(CONNECTION_CODES.CANCELLED);
    if (response?.responseKind !== 'action_brief_candidate') {
      return failed(CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID);
    }

    const brief = analyzeOutput({
      sourceText: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
      rawOutput: response.result,
      provider: settings?.activeBackend || null,
      model: settings?.activeModel || null,
      processingTimeMs: response.processingTimeMs,
    });
    if (!isRepresentativeStructuredBrief(brief)) {
      return failed(CONNECTION_CODES.STRUCTURED_OUTPUT_INVALID);
    }
    return connected();
  } catch (error) {
    return failed(compatibilityErrorCode(error, signal));
  }
}

async function testProviderReadiness(settings, dependencies = {}) {
  const signal = dependencies.signal;
  const connectionTest = dependencies.testProviderConnection || testProviderConnection;
  const metadataResult = await connectionTest(settings, {
    ...(dependencies.connectionDependencies || {}),
    signal,
  });
  if (signal?.aborted) return failed(CONNECTION_CODES.CANCELLED);
  if (metadataResult?.status === CONNECTION_STATUSES.FAILED) return metadataResult;

  return testFullAnalysisCompatibility(settings, dependencies);
}

module.exports = {
  FULL_ANALYSIS_COMPATIBILITY_SOURCE,
  compatibilityErrorCode,
  getRepresentativeStructuredBriefChecks,
  isRepresentativeStructuredBrief,
  testFullAnalysisCompatibility,
  testProviderReadiness,
};
