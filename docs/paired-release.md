# Mac / Windows 同步发行

阅读预览共用一个版本号、一个提交和一个发行页。Mac 为 Apple 芯片 DMG，Windows 为 x64 NSIS 安装包。两端均使用独立预览资料目录；Windows 安装包未签名，Mac 阅读预览有 Developer ID 签名但未公证，正式更新渠道不受影响。

`slipstreamSourceRevision` 写进两个包的 package metadata，避免只按文件名判断同步。`.github/workflows/windows-preview.yml` 持续验证 Windows 构建并上传安装包与清单；它不会单独发布版本。配对脚本仅验证工程产物一致性，不能代替真机或语义验收。
