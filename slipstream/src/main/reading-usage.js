'use strict';
// Explicit local acceptance runs only. Records provider token counts, never
// prompts, replies, images, settings, endpoints or credentials.
const fs = require('node:fs');
const path = require('node:path');
function recordReadingUsage(backend, model, usage) {
  const argument = process.argv.find(value => value.startsWith('--reading-qa-usage='));
  if (!argument || !usage || typeof usage !== 'object') return;
  const output = argument.slice('--reading-qa-usage='.length);
  if (!path.isAbsolute(output)) return;
  const counts = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
    if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) counts[key] = usage[key];
  }
  if (!Object.keys(counts).length) return;
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.appendFileSync(output, JSON.stringify({ date: new Date().toISOString(), backend, model, usage: counts }) + '\n', { mode: 0o600 });
  } catch { /* Diagnostic collection cannot interrupt a reader's request. */ }
}
module.exports = { recordReadingUsage };
