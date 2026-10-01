# macOS release checklist

## Source and build

Release from a reviewed, clean commit with the intended package version. Run the source checks, lint and renderer build before packaging. Source builds require the fixed formula models and their licenses.

`npm run release:signed` stages both architectures outside synced folders. It requires a Developer ID Application identity and Apple notarization credentials. Credentials may come from a validated Keychain profile or the supported environment variables; keep them outside the repository.

## Distribution checks

- Provide arm64/x64 DMGs and update ZIPs, both ZIP blockmaps, `latest-mac.yml` and `SHA256SUMS.txt`.
- Verify package versions, architecture, hardened runtime, signatures, notarization tickets and Gatekeeper acceptance.
- Verify that update metadata binds the ZIPs to their exact size and SHA-512; recompute checksums after packaging.
- Inspect archives and mounted disk images for expected contents, then detach every mounted image.
- Compare packaged application source and resources with the frozen build inputs.

`npm run release:unsigned` is for local builds. Published stable releases require the signed distribution checks. Mac / Windows previews follow the [paired release process](./paired-release.md) and disclose their signing status.

## Publication

Create the version tag from the build commit and attach the installer assets, update metadata and checksums. Release notes describe changes, installation and user-relevant limitations. Verify the actual uploaded assets and description after publication.

Apple tools retry recognized temporary network failures. After a completed notarization upload, resume waiting on its submission ID instead of starting a duplicate upload. Permanent failures stop the release.
