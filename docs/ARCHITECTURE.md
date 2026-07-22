# Architecture and trust boundaries

Slipstream is an Electron application with four explicit boundaries:

```text
capture → structured analysis → optional official verification → evidence-first renderer
```

## Capture

Clipboard, manual text, and Apple Vision OCR become a `CaptureEnvelope` containing source kind, capture time, SHA-256, exact source text, and optional OCR confidence/blocks. OCR runs locally. Temporary screenshots are removed after recognition.

## Structured analysis

Cloud or local model output is untrusted. The main process requests a strict JSON candidate and normalizes it into `ActionBriefV1`. Source quotes are resolved to UTF-16 offsets by Slipstream; model-provided offsets are ignored. Unsupported actions, materials, deadlines, terms, and process claims are dropped or marked pending.

Legacy prose and the free translation backend fail closed to a translation-only brief. Renderer code never interprets arbitrary Markdown as trusted actions.

## Official verification

Verification accepts only a minimal single-line query and up to three candidate HTTPS URLs. It rejects raw message fields, credentials in URLs, private/loopback destinations, unsafe redirects, oversized responses, unexpected MIME types, and timeouts. Successful retrieval alone is not sufficient to prove a claim; the response must satisfy the official-host and support checks before it can become `verified` provenance.

## Renderer

The sandboxed renderer receives redacted settings and JSON-safe briefs through allowlisted IPC. It displays original evidence, model inference, pending context, and official citations as distinct states. External links pass through a main-process HTTPS/public-host validator before opening in the system browser.

## Storage

Secrets use macOS `safeStorage`. Legacy plaintext secrets are migrated when encryption is available and cleared otherwise. Saved terms retain only a bounded definition and the shortest necessary evidence excerpt; full source cases are not retained by default.
