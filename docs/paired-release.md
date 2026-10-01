# Mac / Windows 同步发行

阅读预览共用一个版本号、一个构建源码提交和一个发行页。Mac 为 Apple 芯片 DMG，Windows 为 x64 NSIS 安装包，均使用独立预览资料目录。

当前 Mac 预览使用 Developer ID 签名，应用与 DMG 均已通过 Apple 公证并附有票据；Windows 安装包未签名。正式 Mac 更新渠道独立于预览。

## 构建与配对

1. 从干净且可审查的提交冻结应用源码和版本，运行相关检查。
2. Mac 运行 `npm run build:reading-preview -- --dmg`，Windows 运行 `npm run build:windows`。
3. 将两份安装包及各自 `.manifest.json` 放入同一目录，运行 `npm run release:pair -- /absolute/path/to/directory`。
4. 对 Mac DMG 运行 `npm run release:notarize-preview -- --input /absolute/path/original.dmg --output /absolute/path/notarized.dmg`，只使用公证成功后的输出。具体凭据与失败处理见[签名说明](./code-signing.md#notarize-a-reading-preview-installer)。
5. 公证会改变安装包字节。用最终文件重新生成 Mac manifest、`release.json` 与 `SHA256SUMS.txt`；保留原版本号和包内源码提交。
6. 上传前运行 `npm run check:preview-distribution -- /absolute/path/notarized.dmg`，并检查两端版本、包内 `slipstreamSourceRevision`、文件大小与 SHA-256。全部通过后再建立或更新同版本发行页。

Windows 工作流只上传构建产物，不会单独发布版本。配对检查验证工程产物的一致性，实际操作与内容质量另行判断。

## 对外材料

发行附件包含两端安装包、构建清单、`release.json` 和 `SHA256SUMS.txt`。发行说明介绍功能、安装步骤、签名状态和使用限制。安装后核对下载文件的 SHA-256。
