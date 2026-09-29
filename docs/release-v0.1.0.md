# v0.1.0 正式发布验收

2026-09-29（北京时间）。单站点、统一认证、双视图已完成首次正式标签部署。

## 版本身份与流水线

- [PR #2](https://github.com/TANG617/Acornary/pull/2) 合入 main，正式提交 `7eaf2d3508911700e2ee3b7ee42544108e43bced`，附注标签 `v0.1.0`。
- [分支 CI](https://github.com/TANG617/Acornary/actions/runs/36513050502)、[PR CI](https://github.com/TANG617/Acornary/actions/runs/36513071768)、[main CI](https://github.com/TANG617/Acornary/actions/runs/36513427580) 均通过。
- [正式 Release](https://github.com/TANG617/Acornary/actions/runs/36513448481) 的 identity、test、publish、deploy 全部成功。
- 镜像 `ghcr.io/tang617/acornary@sha256:34f3b83029735cd2a0a7d383e8738ea83547f13368c52ce1f0ef75482e49d05b`。
- 服务器任务 `758bf8edc01ad8a492c06933` 为 `succeeded`，当前发布记录与公网 `/health` 的版本／commit 一致。应用容器于 `2026-09-29T02:42:37Z` 启动。
- 没有待执行 migration，`migration_committed=false`，因此没有生成迁移备份。上一 bootstrap 镜像仍记录为恢复基线。

## 功能与数据证据

- Node 24 类型检查和构建、35 项 Vitest（真实 PostgreSQL／OAuth）、14 项云模式 Chromium 浏览器测试通过。
- 浏览器覆盖统一登录、检查器返回路径、双向跨标签页退出、OAuth 未登录／已有会话／允许／拒绝／会话失效恢复、PKCE 交换、外部返回地址拒绝、只读表白名单，以及产品的离线刷新、草稿恢复、幂等重试和版本冲突。
- 15 项发布控制器测试、真实容器升级与恢复测试通过，包括持久会话保留、按需备份及独立恢复、SQL 回滚、应用失败回退和迁移提交后禁止不安全回退。
- 公网以发布前用户手动建立的真实所有者会话重新加载新版产品；无需再次登录。经设置 → 数据库检查器 → 返回松仓，确认原库存、原 UUID、revision 与只读表格可见。
- 两个既有 MCP 连接（直接 MCP 和 Acornary App 连接）分别完成正式库存只读查询，结果均与发布前相同。没有重新配置 issuer、scope 或 MCP 地址；未声称重新走了一次 ChatGPT 对话界面的人工授权流程。
- 公网 `/items`、`/inspect`、`/login`、`/consent` 均 200；匿名 `/api/context`、`/api/ui/snapshot`、`/api/debug`、`/mcp` 均 401。OAuth issuer 仍为 `https://acornary.protium.top/api/auth`，resource 仍为 `https://acornary.protium.top/mcp`，发现文档正常。
- 正式业务表在更新前后只读计算逐行内容摘要，结果完全一致：17 个 Item、13 个 CatalogNode、2 条 Note、37 条 Event、33 条幂等操作。没有在正式库存进行写入验收。
- 仅应用容器更新。PostgreSQL、共享 Caddy、Runbuoy API／worker 的启动时间不变；Runbuoy 健康接口正常。生产仍为同一域名和 HTTPS 443，应用内部 3210，没有新增 8443 或重建 Caddy。
- 本机演示预览继续运行于 `http://127.0.0.1:33211/items`，沿用原隔离演示库，未重建或重新播种数据。品牌草稿保留在本机；提交仅使用正式图标。

## 后续验收边界

真实写入与故障恢复均在隔离数据库完成，正式环境只读核对。初版 WebKit 本地检查结果见 [Web UI](./webui.md)；本轮统一认证完整回归使用 Chromium。iPhone Safari／主屏幕模式的离线重开、实际输入法与键盘、安全区域、VoiceOver、旧设备性能仍需实机验收。此版本不包含原生 iOS App、多用户或离线写入。
