<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<div align="center">
  <img src="./slipstream/build/icon.png" width="96" alt="Slipstream 应用图标">
  <h1>Slipstream</h1>
  <p><strong>看懂英文，办对事情。</strong></p>
  <p>截图或复制英文邮件、通知、表格或网页。<br>Slipstream 会把它整理成中文行动路径，并让每一步都能指回原文依据。</p>
  <p>
    <a href="https://github.com/0boluan0/Slipstream/releases/latest"><img alt="下载 Slipstream" src="https://img.shields.io/badge/下载_macOS_版-最新版本-087F6D?style=for-the-badge&logo=apple"></a>
  </p>
  <p>
    <img alt="需要 macOS 12 或以上版本" src="https://img.shields.io/badge/macOS-12%2B-222222?logo=apple">
    <a href="./LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/许可证-MIT-2F6FEB"></a>
    <img alt="不收集遥测" src="https://img.shields.io/badge/遥测-不收集-087F6D">
  </p>
</div>

![Slipstream 将每项行动直接连回原文依据](./docs/images/slipstream-action-brief.jpg)

## 看懂了，还得知道怎么办

翻译只能告诉你“它写了什么”。Slipstream 还会帮你看清这件事该怎么办：

- **下一步做什么**：把行动、材料、截止日期和回复要求整理成有顺序的路径。
- **结论从哪里来**：用相同编号和颜色，把每项行动直接连回原文中的准确依据。
- **不认识的内容是什么**：分别解释普通词语、专业术语，以及陌生的社会或行政流程。
- **如何继续处理**：只有原文要求回复时，才提供可编辑的英文回复草稿。Slipstream 不会替你发送或提交。

## 从原文到下一步，只需三步

| 1. 获取原文 | 2. 看清任务 | 3. 开始处理 |
| --- | --- | --- |
| 按 `Option+Shift+S` 框选屏幕，按 `Option+C` 读取已复制文字，或手动粘贴。 | 在完整原文旁查看中文结论和行动顺序；每个重要结论都能直接定位到依据。 | 核对材料与日期，理解术语和流程背景，记录进度，并在需要时准备回复。 |

你可以选择 **行动优先**，先看下一步；也可以选择 **翻译优先**，先读完整中文翻译。

## 三种“不明白”，分开解决

| 你遇到的问题 | Slipstream 会告诉你 |
| --- | --- |
| 某个单词或短语不认识 | 它在当前句子里的通俗中文含义 |
| 不懂专业术语、表格、机构或网站 | 它在这件事里是什么意思，会不会影响下一步 |
| 不熟悉当地的文化、社会或行政流程 | 这是什么、为什么存在、接下来通常怎么做 |

外部补充知识会与“原文明确写了什么”清楚分开，不会混成同一种依据。

## 选择适合你的帮助程度

| 完整分析 | 基础翻译 |
| --- | --- |
| 提供翻译、行动、材料、日期、术语、流程背景、原文依据和回复帮助 | 只提供翻译 |
| 可使用本机 Ollama，或你配置的 Anthropic、OpenAI、DeepSeek 和兼容服务 | 无需配置 |
| 提交前会明确显示文字将被发送到哪里 | 文字会发送给 Google Translate，必要时再发送给 MyMemory |

## 下载与安装

Slipstream 支持 **macOS 12 或以上版本**。

| 你的 Mac | 下载 |
| --- | --- |
| Apple 芯片——M1、M2、M3、M4 及更新型号 | [下载 Slipstream 1.0.5 arm64 版](https://github.com/0boluan0/Slipstream/releases/download/v1.0.5/Slipstream-1.0.5-arm64.dmg) |
| Intel 处理器 | [下载 Slipstream 1.0.5 x64 版](https://github.com/0boluan0/Slipstream/releases/download/v1.0.5/Slipstream-1.0.5-x64.dmg) |

1. 打开下载好的 DMG。
2. 把 **Slipstream** 拖进 **Applications（应用程序）**。
3. 正常启动即可。应用已经使用 Apple Developer ID 签名，并通过 Apple 公证。
4. 如果要从屏幕截图识别文字，请在 macOS 提示时允许“屏幕录制”。粘贴文字和读取已复制文字不需要这项权限。

不知道自己的 Mac 属于哪一种？打开 ** → 关于本机**。Apple M 系列芯片选择 `arm64`，Intel 处理器选择 `x64`。

## 隐私边界，事先讲清楚

- 截图文字识别使用 Apple Vision，在你的 Mac 本地完成。
- Slipstream 不建立原文历史，也不收集遥测数据。
- 完整分析会在提交前显示处理位置；选择本机 Ollama 时，原文可以留在这台 Mac。
- 查询官方资料前会先询问，只发送尽量精简的查询或候选页面；找到网页本身不会被包装成“已经证实”。
- 剪贴板自动监测默认关闭。开启前必须针对当前处理位置单独确认；开启后，主界面和 macOS 菜单会持续显示内容去向，并提供直接关闭入口。

查看完整的[隐私与数据流说明](./docs/PRIVACY.md)。

## 当前边界

- V1 正式支持 macOS 上的英文转中文。
- Slipstream 帮你理解和准备，不会替你发送邮件、上传材料、提交表格或完成现实任务。
- AI 分析可能出错。遇到重要事项时，请对照高亮原文，并以相关官方服务的信息为准。
- 基础翻译不包含行动提取、术语解释、流程背景和原文依据映射。

## 开源、免费

Slipstream 是一个非商业作品集项目，采用 [MIT License](./LICENSE) 开源。它面向在英语环境中生活、学习、工作，或需要与英语体系打交道的非英语母语者。

遇到问题或有建议？欢迎[提交 Issue](https://github.com/0boluan0/Slipstream/issues)。
