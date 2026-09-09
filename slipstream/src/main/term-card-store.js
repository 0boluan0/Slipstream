'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ID = /^[a-f0-9-]{36}$/u;
const FIELDS = ['id', 'term', 'label', 'created', 'updated', 'kind', 'links'];
const SECTIONS = ['概念解释', '在原文中的用法', '原文', '我的理解'];
const normalize = (text) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
const revision = (text) => crypto.createHash('sha256').update(text).digest('hex');
const bounded = (value, limit) => typeof value === 'string' && value.length <= limit;

function encodeCard(card) {
  const metadata = FIELDS.map((key) => `${key}: ${JSON.stringify(card[key])}`).join('\n');
  const bodies = [card.meaning, card.context, card.source, card.notes];
  const references = (card.references || []).map((reference) => `- [${reference.term.replace(/[[\]\\\n]/gu, ' ')}](${encodeURI(reference.fileName)})`).join('\n');
  return `---\n${metadata}\n---\n\n# ${card.term.replace(/\s+/gu, ' ')}${card.label ? ` · ${card.label.replace(/\s+/gu, ' ')}` : ''}\n\n`
    + SECTIONS.map((heading, i) => `## ${heading}\n\n${(bodies[i] || '').replace(/^(\\*)## /gmu, '\\$1## ')}\n`).join('\n')
    + (references ? `\n## 关联卡片\n\n${references}\n` : '');
}

function decodeCard(text) {
  if (typeof text !== 'string' || text.length > 100000) throw new Error('card-invalid-file');
  const header = text.match(/^---\n([\s\S]*?)\n---\n/u);
  if (!header) throw new Error('card-invalid-file');
  const card = {};
  for (const line of header[1].split('\n')) {
    const colon = line.indexOf(':');
    const key = line.slice(0, colon);
    if (FIELDS.includes(key)) card[key] = JSON.parse(line.slice(colon + 1));
  }
  if (!ID.test(card.id) || !bounded(card.term, 1500) || !card.term.trim()
    || !bounded(card.label, 180) || !Array.isArray(card.links)
    || card.links.some((id) => !ID.test(id))) throw new Error('card-invalid-file');
  const body = text.slice(header[0].length);
  const positions = SECTIONS.map((heading) => body.indexOf(`\n## ${heading}\n`));
  if (positions.some((position, i) => position < 0 || (i && position <= positions[i - 1]))) throw new Error('card-invalid-file');
  ['meaning', 'context', 'source', 'notes'].forEach((key, i) => {
    const referencesAt = body.indexOf('\n## 关联卡片\n');
    card[key] = body.slice(positions[i] + SECTIONS[i].length + 5, positions[i + 1] ?? (referencesAt >= 0 ? referencesAt : body.length)).trim().replace(/^\\(\\*)## /gmu, '$1## ');
  });
  card.revision = revision(text);
  return card;
}

function createTermCardStore(directory) {
  let writes = Promise.resolve();
  const serialized = (operation) => {
    const next = writes.then(operation, operation);
    writes = next.catch(() => {});
    return next;
  };
  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('card-unsafe-directory');
  }
  async function list() {
    await ensureDirectory();
    const files = await fs.readdir(directory, { withFileTypes: true });
    const cards = [];
    let unreadable = 0;
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      try {
        const filePath = path.join(directory, file.name);
        if ((await fs.stat(filePath)).size > 512000) throw new Error('card-too-large');
        const card = decodeCard(await fs.readFile(filePath, 'utf8'));
        if (cards.some((other) => other.id === card.id)) throw new Error('card-duplicate-id');
        cards.push({ ...card, fileName: file.name });
      } catch { unreadable += 1; }
    }
    cards.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return { cards, unreadable, directory };
  }
  async function write(card, fileName, expectedRevision) {
    const destination = path.join(directory, fileName);
    if (expectedRevision) {
      if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('card-unsafe-file');
      if (revision(await fs.readFile(destination, 'utf8')) !== expectedRevision) throw new Error('card-conflict');
    }
    const references = card.links.length ? (await list()).cards.filter((entry) => card.links.includes(entry.id)) : [];
    const text = encodeCard({ ...card, references });
    const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
      // An external editor may have saved while this write was being prepared.
      if (expectedRevision && revision(await fs.readFile(destination, 'utf8')) !== expectedRevision) throw new Error('card-conflict');
      await fs.rename(temporary, destination);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return { ...card, fileName, revision: revision(text) };
  }
  async function find(id) {
    if (!ID.test(id)) throw new Error('card-invalid-id');
    const card = (await list()).cards.find((entry) => entry.id === id);
    if (!card) throw new Error('card-not-found');
    return card;
  }
  function save(input) {
    return serialized(async () => {
      if (!bounded(input?.term, 1500) || !input.term.trim() || !bounded(input.label, 180)
        || !bounded(input.meaning, 40000) || !input.meaning.trim() || !bounded(input.context, 4000)
        || !bounded(input.source, 10000) || !input.source.includes(input.term)) throw new Error('card-invalid-input');
      const { cards } = await list();
      const existing = cards.find((card) => normalize(card.term) === normalize(input.term)
        && card.source === input.source && card.kind === input.kind);
      if (existing) return { card: existing, existing: true };
      const now = new Date().toISOString();
      const card = { id: crypto.randomUUID(), term: input.term, label: input.label,
        meaning: input.meaning, context: input.context, source: input.source, notes: '',
        created: now, updated: now, kind: input.kind === 'concept' ? 'concept' : 'translation', links: [] };
      const slug = input.term.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 70) || 'term';
      return { card: await write(card, `${slug}--${card.id}.md`), existing: false };
    });
  }
  function edit(id, input, expectedRevision) {
    return serialized(async () => {
      const card = await find(id);
      if (card.revision !== expectedRevision) throw new Error('card-conflict');
      if (!bounded(input?.label, 180) || !bounded(input.meaning, 40000) || !input.meaning.trim()
        || !bounded(input.context, 4000) || !bounded(input.notes, 20000)
        || !Array.isArray(input.links) || input.links.length > 100
        || input.links.some((link) => !ID.test(link) || link === id)) throw new Error('card-invalid-input');
      const ids = new Set((await list()).cards.map((entry) => entry.id));
      if (input.links.some((link) => !ids.has(link))) throw new Error('card-not-found');
      return write({ ...card, label: input.label, meaning: input.meaning, context: input.context,
        notes: input.notes, links: [...new Set(input.links)], updated: new Date().toISOString() }, card.fileName, expectedRevision);
    });
  }
  async function filePath(id) {
    const card = await find(id);
    const file = path.join(directory, card.fileName);
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('card-unsafe-file');
    return file;
  }
  return { list, save, edit, filePath, directory };
}

module.exports = { createTermCardStore, encodeCard, decodeCard };
