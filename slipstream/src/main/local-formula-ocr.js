'use strict';

// Specialized image-to-LaTeX inference only. No provider, credential or network
// client belongs in this module. Weights are loaded lazily, then released idle.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { nativeImage } = require('electron');
const manifest = require('./local-formula-models.json');

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
  const { width, height } = image.getSize(), margin = 32;
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
  const data = output.data, boxes = [];
  // PP-DocLayoutV3: class, score, left, top, right, bottom, reading order.
  // The published model labels display formulas 5 and inline formulas 15.
  for (let i = 0; i < data.length; i += 7) {
    const label = data[i], score = data[i + 1];
    if ((label !== 5 && label !== 15) || score < .3) continue;
    const x = Math.max(0, Math.floor(data[i + 2] - 32) - 1);
    const y = Math.max(0, Math.floor(data[i + 3] - 32) - 1);
    const right = Math.min(size.width, Math.ceil(data[i + 4] - 32) + 1);
    const bottom = Math.min(size.height, Math.ceil(data[i + 5] - 32) + 1);
    if (right > x && bottom > y) boxes.push({ x, y, w: right - x, h: bottom - y, score, display: label === 5 });
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
      const started = Date.now(), deadline = started + 25000;
      cancelled(signal, deadline);
      const model = await load();
      cancelled(signal, deadline);
      const image = nativeImage.createFromPath(imagePath);
      const size = image.getSize();
      if (image.isEmpty() || size.width * size.height > 20_000_000) throw new Error('formula-image-size');
      const detected = await model.detector.run(detectorInput(image, model.ort));
      cancelled(signal, deadline);
      const boxes = detectBoxes(detected.fetch_name_0, size);
      if (boxes.length > 60) throw new Error('formula-region-limit');
      const formulas = [];
      for (const box of boxes) {
        cancelled(signal, deadline);
        const crop = image.crop({ x: box.x, y: box.y, width: box.w, height: box.h });
        const pixels = rgbTensor(trimFormulaCrop(crop), 384, true, model.ort);
        const encoded = await model.encoder.run({ pixel_values: pixels });
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
        formulas.push({ ...box, latex, confidence: Math.min(confidence, box.score) });
      }
      // Mask only recognized regions; Vision will read the remaining prose.
      const bitmap = image.toBitmap();
      for (const box of formulas) for (let y = box.y; y < box.y + box.h; y++) {
        bitmap.fill(255, (y * size.width + box.x) * 4, (y * size.width + box.x + box.w) * 4);
      }
      const masked = formulas.length ? nativeImage.createFromBitmap(bitmap, size).toPNG() : null;
      return { formulas, masked, size, milliseconds: Date.now() - started };
    });
    queue = run.catch(() => {});
    try { return await run; }
    finally { idle = setTimeout(() => { queue = queue.then(cleanup).catch(() => {}); }, 120000); idle.unref(); }
  }
  return { recognize, cleanup: () => { queue = queue.then(cleanup); return queue; } };
}

module.exports = { createLocalFormulaOcr, detectBoxes, tokenDecoder };
