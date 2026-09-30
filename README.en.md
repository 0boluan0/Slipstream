<p align="right"><a href="./README.md">简体中文</a> · <strong>English</strong></p>

# Slipstream

**Select the part you need help with. Keep reading.**

A macOS quick lookup companion for native Chinese speakers reading English textbooks, research papers, and specialist articles. Select an unfamiliar sentence, short passage, formula with its necessary context, or small part of a figure. Read Chinese and optional explanations beside the source, then continue reading. Full-document translation and in-depth research are outside the main workflow.

> **Reading release v1.2.1** · macOS 12+ · [Download](https://github.com/0boluan0/Slipstream/releases/tag/v1.2.1) · Existing production installations can check for updates from the Slipstream menu.

## Stay with the page

1. Press `Option + Shift + S`. Drag a bright rectangle on the dimmed screen around the small part you need help with, including any necessary nearby explanation. Release to read, or press `Esc` to cancel.
2. Read Chinese beside the source. Switch to English and Chinese, click a suggested term, or select a phrase for an explanation when needed.
3. Close the temporary window and continue reading.

Saving an explanation as a local concept card and managing paper-specific references are optional. They do not have to precede a quick lookup.

Pasting text and choosing “开始阅读”, or copying text and pressing `Option + C`, opens the same reading workflow without screen-recording permission.

## Translation, concepts, and a local card box

Slipstream includes [paper-specific references](./docs/reading-references.md): retain notation and local definitions with their source sentences, retrieve them across captures, and resume the same paper after restarting. Definitions are saved explicitly and kept separately from the concept library.

- **Translation appears first.** Explanations expand on demand.
- **Suggestions are optional.** A passage may have no recommended terms. There is no minimum quota, and the model does not know which concepts you already understand.
- **Context matters.** Explanations distinguish what a concept means from how the passage uses it.
- **Cards are ordinary Markdown.** They live under `Slipstream/术语卡片/` in the system Documents directory. Search, edit, add notes, and create links and backlinks in the app, or open the files directly.
- **LaTeX stays readable.** Inline and display math render locally in translations, explanations, and saved cards. Copying retains LaTeX; standalone equations retain their source. Click a formula in the review view to select its LaTeX, compare it with the zoomable original screenshot, and correct it before translation. Draft edits survive view changes.

Screenshots use authored passages and fixed illustrative responses in the actual application UI. They demonstrate the workflow, not model quality.

## Get started

Requires **macOS 12+**. Download the [Apple silicon installer](https://github.com/0boluan0/Slipstream/releases/download/v1.2.1/Slipstream-1.2.1-arm64.dmg) or [Intel installer](https://github.com/0boluan0/Slipstream/releases/download/v1.2.1/Slipstream-1.2.1-x64.dmg), then drag Slipstream into Applications. Existing production installations can check for updates in the app and confirm a restart after downloading.

The separate “Slipstream 阅读预览” app has its own settings and permissions. Install and configure the production app to use the public update channel.

Building from source additionally requires **Node.js 22.12+** and **Xcode Command Line Tools**:

```bash
git clone https://github.com/0boluan0/Slipstream.git
cd Slipstream/slipstream
npm ci
npm run setup:formula-models
npm run dev
```

Choose **专业阅读** for translation and contextual concept explanations using configured DeepSeek, OpenAI, Anthropic, a compatible service, or local Ollama. Choose **基础翻译** for online translation and selected-phrase translation without an API key. Cloud providers may charge for requests; local quality depends on the model.

Allow screen recording when macOS requests it for capture. If macOS asks for a restart, quit and reopen the app. Development and installed builds can have different permission identities; see the [developer guide](./slipstream/README.md) for a stable preview build.

## Math and data flow

The installers include [local formula OCR](./docs/local-formula-ocr.md): specialized models recover LaTeX from screenshot pixels and place it back into the prose before review. It needs no API key, Python installation, or general-purpose LLM. No additional installation is needed.

In the local preview, setup reads an included authored image and explains one term using the same model, key, and endpoint. After you explicitly enable screenshot reading, that provider first transcribes your selected pixels and then translates the local transcript; standalone equations retain their source. Pixels outside the selection are not sent. Existing configurations retain local Apple Vision and formula OCR until image reading is enabled. The tested default is `deepseek-flash`; other models must pass the image trial. Local OCR retains its editable math review and optional DeepSeek formula transcription.

The configured provider may store requests and charge for images and text. Multiple term candidates receive one additional brief deletion review while the translation is already visible. Selected phrases and the current reading context are sent on demand for explanations. Unreadable areas have a visible recovery prompt; a changed formula between recognized source and translation blocks that translation. This comparison cannot prove the image was recognized correctly. Local Ollama uses a loopback endpoint; a custom local service may independently forward requests. Temporary reading windows do not create automatic source history. Explicitly saved cards include their source passage, and macOS controls any Documents-folder synchronization.

Clipboard monitoring is off by default and requires destination-specific confirmation. While enabled, the interface and macOS menu keep the destination and an off action visible. API keys use macOS encrypted storage. Slipstream has no accounts, ads, or product analytics. Read the [privacy and data-flow guide](./docs/PRIVACY.md).

## Project

The current focus is the complete capture → read → understand → save loop. Model-selected terms and explanations can vary in quality; the original remains available for comparison. Complex layouts and formula transcription still need checking.

[中文产品规格](./SPEC.md) · [Reading behavior](./docs/reading-pins.md) · [Development](./slipstream/README.md) · [Contributing](./CONTRIBUTING.md) · [Releases](https://github.com/0boluan0/Slipstream/releases)

Open source under the [MIT License](./LICENSE). [Report an issue](https://github.com/0boluan0/Slipstream/issues) with a concrete passage and description of the problem, after removing private content.
