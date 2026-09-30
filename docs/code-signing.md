# Code signing policy

Slipstream submitted its application to [SignPath Foundation](https://signpath.org/) for free Windows code signing on 2026-09-30. The application page confirmed submission; approval and a production signing certificate are pending. The Windows installer in `v1.3.0-preview.1` is unsigned; this application does not change that installer or its trust status.

## Project and responsibilities

- Project: [Slipstream](https://github.com/0boluan0/Slipstream), released under the [MIT License](../LICENSE).
- Author, reviewer and release/signing approver: [0boluan0](https://github.com/0boluan0), the repository owner and maintainer.
- Changes from contributors require maintainer review, including changes to dependencies, build scripts and CI configuration.
- Maintainer accounts used for repository access and code signing must use multi-factor authentication. SignPath account setup and verification are pending.
- Each production signing request requires explicit approval by the maintainer. Signing credentials and approval authority must not be exposed to pull requests or stored in the repository.

## Signing scope

The requested scope is the Windows application and installer built from this repository. The [current Windows workflow](../.github/workflows/windows-preview.yml) uses a GitHub-hosted `windows-2022` runner. Future SignPath submissions will use verifiable GitHub Actions artifacts and the source revision recorded in the packaged application. The maintainer's laptop is used for installation and native Windows testing.

Third-party binaries retain their upstream signatures and licenses; they are not presented as Slipstream-authored binaries. Application executables and the installer/uninstaller require an agreed artifact configuration before signing is enabled. The signature must be checked after packaging, and release manifests and SHA-256 values must be generated from the final signed files.

Mac and Windows installers in a paired preview must share the same package version and source commit. A signature does not certify translation accuracy or completion of product acceptance. The [published preview](https://github.com/0boluan0/Slipstream/releases/tag/v1.3.0-preview.1) retains its known reading-quality limitations.

If the Foundation approves the application, its certificate will identify **SignPath Foundation** as the publisher. At that point this policy and the download page will carry the Foundation's required attribution. A certificate is not currently issued to this project.

## Privacy and support

See the [Windows preview privacy notice](./windows-privacy.md) and the [full privacy and data-flow description](./PRIVACY.md). Reading content is sent only after a reader enables a processing mode and requests reading, or explicitly enables clipboard monitoring. The selected mode discloses the receiving service.

Please report security or privacy concerns using [SECURITY.md](../SECURITY.md). Do not include API keys, private screenshots or personal reading material in public issues.
