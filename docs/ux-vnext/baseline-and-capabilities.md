# 当前基线、复用范围与能力映射

核对日期：2026-11-06（Asia/Shanghai）。本页是 Phase 1 设计输入和追踪索引，不增设独立审计阶段。结论来自本轮读取的代码、远端元数据和仓库证据；未运行生产请求或重新验证历史设备结果。

## 分支与交付状态

| 对象                                                  | 本轮观察                                                                                                                                                           | 证据/边界                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| origin/main                                           | 18f7e0496ecb4fb960a6619f12f57c68b3898410                                                                                                                           | git fetch 后核对，与 Handoff 一致                                                                                 |
| origin/codex/cloudflare-native                        | 89544793352d8d8ea7be23ac7dbddaa811ddee43                                                                                                                           | git fetch 后核对，与 Handoff 一致                                                                                 |
| [PR #20](https://github.com/Cabbyte/Acornary/pull/20) | merged；head 81bea639619edc553884b7a0d345c89b836fcc0b                                                                                                              | 修复分类父级误作位置、商品类型编辑；已进入 main                                                                   |
| [PR #21](https://github.com/Cabbyte/Acornary/pull/21) | open、Draft；base 为上述 main、head 为上述 Cloudflare                                                                                                              | 并行迁移项目，不作为本轮代码基底                                                                                  |
| main 普通 CI                                          | [41376099325 成功](https://github.com/Cabbyte/Acornary/actions/runs/41376099325)                                                                                   | exact main SHA；既有运行，不是本轮重跑                                                                            |
| main Release                                          | [41377542910 失败](https://github.com/Cabbyte/Acornary/actions/runs/41377542910)                                                                                   | test/test 的 Types, PostgreSQL, OAuth, build and browser tests 失败；publish/deploy skipped；本轮不定位或修复发布 |
| Cloudflare CI                                         | [42164067650 成功](https://github.com/Cabbyte/Acornary/actions/runs/42164067650)、[42164067690 成功](https://github.com/Cabbyte/Acornary/actions/runs/42164067690) | native 与完整 CI；同 head SHA                                                                                     |
| 用户原工作区                                          | main@c3f0b1e，落后 origin/main 101 提交；7 个 tracked 修改及未跟踪品牌素材                                                                                         | DESIGN、5 个旧 UI 文件、stash 浏览器测试；全部保留，未 stash/reset/rebase                                         |
| 本轮工作区                                            | /Users/timli/workspace/Acornary-frontend-vnext；codex/frontend-vnext                                                                                               | 从 origin/main 建立，变更限定 docs/ux-vnext                                                                       |
| Cloudflare 工作区                                     | 读取时干净                                                                                                                                                         | 未修改该分支                                                                                                      |

连接器的 workflow 查询只返回 PR 触发运行，main 查询无结果；本轮另用只读 gh API 查询 exact SHA 的 push 工作流。无结果没有被解释成“无 CI”。

## 输入文档的权威边界

| 输入                                                                                                                               | 用于什么                                       | 当前差异处理                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [PRODUCT](../../PRODUCT.md)、[DESIGN](../../DESIGN.md)                                                                             | 家庭记忆、身份/未知/时区、暖纸字体及旧 UI 实现 | 新 Handoff 的双模式和 shadcn 覆盖旧 Ant/导航决定；本轮不改根文档                                       |
| [UI 审计](../frontend-ui-audit.md)                                                                                                 | 任务成本、密度、状态、可访问性问题线索         | 2026-10-31 截图/评分不当成当前测试；不继承通用 undo、默认可用等危险建议                                |
| [重构进度](../frontend-refactor-progress.md)、[正式方案](../frontend-production-plan.md)                                           | 已建 primitives、查询适配和任务路径            | 早期“尚无显式路由/默认旧 UI”已过时；旧 Phase 命名不沿用                                                |
| [融合方案](../stash-integration-plan.md)                                                                                           | 商品/实物区分、UUID选择、焦点/安全区           | 全量客户端搜索和四栏不是 vNext 必须继承的方案                                                          |
| [冻结接口](../repair/frozen-interfaces.md)                                                                                         | 协议、状态、字段、旧 F/I 清单                  | 必须与 schema/实现交叉核对；存在更新不齐，不按旧 F 标记禁用已实现能力                                  |
| [intake README](../intake/README.md)、[voice intake](../voice-intake.md)                                                           | 原子任务、分类规范、依赖、挑战/回执、度量口径  | 旧“先建目录再建实物”指南不覆盖最新 commit_intake 主路径                                                |
| [Cloudflare 验收](https://github.com/Cabbyte/Acornary/blob/89544793352d8d8ea7be23ac7dbddaa811ddee43/docs/cloudflare/acceptance.md) | 最新已有协议/浏览器证据和未完成门槛            | main 无此文件；读取迁移分支版本。记录离线冷启动列表仍加载、真实 ChatGPT/物理设备待验收；不混同本轮结果 |

## 当前前端已经有的基础

| 证据 ID | 代码                                                                                                                                                        | 已存在                                                                          | vNext 处理                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| E01     | [app](../../apps/web/src/app.tsx)、[main](../../apps/web/src/main.tsx)、[plugin](../../apps/web/src/plugin.tsx)                                             | React 19/Vite/TanStack、Session/Connection/Inventory；Web 与 MCP 共享 Workspace | 保留入口协议；壳层换 UI；设置不再被全量库存挡住                           |
| E02     | [workspace](../../apps/web/src/workspace.tsx)、[search](../../apps/web/src/app/search.ts)                                                                   | NextShell 默认、显式核心路由、lazy 页面、QR/旧链接、URL 参数                    | 扩路由和严格白名单；当前仍手写 section 分派；ui=legacy 已无真实回退实现   |
| E03     | [query](../../apps/web/src/features/api/query.ts)、[protocol](../../apps/web/src/features/api/protocol.ts)、[api](../../apps/web/src/lib/api.ts)            | 服务端无限分页、scope query key、协议头、POST read、HTTP/MCP 适配               | 复用通信；补缓存读取/离线禁写可见状态与查询条件对应性                     |
| E04     | [inventory model](../../apps/web/src/features/inventory/model/types.ts)、[adapters](../../apps/web/src/features/inventory/adapters/index.ts)                | v2 读模型、日期/组/模板/能力适配                                                | 保留纯适配边界；补 date_kind 等语义，不按标签反推事实                     |
| E05     | [forms](../../apps/web/src/ui/forms.tsx)、[draft](../../apps/web/src/lib/draft.ts)、[writes](../../apps/web/src/features/writes/IntakeSheet.tsx)            | 持久原请求、revision、结果、已拆局部表单、审批/冲突                             | 抽共享任务控制器时保留协议；修复泛化4xx清attempt风险，不直接照抄          |
| E06     | [features](../../apps/web/src/features/api/features.ts)、[runtime](../../apps/web/src/lib/runtime.ts)、[widget store](../../apps/web/src/plugin/store.ts)   | feature fallback、宿主能力过滤、私有草稿读回确认、内存路由                      | 模式偏好可退内存；写入不能放宽存储门槛；扩路由白名单                      |
| E07     | [labels](../../apps/web/src/lib/labels.ts)、[print UI](../../apps/web/src/ui/label-print.tsx)、[printer session](../../apps/web/src/lib/printer-session.ts) | QR可逆ID、D101/Web Bluetooth、逐张不确定处理                                    | 保留设备控制；换面板；扫码采集是新增运行时UI                              |
| E08     | [tokens](../../apps/web/src/ui/tokens.ts)、[theme](../../apps/web/src/ui/theme.tsx)、[primitives](../../apps/web/src/ui/primitives/README.md)               | 自有Token、Lucide、CSS Modules、Ant包装                                         | 替换基础交互；theme 仍硬编码且未调用 antThemeFromTokens，实际尚非完全单源 |
| E09     | [viewport](../../apps/web/src/ui/viewport.ts)、[storage](../../apps/web/src/lib/storage.ts)、[session](../../apps/web/src/lib/session.tsx)                  | 安全区/visualViewport、IndexedDB、清scope                                       | 保留语义；pageScrollRoot 依赖 .ant-app，替换时必须适配                    |
| E10     | [contracts](../../packages/contracts/src/index.ts)、[domain](../../packages/domain/src/index.ts)、[reminders](../../packages/domain/src/reminders.ts)       | 明确命令、Decimal、模板/能力、日期推导                                          | 领域事实源；不为UI改模型                                                  |

当前 apps/web/package.json 不是独立新项目；实际依赖与脚本在根 package.json。React、TypeScript、Vite、Router/Query、Zod、Lucide、Vitest/Playwright 保留。shadcn、Base UI、Tailwind v4 为 Phase 2 引入；本轮不安装。

## 功能到协议的追踪

状态：A=当前 UI 已有路径（仍需新 UI 验收）；B=服务端/契约已存在，UI/传输须补或重组；G=真实缺口/未证实，不能假装已有。

| 能力 / 流程                  | 状态 | 查询/写命令                                                                                  | 关键证据与限制                                                                                                            |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 家庭隔离、会话、OAuth M06    | A    | session/accounts + get_connection_context                                                    | E01/E06/E09；模式不是 scope                                                                                               |
| 实物与商品查询 D01           | A    | query_items/query_catalog_nodes/get_item/get_catalog_node                                    | [schemas](../../packages/contracts/src/index.ts)；位置线索须独立选择，不是自然语言搜索                                    |
| 服务端商品汇总 D01           | B    | query_inventory_groups                                                                       | groups_v2；不可聚合当前页冒充总数；无商品排序参数                                                                         |
| 现有商品/异构多件入库 D02    | A/B  | get_intake_context/commit_intake/get_intake_receipt                                          | [intake schema](../../packages/contracts/src/intake.ts)；UI主要同款共用事实，逐件覆盖待补                                 |
| 基础新SKU原子入库 D03        | A    | 同上，newIntakeProduct                                                                       | 已有 name/parent/initial_attributes/new_groups；不自动合并同名                                                            |
| 新SKU显式类型/能力与入库 D03 | G01  | 当前 commit_intake 不接受 profile/capabilities                                               | [server intake](../../apps/server/src/intake.ts) 新建处未传这两字段；旧 unprofiled 接受部分属性不等于正确能力发现         |
| 目录审批 M01/D03             | A    | propose_catalog_change、get_catalog_review/confirm_catalog_change                            | [catalog review](../../apps/web/src/ui/catalog-review.tsx)；后两者 app-only/私有 challenge                                |
| 部分/整件消耗 D04            | A    | consume_item_content / consume_items                                                         | 同单位、Decimal、未知精度；finish不是void                                                                                 |
| 移动/批量移动 D05/M04        | A    | move_item/move_items                                                                         | 1–100 明确UUID，原子失败；有效容器/无环                                                                                   |
| 开封/属性日期 D06            | A/B  | open_item、bind/update_attributes；deadline四命令                                            | [deadline](../../packages/contracts/src/deadline.ts)；显式时间与未知时间区分                                              |
| 需要留意 D09                 | B    | date_filters、query_stock、custody/service attribute_filters                                 | 不能把多项AND过滤当OR；stock未知不算低                                                                                    |
| 笔记 D08                     | A/B  | list_notes/get_note/add/update/archive_note                                                  | [notes](../../packages/contracts/src/notes.ts)；完整target+目标revision；UI需懒正文                                       |
| 附件 D08                     | B    | create_attachment_upload / complete_attachment_upload / list_attachments / detach_attachment | Web传输存在，MCP主动阻断；不保证缩略图                                                                                    |
| 目录/类型/能力 M01           | A/B  | create/update/move_catalog_node、属性命令                                                    | 类型编辑已在main；完整治理/能力编辑UI需补                                                                                 |
| 模板与版本 M03               | A/B  | list/get_attribute_template、bind/update/remove/upgrade_attributes                           | [registry](../../packages/contracts/src/registry.ts)；原版本与显式升级                                                    |
| lifecycle 批量 M04           | B    | update_items_lifecycle                                                                       | [schemas](../../packages/contracts/src/index.ts) 有原子批量；任意模板批量为G02                                            |
| 处置/作废/拆包/引用 M03      | B    | dispose_item/void_item/void_catalog_node/split_item/query_references                         | 已有服务端；MCP过滤void/split/references；必须逐能力验收                                                                  |
| 位置 M02                     | A/B  | create_items、move_item、container属性                                                       | 现有place操作存在；独立位置工作台待补；缺container_catalog_id需合法建档                                                   |
| 历史/纠错 M05                | A/B  | get_history/correct_item                                                                     | 无通用undo、无actor筛选；operation_id分页可查完整操作                                                                     |
| 冻结导出 M05                 | B    | begin_export/read_export/cancel_export                                                       | [export](../../packages/contracts/src/export.ts)；FeatureKey类型尚未列 frozen_export，但implementedFeatures有，需类型对齐 |
| 离线读取/同步                | A/B  | snapshot + sync_v2端点                                                                       | 已有缓存不等于分页列表冷启可读；Cloudflare验收记录此失败；必须补可验证降级                                                |
| 标签/打印 D07                | A    | labels/printLabelBatch/D101                                                                  | 桌面Web真实能力；MCP/手机不同；无库存写入                                                                                 |
| 相机扫码采集 D07             | B    | 无需新库存模型，运行时读码适配                                                               | Web/MCP采集UI尚无；手动输入可完整降级；商品条码不选Item                                                                   |
| 登录/邀请/检查器 M06         | A    | 既有独立入口与accounts/debug只读接口                                                         | 仍使用Ant，必须进入后续迁移范围                                                                                           |

## 需要先解决的具体门槛

| ID  | 归类              | 决定与解除证据                                                                                                                                                                         |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01 | 后端契约缺口      | 新商品类型/能力无法随原子入库声明。保留原子设计，单独评审兼容字段/审批指纹/事务/能力验证方案；本轮不改模型。不接受先建SKU后补库存作为此流程完成。Phase 2 可做等待态；Phase 3该分支阻塞 |
| G02 | 超出现有原子命令  | 任意模板批量/批量目录移动没有通用原子API。首版限定现有 lifecycle/移动/结束；其他逐件。若扩大范围需另批契约                                                                             |
| G03 | 前端读模型缺陷    | DateFact 有 date_kind，但 DateFactView/nextDateFact 未保留；attentionFor 直接写“已过期”，todayFor 有UTC回退。Phase 2补纯VM并做类型/时区fixture；Phase 3对真实日期对照                  |
| G04 | 前端恢复缺陷      | forms 的泛化4xx分支可能清除 IDEMPOTENCY_CONFLICT attempt。新控制器按 recovery/code分类；失败注入证明原键原参数不丢后才接写入                                                           |
| G05 | 宿主能力/存储限制 | stock/void/split/references/attachments 当前MCP过滤；无可靠widget readback禁止发送。按实际传输开放，需真宿主证据；外链继续不能算宿主闭环                                               |
| G06 | 读取能力未满足    | 分页列表离线冷启未通过；设置仍被InventoryProvider包住。设计已定义缓存覆盖/缺缓存状态；实现及集成分别验证，禁止声称现有离线完整                                                         |
| G07 | 查询范围限制      | 无 exclude_containers、任意自然语言、全匹配选择令牌/任意OR/actor筛选。首版不承诺这些；不能客户端过滤后沿用错误总计                                                                     |
| G08 | 类型/文档漂移     | frozen_export、catalog include_path/include_void/include_one_off 等schema与read-v2类型未完全一致；核对真实契约再补纯类型，不新增私有API                                                |

## Cloudflare 并行边界

main 到当前迁移 head 在 apps/web 的差异为 7 个文件、44 行新增，涉及 headers、账号/登录/会话、preview notice、shell/Button；contracts/domain 此次范围 diff 无差异。这只是此时比较。Phase 3 决定目标分支后重新 fetch/diff、运行该分支现行 scripts，并核对实际 workerd + MCP UI。

验收文档记录 preview 与生产隔离、部分真实 REST/MCP协议/浏览器/备份证据；实际 ChatGPT UI、物理设备/打印和观测窗口仍独立。该材料不提供本轮生产写入/部署授权。
