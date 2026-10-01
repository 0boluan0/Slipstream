<p align="right"><strong>简体中文</strong> · <a href="./README.en.md">English</a></p>

# Slipstream

**卡住哪一块，就划哪一块。**

阅读英文教材、论文和专业文章时，框选不懂的词句、短段落、公式或小块图文，在原文旁看中文与按需解释，看懂后继续读。有用的概念可以另存为本地 Markdown 卡片。

## 下载

[正式版 · v1.3.0](https://github.com/0boluan0/Slipstream/releases/tag/v1.3.0)

| 系统 | 安装包 | 安装提示 |
| --- | --- | --- |
| macOS 12+，Apple 芯片 | [下载 DMG](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0/Slipstream-1.3.0-arm64.dmg) | Developer ID 签名，Apple 公证；拖入“应用程序” |
| macOS 12+，Intel | [下载 DMG](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0/Slipstream-1.3.0-x64.dmg) | Developer ID 签名，Apple 公证；拖入“应用程序” |
| Windows 11 x64 预览 | [下载安装程序](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0/Slipstream-Windows-Preview-1.3.0-x64-Setup.exe) | 未签名，系统可能显示来源提示；见 [安装说明](./docs/windows-preview.md#下载与安装) |

Mac 正式版沿用 Slipstream 的配置和应用内更新渠道。此前的“Slipstream 阅读预览”是独立应用，配置独立；两者主动保存的本地卡片可以从卡片盒打开。安装包校验和在同一发行页提供。

## 开始使用

1. 打开应用，选择“专业阅读”，配置一套**支持图片的 API**。服务、模型与 Key 只需配置一次。
2. 按引导试读内置图片，成功后点击“启用截图阅读”。Mac 首次截图需允许屏幕录制；系统要求重启时，退出并重新打开应用。
3. 按首页显示的截图快捷键，拖出当前不懂的这一小块。屏幕变暗，选区保持高亮；松开开始阅读，Esc 取消。
4. 看中文，按需点击术语，或在英文对照里选词查询。看懂后关闭浮窗继续读。

默认截图快捷键：Mac `Option + Shift + S`，Windows `Alt + Shift + S`。也可以粘贴局部英文，点击“开始阅读”。

## 可以做什么

- **读中文与英文对照**：译文贴在原文旁，窗口可移动、缩放、置顶或收起。
- **查当前概念**：解释“概念是什么”和“放在这段里”，原文依据按需展开；推荐术语允许为空。
- **读公式**：保留并渲染 LaTeX，可在“截图”页核对原图、重新框选。
- **留下有用的内容**：主动保存为本地 Markdown 卡片，补充个人笔记、搜索及关联；本文速查可按论文记符号与缩写。

保存卡片和管理本文速查都按需使用。主要流程是解决眼前这一小块阅读疑问；整篇翻译与深入研读不属于主要用途。

## 数据与服务

截图、中文翻译和解释共用你配置的服务。启用图片阅读后，只发送主动选中的区域；服务可能记录请求并收费。API Key 只填入应用设置，由主进程通过系统安全存储使用。

卡片默认保存在系统文稿目录的 `Slipstream/术语卡片/`，仅在点击保存后写入。应用没有账户、广告或产品分析埋点；剪贴板监听默认关闭；开启前确认处理去向，开启后界面和菜单栏持续显示去向及关闭入口。

详见 [隐私与数据流](./docs/PRIVACY.md)、[Windows 隐私说明](./docs/windows-privacy.md) 和 [签名说明](./docs/code-signing.md)。

## 使用限制

模型可能误读文字、遗漏符号或误解上下文，密集公式仍可能无法读取。关键符号与结论请对照原图。截断句或上下文不足时，带上附近几行必要说明重新框选。预览的 Windows 自动更新与开机启动尚未开放。

## 开源与参与

[阅读功能说明](./docs/reading-pins.md) · [产品规格](./SPEC.md) · [开发与构建](./slipstream/README.md) · [贡献指南](./CONTRIBUTING.md) · [更新记录](./CHANGELOG.md)

采用 [MIT License](./LICENSE)。[反馈问题](https://github.com/0boluan0/Slipstream/issues) 时请说明系统版本、操作步骤和遇到的提示；示例图片只附与问题有关的区域。
