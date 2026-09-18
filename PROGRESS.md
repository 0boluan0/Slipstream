# Slipstream — Progress

## Current — 2026-09-18 version 1.2.0 published

Published [v1.2.0](https://github.com/0boluan0/Slipstream/releases/tag/v1.2.0) at 12:44 UTC from `0c5ae1bcde7f0fdd9a22a04bda087da6d6984f5b`. All eight GitHub asset digests match the verified local artifacts; the public latest update feed and checksums match byte for byte. [Release verification](docs/releases/1.2.0-verification.json).

The local screenshot OCR component uses Apache-2.0 PP-DocLayoutV3 and MIT Pix2Text MFR 1.5. Both Mac architectures bundle verified models, native ONNX libraries and license notices. ONNX Runtime 1.18.0 meets the application's macOS 12 binary compatibility requirement. Both apps and DMGs passed Developer ID signing, Apple notarization, stapling and Gatekeeper checks. Paper-scoped references and the real-paper usability fixes are included in this production release.

Fixed source text duplication around formulas, adjacent punctuation, narrow captures and edge symbols. Real-pixel tests include Adam, Attention, DML, two fresh narrow equation crops, a matrix/mean and plain prose. Missing components and cancellation are covered; screenshot cancellation no longer produces a false permission alert. Formula results remain behind original-image review before translation. [Implementation and limits](docs/local-formula-ocr.md), [recognition evidence](docs/usability/2026-09-18/formula-ocr/results.json).

Validation: [exact-commit CI](https://github.com/0boluan0/Slipstream/actions/runs/35345116536) passed full npm test, local formula OCR, lint, renderer build, dependency audit and Swift typecheck. Each ZIP's 107 source/resource files and 10 renderer artifacts match the candidate. Actual bundled OCR passed Attention, Adam and DML images with network requests blocked on native arm64 and x64 through Rosetta; no Intel hardware acceptance is claimed.

Installed the verified arm64 ZIP over the local official 1.0.4 app, preserving its profile and a recoverable bundle archive. Observed the reading home, retained paper context and reference window; the installed app's update check reported the latest version after publication. The system screenshot selector launches; desktop automation could not complete its drag selection, so interactive capture-to-translation remains unverified. This is not first-install quarantine, minimum-OS or updater download/install acceptance. The independent reading preview remains separate and was closed to avoid competing shortcuts.


## Previous — 2026-09-18 real-paper usability iteration

Tested five excerpts from Attention Is All You Need, Adam, and Double/Debiased Machine Learning through native Preview and the installed reading preview with real model calls. Verified concept saving/editing, paper-scoped retention across restart, and retrieval of an earlier-page Q definition from a later-page card. This was an agent-operated reading audit, not a full-paper study or human usability trial. Evidence and limitations: [audit report](docs/usability/2026-09-18/README.md).

Fixed search equivalence for flattened/Unicode/LaTeX subscripts without changing stored symbol identities; search now filters pending candidates and prioritizes saved entries. Explicit reference windows acquire focus on first creation. Short inline mathematics no longer reserves a scrollbar gutter, and term labels render LaTeX. The initial claim that manual selection required scrolling was withdrawn after both geometry checks and actual drag-selection confirmed immediate visibility.

Validation: reference unit/native checks, the new real-issue usability regressions, math checks/native rendering, ESLint, renderer build and signed preview identity passed. Re-tested the saved Adam symbol, actual DML candidates, selection and mathematics in the installed UI. All 100 packaged source files and 10 renderer artifacts match the current workspace. Updated only the user-local signed reading preview, preserving its profile and recoverable bundle backups; no push, notarization or public release in this iteration.

Open: PDF copying can silently lose mathematical distinctions (Adam moment hats); important terms are still missed and terminology varies. A live root-N explanation also blurred the general rate definition with stronger distributional/moment properties; the audit records a primary-source comparison. Native screen-region capture could not be completed using the available UI-control surface, so its end-to-end result remains unverified. Paper switching clears pending definitions; capture cancellation/timeouts can produce a misleading permission message. Background activation can still require a separate first click. These limitations are not covered by the passing regression checks.

## Previous — 2026-09-14 paper references preview

Implemented persistent paper-scoped references alongside the existing reading cards. New captures inherit the selected paper; existing cards keep their association. Explicitly retained definitions include source evidence, support local lookup and editing, and remain separate from concept cards. Unknown symbols, pending local redefinitions, case/subscript distinctions, conflicting meanings, restart, deletion undo and narrow layouts are covered.

Validation: the full reading-pins group (native OCR, concept library, mathematical rendering and reference flow), macOS reading home, simulated Windows UI route, Windows packaging checks, core regressions, IPC and storage boundaries, lint and renderer build passed. Six authored reference fixtures passed with real DeepSeek V4 Flash through the signed preview identity. The first live run exposed a domain declaration being included in a symbol name; the corrected behavior and both live runs are recorded in [reference evidence](docs/reading-references.md).

Delivery: Developer ID-signed local reading preview; public release remains 1.1.0. The final archive's 100 runtime source files match the current workspace, and its 10 renderer artifacts match the tested production build. This preview has not been notarized or published as a production update. Existing Windows preview changes remain in the working tree.

Installed over the existing user-local reading preview with a recoverable archive of the prior bundle. Opened the installed application and verified the home entry reaches the new 本文速查 window; the app is left there ready to create a reading.

## Published — 2026-09-10 reading release

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
