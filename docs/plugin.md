# MCP Apps 插件

语音入库扩展：版本必填、错误恢复、请求追踪、原子批量操作及 product v2 见 [语音入库指南](./voice-intake.md)。下文历史阶段中的 v1 限制以该扩展说明为准。

插件与 Web 共用 `apps/web/src/workspace.tsx`、页面、表单及响应式工作台。相关源码已合入 `main` 并随 [v0.4.2](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2) 发布；当前生产版本见 `/health`，布局见 [工作台说明](./responsive-workbench.md)。2026-10-01 的逐轮本地测试保留在 [历史交接](./archive/plugin-handoff.md)。

## 入口与身份

- Web 入口使用 Cookie 会话、同源 HTTP transport 和 Service Worker；`apps/web/src/plugin.tsx` 使用 memory history、MCP Apps 宿主桥和同一份 Workspace，不注册 Service Worker。
- `apps/server/src/plugin.ts` 注册版本化、自包含 HTML resource 和 `open_inventory`。模型只收到家庭名、数量等摘要，完整快照及会话放在 `_meta['acornary/view']`；`get_inventory_view` 仅 app 可见。
- `apply_inventory_command` 仅 app 可见。服务端先校验 OAuth write scope 和 `expected_scope`，再执行原有领域命令、revision 与幂等逻辑；现有模型工具继续可用。
- 不透明身份作用域由服务端从运行模式、账号、actor、家庭、授权版本、OAuth client 和 scopes 计算。浏览器状态和工具参数不能选择后端身份。执行与幂等重放前均检查当前作用域。

## v2 协议与能力

`/mcp` 使用标准 MCP 协商和正常 Bearer/OAuth 认证，不要求 `X-Acornary-Protocol`。ChatGPT、Claude 等客户端先调用 `get_connection_context` 发现 `protocol: { current: 2, min: 2 }` 与 `features`。HTTP 的 `/api/context` 与 `get_connection_context` 协商入口仍可用；业务 HTTP `/api/read|write|ui|sync|attachments|debug` 继续要求 `X-Acornary-Protocol: 2`。

`open_inventory` 和 `get_inventory_view` 的 `_meta['acornary/view']` 格式为：

```ts
{ version: 2, protocol: 2, session: { /* 当前授权身份 */ }, snapshot: SnapshotV2 }
```

快照含 v2 分组、水位、记录状态、能力与笔记数量，不内联笔记正文。`get_item` 当前仍返回平铺对象（含笔记摘要、日期与拆分信息），不是 `{ item, ... }` 包装；适配器保留实际返回的字段。读取或编辑正文使用 `get_note`，独立笔记命令使用 `target: { kind: 'ITEM' | 'CATALOG_NODE', id }`（更新可由 `note_id` 定位），不再发送旧 `item_id` 笔记参数。可用性展示使用 `derived_availability` 或相同的派生规则，不写入 `lifecycle.availability`。

`apply_inventory_command` 的 v2 输出保留 `affected_objects`、`event_ids`、`summary`、`created_items`、`children`、`split` / `split_id`、笔记摘要 `note`、期限/来源扩展字段、`receipt` 与 `proposal_id`，允许新增合法回执字段。服务端和插件客户端均验证输出。模型命令仍从 `schemas` 自动注册，保持读写 scope、破坏性提示和追踪元数据。

MCP Apps iframe 没有认证二进制上传/下载通道，插件不展示附件动作；`create_attachment_upload` 与 `complete_attachment_upload` 经模型工具或 app-only 工具调用都返回 `ATTACHMENT_TRANSPORT_UNSUPPORTED`。插件直接请求附件 URL 也返回同一错误，请改用 Web。附件元数据读取与 Web 附件传输保持可用。插件能力取服务端 `features` 与自身界面支持的交集，当前隐藏 stock、void、split、references、attachments 等未完成的界面入口；没有 dispose 专用按钮。这些领域命令仍可通过模型工具使用，附件字节操作除外。

## 入口名称与图标

`open_inventory` 同时提供全局侧边栏（global）和对话侧面板（thread）入口，两处标题均为 **Acornary**。工具标识符保持不变。

入口的顶层 `icons` 使用 D 精修版 20 × 20 松鼠线条 SVG，透明背景、1.35 px 圆角描边；浅色主题用 `#68615C`，深色主题用 `#A6A49E`。几何来自 Figma `133:388` / `133:393`，内嵌于服务端 `plugin-icons.ts` 并输出 Base64 Data URI，随编译产物发布，不依赖运行时设计素材目录或额外图片请求。插件管理页 Logo、网站 favicon 和 PWA 图标独立配置。

发布后，在 ChatGPT 当前自定义 MCP 插件连接中执行 **Refresh**，确认 `tools/list` 的标题与两套图标已更新，再重新打开入口。分别在浅色／深色主题检查名称、悬停提示、图标裁切及两个入口打开库存的行为。线上元数据核对与真实客户端视觉验收须分别记录；模拟宿主不证明真实客户端已刷新缓存。

## 上下文与恢复

详情或检查器选择把真实对象类型、ID、revision、名称和位置发送到 `ui/update-model-context`。离开、对象不可用或授权失效时清空；失败会重试最新状态。选择本身不授权写入。

首屏优先使用 opener 结果，缺失时通过 app-only 工具读取。后续通知使权威查询失效，可见时每 5 秒及焦点恢复时只读刷新。调用按会话代次隔离，迟到响应不能覆盖新会话，历史读取支持取消。

`plugin/store.ts` 使用版本 2 的当前组件私有 widget state 保存草稿、准确请求、原幂等键及已提交结果。提交前验证持久化读回；宿主不支持或未确认保存时停止 UI 写入，读取仍可用。恢复不自动重放，用户只能手动重试原请求或刷新已提交结果。明确业务拒绝允许修正后以新键重提，未知结果保留原请求。

v1 envelope 被拒绝；v1 widget state（包括路由、草稿和待重试请求）明确丢弃，下次确认保存时替换为 v2 状态，不转换或自动重放旧笔记载荷。升级前未确认结果的操作须通过库存/历史核对。

HTML 内联 JS、CSS 和图片，资源 CSP 不增加外部连接／资源域；普通网站的 Cookie、同源写入、CSP 和禁止任意嵌入策略保持独立。

## 发布与缓存刷新

1. 构建 Web 与插件：`pnpm build`，部署后重启服务实例。HTML 在每个服务实例启动时读取一次。
2. `ui://acornary/inventory-v2-<hash>.html` 的 hash 包含 envelope 版本与构建 HTML；重新构建改变内容后 URI 自动更新。
3. 在宿主连接中 Refresh 工具/资源，检查 `tools/list` 中 `open_inventory._meta.ui.resourceUri` 为新 URI，然后关闭旧 iframe 并重新打开。
4. 核对 `_meta['acornary/view'].version`、`protocol` 和 `snapshot.protocol` 均为 2。旧 iframe 不会热更新；只刷新库存不能替换资源代码。

## 验证

仓库的完整隔离 CI 同时覆盖 Web 和不透明来源插件沙箱：

```sh
docker build --target browser-test -t acornary-ci .
node scripts/ci.mjs
```

`tests/plugin-browser-server.ts` 及 `tests/fixtures/plugin-host.*` 只用于隔离测试。真实 MCP 凭据留在测试宿主服务器，iframe 不接触凭据。覆盖选中项、跨家庭写入拒绝、过期授权、迟到响应、同键重试、业务拒绝可编辑、持久化失败及刷新恢复。

模拟宿主结果与真实客户端验收分开记录。私有 widget state 不保证跨新对话、跨设备或宿主清理后继续存在；插件引导仍使用完整 v2 快照，物品查询使用服务端游标分页。实际宿主需在 UI 资源变更后刷新工具／插件，并核对当前资源与所需读写流程。
