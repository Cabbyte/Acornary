# 配套存储与公共接口契约

## registry / 能力 / 升级

代码 registry 是唯一校验源，数据库为不可变发布登记。schema hash 覆盖 id/version/target/合法路径/校验结构，UI hash 单独覆盖 label/section/order/widget/unit/help。旧登记原样保存；缺失登记可以补 seed，定义冲突不得 UPDATE 覆盖。CI 将发布 schema 与冻结清单比较。

写接口枚举从 registry 生成；读 DTO 的 template_id 是字符串、version 是正整数，允许未知/退役数据。版本和绑定数上限不再依赖内置模板数量；绑定最多 16。未知绑定的 values、version、时间和数组位置不变，用数据库 JSONB 规范化文本比较原样保留；不是承诺还原已被 JSONB 丢弃的原始空白/键顺序。退役不删除，写未知/退役值明确拒绝；已知值使用其绑定版本校验。升级是带 expected_revisions 和完整目标值的显式操作。

核心列 `catalog_nodes.profile`（text，CONSUMABLE/DURABLE/WEARABLE/SPACE/MISC 或 NULL）、`catalog_nodes.capabilities`（text[] NULL；NULL 继承默认，显式数组完整覆盖，[] 关闭可选能力）、`catalog_nodes.one_off`（boolean NOT NULL DEFAULT false）与 `catalog_nodes.record_state` / `items.record_state`（text NOT NULL DEFAULT 'VALID'，CHECK VALID/VOID）。通用 identity/lifecycle 状态等基础字段始终可用。唯一解析器 resolveCapabilities 同时控制 UI 和新绑定写入，不另保留 applies_to_profiles。

默认可选能力：CONSUMABLE=lifecycle.expiry/opening/contents/stock；DURABLE=asset/custody/service/deadline；WEARABLE=clothing/wardrobe/asset/custody/service；SPACE=container；MISC=asset/custody；未知=[]，可手动发现合法能力。expiry 不从名称或分类猜；CONSUMABLE 默认提供，纸巾等非食品用显式 capabilities 关闭；其他 profile 需显式声明。container 独立可选，实物冰箱/行李箱可同时表达商品和容纳能力。变更能力不删除已知事实，不隐式创建绑定。能力词表在 registry 中映射到模板/字段组，允许 lifecycle.expiry 这样的细粒度键。

## 日期 / 状态 / 引用

deadline.entries 条目用 deadline_<UUID>，kind 为 WARRANTY_END/SERVICE_DUE/RETURN_BY/RENEWAL/REORDER_BY，due_on 为 YYYY-MM-DD，recurrence_days 可选且为正整数。按稳定 ID upsert/remove/complete，不能按数组位置 patch。完成日由用户明确提交，按家庭时区自然日加 recurrence_days；不按打开页面的日期或原到期日自动滚动。无周期的条目完成后退出待办集合，历史保留。last_completed_on 是完成事件的读投影。

食品 expiry 仍由 lifecycle 适配为 EXPIRY 日期视图；开封后期限依原家庭时区算法派生，不重复写 deadline。购入日在 acquisition；维护完成日是 service.last_service_on；完成维护和推进 deadline 原子提交。

日期视图落一张可重建投影 `date_facts`：`household_id, item_id, source_key, entry_id, kind, due_on, basis, completed_on, source_template, source_version, projected_through_change_id`；主键 `(household_id, item_id, source_key, entry_id)`；索引 `(household_id, due_on) WHERE completed_on IS NULL`。`source_key` 区分 lifecycle expiry / opening-derived / deadline / service；同一行同时满足 kind 与范围过滤。投影随写入事务维护，可按源事实重建；`last_completed_on` 是完成事件的读投影，不直接改写历史记录。

`items` 增加 `label_hash text`、`label_updated_at timestamptz`、`projected_through_change_id bigint`；三者是可重建读投影，不参与核心 revision。AOD 显示最近可执行日期并标类型，D101 保持旧食品日期版式。

usage/custody/service 独立，运输独立于使用/借出状态，位置始终为 parent_id。旧 availability 明确标成旧资料，不回填它与新模板双写；不能从 AVAILABLE 补肯定事实或从 LOANED 编造持有人。新综合可用性遇阻断事实为不可用，所需事实不足为未知。REFERENCE 支持 ACTOR/ITEM/CATALOG_NODE，同家庭、可反向查；外部人使用明确的 name 分支，不创建虚假 Actor。

## 处置 / 作废 / 拆分

dispose_item 写 disposition `{kind,date,recipient?,recipient_name?,note?}`，kind=SALE/GIFT/DONATION/RETURN/DISCARD；recipient 引用与 recipient_name 二选一，同时设置现有 DISPOSED。历史无原因的处置保持未知。普通属性更新不允许绕过终态命令；恢复须有原因。

items/catalog_nodes 增加独立 record_state=VALID/VOID，保留对象和历史。void_catalog_node 首版只允许 SKU，无任何 Item（含历史对象）、子节点、条码、身份键、别名、系统引用和其他有效业务引用；不自动解绑这些引用。默认读集合排除 VOID，明示审计读可查；作废/恢复发墓碑/upsert。普通 Item 恢复走带原因纠正，作废有有效后代的容器/拆分来源被拒绝。

split_item 首版整包拆成同一种明确 SKU，1–100 个独立 Item；item_splits 保存 source/child/operation/数量及守恒依据。源有明确正数内容量、非终态、无子物品；输出与输入 count 或同一量纲等量，禁止把包装件数与 mL 混算。源包 CONSUMED、内容归零、全部子件与关系一次提交。只复制请求列出的共用事实，禁止默认复制序列号、价格和开封状态。首版禁止直接恢复有拆分记录的源包，不提供自动合包；并发重复拆分被版本/关系约束拒绝。

## 单位 / 补货 / SKU / 资产

规范单位：质量 g（mg/g/kg）、体积 mL（mL/L）、长度 mm（mm/cm/m/in，1 in=25.4 mm）、功率 W、能量 Wh（Wh/kWh）、电压 V；count 整数，percent 独立且 0–100。字段声明允许量纲，Decimal 精确转换；历史字段和值不迁移。扩展 contents/product/device 的 schema 要发布新模板版本，不原地扩张已发布版本。金额单独 `{amount,currency}`，按 ISO 4217 币种分组，不自动换汇；原始输入写事件，display_unit 仅展示偏好。

stock 仅 SKU：basis=COUNT|CONTENT，threshold、target 和 CONTENT 时的 unit。COUNT 统计有效当前 Item（含未知生命周期，排除终态/VOID），CONTENT 仅已知同量纲余量，未知单列、percent 不累加；不按每页结果统计，也不自动采购。target 不小于 threshold。

名称仅候选，明确 SKU ID、唯一条码/已确认别名或家庭规则认可的完整非空身份签名才能复用。空签名不写 identity index；冲突交治理，不自动合并。one_off 显式设置、不从缺条码推断；默认常用目录和自动匹配排除，实物仍显示。SKU 名称不唯一；GROUP 新同级重名阻止，旧重复需治理。clothing/device 新版本转换不能猜测尺码/接口；重建身份索引时冲突输出清单。

asset 只存价格/币种/商家/序列号/说明书等，不存 purchased_on 或 warranty_until 的第二份事实。

## 笔记 / 附件 / 脱敏

Note 目标为 ITEM/CATALOG_NODE，保留 ID，增加 updated_by/archived_at，修改所属对象 revision 并发事件；归档不硬删除。附件可挂 Item/CatalogNode/Note，挂 Note 的变化归属该 Note 的目标对象。

BlobStore 接口为 stage/inspect/finalize/open/deleteUnreferenced；root 私有持久卷独立于只读镜像。文件元数据、upload_session、附件关联分离。JPEG/PNG/WebP/PDF，25 MiB/文件、20 个有效关联/目标、5 GiB/家庭（可配），上传先预留配额；80% 告警，配额不足拒绝新上传。

5 分钟单次上传票据绑定家庭/对象/会话/大小；失败可为同一会话重领，最终关联幂等。实际类型嗅探，禁 SVG/HTML；图片 sharp 自动定向、剥 EXIF，限制 20MP、处理并发 1，缩略图最长边 512px；SHA-256 针对最终保存字节。PDF 仅 attachment 下载 + nosniff。插件票据经 app-only 私有 _meta 和请求头，不入 URL/日志；CSP/CORS 仅开放附件通道。

未完成上传 24h 清理；解除关联后未引用 blob 保留 30d。备份持有文件引用租约，GC 不得删除备份 manifest 正在读取的对象。确认关联时检查原目标 revision；失败不生成孤儿事件。

字段在 registry 声明 sensitivity，笔记/附件亦可分级。redactFor(scope,value) 覆盖 list/detail/sync/history/receipt/inspect/export/error/log，SECRET 默认不搜索/导出，序列号默认脱敏。展开原文仍沿用家庭权限，显式请求、记独立访问审计、不增加库存 revision、不发 sync，不落基础离线缓存。Zod 和 SQL 错误不能附带原始输入；原始历史记录不因脱敏而重写。

## 协议与能力发现

业务 v2 在传输 envelope/HTTP 头声明，不参与旧幂等指纹。协商接口返回 current/min/supported、server capabilities；鉴权/健康/版本协商不要求先有业务版本。最终全部业务读写逐次校验，旧版报 PROTOCOL_VERSION_UNSUPPORTED。新增命令仍共享版本/家庭权限/幂等/事务机制。

v1 兼容桥在 switch 前只展示旧版可解释的模板和数据；新增语义生产写开关保持关闭。v2 envelope 在 Batch 5 冻结，提前预留 record_state、one_off、profile/capabilities、deadline、附件摘要。模板读取为开放 ID + 固定版本；新增可选元数据不要求改协议主版本。
