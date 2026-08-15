# Model quality benchmark

This directory contains a deterministic, privacy-safe quality gate for Slipstream's structured action briefs.

## Coverage

`cases.json` contains 10 English administrative scenarios. Every institution, form, portal, appointment, account, and date is fictional. The corpus contains no personal data. It covers university, tenancy, medical appointments, HR, government, and billing, including:

- no-action notices and negative commands;
- conditional actions and conditional replies;
- multiple deadlines and an ambiguous date that must remain unnormalized;
- a forwarded quoted request that must not become a user task;
- required and prohibited replies;
- required and conditional materials.

Each case has machine-readable anchors, action verb/object groups in English and Chinese, exact evidence, deadlines, materials, reply mode, prohibitions, and no-action policy.

## Offline gate

Run:

```sh
node scripts/check-model-quality-benchmark.js
```

The offline gate validates the corpus, validates every deterministic golden brief against the production action-brief schema, and requires every golden to score 1.0. It also proves that these mutations are rejected:

- missing required action;
- hallucinated and ungrounded action;
- wrong calendar date;
- wrong reply channel;
- inverted/negated action using otherwise correct evidence.

The offline golden translation intentionally mirrors synthetic source text so the structural gate stays deterministic. It does **not** prove translation fidelity. The live runner adds a required Chinese-output boundary; semantic anchors and structured extraction checks still apply. Full translation-fidelity evaluation would require a separately reviewed bilingual reference corpus.

## Optional DeepSeek live gate

The live runner calls the existing production `processText` path. It reads the key only from `DEEPSEEK_API_KEY` in the current process, never writes it, and restores the in-memory settings accessor after the run.

```sh
DEEPSEEK_API_KEY='set-in-your-shell-only' node scripts/check-deepseek-quality-live.js
```

The default runs all 10 cases. An intentional smoke run can select or limit cases:

```sh
DEEPSEEK_API_KEY='set-in-your-shell-only' node scripts/check-deepseek-quality-live.js \
  --case university-course-change,forwarded-quoted-request \
  --max 2 \
  --timeout-ms 70000
```

A filtered or limited successful run reports `status: "partial"`; only a successful full-corpus run reports `status: "passed"`.

Live reports always contain metadata, scores, counts, and failure codes only. There are deliberately no command-line options for printing source text or raw model output. The API key, source text, and raw response are never logged.
