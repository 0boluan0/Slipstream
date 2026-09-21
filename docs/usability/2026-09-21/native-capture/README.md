# 正式版原生截图验收 · 2026-09-21

**快捷键 → 系统拖框 → 本地 OCR 核对 → 真实翻译 → 阅读贴窗的完整流程已跑通。识别质量有未解决的问题，不能把这次流程通过解释为公式全部识别正确。**

在 Apple M4 Max、macOS 26.6.1 上测试已发布的 `/Applications/Slipstream.app` 1.2.0。应用签名校验通过，ASAR 与已验证的正式安装包一致。本轮没有修改应用代码或系统权限。结果和文件校验值见 [results.json](results.json)。AX 文本证据仅去除行尾空白。

## 操作与结果

使用明确授权的 CGEvent 输入发送 Option+Shift+S 和真实鼠标拖动，由已安装应用启动 `/usr/sbin/screencapture`。桌面辅助工具读取实际核对窗口和结果；未替换截图、OCR 或服务响应。翻译使用应用中已配置的 DeepSeek，截图的云端重新识别按钮没有被点击。本轮未抓包，不增加有关实测网络隔离的结论。

| 材料 | 实际输入和核对 | 翻译结果 |
| --- | --- | --- |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 第 4 页 | 在预览中显示此前从 PDF 渲染的公式片段，再从屏幕拖框；本地识别 2 处公式，均提示需留意。查看本次截图、展开编辑器确认 LaTeX，未修改识别文字。 | 中文正文、转置、分式、根号下标正确显示，3 段完成。 |
| [Adam](https://arxiv.org/abs/1412.6980) 第 2 页 | 在预览中直接打开 PDF，框选 Algorithm 1 主体；识别 17 处公式，其中 7 处提示需留意。帽子、β 上下标和根号保留，但存在下列错误。 | 按原图在编辑器校正后，真实中文译文保留修改和公式，1 段完成。 |

Attention 证据：[原始论文窗口](attention-preview-source.jpg)、[本次屏幕截图](attention-captured-region.jpg)、[本地核对](attention-review.jpg)、[LaTeX](attention-source-latex.ax.txt)、[中文译文](attention-translation.jpg)、[结果结构](attention-translation.ax.txt)。

Adam 证据：[实际 PDF 窗口](adam-preview-source.jpg)、[核对页面](adam-review.jpg)、[未修改 OCR](adam-raw.txt)、[校正后原文](adam-corrected.txt)、[中文译文](adam-translation.jpg)、[结果结构](adam-translation.ax.txt)。

贴窗可以拖动、[收起](attention-collapsed.jpg)、展开并保留译文，也能关闭。再次触发系统框选后发送 Escape，选择器退出，没有新建卡片或权限警告。测试结束时原有阅读卡片仍在，位置、尺寸保持不变；两张测试卡片已关闭，没有点击保存术语或本文定义。

## 仍需处理的识别和界面问题

- Adam 的独立小字 α 被普通 OCR 读为 `a`，正文中的 θ 被读为 `0`。
- 第二个偏差校正公式出现原图没有的 `\dot{…}`，给分母加了点号；两处公式后的冒号重复。
- 本轮在核对编辑器中手动修正上述内容，**识别器本身未修复**。原始和校正文本分别保存，没有覆盖失败证据。
- `1st`、`2nd` 被当作数学片段，译文中仍出现英文序数后缀。
- 截图页的“校正识别文字”按钮在等待核对时禁用；切回“核对”页仍可展开编辑器。该入口状态值得修正。

## 自动化经验与复现

最初仅向指定应用发送桌面工具事件，未可靠触发全局快捷键；第一次系统级拖动又选到了实际前台的另一个窗口。该次失败不计入验收，生成的卡片已关闭，未保存其画面。仅查看预览窗口的独立截图不足以证明它位于桌面最前方。

[输入驱动](native-input.swift)使用系统打开操作把已有的预览窗口带到前台，验证前台应用，再发送全局快捷键；等到原生选择器进程出现才拖动。固定等待 800 毫秒曾过早检查，因此驱动改为最多 8 秒等待真实进程。Attention 通过先触发、确认进程后再拖动完成；Adam 和 Escape 使用连续驱动命令完成。

```sh
xcrun swiftc docs/usability/2026-09-21/native-capture/native-input.swift -o /tmp/slipstream-native-input
/tmp/slipstream-native-input capture-region 434 437 1127 764
# 默认只打印计划；实际输入必须显式加 --execute。
/tmp/slipstream-native-input --execute capture-region 434 437 1127 764
/tmp/slipstream-native-input --execute capture-cancel
```

这是本次诊断输入脚本，不是无人值守 CI 测试。重放前应打开对应论文、确认当前屏幕坐标及预览窗口内容，并避免同时操作鼠标；示例坐标只适用于本轮布局。驱动本身不会断言 OCR 正确，必须检查真实核对文字、译文和截图。不得把返回码为零当作验收通过。

本次关闭了正式版在当前机器上的原生截图流程验证缺口。它不覆盖 Intel 实机、最低系统版本、首次安装权限、所有显示器布局、更新下载安装或普遍公式准确率，也不是速度基准。
