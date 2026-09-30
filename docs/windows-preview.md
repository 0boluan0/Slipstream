# Windows 阅读预览

目标平台：Windows 11 x64。`1.3.0-preview.1` 对齐 Mac 的局部随手查：框选不懂的词句、公式或小块图文 → 原文旁读中文 → 按需解释 → 关闭继续阅读。保存卡片和本文速查是可选动作。双端发行必须使用同一版本、同一完整源码提交，见[双端发行](paired-release.md)。

Windows 截图使用支持图片的 API，与翻译和解释共用一套配置。首次使用在设置中完成图片试读并明确启用；旧文字预览升级后，原有设置保留，截图会提示先启用图片服务。当前没有 Windows 本机 OCR，基础翻译仍可复制或粘贴文字。来源自动识别未接入的窗口作为临时阅读，避免混入上一篇定义。

拖框时整屏快照仅在本机内存显示；只将选区裁切结果交给已启用的服务。Esc 或右键取消；Alt+Shift+S 为默认截图快捷键。开机启动和自动更新尚未开放。Windows 安装包未签名，签名和正式语义验收不以构建成功代替。

## 构建与检查

使用 Node.js 22.12 或更高版本，检出明确的源码提交，在 PowerShell 执行：

```powershell
cd slipstream
npm ci
npm run check:windows
npm run check:reading-image
npm run check:paired-release
npm run lint
npm run build:renderer
npm run check:windows-ui
npm run build:windows
```

固定回复界面检查验证图片试读、文字交接、概念查询、显式保存、卡片重开与 200% 缩放，使用临时资料目录。真实桌面截图和安装版运行另行验收。可选 `--output` 图像助手曾出现 `UnknownVizError`，必需功能检查不依赖该助手。

产物位于 `slipstream/release/windows-preview/`，包含 `Slipstream-Windows-Preview-1.3.0-preview.1-x64-Setup.exe` 和对应 `.manifest.json`。清单记录包内版本、源码提交、文件大小和 SHA-256。CI 上传两者，不会单端自动发布。

预览使用现有独立身份 `com.slipstream.windows-preview`，配置和会话位于 `%APPDATA%\Slipstream Windows Preview`；按当前用户安装到 `%LOCALAPPDATA%\Programs\Slipstream Windows Preview`。升级前保留旧资料；卸载配置为不删除应用数据。API 凭据仅由主进程通过 Electron safeStorage 使用，禁止复制到报告或测试素材。
