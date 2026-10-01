<p align="right"><a href="./README.md">简体中文</a> · <strong>English</strong></p>

# Slipstream

**Select the part that stops you, understand it, and keep reading.**

Slipstream helps Chinese readers with English textbooks, papers and professional articles. Select a word, short passage, formula or small image region to see Chinese beside the source, then request a contextual explanation when needed. Useful concepts can be saved as local Markdown cards.

## Download

[Current preview: v1.3.0-preview.2](https://github.com/0boluan0/Slipstream/releases/tag/v1.3.0-preview.2)

- [macOS 12+, Apple silicon DMG](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0-preview.2/Slipstream-Reading-Preview-1.3.0-preview.2-arm64.dmg): Developer ID signed and Apple notarized. Drag the app into Applications.
- [Windows 11 x64 installer](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0-preview.2/Slipstream-Windows-Preview-1.3.0-preview.2-x64-Setup.exe): unsigned; Windows may show a warning. See the [installation guide](./docs/windows-preview.md#下载与安装).

Preview apps have separate identities. Checksums and build manifests accompany the installers. [macOS v1.2.1](https://github.com/0boluan0/Slipstream/releases/tag/v1.2.1) also provides Apple silicon and Intel builds with local text/formula recognition and review before translation.

## Get started

1. Choose professional reading and configure one **image-capable API** with its endpoint, model and key.
2. Read the built-in sample, then enable screenshot reading. On Mac, allow Screen Recording and restart the app if requested.
3. Press the capture shortcut shown on the home screen and drag around the part you need. The screen dims and the selected rectangle stays bright. Release to read; Esc cancels.
4. Read the Chinese translation, click a suggested concept or select words in the English view. Close the card to return to the source.

Default capture shortcuts are `Option + Shift + S` on Mac and `Alt + Shift + S` on Windows. Pasting a short passage is also supported.

## Reading tools

Chinese translation appears beside the source. Cards can move, resize, stay on top or collapse. Explanations describe a concept and its role in the selected passage, with source evidence available on demand. Concept suggestions may be empty.

LaTeX is preserved and rendered locally. The screenshot tab lets you compare the original or select another region. Saving cards and maintaining paper-specific symbol references are optional. The main workflow handles a local reading question.

## Data and limitations

Screenshot reading, translation and explanation share your configured service. Only the selected image region is submitted after image reading is enabled; the service may retain requests and charge for them. API keys remain in the main process and use system secure storage.

Saved cards are local Markdown files. Clipboard monitoring is off by default. The app has no accounts, advertising or product analytics. See [privacy and data flow](./docs/PRIVACY.md), [Windows privacy](./docs/windows-privacy.md) and [code signing](./docs/code-signing.md).

Models can misread text, omit symbols or misunderstand context. Dense formulas may fail. Check important notation against the screenshot and include a few necessary surrounding lines when selecting again. Windows preview auto-update and launch-at-login are not available.

## Open source

[Development](./slipstream/README.md) · [Contributing](./CONTRIBUTING.md) · [Changelog](./CHANGELOG.md) · [Report an issue](https://github.com/0boluan0/Slipstream/issues)

Released under the [MIT License](./LICENSE). Include the operating system, reproduction steps and displayed message when reporting a problem; share only the relevant image region.
