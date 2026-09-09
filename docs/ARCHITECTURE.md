# Architecture and trust boundaries

## Current reading workflow

```text
screenshot → local Apple Vision OCR → review when needed ┐
pasted / copied English ────────────────────────────────┤
                                                       ↓
                                      independent reading card
                                                       ↓
                             paragraph translation + optional term suggestions
                                                       ↓ on explicit lookup
                                      contextual concept explanation
                                                       ↓ on explicit save
                               local Markdown card store ↔ card-box window
```

`reading-pins.js` owns independent native windows, source revision, per-window cancellation and temporary state. The trusted main-window IPC exposes `reading:open-text` and `reading:library-open`; screenshot capture uses the same reading manager. Text capture bypasses screen permission and OCR. Window-specific sandboxed preloads accept only their bounded actions.

`reading-service.js` owns translation and lookup contracts. Model output is untrusted: professional terms must match complete source words, may be empty, and have bounded counts and lengths. Explanations are requested only after a user selects a term or phrase. `reading-document.js` retains segment progress and standalone source equations. There is no action extraction or official lookup in this path.

`reading-pin/` renders translation first, parallel source on demand, and screenshot review when an image exists. Hidden image tabs are excluded from keyboard navigation for pasted text. `reading-math.cjs` and bundled KaTeX assets render math locally. Explicit vision transcription has its own image-transfer disclosure and returns to source review.

`term-card-store.js` writes explicitly saved explanations and source passages to Markdown under the system Documents folder. It uses revision checks for external edits and stores links as local Markdown links. `term-library.js` provides a separate sandboxed window for search, editing, links and backlinks; the reading home opens this same library.

The shared provider, credential, IPC, storage recovery, and endpoint checks remain in force. The provider readiness probe and restored historical results still use the compatibility pipeline below.

## Compatibility action workspace

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
