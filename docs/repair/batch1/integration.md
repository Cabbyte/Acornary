# Batch 1 + Batch 2 集成验收

状态：`WAVE1_INTEGRATED`。Batch 1 的四个 lane（operation、tree、sync、query）已合并到 `codex/data-model-v2`，并在隔离 PostgreSQL 18.6 上完成真实数据库验收。Batch 3–8 尚未开始。

## 分支与提交

| 内容 | 提交 / 位置 |
| --- | --- |
| Batch 0 基线 | `0828362` |
| 契约缺口补丁 | `f025cff` |
| ops lane | `9967c26` |
| tree lane | `97b3d3d` |
| sync lane | `7bd98d0` |
| query lane | `7f5c055` |
| 集成修复（列表不内联笔记、条码差量、旧回执测试、TREE04 隔离守卫、sync grants） | `e2ee897` 及后续提交 |

## 已应用迁移

`001`–`005`、`007`、`008`、`009_01`–`009_06`、`010`、`011`、`012`，在 PostgreSQL `18.6` 的 `acornary_test` 空库上通过新的 migration runner 应用。`009_02`、`009_03` 为非事务迁移；`009_03` 是 `CREATE UNIQUE INDEX CONCURRENTLY`。7 条历史 migration 仍为 `UNVERIFIED`，与 Batch 0 证据一致，生产切换前必须签署或核验。

## 验证结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 全仓库单元/集成 | **157 passed / 52 todo / 0 failed**，20 个文件 | `DATABASE_URL=.../acornary_test vitest run`（Batch 0 历史记录仍写 76 项 todo；当前 24 项已有 PASS/PARTIAL 证据，故 todo 为 52） |
| Batch 1 operations | **26 passed** | `tests/batch1/ops-postgres.test.ts`、`ops-runner.test.ts` |
| Batch 1 tree guards | **25 passed / 1 todo** | `tests/batch1/tree-guards.test.ts` |
| TREE04 写隔离 | **1 passed** | `tests/batch1/tree-service-isolation.test.ts` |
| Batch 1 sync foundation | **13 passed** | `tests/batch1/sync-writes.test.ts` |
| Batch 2 query | **19 passed**（10 cursor + 9 DB） | `tests/batch2/query-cursors.test.ts`、`query-database.test.ts` |
| Batch 1+2 合并定向 | **84 passed / 1 todo**，7 个文件 | `tests/batch1/*.test.ts` + Batch 2 两个文件，同一隔离库 |

全仓库测试必须在干净 `acornary_test` 上运行；重复运行会累积 `rateLimit` 行并触发 429，这是测试环境复用问题，不是代码回归。每次完整验收前重建数据库。

## 验收用例

| 用例 | 状态 | 证据 |
| --- | --- | --- |
| OP01–OP07 | PASS | 事务先事件后回执、缺回执拒绝、重复/跨家庭操作 ID、回填桥、历史字节保留、中断恢复 |
| OPS01–OPS04 | PASS | UNVERIFIED/漂移、非事务索引清理、检查点恢复、失败回滚保持兼容 |
| TREE01/02/03/05/06 | PASS | 两连接互相挂父、移动与能力撤销、失败回滚、目录移动与 SKU 引用竞争 |
| TREE04 | PARTIAL | 已加入 `assertWriteIsolation` 并在写路径调用；helper 经真实 REPEATABLE READ 事务验证。没有为测试注入任意隔离级别的入口，故未做完整 execute 路径注入测试 |
| QUERY01/02/03/06/07 | PASS | 统一匹配集合、stale 游标、全量统计、中文短词规范化、同一条目日期过滤 |
| QUERY08 | PARTIAL | 小数据集 SQL 数 5、EXPLAIN/索引检查通过；10k/100k/10k 性能预算 **NOT_RUN** |
| QUERY09 | PARTIAL | 条码索引改为集合差量维护；未新增专门冲突/回滚用例，现有 barcode 集成测试通过 |

## 本批实际改动

- 新增 migration runner：checksum、UNVERIFIED 历史、事务/非事务状态、失败记录、独立迁移池。
- `operations.operation_id` 真实列、桥接触发器、回填、唯一约束、延迟外键、不可变保护、大小守卫、权限收紧。
- 两棵树触发器：家庭 advisory lock、SKU/父类型/容器能力/成环/身份不可变校验。
- `sync_changes` + `household_sync_state` + `save()` 单点 hook；Batch 1 仅存引用，不存 `after_image`。
- SQL 查询：keyset 游标、全量统计、规范化搜索、同模板同条目属性过滤、历史 SQL 过滤；012 索引。
- 查询列表不再内联笔记正文；`get_item` 仍返回笔记。搜索仍匹配笔记正文。
- 目录条码索引只在集合变化时重建。
- 写事务在取得家庭锁后检查 READ COMMITTED；新增 `UNSUPPORTED_WRITE_ISOLATION`。
- `deploy/grants.sql` 收回 operations UPDATE/DELETE、核心表 DELETE，并加入 sync 表的列级授权。

## 已知缺口

1. 10k 物品 / 100k 事件 / 10k 笔记的 QUERY08 性能基准尚未执行；当前只有小 fixture 的 SQL 数与 EXPLAIN 证据。
2. QUERY09 没有专门的条码冲突原子回滚测试；实现已改为差量维护。
3. 位置路径文本搜索未实现；递归容器范围和 `path_ids` 仍支持。Batch 3 共享读模型补。
4. `sync_changes` 只覆盖当前 `save()` 路径；目录政策/提案、附件、void/split、profile 等后续写路径尚未接 hook。
5. Batch 3 同步状态机、初始追赶、墓碑、清理与标签投影未实现；本批只交付 Batch 1 基础。
6. 7 条历史 migration checksum 仍为 `UNVERIFIED`；生产审计与签署未完成。

## 下一批

Checkpoint B：Batch 3（同步/标签）、Batch 4（registry/profile/能力）、Batch 5（deadline/date_facts）。Batch 7（附件/脱敏）可独立并行。开工前先冻结 registry、deadline、date_facts 与同步 envelope 的接口，避免三个 lane 同时改 `service.ts`。
