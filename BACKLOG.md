# Slipstream — Backlog

Priority order: bugs > UX > beauty > error-handling > code-quality > docs

## Active Items

- [x] Verify app starts and runs end-to-end (clipboard monitoring work + no crash on startup)
- [x] Implement Option+C clipboard explanation trigger
- [x] Runtime verify Option+C non-empty and empty clipboard paths
- [x] Retry second judge review for Option+C runtime cycle
- [x] Fix OCR runner permission: `scripts/ocr-swift-runner.sh` currently fails with EACCES during F2 flow
- [x] Test Anthropic API key encrypt/decrypt with safeStorage
- [x] Verify Ollama `system` parameter actually works with local Ollama
- [x] Check dark mode rendering in actual window (vibrancy + transparency)
- [x] Test OCR: `scripts/VisionOCR.swift` compilation + full screenshot flow
- [x] Verify real F2 capture + OCR text handoff to floating panel
- [x] Verify full F2 Chinese explanation with configured provider or running Ollama
- [x] Verify full app-level Option+C flow with Ollama selected
- [x] Verify full app-level F2 flow with Ollama selected
- [x] Add explicit Retry action in floating panel
- [x] Add manual Save Term persistence from current explanation
- [x] Add local explanation history persistence
- [x] Add repeatable regression check for API-key encryption/redaction
- [x] Window position save/restore across sessions
- [x] F2 global shortcut registration and conflict detection
- [x] Truncation warning for text > MAX_TEXT_LENGTH
- [x] Tray icon rendering on macOS (uses system template image)
- [x] Main process sends API keys to renderer via SETTINGS_LOADED — keys should NOT leave main process
- [x] Build unsigned macOS DMG/ZIP artifacts for release smoke test
- [x] Ignore generated `slipstream/release/` artifacts
- [x] Remove unused camera/microphone/Bluetooth privacy strings from packaged Info.plist
- [x] Remove global App Transport Security arbitrary-loads allowance while preserving local Ollama exceptions
- [x] Keep build/check scripts out of packaged app while retaining runtime OCR scripts
- [x] Verify DMG checksum and ZIP app payload
- [x] Add one-command unsigned release gate
- [x] Add one-command unsigned build-and-verify release target
- [x] Make release checks follow package version/product name/current architecture
- [x] Generate and verify SHA-256 checksums for DMG/ZIP artifacts
- [x] Document unsigned release command and Developer ID prerequisite
- [x] Add project command for Developer ID signing readiness
- [x] Package OCR runner as real Resources files instead of inside app.asar
- [x] Make release gate invoke packaged OCR runner through bash
- [x] Make release gate mount DMG and verify it contains the app
- [x] Make release gate verify DMG has an Applications install shortcut
- [x] Make release gate force packaged Swift OCR recompilation
- [x] Make release artifact checks clean up DMG mounts and ZIP temp dirs on failure
- [x] Make release OCR check clean up `/tmp/slipstream-ocr`
- [x] Keep source/generated asset files out of packaged app
- [x] Add release package-config self-check
- [x] Remove risky asar extraction check after it overwrote source package metadata
- [x] Add notarization environment readiness check
- [x] Explicitly enable hardened runtime in mac release config
- [x] Add minimal entitlements plist for signed mac releases
- [x] Add distribution trust check command for signed/notarized artifacts
- [x] Add signed release command gated by signing/notarization readiness
- [x] Document signed release env vars without storing credentials
- [x] Wire `APPLE_TEAM_ID` into signed notarization build config
- [ ] Sign and notarize release with Apple Developer ID
