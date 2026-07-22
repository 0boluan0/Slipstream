const { PROMPT_TEMPLATES } = require('../src/shared/constants.cjs');

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
