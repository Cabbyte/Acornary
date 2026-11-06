# Component Library RC2 组件审阅清单

70 个正式源码组件与 5 个组合场景已完成候选制作，统一交付审阅。流程 D01–D09、M01–M06 已认可；组件与页面视觉仍需分别确认。

本轮取代逐批等待规则：按工程依赖制作全部候选，未经用户明确确认一律为 **待审阅**。自动检查、预览点击和独立代理审阅不能替用户批准。

- [中文工作台](http://127.0.0.1:6007/) · [Storybook](http://127.0.0.1:6006/)
- [交付和检查报告](rc2-report.md) · [完整场景目录](component-catalog.json)
- 可编辑审阅记录：`apps/web/review/review-status.json`。保存版本、依赖、反馈和批准记录；工作台只展示登记结果。
- 默认 `sage / daily` 仅用于预览，正式默认外观未获批准。

本轮建议先看搜索列表、小型表单、管理选择三个组合场景，再看操作恢复和 Shell，最后逐项检查共享组件。每项均可通过固定链接直接打开。

## 基础输入与选择

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `button` · 按钮 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=button&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--button) |
| `icon-button` · 图标按钮 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=icon-button&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--icon-button) |
| `input` · 单行输入 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=input&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--input) |
| `textarea` · 多行输入 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=textarea&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--textarea) |
| `form-field` · 表单字段 | RC2 | 待审阅 | 5 | [工作台](http://127.0.0.1:6007/?component=form-field&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--form-field) |
| `badge` · 状态标签 | RC2 | 待审阅 | 3 | [工作台](http://127.0.0.1:6007/?component=badge&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--badge) |
| `checkbox` · 复选框 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=checkbox&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--checkbox) |
| `radio-group` · 单选组 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=radio-group&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--radio-group) |
| `switch` · 开关 | RC2 | 待审阅 | 5 | [工作台](http://127.0.0.1:6007/?component=switch&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--switch) |
| `select` · 下拉选择 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=select&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--select) |
| `combobox` · 搜索选择 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=combobox&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--combobox) |
| `tabs` · 标签页 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=tabs&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-controls--tabs) |

## 弹层

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `dialog` · 对话框 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=dialog&preset=sage&mode=daily&viewport=390&scenario=draft) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--dialog) |
| `sheet` · 任务面板 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=sheet&preset=sage&mode=daily&viewport=390&scenario=draft) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--sheet) |
| `popover` · 补充信息浮层 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=popover&preset=sage&mode=daily&viewport=390&scenario=keyboard) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--popover) |
| `tooltip` · 简短提示 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=tooltip&preset=sage&mode=daily&viewport=390&scenario=keyboard) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--tooltip) |
| `dropdown-menu` · 操作菜单 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=dropdown-menu&preset=sage&mode=daily&viewport=390&scenario=keyboard) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--dropdown-menu) |
| `alert-dialog` · 确认对话框 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=alert-dialog&preset=sage&mode=daily&viewport=390&scenario=draft) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--alert-dialog) |

## 结构与通用反馈

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `calendar` · 日历 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=calendar&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--calendar) |
| `date-input` · 日期输入 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=date-input&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--date-input) |
| `table` · 表格 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=table&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--table) |
| `data-table` · 数据表格 | RC2 | 待审阅 | 13 | [工作台](http://127.0.0.1:6007/?component=data-table&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--data-table) |
| `pagination-controls` · 分页控制 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=pagination-controls&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--pagination-controls) |
| `tree-view` · 层级树 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=tree-view&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--tree-view) |
| `skeleton` · 加载占位 | RC2 | 待审阅 | 3 | [工作台](http://127.0.0.1:6007/?component=skeleton&preset=sage&mode=daily&viewport=390&scenario=text) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--skeleton) |
| `toast` · 辅助通知 | RC2 | 待审阅 | 5 | [工作台](http://127.0.0.1:6007/?component=toast&preset=sage&mode=daily&viewport=390&scenario=info) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--toast) |
| `inline-notice` · 行内提示 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=inline-notice&preset=sage&mode=daily&viewport=390&scenario=info) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--inline-notice) |
| `separator` · 分隔线 | RC2 | 待审阅 | 3 | [工作台](http://127.0.0.1:6007/?component=separator&preset=sage&mode=daily&viewport=390&scenario=horizontal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--separator) |

## 事实表达

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `item-identity` · 物品身份 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=item-identity&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--item-identity) |
| `quantity-value` · 数量事实 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=quantity-value&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--quantity-value) |
| `date-fact-value` · 日期事实 | RC2 | 待审阅 | 16 | [工作台](http://127.0.0.1:6007/?component=date-fact-value&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--date-fact-value) |
| `location-path` · 位置路径 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=location-path&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--location-path) |
| `item-status` · 物品状态 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=item-status&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--item-status) |
| `fact-source` · 事实来源 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=fact-source&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-facts--fact-source) |

## 领域输入

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `search-bar` · 搜索栏 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=search-bar&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--search-bar) |
| `filter-bar` · 筛选栏 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=filter-bar&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--filter-bar) |
| `quantity-input` · 数量输入 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=quantity-input&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--quantity-input) |
| `date-fact-field` · 日期事实字段 | RC2 | 待审阅 | 12 | [工作台](http://127.0.0.1:6007/?component=date-fact-field&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--date-fact-field) |
| `catalog-picker` · 目录选择器 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=catalog-picker&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--catalog-picker) |
| `location-picker` · 位置选择器 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=location-picker&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-fields--location-picker) |

## 列表与阅读状态

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `page-header` · 页面标题 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=page-header&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--page-header) |
| `product-summary` · 商品汇总 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=product-summary&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--product-summary) |
| `item-row` · 物品行 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=item-row&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--item-row) |
| `item-card` · 物品卡片 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=item-card&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--item-card) |
| `attention-summary` · 关注汇总 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=attention-summary&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--attention-summary) |
| `batch-selection-bar` · 批量选择栏 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=batch-selection-bar&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-lists--batch-selection-bar) |
| `empty-state` · 空与不可读状态 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=empty-state&preset=sage&mode=daily&viewport=390&scenario=empty) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--empty-state) |
| `loading-state` · 读取状态 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=loading-state&preset=sage&mode=daily&viewport=390&scenario=loading) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-overlays--loading-state) |

## 操作与恢复

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `approval-summary` · 批准范围摘要 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=approval-summary&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--approval-summary) |
| `conflict-resolution` · 版本冲突核对 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=conflict-resolution&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--conflict-resolution) |
| `operation-receipt` · 操作回执 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=operation-receipt&preset=sage&mode=daily&viewport=390&scenario=success) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--operation-receipt) |
| `pending-operation-banner` · 待确认任务 | RC2 | 待审阅 | 6 | [工作台](http://127.0.0.1:6007/?component=pending-operation-banner&preset=sage&mode=daily&viewport=390&scenario=unknown) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--pending-operation-banner) |
| `offline-banner` · 离线范围提示 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=offline-banner&preset=sage&mode=daily&viewport=390&scenario=partial) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--offline-banner) |
| `draft-status` · 草稿保存状态 | RC2 | 待审阅 | 5 | [工作台](http://127.0.0.1:6007/?component=draft-status&preset=sage&mode=daily&viewport=390&scenario=saved) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--draft-status) |
| `operation-sheet` · 操作任务面板 | RC2 | 待审阅 | 16 | [工作台](http://127.0.0.1:6007/?component=operation-sheet&preset=sage&mode=daily&viewport=390&scenario=initial) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--operation-sheet) |

## 导航与外观

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `mode-switcher` · 使用模式切换 | RC2 | 待审阅 | 5 | [工作台](http://127.0.0.1:6007/?component=mode-switcher&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--mode-switcher) |
| `appearance-picker` · 界面配色选择 | RC2 | 待审阅 | 3 | [工作台](http://127.0.0.1:6007/?component=appearance-picker&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--appearance-picker) |
| `desktop-navigation` · 桌面导航 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=desktop-navigation&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--desktop-navigation) |
| `mobile-navigation` · 移动导航 | RC2 | 待审阅 | 7 | [工作台](http://127.0.0.1:6007/?component=mobile-navigation&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--mobile-navigation) |
| `household-switcher` · 家庭范围切换 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=household-switcher&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--household-switcher) |
| `app-shell` · 应用框架 | RC2 | 待审阅 | 8 | [工作台](http://127.0.0.1:6007/?component=app-shell&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-navigation--app-shell) |

## 其他共享能力

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `attribute-fields` · 属性字段 | RC2 | 待审阅 | 18 | [工作台](http://127.0.0.1:6007/?component=attribute-fields&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--attribute-fields) |
| `note-editor` · 备注编辑 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=note-editor&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--note-editor) |
| `attachment-list` · 附件列表 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=attachment-list&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--attachment-list) |
| `attachment-field` · 附件选择 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=attachment-field&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--attachment-field) |
| `history-entry` · 历史记录 | RC2 | 待审阅 | 10 | [工作台](http://127.0.0.1:6007/?component=history-entry&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--history-entry) |
| `history-changes` · 变更对比 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=history-changes&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-content--history-changes) |
| `capability-notice` · 能力与限制说明 | RC2 | 待审阅 | 9 | [工作台](http://127.0.0.1:6007/?component=capability-notice&preset=sage&mode=daily&viewport=390&scenario=available) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--capability-notice) |
| `scan-input` · 扫码与手动输入 | RC2 | 待审阅 | 12 | [工作台](http://127.0.0.1:6007/?component=scan-input&preset=sage&mode=daily&viewport=390&scenario=manual) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--scan-input) |
| `label-print-panel` · 标签预览与打印状态 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=label-print-panel&preset=sage&mode=daily&viewport=390&scenario=not-sent) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-operations--label-print-panel) |

## 组合场景

| ID / 名称 | 版本 | 状态 | 场景数 | 预览 |
| --- | --- | --- | ---: | --- |
| `composition-search` · 组合 · 搜索与物品列表 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--search) |
| `composition-form` · 组合 · 小型物品表单 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=composition-form&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--form) |
| `composition-operation` · 组合 · 操作与恢复面板 | RC2 | 待审阅 | 11 | [工作台](http://127.0.0.1:6007/?component=composition-operation&preset=sage&mode=daily&viewport=390&scenario=draft) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--operation) |
| `composition-management` · 组合 · 管理选择场景 | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=composition-management&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--management) |
| `composition-shell` · 组合 · 双模式 Shell | RC2 | 待审阅 | 4 | [工作台](http://127.0.0.1:6007/?component=composition-shell&preset=sage&mode=daily&viewport=390&scenario=normal) · [Storybook](http://127.0.0.1:6006/?path=/story/rc1-compositions--shell) |

## 已有反馈与确认

- 2026-11-06：用户希望浅色背景更浅、更温暖轻盈，反对大面积陶土/蓝灰背景及宋体标题。
- 2026-11-06：四套可切换配色方案已确认：苔绿/石板蓝、杏橙/靛蓝、莓紫/青灰、陶土/蓝灰。方案确认不代表全部组件或正式默认外观批准。
- 2026-11-06：本轮按照统一候选尺度制作：系统无衬线、桌面正文14px、窄屏16px、标题22px、触摸目标至少44px。具体组件仍可提出整体修改。
- 2026-11-06：本轮一次制作全部组件，统一交付；不再等待每批批准后制作下一批。
- 回归测试继续暂停；本轮仅执行必要的限定检查。

## 后续规则

记录反馈 → 统一修订相关组件与 Token → 将受影响批准项标记为变更后待复审 → 用户确认设计 → 装配完整业务页面。真实业务集成和工程验收分开推进。
