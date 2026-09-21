# 本地公式识别

从 v1.2.0 起，macOS 安装包自带专用公式识别组件。框选论文或教材后，公式从截图像素恢复为 LaTeX，与正文按位置合并，先显示排版后的原文供核对。需要修改时展开编辑框；确认后才继续翻译。

识别在本机 CPU 完成，不需要 API Key、Python 或通用大模型，不上传截图。用户明确选择云端重新识别时，界面单独说明图片去向。识别不是数学验证，原图始终可查看。

## 实现与复现

- [PP-DocLayoutV3 ONNX](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx) 检测行内与独立公式，Apache 2.0；[Pix2Text MFR 1.5](https://huggingface.co/breezedeus/pix2text-mfr-1.5) 将公式图像转为 LaTeX，MIT。仅使用这两个专用组件。
- Apple Vision 负责正文。合并以原图文字位置为依据；公式遮罩后的 OCR 仅补充与公式共用边框的正文，避免重复行。公式边缘留白、窄截图比例、相邻标点分别处理。
- ONNX Runtime 1.18.0 同时附带 arm64、x64 原生库，二进制最低系统版本满足应用 macOS 12 的要求。采用 CPU 推理；不依赖用户另装的推理环境。
- 四个模型文件的固定下载地址与 SHA-256 在 `slipstream/src/main/local-formula-models.json`。开发下载、打包及运行时均校验；许可证随安装包放入 `Contents/Resources/licenses/`。
- 模型按需加载，截图串行处理，空闲两分钟释放；每次公式识别限时 25 秒，并响应取消。暂存图像放在私有 OCR 目录，完成后删除。组件失败不会静默标记为识别成功。

```sh
cd slipstream
npm ci
npm run setup:formula-models
npm run check:formula-ocr
npm test
npm run build:reading-preview
```

模型不进入 Git；正式与预览构建均包含模型。构建检查核对原生库的架构，发布检查再次核对两个架构的模型与许可证。

## 真实像素回归

测试直接读取图像，不把 PDF 文本或正确答案传给识别器。

| 材料 | 覆盖内容 |
| --- | --- |
| [Adam](https://arxiv.org/abs/1412.6980)，第 2 页 | 贴边 α、θ、帽子、β 上下标、带帽变量的根号、公式旁的解释文字 |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762)，第 4 页 | 转置、分式、根号下标；完整句子和句末标点的顺序 |
| [Double/Debiased Machine Learning](https://arxiv.org/abs/1608.00060)，第 2 页 | θ₀、η₀ 的位置和标点；新增两行条件期望公式裁剪 |
| Adam 的另一张窄裁剪 | 在不同截取范围下保留帽子和 β 幂次 |
| 自拟矩阵与均值 | 二维矩阵、分式、求和，KaTeX 可渲染 |
| 自拟纯文字 | 不凭空增加公式 |

原生测试还覆盖模型缺失、推理前及推理中取消、截图图像进入实际核对窗口、默认公式排版和按需编辑。测试阻断 HTTP/HTTPS 请求；确认前不得调用翻译服务。系统交互式框选在该测试中由真实论文图像替代。

[识别文本与耗时](usability/2026-09-18/formula-ocr/results.json)和[实际核对界面](usability/2026-09-18/formula-ocr/local-formula-review.png)记录本机测试。这是少量实例，不是普遍准确率或性能保证。

2026-09-21 在已发布的 1.2.0 上补完了[真实快捷键与系统拖框验收](usability/2026-09-21/native-capture/README.md)，继续经过本地核对、真实服务翻译和贴窗操作。Attention 无需修改；Adam 的帽子保留，但小字 α/θ、一个多余点号及重复冒号需要在核对中校正。该记录同时保留原始错误与校正结果，流程通过不代表识别器已经修复这些问题。

公式检测仍可能漏掉单独字母，未检出的字符沿用普通 OCR；例如 N、K、V 在部分句子中仍显示为普通文字。低清晰度、暗色底、复杂多栏、手写和很长的公式可能失败。检测和识别分数只能提示部分疑点，高分不保证正确，因此包含公式的结果仍需对照原图确认。

裁剪坐标使用 PDF 点数、页面从 1 开始：Adam 第 2 页 `(103,176,492,360)` 与 `(99,264,494,324)`；Attention 第 4 页 `(107,416,507,494)`；DML 第 2 页 `(103,184,491,365)` 与 `(103,407,511,438)`。均以 2 倍比例渲染，仅作为 OCR 回归材料。
