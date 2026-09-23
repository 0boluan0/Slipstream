const { execFile } = require('child_process');
const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');
const { createOcrEnvironment } = require('./ocr-environment');
const { createLocalFormulaOcr } = require('./local-formula-ocr');
const { mergeFormulaDocument } = require('./formula-document');

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

async function performReadingOCR(imagePath, { signal } = {}) {
  const [textResult, formulaResult] = await Promise.allSettled([
    performOCR(imagePath, { signal, characters: true }), formulaOcr.recognize(imagePath, { signal }),
  ]);
  if (textResult.status === 'rejected') throw textResult.reason;
  const original = textResult.value;
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
  if (!recognized.formulas.length) {
    return { ...original, formulaOcr: { status: 'done', count: 0, milliseconds: recognized.milliseconds } };
  }
  const cacheDir = path.join(app.getPath('userData'), 'ocr-cache');
  createOcrEnvironment(cacheDir);
  const temporary = await fs.mkdtemp(path.join(cacheDir, 'formula-'));
  try {
    const maskedPath = path.join(temporary, 'prose.png');
    await fs.writeFile(maskedPath, recognized.masked, { mode: 0o600 });
    const [prose, edges] = await Promise.all([
      performOCR(maskedPath, { signal, characters: true }),
      // A second layout may recover a clipped edge word, but must not replace
      // whole sentences: padding can also make correct OCR worse elsewhere.
      performOCR(imagePath, { signal, characters: true, padEdges: true }).catch((error) => {
        if (signal?.aborted || error?.isCancellation) throw error;
        return null;
      }),
    ]);
    const references = await recheckReferenceOne(imagePath, original, edges, temporary, { signal });
    const corroborated = await recheckRightEdgeWord(imagePath, references, edges, temporary, { signal });
    const quoted = await recheckEmptyEdgeQuote(imagePath, corroborated, temporary, { signal });
    const document = mergeFormulaDocument(prose, recognized.formulas, recognized.size, quoted, edges);
    return { ...prose, text: document.text, document,
      // Token probabilities flag uncertain recognition; they do not certify correctness.
      formulaOcr: { status: 'done', count: document.formulaCount,
        uncertain: document.uncertainFormulaCount,
        uncertainStarts: document.uncertainFormulaStarts,
        milliseconds: recognized.milliseconds } };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
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
  cleanup,
};
