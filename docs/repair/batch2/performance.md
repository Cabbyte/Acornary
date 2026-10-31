# Batch 2 — 10k 读路径基准

> 目的：验证 `query_items`、`get_history`、`query_catalog_nodes` 在 10k 物品/100k 事件/10k 笔记规模下的读延迟，并给查询预算一个真实数据点。  
> 范围：本地 Docker PostgreSQL 18.6，单读者、无并发写入、无生产副本；不是容量规划结论。

## 数据

在空的 `acornary_test_perf` 上按 `001`–`020` 迁移后，用 `scripts/batch0/fixture.ts` 的 synthetic fixture 灌入：

| 表 | 行数 |
| --- | --- |
| items | 10,000 |
| events | 100,000 |
| notes | 10,000 |
| households | 2 |

物品按夹具在 2 个 household 间交替，因此被测 household 约 5,000 件；全库合计 10,000 件。所有值均为合成数据。

## 结果（单读者，200/100 次采样）

| 场景 | p50 | p95 | 预算 | 结果 |
| --- | --- | --- | --- | --- |
| `query_items` 首页（50 条） | 67.1 ms | **70.3 ms** | 300 ms | PASS |
| `query_items` 中文双字搜索 | 108.0 ms | **112.3 ms** | 200 ms | PASS |
| `get_history` household 首页 | 3.1 ms | **6.0 ms** | 150 ms | PASS |
| `query_catalog_nodes` GROUP 首页 | 2.2 ms | **3.1 ms** | 300 ms | PASS |

Node 26.7.0；本地容器；查询包含 `BEGIN`/`SET TRANSACTION`/`COMMIT` 与 service 层处理。未跑完整的 `query-performance.test.ts` 3×1000 轮和 11 个 case 矩阵，也未测并发读者/写者。

## 修复的真实瓶颈

首次首页查询为 **~1.9 s**。`EXPLAIN ANALYZE` 显示每个日期状态子查询都在调用 `acornary_date_timezone`，而该函数对每一行扫描 `pg_timezone_names`。`itemDatesJsonSql` 每页约 51 行，乘以目录视图扫描，形成 1.8 s 的 SubPlan。

迁移 `020_timezone_read_perf.sql` 先去掉逐行目录解析，`021_timezone_names.sql` 再用迁移时快照的小表保留非法时区回退 UTC 的兼容性：

```sql
CREATE OR REPLACE FUNCTION acornary_date_timezone(zone text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT name FROM acornary_timezone_names
    WHERE lower(name)=lower(zone) LIMIT 1), 'UTC')
$$;
```

修复后同一查询 **~70 ms p95**。这不是索引缺失问题；索引已存在，瓶颈是读路径中的目录解析。

`020` 的 identity 版本会让历史非法时区行在 `AT TIME ZONE` 直接报错，因此 `021_timezone_names.sql` 增加了迁移时快照的 `acornary_timezone_names` 小表和 `lower(name)` 索引：合法名称走索引，非法/空值回退 UTC，既保留旧兼容行为，也避免逐行扫描 `pg_timezone_names`。

## 复现

```sh
# 空库 + 全量迁移
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_perf \
  ../../node_modules/.bin/tsx apps/server/src/migrate.ts --grants
# 用 fixture 灌入 10k/100k/10k（临时脚本，不入库）
# 然后运行有界采样脚本，记录 p50/p95
```

## 未覆盖

- 并发读者/写者和锁竞争；
- 完整 11 个 QUERY08 case、每 case 3×1000 轮；
- 业务 SQL 条数（测试要求 ≤5）与 `EXPLAIN` 计划归档；
- 生产副本、冷缓存、真实磁盘和网络延迟；
- 10k 导出、同步 bootstrap 和附件元数据组合。

这些仍属于发布前性能门禁，不能用本报告替代。
