# 03 · 同步日志与状态机

## 日志与事务

Batch 1 建立 sync_changes：`change_id bigserial PK, household_id, object_kind, object_id, revision, change_kind, operation_id?, payload_version, after_image jsonb NULL, created_at`。Batch 1 只存引用，`after_image` 不使用；客户端按对象 ID 批量取当前投影。索引 `(household_id, change_id)`。change_kind 仅 UPSERT/TOMBSTONE；墓碑保留身份和顺序，不保留业务正文。operation_id 对有领域回执的变更必填；初始化/维护来源必须显式登记，不能伪造用户操作。

数据库钩子收集事务内 dirty 对象（键为事务、家庭、对象种类及 ID），延迟 flush 写最终像；同一事务修改同一对象多次只发最终记录。flush 后删除本事务 dirty 项，后续延迟回调为空操作。角色不能自行修改 dirty 集合、日志或水位。所有写入在分配 change_id 前持有家庭锁；单个家庭的新序号不得越过同家庭仍未提交的事务。

源数据、事件、回执、派生投影、日志和水位同事务提交。无变化、回滚、幂等重放均不得发布新变化。同步日志存内部形状而非 UI DTO，附件只存元数据。

每家庭状态包括 `sync_generation UUID, last_committed_change_id bigint, pruned_through_change_id bigint`。接口将 bigint 编码成十进制字符串；TS 使用 BigInt，Android 使用 Long，禁止 JS Number 转换。不同家庭的 ID 可以交错或有空洞；禁止使用全局 max/change sequence.last_value 推进本家庭水位。

## 初始化与追赶

1. 验证家庭/账号/协议，获取家庭代次 G 和起始水位 S，建立客户端暂存代次。
2. 按 `(object_kind, object_id)` 稳定键集拉取基础集合。新插入到已翻页区间的对象会由日志补齐。每个基线记录带自身投影的 last_change_id；不能用该页水位代替对象版本。
3. 分页完成后捕获本家庭固定水位 H，读取 `S < change_id <= H`。从旧到新应用；按对象 last_change_id 拒绝降级，不按 core revision 拒绝投影更新。
4. 每页和暂存游标在同一 IndexedDB/Room 事务提交。达到 H 后重新读取水位，有后续变化则进入下一轮。一个轮次的页数不计为追赶轮数。
5. 空追赶确认的水位是完整性边界；原子发布暂存区并显示该时刻。之后持续增量也先暂存完整轮次，再发布，不能展示半次批量操作。
6. 最多 20 个非空追赶轮次；超出返回 SYNC_RESET_REQUIRED，重建暂存代次并以 1/2/4…60 秒封顶退避。旧完整缓存只可标为陈旧展示，不能冒充新结果。授权失效则清除对应私有缓存。

作废对象和归档笔记退出集合写墓碑；恢复写 UPSERT。SKU/父位置变更同时使依赖的展示/搜索/标签投影失效并重建，core revision 可以不变。模板/时区变化也要有可追踪的刷新依据。

## 清理、重置与恢复

保留期 30 天。清理按家庭删除完整的连续日志前缀，不能只按零散旧时间行删除；同事务更新 pruned_through。`cursor < pruned_through` 失效，`cursor == pruned_through` 仍有效。代次不同、未来游标、协议不兼容均明确拒绝，返回重置原因。游标不能因全局序列空洞或家庭当前最小日志 ID 更大而误失效。

恢复数据库必须更换 G。未捕获写入的旧应用不能作为普通回滚版本；确有日志缺口时先使同步代次失效，不能补一个较大水位掩盖。

## 写路径覆盖清单

创建/编辑/移动/消耗/纠正/模板升级/批量入库、目录治理、条码身份变化、笔记、profile、时区、借还/维护、处置/作废/拆分、附件确认/解除关联、投影扇出、维护回填。认证表和原文展开审计不作为库存变更；上传暂存字节也不是库存变化。

新增写表或入口的 PR 必须登记对象类型、钩子、扇出和一条日志断言。Batch 3 仅定义 v2-draft，Batch 5 后冻结；预留 record_state、profile/capabilities、one_off、deadline 和附件元数据。旧 v1 读取在最终切换前不能收到它不能解析的新绑定。
