# Ant Design 迁移验收记录

基线：`915d510`（v0.4.3 之后的 main）。本次只交付迁移候选，不部署生产。

## 自动化与预览

- Node 24 / PostgreSQL 18 隔离环境：类型检查、Web 与 MCP 生产构建、66 项单元与集成测试通过。
- Chromium：39 项完整浏览器回归通过，覆盖账号、Passkey、OAuth、检查器、库存写入、离线、恢复及不透明 MCP iframe。最终手机列表边距调整后，额外通过 2 项选择与视觉矩阵回归。
- macOS WebKit：8 项核心回归通过，覆盖入库、开封、消耗、笔记、分页返回、跨页选择、编辑草稿、日期、输入法、保存后只重读与 MCP 弹层。
- 最后增加 MCP 家庭切换往返的 SKU 勾选回归，两种浏览器均验证旧选择被清空；完整 CI 因此执行 40 项 Chromium 与 9 项 WebKit 用例。
- 部署控制器：15 项 Python 测试通过。真实 PostgreSQL 升级与应用回滚测试由 PR 的完整 CI 运行。
- 本机 Chromium 使用仅安装 Chromium 的临时镜像；WebKit 使用本机 Playwright。PR CI 使用正式 Dockerfile，在 Linux 同时安装并执行两种引擎，不能把本机拆开的运行称为完整 Linux CI。

`tests/browser/antd.spec.ts` 生成 360、390、768、1024、1440px 的物品、目录、详情、长表单、账号、登录、OAuth 授权及检查器截图，检查页面横向溢出。另检查响应式编辑草稿保留、关闭抽屉后的焦点恢复、日期字符串和输入法 Enter。MCP 截图由 `plugin.spec.ts` 生成。

本地截图：`output/antd/final-ci/playwright/`（Chromium）和 `output/playwright/`（WebKit）。CI 截图及失败 trace 位于 `ci-browser-results` 工件。完整远程 CI 的通过状态以 PR 当前提交的检查为准。

隔离预览的启动、账号和停止方法见 [统一界面规范](antd-ui.md#试用)。预览允许操作示例库存，不连接生产数据库。

## 构建体积

同一工作站、相同构建命令测量迁移前后产物。单位为字节，gzip 使用 Node 默认参数；Web 为所有输出 JS/CSS/HTML（含 Service Worker）之和，不代表单次首页请求大小。MCP 只计算单文件 HTML，不重复计算其构建中间文件。

| 产物 | 基线原始 | 候选原始 | 基线 gzip | 候选 gzip |
| --- | ---: | ---: | ---: | ---: |
| Web 合计 | 784,216 | 1,751,993 | 243,452 | 554,797 |
| MCP 单文件 HTML | 1,230,556 | 2,192,010 | 520,682 | 826,834 |

Web gzip 增加约 304 KiB，MCP 增加约 299 KiB。Ant Design 表格、日期、弹层及运行时主题增加了依赖体积；旧 CSS 和 SVG 删除并不能抵消这部分。组件按需导入，认证和检查器保留独立入口，不增加 CDN、外部字体或资源域。

复核命令：`node scripts/ui-bundle-report.mjs`。测量记录使用本机 Node 26；发布和 CI 仍使用 Node 24。后续构建 hash 或压缩器差异可能产生少量字节变化。

## 验收边界

以上是自动化浏览器与本地模拟宿主证据。真实 iPhone 的键盘、安全区、Passkey、VoiceOver，以及真实 ChatGPT/Codex 宿主的尺寸和生命周期尚未实机验收。浏览器 WebKit 不代替 iPhone；不透明沙箱测试不代替正式宿主。未合并、未发布、未修改生产库存。
