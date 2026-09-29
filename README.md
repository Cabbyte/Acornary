# Acornary / 松仓

**Acornary（松仓）** 是面向个人与家庭的物资管理与“物理世界记忆”系统。

> A structured memory for the physical things in your home.

它希望可靠地回答：物品是什么、具体拥有哪几件、在哪里、剩余多少、现在怎样、经历过什么，以及用户为它记录的文字、图片与故事。

## 当前状态

Stage2 已完成双端预验收、整库迁移、生产入口切换及正式 Codex／ChatGPT 授权和读取核对。正式地址为 [acornary.protium.top](https://acornary.protium.top)，MCP 为 `https://acornary.protium.top/mcp`；本地原库存已停写，云端为唯一正式库存。日常备份默认关闭，保留一次迁移前快照。实际通过项和验证边界见 [Stage2 验证记录](./docs/stage2-verification.md)，操作说明见 [云端运行](./docs/cloud-runtime.md)。核心模型仍为三张表；004 migration 增加认证支撑表，检查器仍只展示原有业务表。历史结果保留在 [Stage1 验证记录](./docs/stage1-verification.md)。

版本发布设施已落地：GitHub Actions 测试、公开 GHCR 镜像和服务器受限部署命令均已验证。**首个正式版本 `v0.1.0` 已通过 GitHub Actions 部署上线。** 版本、digest 与公网验收见 [v0.1.0 发布记录](./docs/release-v0.1.0.md)。 普通 main push 只触发 CI；正式 `vX.Y.Z` 才自动更新生产，有新增 migration 时先备份。当前阶段、代码与线上差异、下一步统一见 [项目进度](./docs/progress.md)。

**本地开发模式**在独立库运行：产品界面负责业务读写，检查器只读展示两棵树及业务表的实际记录，分开呈现派生结果和 API 响应。**云模式**提供邮箱、Passkey、可选密码及多家庭成员关系，双客户端 OAuth 复用同一账号；公开注册和邮箱找回默认关闭，真实邮件配置与收信验收后分别开启。实现与迁移说明见 [账号系统](./docs/accounts.md)，线上版本以发布记录为准。图片附件、模板升级、FEFO 和后台提醒继续后置。

沿用 TypeScript / Node.js 24 LTS、Fastify 5、官方 MCP TypeScript SDK v2、PostgreSQL 18、Drizzle、Zod 4、React / Vite；Stage2 增加 Better Auth 1.7.5 的 MCP／CIMD／JWT 和共享 Caddy HTTPS 入口。`local` 模式使用回环地址与个人凭证，`cloud` 模式只接受 OAuth，不回退为个人凭证。完整边界见 [架构](./docs/architecture.md)。

## Web 产品界面（v0.1.0 已上线）

手机优先的「物品、位置、目录、设置」已实现，支持通过页面执行现有业务命令、离线查看缓存、断网保留草稿、幂等重试与冲突核对。原只读检查器移至 `/inspect`，从设置进入并共用会话。`/login` 与 `/consent` 使用产品的公共认证组件；生产共用一个域名与 HTTPS 443。设计来源、接口映射、隔离演示环境和实机验收边界见 [Web UI 实现说明](./docs/webui.md)。本机隔离预览继续保留，正式库存与原停写本地库存的数据不变。

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
