# Slipstream

macOS floating translation and explanation assistant -- reduces friction from English in learning and administrative communication.

## 系统要求

- macOS 10.15 (Catalina) 或更高版本
- Node.js 18 或更高版本
- Xcode Command Line Tools (用于 OCR 功能)

## Features

- **Clipboard monitoring**: Automatically detects and translates copied English text
- **Screenshot OCR**: Press F2 to capture a screen region; Vision framework OCR extracts text
- **Smart explanation**: Not just translation -- explains proper nouns, cultural context, and English idioms
- **Multi-LLM backends**: Supports Anthropic Claude, OpenAI GPT, Ollama local models, and custom API endpoints

## Installation & Startup

```bash
# 1. Install dependencies
cd slipstream
npm install

# 2. Make OCR script executable
chmod +x scripts/ocr-swift-runner.sh

# 3. Start development mode
npm run dev
```

> **提示**：`npm run dev` 是推荐的开发方式，它同时启动 Vite 开发服务器和 Electron 窗口。如果你需要使用 `npm start`，请先运行 `npm run build` 编译前端资源。

## Usage

1. **F2** -- Capture a screen region; OCR extracts text, then the LLM explains it
2. **Copy text** -- Automatically detects clipboard and translates
3. **Manual paste** -- Paste text into the input box, click "Process" (or press Cmd+Enter)
4. **Tray icon** -- Click the macOS menu bar icon to show or hide the Slipstream window

## Settings

Click the gear icon to open settings:
- Select LLM backend and enter the corresponding API key
- Customize prompt templates
- Toggle source language

## 常见问题

### OCR 识别失败 (OCR extraction failed)
1. 确保已安装 Xcode Command Line Tools：`xcode-select --install`
2. 确认 macOS 版本 >= 10.15 (Catalina)
3. 手动测试 OCR：`swift scripts/VisionOCR.swift test.png`

### API Key 不保存 (API Key not saving)
1. 检查 `~/Library/Preferences/slipstream-settings.json` 是否存在
2. 如果文件损坏，删除后重启应用：`rm ~/Library/Preferences/slipstream-settings.json`

### F2 截图不生效 (F2 screenshot shortcut not working)
1. 检查是否有其他应用占用了 F2 键
2. macOS 可能需要授予辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能
3. 确认应用有屏幕录制权限：系统设置 → 隐私与安全性 → 屏幕录制

### 编译 Swift OCR 脚本失败 (Swift compilation failed)
1. 确认 Swift 可用：`swift --version`
2. 手动编译：`swiftc -o /tmp/slipstream-ocr scripts/VisionOCR.swift`
3. 如果 `import Vision` 失败，确认 macOS >= 10.15

## Tech Stack

- Electron + React (JSX)
- macOS Vision framework (local OCR)
- Multi-backend LLM support

## Built with Agent Loop

This application was developed using the Plan -> Build -> Judge multi-agent loop workflow.
