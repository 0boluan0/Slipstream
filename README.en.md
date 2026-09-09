<p align="right"><a href="./README.md">简体中文</a> · <strong>English</strong></p>

# Slipstream

**Read the original. Keep the concepts.**

A macOS reading companion for native Chinese speakers working through English textbooks, research papers, and specialist articles. Capture a passage, keep a Chinese translation beside it, explore unfamiliar concepts in context, and save useful explanations as local Markdown cards.

> **Reading release v1.1.0** · macOS 12+ · [Download](https://github.com/0boluan0/Slipstream/releases/tag/v1.1.0) · Existing production installations can check for updates from the Slipstream menu.

<p align="center"><img src="./docs/images/02-reading-home.png" width="520" alt="Chinese reading home with screenshot capture, text input and a local card box"></p>

## Stay with the page

1. Press `Option + Shift + S` and select a paragraph or two.
2. Read the Chinese translation in an independent, movable, resizable window. Switch to parallel English and Chinese when needed.
3. Click a suggested term for its conceptual meaning and its role in this passage. Select any English phrase to look it up yourself.
4. Save an explanation and its source as a concept card. Add your own understanding and link related cards later.
5. Close the temporary window when finished. Saved cards remain on disk.

Pasting text and choosing “开始阅读”, or copying text and pressing `Option + C`, opens the same reading workflow without screen-recording permission.

## Translation, concepts, and a local card box

- **Translation appears first.** Explanations expand on demand.
- **Suggestions are optional.** A passage may have no recommended terms. There is no minimum quota, and the model does not know which concepts you already understand.
- **Context matters.** Explanations distinguish what a concept means from how the passage uses it.
- **Cards are ordinary Markdown.** They live under `Slipstream/术语卡片/` in the system Documents directory. Search, edit, add notes, and create links and backlinks in the app, or open the files directly.
- **LaTeX stays readable.** Inline and display math render locally in translations, explanations, and saved cards. Copying retains LaTeX; standalone equations retain their source.

<p align="center"><img src="./docs/images/03-reading-concept.png" width="460" alt="A contextual explanation of correlation with an explicit save-to-card action"></p>

Screenshots use authored passages and fixed illustrative responses in the actual application UI. They demonstrate the workflow, not model quality.

## Get started

Requires **macOS 12+**. Download the [Apple silicon installer](https://github.com/0boluan0/Slipstream/releases/download/v1.1.0/Slipstream-1.1.0-arm64.dmg) or [Intel installer](https://github.com/0boluan0/Slipstream/releases/download/v1.1.0/Slipstream-1.1.0-x64.dmg), then drag Slipstream into Applications. Existing production installations can check for updates in the app and confirm a restart after downloading.

The separate “Slipstream 阅读预览” app has its own settings and permissions. Install and configure the production app to use the public update channel.

Building from source additionally requires **Node.js 22.12+** and **Xcode Command Line Tools**:

```bash
git clone https://github.com/0boluan0/Slipstream.git
cd Slipstream/slipstream
npm ci
npm run dev
```

Choose **专业阅读** for translation and contextual concept explanations using configured DeepSeek, OpenAI, Anthropic, a compatible service, or local Ollama. Choose **基础翻译** for online translation and selected-phrase translation without an API key. Cloud providers may charge for requests; local quality depends on the model.

Allow screen recording when macOS requests it for capture. If macOS asks for a restart, quit and reopen the app. Development and installed builds can have different permission identities; see the [developer guide](./slipstream/README.md) for a stable preview build.

## Math and data flow

Apple Vision normally recognizes screenshots on your Mac. Suspected mathematical OCR enters an editable review. A supported DeepSeek configuration additionally offers explicit image-based formula transcription: the app names the destination, sends the current screenshot only on that action, and asks you to check the transcription before translation.

The selected provider receives submitted text for translation and selected phrases with the current reading context for explanations. Local Ollama uses a loopback endpoint; a custom local service may independently forward requests. Temporary reading windows do not create automatic source history. Explicitly saved cards include their source passage, and macOS controls any Documents-folder synchronization.

Clipboard monitoring is off by default and requires destination-specific confirmation. While enabled, the interface and macOS menu keep the destination and an off action visible. API keys use macOS encrypted storage. Slipstream has no accounts, ads, or product analytics. Read the [privacy and data-flow guide](./docs/PRIVACY.md).

## Project

The current focus is the complete capture → read → understand → save loop. Model-selected terms and explanations can vary in quality; the original remains available for comparison. Complex layouts and formula transcription still need checking.

[中文产品规格](./SPEC.md) · [Reading behavior](./docs/reading-pins.md) · [Development](./slipstream/README.md) · [Contributing](./CONTRIBUTING.md) · [Releases](https://github.com/0boluan0/Slipstream/releases)

Open source under the [MIT License](./LICENSE). [Report an issue](https://github.com/0boluan0/Slipstream/issues) with a concrete passage and description of the problem, after removing private content.
