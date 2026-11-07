# Component Library RC5：列表与说明精简

2026-11-07 · `codex/frontend-vnext`。本轮处理新增 **4 条**页面意见；此前 RC4 的 18 条处理结果保留。22 条原意见仍存于 `.local/ui-review-feedback/`，没有覆盖原文。70 个组件、5 个组合场景仍待用户审阅。

## 修改结果

| 原意见 ID / 页面                                  | 实施                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `09006854-494a-4474-9895-a867630b817a` · TreeView | 桌面单行最小高 28px、每层缩进约 17px；有副行的节点按内容增高。保留层级导线、选中状态和原键盘行为；窄屏及触控展开目标仍为 44px                                             |
| `4d25070a-266f-4af9-a0c1-93fe28288382` · 搜索组合 | 共享 `.vn-item-list` 改为连续列表；行间距和逐行圆角归零，使用分隔线。分页移到列表外，选择、完整 UUID、操作回调不变。单独 ItemCard 仍保留卡片容器                          |
| `6d63e129-c4bc-46b2-b449-930e4b5e5f36` · 表单组合 | 删除位置说明、数量说明；快捷表单不显示“依据与详情”。日期依据在要求必填或选择估计日期时出现，输入保留；错误、时区缺失、位置禁用原因仍显示                                  |
| `918f2c75-2204-4a9e-b694-7540a6c9a3a5` · ItemCard | ItemRow/ItemCard 不再重复展示“最佳食用期”“依据与来源”及自定义日期标题。日期本身变为可点击入口，打开真实日期类型、状态、依据和来源；估计日期带“约”，到期/逾期/完成状态保留 |

新增展示 props：`DateFactValue.dateOnly` 与 `DateFactField.showDetails`；不改变事实、业务请求或协议。默认 DateFactField 仍可完整编辑资料，快捷表单显式关闭可选资料。隐藏的旧依据随草稿保留，没有用空值覆盖。

每条新增意见下已显示 **RC5 · 已修改，待复审**，处理记录位于 `apps/web/review/feedback/resolutions.json`。没有自动批准组件。

## 复审入口

- [连续物品列表](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=management&viewport=1440&scenario=normal)
- [紧凑层级树](http://127.0.0.1:6007/?component=tree-view&preset=sage&mode=management&viewport=1440&scenario=normal)
- [精简表单](http://127.0.0.1:6007/?component=composition-form&preset=sage&mode=management&viewport=1024&scenario=normal)
- [物品卡片](http://127.0.0.1:6007/?component=item-card&preset=sage&mode=management&viewport=1440&scenario=normal)
- [Storybook](http://127.0.0.1:6006/) · [完整清单](component-review.md)

## 本轮实际检查

使用现有 Node 24.22.1 / pnpm 11.19.0。前端 `pnpm exec tsc -p apps/web/tsconfig.json`、`pnpm build:ui-preview`、`pnpm build:storybook` 通过；`pnpm check:ui-boundaries` 确认正式导入图 77 文件无 review/fixture，候选 74 源文件无业务/设备 I/O。目录生成核对 70 个组件、5 个组合、597 个状态及 Storybook 链接；代码格式化和 `git diff --check` 通过。

独立预览仍有大分块提示：JS 约 1,282.68kB，gzip 394.64kB。这是包含全部候选的审阅包，不是正式产品性能验收。

浏览器直接查看和点击，仅检查本轮受影响样本：

- 1186px：列表间距 0、行圆角 0；行高约 84px。树单行高 28px，节点横向起点为 24/41/58px；有副行的节点约 44.5px。表单没有三种说明入口，卡片默认没有重复日期文字。
- 390px：搜索列表、表单、树的页面宽度均为 390px，无横向溢出；树展开按钮实测 44px。
- 日期点击与 Enter 可打开完整资料；Escape 已观察到触发器收起，未单独完成退出动画后的焦点恢复验证。未据此声称完整无障碍通过。
- 表单选择“估计日期”后出现依据字段，输入后仍可继续编辑，没有因为第一字符输入卸载字段。
- 新意见下显示 RC5 修改说明；未新增测试评论，原记录共 22 条。

截图：[桌面列表](evidence/rc5/search-1186.png)、[树](evidence/rc5/tree-view-1186.png)、[表单](evidence/rc5/composition-form-1186.png)、[卡片](evidence/rc5/item-card-1186.png)、[日期资料](evidence/rc5/date-details-1186.png)、[手机列表](evidence/rc5/composition-search-390.png)、[手机表单](evidence/rc5/composition-form-390.png)、[手机树](evidence/rc5/tree-view-390.png)、[估计日期输入](evidence/rc5/form-estimated-390.png)、[意见回复](evidence/rc5/feedback-response.png)。

## 保留门槛

回归继续暂停：未运行 Vitest、Playwright 回归套件、Docker CI、全仓库检查、正式 Web/plugin 构建、性能和真人任务测试，未验证真实 MCP、扫码/打印设备或完整浏览器/宽度/597 状态矩阵。未触及正式业务、库存数据、依赖、部署或推送。

下一步在页面复审 RC5，可继续追加意见。实现完成不等于用户批准或 Phase 2 工程验收通过。
