'use strict';

// Evaluation sets live outside product code (eval/ for development cases, a
// sealed file outside the repository for held-out cases). This module loads
// either kind, runs it against the configured reading service and records
// automatic checks. Graders' criteria are never sent to the model.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { referenceKey } = require('./reading-references');

const PLAIN_FORMAT = 'slipstream-eval/1';
const BUNDLE_FORMAT = 'slipstream-eval-bundle/1';
const SEALED_FORMAT = 'slipstream-sealed-eval/1';
const SUITES = new Set(['lookup', 'terms', 'references', 'translation', 'image']);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function sealEval(plaintext, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw new Error('eval-passphrase-too-short');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return { format: SEALED_FORMAT, kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64') };
}

function unsealEval(envelope, passphrase) {
  if (envelope?.format !== SEALED_FORMAT || envelope.cipher !== 'aes-256-gcm' || envelope.kdf?.name !== 'scrypt') {
    throw new Error('eval-not-sealed');
  }
  const key = crypto.scryptSync(passphrase, Buffer.from(envelope.kdf.salt, 'base64'), 32,
    { N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p, maxmem: SCRYPT.maxmem });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('eval-wrong-key-or-damaged');
  }
}

function readPassphrase(keyFile) {
  if (!keyFile) return null;
  const passphrase = fs.readFileSync(keyFile, 'utf8').trim();
  if (passphrase.length < 16) throw new Error('eval-passphrase-too-short');
  return passphrase;
}

function validCase(suite, item) {
  if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(item.id)
    || typeof item.source !== 'string' || !item.source.trim() || item.source.length > 10000) return false;
  const patterns = [...(item.mustMatch || []), ...(item.mustNotMatch || []), ...(item.sourceMustMatch || [])];
  if (patterns.some((pattern) => typeof pattern !== 'string')) return false;
  if (suite === 'lookup') return typeof item.selection === 'string' && item.source.includes(item.selection);
  if (suite === 'terms') return item.empty === true || typeof item.required === 'string';
  if (suite === 'references') return Array.isArray(item.expected) && item.expected.every((symbol) => typeof symbol === 'string');
  return true;
}

function validateSuite(value) {
  if (!SUITES.has(value?.suite) || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > 500) {
    throw new Error('eval-invalid-suite');
  }
  const ids = new Set();
  for (const item of value.cases) {
    if (!validCase(value.suite, item) || ids.has(item.id)) throw new Error(`eval-invalid-case:${item?.id || '?'}`);
    ids.add(item.id);
  }
  return { suite: value.suite, cases: value.cases };
}

// Returns { visibility, suites:[{suite,cases}] }. Sealed files need a key file.
function loadEvalFile(file, { keyFile } = {}) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.format === PLAIN_FORMAT) return { visibility: raw.visibility || 'dev', sealed: false, suites: [validateSuite(raw)] };
  if (raw.format !== SEALED_FORMAT) throw new Error('eval-unknown-format');
  const passphrase = readPassphrase(keyFile);
  if (!passphrase) throw new Error('eval-key-required');
  const bundle = JSON.parse(unsealEval(raw, passphrase));
  if (bundle.format !== BUNDLE_FORMAT || !Array.isArray(bundle.suites)) throw new Error('eval-unknown-format');
  return { visibility: 'held-out', sealed: true, passphrase, suites: bundle.suites.map(validateSuite) };
}

function patternChecks(text, { mustMatch = [], mustNotMatch = [] }) {
  return [
    ...mustMatch.map((pattern) => ({ check: `matches ${pattern}`, passed: new RegExp(pattern, 'u').test(text) })),
    ...mustNotMatch.map((pattern) => ({ check: `avoids ${pattern}`, passed: !new RegExp(pattern, 'u').test(text) })),
  ];
}

function anchoredTerms(source, terms) {
  return terms.every((term) => source.slice(term.start, term.end) === term.quote
    && !/[\p{L}\p{N}_-]$/u.test(source.slice(0, term.start))
    && !/^[\p{L}\p{N}_-]/u.test(source.slice(term.end)));
}

const runners = {
  async lookup(item, { processReadingText, settings, signal }) {
    const start = item.source.indexOf(item.selection);
    const result = await processReadingText({ text: item.source, kind: 'lookup', selection: item.selection,
      ...(item.occurrence === 'first' ? { selectionRange: { start, end: start + item.selection.length } } : {}),
      settingsSnapshot: settings, signal });
    return { output: result.lookup, checks: patternChecks(`${result.lookup.meaning}\n${result.lookup.note}`, item) };
  },
  async translation(item, { processReadingText, settings, signal, timing }) {
    const result = await processReadingText({ text: item.source, withTerms: true, settingsSnapshot: settings, signal,
      onTranslation: () => timing.firstResult() });
    return { output: result, checks: patternChecks(result.translation, item) };
  },
  async terms(item, { processReadingText, settings, signal, timing }) {
    const result = await processReadingText({ text: item.source, withTerms: true, settingsSnapshot: settings, signal,
      onTranslation: () => timing.firstResult() });
    const quotes = result.terms.map((term) => term.quote.toLowerCase());
    const required = item.required?.toLowerCase();
    return { output: result, checks: [
      { check: 'every suggestion is anchored to whole source words', passed: anchoredTerms(item.source, result.terms) },
      item.empty
        ? { check: 'no suggestion', passed: quotes.length === 0 }
        : { check: `suggests ${item.required}`, passed: quotes.some((quote) => quote === required
          || quote.endsWith(` ${required}`) || quote.startsWith(`${required} `)) },
      ...(item.excluded || []).map((term) => ({ check: `omits ${term}`, passed: !quotes.includes(term.toLowerCase()) })),
    ] };
  },
  async references(item, { processReadingText, settings, signal }) {
    const result = await processReadingText({ text: item.source, withTerms: true, withReferences: true,
      settingsSnapshot: settings, signal });
    const found = result.references.map((entry) => referenceKey(entry.symbol)).sort();
    const expected = item.expected.map(referenceKey).sort();
    return { output: result, checks: [{ check: `extracts exactly ${JSON.stringify(item.expected)}`,
      passed: JSON.stringify(found) === JSON.stringify(expected) }] };
  },
  async image(item, { readScreenshot, renderImage, settings, signal, timing }) {
    if (!readScreenshot || !renderImage) throw new Error('eval-image-unavailable');
    const image = await renderImage(item.source);
    const result = await readScreenshot({ image, settingsSnapshot: settings, signal, onTranslation: () => timing.firstResult() });
    return { output: { text: result.text, translation: result.translation, uncertain: result.uncertain, terms: result.terms },
      checks: [...patternChecks(result.text, { mustMatch: item.sourceMustMatch || [] }), ...patternChecks(result.translation, item)] };
  },
};

// Runs every case once per repetition, in order. The criteria field stays in
// the record for graders; only source and selection reach the service.
async function runEvalSuites({ suites, repetitions = 1, onlyCase, timeoutMs = 90000, onRecord, ...services }) {
  const records = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const { suite, cases } of suites) {
      for (const item of cases) {
        if (onlyCase && item.id !== onlyCase) continue;
        const started = Date.now();
        let firstResultMs;
        const timing = { firstResult: () => { firstResultMs ??= Date.now() - started; } };
        const record = { suite, id: item.id, repetition };
        try {
          const { output, checks } = await runners[suite](item, { ...services, timing, signal: AbortSignal.timeout(timeoutMs) });
          Object.assign(record, { output, checks, automaticPass: checks.every((entry) => entry.passed),
            semanticStatus: ['terms', 'references'].includes(suite) ? 'scored' : 'needs-review' });
        } catch (error) {
          Object.assign(record, { failure: { code: /^(?:reading|eval)-[a-z-]+$/u.test(error?.message || '') ? error.message : error?.name || 'Error',
            status: Number.isInteger(error?.status) ? error.status : null }, automaticPass: false, semanticStatus: 'unavailable' });
        }
        record.elapsedMs = Date.now() - started;
        record.firstResultMs = firstResultMs ?? record.elapsedMs;
        records.push(record);
        onRecord?.(record);
      }
    }
  }
  return records;
}

function summarizeEval(records) {
  const count = (predicate) => records.filter(predicate).length;
  const elapsed = records.filter((record) => !record.failure).map((record) => record.firstResultMs).sort((a, b) => a - b);
  return {
    total: records.length,
    failures: count((record) => record.failure),
    automaticPass: count((record) => record.automaticPass),
    needsReview: count((record) => record.semanticStatus === 'needs-review'),
    medianFirstResultMs: elapsed.length ? elapsed[Math.floor((elapsed.length - 1) / 2)] : null,
    slowestFirstResultMs: elapsed.at(-1) ?? null,
    bySuite: Object.fromEntries([...new Set(records.map((record) => record.suite))].map((suite) => [suite, {
      total: count((record) => record.suite === suite),
      automaticPass: count((record) => record.suite === suite && record.automaticPass),
    }])),
  };
}

module.exports = { BUNDLE_FORMAT, PLAIN_FORMAT, SEALED_FORMAT, loadEvalFile, readPassphrase, runEvalSuites,
  sealEval, summarizeEval, unsealEval };
