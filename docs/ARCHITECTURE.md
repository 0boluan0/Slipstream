# Architecture and trust boundaries

Slipstream is an Electron application with four explicit boundaries:

```text
capture → structured analysis → optional official verification → evidence-first renderer
```

## Capture

Clipboard, manual text, and Apple Vision OCR become a `CaptureEnvelope` containing source kind, capture time, SHA-256, exact source text, and optional OCR confidence/blocks. OCR runs locally. Temporary screenshots are removed after recognition.

## Structured analysis

Cloud or local model output is untrusted. The main process requests a strict JSON candidate and normalizes it into `ActionBriefV1`. Source quotes are resolved to UTF-16 offsets by Slipstream; model-provided offsets are ignored. Unsupported actions, materials, deadlines, terms, and process claims are dropped or marked pending.

Terms distinguish ordinary language from domain terminology. Process context has bounded `whatItIs`, `whyItMatters`, and `whatToDo` fields plus a compatibility summary. A model may reference a verification candidate by array index, but the normalizer converts it to a canonical ID only when the explanation and verification share overlapping source evidence; invalid references are ignored and remain visibly pending.

Legacy prose and the free translation backend fail closed to a translation-only brief. Renderer code never interprets arbitrary Markdown as trusted actions.

## Official verification

Verification accepts only a minimal single-line query and up to three candidate HTTPS URLs. It rejects raw message fields, credentials in URLs, private/loopback destinations, unsafe redirects, oversized responses, unexpected MIME types, and timeouts. GOV.UK lookups may use its public Search API to discover up to three exact `gov.uk` pages from a minimized query; search snippets are untrusted navigation hints and never evidence.

Successful retrieval creates a bounded `retrievals` receipt and leaves the claim `pending`. Keyword overlap is not semantic proof. Only an explicitly supplied claim-support assessor may promote a claim to `verified`; the supported V1 runtime therefore presents retrieved pages neutrally for the user to inspect.

## Renderer

The sandboxed renderer receives redacted settings and JSON-safe briefs through allowlisted IPC. It displays original evidence, model explanation, pending context, retrieval receipts, and verified claims as distinct states. External links pass through main-process HTTPS, public-host, and DNS checks before opening in the system browser.

## Storage

Secrets use macOS `safeStorage`. Legacy plaintext secrets are migrated when encryption is available and cleared otherwise. Saved terms retain only a bounded definition and the shortest necessary evidence excerpt; full source cases are not retained by default.
