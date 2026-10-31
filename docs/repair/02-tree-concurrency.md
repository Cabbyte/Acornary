# 02 · 两棵树并发契约

## 锁与快照

items、catalog_nodes 写触发器第一条数据库操作必须是 `pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0))`，与服务层完全相同。业务写事务显式 READ COMMITTED；取得锁后检查隔离级别，非 READ COMMITTED 返回 `UNSUPPORTED_WRITE_ISOLATION`。只读快照继续允许 REPEATABLE READ。

触发器使用 VOLATILE 的独立 SQL 查询，在等待锁结束后读取已提交的父链。不能复用 UPDATE 外层语句开始时预先计算的父链。普通写入不得改变 id/household_id。应用提前拿锁；直接 SQL 仍必须经过触发器保护。

锁内检查：同家庭、Item 引用 SKU、目录父必须 GROUP、SKU 不可有子节点、Item 父具容纳能力、撤销容纳能力时没有子物品、递归无环。递归必须记录 visited 集合，坏历史也要有限终止。错误 SQLSTATE/约束名映射到稳定领域错误。

## 并发测试骨架

使用两个 pg.Client 和第三个观察连接。A 开事务执行第一条变更但不提交；B 启动相反变更；观察 pg_locks 中 B 等待同一个 advisory lock 后才允许 A 提交。不能依赖固定 sleep 猜测是否重叠。整体超时后取消 B 并回滚两边，不能让 CI 挂起。

覆盖 Item A→B/B→A、GROUP A→B/B→A、移动与撤销容纳能力、目录关系修改与引用创建。至少一方失败，最终图必须无环。若发生死锁，断言事务完全回滚，并在有限重试后再次核验；不能仅凭任意异常就判定防环通过。

另测 READ COMMITTED 默认、明确 REPEATABLE READ 被拒绝、失败后再次读取不遗留半次变更。批量维护每事务只处理一个家庭；新树约束进入生产前先处理副本审计中的历史异常。

现有 CI 夹具直接操作 SQL 的部分需要在 Batch 1 中调整；不得为使测试通过而关闭约束。
