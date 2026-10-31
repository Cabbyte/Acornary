import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { DomainError } from '../../domain/src/index.js';
const text = z.string().min(1).max(500);

export const profileSchema = z.enum(['CONSUMABLE', 'DURABLE', 'WEARABLE', 'SPACE', 'MISC']);
export type Profile = z.infer<typeof profileSchema>;
export const capabilitySchema = z.enum([
  'lifecycle.expiry',
  'lifecycle.opening',
  'contents',
  'stock',
  'asset',
  'custody',
  'service',
  'deadline',
  'clothing',
  'wardrobe',
  'container',
  'usage',
  'transport',
]);
export type CapabilityKey = z.infer<typeof capabilitySchema>;
export type RecordState = 'VALID' | 'VOID';
export type BindingStatus = 'KNOWN' | 'UNKNOWN' | 'RETIRED';
const profileDefaults: Record<Profile, readonly CapabilityKey[]> = {
  CONSUMABLE: ['lifecycle.expiry', 'lifecycle.opening', 'contents', 'stock'],
  DURABLE: ['asset', 'custody', 'service', 'deadline'],
  WEARABLE: ['clothing', 'wardrobe', 'asset', 'custody', 'service'],
  SPACE: ['container'],
  MISC: ['asset', 'custody'],
};
export function resolveCapabilities(
  profile: Profile | null,
  capabilities: readonly CapabilityKey[] | null,
): CapabilityKey[] {
  return [...(capabilities ?? (profile ? profileDefaults[profile] : []) ?? [])];
}
export interface TemplateField {
  path: string;
  label: string;
  type:
    | 'string'
    | 'number'
    | 'decimal'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'measurement'
    | 'reference'
    | 'url';
  section: string;
  order: number;
  widget?:
    | 'text'
    | 'textarea'
    | 'select'
    | 'date'
    | 'number'
    | 'switch'
    | 'measurement'
    | 'reference'
    | 'photo'
    | 'link';
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
  sensitivity?: 'NORMAL' | 'SENSITIVE' | 'SECRET';
}
export interface TemplateDefinition {
  id: string;
  version: number;
  name: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  capability?: CapabilityKey;
  allowed_catalog_node_kinds: ('GROUP' | 'SKU')[];
  paths: string[];
  fields: TemplateField[];
  schema?: Record<string, unknown>;
  fields_optional?: boolean;
}
const templateCapabilities: Partial<Record<TemplateId, CapabilityKey>> = {
  contents: 'contents',
  container: 'container',
  clothing: 'clothing',
};
// Fine-grained capabilities select field groups; base lifecycle facts always remain available.
export function pathCapability(id: string, path: string): CapabilityKey | undefined {
  if (id === 'lifecycle' && path.startsWith('expiry.')) return 'lifecycle.expiry';
  if (id === 'lifecycle' && path.startsWith('opening.')) return 'lifecycle.opening';
  return templateCapabilities[id as TemplateId];
}
const labels: Record<string, string> = {
  brand: '品牌',
  model: '型号',
  specification: '规格',
  barcodes: '条码',
  net_content: '净含量',
  'storage.requirement': '储存要求',
  state: '状态',
  condition: '品相',
  availability: '可用状态（旧资料）',
  'opening.state': '开封状态',
  'opening.opened_at': '开封时间',
  'expiry.date': '到期日',
  'expiry.date_kind': '日期性质',
  'expiry.after_opening_days': '开封后天数',
  'acquisition.acquired_on': '购入日期',
  'acquisition.batch_label': '批次',
  remaining: '剩余量',
  accuracy: '精度',
  can_contain: '可以容纳物品',
  visibility: '可见性',
  material: '材质',
  color: '颜色',
  size: '尺码',
  connector: '接口',
  rated_power_w: '额定功率',
  shelf_life_days: '保质天数',
  shelf_life_basis: '保质期起算依据',
  shelf_life_basis_note: '起算依据说明',
};
function fieldMetadata(id: string, path: string, order: number, schema: any): TemplateField {
  const node = path.split('.').reduce((s, key) => s?.properties?.[key], schema) ?? {};
  const type: TemplateField['type'] = node.enum
    ? 'enum'
    : node.format === 'date'
      ? 'date'
      : node.format === 'date-time'
        ? 'datetime'
        : node.type === 'boolean'
          ? 'boolean'
          : node.type === 'integer' || node.type === 'number'
            ? 'number'
            : node.type === 'object' && node.properties?.unit
              ? 'measurement'
              : path === 'rated_power_w'
                ? 'decimal'
                : 'string';
  return {
    path,
    label: labels[path] ?? path,
    type,
    section: path.includes('.') ? path.split('.')[0] : id,
    order,
    widget:
      type === 'enum'
        ? 'select'
        : type === 'boolean'
          ? 'switch'
          : type === 'measurement'
            ? 'measurement'
            : type === 'number' || type === 'decimal'
              ? 'number'
              : type === 'date'
                ? 'date'
                : path === 'barcodes' || path.endsWith('_note')
                  ? 'textarea'
                  : 'text',
    ...(node.enum ? { options: node.enum.map((value: string) => ({ value, label: value })) } : {}),
    ...(path === 'rated_power_w' ? { unit: 'W' } : path.endsWith('_days') ? { unit: 'day' } : {}),
    ...(path === 'availability' ? { help: '旧资料；不推断持有人或综合可用性。' } : {}),
    ...(path === 'barcodes' ? { help: '多个条码按数组提交。' } : {}),
  };
}

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
// Published versions and explicit upgrade edges; adding a version does not rewrite old schemas.
export const registry = [
  ...Object.entries(templates).map(([id, template]) => ({
    id: id as TemplateId,
    version: 1,
    ...template,
    retired: false,
    upgrade_from: [] as number[],
  })),
  { id: 'product' as const, version: 2, ...productV2, retired: false, upgrade_from: [1] },
];
export const templateId = z.enum([
  ...new Set(registry.filter((t) => !t.retired).map((t) => t.id)),
] as [TemplateId, ...TemplateId[]]);
export const latestTemplateVersion = (name: TemplateId) =>
  Math.max(...registry.filter((t) => t.id === name && !t.retired).map((t) => t.version));
export const findTemplate = (name: string, version: number) =>
  registry.find((t) => t.id === name && t.version === version);
export function templateFor(name: string, version = 1) {
  const template = findTemplate(name, version);
  if (template && !template.retired) return template;
  throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Unknown or retired template is read-only.');
}
export function canUpgrade(name: string, from: number, to: number) {
  const source = findTemplate(name, from),
    destination = findTemplate(name, to);
  return (
    !!source &&
    !source.retired &&
    !!destination &&
    !destination.retired &&
    destination.upgrade_from.includes(from)
  );
}
export function templateDefinition(name: TemplateId, version = 1): TemplateDefinition {
  const t = templateFor(name, version);
  const schema = z.toJSONSchema(t.schema);
  return {
    id: name,
    version,
    name,
    target_kind: t.target_kind,
    allowed_catalog_node_kinds: t.target_kind === 'CATALOG_NODE' ? ['SKU'] : [],
    paths: [...t.paths],
    schema,
    fields_optional: true,
    ...(templateCapabilities[name] ? { capability: templateCapabilities[name] } : {}),
    fields: t.paths.map((path, order) => fieldMetadata(name, path, order, schema)),
  };
}
export function validateValues(name: string, values: unknown, version = 1): any {
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
