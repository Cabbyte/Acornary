# Batch 0 · 审计与验收证据

本轮仅验证设计机制、审计工具和冻结标签基线。业务实现、迁移器、客户端同步、附件和生产发布均未修改。根据用户“先在本地充分测试，不需要现在 SSH 服务器和上线”的补充要求，生产副本审计为 `DEFERRED_BY_USER`，不以合成数据替代。

## 可复现入口

在仓库根目录执行：

```sh
node scripts/batch0/local-check.mjs
```

默认使用现有 Dockerfile 的 dependencies target 构建 Node 24 测试镜像；也可用 `BATCH0_NODE_IMAGE` 指定本地已有依赖镜像。脚本核对 lockfile，并替换镜像内所有参与验证的源码，避免测到旧代码。PostgreSQL 默认 `postgres:18-bookworm`，可由 `BATCH0_POSTGRES_IMAGE` 覆盖，运行时仍校验 18 主版本。

PostgreSQL 容器使用 `--network none`，无宿主端口；Node 容器只共享其网络命名空间。trust 认证只在这个临时隔离环境内使用。创建独立 `acornary_audit_*` 数据库，结束时移除本次容器及匿名卷，不连接现有数据库、不调用 SSH。

依次执行：TypeScript 检查 → 工具/标签基线测试 → 构建当前 Web/插件 UI 并在另一临时库运行完整测试套件 → 在空库执行现有迁移并灌入合成样本 → PostgreSQL 真实连接参考测试 → 小规模只读审计 → 完整规模生成和灌库 → 完整只读审计 → pg_dump/pg_restore 到另一个空库 → 恢复审计及摘要比对。不是生产修复迁移或线上压力测试。

输出位于被 Git 忽略的 `output/repair-batch0/<时间-随机ID>/`，含逐步骤日志、`run.json`、当前源文件 SHA-256 清单、数据分布清单、审计报告及恢复比对。输出目录权限 0700、审计文件 0600；审计报告仅含对象标识和检查类别，不输出名称、笔记正文、属性值或回执正文。

需要单独复核时：

```sh
pnpm exec vitest run tests/repair-batch0.test.ts tests/terminal-label-history.test.ts

# 只允许本地 acornary_audit_* 数据库，不使用 DATABASE_URL 默认值。
BATCH0_TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/acornary_audit_fixture \
  pnpm exec tsx scripts/batch0/seed.ts small
BATCH0_TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/acornary_audit_fixture \
  pnpm exec vitest run --config tests/batch0/vitest.config.ts
BATCH0_AUDIT_DATABASE_URL=postgres://USER@127.0.0.1:5432/acornary_audit_fixture \
  pnpm exec tsx scripts/batch0/audit.ts --source synthetic_fixture --output output/repair-audit-new
```

seed 拒绝已有 public 表的库；审计会话默认只读并在单个 REPEATABLE READ READ ONLY 事务内取数。已有副本使用 `--source restored_copy`，这只是输入分类，不能证明其生产来源。每次使用新的输出目录，拒绝覆盖旧证据。

## 本地结果

最终运行：`2026-10-31T10-52-06.426Z-6003c322`，Node **24.22.2**、PostgreSQL **18.6**，Linux aarch64 Docker 环境。使用命令 `BATCH0_NODE_IMAGE=acornary-design-ci:latest node scripts/batch0/local-check.mjs`。源提交为 `216439a94485dd5428c6c21b7f9f84e1963e3a6d`；本轮新增文件尚未提交，实际被测文件摘要另见输出中的 source-manifest，不能只用 HEAD 标识本轮代码。

| 检查 | 结果 | 口径 |
|---|---|---|
| 服务端/工具与 Web 类型检查 | PASS | `pnpm run typecheck` |
| 当前源码构建 | PASS | `pnpm build`，含 Web/插件 UI |
| 完整仓库测试 | **157 passed / 76 todo / 0 failed**，20 个文件 | TODO 是后续修复验收，未执行 |
| PostgreSQL 参考机制 | **9 passed / 0 failed** | 三个真实连接；独立随机 schema，结束清理 |
| 工具/标签定向测试 | 21 passed / 76 todo | 已包含在完整仓库结果中，不重复累计 |
| 小规模/完整规模审计 | 各 **0 ERROR / 7 REVIEW** | REVIEW 均为历史 migration checksum 未验证 |
| 完整规模标签旧算法基线 | 10,000 个对象 | BASELINE_ONLY，新投影比较 NOT_RUN |
| 合成数据库 dump/restore | PASS | 恢复前后所审计业务投影与标签基线摘要均相同 |
| 本轮临时资源清理 | PASS | 两个容器及其匿名卷均已删除 |

最终成功运行前，完整套件曾因未构建插件 UI 而有 1 项失败（`Build the Acornary plugin UI before reading this resource`）；修复的是本地执行脚本的构建前置步骤，没有修改业务代码或原有断言。最后一次完整运行已全部通过。

可入库的脱敏结果、数据分布、待审查清单及原始证据文件摘要见 [local-2026-10-31.json](evidence/local-2026-10-31.json)。原始日志、审计与恢复结果保存在 [本地输出目录](../../output/repair-batch0/2026-10-31T10-52-06.426Z-6003c322/run.json)，不提交含测试会话日志和逐对象基线的大文件。

- 固定生成数据 SHA-256：`07163ccfdec5649cc7c10391cc746478ffedefe6c12f0897087f3fad63392970`。
- 本次数据库审计投影 SHA-256：`88e13d1a658f555e5f679bbf92e595ba79a18378af7f1131ca97f764cd442e57`（包含数据库默认时间，跨 seed 运行不要求相同，只要求同一次备份恢复一致）。
- 标签基线 SHA-256：`83c83828349abb94daf3a99eb120c5e4512920d5928e1c0ac0749ec654ede9ee`。

## 证据解释与剩余门禁

- `tests/batch0/reference.sql` 位于测试目录，不被生产迁移器发现。它验证真实 PostgreSQL 的延迟外键、RC + 家庭锁、回滚和序列分配机制，尚未覆盖生产写路径、权限角色、兼容桥、回填或同步 flush。
- 两连接并发测试由第三连接观察 `pg_locks` 中 B 的 advisory lock 等待，再让 A 提交/回滚；没有用顺序调用冒充并发。正式 Item/GROUP/引用全链路测试留在后续验收中。
- 标签 oracle 是独立冻结副本，provenance 文件保存源提交和两个 SHA-256。已验证现有算法的基线一致性、空名称和 500 件规格扇出；没有新投影，故 `new_projection_comparison=NOT_RUN`。本地恢复后的旧 oracle 相同不等于新投影已通过。
- 审计摘要覆盖所选业务投影，不含所有表和所有列。恢复比对不能替代附件 manifest、认证配置、完整数据库、restic 加密/独立密钥恢复演练。
- 迁移历史表没有 checksum；7 条 `MIGRATION_CHECKSUM_UNVERIFIED` 是待审查项。当前 migration 文件 hash 或合成 seed 执行成功不能证明历史部署执行过相同内容，也不证明 006 缺号的历史原因。
- 固定规模 10,000 件物品、100,000 事件、10,000 笔记已具备生成器和 seed；2 个家庭、20 个容器、10 层容器树、4 个 SKU，含中文短词。该分布特意包含大 SKU 扇出，不能视为生产分布样本。
- 性能配置在 `tests/batch0/benchmark.config.json`；冷启动、预热 p95、SQL 数和执行计划均为 `NOT_RUN`。审计运行耗时不作为业务 API 延迟。300/150/200 ms、业务 SQL ≤5、写入下降 ≤10% 的门槛不放宽。
- `tests/batch0/cases.json` 的 76 项是后续真实实现验收清单，全部 `NOT_RUN`，由 Vitest `todo` 明示，不计入通过数。44 条发现没有任何一条标为修复验收通过；D16/S13 等决定已记录，仍需未来代码与测试验证。

设计评审通过后才进入 Batch 1。本轮不请求服务器配置；生产副本来源、全量历史 oracle 比对、NAS/SFTP 目的地与独立恢复密钥留到对应生产门禁核验。
