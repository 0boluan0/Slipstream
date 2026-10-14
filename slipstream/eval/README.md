# 阅读质量评测集

产品代码只放通用规则；具体论文、术语和失败样例放在这里，用来**衡量**质量，而不是写进提示词或校验器里“修好”某一条。

## 两类材料

| | 开发集 `dev/` | 封存集（held-out） |
| --- | --- | --- |
| 位置 | 仓库内，随代码公开 | 仓库外，加密保存（本机位置见私有 QA 目录的 `heldout-sealed-*/README.md`） |
| 谁能看 | 所有开发者和 AI 代理 | 只有验收时的评分人；修 bug 的人不看 |
| 用途 | 复现问题、比较方案、回归 | 判断一个版本是否真的变好 |
| 能否改提示词去“对上” | 不能把样例原文、答案或评分要点写进产品代码 | 绝对不能；用过的材料下一轮要补新的 |

`test/eval-contamination.test.mjs` 会在 `npm test` 里检查：产品源码中不能出现开发集任何一条原文或评分要点里连续 7 个词的片段。这只能拦住逐字复制，概念上的“对题作答”仍要靠评审时自觉。

## 文件格式

每个开发集文件是一个套件（`suite`）：

- `lookups.json`：选中一个词句看解释。`criteria` 写给评分人，**不会**发给模型。
- `terms.json`：推荐的概念按钮。`required` / `excluded` / `empty` 自动评分。
- `references.json`：本文符号定义。`expected` 自动评分。
- `translations.json`：译文保真。`mustMatch` / `mustNotMatch` 只是自动提示，最终仍看 `criteria`。

封存集是 `slipstream-eval-bundle/1` 格式，可以把多个套件放在一起，另有 `image` 套件：把自拟的文字和公式渲染成截图，再走截图阅读路径（`sourceMustMatch` 检查转写，`mustMatch` 检查译文）。

## 运行

真实评测会调用你配置的模型服务并产生费用。它在已签名的“Slipstream 阅读预览”里运行，使用该应用自己的钥匙串凭据，凭据不会离开那个进程：

```bash
cd slipstream
npm run eval -- --app="/绝对路径/Slipstream 阅读预览.app" --cases=eval/dev/lookups.json
npm run eval -- --app=... --cases=eval/dev/terms.json --repetitions=3
npm run eval -- --app=... --cases=eval/dev/lookups.json --case=root-n
```

结果写在 `--output` 目录（默认临时目录）：`eval-summary.json` 是数量、自动检查通过数和等待时间；`eval-report.json` 是逐条输出。运行封存集时加 `--key-file=…`，逐条结果会以同一把密钥加密成 `eval-report.sealed.json`，只有汇总是明文。

自动检查只覆盖能机械判断的部分。`needs-review` 的条目要由人对照 `criteria` 评分，程序通过不等于语义正确。

封存新材料：

```bash
node scripts/eval-seal.js new-key ~/Library/Developer/Slipstream/heldout-keys/<名字>.key
node scripts/eval-seal.js seal <bundle.json> <输出.sealed.json> --key-file=<密钥>
node scripts/eval-seal.js verify <输出.sealed.json> --key-file=<密钥>   # 只显示数量
```

封装后删除明文。材料请自拟或使用许可明确的内容，不放个人信息。

## 2026-10-13 从产品代码移出的规则

这些规则都是在某一个样例失败后加进产品代码的，只对那一篇材料或那一个词生效。它们现在作为评测样例保留，产品里只留下通用原则（`reading-service.js` 中的 `DEFINITION_RULES`、`TRANSLATION_QUALIFICATION_RULES` 等）。

| 移出的规则 | 现在的评测样例 |
| --- | --- |
| 解释校验：数据声明“a form that … can take”不能说成表格 | `lookups.json#introduced-practice` |
| 解释校验与提示：root-N 不能推出非退化极限；nuisance parameter 必须译为“干扰参数” | `lookups.json#root-n` |
| 解释校验（约 35 条中文句式规则）：条件期望不能断言随 X 变化 | `lookups.json#conditional-expectation` |
| 解释校验：充分条件不能推出“不是必要条件” | `lookups.json#sufficient-condition` |
| 解释校验：“Direct stakeholders include …” 中的角色不能与利益相关者并列 | `lookups.json#speaker-direct-stakeholder` |
| 解释校验：未写明时不能说“未经授权” | `lookups.json#undeclared-consumers` |
| 提示：HBM 只能与原文的 SRAM 比较；固定数据下的归一化常数；密度值不是概率 | `lookups.json#memory-tier-comparison`、`#evidence-density`、`#density-above-one` |
| 译文校验与重试：orthonormal 必须译为“标准正交” | `translations.json#orthonormal-basis` |
| 译文提示：curator 不能译为“策展人” | `translations.json#dataset-curator-role` |
| 译文提示：“as during training” 的比较对象 | `translations.json#same-as-during-training` |
| 译文旁提示：访谈样本中的“92% prevalence”需交代统计对象 | `translations.json#study-percentage-scope` |
| 术语过滤：“X,Y space” 不作为概念按钮 | `terms.json#coordinate-space-label` |
| 符号提示中的原文示例：CLIP 批大小、BatchNorm 算法、ResNet 残差函数 | `references.json#collection-cardinality`、`#labeled-algorithm-assignment`、`#defined-function-atom` |
| 术语提示中的示例：sample / sample space、field 的两种词义 | 已换成不在评测集里的自拟示例；对应样例为 `terms.json#sample-roles`、`#field-algebra`、`#field-everyday` |

移出后，这些样例在真实服务上的表现可能变差，这才是当前提示词的真实水平。如果某个问题在**多个来源**上反复出现，再考虑加一条通用规则，并用封存集确认它没有只对某一篇有效。
