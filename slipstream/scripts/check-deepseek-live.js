const { analyzeModelOutput } = require('../src/main/analysis');
const persistentStore = require('../src/main/store');
const { processText } = require('../src/main/llm-service');
const { testProviderConnection } = require('../src/main/provider-connection');
const {
  FULL_ANALYSIS_COMPATIBILITY_SOURCE,
  compatibilityErrorCode,
  getRepresentativeStructuredBriefChecks,
  isRepresentativeStructuredBrief,
} = require('../src/main/provider-readiness');

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const modelLabel = ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(model)
  ? model
  : 'custom-deepseek-model';
const SAFE_BRIEF_STATUSES = new Set(['complete', 'partial', 'translation_only', 'invalid']);
const SAFE_RESPONSE_KINDS = new Set([
  'structured',
  'invalid',
  'legacy_unstructured',
  'legacy_two_section',
  'translation_only',
]);
const SAFE_TERM_KINDS = new Set([
  'proper_noun', 'abbreviation', 'specialist_term', 'general_term', 'institution',
  'course', 'policy', 'form', 'portal', 'other',
]);
const SAFE_WARNING_CODES = new Set([
  'NON_STRICT_JSON_WRAPPER',
  'INVALID_TERM_DROPPED',
  'UNSUPPORTED_TERM_DROPPED',
  'UNLINKED_PENDING_TERM',
  'INVALID_CONTEXT_DROPPED',
  'UNSUPPORTED_CONTEXT_DROPPED',
  'UNLINKED_PENDING_CONTEXT',
  'INVALID_DEADLINE_DROPPED',
  'UNSUPPORTED_DEADLINE_DROPPED',
  'UNSAFE_CALENDAR_DEADLINE_DROPPED',
  'UNSAFE_NORMALIZED_DEADLINE_DROPPED',
  'INVALID_MATERIAL_DROPPED',
  'UNSUPPORTED_MATERIAL_DROPPED',
  'INVALID_NEXT_STEP_DROPPED',
  'UNSUPPORTED_NEXT_STEP_DROPPED',
  'INVALID_DEADLINE_REFERENCE',
  'INVALID_STEP_DEPENDENCIES',
  'INVALID_STEP_DEPENDENCY_REFERENCE',
  'CYCLIC_STEP_DEPENDENCIES_DROPPED',
  'INVALID_VERIFICATION_DROPPED',
  'UNSUPPORTED_VERIFICATION_DROPPED',
  'UNVERIFIED_OFFICIAL_CLAIM_DOWNGRADED',
  'INVALID_VERIFICATION_REFERENCE',
  'MISMATCHED_VERIFICATION_REFERENCE',
  'INVALID_VERIFICATION_LOOKUP_DROPPED',
  'INVALID_LOOKUP_URLS_DROPPED',
  'UNSAFE_LOOKUP_URL_DROPPED',
  'LOOKUP_URLS_TRUNCATED',
  'INVALID_CONTENT_BLOCK_DROPPED',
  'OFFICIAL_PROVENANCE_DOWNGRADED',
  'MODEL_WARNING',
  'INVALID_ARRAY_DROPPED',
  'ARRAY_TRUNCATED',
]);

function safeEnum(value, allowed, fallback = 'unknown') {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function printResult(payload, failed = false) {
  const output = JSON.stringify(payload);
  if (failed) console.error(output);
  else console.log(output);
}

function compatibilityDiagnostics(brief) {
  const checks = getRepresentativeStructuredBriefChecks(brief);
  const terms = Array.isArray(brief?.terms) ? brief.terms : [];
  const contexts = Array.isArray(brief?.contexts) ? brief.contexts : [];
  const provisionalTerm = terms.find((term) => (
    typeof term?.surface === 'string'
    && term.surface.trim().toLowerCase() === 'provisional'
  ));
  const deadline = (brief?.deadlines || []).find((candidate) => (
    typeof candidate?.whenText === 'string'
    && candidate.whenText.toLowerCase().includes('30 september 2099')
  ));
  const submitStep = (brief?.nextSteps || []).find((step) => (
    step?.provenance?.evidence?.some((evidence) => (
      typeof evidence?.quote === 'string'
      && evidence.quote.includes('submit the signed Wren-7 Intake Form')
    ))
  ));
  const replyStep = (brief?.nextSteps || []).find((step) => (
    step?.provenance?.evidence?.some((evidence) => (
      typeof evidence?.quote === 'string'
      && evidence.quote.includes('Reply to confirm receipt')
    ))
  ));
  const institutionalContext = contexts.find((context) => context?.kind === 'institutional_process');
  const generalTermAnchors = [
    'on hold',
    'provisional',
    'filing process',
    'portal receipt',
    'process record',
    'confirm receipt',
    'entered the intake',
  ];
  const generalTermAnchorChecks = Object.fromEntries(generalTermAnchors.map((anchor) => {
    const matchingTerms = terms.filter((term) => (
      typeof term?.surface === 'string'
      && term.surface.toLowerCase().includes(anchor)
    ));
    return [anchor, {
      surfacePresent: matchingTerms.length > 0,
      generalKind: matchingTerms.some((term) => term?.kind === 'general_term'),
      exactEvidence: matchingTerms.some((term) => term?.provenance?.evidence?.some((evidence) => (
        evidence?.match === 'exact'
        && typeof evidence?.quote === 'string'
        && evidence.quote.toLowerCase().includes(anchor)
      ))),
    }];
  }));
  const processAnchors = [
    'northstar intake',
    'institutional filing process',
    'lanterngate portal',
    'portal receipt',
    'process record',
    'entered the intake',
  ];
  const processAnchorChecks = Object.fromEntries(processAnchors.map((anchor) => [
    anchor,
    contexts.some((context) => context?.provenance?.evidence?.some((evidence) => (
      evidence?.match === 'exact'
      && typeof evidence?.quote === 'string'
      && evidence.quote.toLowerCase().includes(anchor)
    ))),
  ]));
  const warningCodes = [...new Set((brief?.warnings || []).map((warning) => (
    safeEnum(warning?.code, SAFE_WARNING_CODES, 'UNKNOWN_WARNING')
  )))];
  return {
    briefStatus: safeEnum(brief?.status, SAFE_BRIEF_STATUSES),
    responseKind: safeEnum(brief?.analysisProvenance?.responseKind, SAFE_RESPONSE_KINDS),
    validBrief: checks.validBrief,
    warningCodes,
    counts: {
      terms: brief?.terms?.length || 0,
      contexts: brief?.contexts?.length || 0,
      deadlines: brief?.deadlines?.length || 0,
      materials: brief?.materials?.length || 0,
      nextSteps: brief?.nextSteps?.length || 0,
    },
    capabilities: {
      translation: checks.translation,
      deadline: checks.deadline,
      material: checks.material,
      submitAction: checks.submitAction,
      replyAction: checks.replyAction,
      generalTerm: checks.generalTerm,
      professionalTerm: checks.professionalTerm,
      processContext: checks.processContext,
      processContextEvidence: checks.processContextEvidence,
      contextSections: {
        whatItIs: checks.contextWhatItIs,
        whyItMatters: checks.contextWhyItMatters,
        whatToDo: checks.contextWhatToDo,
      },
    },
    generalTermProbe: {
      anyGeneralTerm: terms.some((term) => term?.kind === 'general_term'),
      provisionalSurfacePresent: Boolean(provisionalTerm),
      provisionalKind: provisionalTerm
        ? safeEnum(provisionalTerm.kind, SAFE_TERM_KINDS)
        : null,
      provisionalEvidencePresent: Boolean(provisionalTerm?.provenance?.evidence?.some((evidence) => (
        typeof evidence?.quote === 'string'
        && evidence.quote.includes('provisional')
      ))),
      anchors: generalTermAnchorChecks,
    },
    processContextProbe: {
      anyInstitutionalProcess: contexts.some((context) => context?.kind === 'institutional_process'),
      anySocialProcess: contexts.some((context) => context?.kind === 'social_process'),
      anyCulturalContext: contexts.some((context) => context?.kind === 'cultural'),
      anyCompleteSections: contexts.some((context) => (
        typeof context?.whatItIs === 'string' && context.whatItIs.trim()
        && typeof context?.whyItMatters === 'string' && context.whyItMatters.trim()
        && typeof context?.whatToDo === 'string' && context.whatToDo.trim()
      )),
      labelNamesProcess: institutionalContext?.label?.toLowerCase().includes('northstar intake') || false,
      whatItIsNamesProcess: institutionalContext?.whatItIs?.toLowerCase().includes('northstar intake') || false,
      whatItIsDescribesProcess: /(?:\u6d41\u7a0b|\u7a0b\u5e8f|process|filing)/iu
        .test(institutionalContext?.whatItIs || ''),
      whyItMattersNamesRecord: /(?:\u6536\u636e|\u6536\u64da|\u51ed\u8bc1|\u6191\u8b49|\u51ed\u636e|\u6191\u64da|\u8bb0\u5f55|\u8a18\u9304|\u7559\u75d5|\u8ffd\u8e2a|\u8ffd\u8e64|\u8ddf\u8e2a|receipt|record|proof|evidence|track|trace)/iu
        .test(institutionalContext?.whyItMatters || ''),
      whyItMattersDescribesConfirmation: /(?:\u786e\u8ba4|\u78ba\u8a8d|\u8bc1\u660e|\u8b49\u660e|\u8868\u660e|\u663e\u793a|\u986f\u793a|\u8fdb\u5165|\u9032\u5165|\u7eb3\u5165|\u7d0d\u5165|\u53d7\u7406|\u63a5\u6536|\u6536\u5230|\u5df2\u63d0\u4ea4|\u63d0\u4ea4\u6210\u529f|\u53ef\u67e5|\u53ef\u8ffd|confirm|entered|received|accepted|submitted|processed|track|trace)/iu
        .test(institutionalContext?.whyItMatters || ''),
      whatToDoNamesForm: institutionalContext?.whatToDo?.toLowerCase().includes('wren-7 intake form') || false,
      whatToDoNamesPortal: institutionalContext?.whatToDo?.toLowerCase().includes('lanterngate') || false,
      whatToDoSubmitsForm: /(?:\u63d0\u4ea4|\u9012\u4ea4|\u4e0a\u4ea4|submit)/iu
        .test(institutionalContext?.whatToDo || '')
        && /(?:\u8868\u683c?|form|wren-7)/iu.test(institutionalContext?.whatToDo || ''),
      whatToDoUsesPortal: /(?:\u95e8\u6237|\u9580\u6236|portal|lanterngate)/iu
        .test(institutionalContext?.whatToDo || ''),
      evidenceAnchors: processAnchorChecks,
    },
    submitActionProbe: {
      evidenceMatchedStep: Boolean(submitStep),
      actorUser: submitStep?.actor === 'user',
      mandatory: submitStep?.mandatory === true,
      deadlineMatched: Boolean(deadline),
      deadlineLinked: Boolean(deadline?.id) && submitStep?.deadlineId === deadline.id,
      actionNamesForm: submitStep?.action?.toLowerCase().includes('wren-7 intake form') || false,
      actionNamesWren: submitStep?.action?.toLowerCase().includes('wren-7') || false,
      actionNamesPortal: submitStep?.action?.toLowerCase().includes('lanterngate') || false,
      actionSubmitsForm: /(?:\u63d0\u4ea4|\u9012\u4ea4|\u4e0a\u4ea4|submit)/iu.test(submitStep?.action || '')
        && /(?:\u8868\u683c?|form|wren-7)/iu.test(submitStep?.action || ''),
    },
    replyActionProbe: {
      evidenceMatchedStep: Boolean(replyStep),
      actorUser: replyStep?.actor === 'user',
      mandatory: replyStep?.mandatory === true,
      noDeadline: replyStep?.deadlineId === null,
      actionNamesReply: /(?:\u56de\u590d|\u56de\u8986|\u56de\u4fe1|\u7b54\u590d|\u7b54\u8986|\u56de\u51fd|reply|respond|write\s+back)/iu
        .test(replyStep?.action || ''),
      actionConfirmsReceipt: /(?:\u786e\u8ba4|\u78ba\u8a8d|\u544a\u77e5|\u901a\u77e5|confirm|acknowledge|notify)/iu
        .test(replyStep?.action || '')
        && /(?:\u6536\u5230|\u6536\u6089|\u63a5\u6536|\u6536\u4ef6|receipt|received|receiving)/iu
          .test(replyStep?.action || ''),
    },
  };
}

async function main() {
  if (!apiKey) {
    printResult({
      status: 'skipped',
      code: 'missing-deepseek-api-key',
      hint: 'Set DEEPSEEK_API_KEY only for this command; never add it to a project file.',
    }, true);
    process.exitCode = 1;
    return;
  }

  const metadata = await testProviderConnection({
    activeBackend: 'deepseek',
    activeModel: model,
    deepseekApiKey: apiKey,
  });
  if (metadata.status !== 'connected' || metadata.code !== 'ok') {
    printResult({
      status: 'failed',
      stage: 'metadata',
      model: modelLabel,
      code: metadata.code,
    }, true);
    process.exitCode = 1;
    return;
  }

  const originalGetAllSettings = persistentStore.getAllSettings;
  persistentStore.getAllSettings = () => ({
    activeBackend: 'deepseek',
    activeModel: model,
    deepseekApiKey: apiKey,
    languageHint: 'en',
    customPrompt: 'LIVE_TEST_CUSTOM_PROMPT_MUST_BE_IGNORED',
  });
  let response;
  try {
    response = await processText({
      text: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
      backend: 'deepseek',
      model,
      languageHint: 'en',
      ignoreCustomPrompt: true,
    });
  } finally {
    persistentStore.getAllSettings = originalGetAllSettings;
  }
  const rawOutput = response.result;
  const processingTimeMs = response.processingTimeMs;
  const brief = analyzeModelOutput({
    sourceText: FULL_ANALYSIS_COMPATIBILITY_SOURCE,
    rawOutput,
    provider: 'deepseek',
    model: modelLabel,
    processingTimeMs,
  });
  const structuredBrief = isRepresentativeStructuredBrief(brief);

  printResult({
    status: structuredBrief ? 'connected' : 'failed',
    stage: 'full-analysis',
    model: modelLabel,
    metadata: metadata.code,
    structuredBrief,
    outputChars: rawOutput.length,
    processingTimeMs,
    ...(!structuredBrief ? { diagnostics: compatibilityDiagnostics(brief) } : {}),
  }, !structuredBrief);
  if (!structuredBrief) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    printResult({
      status: 'failed',
      stage: 'full-analysis',
      model: modelLabel,
      code: compatibilityErrorCode(error),
    }, true);
    process.exitCode = 1;
  });
}

module.exports = { compatibilityDiagnostics };
