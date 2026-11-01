# 松仓正式版前端方案（Quiet Ledger）

> 基线：`docs/repair/frozen-interfaces.md` / `v2-2026-10-31`  
> 参考原型：`apps/web/src/prototype/ItemsPrototype.tsx`（仅源码设计参考，运行入口已移除）  
> 现有阶段代码：`apps/web/src/next/`（`?ui=next`）  
> 状态：**方案冻结，等待执行**。本文件描述正式版目标、页面规格、组件/数据架构、写流程、测试与切换顺序。

---

## 0. 结论与目标

### 0.1 方向

采用 **Quiet Ledger（安静的家庭账本）**：

- 暖纸色背景 + 单一陶土主色，不使用渐变/玻璃拟态/彩色阴影。
- 桌面是「侧栏 + 固定列账本」；手机是「紧凑头部 + 单列卡片行 + 底部导航」。
- 每个物品有一个 38px 分类图标字块；图标是识别锚点，照片上线后作为增强。
- 默认状态退后；只显示异常（已过期、临期、借出、维修、未记录）。
- 分类分组用 10px eyebrow，不用全宽色带；同分类内按关注度排序。
- 所有页面只读 View Model，不读模板路径/attributes，不本地重算 groups。

### 0.2 范围

**正式版覆盖全部可见前端：**

1. 新壳层：桌面侧栏、手机底部导航、页面头部。
2. 我的物品：列表、筛选、搜索、分类分组、位置视图、关注视图、批量选择。
3. 单件档案：详情、资料、日期、笔记、历史、附件（F 时隐藏）。
4. 商品目录：分类树、SKU 列表、商品详情、新建商品。
5. 动态：事件流、日期分组、目标解析、过滤/分页。
6. 搜索：服务端搜索、最近搜索、结果分组。
7. 设置：家庭、账号、打印、缓存、安装、开发者工具、退出。
8. 写流程：入库、消耗、移动、编辑、笔记、打印；F 能力按开关隐藏。
9. 离线/错误/空/加载/冲突恢复。

**非目标（本波不做）：**

- 后端契约字段扩展；F 接口真实实现。
- 原生 App/桌面端。
- 深色模式；先保证 light-only 一致性。
- 复杂报表/图表；库存不是 BI。

### 0.3 完成标准

- 默认入口切到新版；`?ui=legacy` 仍可回退一个版本周期。
- 1440 / 1024 / 390 三个宽度通过视觉与交互验收。
- 无原生 `<select>`、无原始 UUID 出现在主信息中、无页面直接读 `attributes`。
- `F` 能力无入口；`I` 能力全部可用；`INVALID_CURSOR` / `stale` / 离线有明确恢复。
- 新 UI 浏览器测试、视觉回归、axe 通过；旧浏览器测试完成迁移或显式跳过。
- 关键页面 LCP 与 bundle 预算达标。

---

## 1. 设计语言规格

### 1.1 色彩

保持现有主色，新增**分类色**与**语义色**两套，互不混用。

#### 基础色（已有 tokens）

| Token           | 值        | 用途                 |
| --------------- | --------- | -------------------- |
| `paper`         | `#F6F0E6` | 页面背景             |
| `surface`       | `#FFFCF6` | 面板/行              |
| `surfaceRaised` | `#FFFFFF` | 浮层/菜单            |
| `ink`           | `#2B2420` | 主文字               |
| `ink2`          | `#51463D` | 次级文字             |
| `muted`         | `#68615C` | 辅助文字             |
| `line`          | `#E8DFD2` | 行分隔               |
| `lineStrong`    | `#D8C9B8` | 分组/外边框          |
| `accent`        | `#AB5F40` | 主操作/当前导航/选中 |
| `accentHover`   | `#965136` | 主操作 hover         |
| `accentSoft`    | `#F5E5D8` | 选中底/焦点光环      |

#### 分类色（只用于图标字块）

| 分类           | 背景      | 图标      |
| -------------- | --------- | --------- |
| 食品/饮料      | `#F3E6D5` | `#7A541F` |
| 衣物           | `#F3E1E1` | `#8B4A4A` |
| 电子/设备      | `#E2ECF0` | `#3F5F6E` |
| 日用/清洁      | `#E8EFE4` | `#526A4A` |
| 文件/工具/其他 | `#EEE7DC` | `#6E5A3C` |

> 新增 token：`--ac-cat-food`, `--ac-cat-food-ink`, `--ac-cat-clothing`, `--ac-cat-clothing-ink`, `--ac-cat-device`, `--ac-cat-device-ink`, `--ac-cat-cleaning`, `--ac-cat-cleaning-ink`, `--ac-cat-neutral`, `--ac-cat-neutral-ink`。分类色不得用于行背景或按钮。

#### 语义色（只用于状态）

| 语义               | 文字      | 浅底      |
| ------------------ | --------- | --------- |
| danger 已过期/作废 | `#A33828` | `#F7E2DC` |
| warning 临期       | `#A9742A` | `#F6EAD6` |
| success 可用       | `#5F7358` | `#E8EFE4` |
| info 借出/运输     | `#4F6B7A` | `#E4EDF0` |
| neutral 未记录     | `#68615C` | `#F1EBE2` |

规则：

1. `accent` 只给主操作、当前导航、选中行、焦点环。
2. 默认“在库”用 11px muted 文本，不挂彩色 pill。
3. 异常 badge 最多一个；不要同时挂“临期”和“在库”。
4. 颜色不是唯一信号；badge 必须有文字。

### 1.2 字体与数字

| 角色               | 规格                                |
| ------------------ | ----------------------------------- |
| Display / 页面标题 | Songti SC 30px / 1.2 / 600 / 0.02em |
| Title / 面板标题   | Songti SC 18px / 1.3 / 600          |
| Row / 行标题       | PingFang SC 15px / 1.35 / 600       |
| Body / 正文        | PingFang SC 14px / 1.5 / 400        |
| Micro / 元信息     | PingFang SC 12px / 1.4 / 500        |
| Eyebrow / 分组标签 | 10px / 1.2 / 600 / 0.08em           |
| Status / 状态      | 10.5px / 1 / 500                    |

- 所有数字 `font-variant-numeric: tabular-nums`。
- 日期统一 `MM-DD`，跨年才显示年份；相对天数用中文：`已过期 29 天`、`临期 3 天`、`今天到期`。
- 英文品牌字距 0.08em；中文正文不加字距。
- 移动端行标题不低于 15px，元信息不低于 12px。

### 1.3 间距、圆角、阴影

- 间距：4 / 8 / 12 / 16 / 24 / 32 / 48。
- 行高：桌面 64px；移动 64px + 自动换行；设置行 56px。
- 控件：桌面 36px；触屏 44px。
- 圆角：控件 8px；图标字块 10px；面板 12px；badge 999px。
- 阴影：只用于 Sheet/菜单/Toast；内容面不用阴影。
- 分隔：内容行 1px `line`；分组之间 1px `lineStrong`；禁止双边框。

### 1.4 图标

**统一用 Lucide，1.5px 描边，尺寸 14/16/18/20，不混用其他图标集。**

| 类别/关键词   | 图标                 |
| ------------- | -------------------- |
| 食品          | `Apple`              |
| 乳品/牛奶     | `Milk`               |
| 主食/米面     | `Soup`               |
| 饮料/咖啡     | `CupSoda` / `Coffee` |
| 衣物          | `Shirt`              |
| 电子/USB/充电 | `Plug`               |
| 清洁/洗衣     | `SprayCan`           |
| 文件/证件     | `FileText`           |
| 工具          | `Wrench`             |
| 药品          | `Pill`               |
| 宠物          | `PawPrint`           |
| 其他/兜底     | `Package`            |

- 分类字块 38px，背景分类色，图标 18px，图标色为分类深色。
- 图标按**商品关键词**匹配；匹配不到用**分类图标**；再兜底 `Package`。
- 分类图标注册表放在 `ui/icons/category.ts`；页面不得内联 SVG path。
- 装饰图标 `aria-hidden`；操作图标必须有 `aria-label`。

### 1.5 动效

- 行 hover 120ms；筛选结果 120ms；Sheet 180ms；侧栏选中 120ms。
- 不做弹跳/视差/循环动画；`prefers-reduced-motion` 下全部关闭。
- Skeleton 只做 1.6s opacity pulse；不使用 spinner 占满内容区。

---

## 2. 信息架构与路由

### 2.1 路由

| 路由                      | 页面             | 说明                                             |
| ------------------------- | ---------------- | ------------------------------------------------ |
| `/`                       | Redirect         | → `/items`                                       |
| `/items`                  | 我的物品         | 全部；支持 `?view=&location=&category=&q=&sort=` |
| `/places/:id`             | 我的物品（位置） | 等价于 `?location=:id`                           |
| `/search`                 | 搜索             | 服务端搜索；`?q=`                                |
| `/items/:id`              | 单件档案         | 兼容 `/items/:id/details`                        |
| `/items/group/:catalogId` | 商品实物         | 兼容旧链接；内部转 `/catalog/:id` 过滤           |
| `/catalog`                | 商品目录         | 分类树 + SKU                                     |
| `/catalog/:id`            | 商品详情         | SKU/分类节点                                     |
| `/activity`               | 动态             | 事件流                                           |
| `/settings`               | 设置             | 新 SettingsScreen                                |
| `/settings/account`       | 账号与安全       | 复用 AccountSettings，套新壳                     |
| `/settings/households`    | 家庭与成员       | 复用 HouseholdSettings                           |
| `/settings/printer`       | 打印             | PrinterSettings                                  |

### 2.2 Search params

用 TanStack Router `validateSearch` + Zod：

```ts
{
  ui?: 'next' | 'legacy';
  view?: 'all' | 'attention';
  location?: string;
  category?: string;
  q?: string;
  sort?: 'attention' | 'name' | 'created';
}
```

- 游标不入 URL；筛选/排序变化清空游标，回到第一页。
- 返回/前进保留筛选；刷新保留。
- `?ui=legacy` 保留一个版本周期；新版默认后删除。

### 2.3 壳层

- 桌面：248px 侧栏 + 内容 `max-width: 1180px`。
- 侧栏：品牌、主导航、视图（全部/需留意）、位置列表、设置。
- 手机：隐藏侧栏，底部 64px 导航（物品/目录/动态/设置）；页面头部保留标题 + 添加。
- 内容区：`padding: 42px 48px`；手机 `24px 16px`。
- 列头 sticky 在内容滚动容器顶部；不遮挡页面头部。

---

## 3. 页面规格

### 3.1 我的物品（`/items`）

#### 数据

- `useItemQuery`：服务端搜索、排序、游标、summary、stale。
- `useInventoryView`：catalog / item / location 参考。
- `useInventory`：容器判断与 household timezone。
- **禁止** `productGroups`、`searchInventory`、offset 分页。

#### 查询输入

| 场景     | 参数                                                              |
| -------- | ----------------------------------------------------------------- |
| 全部     | `limit:50`, `sort:{created_at:desc}`                              |
| 位置     | `within_item_id`                                                  |
| 商品分类 | `catalog_subtree_id`（GROUP）或 `catalog_node_ids:[id]`（SKU）    |
| 搜索     | `search`                                                          |
| 状态     | `attribute_filters` on `lifecycle.state`（I）                     |
| 关注     | 客户端基于日期/状态过滤；`deadline` F 后改用服务端 `date_filters` |

> **契约缺口（必须解决）：** 当前 `query_items` 返回容器实例，`summary` 也含容器；原型用客户端过滤。正式版在 `query_items` 增加 `exclude_containers`（或等价参数）之前，不得把 `summary.matching_count` 标成“物品数”。在服务端支持前：客户端过滤容器，计数用已加载物理物品数，并标注“当前结果”。默认切换前优先补服务端参数。

#### 分组

- 按分类分组（食品与饮品 / 衣物 / 设备与配件 / 日用与清洁 / 文件与工具 / 其他）。
- 分类从 catalog 祖先路径推导；不依赖 `profile`（F）。
- 同分类内：异常优先（danger → warning），再按异常天数，再按名称。
- 不显示全宽组头；使用 10px eyebrow + 右侧计数。
- 每个物理物品一行；同款 6 瓶牛奶仍是 6 行，保留逐件身份。

#### 工具栏

- 搜索框 370px；带 Search 图标；`/` 聚焦；Esc 清空。
- “需留意”筛选按钮：漏斗图标 + 计数；active 用 accent-soft。
- 排序按钮：`按关注度` / `按名称`，带上下箭头。
- 不出现原生 `<select>`；位置/分类筛选走侧栏或 FilterButton + 菜单。

#### 行

固定列：`40 图标 / 1.45fr 物品 / 0.9fr 位置 / 1.05fr 关键信息 / 118 状态 / 32 操作`。

- 物品：名称 + 商品名/规格（次级）。
- 位置：完整路径；未记录显示“未记录位置”。
- 关键信息：到期日 + 余量，普通文本，用 `·` 分隔，不用 chip。
- 状态：默认“在库”11px muted；异常用 badge（已过期 N 天 / 临期 N 天 / 今天到期 / 借出 / 维修）。
- 操作：`⋯` 默认 opacity 0，hover/focus 出现；触屏常显。
- 行点击打开详情；checkbox 仅在选择模式出现；不要用行点击做选择。

#### 状态

- 首屏 skeleton：图标块 + 两行文字，不用整页 spinner。
- `stale`：顶部细 banner “有新变更，刷新查看最新” + 刷新。
- `INVALID_CURSOR`：清空分页，从第一页重取；不要复用旧游标。
- 空：分“无物品 / 无搜索结果 / 位置为空”三种文案；一个主操作。
- 离线：读快照，写禁用；离开线时提示。
- 错误：请求 ID 可折叠；提供重试。

#### 批量

- 头部“选择”进入选择模式；行前 checkbox；底部 BatchBar。
- 批量移动、批量打印；批量消耗/作废在 F 后按命令能力开放。
- 选择模式不改变行点击；点击行仍打开详情，checkbox 单独选。

#### 验收

- 11 件物理物品不包含容器；6 件过期牛奶显示 `已过期 N 天` 且排序最前。
- 1440/1024/390 无横向溢出；无原生 select；无原始 UUID。
- 键盘：Tab 到搜索/筛选/行/操作；`/` 聚焦；焦点环可见。
- `?ui=next` 与 `?ui=legacy` 都能打开；新版无 console error。

### 3.2 单件档案（`/items/:id`）

- `get_item` + `adaptItemDetail`；形状检测 `isItemDetailV2`。
- Header：返回 + 名称 + 位置；右侧编辑。
- 身份行：状态 badge + redaction 提示。
- 三指标：剩余 / 到期（相对天数）/ 位置或状态；不要重复状态 tag。
- 主操作：记录消耗、移动；更多：开封、整件用完、打印、作废（F）。
- 资料：只显示已记录 facts + 日期；空时“还没有补充资料” + 编辑。
- 笔记：前 3 条摘要；添加笔记；`notes_v2` 后支持正文页。
- 最近变化：`get_history` target item；错误可重试。
- 附件：`attachments` F 时完全不渲染；开启后缩略图网格。
- 技术信息：折叠 `<details>`；UUID 只在这里。
- 终端/作废：状态优先，禁用不适用操作。
- 移动端：单列；操作在首屏；底部导航保留。

### 3.3 商品目录（`/catalog`）

- 左分类树 + 右 SKU 列表（桌面）；手机分类抽屉。
- `query_catalog_nodes` 游标；搜索；分类子树。
- SKU 行：名称、品牌/规格、分类路径、在库件数、位置数、chevron。
- 商品详情：名称、规格、分类、在库、近期动态、编辑/新增实物。
- 新建商品 Sheet：名称、分类、模板字段（F 时旧字段）。
- 批量整理/合并分类暂不做；放到后续。
- 空/错误/加载同列表规则。

### 3.4 动态（`/activity`）

- `get_history` 游标；按日分组；事件人话标签；目标名称解析；原因。
- 过滤：事件类型/日期在 `history_v2` 基础上；date 过滤 F 时隐藏。
- 不显示原始 diff/UUID；目标未知时不显示，不猜。
- 空：一句话 + 返回物品。
- 加载更早；stale 提示。

### 3.5 设置（`/settings`）

- 新 SettingsScreen：家庭、打印、缓存、安装、开发者工具、退出。
- 账号/家庭/打印子页保留现有业务组件，套新壳。
- 缓存范围统计要排除容器；在服务端参数落地前用物理物品数。
- 退出确认；离线禁用。
- MCP 宿主模式：只读说明 + 刷新库存，不显示账号/家庭入口。

### 3.6 搜索（`/search`）

- 独立搜索页：服务端 `query_items.search`；分类/位置过滤。
- 最近搜索 localStorage（最多 8 条）；可清除。
- 无结果时给“搜索全部位置 / 清除筛选”。
- 不本地过滤大列表。

---

## 4. 组件与代码架构

### 4.1 目录重组

把 `apps/web/src/next/` 的临时结构迁到 feature 目录：

```text
apps/web/src/
  app/
    router.tsx              # TanStack Router 显式树
    providers.tsx           # Session / Connection / Inventory / Query
    shell/
      AppShell.tsx
      Sidebar.tsx
      MobileTabBar.tsx
  features/
    items/
      screens/ItemsScreen.tsx
      components/ItemsToolbar.tsx
      components/Ledger.tsx
      components/LedgerRow.tsx
      components/AttentionBadge.tsx
      selectors/category.ts
      selectors/attention.ts
      selectors/counts.ts
    item-detail/
    catalog/
    activity/
    settings/
    search/
    writes/
      IntakeSheet.tsx
      ConsumeSheet.tsx
      MoveSheet.tsx
      EditSheet.tsx
      NoteSheet.tsx
      PrintSheet.tsx
  ui/
    tokens.ts / tokens.css
    icons/
      Icon.tsx
      category.ts
    primitives/
      Button / IconButton / StatusBadge / FactChip / Metric / PageHeader /
      Section / Toolbar / ItemRow / Sheet / Field / EmptyState / Skeleton
    patterns/
      SearchField / FilterButton / FilterChip / LedgerHeader / BatchBar
```

`prototype/` 只保留作设计参考；正式版不 import。`?prototype=1` 运行入口已删除。

### 4.2 组件契约

| 组件           | Props 要点                       | 状态                           |
| -------------- | -------------------------------- | ------------------------------ |
| `ItemGlyph`    | `name, product, category, size`  | 分类图标/兜底                  |
| `LedgerRow`    | `item, selected, onOpen, onMore` | hover/focus/selected/attention |
| `LedgerHeader` | `sticky`                         | 列头                           |
| `StatusBadge`  | `kind, label, days`              | danger/warning/neutral         |
| `SearchField`  | `value, onChange, onSubmit`      | focus/clear                    |
| `FilterButton` | `label, count, active`           | active                         |
| `Sheet`        | `title, footer, busy, onClose`   | open/busy/error                |
| `BatchBar`     | `count, actions`                 | visible                        |
| `EmptyState`   | `title, description, action`     | —                              |
| `SkeletonRows` | `rows`                           | —                              |

### 4.3 设计系统规则

1. 页面不直接 import `antd`；Ant 只在 primitives/Sheet/复杂表单内部使用。
2. 页面不写 hex；颜色只从 tokens/分类 registry 来。
3. 一个文件只负责一个页面或一个 pattern；不复制行 CSS。
4. 所有 icon 从 `ui/icons` 取；不在页面内联 SVG。
5. 所有交互元素有 hover/focus-visible/disabled 状态；不可只靠颜色。
6. 组件必须有 `aria-*`；行打开详情用 button/link，不用可点击 div。

### 4.4 图标依赖

- 添加 `lucide-react`（tree-shaken）；若 bundle 超预算，改为 `ui/icons/lucide.ts` 只导出用到的 12 个图标。
- 原型内联 path 不进入正式版。
- 图标尺寸/描边由 `Icon` 统一；不要在 JSX 手写 `strokeWidth`。

---

## 5. 数据与 View Model

### 5.1 分层

```text
ConnectionProvider (features/protocol)
  └─ SnapshotProvider (v1/v2 adapter)
       └─ InventoryView (catalog/items/groups/locations)
            └─ selectors (category/attention/counts)
                 └─ screens/components

ReadApi (query_items/query_catalog_nodes/get_history/get_item)
  └─ adapters (query/detail)
       └─ View Model
```

### 5.2 View Model 扩展

在 `ItemView` 增加（adapter 计算，页面不计算）：

```ts
type ItemView = {
  ...
  categoryPath: string[];
  category: string;
  glyph: CategoryGlyph;
  expiryDate?: string;
  remaining?: string;
  attention: Attention | null;
};
```

`Attention`：

```ts
type Attention =
  | { kind: 'expired'; days: number; label: string }
  | { kind: 'today'; label: string }
  | { kind: 'soon'; days: number; label: string }
  | { kind: 'void'; label: string }
  | { kind: 'borrowed' | 'maintenance' | 'missing'; label: string }
  | null;
```

- 日期计算用 household timezone；`todayFor` 放 `features/items/selectors/attention.ts`。
- 优先级：void > expired > today > soon > borrowed/maintenance/missing > null。
- `deadline` F 时用 `lifecycle.expiry`/`reminder`；F 后改用 `DateFact`。
- `category` 从 catalog 祖先推导；没有分类→其他。
- 计数：物理物品数、商品种数、需留意数；容器不计入。

### 5.3 查询/状态规则

- Query key 包含 household、session cache key、query input；切换家庭必须隔离。
- `keepPreviousData` 保留旧页，但筛选变化显示轻量加载态。
- 游标只存 `next_cursor`；不把 cursor 放 URL；不 offset。
- `INVALID_CURSOR` 重置；`stale` banner；`CURSOR_STALE` 同。
- 特征：`useFeature` 只决定入口；无 features 时 baseline `query_v2/history_v2`。
- 不可用功能不渲染；不显示 disabled 的空入口。

---

## 6. 写流程

所有写操作统一生命周期：

```text
open → draft → validate → confirm → submit(idempotency_key)
  → success: close + refresh/局部更新 + toast
  → conflict: 保留草稿 + 解释 + 重新读取
  → network: 保留草稿 + 重试
  → permission: 只读/不可用
```

规则：

- 提交中禁止关闭；关闭需确认丢弃草稿。
- 一个 Sheet 一个主操作；取消是次操作。
- 表单错误就地显示，不用全局 alert。
- 成功后刷新相关 query + snapshot；不做整页刷新。
- 写失败保留输入；错误带 request_id。
- 离线写禁用；`sync_v2` F 前不做假队列。
- 幂等键在打开 Sheet 时生成；重试复用同一个键。
- 不允许以原始 UUID 作为主标签；只在技术信息里出现。

### 6.1 Intake（入库）

- 选择已有商品 / 新建商品。
- 件数、位置、日期/开封/余量（可选）、模板字段（能力驱动）。
- 入库件数 1–N；每件独立身份。
- 核对页：商品、件数、位置、关键属性；确认后提交。
- 成功后回到列表并高亮新行。

### 6.2 Consume（消耗）

- 当前剩余 + 单位；本次消耗量；依据（测量/估计/整件）。
- 校验 >0 且不超剩余；提交后剩余更新。
- 整件用完走单独的 finish/void 命令（F 时用旧 finish）。

### 6.3 Move（移动）

- 目标位置选择（树 + 搜索）；当前路径；确认。
- 部分移动需要 `split` F；未开启时只移动整件。

### 6.4 Edit（编辑）

- 物品属性 vs 商品共有属性分 tab；明确提示影响范围。
- 能力驱动字段；F 字段隐藏。
- 脏表单离开确认。

### 6.5 Note（笔记）

- 标题 + 正文；v1 快照笔记正文；`notes_v2` 后正文按需取。
- 成功后更新 note_count；不在列表内联正文。

### 6.6 Print（打印）

- 复用现有标签预览/打印机设置；打印失败保留选择。

### 6.7 F 写操作

- void / split / dispose / stock replenish / attachments / sync：无 feature 不渲染入口；有 feature 时按命令能力开放。
- 先用 mock fixture 做 UI；adapter 替换，不改页面。

---

## 7. 响应式、可访问性、性能

### 7.1 响应式

- 1440：侧栏 + 1180 内容 + 六列账本。
- 1024：侧栏 214 + 内容；列宽压缩；操作 hover 仍可用。
- 767：隐藏侧栏；单列行；工具栏换行；底部导航；触控 44px。
- 390：标题 26；行 64+；无横向滚动；长位置换行/截断。

### 7.2 可访问性

- 对比度：正文 ≥4.5:1；大字 ≥3:1；badge 文字 ≥4.5:1。
- 所有按钮/链接有 accessible name；装饰图标 `aria-hidden`。
- 行打开详情用 `<button>`/`<a>`；checkbox 有 label。
- Sheet 焦点陷阱；Esc 关闭；返回焦点到触发元素。
- 键盘：`/` 搜索、Tab 顺序、Enter 打开、Esc 清空。
- `prefers-reduced-motion` 关闭动效。
- 状态不只靠颜色：文字 + 图标/点。

### 7.3 性能

- 路由级 lazy；目录/设置/详情独立 chunk。
- 列表超过 200 行用虚拟化（`@tanstack/react-virtual`）；首屏 50 行不做。
- 图标按需导入；不引入整套图标库。
- 图片懒加载；附件缩略图尺寸固定。
- 目标：初始 JS gzip < 350KB（不包含认证/打印），列表交互 <100ms。
- 避免每行创建大对象；View Model 用 memo/selector。

---

## 8. 测试与验收

### 8.1 单元

- category：路径推导/顺序/fallback。
- attention：过期/今天/临期/void/无日期/时区边界。
- counts：容器排除、需留意数。
- 日期格式/相对天数。
- 图标映射：关键词优先级（洗衣液→清洁，不是衣物）。
- 适配器：v1/v2 snapshot/detail。

### 8.2 组件/视觉

- 每个 primitive 的 default/hover/focus/disabled/loading。
- LedgerRow 的默认/异常/选中/空。
- 1440/1024/390 截图；Chromatic 或 Playwright snapshot。
- 无原生 select、无 UUID、无 `item_` 文本。

### 8.3 浏览器

- 新 UI 冒烟：列表/目录/动态/设置/移动底栏。
- 真实写流程：入库 → 列表高亮；消耗 → 剩余变化；移动 → 位置变化；笔记 → 详情。
- 游标：滚动加载、筛选重置、`INVALID_CURSOR` 注入。
- 离线/错误/空/无权限。
- 键盘/axe。
- 旧 UI `?ui=legacy` 回归。

### 8.4 门禁

| 门禁 | 条件                                       |
| ---- | ------------------------------------------ |
| G0   | 原型设计确认；tokens/分类/图标冻结         |
| G1   | 列表 production 完成；视觉/键盘/移动端通过 |
| G2   | 详情/目录/动态/设置完成；F 入口检查        |
| G3   | 写流程完成；冲突/离线/幂等测试             |
| G4   | 新浏览器测试通过；旧测试迁移               |
| G5   | 默认切换；旧 UI 保留回退                   |
| G6   | 清理旧代码；性能/axe/视觉回归通过          |

---

## 9. 分阶段实施

> 估算为熟悉代码库的 1 名工程师；并行 subagent 可压缩，但不改变依赖顺序。不含后端新增 `exclude_containers` 等契约工作。

### Phase 0 · 设计冻结（0.5–1 天）

- 确认 Quiet Ledger；分类/图标/Lucide/侧栏/移动底栏。
- 把原型截图、tokens、分类映射写入文档。
- `?prototype=1` 运行入口已删除；原型只保留源码与截图。

**验收：** 设计决策无未决项；图标映射表确认。

### Phase 1 · 设计系统生产化（2–3 天）

- tokens 增加分类色/字号/宽度；Lucide 依赖或 vendored icons。
- `ItemGlyph`、`LedgerRow`、`LedgerHeader`、`StatusBadge`、`SearchField`、`FilterButton`、`BatchBar`、`SkeletonRows`。
- 移除原型内联 SVG；页面不写 hex。
- 更新 kitchen-sink `/ui`。

**验收：** 组件在 1440/390 无溢出；hover/focus/disabled 完整；tokens 测试通过。

### Phase 2 · 我的物品正式版（3–4 天）

- 将原型迁移到 `features/items/screens/ItemsScreen.tsx`。
- 接 `useItemQuery`；分类/关注/位置/搜索/排序/游标。
- 容器过滤；计数校正（依赖后端参数或明确“当前结果”）。
- 行点击详情、`⋯` 菜单、选择模式/批量 Bar。
- 空/错/离线/stale/INVALID_CURSOR。
- 新 UI 浏览器测试扩展。

**验收：** G1；11 件/6 异常；无原生 select/UUID；键盘/移动通过。

### Phase 3 · 详情/目录/动态/设置/搜索（5–6 天）

- 详情页正式化（三指标、资料、笔记、历史、附件 F 隐藏）。
- 目录树 + SKU 列表 + 商品详情。
- 动态日期分组/过滤/分页。
- 新设置页 + 账号/家庭/打印子页。
- 搜索页/最近搜索。
- 壳层/路由 `validateSearch`/lazy。

**验收：** G2；所有页面 1440/390；F 能力无入口。

### Phase 4 · 写流程（5–7 天）

- Intake/Consume/Move/Edit/Note/Print Sheet。
- 草稿/校验/幂等/冲突/离线/成功刷新。
- 批量移动/打印。
- 旧 ActionSheet 退场；保留 legacy 旧 UI。

**验收：** G3；真实 HTTP 写测；错误恢复；焦点/键盘。

### Phase 5 · F 能力/离线（按后端，5+ 天）

- deadline/stock/notes_v2/attachments/void/split/sync/redaction。
- mock fixture + feature gate 测试。
- 只替换 adapter，不改页面骨架。

**验收：** 无 feature 无入口；有 feature 的 fixture 通过。

### Phase 6 · 切换/清理（3–4 天）

- 新 UI 浏览器测试全绿；旧测试迁移/标记。
- 默认切新版；`?ui=legacy` 回退。
- 删除旧页面/旧 CSS/死类名/`next/` 临时结构。
- 性能/axe/视觉回归；文档。

**验收：** G4–G6；回退路径可用；无 console error。

---

## 10. 风险与待决

| 风险                      | 影响                 | 处理                                        |
| ------------------------- | -------------------- | ------------------------------------------- |
| `query_items` 含容器      | 计数/列表错误        | 后端加 `exclude_containers`；默认切换前解决 |
| `detail_v2` 无 FeatureKey | 详情形状不确定       | 形状检测；不私有 flag                       |
| 分类是前端推导            | 同一商品跨分类不一致 | 固定 registry + catalog 祖先；文档化        |
| 图标依赖增加 bundle       | 首屏变大             | 仅导入 12 个图标；必要时 vendored           |
| 中文密度                  | 模板感过空           | 固定 64 行、12px 元信息；不照抄英文模板     |
| 旧浏览器测试              | 默认切换失败         | 先加新 spec，再改旧 spec；`?ui=legacy`      |
| 写流程复杂                | 回归风险             | 复用现有命令/幂等；先外观后拆分             |
| 离线写                    | 假队列风险           | `sync_v2` 前禁写，保留草稿                  |

### 需要确认的决策

1. **分类内是否合并同款**：当前方案是每个物理物品一行（6 瓶牛奶 = 6 行）。如果觉得太长，可加“按商品折叠”，但不替换逐件视图。
2. **行点击**：点击行打开详情；批量选择用 checkbox/选择模式，不用行点击。
3. **图标库**：Lucide 作为正式依赖，还是 vendored 12 个路径；建议先 Lucide。
4. **默认切换时间**：G4 通过后切；旧 UI 至少保留一个版本周期。
5. **容器计数**：是否接受“当前结果”计数直到后端 `exclude_containers` 上线；建议阻塞默认切换。

---

## 11. Definition of Done

- [ ] 所有页面使用 Quiet Ledger tokens/primitives，无页面级 hex/内联 SVG。
- [ ] 列表/详情/目录/动态/设置/搜索在 1440/1024/390 通过视觉与交互验收。
- [ ] 无原生 select、无原始 UUID 主标签、无 `productGroups`/`searchInventory`。
- [ ] 分类/图标/日期/异常状态语义一致；容器不计入物品。
- [ ] 写流程具备草稿、校验、幂等、冲突、离线、成功刷新。
- [ ] F 能力无入口；I 能力全部可用。
- [ ] 新 UI 浏览器/视觉/axe 测试通过；旧 UI 回退可用。
- [ ] 默认入口切新版；旧页面/死代码清理；文档更新。
