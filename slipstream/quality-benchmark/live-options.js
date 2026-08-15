'use strict';

const DEFAULT_TIMEOUT_MS = 70000;
const DEFAULT_PASS_THRESHOLD = 0.9;

function parseInteger(value, optionName, { min, max }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${optionName} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('--threshold must be between 0 and 1');
  }
  return parsed;
}

function readOptionValue(argv, index, name) {
  const argument = argv[index];
  const inlinePrefix = `${name}=`;
  if (argument.startsWith(inlinePrefix)) {
    return { value: argument.slice(inlinePrefix.length), consumed: 0 };
  }
  if (argument === name && typeof argv[index + 1] === 'string') {
    return { value: argv[index + 1], consumed: 1 };
  }
  return null;
}

function parseLiveOptions(argv, totalCases) {
  if (!Number.isSafeInteger(totalCases) || totalCases < 1) {
    throw new Error('totalCases must be a positive integer');
  }
  const options = {
    caseIds: [],
    maxCases: totalCases,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    passThreshold: DEFAULT_PASS_THRESHOLD,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--all') {
      options.maxCases = totalCases;
      continue;
    }

    const caseOption = readOptionValue(argv, index, '--case');
    if (caseOption) {
      options.caseIds.push(...caseOption.value.split(',').map((value) => value.trim()).filter(Boolean));
      index += caseOption.consumed;
      continue;
    }
    const maxOption = readOptionValue(argv, index, '--max');
    if (maxOption) {
      options.maxCases = parseInteger(maxOption.value, '--max', { min: 1, max: totalCases });
      index += maxOption.consumed;
      continue;
    }
    const timeoutOption = readOptionValue(argv, index, '--timeout-ms');
    if (timeoutOption) {
      options.timeoutMs = parseInteger(timeoutOption.value, '--timeout-ms', { min: 1000, max: 180000 });
      index += timeoutOption.consumed;
      continue;
    }
    const thresholdOption = readOptionValue(argv, index, '--threshold');
    if (thresholdOption) {
      options.passThreshold = parseThreshold(thresholdOption.value);
      index += thresholdOption.consumed;
      continue;
    }
    throw new Error('Unsupported option. Use --help for the accepted benchmark options.');
  }

  return options;
}

function liveUsage(totalCases) {
  return [
    'Usage: node scripts/check-deepseek-quality-live.js [options]',
    '',
    'Options:',
    '  --case <id[,id]>       Run exact benchmark case ids; may be repeated.',
    `  --max <n>              Explicit smoke-run limit (default: all ${totalCases} cases).`,
    '  --all                  Run every selected case.',
    `  --timeout-ms <n>       Per-case timeout (default: ${DEFAULT_TIMEOUT_MS}).`,
    `  --threshold <0..1>     Per-case score threshold (default: ${DEFAULT_PASS_THRESHOLD}).`,
    '  --help                 Show this help.',
    '',
    'Authentication: set DEEPSEEK_API_KEY for this process only.',
    'Reports contain metadata, scores, and failure codes only; source text, raw model output, and the key are never printed.',
  ].join('\n');
}

module.exports = {
  DEFAULT_PASS_THRESHOLD,
  DEFAULT_TIMEOUT_MS,
  liveUsage,
  parseLiveOptions,
};
