# Soft Gray 实现交接

> 历史记录（2026-10-01）：下述状态仅描述当时的本地工作。相关源码后来已合入主线并发布；当前入口见 [项目进度](../progress.md) 和 [归档说明](./README.md)。

2026-10-01，MacBook16，分支 `codex/soft-gray-webui`。未合并、推送或部署；所有写入验收使用一次性 PostgreSQL 测试库。

工作目录：`/Users/timli/.codex/worktrees/acornary-soft-gray-webui/Acornary`。

## 验证结果

- Node 24 Docker 环境：`pnpm typecheck`、`pnpm test`（8 个文件、51 项）和 `pnpm build` 通过。
- Chromium：最终 WebUI 定向回归 12/12 通过；同一份应用代码的完整回归中，另 8 项账号、OAuth、检查器测试通过。完整回归最初的 1 项失败是搜索范围测试使用了不匹配的 label 定位；仅将测试改为按 `combobox` 可访问名称定位后，12 项 WebUI 全部复测通过。不能将此表述为单次 20/20 执行。
- 360 / 390 / 430 / 600 / 1280 / 1440 像素宽度无横向溢出；已查看窄屏位置浏览、宽屏位置侧栏、消耗表单、移动确认和搜索结果截图。样式覆盖和移动选择按钮挤压已修复。
- 实际 HTTP 写入覆盖：入库、开封、部分消耗、整件用完、纠错、笔记、容器及单件移动；故障注入覆盖同键重试、revision 冲突、离线恢复、登录失效和成功后刷新失败。返回查询、已加载条数、滚动位置、全层级搜索均通过。
- 日志：`output/ci/soft-gray-final.log`、`output/ci/soft-gray-full-regression.log`。截图：`output/ci/playwright/soft-location-390.png`、`soft-location-1280.png`、`soft-consume-390.png`、`soft-consume-1280.png`、`soft-move-confirm-390.png` 等。
- 测试创建的临时容器和网络已自动清理。原有 `acornary-webui-preview`、`acornary-webui-test-pg` 未修改。主目录仍只有原先的三个未跟踪品牌素材路径。

## 已实现的边界

- `apps/web/src/ui/browser.tsx`：位置浏览、完整路径、SKU 目录、逐件搜索、加载更多、移动目标选择；浏览状态按会话缓存键隔离。
- `apps/web/src/lib/browse.ts`：完整快照搜索、商品规格消歧、件数投影与消耗校验。
- `apps/web/src/soft-gray.css` 和 `product.css`：统一色彩、排版、响应式布局和明确的样式层级；复用 Figma 搜索及清除 SVG。
- `apps/web/src/pages.tsx`：SKU 逐件列表分页、返回状态、详情完整编号和位置路径。
- `apps/web/src/ui/forms.tsx`：单件移动二次确认、非法消耗内联校验、已提交结果只读刷新；沿用现有草稿、revision 和幂等写入管线。
- `apps/web/src/app.tsx`：统一导航及 `/search` 页面；打开和关闭操作保留浏览返回参数，并清除旧操作参数。
- `apps/server/src/app.ts`、`lib/auth.tsx`、`sw.js`：只增加搜索路由返回支持和新静态资源缓存。未改变领域命令、OAuth 范围或正式数据库。

## 尚未覆盖

客户端分页仍建立在完整家庭快照上；大库存服务端游标分页需单独实现。iPhone Safari、真实输入法、VoiceOver 和插件宿主尚未实机验收。入库、编辑资料、开封、纠错、容器整批移动、目录管理、笔记、历史、认证、设置保留既有功能，其完整 Soft Gray 设计尚未补齐。

## 插件串行接入方案（历史计划；现已在本工作树实施）

1. 从 `app.tsx` 抽出无挂载副作用的共享 `Workspace`，页面、表单、浏览投影和 CSS 仍使用同一份源码。新增 `apps/web/src/plugin.tsx` 作为第二个宿主入口；通过 `vite.config.ts` 构建独立资源包。插件入口不注册 Web Service Worker。
2. 在 `lib/api.ts` 周围定义 `InventoryTransport`，包含快照、领域读取、写入与历史。Web 实现保持同源 Cookie HTTP；插件实现通过 MCP Apps 宿主桥调用工具，将响应映射为相同的 `InventorySnapshot`、`WriteResult` 和 `ApiError`。`lib/inventory.tsx`、`lib/session.tsx` 和表单消费注入的 transport / session context，不把 Web Cookie、localStorage 的家庭标识或宿主消息当作服务器身份。
3. 插件使用 memory history 和受控初始页面，浏览查询、选择与滚动状态只作为视图状态恢复。草稿、操作 ID 和重试键仍按服务器确认的账号／家庭隔离；宿主卸载、403、401、409、结果未知和成功后刷新失败必须独立测试，不能自动重放写操作。
4. 在 `apps/server/src/app.ts` 的 MCP 注册处新增 UI resource 与只读展示工具，用 `_meta.ui.resourceUri` 关联资源。为 UI 需要的完整投影增加受 OAuth 读取权限保护的工具，复用 `webSnapshot` 及现有领域命令；不要复制库存服务或将大量快照文本塞入模型上下文。资源和工具可见范围、数据载荷分层、CSP 按宿主规范逐项核对。
5. 保持普通 Web 的同源写入校验和禁止任意嵌入策略；UI 资源单独配置所需 CSP，不能为了嵌入全局关闭安全响应头。当前 MCP SDK 为仓库锁定版本，先核实其与 MCP Apps 扩展的兼容性，再引入必要依赖。
6. 在 Web CI 继续通过后，以独立插件验收覆盖工具结果渲染、宿主 resize/theme、无写权限、重新授权、家庭隔离、冲突和同键重试，最后进行真实 ChatGPT Developer Mode 验收。

当前官方文档以 MCP Apps UI resource / tools-call 为基础，ChatGPT 特有扩展仅在需要时加入：[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)、[MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)。以上为结合当前仓库的实施建议，不代表插件已接通。

串行写入交接：本轮结束后才由插件会话接手。接手时重新检查分支、未提交修改和主目录的品牌素材；不要在旧基线覆盖 `app.tsx`、`lib/api.ts`、`lib/inventory.tsx`、`lib/session.tsx`、`ui/forms.tsx`、`vite.config.ts` 和服务器 `app.ts`。

## 插件接入后续交接

2026-10-01：本地插件 UI 已在本工作树实施，仍复用本文件所述 Soft Gray 页面与表单。审阅发现的三项问题已修复；最新单次 Node 24 验收为 59/59 后端及单元测试、35/35 Chromium 测试（15 项插件 + 原有 20 项）。实现、修复过程、最终日志与截图见 [plugin-handoff.md](plugin-handoff.md)，最新证据目录为 `output/ci/plugin-fixes-verified/`。等待再次 Max 只读审阅；未推送、部署或连接真实 ChatGPT，不能视为真实宿主验收。
