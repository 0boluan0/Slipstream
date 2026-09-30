'use strict';

// Opt-in local QA. The manifest supplies selected public-paper images only;
// scoring notes in it are deliberately not part of any model request.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

exports.run = async ({ settings, output, manifestPath }) => {
  if (!path.isAbsolute(manifestPath)) throw new Error('Absolute screenshot manifest required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.cases) || !manifest.cases.length || manifest.cases.length > 200) throw new Error('Invalid screenshot manifest');
  const { readScreenshot } = require('./llm-service');
  const records = [];
  const queue = manifest.cases.map(({ id, path: file }) => {
    if (!/^[a-z0-9-]{1,80}$/u.test(id) || !path.isAbsolute(file)) throw new Error('Invalid screenshot case');
    return { id, file };
  });
  const startedAt = new Date().toISOString();
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const save = () => fs.writeFileSync(path.join(output, 'cloud-baseline-summary.json'),
    JSON.stringify({ startedAt, provider: settings.activeBackend, model: settings.activeModel, records }, null, 2) + '\n', { mode: 0o600 });
  save();
  const worker = async () => {
    while (queue.length) {
      const { id, file } = queue.shift();
      const record = { id, requests: [] };
      const start = performance.now();
      try {
        if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('Image too large');
        const result = await readScreenshot({ image: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`,
          settingsSnapshot: settings, signal: AbortSignal.timeout(95000),
          onResponse: (raw, request) => fs.writeFileSync(path.join(output,
            `${id}-${request.stage}-${request.index}-raw.json`), raw, { mode: 0o600 }),
          onUsage: ({ model, usage }) => { record.model = model; record.requests.push({ date: new Date().toISOString(), model, usage }); },
          onTranslation: () => { record.firstTranslationMs ??= Math.round(performance.now() - start); } });
        fs.writeFileSync(path.join(output, `${id}-cloud.json`), JSON.stringify({ id, result }, null, 2) + '\n', { mode: 0o600 });
        Object.assign(record, { success: true, sourceLength: result.text.length, translationLength: result.translation.length, uncertain: result.uncertain });
      } catch (error) {
        Object.assign(record, { success: false, errorType: error.name,
          errorCode: /^reading-[a-z-]+$/u.test(error.message || '') ? error.message : error.code || null,
          status: Number(error.status) || null });
      }
      record.milliseconds = Math.round(performance.now() - start);
      if (record.success) record.firstTranslationMs ??= record.milliseconds;
      records.push(record); save(); console.log(JSON.stringify(record));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return records.every(record => record.success);
};
