# Slipstream

**看懂英文，办对事情。**

Slipstream is an open-source, privacy-first macOS assistant for Chinese-speaking people handling consequential English in study, work, and daily life. Copy text or capture a screen region, then get a Chinese action brief whose deadlines, materials, and next steps point back to the exact original wording.

## Why it is different

- **Action before abstraction** — see what to do, in order, instead of receiving only a translation.
- **Evidence beside every claim** — numbered highlights connect each action to the source quote that supports it.
- **Terms in context** — unfamiliar words, professional terminology, institutions, forms, and portals are explained where they occur.
- **Processes are a separate layer** — cultural or administrative background never masquerades as something the original text said.
- **Honest verification states** — a source is marked verified only after Slipstream has actually retrieved eligible official material that supports the lookup; otherwise it stays pending or failed.
- **Local-first capture** — Apple Vision OCR runs on the Mac. Clipboard monitoring and telemetry are off by default.

## Supported V1 workflow

1. Press `F2` and select a screen region, press `Option+C` for copied text, or paste text manually.
2. Watch the short capture → recognition → analysis → verification progress.
3. Review the original and action path side by side.
4. Open the full translation, term explanations, and clearly separated process background.
5. Copy the result, generate a reply draft, or recapture. Slipstream never sends or submits on the user's behalf.

V1 officially supports macOS and English-to-Chinese. It is not a general chat app.

## Privacy at a glance

| Operation | Where it runs | Default |
| --- | --- | --- |
| Screenshot OCR | Local Apple Vision | Local |
| Clipboard monitoring | Local app | Off |
| Model analysis | Selected Ollama or cloud provider | User-selected |
| Official-source lookup | Minimal query/candidate URL only | Ask first |
| Original case history | Local storage | Not retained by default |
| Telemetry | — | None |

The free translation backend sends submitted text to third-party translation endpoints and can only produce a translation-only result. Use Ollama for local analysis, or configure a supported cloud model for the full action brief. See [Privacy and data flow](docs/PRIVACY.md).

## Run from source

Requirements: macOS 12 or later, Node.js 22.12 or later, and Xcode Command Line Tools.

```bash
cd slipstream
npm ci
npm run dev
```

The first full analysis requires either a running Ollama model or an API key for a configured provider. API keys are encrypted with macOS `safeStorage` and are never exposed to the renderer.

## Verify changes

```bash
cd slipstream
npm test
npm run lint
npm run build:renderer
```

## Distribution

Unsigned, ad-hoc artifacts are only for local smoke testing:

```bash
cd slipstream
npm run release:unsigned
```

Public artifacts must be built from a clean commit with a Developer ID Application certificate and Apple notarization credentials. See the [release checklist](docs/RELEASE.md).

## Project docs

- [Product specification](SPEC.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Privacy and data flow](docs/PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

Slipstream is non-commercial and released under the [MIT License](LICENSE).
