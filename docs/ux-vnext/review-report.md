# Phase 1 交付报告

日期：2026-11-06；候选版本P1-RC1。**设计编制完成，用户冻结确认尚未完成。** 本候选不能作为已获得Phase2/3验收的证据。

## 目标

在独立codex/frontend-vnext分支把Frontend vNext Handoff转为可以审阅和实施的双模式交互规格，保留当前领域语义，并明确不能单靠UI实现的分支。

## 本轮实施内容

- 定义日常/管理导航、URL及旧二维码/历史链接映射，共17类页面/面板。
- 完成D01–D09和M01–M06，每项有流程、输入/输出、错误恢复和契约映射。
- 定义15种全局状态、每流程状态覆盖、共享OperationSession、草稿/审批/原请求恢复与身份隔离。
- 提供桌面、手机、MCP的线框与尺寸行为；明确单件与商品、两种树、批量选择和真实设备边界。
- 提供三层组件契约、平台无关Token候选与62组色对计算。
- 提供任务测量口径、工程/人工/宿主验收矩阵、Phase2顺序及6项冻结取舍。

## 修改文件

全部在docs/ux-vnext：README、product-principles、information-architecture、mode-switching、daily-flows、management-flows、screen-specifications、interaction-states、component-contracts、accessibility、acceptance-matrix、decision-log，以及baseline-and-capabilities、implementation-plan、design-tokens.json、token-contrast和本报告。共16份Markdown及1份JSON。

未改apps、packages、运行配置、依赖或数据库。原工作区未提交UI/品牌素材保持原状，Cloudflare分支未修改。

## 使用的领域契约与用户流程

packages/contracts的index/read-v2/intake/registry/deadline/notes/semantics/export及packages/domain为依据；映射详见[基线与能力](baseline-and-capabilities.md)。覆盖D01–D09、M01–M06；创建商品/具体实物、分类/位置、日期类型、revision、幂等、审批、原子批量、笔记、标签与身份协议均独立明确。

## 检查命令与结果

| 检查                                                                | 本轮结果                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| git fetch origin main codex/cloudflare-native，PR及exact-SHA CI查询 | 已核实，详见基线；main CI成功但Release失败且未deploy；Cloudflare为Draft且两CI成功 |
| Python3标准库文档结构/相对链接/流程状态覆盖检查                     | 12个必需文件齐备；15流程、15状态、17页面均映射；本地文件链接检查通过              |
| Python3按sRGB公式读取design-tokens.json计算                         | 62组色对均达到指定文本/非文本阈值，见token-contrast                               |
| 仓库已安装Prettier --write/--check docs/ux-vnext                    | 格式化后检查通过；仅用于文档，不代表Node24应用构建验证                            |
| git diff --cached --check                                           | 通过；暂存范围仅docs/ux-vnext                                                     |
| pnpm typecheck/build/test/test:e2e                                  | 未执行；本轮无运行代码变更                                                        |

## 浏览器、MCP与交互证据边界

线框和Mermaid流程在[页面规格](screen-specifications.md)、[日常流程](daily-flows.md)、[管理流程](management-flows.md)与[状态文档](interaction-states.md)，是设计证据，不是截图测试。没有启动演示业务、没有真实库存写入、没有运行真人任务/axe/实际宿主/物理打印验证。历史CI及Cloudflare验收仅作为已有输入，不冒充本轮通过。

## 未解决问题

产品需用户确认DEC-01至DEC-06。G01新商品显式类型与原子入库缺口，G03日期语义适配、G04错误恢复、G05宿主限制、G06离线冷启等均有明确停止/解除条件；G02/G07限制由设计不承诺越界功能处理；G08需实际类型对齐。性能B0和绝对预算尚未实测/冻结，按Phase2首项完成。

新商品基础原子能力已经存在；不能把G01说成所有新商品都不支持。当前后端对unprofiled旧商品仍允许部分属性写入，但这不能替代显式类型/能力契约，也不是UI绕过能力检查的许可。

## 正式数据与部署

均未触及。只读仓库/GitHub元数据与文档写入；没有调用Acornary业务写工具、迁移、部署或生产切换。交付为本地独立分支的设计候选提交，未推送、未新建远端PR。

## 下一轮依赖

用户确认本候选或修订后，按[实施顺序](implementation-plan.md)从设计系统与隔离开发入口开始。Phase2只实现生产级React UI与fixture验证，接通真实业务和入口替换仍必须等Phase2验收。
