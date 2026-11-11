# 组件契约与设计 Token

## 三层职责

Level 1 是进入仓库的 shadcn/ui 基础组件源码，默认采用 Base UI 原语；不读取库存、不持有会话、不调用业务命令。Level 2 是 Acornary 产品组件，接收已经规范化的事实与状态，发出明确用户意图。Level 3 页面/任务负责选择读取范围和编排共享应用控制器；两种模式不可复制命令执行实现。

现有 Vite 工程支持在原项目配置 shadcn，无需迁移 Next.js；实现时记录 CLI/依赖实际固定版本，不在脚本里长期依赖 latest。参见 [shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)。Base UI 方向与当前官方组件基础一致，仍须逐个验证菜单/焦点/弹层行为，不能把更换 import 当成迁移完成。[官方 Base UI 说明](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)

## Level 1 组件清单

| 组件                             | Acornary 规则                                                   | 必须呈现的状态                               |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Button / IconButton              | primary / secondary / quiet / danger；type显式；图标按钮需label | normal/hover/active/focus/disabled/busy      |
| Input / Textarea / Field         | label、hint、error各有语义关联；未知值不可变占位默认值          | empty/value/error/readOnly/disabled          |
| Select / Combobox                | 搜索候选有实体类型/完整路径；异步候选不是本地全库               | loading/noMatch/error/selected/unavailable   |
| Dialog / Sheet                   | controlled open；由任务决定能否关闭；同一表单实例跨尺寸         | draft/busy/unknown/blocked；焦点trap/restore |
| Popover / Tooltip / DropdownMenu | 不承载唯一关键事实；关闭返回触发点                              | keyboard/open/focus/disabled                 |
| Tabs / RadioGroup                | 模式与内容切换语义明确；选中不只靠颜色                          | selected/focused/disabled                    |
| Checkbox                         | true/false/indeterminate；混合值不写回业务                      | checked/mixed/unchecked/error                |
| Calendar / DateInput             | 纯日期用YYYY-MM-DD；类型独立；键盘可直接输入                    | empty/valid/invalid/clear                    |
| Table                            | caption、列头、aria-sort；选择和打开独立                        | sorting/loading/empty/rowSelected            |
| Skeleton / Status / Toast        | 重要回执常驻面板，Toast仅辅助                                   | polite status/alert错误/可关闭               |

OperationSheet 使用受控 Base UI Dialog 的定位与焦点能力；本版不依赖滑动手势关闭，避免意外丢任务。复杂选择器优先作为面板内部步骤。若以后采用 Drawer 手势，必须仍遵守 busy/unknown 守卫，不能由手势直接卸载任务。[Base UI Dialog](https://base-ui.com/react/components/dialog)

## Level 2 契约

以下为接口规格，不是本轮新代码。所有 ID 取共享契约完整类型，所有 callback 表示意图而非组件内部写请求。

| 组件                      | 输入                                                     | 输出意图                                | 不得承担的职责                    |
| ------------------------- | -------------------------------------------------------- | --------------------------------------- | --------------------------------- |
| ModeSwitcher              | mode、transitionBlockedReason、layout、storageStatus     | requestMode(daily/management)           | 授权、清草稿、直接写localStorage  |
| AppShell                  | mode、route、household、navItems、pendingTasks、viewport | navigate / resumeTask / chooseHousehold | 创建新的QueryClient或任务实例     |
| SearchBar                 | value、entity、loading、scanCapability                   | change / submit / scan / clear          | 自行解析自然语言或过滤完整库存    |
| PageHeader                | title、context、backTarget、primaryAction                | 返回/主要意图                           | 重复多个h1；盲目history.back      |
| ProductSummary            | SKU身份、服务端计数/合计/未知数、coverage                | openItems / intake                      | 从分页累加总数、商品级消耗        |
| ItemRow / ItemCard        | ItemView、facts、actionAvailability、selection           | open(id) / select(id) / action(kind,id) | 将row index/短尾号用作身份        |
| ItemStatus                | lifecycle/opening/custody/service/recordState及unknown   | 无或打开事实说明                        | 把未记录当默认可用                |
| QuantityInput             | decimalString、unit、accuracy、constraints               | setDecimal / setUnit / setAccuracy      | Number精确计算、从规格补数量      |
| LocationPicker            | selectedItemId、候选页、路径、禁用原因、rootAllowed      | choose(ItemID或null)/query              | 接受Catalog ID、隐式建位置        |
| CatalogPicker             | kind、selectedCatalogId、候选/路径/规则摘要              | choose / query / requestCreate          | 同名自动合并、位置混入            |
| DateFactField             | source/kind/dateKind/dueOn/basis/state、模板版本         | 修改明确字段或清除                      | 将所有日期归为expiry或UTC日期偏移 |
| AttentionSummary          | kind、knownCount或null、coverage、stale                  | openCategory                            | 全家庭未去重合计、未知风险推断    |
| OperationSheet            | task、state、closePolicy、footerActions                  | validate/submit/retain/close            | 私有业务mutation、重试换键        |
| ApprovalSummary           | proposal展示数据、scope、validity、busy                  | requestReview / confirm / revise        | 暴露challenge、绕过app-only       |
| ConflictResolution        | original/latest/draft、字段差异、scope                   | reread / chooseFields / confirmIntent   | 静默改revisions或覆盖全部字段     |
| BatchSelectionBar         | selectedIDs、visibleIDs、unavailableIDs、limit           | review/remove/clear/startAction         | SKU行展开授权、隐式全量选择       |
| OfflineBanner             | cacheTime、coverage、online、pendingAttempt              | reconnect / viewRecovery                | 假同步或离线执行                  |
| EmptyState / LoadingState | reason、context、recoveryAction                          | 当前可行下一步                          | 将403/网络错展示成0库存           |
| OperationReceipt          | 服务端result、replay、refreshState                       | openAffected / refreshReads / done      | 用模拟随机ID/本地计算充当回执     |
| LabelPrintPanel           | 明确Item列表、deviceCapability、perPageStatus            | connect/print/stop/confirmPaper         | 自动重打不确定页、伪设备成功      |

## 共享读模型与命令边界

保留 features/inventory/model、adapters 和 features/api 的分层，优先补其纯字段，不一开始全目录搬家。以下扩展是 UI 模型，不能创建第二个领域模型：

- Fact：保留 typed value 与展示字符串、source(template/version/path)、unknown/redacted、accuracy。显示字符串不能反过来参与日期/数量逻辑。
- DateFactView：补 dateKind，保留 kind/source/basis/state/dueOn/completedOn；不能只有 label。
- QueryPage：records、server summary、nextCursor、asOfChangeId、stale、coverage(live/cached subset/none)。coverage为读取证据，不虚构服务器字段。
- SelectionSnapshot：scope + 完整 IDs + 捕获版本 + 当前可见/隐藏计数。mode不是scope；切家庭清除。
- ActionAvailability：available / readOnly / offline / missingFacts / unsupportedHost / missingContract / blockedState，附人类可读原因。feature是运行时能力，不等于权限。
- OperationSession：以[状态文档](interaction-states.md)为准。两种模式发相同 CommandIntent，经同一适配器变成真实 operation payload。

Web/MCP TransportAdapter、StorageAdapter、NavigationAdapter、ScanAdapter、PrintAdapter 为边界。页面不能探测 navigator.bluetooth 或直接操作 window.openai。原生客户端未来可共享非DOM的意图/状态/Token，不复用Tailwind/DOM/蓝牙假适配。

## Token 冻结候选

B00 起，应用 `apps/web/src/ui/tokens/source.json` 是唯一可编辑值源。[design-tokens.json](design-tokens.json) 与运行时 CSS 是生成快照，通过 `pnpm generate:ui-tokens` 更新，`pnpm check:ui-tokens` 校验。旧 tokens.ts 和临时 Ant ThemeConfig 读取同源 legacy 区，保留旧呈现。候选视觉值未改变，B00 仍待用户批准。

根容器使用 data-acornary-mode=daily / management；overlay root继承同一属性。语义名包括 background、foreground、surface、surfaceRaised、mutedForeground、border、controlBorder、accent、accentHover、accentActive、accentForeground、accentText、selection、selectionForeground、focus、danger/warning/success/info 与对应surface。页面禁止硬编码色值。

Tailwind v4主题变量与普通CSS变量可映射；使用显式语义token，避免套一份互不关联的默认色板。[Tailwind theme variables](https://tailwindcss.com/docs/theme)

字体保持系统无衬线正文，系统宋体仅品牌和少量标题。两种模式共享字体/尺度；日常正文16，管理桌面正文14，触屏输入16。间距4/8/12/16/24/32/48，圆角8/12；列表最小行高日常72、管理桌面56，内容增长时可扩展。触屏主目标44，桌面控件36，关闭/返回始终44。

主按钮白字；accentText用于浅底文字，不直接把任意accent填到小字号。控制边界使用controlBorder；低对比border只分隔内容，不能作为输入框唯一边界。错误/警告/成功状态在两模式完全一致。focus为2px实线+2px间距，空间不足不能裁切。

交互时长120/180ms，reduce motion时0；不做模式整页滑移。sheet普通560/宽720；这些值是最大宽度，受容器约束。仅浅色；不响应宿主深色自动改token，宿主深色可记录但应用保持稳定浅色。

Token数值对比度见[token-contrast](token-contrast.md)。计算只能验证色对，不能验证叠加、文字尺寸、实际焦点遮挡或浏览器渲染；后续必须实际页面验收。

## Fixture 和实现隔离

Phase 2生产组件只import真实类型/共享纯逻辑，不importfixtures。独立开发入口将 fixture repositories/transport 注入顶层；mock receipt和时序只留在开发/测试装配层。fixtures必须覆盖空、未知、估计、多个SKU、多位置、100件、长文本、旧版本、redacted、权限、超时、冲突、存储失败和宿主限制。

正式入口不开模拟写入；尚未接线的生产路径继续使用既有页面。开发界面清楚显示fixture环境，不修改正式家庭生成样本。Phase 2 的UI事件可被受控测试驱动，但不能把“演示成功”写进生产组件分支。
