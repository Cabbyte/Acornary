# CF 上线执行记录

2026-11-11。方案已获用户授权，完整回归恢复；目标仍为独立 CF 试用，不回灌非 CF。本记录区分本地检查、GitHub CI、用户验收和部署。

## L0 检查基础

起点 `f452cfc`，方案确认提交 `a4e949e`。使用 Node 24.22.2、pnpm 11.19.0。

- 将遗漏的 `app-vnext/**/*.test.ts` 加入主 Vitest 收录。
- 将过时的 B00 浏览器入口断言迁到 RC6 正式组件，保留隔离、状态、输入保留、响应式和减少动态效果约束，并增加键盘/焦点/关闭守卫。未删除业务断言或新增 skip。
- CI 增加 UI 候选、预览、Storybook 构建与 Chromium/WebKit 检查。
- 发布 CI gate 校验固定仓库、工作流 ID/path、CF 分支、push、提交及最新 run/attempt；旧成功不能覆盖新失败。输出可追踪证据，失败清除旧证据。

| 本地检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（L1 合入后需再核对） |
| `pnpm test` | 24 文件，156 passed，2 个原有 TODO；TODO 不计通过 |
| CF contracts/auth-schema | 通过 |
| CF kernel/inventory/auth/http | 8 / 17 / 4 / 8 passed |
| CF snapshot | Docker 初次未启动失败；启动 OrbStack 后 14 passed |
| CF backup/operators | 2 / 1 passed |
| CI gate 定向测试 | 53 passed |
| `pnpm build` | Web/MCP 构建和 Worker dry-run 通过；没有部署 |
| UI tokens/boundaries/catalog | 通过 |
| candidate/preview/trial/Storybook 构建 | 通过 |
| UI Chromium/WebKit | 6 passed；八种外观、320–1920 px、输入保留、焦点与关闭守卫 |
| 既有 CF Chromium 浏览器 | 70 passed，3 个原有 skipped；非新前端端到端证据 |
| 既有 CF WebKit 重点回归 | 15 passed |
| Android | 本机未执行，交由保留的 GitHub Android job 验证 |

本地日志位于忽略目录 `output/cf-launch/`。上表是各检查运行时快照，后续 L1 改动需定向检查，不能自动沿用旧结果。真实 MCP 宿主、物理打印/安卓设备、性能及真人验收未执行。

## GitHub 发布边界

- 重新读取远端 main `18f7e04`、CF `8954479`，未改变。
- 重新读取线上：非 CF v0.13.0 / `a7252bc`；CF build-89544793352d / `8954479`。
- `CF_PREVIEW_DEPLOY_ENABLED=false`，保持关闭。纠正规划时查询 404 的旧观察。
- `cloudflare-preview` 已设 required reviewer `TANG617`；允许用户批准自己发起的发布，exact branch policy 仅 `codex/cloudflare-native`。
- CF 主线要求 PR、分支最新，以及 `test`、`android`、`ui-review`、`native-kernel` 检查；管理员同样受约束，禁止 force push/delete。
- 非 CF production Environment、main 分支保护、Release workflow 和凭据均未修改。
- 尚未配置发布 secret、启用部署、创建远端验收家庭或修改线上库存。

## L1 与后续门槛

日常与管理 subagent 正在抽取共享控制器。完成范围、真实契约缺口、定向测试与 GitHub CI 结果将在整合后补记。其余任务、正式持久化、真实应用 bootstrap、Phase 2 验收及 L2–L7 仍待完成；本记录不是上线声明。
