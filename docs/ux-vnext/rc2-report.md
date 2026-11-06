# Component Library RC2：密度、层级与文案修正

2026-11-06 · `codex/frontend-vnext` · 全部 70 个公开组件、5 个组合场景保持 **待用户审阅**。本次完成已批准审查建议的实现，不代表 Phase 2 工程验收或正式业务交付。

## 目标与本轮内容

针对用户指出的普遍问题：横屏空间浪费、物品名称不突出、重复副标题和长动作文字。覆盖全部组件分组的共同呈现规则及五个组合场景；没有为无问题的基础控件制造额外改动。

- 搜索列表改为宽屏身份、位置、余量、日期、动作横向组织；日常名称 16px/600，管理名称 14px/600，均使用主文字色。状态和名称合并到同一身份区域，长内容自然增长。
- 表单按实际内容宽度在 820px 起分为两列，数量与单位保持关联，窄屏单列。普通提示可展开，字段错误、缺少时区和非法完成日期直接可见。
- 管理表格保留分页及完整 UUID 选择；手机一个图标入口展开事实和记录详情，静态短编号区分同名物品，完整 ID 和版本在详情中。分类树在窄屏收起。
- 事实组件提供摘要和详情呈现；来源、依据、完整身份与技术引用仍可访问。未知数量、估计性质、日期真实类型、操作范围与不确定结果没有改成默认事实。
- 精简审批、冲突、回执、离线、草稿、扫码和打印面板；冲突与审批采用宽面板，恢复动作与禁用编辑区分开。没有改变真实协议或生成模拟成功。
- 附件采用紧凑行，历史前后值按容器宽度并排，复杂原始值和保留字段按需展开。Shell 去掉重复边距及固定 640px 高度，导航切换沿用共享状态。
- 工作台与 Storybook 共用 ReviewFrame：顶部保留“预览 · 示例数据”，审阅教学说明移到独立折叠区域，点击反馈继续可见。四套配色、两种模式、稳定链接及审阅机制保持。

## 审阅入口

- [中文组件工作台](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=daily&viewport=1440&scenario=normal)
- [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--form)
- [逐项清单](component-review.md) · [机器目录](component-catalog.json) · [RC2 设计说明](rc2-design-notes.md)

建议先看搜索列表、表单和管理选择，再看恢复面板、Shell，最后逐项审阅共享组件。Storybook 的旧 `rc1-*` ID 有意保留，显示标题和候选版本已更新为 RC2，已有书签继续有效。

## 修改文件与契约

主要路径：`apps/web/src/ui/components/ui/`、`apps/web/src/ui/patterns/`、`apps/web/review/`、`.storybook/preview.ts`、`scripts/ui/catalog.mjs` 和本目录。未改正式 main/plugin 入口、领域模型、旧业务控制器、依赖或锁文件、Token 来源和 legacy 值。

沿用 `ItemView`、`QuantityPresentation`、`DateFactPresentation`、`SelectionSnapshot`、`ActionAvailability`、`OperationPresentation` 和共享 `WriteResultV2`；数量仍是 decimal string，操作与选择仍使用完整 Item ID。

兼容新增的展示接口包括 `FactPresentation`、`FormField.hintMode/labelVisibility`、`ItemIdentity.status/showId`、`DataTable.renderRowDetails/showOpenAction/showSelectionSummary`、`DateFactField.basisRequired`、`OperationReceipt.objectLabels`、`OperationSheet.size/recoveryContent`、`BatchSelectionBar.scopeLabel`。接口没有引入业务网络、浏览器存储或设备执行。

受影响的用户任务是 D01–D09、M01–M06 的共享呈现层；完整任务页面仍未装配或接线。示例搜索集合从 3 件扩展到 9 件，每页 6 件，用于观察密度与分页，不代表真实库存。

## 实际执行的检查

环境：Node 24、pnpm 11.19.0。以下结果均来自本地隔离工作树。

| 命令 / 检查 | 结果 |
| --- | --- |
| `pnpm exec tsc -p apps/web/tsconfig.json` | 通过，涵盖候选 UI、预览和 stories |
| `pnpm build:ui-preview` | 通过 |
| `pnpm build:storybook` | 通过 |
| `node scripts/ui/catalog.mjs --write`、`pnpm check:ui-catalog` | 70 组件 + 5 组合 + 592 场景，全部 Storybook ID 可解析 |
| `pnpm check:ui-tokens` | 同源派生产物一致；8 种外观组合中 125 个文字色对达到既定阈值 |
| `pnpm check:ui-boundaries` | 77 个生产图文件未导入 review/fixture；74 个候选源码文件无直接业务/设备 I/O |
| 修改文件 Prettier 解析/格式化 | 通过 |
| 独立代理只读审阅 | 发现 3 项具体问题并修复；仅复核该三项源码后无遗留阻断，不等同完整 QA |

独立审阅修复：手机同名物品缺少区分信息、非法完成日期提示被隐藏、离线 fieldset 连同重连按钮一起禁用。新增非法完成日期 fixture，审阅状态没有自动批准。

预览和 Storybook 仍有大于 500kB 的构建分块提示；预览 JS 约 1,241kB（gzip 387kB），这是包含完整审阅库的隔离构建，不是正式产品性能结果。没有据此宣称性能预算达标，也没有抬高警告阈值。

## 浏览器证据及边界

使用 Codex 内置浏览器做限定人工交互检查，没有运行 Playwright 回归套件。检查了五个组合的桌面和手机代表布局，并检查了工作台 1024px iframe 内配色/模式切换保留输入、日期依据首字符输入保持焦点、完整编号展开、管理行展开和 UUID 选择、冲突选项、面板关闭、离线重连意图、非法完成日期常驻错误、Storybook 载入。

- **1440×900 独立列表预览**：普通行实测 102px，首行 y≈254px；完整可见 5 行，第 6 行部分可见。文档横向宽度与视口均 1440px。
- **1440×900 独立表单预览**：主要表单底部 y≈522px，核对按钮在首屏；文档宽度 1440px，无横向溢出。
- **390px 管理预览**：单列摘要与展开入口可达；完整 ID 仍在展开内容，短编号常驻。此轮最终截图包含同名物品区分信息。
- 上述数字是当前 fixture 与浏览器下的布局观察，不是 RC1 同条件性能基线，不声称耗时或完成率提升百分比。Storybook 外框、浏览器缩放和实际窗口尺寸会改变可见区域。

截图：

- [列表桌面](evidence/rc2/search-desktop.png)、[列表手机与展开身份](evidence/rc2/search-mobile.png)
- [表单桌面](evidence/rc2/form-desktop.png)、[表单手机](evidence/rc2/form-mobile.png)
- [管理桌面](evidence/rc2/management-desktop.png)、[管理手机](evidence/rc2/management-mobile.png)
- [恢复面板手机](evidence/rc2/operation-mobile.png)
- [Shell 桌面](evidence/rc2/shell-desktop.png)、[Shell 手机](evidence/rc2/shell-mobile.png)
- [Storybook 表单](evidence/rc2/storybook-form.png)

## 未执行与下一轮依赖

完整 `pnpm typecheck`、正式 Web/plugin `pnpm build`、Vitest、全部 Playwright 回归、Docker CI、性能采样、真人任务、完整无障碍与六档宽度矩阵、真实 MCP/设备验证均未执行，继续保留为后续门槛。592 是已登记的可切换场景数量，不是全部经过人工验收的场景数。

没有接触正式库存、没有修改认证/审批/扫码/打印执行，没有推送、触发 CI 或部署。下一轮依据用户逐项反馈统一修改和冻结组件，再进入完整业务页面装配；不得根据本报告或自动检查更新为用户已批准。
