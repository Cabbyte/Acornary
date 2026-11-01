# 松仓前端重构更新方案（v2 冻结契约）

> 基线：`docs/repair/frozen-interfaces.md` / `v2-2026-10-31`  
> 当前分支：`codex/data-model-v2`（Wave 1 已合并）  
> 视觉与组件规格：沿用 [前端设计完整方案](./frontend-design-plan.md) 第 3–6 节  
> 本文件替换该方案第 14 节“实施路线”，只处理 **v2 契约对齐、适配层、功能开关、分波执行**  
> 状态标记：`I` = 已实现；`F` = 已冻结、未实现；`I/F` = 旧形状可用、新形状待实现

---

## 0. 结论

**可以一次性完成全部前端重构，但必须按“I 先接、F 灰化”的方式做。**

- `query_items` / `query_catalog_nodes` / `get_history` 已实现，可以立即替换本地搜索、分页、统计。
- 快照 v2、详情包装、profile/capabilities、deadline、notes v2、attachments、void/split/stock、sync 仍是 `F`；前端现在就设计，但入口必须由 `features` 控制，默认隐藏。
- 旧快照/旧详情/旧模板通过适配层兼容；页面不直接读 `attributes`、不直接算 `productGroups`、不使用 offset 游标。
- 全量重构放在一个分支、一个 `ui=next` 开关后；`F` 功能全部有 mock fixture，后端启用 key 后再打开，不需要重写页面。

**关键原则：不要把“后端分支已合并”当成“线上可用”。只认 `get_connection_context.features`；没有 `features` 时只启用 `query_v2` + `history_v2` 安全基线。**

---

## 1. 冻结契约与真实状态

### 1.1 Feature 矩阵

| Feature | 状态 | 前端用途 | 未启用时 |
| --- | --- | --- | --- |
| `query_v2` | **I** | `query_items` / `query_catalog_nodes` 的服务端搜索、排序、游标、统计 | 安全基线，始终可用 |
| `history_v2` | **I** | `get_history` 的事件类型/时间过滤/游标 | 安全基线，始终可用 |
| `protocol_v2` | **F** | `get_connection_context.protocol/features`；POST read | 发协议头但按 GET + baseline 降级 |
| `snapshot_v2` | **F** | v2 快照（无笔记正文、`as_of_change_id`、服务端 groups） | v1 快照适配器 |
| `groups_v2` | **F** | `query_inventory_groups` | `snapshot.groups`；不本地重算 |
| `profile_capabilities` | **F** | `profile` / `capabilities` / `effective_capabilities` / `TemplateDefinition.fields` | 不显示 profile；用旧模板定义 |
| `deadline` | **F** | `DateFact`、`date_filters`、deadline 命令 | 旧 `reminder`/`expiry`；不显示 deadline 筛选 |
| `stock` | **F** | `query_stock`、补货 | 隐藏补货入口 |
| `notes_v2` | **F** | `list_notes` / `get_note` / 摘要 | v1 快照 notes 正文；摘要由前端截断 |
| `attachments` | **F** | 上传票据、缩略图、画廊 | 完全隐藏附件入口 |
| `void` | **F** | `void_item` / `void_catalog_node` | 隐藏作废 |
| `split` | **F** | `split_item` | 隐藏拆分 |
| `references` | **F** | `Reference` 字段 | 隐藏引用字段 |
| `units_v2` | **F** | 新单位/量纲 | 旧单位 |
| `sync_v2` | **F** | bootstrap/changes/fetch/离线同步 | 全量快照离线 |
| `redaction_v2` | **F** | `reveal_sensitive` / 审计 | 隐藏敏感展开 |

### 1.2 一个契约缺口：`detail_v2` 不在 `FeatureKey` 里

冻结文档第 4.1 节说“等 `detail_v2` feature”，但第 1.2 节 `FeatureKey` 没有 `detail_v2`。前端不能猜。

**处理：**

- 不新增私有 flag 冒充契约；用 **形状检测** 兼容旧/新详情：
  ```ts
  const isItemDetailV2 = (raw: unknown): raw is ItemDetailV2 =>
    !!raw && typeof raw === 'object' && 'item' in raw && 'dates' in raw;
  ```
- v2-only 区块分别由 `deadline` / `attachments` / `notes_v2` 控制；`ItemDetail` 包装本身不需要独立 flag。
- 建议后端在下一个 `v2.x` 追加可选 `detail_v2` key；这是新增 key，不违反冻结规则。未追加前，前端按形状检测运行。

### 1.3 当前代码真实状态

| 区域 | 当前实现 | 与冻结契约的差距 |
| --- | --- | --- |
| 协议头 | `request()` 不发送 `X-Acornary-Protocol` | 所有 HTTP 业务请求需补 |
| 能力发现 | `/api/context` 只返回 household/container；`get_connection_context` 无 protocol/features | 需 `ConnectionProvider` + baseline |
| 错误 | `failure()` 已有 code/message/details/request_id/recovery | 新错误码未进 `errors.ts`/`api.ts` |
| 快照 | v1：含 `notes` 正文；`webSnapshot` 用本地 `productGroups` 算 groups | 需 v1 适配 + v2 类型 |
| 查询 | `query_items`/`query_catalog_nodes` 已有 cursor/sort/summary/stale | 前端仍在用本地 `searchInventory`/`productGroups` |
| 历史 | `get_history` 已有 event_type/date/cursor | `history()` 仍用旧 limit/cursor；Activity 未用过滤 |
| 详情 | `get_item` 扁平对象 + 笔记正文 + `reminder` | 需适配 `ItemDetail` 包装 |
| 分组 | v1 快照 `groups` 由服务端算；前端又本地重算 | 统一用服务端 groups/summary |
| 模板 | `list_attribute_templates` 旧字段；`fields.tsx` 硬编码 | 需 `TemplateDefinition.fields` 适配 |
| Profile/能力 | 无 | 需 F 门控 |
| 日期 | `reminder` / `lifecycle.expiry` | 需 `next_date`/`DateFact` 适配 |
| 笔记 | 快照含正文；详情返回全部笔记 | 需摘要/正文分离适配 |
| 附件 | 无 | 全部 F，隐藏 |
| 同步 | 只有内部 `sync_changes` 表 | 全部 F，不接 |
| 插件 | `pluginEnvelopeSchema` version 1，本地 `productGroups` | 需 v2 兼容 + features baseline |

**证据：**

- v1 快照含 notes：`apps/server/src/web.ts:45–52`
- v1 详情扁平 + notes 正文：`apps/server/src/service.ts:405–440`
- context 无 features：`apps/server/src/service.ts:831–849`
- 前端无协议头：`apps/web/src/lib/api.ts:47–112`
- 本地搜索：`apps/web/src/lib/browse.ts:46–77`
- 本地 groups：`packages/contracts/src/web.ts:125+`
- 插件 envelope v1：`packages/contracts/src/plugin.ts:49–66`
- 查询 I：`apps/server/src/service.ts:606–830`
- 历史 I：`apps/server/src/service.ts:566–604`

---

## 2. 目标架构

### 2.1 分层

```text
Session / ConnectionProvider
  ├─ protocol: 2 | 1
  ├─ features: Set<FeatureKey>
  └─ household / actor

SnapshotProvider
  └─ SnapshotAdapter (v1 | v2)
       └─ InventoryView (catalog, items, groups, locations, counts)

ReadApi
  ├─ query_items
  ├─ query_catalog_nodes
  ├─ get_history
  └─ get_item / get_catalog_node
       └─ QueryAdapter / DetailAdapter
            └─ View Model (ItemView, GroupView, ItemDetailView)

WriteApi
  └─ Sheet → WriteCommand → WriteResult
       └─ adapters for new commands (F)

UI
  └─ primitives / patterns / screens
```

### 2.2 目录

```text
packages/contracts/src/
  read-v2.ts          # 冻结类型：SnapshotV2, ItemRecordV2, ItemDetail, ...
  errors.ts           # 新错误码/恢复
  index.ts            # 现有 schemas（暂不改协议字段）

apps/web/src/
  features/
    api/
      connection.tsx  # ConnectionProvider + FeatureRegistry
      protocol.ts     # header / POST read / GET fallback
      errors.ts       # ApiError + recovery 动作
      query.ts        # query hooks
      detail.ts       # get_item / detail adapter
      write.ts        # write wrapper
    inventory/
      adapters/
        snapshot.ts
        record.ts
        query.ts
        detail.ts
        groups.ts
        dates.ts
        notes.ts
        templates.ts
        capabilities.ts
      model/
        view.ts
        selectors.ts
      components/
      screens/
    attachments/      # F
    sync/             # F
    notes/            # F
  ui/
    tokens.ts / tokens.css
    theme.ts
    primitives/
    patterns/
  app/
    router.tsx
    providers.tsx
    shell/
```

### 2.3 规则

1. 页面不 import `attr()`、不读 `attributes`、不拼模板路径；只读 View Model。
2. 页面不调用 `productGroups` / `searchInventory`；分组和统计来自服务端 `groups`/`summary`。
3. 游标是不透明字符串；筛选/排序变化丢弃旧游标；不把游标当 offset。
4. `F` 功能没有 feature 时**不渲染入口**；不是 disabled，也不是“空状态”。
5. `I` 接口先接；`F` 接口用 mock fixture 开发，feature 打开后只替换 adapter。
6. 旧快照/旧详情/旧模板必须能工作；新形状是加分项，不是页面前提。

---

## 3. 8 个 breaking change 的适配

| # | 变化 | 当前 | 适配策略 | 门控 |
| --- | --- | --- | --- | --- |
| 1 | 快照不再有 notes 正文 | v1 `snapshot.notes[]` | `SnapshotAdapter` 保存 `notesByItem`；列表只输出 `note_count`；详情再取 | `snapshot_v2` / `notes_v2` |
| 2 | 列表不内联笔记 | `query_items` 已不返回 notes；v1 前端用本地 notes 搜索 | 行不显示正文；搜索交给 `query_items.search`；显示 `note_count` | `query_v2` |
| 3 | 游标 opaque | 旧 offset/数字游标 | 新 hook 只存 `next_cursor`；条件变化清空；`INVALID_CURSOR` 重载 | `query_v2` |
| 4 | 详情包装 | `get_item` 扁平对象 | `DetailAdapter` 判形状：`'item' in raw` 用 v2；否则包成 `{ item, path_ids, dates, notes, attachments, split }` | 形状检测 |
| 5 | 分组无 `item_ids` | v1 `ProductGroup.item_ids` | 组头只显示统计；展开时 `query_items({catalog_node_ids:[group.id]})` | `query_v2`；`groups_v2` 后换组查询 |
| 6 | 统计服务端算 | 前端 `productGroups` 重算 | 删除本地统计；列表用 `summary`；默认组用 `snapshot.groups`；F 后用 `query_inventory_groups` | `query_v2` / `groups_v2` |
| 7 | 日期统一 | `reminder` / `lifecycle.expiry` | `DateAdapter` 输出 `DateFact[]`；列表用 `next_date ?? reminder`；筛选 F 时隐藏 | `deadline` |
| 8 | 能力驱动表单 | `fields.tsx` 硬编码 | `TemplateRegistry` 支持旧 `definitions` 和 v2 `fields`；能力由 `effective_capabilities` 决定 | `profile_capabilities` |

### 3.1 详细适配

#### 快照

```ts
type SnapshotSource = SnapshotV1 | SnapshotV2;

function adaptSnapshot(raw: SnapshotSource, now: Date): InventoryView {
  const v2 = isSnapshotV2(raw);
  const notesByItem = v2 ? {} : groupNotes(raw.notes);
  return {
    ...raw,
    items: raw.items.map((item) => adaptItem(item, notesByItem[item.id] ?? [])),
    catalog: raw.catalog.map(adaptCatalog),
    groups: raw.groups.map(adaptGroup),
    capabilities: v2 ? raw.capabilities : {},
    asOfChangeId: v2 ? raw.as_of_change_id : '0',
  };
}
```

- v1 `ItemRecord` 没有 `note_count/attachment_count/next_date/split/record_state`：默认 `0/0/from reminder/null/VALID`。
- v1 `CatalogRecord` 没有 `profile/capabilities/effective_capabilities/one_off/record_state`：默认 `null/null/[]/false/VALID`。
- v1 `AttributeBinding` 没有 `status`：默认 `KNOWN`；`template_version` 已可能是数字，保留。
- v1 `ProductGroup` 有 `item_ids`：不进入 View Model；仅 `hasItemIds` 调试用。

#### 查询

- `query_items` 结果当前已有 `summary`、`as_of_change_id`、`stale`、`next_cursor`；补类型，不改服务端。
- 首次加载用 `query_items`，不用快照 items 做在线列表；快照只提供目录/位置/默认 groups/离线。
- 分组展开：`query_items({ catalog_node_ids:[group.id], ...filters, limit })`；不要用 `item_ids`。
- 过滤变化：`queryKey` 变化 → 新查询；旧 cursor 自然丢弃。
- `INVALID_CURSOR`：清空该 query 的 pages，重新请求第一页；显示“列表已更新”。
- `stale=true`：保留当前页，顶部 Banner“有新变更，刷新查看最新”。

#### 详情

- `get_item({ item_id, include_path: true })` 拿 path；v2 有 `ItemDetail` 则直接用。
- v1 扁平对象：`item` = 去掉 `catalog_name/notes/reminder` 的字段；`path_ids` 来自 `include_path`；`dates` 从 `reminder` 构造；`notes` 从 `notes[]` 转摘要；`attachments=[]`；`split=null`。
- `get_note` F：v1 用 `notes` 正文；v2 用 `list_notes` + `get_note`。
- `reveal_sensitive` F：不显示展开按钮；`redacted_paths` 只显示“已隐藏”。

#### 分组与统计

- 默认列表：`snapshot.groups`（服务端算好的）作为组摘要；每组的 items 通过 `query_items` 取。
- 搜索/筛选后：`query_items.summary` 是唯一总数；页面内按 `catalog_node_id` 分组只用于排版，不把它当全局统计；组内显示“本页/本结果”而不是“全家”。
- `query_inventory_groups` F 后：组摘要改为该接口；`query_items` 只取展开项。
- 删除 `productGroups` 调用；保留函数只用于旧测试或离线 v1 fallback，不进入新 UI。

#### 日期

- 列表：`item.next_date ?? reminderToFact(item.reminder)`。
- 详情：`detail.dates`；没有则从 `reminder`/`lifecycle.expiry` 构造。
- `date_filters` F：筛选面板不显示“到期窗口”；排序 `reminder_date` I 可用。
- `DateFact.state`：v2 用服务端；v1 按 `due_on` vs 家庭今天推导，未知保持 `UNKNOWN`。

#### 模板与能力

- `TemplateRegistry`：
  - 旧 `list_attribute_templates` 返回 `paths/schema` → 生成 fallback fields（label 从 `fields.tsx`，section 默认“资料”）。
  - v2 `fields` 存在 → 直接用 `label/section/order/widget/unit/sensitivity`。
- `effective_capabilities` 只在 v2 记录上存在；没有时 `[]`，不复制 profile 默认表。
- `profile` 为 `null` 时不显示 profile 徽标，不猜。
- `profile_capabilities` F：表单仍用旧 `definitions`；F 开启后切到动态 fields。

#### 笔记

- v1 快照/详情：`body` → `excerpt = body.slice(0,160)`；`note_count`；正文保留在详情缓存。
- `notes_v2` F：`list_notes` 摘要；`get_note` 正文。
- CatalogNode 笔记 F：不显示“商品笔记”入口。

#### 附件

- `attachments` F：不显示上传/画廊/数量；`attachment_count` 为 0 或服务端值。
- F 开启：`create_attachment_upload` → `PUT` → `complete_attachment_upload`；缩略图用 `?variant=thumb`；限制 25 MiB/20/5 GiB；错误码映射。

---

## 4. 功能开关

### 4.1 安全基线

```ts
const SAFE_BASELINE: FeatureKey[] = ['query_v2', 'history_v2'];

export function resolveFeatures(ctx: ConnectionContext | undefined): Set<FeatureKey> {
  if (!ctx?.protocol || !Array.isArray(ctx.features)) return new Set(SAFE_BASELINE);
  if (ctx.protocol.current < 2) return new Set(SAFE_BASELINE);
  return new Set(ctx.features);
}
```

- `get_connection_context` 没有 `features`（当前就是这样）→ baseline。
- 有 `features` → 以服务端为准；不自行加 `F`。
- `protocol.current < 2` → 只读/提示升级；不重试写请求。

### 4.2 组件

```tsx
<FeatureGate feature="deadline">
  <DeadlineSection dates={detail.dates} />
</FeatureGate>

<CapabilityBoundary capabilities={item.effective_capabilities} capability="custody">
  <CustodySection />
</CapabilityBoundary>
```

- `FeatureGate`：无 feature 返回 `null`，不占位。
- `CapabilityBoundary`：先看 feature，再看 `effective_capabilities`；不复制默认表。
- `F` 不允许“灰按钮 + 提示”；直接不渲染，避免用户以为功能坏了。

### 4.3 开发/测试

- dev 可用 `?features=deadline,attachments` 只看 UI；生产忽略。
- 测试矩阵：`baseline`、`all F`、每个 F 单独。
- F 的 mock fixture 放在 `tests/fixtures/read-v2/`；`features` 打开时跑。

### 4.4 缺 `detail_v2`

- 不新增私有 flag。
- 形状检测 + `notes_v2`/`attachments`/`deadline` 分区门控。
- 向后端建议：在 `v2.x` 追加 `detail_v2` 可选 key；不改变现有语义。

---

## 5. 页面到接口

| 页面/区域 | 首屏 | 懒加载 | 未启用时 |
| --- | --- | --- | --- |
| 工作台列表 | `get_connection_context` + `GET /api/ui/snapshot` | `query_items` 翻页/筛选 | v1 快照适配；不本地统计 |
| 商品分组 | `snapshot.groups`（v1/v2） | `query_inventory_groups`（F） | 组摘要只用 `snapshot.groups` |
| 搜索/筛选 | `query_items` | 无 | `query_v2` 已 I，可立即用 |
| 单件详情 | `get_item`（旧/新形状） | `list_notes`、`list_attachments`、`get_history`（F） | 适配器包 v2；笔记/附件灰化 |
| 日期/关注 | `item.next_date` / `reminder` | `date_filters`（F） | 旧 `reminder` |
| 商品目录 | `query_catalog_nodes` | 目录树来自快照 | 旧树 + 新表 |
| 家庭动态 | `get_history` | 按 `operation_id` 展开 | `history_v2` 已 I |
| 添加/编辑 | `list_attribute_templates` | `create_items` / `update_*` | 旧模板定义；F 后动态 fields |
| 补货 | `query_stock`（F） | 无 | 隐藏 |
| 笔记 | `list_notes`/`get_note`（F） | 无 | v1 快照正文摘要 |
| 附件 | `list_attachments`（F） | 上传/缩略图 | 隐藏 |
| 离线/同步 | `GET /api/sync/bootstrap`（F） | `/changes` | 全量快照离线 |

### 5.1 列表策略（I 阶段）

1. 启动：并行 `get_connection_context` + snapshot；snapshot 适配为 `InventoryView`。
2. 默认列表：用 `query_items` 第一页，按 `catalog_node_id` 做页面分组；组摘要用 `snapshot.groups`，总数用 `summary`。
3. 筛选/搜索：只用 `query_items`；结果总数/统计取 `summary`；不调用本地 `searchInventory`。
4. 分组展开：`query_items({ catalog_node_ids:[group.id], ...filters })`；组内分页独立。
5. `groups_v2` 后：组摘要/分页切 `query_inventory_groups`；组展开仍用 `query_items`。
6. 离线：snapshot v1/v2 只提供基础库存/组摘要；筛选可本地只读，但统计标注“离线”。

### 5.2 详情策略（I 阶段）

1. `get_item`（include_path=true）→ `DetailAdapter`。
2. `get_history` 并行；笔记/附件按需。
3. v2 `ItemDetail` 直接使用；v1 包装。
4. 操作按钮按 `record_state`/`split`/feature 决定；没有 F 就隐藏。
5. `get_note` 未实现时用详情内笔记正文；`notes_v2` 后切摘要/正文。

### 5.3 插件

- `PluginClient` 实现 `context()`：`read('get_connection_context')`；无 features 用 baseline。
- `pluginEnvelopeSchema` 增加可选 v2 snapshot/features；不能解析 v2 时保持 v1。
- 插件不发送 HTTP 头；协议通过 tool context 决定。
- 插件的本地 `productGroups` 删除；用 snapshot.groups 或 tool `query_items`。
- 插件 envelope version 1 暂不升；新增可选字段，向后兼容。

---

## 6. 分波计划

> 完整任务清单见 [frontend-refactor-tasks.csv](./frontend-refactor-tasks.csv)。  
> 每波都是一个可独立合并的 PR；不要求用户逐波验收，但内部必须过 gate。

### Wave 0 · 契约与壳层基础（I/F）

**目标：** 让前端知道“协议、能力、错误”，但不改页面。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| FND-01 | `packages/contracts/src/read-v2.ts`：冻结类型 + 导出 | I | — |
| FND-02 | `ConnectionProvider` + `FeatureRegistry` + baseline | I/F | FND-01 |
| FND-03 | 协议头 `X-Acornary-Protocol: 2`；read GET/POST 切换 | I/F | FND-02 |
| FND-04 | 新错误码/状态/消息/recovery | I/F | FND-01 |
| FND-05 | `InventoryTransport.context()` HTTP/plugin | I/F | FND-02 |
| FND-06 | 契约 fixtures：v1/v2 快照、旧/新详情、查询页、错误 | I | FND-01 |
| FND-07 | 形状检测 `isSnapshotV2` / `isItemDetailV2` | I | FND-06 |
| FND-08 | 请求 ID/恢复动作 UI + 不重试协议错误 | I/F | FND-04 |
| FND-09 | 插件 envelope v1/v2 兼容 + context + server groups | I/F | FND-02/05 |

**Exit：** 请求带协议头；无 features 时 baseline；新错误码有文案/恢复；fixture 测试通过；页面不变。

### Wave 1 · 适配层（I/F）

**目标：** 页面可继续用旧数据，但数据形状统一。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| ADP-01 | `SnapshotAdapter` v1/v2 → `InventoryView` | I/F | W0 |
| ADP-02 | `RecordAdapter`：Item/Catalog/Binding 默认值 | I/F | ADP-01 |
| ADP-03 | `useItemQuery`：cursor/stale/summary/去重 | I | W0 |
| ADP-04 | `useCatalogQuery` | I | W0 |
| ADP-05 | `useHistoryQuery`：event_type/date/cursor | I | W0 |
| ADP-06 | `DetailAdapter`：旧扁平 → `ItemDetail` | I/F | ADP-02 |
| ADP-07 | `GroupAdapter`：snapshot.groups；无 item_ids | I/F | ADP-01 |
| ADP-08 | `DateAdapter`：reminder/next_date → `DateFact` | I/F | ADP-02 |
| ADP-09 | `NoteAdapter`：body → excerpt/summary/note_count | I/F | ADP-01 |
| ADP-10 | `TemplateRegistry`：旧 definitions → `fields` | I/F | ADP-02 |
| ADP-11 | `CapabilityAdapter`：effective_capabilities | I/F | ADP-02 |
| ADP-12 | 适配层 fixture/单元测试 | I | 全部 |

**Exit：** 旧快照/旧详情可渲染为 View Model；无 F 字段时默认正确；页面仍可暂用旧组件。

### Wave 2 · 设计系统与壳层（I）

**目标：** 建立新 UI 的外壳和原语，不接业务。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| UI-01 | `tokens.ts` / `tokens.css` / Ant theme | I | — |
| UI-02 | 8 个 primitives（Button/Field/Sheet/PageHeader/Toolbar/ItemRow/StatusTag/EmptyState） | I | UI-01 |
| UI-03 | `AppShell`：侧栏/底部导航/container query | I | UI-01 |
| UI-04 | 显式路由 + `validateSearch` + 路由 lazy | I | UI-03 |
| UI-05 | `FeatureGate` / `Banner` / `Skeleton` / `ErrorBoundary` | I | W0 |
| UI-06 | `/ui` kitchen-sink + 状态示例 | I | UI-02 |
| UI-07 | 视觉回归 + axe 基线（390/768/1440） | I | UI-03 |

**Exit：** 新壳层可独立预览；0 死类名；视觉基线；不依赖数据。

### Wave 3 · 读界面（I）

**目标：** 用 I 接口替换列表/搜索/详情/历史/目录。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| LST-01 | 列表：`useItemQuery` + `ItemRow` + 分页 | I | W1/W2 |
| LST-02 | 组展开：`query_items(catalog_node_ids)` | I | LST-01 |
| LST-03 | 搜索/筛选/排序/游标/stale | I | LST-01 |
| LST-04 | 选择/批量/移动入口 | I | LST-01 |
| DET-01 | 详情：`DetailAdapter` + 新档案布局 | I | W1/W2 |
| DET-02 | 历史/笔记摘要/附件占位 | I/F | DET-01 |
| CAT-01 | 目录：`useCatalogQuery` + 树 | I | W1/W2 |
| ACT-01 | 动态：`useHistoryQuery` + 人话 feed | I | W1/W2 |
| PERF-01 | 删除本地 `productGroups`/`searchInventory`；索引 | I | LST-01 |

**Exit：** 在线列表/搜索/详情/目录/动态全部走 I 接口；无本地统计；5k 基准；视觉验收。

### Wave 4 · 写流程（I）

**目标：** 现有命令全部切到新 Sheet；不加 F 功能。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| FRM-01 | Sheet/Field/Draft 原语 | I | W2 |
| FRM-02 | 入库（已有/新商品） | I | FRM-01 |
| FRM-03 | 消耗/移动/编辑/笔记/开封 | I | FRM-01 |
| FRM-04 | 错误/冲突/幂等/离线恢复 | I | W0/W4 |
| FRM-05 | 手机全屏 Sheet + ActionBar | I | FRM-01 |
| FRM-06 | 打印/标签回归 | I | FRM-01 |

**Exit：** 所有现有写命令可用；错误恢复；打印不回归；5 人任务测试。

### Wave 5 · 能力驱动（F）

**目标：** 设计并实现 profile/capabilities/deadline/stock/void/split/references 的 UI，默认隐藏。

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| CAP-01 | profile/capabilities 徽标/分组 | F | W1/W2 |
| CAP-02 | `TemplateDefinition.fields` 动态表单 | F | CAP-01 |
| CAP-03 | deadline 区块/日期筛选/完成 | F | CAP-01 |
| CAP-04 | stock/补货 | F | CAP-01 |
| CAP-05 | void/split/dispose 菜单与确认 | F | CAP-01 |
| CAP-06 | references/units 字段 | F | CAP-02 |
| CAP-07 | F 功能矩阵与 mock 测试 | F | CAP-01..06 |

**Exit：** baseline 下完全隐藏；mock features 下可用；后端启用 key 后只开 flag。

### Wave 6 · 笔记与附件（F）

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| NTS-01 | `list_notes`/`get_note` hook | F | W5 |
| NTS-02 | 笔记摘要/正文/归档 UI | F | NTS-01 |
| ATT-01 | 上传票据/PUT/complete | F | W5 |
| ATT-02 | 缩略图/画廊/排序 | F | ATT-01 |
| ATT-03 | 25 MiB/20/5 GiB/类型错误 | F | ATT-01 |
| ATT-04 | 敏感/redaction/reveal 审计 | F | ATT-02 |
| ATT-05 | 附件 fixture/浏览器测试 | F | ATT-01..04 |

**Exit：** baseline 无入口；F 下完整上传/显示/错误；无公开 URL。

### Wave 7 · 同步（F）

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| SYN-01 | sync state/generation 客户端 | F | W1 |
| SYN-02 | bootstrap/changes/fetch | F | SYN-01 |
| SYN-03 | 离线缓存/重置/墓碑 | F | SYN-02 |
| SYN-04 | 冲突/断线/Android 协调测试 | F | SYN-03 |

**Exit：** `sync_v2` 未开时仍用全量快照；开启后不影响 Web 首屏。

### Wave 8 · 清理与发布（I）

| ID | 任务 | I/F | 依赖 |
| --- | --- | --- | --- |
| CLN-01 | 删除旧页面/旧列表/旧详情/死 CSS | I | W3/W4 |
| CLN-02 | 删除本地 `productGroups`/`searchInventory` | I | PERF-01 |
| CLN-03 | bundle/route split/5k 性能 | I | W3 |
| CLN-04 | a11y/视觉回归/axe | I | W2/W3 |
| CLN-05 | 文档/运行手册/回滚 | I | 全部 |
| CLN-06 | 全量回归 + 默认开关 | I | 全部 |

**Exit：** 一套实现；指标达标；回滚路径验证。

---

## 7. 任务清单与依赖

- 完整 60+ 任务见 [frontend-refactor-tasks.csv](./frontend-refactor-tasks.csv)。
- 关键路径：

```text
FND-01 → FND-02 → ADP-01/03 → UI-03/04 → LST-01/DET-01 → FRM-02/03 → CLN-06
```

- 并行：
  - W2 设计系统与 W1 适配层并行；
  - W5/6/7 的 F UI 在 W4 后并行，用 mock + feature flag；
  - 插件 lane 与 Web lane 并行，共用适配层。

---

## 8. 测试策略

| 层 | 测试 | 覆盖 |
| --- | --- | --- |
| 契约 | `contracts-v2.test.ts` | v1/v2 快照、旧/新详情、查询结果、错误信封 |
| 适配 | `adapters.test.ts` | 缺失字段默认、notes→summary、日期、groups、template |
| 查询 | `query-hooks.test.ts` | cursor、stale、INVALID_CURSOR、条件变化清游标 |
| 功能开关 | `features.test.ts` | baseline/all/单个 F；F 入口不存在 |
| 浏览器 | `refactor.spec.ts` | 列表/详情/搜索/表单/移动端 |
| 视觉 | `toHaveScreenshot` | 390/768/1440；列表/详情/空/错误 |
| a11y | axe | 5 页；0 critical |
| 性能 | `query-performance.test.ts` + 前端基准 | 5k 物品输入 <100ms；无本地 O(n²) |
| 错误 | `errors.test.ts` | 新错误码/recovery/不重试协议错误 |

**fixtures 必须包含：**

- v1 snapshot（含 notes）；
- v2 snapshot（无 notes，含 groups/next_date/note_count）；
- v1 get_item 扁平 + notes 正文；
- v2 ItemDetail（dates/notes/attachments/split）；
- query 第一页/下一页/stale/INVALID_CURSOR；
- 空结果/未知模板/退役模板/redacted_paths；
- 所有 F 能力的 mock（deadline/attachment/profile 等）。

---

## 9. 灰度与回滚

- 开发/评审：`?ui=next`；生产默认旧入口，W3 通过后切新入口。
- `F` 功能由 `features` 控制；未返回 key 时入口不存在。
- 旧页面保留到 W8；按路由/开关切换，不做数据迁移。
- 回滚：关闭 `ui=next`；附件/同步未启用时无新缓存需要清理；已启用则清本地缓存并重新 bootstrap。
- 发布前跑：typecheck、build、unit、browser、visual、axe、5k 基准。

---

## 10. 验收

### 10.1 每波 gate

| Wave | Gate |
| --- | --- |
| 0 | 协议头/基线 features/错误码/fixtures |
| 1 | v1/v2 适配；无 F 默认正确；单测 |
| 2 | 设计系统/壳层；0 死类；视觉基线 |
| 3 | 列表/详情/搜索/目录/动态全走 I；无本地统计 |
| 4 | 现有写命令全可用；错误恢复；打印 |
| 5 | baseline 无 F 入口；mock 全开可用 |
| 6 | 附件限制/错误/敏感；baseline 隐藏 |
| 7 | sync 关闭不影响；开启可 bootstrap/changes |
| 8 | 一套实现；5k/axe/视觉/回归 |

### 10.2 产品指标

- 入库 ≤3 动作；消耗 ≤3；移动 ≤3；搜索 ≤2。
- 详情首屏 3 个指标 + 1 主操作。
- 20 件 ≤1800px（1440）/ ≤2400px（390）。
- 5 人任务测试 ≥4/5。

### 10.3 工程指标

- 初始 JS gzip ≤350KB；路由 chunk ≤80KB。
- 5k 物品输入 <100ms；筛选 <200ms。
- axe 0 critical；0 未定义 className。
- 无本地 `productGroups`/`searchInventory` 调用（CLN-02 后）。

---

## 11. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| `detail_v2` 缺 FeatureKey | 详情门控不确定 | 形状检测；建议 v2.x 追加；不私自加 flag |
| `protocol_v2` / context 未实现 | 无法发现 features | baseline `query_v2`+`history_v2`；发协议头无害 |
| 读 POST 未实现 | 只能用 GET | 保留 GET；F 后切 POST；接口封装 |
| v1 快照含 notes | 列表可能误用正文 | 适配器只输出 `note_count`/摘要；列表不读正文 |
| `groups_v2` 未实现 | 筛选后组统计不完整 | 默认用 snapshot.groups；筛选后总数用 summary；组内标“本页” |
| 插件 envelope v1 | 无法接 v2 快照 | 可选字段 + 形状检测；不破坏 v1 |
| sync F | 离线仍全量 | 不接 sync；保留快照离线；F 后再替换 |
| Android 共用契约 | 终端受影响 | 契约变更同步 Android；fixture 测试 |
| 范围过大 | 一次交付风险 | 一个分支 + 波次 gate；旧入口保留到 W8 |
| F 未上线 | UI 空转 | mock 开发 + feature flag；不显示入口 |

---

## 12. 现在就开始的第一步

Wave 0 不依赖任何 F 实现，可以立即做：

1. `read-v2.ts` + fixtures；
2. `ConnectionProvider` + baseline；
3. 协议头 + 错误码；
4. `InventoryTransport.context()`；
5. 形状检测。

产出：一个不改页面的 PR，所有请求带协议头，`features` 缺失时自动 baseline，旧快照/旧详情可被适配，测试通过。

**需要后端确认的一件事：** 是否在 `v2.x` 追加 `detail_v2` 可选 key；如果不追加，前端按 `isItemDetailV2` 形状检测运行，不阻塞。

---

## 附录 A · Feature Registry 代码草案

```tsx
const SAFE: FeatureKey[] = ['query_v2', 'history_v2'];

export function FeatureProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['connection-context'],
    queryFn: () => read<ConnectionContext>('get_connection_context', {}),
    staleTime: 60_000,
  });
  const ctx = q.data;
  const features = useMemo(() => resolveFeatures(ctx), [ctx]);
  return <FeatureContext.Provider value={{ ctx, features }}>{children}</FeatureContext.Provider>;
}

export function useFeature(key: FeatureKey) {
  return useContext(FeatureContext).features.has(key);
}
```

## 附录 B · 适配器代码草案

```ts
export function adaptItemDetail(raw: unknown, snapshot: InventoryView): ItemDetailView {
  if (isItemDetailV2(raw)) return normalizeV2Detail(raw);
  const flat = raw as LegacyItemDetail;
  return {
    item: adaptItem(flat, snapshot.notesByItem[flat.id] ?? []),
    path_ids: flat.path_ids ?? [],
    dates: reminderToDates(flat.reminder, snapshot.household.timezone),
    notes: (flat.notes ?? []).map(noteToSummary),
    attachments: [],
    split: null,
  };
}
```

## 附录 C · 任务清单

完整任务、I/F、依赖、文件与验收见 [frontend-refactor-tasks.csv](./frontend-refactor-tasks.csv)。

## 附录 D · 文件变更地图

| 区域 | 主要文件 |
| --- | --- |
| 契约 | `packages/contracts/src/read-v2.ts`、`errors.ts` |
| 连接/协议 | `apps/web/src/features/api/connection.tsx`、`protocol.ts`、`apps/web/src/lib/api.ts`、`runtime.ts`、`plugin/client.ts` |
| 适配 | `apps/web/src/features/inventory/adapters/*`、`model/*` |
| 页面 | `apps/web/src/features/inventory/screens/*`、`app/router.tsx`、`app/shell/*` |
| 设计系统 | `apps/web/src/ui/tokens.*`、`ui/primitives/*`、`ui/patterns/*` |
| 写流程 | `apps/web/src/features/*/sheets/*`、`write.ts` |
| F 功能 | `features/attachments/*`、`features/sync/*`、`features/notes/*` |
| 测试 | `tests/fixtures/read-v2/*`、`tests/web/*`、`tests/browser/refactor.spec.ts` |
