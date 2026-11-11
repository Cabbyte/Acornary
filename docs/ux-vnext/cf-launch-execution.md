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

## L1 第一批任务整合

- 日常：开封、生命周期日期/新期限、Item/SKU 笔记的命令投影与根任务会话。已有期限缺稳定 entry ID、生命周期日期依据无可写路径、商品笔记缺目录 revision 时保留输入并阻止发送；这些是明确待接通/缺契约分支，不能记成功能对等完成。
- 管理：名称编辑、属性编辑、单件移动、容器移动、批量移动、批量整件用完、批量生命周期，共 7 类任务；保持 UUID/revision、100 件边界、已冻结原命令、存储确认后才发送、事务回执和原键参数指纹。
- 独立审阅发现并修复：错任务恢复、错目标恢复、商品重归类后原 SKU 请求绑定、旧笔记回执恢复覆盖新正文、同键异参错误重放、冲突重审被旧视图覆盖。旧记录无法证明绑定版本时保留并拒绝危险发送。
- 新增 `refreshDraft` 仅允许尚无 attempt 的草稿在显式重新读取后补全基线；不替换冲突或未决请求。持久化失败保留旧基线。
- 前端测试移至 Web 的严格 Bundler/JSX 类型检查范围，所有 `tests/web` 仍由主 Vitest 执行；不是通过排除测试消除类型错误。
- 29 页新增 360 px 渲染、无横向溢出、无业务 API 请求和无页面异常检查；任务面板使用其自身可访问标题，不强制弹层标题变成页面 h1。它只证明页面能正常呈现，不等于逐任务生产验收。

尚未完成：其余管理目录/策略、位置创建编辑、处置/拆包/作废恢复、模板/纠错/导出控制器，账号设置控制器，真实持久化/查询 adapters 和正式 Web/MCP bootstrap；Phase 2 工程验收、性能与用户阶段确认，L2–L7 仍有待执行工作。附件、扫码与打印继续沿用隔离能力适配，未接真实设备。

## GitHub 检查跟踪

草稿 PR：https://github.com/Cabbyte/Acornary/pull/22 ，base 为 CF 主线，未合并。

首轮 `1a18de2` 的新 UI job 发现目录检查先于 Storybook 构建、干净 runner 缺少 `index.json`；`8450d92` 修复步骤依赖，未放宽目录校验。该提交 push CI（42996832521）和 native PR checks（42996842426）已成功，包括 Android 构建、签名和模拟器。它们不能代替后续 L1 提交的检查。

`ef72de5` 增加审批前无部署凭据的 `release-ready` gate；完整 CI 通过后才进入 Environment 审核，审核后再次检查。构建一次并发布不可变产物、备份回退、凭据和正式上线演练仍属于 R7，当前配置不是已完成的发布系统。

## L1 本地整合检查（最终候选）

Node 24.22.2 / pnpm 11.19.0：根/Web/CF 类型检查通过；28 个 Vitest 文件，194 passed、2 个原有 TODO。日常/管理四个新文件共 35 项定向用例，共享 OperationSession 15 项。独立代理复核了原请求恢复与旧日志优先级，已发现的阻断问题均修复。

候选、逐页预览、连续试用、Storybook 构建及 tokens/boundaries/catalog 检查通过。29 页 × 两浏览器窄屏渲染与6项组件交互共64项通过，另2项开封提交→刷新→回执保留检查通过；模拟数据结果不能替代正式业务执行。整合版本还会在 PR 上重新执行 CI。

保留的旧日常日志原文不变；仅完整验证过、且作用域/目标/原请求/前驱匹配的新持久任务接管恢复入口，畸形或不匹配后继不会隐藏原任务。
