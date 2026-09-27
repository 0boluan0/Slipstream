const { execFile } = require('child_process');
const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');
const { createOcrEnvironment } = require('./ocr-environment');
const { createLocalFormulaOcr } = require('./local-formula-ocr');
const { mergeFormulaDocument } = require('./formula-document');
const { reconcileProseOcr } = require('./prose-ocr-reconciliation');
const { missingInteriorRows, orderedAgreement, rect } = require('./interior-prose-recheck');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const OCR_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'ocr-swift-runner.sh')
  : path.join(APP_ROOT, 'scripts', 'ocr-swift-runner.sh');
const formulaOcr = createLocalFormulaOcr(app.isPackaged
  ? path.join(process.resourcesPath, 'formula-models') : path.join(APP_ROOT, 'formula-models'));

function frontmostDocumentWindow() {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    let environment;
    try { environment = createOcrEnvironment(path.join(app.getPath('userData'), 'ocr-cache')); }
    catch { resolve(null); return; }
    execFile('/bin/bash', [OCR_SCRIPT, '--front-window'], {
      timeout: 20000, maxBuffer: 4096, env: environment,
    }, (error, stdout) => {
      if (error) { resolve(null); return; }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve(null); }
    });
  });
}

/**
 * Clean raw OCR text by normalizing whitespace and removing garbage.
 * @param {string} rawText
 * @returns {string}
 */
function cleanOcrText(rawText) {
  if (!rawText) return '';
  return rawText
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // remove control chars
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines
    .replace(/\s{2,}/g, ' ') // collapse multiple spaces
    .replace(/[=]{3,}/g, ''); // remove === separators
}

/**
 * Perform OCR on the given image file using the Swift Vision script.
 * @param {string} imagePath - Absolute path to the image file.
 * @returns {Promise<{text: string, confidence: number, blocks: Array}>}
 */
function performOCR(imagePath, { signal, characters = false, padEdges = false } = {}) {
  return new Promise((resolve, reject) => {
    const cacheDir = path.join(app.getPath('userData'), 'ocr-cache');
    let settled = false;
    let child;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      child?.kill('SIGTERM');
      const error = new Error('OCR cancelled by user');
      error.isCancellation = true;
      finish(reject, error);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    let environment;
    try {
      environment = createOcrEnvironment(cacheDir);
    } catch (error) {
      finish(reject, error);
      return;
    }
    child = execFile('/bin/bash', [OCR_SCRIPT, imagePath, ...(characters ? ['--characters'] : []), ...(padEdges ? ['--pad-edges'] : [])], {
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      env: environment,
    }, (error, stdout, stderr) => {
      if (error) {
        if (signal?.aborted) {
          const cancellation = new Error('OCR cancelled by user');
          cancellation.isCancellation = true;
          return finish(reject, cancellation);
        }
        // Swift prints structured errors to stdout; shell/compiler errors usually use stderr.
        try {
          const errData = JSON.parse((stdout || stderr).trim());
          if (errData && errData.error) {
            return finish(reject, new Error(errData.error));
          }
        } catch (_) {
          // stderr isn't JSON, fall through
        }
        return finish(reject, new Error(`OCR script failed: ${error.message}`));
      }

      try {
        const result = JSON.parse(stdout.trim());

        if (result.error) {
          return finish(reject, new Error(result.error));
        }

        finish(resolve, {
          text: cleanOcrText(result.text || ''),
          confidence: result.confidence || 0,
          blocks: result.blocks || [],
          spellJoinCandidates: result.spellJoinCandidates || [],
        });
      } catch (parseError) {
        finish(reject, new Error(`Failed to parse OCR output: ${parseError.message}`));
      }
    });
  });
}

async function recheckReferenceOne(imagePath, original, padded, temporary, { signal } = {}) {
  const source = original?.blocks || [], alternative = padded?.blocks || [];
  if (!source.some((block) => /\b(?:Figure|Table|Equation|Algorithm) I\b/u.test(block.text))) return original;
  const image = nativeImage.createFromPath(imagePath), size = image.getSize();
  if (image.isEmpty()) return original;
  const blocks = source.slice();
  let checked = 0;
  for (let row = 0; row < blocks.length && checked < 4; row++) {
    const block = blocks[row];
    const match = /\b(?:Figure|Table|Equation|Algorithm) I\b/u.exec(block.text);
    if (!match || !block.boundingBox || !block.characters?.length
      || block.characters.length !== Array.from(block.text).length) continue;
    const corrected = block.text.slice(0, match.index) + match[0].replace(/I$/u, '1')
      + block.text.slice(match.index + match[0].length);
    const alternativeRow = alternative.find((candidate) => candidate.confidence >= .9
      && candidate.text === corrected && candidate.boundingBox
      && Math.abs(candidate.boundingBox.y + candidate.boundingBox.h / 2
        - block.boundingBox.y - block.boundingBox.h / 2) < Math.min(candidate.boundingBox.h, block.boundingBox.h) * .6);
    if (!alternativeRow) continue;
    const first = Array.from(block.text.slice(0, Math.max(0, match.index - 4))).length;
    const last = Array.from(block.text.slice(0, match.index + match[0].length)).length;
    const chars = block.characters.slice(first, last).filter((char) => char.boundingBox.w > 0 && char.boundingBox.h > 0);
    if (chars.length < 3) continue;
    const x = Math.max(0, Math.floor(Math.min(...chars.map((char) => char.boundingBox.x)) * size.width) - 8);
    const right = Math.min(size.width, Math.ceil(Math.max(...chars.map((char) => char.boundingBox.x + char.boundingBox.w)) * size.width) + 8);
    const y = Math.max(0, Math.floor((1 - Math.max(...chars.map((char) => char.boundingBox.y + char.boundingBox.h))) * size.height) - 8);
    const bottom = Math.min(size.height, Math.ceil((1 - Math.min(...chars.map((char) => char.boundingBox.y))) * size.height) + 8);
    if (right - x < 40 || bottom - y < 12) continue;
    const crop = path.join(temporary, `reference-${checked++}.png`);
    await fs.writeFile(crop, image.crop({ x, y, width: right - x, height: bottom - y }).toPNG(), { mode: 0o600 });
    const confirmed = await performOCR(crop, { signal }).catch((error) => {
      if (signal?.aborted || error?.isCancellation) throw error;
      return null;
    });
    if (!confirmed || confirmed.confidence < .9 || !confirmed.text.includes(match[0].replace(/I$/u, '1'))) continue;
    const index = last - 1;
    blocks[row] = { ...block, text: corrected, characters: block.characters.map((char, i) =>
      i === index ? { ...char, text: '1' } : char) };
  }
  return { ...original, blocks };
}

async function recheckRightEdgeWord(imagePath, original, padded, temporary, { signal, recognize = performOCR } = {}) {
  const source = original?.blocks || [], alternative = padded?.blocks || [];
  if (!source.length || !alternative.length) return original;
  const image = nativeImage.createFromPath(imagePath), size = image.getSize();
  if (image.isEmpty()) return original;
  const blocks = source.slice();
  let checked = 0;
  for (let row = 0; row < blocks.length && checked < 3; row++) {
    const block = blocks[row];
    const word = /[A-Za-z]+(?:-[A-Za-z]+)?$/u.exec(block.text);
    if (!word || !block.boundingBox || block.boundingBox.x + block.boundingBox.w < .82
      || !block.characters?.length || block.characters.length !== Array.from(block.text).length) continue;
    const normalizePrefix = (value) => value.replace(/[‘’“”"']/gu, '"').replace(/\s+/gu, ' ');
    const prior = normalizePrefix(block.text.slice(0, word.index));
    const replacement = alternative.find((candidate) => {
      const other = /[A-Za-z]+(?:-[A-Za-z]+)?$/u.exec(candidate.text);
      if (!other || !candidate.boundingBox || candidate.confidence < .9
        || normalizePrefix(candidate.text.slice(0, other.index)) !== prior
        || Math.abs(candidate.boundingBox.x - block.boundingBox.x) > .08
        || Math.abs(candidate.boundingBox.x + candidate.boundingBox.w
          - block.boundingBox.x - block.boundingBox.w) > .08
        || Math.abs(candidate.boundingBox.y + candidate.boundingBox.h / 2
          - block.boundingBox.y - block.boundingBox.h / 2) >= Math.min(candidate.boundingBox.h, block.boundingBox.h) * .6
        || other[0].length !== word[0].length) return false;
      return [...other[0]].filter((letter, i) => letter !== word[0][i]).length === 1;
    });
    if (!replacement) continue;
    const other = /[A-Za-z]+(?:-[A-Za-z]+)?$/u.exec(replacement.text)[0];
    const start = Array.from(block.text.slice(0, Math.max(0, word.index - 6))).length;
    const letters = block.characters.slice(start).filter((char) => char.boundingBox.w > 0 && char.boundingBox.h > 0);
    if (letters.length < other.length) continue;
    const x = Math.max(0, Math.floor(Math.min(...letters.map((char) => char.boundingBox.x)) * size.width) - 15);
    const right = Math.min(size.width, Math.ceil(Math.max(...letters.map((char) => char.boundingBox.x + char.boundingBox.w)) * size.width) + 15);
    const y = Math.max(0, Math.floor((1 - Math.max(...letters.map((char) => char.boundingBox.y + char.boundingBox.h))) * size.height) - 12);
    const bottom = Math.min(size.height, Math.ceil((1 - Math.min(...letters.map((char) => char.boundingBox.y))) * size.height) + 12);
    if (right - x < 30 || bottom - y < 12) continue;
    const crop = path.join(temporary, `edge-word-${checked++}.png`);
    await fs.writeFile(crop, image.crop({ x, y, width: right - x, height: bottom - y }).toPNG(), { mode: 0o600 });
    const confirmed = await recognize(crop, { signal }).catch((error) => {
      if (signal?.aborted || error?.isCancellation) throw error;
      return null;
    });
    const tail = confirmed?.text?.trim() || '';
    if (!confirmed || confirmed.confidence < .9 || !tail.endsWith(other)
      || (tail.length > other.length && /[A-Za-z-]/u.test(tail.at(-other.length - 1)))) continue;
    const wordStart = Array.from(block.text.slice(0, word.index)).length;
    blocks[row] = { ...block, text: block.text.slice(0, word.index) + other,
      characters: block.characters.map((char, i) => i >= wordStart
        ? { ...char, text: other[i - wordStart] } : char) };
  }
  return { ...original, blocks };
}

async function recheckEmptyEdgeQuote(imagePath, original, temporary, { signal, recognize = performOCR } = {}) {
  const source = original?.blocks || [];
  if (!source.some((block) => /(?:""|“”|‘’)(?=\s*$)/u.test(block.text))) return original;
  const image = nativeImage.createFromPath(imagePath), size = image.getSize();
  if (image.isEmpty()) return original;
  const blocks = source.slice();
  let checked = 0;
  for (let row = 0; row < blocks.length && checked < 2; row++) {
    const block = blocks[row], match = /(?:""|“”|‘’)(?=\s*$)/u.exec(block.text);
    if (!match || !block.boundingBox || block.boundingBox.x + block.boundingBox.w < .85
      || !block.characters?.length || block.characters.length !== Array.from(block.text).length) continue;
    const index = Array.from(block.text.slice(0, match.index)).length;
    const quotes = block.characters.slice(index, index + 2);
    if (quotes.length !== 2 || quotes.some((char) => !char.boundingBox?.w || !char.boundingBox?.h)) continue;
    const readings = [];
    for (const before of [18, 8]) {
      const chars = block.characters.slice(Math.max(0, index - before), index + 2)
        .filter((char) => char.boundingBox.w > 0 && char.boundingBox.h > 0);
      if (chars.length < 2) break;
      const x = Math.max(0, Math.floor(Math.min(...chars.map((char) => char.boundingBox.x)) * size.width) - 20);
      const right = Math.min(size.width, Math.ceil(Math.max(...chars.map((char) => char.boundingBox.x + char.boundingBox.w)) * size.width) + 20);
      const y = Math.max(0, Math.floor((1 - Math.max(...chars.map((char) => char.boundingBox.y + char.boundingBox.h))) * size.height) - 8);
      const bottom = Math.min(size.height, Math.ceil((1 - Math.min(...chars.map((char) => char.boundingBox.y))) * size.height) + 16);
      if (right - x < 70 || bottom - y < 20) break;
      const crop = path.join(temporary, `edge-quote-${checked}-${before}.png`);
      await fs.writeFile(crop, image.crop({ x, y, width: right - x, height: bottom - y }).toPNG(), { mode: 0o600 });
      const result = await recognize(crop, { signal }).catch((error) => {
        if (signal?.aborted || error?.isCancellation) throw error;
        return null;
      });
      const letter = result?.text?.trim().match(/["“‘]([A-Za-z0-9])["”’]$/u)?.[1];
      if (!letter || result.confidence < .9) break;
      readings.push(letter);
    }
    checked++;
    if (readings.length !== 2 || readings[0] !== readings[1]) continue;
    const first = quotes[0].boundingBox, second = quotes[1].boundingBox;
    const x = Math.min(first.x, second.x), y = Math.min(first.y, second.y);
    const shared = { x, y, w: Math.max(first.x + first.w, second.x + second.w) - x,
      h: Math.max(first.y + first.h, second.y + second.h) - y };
    const characters = block.characters.slice();
    characters.splice(index, 2, { ...quotes[0], boundingBox: shared },
      { text: readings[0], boundingBox: shared }, { ...quotes[1], boundingBox: shared });
    blocks[row] = { ...block, text: block.text.slice(0, match.index + 1) + readings[0]
      + block.text.slice(match.index + 1), characters };
  }
  return { ...original, blocks };
}

async function recheckAmbiguousProseZero(imagePath, original, masked, temporary,
  { signal, recognize = performOCR } = {}) {
  const source = original?.blocks || [], comparison = masked?.blocks || [];
  if (!source.length || !comparison.length) return original;
  const image = nativeImage.createFromPath(imagePath), size = image.getSize();
  if (image.isEmpty()) return original;
  const box = (char) => ({ x: char.boundingBox.x * size.width,
    y: (1 - char.boundingBox.y - char.boundingBox.h) * size.height,
    w: char.boundingBox.w * size.width, h: char.boundingBox.h * size.height });
  const sameGlyph = (a, b) => Math.abs(a.x + a.w / 2 - b.x - b.w / 2) < Math.max(a.w, b.w) * .45
    && Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < Math.max(a.h, b.h) * .35;
  const normalize = (value) => value.replace(/\s+/gu, ' ').trim().toLowerCase();
  const blocks = source.slice(), verifiedGlyphConflicts = [];
  let checked = 0;
  for (let row = 0; row < blocks.length && checked < 3; row++) {
    const block = blocks[row], chars = block.characters || [], rowText = Array.from(block.text);
    if (block.confidence < .9 || chars.length !== rowText.length) continue;
    for (let index = 1; index < chars.length - 1 && checked < 3; index++) {
      const char = chars[index];
      if (!/^[Oo]$/u.test(char.text) || !/\W/u.test(chars[index - 1].text)
        || !/\W/u.test(chars[index + 1].text) || !char.boundingBox?.w || !char.boundingBox?.h) continue;
      const before = rowText.slice(Math.max(0, index - 8), index).join('');
      const after = rowText.slice(index + 1, index + 7).join('');
      if (before.trim().length < 5 || after.trim().length < 2) continue;
      const printed = box(char);
      const matches = comparison.flatMap((candidate) => {
        const candidateText = Array.from(candidate.text);
        if (candidate.confidence < .9 || candidate.characters?.length !== candidateText.length) return [];
        return candidate.characters.flatMap((glyph, i) => {
          if (glyph.text !== '0' || !glyph.boundingBox?.w || !glyph.boundingBox?.h
            || !sameGlyph(printed, box(glyph))
            || !normalize(candidateText.slice(Math.max(0, i - Array.from(before).length), i).join('')).endsWith(normalize(before))
            || !normalize(candidateText.slice(i + 1, i + 1 + Array.from(after).length).join('')).startsWith(normalize(after))) return [];
          return [glyph];
        });
      });
      if (matches.length !== 1) continue;
      checked++;
      const expected = normalize(before + '0' + after);
      let confirmed = true;
      for (const [left, right] of [[260, 260], [350, 350]]) {
        const x = Math.max(0, Math.floor(printed.x) - left);
        const edge = Math.min(size.width, Math.ceil(printed.x + printed.w) + right);
        const y = Math.max(0, Math.floor(printed.y) - 20);
        const bottom = Math.min(size.height, Math.ceil(printed.y + printed.h) + 20);
        if (edge - x < 100 || bottom - y < 20) { confirmed = false; break; }
        const crop = path.join(temporary, `prose-zero-${row}-${index}-${left}.png`);
        await fs.writeFile(crop, image.crop({ x, y, width: edge - x, height: bottom - y }).toPNG(), { mode: 0o600 });
        const result = await recognize(crop, { signal }).catch((error) => {
          if (signal?.aborted || error?.isCancellation) throw error;
          return null;
        });
        const readings = result?.blocks?.length ? result.blocks : [result];
        if (!readings.some((entry) => entry?.confidence >= .9 && normalize(entry.text || '').includes(expected))) {
          confirmed = false; break;
        }
      }
      if (!confirmed) continue;
      blocks[row] = { ...block, text: [...rowText.slice(0, index), '0', ...rowText.slice(index + 1)].join(''),
        characters: chars.map((entry, i) => i === index ? { ...entry, text: '0' } : entry) };
      verifiedGlyphConflicts.push({ source: char.text, alternative: '0' });
      break;
    }
  }
  return verifiedGlyphConflicts.length ? { ...original, blocks, verifiedGlyphConflicts } : original;
}

function withoutClippedBottomRows(ocr, size, cutoffY) {
  if (!ocr || cutoffY === null) return ocr;
  const blocks = (ocr.blocks || []).filter((block) => {
    const box = block.boundingBox;
    if (!box || !Number.isFinite(box.y) || !Number.isFinite(box.h)) return true;
    return (1 - box.y - box.h / 2) * size.height < cutoffY;
  });
  return { ...ocr, blocks, text: cleanOcrText(blocks.map((block) => block.text).join('\n')) };
}

async function performReadingOCR(imagePath, { signal } = {}) {
  const [textResult, formulaResult] = await Promise.allSettled([
    performOCR(imagePath, { signal, characters: true }), formulaOcr.recognize(imagePath, { signal }),
  ]);
  if (textResult.status === 'rejected') throw textResult.reason;
  let original = textResult.value;
  if (formulaResult.status === 'rejected') {
    const error = formulaResult.reason;
    if (signal?.aborted || error?.isCancellation) throw error;
    return { ...original, formulaOcr: { status: error.code === 'ENOENT' ? 'unavailable' : 'failed', count: 0 } };
  }
  let recognized = formulaResult.value;
  if (recognized.formulas.length) {
    try { recognized = await formulaOcr.recheckCharacters(imagePath, original, recognized, { signal }); }
    catch (error) {
      if (signal?.aborted || error?.isCancellation) throw error;
      // Character-level corroboration is optional; retain the completed
      // region-level result if this bounded second pass cannot finish.
    }
  }
  const clippedBottom = Number.isFinite(recognized.clippedBottomY);
  if (clippedBottom) original = withoutClippedBottomRows(original, recognized.size, recognized.clippedBottomY);
  if (!recognized.formulas.length) {
    let padded = await performOCR(imagePath, { signal, characters: true, padEdges: true }).catch((error) => {
      if (signal?.aborted || error?.isCancellation) throw error;
      return null;
    });
    if (clippedBottom) padded = withoutClippedBottomRows(padded, recognized.size, recognized.clippedBottomY);
    const prose = reconcileProseOcr(original, padded);
    return { ...prose, formulaOcr: { status: 'done', count: 0, clippedBottom, milliseconds: recognized.milliseconds } };
  }
  const cacheDir = path.join(app.getPath('userData'), 'ocr-cache');
  createOcrEnvironment(cacheDir);
  const temporary = await fs.mkdtemp(path.join(cacheDir, 'formula-'));
  try {
    const maskedPath = path.join(temporary, 'prose.png');
    await fs.writeFile(maskedPath, recognized.masked, { mode: 0o600 });
    let [prose, edges] = await Promise.all([
      performOCR(maskedPath, { signal, characters: true }),
      // A second layout may recover a clipped edge word, but must not replace
      // whole sentences: padding can also make correct OCR worse elsewhere.
      performOCR(imagePath, { signal, characters: true, padEdges: true }).catch((error) => {
        if (signal?.aborted || error?.isCancellation) throw error;
        return null;
      }),
    ]);
    if (clippedBottom) {
      prose = withoutClippedBottomRows(prose, recognized.size, recognized.clippedBottomY);
      edges = withoutClippedBottomRows(edges, recognized.size, recognized.clippedBottomY);
    }
    const references = await recheckReferenceOne(imagePath, original, edges, temporary, { signal });
    const corroborated = await recheckRightEdgeWord(imagePath, references, edges, temporary, { signal });
    const quoted = await recheckEmptyEdgeQuote(imagePath, corroborated, temporary, { signal });
    const zeroChecked = await recheckAmbiguousProseZero(imagePath, quoted, prose, temporary, { signal });
    const interior = await verifyMissingInteriorRows(imagePath, zeroChecked, edges, { signal });
    const document = mergeFormulaDocument(prose, recognized.formulas, recognized.size, zeroChecked, edges, interior.verified);
    document.interiorUnresolved = interior.unresolved;
    return { ...prose, text: document.text, document,
      // Token probabilities flag uncertain recognition; they do not certify correctness.
      formulaOcr: { status: 'done', count: document.formulaCount,
        clippedBottom,
        uncertain: document.uncertainFormulaCount,
        uncertainStarts: document.uncertainFormulaStarts,
        milliseconds: recognized.milliseconds } };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function verifyMissingInteriorRows(imagePath, original, padded, { signal } = {}) {
  const candidates = missingInteriorRows(original, padded);
  if (!candidates.length) return { verified: [], unresolved: 0 };
  const image = nativeImage.createFromPath(imagePath), size = image.getSize();
  if (image.isEmpty() || size.width < 100 || size.height < 40) {
    return { verified: [], unresolved: candidates.length };
  }
  const verified = [];
  for (const candidate of candidates.slice(0, 4)) {
    const box = rect(candidate), margin = 8;
    const x = Math.max(0, Math.floor(box.left * size.width) - margin);
    const y = Math.max(0, Math.floor(box.top * size.height) - margin);
    const right = Math.min(size.width, Math.ceil(box.right * size.width) + margin);
    const bottom = Math.min(size.height, Math.ceil(box.bottom * size.height) + margin);
    if (right - x < 100 || bottom - y < 12) continue;
    const crop = path.join(await fs.mkdtemp(path.join(app.getPath('userData'), 'ocr-cache', 'line-')), 'line.png');
    try {
      await fs.writeFile(crop, image.crop({ x, y, width: right - x, height: bottom - y }).toPNG(), { mode: 0o600 });
      const local = await performOCR(crop, { signal, characters: true });
      if (local.blocks.some((row) => row.confidence >= .9
        && orderedAgreement(candidate.text, row.text) >= .85)) verified.push(candidate);
    } catch (error) {
      if (signal?.aborted || error?.isCancellation) throw error;
    } finally { await fs.rm(path.dirname(crop), { recursive: true, force: true }); }
  }
  return { verified, unresolved: candidates.length - verified.length };
}

/**
 * Cleanup any resources held by the OCR service.
 * Currently a no-op but provided for interface consistency.
 */
function cleanup() {
  return formulaOcr.cleanup();
}

module.exports = {
  frontmostDocumentWindow,
  performOCR,
  performReadingOCR,
  recheckReferenceOne,
  recheckRightEdgeWord,
  recheckEmptyEdgeQuote,
  recheckAmbiguousProseZero,
  cleanup,
};
