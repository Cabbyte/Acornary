# 01 · 操作标识与事件完整性

## 现状与目标

当前操作标识只保存在 `operations.result.operation_id`。既有表达式索引可用于查询，不能作为事件外键的目标。新增真实 `operation_id text`，同家庭唯一；不修改 result、fingerprint、fingerprint_format、created_at 或旧事件。

## Online expand 顺序

1. 加可空真实列，设置短 lock_timeout；取不到 DDL 锁则退出重试，不长时间阻塞写入。
2. 安装 BEFORE INSERT 兼容桥：旧写入未传真实列时从 result 复制；传入值必须与 result 内标识相同且格式有效。桥接版应用同时显式写两处。不能为缺失 ID 生成替代值。
3. 按 `(household_id, actor_id, idempotency_key)` 键集分页回填，事务只处理有限批次。记录检查点；只更新 operation_id。不可变 UPDATE 触发器必须在回填完成后启用。
4. 在同一一致性副本审计 NULL、非法格式、重复 `(household_id, operation_id)`、孤儿和跨家庭事件。冲突交人工治理；不自动合并回执、改事件或补造操作。
5. `CREATE UNIQUE INDEX CONCURRENTLY` 建真实列组合索引，成功后 `ADD CONSTRAINT ... UNIQUE USING INDEX`。索引名、定义和任务归属一致才允许失败恢复清理。
6. events 增加 `(household_id, operation_id)` → operations 同列外键，`DEFERRABLE INITIALLY DEFERRED NOT VALID`，随后单独 VALIDATE。没有目标唯一约束不得执行此步。
7. 验证完成后增加一致性 CHECK（包括 result 中 ID 存在且为 JSON string，不能让 JSON null 逃过 CHECK）、NOT NULL；先 NOT VALID CHECK、在线 VALIDATE，再利用已验证检查收紧列。
8. 开启 operations INSERT-only 保护，撤销运行角色 UPDATE/DELETE；事件不可变保护保持。收紧权限先显式 REVOKE，不能只省略旧 GRANT。

## 事务及协议

领域命令仍可先写事件、最后写回执；所有延迟约束在提交前判定。失败整体回滚，幂等重放不新建事件或同步日志。协议版本在外层传输 envelope，不进入历史指纹；回执展开/脱敏不改写数据库原始 result。

同一操作对同一对象通常只递增一次 revision；复合编辑用 change_kinds 表达实际变化，不能通过多次 revision 增长制造虚假并发。新事件 changes ≤1 MiB，回执 ≤4 MiB；只拒绝超限新写入，不截断旧记录。

## 测试接口

`OP01–OP07` 见 `tests/batch0/cases.json`。用独立 PostgreSQL 18 数据库执行；断言必须发生在 COMMIT，不能把 INSERT 成功当作 FK 验收。回填前后对历史 result/fingerprint/timestamp 和全部 events 生成摘要比对；包含回填中旧客户端插入及中断重启。

当前仅有审计工具和测试骨架；这里的 DDL 次序不是可直接执行的 production migration。
