# Changelog

All notable changes to Slipstream are documented here.

## Unreleased

### Added

- Source-backed `ActionBriefV1` output for actions, deadlines, materials, ordinary words, professional terms, and unfamiliar processes.
- Side-by-side original-to-action evidence mapping.
- Structured “what it is / why it matters / what to do” process explanations.
- Separate pending, retrieved, and explicitly verified provenance.
- Ask-first, local-only, and official-auto verification policies.
- Privacy-minimized GOV.UK discovery and bounded official-page retrieval receipts.
- Minimal-retention saved terms and legacy secret migration.

### Changed

- Repositioned the product from a floating translator to an action-oriented English assistant.
- Passive clipboard monitoring remains off by default.
- Free translation now fails closed to a clearly labeled translation-only result.
- Original case history is no longer retained by the supported V1 flow.
- macOS releases now build and sign in an isolated temporary staging directory, then publish the complete dual-architecture artifact set through staged replacement.

### Security

- Added safe official-source fetching constraints and validated external-link IPC.
- Added one-time, source-bound verification approvals, cancellation propagation, DNS/SSRF checks, and neutral retrieval semantics.
- Removed ad-hoc re-signing fallback from the signed release path.
- Separated local ad-hoc and Developer ID entitlements so the local Electron workaround cannot leak into public artifacts.
