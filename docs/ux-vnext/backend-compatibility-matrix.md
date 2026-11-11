# 非 CF / CF / 新前端接口兼容矩阵

日期：2026-11-11。C2 静态核对和待执行验收设计。**回归暂停：本轮未执行下面的用例、workerd/Docker/浏览器测试、真实 Android/MCP、远端写入或部署。** [功能清单](feature-parity-matrix.md) 的 F 编号和 54 操作索引为完整用户能力入口映射。

## 比较基线和证据等级

| 对象 | 锁定提交 | 本轮核对范围 |
| --- | --- | --- |
| 已部署非 CF 源码 | `a7252bc9a10018984f6b526e1149af3787cf6f1a` / v0.13.0 | `git show` server/app、terminal、exports、plugin、Web workspace/forms、Caddy |
| main 源码 | `18f7e0496ecb4fb960a6619f12f57c68b3898410` | 与非 CF 提交差异仅 6 个前端/测试文件；分类不能继承为实物位置、草稿修复保护未知尝试、SKU profile UI |
| CF 源码 | `89544793352d8d8ea7be23ac7dbddaa811ddee43` | worker、terminal-handler、inventory、auth/accounts、plugin；本轮集成基线 |
| 新 UI | 当前集成树 `apps/web/src/features/{daily,management,settings}/pages` 与 `review/pages/catalog.ts` | 29 页面静态映射；真实适配器未验收 |

`git diff a7252bc 18f7e04` 和 `git diff a7252bc 8954479 -- packages/contracts` 是本轮只读核对，后者无输出；54 操作的 schema/描述/read 分类源文件在三版本相同。`scripts/cloudflare/contracts.ts` 比较的是 main 冻结 JSON（版本 1），不是 HTTP 路由/OAuth/Android/附件的完整协议比较；C2 没有运行该脚本。源码相同也不代表数据库/日期/错误封装或宿主行为一致。

证据标记：**S** 本轮源码静态核对；**H** 仓库历史执行记录（不代表本轮复验）；**P** 待执行。所有下表 B 用例本轮结果都是 **P**。H 的具体时间、release、环境和局限以 `docs/cloudflare/acceptance.md` 及其 receipt 为准，不将多个历史 release 合并称为当前版本全量通过。

## 接口和通道盘点（54 工具以外也必须覆盖）

旧实现路径均相对 `a7252bc:apps/server/src/`；CF 路径相对 `8954479:apps/cloudflare/src/`。公共 schema 在 `packages/contracts/src/`。

| 范围/入口 | 旧端实现 → CF 实现 | 客户端/权限/响应要求 | 用例/差异 |
| --- | --- | --- | --- |
| `GET /health`、`/api/version` | `app.ts/release.ts` → `worker.ts` | 区分版本与健康；CF health 额外 runtime/environment，非要求字节相等 | B19；R 运行时元信息差异 |
| `GET /api/session`、`/api/context`、`GET/POST /api/read/get_connection_context` | `app.ts/memberships.ts` → `worker.ts/memberships.ts` | 真实身份、家庭、timezone、protocol/features；账号/家庭头不得切换到无权身份 | B01；会话不跨 origin 共用 |
| `POST /api/read/:operation`、`POST /api/write/:operation` | `app.ts/service.ts` → `worker.ts/business-client.ts/inventory/service.ts` | Web protocol 2、家庭/账号 scope；写入同源 JSON 和 `X-Acornary-Request: web`；54 操作按 registry 分流 | B02–B17；`domainErrorStatus` 与 error details 逐项对照 |
| `GET /api/ui/snapshot`、`/api/ui/groups` | `app.ts/web.ts` → `worker.ts/inventory/web.ts` | 兼容旧投影，不可用局部 snapshot 推断服务端完整分页总数 | B02/B03 |
| `POST /api/ui/catalog-review`、`catalog-confirm` | `app.ts/intake.ts` → `worker.ts/inventory/intake.ts` | 提案/依赖版本/会话绑定的 review→confirm；审批 ID 不是布尔 confirmed | B06 |
| `GET /api/sync/state`、`changes`、`bootstrap`；`POST /api/sync/fetch` | `sync-api.ts` → `inventory/sync-api.ts` | bigint string、完整 bootstrap/fetch、变更水位、缓存覆盖；世代失效不得继续旧游标 | B02/B14/B17 |
| `POST /api/read/{begin_export,read_export,cancel_export}` | `exports.ts` → `worker.ts/inventory/exports.ts` | 显式特殊只读端点分流；同源；冻结/脱敏/签名游标，库存不变但会建临时快照 | B15 |
| `PUT /api/attachments/upload/:upload_id`；`GET /api/attachments/:id` | `app.ts/attachments.ts` → `worker.ts/attachment-upload.ts/attachment-transfer.ts` | ticket、octet-stream、25 MiB、hash、EXIF、私有读取/敏感披露；关联确认另走命令 | B11；R PG/文件→DO/R2/上传 DO |
| `GET /api/debug` | `debug.ts` → `inventory/debug.ts` | 只读、敏感脱敏、当前家庭；SQL 元数据不同可接受，业务事实不能漂移 | B19 |
| `/api/auth/*`、`/.well-known/*` | `auth.ts/accounts.ts/app.ts` → `auth.ts/accounts.ts/auth-handler.ts` | capability、邮件流程、密码、Passkey、session、OAuth/JWKS/metadata；禁用注册/恢复不能伪装可用 | B01/B16/B20；R D1/CIMD 网络 |
| `/api/auth/account/households`、`household`、`invitation` | `accounts.ts/memberships.ts` → 同名 CF 模块与 `household-accounts.ts` | create/rename/members/invite/revoke/leave/join；权限由服务端，暂无四角色分配契约 | B16；N/G 新角色 UI |
| `/api/terminal/v1/config`、`context`、`snapshot` | `terminal.ts` → `terminal-handler.ts` | config v1；client/resource/redirect/scopes；缺 terminal client 配置为 503；OAuth 身份对应家庭 | B21 |
| `GET /api/terminal/v1/items/:id`、`items/:id/history` | `terminal.ts` → `terminal-handler.ts/inventory/terminal.ts` | detail/notes/household/synced_at；history cursor；禁止跨家庭 ID | B21 |
| `POST /api/terminal/v1/commands/:operation`、`GET /api/terminal/v1/operations/:key` | `terminal.ts` → `terminal-handler.ts/inventory/terminal.ts` | 仅 open_item/consume_item_content/consume_items；整件仅 1 UUID、revision 必填、开封时间必填；回执按原操作者/家庭 | B07/B17/B21 |
| `/.well-known/assetlinks.json`、`/android/oauth/callback` | `terminal.ts` → `worker.ts` | App Links 的 origin、包名、签名指纹分别配置；两安装包身份隔离 | B18/B21；R 环境配置，不是业务语义改变 |
| `/mcp` | `app.ts/plugin.ts/mcp-input.ts` → `mcp.ts/plugin.ts/mcp-input.ts` | OAuth resource/scopes、54 schemas、工具 error/structuredContent；S 源码两边都是 `/mcp` | B20；G 早期 `/api/mcp` 文档口径待统一 |
| MCP App 工具与 resource | `plugin.ts` → `plugin.ts` | `open_inventory`、`get_inventory_view`、`apply_inventory_command`、`get_catalog_review`、`confirm_catalog_change`；`ui://acornary/inventory-v2-<hash>.html`、expected_scope、UI metadata | B20；U 新入口未承接宿主能力 |
| Web 静态资源、旧深链、Service Worker、客户端设备 API | `app.ts` + Web → Worker ASSETS + Web | 老入口仍默认；新 candidate 构建不能偷带 fixture；旧 QR 路由/离线/打印属于客户端验收 | B17/B18/B20；U |

额外配置缺口：`a7252bc:deploy/acornary.caddy` 全站请求体上限为 `1MB`，旧应用附件上限为 25 MiB。尚未核对线上实际加载的 Caddy 配置，不能推断线上上传能力；B11 应分别记录应用直连和真实入口的结果。此项先归为部署配置/旧端限制待确认，不直接归为 CF 回归。

必须逐项核对的错误语义源为 `packages/contracts/src/errors.ts`：`UNAUTHORIZED` 401，`FORBIDDEN` 403，`NOT_FOUND` 404；`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`APPROVAL_REQUIRED/EXPIRED`、`CURSOR_STALE`、`SESSION_CHANGED`、`PROTOCOL_VERSION_UNSUPPORTED` 为 409；`MISSING_EXPECTED_REVISION`、`INSUFFICIENT_CONTENT`、`UNIT_MISMATCH`、`SPLIT_NOT_CONSERVED` 为 400；`ATTACHMENT_TOO_LARGE` 为 413。HTTP wrapper、Android 特有错误和 MCP `isError/structuredContent/recovery` 分别验证；传输超时/未知错误不得归为确定失败并换键。并非所有 OAuth SDK 错误都采用此 domain 表。

## 统一夹具与判定规则

后续只在两个独立隔离实例使用同一固定种子；禁止把正式库存作为测试对象。预置家庭 H-A/H-B、用户 U-A/U-B、只读 OAuth token 和写 token；复用确定 UUID、模板绑定版本、基准时钟与时区。物品包括未知 lifecycle、余量未知、已知零、`0.1` 与高精度 decimal、已开封、终结/VOID、带敏感笔记/附件、容器及后代；目录包括 GROUP/SKU、同名不同路径、自定义 capabilities、旧模板；分页数据超过单页。

每个写序列记录前后规范化快照、affected_objects、revision、operation/event 归属与数量、回执、错误 HTTP status/code/details，以及 UI 输入/原键/审批状态。每次成功后在同实例同键重放；跨实例生成 ID 建立“返回值→逻辑对象”映射，**不能通过删除所有 ID/时间/revision 字段来使比较通过**。历史导入的 ID、revision、时间和原回执应严格保留；新生成时间只在预先声明的时钟规则下比较。

允许差异仅限：origin/client/resource/包名等配置，环境会话/令牌本身，新产生随机 ID，明确锁定的时间表示。UTC 文本→ISO UTC 可以保留同一 instant 和微秒；bigint 全程十进制字符串。H 记录旧 JSONB 聚合在 >2^53 时丢精度，应以原 SQL bigint 为审计基准并登记旧端缺陷，不能要求 CF 复制舍入错误。未知/null/缺省/零不能合并；decimal 不转 JS number；排序、页覆盖和终态必须可解释。

## 可追踪验收序列

每行均应运行正常、边界与失败分支；未列的字段仍由 schema 检查。执行后新增带提交、环境、fixture hash、客户端版本和实测结果的 receipt，本文件当前不填通过。

| ID / 功能 | 正常序列 | 边界/失败序列和必须观察的结果 | 当前证据与执行缺口 |
| --- | --- | --- | --- |
| B01 / F18 | 独立登录两端→读取 session/context→选 H-A→读 Item | 无登录、账号头不匹配、H-B UUID、成员离开/撤销后重放旧键均拒绝；旧身份异步响应不得入新缓存；缺 protocol 2 按协议报错 | S worker/memberships；H auth/HTTP；P 新 scope 接线 |
| B02 / F01/F07 | 相同筛选/排序遍历全部 query_items/catalog/groups；对照总数、未知数、分组、stock | 空集/末页/同排序值/limit 边界/更改条件复用游标；部分缓存标 partial，不把当前页当全库；bootstrap/fetch 水位一致 | H 13 个 PG read 差分；P 全筛选组合与新分页 |
| B03 / F02 | Item→SKU→GROUP path→模板属性→历史/笔记；与 snapshot/detail 对照 | 同名路径、缺失父资料、VOID、不同 capability、未知 lifecycle；不从 SKU 推导实物余量或位置 | S adapters/contracts；P 新档案 UI |
| B04 / F02/F13 | 固定模板版本读取→bind→set/unset→显式 upgrade→读取 | UNKNOWN 模板只读；Measurement 整体换；旧版本缺字段保留；冲突不能自动替换 revision | H remaining commands；P 新模板编辑全字段 |
| B05 / F03/F12/F15 | intake context→明确数量/SKU/位置→commit_intake；另测 create_items/create_items_batch | 同名歧义/覆盖截断/重复 client_ref/第 N 件失败/数量上下界；失败无目录、物品、事件或部分 receipt；同键重放原 UUID | H native intake；P 新表单与双端命令序列 |
| B06 / F03/F11 | 读取 policy→propose→对应 Web 或 MCP review→人工 confirm→带 approval 执行 | 未确认/过期/依赖变更/换账号家庭会话/另一提案 approval 拒绝；普通入库不得顺便治理旧目录 | H intake + 审批 fixture 历史；P 新卡片与真实宿主 |
| B07 / F04 | 已知余量 `1.0` 扣 `0.1`，再整件消费；Android 同操作 | 未知量/零/负数/超量/单位不兼容/陈旧 revision 拒绝；percent 按初始量百分点；Android 多 item 拒绝；同键不同参冲突 | H consume/rename/open/consume/clear-name 差分与 replay；P 新 UI 完整链 |
| B08 / F05/F11/F12/F15 | Item/容器移动→子件位置；多选原子移动；GROUP/SKU 移动保 ID | 环、SKU 作目录父、跨家庭、非容器 Item 父、其中一条 stale revision；全批零变更；目录移动不改实物位置 | H native tree/rollback；P 双端全部层级组合 |
| B09 / F06/F07 | Web 未知开封时间保留未知；明确时间与日期 set/unset；deadline 增改完删 | Android 缺 opened_at 拒绝；date 与 datetime/家庭时区分开；闰日/DST/已过期/周期完成日推进/service 联动；稳定 deadline ID 不用数组下标 | H date projection；P 页面事实/提醒投影 |
| B10 / F08 | Item/SKU add→list→get→update→archive→restore；核对目标 revision | 敏感展开需显式审计；列表无正文；错归属拒绝；重分类后旧回执不泄露正文；归档不删历史 | H native notes/redaction；P 新笔记入口 |
| B11 / F09 | create upload→二进制 PUT→complete→list→私有 download→detach | 25 MiB 边界/超限/错 hash/坏 ticket/超时重放/未确认/过期清理/敏感下载；EXIF 清理；MCP create/complete 返回 ATTACHMENT_TRANSPORT_UNSUPPORTED + USE_WEB，不先发 ticket | H 11-06 上传 DO 实测记录；P 新附件 UI、并发与中断序列 |
| B12 / F10/F13/F15 | edit_item name/acquired/note 原子更改；update_item；批量 lifecycle | unchanged/set/clear 分开；任一无效字段/版本冲突不部分写；保留输入；错误后重新读取和确认才能再发 | H native command/rollback；P 新受控视图/批量 |
| B13 / F14 | split 守恒→dispose→void 错建 Item→correct_item(record_state=VALID, reason) | 不复活已拆包源；reason 必填；所需审批/版本有效；SKU 作废有引用拒绝；修复关联不删除历史 | H split/remaining commands；P 恢复与审批 UI |
| B14 / F16 | 连续写入→get_history 目标/operation→逐页读取→query_references→sync changes | 同微秒时间事件、大 bigint、无引用/跨家庭、分页中追加；不漏不重；append-only；partial operation 标未完整 | H microsecond/bigint + PG read；P 新历史完整性适配 |
| B15 / F17 | begin_export→中途修改原库存→read 全页→cancel；核对冻结总数/脱敏 | 重复游标稳定；改 query/disclosure、跨用户/家庭、篡改/过期游标 CURSOR_STALE；include_sensitive 审计；本地 CSV 只可由完整已验证 frozen rows 转换 | H frozen export；P 服务端导出与 UI 进度 |
| B16 / F18 | capability→启用的注册/恢复路径、密码/Passkey、家庭创建/改名/邀请/加入/撤销/离开 | 禁用邮件能力、错误/过期/重复 token、需近期验证的凭证变更、跨家庭；四角色编辑不得调用猜测端点 | H D1 credential/auth；P 新 auth 全流程与角色产品决策 |
| B17 / F19 | 发前可靠存原键/参数→提交但丢回执→重启/路由切换→查原入库回执或原请求重放；Android 查 operation | 存储失败零发送；同键不同参失败；NOT_FOUND 不换键；换环境/账号/家庭不串请求；审批过期保留输入重新审阅；离线不伪造成功 | H replay/offline draft；P 正式 root controller/persistence；历史 offline cold list 未通过 |
| B18 / F20 | 旧 `/i/:short`、详情/笔记/历史/目录/位置/group/dialog 深链→目标新页；标签扫码→打印 | 无效 ID/另一环境标签/无相机或蓝牙/取消/打印回执未知；禁止自动改 origin 后写或自动重打；实际纸张与任务日志一致 | S labels/workspace；P 旧 URL 矩阵、物理相机/App Links/打印 |
| B19 / F21 | version/health→debug 家庭内对象；比较业务事实与脱敏 | debug 无写命令；无权限/敏感字段/大结果拒绝或分页；允许 PG/SQLite 元数据不同；健康失败不能伪装空库存 | H native inspector；P 新只读 inspector |
| B20 / F22 | OAuth PKCE/consent→54 tool schemas→call→5 App tools/resource→选择/草稿/写入/恢复→refresh/revoke | 缺 scope/错误 resource/session-changed/refresh replay/CIMD 错误；UI 自包含、CSP/宿主工具限制；附件 USE_WEB；治理卡片必须在授权宿主完成 | H protocol harness、Codex login；P 真实 ChatGPT/新 MCP UI；G 路径口径 |
| B21 / Android | 两包独立 config→PKCE→context/snapshot/detail/history→三个命令→operation lookup→刷新/撤销 | 无 client 配置 503；错 client/resource/state/verifier、H-B id、过期 token、read-only scope；双包存储隔离；同 App 切换另立设计验收 | H live Android API；P 当前 APK/实机、App Links、打印/AOD/后台同步 |

## 历史证据的可复用边界

`docs/cloudflare/acceptance.md` 报告 54 schema/分类/描述一致及全部 native 操作执行，13 个 PG read 操作差分，以及 consume/rename/open/consume/clear-name 有限写序列、重复回执和 stale/excessive-consumption 错误对照。相关测试源码是 `tests/cloudflare/inventory.test.mjs`、`snapshot.test.mjs`、`http-acceptance.mjs`、`auth-http.test.mjs`；只读定位了这些文件，没有运行它们。

同文档的 live REST/Android/OAuth/MCP、25 MiB 上传、备份恢复和 browser CI 是 11 月 5–6 日范围内的历史结果。它明确保留：物理 Android/Passkey/打印、真实 ChatGPT 宿主、广泛写序列差分、受控 DNS rebinding、长期容量/观测，以及 offline cold reload 列表停留 loading 的缺口。历史 upload CPU 故障已记录替代实现和后续有限通过，既不能当作当前仍必现，也不能据有限通过承诺 Free 长期容量。

## 差异处置与关闭门槛

- **版本 V：** main 的入库位置草稿修复和 profile UI 是 v0.13.0→v0.13.1 前端演进；共同后端 schema 未变。需要新 UI 延续修复，不能计作 CF 后端回归，也不能为了“相同”复刻旧 bug。
- **运行时 R：** PG/文件/Fastify→SQLite DO/D1/R2/Worker 的原子性、时序/游标、权限和错误才是迁移比较对象；SQLite inspector 元数据、origin 和 OAuth 配置可不同但必须显式说明。
- **未接线 U：** 29 页面和试用回执只是交互候选。只有对应 F/B 都有实际证据才能切换该入口；未通过功能保留旧 CF 路径。
- **新增 N / 缺口 G：** 四角色成员管理没有可确认的既有后端角色分配协议；导出仍需服务端冻结结果适配；新 MCP 资源与旧深链桥接待实现/验收。不得仅凭 mock 模型创建权限或绕过审批。
- **真实契约不一致：** 以字段、错误、终态或事件的最小复现登记，先确认是否旧版缺陷、配置差异、显示投影或 CF 运行时缺陷；没有实测不标“已证实退步”。

关闭一行需要：同客户端版本、两个隔离后端、同种子/操作序列、结果比较 receipt、失败恢复观察和对应用户流程验收。恢复回归前本矩阵只提供执行规格，不可用于宣布 Phase 2 工程验收、双后端完全等价或允许发布。

## B22：已观察到的连续试用一致性失败（G-TRIAL-QUANTITY）

关联 F01/F02/F04、B03/B07/B17。2026-11-11 总负责人集中 CUA 观察：6008 已保存 fixture 中，燕麦饮 `item_00000000-0000-4000-8000-000000000001` 日常余量 290 mL，切管理列表同一 UUID 仍显示 310 mL（估计）。状态为 **本轮观察失败；已修候选，修后未复验**，并非 P 类尚未执行用例；该失败只适用于隔离试用显示一致性，不证明两真实后端行为不同。

源码解释详见 [G-TRIAL-QUANTITY](feature-parity-matrix.md#本轮集中预览发现g-trial-quantity已修候选待复验)：消费写 `DailyItemFacts.quantity`，管理列表读取未重投影的 `ItemView.facts`。审阅 fixture 里这两份数据最初均为 310，因写入后只更新一份而分歧。

恢复验证时的明确序列：保留当前已有存储，读取同一 UUID 的 quantity/revision；日常详情→管理列表→管理精确编辑→返回日常→刷新，所有数量展示与当前事实一致且不增加业务事件。再在明确授权的 fixture 中消费已知量，逐页核对结果、精度标记、商品聚合、revision 和历史；另覆盖已知零、未知量、不同单位及已用完。未知不能变零，空 facts 不能伪称“余量未记录”。修复后只做源码检查不能关闭本失败；需保存新的集中手动观察结果，自动回归仍等待解除暂停。

B22 修复候选：私有 `apps/web/review/pages/management-item-projection.ts` 以当前 quantity 派生管理 ItemView.remaining，`ManagementJourney.tsx` 在 world→管理模型边界应用；复用现有 Decimal `amount` formatter。旧存储不重写、原请求和回执不变、正式组件/领域未变。2026-11-11 执行 `pnpm exec tsc -p apps/web/tsconfig.json`，exit 0；没有运行 tests 或 git 操作。B22 的手动复验/自动回归不得被类型检查替代。
