# Changelog

## Unreleased

- 截图按前台文档来源找回本文速查；新文档或未知来源先进入临时阅读，读者选定后绑定，同篇后续截图及重启后继续复用，不再静默沿用上一篇论文的局部定义。
- 对论文公式识别中不确定的横线增加核对提示，去除公式框内误读的分号，并区分相似度函数 `sim` 与 LaTeX 采样关系 `\sim`。

- 术语推荐区分核心概念与配角词；多个候选增加一次只删不增的短复核，译文先显示，不等待推荐即可阅读、复制和选词查询。
- 同一张阅读卡片不重复展示相同概念按钮，仍可在各段原文中选词查询。
- 复核失败保留译文，并提示可在原文中手动查询；普通段落仍可完全不推荐术语。
- 小卡片展开解释时自动增加空间，关闭后恢复，保留手动调整的尺寸和位置。连续查词从新解释的开头显示，字号按钮同时作用于解释与本段用法，收起后焦点返回术语按钮。

- 专业阅读首次配置使用自拟教材段落，实际测试中文翻译与上下文术语解释，并展示当前模型的返回内容。
- 修复首次配置仍以邮件待办和流程背景验收模型的问题；自动推荐为空也可正常完成阅读试读。
- 模型目录未列出当前模型名称时，继续以真实阅读请求确认可用性，避免拒绝服务实际支持的别名。
- 试读限制在 60 秒内，支持取消和失败重试；新测试清除旧结果，完成后可核对原文并明确启用。

## 1.2.1 — 2026-09-21

- 修复慢速环境下英文回复草稿的状态竞争，避免新输入被旧内容覆盖。

- 改善截图中独立希腊字母的检测：对较弱的小符号候选增加像素识别核验，保留 α、θ 等符号；继续提示需要核对。
- 调整公式裁剪边界，避免相邻行的像素混入公式；修复正文与公式之间的重复标点，序数词不再被锁定为数学内容。
- 核对页可点击公式直接定位编辑；编辑时同时显示原始截图，支持放大和滚动，并可直接提交校正内容翻译。
- 修复核对阶段从截图进入校正的按钮被禁用；切换截图和核对时保留尚未确认的修改。
- 新增真实桌面截图、不同显示尺寸、导数点号及普通文字回归，保留改动前后的识别证据。

## 1.2.0 — 2026-09-18

- 正式安装包在截图入口自动进行本地公式识别，恢复帽子、上下标、分式与矩阵的 LaTeX，并按位置合并正文；无需 Key，确认前不调用翻译服务。识别组件随应用安装，本机处理截图，不调用通用大模型。

- 修复公式邻近正文重复、标点遗漏和贴边符号识别；核对页优先展示排版后的原文，按需展开 LaTeX 编辑。
- 取消截图安静退出；框选超时给出重新框选提示，避免误报权限问题。
- 新增按论文保留的「本文速查」：从截图中的明确原句提取定义，显式留下后跨截图查询、跨启动继续阅读。
- 支持符号与缩写搜索、手动记录、修正、复制和删除撤销；保留上下标、大小写、LaTeX 和同名不同义的原文依据。
- 首页、菜单栏和阅读卡片均可打开速查；记录独立于长期概念卡片盒。

## 1.1.0 — 2026-09-10

- 面向英文教材、论文和专业文章，首页以截图阅读为主要入口，粘贴英文进入相同的独立阅读卡片。
- 中文译文优先；按需展开上下文术语解释，推荐允许为空，并支持原文选词查询。
- 显式保存为本地 Markdown 概念卡片，支持个人笔记、搜索、关联与反向关联；首页直接打开卡片盒。
- 保留并渲染 LaTeX，数学 OCR 先核对，支持明确选择后的视觉公式转写。
- 首次设置、阅读示例、中文默认 README 与英文说明同步采用阅读定位。
- 独立阅读预览应用身份与配置目录，避免与正式版权限及更新渠道混淆。

- 正式版支持登录时启动，可在设置中关闭；尊重系统中已有的登录项选择。
- 更新 fast-uri、js-yaml 与构建依赖 xmldom 的安全补丁。

## 1.0.6 — 2026-08-17

### Updates stay inside Slipstream

- Check the public GitHub release feed automatically after launch or manually from the Slipstream menu.
- Download updates in the app, show progress in the macOS menu, and ask before restarting to install.
- Keep restart-to-install behind the same draft, task, and clipboard exit protections as a normal quit.
- Publish signed arm64 and Intel update archives with verified metadata and differential-download blockmaps.

## 1.0.5 — 2026-08-17

### Action lists stop at real unfinished work

- Keep completed confirmations, optional controls, and institution-side work out of the user's action list.
- Preserve explicit required and conditional user tasks, with their exact source evidence.
- Recheck proposed tasks, materials, and deadlines with the same configured model before showing them as unfinished work; online providers may charge for this second call.
- Keep DeepSeek's reviewed items bound to their original claims, and accept equivalent Chinese upload and material wording during setup checks.
- Show an honest no-action result without mislabeling the analysis as basic translation.

## 1.0.4 — 2026-08-16

### Model setup is clearer and failures are easier to recover from

- Choose supported online models from a visible menu instead of typing model IDs; local Ollama and custom model IDs remain editable.
- Show the right next step for network problems, provider outages, account limits, custom services, and local Ollama.
- Improve provider retries, cancellation, and response handling, with safer Ollama suggestions for Chinese structured results.

## 1.0.3 — 2026-08-16

### DeepSeek analysis works reliably

- Disable DeepSeek V4's default thinking mode so complete, source-backed results finish within Slipstream's processing window instead of timing out before the final answer.

## 1.0.2 — 2026-08-15

### First use works as intended

- Keep the app visible when the first-use choice opens the main window.
- Restore basic translation for pasted text, clipboard text, and the safe example.
- Ask macOS for Screen Recording access on the first screenshot attempt, so Slipstream is registered in System Settings without requiring the user to add it manually.

## 1.0.1 — 2026-08-15

### A clearer first run

- Explain the API key or ready-to-use Ollama requirement before users choose full analysis, including possible online-service charges.
- Add a short first-task path, a prominent load-only safe example, and an up-front explanation of macOS Screen Recording permission.
- Keep the source-evidence instruction visible above the original text, so users can immediately verify where each conclusion came from.

### A polished macOS installer

- Replace the default DMG window with a branded drag-to-Applications layout.
- Keep both app labels readable in Finder and align the app, arrow, and Applications shortcut to their intended landing zones.

## 1.0.0 — 2026-08-15

Slipstream's first public macOS release.

### Understand the task

- Capture an English screen region, read copied text, or paste text manually.
- Turn the source into an ordered Chinese action path with materials, deadlines, reply requirements, and a complete translation.
- Explain everyday language, professional terminology, and unfamiliar cultural or administrative processes separately.
- Choose between action-first and translation-first result layouts.

### See where every answer came from

- Connect actions and explanations to exact source passages with matching numbers and colours.
- Keep outside explanations visually separate from what the original explicitly states.
- Treat retrieved official pages as sources to review, not automatic proof.

### Move forward without losing control

- Track personal progress without presenting it as verified real-world completion.
- Prepare an editable English reply only when the source requires one.
- Preserve drafts and results through safe navigation, recover recent accidental clears, and warn before abandoning active work.
- Keep clipboard monitoring optional and off by default.

### Privacy and processing choices

- Run screenshot OCR locally with Apple Vision.
- Use local Ollama, Anthropic, OpenAI, DeepSeek, or a compatible configured service for full analysis.
- Use no-setup basic translation through Google Translate with MyMemory as a fallback.
- Collect no telemetry and retain no history of original cases.

### macOS release

- Support macOS 12 or later on Apple silicon and Intel Macs.
- Ship Developer ID signed and Apple-notarized DMG installers for both architectures.
