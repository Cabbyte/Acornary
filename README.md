# Acornary / 松仓

**Acornary（松仓）** 是面向个人与家庭的物资管理与“物理世界记忆”系统。

> A structured memory for the physical things in your home.

它希望可靠地回答：物品是什么、具体拥有哪几件、在哪里、剩余多少、现在怎样、经历过什么，以及用户为它记录的文字、图片与故事。

## 当前状态

正式地址为 [acornary.protium.top](https://acornary.protium.top)，MCP 为 `https://acornary.protium.top/mcp`。云端 PostgreSQL 是唯一正式库存，原本地库存保持停写；本地开发使用独立库。

响应式工作台与 MCP Apps 共用界面已合入 `main`，随 [v0.4.2](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2) 正式发布。当前发布状态、核对日期和验收边界集中记录于 [项目进度](./docs/progress.md)；后续版本以 [Releases](https://github.com/Cabbyte/Acornary/releases) 和线上 `/health` 为准。普通 main push 只运行 CI，正式 `vX.Y.Z` 标签才自动部署，有新增 migration 时先备份，见 [发布手册](./docs/releases.md)。

账号支持邮箱、Passkey、可选密码和多家庭成员关系，Web 与 MCP 按当前授权家庭隔离。公开注册与邮箱找回默认关闭，真实 SMTP 配置和收信验收后分别开启，见 [账号系统](./docs/accounts.md)。图片附件、模板升级、自动选取／FEFO 和后台提醒仍未实现；日常定时备份默认关闭。

运行栈为 TypeScript、Node 24、Fastify、MCP TypeScript SDK v2、PostgreSQL 18、Drizzle、Zod、React / Vite 与 Better Auth。精确版本由锁文件记录；云端使用共享 Caddy HTTPS 入口和 OAuth，本地 MCP 使用回环地址及个人凭证，见 [架构](./docs/architecture.md)。

## Web 与 MCP Apps

桌面三栏和手机工作台共用页面、数据与领域命令，支持搜索、筛选、排序、按 UUID 多选、原子批量移动和物品／备注编辑。详细资料、入库、消耗、纠错、笔记和历史入口继续可用。离线只读缓存，修改需联网；草稿、同键重试及 revision 冲突处理保留。

`/inspect` 是独立按需加载的只读检查器，从设置进入并共用账号会话。Web 与插件共用 `Workspace`，各自通过同源 HTTP 或 MCP Apps 宿主桥访问后端。当前设计、接口、复现方式与验收边界见 [Web UI](./docs/webui.md)、[响应式工作台](./docs/responsive-workbench.md) 和 [插件实现](./docs/plugin.md)。

## 本地启动

以下用于独立本地开发环境。已迁移工作区保留停写标记，禁止重新启动原正式库存；日常使用请连接云端 MCP。

```sh
node scripts/local.mjs init
node scripts/local.mjs codex
```

Web：<http://127.0.0.1:3210>。Docker 内使用 Node 24，无需切换宿主机 Node。

## 核心模型

```text
CatalogNode（含 attributes） ──定义──> Item（含 attributes）
          │                            │
          └── 按模板键和版本校验 ────────┤
                   AttributeTemplate   └── Note → NoteAttachment（后续）

CatalogNode / Item 的变化 → Event
```

核心三张表为 catalog_nodes、items、attribute_templates。属性绑定是对象 attributes 数组中的值结构，无独立表或 ID；家庭、操作者、笔记、事件、幂等及其他支撑表继续保留。

- **CatalogNode**：GROUP 组织分类，SKU 描述具体商品；系统生成的稳定 ID 不随名称、条码或分类改变。
- **Item**：每件实物一个 UUID；六瓶同款牛奶共用一个 SKU，但拥有六个不同 UUID。空间与容器也是 Item，其父引用表达实际放置关系。
- **受控模板**：product、lifecycle、contents、container、catalog、clothing、device 七个模板覆盖属性扩展；业务字段默认可选，二级／三级路径受定义约束，禁止任意 KV。
- **Event**：当前状态与追加式事件原子更新，解释每次实际变化；数量汇总和完整位置路径由查询推导。
- **Note / NoteAttachment**：保存用户自由记录的做法、提醒、文字、图片与故事。

## Design goals

1. **稳定身份**：开封、部分消耗、移动、纠错均保留实物 UUID；件数来自实例统计。
2. **明确关系**：分类树回答“是什么”，容纳树回答“在哪里”；容器只用一个实例表达。
3. **最小核心、受控扩展**：新增物品类别优先使用模板；模板版本固定，升级显式执行；set / unset 只修改指定属性路径。
4. **AI-native、领域服务控制**：共享领域服务维护权限、模板校验、幂等与事务；MCP 与产品 Web 使用相同业务命令，检查器只读，不让模型直接写数据库。
5. **事实与推导分离**：保存实例上的日期与开封事实，临期、路径和分组统计按需计算；未知状态可参与日常库存和明确操作，不自动补成 ACTIVE 或已确认可用。
6. **结构化事实与自由记忆并存**：属性可查询、可比较；笔记保留用户表达，不自动覆盖结构化事实。

## Documentation

- [项目进度与下一步](./docs/progress.md)
- [版本标签与自动发布](./docs/releases.md)
- [发布验证记录](./docs/release-verification.md)
- [本地运行与备份](./docs/local-runtime.md)
- [实际验证记录](./docs/stage1-verification.md)
- [文档索引](./docs/README.md)
- [领域模型与静态结构](./docs/domain-model.md)
- [架构与公共接口](./docs/architecture.md)
- [场景示例与验收要求](./docs/examples.md)
- [产品术语](./docs/product-language.md)
