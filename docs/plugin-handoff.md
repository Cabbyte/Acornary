# Acornary MCP 插件 UI 本地交接

工作树：`/Users/timli/.codex/worktrees/acornary-soft-gray-webui/Acornary`，分支 `codex/soft-gray-webui`，基线 `e2fb840`。本轮仅本地实现与隔离测试；没有推送、部署、合并、生产 OAuth 修改或真实 ChatGPT 连接变更。

## 实现

- `apps/web/src/workspace.tsx` 是无挂载副作用的共享页面入口。Web 继续原有 Cookie 会话、HTTP transport 和 Service Worker；`plugin.tsx` 使用 memory history，同一份页面、表单和 Soft Gray CSS，不注册 Service Worker。
- `lib/runtime.ts` 在每个独立 iframe 启动前注入 MCP transport、组件私有状态存储与选中项同步。服务端将运行模式、账号、actor、家庭、授权版本、OAuth client 和 scopes 计算为不透明隔离键；浏览器存储或宿主参数均不能选择后端身份。
- `apps/server/src/plugin.ts` 注册版本化、自包含 HTML resource，`open_inventory` 支持 global/thread 入口，明确 fullscreen 模式。`get_inventory_view` 仅 app 可见。模型只收到家庭名和数量摘要；完整库存及会话在 `_meta['acornary/view']` 中。UI 写入使用仅 app 可见的 `apply_inventory_command`，服务端先核对 write scope 和 `expected_scope`，再进入既有领域命令、revision 和幂等管线；模型原有领域工具不变。新工具声明准确的输入和输出 schema。
- 详情页的对象类型、ID、revision、名称及位置通过 `ui/update-model-context` 发送。离开详情、对象失效、读取失效或授权失效时清空。选择仅提供上下文，不自动授权或发送写操作。同步器区分期望值与已确认值，只发送最新排队值；失败按有限间隔持续重试，即使授权失效后的库存轮询已停止也能重试清空。
- 只使用初始 opener 结果首屏；没有收到初始结果时才读取 app-only 投影。后续通知只使权威查询失效，不直接覆盖快照；可见时每 5 秒及焦点恢复时只读刷新，覆盖通知缺失。快照通知不触发自身刷新循环，同一查询在进行时合并刷新。
- `plugin/store.ts` 在当前组件的 `window.openai.widgetState.privateContent` 中保存草稿、精确原请求、原幂等键与已提交结果。按顺序写入并验证读回；宿主不支持或未确认保存时，表单不发写请求。读取缓存仅内存保存。恢复不自动重放写入；用户手动重试原请求或只刷新已提交结果。
- 私有草稿格式损坏时停止恢复；切换服务端账号/家庭清除旧查询与选择并切换存储作用域。写入前前端核对表单会话，服务端在执行和幂等重放前再次比较请求预期的完整身份，拒绝宿主更换凭据后到达的旧表单。预期身份只用于拒绝不一致，不能赋予权限或选择家庭。
- 每次调用捕获会话代次，响应和错误副作用只能作用于原代次；即使 A→B→A，也丢弃旧代次结果。历史查询贯通 AbortSignal，清理旧 QueryClient 时同时取消传输。业务拒绝与 Web 共享错误状态映射，明确拒绝可修改重提；网络或未知错误继续保留原请求。
- 插件资源 CSP 没有额外连接或资源域，HTML 内联 JS/CSS/图片。普通网站的同源写入、Cookie、CSP 和 `X-Frame-Options` 未放宽。

## 本地验收流程

运行时 Node 24，MCP client/server/core 2.0.0，ext-apps 2.0.3；未引入 MCP SDK v1 或 `@openai/mcp-extensions@0.1.0`。

```sh
docker build --target browser-test -t acornary-plugin-ci .
ACORNARY_CI_IMAGE=acornary-plugin-ci node scripts/ci.mjs
```

CI 创建独立网络、临时 PostgreSQL 与测试数据库，先 typecheck/build，再单元及真实后端测试、完整浏览器回归，最后清理临时资源。`tests/plugin-browser-server.ts` 只用于隔离验收，实际 MCP 凭据留在宿主服务器，浏览器 iframe 不接触凭据。`tests/fixtures/plugin-host.*` 实现可控协议宿主；iframe 为 `sandbox="allow-scripts"` 的不透明来源。

修复前的单次完整运行（2026-10-01；不代替下文审阅后验收）：

- Node 24：`pnpm typecheck`、`pnpm build` 通过；`pnpm test` 为 **9 个文件、56/56 项通过**。
- Chromium：**31/31 项通过**，其中 **11 项插件沙箱测试 + 原有 20 项 Web/账号/OAuth/检查器测试**。没有把分轮结果相加充当单次通过。
- 完整命令：`ACORNARY_CI_IMAGE=acornary-plugin-ci ACORNARY_CI_OUTPUT=output/ci/plugin-final node scripts/ci.mjs`。
- 完整日志：`output/ci/plugin-final.log`；最终专属证据目录：`output/ci/plugin-final/playwright/`。`.last-run.json` 位于其 `results/` 下，状态为 passed。
- 测试镜像：`sha256:d9ae731b3b1f1a7542713368adb6dc15db812868da94cd11155546fc65fa221d`。
- 本地工作树也已重新构建，产物 `apps/web/dist/plugin/index.html`；日志 `output/ci/plugin-local-build.log`。
- 关键截图：`plugin-selected-1440.png`、`plugin-selected-390.png`、`plugin-recovered-write.png`、`plugin-storage-unavailable.png`、`plugin-revision-conflict.png`。同一目录保留最终 WebUI 各屏宽及表单截图。

首轮浏览器 22/28，定向恢复轮 10/12；最终完整轮 31/31。实际修复包括：严格沙箱禁用原生表单提交时走同一业务提交函数；组合输入的 Enter 不提交；上下文清空发送失败继续重试最新值。账号测试改为等待密码保存响应后判断状态。模拟故障只匹配返回 operation_id 的业务写入；幂等比较保留完整业务 arguments，排除正常变化的 SDK progressToken。早期日志保留在 `output/ci/plugin-first-pass.log` 与 `output/ci/plugin-recovery-pass.log`，不作为最终通过证据。

## 审阅后修复与最终验收（2026-10-01）

Max 审阅的三个实际复现见 `output/ci/plugin-review/review.md`。本轮均已修复并补充回归：

1. **家庭/身份切换误写**：UI 使用 `apply_inventory_command`，携带服务端给出的 `expected_scope`。服务端只从当前认证上下文计算完整身份摘要，在调用领域执行器前比较；不一致返回 `SESSION_CHANGED`。检查位于幂等查找之前。真实 MCP 集成测试覆盖账号、actor、家庭、授权版本、OAuth client、scopes 和运行模式的差异，分别验证新命令与已提交命令的重放；检查最终对象和事件只存在一次。真实 OAuth 测试另验证只读 scope 拒绝，以及跨家庭授权不能执行或重放旧 UI 命令。
2. **明确业务拒绝锁死输入**：插件与 Web 共享 `packages/contracts/src/errors.ts` 中已知领域错误的状态分类；未知错误仍保留原幂等请求。浏览器用真实条码冲突验证未发生写入，重新挂载后字段可修改，纠正条码后以新键成功提交，且只有一次实际属性绑定事件。原有丢响应、结果保存失败和刷新失败的精确重试用例继续通过。
3. **旧授权错误影响新会话**：所有调用的成功结果与错误副作用先核对发起时的会话代次；历史查询支持取消。浏览器挂起旧家庭 history，在新家庭显示后释放旧 UNAUTHORIZED，验证新界面及服务端读取继续可用；单元测试另覆盖没有取消信号时的晚到成功/授权错误，以及 A→B→A 场景。组件切换存储时比较当前 store.scope，避免依赖旧 React 闭包。

另补充启动回归：500ms 后已进入权威备用读取时，晚到的 opener 结果不再改变会话代次或中断启动。

最终单次完整运行：

- Node 24 的 `pnpm typecheck`、`pnpm build` 通过；`pnpm test` **9 个文件、59/59 项通过**。
- Chromium **35/35 项通过**，含 **15 项插件沙箱测试 + 原有 20 项 Web/账号/OAuth/检查器测试**。
- 命令：`ACORNARY_CI_IMAGE=acornary-plugin-fixes-ci ACORNARY_CI_OUTPUT=output/ci/plugin-fixes-verified node scripts/ci.mjs`。
- 日志：`output/ci/plugin-fixes-verified.log`；截图及运行状态：`output/ci/plugin-fixes-verified/playwright/`；结构化证据：`output/ci/plugin-fixes-verified/evidence.json`。
- 镜像：`sha256:d80d76631f1ad5046bbad52e0d8942dfb4737c6fe4f22601ece43e159bd444dc`。
- 本地工作树产物也已重新构建，日志 `output/ci/plugin-fixes-verified-local-build.log`。HTML 为 1,173,027 字节，SHA256 `f13a19b01dccb4d1d6c9a910287d347ed3a3c111c7d43c229f816f4a6f215389`，与最终验收容器一致。
- 新截图：`plugin-business-rejection-editable.png`、`plugin-cross-family-write-blocked.png`、`plugin-late-auth-new-session-active.png`、`plugin-late-opener-startup.png`；最终目录同时保留此前各插件/Web 场景截图。已目视核对业务拒绝后可编辑界面和晚到授权错误后的新家庭界面。
- 所有本轮临时 CI 容器、PostgreSQL 和网络均已清理。

本轮首个完整运行也通过 59/59、34/34，保存在 `output/ci/plugin-fixes-final.log` 和 `output/ci/plugin-fixes-final/`；随后补充启动边界修复并重新完成上面的 59/59、35/35。最终结果是单次运行，没有将分轮数字相加。

当前代码已通过 gpt-6-astra/max 最终只读复审：上一轮1项P1和2项P2均已关闭，未发现新的实质问题。复审报告见 [plugin-review-final/review.md](../output/ci/plugin-review-final/review.md)，已独立核对33个源码、测试及配置文件与最终验收镜像一致。代码仍为原工作树中的本地未提交改动；未推送、部署、合并或连接真实 ChatGPT。

## 尚未验证的边界

真实 ChatGPT 的授权、UI 放置、宿主状态持久化和对话广播没有连接验收；模拟宿主不是实际 ChatGPT 验收。私有 widget state 只用于当前组件恢复，不承诺跨新对话、跨设备或宿主数据清理后仍存在。若真实宿主不提供可确认的状态保存，UI 写入会停止，读取仍可使用。自然语言理解没有被模拟：测试使用选中项上下文生成真实 MCP 命令，验证的是上下文和领域写入链路。

库存投影仍是完整家庭快照，沿用 WebUI 的客户端分页；大库存服务端分页、真实移动设备、VoiceOver 等继续属于独立验收。
