# dsh-compat：DeepSeek Harness 插件移植层

把 DeepSeek Harness（Cordis）插件的"时空可组合性"能力带到 Operit2。

这是部分 Cordis 兼容运行时和 ToolPkg 移植工具，不是完整的 DeepSeek Harness
宿主。Node 测试通过不等于 Android QuickJS 真机兼容通过；安装、工具调用、
禁用和热重载仍需要在 Android 上验证。

## 组成

| 文件 | 作用 |
| --- | --- |
| `cordis-core.mjs` | Cordis 兼容内核：Context 服务容器、`inject` 依赖激活、可逆 effect（逆序回卷）、Fiber 状态机、5 种事件分发（emit/parallel/serial/bail/waterfall）、isolate 子上下文 |
| `dsh-shim.mjs` | 把 dsh 服务映射到 Operit2：`tools`（运行时工具注册）、`fs`、`http`、`config`、`logger`、`storage`；启动时登记 `ToolPkg.onUnload`，卸载时自动 `dispose()` 全部插件树 |
| `port-dsh-plugin.mjs` | 移植工具：esbuild 打包 dsh 插件 → Node 内捕获工具清单 → 生成 ToolPkg（manifest + main + METADATA/包装器）→ 可选打成 `.toolpkg` |
| `tests/` | 21 项 Node 测试，覆盖生命周期、依赖激活、隔离、工具注册、ZIP 打包与移植工具集成 |

## 使用

```sh
cd tools/dsh-compat
npm ci
npm test
node port-dsh-plugin.mjs /path/to/dsh-plugin --out /path/to/empty-output
```

输出目录必须为空。移植工具会在 Node 中执行插件以捕获工具声明，
因此只应处理可信来源的插件；捕获过程限时 15 秒。
生成的 `.toolpkg` 可供导入 Operit2，但 Android 执行结果尚未实机验证。生成的包会声明
`strict_dependencies: true`，因此依赖的提供者被禁用时，这个插件会被 Operit2 的
响应式依赖机制自动挂起，提供者恢复后自动重新激活。

## 兼容范围（v1）

可移植（由移植工具自动完成）：

- 在 `apply(ctx)` 里通过 `ctx.tools.register` 注册工具的插件；
- 使用 `ctx.fs` / `ctx.http` / `ctx.config` / `ctx.logger` / `ctx.storage` 的插件；
- 纯 JS/TS 依赖（esbuild 能打进单文件的）；
- 依赖关系用 `inject` 声明的插件（由内置内核执行激活/停用）。

不可移植（移植工具会给出明确报错或零工具警告）：

- 依赖 Node 原生模块（node-pty、better-sqlite3、sharp 等）；
- 依赖 dsh 专有服务 `ctx.llm`、`ctx.sessions`、`ctx.agentLoop`、`ctx.sandbox`、`ctx.approval`、`ctx.mcp`；
- 使用同步文件系统 API（Operit2 的 Files API 是异步的）；
- 只提供 UI 美化/视图插件的 dsh 包（Operit2 的 UI 由 Compose DSL 渲染，语义不同）。

完整 Cordis API、配置热更新协调、会话作用域、同名服务替换响应和挂载后
动态工具发现尚未实现。必需的宿主服务缺少适配时，打包会明确失败，
而不是输出一个安装后静默失效的包。

## 与 Operit2 原生插件的关系

- 原生 ToolPkg 插件完全不受影响：新机制是"可选加入"（`strict_dependencies`）加"零行为变化"（无该字段时保持原有依赖提示行为）。
- 所有插件（原生与移植）都能使用新增加的 `ToolPkg.onUnload(fn)` / `ToolPkg.effect(fn)`：
  禁用、删除、热重载时，宿主会在销毁 JS 引擎之前按逆注册顺序执行这些清理回调（5 秒超时）。
- 插件禁用后，它注册过的 `包名:工具名` 会从 AI 工具表中被真正摘除，而不是仅靠调用期拦截。
