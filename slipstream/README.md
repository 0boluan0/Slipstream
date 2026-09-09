# Slipstream 开发说明

**读懂原文，留下概念。** 给中文母语者的 macOS 专业英文阅读工具：截图或粘贴英文，打开独立中文阅读卡片，按需解释术语，并将解释与原文保存为本地 Markdown 概念卡片。

[产品首页](../README.md) · [English](../README.en.md) · [产品规格](../SPEC.md) · [阅读行为与证据](../docs/reading-pins.md)

## 环境与启动

- macOS 12+
- Node.js 22.12+
- Xcode Command Line Tools（Apple Vision OCR 辅助程序）

从本目录运行：

```bash
npm ci
npm run dev
```

`Option + Shift + S` 截图阅读，`Option + C` 读取已复制文字，`Command + ,` 打开设置；粘贴英文后用“开始阅读”或 `Command + Enter` 提交。截图需要 macOS 屏幕录制权限，纯文字阅读不需要。

专业阅读可配置本机 Ollama、DeepSeek、OpenAI、Anthropic 或兼容端点。基础翻译使用 Google Translate，必要时回退至 MyMemory。模型配置的兼容性探测仍使用固定虚构材料和现有结构化校验，界面会说明测试内容；不发送当前阅读材料。

## 核心模块

| 模块 | 责任 |
| --- | --- |
| `src/main/reading-pins.js` | 独立窗口、截图/OCR、文字入口、请求生命周期、选词解释与保存 |
| `src/main/reading-service.js` | 翻译与术语契约、原文匹配、可为空的推荐、上下文解释 |
| `src/main/reading-document.js` | 分段与段落状态，保留独立公式 |
| `src/main/reading-pin/` | 中文阅读卡片、英文对照、原图与公式核对 |
| `src/shared/reading-math.cjs` | LaTeX 规范化与本地渲染 |
| `src/main/term-card-store.js` | Markdown 持久化、关联与外部编辑冲突保护 |
| `src/main/term-library.js`、`term-library/` | 本地卡片盒的搜索、编辑和关联浏览 |
| `src/renderer/components/` | 阅读首页、首次设置、服务与快捷键配置 |

完整边界见[架构](../docs/ARCHITECTURE.md)与[隐私说明](../docs/PRIVACY.md)。历史结果、恢复和兼容性探测的详细约束保留在[兼容契约](../docs/action-workspace-contract.md)和[开发参考](../docs/action-workspace-development.md)。

## 验证

```bash
npm test
npm run lint
npm run build:renderer
npm run check:reading-home
```

- `check:reading-home` 使用真实 Electron、生产渲染构建和临时目录，覆盖首页 → 粘贴示例 → 独立阅读卡片 → 解释 → 保存 → 首页卡片盒，并检查首次设置及 200% 排版。回复为固定示例，不调用模型或读取屏幕。
- `check:reading-pins` 覆盖术语契约、本地存储、原生卡片与卡片盒、数学渲染和预览配置。
- `check:reading-math` 检查 LaTeX 保留、核对界面、渲染、复制和存储。
- 显式在线检查和既有质量记录见[阅读验收说明](../docs/reading-pins.md)。测试和 Issue 只使用自拟或已授权材料。

常规检查不覆盖仓库中的截图。需要更新界面证据时，在构建渲染器后显式运行 `npx electron scripts/check-reading-home-native.js --output ../docs/images`。

## 构建阅读预览

```bash
npm run build:reading-preview
```

此脚本创建独立身份 `com.slipstream.reading-preview` 的本地预览应用，输出路径记录为 `READING_PREVIEW_APP=…`。使用单独的配置目录与稳定应用身份，避免与原版 Slipstream 的权限混淆；预览不注册登录启动项，也不从正式版更新源安装更新。

脚本要求本机恰有一个可用 Developer ID Application 身份，并使用该身份签名。将后续构建放在相同安装路径并保持签名身份，有助于保持 macOS 权限。此命令不做 Apple 公证或公开发布，缺少所需签名身份会直接停止。

不要将临时构建路径当作长期安装路径。首次授权后若 macOS 要求重启，退出并从固定路径正常启动，再验证实际截图。

## 发布

阅读版从 1.1.0 开始提供正式安装包，使用 `com.slipstream.app` 与既有应用内更新渠道。正式发布运行 `npm run release:signed`，核对两个架构的签名、公证、安装包、更新元数据和校验和后，再发布同一提交的版本标签。

公证凭据可通过已验证的 Keychain profile 提供：设置 `APPLE_KEYCHAIN` 为钥匙串路径，`APPLE_KEYCHAIN_PROFILE` 为 profile 名称。凭据保留在本机钥匙串，不写入仓库。完整流程见[发布说明](../docs/RELEASE.md)。
