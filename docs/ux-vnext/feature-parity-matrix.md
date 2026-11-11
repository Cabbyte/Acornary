# 旧能力到新入口的功能对等清单

> 执行补记（2026-11-11）：回归与 CI 已恢复；共享任务、账号语义、导出和持久化的最新进度见 [执行记录](cf-launch-execution.md)。下方 C2 是规划起点，任何隔离结果均不等于真实业务对等验收。

核对日期：2026-11-11。C2 文档候选；**未进行回归、真实接线、远端写入或用户验收，没有任何行可据此宣称端到端对等通过**。与 [接口兼容矩阵](backend-compatibility-matrix.md) 的 B 编号验收用例互相引用。页面存在、操作 schema 存在、历史测试通过是三种不同证据。

## 基线与证据索引

| ID | 本轮只读核对的源码或记录 | 能证明什么 |
| --- | --- | --- |
| S0 | `git show a7252bc:apps/server/src/app.ts`、`terminal.ts`、`exports.ts`、`plugin.ts`；`apps/web/src/workspace.tsx`、`ui/forms.tsx`；`deploy/acornary.caddy` | 已部署非 CF 提交的路由/旧入口实现；不是今日线上行为重测 |
| S1 | `git diff a7252bc 18f7e04` | 仅 6 个前端/测试文件不同；入库分类误作位置的修复、SKU profile 编辑 UI；不是 CF 迁移差异 |
| S2 | `git diff a7252bc 8954479 -- packages/contracts` 无差异；`docs/cloudflare/contracts-baseline.json` | 三基线共享契约源码相同；冻结记录标注 main `18f7e04`，有 54 个操作；不证明运行时等价 |
| S3 | `apps/cloudflare/src/worker.ts`、`inventory/service.ts`、`terminal-handler.ts`、`plugin.ts`、`accounts.ts`（CF `8954479`） | CF 实现路径与权限/协议分流 |
| S4 | `apps/web/review/pages/catalog.ts`；`src/features/{daily,management,settings}/pages/` | 29 个审阅页面及受控视图模型；审阅路径不是生产路由已切换的证据 |
| S5 | `apps/web/review/pages/{TaskJourney,DailyExtrasJourney,ManagementJourney,SettingsJourney}.tsx` | 隔离示例操作、恢复、导出和设置演示；不能作为真实适配器 |
| H1 | `docs/cloudflare/acceptance.md`、其 `evidence/*.json`（2026-11-05/06） | 历史 CF 测试/远端协议范围及尚欠门槛；不同记录有不同 release，不自动归到 `8954479` 或新 UI |

旧正式基线 `a7252bc9a10018984f6b526e1149af3787cf6f1a`，main `18f7e0496ecb4fb960a6619f12f57c68b3898410`，CF `89544793352d8d8ea7be23ac7dbddaa811ddee43`。端点版本由本轮总体基线文档负责；本清单没有再次请求远端库存。差异标签：**U** 新前端未接线；**V** 非 CF/main 版本差异；**R** CF 运行时差异；**N** 新 UI 能力或产品语义待核对；**G** 明确契约/适配缺口。N 不等于已经批准新增后端权限。

## 用户任务与入口

以下每行均为“已静态映射 / 执行验收待恢复”。旧入口列区分直接 Web UI 与只由公共操作承诺的能力；不能把 API 能力写成旧 UI 已有按钮。

| ID | 旧用户任务与证据 | 新页面/入口 | 查询、命令及客户端边界 | 缺口/验收 |
| --- | --- | --- | --- | --- |
| F01 | 我的物品、搜索、商品分组、位置筛选：S0 workspace `/items`、`/search`、`/items/group/:id`、`/places/:id` | `/items`、`/search`、`/products/:id`、`/manage/items`、`/manage/locations` | `query_items`、`query_inventory_groups`、`query_catalog_nodes`、`query_stock`；Android 用 snapshot/detail，不是全部查询 API | U：全量筛选/分组统计不能从当前页推算；B02/B03 |
| F02 | 单件档案、商品资料、笔记/历史：`/items/:id`、`/catalog/:id` | `/items/:id`、`/products/:id`、`/manage/catalog` | `get_item`、`get_catalog_node`、`get_history`、`list_notes`；SKU 与实物 UUID、GROUP 层级分离 | U：共有资料/单件覆盖、模板版本、未知状态；B03/B04 |
| F03 | 已有商品入库及新商品/分类的原子入库；S0 `ActionSheet` intake | `/tasks/intake`、`/tasks/new-product` | `get_intake_context` → 必要提案/确认 → `commit_intake` → `get_intake_receipt`；Web/MCP；Android v1 无入库命令 | U/V：不能继承 SKU 分类为实物位置；数量不猜测；B05/B06 |
| F04 | 使用部分内容或整件用完；S0 consume/finish | `/tasks/consume`、单件档案、批量管理 | `consume_item_content`、`consume_items`；Android 仅单件，量为 decimal string | U：百分比按初始量百分点、未知余量不能扣减；B07 |
| F05 | 移动物品/容器/批量；S0 move | `/tasks/move`、`/manage/locations`、`/manage/bulk` | `move_item`、`move_items`；目录移动另用 `move_catalog_node` | U：位置树与分类树不可混用；所有 revision、原子回滚；B08 |
| F06 | 开封、日期和生命周期属性；S0 open/attributes；期限为公共 API 能力 | `/daily/opening`、`/daily/dates`、`/attention` | `open_item`、`update_items_lifecycle`、四个 deadline 操作；Android 开封必填时间，Web 可未知 | U：日期事实、来源、时区、周期推进；B09 |
| F07 | 留意/补货和最近变化；公共 `query_stock`、旧 `/activity` | `/attention`、`/activity` | `query_items`、`query_stock`、`get_history`；提示由已知事实投影 | U：不可把未知视为过期/缺货；全库留意总数需完整查询支持；B02/B09 |
| F08 | 添加/修改文字笔记；S0 note；归档/恢复为公共 API | `/daily/notes`、单件笔记页 | `list_notes/get_note/add_note/update_note/archive_note`；Android 只读笔记快照 | U：Item/SKU 归属、敏感展开审计与归档后历史；B10 |
| F09 | 私有附件操作；公共 API 与 HTTP 二进制通道 | `/daily/attachments` | `create_attachment_upload` → PUT bytes → `complete_attachment_upload`、`list_attachments`、`detach_attachment` | U/R：MCP 不能上传/下载字节，须引导 Web；B11 |
| F10 | 修改单件名、购入日、备注；S0 edit/rename | 单件档案、`/manage/edit` | `edit_item`、`update_item`；未提供字段保持，显式清空用 null/unset | U：不能同时暗改同款 SKU；B04/B12 |
| F11 | 目录分类/商品创建、改名、移动、治理确认；S0 catalog/rename/move/确认卡片 | `/manage/catalog`、商品资料 | `get_catalog_policy`、`propose_catalog_change`、review/confirm、`create/update/move/void_catalog_node` | U/V：SKU profile 新 UI 在 main 已增加；无引用作废、审批不能被普通确认框替代；B06/B08 |
| F12 | 空间/容器建档；S0 place | `/manage/locations` | `create_items` + 正确 SKU/初始 container 模板；容器仍是 Item | U：新位置不能写成 Catalog GROUP；B08 |
| F13 | 模板发现、精确属性编辑；S0 attributes + 公共升级/删除 API | `/manage/edit`、`/manage/catalog` | `list/get_attribute_template`、`bind/update/remove/upgrade_attributes` | U：固定绑定版本、UNKNOWN 模板只读、Measurement 整体替换；B04/B12 |
| F14 | 拆包、处置、作废；公共 API；纠错 S0 correct | `/manage/items`、`/manage/edit`、`/manage/history` | `split_item`、`dispose_item`、`void_item`、`correct_item`；恢复作废用 `correct_item.record_state=VALID` | U：恢复需原因/revision/相关审批与终结状态检查；拆包源不可借纠错复活；B13 |
| F15 | 明确选择的批量入库/移动/生命周期；公共 API，S0 批量 move/finish | `/manage/bulk`、入库任务 | `create_items_batch`、`move_items`、`update_items_lifecycle`、`consume_items` | U：跨页选集 UUID/revision 冻结、任一失败零部分提交；B05/B08/B12 |
| F16 | 历史、操作关联、反向引用与纠错原因；旧 activity/档案 + API | `/activity`、`/manage/history`、单件历史 | `get_history`、`query_references`、`correct_item` | U：operation 完整性不能由当前页事件数推断；B14 |
| F17 | 冻结导出；公共 API，不宣称旧 Web 按钮已覆盖 | 管理物品/目录导出 | `begin_export/read_export/cancel_export`；冻结 JSON 行，默认脱敏 | U/G：现已提供冻结导出端口与隔离快照，真实服务端签名游标仍待接通；B15 |
| F18 | 登录、Passkey、凭证管理、授权、邀请、家庭切换；S0 authentication/accounts/settings | `/settings`、`/settings/household`、`/settings/auth`、`/settings/members` | `/api/auth/*`、`/api/session`、`get_connection_context`；OAuth scopes 与家庭成员身份分开 | U/N/G：候选已移除无契约角色分配，真实平等成员/账号接口仍待接通；B01/B16 |
| F19 | 离线缓存、草稿、冲突、丢回执恢复；S0 lib/session/storage/draft + features/api/recovery | 根任务会话、`/settings/cache`、任务冲突/恢复面板 | 身份隔离持久化、原键原参数重放、入库回执；不能假造通用 REST operation lookup | U：本地日志不是正式持久化验收；B17 |
| F20 | 标签生成、打印设置、旧二维码/深链；S0 lib/labels、label-print、printer-settings、workspace `/i/:short` | `/daily/scan`、`/daily/labels`、`/settings/printing` | 客户端相机/二维码/蓝牙与打印日志；无公共“print”库存命令 | U/R：旧路径转换、设备权限、打印未知回执与不重打；B18 |
| F21 | 只读检查器；旧 `/api/debug` 与 Inspector | `/settings/inspector` | `/api/debug`；CF 为 SQLite 元数据，旧端 PostgreSQL | U/R：表结构不是字节相等目标；仍脱敏/只读/家庭隔离；B19 |
| F22 | MCP 内嵌库存 UI、宿主选择上下文与治理卡片；S0 plugin | 新页面未来通过 MCP 平台适配器承接；当前旧 plugin 入口保留 | 54 公共工具 + 5 个 App 工具/资源；`expected_scope`、宿主能力、OAuth | U/G：新 Web 构建不证明 MCP 自包含资源；B20 |

## 54 个公共操作的逐项归属

R/W 按冻结 registry 分类；导出 R 仍会创建/释放临时服务端快照。每项均须通过相应 B 用例，当前状态统一为 **源码已定位，行为对等待验证**。Web REST 覆盖受 registry 与端点权限约束；MCP 覆盖公开工具但附件字节有明确限制；Android 只开放下表明确标记的三个写命令，其余能力通过专用只读投影或不支持。

| 操作 | 分类 | 用户任务 | 新入口目标/验收 |
| --- | --- | --- | --- |
| `add_deadline` | W | F06 | 日期；B09 |
| `add_note` | W | F08 | 笔记；B10 |
| `archive_note` | W | F08 | 笔记；B10 |
| `begin_export` | R | F17 | 导出；B15 |
| `bind_attributes` | W | F13 | 模板/属性；B04/B12 |
| `cancel_export` | R | F17 | 导出；B15 |
| `commit_intake` | W | F03 | 入库；B05/B17 |
| `complete_attachment_upload` | W | F09 | 附件；B11；MCP 字节通道不支持 |
| `complete_deadline` | W | F06 | 日期；B09 |
| `consume_item_content` | W | F04 | 使用；B07；Android 单件支持 |
| `consume_items` | W | F04 | 使用；B07；Android 单件支持 |
| `correct_item` | W | F14 | 管理/纠错；B13 |
| `create_attachment_upload` | W | F09 | 附件；B11；MCP 字节通道不支持 |
| `create_catalog_node` | W | F11 | 目录治理；B06/B08 |
| `create_items` | W | F12 | 位置/容器；B05/B08 |
| `create_items_batch` | W | F03 | 入库；B05/B17 |
| `detach_attachment` | W | F09 | 附件；B11；MCP 字节通道不支持 |
| `dispose_item` | W | F14 | 管理/纠错；B13 |
| `edit_item` | W | F10 | 精确编辑；B12 |
| `get_attribute_template` | R | F13 | 模板/属性；B04/B12 |
| `get_catalog_node` | R | F02 | 档案/商品；B03 |
| `get_catalog_policy` | R | F11 | 目录治理；B06/B08 |
| `get_connection_context` | R | F18 | 身份/作用域；B01 |
| `get_history` | R | F16 | 历史/引用；B14 |
| `get_intake_context` | R | F03 | 入库；B05/B17 |
| `get_intake_receipt` | R | F03 | 入库；B05/B17 |
| `get_item` | R | F02 | 档案/商品；B03 |
| `get_note` | R | F08 | 笔记；B10 |
| `list_attachments` | R | F09 | 附件；B11；MCP 字节通道不支持 |
| `list_attribute_templates` | R | F13 | 模板/属性；B04/B12 |
| `list_notes` | R | F08 | 笔记；B10 |
| `move_catalog_node` | W | F11 | 目录治理；B06/B08 |
| `move_item` | W | F05 | 移动；B08 |
| `move_items` | W | F05 | 移动；B08 |
| `open_item` | W | F06 | 开封；B09；Android 要求明确时间 |
| `propose_catalog_change` | W | F11 | 目录治理；B06/B08 |
| `query_catalog_nodes` | R | F01 | 列表/搜索；B02 |
| `query_inventory_groups` | R | F01 | 列表/搜索；B02 |
| `query_items` | R | F01 | 列表/搜索；B02 |
| `query_references` | R | F16 | 历史/引用；B14 |
| `query_stock` | R | F01 | 列表/搜索；B02 |
| `read_export` | R | F17 | 导出；B15 |
| `remove_attributes` | W | F13 | 模板/属性；B04/B12 |
| `remove_deadline` | W | F06 | 日期；B09 |
| `split_item` | W | F14 | 管理/纠错；B13 |
| `update_attributes` | W | F13 | 模板/属性；B04/B12 |
| `update_catalog_node` | W | F11 | 目录治理；B06/B08 |
| `update_deadline` | W | F06 | 日期；B09 |
| `update_item` | W | F10 | 精确编辑；B12 |
| `update_items_lifecycle` | W | F06 | 日期；B09 |
| `update_note` | W | F08 | 笔记；B10 |
| `upgrade_attributes` | W | F13 | 模板/属性；B04/B12 |
| `void_catalog_node` | W | F11 | 目录治理；B06/B08 |
| `void_item` | W | F14 | 管理/纠错；B13 |

## 发布阻塞项与关闭规则

1. **U-ALL：29 页面真实接线与平台适配未验收。** 保留旧 CF 入口；每个 F 行须记录对应提交、用例、fixture、终态和用户验收，不能只勾页面截图。
2. **G-ROLE：成员角色是假定产品模型。** `settings/pages/models.ts` 的四角色与 S3 成员返回值不一致；现有账号家庭接口只有 create/rename/members/invite/revoke/leave/join，不等于角色分配接口。冻结角色修改接线，待产品决策或后端能力明确；现有邀请/离开不受此阻塞。
3. **G-EXPORT：冻结导出适配缺失。** 审阅 CSV 不是正式 API 完整范围结果；需读完签名游标、验证 disclosure/query_hash/generation 后才可转成用户选择的格式。
4. **G-PATH：MCP 路径口径。** S0/S3 实际注册 `/mcp`；旧 Caddy 原样反代，没有 `/api/mcp` 重写。早期文字中的 `/api/mcp` 不能成为新适配器地址；若另有外部代理别名，须独立只读证据确认，不在本轮改路由。
5. **G-DEEPLINK：旧二维码/详情路径与新路由待映射验收。** `/i/:short`、`/items/:id/{details,notes,history}`、`/catalog/:id`、`/places/:id`、`/items/group/:sku` 和 dialog 查询需保留语义、选择与返回上下文；不能回退首页后宣称兼容。
6. **G-UPLOAD-INGRESS：旧部署入口大小限制需独立核对。** `a7252bc:deploy/acornary.caddy` 为全站 `request_body max_size 1MB`，但旧 server 附件声明 25 MiB。源码只能证明此配置风险，未检查当前线上实际加载配置；不得声称旧正式入口已经接受 25 MiB，也不得把 CF 已有大附件能力当新 UI 对等验收。
7. **R-CLIENT：真实 MCP 宿主、物理 Android/Passkey/蓝牙打印及长期 Free 容量仍是独立门槛。** H1 协议 harness 和虚拟认证器不能关闭这些项。

本清单没有发现共享 schema 的版本增删；不据此断言全部运行时语义相同。新增页面展示的角色、全库统计、导出、历史完整性都须由真实协议支持。下一轮按 B01 → B02/B03 → B07/B17 的首个真实闭环推进，其余按接口组扩展，所有执行等待恢复回归与对应环境授权。

## 本轮集中预览发现：G-TRIAL-QUANTITY（已修候选，待复验）

2026-11-11，总负责人在 6008 连续试用已保存的 fixture 状态观察到：燕麦饮 `item_00000000-0000-4000-8000-000000000001` 日常档案余量为 **290 mL**，切到管理物品列表，同一 UUID 行仍显示 **310 mL（估计）**。这是本轮实际 UI 观察，由总负责人提供；C2 文档负责人的追加核对仅为源码读取，没有重新写入或运行回归。该问题属于 **已观察到的试用跨模式事实不一致**，不是旧生产/CF 数据迁移差异，也不能再用“待真实接线”掩盖。F01/F02/F04 的原连续试用一致性观察为失败；已补修复候选，修后手动复验和回归尚未完成。

修复前静态根因链：

- `apps/web/review/fixtures.ts:15` 把 `ItemView.facts` 的 remaining 文案固定为 `310 mL（估计）`；`review/pages/fixtures.ts:15` 起将此 ItemView 与独立 `quantity` 装配为 `DailyItemFacts`。
- `apps/web/review/pages/inventory-session.ts:199` 的消费路径更新 `current.quantity`，没有同步重投影 `current.item.facts` 的 remaining。
- `apps/web/review/pages/ManagementJourney.tsx:343` 以 `world.items.map(row => row.item)` 读取管理数据，丢弃 quantity；`:461` 起直接采用该 ItemView 列表。
- `apps/web/src/features/management/pages/ManagementPages.tsx:296` 起渲染 `item.facts`；日常 `daily-item-detail.tsx:106` 渲染 `props.facts.quantity`，两处因此读取不同层的值。

修复目标：在隔离数据适配层由当前权威 quantity 生成一致的 ItemView facts，保留未知、零、单位和精度；不可在显示组件中替换 `310` 字符串或以清空旧试用数据掩盖。旧已保存 world 也须得到正确投影。不得为此把试用执行器接入真实后端。关闭条件见兼容矩阵 B22。后续经总负责人明确授权，已新增私有 `review/pages/management-item-projection.ts`，并将 ManagementJourney 的管理列表输入改为从当前 `row.quantity` 投影 remaining 文案；复用已有 `lib/presentation.amount` Decimal formatter，保留零/未知/精度/单位，移除旧 remaining 文案但保留其他 facts。不改正式组件、领域模型或已保存 world 内容，因此已有保存试用也应用新投影。当前为已修候选，仍待集中手动复验与恢复后的回归。
