# 单元测试

`npm run test:unit` 用 Node 自带的 [`node:test`](https://nodejs.org/api/test.html) 运行本目录下的 `*.test.mjs`，不需要额外依赖，也不启动 Electron。它是 `npm test` 的第一步，几秒内就能给出结果。

## 写什么样的测试

- **测行为，不测写法。** 调用函数或模块，断言它的输入输出、状态变化或发出的请求。不要读取产品源码文本再用正则匹配某一行代码：那样的测试改个变量名就失败，行为坏了反而照样通过。
- **把逻辑放进可测的模块。** React 组件和 `main.js` 里的判断、状态转换和请求组装，先抽成不依赖 React 和 Electron 的函数（参考 `src/renderer/utils/*.mjs`），再在这里测试。
- **组件看渲染结果。** `test/helpers/render-component.mjs` 用 Vite 自带的 rolldown 编译组件，再用 `react-dom/server` 渲染成 HTML；断言角色、文案、禁用状态和顺序（示例见 `foreground-status-center.test.mjs`）。
- **一项测试说明一个行为。** 用 `test('读者取消后，迟到的回复不会覆盖新结果', ...)` 这样的句子命名。
- **只用自拟材料。** 不放真实邮件、截图、凭据或个人信息；评测样例放在 `../eval/`，不要复制进测试或提示词。

## 源码文本断言的预算

`scripts/` 里的旧检查还有一批“读取源码再匹配正则”的断言（v1.4.0 时共 1,629 条）。`npm run check:source-assertion-budget` 统计每个脚本的数量，任何脚本只要比 `scripts/source-assertion-budget.json` 记录的多，检查就失败。

用行为测试替换掉一部分后，运行：

```bash
node scripts/check-source-assertion-budget.mjs --update
```

记录的预算只会降低，不会升高。少数确实需要读源码的静态约束（例如 CSP 字符串、禁止的导入）可以保留，但不能新增。

## 其他检查

真实窗口、截图和打包流程仍由 `scripts/check-*` 覆盖（多数需要 Electron）。`npm test` 跑当前阅读产品的全部检查；冻结的行动工作区兼容检查在 `npm run test:legacy`，发布前的 `check:release` 和 CI 两者都跑。
