# Ant Design 迁移验收记录

基线：`915d510`（v0.4.3 之后的 main）。本次只交付迁移候选，不部署生产。

## 自动化与预览

本轮导航与位置筛选回归使用 Node 24、PostgreSQL 18、正式 Dockerfile 的 Chromium/WebKit 隔离环境；不读取 `.env`，不连接生产数据库。

- 全部通过：类型检查、Web/MCP 生产构建、66 项单元与集成测试、42 项 Chromium 浏览器用例及 11 项 Linux WebKit 核心用例。
- 部署控制器：15 项 Python 测试通过。真实 PostgreSQL 迁移与应用恢复仍由 PR 完整 CI 检查。
- 新增页内位置树测试覆盖鼠标拖动、Chromium 单指触控模拟、键盘上下界/复位、刷新恢复、平板折叠、包含下级、默认创建位置、重命名、响应式详情与草稿保留。
- MCP 新增不透明 iframe 的本地存储拒绝、会话宽度记忆、路由往返、位置抽屉与菜单回归。现有写入恢复、冲突、会话失效、家庭隔离及宿主选择上下文继续执行。
- 新布局覆盖 360/390/768/1024/1200/1440/1920px；原全入口视觉矩阵继续覆盖物品、目录、详情、长表单、账号、登录、授权和检查器。

本轮隔离回归日志位于 `output/antd/navigation-final-ci.log`，截图及 trace 位于 `output/antd/navigation-final-ci/`。CI 工件仍为 `ci-browser-results`，远程通过状态以 PR 当前提交的检查为准。

视觉复核见根目录 `design-qa.md`。本地整洁示例截图为 `output/playwright/navigation-preview-desktop.png`、`navigation-preview-mobile.png`、`navigation-preview-mobile-locations.png`；MCP 截图为 `navigation-mcp-desktop.png`、`navigation-mcp-drawer.png`。生成图片只作为布局参考，截图来自真实运行页面。

隔离预览启动、账号及停止方法见 [统一界面规范](antd-ui.md#试用)。本机保留原有示例库存，另通过账号和领域 API 创建“界面体验家庭”（89 件示例实物，厨房 8 件）；可在“设置 → 家庭”切换。此额外家庭只存在于本机预览，不进入 CI 或生产。

## 构建体积

同一工作站、相同构建命令测量迁移前后产物。单位为字节，gzip 使用 Node 默认参数；Web 为所有输出 JS/CSS/HTML（含 Service Worker）之和，不代表单次首页请求大小。MCP 只计算单文件 HTML，不重复计算其构建中间文件。

| 产物            |  基线原始 |  候选原始 | 基线 gzip | 候选 gzip |
| --------------- | --------: | --------: | --------: | --------: |
| Web 合计        |   784,216 | 1,770,296 |   243,452 |   561,095 |
| MCP 单文件 HTML | 1,230,556 | 2,210,263 |   520,682 |   833,426 |

Web gzip 增加约 310 KiB，MCP 增加约 305 KiB。Ant Design 表格、日期、弹层及运行时主题增加了依赖体积；旧 CSS 和 SVG 删除并不能抵消这部分。组件按需导入，认证和检查器保留独立入口，不增加 CDN、外部字体或资源域。

相对上一版 Ant Design 候选，本轮布局增加 Web gzip 6,298 字节、MCP gzip 6,592 字节，主要来自 Splitter 及布局适配。

复核命令：`node scripts/ui-bundle-report.mjs`。测量记录使用本机 Node 26；发布和 CI 仍使用 Node 24。后续构建 hash 或压缩器差异可能产生少量字节变化。

## 验收边界

以上是自动化浏览器与本地模拟宿主证据。真实 iPhone 的键盘、安全区、Passkey、VoiceOver，以及真实 ChatGPT/Codex 宿主的尺寸和生命周期尚未实机验收。浏览器 WebKit 不代替 iPhone；不透明沙箱测试不代替正式宿主。未合并、未发布、未修改生产库存。
