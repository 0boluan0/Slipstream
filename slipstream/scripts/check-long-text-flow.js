const assert = require('assert');
const { mergeChunkResults, processLongTextChunks } = require('../src/main/llm-service');

async function main() {
  const calls = [];
  const text = 'This is a sentence about ABC. '.repeat(220);
  const result = await processLongTextChunks({
    text,
    settings: {},
    backend: 'openai',
    model: 'fake',
    languageHint: 'en',
    systemPrompt: 'system',
    buildContext: async () => '',
    translateChunk: async (_systemPrompt, userMessage) => {
      calls.push(userMessage);
      return `1. 中文翻译\n\n翻译${calls.length}\n\n2. 专有名词 / 缩写 / 机构 / 课程名\n\nABC：测试术语`;
    },
  });

  assert(calls.length > 1);
  assert(result.includes('翻译1'));
  assert(result.includes(`翻译${calls.length}`));
  assert(result.indexOf('翻译1') < result.indexOf(`翻译${calls.length}`));
  assert.strictEqual((result.match(/ABC：测试术语/g) || []).length, 1);
  assert(!result.includes('第 1/'));

  const englishResult = mergeChunkResults([
    '1. **English Translation**\n\nFirst translation.\n\n2. **Proper Noun / Term Explanations**\n\nABC: test term',
    '1. **English Translation**\n\nSecond translation.\n\n2. **Proper Noun / Term Explanations**\n\nABC: duplicate',
  ], 'zh');
  assert(englishResult.includes('First translation.'));
  assert(englishResult.includes('Second translation.'));
  assert.strictEqual((englishResult.match(/ABC:/g) || []).length, 1);
  console.log('long text flow check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
