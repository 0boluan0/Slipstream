'use strict';

// Specialized image-to-LaTeX inference only. No provider, credential or network
// client belongs in this module. Weights are loaded lazily, then released idle.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { nativeImage } = require('electron');
const manifest = require('./local-formula-models.json');
const { proseSuperscript } = require('./formula-document');

function cancelled(signal, deadline) {
  if (signal?.aborted) {
    const error = new Error('Formula OCR cancelled');
    error.isCancellation = true;
    throw error;
  }
  if (Date.now() > deadline) throw new Error('formula-ocr-timeout');
}

function rgbTensor(image, size, normalize, ort) {
  const bitmap = normalize ? image.resize({ width: size, height: size, quality: 'best' }).toBitmap() : image.toBitmap();
  const source = normalize ? { width: size, height: size } : image.getSize();
  const plane = size * size, data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) {
    // Native bitmaps are BGRA on both supported Mac architectures.
    const px = Math.max(0, Math.min(source.width - 1, ((i % size) + .5) * source.width / size - .5));
    const py = Math.max(0, Math.min(source.height - 1, (Math.floor(i / size) + .5) * source.height / size - .5));
    const x = Math.floor(px), y = Math.floor(py), dx = px - x, dy = py - y;
    const at = (xx, yy) => bitmap[(yy * source.width + xx) * 4 + 2 - c];
    const value = Math.round((1 - dy) * ((1 - dx) * at(x, y) + dx * at(Math.min(x + 1, source.width - 1), y))
      + dy * ((1 - dx) * at(x, Math.min(y + 1, source.height - 1)) + dx * at(Math.min(x + 1, source.width - 1), Math.min(y + 1, source.height - 1)))) / 255;
    data[c * plane + i] = normalize ? (value - .5) / .5 : value;
  }
  return new ort.Tensor('float32', data, [1, 3, size, size]);
}

function detectorInput(image, ort) {
  // A real screenshot can end directly against a symbol. Give the detector
  // page-like margins without discarding or inventing any source pixels.
  const { width, height } = image.getSize(), margin = Math.max(8, Math.round(width * .04));
  const paddedSize = { width: width + margin * 2, height: Math.max(height + margin * 2, Math.ceil((width + margin * 2) / 2)) };
  const pixels = image.toBitmap(), padded = Buffer.alloc(paddedSize.width * paddedSize.height * 4, 255);
  for (let y = 0; y < height; y++) pixels.copy(padded,
    ((y + margin) * paddedSize.width + margin) * 4, y * width * 4, (y + 1) * width * 4);
  const canvas = nativeImage.createFromBitmap(padded, paddedSize);
  return { image: rgbTensor(canvas, 800, false, ort),
    im_shape: new ort.Tensor('float32', Float32Array.of(800, 800), [1, 2]),
    scale_factor: new ort.Tensor('float32', Float32Array.of(800 / paddedSize.height, 800 / paddedSize.width), [1, 2]) };
}

function overlap(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h / Math.min(a.w * a.h, b.w * b.h);
}

function detectBoxes(output, size) {
  const margin = Math.max(8, Math.round(size.width * .04));
  const data = output.data, boxes = [];
  // PP-DocLayoutV3: class, score, left, top, right, bottom, reading order.
  // The published model labels display formulas 5 and inline formulas 15.
  for (let i = 0; i < data.length; i += 7) {
    const label = data[i], score = data[i + 1];
    if ((label !== 5 && label !== 15) || score < .1) continue;
    const x = Math.max(0, Math.floor(data[i + 2] - margin) - 1);
    const y = Math.max(0, Math.floor(data[i + 3] - margin));
    const right = Math.min(size.width, Math.ceil(data[i + 4] - margin) + 1);
    const bottom = Math.min(size.height, Math.ceil(data[i + 5] - margin));
    const w = right - x, h = bottom - y;
    // Isolated symbols and short notation lists receive weaker layout scores
    // than equations. Recognition below enforces their mathematical structure.
    if (score < .3 && (label !== 15 || w > h * 6 || h > size.height * .12)) continue;
    if (w > 0 && h > 0) boxes.push({ x, y, w, h, score, display: label === 5 });
  }
  const selected = [];
  const distinct = boxes.filter((box) => box.score >= .5 || boxes.filter((part) => part !== box
    && part.w < box.w * .75 && overlap(box, part) > .9).length < 2);
  for (const box of distinct.sort((a, b) => b.score - a.score)) {
    if (!selected.some((other) => overlap(box, other) > .65)) selected.push(box);
  }
  return selected.sort((a, b) => a.y - b.y || a.x - b.x);
}

function trimFormulaCrop(image) {
  const { width, height } = image.getSize(), pixels = image.toBitmap();
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 160) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (left > right || top > bottom) return image;
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  return image.crop({ x: left, y: top, width: Math.min(width - left, right - left + 2), height: Math.min(height - top, bottom - top + 2) });
}

function padFormulaCrop(image, ratio) {
  const size = image.getSize(), margin = Math.max(1, Math.round(size.height * ratio));
  const paddedSize = { width: size.width + margin * 2, height: size.height + margin * 2 };
  const source = image.toBitmap(), pixels = Buffer.alloc(paddedSize.width * paddedSize.height * 4, 255);
  for (let y = 0; y < size.height; y++) source.copy(pixels,
    ((y + margin) * paddedSize.width + margin) * 4, y * size.width * 4, (y + 1) * size.width * 4);
  return nativeImage.createFromBitmap(pixels, paddedSize);
}

function styledAtom(latex) {
  // Both \\mathcal{H} and {\\mathcal H} denote the same single glyph.
  const compact = latex.replace(/\\(mathcal|mathbb|mathfrak|mathscr)\s+([A-Za-z])\b/g, '\\$1{$2}')
    .replace(/\s+/g, '').replace(/^\{(\\(?:mathcal|mathbb|mathfrak|mathscr)\{[A-Za-z]\})\}([,.;:!?]?)$/, '$1$2');
  return /^\\(?:mathcal|mathbb|mathfrak|mathscr)\{[A-Za-z]\}[,.;:!?]?$/.test(compact) ? compact : null;
}

function accentedAtom(latex) {
  // A weak layout candidate may still contain a clearly printed accent over
  // one letter. Require the math recognizer to agree on that exact atom under
  // three crop margins before letting it replace Vision's plain letter.
  const compact = latex.replace(/\s+/g, '');
  const match = compact.match(/^\\(hat|bar|tilde|vec|dot|ddot)(?:\{([A-Za-z])\}|([A-Za-z]))([,.;:!?]?)$/);
  return match ? `\\${match[1]}{${match[2] || match[3]}}${match[4]}` : null;
}

function accentSignature(latex) {
  const compact = latex.replace(/\s+/g, '');
  return [...compact.matchAll(/\\(?:hat|bar|tilde|vec|breve|check|dot|ddot|widehat|widetilde)\{?[A-Za-z]\}?/g)]
    .map((match) => match[0]).join('|');
}

function weakAccentGeometry(box, size) {
  return !box.display && box.w < box.h * 2 && box.h < size.height * .12;
}

function visualAtom(latex) {
  let compact = latex.replace(/\\(mathcal|mathbb|mathfrak|mathscr)\s+([A-Za-z])\b/gu, '\\$1{$2}')
    .replace(/\s+/gu, '').replace(/[,.;:!?]$/u, '');
  // The decoder may wrap a single styled glyph in an extra brace pair.
  // It remains the same visible atom after surrounding whitespace is trimmed.
  const styled = styledAtom(compact);
  if (styled) return styled;
  const wrapped = compact.match(/^\\(?:boldsymbol|mathbf|mathrm)\{(.*)\}$/u);
  if (wrapped) compact = wrapped[1];
  if (/^\\(?:mathcal|mathbb|mathfrak|mathscr)\{[A-Za-z]\}$/u.test(compact)) return compact;
  if (/^\\(?:var)?(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/u.test(compact)) return compact;
  if (/^\\(?:in|notin|subset|subseteq|supset|supseteq)$/u.test(compact)) return compact;
  return null;
}

function characterCandidates(ocr, size, formulas) {
  const candidates = [];
  for (const block of ocr?.blocks || []) {
    const chars = Array.from(block.text || '');
    if (chars.length !== block.characters?.length) continue;
    for (let i = 0; i < chars.length; i++) {
      const first = block.characters[i].boundingBox, second = block.characters[i + 1]?.boundingBox;
      // Vision can split one printed mathematical glyph into two text
      // characters (observed Ω -> S2) while giving both the same pixel box.
      // An ordinary S2 has two separate boxes and stays untouched.
      const splitGlyph = /^[A-Za-z]$/u.test(chars[i]) && /^[0-9]$/u.test(chars[i + 1] || '')
        && first && second && ['x', 'y', 'w', 'h'].every((key) => first[key] === second[key])
        && !/[\p{L}\p{N}]/u.test(chars[i - 1] || '')
        && !/[\p{L}\p{N}]/u.test(chars[i + 2] || '');
      // Vision can render an isolated Ω as S, &, or $ across macOS versions.
      if (!splitGlyph && (!/^[A-Za-z€&$]$/u.test(chars[i])
        || /[\p{L}\p{N}]/u.test(chars[i - 1] || '')
        || /[\p{L}\p{N}]/u.test(chars[i + 1] || ''))) continue;
      const source = first;
      if (!source || source.w <= 0 || source.h <= 0) continue;
      const x = Math.max(0, Math.floor(source.x * size.width));
      const y = Math.max(0, Math.floor((1 - source.y - source.h) * size.height));
      const right = Math.min(size.width, Math.ceil((source.x + source.w) * size.width));
      const bottom = Math.min(size.height, Math.ceil((1 - source.y) * size.height));
      const box = { x, y, w: right - x, h: bottom - y };
      // Vision's tall character box can overlap an already decoded formula
      // by just under the area threshold. Its center still identifies it as
      // the same printed glyph, so avoid emitting the formula twice.
      const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
      if (box.w < 8 || box.h < 10 || box.w > box.h * 2 || box.h > size.height * .15
        || formulas.some((formula) => overlap(formula, box) > .65
          || (centerX >= formula.x && centerX <= formula.x + formula.w
            && centerY >= formula.y && centerY <= formula.y + formula.h))) continue;
      candidates.push({ ...box, priority: splitGlyph ? -1 : block.text.length <= 45 ? 0 : 1,
        rowLength: block.text.length });
    }
  }
  return candidates.sort((a, b) => a.priority - b.priority || a.rowLength - b.rowLength
    || a.y - b.y || a.x - b.x).slice(0, size.width <= 900 ? 24 : 16);
}

function sourceDisagreesOnDelta(formula, ocr, size) {
  if (!/^\\(?:var)?Delta\b/u.test(formula.latex)) return false;
  return (ocr?.blocks || []).some((block) => block.characters?.some((character) => {
    if (character.text !== 'A' || !character.boundingBox) return false;
    const { x, y, w, h } = character.boundingBox;
    const centerX = (x + w / 2) * size.width;
    const centerY = (1 - y - h / 2) * size.height;
    return centerX >= formula.x && centerX <= formula.x + formula.w * .4
      && centerY >= formula.y && centerY <= formula.y + formula.h;
  }));
}

function maskFormulaRegions(image, formulas, size) {
  const bitmap = image.toBitmap();
  for (const box of formulas) for (let y = box.y; y < box.y + box.h; y++) {
    bitmap.fill(255, (y * size.width + box.x) * 4, (y * size.width + box.x + box.w) * 4);
  }
  return formulas.length ? nativeImage.createFromBitmap(bitmap, size).toPNG() : null;
}

async function recognizeCrop(model, image, signal, deadline) {
  cancelled(signal, deadline);
  const encoded = await model.encoder.run({ pixel_values: rgbTensor(image, 384, true, model.ort) });
  const ids = [1];
  let confidence = 1;
  for (let step = 0; step < 384; step++) {
    cancelled(signal, deadline);
    const output = await model.decoder.run({
      input_ids: new model.ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      encoder_hidden_states: encoded.last_hidden_state,
    });
    const logits = output.logits.data, vocab = output.logits.dims[2], offset = logits.length - vocab;
    let best = 0;
    for (let i = 1; i < vocab; i++) if (logits[offset + i] > logits[offset + best]) best = i;
    let sum = 0;
    for (let i = 0; i < vocab; i++) sum += Math.exp(logits[offset + i] - logits[offset + best]);
    confidence = Math.min(confidence, 1 / sum);
    ids.push(best);
    if (best === 2) break;
  }
  if (ids.at(-1) !== 2) throw new Error('formula-token-limit');
  const latex = model.decode(ids);
  if (!latex || latex.includes('�')) throw new Error('formula-invalid-latex');
  return { latex, confidence };
}

// Decode the published ByteLevel tokenizer without importing a language-model
// framework. IDs 0–3 are its special tokens; regular tokens include UTF-8 bytes.
function tokenDecoder(json) {
  const bytes = [...Array(94)].map((_, i) => i + 33)
    .concat([...Array(12)].map((_, i) => i + 161), [...Array(82)].map((_, i) => i + 174));
  const chars = [...bytes];
  for (let i = 0, extra = 0; i < 256; i++) if (!bytes.includes(i)) { bytes.push(i); chars.push(256 + extra++); }
  const byteOf = new Map(chars.map((code, i) => [String.fromCodePoint(code), bytes[i]]));
  const tokens = Object.fromEntries(Object.entries(json.model.vocab).map(([text, id]) => [id, text]));
  return (ids) => Buffer.from([...ids.filter((id) => id > 3).map((id) => tokens[id]).join('')]
    .map((char) => byteOf.get(char))).toString('utf8').trim();
}

function createLocalFormulaOcr(modelDir) {
  let loading, sessions, idle;
  let queue = Promise.resolve();
  async function load() {
    if (sessions) return sessions;
    if (loading) return loading;
    loading = (async () => {
      for (const file of manifest.files) {
        const content = await fs.readFile(path.join(modelDir, file.name));
        if (crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('formula-model-integrity');
      }
      const ort = require('onnxruntime-node');
      const options = { executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1 };
      const opened = [];
      try {
        for (const name of ['detector', 'encoder', 'decoder']) opened.push(await ort.InferenceSession.create(path.join(modelDir, `${name}.onnx`), options));
        const decode = tokenDecoder(JSON.parse(await fs.readFile(path.join(modelDir, 'tokenizer.json'), 'utf8')));
        sessions = { ort, detector: opened[0], encoder: opened[1], decoder: opened[2], decode };
        return sessions;
      } catch (error) { await Promise.all(opened.map((session) => session.release())); throw error; }
    })().finally(() => { loading = null; });
    return loading;
  }
  async function cleanup() {
    clearTimeout(idle);
    const previous = sessions;
    sessions = null;
    if (previous) await Promise.all(['detector', 'encoder', 'decoder'].map((key) => previous[key].release()));
  }
  async function recognize(imagePath, { signal } = {}) {
    // One capture at a time bounds native model memory and CPU competition.
    const run = queue.then(async () => {
      clearTimeout(idle);
      // A fresh install must hash and open all three models before its first
      // inference. Give that one cold start more time; subsequent captures
      // keep the shorter interactive deadline.
      const started = Date.now();
      let deadline = started + (sessions ? 25000 : 60000);
      cancelled(signal, deadline);
      const model = await load();
      cancelled(signal, deadline);
      const image = nativeImage.createFromPath(imagePath);
      const size = image.getSize();
      if (image.isEmpty() || size.width * size.height > 20_000_000) throw new Error('formula-image-size');
      const detected = await model.detector.run(detectorInput(image, model.ort));
      cancelled(signal, deadline);
      const boxes = detectBoxes(detected.fetch_name_0, size);
      // Wide excerpts shrink an isolated accent to a few detector pixels.
      // Inspect overlapping halves at higher effective resolution, but admit
      // only small candidates whose accent survives three math-model crops.
      if (size.width >= 1200 && size.width > size.height * 2) {
        const width = Math.round(size.width * .6), tiled = [];
        for (const x of [0, size.width - width]) {
          cancelled(signal, deadline);
          const tile = image.crop({ x, y: 0, width, height: size.height });
          const inferred = await model.detector.run(detectorInput(tile, model.ort));
          for (const candidate of detectBoxes(inferred.fetch_name_0, tile.getSize())) {
            const box = { ...candidate, x: candidate.x + x, tiled: true };
            if (box.score < .12 || !weakAccentGeometry(box, size)
              || boxes.some((existing) => overlap(existing, box) > .65)) continue;
            const duplicate = tiled.findIndex((existing) => overlap(existing, box) > .65);
            if (duplicate < 0) tiled.push(box);
            else if (box.score > tiled[duplicate].score) tiled[duplicate] = box;
          }
        }
        boxes.push(...tiled.sort((a, b) => b.score - a.score).slice(0, 12));
        boxes.sort((a, b) => a.y - b.y || a.x - b.x);
      }
      if (boxes.length > 60) throw new Error('formula-region-limit');
      // A dense page needs more decoder passes than a short excerpt. Keep the
      // common path quick, while bounding formula-heavy captures to one minute.
      deadline = Math.max(deadline, started + Math.min(60000, 20000 + boxes.length * 2500));
      const formulas = [];
      let accentRechecks = 0;
      for (const box of boxes) {
        cancelled(signal, deadline);
        const crop = image.crop({ x: box.x, y: box.y, width: box.w, height: box.h });
        const trimmed = trimFormulaCrop(crop);
        let { latex, confidence } = await recognizeCrop(model, trimmed, signal, deadline);
        let agreedStyledAtom = false;
        // Tight isolated glyphs can look like another font or letter when
        // stretched to the model input. Recheck only uncertain styled atoms;
        // two modest margins must agree in case, font and punctuation.
        if (!box.display && box.w < box.h * 2 && box.h < size.height * .12 && confidence < .75
          && /\\(?:boldsymbol|mathbf|mathcal|mathbb|mathfrak|mathscr)\b/.test(latex)) {
          const first = await recognizeCrop(model, padFormulaCrop(trimmed, .1), signal, deadline);
          const second = await recognizeCrop(model, padFormulaCrop(trimmed, .2), signal, deadline);
          const atom = styledAtom(first.latex);
          if (atom && atom === styledAtom(second.latex) && Math.min(first.confidence, second.confidence) >= .6
            && Math.max(first.confidence, second.confidence) > confidence + .1) {
            latex = atom;
            confidence = Math.min(first.confidence, second.confidence);
            agreedStyledAtom = true;
          }
        }
        let agreedAccentAtom = false;
        if (weakAccentGeometry(box, size) && box.score >= (box.tiled ? .12 : .2)
          && (box.tiled || box.score < .3) && confidence >= .95) {
          const atom = accentedAtom(latex);
          if (atom) {
            const first = await recognizeCrop(model, padFormulaCrop(trimmed, .1), signal, deadline);
            const second = await recognizeCrop(model, padFormulaCrop(trimmed, .2), signal, deadline);
            if (atom === accentedAtom(first.latex) && atom === accentedAtom(second.latex)
              && Math.min(first.confidence, second.confidence) >= .95) {
              latex = atom;
              agreedAccentAtom = true;
            }
          }
        }
        // A high-confidence decoder can still invent an accent inside a long
        // expression. Compare its accent labels under two crop margins; any
        // disagreement asks the reader to check rather than silently changing
        // the mathematics. Bound extra passes on dense pages.
        let reviewAccent = false;
        const signature = accentSignature(latex);
        if (signature && confidence >= .7 && box.score >= .7 && !agreedAccentAtom) {
          if (accentRechecks++ >= 8) reviewAccent = true;
          else {
            const first = await recognizeCrop(model, padFormulaCrop(trimmed, .1), signal, deadline);
            const second = await recognizeCrop(model, padFormulaCrop(trimmed, .2), signal, deadline);
            reviewAccent = accentSignature(first.latex) !== signature
              || accentSignature(second.latex) !== signature
              || Math.min(first.confidence, second.confidence) < .75;
          }
        }
        // A weak detection is not enough to turn prose into mathematics. Admit
        // only confident notation. Bare Latin atoms need stronger recognition;
        // the English words a/A/I still belong to prose in this weak-layout path.
        const compact = latex.replace(/\s+/g, '');
        const greek = /^\\(?:var)?(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)(?:[_^]\{[a-zA-Z0-9]+\})?[,.;:!?]?$/i.test(compact);
        const styled = /^\\(?:mathcal|mathbb|mathfrak|mathscr)\{[A-Za-z]\}[,.;:!?]?$/.test(compact);
        const list = /^(?:[A-Za-z],){2,}[A-Za-z][.;:!?]?$/.test(compact);
        const latin = /^[B-HJ-Zb-z][,.;:!?]?$/.test(compact);
        const indexed = /^(?:[A-Za-z]|\d+)(?:[_^]\{[A-Za-z0-9+-]+\}){1,2}[,.;:!?]?$/.test(compact);
        const annotatedProse = !box.display && confidence >= .99 && proseSuperscript(latex);
        // The faintest layout candidates need near-certain short notation.
        // Do not extend the lower detector floor to words or font guesses.
        if (box.tiled && !agreedAccentAtom) continue;
        if (box.score < .12 && !(confidence >= .99 && (latin || indexed))) continue;
        if (box.score < .3 && !(agreedStyledAtom || agreedAccentAtom || annotatedProse || confidence >= .75 && (greek || styled || list)
          || confidence >= .95 && (latin || indexed))) continue;
        formulas.push({ ...box, latex, confidence: Math.min(confidence, box.score), reviewAccent });
      }
      // Mask only recognized regions; Vision will read the remaining prose.
      const masked = maskFormulaRegions(image, formulas, size);
      return { formulas, masked, size, milliseconds: Date.now() - started };
    });
    queue = run.catch(() => {});
    try { return await run; }
    finally { idle = setTimeout(() => { queue = queue.then(cleanup).catch(() => {}); }, 120000); idle.unref(); }
  }
  async function recheckCharacters(imagePath, original, detected, { signal } = {}) {
    const run = queue.then(async () => {
      clearTimeout(idle);
      const image = nativeImage.createFromPath(imagePath), size = image.getSize();
      if (image.isEmpty() || !detected.formulas.length) return detected;
      const baseline = detected.formulas.map((formula) => ({ ...formula,
        reviewSymbol: formula.reviewSymbol || sourceDisagreesOnDelta(formula, original, size) }));
      const candidates = characterCandidates(original, size, baseline);
      if (!candidates.length) return { ...detected, formulas: baseline };
      const model = await load(), deadline = Date.now() + 20000;
      const supplements = [];
      for (const box of candidates) {
        cancelled(signal, deadline);
        // Vision's character box is already wider than the printed ink here.
        // Expanding it admits neighboring prose and can turn a calligraphic A
        // into a different symbol in all three recognizer passes.
        // Vision's character rectangle can include several blank pixels. At
        // small screenshot sizes the decoder can mistake that blank border for
        // an empty subscript, making otherwise agreeing symbol reads disagree.
        const crop = trimFormulaCrop(image.crop({ x: box.x, y: box.y, width: box.w, height: box.h }));
        let readings;
        try {
          readings = await Promise.all([0, .1, .2].map((ratio) => recognizeCrop(model,
            ratio ? padFormulaCrop(crop, ratio) : crop, signal, deadline)));
        } catch (error) {
          if (signal?.aborted || error?.isCancellation) throw error;
          if (Date.now() >= deadline) break;
          continue;
        }
        const atoms = readings.map(({ latex }) => visualAtom(latex));
        if (!atoms[0] || !atoms.every((atom) => atom === atoms[0])
          || Math.min(...readings.map(({ confidence }) => confidence)) < .45
          || Math.max(...readings.map(({ confidence }) => confidence)) < .65) continue;
        supplements.push({ ...box, latex: atoms[0], confidence: Math.min(...readings.map(({ confidence }) => confidence)),
          score: .7, display: false });
      }
      if (!supplements.length) return { ...detected, formulas: baseline };
      const formulas = [...baseline, ...supplements].sort((a, b) => a.y - b.y || a.x - b.x);
      return { ...detected, formulas, masked: maskFormulaRegions(image, formulas, size) };
    });
    queue = run.catch(() => {});
    try { return await run; }
    finally { idle = setTimeout(() => { queue = queue.then(cleanup).catch(() => {}); }, 120000); idle.unref(); }
  }
  return { recognize, recheckCharacters, cleanup: () => { queue = queue.then(cleanup); return queue; } };
}

module.exports = { createLocalFormulaOcr, detectBoxes, tokenDecoder };
