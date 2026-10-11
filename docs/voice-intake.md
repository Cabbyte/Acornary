# 语音入库、并发恢复与性能验收

## Agent 短流程

1. `get_connection_context` 辨认服务地址、账号/操作者、家庭和权限；多个连接无法确定时先确认目标。
2. 查询同款 SKU 与相关分类分支，按下述通用规则核对完整路径、复用目录，必要时补齐分类再创建商品。创建商品资料不会创建具体库存。
3. 先收集包数、逐包规格、共同位置及已知日期；位置有多个候选时确认完整路径。未知状态、日期和数量精度留空。
4. 相同属性多件用 `create_items`；不同规格用 `create_items_batch`。通过 `parent_id` 和 `initial_attributes` 同时写入位置、重量和日期，避免后补。
5. 核对并报告商品完整分类路径，以及返回的条目、ID、重量、位置和日期；成功后使用 `after_revision`。首次同类失败停止未发送的依赖写入，已发出的请求逐个核对。

MCP 初始化指引的源码为 `packages/contracts/src/intake.ts`。工具指南无法取消宿主已经发出的请求，也不能保证所有宿主按建议编排。

## 通用商品分类规则

**沿用现有目录，按商品类型规范扩展，先确定归属，再创建商品。** 以下规则适用于所有商品，不是固定目录白名单，也不要求每条路径具有相同层数。

1. **分类表达“它是什么”。** 默认按大类、子类到更具体的类型细分；子类必须属于父类，同一父级下保持划分依据一致。已有目录存在明确惯例时优先遵循，用户明确指定的分类要求优先；发生冲突时确认，不自行重构。
2. **GROUP 与 SKU 分开。** GROUP 是可容纳同类商品的集合，SKU 是可直接用于入库的商品定义。没有品牌或条码也能建立 SKU；不为了凑层数将商品名再复制为同名 GROUP。实质不同的固定品牌、型号或包装规格可区分 SKU，但不因此默认建立对应分类。
3. **属性不默认充当分类。** 品牌、固定规格、颜色、保质期及储存要求等按模板记录在商品属性；逐包实际重量、购入日期和具体到期信息记录在实物属性。逐包重量不同本身不要求拆分 SKU。已有明确按这些维度组织的目录可以沿用，不擅自重构。
4. **位置独立。** 房间、冰箱、冷库、抽屉属于 Item 实物位置，不作为商品分类依据。目录节点的 `parent_id` 指向分类 GROUP，实物的 `parent_id` 指向位置或容器 Item；两者不能混用，移动实物也不会改变商品归类。
5. **选择最具体且有依据的分类。** 已有合适子类时不把 SKU 放在根目录或宽泛父类。缺少必要层级时补建，但不凭空发明细分，也不为一个商品建立无意义的长路径。
6. **复用优先。** 按含义和完整路径查找，而非仅比较短名称；检查分页。近义名称只能作为候选，不能直接认定为同一分类或自动合并。
7. **歧义先确认。** 多条路径均合理、分类重叠或商品类型不明时，列出候选路径及推荐理由，让用户确认；信息不足时询问需要区分的商品类型。不能随意挂到根目录，也不能自行新建“其他／未分类”绕过判断。

### 执行顺序

1. 用 `query_catalog_nodes` 查询同款 SKU 和相关分类分支。设置 `include_path=true` 读取 `path_ids`，必要时用 `get_catalog_node` 补读未知路径节点的名称和类型。使用 `catalog_subtree_id` 缩小到相关分支，沿返回的 `next_cursor` 继续查询，不能把首屏无匹配当成不存在；无需每次扫描整个家庭目录。
2. 找到同款 SKU 则复用。如果其归类疑似错误，指出原路径和建议路径，不通过重建 SKU 解决，也不默默移动。整理已有节点需要用户授权；已获得整理授权时无需重复询问。
3. 未找到同款时，先确定完整目标路径。在已授权创建商品的范围内逐层复用 GROUP，仅按需从父到子创建缺失分类，并使用实际返回的父节点 ID 创建 SKU。分类创建失败时停止依赖创建，不退回根目录继续写入；重试遵循下述幂等恢复规则。
4. 创建后读取并核对完整分类路径，向用户报告；新增具体库存继续走入库流程。只创建商品时不能报告实物已入库。
5. 已授权纠正分类时，读取原节点的当前 revision，用 `move_catalog_node` 携带 `expected_revisions` 移动原节点，保留 ID 和库存关联，随后核对目标路径。不自动重命名、合并或批量迁移既有目录。

### 跨品类示例

下列路径均假设符合该家庭已有目录或已明确的分类意图；路径末端为 SKU，其余为 GROUP。不能照抄示例另建与现有目录重复的分类。

| 场景 | 正确处理 | 应避免的处理 |
| --- | --- | --- |
| 梅花肉、五花肉 | `食品 → 生鲜 → 猪肉 → 梅花肉` 与 `食品 → 生鲜 → 猪肉 → 五花肉`；两种商品为同级 SKU | 把 SKU 放在根目录，或再建 `梅花肉 GROUP → 梅花肉 SKU` 凑层数 |
| 同款梅花肉四包重量不同 | 复用同一个梅花肉 SKU，425/495/245/520g 分别记在四个 Item 上；冷库记为位置 | 建立四个重量分类，或因实测重量不同建立四个 SKU，或将冷库作为目录父级 |
| 棉质 T 恤，蓝色、M 码 | 复用既有分类，形成 `服饰 → 上装 → T 恤 → 棉质 T 恤（蓝色 M 码）`；颜色、尺码记录属性，确属不同商品规格时区分 SKU | 默认新增“蓝色”“M 码”分类，或按衣柜抽屉组织商品目录 |
| 某型号无线鼠标 | 复用既有分类，形成 `电子产品 → 电脑外设 → 鼠标 → 某型号无线鼠标`，末端创建或复用该型号 SKU | 在已有鼠标子类时直接挂在电子产品下，或默认按品牌建立新的平行分类树 |
| 目录同时有“食品”和“食品饮料” | 查看完整分支、既有商品及含义；仍重叠时给出候选路径和推荐理由后确认 | 仅凭名称相近自动合并，或创建第三套同义目录 |

### 分类指引验收

协议暴露检查与模型行为验收分别记录：初始化 `instructions` 和 `tools/list` 包含新规则，只证明宿主收到指引，不证明模型一定遵循。

| 模型行为场景 | 预期行为 |
| --- | --- |
| 已有完整分类及同款 SKU | 读取完整路径并复用，不新增商品或分类 |
| 没有同款，缺少中间分类 | 确定路径，逐层补建必要 GROUP 再建 SKU，不机械增加层数 |
| 同名不同路径、近义分类或类型不明 | 核对含义和父路径，仍有歧义则提供候选及理由并确认 |
| 匹配项位于查询下一页 | 沿 `next_cursor` 查询后复用，不以首屏无结果为由创建 |
| 重量、颜色、存放位置不同 | 不默认建立属性或位置分类，正确区分固定商品规格和逐件实物属性 |
| 已有 SKU 归类错误 | 不重建；已获整理授权后用原 ID 和当前 revision 移动 |
| 食品、衣物、电子产品 | 都遵循通用规则，示例路径不作为固定白名单 |

部署服务并刷新连接平台工具缓存后，新指引才会在线上生效。本次仅调整提示词、工具描述和指南，不新增数据库分类约束，不自动整理现有数据。真实宿主的模型行为验收应在隔离家庭中执行；尚未执行的场景标为待验收，不用文案检查代替。

2026-10-11 本次分类指引验证记录：

- `pnpm typecheck` 通过。
- 本地 Node v26.7.0 下，用真实 MCP SDK 客户端连接临时服务，验证初始化 `instructions` 与源码一致，以及 `query_catalog_nodes`、`get_catalog_node`、`create_catalog_node`、`move_catalog_node` 四个工具在 `tools/list` 中的描述与源码一致。检查期间禁用数据库连接，未调用业务工具或写入库存；此项为协议暴露检查，不替代项目 Node 24 发布验收。
- 上表的真实宿主模型行为场景均待验收；尚未部署或刷新线上连接缓存。

## 版本和错误协议

修改已有对象必须提供完整 ID 到 revision 的映射。只引用的 SKU 和父容器无需版本；创建接口保留旧请求规范化和幂等指纹。

完整移动示例（ID 替换为实际读取值）：

```json
{
  "item_ids": ["item_11111111-1111-4111-8111-000000000001"],
  "parent_id": "item_22222222-2222-4222-8222-000000000002",
  "expected_revisions": { "item_11111111-1111-4111-8111-000000000001": 1 },
  "idempotency_key": "move-pack-unique-intent"
}
```

错误对象为 `error: {code, message, details?, request_id, recovery}`。MCP 的 `content` 与 `structuredContent` 使用同一错误；业务失败设置 `isError=true`。缺参由统一业务校验处理，公开工具 schema 仍严格。OAuth challenge 和无效 JSON-RPC 等协议错误沿用各自协议。

| code                                       | HTTP        | recovery                 | 下一步                                     |
| ------------------------------------------ | ----------- | ------------------------ | ------------------------------------------ |
| MISSING_EXPECTED_REVISION                  | 400         | FIX_REQUEST              | 补读并提供每个目标版本；不是记录已发生变化 |
| REVISION_CONFLICT                          | 409         | REREAD_AND_REVIEW        | 重读并核对变化，原意图仍成立才用新键提交   |
| ATTRIBUTE_VALIDATION_FAILED                | 400         | FIX_REQUEST              | 修正字段、模板版本或单位，以新键提交       |
| IDEMPOTENCY_CONFLICT                       | 409         | RECOVER_ORIGINAL_REQUEST | 找回原请求及结果，不能换键绕过             |
| UNAUTHORIZED / FORBIDDEN / SESSION_CHANGED | 401/403/409 | REAUTHORIZE              | 核对授权和连接                             |
| 网络、超时或未知异常                       | 不固定      | RETRY_SAME_REQUEST       | 保留原键和原参数，不能假定未提交           |

真正冲突会给出授权范围内的 `expected_revision/current_revision`，但不可直接替换版本强行覆盖。连接平台自己的外层 `INVALID_ARGUMENT` 不属于服务端错误合同，需要分别记录原始 MCP 响应和宿主展示。

## 原子批量命令

`create_items_batch` 顶层接受 `idempotency_key`、可选 `occurred_at` 与 1–100 个 `items`。每条一个实物：唯一 `client_ref`、`catalog_node_id`、可选 `parent_id`（缺省为根位置）、`display_name` 和 `initial_attributes`。不接受每条 count；需要几包就列几条。

四包梅花肉分别填写 contents.remaining 为 `425/495/245/520`，unit 为 `g`；每条 lifecycle 同时记录：

```json
{
  "template_id": "lifecycle",
  "template_version": 1,
  "values": {
    "acquisition": { "acquired_on": "2026-10-11" },
    "expiry": { "date": "2027-10-11", "date_kind": "ESTIMATED" }
  }
}
```

每条 parent_id 使用已确认的“客厅→冷库”ID。成功结果保留 operation_id、affected_objects、event_ids，并返回 `created_items: [{client_ref,item_id,after_revision}]`。每包独立 CREATE 事件，共用一次操作；同键重放返回原 ID。失败全部回滚，错误包含零起始 `item_index` 及 client_ref。

`update_items_lifecycle` 接受顶层版本映射及 `items: [{item_id,template_version:1,set,unset}]`。set/unset 使用 lifecycle 模板内路径，省略字段保持原值，每个实际变化的物品只增加一次版本。重复 item_id、版本冲突或非法属性导致整批回滚。

## 未开封保质期与模板升级

product v1 不变；追加 product v2，增加可选 `shelf_life_days`（1–36500）、`shelf_life_basis`（PRODUCTION_DATE/PACKAGING_DATE/OTHER）和 `shelf_life_basis_note`。15 天但起算依据不明时仅填天数。开封后天数仍属于 lifecycle.expiry.after_opening_days。

商品只有保质天数时，不生成库存或具体到期日期；购入日期不视为生产日期。具体物品的日期沿用 expiry.date/date_kind。估计值明确标记 ESTIMATED。

`list_attribute_templates` 返回各模板最新定义；`get_attribute_template` 可读取指定旧版本。更新已有绑定必须使用该绑定版本，Web/插件同样遵守。使用 `upgrade_attributes` 显式从 product v1 升至 v2：提交 target、expected_revisions、幂等键、template_id=product、template_version=2 和完整 values。完整值中未保留的旧字段会被移除，因此升级前应读取并合并需要保留的值。不会自动解析 specification 文本。

迁移 007 只追加各家庭的 v2 定义，不修改 v1、绑定、revision、事件或幂等结果。新家庭注册两个 product 版本。兼容发布可在本地 Compose 的 `.env` 或云端私有 `app.env` 设置 `ACORNARY_PRODUCT_V2_WRITES=0`，阻止引入新 v2 绑定，仍能读写已有 v2；核对所有应用实例和 UI 兼容后移除此设置并重启，启用新增/升级。出现 v2 绑定后，不能回滚至只能读取 v1 的旧程序。

## 测量与验证

服务端每次请求生成 X-Request-ID，并以结构化日志记录版本、工具、结果、批量大小、operation_id 和幂等重放标记。HTTP 返回 `Server-Timing: total;dur=...`，MCP 返回 `_meta['acornary/trace']`。每次重试的 request_id 不同，业务幂等结果保持相同。元数据还包含 server_instance_id 和 process_uptime_ms，可区分服务重启与长驻进程。

- server_duration_ms 为响应生成时的服务端耗时；日志总时长计至响应完成。
- auth_ms 与 business_ms 是包含子阶段的总耗时；不能与 db_ms 相加。
- pool_wait_ms 单独记录显式连接池等待；lock_wait_ms 单独记录取得家庭事务锁的 SQL 往返耗时（包含锁等待），已从 db_ms 排除。
- db_ms 是业务数据库封装中的 SQL 往返耗时，不等于数据库 CPU 时间；鉴权库内部 SQL 包含在 auth_ms，不能进一步归因。
- 自有客户端保留最近 500 条无参数的测量，发送 `acornary-call-timing` 事件；`callTimingSamples()/callTimingSummary()` 提供样本及 p50/p95。第一条客户端调用与热调用分开，不把它直接认定为平台冷启动。

隔离基线脚本拒绝非 `acornary_test*` 数据库，创建独立验收家庭。它比较四次完整单包创建与一次四包批量创建，并测读取。使用 Node 24：

```sh
DATABASE_URL=postgres://.../acornary_test LOG_LEVEL=error node --import tsx scripts/measure-intake.ts 100 > output/intake-timing.json
```

报告含样本数、错误率、p50/p95 和逐次 request_id/阶段耗时。four_pack_intakes 汇总整次四包入库，单包组每轮四次请求的时长已相加；跨平台网络延迟不包含在本机回环结果中。平台等待需真实宿主数据验证，不将端到端差值直接归因于服务器或网络。

验收运行 `pnpm typecheck`、`pnpm build`、`pnpm test` 和受影响的 Playwright 测试；标准隔离运行方式为构建 Docker browser-test 后执行 `node scripts/ci.mjs`。发布前备份并恢复验证迁移，发布后刷新连接平台工具列表，分别记录原始协议测试与真实宿主验收。不要对本次实际四包库存重复创建测试数据。

## 2026-10-11 实施验收记录

- 最终版本在 Node 24 容器中通过类型检查、生产构建、18 个测试文件的 108 项测试，以及插件/Web/OAuth 的 36 项 Chromium 回归。此前完整 Chromium 46 项、WebKit 13 项均通过；最终补充修改为错误与追踪元数据，并已做针对性回归。
- 真实 MCP SDK 的 tools/list 与 tools/call 验证了必填版本、缺失版本与真实冲突的不同错误码、文本/结构化错误一致以及逐次 request_id；不是仅模拟函数调用。
- 隔离备份恢复的 9 张核心表行数与 SHA-256 一致，包含 7 个已执行迁移；追加 v2 定义保留旧绑定、事件与幂等结果。
- Node v24.21.0、本地 Docker/PostgreSQL 18、MCP 回环测量共 600 次请求，错误为 0，每次均有独立 request_id 及服务端阶段耗时。两种入库方式各测 100 轮，下表排除第一轮，均为 99 轮四包入库。

| 四包入库方式            | 请求数/轮 | 端到端 p50 | 端到端 p95 |
| ----------------------- | --------- | ---------- | ---------- |
| 四次完整 create_items   | 4         | 73.90 ms   | 190.93 ms  |
| 一次 create_items_batch | 1         | 28.42 ms   | 52.82 ms   |

这是顺序分组的本地测量，期间有其他 CI 负载，不构成线上延迟承诺或服务器瓶颈结论。原始样本与恢复核对结果保存在本工作区 `output/intake/`；浏览器验收附件保存在 `output/intake-ci/` 与 `output/intake-ci-final/`。

尚未发布生产版本、刷新真实连接平台工具缓存或验证其外层错误包装；测试未修改用户的实际四包肉和牛奶记录。
