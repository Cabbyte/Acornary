# MCP Apps 插件

插件与 Web 共用 `apps/web/src/workspace.tsx`、页面、表单及响应式工作台。相关源码已合入 `main` 并随 [v0.4.2](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2) 发布；当前生产版本见 `/health`，布局见 [工作台说明](./responsive-workbench.md)。2026-10-01 的逐轮本地测试保留在 [历史交接](./archive/plugin-handoff.md)。

## 入口与身份

- Web 入口使用 Cookie 会话、同源 HTTP transport 和 Service Worker；`apps/web/src/plugin.tsx` 使用 memory history、MCP Apps 宿主桥和同一份 Workspace，不注册 Service Worker。
- `apps/server/src/plugin.ts` 注册版本化、自包含 HTML resource 和 `open_inventory`。模型只收到家庭名、数量等摘要，完整快照及会话放在 `_meta['acornary/view']`；`get_inventory_view` 仅 app 可见。
- `apply_inventory_command` 仅 app 可见。服务端先校验 OAuth write scope 和 `expected_scope`，再执行原有领域命令、revision 与幂等逻辑；现有模型工具继续可用。
- 不透明身份作用域由服务端从运行模式、账号、actor、家庭、授权版本、OAuth client 和 scopes 计算。浏览器状态和工具参数不能选择后端身份。执行与幂等重放前均检查当前作用域。

## 入口名称与图标

`open_inventory` 同时提供全局侧边栏（global）和对话侧面板（thread）入口，两处标题均为 **Acornary**。工具标识符保持不变。

入口的顶层 `icons` 使用 D 精修版 20 × 20 松鼠线条 SVG，透明背景、1.35 px 圆角描边；浅色主题用 `#68615C`，深色主题用 `#A6A49E`。几何来自 Figma `133:388` / `133:393`，内嵌于服务端 `plugin-icons.ts` 并输出 Base64 Data URI，随编译产物发布，不依赖运行时设计素材目录或额外图片请求。插件管理页 Logo、网站 favicon 和 PWA 图标独立配置。

发布后，在 ChatGPT 当前自定义 MCP 插件连接中执行 **Refresh**，确认 `tools/list` 的标题与两套图标已更新，再重新打开入口。分别在浅色／深色主题检查名称、悬停提示、图标裁切及两个入口打开库存的行为。线上元数据核对与真实客户端视觉验收须分别记录；模拟宿主不证明真实客户端已刷新缓存。

## 上下文与恢复

详情或检查器选择把真实对象类型、ID、revision、名称和位置发送到 `ui/update-model-context`。离开、对象不可用或授权失效时清空；失败会重试最新状态。选择本身不授权写入。

首屏优先使用 opener 结果，缺失时通过 app-only 工具读取。后续通知使权威查询失效，可见时每 5 秒及焦点恢复时只读刷新。调用按会话代次隔离，迟到响应不能覆盖新会话，历史读取支持取消。

`plugin/store.ts` 使用当前组件的私有 widget state 保存草稿、准确请求、原幂等键及已提交结果。提交前验证持久化读回；宿主不支持或未确认保存时停止 UI 写入，读取仍可用。恢复不自动重放，用户只能手动重试原请求或刷新已提交结果。明确业务拒绝允许修正后以新键重提，未知结果保留原请求。

HTML 内联 JS、CSS 和图片，资源 CSP 不增加外部连接／资源域；普通网站的 Cookie、同源写入、CSP 和禁止任意嵌入策略保持独立。

## 验证

仓库的完整隔离 CI 同时覆盖 Web 和不透明来源插件沙箱：

```sh
docker build --target browser-test -t acornary-ci .
node scripts/ci.mjs
```

`tests/plugin-browser-server.ts` 及 `tests/fixtures/plugin-host.*` 只用于隔离测试。真实 MCP 凭据留在测试宿主服务器，iframe 不接触凭据。覆盖选中项、跨家庭写入拒绝、过期授权、迟到响应、同键重试、业务拒绝可编辑、持久化失败及刷新恢复。

模拟宿主结果与真实客户端验收分开记录。私有 widget state 不保证跨新对话、跨设备或宿主清理后继续存在；库存仍使用完整快照与客户端分页。实际宿主需在 UI 资源变更后刷新工具／插件，并核对当前资源与所需读写流程。
