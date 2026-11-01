# 前端重构执行进度（Wave 0 / 1 / 2 部分）

> 日期：2026-10-31  
> 分支：`codex/data-model-v2`（工作区未提交）  
> 契约：`docs/repair/frozen-interfaces.md` / `v2-2026-10-31`  
> 计划：[frontend-refactor-plan-v2.md](./frontend-refactor-plan-v2.md)

## 已完成

### Wave 0 · 契约与壳层基础

- `packages/contracts/src/read-v2.ts`：冻结类型（FeatureKey、ConnectionContext、SnapshotV2、ItemDetail、QueryResult、DateFact、NoteSummary、AttachmentSummary 等）。
- `packages/contracts/src/errors.ts`：新增协议/游标/附件/状态/同步等错误码、HTTP 状态与修复方向。
- `apps/web/src/features/api/features.ts`：安全基线 `query_v2` + `history_v2`；无 `features` 时降级。
- `apps/web/src/features/api/connection.tsx`：`ConnectionProvider`、`useFeature`、`FeatureGate`；按家庭缓存。
- `apps/web/src/features/api/protocol.ts`：`X-Acornary-Protocol: 2`。
- `apps/web/src/lib/api.ts`：所有 HTTP 业务请求带协议头；GET/POST read 可切换；新增错误文案。
- `apps/web/src/features/api/recovery.ts`：错误 → 用户恢复动作映射。
- `packages/contracts/src/plugin.ts`：v1/v2 插件 envelope 兼容（notes 可选、server groups、container 可选、未知模板不拒绝）。
- `apps/web/src/plugin/client.ts`：实现 `context()`；插件入口接入 `ConnectionProvider`。
- `apps/web/src/features/inventory/adapters/shape.ts`：`isSnapshotV2` / `isItemDetailV2` / `isItemRecordV2`。

### Wave 1 · 读模型适配

- `apps/web/src/features/inventory/model/types.ts`：ItemView / GroupView / InventoryView / ItemDetailView 等纯 View Model。
- `adapters/`：snapshot、record、groups、dates、notes、detail、templates、capabilities、index。
- `apps/web/src/features/inventory/view.ts`：`useInventoryView` / `useItemView` / `useGroupView` / `useItemNotes`。
- `apps/web/src/features/api/query.ts`：`useItemQuery` / `useCatalogQuery` / `useHistoryQuery`（opaque cursor、stale、summary、F-only 参数剥离）。
- `apps/web/src/features/api/query-params.ts`：按 `features` 剥离 `profile/capabilities/date_filters/include_void/include_terminal`。
- `tests/web/adapters.test.ts`：12 项适配器测试。

### Wave 2 · 设计系统与壳层

- `apps/web/src/ui/tokens.ts` / `tokens.css`：颜色、字号、间距、圆角、动效、宽度；单源生成 CSS + Ant theme。
- `apps/web/src/ui/primitives/`：Button、IconButton、StatusTag、FactChip、Metric、PageHeader、EmptyState、Section、Toolbar、ItemRow、Sheet、Field + 12 个 CSS Module。
- `apps/web/src/ui/primitives/README.md`：页面只使用 primitives 的规则。
- `/ui` kitchen-sink：`apps/web/src/features/ui-kitchen/KitchenSink.tsx`，通过 `lazy` 路由加载，用于视觉检查。
- `theme.tsx` 引入 `tokens.css`。
- 新壳层：`apps/web/src/next/NextShell.tsx` + CSS Module；桌面侧栏、手机底部导航、skip link、container-friendly layout。
- 新页面：
  - `features/items/screens/ItemsScreen.tsx`：服务端 `query_items` 列表、位置/状态筛选、分类分组、空/错/加载、加载更多；
  - `next/screens/ItemScreen.tsx`：`get_item` + 适配器、3 指标、主/次操作、资料/笔记/历史；
  - `next/screens/CatalogScreen.tsx`：`query_catalog_nodes` + 规格/分类/在库；
  - `next/screens/ActivityScreen.tsx`：`get_history` + 日分组 + 人话摘要；
  - `next/screens/SettingsScreen.tsx`：新设置页（家庭/打印/缓存/开发者工具/安装步骤）；
  - `ActionDrawer` 改用新 `Sheet`，旧表单也获得新抽屉外观。
- 运行时验证：隔离 PostgreSQL + demo 数据 + 本地 Web 服务 + Playwright；`?ui=next` 的列表/详情/目录/动态/设置无 console/page error。截图在 `output/next/`（`items-1440-v2.png`、`item-1440-v2.png`、`item-390.png`、`catalog-1440.png`、`activity-1440.png`、`settings-new.png`）。
- 新增 `tests/browser/next-ui.spec.ts`：新壳层/列表/目录/动态/设置/移动端底栏的浏览器冒烟；默认旧界面下不影响现有测试，测试使用 `?ui=next`。
- 灰度：新界面由 `?ui=next` 或构建期 `VITE_UI_NEXT=1` 启用；`?ui=legacy` 回退旧界面；默认仍走旧界面以保持现有浏览器测试稳定。

## 验证

| 项                                       | 结果                  |
| ---------------------------------------- | --------------------- |
| `tsc --noEmit`                           | PASS                  |
| `tsc -p apps/web/tsconfig.json --noEmit` | PASS                  |
| `vite build`（web）                      | PASS                  |
| `vite build`（plugin）                   | PASS                  |
| Vitest（新增 + 受影响）                  | 42 tests PASS         |
| Prettier                                 | 新增/修改文件已格式化 |

新增测试：

- `tests/frontend-foundation.test.ts`：features、shape、错误、恢复、query 参数剥离。
- `tests/frontend-protocol.test.ts`：协议头、GET/POST read、写请求 CSRF 头。
- `tests/frontend-tokens.test.ts`：tokens.ts / tokens.css 同步。
- `tests/frontend-plugin-v2.test.ts`：插件 envelope v2 兼容。
- `tests/web/adapters.test.ts`：v1/v2 快照、详情、分组、日期、笔记、模板、能力。

## 正式版方案

完整设计语言、页面规格、组件/数据架构、写流程、测试与分阶段切换方案已整理到 [frontend-production-plan.md](./frontend-production-plan.md)。原型源码只作设计参考；`?prototype=1` 运行入口已移除。

## 未完成（下一批）

1. **显式路由**：当前仍用现有 catch-all 路由；需要显式路由、`validateSearch`，并让设置/账号路由脱离 InventoryProvider 的全量加载。
2. **写流程内层**：抽屉外观已新，但入库/消耗/移动/编辑/笔记表单仍是旧实现；需要拆 `IntakeSheet` / `ConsumeSheet` / `MoveSheet` / `EditSheet` 并减少重复上下文。
3. **列表能力**：批量选择/移动/打印、搜索高亮、保存视图、缩略图；目录的 SKU 侧栏与批量整理。
4. **F 能力 UI**：profile/capabilities、deadline、stock、void/split/dispose、notes_v2、attachments、sync；目前仅类型/适配/feature gate 基础，未显示入口。
5. **测试与清理**：新 UI 的浏览器/视觉回归、旧页面/旧 CSS/死类名删除、bundle 拆分、5k 基准、axe。

## 注意

- `detail_v2` 不在冻结 `FeatureKey` 中：当前用形状检测；v2-only 区块分别由 `deadline` / `attachments` / `notes_v2` 控制。
- `get_connection_context` 目前不返回 `protocol/features`，运行时只能走安全基线；不要用旧字段猜能力。
- 后端 F 功能上线时，只需在 `features` 返回对应 key；前端入口已按 `FeatureGate` 预留。
- `/ui` 是开发检查页，不在主导航；需要登录/库存上下文才能打开。

## 正式版执行进度（2026-10-31）

### 已完成

- **Lucide 图标系统**：`apps/web/src/ui/icons/Icon.tsx` / `names.ts` / `category.ts`；38px 分类字块，1.5px 描边；`lucide-react@1.65.0` 进入 `package.json` / `pnpm-lock.yaml`。
- **设计 token**：分类色、eyebrow 字号加入 `tokens.ts` / `tokens.css`。
- **正式列表**：`apps/web/src/features/items/screens/ItemsScreen.tsx` + CSS；真实 `useItemQuery`、分类分组、关注/位置视图、日期语义、sticky 列头、行尾菜单、批量选择（移动/打印）、移动端位置菜单。
- **侧栏**：`NextShell` 加入视图/位置；`ItemsSidebar` 使用物理物品计数与关注计数；导航图标。
- **详情**：`next/screens/ItemScreen.tsx` 增加分类图标、商品/分类身份、日期语义、2 列事实、移动端指标布局。
- **目录/动态**：`next/screens/CatalogScreen.tsx` / `ActivityScreen.tsx` 使用 Lucide 图标、统一工具栏/行/空态/移动端。
- **测试**：`tests/web/item-selectors.test.ts`（6）；`tests/browser/next-ui.spec.ts` 增加无原生 select / URL-backed 视图断言；48 个前端相关测试通过。
- **运行时**：`?ui=next` 的列表/详情/目录/动态/设置 1440/390 截图无 console/page error。

### 仍需完成

1. 显式路由 + `validateSearch`；当前仍是 catch-all。
2. 写 Sheet 内层（入库/消耗/移动/编辑/笔记/打印）仍复用旧表单；外观已统一。
3. 新建商品/目录树/搜索最近记录/批量消耗等完整交互。
4. 默认入口仍为旧版；`?ui=next` 或 `VITE_UI_NEXT=1` 启用。旧浏览器测试迁移后再切默认。
5. 旧 `next/screens/ItemsScreen.tsx` 已删除；原型源码保留为设计参考，不进入生产。

## Codex 收尾（2026-11-01）

- 新 UI 已默认：`/items` 直接进入 Quiet Ledger；`?ui=legacy` 回退并记住当前 tab，`?ui=next` 切回。
- 写流程已拆到 `apps/web/src/features/writes/`：Consume / Move / Edit / Note / Intake / AttributeEditor / WriteButton；共享命令与草稿仍由 `ui/forms.tsx` 控制。
- 显式核心路由与 `validateSearch` 已加入；cursor 不进入 URL。
- 旧浏览器测试通过 `tests/browser/legacy.ts` 使用回退入口；新增 `next-ui.spec.ts` / `next-writes.spec.ts`。
- 验证：52 个单元测试；34 个 Web 浏览器测试 + 2 个 MCP 测试通过；TypeScript 与 Web/Plugin build 通过。
- 演示库已清理并重新 seed；当前为原始 11 件物理物品，无测试合成记录。
- 剩余：共享 dispatcher/路由组件彻底迁移、bundle 拆分、axe/cloud 覆盖、F 后端能力。
