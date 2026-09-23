# 切换论文时的本地定义范围：安装版原生复验

2026-09-23，签名本地预览版 `c3d29e2`（v1.2.1；未公证、未公开发布）。测试在 Preview 中使用 Option+Shift+S 和 macOS `/usr/sbin/screencapture -i` 的真实系统拖框。被测原版 PDF 是 [SimCLR](https://proceedings.mlr.press/v119/chen20j/chen20j.pdf)（SHA-256 `cc620e511bafe8b4b11ca3415f6d7bcf127a05818087bfa49905de3a2e50bc2d`）和 [Calibration](https://proceedings.mlr.press/v70/guo17a/guo17a.pdf)（SHA-256 `df7c93f97204f8a3c2b10f6d5bf5265baac25f00c1ae3b473a3e1dbc102dacb2`）。两篇此前都已用于 OCR 回归，本轮只验切篇与重启后的本文速查归属，**不计独立首读**。

修复前，SimCLR 的第一张真实截图继承 `QA-Calibration-Guo-2017`。现在截图前读取前台窗口来源，在本机为应用标识与窗口标题生成 SHA-256 键；新增的关联字段仅保存键，不保存原始窗口标题或 PDF 路径。从截图新建阅读时，窗口标题会作为可修改的默认阅读名称保存。没有匹配的来源先作为临时阅读；读者在卡片内选中或新建阅读后，把当前来源绑定到该阅读。来源识别不到时也先用临时阅读。粘贴文字仍可使用用户当前选定的阅读。

安装版依次完成五次系统快捷键加原生拖框：

1. Preview 的 `simclr-chen20j-pmlr.pdf` 第 2 页，`(865,140)→(1325,590)`：卡片显示“临时阅读”，明确提示新文档，没有出现上一篇 Calibration 的定义。读者用卡片菜单选中已有 `QA-SimCLR-Chen-2020`，显示其 3 条已存定义。
2. 同一 Preview PDF、同一选区复拍：新卡片**自动**显示 `QA-SimCLR-Chen-2020` 和 3 条定义，不需再次选择。
3. 切到 `calibration-guo17a-pmlr.pdf` 第 2 页，`(845,160)→(1295,820)`：新卡片显示“临时阅读”，未继承 SimCLR。该选区底部截断，卡片有提示；它只用于范围测试。读者选中已有 `QA-Calibration-Guo-2017`，其 3 条定义可见。
4. Calibration 同页缩短选区到 `(845,160)→(1295,650)`：新卡片自动显示 `QA-Calibration-Guo-2017` 和 3 条定义，不混入 SimCLR。
5. 完全退出并重开已安装预览版，再对 Calibration 同页使用 `(845,160)→(1295,650)`：仍自动显示 `QA-Calibration-Guo-2017` 和 3 条定义。本机 `references.json` 中两篇的来源键分别与各自 Preview 窗口名生成的键一致，且互不相同；两篇仍各有 3 条已存定义，没有改写定义内容。

本轮的第 3、5 张选区还提示正文可能被截断；第 5 张首行 OCR 有噪声。它们不能作为论文内容准确性的通过证据。窗口标题如果改变、两个不同文档同名，或系统不能提供窗口名，自动关联仍可能失效；卡片保留人工选择，未知来源默认临时阅读。识别准确率和独立首次使用通过数没有因这项范围修复而提高。

验证：在保留私有像素样例的本机完整运行 `npm test`、`npm run check:formula-ocr`（19 项图像用例）、`npm audit --audit-level=high`、`npm run check:package-config`、`npm run lint` 和 Swift 类型检查，均通过。`npm test` 包含新增原生 Electron 切篇、同篇复用、未知来源及旧卡片隔离检查。已安装签名版与源码逐项匹配 116 个运行文件，随包 OCR 通过既有边缘修复测试。公开仓库保留可复现的代码与自拟材料测试；来自第三方论文的像素图和原始窗口记录留在本机验收目录。
