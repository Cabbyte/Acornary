# Acornary / 松仓

**Acornary（松仓）** 是面向个人与家庭的物资管理与“物理世界记忆”系统。

> A structured memory for the physical things in your home.

它希望可靠地回答：物品是什么、具体拥有哪几件、在哪里、剩余多少、现在怎样、经历过什么，以及用户为它记录的文字、图片与故事。

## Cloudflare 原生分支

此分支将运行时完全迁移到 Cloudflare Workers：Static Assets 托管 WebUI 与 MCP UI，每家庭一个 SQLite Durable Object 保存库存与权限事实，D1 保存账号、OAuth 和家庭目录，私有 R2 保存附件与备份，Queues / Alarms / Cron 处理可恢复任务。

预览已部署到 [cf.acornary.protium.top](https://cf.acornary.protium.top)，使用生产数据的隔离副本，REST 与 MCP 只替换 origin，保持 54 个操作的 schema、错误和业务语义。预览先使用 Workers Free，保留完整业务功能；原先 25 MiB 上传触发的 CPU 限制已通过独立上传 DO 与原生哈希处理优化，完整原生远端测试已通过，继续在免费套餐上验证；当前未升级，长期容量与真实客户端验收仍需观察。发布与数据迁移进度见 [验收记录](docs/cloudflare/acceptance.md)。既有 [正式站](https://acornary.protium.top) 继续承载正式库存，预览写入不会回灌。

- [验收证据与剩余门槛](docs/cloudflare/acceptance.md)
- [预览发布、CI 与 Android](docs/cloudflare/preview-release.md)
- [一致快照迁移](docs/cloudflare/snapshot-migration.md)
- [原生备份与空环境恢复](docs/cloudflare/backups.md)

新应用没有 PostgreSQL、Fastify、Caddy、服务器附件目录或 owner token 兼容运行模式。`nodejs_compat` 仅提供 Workers 支持的 Node API。公开注册与邮箱恢复保持关闭；密码和 Passkey、OAuth PKCE、多家庭权限继续可用。

## 本地开发与验收

使用 Node 24 和锁定的 pnpm。应用开发运行在 workerd，本地绑定独立保存于 `.local/cloudflare-dev`。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

本地地址为 `https://localhost:3210`。启动脚本创建独立随机凭据并显示其本地文件位置，不读取生产 `.env`。首次登录后创建测试家庭。开发证书需本机信任；远端验收必须验证真实 TLS。

```sh
pnpm typecheck
pnpm test
pnpm cf:contracts
pnpm cf:test:inventory
pnpm cf:test:http
pnpm cf:test:backup
pnpm cf:test:snapshot
pnpm cf:test:browser
```

快照测试需 Docker，只启动一次性 PostgreSQL。浏览器验收需安装 Playwright Chromium；它使用实际 workerd、D1、DO、R2、构建后的 Web/MCP UI 和真实 OAuth 流程。模拟 MCP 宿主不等于 ChatGPT/Codex 实际客户端验收。

旧服务仅通过 `pnpm cf:reference` 从固定提交 `18f7e0496ecb4fb960a6619f12f57c68b3898410` 提取到忽略目录 `output/cloudflare-reference`，供迁移比较。它不进入本分支的构建和部署；原有 PostgreSQL 测试、迁移历史与 SSH 部署实现仍可在该固定提交查阅。

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
