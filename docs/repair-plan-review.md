# 修复计划评审与实施指令

> 评审对象：Codex《松仓数据模型完整修复方案》  
> 评审基线：[数据模型诊断](data-model-diagnosis.md)、[44 条缺陷清单](data-model-findings.csv)、当前 `main` 工作树  
> 结论日期：2026-10-31  
> 说明：本文只写“与计划不同、或计划未说清”的部分，不重复计划已经正确的设计。

## 0. 总体判断

方向正确，可以按这个方案实施；但**不建议现在就让 Codex 从 Batch 0 直接写到 Batch 8**。有 5 个技术问题会直接导致返工，5 个产品/协议决策没有拍板，Codex 会自行假设；另外“8 批开发、停写窗口一次切换”的流程需要改成 expand/contract，否则停写窗口会承担不必要的重迁移风险。

一句话：**先修 5 个硬问题，先拍 5 个决策，再按批次开工。**

## 1. 必须先修正的 5 个硬问题

### 1.1 操作 ID 外键不能建立在表达式索引上

计划写的是“从 `operations.result.operation_id` 建立受约束的操作标识……事件与操作建立延迟外键”。

**问题：** PostgreSQL 的外键只能引用真实列上的 `PRIMARY KEY` 或 `UNIQUE` 约束，不能引用表达式索引。现在 `operations` 没有 `operation_id` 列，`result->>'operation_id'` 上的唯一索引不能作为 `events.operation_id` 的外键目标。

**必须改成：**

```sql
ALTER TABLE operations ADD COLUMN operation_id text;
UPDATE operations SET operation_id = result->>'operation_id';
-- 先检查 NULL 和重复，再加约束
ALTER TABLE operations ALTER COLUMN operation_id SET NOT NULL;
ALTER TABLE operations
  ADD CONSTRAINT operations_operation_id_unique UNIQUE (household_id, operation_id);
ALTER TABLE events
  ADD CONSTRAINT events_operation_fk
  FOREIGN KEY (household_id, operation_id)
  REFERENCES operations (household_id, operation_id)
  DEFERRABLE INITIALLY DEFERRED;
```

**验收：** 事务内先写事件、后写操作回执可以提交；提交后删除操作记录失败；同一家庭重复 `operation_id` 插入失败；跨家庭引用失败。

### 1.2 递归 CTE 触发器不足以保证并发不成环

计划写的是“数据库约束覆盖……两棵树无环”“直接 SQL 和两个并发事务均不能制造环”。

**问题：** 触发器里的递归 CTE 只能看到已提交和本事务的数据，看不到另一个未提交事务刚插入的边。两个事务各自把 A 挂到 B、B 挂到 A，可以都通过检查后提交，形成环。这是典型的 write skew，不是加一个 `CHECK` 能解决的。

**必须二选一：**

- **推荐：** 树写入触发器（`items` / `catalog_nodes` 的 INSERT/UPDATE）第一句执行 `pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0))`，与现有应用层家庭锁使用同一个 key。应用已持有锁时是可重入的；直接 SQL 会被串行化。然后再做父类型、容器能力、递归 CTE 检查。
- 或者使用 `SERIALIZABLE` 隔离级别并实现序列化失败重试。成本更高，且会改变现有事务语义。

**验收：** 开两个 psql 会话，并发执行互相挂父节点的两条 UPDATE，必须一条成功、一条 `CYCLE_DETECTED` 或等待后失败；不能两条都提交。测试要作为 CI 集成测试保留。

### 1.3 增量同步缺少可执行的状态机

计划写的是“事务内递增的家庭变更序号”“分页完成后补齐期间的变更”“变量日志保留 30 天”。方向对，但以下四件事没有定义，Codex 会各写一套：

1. **变更日志的主键与游标。** 建议用全局 `change_id bigserial`，每行一个变化对象：`(change_id, household_id, object_kind, object_id, revision, change_kind, created_at)`。游标就是 `change_id`，不要用 `(seq, object_id)` 这种复合游标，分页和重试都更简单。
2. **一次操作多个对象。** 一次批量入库 100 件产生 100 行，`change_id` 各自递增；同一 `operation_id` 可用于分组，不要要求同一序号。
3. **初始同步的追赶循环。** 起始水位 `start = max(change_id)`；先分页拉全量对象；再拉 `change_id > start` 的变更；应用后继续拉，直到没有新变更；设最大轮次（例如 20 轮），超过则重新初始化。每页与游标必须在本地同一个 IndexedDB/Room 事务提交。
4. **墓碑与保留。** 作废（void）必须写一条墓碑；保留 30 天后，比 `min(change_id)` 更旧的游标返回 `SYNC_RESET_REQUIRED`，客户端清空缓存、换新代次全量同步。恢复数据库后必须更换 `sync_generation`，否则旧游标会指向错误历史。

**验收：** 在初始分页过程中并发改一个已翻页对象、作废一个未翻页对象、改一个已翻页对象的排序键；最终本地缓存与服务器全量快照逐对象一致；断线重试不重复应用；30 天过期游标触发全量重置。

### 1.4 分页游标的“一致性语义”没有定义

计划写的是“库存分页期间发生影响排序的变更时明确要求刷新”。

**问题：** 没有说怎么检测“影响排序”。如果任何家庭变更都让游标失效，10,000 件物品的列表几乎无法翻页；如果完全不检测，用户可能漏掉新插入或排序变化的对象。

**建议定义两种模式，不要混在一起：**

- **浏览（browse）：** 键集分页 `(created_at DESC, id DESC)`，游标携带 `query_hash`、排序、协议版本、`as_of_change_id`。翻页期间有新变更时照常返回，同时返回 `stale=true` 和当前 `change_id`；UI 提示“列表已变化，刷新查看最新”，**不强制刷新**。接受“新插入的对象可能不在本次翻页中”的产品语义。
- **导出/对账（export）：** 要求稳定快照。用 `REPEATABLE READ` 事务或服务端临时结果集，或者要求“导出前停写”；不一致时返回 `CURSOR_STALE` 并拒绝继续。

统计数字必须绑定 `as_of_change_id`，并明确标注“截至某变更序号”；不要用当前页数据重新计算总数。

**验收：** 翻页中途插入、更新排序键、作废对象三种场景都有测试；浏览模式不阻塞，导出模式明确拒绝并说明原因。

### 1.5 标签时间投影的输入、扇出和回填口径

计划写的是“Android 的 `label_updated_at` 改为可重建的读模型；迁移时根据旧历史计算一次，之后只在实际标签内容改变时更新”。

**现状：** 标签内容实际是四元组：`[display_name 或 SKU 名称, SKU 规格, 到期日, 日期类型标题]`，定义在 [terminal-label-history.ts:16–24](apps/server/src/terminal-label-history.ts#L16-L24)。它**不包含位置路径**，所以位置改名/移动不会影响标签，这一点计划不用处理；但下面三点必须写清：

1. **输入集合：** `items.display_name`、`items.catalog_node_id`、`items.lifecycle.expiry.date`、`items.lifecycle.expiry.date_kind`、`catalog_nodes.name`、`catalog_nodes.product.specification`。
2. **扇出规则：**
   - SKU 名称变化 → 只影响该 SKU 下 `display_name IS NULL` 的物品（有自定义名称的物品标签不显示 SKU 名）。
   - SKU 规格变化 → 影响该 SKU 下**所有**物品（规格总是显示）。
   - 单件字段变化 → 只影响该物品。
   - `date_kind` 只有在存在 `expiry.date` 时才影响标题；没有日期时不应刷新标签时间。
3. **回填口径：** 迁移时必须用旧算法作为 oracle，对生产副本做逐物品比对；新投影结果与旧算法完全一致才算通过。时间戳沿用旧算法的 `recorded_at`，初始值用 `created_at`；“隐藏的 SKU 名”“同值改挂 SKU”“无日期的日期类型”都不能算作标签变化。

**验收：** 生产副本全量比对零差异；SKU 改名 500 件物品的扇出在同一事务完成；标签最近 7 天列表与旧版一致。

## 2. 必须先拍板的 5 个决策

| # | 决策 | 选项 | 建议 | 不定的后果 |
| --- | --- | --- | --- | --- |
| 1 | 切换后旧客户端怎么办 | 全部硬失败 / 旧版只读 / 旧版继续读写 | **全部业务端点要求 v2，旧客户端返回 `PROTOCOL_VERSION_UNSUPPORTED` 并提示升级；离线缓存仍可看。** Web 由服务端直接更新；Android 需要明确更新路径；插件宿主缓存旧 bundle 要能检测版本。 | Codex 会自行选择，三端行为不一致；旧 Android 可能写入半新半旧数据 |
| 2 | 浏览分页的一致性 | 强制刷新 / 允许漏新对象 / 稳定快照 | **浏览允许 `stale=true`，导出才要求稳定快照**（见 1.4） | 要么列表不可用，要么导出数据不可信 |
| 3 | 离线能力 | 只读缓存 / 离线排队写入 | **首版只读**。Android 的“待确认操作”只保留展示和重试入口，不在离线时创建新写操作。 | 离线写入会引入冲突合并、幂等、时钟和顺序问题，远超本轮范围 |
| 4 | 作废与拆分范围 | 只作废 Item / 也作废 SKU / 引入 SPLIT 终态 | **Item 先做；SKU 增加 `void_catalog_node`（无 Item、无子节点、无条码/身份引用才允许）；拆分不新增 lifecycle 状态，用 `item_splits` 关系 + 源包 `CONSUMED` + 内容归零。** 如果坚持 `SPLIT` 终态，必须明确它属于 lifecycle v2 并写升级路径。 | 误建 SKU 无法清理；`SPLIT` 与 lifecycle v1/v2 冲突，统计和客户端分叉 |
| 5 | 无身份信息的 SKU 如何匹配 | 名称自动复用 / 名称只做候选 / 禁止创建 | **名称只做候选，绝不自动复用。** 无品牌/型号/条码/别名时，必须新建 SKU 或由用户明确选择；给一次性物品加 `one_off` 或 `visibility=HIDDEN`，避免目录膨胀。 | 不同物品被合并（AA/AAA 电池、USB-C/Lightning 线），或目录爆炸 |

另外几个需要确认、但可以先按建议执行的：

- **处置存储：** `dispose_item` 写 `disposition` 模板（`kind/date/recipient/note`）并把 `lifecycle.state` 置为 `DISPOSED`，不新增 lifecycle v2，也不要把原因塞进 Note。接收方用 REFERENCE 或明确的 `recipient_name`，不伪造 Actor。
- **单位存储：** 现有 `mL/g/count/percent` 字段保持原单位，不迁移；新量纲字段按“字段声明规范单位、写入归一化、事件保留原始输入”存储，响应可带 `display_unit`。不要静默把历史值改成 g/mL。
- **标签/AOD 日期：** 标签只打印食品保质期，不替换；AOD 可显示“最近一个可执行日期”（食品到期、保修、应还、维护），并标注类型。需要产品确认 D101 30×12mm 的版式是否放得下类型文字。

## 3. 需要补充的规格（开工前写成一页，避免 Codex 自由发挥）

1. **查询规格：** 允许的搜索字段、规范化（NFKC/大小写/空白）、中文 1–2 元候选索引的生成方式、排序字段与空值规则、游标字段与错误码、统计的 `as_of_change_id`。
2. **同步规格：** `change_id` 表结构、写入时机、墓碑、初始追赶循环、保留与重置、本地事务边界。
3. **模板 registry 规格：** `(id, version)` 的 schema hash、退役状态、UI 元数据与校验定义的分离、`list_attribute_templates` 的过滤参数与响应。
4. **能力/profile 规格：** profile 枚举、能力词表（建议直接用模板 ID）、profile 默认能力、SKU 显式覆盖的优先级、未知 profile 的行为。
5. **deadline 规格：** 条目 ID 格式、`due_on`/`recurrence_days`/`last_completed_on`、完成后如何推进、时区与日期运算、统一日期视图的字段、AOD/标签显示规则。
6. **处置/作废/拆分规格：** 存储位置（核心列还是模板）、允许的前置条件、统计口径、同步墓碑、恢复命令。
7. **单位与库存规格：** 量纲表、规范单位、换算精度、字段允许量纲、金额币种、事件原始输入、UI 显示单位；`stock` 必须声明 `basis=COUNT|CONTENT`、阈值单位和未知值口径。
8. **附件规格：** BlobStore 接口、票据 TTL/一次性、类型嗅探、EXIF 剥离、PDF 下载策略、配额、缩略图库、备份/GC 协调。
9. **脱敏矩阵：** 字段级 `sensitivity` 声明、读路径清单（列表/详情/历史/回执/检查器/导出/同步/错误/日志）、展开原文的审计。
10. **迁移/回滚 runbook：** expand/contract 步骤、非事务迁移、失败恢复、旧应用阻断、备份/恢复演练。

## 4. 批次与上线流程调整

### 4.1 用 expand/contract，不要把重迁移放进停写窗口

计划是“8 批开发、一次停写窗口完成迁移和三端升级”。这样停写窗口要同时做加表、回填、建索引、切换读写和三端升级，风险过高，窗口也不好估。

建议拆成三段：

1. **Online expand（可提前做）：** 加表、加列、`CREATE INDEX CONCURRENTLY`、分批回填投影、双读校验。除短暂锁外不影响写入。
2. **Stop-write switch（短窗口）：** 只做最终校验、翻转读写开关、更新协议最低版本、切换三端。不做大规模 DDL 和回填。
3. **Post-switch cleanup（观察后）：** 删除旧列/旧索引、收紧权限、下线旧端点。删除类操作单独批次，可回退。

### 4.2 变更日志早于同步功能

如果 Batch 3 才加 `change_id`，Batch 2、4、5、6、7 的所有写入路径以后都要回头补“发变更”的代码，容易漏（尤其是笔记、附件、作废、拆分、profile 修改）。建议在 **Batch 1** 就把 `sync_changes` 表和写入钩子建好，哪怕客户端还不用；初始同步再从全量基线开始。

### 4.3 协议 v2 的冻结点

计划把 registry（Batch 4）、日期（Batch 5）、附件（Batch 7）都放在同步（Batch 3）之后。同步 v2 的 envelope 如果先冻结，后面加 `deadline`、附件元数据、`profile` 就会反复改协议。

建议：**Batch 3 先定 envelope 骨架，但标记为 `v2-draft`；Batch 5 结束时冻结 v2；附件元数据在 v2 内预留字段**，或者把同步协议单独版本化为 `sync_v1`，与业务协议解耦。

### 4.4 每批必须可独立部署

“统一切换”是用户可见的切换，不是“8 批都堆在一个分支”。每批要求：

- 迁移只增不改；
- 新代码在 feature flag 后；
- 旧读路径仍可用；
- 有独立回滚开关；
- 合入 main 后可以部署但不启用；
- 只有最终 switch 才翻转默认值。

否则 8 批会变成一个巨大的长分支，评审和回归都会失控。

### 4.5 Batch 0 要包含“生产副本审计”，不只是文档

计划 Batch 0 是“修正诊断事实、补齐清单验收项、建立基准与迁移摘要登记”。建议再加：

- 从生产备份恢复一份副本，跑数据审计 SQL：重复 `operation_id`、孤儿事件、循环父子、Item 引用 GROUP、非容器父、无效绑定、非法时区、同级同名 SKU、条码冲突。
- 输出对象级问题清单，明确“修复/保留/人工确认”，不要自动改名、合并、删除。
- 用这份清单决定 Batch 8 的约束是否能直接加；不能直接加的，先治理再约束。

## 5. 验收门禁

计划里的验收目标很好，但需要明确“什么算证据”。建议每个批次都过下面这张门禁表：

| 门禁 | 证据 | 阻断条件 |
| --- | --- | --- |
| 数据审计 | 生产副本审计报告 + 对象级清单 | 有未解释的孤儿/循环/重复 |
| 性能 | 10k 物品/100k 事件/10k 笔记数据集生成器 + p95 + SQL 数 + `EXPLAIN` | 超目标 20% 且无解释 |
| 索引/投影写入影响 | 与基线对比的插入/更新吞吐 | 下降 > 10% 且无优化 |
| 并发 | 两会话造环、两写者移动、并发作废/拆分、并发确认附件 | 任一可制造非法状态 |
| 同步 | 初始分页中改/删/排序变化、断线重试、游标过期 | 本地与全量快照不一致 |
| 脱敏 | 列表/详情/历史/回执/检查器/导出/同步/错误/日志逐路径测试 | 任一路径出现明文 |
| 迁移 | 生产副本演练、失败注入、非事务索引失败恢复 | 迁移失败后旧应用可启动 |
| 恢复 | DB + 附件全量恢复、字节摘要、关联完整性、同步代次重置 | 任一摘要或关联不一致 |
| 三端黄金样本 | Web/插件/Android 同一查询同一 ID 集合、同一日期/汇总 | 任一不一致 |
| 44 条证据 | 每条 ID 对应测试/PR/迁移/手工证据 | 只有“已实现”没有证据 |

性能测试还要写清方法：环境与生产同规格、warm/cold 分别记录、SQL 数包含哪些语句、p95 的样本量、数据集是否提交到仓库。不要用“本地跑了一下很快”作为证据。

## 6. 给 Codex 的直接指令（可复制）

1. 先不要写业务功能。先把 1.1 的 `operation_id` 列/唯一约束/延迟外键、1.2 的触发器家庭锁、1.3 的同步状态机、1.4 的游标语义、1.5 的标签投影口径写成设计文档和测试骨架，评审通过再开工。
2. 在 Batch 1 建立 `sync_changes`（`change_id bigserial`）和所有写路径的变更钩子；同步客户端可以后做，日志不能后补。
3. 迁移器先支持 `checksum`、`transactional` 标志和失败状态；没有这个，不要写 `CREATE INDEX CONCURRENTLY` 和大回填。迁移使用独立连接池，不能继承业务的 15s `statement_timeout`；非事务索引失败后要先清理 invalid index 再重试。历史迁移没有可靠摘要的，标记 `UNVERIFIED` 并要求人工签署，不要用当前文件哈希冒充历史执行证据。
4. 重迁移走 online expand；停写窗口只做最终校验和开关翻转。
5. 模板 registry 以 `(id, version)` 为单位保留 schema hash；CI 阻止修改已发布版本的 schema；UI 元数据单独 hash，不参与“篡改”判定。
6. 未知/退役模板的读取必须保留原始绑定；移动/改名/加笔记不能改写未知绑定；写未知模板必须明确拒绝。为这条写专门的字节级保留测试。
7. 删除所有 `1 | 2`、七模板枚举、`max(7)` 的业务限制；绑定资源上限设为 16，并由 registry 生成协议枚举。
8. `profile` 和能力用核心列（`catalog_nodes.profile`、`catalog_nodes.capabilities`），不要再用模板承载行为选择；profile 默认能力在 registry，SKU 显式能力覆盖默认；未知 profile 不猜。不要同时保留 `applies_to_profiles` 和 capabilities 两套适用性来源，只能有一套。
9. `deadline` 是日期唯一来源：`custody` 不放 `due_on`，`service` 不放 `next_service_on`，`asset` 不放 `warranty_until`；完成维护时同一事务更新 `service.last_service_on` 并推进 `deadline`。日期条目必须用稳定 ID，不能用数组下标修改；周期推进的基准（到期日还是完成日）写进契约。
10. `void_item` 用独立记录状态，不改 lifecycle；`void_catalog_node` 只在无 Item/子节点/条码/身份引用时允许；拆分先不新增 lifecycle 状态，用 `item_splits` + 源包 `CONSUMED`，如果坚持 `SPLIT` 就写 lifecycle v2 升级路径。拆包守恒按 count 或同一量纲分别校验，不能把包装件数和内容体积混算；只复制明确列出的共用事实。
11. 无身份 SKU 不允许按名称自动复用；必须返回候选并要求确认；一次性 SKU 用 `one_off` 或 `hidden` 控制目录膨胀。
12. 附件上传必须剥离 EXIF、做类型嗅探、禁止 SVG/HTML、PDF 强制下载、设置 `nosniff`；加家庭配额和磁盘监控；缩略图库必须在 Node 24 容器里验证。
13. 脱敏做成一个 `redactFor(scope, value)` 中心函数，覆盖列表/详情/历史/回执/检查器/导出/同步/错误/日志；Zod 错误详情也要脱敏；展开原文要写审计事件。
14. 协议 v2 的最低版本、错误码、旧客户端行为、插件缓存检测、Android 更新路径写成一张兼容矩阵；不要只在代码里判断。客户端在 `get_connection_context` 和每次写请求携带 `protocol_version`（HTTP 可用请求头），服务端返回 current/min/supported 和 `PROTOCOL_VERSION_UNSUPPORTED`。
15. 44 条问题逐条建立证据表；D16、S13 这类产品决策写明“决定是什么、为什么、验收怎么核对”，不要标成“已修复”。

## 7. 不建议做的事

- 不要重写已执行的 migration、旧事件、旧操作回执、已发布模板定义。
- 不要自动合并重复 SKU；冲突交目录治理提案。
- 不要从旧 `availability` 的 `LOANED` 编造借用人，也不要从 `AVAILABLE` 补齐归属/清洁等肯定事实。
- 不要用数组下标修改 `deadline` 条目；必须用稳定条目 ID。
- 不要把 UI 标签元数据混进模板校验定义的 hash。
- 不要让附件走公开 URL、查询参数或日志；不要让 PDF/HTML 内联执行。
- 不要在停写窗口做大回填/大索引；不要把 8 批堆在一个长分支里。
- 不要在没有“触发器家庭锁”的情况下声称并发不成环。
- 不要把同机备份当成灾难恢复：至少异盘/异地一份，并明确敏感数据的加密与密钥保管。
- 不要把“已实现”当作验收证据；每条缺陷要有可复核的测试或演练记录。

## 8. 一页结论

计划可以执行，但请先让 Codex 交五份东西：**操作 ID/事件外键与触发器锁的设计、同步状态机、游标一致性语义、标签投影口径、模板/能力/deadline/处置的存储契约**。这五份确认后再开工，能省掉后面至少两轮返工。

流程上记住三句话：**重迁移在线上做，停写窗口只翻转；变更日志早建，协议冻结晚一点；每批可独立部署，最终才统一切换。**

## 9. Batch 0 复核补充（2026-10-31）

Batch 0 的五份契约、存储约定和证据质量足够支撑开工；76 项验收仍为 `NOT_RUN`、7 项历史 checksum 未核验、性能基准未执行，这些是门禁事实，不是文档问题。

开工前建议先补三个设计缺口：

1. **profile 默认能力与“食品显示保质期”冲突。** `06-storage-contracts.md` 写 `CONSUMABLE=opening/contents/stock`，并规定 `expiry` 必须显式声明。这样食品默认不会出现保质期，和最初目标相反。建议 `CONSUMABLE` 默认包含 `lifecycle.expiry`，纸巾等非食品用显式能力关闭；`DURABLE` 默认加 `deadline`（保修/维护），`WEARABLE` 加 `wardrobe`（归属/季节）。仍不从名称或分类猜，但用户选 profile 就是显式选择。
2. **日期视图没有落表。** 06 说 `last_completed_on` 是完成事件的读投影，日期视图有 `item_id/entry/kind/due_on/...`，但没有定义投影表。Batch 5 要支持 10k 物品的日期筛选，需要 `date_facts`（或等价物）随写入维护、可重建，并建 `(household_id, due_on)` 索引。
3. **同步日志 payload 形态未定。** 03 的 `sync_changes` 有 `after_image?`，但没定客户端是直接读 after_image 还是按 ID 批量取。建议只存 `(change_id, kind, id, revision, change_kind)`，客户端批量取当前投影；否则日志膨胀且 after_image 可能与主表不一致。`record_state`、`one_off`、`label_hash` 的列定义也要补进 06。

如果坚持“一次完成”，建议定义为：**一个集成分支、4 个内部 checkpoint、最终一次 switch**。

| Checkpoint | 批次 | 验收数 | 门禁 |
| --- | --- | --- | --- |
| A 基础设施与读路径 | Batch 1 + 2 | 24 | OP/TREE/QUERY + checksum + 当前性能基线 |
| B 同步与语义核心 | Batch 3 + 4 + 5 | 25 | SYNC/LABEL/MODEL01–03/13 + v2 冻结 |
| C 全屋语义与附件 | Batch 6 + 7 | 21 | MODEL04–15/FILE + 脱敏全路径 |
| D 加固与切换 | Batch 8 | 6 | OP08/OPS05–09 + 恢复演练 + 44 条证据 |

不要把 Batch 1 与 Batch 3 合并成一次评审；Batch 3 的 21 项同步/标签用例是最容易“看起来通过、实际漏写路径”的部分，必须有独立门禁。

上述 3 个缺口已在 Batch 0 契约补丁中修正：`CONSUMABLE` 默认包含 `lifecycle.expiry`，`date_facts` 与 `label_hash` 投影已写入存储契约，`sync_changes.after_image` 明确为 Batch 1 不使用、客户端按 ID 取当前投影。
