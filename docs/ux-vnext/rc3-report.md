# Component Library RC3：排版与对齐修正

2026-11-07 · `codex/frontend-vnext` · 70 个公开组件、5 个组合场景仍为 **待用户审阅**。

## 目标与完成范围

按用户批准的 [RC2 排版与对齐审阅](rc2-typography-alignment-audit.md)，先统一共享组件规则，再检查五个组合场景。保留四套配色、系统无衬线字号角色、信息密度方向及已认可的任务流程。本次是组件设计候选修正，不是 Phase 2 工程验收或业务接线完成。

| 问题 | RC3 修正 |
| --- | --- |
| A01 控件密度与外框 | 主题根使用命名 `vn-host` 容器，派生 `--vn-control-height` 和 `--vn-input-size`。桌面单行控件 36px，窄宿主/触控至少 44px，窄屏输入 16px。字段容器只处理分栏。Combobox 外框不再额外叠加 2px，日期图标与输入同高；树、菜单、详情入口也采用共享密度 |
| A02 主要事实基准 | 名称、位置、数量、日期采用统一主行框。真实日期类型与来源入口放在辅助行；已知、未知、可点击与纯文字位置保持相同主要行框。字号角色不变 |
| A03 展开锚点 | 日期和身份的展开内容置于稳定摘要之下。表格详情使用独立 `tr > td[colSpan]`；摘要行、选择框与位置不再按展开后的总高度居中 |
| A04 表头对齐 | 排序触发器去掉重复横向 padding 和透明边框，文字与对应单元格同起点 |
| A05 列表列宽 | 动作轨道为确定宽度；`.vn-item-list` 让混合选择列表统一预留选择槽。纯浏览列表不留空槽，独立行按自身选择状态布局。ItemCard 在宽容器同样横排，窄卡才堆叠 |
| A06 工具栏 | FilterBar 的范围信息移到控件组之后。Shell 共享标签/控件行，家庭选择与外观动作对齐；紧凑布局不再另行覆盖控件高度 |
| A07 标签与间距 | FormField 的可展开帮助进入控件行独立槽位，标签与输入起点不受帮助按钮影响。错误和布局说明显式零 margin，由容器管理间距。笔记 prose 独立定义段落、标题及列表间距 |
| A08 手机字段宽度 | 数量依据独占一行时填满字段组，删除独立 256px 上限；保留数量与单位相邻关系 |

没有新增公开组件或业务 props。新增的是共享布局类、受控组件内部结构与隔离审阅场景。帮助按钮仍有可读名称、展开关联与描述；手机触控目标没有缩小。未知、估计、日期类型、完整 UUID、版本、审批影响和不确定结果恢复入口保留。

## 审阅入口与顺序

1. [控件密度与标签对齐](http://127.0.0.1:6006/?path=/story/rc1-controls--density-alignment)：Input、Select、Combobox、DateInput 并排；可切换错误、禁用、只读和长文本。
2. [小型表单](http://127.0.0.1:6007/?component=composition-form&preset=sage&mode=daily&viewport=1440&scenario=alignment)：有/无帮助入口、手机字段宽度与展开说明。
3. [搜索列表](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=daily&viewport=1440&scenario=alignment)：长名称、不同动作、有/无选择、有/无动作共存时的列对齐。
4. [管理选择](http://127.0.0.1:6007/?component=composition-management&preset=sage&mode=management&viewport=1440&scenario=normal)：表头、摘要与展开详情。
5. [操作与恢复](http://127.0.0.1:6007/?component=composition-operation&preset=sage&mode=daily&viewport=390&scenario=revisionConflict)、[双模式 Shell](http://127.0.0.1:6007/?component=composition-shell&preset=sage&mode=daily&viewport=1440&scenario=normal)：宽窄布局、动作区与任务连续性。

主入口：[中文工作台](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=daily&viewport=1440&scenario=normal) · [Storybook](http://127.0.0.1:6006/) · [逐项清单](component-review.md)。Storybook 显示 RC3，原 `rc1-*` 稳定 ID 保持，已有链接继续可用。

目录现为 **597 个登记场景**，比 RC2 增加 5 个（搜索组合、表单组合、DataTable、ItemRow、ItemCard 的对齐场景）；另提供一个 Storybook 综合控件样板。场景登记数量不代表逐个验收通过。组件登记保留原反馈和配色决定，没有自动添加批准记录。

## 浏览器观察与证据

使用 Codex 内置浏览器人工查看与点击，没有运行 Playwright 回归套件。五个组合均检查了 1440px 桌面和 390px 手机代表布局；另检查 320px 错误表单、1024px 紧凑 Shell、宽页面中的 390px iframe，以及 Storybook 控件样板。初轮发现的宽卡强制堆叠和残留独立密度规则已修正，再确认受影响项。

| 实际观察 | 结果 |
| --- | --- |
| 1440px 表单 | 名称输入、帮助按钮、位置 Combobox、数量/单位/依据、日期类型、日期输入与日历按钮均为 36px；名称及位置输入同起点 y=137.09 |
| 390px 表单 | 单行输入与选择均为 44px，输入字号 16px；依据宽约 357.99px，字段组 358px。多行文本仍可自然增高 |
| 日期来源展开 | 主日期 y=262.59，展开后仍为 262.59，位移 0；RC2 相同问题曾下移约 39.25px |
| 混合列表列宽 | 六行名称 x=89、位置 x=526.24 一致；存在的数量列 x=774.49、动作列 x=1270.99 一致，长动作与缺少动作未改变这些起点 |
| 表头 | “物品”排序标题与对应名称均从 x=321 开始，重复 16px 缩进已消除 |
| 表格展开 | 名称 y=306.09、复选框 y=314.09、位置 y=313.59，展开后保持相同；RC2 复选框和位置曾下移 44px |
| 搜索工具栏 | 搜索输入、搜索按钮、扫码按钮、筛选按钮均在 y=108.09，高 36px |
| Shell | 桌面家庭选择与配色动作均为 y=105.5、高 36px；1024px 紧凑 Shell 的模式、家庭、添加、配色控件均为 36px；手机按共享规则变为 44px |
| 错误与正文节奏 | 320px 表单错误直接可见，三个错误段落 margin 均为 0；备注预览实测标题后 8px、后续标题前 24px、普通段落间 16px；回执状态段落 margin 为 0 |
| iframe 与交互 | 外观由 sage/daily 切为 berry/management 后，已输入名称保留，390px iframe 内输入仍为 44px/16px。帮助展开不移动原输入；冲突单选可用；日期浮层 Escape 关闭后焦点回到日期入口 |

上述坐标仅属于本地确定 fixture 和对应视口，用于比较对齐，不是性能或真实用户效率结论。320px 错误表单、390px 列表/管理、1440px 列表/表单、1024px Shell 的页面宽度与视口一致，未见横向溢出；不把这些样本扩展为全状态、全浏览器或所有缩放比例通过。

截图：

- [表单桌面](evidence/rc3/form-desktop.png)、[表单手机](evidence/rc3/form-mobile.png)、[320px 错误](evidence/rc3/form-errors-320.png)
- [混合列表桌面](evidence/rc3/search-desktop.png)、[普通列表手机](evidence/rc3/search-mobile.png)、[日期展开](evidence/rc3/date-expanded.png)
- [管理展开桌面](evidence/rc3/management-desktop.png)、[管理展开手机](evidence/rc3/management-mobile.png)
- [操作桌面](evidence/rc3/operation-desktop.png)、[操作手机](evidence/rc3/operation-mobile.png)
- [Shell 桌面](evidence/rc3/shell-desktop.png)、[Shell 手机](evidence/rc3/shell-mobile.png)
- [备注段落](evidence/rc3/note-mobile.png)、[外观切换保留输入](evidence/rc3/appearance-input-retained.png)、[Storybook 样板](evidence/rc3/storybook-controls.png)、[审阅工作台](evidence/rc3/review-workbench.png)

## 实际工程检查

采用已安装的 Node **24.22.1** 与 pnpm **11.19.0**，仅为本次命令指定路径；没有修改系统默认运行时、依赖或锁文件。

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm exec tsc -p apps/web/tsconfig.json` | 通过，候选组件、stories 与预览类型可用 |
| `pnpm build:ui-preview` | 最终源码构建通过 |
| `pnpm build:storybook` | 最终源码构建通过 |
| `node scripts/ui/catalog.mjs --write` | 70 组件、5 组合、597 登记场景，全部登记 Storybook 链接存在 |
| `pnpm check:ui-boundaries` | 正式图 77 文件未导入 review/fixture；候选 74 源文件无直接业务/设备 I/O |
| `pnpm check:ui-tokens` | 同源一致；8 种外观组合的 125 个文字色对达到既定阈值 |
| 修改代码 Prettier、`git diff --check` | 通过 |
| Impeccable layout/type 限定静态扫描 | layout 0 命中，type 9 条 advisory，均为已有旧 UI/审阅外框字号；没有将静态零命中当作视觉通过 |

预览构建仍提示大于 500kB 的分块。独立工作台包含完整审阅库，JS 约 1,263.56kB（gzip 388.54kB），不是正式产品性能包；未调整警告门槛或宣称性能验收通过。

## 修改文件、契约与边界

共享修正集中于 `src/ui/theme/vnext.css`、`components/ui/controls.css`、`form-field.tsx`、`data-table.tsx`、`overlays.css`，以及 `patterns/` 内事实、列表、字段、导航、操作和内容样式与对应组件。`review/` 增加隔离样例、更新显示版本和审阅记录；`scripts/ui/catalog.mjs` 从审阅记录读取版本，继续生成目录。

沿用 `ItemView`、`QuantityPresentation`、`DateFactPresentation`、`SelectionSnapshot`、`ActionAvailability` 及既有回执类型；数量精度、日期来源、完整 Item UUID 与事件/版本语义不变。没有修改领域契约、Token 数值/legacy、正式 Web/plugin 入口、旧业务控制器或生产草稿。

## 未执行与下一步

回归继续暂停：没有运行完整 Vitest、任何 Playwright 回归套件、Docker CI、正式 Web/plugin 构建、全仓库类型检查、性能基准、真人任务、真实 MCP/扫码/打印设备验证。没有完成屏幕阅读器、全浏览器、完整六档宽度/缩放矩阵或全部 597 状态验收。

没有触及正式库存、认证/审批执行，没有推送、触发 CI 或部署。下一步是用户审阅 RC3；反馈落到共享组件和对应状态，明确确认后再冻结视觉、推进完整业务页面装配。
