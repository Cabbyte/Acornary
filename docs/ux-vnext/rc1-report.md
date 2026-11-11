# Component Library RC1：完整组件设计候选

本报告记录本轮实际交付与检查边界。组件制作完成不表示用户批准、Phase 2 工程验收完成或正式业务已经接线。

## 目标与实现范围

70 个公开组件、5 个组合场景、四套配色 × 两种模式，共用正式 React 源码。中文工作台 6007；Storybook 6006。全部组件和组合场景待用户审阅，四套配色方案保留已有确认记录；正式默认配色仍未批准。

本轮在 `codex/frontend-vnext` 独立工作树继续，原 B00 暂存/未暂存成果已保存为本地检查点 `806dfff`。首轮公共主题与31组件保存为 `411e0f7`，第二轮组件与首批组合装配保存为 `082161d`。没有重置工作树、推送分支、部署或接触正式库存。

用户新规则覆盖此前逐批等待：按工程依赖完成三轮，不等待中间视觉批准；最后逐项审阅。正式业务页面装配仍在组件审阅之后。

## 源码与适配边界

- `apps/web/src/ui/components/ui/`：基础原语和结构控件；shadcn Base UI 组合模式、Base UI 行为、DayPicker 和 TanStack Table。
- `apps/web/src/ui/patterns/`：领域事实、输入、阅读、操作恢复、导航及共享能力；只接收事实、状态和意图回调。
- `apps/web/src/ui/theme/provider.tsx`：受控主题、统一 portal 容器；配色和模式切换不改变组件身份。
- `apps/web/src/ui/tokens/source.json`：唯一可编辑值源，legacy 区不变。Hover/Active 在生成阶段确定；Token CSS、文档快照及对比度记录派生。
- `apps/web/review/`：隔离 fixture、场景驱动、React Hook Form＋Zod 局部表单、组件工作台与 stories。没有库存、认证、审批、相机、上传或打印网络接线。
- `scripts/ui/`：Token 一致性、静态边界、组件目录与 Storybook 链接校验。

正式入口仍沿用原实现；未删除 Ant Design，未修改领域契约、旧写入控制器或旧用户草稿。展示用状态不承担真实 OperationSession、审批挑战、revision 冲突处理或幂等持久化。

## 领域语义

数量原样保留 decimal string、单位和依据；未记录与零不同。日期保留用途、BEST_BEFORE/USE_BY/ESTIMATED、来源、依据和未知状态，不根据浏览器时区推断家庭事实。商品目录和物理位置分开选择，后者需明确的有效容器资格。

管理表格接受已加载页、外部排序/筛选/分页和完整 UUID 选择；批量100件上限、不自动拆批、不隐式全结果选择。回执直接接收 WriteResultV2。结果不确定时只给原任务恢复意图；身份变化隐藏旧任务内容。扫码和打印仅表达传入的能力和状态，不宣称真实设备成功。

## 本轮检查记录

以下仅为本轮获准的限定检查；没有执行完整回归。

| 命令 / 检查 | 实际结果与范围 |
| --- | --- |
| `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` | 通过；正式源码、review、stories 与相关配置纳入前端类型检查 |
| `node scripts/ui/tokens.mjs --check` | 派生一致；8 组合、125 组不透明色对通过指定阈值；不等于完整可访问性验收 |
| `node scripts/ui/boundaries.mjs` | 正式入口可达 77 文件未引入 review/fixture；73 个候选 UI 源文件未发现直接业务/设备调用或旧 UI 依赖。静态文本/导入检查不是生产包或完整运行时证明 |
| `pnpm build:ui-preview` | 通过；独立 preview 配置，无业务代理或 Service Worker |
| `pnpm build:storybook` | 通过；独立配置；最终统一分组后再次构建通过 |
| `node scripts/ui/catalog.mjs --write` / `pnpm check:ui-catalog` | 70 个组件、5 个组合场景、591 个状态；75 条固定 Storybook 链接均存在于构建索引 |
| 旧入口与领域差异 | 与 B00 检查点对比，main/app/plugin、领域契约、旧写入控制器无本轮改动；legacy Token 值相同 |
| 代表性浏览器交互 | 见下方操作证据；限当前内置 Chromium 环境 |
| 独立 ultra 候选审阅 | sampled source + desktop/mobile capture：可交付 RC1 供用户审阅；无确认的实质修正项，不是用户批准或生产验收 |

预览构建给出大 chunk 提示：本地预览主 JS 约 1.22 MB、gzip 约 384 KB，含完整候选/开发场景。这是预览包统计，不能视作正式候选生产包大小、性能基线或预算通过。性能测量保持暂停。

### 浏览器操作证据

- Input：输入后切换配色、模式和 390/360 宽度，内容保留。
- DataTable：第一页选择一件后翻页，明确显示“已选 1，其中 1 不在本页”。
- Shell：桌面从管理切日常，导航与全局模式同步，同一输入保留；独立手机预览 DOM 宽 390、高 780、文档宽 390，无水平溢出。
- Sheet：390×780 容器内面板约 390×780；Escape 关闭保留草稿，动画结束后焦点回到“打开任务面板”。
- DateInput：窄容器日历可打开；完整日期键盘导航未在本轮穷举。
- OperationSheet：提交中关闭和返回不可用；隔离驱动转到结果未知后，可“保留任务并收起”，显示同一个任务引用和恢复入口。没有实际请求或幂等写入。
- Storybook：单独 Button story 可打开，点击“继续”后本地计数由 0 变为 1。

[桌面工作台](evidence/rc1/desktop.jpg) · [独立手机 Shell](evidence/rc1/mobile.jpg) · [窄屏 Sheet](evidence/rc1/sheet-mobile.jpg) · [当前审阅入口](evidence/rc1/workbench.jpg)。截图为浏览器原始捕获；宿主缩放导致画布留白，实际布局宽度以上述 DOM 读数为准，不用图片像素冒充视口宽度。

浏览器临时视口覆盖已重置，用户主要工作台保持打开。状态切换、任务反馈来自隔离 fixture，不构成真实库存、身份、持久化或设备证据。

## 未执行门槛

按用户要求，本轮没有执行完整 Vitest、任何回归 Playwright 套件、Docker CI、库存性能基准、生产 Web/plugin 全量构建、真实 MCP 宿主或设备验收，也没有真人任务完成率测试。不存在自动化代替用户批准的记录。

生产接线、可靠持久化、跨账号/家庭运行时隔离、真实审批与幂等回执、摄像头/附件上传/标签设备、完整键盘读屏与多浏览器验收、所有宽度回归、性能预算及发布回滚均是后续门槛。组件对这些状态的表达不等于这些业务能力已实现。

契约限制继续保留：新 SKU 类型/能力与库存同请求原子声明的缺口、任意模板批改/全结果选择、MCP 与设备能力差异，都只表达限制并保留适用草稿，不用拆写或模拟成功填补。批量仍限明确 UUID 和 100 件，不自动拆分。

## 用户审阅与后续

先检查 Button/Input/Sheet 的字体、边界和焦点，再看数量/日期/身份等事实表达，然后查看操作恢复与五个组合场景。反馈通过聊天登记到 review-status.json，并同步 component-review.md；任何未获明确批准的项继续待审阅。统一处理组件反馈并冻结后，才进入完整业务页面装配。真实业务集成和回归恢复单独执行。

审阅状态的可编辑登记位于 `apps/web/review/review-status.json`，按75个稳定ID保存版本、组件依赖、反馈与批准记录。工作台只读取该记录；没有反馈后端、批准按钮或自动通过逻辑。目录检查要求“已批准”必须附带明确批准记录，当前记录均为空且状态均为待审阅。
