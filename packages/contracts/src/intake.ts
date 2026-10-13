import { z } from 'zod';
import { entityId } from './ids.js';

const name = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => /\S/.test(s), 'Name must not be blank.');
const catalogId = entityId('catalog_node');
const itemId = entityId('item');
export const revisionMap = z.record(z.union([catalogId, itemId]), z.int().positive());
export const intakeAttribute = z.strictObject({
  template_id: z.enum([
    'product',
    'lifecycle',
    'contents',
    'container',
    'catalog',
    'clothing',
    'device',
  ]),
  template_version: z.int().positive(),
  values: z.record(z.string(), z.unknown()),
});
const attributes = z.array(intakeAttribute).max(7);
export const catalogRuleSchema = z.strictObject({
  branch_id: catalogId,
  standard_name: name.optional(),
  meaning: name,
  boundaries: name,
  subdivision_basis: name,
  allow_direct_products: z.boolean(),
  allow_new_groups: z.boolean(),
  max_new_depth: z.int().min(0).max(4),
  naming_guidance: name,
  name_max_length: z.int().min(1).max(500).default(100),
  forbid_location_names: z.boolean().default(true),
  forbid_measurement_names: z.boolean().default(true),
  forbidden_names: z.array(name).max(100).default(['其他', '未分类']),
  aliases: z
    .array(z.strictObject({ name, catalog_node_id: catalogId }))
    .max(200)
    .default([]),
  identity_fields: z
    .array(
      z.enum([
        'product.brand',
        'product.model',
        'product.specification',
        'product.net_content',
        'clothing.material',
        'clothing.color',
        'clothing.size',
        'device.connector',
        'device.rated_power_w',
      ]),
    )
    .max(9)
    .default([
      'product.brand',
      'product.model',
      'product.specification',
      'product.net_content',
      'clothing.material',
      'clothing.color',
      'clothing.size',
      'device.connector',
      'device.rated_power_w',
    ]),
  legacy_exceptions: z.array(catalogId).max(200).default([]),
});
const defaults = z.strictObject({
  parent_id: itemId.nullable().optional(),
  initial_attributes: attributes.optional(),
});
export const newIntakeProduct = z.strictObject({
  name,
  parent_id: catalogId.nullable(),
  initial_attributes: attributes.optional(),
  new_groups: z.array(name).max(4).default([]),
  classification_reason: name,
});
export const intakeBodySchema = z
  .strictObject({
    policy_revision: z.int().nonnegative(),
    expected_revisions: revisionMap,
    defaults: defaults.optional(),
    lines: z
      .array(
        z.strictObject({
          product: z.union([z.strictObject({ catalog_node_id: catalogId }), newIntakeProduct]),
          instances: z
            .array(
              z.strictObject({
                count: z.int().min(1).max(100),
                parent_id: itemId.nullable().optional(),
                display_name: name.optional(),
                initial_attributes: attributes.optional(),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (body) =>
      body.lines.reduce((n, l) => n + l.instances.reduce((m, i) => m + i.count, 0), 0) <= 100,
    'A task may contain at most 100 physical items. Agree on separate tasks before splitting.',
  );
export const catalogProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('policy'),
    policy_revision: z.int().nonnegative(),
    expected_revisions: revisionMap,
    rule: catalogRuleSchema,
    reason: name,
  }),
  z.strictObject({ kind: z.literal('intake_exception'), intake: intakeBodySchema, reason: name }),
  z.strictObject({
    kind: z.literal('catalog_command'),
    operation: z.enum([
      'create_catalog_node',
      'update_catalog_node',
      'move_catalog_node',
      'bind_attributes',
      'update_attributes',
      'remove_attributes',
      'upgrade_attributes',
      'correct_item',
    ]),
    input: z.record(z.string(), z.unknown()),
    reason: name,
  }),
]);
export const intakeSchemas = {
  get_intake_context: z.strictObject({
    names: z.array(name).max(100).default([]),
    location_names: z.array(name).max(100).default([]),
    category_names: z.array(name).max(100).default([]),
    barcodes: z.array(z.string().min(1).max(128)).max(100).default([]),
    catalog_node_ids: z.array(catalogId).max(100).default([]),
    location_ids: z.array(itemId).max(100).default([]),
    limit: z.int().min(1).max(200).default(30),
    cursor: z.int().nonnegative().default(0),
  }),
  commit_intake: intakeBodySchema.safeExtend({
    idempotency_key: z.string().min(1).max(200),
    approval_id: z.uuid().optional(),
    occurred_at: z.iso.datetime({ offset: true }).optional(),
  }),
  get_intake_receipt: z
    .strictObject({
      operation_id: entityId('operation').optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
    })
    .refine(
      (v) => !!v.operation_id !== !!v.idempotency_key,
      'Supply exactly one receipt identifier.',
    ),
  get_catalog_policy: z.strictObject({
    branch_id: catalogId.optional(),
    revision: z.int().positive().optional(),
  }),
  propose_catalog_change: z.strictObject({
    idempotency_key: z.string().min(1).max(200),
    proposal: catalogProposalSchema,
  }),
};
export const catalogReviewSchema = z.strictObject({ proposal_id: z.uuid() });
export const catalogConfirmSchema = catalogReviewSchema.extend({
  challenge: z.string().min(32).max(200),
});
export type CatalogRule = z.infer<typeof catalogRuleSchema>;
export type IntakeBody = z.infer<typeof intakeBodySchema>;
export type CatalogProposal = z.infer<typeof catalogProposalSchema>;

// Kept short enough to be included in every MCP initialization.
export const intakeInstructions = `Acornary 管理具体物品。先用 get_connection_context 辨认当前账号、家庭和连接；多连接无法确定时先澄清。日常入库使用 get_intake_context 查询、commit_intake 原子提交；创建商品资料不等于新增库存。
商品分类沿用现有目录、按商品类型规范扩展，先确定归属再创建。GROUP 表达“它是什么”的同类集合，SKU 是可直接用于入库的商品定义，无品牌或条码也可建立 SKU。默认按大类到具体类型细分，子类必须属于父类，同级划分依据一致；尊重已有明确惯例，不预设全品类目录、不强制层数、不复制商品名建立多余的同名 GROUP。
先用 query_catalog_nodes 查同款及相关分类分支，include_path=true 核对 path_ids；未知路径节点用 get_catalog_node 补读名称，沿 next_cursor 翻页，不因首屏未找到就新建。结合含义和完整路径匹配，不能只看短名称或把近义名称直接当作同一分类。找到同款先复用；归类疑似错误时指出，不通过重建 SKU 修复。无同款时选择最具体且有依据的分类，逐层复用 GROUP；在已确认分类规范和用户授权范围内，由 commit_intake 仅按需补建缺失分类和 SKU，不因缺分类随意挂根或宽泛父类，不凭空细分。
品牌、固定规格、颜色等记录在商品属性；逐包实际重量、购入日期和到期信息记录在实物属性，不按这些属性或储存要求默认新建分类；已有明确采用这些维度的目录时沿用，不擅自重构。实质不同的固定商品规格可区分 SKU，逐包实测重量不同不因此拆成多个 SKU。房间、冰箱、冷库、抽屉是实物位置，不能作为商品分类依据。多条路径合理、目录重叠或商品类型不明时，给出候选路径和推荐理由后确认，不自行建“其他/未分类”绕过判断。整理已有目录须用户授权，以当前 revision 移动原节点，保留 ID 和库存关联；移动实物不改变商品归类。
入库先收集包数、逐包规格、共同位置、购入日期及到期日性质；未知事实留空，不补 ACTIVE、AVAILABLE、实测标签或日期。位置多个候选时确认完整路径。优先使用 commit_intake，共同信息放 defaults，逐件差异放 instances，每件独立 ID；已明确 SKU 的旧 create_items/create_items_batch 接口仍可用。尽量在 initial_attributes 与 parent_id 中一次提交全部已知事实。
所有修改已有对象的操作必须携带 expected_revisions，映射完整对象 ID 到读取所得 revision；成功后采用 affected_objects.after_revision。缺版本先补读；版本冲突后重新读取、核对原意图是否成立，再以新键提交，不能只替换 revision 强行覆盖。首次同类失败停止尚未发送的依赖写入；已发出的请求逐个核对。
超时或结果不明保留原参数和原幂等键重试；IDEMPOTENCY_CONFLICT 先找回原请求和结果，不能换键绕过。明确拒绝后修正的请求用新键。
商品未开封保质期使用 product v2 的 shelf_life_days 和已知起算依据；expiry.after_opening_days 仅表示开封后天数。不能把购入日加保质天数当成厂家到期日，不自动推算到期日；估计日期使用 ESTIMATED。已有模板绑定使用其固定版本，升级必须显式 upgrade_attributes 并保留完整目标值。模板字段通过 list_attribute_templates/get_attribute_template 发现。
分类规范必须读取服务端；先 get_intake_context，再 commit_intake，每批最多100件。缺失规范或越界扩展先 propose_catalog_change，由用户在 Acornary 卡片确认；区分长期规则和仅本次授权。普通已授权补货不重复确认。独立目录治理也必须有对应提案确认；不得借入库整理旧目录。超时使用原键和原参数，get_intake_receipt核对结果；同名不等于同款。
最后核对并报告商品完整分类路径，以及实际返回的包数、ID、重量、位置和日期；必要时读取对象验证。推荐和选中对象本身不授权写入；不要把商品资料创建成功报告成实物已入库。`;
