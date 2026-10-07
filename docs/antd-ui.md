# Ant Design 统一界面

本分支将所有 Web、移动 Web、MCP 内嵌、账号、授权和检查器入口迁至 Ant Design 6。迁移候选的代码与验证不代表正式上线；发布沿用现有发布流程另行安排。公开 API、MCP 工具、领域命令及数据库 schema 没有变更。

## 依赖与主题

精确依赖：`antd@6.6.5`、`@ant-design/icons@6.3.4`、`dayjs@1.11.23`。React 19、Vite、TanStack Query 和 Router 保留。锁文件固定安装结果。

所有根入口包裹 `AcornaryUIProvider`（`apps/web/src/ui/theme.tsx`），其内部使用中文 `ConfigProvider`、Ant Design `App` 和无 DOM 包装的 `Form` 上下文。仅浅色；不跟随操作系统切换为深色。

| 项目               | 约定                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| 主色 / 链接        | `#AB5F40`                                                               |
| 页面 / 内容 / 正文 | `#F4F1EE` / `#FFFFFF` / `#191A1B`                                       |
| 圆角               | 控件 8px，面板 12px                                                     |
| 字体               | 系统中文字体，正文 14px，手机表单 16px                                  |
| 尺寸               | 普通控件 36px；手机与触屏主操作至少 44px                                |
| 间距               | 4、8、12、16、24、32px                                                  |
| 图标               | 保留松仓品牌 SVG；通用图标使用 Ant Design Icons，装饰图标对辅助技术隐藏 |
| 语义状态           | Ant Design 成功 / 警告 / 错误色与文字一起展示                           |

消息使用 `App.useApp().message`；确认框使用同一个上下文的 `modal`。禁止静态 `message`、静态 `Modal.confirm` 和 `window.confirm`。关闭按钮和表单字段提供稳定的中文可访问名称；关闭两个汉字按钮的自动插空格，避免朗读名称与文案分离。

组件外观由 theme token 调整。`ui/layout.css` 只维护页面布局、业务内容排版、响应式尺寸及可访问性规则。旧 `product.css`、`soft-gray.css`、`workbench.css`、`style.css` 和旧 Button / Field / Sheet / Toast 实现已移除。未使用的手绘操作 SVG 及其预缓存条目同时删除。

## 组件约定

- 页面导航使用 `Layout`、`Menu`、`Tree` 和 `Breadcrumb`。只保留列表工具栏搜索；`/search` 保留完整搜索。
- 桌面列表使用 `Table`，手机使用紧凑双行列表。查询、过滤、排序作用于完整家庭快照，再分页。每页默认 20，可选 50/100；变更筛选回第一页。
- 选择以真实 UUID 为键，跨页保留；表头全选仅影响当前页。切换家庭不带入旧选择。列表查询、页码和滚动位置按会话与页面保存。
- 详情使用 `Card`、`Descriptions`，历史使用 `Timeline`，检查器使用 `Tabs`、`Collapse`、`Table` 和可复制 JSON。
- `ActionDrawer` 是唯一编辑容器：桌面 560px，手机全屏；保持同一实例，视口变更不重新创建草稿。操作区固定在表单底部可达位置。
- `FormField` 只负责标签、说明及错误关联；不另建字段值存储。业务草稿仍是唯一值来源。
- `DecimalInput` 使用 `InputNumber` 的 `stringMode`，输入原文通过 `onInput` 回写草稿，避免无效输入悄悄提交上一次有效数量。`CalendarInput` 在选择值与本地 `YYYY-MM-DD` 字符串之间转换；纯日期不经 UTC。
- 新控件直接从 `antd` 和 `@ant-design/icons` 按需导入，不再封装通用按钮、Toast 或第二套主题系统。

## 导航与位置筛选

主导航固定宽度，顶部只放“我的物品、商品目录”，设置固定在视口左下角。位置属于“我的物品”的筛选，不再出现在主导航或重复的房间标签行中。标题始终显示“我的物品”及当前结果数量。

| 宽度       | 主导航               | 位置与详情                                                                  |
| ---------- | -------------------- | --------------------------------------------------------------------------- |
| ≥1200px    | 224px 固定侧栏       | 内容区可容纳 180px 位置栏、16px 间隔及 640px 列表时常驻位置树，否则位置抽屉 |
| 768–1199px | 200px，可收起至 64px | 位置抽屉、详情抽屉                                                          |
| <768px     | 底部主导航           | 位置抽屉、全页详情                                                          |

- 页内位置栏使用 Ant Design `Splitter`，默认 224px，范围 180–320px。为列表保留至少 640px；窗口收窄时临时限制栏宽，恢复空间后使用用户偏好宽度。另预留 360px 详情栏和 24px 间隔仍能容纳最大位置栏与列表时，详情并排显示，避免打开详情或拖动时反复切换布局。
- 分隔条支持鼠标和单指触控拖动、左右方向键每次 8px、Home/End 到最小/最大宽度，双击恢复 224px。偏好使用本地键 `acornary-location-panel-width`；存储被拒绝（如不透明 MCP iframe）时只在当前运行会话内记忆，不阻塞使用。
- 位置树包含搜索、全部物品、房间及下级位置，长名称省略、悬停显示完整路径，数量右对齐。数量表示该位置及下级的在库实物总数；标题数量表示当前筛选结果。树搜索与展开状态按家庭保留，位置切换与抽屉切换共用状态。
- 选择房间默认包含下级位置，取消“包含下级位置”后只显示直接存放的物品。当前位置路径与范围复选框位于列表工具栏下方；位置操作只提供重命名和移动。
- 标题区使用分体添加按钮：主按钮直接添加物品，箭头菜单添加位置。两种操作默认使用当前房间为位置，全部物品页面不预设位置，表单仍可修改。
- 保留 `/items`、`/places/:id` 和详情链接。列表状态继续按家庭和位置保存；调整栏宽和窗口不清空选择或重新创建编辑草稿。手机底部导航与抽屉操作区避让安全区。

## 写入与恢复契约

迁移沿用现有草稿版本、revision、待确认请求、准确载荷及幂等键。数量保持字符串，空值保持未记录。已保存的旧草稿无需转换。

离线、授权失效、只读或快照过期均不能提交。联网或重新登录不自动重发。409 必须读取新数据并由用户核对；写入成功但刷新失败仅重读。中文输入法候选确认不会提交；下拉和日历的 Enter 按组件语义处理。

MCP 使用相同页面、Provider 与字段适配器；弹层挂在当前 iframe 的 `document.body`。继续生成单个自包含 HTML，资源内联，不使用 CDN、外部字体或新的资源域权限。Service Worker 根据新构建资源 hash 更换缓存，认证与检查器仍独立按需加载，其导航不进入离线外壳。

## 试用

在仓库目录执行：

```sh
node scripts/ui-preview.mjs start
```

脚本创建独立 Docker 网络、PostgreSQL 18 与示例数据库，不读取 `.env`，也不连接已有库存。需要本机 Docker。第一次运行会构建镜像。

- Web：`https://localhost:3210`，本地自签名证书。
- 示例账号：`browser@example.test` / `Browser-test-password-123!`。
- MCP 不透明沙箱模拟器：`http://localhost:3212`，无需登录。
- 检查状态：`node scripts/ui-preview.mjs status`。
- 删除预览及示例数据：`node scripts/ui-preview.mjs stop`。

端口只发布到电脑的 loopback；手机布局可以在浏览器响应式模式下预览。真实 iPhone 和真实 ChatGPT/Codex 宿主验收需单独进行。

## 验证

```sh
docker build --target browser-test -t acornary-ci .
node scripts/ci.mjs
```

完整脚本在 Node 24 和隔离 PostgreSQL 18 下依次执行类型检查、两套生产构建、单元与集成测试、全部 Chromium 浏览器测试，再执行 WebKit 核心流程。CI 归档 `output/ci/` 下的截图和失败 trace。针对性调试可以用 `ACORNARY_E2E_GREP`，它不会被称为完整回归。

`antd.spec.ts` 检查跨页选择、调整窗口时的草稿保留、日期、输入法 Enter、焦点恢复，以及 360/390/768/1024/1440px 的列表、目录、详情、长表单、账号、授权、检查器截图。MCP 测试覆盖实际不透明 iframe 内的弹层、下拉、日期、宿主选择上下文与准确请求恢复。

验证结果、构建体积与实机边界见迁移 PR 和 [本次验收记录](antd-validation.md)。浏览器自动化及沙箱模拟器通过不等同于真实 iPhone、VoiceOver 或正式宿主验收。

API 用法参考官方 [v6 迁移说明](https://ant.design/docs/react/migration-v6/) 与 [App 上下文](https://ant.design/components/app/)。
