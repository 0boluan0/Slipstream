# macOS release checklist

## Source gate

## Signing and notarization

- Install a valid `Developer ID Application` identity.
- Provide App Store Connect API credentials, `APPLE_ID` plus an app-specific password and Team ID, or a validated `notarytool` Keychain profile.
- Run `npm run release:signed`.
- Never replace a failed Developer ID signature with an ad-hoc signature.
- The final DMGs are Developer ID signed and verified, submitted to Apple, stapled and validated, then receive freshly generated blockmaps before publication.
- Both release commands stage the complete build under the system temporary directory, outside synced/File Provider folders, and publish artifacts only after both architectures finish. As soon as each architecture's archives exist, the builder removes only its basename-guarded reproducible unpacked app directory to bound peak disk use; every `.pending` destination is registered for cleanup before its copy starts, so an interrupted or ENOSPC copy cannot leave a partial candidate behind.
- Ad-hoc builds use a local-only library-validation exception so Electron can launch without a Team ID. The signed distribution gate rejects that exception.

## Artifact gate

- arm64 and x64 DMG/ZIP files exist and match `SHA256SUMS.txt`.
- Packaging inputs and the release directory must be free of lexical File Provider conflict-copy names. `afterPack` scans the complete app tree and ASAR; release inspection independently scans raw ZIP central-directory entries, each extracted ZIP/app/ASAR, each read-only mounted DMG/app/ASAR, and the final release directory. Architectures are extracted and removed one at a time, and the gate finishes by recomputing artifact hashes and rescanning the release directory.
- DMG inspection detaches every mounted image before continuing. `scripts/check-release-artifacts.js` allows only four detach attempts, 250 ms apart, and accepts a disappeared mount point as already detached; a mount that remains after the bounded retry still fails the gate.
- Both apps have hardened runtime and a Developer ID authority/team identifier.
- The app and DMG both contain valid stapled notarization tickets.
- Gatekeeper accepts both architectures.
- Packaged OCR acceptance statically verifies the exact arm64 or x86_64 Mach-O slice in both packages. On the host architecture only, `check-release-info` must execute the reviewed fixed fictional image and require its exact text, source hash, ordered 4-block contract, and confidence floor, then separately execute the missing-image negative case. Do not describe this as runtime execution on both target architectures.

## Publish

- Publish only from a reviewed, clean exact-version commit after `release:signed` and `check:distribution` pass with a valid Developer ID identity and notarization credentials. Never upload the local-ad-hoc artifacts as the public production release.
- Create a version tag from the exact commit used to build.
- Attach both user-facing DMGs, both ZIPs, and `SHA256SUMS.txt` to the release. Blockmaps remain build outputs until an in-app updater consumes them.
- Include known limitations and privacy-impacting changes in the notes. In V1, GOV.UK is the only built-in search-discovery provider; other publishers require an eligible candidate URL and retrieved pages remain claim-neutral unless an explicit semantic assessor verifies support.
