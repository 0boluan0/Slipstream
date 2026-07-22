# macOS release checklist

## Source gate

- Working tree and dependency lock are intentional.
- Version and changelog are updated.
- `npm ci`, `npm audit --audit-level=high`, `npm test`, lint, renderer build, OCR checks, and package-config validation pass.
- No screenshots, source emails, API keys, or local audit artifacts are included.

## Signing and notarization

- Install a valid `Developer ID Application` identity.
- Provide either App Store Connect API credentials or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- Run `npm run release:signed`.
- Never replace a failed Developer ID signature with an ad-hoc signature.

## Artifact gate

- arm64 and x64 DMG/ZIP files exist and match `SHA256SUMS.txt`.
- Both apps have hardened runtime and a Developer ID authority/team identifier.
- The app and DMG both contain valid stapled notarization tickets.
- Gatekeeper accepts both architectures.
- Packaged OCR runs on its target architecture.

## Publish

- Create a version tag from the exact commit used to build.
- Attach both DMGs, both ZIPs, and `SHA256SUMS.txt` to the release.
- Include known limitations and privacy-impacting changes in the notes.
