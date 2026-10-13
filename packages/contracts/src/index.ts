import { intakeSchemas } from './intake.js';
import { entityId } from './ids.js';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { DomainError } from '../../domain/src/index.js';
const text = z.string().min(1).max(500),
  id = entityId('catalog_node'),
  uuid = entityId('item');
// Keep the nonblank check on the server: some connectors misinterpret an exported /\S/ pattern.
// Do not trim names; parsed input is also used for idempotency fingerprints.
const catalogName = text.refine((value) => /\S/.test(value), 'Name must not be blank.');
const decimal = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/);
export const measurement = z.strictObject({
  value: decimal,
  unit: z.enum(['mL', 'g', 'count', 'percent']),
});
const positive = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/);
const lifeState = z.enum(['ACTIVE', 'CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED']);
export const templates = {
  product: {
    target_kind: 'CATALOG_NODE',
    paths: ['brand', 'model', 'specification', 'barcodes', 'net_content', 'storage.requirement'],
    schema: z.strictObject({
      brand: text.optional(),
      model: text.optional(),
      specification: text.optional(),
      barcodes: z
        .array(
          z
            .string()
            .min(1)
            .max(128)
            .regex(/^[\x21-\x7e]+$/),
        )
        .min(1)
        .max(32)
        .optional(),
      net_content: z
        .strictObject({ value: positive, unit: z.enum(['mL', 'g', 'count']) })
        .optional(),
      storage: z
        .strictObject({ requirement: z.enum(['AMBIENT', 'REFRIGERATED', 'FROZEN']).optional() })
        .optional(),
    }),
  },
  lifecycle: {
    target_kind: 'ITEM',
    paths: [
      'state',
      'condition',
      'availability',
      'opening.state',
      'opening.opened_at',
      'expiry.date',
      'expiry.date_kind',
      'expiry.after_opening_days',
      'acquisition.acquired_on',
      'acquisition.batch_label',
    ],
    schema: z.strictObject({
      state: lifeState.optional(),
      condition: z.enum(['NEW', 'GOOD', 'WORN', 'DAMAGED', 'BROKEN']).optional(),
      availability: z
        .enum(['AVAILABLE', 'IN_USE', 'LOANED', 'CLEANING', 'MAINTENANCE', 'IN_TRANSIT'])
        .optional(),
      opening: z
        .strictObject({
          state: z.enum(['SEALED', 'OPENED']).optional(),
          opened_at: z.iso.datetime({ offset: true }).optional(),
        })
        .optional(),
      expiry: z
        .strictObject({
          date: z.iso.date().optional(),
          date_kind: z.enum(['BEST_BEFORE', 'USE_BY', 'ESTIMATED']).optional(),
          after_opening_days: z.int().positive().max(36500).optional(),
        })
        .optional(),
      acquisition: z
        .strictObject({ acquired_on: z.iso.date().optional(), batch_label: text.optional() })
        .optional(),
    }),
  },
  contents: {
    target_kind: 'ITEM',
    paths: ['remaining', 'accuracy'],
    schema: z.strictObject({
      remaining: measurement.optional(),
      accuracy: z.enum(['ESTIMATED', 'MEASURED']).optional(),
    }),
  },
  container: {
    target_kind: 'ITEM',
    paths: ['can_contain'],
    schema: z.strictObject({ can_contain: z.boolean().optional() }),
  },
  catalog: {
    target_kind: 'CATALOG_NODE',
    paths: ['visibility'],
    schema: z.strictObject({ visibility: z.enum(['VISIBLE', 'HIDDEN']).optional() }),
  },
  clothing: {
    target_kind: 'CATALOG_NODE',
    paths: ['material', 'color', 'size'],
    schema: z.strictObject({
      material: text.optional(),
      color: text.optional(),
      size: text.optional(),
    }),
  },
  device: {
    target_kind: 'CATALOG_NODE',
    paths: ['connector', 'rated_power_w'],
    schema: z.strictObject({ connector: text.optional(), rated_power_w: positive.optional() }),
  },
} as const;
export type TemplateId = keyof typeof templates;
export const templateId = z.enum([
  'product',
  'lifecycle',
  'contents',
  'container',
  'catalog',
  'clothing',
  'device',
]);
export const productV2 = {
  ...templates.product,
  paths: [
    ...templates.product.paths,
    'shelf_life_days',
    'shelf_life_basis',
    'shelf_life_basis_note',
  ],
  schema: templates.product.schema.extend({
    shelf_life_days: z.int().positive().max(36500).optional(),
    shelf_life_basis: z.enum(['PRODUCTION_DATE', 'PACKAGING_DATE', 'OTHER']).optional(),
    shelf_life_basis_note: text.optional(),
  }),
};
export const latestTemplateVersion = (name: TemplateId) => (name === 'product' ? 2 : 1);
export function templateFor(name: TemplateId, version = 1) {
  if (name === 'product' && version === 2) return productV2;
  if (version === 1 && Object.hasOwn(templates, name)) return templates[name];
  throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Unsupported template version.', {
    template_id: name,
    template_version: version,
  });
}
export function templateDefinition(name: TemplateId, version = 1) {
  const t = templateFor(name, version);
  return {
    id: name,
    version,
    name,
    target_kind: t.target_kind,
    allowed_catalog_node_kinds: t.target_kind === 'CATALOG_NODE' ? ['SKU'] : [],
    paths: t.paths,
    schema: z.toJSONSchema(t.schema),
    fields_optional: true,
  };
}
export function validateValues(name: TemplateId, values: unknown, version = 1): any {
  const result = templateFor(name, version).schema.safeParse(values);
  if (!result.success)
    throw new DomainError(
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid template values.',
      result.error.issues,
    );
  const v: any = result.data;
  const fail = (message: string) => {
    throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', message);
  };
  if (name === 'lifecycle' && v.opening?.state === 'SEALED' && v.opening.opened_at)
    fail('SEALED cannot have opened_at.');
  const m = v.net_content ?? v.remaining;
  if (m) {
    const d = new Decimal(m.value);
    if (name === 'product' && !d.gt(0)) fail('Net content must be positive.');
    if (m.unit === 'count' && !d.isInteger()) fail('count must be an integer.');
    if (m.unit === 'percent' && d.gt(100)) fail('percent must be at most 100.');
  }
  if (v.rated_power_w && !new Decimal(v.rated_power_w).gt(0)) fail('Power must be positive.');
  if (v.barcodes && new Set(v.barcodes).size !== v.barcodes.length) fail('Duplicate barcodes.');
  return v;
}
export const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ITEM'), id: uuid }),
  z.strictObject({ kind: z.literal('CATALOG_NODE'), id }),
]);
export type Target = z.infer<typeof target>;
const revisions = z
  .record(z.union([id, uuid]), z.int().positive())
  .describe(
    '必填：全部待修改对象的完整 ID 到当前 revision 的映射。例如 {"item_11111111-1111-4111-8111-000000000001":1}。从读取结果取得版本；成功后采用 affected_objects.after_revision；冲突后重新读取并核对，不直接替换版本重试。',
  );
const write = {
  idempotency_key: z.string().min(1).max(200),
  expected_revisions: revisions,
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  approval_id: z.uuid().optional(),
};
// Creation keeps the original normalization for persisted idempotency fingerprints.
const create = {
  ...write,
  expected_revisions: revisions
    .default({})
    .describe('创建新对象不需要旧版本，可省略；保留此字段以兼容既有幂等请求。'),
};
const attr = { template_id: templateId, template_version: z.union([z.literal(1), z.literal(2)]) };
const values = z.record(z.string(), z.unknown());
const patchShape = {
  ...attr,
  set: z.record(z.string(), z.unknown()).default({}),
  unset: z.array(z.string()).max(50).default([]),
};
const initial = z
  .array(z.strictObject({ ...attr, values }))
  .max(7)
  .optional();
const page = {
  limit: z.int().min(1).max(200).default(100),
  cursor: z.string().max(200).optional(),
};
const filters = z
  .array(
    z.strictObject({
      template_id: templateId,
      path: z.string().max(100),
      op: z.enum(['eq', 'gte', 'lte']),
      value: z.unknown(),
    }),
  )
  .max(20)
  .optional();
export const schemas = {
  ...intakeSchemas,
  get_connection_context: z.strictObject({}),
  create_items_batch: z.strictObject({
    ...create,
    items: z
      .array(
        z.strictObject({
          client_ref: z.string().min(1).max(100),
          catalog_node_id: id,
          parent_id: uuid.nullable().default(null),
          display_name: text.optional(),
          initial_attributes: initial,
        }),
      )
      .min(1)
      .max(100),
  }),
  update_items_lifecycle: z.strictObject({
    ...write,
    items: z
      .array(
        z.strictObject({
          item_id: uuid,
          template_version: z.literal(1),
          set: patchShape.set,
          unset: patchShape.unset,
        }),
      )
      .min(1)
      .max(100),
  }),
  upgrade_attributes: z.strictObject({
    ...write,
    target: z.strictObject({ kind: z.literal('CATALOG_NODE'), id }),
    template_id: z.literal('product'),
    template_version: z.literal(2),
    values,
  }),
  query_catalog_nodes: z.strictObject({
    ...page,
    include_path: z.boolean().default(false),
    name: z.string().max(500).optional(),
    barcode: z.string().max(128).optional(),
    catalog_subtree_id: id.optional(),
    include_hidden: z.boolean().default(false),
    attribute_filters: filters,
  }),
  get_catalog_node: z.strictObject({
    catalog_node_id: id,
    include_path: z.boolean().default(false),
  }),
  create_catalog_node: z.strictObject({
    ...create,
    kind: z.enum(['GROUP', 'SKU']),
    name: catalogName,
    parent_id: id.nullable().default(null),
    initial_attributes: initial,
  }),
  update_catalog_node: z.strictObject({ ...write, catalog_node_id: id, name: catalogName }),
  move_catalog_node: z.strictObject({ ...write, catalog_node_id: id, parent_id: id.nullable() }),
  query_items: z.strictObject({
    ...page,
    include_path: z.boolean().default(false),
    name: z.string().max(500).optional(),
    barcode: z.string().max(128).optional(),
    catalog_node_ids: z.array(id).max(100).optional(),
    catalog_subtree_id: id.optional(),
    within_item_id: uuid.optional(),
    attribute_filters: filters,
  }),
  get_item: z.strictObject({ item_id: uuid, include_path: z.boolean().default(false) }),
  create_items: z.strictObject({
    ...create,
    catalog_node_id: id,
    parent_id: uuid.nullable().default(null),
    count: z.int().min(1).max(100),
    display_name: text.optional(),
    initial_attributes: initial,
  }),
  update_item: z.strictObject({ ...write, item_id: uuid, display_name: text.nullable() }),
  move_item: z.strictObject({ ...write, item_id: uuid, parent_id: uuid.nullable() }),
  move_items: z.strictObject({
    ...write,
    item_ids: z.array(uuid).min(1).max(100),
    parent_id: uuid.nullable(),
  }),
  edit_item: z.strictObject({
    ...write,
    item_id: uuid,
    display_name: text.nullable().optional(),
    availability: templates.lifecycle.schema.shape.availability.unwrap().nullable().optional(),
    acquired_on: z.iso.date().nullable().optional(),
    note: z
      .strictObject({ note_id: entityId('note').optional(), body: z.string().max(100000) })
      .optional(),
  }),
  open_item: z.strictObject({
    ...write,
    item_id: uuid,
    opened_at: z.iso.datetime({ offset: true }).optional(),
  }),
  consume_items: z.strictObject({ ...write, item_ids: z.array(uuid).min(1).max(100) }),
  consume_item_content: z.strictObject({
    ...write,
    item_id: uuid,
    amount: measurement,
    accuracy: z.enum(['ESTIMATED', 'MEASURED']).optional(),
  }),
  correct_item: z.strictObject({
    ...write,
    item_id: uuid,
    reason: text,
    core: z.strictObject({ catalog_node_id: id }).optional(),
    attributes: z.array(z.strictObject(patchShape)).max(7).optional(),
  }),
  list_attribute_templates: z.strictObject({
    target_kind: z.enum(['ITEM', 'CATALOG_NODE']).optional(),
  }),
  get_attribute_template: z.strictObject(attr),
  get_attribute_sets: z.strictObject({ target }),
  bind_attributes: z.strictObject({ ...write, target, ...attr, values }),
  update_attributes: z.strictObject({ ...write, target, ...patchShape }),
  remove_attributes: z.strictObject({ ...write, target, ...attr }),
  add_note: z.strictObject({
    ...write,
    item_id: uuid,
    title: text.optional(),
    body: z.string().max(100000),
  }),
  update_note: z.strictObject({
    ...write,
    item_id: uuid,
    note_id: entityId('note'),
    title: text.nullable().optional(),
    body: z.string().max(100000),
  }),
  get_history: z.strictObject({
    ...page,
    target: target.optional(),
    operation_id: entityId('operation').optional(),
  }),
};
export type Operation = keyof typeof schemas;
export const reads = new Set<Operation>([
  'get_intake_context',
  'get_intake_receipt',
  'get_catalog_policy',
  'get_connection_context',
  'query_catalog_nodes',
  'get_catalog_node',
  'query_items',
  'get_item',
  'list_attribute_templates',
  'get_attribute_template',
  'get_attribute_sets',
  'get_history',
]);
export const descriptions: Record<Operation, string> = {
  get_intake_context:
    '日常入库先批量查询整批名称、已知位置和明确 ID，获得当前规范、候选与版本。检索覆盖范围不等于语义上全库无匹配；截断时继续查询。',
  commit_intake:
    '在用户已授权范围内一次原子入库整批物品，复用商品，必要分类和新商品一起提交。共同信息放 defaults，逐件差异放 instances；不猜数量、日期、精度，不夹带目录治理。成功回执即实际结果，超时保留原键与参数。',
  get_intake_receipt: '按操作 ID 或原幂等键读取已提交入库回执。未找到不代表可换键重试。',
  get_catalog_policy: '读取家庭当前已确认分类规范及版本。历史目录不自动等于规范。',
  propose_catalog_change:
    '提出具体规范变更、仅本次入库例外或独立目录治理；只保存提案，必须在插件确认卡片确认后生效。不得为普通入库主动整理旧目录。',

  get_connection_context:
    '读取当前连接的服务、账号/操作者、家庭、时区及权限；不能用参数切换身份。多连接时先辨认目标家庭。',
  create_items_batch:
    '将 1–100 包不同规格的实物一次入库，每条一个独立 ID。每条 client_ref 必须唯一；尽量同时提供已知位置、重量和日期。整批成功或回滚；同键同参数重试返回原 ID。创建商品 SKU 不会新增库存。',
  update_items_lifecycle:
    '原子更新明确物品的生命周期；每条使用 lifecycle v1 的 set/unset，全部 item_id 必须提供 expected_revisions，任一失败整批回滚。',
  upgrade_attributes:
    '显式升级已绑定的 product v1 至 v2；提交完整目标 values 和目标 template_version=2，保留需继续使用的旧值。须提供对象 revision；不会从规格文字推断保质期。',
  query_catalog_nodes:
    '查询分类 GROUP、商品 SKU、名称和条码，返回稳定 ID 和版本。建商品前先查同款及相关分类分支，include_path=true 返回 path_ids，补读未知节点名称并沿 next_cursor 翻页；按含义和完整路径复用，不只匹配短名称，不因首屏未找到就创建。近义名称或多条合理路径有歧义时先确认。',
  get_catalog_node:
    '读取一个目录节点及其模板属性。include_path=true 返回 path_ids；按需补读路径节点名称，核对完整分类路径、GROUP/SKU 类型及修改前 revision。',
  create_catalog_node:
    '独立目录创建须有对应治理提案的界面确认；日常入库使用 commit_intake。GROUP表达分类，SKU为商品叶节点，创建商品资料不等于实物入库。',
  update_catalog_node: '修改目录名称，稳定 ID 不变。',
  move_catalog_node:
    '在用户已授权整理目录时移动原 GROUP 或 SKU，保留稳定 ID 和库存关联，不改变实物位置；不通过重建商品修复归类。先读取原节点 revision 并核对目标完整分类路径，歧义先确认；提交 expected_revisions。非根父节点必须是 GROUP，禁止环和跨家庭引用；移动后核对完整路径。',
  query_items:
    '查询具体实例、位置路径、版本和库存统计；未知不等于 ACTIVE 或 AVAILABLE。多个候选必须请用户确认，不自动选取。',
  get_item: '读取明确 UUID 的物品、模板值、位置、文字笔记和版本。',
  create_items:
    '创建 count 个不同 UUID 的实例；相同规格共用明确初始属性。请同时提供已知 parent_id、contents 重量及 lifecycle 日期，减少补写；不同规格用 create_items_batch。创建 SKU 不等于入库。',
  update_item: '修改明确 UUID 的显示名。',
  move_item: '移动明确 UUID 的物品或容器，后代相对位置不变。',
  move_items: '将明确选择的物品原子地移至同一位置；全部版本必须匹配，任一失败则全部回滚。',
  edit_item:
    '原子编辑一件实物的名称、可用状态、购入日期和指定备注；未提供的可选字段保持不变，不修改同款商品资料。',
  open_item:
    '开封用户明确指定的 UUID。多个候选必须先询问用户。opened_at 仅填写用户提供的已知时间。',
  consume_items: '整件消耗用户明确指定的 item_ids，不接受自动选取或 FEFO。',
  consume_item_content:
    '从明确 UUID 扣减正数内容量。需要已知剩余量，不从 SKU 猜测。percent 是初始内容的百分点。',
  correct_item: '带原因纠正明确 UUID 的属性或商品关联，可修复终结状态。',
  list_attribute_templates: '发现内置七种可选属性模板的最新版本；已有绑定使用其固定版本。',
  get_attribute_template: '读取指定模板版本和允许字段。',
  get_attribute_sets: '读取目标已绑定的模板和值。',
  bind_attributes: '绑定尚未存在的模板，不覆盖已有值。',
  update_attributes: '按模板内路径 set/unset 更新，未涉及字段保留；Measurement 整体更新。',
  remove_attributes: '移除目标模板，不能绕过容纳或生命周期约束。',
  add_note: '为明确 UUID 添加文字笔记；不隐式修改库存。',
  update_note: '修改属于明确 UUID 的文字笔记。',
  get_history: '查询对象或操作的追加式历史。',
};

export const creates = new Set<Operation>([
  'create_catalog_node',
  'create_items',
  'create_items_batch',
]);
export function parseCommand(name: Operation, raw: unknown): any {
  // Classify missing versions before Zod's required-field error. Never infer a revision.
  if (
    !reads.has(name) &&
    !creates.has(name) &&
    name !== 'propose_catalog_change' &&
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw)
  ) {
    const input = raw as Record<string, any>;
    if (input.expected_revisions === undefined)
      throw new DomainError(
        'MISSING_EXPECTED_REVISION',
        'Supply revisions for every target before writing.',
      );
  }
  const parsed = schemas[name].safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues.find(
      (i) => i.path[0] === 'items' && typeof i.path[1] === 'number',
    );
    const index = issue?.path[1] as number | undefined;
    throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid command input.', {
      issues: parsed.error.issues,
      ...(index === undefined
        ? {}
        : { item_index: index, client_ref: (raw as any)?.items?.[index]?.client_ref }),
    });
  }
  const input: any = parsed.data;
  if (
    !reads.has(name) &&
    !creates.has(name) &&
    name !== 'propose_catalog_change' &&
    name !== 'commit_intake'
  ) {
    const ids: string[] = input.item_ids ??
      input.items?.map((i: any) => i.item_id) ?? [
        input.target?.id ?? input.item_id ?? input.catalog_node_id,
      ];
    const missing = ids.filter((id) => !Object.hasOwn(input.expected_revisions, id));
    if (missing.length)
      throw new DomainError(
        'MISSING_EXPECTED_REVISION',
        'Supply revisions for every target before writing.',
        { missing_ids: missing },
      );
  }
  return input;
}
