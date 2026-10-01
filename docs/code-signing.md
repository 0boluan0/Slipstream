# Code signing policy

Current Mac stable releases and reading previews use Developer ID signing and Apple notarization. Local preview builds must complete the distribution checks below before publication. Windows previews are unsigned and may trigger SmartScreen or other installation restrictions. See the [installation guide](./windows-preview.md#下载与安装).

## Current preview verification

On 2026-10-01, the Mac installer for [v1.3.0-preview.2](https://github.com/0boluan0/Slipstream/releases/tag/v1.3.0-preview.2) was repackaged with notarization tickets. Apple accepted both the application and DMG submissions. The final DMG and the application mounted from it passed signature, stapled-ticket and Gatekeeper checks. The original application's signed code hash and `app.asar` hash remained unchanged. The Windows installer was unchanged.

The final Mac DMG SHA-256 is `676f02e1bb75d189fa5dd5d907628b3e3fef24ac95a0b016f62b7155b0b990bc`. Users who downloaded the earlier unnotarized DMG can download the current file from the same release. Historical previews retain their original release status.

## Notarize a reading-preview installer

Use the already signed DMG as input. This keeps the application version, source revision, profile and runtime code unchanged. Keep the original file until the new installer has passed all checks.

From `slipstream/`, provide a validated Keychain profile in `APPLE_KEYCHAIN` and `APPLE_KEYCHAIN_PROFILE`, or one of the credential sets supported by `release:signed`. Then run:

```bash
npm run release:notarize-preview -- --input /absolute/path/original.dmg --output /absolute/path/notarized.dmg
npm run check:preview-distribution -- /absolute/path/notarized.dmg
```

The command notarizes and staples the app, rebuilds and signs the DMG, notarizes and staples it, then checks both the installer and its mounted app. It exports the output only after those checks pass. Failed work and Apple logs remain in the reported work directory for inspection; the original DMG is retained.

An Apple HTTP 403 about a missing or expired agreement requires the account holder to review and accept the pending agreement in [Apple Developer](https://developer.apple.com/account/). A successful code signature alone does not satisfy this requirement.

Before uploading a replacement, regenerate the Mac manifest's byte count and SHA-256, the corresponding `release.json` entry and `SHA256SUMS.txt` from the final file. Keep the application version and source revision unchanged, and keep the Windows artifact unchanged. Validate the final installer immediately before uploading. After uploading, check GitHub's asset digest and download the public manifests to confirm they match the local files. Only then change the release notes and download documentation to say the Mac installer is notarized.

See [Apple's notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). Notarization and Gatekeeper acceptance establish distribution checks; they do not establish translation quality or a new reader's first-use result.

## Maintainer responsibilities

The repository maintainer reviews release changes, including dependencies, build scripts and CI. Signing credentials stay outside the repository and pull-request environments. Accounts with release access must use multi-factor authentication.

Third-party binaries retain their upstream signatures and licenses. Verify the application and installer signatures after packaging, then generate manifests and checksums from the final files.

## Build identity

Paired previews share a package version and build-source revision. The revision is recorded inside each application and its manifest. Signing identifies the publisher; reading content still needs the reader's judgment.

## Privacy and support

See [privacy and data flow](./PRIVACY.md), [Windows privacy](./windows-privacy.md) and [SECURITY.md](../SECURITY.md). Public reports should contain the relevant steps and application message. API keys belong in application settings.
