# Slipstream — Progress

## Current — 2026-09-10 reading release

Phase: professional English reading, version 1.1.0.

Positioning: 读懂原文，留下概念。The Chinese README is the default repository entry, with an English switch. Screenshot and pasted-text reading open independent cards; contextual terms can be saved to the local Markdown concept library. First use, examples, formula handling and public docs follow this workflow.

Published: [v1.1.0](https://github.com/0boluan0/Slipstream/releases/tag/v1.1.0), at 2026-09-10 08:38 UTC, from tag commit `b2d9933d1661bceb97e0262a8f96732b0e69ad86`. The eight public release assets match local SHA-256 digests. The public latest update feed was downloaded and matched the verified 1.1.0 metadata byte for byte.

Validation: [CI run 34432930836](https://github.com/0boluan0/Slipstream/actions/runs/34432930836) passed full npm test, lint, renderer build, full dependency audit and OCR typecheck. Both architectures passed local archive, OCR-slice, signing, notarization, Gatekeeper and update-manifest checks. All 95 packaged source files in each ZIP match the release commit. Local lint and history non-retention checks passed. Local aggregate test retries encountered native fixture launcher/timeouts; the complete source regression result is the successful CI run.

Distribution recovery: after Apple status polling lost its connection, the preserved signed artifacts were resumed. All four app/DMG submissions were confirmed Accepted; staples and final distribution trust passed. Temporary-network retry and uploaded-submission resume checks are included in the release tooling.

Installation: the public app keeps `com.slipstream.app` and its existing update channel. The independent reading preview retains its own settings, permissions and identity.

Next: use real reading feedback to refine term selection and formula review.

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
