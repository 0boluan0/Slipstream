'use strict';

const corpus = require('../quality-benchmark/cases.json');
const {
  scoreBenchmarkCase,
  summarizeBenchmark,
  validateBenchmarkCorpus,
} = require('../quality-benchmark/scoring');
const {
  liveUsage,
  parseLiveOptions,
} = require('../quality-benchmark/live-options');

class CaseTimeoutError extends Error {
  constructor() {
    super('Benchmark case timed out');
    this.name = 'CaseTimeoutError';
  }
}

function selectCases(options) {
  const requested = new Set(options.caseIds);
  const unknown = [...requested].filter((id) => !corpus.cases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) throw new Error('One or more requested benchmark case ids are unknown');
  const selected = requested.size === 0
    ? corpus.cases
    : corpus.cases.filter((testCase) => requested.has(testCase.id));
  return selected.slice(0, options.maxCases);
}

function modelLabel(model) {
  return ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(model)
    ? model
    : 'custom-deepseek-model';
}

function safeLiveFailure(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || error?.statusCode || 0);
  if (error instanceof CaseTimeoutError || /timeout|timed out|aborted/iu.test(message)) {
    return { code: 'live.timeout', message: 'The model did not finish within the per-case timeout.' };
  }
  if (status === 401 || status === 403 || /authentication|unauthorized|invalid api key/iu.test(message)) {
    return { code: 'live.authentication', message: 'DeepSeek authentication failed.' };
  }
  if (status === 429 || /rate limit/iu.test(message)) {
    return { code: 'live.rate-limit', message: 'DeepSeek rate-limited the benchmark request.' };
  }
  if (/fetch failed|network|socket|econn/iu.test(message)) {
    return { code: 'live.network', message: 'The model request failed at the network boundary.' };
  }
  return { code: 'live.provider-error', message: 'The production model path returned an error.' };
}

async function withCaseTimeout(task, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CaseTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runCase({
  testCase,
  model,
  options,
  processText,
  analyzeModelOutput,
}) {
  const startedAt = Date.now();
  try {
    const response = await withCaseTimeout((signal) => processText({
      text: testCase.source,
      backend: 'deepseek',
      model,
      languageHint: 'en',
      ignoreCustomPrompt: true,
      signal,
    }), options.timeoutMs);
    const rawOutput = response.result;
    const brief = analyzeModelOutput({
      sourceText: testCase.source,
      rawOutput,
      provider: 'deepseek',
      model: modelLabel(model),
      processingTimeMs: response.processingTimeMs,
    });
    const score = scoreBenchmarkCase({
      testCase,
      brief,
      passThreshold: options.passThreshold,
      requireChineseTranslation: true,
    });
    return {
      ...score,
      status: score.pass ? 'passed' : 'failed',
      processingTimeMs: response.processingTimeMs,
      briefStatus: brief.status,
      responseKind: brief?.analysisProvenance?.responseKind || 'unknown',
    };
  } catch (error) {
    const failure = safeLiveFailure(error);
    return {
      caseId: testCase.id,
      domain: testCase.domain,
      pass: false,
      score: 0,
      status: 'failed',
      processingTimeMs: Date.now() - startedAt,
      failures: [{ ...failure, critical: true }],
    };
  }
}

async function main() {
  const options = parseLiveOptions(process.argv.slice(2), corpus.cases.length);
  if (options.help) {
    console.log(liveUsage(corpus.cases.length));
    return;
  }

  const validation = validateBenchmarkCorpus(corpus);
  if (!validation.valid) throw new Error('Local benchmark corpus validation failed');
  const selectedCases = selectCases(options);
  if (selectedCases.length === 0) throw new Error('No benchmark cases selected');

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({
      status: 'skipped',
      code: 'missing-deepseek-api-key',
      hint: 'Set DEEPSEEK_API_KEY only for this process; never add it to a project file.',
    }));
    process.exitCode = 1;
    return;
  }

  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  // Production modules are intentionally loaded only after argument and key
  // validation so --help and missing-key checks cannot acquire store handles.
  const { analyzeModelOutput } = require('../src/main/analysis');
  const persistentStore = require('../src/main/store');
  const { processText } = require('../src/main/llm-service');
  const originalGetAllSettings = persistentStore.getAllSettings;
  persistentStore.getAllSettings = () => ({
    activeBackend: 'deepseek',
    activeModel: model,
    deepseekApiKey: apiKey,
    languageHint: 'en',
    customPrompt: 'LIVE_BENCHMARK_CUSTOM_PROMPT_MUST_BE_IGNORED',
  });

  const startedAt = Date.now();
  const results = [];
  try {
    for (const testCase of selectedCases) {
      results.push(await runCase({
        testCase,
        model,
        options,
        processText,
        analyzeModelOutput,
      }));
    }
  } finally {
    persistentStore.getAllSettings = originalGetAllSettings;
  }

  const summary = summarizeBenchmark(results);
  const fullCorpus = selectedCases.length === corpus.cases.length;
  const output = {
    status: summary.pass ? (fullCorpus ? 'passed' : 'partial') : 'failed',
    benchmark: corpus.schemaVersion,
    model: modelLabel(model),
    options: {
      selectedCases: selectedCases.length,
      timeoutMs: options.timeoutMs,
      passThreshold: options.passThreshold,
      fullCorpus,
      chineseTranslationBoundary: true,
    },
    summary,
    durationMs: Date.now() - startedAt,
    results,
  };
  const serialized = JSON.stringify(output, null, 2);
  if (summary.pass) console.log(serialized);
  else console.error(serialized);
  if (!summary.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'failed',
    code: 'live-benchmark-configuration-error',
    message: error instanceof Error ? error.message : 'Unknown configuration error',
  }));
  process.exitCode = 1;
});
