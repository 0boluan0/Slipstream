'use strict';
// Explicit opt-in: use the existing encrypted app credential in memory, and
// submit only these authored academic samples. No profile values are written.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
if (!process.argv.includes('--configured-profile')) throw new Error('Pass --configured-profile to run live checks.');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slipstream-concept-live-'));
app.setName('Slipstream');
app.setPath('userData', path.join(work, 'profile'));
app.setPath('sessionData', path.join(work, 'session'));
const cases = [
  { term: 'conditional expectation', source: 'Let Y denote future demand and X the information available today. The conditional expectation E[Y | X] is a random variable determined by X. It differs from the unconditional expectation E[Y], which is a single average over all possible values of X.' },
  { term: 'confounder', source: 'A confounder is a variable that influences both a treatment and an outcome. An association between treatment and outcome may therefore persist even when the treatment has no causal effect.' },
];
let stage = 'read-profile';
app.whenReady().then(async () => {
  const profile = path.join(os.homedir(), 'Library', 'Application Support', 'Slipstream', 'slipstream-settings.json');
  const raw = JSON.parse(fs.readFileSync(profile, 'utf8'));
  const settings = { ...raw };
  const key = { deepseek: 'deepseekApiKey', openai: 'openaiApiKey', anthropic: 'anthropicApiKey', custom: 'customEndpointApiKey' }[raw.activeBackend];
  stage = 'decrypt-active-credential';
  if (key) settings[key] = typeof raw[key] === 'string' && raw[key].startsWith('enc:')
    ? safeStorage.decryptString(Buffer.from(raw[key].slice(4), 'base64')) : '';
  stage = 'load-provider';
  const { processReadingText } = require('../src/main/llm-service');
  const evidence = { date: new Date().toISOString(), provider: settings.activeBackend, model: settings.activeModel, cases: [] };
  for (const sample of cases) {
    stage = 'translate';
    const started = Date.now();
    const translated = await processReadingText({ text: sample.source, withTerms: true, settingsSnapshot: settings, signal: AbortSignal.timeout(60000) });
    const translationMs = Date.now() - started;
    const lookupStarted = Date.now();
    stage = 'explain';
    const explained = await processReadingText({ text: sample.source, kind: 'lookup', selection: sample.term, settingsSnapshot: settings, signal: AbortSignal.timeout(60000) });
    if (!translated.terms.some((term) => term.quote.toLowerCase() === sample.term) || explained.lookup.meaning.length < 20) throw new Error('concept-quality-check-failed');
    evidence.cases.push({ ...sample, ...translated, ...explained, translationMs, lookupMs: Date.now() - lookupStarted });
    console.log(`Live concept completed: ${sample.term}; ${translated.terms.length} anchored terms; translation ${translationMs} ms; explanation ${Date.now() - lookupStarted} ms.`);
  }
  fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'reading-concepts-live.json'), JSON.stringify(evidence, null, 2) + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(`Live concept check failed at ${stage} (${error.name || 'Error'}; status ${Number(error.status) || 'unavailable'}). No credential values were logged.`);
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(1);
});
