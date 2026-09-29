# 本地公式识别

从 v1.2.0 起，macOS 安装包自带专用公式识别组件。框选论文或教材后，公式从截图像素恢复为 LaTeX，与正文按位置合并，先显示排版后的原文供核对。需要修改时展开编辑框；确认后才继续翻译。

识别在本机 CPU 完成，不需要 API Key、Python 或通用大模型，不上传截图。用户明确选择云端重新识别时，界面单独说明图片去向。识别不是数学验证，原图始终可查看。

## 实现与复现

```sh
cd slipstream
npm ci
npm run setup:formula-models
npm run check:formula-ocr
npm test
npm run build:reading-preview
```

模型不进入 Git；正式与预览构建均包含模型。构建检查核对原生库的架构，发布检查再次核对两个架构的模型与许可证。
