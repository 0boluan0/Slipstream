# Slipstream

**看懂英文，办对事情。**

Slipstream is a privacy-first macOS action assistant for Chinese users handling consequential English. It turns clipboard text or local screenshot OCR into a structured Chinese brief with source-backed actions, deadlines, materials, term explanations, and clearly separated process context.

## Requirements

- macOS 12 or later
- Node.js 22.12 or later
- Xcode Command Line Tools for the local Apple Vision OCR helper

## Development

```bash
npm ci
npm run dev
```

Primary triggers:

- `F2`: select a screen region, run local OCR, and analyze it.
- `Option+C`: analyze the current clipboard text.
- Manual input: paste text and choose Analyze.

Clipboard monitoring is optional and off by default.

## Model configuration

The full action brief requires Ollama or a configured Anthropic, OpenAI, DeepSeek, or compatible endpoint. Cloud backends receive text the user submits. Ollama keeps model analysis local. API keys use macOS secure storage.

The free translation backend uses third-party online translation endpoints and returns a clearly labeled translation-only result; it cannot provide trusted actions or official verification.

## Verification

Official-source verification defaults to Ask first. Local-only performs no lookup. Official-auto retrieves only eligible HTTPS candidate sources using a minimized request. Retrieval, support, and official-host checks must pass before a result is labeled verified.

## Checks

```bash
npm audit --audit-level=high
npm test
npm run lint
npm run build:renderer
npm run check:package-config
```

## Release

`npm run release:unsigned` produces ad-hoc artifacts for local smoke testing only. Public distribution requires a Developer ID Application identity and Apple notarization credentials, then `npm run release:signed`. The signed gate verifies both arm64 and x64 ZIP/DMG artifacts, hardened runtime, stapling, and Gatekeeper acceptance.

Slipstream collects no telemetry. See the repository's `docs/PRIVACY.md`, `SECURITY.md`, and MIT `LICENSE` for details.
