# Component Library RC6：360px 对齐与图标动作

2026-11-07 · `codex/frontend-vnext`。处理新增 4 条页面意见及聊天中“使用改为 icon”的要求。累计 26 条页面意见的原文与处理记录保留；全部组件仍待用户审阅。

## 修改与原因

| 意见 / 组件                                                | 原因与修正                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b450b1ca-9ad6-4e6c-ad5f-199a2dc0af6b` · ItemCard          | 原选择框占据每一行，数量与日期再均分剩余宽度，导致日期被拆断。选择槽现在只影响标题；数量/日期组成共享事实行，使用完整宽度，日期文本不从连字符处折行。更长的事实按整块换行，桌面仍恢复原多列结构 |
| `8f649802-c5b7-425d-b6b2-d3b8349556a7` · BatchSelectionBar | 原主动作与右侧两按钮宽度之和超过可用空间，右侧组掉到下一行。收短为“处理已选 / 核对 / 清空”，保持左主右辅；标题和查看清单采用稳定两列                                                            |
| `deae18eb-8944-44ab-97e7-a5fdf071cab7` · ScanInput         | 原输入/动作在窄屏强制堆叠。现在同排，识别和相机在窄屏用图标，保留名称和禁用条件。识别后的“确认物品”继续独立显示，未绕过身份核对                                                                 |
| `ed3b72c1-3285-4854-a93d-b6b0bf941d29` · AppShell          | 原顶栏给模式的宽度不足。模式列使用内容宽度、短标签不折行；窄屏添加用图标，家庭选择单独一行                                                                                                      |
| 聊天明确要求 · ItemRow / ItemCard / 搜索组合               | `consume` 主动作统一为 Lucide `PackageMinus` 图标，具有“使用 + 物品名称”的可读名称和悬停提示；更多操作改用同一 IconButton。保留原完整 UUID、意图回调、权限、离线、只读和加载限制                |

本轮修正共享组件，没有只覆盖演示页面 CSS。没有减少字体或手机触摸目标来塞入控件，没有修改领域契约或真实业务执行。

## 审阅入口

- [360px 物品卡片](http://127.0.0.1:6007/?component=item-card&preset=sage&mode=management&viewport=360&scenario=normal)
- [360px 批量选择栏](http://127.0.0.1:6007/?component=batch-selection-bar&preset=sage&mode=management&viewport=360&scenario=normal)
- [360px 扫码输入](http://127.0.0.1:6007/?component=scan-input&preset=sage&mode=management&viewport=360&scenario=manual)
- [360px Shell](http://127.0.0.1:6007/?component=app-shell&preset=sage&mode=management&viewport=360&scenario=normal)
- [360px 搜索列表](http://127.0.0.1:6007/?component=composition-search&preset=sage&mode=management&viewport=360&scenario=normal)

页面意见下显示 **RC6 · 已修改，待复审**。工作台与 Storybook 显示 RC6，固定 story ID 不变，用户批准记录未自动更新。

## 实际检查

前端 TypeScript（`pnpm exec tsc -p apps/web/tsconfig.json`）、独立预览和 Storybook 构建通过。静态边界检查：正式导入图 77 文件无 review/fixture，候选 74 文件无直接业务/设备 I/O。目录核对仍为 70 组件、5 组合、597 个登记状态；格式化与 `git diff --check` 通过。未修改 Token、依赖或锁文件。

使用内置浏览器直接检查本轮样本，未运行 Playwright 回归：

| 样本           | 观察                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| 360px ItemCard | 日期保持单行；日期按钮约 124.48 × 44px，使用与更多按钮均 44 × 44px；页面无横向溢出       |
| 360px 批量栏   | 三按钮同一 y=194.5，均高 44px，宽分别 98/66/66px                                         |
| 360px 扫码     | 输入与两个动作同排，动作均 44 × 44px；输入示例编码后识别显示“尚未识别”，确认物品保持禁用 |
| 360px Shell    | 当前模式文字完整，入口 122 × 44px；添加和配色在同一行，家庭选择不受挤压                  |
| 使用图标       | 搜索组合点击后记录 `consume` 意图和原 Item UUID，没有提交业务请求                        |
| 1186px         | 卡片、搜索列表和 Shell 的桌面布局正常；事实列仍横排，页面宽度等于视口                    |

截图：[卡片 360](evidence/rc6/item-card-360.png)、[批量 360](evidence/rc6/batch-selection-bar-360.png)、[扫码 360](evidence/rc6/scan-input-360.png)、[Shell 360](evidence/rc6/app-shell-360.png)、[搜索 360](evidence/rc6/composition-search-360.png)、[卡片 1186](evidence/rc6/item-card-1186.png)、[搜索 1186](evidence/rc6/composition-search-1186.png)、[Shell 1186](evidence/rc6/app-shell-1186.png)。

## 保留门槛

回归测试继续暂停。没有运行 Vitest、回归 Playwright、Docker、性能/真人任务、全仓库类型检查或正式 Web/plugin 构建；未验证所有 597 状态、全部宽度/浏览器、屏幕阅读器或真实 MCP/扫码设备。独立预览的大分块提示仍保留，不宣称性能通过。

没有正式库存写入、业务接线、推送或部署。下一步由用户复审 RC6，处理结果不代表设计批准或 Phase 2 工程验收通过。
