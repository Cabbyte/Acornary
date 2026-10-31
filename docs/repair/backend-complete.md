# 后端实现完成报告（Batch 0–8）

> 分支：`codex/wave2-integration`（基于 `codex/data-model-v2`）  
> 日期：2026-11-01  
> 状态：`BACKEND_COMPLETE_WITH_GATES`。后端代码、迁移和测试已完成；生产切换仍受下方门禁约束。

## 1. 结论

Batch 3–8 的后端能力已经实现并合并到集成分支：

- 模板 registry、未知/退役绑定、profile/capabilities、UI 元数据；
- deadline、`date_facts`、统一日期视图和日期过滤；
- 同步 API、快照 v2、商品分组、标签投影；
- REFERENCE、usage/custody/service/transport/wardrobe/asset/stock/disposition、void/dispose/split、单位换算、`query_stock`、one_off/SKU 规则；
- 笔记目标扩展、附件 BlobStore/上传/下载、脱敏；
- 冻结导出（QUERY04/05），一小时快照、分页、TTL、敏感披露审计；
- 数据库事件/引用/拆分约束、协议开关、错误映射、检查器、健康检查和恢复清单。

**没有完成、也不应伪装完成的**：附件缩略图/像素重编码/旋转、附件字节与 GC/备份租约、独立异机恢复、7 条历史 migration checksum、客户端缓存/三端切换、`get_item` v2 包装。这些是明确的剩余门禁。

## 2. 测试证据

全部在隔离 PostgreSQL 18.6 上执行；数据库为 Docker 本地实例，未连接生产。

| 范围 | 结果 |
| --- | --- |
| 全仓库既有回归 | **157 passed / 2 todo / 0 failed**，20 个文件 |
| Batch 1 + 2（新验收） | **84 passed / 1 todo** |
| 10k 读路径基准 | items p95 **70.3 ms**、history **6.0 ms**、search **112.3 ms** |
| Batch 3 sync/label | **17 passed / 4 skipped** |
| Batch 4 registry/profile | **19 passed** |
| Batch 5 deadline/dates | **11 passed** |
| Batch 6 semantics | **23 passed** |
| Batch 7 notes/attachments | **15 passed**；媒体安全 **3 passed**；冻结导出 **12 passed** |
| Batch 8 hardening | **12 passed / 1 todo** |
| 类型检查 | 根与 Web `tsc --noEmit` 通过 |
| 构建 | server、Web、插件 bundle 通过 |

验收用例：**60 PASS / 14 PARTIAL / 2 NOT_RUN**（76 条）。PARTIAL/NOT_RUN 与下方门禁一一对应。

## 3. 迁移

已按顺序应用：`001`–`005`、`007`、`008`、`009_01`–`009_06`、`010`、`011`、`012`、`013`、`014`、`015`、`016`、`016a`、`017`、`018`、`019`、`020`、`021`。`009_02/009_03` 为非事务迁移；`016a` 是旧笔记插入兼容桥。

- 新数据库从空库完整迁移通过。
- `--grants` 通过；运行角色测试覆盖事件/ACTOR 引用插入、核心表 UPDATE/DELETE 收紧、同步表列级授权。
- 7 条历史 migration 仍是 `UNVERIFIED`；发布前必须用历史 release/git 证据核对，不能用当前文件 hash 冒充。

## 4. 主要接口与能力

| 能力 | 状态 | 入口 |
| --- | --- | --- |
| 模板 registry / unknown / retired | 完成 | `list_attribute_templates`、`get_attribute_template`、`upgrade_attributes` |
| profile / capabilities | 完成 | catalog create/update、快照、详情、模板过滤 |
| deadline / date_facts | 完成 | `add/update/remove/complete_deadline`、`date_filters`、`dates` |
| 同步 v2 | 完成（服务端） | `/api/sync/state`、`/changes`、`/fetch`、`/bootstrap` |
| 快照 v2 / 分组 | 完成 | `X-Acornary-Protocol: 2` + `/api/ui/snapshot`、`query_inventory_groups` |
| 标签投影 | 完成 | `label_hash`/`label_updated_at`/`projected_through_change_id` |
| 引用与状态 | 完成 | REFERENCE、custody/usage/service/transport/wardrobe |
| 处置 / 作废 / 拆分 | 完成 | `dispose_item`、`void_item`、`void_catalog_node`、`split_item` |
| 单位 / 补货 / 资产 / SKU | 完成 | units、`stock`、`query_stock`、asset、clothing/device v2、one_off |
| 笔记 / 附件 / 脱敏 | 完成（媒体门禁除外） | notes/attachment commands、blob routes、`redactFor` |
| 冻结导出 | 完成 | `begin_export`/`read_export`/`cancel_export` |
| 约束 / 错误 / 协议 / 检查器 | 完成 | migration 018、`mapDatabaseError`、`ACORNARY_REQUIRE_PROTOCOL_V2=1` |
| 健康 / 恢复清单 | 完成（异机字节门禁除外） | `/health`、`verify-restore.ts` |

前端契约见 [frozen-interfaces.md](./frozen-interfaces.md)；未实现项在该文件标 `F`/`PARTIAL`。

## 5. 剩余门禁

1. **附件媒体**：已实现无依赖的 EXIF/eXIf/XMP 剥离与 JPEG/PNG/WebP 尺寸读取（`SafeMediaProcessor`）。**缩略图、像素重编码/旋转**仍未实现；FILE02 仍为 PARTIAL。
2. **附件字节/备份**：数据库元数据摘要已验证；附件字节 manifest、GC 租约、NAS/SFTP 上传、独立密钥解密和真实异机恢复未执行。`OPS07` 为 NOT_RUN。
3. **历史校验和**：7 条 `UNVERIFIED` 需要发布前人工签署/核对。
4. **客户端**：Web/Android/插件尚未切到 v2；`get_item` 仍是扁平形状，v2 包装未实现。
5. **全路径脱敏**：笔记/附件/检查器/详情已覆盖；其他读取路径的完整矩阵仍为 PARTIAL。
6. **生产切换**：`ACORNARY_REQUIRE_PROTOCOL_V2` 默认关闭；三端切换、真实插件附件传输、真实 Android 同步/打印、生产副本审计和恢复演练仍需执行。

## 6. 合并状态

后端全部工作在 `codex/wave2-integration`，基于 `codex/data-model-v2`。主工作树当前有另一条前端的未提交改动（`apps/web/src/next`、frontend-refactor 文档），因此**没有**把后端分支强合并进主工作树，也没有触碰这些前端文件。

推荐收口：

1. 前端完成并提交；
2. 在干净工作树把 `codex/wave2-integration` 合入 `codex/data-model-v2`；
3. 跑一次全仓回归 + 三端黄金样本；
4. 解决 7 条 checksum、附件字节/异机恢复门禁；
5. 再开启协议 v2 强制和生产切换。

## 7. 证据入口

- [前端接口冻结 v2](./frozen-interfaces.md)
- [Batch 1+2 集成](./batch1/integration.md)
- [10k 读路径基准](./batch2/performance.md)
- [Batch 3 sync/label](./batch3/sync-label.md)
- [Batch 4 registry/profile](./batch4/registry.md)
- [Batch 5 dates](./batch5/dates.md)
- [Batch 6 semantics](./batch6/semantics.md)
- [Batch 7 notes/attachments](./batch7/notes-attachments.md)
- [Batch 7 media safety](./batch7/media.md)
- [Batch 7 frozen export](./batch7/export.md)
- [Batch 8 hardening](./batch8/hardening.md)
- [验收用例](../tests/batch0/cases.json)
- [44 条缺陷清单](../data-model-findings.csv)
