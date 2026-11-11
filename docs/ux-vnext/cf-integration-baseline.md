# CF 前端集成基线 · 2026-11-11

本轮获用户批准执行，使用三个子代理分别负责功能/接口对等、Android 切换设计、候选应用层。回归继续暂停；所有提交只保存在本地。

## 锁定点

| 对象 | 本轮只读结果 |
| --- | --- |
| 非 CF `/api/version` | `v0.13.0` / `a7252bc9a10018984f6b526e1149af3787cf6f1a` |
| CF `/api/version` | `build-89544793352d` / `89544793352d8d8ea7be23ac7dbddaa811ddee43` |
| `origin/main`，`git ls-remote` | `18f7e0496ecb4fb960a6619f12f57c68b3898410` |
| `origin/codex/cloudflare-native` | `89544793352d8d8ea7be23ac7dbddaa811ddee43` |
| 前端成果 | `53bedac` + 方案检查点 `333889e` |
| 集成合并 | `403b842`，第一父提交 CF `8954479`，第二父提交前端 `333889e` |
| 当前工作树 | `/Users/timli/workspace/Acornary-cf-frontend-vnext` |
| 当前分支 | `codex/cf-frontend-vnext` |

版本 GET 只读取版本信息，未登录、读取或写入库存。远端版本是本轮快照，不代表未来发布授权。原 `Acornary/main` 用户修改未移动、重置或提交；原 CF 工作树和前端工作树保留。

## 合并决定

- `.github/workflows/ci.yml` 保留 CF 版本；整个 `.github/workflows` 与 CF 基线一致。不恢复非 CF 镜像/服务器发布工作流，不扩大触发条件。
- `package.json` 以 CF 为基底，只合入前端相对共同基线的依赖和脚本差量。保留 CF 原生工具链及命令。
- `pnpm-workspace.yaml` 同时保留 `workerd` 构建许可和已固定 Storybook 版本的安装例外。
- 锁文件以 CF 原锁为基础，通过 Node 24 / pnpm 11.19.0 重解 UI 新增部分；未主动升级既有运行时依赖。离线安装缺缓存包，随后正常安装完成。
- 共享领域契约、CF Worker、Wrangler 绑定和旧 Web/MCP 引导文件未因 UI 合并改写。

## 预览和产物

6006 / 6007 / 6008 分别继续供组件、逐页、连续试用审阅。新工作树 `.local/ui-review-feedback` 显式链接到旧前端工作树同名目录，按原意见 UUID 读取，不复制或重复提交。只共享意见目录，不共享本地凭据或运行时环境文件。

独立候选构建输出 `output/ui-candidate`，是可被宿主装配的源码库，不是已接线的完整应用。`cf:build:candidate` 只构建该产物，不写 `apps/web/dist`，不切换 Worker ASSETS。默认 `cf:build` 仍构建原 Web + 自包含 MCP plugin 资源。发布选择与真实 adapters 属于后续接线。

## 可复现边界

允许类型、静态契约、Token、依赖边界及构建检查，结果见 [本轮报告](phase2-cf-report.md)。不运行回归、性能、workerd 业务测试、Docker、真机/MCP 验收；不推送、不部署。构建通过不等于契约行为等价或阶段验收。
