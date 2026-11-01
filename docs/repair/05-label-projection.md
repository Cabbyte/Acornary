# 05 · 标签投影与冻结 oracle

oracle 为 `tests/batch0/label-oracle.ts`，从评审基线的 terminal-label-history.ts 冻结，生产源码原文件的 SHA-256 记录在相邻 provenance.json。oracle 只使用自己的最小属性读取器，不导入后续可能变化的生产投影函数。未来修改 oracle 必须单独审查，不能和新实现一起“修正预期”。

## 唯一内容口径

四元组为 `[display_name || SKU.name || '未命名物品', SKU.product.specification || '', expiry.date || null, 日期标题]`。不 trim 自定义名称；NULL/空串回退，空白串沿用历史行为。无日期时标题 null；ESTIMATED=计划吃完、USE_BY=保质期、BEST_BEFORE=最佳食用期，其余有日期时=到期日期。

输入只有 display_name、catalog_node_id、lifecycle.expiry.date/date_kind、SKU name/product.specification。位置、笔记、余量、开封、deadline 不参与。D101 不新增日期类型版式；AOD 可以独立展示带类型的通用日期。

## 更新与扇出

维护 `label_hash`、label_updated_at、projected_through_change_id。同事务比较变更前后有效四元组，只有不同才更新时间。SKU 名称变化只检查使用 SKU 名的物品；规格变化检查全部物品；单件字段变化只检查该件。同值换 SKU、无日期改类型、被遮蔽的名称变化均不刷新。

领域写入使用对应事件 recorded_at；不能使用 occurred_at、同步时间或普通 updated_at。初始为 created_at，历史时间不得使结果早于 created_at。500 件扇出在家庭锁内原子更新，并为改变的读投影发同步记录，即使单件 revision 没增加。

## Online 回填

先启用捕获钩子，再捕获家庭水位 H 和一致性源快照。旧算法按 recorded_at/id 逆序解释历史 SKU 关联及有效内容。新回填分批、带检查点；只写 projected_through 不比 H 更新的记录，避免覆盖新写入。然后追赶 H 后的日志，清零差异与积压后才允许切换。

生产副本全量比较必须输出 total/compared/mismatch/缺失 ID 数及算法摘要；逐对象结果只保存在 0600 私有输出。现有算法自测或 oracle 与自身比较不能算新投影验收。新投影尚不存在时明确 NOT_RUN。

测试覆盖 LABEL01–LABEL09，包括 500 件扇出、空名称、旧于创建的 recorded_at、历史同值 SKU 改挂、回填竞争及最近七天筛选等价性。
