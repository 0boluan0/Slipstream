# Code signing policy

Mac stable releases use Developer ID signing and Apple notarization. Mac reading previews use Developer ID signing and are not notarized. Windows previews are unsigned and may trigger SmartScreen or other installation restrictions. See the [installation guide](./windows-preview.md#下载与安装).

## Maintainer responsibilities

The repository maintainer reviews release changes, including dependencies, build scripts and CI. Signing credentials stay outside the repository and pull-request environments. Accounts with release access must use multi-factor authentication.

Third-party binaries retain their upstream signatures and licenses. Verify the application and installer signatures after packaging, then generate manifests and checksums from the final files.

## Build identity

Paired previews share a package version and build-source revision. The revision is recorded inside each application and its manifest. Signing identifies the publisher; reading content still needs the reader's judgment.

## Privacy and support

See [privacy and data flow](./PRIVACY.md), [Windows privacy](./windows-privacy.md) and [SECURITY.md](../SECURITY.md). Public reports should contain the relevant steps and application message. API keys belong in application settings.
