# Mac / Windows 同步发行

Mac 与 Windows 共用一个版本号、一个构建源码提交和一个发行页。自 `1.3.0` 起，同版本发行提供正式 Mac arm64 / x64 DMG，以及 Windows x64 NSIS 预览安装包。Mac 正式版使用正式应用身份、资料目录和更新渠道；Windows 仍使用独立预览身份和资料目录。

Mac 正式发行要求 Developer ID 签名，应用与 DMG 通过 Apple 公证并附加票据；Windows 安装包未签名。Windows 预览不开启自动更新。此前的 Mac 阅读预览与正式版身份和配置目录不同，安装正式版后应在设置中核对并启用所需服务；原预览配置与已保存的文稿不会因安装正式版而删除。

## 正式 Mac 与 Windows 预览同步发行

1. 从干净且可审查的提交冻结应用源码和版本，运行相关检查。
2. Mac 使用 `npm run release:signed` 构建 arm64 与 x64 安装包、ZIP 更新包和更新元数据。该流程包含签名、公证、附加票据及分发检查。Windows 使用同一提交运行 `npm run build:windows`，工作流只上传构建产物，不单独发布版本。
3. 从最终包内元数据核对版本和 `slipstreamSourceRevision`。三份安装包必须来自同一完整源码提交；根据最终文件生成构建清单、`release.json` 和 `SHA256SUMS.txt`，记录平台、架构、文件大小与 SHA-256。公证后的字节才是发布与计算哈希的依据。
4. 在同一个发行页上传三份安装包、Mac ZIP 与更新元数据、构建清单和校验文件。核对 GitHub 公开资产摘要，并下载公开清单确认与本地一致，再确认下载文档与发行状态。

正式 Mac 发行使用完整的签名发行检查。下面的 `release:pair` 工具只针对两份独立预览安装包，不能用来验证含三个安装包的正式发行集合。工程产物检查证明版本、来源与分发状态一致；实际操作和内容质量另行判断。

## 两份独立阅读预览的构建与配对

需要单独发布 Mac 阅读预览时，Mac 为 Apple 芯片 DMG，Windows 为 x64 NSIS 安装包，两端均使用独立预览身份。Mac 预览同样必须完成签名、公证及分发检查，正式 Mac 更新渠道独立于该预览。

1. 从干净且可审查的提交冻结应用源码和版本，运行相关检查。
2. Mac 运行 `npm run build:reading-preview -- --dmg`，Windows 运行 `npm run build:windows`。
3. 将两份安装包及各自 `.manifest.json` 放入同一目录，运行 `npm run release:pair -- /absolute/path/to/directory`。
4. 对 Mac DMG 运行 `npm run release:notarize-preview -- --input /absolute/path/original.dmg --output /absolute/path/notarized.dmg`，只使用公证成功后的输出。具体凭据与失败处理见[签名说明](./code-signing.md#notarize-a-reading-preview-installer)。
5. 公证会改变安装包字节。用最终文件重新生成 Mac manifest、`release.json` 与 `SHA256SUMS.txt`；保留原版本号和包内源码提交。
6. 上传前运行 `npm run check:preview-distribution -- /absolute/path/notarized.dmg`，并检查两端版本、包内 `slipstreamSourceRevision`、文件大小与 SHA-256。全部通过后再建立或更新同版本发行页。

## 对外材料

发行说明介绍功能、安装步骤、各平台签名状态和使用限制。下载后、安装前可核对安装包的 SHA-256。公开资料不包含本地配置、个人卡片、测试会话或凭据。
