# Phase 2 可执行任务顺序与阶段边界

2026-11-06：用户已确认 D01–D09、M01–M06 流程并要求实施 Phase 2；当前进入 B00。视觉与组件按 [组件审阅清单](component-review.md) 逐批批准，B01 尚未开始。每个任务保持当前正式入口可构建/可运行，开发入口隔离；不在开始阶段移动所有目录。

## 顺序与独立交付

| 顺序 / 建议PR            | 工作范围                                                                                                        | 依赖      | 退出条件                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| P2-01 设计系统           | 核对基底/Node24；测B0性能；在现有Vite引入Tailwind4/shadcn Base UI；Token单源派生；基础控件和开发fixture装配入口 | 设计冻结  | 基础状态、两主题、focus/文字对比度；Web/plugin原入口构建不变；无生产组件导入fixture |
| P2-02 模式与Shell        | 明确路由/兼容解析、ModeSwitcher、AppShell、响应式overlay root、安全返回、偏好适配                               | P2-01     | URL优先、刷新/返回、无存储降级、scope隔离fixture；不接新生产入口                    |
| P2-03 共享事实与只读页面 | ProductSummary/ItemRow/DateFact/Location/Catalog picker；D01/D09、S01–S05/S07/S08手动识别入口                   | P2-02     | 类型/未知/脱敏/分页语义和空错加载完整；G03/G08纯类型对齐；无全库客户端替代查询      |
| P2-04 共享任务状态       | 定义controller interface及OperationSession；在开发适配器注入时序；Approval/Conflict/Receipt/Offline/Recovery    | P2-01/02  | ST00–ST14、持久化失败、同键原参、重挂载、改模式草稿不丢；业务真实网络不接           |
| P2-05 日常写面板         | D02–D08所有表单/步骤、原子核对、逐件差异、打印状态；新类型G01等待态                                             | P2-03/04  | 所有字段与操作可解释、无假按钮、正常/冲突/未知fixture；D03受限分支明确              |
| P2-06 管理页面           | S09–S13，目录/位置、模板、精确编辑、批量、历史/纠错/导出；M01–M05                                               | P2-03/04  | 选择精确、100件界限、原子/分任务区分、扩展能力等待态完整                            |
| P2-07 剩余入口           | S14–S16账号/家庭/授权/缓存/打印/检查器的正式UI组件；不换鉴权协议                                                | P2-02/04  | 所有现有用户入口有明确迁移组件；身份错误/服务禁用状态覆盖                           |
| P2-08 组件验收           | 六宽度、键盘/缩放/读屏、真实host布局容器、fixture性能、应用构建回归                                             | P2-01至07 | TypeScript/项目格式/必要测试通过；差距单列；用户组件/交互验收后才进入Phase3         |

P2-03和P2-04在共享接口确定后可独立实施。实际PR可合并相邻小变更，但不能把后台迁移/生产接线/清理塞进设计系统PR。

## 现有模块复用与替换清单

| 模块                                                        | 处理                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| lib/api、runtime、session、auth、accounts通信、features/api | 复用协议与身份；仅抽UI/适配，不复制两个mode版本                                  |
| lib/draft、storage、plugin/store、ui/forms命令生命周期      | 保留schema/原请求/审批/版本语义，迁移为共享controller；G04修正必须有故障注入证据 |
| features/inventory/model、adapters、query                   | 复用纯VM基础；补dateKind/coverage/真实类型；避免scope或未知语义丢失              |
| features/writes局部表单                                     | 借用字段/约束映射，替换视觉层和任务编排；生产组件不导入旧AntUI                   |
| ui/primitives、tokens、theme、layout                        | 建shadcn基础与统一Token，分批替换；Ant bridge临时保留供旧入口用                  |
| next/NextShell、screens、workspace                          | 用双模式shell/pages与显式路由逐步替换；保持旧入口兼容                            |
| ui/catalog-review                                           | 审批协议/挑战保持，换ApprovalSummary表现；不能转普通generic write                |
| labels、d101、printer-session、label-renderer/profiles      | 复用真实设备/QR实现，换面板，按host能力接；不模拟物理完成                        |
| viewport、plugin/client、selection                          | 复用宿主协议；替换.ant-app滚动依赖，扩大路由白名单，验证focus                    |
| authentication、accounts、inspector与设置                   | 都进入后续替换清单，不遗漏剩余Ant路径                                            |
| packages/contracts / domain / Android Kotlin+Compose        | 作为事实源/独立客户端保留；本项目不做原生重写                                    |

Phase2建议目录遵循Handoff职责，但只在首次引入对应能力时创建：ui/components/ui、ui/patterns、ui/theme、features/daily、features/management、features/shared、app/routing、app/shell、app/mode。当前已有app/search可逐步扩展；不为整齐路径做无验证搬家。

## Phase 3 入口与停止规则

Phase2验收后另定目标集成分支，重新fetch并验证Cloudflare差异。接线顺序保持Handoff六个Wave：shell → 日常只读 → 日常写 → 管理 → 其余入口 → 清理Ant。每Wave有真实协议的隔离家庭验收和回退策略；数据模型不改变。

真实恢复、授权隔离、原子性、MCP传输或G01等前置条件未满足时只停相关功能。不能为页面完整随意添加后端字段或放宽审批；需要独立明确的契约决定。G01未解决可先完成所有无依赖组件，完整新商品类型原子入库不能标完成。

当前main没有可工作的ui=legacy实现；过渡期受控切换需保留集成前现行页面为回退，对兼容路由进行共享映射。旧UI移除要有功能对等证据、外部QR/宿主/书签检查及确认的回滚窗口。Ant依赖只在所有生产入口无引用后删除，不能按主页截图判断。

## 每次交付报告模板

```text
目标
本轮实施内容
修改文件
使用的领域契约
影响的用户流程（D/M/S/A编号）
测试命令及结果（未执行单列）
真实浏览器/MCP验证边界
截图或交互证据（fixture/隔离真实数据/真设备分别说明）
未解决问题和阻塞范围
是否触及正式数据或部署
下一轮依赖
```

文档PR不要求为了形式运行库存集成测试；运行代码变化按实际风险执行typecheck/build/Vitest/Playwright及仓库既有CI。发布、部署、正式写入另需用户明确授权和现有发布流程，本阶段交付不提供这些授权。
