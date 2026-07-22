const assert = require('assert');
const { splitTextIntoChunks } = require('../src/main/llm-service');

function sameAfterChunking(text, maxLength) {
  const chunks = splitTextIntoChunks(text, maxLength);
  assert.strictEqual(chunks.join(''), text);
  return chunks;
}

assert.deepStrictEqual(splitTextIntoChunks('short text', 50), ['short text']);

const paragraphs = `Paragraph one stays together.\n\n${'Paragraph two sentence. '.repeat(8)}\n\nLast paragraph.`;
const paragraphChunks = sameAfterChunking(paragraphs, 80);
assert(paragraphChunks.length > 1);
assert(paragraphChunks.every((chunk) => chunk.length <= 80));

const sentences = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
const sentenceChunks = sameAfterChunking(sentences, 35);
assert(sentenceChunks.length > 1);
assert(sentenceChunks.every((chunk) => chunk.length <= 35));

const longWord = 'x'.repeat(121);
const hardChunks = sameAfterChunking(longWord, 50);
assert.deepStrictEqual(hardChunks.map((chunk) => chunk.length), [50, 50, 21]);

console.log('long text chunking check passed');
