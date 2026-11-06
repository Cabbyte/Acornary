# 模式、URL 与恢复

## 优先级和存储

解析顺序：明确 URL 模式 → 同一身份/家庭/客户端已确认偏好 → 日常。/manage 命名空间明确管理；/items、/search、/products、/attention、/activity、/add、/scan 明确日常。只有 / 和共享设置入口允许用偏好决定落点。共享设置显式 mode 查询参数优先。

/inspect 默认管理模式；从共享设置进入可带显式 mode 保留来源，不读取另一家庭的偏好。身份/授权页面使用中性壳，成功后由校验过的 returnTo 恢复具体页面及模式，不把授权流程本身当作模式切换。

偏好键由 server origin、账号/actor、household、client(web/mcp) 和 schema version 组成。模式偏好与写草稿分开。Web 存储异常可退为会话内偏好；MCP 优先宿主私有 widget state，失败时会话内记忆模式，并告知“本次打开有效”。任何模式偏好保存失败都不能阻止只读浏览，也不能据此放宽写请求的可靠持久化门槛。

Query 缓存和 OperationSession 继续使用 session.cache_key 的严格鉴权作用域。家庭/账号变更时取消旧读、清除可见结果、选择、宿主 selection、偏好内存和旧响应回调。先处理待恢复请求再主动切换；不可把旧家庭草稿带入新家庭。强制授权变化的保护见交互状态 ST13。

## 切换的具体行为

| 当前上下文         | 切到另一模式                                                                         |
| ------------------ | ------------------------------------------------------------------------------------ |
| 实物列表           | 对应 /items ↔ /manage/items，保留可表达的搜索/位置/分类/排序                         |
| 单件详情           | /items/:id ↔ /manage/items/:id，同一 tab（可映射时）                                 |
| 商品摘要/商品管理  | /products/:id ↔ /manage/catalog/:id（只有 SKU 可反向映射）                           |
| 分类 GROUP         | 切日常 /items?category=:id；保留范围标签                                             |
| 位置/容器          | 切日常 /items?location=:id；反向进入位置详情                                         |
| 日常留意           | 切管理 Item 列表，带可表达的类别筛选；stock 仍到独立补货区                           |
| 动态               | /activity ↔ /manage/activity，保留目标与操作过滤                                     |
| 设置               | 原页面不变，只更新 mode；同一设置组件                                                |
| 添加与扫码页面     | /add ↔ /manage/add、/scan ↔ /manage/scan；保留同一任务或识别结果，不重新请求相机权限 |
| 添加/操作进行中    | 保留同一个 task ID 和全部草稿，替换外层 shell；不生成新请求                          |
| 无法映射的 UI 选项 | 保留在该模式会话内；另一模式显示“部分视图条件仅用于管理”，不能静默扩大写入范围       |

桌面切换器使用两个带文字的选项；切换写入 history，返回键恢复原模式。手机点击顶部“日常 ▾ / 管理 ▾”，打开带一句用途说明的选择面板；选中后关闭，焦点回到模式入口或新页面标题。键盘 Enter/Space 可打开；radio group 方向键选择，确认生效。

正在提交时不允许切换造成页面离开；切换器暂时 disabled 并说明“正在保存”。网络已转不确定后可切换：全局持续显示“1 项结果待确认”，恢复入口定位原任务。切换本身不提交、不改参数、不改幂等键、不产生库存事件。

## 兼容映射

| 既有链接                                            | vNext 行为                                            | 必须保留                                                      |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| /                                                   | 依据偏好跳到 /items 或 /manage/items                  | 身份先确认；不得使用上个账号偏好                              |
| /items、/search?q=…                                 | 日常页面                                              | 搜索/支持的筛选；URL 优先                                     |
| /items/:id                                          | 日常单件详情                                          | 独立 Item ID                                                  |
| /items/:id/details                                  | replace 到 /items/:id                                 | 安全查询参数                                                  |
| /items/:id/history、/notes                          | replace 到 /items/:id?tab=history 或 notes            | 保留对象与目标区块，不只回到概览                              |
| /items/group/:catalogId                             | replace 到 /products/:catalogId                       | SKU 过滤；非 SKU 显示分类范围而非猜对象                       |
| /i/:compactId                                       | 用现有 expandItemId 校验，replace 到 /items/:id       | 不改二维码格式；无效值不发写请求                              |
| /places/:id                                         | replace 到 /items?location=:id                        | 物理位置范围，不能变分类                                      |
| /catalog、/catalog/:id                              | replace 到 /manage/catalog、对应详情                  | 旧目录链接明确进入管理                                        |
| /catalog/:id/history                                | 管理商品详情 tab=history                              | 原对象                                                        |
| /activity                                           | 日常最近变化                                          | 目标/操作参数白名单                                           |
| /settings/*                                         | 共享设置；带 mode 时尊重，无 mode 用当前合法偏好      | 原子页面及认证入口                                            |
| ?ui=next 或 ?ui=legacy                              | 视为旧 UI 标志；不作为模式选择                        | 过渡期 rollout 开关独立管理；当前 main 已没有可用 legacy 实现 |
| ?dialog=&target=&ids=&template=&note=&parent=&from= | 校验旧 action；先恢复原草稿/attempt，再转换成任务引用 | 不能访问链接即执行；非法/跨家庭目标不可见                     |
| /inspect/*、身份/OAuth 路径                         | 原协议入口保留                                        | return URL 白名单、OAuth 参数及授权边界                       |

旧 dialog 适配必须覆盖 intake/place/catalog/rename/edit/move/open/consume/finish/note/correct/attributes/print。finish 仍映射 consume_items；不得映射到 void_item。历史 URL 中的 ids 必须解析完整实体 ID，去重并检查上限，不把 SKU ID 展开为授权。

## 新 URL 状态契约

- 可分享：q（最大 500）、entity(items/products/locations)、location、category、sort、direction、attention kind、tab、target 和 operation_id（均按路由 schema 白名单）。模式从路径推导。
- 不分享：请求正文、approval challenge、OAuth token、完整选择集合、revision map、草稿字段、查询 cursor。task 仅为无权限能力的本地随机引用；换设备无草稿时显示“此设备没有这份草稿”，不重建提交。
- 输入中文 IME 期间不发搜索；compositionend 后 250ms debounce，Enter 立即查询。连续输入使用 replace；应用筛选、进入详情和模式切换使用 push。cursor 不进入 URL，筛选变化清旧游标。
- 浏览器返回恢复同作用域已加载页、滚动锚点和选择；冷刷新先按 URL 重读第一页，再恢复仍合法的浏览位置。无法恢复时明确落在第一页，不能用过期 cursor 编造结果。
- returnTo 只允许同源、白名单应用路径；拒绝 //、反斜线、协议 URL、换行和身份回调注入。浏览器与 MCP 都从 router location 读取，不能在 MCP 中读 window.location 来推断内存路由。

## MCP 与移动视口

MCP 用 TanStack memory history 和宿主 rememberRoute；需扩展当前 WidgetStore 路由白名单接受 /manage、/products、/attention、/add、/scan。恢复时先校验 scope，再校验 URL；宿主挂载失败不得拿前一家庭页面占位。

ModeSwitcher、OperationSheet 都在同一个 React 状态树内响应宽度变化。浮层挂在 iframe 内的 overlay root，继承 data-acornary-mode；不挂到宿主 top.document。可用高度取宿主 bounds 与 visualViewport 的较小值，再扣安全区。输入法出现时 Sheet 内滚动使字段和提交栏可见，底栏在表单模态期间隐藏。模式变化只切 token，不播放整屏位移动画。
