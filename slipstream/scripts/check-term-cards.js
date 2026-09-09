'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTermCardStore } = require('../src/main/term-card-store');
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slipstream-terms-check-'));
  try {
    const store = createTermCardStore(directory);
    const input = { term: 'conditional expectation', label: '条件期望', meaning: '给定一部分信息后，随机变量的平均值。',
      context: '文中强调估计取决于已经观测到的信息。', source: 'The conditional expectation depends on the observed information.', kind: 'concept' };
    const [first, duplicate] = await Promise.all([store.save(input), store.save(input)]);
    assert.equal(first.card.id, duplicate.card.id);
    assert.equal((await store.list()).cards.length, 1, 'concurrent saves must not duplicate one source card');
    const file = await store.filePath(first.card.id);
    assert.match(await fs.readFile(file, 'utf8'), /## 概念解释/);
    assert.equal((await createTermCardStore(directory).list()).cards[0].meaning, input.meaning, 'restart must retain the complete definition');
    const context2 = await store.save({ ...input, source: 'A different use of conditional expectation.' });
    assert.notEqual(context2.card.id, first.card.id, 'a new reading context must not overwrite an existing card');
    const edited = await store.edit(first.card.id, { ...first.card, notes: '我自己的理解\n## 我的理解\n保留这个标题', links: [context2.card.id] }, first.card.revision);
    assert.equal(edited.links[0], context2.card.id);
    const reloaded = (await store.list()).cards.find((card) => card.id === edited.id);
    assert.equal(reloaded.notes, '我自己的理解\n## 我的理解\n保留这个标题');
    assert.equal(reloaded.source, input.source);
    await assert.rejects(store.edit(first.card.id, { ...edited, notes: 'stale' }, first.card.revision), /card-conflict/);
    await assert.rejects(store.filePath('../../outside'), /card-invalid-id/);
    await fs.writeFile(path.join(directory, 'unrelated.md'), 'This file belongs to the reader.');
    assert.equal((await store.list()).unreadable, 1);
    assert.equal(await fs.readFile(path.join(directory, 'unrelated.md'), 'utf8'), 'This file belongs to the reader.');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('我自己的理解', '外部编辑'));
    await assert.rejects(store.edit(first.card.id, { ...edited, notes: 'overwrite' }, edited.revision), /card-conflict/);
    console.log('Term cards passed: Markdown round trip, durable storage, concurrent deduplication, independent contexts, personal notes, concept links, external-edit conflicts and bounded IDs.');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
