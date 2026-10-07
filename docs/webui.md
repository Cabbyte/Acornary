# 松仓 Web UI

本分支全量采用 [Ant Design 统一界面](./antd-ui.md)，Web 和 MCP Apps 复用同一组件。正式线上版本仍以发布记录为准；本次迁移尚未部署。账号与多家庭能力见 [账号系统](./accounts.md)，当前发布和验收状态见 [项目进度](./progress.md)。

## 设计与入口

当前布局及 token 以 [Ant Design 统一界面](./antd-ui.md) 为准，原工作台与 Figma 来源保存在 [工作台历史](./responsive-workbench.md)。共享页面入口是 `workspace.tsx`，Web 与 [插件](./plugin.md) 分别注入 transport 和会话。2026-10-01 的 Soft Gray 本地阶段已归入 [历史交接](./archive/soft-gray-handoff.md)。

统一使用暖灰背景、白色内容面板、棕色主色和完整位置路径。Ant Design Form / Input / Select / TreeSelect / DatePicker / InputNumber 连接既有草稿，旧样式层已清理。

- `/items`：工作台列表、完整范围搜索、筛选、排序、显示列和按 UUID 多选。
- `/search`：逐件搜索名称、规格、型号、位置或完整编号，可限定位置及所有下级位置，并按分类和库存状态筛选。
- `/items/group/:sku`：逐件选择，区分件数与剩余内容；批量用完显示明确的实物名单。
- `/items/:id`：工作台详情检查器；`/items/:id/details` 保留完整资料、开封、部分消耗、整件用完、纠错、笔记和历史。
- `/places/:id?`：位置层级、新增／改名／移动；容器内容随父容器一起移动。
- `/catalog`：可见 SKU 列表，显示规格、分类与实物件数，点击进入该 SKU 的逐件列表。
- `/catalog/manage`、`/catalog/:id`：保留分类、商品共有资料与属性模板管理。
- `/settings`：登录会话、缓存范围及更新时间、刷新、添加到主屏幕指引、退出并清除本机数据。
- `/settings/account`、`/settings/households`：登录凭据管理、家庭成员与邀请、创建及切换家庭，见 [账号系统](./accounts.md)。
- `/inspect`：设置 → 开发者工具 → 数据库检查器；独立按需加载，提供“返回松仓”。
- `/login`、`/consent`：产品视觉的公共登录与 OAuth 授权页，不依赖检查器模块。

工作台 <768px 使用手机列表、底部导航、位置抽屉和全页详情；768–1199px 使用 200px 可折叠侧栏与详情抽屉；≥1200px 使用 224px 侧栏与 360px 详情栏。编辑统一在 560px / 手机全屏抽屉中，调整窗口保留草稿。物品、商品、SKU 和搜索每页默认 20 条，可选 50/100。

## 单站点与统一会话

两套视图共用账号、Cookie 和后端会话；检查器只提供查询，不具备直接数据库写入或任意 SQL。当前家庭的所有成员同权，检查器由后端限制到该家庭；同源的两套视图不构成独立安全隔离。

普通登录只接受 `/items`、`/places`、`/catalog`、`/search`、`/settings`、`/inspect`、`/join` 内的返回路径，默认物品首页。OAuth 则把带签名的完整上下文交给现有 provider 验证，登录、选择家庭、继续授权、允许或拒绝只采用服务器返回的地址；不直接跳转查询参数中的 `redirect_uri`。已有会话无需重复密码，客户端明确要求重新验证时遵循其请求。issuer、发现文档、scope、`/api/auth/*` 与 `/mcp` 保持兼容。

任一视图退出都会撤销服务器会话、清除本机私有缓存，并通过 storage 事件令其他标签页失效。恢复焦点和定期查询复核会话。产品编辑遇到过期时保留输入并弹出公共登录表单；检查器回统一登录后返回原入口。检查器数据不写入 IndexedDB，不提供离线查询；Service Worker 不接管检查器、登录和授权导航，也不预加载检查器资源。

发布使用一个应用容器、同一个正式数据库与现有 Caddy HTTPS 443，容器内部仍为 3210。v0.1.0 双视图没有新增 migration；账号系统新增 `005_accounts.sql`。开发预览使用独立测试库，其进程状态不作为部署依据。发布门禁与回退遵循 [发布手册](./releases.md)。

## 数据与接口

浏览器 → Fastify 会话、家庭成员与同源校验 → 现有 `execute` 业务命令 → PostgreSQL 同事务记录实体、revision、事件与幂等结果。前端没有数据库凭证；账号迁移不改变领域类型／领域命令行为。

| 接口                                                    | 行为                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/session`                                      | 当前账号、运行模式、账号与家庭对应的缓存键                             |
| `GET /api/ui/snapshot`                                  | 一致性家庭快照：商品、实物、笔记、容器 SKU 与派生汇总；不返回认证表    |
| `GET /api/ui/groups?search=&category=&location=&state=` | 对完整当前范围筛选后汇总，保留每件实物 ID                              |
| `GET /api/read/get_history`                             | 沿用领域查询，历史每次 30 条                                           |
| `POST /api/write/:operation`                            | 使用现有 schema、expected_revisions 和 idempotency_key；事件来源为 WEB |

写请求要求有效账号会话（云端）、精确同源 Origin、JSON 与 `X-Acornary-Request: web`。业务请求携带 `X-Acornary-Household`，服务器逐次核对成员关系并解析 actor；提交还核对编辑时绑定的账号。无 Origin、跨源、未知命令及向写入口调用读操作均拒绝。版本冲突与幂等冲突返回 409。

| 页面动作                       | 现有命令                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| 新建商品／分类、改名、调整分类 | `create_catalog_node` / `update_catalog_node` / `move_catalog_node` |
| 入库、新建位置                 | `create_items`                                                      |
| 实物改名、移动                 | `update_item` / `move_item`                                         |
| 工作台原子编辑、批量移动       | `edit_item` / `move_items`，复用相同 revision、幂等及事务校验         |
| 开封、部分消耗、整件用完       | `open_item` / `consume_item_content` / `consume_items`              |
| 编辑共有／独立属性             | `bind_attributes` / `update_attributes`                             |
| 带原因纠错                     | `correct_item`，可在同一次纠错中恢复生命周期和剩余内容              |
| 文字笔记                       | `add_note` / `update_note`                                          |

未知字段保持未记录；不会自动将包装净含量当作剩余量。不同单位分别汇总，百分比不相加。实物件数单独统计，房间与容器不计入 SKU 实物件数。每件实物仍拥有独立 UUID；名称、位置与数量改变不替换身份。

当前读取采用固定数量 SQL 的家庭完整快照，避免逐条读取和分页后错误汇总。它适合当前家庭规模；海量物品、超大笔记、极深层级与增量快照尚未做负载验收。后续分页需要先保留完整范围的服务端汇总语义。

## 离线、草稿与恢复

- Service Worker 只缓存公共应用外壳、构建资源与品牌资产。API、认证及 MCP 不放入 Cache Storage。
- IndexedDB 按账号／家庭缓存最近完整快照、已查看的最近 30 条历史及表单草稿；退出登录清除，账号切换先清旧缓存。
- 离线可浏览已缓存的目录、实物和笔记。未看过的历史不宣称可离线读取。页面显示缓存时间与范围。
- 编辑时断网保留输入并禁用提交；重新联网不自动写入。用户重新核对并点击提交。
- 提交前持久化准确的请求载荷与幂等键。响应丢失时保留该次提交，重试相同键与载荷；已提交但刷新失败时仅重读。
- 409 先刷新并展示当前值，由用户确认保留输入后采用新 revision；不静默覆盖。
- 401 打开重新登录，保存原输入与待确认请求。重新登录不会自动重发写入。
- 缓存可能受浏览器存储限制或清理影响；缓存失败会显示提示。没有后台同步或离线写入队列。

## 启动与验证

本次迁移推荐使用 `node scripts/ui-preview.mjs start` 创建完全独立的示例环境，详见 [试用与验证](./antd-ui.md#试用)。以下历史运行方法仍只适用于明确隔离的开发配置。


运行要求保持仓库现有的 Node 24、pnpm 和 PostgreSQL 18。使用独立开发库；不要重新启用迁移前的正式本地库存。

```sh
pnpm typecheck
pnpm test
pnpm build
```

集成测试需要独立 `DATABASE_URL`。先执行 `docker build --target browser-test -t acornary-ci .`，再运行完整隔离容器流程：`node scripts/ci.mjs`。现有 CI 已包含构建、PostgreSQL 测试及云模式浏览器测试。E2E 自签名证书仅以该测试证书的 SPKI 指纹用于 Chromium 测试启动，不更改应用或系统的证书校验。

开发预览可使用 `tests/web-browser-server.ts`，监听 3210；此入口和 `tests/seed-web-demo.ts` 都强制数据库名称符合 `acornary_e2e_<数字>`。演示种子要求没有任何物品，创建虚构家庭数据，不接受正式数据库。先种子、构建，再启动服务器：

```sh
pnpm exec tsx tests/seed-web-demo.ts
pnpm build
pnpm exec tsx tests/web-browser-server.ts
```

工作台演示种子是 `tests/seed-workbench.ts`，同样只接受 `acornary_e2e_<数字>` 数据库。历史预览端口和容器不保证仍在运行；按上述流程重建独立环境，不能复活原正式本地库。

当前 CI 覆盖 Web、账号、OAuth、只读检查器和不透明 MCP Apps 沙箱，结果以对应提交的 GitHub Actions 为准。`v0.4.2` 发布记录包含 66 项单元／集成、36 项 Chromium 和 15 项部署控制器测试；早期 Web 证据见 [v0.1.0](./release-v0.1.0.md)。截图及诊断保存在忽略提交的 `output/`，不保证其他 checkout 可读取。

初版 WebKit 本地模式的 7 项检查通过，覆盖主要写入、冲突、布局与编辑断网流程（本地模式跳过云端会话测试）；离线重开在 Playwright 1.63 的离线模拟中出现引擎内部错误，与[已登记的上游问题](https://github.com/microsoft/playwright/issues/42775)一致，该测试明确跳过，不能据此声称 Safari 离线重开已经验收。

仍需验收：iPhone Safari 与添加到主屏幕后的离线重开、真实输入法和键盘遮挡、安全区域、VoiceOver 焦点、旧设备滚动与玻璃性能。浏览器尺寸测试不等同于这些实机结果。统一认证本轮以 Chromium 完整回归。生产版本、真实会话与原库存读取已经验证，不代替上述实机检查。

入库、单件资料编辑、开封、纠错、容器整批移动、目录管理、笔记、历史、认证和设置保留现有业务流程；其完整 Soft Gray 设计仍需补齐。未来宿主应共用 Web UI 来源，认证和消息传输适配另行验收。

本轮浏览每次展示 20 条，搜索和统计先作用于完整家庭快照，再进行客户端分页，不属于服务端游标分页。浏览返回保留当前账号与家庭范围内的查询、筛选、已加载条数和滚动位置。单件移动区分进入与选择位置，提交前确认来源和目标完整路径；消耗在表单内校验正数、单位和最新剩余量。结果未知时沿用同一次幂等提交，已保存但刷新失败时只重新读取。
