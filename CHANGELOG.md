# Changelog

## 1.0.4 — 2026-08-16

### Model setup is clearer and failures are easier to recover from

- Choose supported online models from a visible menu instead of typing model IDs; local Ollama and custom model IDs remain editable.
- Show the right next step for network problems, provider outages, account limits, custom services, and local Ollama.
- Improve provider retries, cancellation, and response handling, with safer Ollama suggestions for Chinese structured results.

## 1.0.3 — 2026-08-16

### DeepSeek analysis works reliably

- Disable DeepSeek V4's default thinking mode so complete, source-backed results finish within Slipstream's processing window instead of timing out before the final answer.

## 1.0.2 — 2026-08-15

### First use works as intended

- Keep the app visible when the first-use choice opens the main window.
- Restore basic translation for pasted text, clipboard text, and the safe example.
- Ask macOS for Screen Recording access on the first screenshot attempt, so Slipstream is registered in System Settings without requiring the user to add it manually.

## 1.0.1 — 2026-08-15

### A clearer first run

- Explain the API key or ready-to-use Ollama requirement before users choose full analysis, including possible online-service charges.
- Add a short first-task path, a prominent load-only safe example, and an up-front explanation of macOS Screen Recording permission.
- Keep the source-evidence instruction visible above the original text, so users can immediately verify where each conclusion came from.

### A polished macOS installer

- Replace the default DMG window with a branded drag-to-Applications layout.
- Keep both app labels readable in Finder and align the app, arrow, and Applications shortcut to their intended landing zones.

## 1.0.0 — 2026-08-15

Slipstream's first public macOS release.

### Understand the task

- Capture an English screen region, read copied text, or paste text manually.
- Turn the source into an ordered Chinese action path with materials, deadlines, reply requirements, and a complete translation.
- Explain everyday language, professional terminology, and unfamiliar cultural or administrative processes separately.
- Choose between action-first and translation-first result layouts.

### See where every answer came from

- Connect actions and explanations to exact source passages with matching numbers and colours.
- Keep outside explanations visually separate from what the original explicitly states.
- Treat retrieved official pages as sources to review, not automatic proof.

### Move forward without losing control

- Track personal progress without presenting it as verified real-world completion.
- Prepare an editable English reply only when the source requires one.
- Preserve drafts and results through safe navigation, recover recent accidental clears, and warn before abandoning active work.
- Keep clipboard monitoring optional and off by default.

### Privacy and processing choices

- Run screenshot OCR locally with Apple Vision.
- Use local Ollama, Anthropic, OpenAI, DeepSeek, or a compatible configured service for full analysis.
- Use no-setup basic translation through Google Translate with MyMemory as a fallback.
- Collect no telemetry and retain no history of original cases.

### macOS release

- Support macOS 12 or later on Apple silicon and Intel Macs.
- Ship Developer ID signed and Apple-notarized DMG installers for both architectures.
