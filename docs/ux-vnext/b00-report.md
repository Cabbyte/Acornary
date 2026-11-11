# B00-R1 实施报告

## 目标与范围

交付可交互的双色 Token 样板、Storybook 与独立 Vite 预览、单源 Token 和批次审阅登记。没有进入 B01，没有新增业务命令或连接家庭数据。

本轮基底：main `18f7e0496ecb4fb960a6619f12f57c68b3898410`；Cloudflare `89544793352d8d8ea7be23ac7dbddaa811ddee43`。2026-11-06 重新获取远端：main 最新 CI success；Cloudflare PR #21 仍打开。前端设计分支从 `44872c7` 开始修改。

## 文件与契约

- `apps/web/src/ui/tokens/source.json` 为可编辑单源。旧 tokens 与旧 Ant theme 原值保存在 legacy 区，现有导出接口不变。
- 生成的 CSS 与设计文档快照由 `pnpm generate:ui-tokens` 更新，`pnpm check:ui-tokens` 防止漂移。
- `apps/web/review` 与 `.storybook` 是开发装配层，独立配置且不加载应用代理、publicDir 或离线插件。
- 无领域契约变更，无 Session/OperationSession 生产行为变更；当前仅为视觉样板。
- 未安装未来批次才需要的 Base UI、表单和表格依赖；B01 开始后按批次引入。

## 启动与复现

使用 Node 24、pnpm 11.19.0。运行 `pnpm storybook` 或 `pnpm dev:ui-preview`；默认仅绑定 127.0.0.1:6006 / 6007。

组件预览与完整任务预览共用正式 Token。B00 阶段后者仅承载视觉样板，页面和业务 fixture 尚未实现。

## 验证边界

本地 TypeScript、Web/plugin 构建、Storybook 构建、独立预览构建、Token 一致性、静态依赖边界检查和前端 Vitest 已执行。浏览器测试覆盖 Chromium/WebKit，各 7 宽度 × 2 模式 × 4 章节；还检查输入保留、禁用、反馈、减少动态效果、无业务网络、无 Service Worker 注册。

截图：`.impeccable/review/desktop.png` 与 `mobile.png`（本地忽略文件）。应用内浏览器打开超时；截图来自本地 Playwright 浏览器，不是 MCP 宿主。

产物检查曾发现 Storybook 意外加载旧 Vite 离线插件；已改用显式独立 Vite 配置并增加 SW 产物检查。静态依赖检查只覆盖静态及字符串字面量导入，不宣称是完整 JS 安全分析。

## 性能基线状态

当前记录构建体积作为 B0 第一部分。11/500/5000 Item 的任务响应、30 热/10 冷样本、真实手机及真实 MCP 性能尚未完成；不能用 Token 样板的运行速度替代库存任务基线，也没有冻结绝对性能预算。此项仍属于 B00 独立工程工作，不能标通过。

## 用户验收与下一轮

B00 四项视觉基础均待用户审阅。B01 需要 B00 全部批准及剩余工程门槛完成。真实宿主、真人任务、设备与正式业务接线均未验收。

未读取或修改正式库存，未部署、推送、合并或切换生产。原始脏工作树与 Cloudflare 分支未改动。

## 证据补充

- `b00-bundle-baseline.json` 保存 main 与当前候选的 raw/gzip/brotli 体积；Web 字段仅 HTML 直接引用 JS，不是含动态导入的完整首屏预算。plugin 字段为自包含 HTML 整体体积。
- 独立视觉复查发现的悬停对比度、手机密度说明与 metadata 字号均已修正；复查结论为可提交 B00 用户审阅，不代表用户已批准。
- 设计检测器按旧 DESIGN.md 给出的字号建议不作为改写已批准 vNext 候选的依据。PRODUCT.md 与 DESIGN.md 保留，候选颜色/字体/尺度值全部保持一致。
- 新增 ESLint、组件 Vitest 项目和 MCP fixture 包随后续对应批次接入，本轮未声称这些脚本已实现或通过。

## 实际测试记录

- Node 24.22.2 / pnpm 11.19.0：`pnpm typecheck`、`pnpm build` 通过。
- `pnpm check:ui-tokens`：生成一致性及两模式文字色对 4.5:1 门槛通过。
- `pnpm build:ui-preview`、`pnpm build:storybook`、`pnpm check:ui-boundaries`：本机及 Linux 隔离镜像通过。
- `pnpm test:e2e:ui`：本机 Chromium/WebKit 2 项通过，Linux Chromium/WebKit 2 项通过；每项遍历完整宽度/模式/章节矩阵。
- `pnpm exec vitest run tests/web`：3 文件、18 测试通过。
- 仓库 `scripts/ci.mjs` 的 `pnpm test`：31 文件、234 测试通过，原有 2 项 todo 保留。额外 model-v2 分组按脚本执行，既有 skipped/todo 未修改，不能把它们算通过。
- 隔离备份恢复比较 50 张表一致；附件字节校验不在该比较范围内。
- 新 UI 检查已加入既有 CI；没有删改既有测试断言。
