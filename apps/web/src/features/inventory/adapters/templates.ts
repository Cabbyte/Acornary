import type {
  TemplateDefinitionV2,
  TemplateFieldV2,
} from '../../../../../../packages/contracts/src/read-v2.js';

export interface LegacyTemplateDefinition {
  id: string;
  version: number;
  name: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  allowed_catalog_node_kinds: ('GROUP' | 'SKU')[];
  paths: string[];
  schema?: Record<string, unknown>;
  fields_optional?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const unwrapSchema = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = value[key];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const candidate = unwrapSchema(branch);
      if (candidate && (typeof candidate.type === 'string' || Array.isArray(candidate.enum)))
        return candidate;
    }
  }
  return value;
};

const schemaAt = (
  schema: Record<string, unknown> | undefined,
  path: string,
): Record<string, unknown> | null => {
  let current: unknown = schema;
  for (const segment of path.split('.')) {
    const node = unwrapSchema(current);
    if (!node || !isRecord(node.properties)) return null;
    current = node.properties[segment];
  }
  return unwrapSchema(current);
};

const inferType = (node: Record<string, unknown> | null): TemplateFieldV2['type'] => {
  if (!node) return 'string';
  if (Array.isArray(node.enum) && node.enum.every((value) => typeof value === 'string'))
    return 'enum';
  switch (node.type) {
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'string':
      if (node.format === 'date') return 'date';
      if (node.format === 'date-time') return 'datetime';
      if (node.format === 'uri' || node.format === 'url') return 'url';
      return 'string';
    case 'object': {
      const properties = isRecord(node.properties) ? node.properties : null;
      if (properties && 'value' in properties && 'unit' in properties) return 'measurement';
      return 'string';
    }
    default:
      return 'string';
  }
};

export function deriveTemplateFields(
  paths: readonly string[],
  schema?: Record<string, unknown>,
): TemplateFieldV2[] {
  return paths.map((path, order) => ({
    path,
    label: path.split('.').at(-1) || path,
    type: inferType(schemaAt(schema, path)),
    section: '资料',
    order,
  }));
}

export function adaptTemplateDefinition(
  raw: TemplateDefinitionV2 | LegacyTemplateDefinition,
): TemplateDefinitionV2 {
  const candidate = raw as Partial<TemplateDefinitionV2>;
  const fields = Array.isArray(candidate.fields)
    ? candidate.fields.map((field) => ({ ...field }))
    : deriveTemplateFields(raw.paths, raw.schema);
  return {
    id: raw.id,
    version: raw.version,
    name: raw.name,
    target_kind: raw.target_kind,
    ...(candidate.capability ? { capability: candidate.capability } : {}),
    allowed_catalog_node_kinds: [...(raw.allowed_catalog_node_kinds ?? [])],
    paths: [...(raw.paths ?? [])],
    fields,
    ...(raw.schema ? { schema: raw.schema } : {}),
  };
}
