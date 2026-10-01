# Windows 阅读预览

目标平台：Windows 11 x64。`1.3.0-preview.2` 对齐 Mac 的局部随手查：框选不懂的词句、公式或小块图文 → 原文旁读中文 → 按需解释 → 关闭继续阅读。保存卡片和本文速查是可选动作。双端发行必须使用同一版本、同一完整源码提交，见[双端发行](paired-release.md)。

## 下载与安装

**[下载 Windows 11 x64 安装包 · v1.3.0-preview.2](https://github.com/0boluan0/Slipstream/releases/download/v1.3.0-preview.2/Slipstream-Windows-Preview-1.3.0-preview.2-x64-Setup.exe)**（约 160 MB，未签名）。Mac 同版本安装包见[双端发行页](https://github.com/0boluan0/Slipstream/releases/tag/v1.3.0-preview.2)。

1. 下载后双击 `Slipstream-Windows-Preview-1.3.0-preview.2-x64-Setup.exe`。
2. 若出现“Windows 已保护你的电脑”，确认文件来自上方项目发行页后，可点“更多信息”→“仍要运行”。未签名包会显示“未知发布者”，按提示完成安装。
3. 从开始菜单打开 **Slipstream Windows Preview**。专业阅读需配置支持图片的 API，完成图片试读并启用；基础翻译可直接粘贴文字。

部分受管理电脑或启用 Smart App Control 的系统可能直接阻止未签名程序，且没有“仍要运行”选项；本预览无法保证在这类配置下安装。参见 [Microsoft 的 SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

<details>
<summary>可选：核对下载文件的 SHA-256</summary>

在安装包所在目录打开 PowerShell：

```powershell
Get-FileHash .\Slipstream-Windows-Preview-1.3.0-preview.2-x64-Setup.exe -Algorithm SHA256
```

预期结果（不区分大小写）：`6b793a1363ebebbd2bb739a5113ef5cd3ad0ad11a9ea79acc8bd47989632c44b`。同一发行页提供 `SHA256SUMS.txt` 和构建清单。

</details>

## 阅读与平台范围

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

检查使用自拟输入与临时资料目录；实际桌面操作和内容质量分别核对。

产物位于 `slipstream/release/windows-preview/`，包含 `Slipstream-Windows-Preview-1.3.0-preview.2-x64-Setup.exe` 和对应 `.manifest.json`。清单记录包内版本、源码提交、文件大小和 SHA-256。CI 上传两者，不会单端自动发布。

预览使用现有独立身份 `com.slipstream.windows-preview`，配置和会话位于 `%APPDATA%\Slipstream Windows Preview`；按当前用户安装到 `%LOCALAPPDATA%\Programs\Slipstream Windows Preview`。升级前保留旧资料；卸载配置为不删除应用数据。API 凭据仅由主进程通过 Electron safeStorage 使用，禁止复制到报告或测试素材。
