// Kept short enough to be included in every MCP initialization.
export const intakeInstructions = `Acornary 管理具体物品。先用 get_connection_context 辨认当前账号、家庭和连接；多连接无法确定时先澄清。先查同款，必要时创建 SKU；创建商品资料不等于新增库存。
商品分类沿用现有目录、按商品类型规范扩展，先确定归属再创建。GROUP 表达“它是什么”的同类集合，SKU 是可直接用于入库的商品定义，无品牌或条码也可建立 SKU。默认按大类到具体类型细分，子类必须属于父类，同级划分依据一致；尊重已有明确惯例，不预设全品类目录、不强制层数、不复制商品名建立多余的同名 GROUP。
先用 query_catalog_nodes 查同款及相关分类分支，include_path=true 核对 path_ids；未知路径节点用 get_catalog_node 补读名称，沿 next_cursor 翻页，不因首屏未找到就新建。结合含义和完整路径匹配，不能只看短名称或把近义名称直接当作同一分类。找到同款先复用；归类疑似错误时指出，不通过重建 SKU 修复。无同款时选择最具体且有依据的分类，逐层复用 GROUP；在已授权创建商品的范围内，仅按需从父到子补建缺失分类，再创建 SKU，不因缺分类随意挂根或宽泛父类，不凭空细分。
品牌、固定规格、颜色等记录在商品属性；逐包实际重量、购入日期和到期信息记录在实物属性，不按这些属性或储存要求默认新建分类；已有明确采用这些维度的目录时沿用，不擅自重构。实质不同的固定商品规格可区分 SKU，逐包实测重量不同不因此拆成多个 SKU。房间、冰箱、冷库、抽屉是实物位置，不能作为商品分类依据。多条路径合理、目录重叠或商品类型不明时，给出候选路径和推荐理由后确认，不自行建“其他/未分类”绕过判断。整理已有目录须用户授权，以当前 revision 移动原节点，保留 ID 和库存关联；移动实物不改变商品归类。
入库先收集包数、逐包规格、共同位置、购入日期及到期日性质；未知事实留空，不补 ACTIVE、AVAILABLE、实测标签或日期。位置多个候选时确认完整路径。相同规格用 create_items，不同规格用 create_items_batch，每包一个 client_ref 和独立 ID；尽量在 initial_attributes 与 parent_id 中一次提交全部已知事实。
所有修改已有对象的操作必须携带 expected_revisions，映射完整对象 ID 到读取所得 revision；成功后采用 affected_objects.after_revision。缺版本先补读；版本冲突后重新读取、核对原意图是否成立，再以新键提交，不能只替换 revision 强行覆盖。首次同类失败停止尚未发送的依赖写入；已发出的请求逐个核对。
超时或结果不明保留原参数和原幂等键重试；IDEMPOTENCY_CONFLICT 先找回原请求和结果，不能换键绕过。明确拒绝后修正的请求用新键。
商品未开封保质期使用 product v2 的 shelf_life_days 和已知起算依据；expiry.after_opening_days 仅表示开封后天数。不能把购入日加保质天数当成厂家到期日，不自动推算到期日；估计日期使用 ESTIMATED。已有模板绑定使用其固定版本，升级必须显式 upgrade_attributes 并保留完整目标值。模板字段通过 list_attribute_templates/get_attribute_template 发现。
最后核对并报告商品完整分类路径，以及实际返回的包数、ID、重量、位置和日期；必要时读取对象验证。推荐和选中对象本身不授权写入；不要把商品资料创建成功报告成实物已入库。`;
