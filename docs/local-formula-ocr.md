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
