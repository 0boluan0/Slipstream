const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PROMPT_TEMPLATES } = require('../src/shared/constants.cjs');

const rendererConstantsSource = fs.readFileSync(
  path.join(__dirname, '../src/shared/constants.js'),
  'utf8',
);

assert.doesNotMatch(
  rendererConstantsSource,
  /PROMPT_TEMPLATES|DEFAULT_SYSTEM_PROMPT|DEFAULT_USER_PROMPT|DEFAULT_PROMPTS/,
  'provider prompts must remain main-process-only and stay out of the renderer entry',
);

const checks = [
  ['en', ['逐句', '逐段', '保留原文', '不要总结', '不要概括']],
  ['zh', ['sentence by sentence', 'paragraph by paragraph', 'preserve the original order', 'do not summarize']],
  ['auto', ['sentence by sentence', 'paragraph by paragraph', 'preserve the original order', 'do not summarize']],
];

for (const [language, words] of checks) {
  const prompt = `${PROMPT_TEMPLATES[language].system}\n${PROMPT_TEMPLATES[language].user}`;
  const missing = words.filter((word) => !prompt.includes(word));
  if (missing.length) {
    throw new Error(`${language} prompt is missing: ${missing.join(', ')}`);
  }
}
