import { z } from 'zod';

// query is validated with the existing kind-specific query schema on the server.
// Browse cursor/limit are not accepted here; read_export owns pagination.
const selection = {
  kind: z.enum(['ITEM', 'CATALOG_NODE']),
  query: z.record(z.string(), z.unknown()).default({}),
  include_sensitive: z.boolean().default(false),
};
const exportId = z.string().regex(/^export_[0-9a-f-]{36}$/);
export const exportSchemas = {
  begin_export: z.strictObject(selection),
  read_export: z.strictObject({
    ...selection,
    export_id: exportId,
    cursor: z.string().max(2048).optional(),
    limit: z.int().min(1).max(200).default(100),
    generation: z.uuid().optional(),
    query_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
  cancel_export: z.strictObject({ export_id: exportId }),
};
export type ExportOperation = keyof typeof exportSchemas;
export const exportOperations = new Set<string>(Object.keys(exportSchemas));
export const exportReads: ExportOperation[] = ['begin_export', 'read_export', 'cancel_export'];
export const exportDescriptions = {
  begin_export: '冻结物品或目录查询结果一小时；默认脱敏，原文需 include_sensitive=true 并审计。',
  read_export: '按签名游标读取私有冻结 JSON 行；重复原查询和披露选择，失效时重新 begin_export。',
  cancel_export: '释放当前家庭与操作者的冻结结果；不修改库存。',
};
export type BeginExport = z.input<typeof exportSchemas.begin_export>;
export type ReadExport = z.input<typeof exportSchemas.read_export>;
export type CancelExport = z.input<typeof exportSchemas.cancel_export>;
export type ExportMetadata = {
  export_id: string;
  generation: string;
  query_hash: string;
  disclosure_mode: 'REDACTED' | 'SENSITIVE';
  as_of_change_id: string;
  matching_count: number;
  summary: Record<string, unknown>;
  expires_at: string;
};
export type ExportPage = ExportMetadata & {
  data: Record<string, unknown>[];
  next_cursor: string | null;
};
