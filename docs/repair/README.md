# 数据模型修复 · Batch 0 评审入口

状态：`MERGED_WITH_GATES`。Batch 0–8 的后端实现、迁移和测试已完成，并与前端重构一起合入 `codex/data-model-v2`（合并 `b6ab798`，契约对齐 `f3fe4ba`）；仍有附件缩略图/字节、历史 checksum、客户端切换和异机恢复门禁，详见 [后端完成报告](./backend-complete.md)。

后端全部批次的结果、测试证据和门禁见 [后端完成报告](./backend-complete.md)，Batch 1/2 的细节见 [Batch 1 + Batch 2 集成验收](./batch1/integration.md)。前端设计与重构的冻结基线见 [前端接口冻结 v2](./frozen-interfaces.md)；标 `F`/`PARTIAL` 的接口仍需按 `features` 灰化。

## 五份技术契约

1. [操作标识与事件完整性](01-operation-integrity.md)
2. [两棵树的并发写入](02-tree-concurrency.md)
3. [同步日志与状态机](03-sync-state-machine.md)
4. [查询、游标与冻结导出](04-query-cursors.md)
5. [标签投影与冻结 oracle](05-label-projection.md)

另见 [存储和公共接口契约](06-storage-contracts.md)、[发布及恢复 runbook](07-rollout-runbook.md)、[审计与验收证据](08-evidence.md)。评审来源为 [repair-plan-review](../repair-plan-review.md)，追踪清单为 [44 条发现](../data-model-findings.csv)。

## 已确定的边界

- 最终切换全部业务端点要求 v2；旧客户端硬失败并提示升级，离线缓存和待确认操作保留。
- 浏览允许 stale；导出冻结结果。基础库存完整离线缓存只读，不增加离线写队列。
- 食品 expiry 保留原位；新增到期事实只存 deadline。处置使用 disposition + DISPOSED；拆分使用 item_splits + CONSUMED，不新增 lifecycle v2 或 SPLIT。
- 保留具体 SKU；名称只做候选，one_off 显式声明。保留已存在的“无身份时不按同名自动复用”保护。
- 模板由代码 registry 管理；未知绑定原样保留；绑定资源上限 16。
- 敏感信息仅做脱敏和默认导出排除，不增加成员字段 ACL。附件私有存储；加密异机备份使用 NAS/SFTP。
- 重迁移在线 expand；每批独立部署且默认不开启新语义；v2 envelope 在 Batch 5 后冻结。

## 批次和门禁

| 批次 | 内容 | 覆盖 |
|---|---|---|
| 0 | 五份契约、存储约定、测试骨架、本地合成数据审计、证据表；生产副本审计按用户要求延期，等待设计评审 | D23/D28 前置，S10 |
| 1 | 迁移器、操作真实列/FK、家庭锁、sync_changes 和完整写钩子、权限及不可变保护 | D20/D21/D23、S03/S06/S14/S15 |
| 2 | SQL 查询/聚合/历史/索引、条码差量维护 | D01/D02/D04、S04/S05/S07/S08 |
| 3 | 共享读模型、同步、标签投影、缓存暂存区；v2-draft | D03/D27 |
| 4 | registry、未知模板、profile/能力、UI 元数据 | D05/D06/D07/D24/D25 |
| 5 | deadline、时区、日期索引及 AOD；冻结 v2 envelope | D08、S01 |
| 6 | 引用/状态/处置/作废/拆分/单位/补货/资产/SKU | D10–D16/D18、S11/S12/S13 |
| 7 | 笔记/附件/脱敏/导出/加密异机备份 | D09/D17/D19、S02/S16 |
| 8 | 约束验证、事件/错误、检查器、三端切换/恢复演练 | D22/D26/D28、S09 |

进入 Batch 1 必须有明确的设计评审通过记录。按用户最新要求，本轮充分进行本地测试，不连接生产 SSH、不上线；生产副本审计记为 `DEFERRED_BY_USER`，不阻断本轮本地交付。未来生产扩展和约束收紧前，仍须取得可信生产副本、完成审计及问题处置。TODO 测试、合成数据结果、工具自身测试均不能替代生产审计或实际修复验收。
