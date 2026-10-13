# 语音入库与分类规范 v1

实施基线：`main@b3d2463`。改动分支：`codex/voice-intake-policy`。仅隔离测试数据；不部署生产、不调整历史分类、不改真实库存。

## 调用与契约

契约源：`packages/contracts/src/intake.ts`；七种属性模板仍以 `packages/contracts/src/index.ts` 为准。

| 接口 | 行为 |
| --- | --- |
| `get_intake_context` | 整批名称、分类线索、条码、已知 SKU/分类及位置 ID、位置名称；返回候选、完整路径、相关规则、模板定义、依赖版本、覆盖范围和分页游标。明确引用的对象及祖先不受候选页截断影响。 |
| `commit_intake` | 一个幂等键对应一个明确的购买任务；最多100件。家庭写锁内重新检查规范及所有给定依赖，匹配商品身份，创建必要分类、SKU及全部实物。 |
| `get_intake_receipt` | 操作 ID（同家庭可读）或当前操作者的幂等键；返回最初保存的完整结果。未知结果不换幂等键。 |
| `get_catalog_policy` | 当前家庭最新规范，或指定历史 `revision`；可按分支筛选；返回当前操作者待确认提案。 |
| `propose_catalog_change` | 只保存具体提案，不创建分类或库存；kind为 `policy`、`intake_exception` 或 `catalog_command`。 |

MCP日常正常路径为一次 context + 一次 commit。已有明确SKU不需要初始化分类规范。模板、事实、授权不够时，允许必要的补充查询/集中澄清；不是保证所有任务永远两次调用。

输入示意（ID与版本必须来自当前家庭读取，示例不可直接提交）：

```json
{
  "idempotency_key": "one-purchase-not-one-attempt",
  "policy_revision": 1,
  "expected_revisions": { "catalog_node_<uuid>": 1, "item_<uuid>": 2 },
  "defaults": {
    "parent_id": "item_<uuid>",
    "initial_attributes": [{ "template_id": "lifecycle", "template_version": 1, "values": { "expiry": { "date": "2026-12-01" } } }]
  },
  "lines": [{
    "product": { "catalog_node_id": "catalog_node_<uuid>" },
    "instances": [
      { "count": 1, "initial_attributes": [{ "template_id": "contents", "template_version": 1, "values": { "remaining": { "value": "310", "unit": "g" } } }] },
      { "count": 1, "initial_attributes": [{ "template_id": "contents", "template_version": 1, "values": { "remaining": { "value": "470", "unit": "g" } } }] }
    ]
  }]
}
```

共同字段只写一次。逐件属性在叶字段覆盖共同属性；一个 measurement（value+unit）整体覆盖，避免错配单位。位置未给出时继承共同位置；显式null表示无位置。未知日期、开封状态、内容数量、精度省略，不补默认事实。SKU模板为product/catalog/clothing/device，实物模板为lifecycle/contents/container。

新商品描述为name、parent_id、initial_attributes、new_groups、classification_reason。新商品的重量/日期/位置放在实例，不放在身份字段。一般parent_id是已确认的GROUP；需要根级新分支时，parent_id=null并给出具体new_groups，只能通过绑定整批内容的一次性确认授权。

## 规范及商品身份

现有目录不会被迁移成规范。每份家庭规范包含分支含义、边界、划分依据、命名指导、最大名称长度、禁用名称、是否禁止位置/纯重量名称、直接挂商品权限、扩展层级、别名、身份字段和明确的历史例外。确认时的标准名称由服务器从所引用目录读取并保存在规范版本中；当前名称仍由目录提供，后续重命名须单独治理并留痕。版本完整快照追加保存确认人、时间和原因，可读历史版本。

模型在已批准的宽泛语义范围内判断新概念的归属，说明classification_reason；服务器检查结构、命名、深度、别名冲突及依赖，不把该理由或自报置信度视为授权。语义是否正确仍需要真实宿主验收。新规则不自动移动旧记录；与新规则存在明确结构冲突的旧商品需标记历史例外或批准本次任务。

同款匹配在写锁内覆盖全部相关名称、条码、确认别名和身份索引。名称和字符串识别信息采用NFKC、边缘空白及大小写规范化；数值measurement比较规范化十进制。只在明确条码/别名，或至少一个已知身份字段且完整身份投影相同时复用。仅同名、身份信息一方缺失、历史多个候选、已知条码冲突、或所提供商品资料无法完整保留在已有SKU时返回具体候选；实质不同的已知身份字段可创建不同SKU。不同购买任务分别创建实物；同幂等键及相同参数返回原结果。历史重复不会被合并。

## 授权边界

模型可以提出具体提案，不能直接调用确认操作。`get_catalog_review`与`confirm_catalog_change`单独注册为app-only，不在schemas的自动工具注册或generic write路由内。前者把随机challenge放在模型不可见的`_meta['acornary/catalog-review']`，不放content/structuredContent；网页对应`/api/ui/catalog-review`、`/api/ui/catalog-confirm`。

服务器验证当前认证用户/操作者、家庭、OAuth权限或Web会话、具体提案、相关目录和规范版本、challenge哈希及15分钟有效期。Web还检查同源JSON与CSRF请求头；Web凭证绑定账号鉴权版本和会话ID，MCP凭证绑定当前认证上下文。工具visibility只是宿主限制，不替代这些验证。此机制不声称可以阻止获授权账号自己编写客户端操作其已有权限。

卡片区分“保存为长期规则”与“仅批准本次”。需要另一种范围时重新提出相应的具体提案。确认阶段只保存规则或授权；一次性授权绑定原命令/整批正文，消费与实际写入同事务。错误回滚恢复未消费状态；相同操作结果重放在原领域幂等逻辑中完成。超时可重试原确认凭证；过期时重新开卡片，已批准提案仍可恢复原确认结果。

旧create/update/move_catalog_node、目录属性绑定/修改/移除及纠正实物所属SKU都需具体已批准的catalog_command。HTTP、原MCP、apply_inventory_command与新整批工具共用约束；传source=MCP_UI或confirmed=true无效。旧create_items仍可补货，但检查当前已有商品的结构规则。批量入库通过事务内原语，不嵌套execute事务。

## 一致性、检索和回执

家庭级advisory事务锁沿用原实现。一次提交包含新分类、SKU、Item、条码/身份索引、事件、授权消费及成功operations回执；任何后续失败全部回滚。相关父路径的版本也检查，位置祖先改名/移动会导致冲突。规范用家庭快照版本保守检查；无自动替换版本的重试。

新读取通过批量候选SQL和递归祖先查询构造结果，不逐条加载全库。`catalog_folded_name`、条码、identity key、父节点及回执操作索引服务相应查询。contains语义查询仍可能扫描家庭内匹配行，这是SQL侧检索，不是逐条领域对象加载；未声称任意库存规模的恒定耗时。

每页有matching_count、has_more、next_cursor、complete。complete仅表示此次从第一页开始的相关查询没有截断，不代表自然语言的所有同义词都搜索完毕。已知ID单独返回referenced_catalog/referenced_locations；不存在的引用在提交阶段明确拒绝。分页无结果不作为唯一性判据，提交始终重新检查。

保存完整回执，包括实际复用/新增ID、每件属性和位置路径、事件及规则判断。HTTP/app收到完整结果；模型MCP commit得到实际商品/位置/差异的分组摘要。需要完整编号或历史时再get_intake_receipt/get_history。

## 迁移、运行和交付

006是增量迁移，仅增表、函数和索引；旧对象、嵌入属性、事件、旧幂等指纹/结果保留。部署权限追加policy INSERT、proposal INSERT/UPDATE、identity索引维护；policy版本有不可变触发器。备份清单新增三表；CI真实pg_dump/pg_restore后对比全部36张表。

```sh
docker build --target browser-test -t acornary-intake-candidate .
ACORNARY_CI_IMAGE=acornary-intake-candidate ACORNARY_CI_OUTPUT=output/intake-final-ci node scripts/ci.mjs
node scripts/intake-benchmark.mjs
python3 scripts/package-intake-skills.py
```

镜像内Node24是类型检查、构建及测试运行时。宿主Node只编排Docker。一次性PostgreSQL18自动清理，不读取本机.env或生产凭证。基线镜像来自output/intake-baseline的b3d2463归档，名称acornary-intake-baseline。服务探针是模拟明确意图后的服务器流程；工具调用次数是该探针的实现，不代表真实语音任务的实测往返。

两份Skill在plugin/skills；打包脚本生成output/intake-skills下两个zip。自定义MCP连接靠服务端instructions、工具描述和实时context执行；Skill文件交付不等于客户端安装或加载。真实宿主Refresh、导入、触发及语义一致性单独验收。

验收记录及待办见[acceptance.md](acceptance.md)。
