# Acornary 文档

先读 [项目进度](./progress.md)。Acornary 以云端库存为唯一正式数据源，Web 和 MCP Apps 使用同一套响应式工作台；MCP 与 Web 写入共用领域命令。产品支持读写，`/inspect` 检查器保持只读。

## 当前实现与运行

| 文档 | 内容 |
| --- | --- |
| [项目进度](./progress.md) | 已实现、已发布、已验证的状态和剩余边界 |
| [领域模型](./domain-model.md) | CatalogNode / Item 两棵树、稳定身份、七种属性模板、事件与不变量 |
| [架构](./architecture.md) | 运行模式、技术栈、领域命令、事务、权限及阶段演进 |
| [业务示例](./examples.md) | 明确 UUID 的操作、局部更新、移动、笔记和失败场景 |
| [Ant Design 统一界面](./antd-ui.md) | 全量迁移、共享主题、组件约定、独立试用与验证 |
| [Web UI](./webui.md) | 路由、会话、读写、离线缓存、草稿与验证流程 |
| [响应式工作台](./responsive-workbench.md) | 桌面／手机共用界面、原子批量移动与编辑 |
| [MCP Apps 插件](./plugin.md) | 宿主桥、资源、身份作用域、上下文与私有状态 |
| [账号系统](./accounts.md) | Passkey、密码、家庭成员、邮件开关与迁移 |
| [版本发布](./releases.md) | GitHub Actions、GHCR、受限 SSH、迁移备份与恢复 |
| [云端运行](./cloud-runtime.md) | 云端模式、OAuth、账号运维、入口与备份 |
| [本地运行](./local-runtime.md) | 独立开发环境、Codex 连接、测试和恢复核对 |
| [产品语言](./product-language.md) | 品牌语言与领域术语 |

## 历史证据

- [v0.4.2 发布](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2)：工作台与插件统一、仓库迁移后的发布修复及生产核对。
- [v0.2.1](./release-v0.2.1.md)、[v0.2.0](./release-v0.2.0.md)、[v0.1.0](./release-v0.1.0.md)：名称校验、账号、初版 Web 的发布记录。
- [发布设施验证](./release-verification.md)、[Stage2 验证](./stage2-verification.md)、[Stage1 验证](./stage1-verification.md)：各阶段当时的证据与边界。
- [本地交接归档](./archive/README.md)：已被主线和正式发布取代的工作树交接。

## 一句话模型

**CatalogNode 定义分类和商品，Item 用独立 UUID 表示每件实物并形成容纳树；属性由版本化模板扩展，变化由 Event 记录，自由文字由 Note 保存。** 图片附件尚未实现。

| 问题 | 数据来源 |
| --- | --- |
| 它是什么？ | Item.catalog_node_id → CatalogNode SKU 及其 GROUP 祖先 |
| 具体是哪一件？ | Item UUID；六瓶牛奶是六个不同 UUID |
| 在哪里？ | Item.parent_id 形成的容纳树，完整路径由查询推导 |
| 有多少件／剩多少？ | 实物件数、未知生命周期件数与 contents.remaining 分开统计 |
| 品牌、条码、日期、状态是什么？ | 对象内嵌 attributes 绑定固定版本的 AttributeTemplate |
| 经历了什么？ | 通过对象身份和 operation_id 查询 Event |
| 有哪些自由记录？ | Item → Note；附件是后续能力 |

家、厨房、抽屉可以引用隐藏的通用容器 SKU；实际冰箱或行李箱可引用真实 SKU。容纳能力由实例模板声明，目录隐藏不能替代权限控制。模板为 product、lifecycle、contents、container、catalog、clothing、device；未记录的字段保持未知。

领域语义以领域模型为准，接口和运行约束以架构及实现说明为准。修改时同步核对字段、图示、模板、MCP 示例和验收场景；历史文档不构成另一套当前契约。
