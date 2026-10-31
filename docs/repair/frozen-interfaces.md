# 松仓前端接口冻结基线 v2

> 版本：`v2-2026-10-31`  
> 状态：**前端设计基线已冻结**。标 `I` 的接口已在 `codex/data-model-v2` 实现并通过 Wave 1 验收；标 `F` 的接口已冻结、尚未实现，前端必须通过 `features` 开关灰化，不得假设已可用。  
> 变更规则：新增可选字段不升协议版本；删除字段、改变字段语义、改变默认值必须升 `v3` 或新增 `v2.x` 兼容字段。前端只依赖本文件，不直接依赖 `docs/repair/06-storage-contracts.md` 的实现细节。

## 1. 通用约定

| 约定 | 冻结值 |
| --- | --- |
| 实体 ID | `<kind>_<uuid>`；前端不得截断、拼接或解析 UUID |
| 日期 | `YYYY-MM-DD`，按家庭时区解释；不做 UTC 转换 |
| 时间戳 | RFC 3339，带偏移；服务端返回 UTC/家庭时区均可，前端只做展示 |
| 数量 | 十进制字符串，禁止 `Number` 参与精确计算 |
| 未知 | 字段缺失或 `null` 都表示“未记录”；不要补 `ACTIVE`、`AVAILABLE`、`0` |
| 分页 | opaque `cursor`；禁止把游标当 offset；非法/跨家庭/条件变化返回 `INVALID_CURSOR` |
| 默认页大小 | 100，最大 200 |
| 写请求 | 必须带 `idempotency_key` 和 `expected_revisions`；创建命令除外 |
| 写结果 | `operation_id`、`changed`、`affected_objects`、`event_ids`、`summary` |
| 协议头 | HTTP 所有业务请求带 `X-Acornary-Protocol: 2` |
| 能力发现 | `get_connection_context` / `GET /api/context` 返回 `protocol` 和 `features` |

### 1.1 错误信封

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id: string;
    recovery:
      | 'RETRY_SAME_REQUEST'
      | 'REREAD_AND_REVIEW'
      | 'REAUTHORIZE'
      | 'FIX_REQUEST'
      | 'RECOVER_ORIGINAL_REQUEST';
  };
};
```

新增稳定错误码：

| code | HTTP | 前端处理 |
| --- | --- | --- |
| `PROTOCOL_VERSION_UNSUPPORTED` | 409 | 提示升级客户端；不要重试写请求 |
| `INVALID_CURSOR` | 400 | 清空当前列表游标，从第一页重新加载 |
| `CURSOR_STALE` | 409 | 仅冻结导出使用；重新 `begin_export` |
| `UNSUPPORTED_WRITE_ISOLATION` | 400 | 内部错误；提示重试，不应由 UI 触发 |
| `ATTACHMENT_TOO_LARGE` | 413 | 提示 25 MiB 限制 |
| `ATTACHMENT_QUOTA_EXCEEDED` | 409 | 提示家庭 5 GiB 配额 |
| `ATTACHMENT_TYPE_UNSUPPORTED` | 400 | 只允许 JPEG/PNG/WebP/PDF |
| `REFERENCE_INVALID` | 400 | 引用的 Actor/Item/SKU 不存在或跨家庭 |
| `STATE_CONFLICT` | 409 | 作废/处置/拆分前置条件不满足；重新读取详情 |
| `SYNC_RESET_REQUIRED` | 409 | 同步代次变化/游标过早；清空本地缓存重新 bootstrap |
| `REVEAL_AUDIT_REQUIRED` | 400 | 展开敏感原文缺少显式确认参数 |
| `SPLIT_NOT_CONSERVED` | 400 | 拆分数量/内容量不守恒 |

### 1.2 协议与能力发现

```ts
type ConnectionContext = {
  protocol: { current: 2; min: 2 };
  features: FeatureKey[];
  household: { id: string; name: string; timezone: string };
  actor: { id: string; name: string };
  connection?: { server_origin: string; mode: 'local' | 'cloud'; scopes: string[] };
};

type FeatureKey =
  | 'query_v2'
  | 'history_v2'
  | 'snapshot_v2'
  | 'groups_v2'
  | 'profile_capabilities'
  | 'deadline'
  | 'stock'
  | 'notes_v2'
  | 'attachments'
  | 'void'
  | 'split'
  | 'references'
  | 'units_v2'
  | 'sync_v2'
  | 'frozen_export'
  | 'redaction_v2'
  | 'protocol_v2';
```

`I`（服务端）：`query_v2`、`history_v2`、`snapshot_v2`、`groups_v2`、`sync_v2`、`profile_capabilities`、`deadline`、`notes_v2`、`attachments`（媒体/字节门禁除外）、`stock`、`void`、`split`、`references`、`units_v2`。`protocol_v2` 由 `ACORNARY_REQUIRE_PROTOCOL_V2=1` 启用；`redaction_v2` 为 PARTIAL；冻结导出已实现。  
前端规则：**任何 `F` 功能在 `features` 未返回前不得显示入口**；不要用“后端已合并”推断功能可用。

### 1.3 传输、鉴权与 CSRF

| 用途 | 冻结端点 | 状态 |
| --- | --- | --- |
| 能力发现 | `GET /api/context` | I（v2 字段 F） |
| 读操作 | `POST /api/read/:operation`，JSON body | F；当前只有 `GET /api/read/:operation?input=` |
| 写操作 | `POST /api/write/:operation`，JSON body | I |
| 快照 | `GET /api/ui/snapshot` | I（v2 形状 F） |
| 附件上传 | `PUT /api/attachments/upload/:upload_id` | F |
| 附件下载 | `GET /api/attachments/:id`、`?variant=thumb` | F |
| 同步 | `GET /api/sync/state`、`/changes`、`/bootstrap`、`POST /api/sync/fetch` | F |

- 鉴权使用会话 Cookie 或既有 MCP/OAuth；前端不得把 token 放进 URL。
- 所有写请求必须同源，并带 `X-Acornary-Request: web`、`Content-Type: application/json`；否则 403。
- 所有业务请求带 `X-Acornary-Protocol: 2`。
- 读请求可以是 GET 兼容形式；v2 新前端统一用 POST JSON，避免 URL 长度和编码问题。

## 2. 读模型

### 2.1 快照

```http
GET /api/ui/snapshot
X-Acornary-Protocol: 2
```

```ts
type SnapshotV2 = {
  protocol: 2;
  household: { id: string; name: string; timezone: string };
  as_of_change_id: string;      // 十进制字符串；0 表示同步状态尚未建立
  server_time: string;
  catalog: CatalogRecord[];
  items: ItemRecord[];
  groups: ProductGroup[];
  cached_at: string;
};
```

冻结规则：

- **不再包含 `notes` 正文**。列表需要的“有无笔记/附件”用 `note_count`、`attachment_count`；正文用 `list_notes`/`get_note`。
- `groups` 由服务端计算；前端不得再用本地 `productGroups` 重算统计。
- `as_of_change_id` 用于判断快照新旧；显示“数据截至某变更”时使用它。
- 离线的“完整基础库存”只包含 `catalog/items/groups`；笔记正文、附件、历史按需缓存。
- `F`：`snapshot_v2`。当前 v1 快照字段不同，重构时以本类型为准。

### 2.2 目录记录

```ts
type Profile = 'CONSUMABLE' | 'DURABLE' | 'WEARABLE' | 'SPACE' | 'MISC';

type RecordState = 'VALID' | 'VOID';

type AttributeBinding = {
  template_id: string;
  template_version: number;      // 正整数；不再限定 1|2
  values: Record<string, unknown>;
  status: 'KNOWN' | 'UNKNOWN' | 'RETIRED';
};

type CatalogRecord = {
  id: string;
  parent_id: string | null;
  kind: 'GROUP' | 'SKU';
  name: string;
  revision: number;
  profile: Profile | null;
  capabilities: CapabilityKey[] | null;        // null=继承 profile 默认；[]=关闭可选能力
  effective_capabilities: CapabilityKey[];     // 服务端解析结果，只读
  one_off: boolean;
  record_state: RecordState;
  voided_at: string | null;
  attributes: AttributeBinding[];
  created_at: string;
  updated_at: string;
  redacted_paths: string[];                    // 例：['asset.serial_no']
};
```

### 2.3 物品记录

```ts
type ItemRecord = {
  id: string;
  parent_id: string | null;
  catalog_node_id: string;
  display_name: string | null;
  revision: number;
  record_state: RecordState;
  voided_at: string | null;
  effective_capabilities: CapabilityKey[];     // 继承自 SKU
  attributes: AttributeBinding[];
  created_at: string;
  updated_at: string;
  note_count: number;
  attachment_count: number;
  next_date: DateFact | null;                  // 最早未完成日期，列表徽标用
  split: SplitInfo | null;
  redacted_paths: string[];
};
```

### 2.4 商品分组

```ts
type ProductGroup = {
  id: string;                    // SKU ID
  name: string;
  profile: Profile | null;
  count: number;                 // 匹配记录数
  current_count: number;         // 排除终态，含未知状态
  opened: number;
  sealed: number;
  unknown_opening: number;
  unknown_lifecycle: number;
  locations: number;
  totals: {
    unit: 'mL' | 'g' | 'count' | 'percent' | string;
    value: string;
    estimated: boolean;
    unknown_accuracy: boolean;
  }[];
  unknown_quantity: number;
  next_date: DateFact | null;
  overdue_count: number;
  low_stock: boolean | null;     // null=无法判断
};
```

- 不返回 `item_ids`；需要具体实例时调用 `query_items({ catalog_node_ids: [group.id] })`。
- 旧字段 `opened/sealed/unknown_opening/unknown_lifecycle/locations/totals/unknown_quantity` 名称保留，避免前端二次映射。

## 3. 查询

### 3.1 `query_items`

```ts
type ItemQuery = {
  search?: string;
  name?: string;
  barcode?: string;
  catalog_node_ids?: string[];
  catalog_subtree_id?: string;
  within_item_id?: string;
  profile?: Profile;
  capabilities?: CapabilityKey[];       // 必须全部具备
  attribute_filters?: {
    template_id: string;
    path: string;
    op: 'eq' | 'gte' | 'lte';
    value: unknown;
  }[];
  date_filters?: DateFilter[];
  include_path?: boolean;               // 默认 false
  include_void?: boolean;               // 默认 false
  include_terminal?: boolean;           // 默认 false
  sort?: {
    field: 'created_at' | 'updated_at' | 'name' | 'reminder_date';
    direction: 'asc' | 'desc';
  };
  cursor?: string;
  limit?: number;
};
```

默认：`sort = { field: 'created_at', direction: 'desc' }`；`limit = 100`。  

**状态：** `search/sort/cursor/limit` 为 I；`profile/capabilities/date_filters/include_void/include_terminal` 为 F。当前服务端默认仍包含终态，前端在 F 未启用前不要依赖“默认排除终态”。
`search` 与 `name` 都按 NFKC → 小写 → 空白折叠 → trim 后匹配；同时给出时取 AND。  
`date_filters` 内多个条件必须命中**同一条** `DateFact`；不同 filter 之间 AND。  
`capabilities` 是“全部具备”，不是“任一具备”。

```ts
type ItemQueryResult = {
  data: ItemRecord[];
  next_cursor: string | null;
  matching_count: number;
  current_count: number;
  unknown_lifecycle_count: number;
  unknown_availability_count: number;
  content_totals: {
    by_unit: Record<string, {
      value: string;
      measured_count: number;
      estimated_count: number;
      unknown_accuracy_count: number;
    }>;
    unknown_quantity_count: number;
    unconvertible_percentage_count: number;
  };
  as_of_change_id: string;
  stale: boolean;
  summary: {
    matching_count: number;
    current_count?: number;
    unknown_lifecycle_count?: number;
    unknown_availability_count?: number;
    content_totals?: ItemQueryResult['content_totals'];
    as_of_change_id: string;
  };
};
```

- `stale=true`：翻页期间家庭有变更；允许继续翻页，UI 提示“刷新查看最新”。
- 统计始终覆盖**完整匹配集合**，不是当前页。
- 列表 `data` 不内联笔记正文/历史/附件二进制。

### 3.2 `query_catalog_nodes`

请求在 `query_items` 基础上：

```ts
type CatalogQuery = {
  kind?: 'GROUP' | 'SKU';
  include_hidden?: boolean;   // 默认 false
  profile?: Profile;
  capabilities?: CapabilityKey[];
  search?: string;
  name?: string;
  barcode?: string;
  catalog_subtree_id?: string;
  attribute_filters?: ItemQuery['attribute_filters'];
  sort?: { field: 'created_at' | 'updated_at' | 'name'; direction: 'asc' | 'desc' };
  cursor?: string;
  limit?: number;
};

type CatalogQueryResult = {
  data: CatalogRecord[];
  next_cursor: string | null;
  matching_count: number;
  as_of_change_id: string;
  stale: boolean;
  summary: { matching_count: number; as_of_change_id: string };
};
```

**状态：** `kind/search/sort/cursor/include_hidden` 为 I；`profile/capabilities` 过滤为 F。

### 3.3 `get_history`

```ts
type HistoryQuery = {
  target?: { kind: 'ITEM' | 'CATALOG_NODE'; id: string };
  operation_id?: string;
  event_type?: string;
  recorded_from?: string;   // inclusive
  recorded_to?: string;     // inclusive
  cursor?: string;
  limit?: number;
};

type HistoryEvent = {
  id: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  target_id: string;
  operation_id: string;
  event_type: string;
  before_revision: number;
  after_revision: number;
  changes: {
    path: string;
    before_present: boolean;
    after_present: boolean;
    before?: unknown;
    after?: unknown;
    template_id?: string;
    template_version?: number;
  }[];
  reason: string | null;
  actor_id: string;
  source: 'WEB' | 'MCP' | 'TERMINAL' | 'IMPORT' | 'SYSTEM' | string;
  occurred_at: string;
  recorded_at: string;
};

type HistoryResult = {
  data: HistoryEvent[];
  next_cursor: string | null;
  as_of_change_id: string;
  stale: boolean;
  summary: { as_of_change_id: string };
};
```

### 3.4 `query_inventory_groups`（F）

```http
POST /api/read/query_inventory_groups
```

输入同 `ItemQuery`（去掉 `include_path/sort`），输出：

```ts
type InventoryGroupsResult = {
  groups: ProductGroup[];
  matching_group_count: number;
  as_of_change_id: string;
  stale: boolean;
};
```

### 3.5 `query_stock`（F）

```ts
type StockQuery = {
  catalog_node_ids?: string[];
  catalog_subtree_id?: string;
  within_item_id?: string;
  low_only?: boolean;
  cursor?: string;
  limit?: number;
};

type StockStatus = {
  catalog_node_id: string;
  name: string;
  profile: Profile | null;
  basis: 'COUNT' | 'CONTENT';
  unit: string;
  threshold: string | null;
  target: string | null;
  current_count: number | null;
  current_content: string | null;
  unknown_count: number;
  low: boolean | null;
  gap: string | null;
};

type StockResult = {
  data: StockStatus[];
  next_cursor: string | null;
  matching_count: number;
  as_of_change_id: string;
  stale: boolean;
};
```

## 4. 详情

### 4.1 `get_item`

```ts
type ItemDetail = {
  item: ItemRecord;
  path_ids: string[];
  dates: DateFact[];
  notes: NoteSummary[];
  attachments: AttachmentSummary[];
  split: SplitInfo | null;
};
```

- 默认 `reveal_sensitive=false`；敏感字段以 `redacted_paths` 标记并省略值。
- `reveal_sensitive=true` 时返回原文，并写访问审计；不得进入基础离线缓存。
- 笔记正文不通过 `get_item` 全量返回；`notes` 是摘要。

**状态：** 当前 `get_item` 返回扁平对象和笔记正文；`ItemDetail` 包装、`dates`、附件摘要、`reveal_sensitive` 均为 F。前端按本类型设计，等 `detail_v2`/`deadline`/`attachments` feature。

### 4.2 `get_catalog_node`

```ts
type CatalogDetail = {
  node: CatalogRecord;
  path_ids: string[];
  templates: TemplateDefinition[];   // 该 SKU 可用的模板
};
```

### 4.3 模板目录

```ts
type TemplateField = {
  path: string;
  label: string;
  type: 'string' | 'number' | 'decimal' | 'boolean' | 'date' | 'datetime'
      | 'enum' | 'measurement' | 'reference' | 'url';
  section: string;
  order: number;
  widget?: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'switch'
         | 'measurement' | 'reference' | 'photo' | 'link';
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
  sensitivity?: Sensitivity;
};

type TemplateDefinition = {
  id: string;
  version: number;
  name: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  capability?: CapabilityKey;
  allowed_catalog_node_kinds: ('GROUP' | 'SKU')[];
  paths: string[];
  fields: TemplateField[];
  schema?: Record<string, unknown>;
};

type ListTemplatesQuery = {
  target_kind?: 'ITEM' | 'CATALOG_NODE';
  catalog_node_id?: string;
  profile?: Profile;
  capability?: CapabilityKey;
};

type ListTemplatesResult = { data: TemplateDefinition[] };
```

`I`：当前 `list_attribute_templates` 只返回旧字段，没有 `fields/ui/capability` 过滤；前端必须等 `profile_capabilities` feature。

### 4.4 模板绑定

- 未知/退役模板：`status` 为 `UNKNOWN`/`RETIRED`，`values` 原样保留，前端只读展示“未知模板 vN”。
- 写未知/退役版本明确拒绝；移动/改名/加笔记不得丢弃未知绑定。
- 绑定数量上限 16。
- `upgrade_attributes` 使用 `{target, template_id, from_version, to_version, values, expected_revisions, idempotency_key}`。

## 5. 档案 / 能力

### 5.1 profile 与 capabilities

`Profile` 五值，允许 `null`。`capabilities=null` 继承 profile 默认；`[]` 关闭可选能力；显式数组完整覆盖。

| profile | 默认能力 |
| --- | --- |
| `CONSUMABLE` | `lifecycle.expiry`、`lifecycle.opening`、`contents`、`stock` |
| `DURABLE` | `asset`、`custody`、`service`、`deadline` |
| `WEARABLE` | `clothing`、`wardrobe`、`asset`、`custody`、`service` |
| `SPACE` | `container` |
| `MISC` | `asset`、`custody` |
| `null` | `[]`，可手动发现合法能力 |

```ts
type CapabilityKey =
  | 'lifecycle.expiry'
  | 'lifecycle.opening'
  | 'contents'
  | 'stock'
  | 'asset'
  | 'custody'
  | 'service'
  | 'deadline'
  | 'clothing'
  | 'wardrobe'
  | 'container'
  | 'usage'
  | 'transport';
```

- `lifecycle` 的 state/condition/acquisition 是基础字段，始终可用；`lifecycle.availability` 是旧资料，只读。
- `container` 独立；冰箱/行李箱可以同时是商品和容器。
- 修改 profile 不删除历史绑定；前端只改变表单建议。
- `effective_capabilities` 由服务端解析；前端不要自己复制默认表。

### 5.2 冻结的 ITEM 模板值

```ts
type UsageValues = { state?: 'IDLE' | 'IN_USE' };

type CustodyValues = {
  owner?: Reference;
  holder?: Reference;
  since?: string;                 // YYYY-MM-DD
  status?: 'OWNED' | 'LOANED_OUT' | 'BORROWED_IN';
  note?: string;
};

type ServiceValues = {
  state?: 'NONE' | 'CLEANING' | 'REPAIR' | 'MAINTENANCE';
  last_service_on?: string;
  interval_days?: number;
  provider?: string;
  note?: string;
};

type TransportValues = {
  state?: 'IN_TRANSIT' | 'AT_DESTINATION';
  expected_on?: string;
};

type WardrobeValues = {
  owner?: Reference;
  size_override?: string;
  season?: ('SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER' | 'ALL')[];
  care_state?: 'CLEAN' | 'DIRTY' | 'REPAIR';
};

type AssetValues = {
  serial_no?: string;
  imei?: string;
  mac?: string;
  price?: { amount: string; currency: string };
  vendor?: string;
  manual_url?: string;
};

type StockValues = {
  basis: 'COUNT' | 'CONTENT';
  reorder_threshold?: string;     // CONTENT 时为同 unit 的数量
  target?: string;
  content_unit?: string;          // CONTENT 必填
};

type DispositionValues = {
  kind: 'SALE' | 'GIFT' | 'DONATION' | 'RETURN' | 'DISCARD';
  date: string;
  recipient?: Reference;
  recipient_name?: string;
  note?: string;
};

type Reference =
  | { kind: 'ACTOR'; id: string }
  | { kind: 'ITEM'; id: string }
  | { kind: 'CATALOG_NODE'; id: string }
  | { kind: 'EXTERNAL'; name: string };
```

- `custody.due_on`、`service.next_service_on`、`asset.warranty_until` **不存在**；归还/保修/维护到期只写 `deadline`。
- 外部借用人用 `{ kind: 'EXTERNAL', name }`，不创建账号。
- `asset` 不存购入日期（在 `lifecycle.acquisition.acquired_on`）。

## 6. 日期

### 6.1 `deadline` 条目

```ts
type DeadlineKind =
  | 'WARRANTY_END'
  | 'SERVICE_DUE'
  | 'RETURN_BY'
  | 'RENEWAL'
  | 'REORDER_BY';

type DeadlineEntry = {
  id: string;                    // deadline_<uuid>，稳定；不得用数组下标
  kind: DeadlineKind;
  due_on: string;                // YYYY-MM-DD
  recurrence_days?: number | null;
  last_completed_on?: string | null;
  basis?: string;
  note?: string;
};
```

### 6.2 统一日期视图

```ts
type DateSource = 'LIFECYCLE' | 'DEADLINE';
type DateState = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'UNKNOWN';

type DateFact = {
  key: string;                   // 'lifecycle.expiry' | 'lifecycle.opening' | 'deadline.<id>'
  source: DateSource;
  kind: 'EXPIRY' | DeadlineKind;
  date_kind?: 'BEST_BEFORE' | 'USE_BY' | 'ESTIMATED';
  due_on: string;
  basis: string | null;
  state: DateState;
  completed_on: string | null;
  label: string;                 // 例：'保质期'、'保修到期'、'应还'
};

type DateFilter = {
  kind?: DateFact['kind'];
  source?: DateSource;
  from?: string;                 // inclusive
  to?: string;                   // inclusive
  state?: DateState;
};
```

- `reminder_date` = 最早 `due_on` 且 `state != COMPLETED` 的日期；没有则 `null`。
- 食品 `lifecycle.expiry` 保留原位；开封后期限派生为 `key='lifecycle.opening'`，不重复写 deadline。
- 同一 `DateFilter` 的类型/范围/状态必须命中同一条 `DateFact`。

### 6.3 deadline 写命令

```ts
type AddDeadline = {
  item_id: string;
  entry: Omit<DeadlineEntry, 'id' | 'last_completed_on'>;
  expected_revisions: Record<string, number>;
  idempotency_key: string;
  occurred_at?: string;
};

type UpdateDeadline = {
  item_id: string;
  entry_id: string;
  patch: Partial<Omit<DeadlineEntry, 'id' | 'last_completed_on'>>;
  expected_revisions: Record<string, number>;
  idempotency_key: string;
};

type RemoveDeadline = {
  item_id: string;
  entry_id: string;
  expected_revisions: Record<string, number>;
  idempotency_key: string;
};

type CompleteDeadline = {
  item_id: string;
  entry_id: string;
  completed_on: string;          // 用户明确提交，不猜今天
  expected_revisions: Record<string, number>;
  idempotency_key: string;
};
```

- 完成一次性条目：写入 `last_completed_on`，日期状态 `COMPLETED`，不再出现在待办。
- 完成周期条目：同一条目 `last_completed_on = completed_on`，`due_on = completed_on + recurrence_days`（自然日，按家庭时区）。
- 完成 `SERVICE_DUE`：同一事务更新 `service.last_service_on`，不写第二份日期。
- 命令名固定：`add_deadline`、`update_deadline`、`remove_deadline`、`complete_deadline`。

## 7. 笔记

```ts
type NoteTarget =
  | { kind: 'ITEM'; id: string }
  | { kind: 'CATALOG_NODE'; id: string };

type NoteSummary = {
  id: string;
  target: NoteTarget;
  title: string | null;
  excerpt: string;               // 服务端截断，最多 160 字符
  created_by: string;            // actor id
  created_at: string;
  updated_by: string;
  updated_at: string;
  archived: boolean;
  sensitivity: Sensitivity;
};

type Note = NoteSummary & {
  body: string;                  // Markdown
  body_format: 'Markdown';
  sensitivity: Sensitivity;
};

type NoteListResult = {
  data: NoteSummary[];
  next_cursor: string | null;
  as_of_change_id: string;
  stale: boolean;
};
```

命令：

| 命令 | 输入 | 说明 |
| --- | --- | --- |
| `list_notes` | `{target?, include_archived?, cursor?, limit?}` | 返回 `NoteSummary[]`，不含正文 |
| `get_note` | `{note_id}` | 返回 `Note` |
| `add_note` | `{target, title?, body, expected_revisions, idempotency_key}` | 归属目标 revision 递增 |
| `update_note` | `{note_id, title?, body, expected_revisions, idempotency_key}` | 归属目标 revision 递增 |
| `archive_note` | `{note_id, archived, expected_revisions, idempotency_key}` | 软归档，不删历史 |

- `expected_revisions` 的键是**笔记所属目标对象**（Item/CatalogNode），不是 note_id。
- 笔记正文不进入快照；列表只显示 `excerpt`。
- 搜索仍可命中笔记正文，但响应不返回正文。

## 8. 附件

```ts
type Sensitivity = 'NORMAL' | 'SENSITIVE' | 'SECRET';

type AttachmentTarget = NoteTarget | { kind: 'NOTE'; id: string };

type AttachmentSummary = {
  id: string;                    // attachment_<uuid>
  target: AttachmentTarget;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  file_size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  sort_order: number;
  sensitivity: Sensitivity;
  created_at: string;
  thumbnail_url: string | null;  // 相对 API 路径，需鉴权
};
```

### 8.1 上传流程

```ts
type CreateUpload = {
  target: AttachmentTarget;
  filename: string;
  mime_type: AttachmentSummary['mime_type'];
  file_size: number;
  sha256?: string;
  idempotency_key: string;
};

type UploadTicket = {
  upload_id: string;
  upload_url: string;            // 同源 /api/attachments/upload/:id
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;            // 5 分钟
  max_size: number;
};

type CompleteUpload = {
  upload_id: string;
  target: AttachmentTarget;
  caption?: string;
  sort_order?: number;
  expected_revisions: Record<string, number>;
  idempotency_key: string;
};
```

- `create_attachment_upload` → `UploadTicket`；前端用 `PUT upload_url` 上传二进制，带返回的 headers。
- `complete_attachment_upload` → `AttachmentSummary`；只有完成关联才递增目标 revision、发事件。
- `detach_attachment({ attachment_id, expected_revisions, idempotency_key })` 解除关联。
- `list_attachments({ target, cursor?, limit? })` → `{ data: AttachmentSummary[]; next_cursor: string | null }`。
- `complete_attachment_upload` 返回 `WriteResult & { attachment: AttachmentSummary }`。
- `GET /api/attachments/:id` 返回鉴权二进制；`?variant=thumb` 返回缩略图。
- 限制：25 MiB/文件、20 个有效附件/目标、5 GiB/家庭；只允许 JPEG/PNG/WebP/PDF；服务端剥 EXIF；PDF 强制下载 + `nosniff`；禁止 SVG/HTML。
- 票据在 `_meta`/请求头，不进 URL、日志或模型输出。
- 基础快照只含 `attachment_count`，不含附件正文。

## 9. 写命令

### 9.1 公共信封

```ts
type WriteBase = {
  idempotency_key: string;
  expected_revisions: Record<string, number>;
  occurred_at?: string;
};

type AffectedObject = {
  kind: 'ITEM' | 'CATALOG_NODE';
  id: string;
  before_revision: number;
  after_revision: number;
};

type WriteResult = {
  operation_id: string;
  changed: boolean;
  affected_objects: AffectedObject[];
  event_ids: string[];
  summary: string;
};

type CreateItemsResult = WriteResult & {
  created_items?: { client_ref: string; item_id: string; after_revision: number }[];
};
type AddDeadlineResult = WriteResult & { entry: DeadlineEntry };
type UpdateDeadlineResult = WriteResult & { entry: DeadlineEntry };
type RemoveDeadlineResult = WriteResult;
type CompleteDeadlineResult = WriteResult & { entry: DeadlineEntry };
type AddNoteResult = WriteResult & { note: NoteSummary };
type UpdateNoteResult = WriteResult & { note: NoteSummary };
type CompleteAttachmentUploadResult = WriteResult & { attachment: AttachmentSummary };
type SplitItemResult = WriteResult & { split: SplitInfo; children: { item_id: string; revision: number }[] };
```

### 9.2 已有命令（字段名冻结）

| 命令 | 关键输入 |
| --- | --- |
| `create_catalog_node` | `kind, name, parent_id, profile?, capabilities?, one_off?, initial_attributes?` |
| `update_catalog_node` | `catalog_node_id, name?, profile?, capabilities?, one_off?` |
| `move_catalog_node` | `catalog_node_id, parent_id` |
| `create_items` / `create_items_batch` | `catalog_node_id, count, parent_id?, display_name?, initial_attributes?` |
| `update_item` | `item_id, display_name` |
| `move_item` / `move_items` | `item_id` / `item_ids, parent_id` |
| `open_item` | `item_id, opened_at?` |
| `consume_items` | `item_ids` |
| `consume_item_content` | `item_id, amount, accuracy?` |
| `correct_item` | `item_id, reason, core?, attributes?` |
| `bind_attributes` / `update_attributes` / `remove_attributes` | `target, template_id, template_version, values / set+unset` |
| `upgrade_attributes` | `target, template_id, from_version, to_version, values` |
| `add_note` / `update_note` / `archive_note` | 见第 7 节 |
| `add_deadline` / `update_deadline` / `remove_deadline` / `complete_deadline` | 见第 6 节 |

`update_catalog_node` 的 `profile/capabilities/one_off` 是 v2 新增；传 `null` 表示清空（capabilities 清空即继承默认）。

### 9.3 新增命令（F）

```ts
type DisposeItem = WriteBase & {
  item_id: string;
  disposition: DispositionValues;
};

type VoidItem = WriteBase & {
  item_id: string;
  reason: string;
};

type VoidCatalogNode = WriteBase & {
  catalog_node_id: string;
  reason: string;
};

type SplitItem = WriteBase & {
  source_item_id: string;
  target_catalog_node_id: string;
  count: number;                 // 1–100
  child_attributes?: { template_id: string; template_version: number; values: Record<string, unknown> }[];
  reason?: string;
};

type SplitInfo = {
  split_id: string;
  source_item_id: string;
  child_item_ids: string[];
  count: number;
  created_at: string;
};
```

- `void_item`：独立 `record_state=VOID`，不写 lifecycle；默认读集合排除；详情可查；有子物品或有效拆分后代时拒绝。
- `void_catalog_node`：只允许 SKU；无 Item、子节点、条码、身份键、别名、系统引用时允许。
- `dispose_item`：写 `disposition` 并设置 `lifecycle.state=DISPOSED`；允许 `SALE/GIFT/DONATION/RETURN/DISCARD`。
- `split_item`：源包必须非终态、有明确正数内容量、无子物品；`count` 或同一量纲内容守恒；源包 `CONSUMED` + 内容归零；子件独立 Item；来源关系用 `item_splits`，不复用 `parent_id`。
- 恢复 VOID：`correct_item({ item_id, reason, record_state: 'VALID' })`；不允许普通属性更新绕过。
- `dispose_item`/`void_item`/`split_item` 的响应包含 `WriteResult`；`split_item` 额外返回 `split: SplitInfo`。

## 10. 同步（F，Android/离线优先）

```http
GET /api/sync/state
GET /api/sync/changes?cursor=<change_id>&limit=200
POST /api/sync/fetch
GET /api/sync/bootstrap?cursor=&limit=
```

```ts
type SyncState = {
  generation: string;
  last_change_id: string;          // 十进制字符串
  min_available_change_id: string;
  protocol: 2;
};

type SyncChange = {
  change_id: string;
  object_kind: 'ITEM' | 'CATALOG_NODE' | 'NOTE' | 'ATTACHMENT';
  object_id: string;
  revision: number;
  change_kind: 'UPSERT' | 'TOMBSTONE';
};

type SyncChanges = {
  generation: string;
  changes: SyncChange[];
  next_cursor: string | null;
  has_more: boolean;
  as_of_change_id: string;
};

type SyncFetchRequest = {
  generation: string;
  ids: { kind: SyncChange['object_kind']; id: string }[];
};

type SyncFetchResult = {
  generation: string;
  objects: (ItemRecord | CatalogRecord | NoteSummary | AttachmentSummary)[];
};

type SyncBootstrap = {
  generation: string;
  as_of_change_id: string;
  next_cursor: string | null;
  has_more: boolean;
  catalog: CatalogRecord[];
  items: ItemRecord[];
  groups: ProductGroup[];
};
```

- 游标是 `change_id` 十进制字符串；不要用 `updated_at`。
- 墓碑只含身份和顺序，不含正文。
- `generation` 变化或游标早于 `min_available_change_id` → `SYNC_RESET_REQUIRED`，清空本地缓存。
- 初始同步：`bootstrap` 分页 + `changes` 追赶；每页与游标在本地同一事务提交。
- 基础缓存不含笔记正文/附件二进制。

## 11. 页面到接口

| 页面/区域 | 首屏 | 懒加载 |
| --- | --- | --- |
| 工作台列表 | `GET /api/ui/snapshot`（`snapshot_v2` 未开时用旧快照） | `query_items` 翻页/筛选 |
| 商品分组 | `snapshot.groups` | `query_inventory_groups`（F） |
| 搜索/筛选 | `query_items` / `query_catalog_nodes` | 无 |
| 单件详情 | `get_item` | `list_notes`、`list_attachments`、`get_history` |
| 日期/关注事项 | `item.next_date` / `item.dates` | `query_items` 的 `date_filters`（F） |
| 补货 | `query_stock`（F） | 无 |
| 家庭动态 | `get_history` | 按 `operation_id` 展开 |
| 添加/编辑 | 模板 `list_attribute_templates`（F 过滤） | `create_items` / `update_*` / `add_note` |
| 离线/同步 | `GET /api/sync/bootstrap`（F） | `GET /api/sync/changes` |

如果 `get_connection_context` 没有返回 `features`，前端只启用安全基线 `['query_v2','history_v2']`；其余功能隐藏，不要用旧快照字段猜。

## 12. 前端落地规则

1. 所有业务请求带 `X-Acornary-Protocol: 2`；收到 `PROTOCOL_VERSION_UNSUPPORTED` 时只提示升级，不重试。
2. 启动时调用 `get_connection_context`，用 `features` 决定入口；`F` 功能没有 feature 时完全隐藏。
3. 列表/分组统计只用服务端返回的 `groups`/`summary`，不在前端重算总数。
4. 未知字段/未知模板/未知日期保持“未记录”，不补默认值。
5. 数量用字符串 + Decimal；`percent` 不跨物品相加。
6. 游标是不透明字符串；筛选/排序变化后丢弃旧游标。
7. 列表不请求笔记正文；详情再 `list_notes`/`get_note`。
8. 附件只拿元数据，二进制通过票据/鉴权端点；不要拼公开 URL。
9. 敏感字段以 `redacted_paths` 判断；展开原文要显式请求并提示。
10. 离线只缓存基础库存；笔记正文/附件/历史按需缓存，退出/切换家庭清空。

## 13. 实现状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| `query_items` / `query_catalog_nodes` / `get_history` 新参数 | I | Wave 1 已实现；列表不内联笔记 |
| `get_item` / `get_catalog_node` | I（旧形状） | v2 包装形状 `F` |
| 快照 v2 | I | 协议头 `X-Acornary-Protocol: 2` 返回；无头保持 v1 |
| `query_inventory_groups` | I | 服务端同匹配集合聚合 |
| `profile` / `capabilities` | I | 表列、默认/覆盖、`effective_capabilities`、表单过滤 |
| `deadline` / `DateFact` | I | 模板、四个命令、`date_facts`、`date_filters` |
| 笔记 target / summaries | I | Item/CatalogNode、摘要/归档/敏感度；正文走 `get_note` |
| 附件 | PARTIAL | 元数据/票据/上传/下载/脱敏、EXIF/eXIf/XMP 剥离与尺寸已实现；缩略图/备份字节门禁未完成 |
| `void` / `split` / `dispose` / `references` / 单位 / `stock` | I | 服务端命令、反向索引、`query_stock` |
| 同步 v2 | I | state/changes/fetch/bootstrap、generation/prune |
| 协议 v2 强制 | I | `ACORNARY_REQUIRE_PROTOCOL_V2=1` 开启；默认兼容 |
| 冻结导出（QUERY04/05） | I | begin/read/cancel_export；一小时冻结、TTL、敏感披露审计 |
| 全路径脱敏 | PARTIAL | 笔记/附件/检查器/详情已覆盖；非全部读取路径 |

## 14. 变更流程

- 本文件版本 `v2-2026-10-31`；前端设计以此为基线。
- 新增可选字段：不升协议；在本文追加字段并标 `I/F`。
- 删除/重命名/改语义：升 `v3`；或新增 `v2.x` 字段并保留旧字段至下个大版本。
- 任何 `F` 接口实现后，必须在 `get_connection_context.features` 中启用对应 key，并补一条前端黄金样本。
- 后端实现与本文不一致时，以本文为前端契约，先改后端或先升版本，不允许前端静默适配两套形状。
