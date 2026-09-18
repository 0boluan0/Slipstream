# Windows 文字阅读预览

目标平台：Windows 11 x64。此预览先验证粘贴／剪贴板文字 → 独立阅读卡片 → 概念查询 → 本地保存与重开。

截图与本机 OCR 尚未接入 Windows。首页不显示截图主入口；快捷键或其他截图入口返回说明，不运行 macOS 命令。开机启动和自动更新尚未开放。模型 API 密钥由 Electron safeStorage 保存，实际 Windows 加密与重启读取需要真机验收。

## 在 Windows 上运行

使用 Node.js 22.12 或更高版本和 Git，在独立工作目录检出包含本次 Windows 改动的代码，然后在 PowerShell 执行：

```powershell
cd slipstream
npm ci
npm run check:windows
npm run build:renderer
npm run check:windows-ui
npm run build:windows
```

界面测试使用固定模型回复和临时数据目录，不调用付费模型、不读真实剪贴板。它验证文字交接、概念查询、显式保存、卡片盒重开与缩放。它不证明真实服务质量或安装包能够启动。

安装包输出：`slipstream/release/windows-preview/Slipstream-Windows-Preview-1.1.0-x64-Setup.exe`。这是未签名的内部预览，不对外发布。安装器按当前用户安装。

预览使用独立应用身份 `com.slipstream.windows-preview`，配置与会话位于 `%APPDATA%\Slipstream Windows Preview`。卸载不删除配置或用户主动保存的概念卡片。自动更新关闭。

也可在 macOS 使用 `npm run build:windows` 交叉生成安装包；实际启动与系统集成仍须在 Windows 验证。

## 真机验收

- 安装生成的安装包，确认首页显示 Windows 预览限制、文字入口可用。
- 从浏览器和 PDF 复制英文，使用 Alt+C 打开阅读；确认没有修改剪贴板原文。
- 在明确选择的服务下提交自拟文字，核对译文、术语解释、保存与重开。
- 重启应用，确认设置与 API Key 可用；不要把密钥放进日志或测试报告。
- 检查托盘、快捷键冲突、关闭应用、中文路径和 100%／150%／200% 缩放。
- 卸载、重装，核对主动保存的概念卡片仍在。

`.github/workflows/windows-preview.yml` 在 Windows runner 上执行界面测试并生成安装包供下载。CI 工作流尚需推送并实际运行；安装包仍需交互验收。

## 当前证据（2026-09-10）

Windows 11 x64（10.0.26200.9445），Node 24.17.0、Electron 43.1.0：

- 依赖安装、预览配置／构建身份检查、lint、renderer 构建通过。
- `npm run check:windows-ui` 退出码 0：文字交接、概念查询、保存重开、首次设置及 200% 缩放断言通过。
- 测试目录由外层 Node 进程在 Electron 完全退出后清理，解决 Windows 文件占用导致的退出失败。
- Windows 本机构建、当前用户范围的 NSIS 安装、安装后程序启动与正常关闭均通过。安装后页面从 `resources/app.asar` 加载，截图确认 Windows 入口文案正确。
- 可选的 `--output` 截图助手在该会话发生 `UnknownVizError`，未记为成功；CI 的功能检查不启用这个可选输出。安装版的独立 CDP 截图已成功。
- Mac 侧的核心逻辑、首次设置、快捷键、IPC 边界、包配置、lint、构建和原生阅读流程回归通过。

Windows 本机构建的已安装预览：111764675 字节，未签名。SHA-256：`8102cfab19e706f7e5c2aad9372e413392f2f4378be6deeb6334ecd321768608`。

程序位于 `%LOCALAPPDATA%\Programs\Slipstream Windows Preview\Slipstream Windows Preview.exe`；桌面保留安装包 `Slipstream-Windows-Preview-1.1.0-x64-Setup.exe`。

macOS 交叉构建另有一份同源码预览安装包，校验值见输出目录的 `SHA256SUMS`，不同构建产物的哈希不作相同承诺。

安装版的真实基础翻译已验证：自拟句子 `A triangle has three sides.` 得到 `三角形有三条边。`，阅读卡片进入完成状态；未使用 API Key 或付费模型。预览保留基础翻译模式。

退出复查确认：正常关闭测试阅读卡片后，应用主进程和子进程均退出，未使用强杀。早先 CDP 自动化没有处理仍存在的独立卡片，且等待关闭目标的 CDP 应答超时；该失败保留在测试记录中，未据此判定产品缺陷。不要把 `Browser.close` 的返回值代替进程退出检查。

API Key 持久化、卸载重装、150% 系统 DPI 和真实浏览器／PDF 剪贴板尚未验收。GitHub Windows 工作流已配置，尚未推送运行。
