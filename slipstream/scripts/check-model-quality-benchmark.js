'use strict';

const assert = require('node:assert/strict');
const corpus = require('../quality-benchmark/cases.json');
const { buildGoldenBrief } = require('../quality-benchmark/golden');
const { parseLiveOptions } = require('../quality-benchmark/live-options');
const {
  scoreBenchmarkCase,
  summarizeBenchmark,
  validateBenchmarkCorpus,
} = require('../quality-benchmark/scoring');
const { validateActionBrief } = require('../src/shared/action-brief.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findCase(id) {
  const testCase = corpus.cases.find((candidate) => candidate.id === id);
  assert.ok(testCase, `missing benchmark case: ${id}`);
  return testCase;
}

function assertMutationFails({
  name,
  testCase,
  mutate,
  expectedFailureCode,
}) {
  const mutatedBrief = clone(buildGoldenBrief(testCase));
  mutate(mutatedBrief, testCase);
  const result = scoreBenchmarkCase({ testCase, brief: mutatedBrief });
  assert.equal(result.pass, false, `${name} mutation must fail`);
  assert.ok(
    result.failures.some((failure) => failure.code === expectedFailureCode),
    `${name} mutation must fail with ${expectedFailureCode}`,
  );
  return {
    name,
    rejected: true,
    score: result.score,
    failureCodes: result.failures.map((failure) => failure.code),
  };
}

function main() {
  const validation = validateBenchmarkCorpus(corpus);
  assert.equal(validation.valid, true, validation.errors.join('\n'));

  const goldenResults = corpus.cases.map((testCase) => {
    const goldenBrief = buildGoldenBrief(testCase);
    const schemaValidation = validateActionBrief(goldenBrief, { sourceText: testCase.source });
    assert.equal(
      schemaValidation.valid,
      true,
      `${testCase.id} golden brief schema failed: ${schemaValidation.errors.join('; ')}`,
    );
    const result = scoreBenchmarkCase({ testCase, brief: goldenBrief });
    assert.equal(
      result.pass,
      true,
      `${testCase.id} golden brief failed: ${result.failures.map((failure) => failure.code).join(', ')}`,
    );
    return result;
  });
  const goldenSummary = summarizeBenchmark(goldenResults);
  assert.equal(goldenSummary.pass, true, 'all golden briefs must pass');

  const liveDefaults = parseLiveOptions([], corpus.cases.length);
  assert.equal(liveDefaults.maxCases, corpus.cases.length, 'live benchmark must run the full corpus by default');
  for (const unsafeFlag of ['--show-source', '--show-raw-output']) {
    assert.throws(
      () => parseLiveOptions([unsafeFlag], corpus.cases.length),
      /Unsupported option/u,
      `${unsafeFlag} must remain unavailable`,
    );
  }

  const translationBoundaryCase = findCase('university-course-change');
  const englishGolden = buildGoldenBrief(translationBoundaryCase);
  const rejectedEnglishTranslation = scoreBenchmarkCase({
    testCase: translationBoundaryCase,
    brief: englishGolden,
    requireChineseTranslation: true,
  });
  assert.equal(rejectedEnglishTranslation.pass, false, 'live boundary must reject non-Chinese translation output');
  assert.ok(
    rejectedEnglishTranslation.failures.some((failure) => failure.code === 'translation.chinese-boundary'),
    'live boundary must report translation.chinese-boundary',
  );
  const chineseBoundaryGolden = clone(englishGolden);
  chineseBoundaryGolden.translation.text = '这是一份用于离线验证的中文行动简报，保留了所有虚构的表格、门户和截止日期标识。';
  const acceptedChineseTranslation = scoreBenchmarkCase({
    testCase: translationBoundaryCase,
    brief: chineseBoundaryGolden,
    requireChineseTranslation: true,
  });
  assert.equal(acceptedChineseTranslation.pass, true, 'live boundary must accept substantial Chinese output');

  const universityCase = findCase('university-course-change');
  const noActionCase = findCase('government-closed-status-notice');
  const mutations = [
    assertMutationFails({
      name: 'missing-required-action',
      testCase: universityCase,
      mutate: (brief) => {
        brief.nextSteps = brief.nextSteps.filter((step) => !step.action.includes('Sparrow-12'));
      },
      expectedFailureCode: 'action.submit-course-change.present',
    }),
    assertMutationFails({
      name: 'hallucinated-action',
      testCase: noActionCase,
      mutate: (brief) => {
        brief.nextSteps.push({
          id: 'step-hallucinated',
          action: 'Submit the invented Nebula-88 permit immediately.',
          actor: 'user',
          urgency: 'now',
          mandatory: true,
          deadlineId: null,
          prerequisiteStepIds: [],
          provenance: {
            kind: 'inference',
            confidence: 1,
            note: null,
            evidence: [{
              quote: 'Submit the invented Nebula-88 permit immediately.',
              start: 0,
              end: 49,
              match: 'exact',
              ambiguous: false,
            }],
            citations: [],
          },
        });
      },
      expectedFailureCode: 'hallucination.source-grounding',
    }),
    assertMutationFails({
      name: 'wrong-calendar-date',
      testCase: universityCase,
      mutate: (brief) => {
        brief.deadlines[0].calendarDate = '2099-10-01';
      },
      expectedFailureCode: 'deadline.course-change-deadline.calendar-date',
    }),
    assertMutationFails({
      name: 'wrong-reply-channel',
      testCase: universityCase,
      mutate: (brief) => {
        const replyStep = brief.nextSteps.find((step) => /reply/iu.test(step.action));
        assert.ok(replyStep, 'golden reply step is required for the mutation');
        replyStep.action = 'Call the fictional office instead.';
      },
      expectedFailureCode: 'reply.required',
    }),
    assertMutationFails({
      name: 'inverted-action-command',
      testCase: universityCase,
      mutate: (brief) => {
        const submitStep = brief.nextSteps.find((step) => step.action.includes('Sparrow-12'));
        assert.ok(submitStep, 'golden submit step is required for the mutation');
        submitStep.action = 'Do not submit the signed Sparrow-12 Course Change Form in LanternGate.';
      },
      expectedFailureCode: 'action.submit-course-change.present',
    }),
  ];

  console.log(JSON.stringify({
    status: 'passed',
    corpus: {
      schemaVersion: corpus.schemaVersion,
      cases: validation.stats.cases,
      domains: validation.stats.domains,
      syntheticOnly: corpus.metadata.syntheticOnly,
      containsPersonalData: corpus.metadata.containsPersonalData,
    },
    golden: goldenSummary,
    liveSafety: {
      defaultCases: liveDefaults.maxCases,
      sourceLoggingOptionRejected: true,
      rawOutputLoggingOptionRejected: true,
      chineseTranslationBoundary: {
        rejectsEnglish: true,
        acceptsSubstantialChinese: true,
      },
    },
    mutations,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    status: 'failed',
    code: 'model-quality-benchmark-regression',
    message: error instanceof Error ? error.message : 'Unknown benchmark failure',
  }));
  process.exitCode = 1;
}
