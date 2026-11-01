# Legacy 彻底清理计划

> 分支：`codex/legacy-cleanup`  
> 范围确认：全选（前端旧 UI、后端 v1 读路径、数据兼容层、工程垃圾），删除力度=彻底。  
> 原则：先备份/回填，再删数据；每阶段全量测试+构建；已应用 migration 和验收证据文档不删除。

## 0. 审计

### 前端旧 UI
- `apps/web/src/pages.tsx`（~1050 行）：旧 Home/Product/ItemDetail/Catalog/History/Notes/Settings。
- `apps/web/src/workspace.tsx`：`ui=legacy`、sessionStorage `acornary-ui`、旧 `WorkbenchShell` 路由。
- 旧 UI 模块：`ui/browser.tsx`、`ui/workbench.tsx`、`ui/activity.tsx`、`ui/inventory-layout.tsx`、`ui/catalog-tree.tsx`、`ui/item-inspector.tsx`、`ui/stash-results.tsx`、`prototype/ItemsPrototype.tsx`。
- 可保留的功能组件（不是旧 shell）：`ui/primitives`、`ui/icons`、`ui/theme`、`ui/components`、`ui/forms`、`ui/inputs`、`ui/fields`、`ui/label-button`、`ui/label-print`、`ui/printer-settings`、`ui/catalog-review`。
- 旧浏览器用例：`tests/browser/*` 中选择 `ui=legacy` 的断言；新 UI 用例在 `next-ui.spec.ts`/`next-writes.spec.ts`。

### 后端 v1 读路径
- `GET /api/read/:operation`（无 body，v1）。
- `GET /api/ui/snapshot` 无协议头时走 `webSnapshot` v1；`GET /api/ui/groups` 同样。
- `packages/contracts/src/web.ts` v1 snapshot 类型仍被前端 view model 使用。
- `fingerprint.ts` `legacyInput` 与 `fingerprint_format='legacy_v1'` 重放 fallback。
- `get_connection_context` 未 advertise `protocol_v2`，前端仍选择 GET。
- `get_attribute_sets` 旧命令（新前端未使用）。
- Android 只使用 `/api/terminal/v1`，不受 read v1 删除影响；旧 Web/第三方 read 客户端会受影响。

### 数据兼容层
- `attribute_sets` 表：003 已把值嵌入 `items.attributes` / `catalog_nodes.attributes`，表只被迁移和 preservation 测试引用。
- `notes.item_id` 投影、`note_item_projection`、`016a` 的 `notes_legacy_target` 触发器。
- `lifecycle.availability`：旧字段仍在新旧 UI/通用编辑中出现；需回填到 usage/custody/service/transport。
- `EDIT` 事件：历史行可能仍存在；事件表 append-only，不能直接删历史；先盘点再决定是否只移出写入词表。
- `attribute_sets`/notes 的删除都需要先跑数据一致性检查。

### 工程垃圾
- `apps/scanner/__pycache__`（若存在）、`prototype`、无引用脚本、`output/`/`dist/`（已忽略）。
- `hardware/` 是未跟踪的前端打印资料，默认保留，等待用户确认。
- `docs/archive/` 和 `docs/repair/` 是证据/历史，不删除。

## 1. 阶段（进度）

### Phase 1 — 前端旧 UI（已完成）
1. 先把 `/items/:id/history`、`/items/:id/notes`、`/items/:id/details`、`/i/:id`、`/catalog/:id/history` 重定向/映射到新屏幕。
2. 把 Settings 的 account/households/printer 详情提取为独立 feature（保留打印/账号能力），移除旧 `pages.tsx` 其余部分。
3. 移除 `ui=legacy`/`acornary-ui`，固定 NextShell。
4. 删除旧模块和 `prototype`；保留共享 primitives/forms。
5. 更新 browser/unit 断言，禁止再出现 legacy 路由。

### Phase 2 — 后端 v1 读（已完成）
1. 增加通用 `POST /api/read/:operation`；advertise `protocol_v2`；前端固定 POST。
2. 要求 `/api/read`、`/api/ui/snapshot|groups`、`/api/sync` 必须 `X-Acornary-Protocol: 2`（auth/health/version/context 例外）。
3. 删除 GET read、v1 snapshot 分支和 `webSnapshot` v1；保留 terminal v1。
4. 删除 `legacyInput` 写入路径；历史 operation replay 只保留只读证明，不新增 fallback。
5. 删除 `get_attribute_sets` 命令/合同/测试。

### Phase 3 — 数据（已完成：attribute_sets、notes.item_id/016a、lifecycle.availability→v2 已迁移）
1. 备份：`pg_dump` + 行数/摘要。
2. `022_drop_attribute_sets.sql`：校验嵌入值后 drop table。
3. `023_notes_target_only.sql`：回填缺失 target、校验、drop `item_id`/constraint、drop `016a` trigger/function；更新所有代码/tests。
4. `024_lifecycle_v2.sql`：发布 lifecycle v2（无 availability），把旧值无损映射到 usage/custody/service/transport，升级绑定；v1 保留为历史 retired 读取。
5. 移除 `lifecycle.availability` 合同/UI/编辑路径；更新查询摘要。
6. `EDIT` 只做历史盘点，不删事件；如需统一，另立迁移并保留原文。

### Phase 4 — 垃圾与收口（待做）
1. 删除无引用文件、缓存、临时脚本。
2. 更新 docs/repair/README、frontend handoff、legacy 说明。
3. 空库迁移 001–024、全量测试、nested batches、`npm run build`、浏览器冒烟。
4. 合并回 `codex/data-model-v2`。

## 2. 验收门禁

- 全仓库测试 0 failed；
- 空库迁移 001–024 成功；
- `tsc` 根+Web、`npm run build` 成功；
- read/snapshot/sync 无协议头拒绝；
- 无 `ui=legacy`、无 `pages.tsx`、无 `attribute_sets`、无 `notes.item_id`；
- 数据备份与回填脚本可复现；
- 浏览器主流程冒烟通过。

## 3. 回滚

- 阶段 1/2 用 git revert；
- 阶段 3 依赖备份恢复，迁移不可逆；在 `022`–`024` 前保留 dump 和恢复演练记录。


## 4. 进度记录（2026-11-01）

- Phase 1 已完成：`pages.tsx`、旧 `ui/browser|workbench|activity|catalog-tree|item-inspector|stash-results|inventory-layout`、`prototype` 已删除；Settings 详情提取到 `features/settings/SettingsDetails.tsx`；`ui=legacy` 已从 schema 和路由移除。
- Phase 2 已完成：`GET /api/read/:operation` 已删除（仅保留 `get_connection_context` 协商 GET）；通用 `POST /api/read/:operation`；`protocol_v2` 已 advertise；业务 API 无 `X-Acornary-Protocol: 2` 返回 409；v1 snapshot 分支仍在，待删。
- Phase 3 完成：`attribute_sets`（022）、`get_attribute_sets`、`notes.item_id`/`016a`（023）、`lifecycle.availability`→usage/custody/service/transport + lifecycle v2（024）已完成。
- Phase 4 未开始。
- 当前验收：全仓 **199 passed / 2 todo**；Batch 1/2 84、Batch 3 17/4、Batch 4 19、Batch 5 11、Batch 6 23、Batch 7 notes 15 + export 12、Batch 8 10/1。
- 构建：Web/插件构建通过。注意 `ui/forms.tsx` 仍保留生产 ActionSheet 和少量 legacy 分支，后续可拆分。
