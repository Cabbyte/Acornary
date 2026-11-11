# Component Library RC4：页面意见修正

2026-11-07 · `codex/frontend-vnext` · **18 条意见已处理，70 个组件与 5 个组合场景仍待用户审阅**。

本轮读取本工作树 `.local/ui-review-feedback/*.json` 中的 18 条真实意见，涉及 17 个组件/场景。按共享组件规则修正，再人工检查受影响组合。原意见文件保持不变；[处理记录](../../apps/web/review/feedback/resolutions.json)按唯一编号关联，页面可看到“已修改，待复审”和修改说明。本轮不恢复回归测试。

## 审阅入口

- [商品汇总与意见处理记录](http://127.0.0.1:6007/?component=product-summary&preset=berry&mode=daily&viewport=1440&scenario=normal)：展开页面的“修改意见”，逐条查看原意见与回复。
- [1024px 小型表单](http://127.0.0.1:6007/?component=composition-form&preset=sage&mode=daily&viewport=1024&scenario=normal)：名称/位置一行，数量/日期一行。
- [双模式 Shell](http://127.0.0.1:6007/?component=composition-shell&preset=sage&mode=daily&viewport=1440&scenario=normal)：检查设置下方切换入口及切换前后的尺寸。
- [中文工作台](http://127.0.0.1:6007/) · [Storybook](http://127.0.0.1:6006/) · [完整组件清单](component-review.md)。

全部组件显示 RC4，原 `rc1-*` Storybook 固定 ID 保留。目录仍为 70 个公开组件、5 个组合、597 个登记状态；登记数不表示逐项验收。

## 逐项修改

表中编号为原意见 ID 的前 8 位；完整编号及响应在处理记录中。商品汇总有两条意见，合并实施。

| 组件 / 意见编号                         | 修正与保留的语义                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| FormField · `a603be02`                  | “必填”改为强调色 `*`；Select、Combobox、RadioGroup 同步，保留必填可读名称和控件语义                                      |
| Badge · `ee6a380c`                      | 图标统一 14px 槽；宽屏图标加文字，窄容器图标简写。名称仍可被辅助技术读取，悬停可查看；重要范围标签保留文字               |
| RadioGroup · `e36f39aa`                 | 默认横排并自然换行，隐藏普通副标题；冲突核对值、扫码候选身份等必要事实显式保留                                           |
| Select · `720c511c`                     | 选项只显示名称与选中标记；禁用原因保留提示与辅助描述                                                                     |
| Table · `b3b60e8b`                      | 缩窄选择列，使用正式 Checkbox；打开改为图标；示例规格不再以圆点分隔                                                      |
| TreeView · `8ecc5cf0`                   | 增加各层竖向缩进线；统一展开图标、叶节点槽和选中图标，原树键盘逻辑保留                                                   |
| ItemIdentity · `516f3c31`               | 取消编号下拉，短编号旁提供复制图标；详情仍可显示完整 ID。组件只发出复制意图，预览读取实际剪贴板写入结果                  |
| QuantityValue · `799ad7a3`              | 审阅页原生选择框换为正式 Select；DateFactValue 审阅页同步                                                                |
| SearchBar · `22b53977`                  | 隐藏浏览器重复清除控件，仅保留一个入口；窄栏搜索只显示图标，扫码放在搜索之前                                             |
| PageHeader · `4e595c6a`                 | 返回改为等高图标按钮，标题和操作按钮共享主行；说明另置下方                                                               |
| ProductSummary · `588d7f1f`、`05b316f6` | 名称 22px；数量合计和真实日期为第二层；件数、位置等降为辅助文字，压缩垂直间距，其余资料可展开                            |
| BatchSelectionBar · `77a7f788`          | 主处理动作在左，核对/清空在右；明确 UUID 范围、隐藏选择与 100 件限制保持                                                 |
| ApprovalSummary · `98210cb5`            | 确认在左，重新核对/返回修改在右；原审批状态、失效与禁用条件保持                                                          |
| DesktopNavigation · `39b4b62f`          | 设置下方显示带当前模式文字的一键切换按钮；窄屏继续使用顶部切换面板                                                       |
| AttributeFields · `6ca3d1fc`            | 简单字段最小列宽 200px，1024px 下四个字段同排；多行/复合字段在宽屏跨两列                                                 |
| 小型表单 · `c9c4f3a1`                   | 名称与位置并排，数量/单位/依据和日期并排；根位置及未知位置收进选择器，不再常驻占行。仍明确区分“不放入容器”与“位置未记录” |
| 双模式 Shell · `bf9780dd`               | 移除按模式缩小物品名称、改变行高和内容宽度的规则；管理表格密度由表格本身决定                                             |

商品汇总显示“已记录合计”，避免把有未知项的合计冒充完整总量；日期保留实际日期类型与到期警示。未知件数、来源、开封、生命周期和库存状态仍在“更多资料”中。普通视觉说明缩短，身份与操作影响不被删去。

## 共享接口与修改范围

- 基础组件：必填标记、选择选项、Badge 图标与紧凑规则、TreeView 层级导线。
- 产品组件：事实显示、字段布局、搜索、商品汇总、动作分组与模式入口。
- 隔离审阅：演示控件改用正式组件、实际复制反馈、RC4 标识、意见处理说明；原评论全文仍留在 Git 忽略的本地目录。
- 新增可选展示 props：`Badge.icon` / `compact`、`RadioGroup.showOptionDescriptions`、`DateFactValue.compact`。均不执行业务请求。
- Token 单源生成逻辑统一通用行高；旧 `legacy` 数值、四套配色数值、领域契约、依赖和锁文件未改。

继续沿用数量 decimal string、真实日期类型/来源、完整 Item UUID、选择快照、权限与操作状态输入。没有改写写入状态机、审批协议或正式入口。

## 实际检查与浏览器证据

环境：Node 24.22.1、pnpm 11.19.0；仅为本次命令指定现有运行时路径。

| 检查                                      | 结果                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm exec tsc -p apps/web/tsconfig.json` | 通过                                                                        |
| `pnpm build:ui-preview`                   | 通过；独立审阅包 JS 1,280.27kB / gzip 394.04kB，仍有大分块提示              |
| `pnpm build:storybook`                    | 通过，固定 story ID 可解析                                                  |
| `pnpm check:ui-tokens`                    | 同源一致；8 种组合共 125 个文字色对达到既定阈值                             |
| `pnpm check:ui-catalog`                   | 70 组件、5 组合、597 个状态，登记链接可解析                                 |
| `pnpm check:ui-boundaries`                | 正式导入图 77 文件无 review/fixture 导入；候选 74 源文件无直接业务/设备 I/O |
| 修改代码格式化、`git diff --check`        | 通过                                                                        |
| 意见与处理记录核对                        | 18 条均有对应记录，75 个审阅项仍待审阅，无自动批准                          |

使用 Codex 内置浏览器直接查看和操作，没有运行 Playwright 套件。记录的是确定 fixture 的代表样本：

| 观察           | 结果与证据                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1024px 表单    | 名称/位置同排、数量/日期同排；输入与选择均为 36px。[截图](evidence/rc4/form-1024.png)                                                                                                            |
| 1024px 属性    | 四个简单字段同一行，各宽约 224px；未见横向溢出。[截图](evidence/rc4/attribute-fields-1024.png)                                                                                                   |
| 1024px 标题    | 返回、标题主行、操作均高 36px，位于同一 y=131 基准。[截图](evidence/rc4/page-header-1024.png)                                                                                                    |
| 层级树与表格   | 缩进线层级可读，选择列收窄、打开为图标。[树](evidence/rc4/tree-view-1024.png)、[表格](evidence/rc4/table-1024.png)                                                                               |
| 横排与动作分组 | 普通单选同一行；批量和审批主动作左置、辅助动作右置。[单选](evidence/rc4/radio-group-1186.png)、[批量](evidence/rc4/batch-selection-bar-1186.png)、[审批](evidence/rc4/approval-summary-1186.png) |
| 商品汇总       | 1186px 样本名称 22px，卡片高约 218px；数量和日期并列，日期间隔 8px。[截图](evidence/rc4/product-summary-1186.png)                                                                                |
| 360px 搜索     | 清除入口一个；扫码在搜索之前；搜索只显示图标，动作目标 44px；点击清除后输入为空。[截图](evidence/rc4/search-360.png)                                                                             |
| 同组件跨模式   | Shell 中内容、输入、物品行位置和尺寸相同；名称两模式均 16px。点击模式按钮能切换，内容区宽度保持                                                                                                  |
| 真实组件交互   | 编号复制显示实际成功；数量选择切到未知可见；Select 弹层只有名称与勾选。[复制](evidence/rc4/identity-copy.png)、[选项](evidence/rc4/select-options.png)                                           |
| 意见响应       | 原商品汇总的两条意见保留，下方分别显示 RC4 修改说明。[截图](evidence/rc4/feedback-resolutions.png)                                                                                               |

五个组合在 390px 查看，页面宽度均未超过视口：[搜索](evidence/rc4/composition-search-390.png)、[表单](evidence/rc4/composition-form-390.png)、[管理](evidence/rc4/composition-management-390.png)、[操作](evidence/rc4/composition-operation-390.png)、[Shell](evidence/rc4/composition-shell-390.png)。操作场景另实际打开[冲突面板](evidence/rc4/operation-conflict-390.png)，核对值仍可见，未选择前确认禁用。桌面另检查搜索、管理、Shell 与表单；桌面操作仅查看启动入口，未将其记为完整面板通过。

截图采集期间最后一轮仅调整 Badge 默认图标与物品状态语义图标、商品日期间距，最终状态见 [Badge](evidence/rc4/badge-1186.png) 与[商品汇总](evidence/rc4/product-summary-1186.png)。早期窄屏组合截图用于布局证据，不代表最后图标字形。

## 未执行与下一步

完整 Vitest、Playwright 回归、Docker CI、全仓库类型检查、正式 Web/plugin 构建、性能基准、真人任务、真实 MCP/扫码/打印设备验收均未执行。未逐一检查全部 597 状态、全部浏览器、缩放/屏幕阅读器及所有六档宽度。独立预览大分块提示仍保留，不以此构建结果代替性能验收。

正式库存、认证与审批执行未接通；没有推送、触发 CI 或部署。下一步由用户在同一工作台复审 RC4，可继续逐页补充意见；组件获明确确认后才冻结并进入完整业务页面装配。
