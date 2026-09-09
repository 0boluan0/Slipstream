# Slipstream — Progress

## Current — 2026-09-09 reading preview

Phase: professional English reading preview.

Positioning: 读懂原文，留下概念。The Chinese README is the default repository entry, with an English switch. Screenshot reading leads the home screen; pasted text opens the same independent reading cards. The home card-box entry opens the native Markdown concept library. First use, model-mode labels, authored sample, package description, specification, privacy and architecture docs follow this reading workflow.

Validation: all npm test component checks and ESLint pass after targeted reruns, including native first use, lazy workspace recovery, reading home, pins, card store and math. Production entry JavaScript is 485,321 bytes (under the 490,000-byte working budget). UI screenshots use temporary profiles and illustrative replies, not live-model quality evidence. The preview uses a stable Developer ID identity separate from the original installed app.

Release candidate: 1.1.0, prepared for the existing production update channel. Developer ID signing and the prior Apple notarization profile are available. Fresh lockfile installation and full dependency audit report zero vulnerabilities after fast-uri, js-yaml and xmldom patch updates. Publication requires the complete signed dual-architecture release gate; the exact published tag records the built commit.

Installed preview: updated at the fixed user Applications path with the same Developer ID and bundle identity; installed source and renderer match the verified workspace. The new Chinese home, card-box entry, authored sample loading and accepted text handoff were checked through native UI.

Next: complete the signed release gate, publish its exact commit and upload all eight distribution/update assets.

## Historical snapshot — 2026-08-04

The following records the state at that time; its credential, signing and publication blockers are not current.


Phase: 4-release-polish
Sprint: — / —
Attempt: — / —
Dependency security: full `npm audit` and `npm audit --omit=dev` both report 0 vulnerabilities. The lockfile pins `fast-uri@3.1.5`, range-compatible `brace-expansion@1.1.18` / `2.1.4` / `5.0.9`, and root development `undici@7.29.0`; exact dependency-tree, lock-integrity, legacy-API, and bounded-expansion checks remain part of `npm test`.
Latest validation: on 2026-08-04, the exact current application tree was copied into a private non-synced validation tree and `npm run release:unsigned` exited 0. Fresh local-ad-hoc arm64/x64 DMG and ZIP candidates passed package configuration, the production dependency audit at 0 vulnerabilities, complete `npm test`, full ESLint, history non-retention, checksum revalidation, raw ZIP/app/ASAR and read-only DMG inspection, signature/build-identity/entitlement checks, and File Provider conflict-copy gates. Production entry JavaScript is 482,501 bytes, 7,499 bytes below the working budget and 17,499 below the release ceiling. Both packaged OCR binaries have the exact target Mach-O slice; the host-arm64 packaged runner recognized the fixed fictional image as 4 blocks at 1.000 confidence, while the missing-image case remained an independent negative probe.
Last action: made the OCR and local release path repeatable and fail closed. OCR helpers now receive only the seven required environment keys through private mode-`0700` cache/HOME/temp directories. Release inputs, generated app trees, ASAR entries, raw ZIP directories, extracted ZIPs, mounted DMGs, checksums, and the final release directory reject File Provider conflict copies. The release gate verifies full artifacts before tests download the local Electron runtime, removes each inspected architecture immediately, and finishes by rechecking artifact checksums and directory cleanliness.
Failed items: public release remains externally blocked. This machine has 0 valid Developer ID Application identities, no supported Apple notarization credentials, and no authenticated GitHub CLI session; `check:signing`, `check:notarization-env`, and `check:distribution` fail as designed. The current `main` worktree is not a clean exact-version tagged release commit, and the changelog remains `Unreleased`. The packaged executable still lacks an installed-style first-use/Settings persistence smoke. Real VoiceOver/manual macOS accessibility settings, signed/notarized installed-app acceptance, Finder/Gatekeeper/translocation, physical cold start, representative older/Intel Macs, and a rotated-credential network-backed quality run remain open. No supplied credential was used, sent, logged, or persisted; the previously exposed credential must be revoked before any future live-provider run.
Next items: run the copied-package first-use/Settings/restart smoke, then make legacy Full-mode migration require current prompt-v2 readiness rather than credential presence alone. Reduce packaged non-runtime dependency source/map weight without weakening the artifact contract. After those internal gates pass, provision Developer ID/notarization credentials, authenticate GitHub, review and commit an exact-version release, and rerun the signed distribution gate before tagging or publishing.
