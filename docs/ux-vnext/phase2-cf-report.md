# CF 集成准备与 Phase 2 收尾 · 本轮报告

日期：2026-11-11。状态：**CF 开发基线、对等映射和首批应用层候选已交付；Phase 2 工程验收未完成。**用户要求的回归暂停继续生效；未推送、未触发 CI、未部署、未操作正式库存。

## 目标与结果

新前端已转移到 `/Users/timli/workspace/Acornary-cf-frontend-vnext` 的 `codex/cf-frontend-vnext` 分支，基于 CF `8954479` 合入前端 `333889e`，合并提交 `403b842`。原工作树及上线非 CF 应用保留，现有 CF 默认 Web/MCP 入口也未切换。

| 工作包 | 本轮实际结果 | 尚存门槛 |
| --- | --- | --- |
| C0/C1 基线与合并 | 重新核对两个线上版本、两个远端 HEAD；保留历史的本地合并；解决 4 个依赖/工作流冲突 | 未推送，远端 CI 未运行 |
| C2 功能/协议对等 | 22 组功能、29 页面、54 公共操作逐项归属；REST/认证/附件/Android/MCP 矩阵；22 组验收序列 | 源码定位不等于行为对等，验收序列均未运行 |
| C3 应用层 | 根任务 registry、作用域、冻结请求、持久化/恢复、纯路由与查询接口；P03 四任务实际接入隔离装配 | 其他 Journey 尚未迁移；正式查询、命令、审批、宿主和设备 adapters 未接 |
| C4 构建和审阅 | 6006/6007/6008 继续可用；原意见目录复用；独立 candidate 源码库产物 | candidate 不是可部署的完整产品；真实入口装配留待接线 |
| C5 Android | 234 行切换规格、逐文件任务和 22 项验收设计 | 双 APK 保持原状；同包切换未实施/编译/安装 |
| C6 有限检查 | 类型、静态契约/Token/边界、五类构建及一次集中人工抽查 | 完整回归、性能、真实用户/设备/MCP 验收未执行 |

三个子代理分别交付 C2、C3、C5；Android 代理另做 C3 独立代码审阅，发现由应用层代理修正。依赖、工作树、构建、意见记录、检查和本地提交由主代理串行整合。

## 审阅入口

- [连续试用 6008](http://127.0.0.1:6008/#/items)：隔离库存、任务、家庭和故障场景。
- [逐页/组件审阅 6007](http://127.0.0.1:6007/?component=page-daily-home&viewport=390)：保留当前页修改意见。
- [Storybook 6006](http://127.0.0.1:6006/)：组件与场景。

进程从新 CF 派生工作树启动。`.local/ui-review-feedback` 链接旧前端工作树的意见目录；原 UUID、批准记录和意见未重写。没有自动批准任何本轮候选。连续试用仍采用单标签写入锁；已有其他写入标签时，新标签显示只读提示，不自动抢锁或重置数据。

## 实际源码与契约

新增 `apps/web/src/app-vnext/`；P03 TaskJourney 仅保留视图状态，任务由根 Provider 持有。复用 `parseWriteCommand`、`recoveryFor` 和查询能力裁剪；共有 schema/Worker/旧 forms 控制器未修改。新 API 端口是接线边界，不能据此声称查询/权限/审批已实现。

修正的明确风险：串行保存避免草稿覆盖提交快照；发送前可靠保存；冻结操作与目标；回执保存失败不允许换键重发；HTTP 超时/限流/未知代理错误保守保留原请求；未保存时阻止离开；旧代次响应隔离；冲突核对保留输入；下一任务重新采用读取的 revision。RC1 旧隔离请求沿用原 key/draft/revision 的受控兼容，不是正式 wire 请求迁移。详细范围见 [候选应用层说明](candidate-application-layer.md)。

人工抽查发现管理列表从旧 ItemView 文案读到 310 mL，而日常同一物品为 290 mL。现由私有 adapter 从当前 quantity 投影管理事实；保留 decimal、零、未知和估计语义。既有浏览器存储没有清除。复验已观察两模式均显示 290 mL；全面同步行为仍需 B22 回归。

新增 `src/candidate.ts`、`vite.candidate.config.ts`、`build:ui-candidate` / `cf:build:candidate`。候选包只输出到 `output/ui-candidate`；默认 `cf:build` 仍构建旧 Web 和自包含 MCP HTML。边界检查覆盖实际候选模块图，禁止 fixture/Ant；应用层仅允许复用列明的纯业务 helper。Wrangler ASSETS 与发布工作流未改变。

## 实际检查记录

使用 Node 24.22.1 / pnpm 11.19.0。均在新工作树运行，以下不是测试套件。

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm exec tsc -p apps/web/tsconfig.json` | 通过，覆盖源码、stories、预览和候选配置 |
| `pnpm cf:typecheck` | 通过 |
| `pnpm cf:contracts` | 通过，54 operations；SHA-256 `857865de4c2daf787a6c466892e9ee890858ddeea6bbf442e45053c3bed3db3a` |
| `pnpm check:ui-tokens` | 通过，8 个配色/模式组合、125 组对比 |
| `pnpm check:ui-boundaries` | 通过，186 个入口图文件、108 个候选源码文件；无 review/fixture 越界 |
| `pnpm check:ui-catalog` | 通过，70 组件、5 组合、29 页面、901 场景状态及 Storybook 链接 |
| `pnpm cf:build` | 旧 Web 和自包含 MCP plugin 资源构建通过；不是宿主运行验收 |
| `pnpm cf:build:candidate` | 独立源码库构建通过；未改 Worker 部署目录 |
| `pnpm build:ui-preview` | 通过 |
| `pnpm build:ui-trial` | 通过 |
| `pnpm build:storybook` | 通过 |
| `git diff --check` | 通过 |
| 与 CF 基线比较工作流/Worker/contracts/main/plugin/forms | 无本轮差异 |

首次目录检查在 Storybook 产物尚未生成时失败，构建后通过；没有跳过或放宽检查。构建仍提示大 chunk 及部分配置扩展名警告，未压制；本轮不进行性能预算验收。候选 library 是全出口构建，其大小不能直接当首屏加载大小。

集中人工抽查使用本地浏览器，观察了页面审阅入口和原意见、任务打开/保留/跨模式返回后 5 mL 输入保留、提交阶段关闭禁用、旧任务版本冲突保留输入、管理数量修正。随后代码修正下一任务旧 revision、持久化和代理错误分类；这些异常分支只有代码审阅/类型证据，不能写成浏览器全部复验通过。本轮后段热更新/其他试用标签锁导致只读提示，未绕过锁继续写入。

9 组针对性任务层测试已编写，**未执行**。没有运行 `pnpm test`、任何 Vitest/Playwright 套件、workerd 业务测试、Docker/数据库差分、性能、真实 MCP/Android/打印设备验证、远端写入、发布或生产迁移。未运行 APK 构建和 Wrangler dry-run；本轮未改其运行时代码/资源绑定。

## 尚未满足的门槛与下一步

1. 收齐其他日常、管理、设置任务的候选控制器迁移；将权限、导出、深链等真实契约差异逐项落实。当前不宣称 29 页都使用统一写入控制器。
2. 用户恢复回归后，执行已写入的状态/持久化用例及所需组件、路由、响应式、无障碍和性能验收。当前没有通过 Phase 2 工程验收。
3. 验收后在隔离 CF 家庭或本地 workerd 接首个真实闭环：身份/家庭 → 搜索/档案 → 部分使用 → 余量/历史 → 丢回执恢复。
4. 再扩展全部日常/管理/设置/MCP 接线，按 [兼容矩阵](backend-compatibility-matrix.md) 在两套隔离后端比较。角色分配契约、新类型原子入库、旧深链与冻结导出等缺口不能绕过。
5. Android 先保持双包；按 [切换规格](android-environment-switching.md) 实施同包切换前，补齐环境身份、令牌/缓存/任务隔离、旧数据迁移及 App Links 配置。
6. CF 专用发布在独立授权及既有同提交 CI/发布门槛后进行。原非 CF 保留；最后迁移还需新一致快照与写入切换/增量回滚方案。

本轮未触及正式数据或部署。代码候选可继续审阅，不等于可替换线上全部功能。

## 本地提交

- `333889e`：原前端分支保存获批方案。
- `403b842`：CF 基线合入前端历史。
- `d10ab33`：根任务会话、P03 隔离装配、管理事实投影修正。
- `93786a5`：独立候选构建与边界。
- 本报告和功能/接口/Android 规格以独立文档提交保存；均未推送。
