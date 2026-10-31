export * from './semantics.js';
export * from './units.js';
import { dispositionSchema, referenceSchema } from './semantics.js';
export * from './registry.js';
import { templates, templateId, measurement, profileSchema, capabilitySchema } from './registry.js';
import {
  deadlineTemplate,
  deadlineServiceTemplate,
  deadlineInput,
  deadlineId,
  dateFilter,
} from './deadline.js';
export type {
  DeadlineEntry,
  DeadlineKind,
  DateFact,
  DateFilter,
  DateSource,
  DateState,
} from './deadline.js';
import { fileSchemas, fileReads, fileOperations } from './notes.js';
export * from './notes.js';
import { intakeSchemas } from './intake.js';
import { entityId } from './ids.js';
import { z } from 'zod';
import { DomainError } from '../../domain/src/index.js';
const text = z.string().min(1).max(500),
  id = entityId('catalog_node'),
  uuid = entityId('item');
// Keep the nonblank check on the server: some connectors misinterpret an exported /\S/ pattern.
// Do not trim names; parsed input is also used for idempotency fingerprints.
const catalogName = text.refine((value) => /\S/.test(value), 'Name must not be blank.');

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
const attr = { template_id: templateId, template_version: z.int().positive() };
const values = z.record(z.string(), z.unknown());
const patchShape = {
  ...attr,
  set: z.record(z.string(), z.unknown()).default({}),
  unset: z.array(z.string()).max(50).default([]),
};
const initial = z
  .array(z.strictObject({ ...attr, values }))
  .max(16)
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
const itemQuerySchema = z.strictObject({
    ...page,
    cursor: z.string().optional(),
    sort: z
      .strictObject({
        field: z.enum(['created_at', 'updated_at', 'name', 'reminder_date']).default('created_at'),
        direction: z.enum(['asc', 'desc']).default('desc'),
      })
      .default({ field: 'created_at', direction: 'desc' }),
    search: z.string().max(500).optional(),
    include_path: z.boolean().default(false),
    name: z.string().max(500).optional(),
    barcode: z.string().max(128).optional(),
    catalog_node_ids: z.array(id).max(100).optional(),
    catalog_subtree_id: id.optional(),
    within_item_id: uuid.optional(),
    date_filters: z.array(dateFilter).max(20).optional(),
    include_void: z.boolean().default(false),
    include_terminal: z.boolean().default(false),
    profile: profileSchema.optional(),
    capabilities: z.array(capabilitySchema).optional(),
    attribute_filters: filters,
  });
export const schemas = {
  ...intakeSchemas,
  query_references: z.strictObject({ target: referenceSchema }),
  query_stock: z.strictObject({
    ...page,
    cursor: z.string().optional(),
    catalog_node_ids: z.array(id).max(100).optional(),
    catalog_subtree_id: id.optional(),
    within_item_id: uuid.optional(),
    low_only: z.boolean().default(false),
  }),
  void_item: z.strictObject({ ...write, item_id: uuid, reason: text }),
  void_catalog_node: z.strictObject({ ...write, catalog_node_id: id, reason: text }),
  dispose_item: z.strictObject({ ...write, item_id: uuid, disposition: dispositionSchema }),
  split_item: z.strictObject({
    ...write,
    source_item_id: uuid,
    target_catalog_node_id: id,
    count: z.int().min(1).max(100),
    child_attributes: initial,
    reason: text.optional(),
  }),
  add_deadline: z.strictObject({ ...write, item_id: uuid, entry: deadlineInput }),
  update_deadline: z.strictObject({
    ...write,
    item_id: uuid,
    entry_id: deadlineId,
    patch: deadlineInput.partial(),
  }),
  remove_deadline: z.strictObject({ ...write, item_id: uuid, entry_id: deadlineId }),
  complete_deadline: z.strictObject({
    ...write,
    item_id: uuid,
    entry_id: deadlineId,
    completed_on: z.iso.date(),
  }),
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
          template_version: z.int().positive(),
          set: patchShape.set,
          unset: patchShape.unset,
        }),
      )
      .min(1)
      .max(100),
  }),
  upgrade_attributes: z
    .strictObject({
      ...write,
      target,
      template_id: templateId,
      from_version: z.int().positive().optional(),
      to_version: z.int().positive().optional(),
      template_version: z.int().positive().optional(),
      values,
    })
    .refine(
      (v) =>
        (v.from_version !== undefined &&
          v.to_version !== undefined &&
          v.template_version === undefined) ||
        (v.template_version !== undefined &&
          v.from_version === undefined &&
          v.to_version === undefined),
      'Supply from_version/to_version, or the legacy template_version.',
    ),
  query_catalog_nodes: z.strictObject({
    ...page,
    cursor: z.string().optional(),
    sort: z
      .strictObject({
        field: z.enum(['created_at', 'updated_at', 'name']).default('created_at'),
        direction: z.enum(['asc', 'desc']).default('desc'),
      })
      .default({ field: 'created_at', direction: 'desc' }),
    search: z.string().max(500).optional(),
    kind: z.enum(['GROUP', 'SKU']).optional(),
    include_path: z.boolean().default(false),
    name: z.string().max(500).optional(),
    barcode: z.string().max(128).optional(),
    catalog_subtree_id: id.optional(),
    include_hidden: z.boolean().default(false),
    include_void: z.boolean().default(false),
    include_one_off: z.boolean().default(false),
    profile: profileSchema.optional(),
    capabilities: z.array(capabilitySchema).optional(),
    attribute_filters: filters,
  }),
  get_catalog_node: z.strictObject({
    catalog_node_id: id,
    include_path: z.boolean().default(false),
  }),
  create_catalog_node: z.strictObject({
    ...create,
    profile: profileSchema.nullable().optional(),
    capabilities: z.array(capabilitySchema).nullable().optional(),
    one_off: z.boolean().optional(),
    kind: z.enum(['GROUP', 'SKU']),
    name: catalogName,
    parent_id: id.nullable().default(null),
    initial_attributes: initial,
  }),
  update_catalog_node: z.strictObject({
    ...write,
    catalog_node_id: id,
    name: catalogName.optional(),
    profile: profileSchema.nullable().optional(),
    capabilities: z.array(capabilitySchema).nullable().optional(),
    one_off: z.boolean().optional(),
  }),
  move_catalog_node: z.strictObject({ ...write, catalog_node_id: id, parent_id: id.nullable() }),
  query_items: itemQuerySchema,
  query_inventory_groups: itemQuerySchema.omit({ include_path: true, sort: true }),
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
    record_state: z.literal('VALID').optional(),
    item_id: uuid,
    reason: text,
    core: z.strictObject({ catalog_node_id: id }).optional(),
    attributes: z.array(z.strictObject(patchShape)).max(16).optional(),
  }),
  list_attribute_templates: z.strictObject({
    target_kind: z.enum(['ITEM', 'CATALOG_NODE']).optional(),
    catalog_node_id: id.optional(),
    profile: profileSchema.nullable().optional(),
    capability: capabilitySchema.optional(),
  }),
  get_attribute_template: z.strictObject({
    ...attr,
    template_id: z.enum([...templateId.options, 'deadline', 'service']),
  }),
  get_attribute_sets: z.strictObject({ target }),
  bind_attributes: z.strictObject({ ...write, target, ...attr, values }),
  update_attributes: z.strictObject({ ...write, target, ...patchShape }),
  remove_attributes: z.strictObject({ ...write, target, ...attr }),
  ...fileSchemas,
  get_history: z.strictObject({
    ...page,
    cursor: z.string().optional(),
    event_type: z.string().min(1).max(100).optional(),
    recorded_from: z.iso.datetime({ offset: true }).optional(),
    recorded_to: z.iso.datetime({ offset: true }).optional(),
    target: target.optional(),
    operation_id: entityId('operation').optional(),
  }),
};
export type Operation = keyof typeof schemas;
export const reads = new Set<Operation>([
  'query_stock',
  'query_references',
  ...(fileReads as Set<Operation>),
  'get_intake_context',
  'get_intake_receipt',
  'get_catalog_policy',
  'get_connection_context',
  'query_catalog_nodes',
  'get_catalog_node',
  'query_items',
  'query_inventory_groups',
  'get_item',
  'list_attribute_templates',
  'get_attribute_template',
  'get_attribute_sets',
  'get_history',
]);
export const descriptions: Record<Operation, string> = {
  query_references: '查询同家庭对象的反向引用。',
  query_stock: '按 SKU 的 COUNT 或 CONTENT 策略查询完整范围的补货状态，未知量单列。',
  void_item: '作废误建实物，保留身份和历史。',
  void_catalog_node: '通过目录治理审批作废无引用 SKU。',
  dispose_item: '原子记录处置事实并置为 DISPOSED。',
  split_item: '整包拆成同一明确 SKU；显式子件内容必须守恒。',
  add_deadline: '按物品添加期限，服务端生成稳定条目 ID。',
  update_deadline: '按稳定条目 ID 修改期限，不接受数组下标或完成日。',
  remove_deadline: '按稳定条目 ID 移除期限，历史事件保留。',
  complete_deadline:
    '以明确完成日完成期限；周期从完成日推进，维护完成同时记录 service.last_service_on。',
  query_inventory_groups: '按 query_items 的完整匹配集合读取服务端商品分组与统计。',
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
    '按登记的升级规则显式升级绑定；提交 from_version、to_version、完整目标 values 和对象 revision；保留需继续使用的旧值。',
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
  list_attribute_templates:
    '发现已登记模板的最新版本，可按对象、档案和能力筛选；已有绑定使用其固定版本。',
  get_attribute_template: '读取指定模板版本和允许字段。',
  get_attribute_sets: '读取目标已绑定的模板和值。',
  bind_attributes: '绑定尚未存在的模板，不覆盖已有值。',
  update_attributes: '按模板内路径 set/unset 更新，未涉及字段保留；Measurement 整体更新。',
  remove_attributes: '移除目标模板，不能绕过容纳或生命周期约束。',
  add_note: '为 Item 或 CatalogNode 添加笔记并更新目标版本。',
  archive_note: '归档或恢复笔记并更新目标版本。',
  list_notes: '列出笔记摘要，不返回正文。',
  get_note: '读取笔记正文；敏感原文需显式展开并审计。',
  create_attachment_upload: '预留私有附件上传会话。',
  complete_attachment_upload: '确认上传并关联到目标。',
  detach_attachment: '解除附件关联。',
  list_attachments: '列出附件元数据摘要。',
  update_note: '修改属于明确 UUID 的文字笔记。',
  get_history: '查询对象或操作的追加式历史。',
};

export const creates = new Set<Operation>([
  'create_attachment_upload',
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
    name !== 'commit_intake' &&
    !fileOperations.has(name)
  ) {
    const ids: string[] = input.item_ids ??
      input.items?.map((i: any) => i.item_id) ?? [
        input.target?.id ?? input.item_id ?? input.source_item_id ?? input.catalog_node_id,
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

export * as syncContracts from './sync.js';
