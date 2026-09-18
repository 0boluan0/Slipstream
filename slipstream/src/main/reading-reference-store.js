'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { referenceKey, referenceOccurrences } = require('./reading-references');

const bounded = (value, limit) => typeof value === 'string' && value.length <= limit;
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/u.test(id);

function validateEntry(input) {
  if (!bounded(input?.symbol, 120) || !input.symbol.trim() || !bounded(input.meaning, 1500) || !input.meaning.trim()
    || !bounded(input.scope, 160) || !bounded(input.evidence, 3000) || !bounded(input.source, 10000)
    || !['excerpt', 'manual'].includes(input.origin)
    || (input.evidence && !input.source.includes(input.evidence))
    || (input.origin === 'excerpt' && (!input.evidence || !referenceOccurrences(input.evidence, input.symbol).length))) {
    throw new Error('reference-invalid-entry');
  }
}

function createReadingReferenceStore(directory) {
  const file = path.join(directory, 'references.json');
  let writes = Promise.resolve();
  async function read() {
    try {
      if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('reference-unsafe-directory');
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('reference-invalid-file');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.papers) || (data.activePaperId !== null && !validId(data.activePaperId))) throw new Error('reference-invalid-file');
      const ids = new Set();
      for (const paper of data.papers) {
        if (!validId(paper.id) || ids.has(paper.id) || !bounded(paper.title, 120) || !paper.title.trim()
          || !Array.isArray(paper.entries)) throw new Error('reference-invalid-file');
        ids.add(paper.id);
        const entries = new Set();
        for (const entry of paper.entries) {
          validateEntry(entry);
          if (!validId(entry.id) || entries.has(entry.id) || !Number.isSafeInteger(entry.revision)) throw new Error('reference-invalid-file');
          entries.add(entry.id);
        }
      }
      if (data.activePaperId && !ids.has(data.activePaperId)) throw new Error('reference-invalid-file');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, activePaperId: null, papers: [] };
      throw error;
    }
  }
  function mutate(operation) {
    const next = writes.then(async () => {
      const data = await read();
      const result = operation(data);
      const text = JSON.stringify(data, null, 2) + '\n';
      if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('reference-store-full');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('reference-unsafe-directory');
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return result;
    });
    writes = next.catch(() => {});
    return next;
  }
  function find(data, id) {
    const paper = data.papers.find((item) => item.id === id);
    if (!paper) throw new Error('reference-paper-not-found');
    return paper;
  }
  function title(value) {
    if (!bounded(value, 120) || !value.trim()) throw new Error('reference-invalid-title');
    return value.trim();
  }
  const touch = (paper) => { paper.updated = new Date().toISOString(); };
  return {
    read, directory,
    create: (name) => mutate((data) => {
      const paper = { id: randomUUID(), title: title(name), entries: [], updated: new Date().toISOString() };
      data.papers.unshift(paper);
      data.activePaperId = paper.id;
      return paper;
    }),
    select: (id) => mutate((data) => { if (id !== null) find(data, id); data.activePaperId = id; }),
    rename: (id, name) => mutate((data) => { const paper = find(data, id); paper.title = title(name); touch(paper); }),
    add: (id, input) => mutate((data) => {
      validateEntry(input);
      const paper = find(data, id);
      const existing = paper.entries.find((entry) => referenceKey(entry.symbol) === referenceKey(input.symbol)
        && entry.evidence === input.evidence && entry.source === input.source && entry.scope === input.scope
        && (input.origin === 'excerpt' || entry.meaning === input.meaning));
      if (existing) return existing;
      const entry = { ...input, symbol: input.symbol.trim(), meaning: input.meaning.trim(), id: randomUUID(), revision: 1 };
      paper.entries.push(entry);
      touch(paper);
      return entry;
    }),
    edit: (paperId, id, input, revision) => mutate((data) => {
      validateEntry(input);
      const paper = find(data, paperId);
      const entry = paper.entries.find((item) => item.id === id);
      if (!entry || entry.revision !== revision) throw new Error('reference-conflict');
      Object.assign(entry, input, { id, revision: revision + 1 });
      touch(paper);
      return entry;
    }),
    removeEntry: (paperId, id, revision) => mutate((data) => {
      const paper = find(data, paperId);
      const entry = paper.entries.find((item) => item.id === id);
      if (!entry || entry.revision !== revision) throw new Error('reference-conflict');
      paper.entries = paper.entries.filter((item) => item.id !== id);
      touch(paper);
      return entry;
    }),
    removePaper: (id) => mutate((data) => {
      const paper = find(data, id);
      data.papers = data.papers.filter((item) => item.id !== id);
      if (data.activePaperId === id) data.activePaperId = null;
      return paper;
    }),
    restorePaper: (paper) => mutate((data) => {
      if (data.papers.some((item) => item.id === paper.id)) throw new Error('reference-conflict');
      data.papers.unshift(paper);
      data.activePaperId = paper.id;
    }),
  };
}

module.exports = { createReadingReferenceStore };
