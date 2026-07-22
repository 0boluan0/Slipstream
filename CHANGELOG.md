# Changelog

All notable changes to Slipstream are documented here.

## Unreleased

### Added

- Source-backed `ActionBriefV1` output for actions, deadlines, materials, terms, and unfamiliar processes.
- Side-by-side original-to-action evidence mapping.
- Separate pending and official verification provenance.
- Ask-first, local-only, and official-auto verification policies.
- Minimal-retention saved terms and legacy secret migration.

### Changed

- Repositioned the product from a floating translator to an action-oriented English assistant.
- Passive clipboard monitoring remains off by default.
- Free translation now fails closed to a clearly labeled translation-only result.

### Security

- Added safe official-source fetching constraints and validated external-link IPC.
- Removed ad-hoc re-signing fallback from the signed release path.
