# Slipstream — Backlog

Priority order: bugs > UX > beauty > error-handling > code-quality > docs

## Active Items

- [ ] Verify app starts and runs end-to-end (clipboard monitoring + F2 screenshot + LLM processing)
- [ ] Test OCR: `scripts/VisionOCR.swift` compilation on this machine
- [ ] Test clipboard monitor polling
- [ ] Verify all IPC channels work between main and renderer
- [ ] Check dark mode rendering in actual window (vibrancy + transparency)
- [ ] Verify `electron-store` ESM/CJS compatibility (uses fallback pattern)
- [ ] Test Anthropic, OpenAI, Ollama, and Custom backends
- [ ] Check Markdown rendering for all LLM output formats
- [ ] Window position save/restore across sessions
- [ ] F2 global shortcut registration and conflict detection
- [ ] Truncation warning for text > MAX_TEXT_LENGTH
- [ ] Tray icon rendering on macOS (uses system template image)
- [ ] CSP in index.html — `connect-src` covers all LLM backends
