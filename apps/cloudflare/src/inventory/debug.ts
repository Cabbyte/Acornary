import { createHash } from 'node:crypto';
import { redactFor } from './redaction.js';
import { z } from 'zod';
import { target } from '../../../../packages/contracts/src/index.js';
import { DomainError, requireFact } from '../../../../packages/domain/src/index.js';
import { query, transaction } from './db.js';
import { type Context } from './service.js';
export const debugTables = [
  'households',
  'actors',
  'catalog_nodes',
  'items',
  'attribute_templates',
  'notes',
  'events',
  'operations',
  'barcode_index',
  'installations',
  'migrations',
  'catalog_policy_versions',
  'catalog_proposals',
  'catalog_identity_keys',
  'attachments',
  'attachment_blobs',
  'upload_sessions',
  'item_splits',
  'attribute_references',
] as const;
const schema = z.strictObject({
  view: z.enum(['object', 'system']),
  table: z.enum(debugTables),
  target: target.optional(),
  id: z.string().max(150).optional(),
  template_id: z.string().max(100).optional(),
  template_version: z.int().positive().optional(),
  limit: z.int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
export function debugRead(ctx: Context, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError(
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid debug query.',
      parsed.error.issues,
    );
  const input = parsed.data;
  return transaction(ctx.db, (c) => {
    requireFact(
      query(c, 'SELECT 1 FROM actors WHERE household_id=?1 AND id=?2', [
        ctx.household_id,
        ctx.actor_id,
      ]).rows.length,
      'FORBIDDEN',
      'Invalid household context.',
    );
    const table = input.table,
      params: any[] = [ctx.household_id];
    let where =
      table === 'migrations' ? 'TRUE' : table === 'households' ? 't.id=?1' : 't.household_id=?1';
    // Only migrations are installation-wide. Every business table is scoped to the authenticated household.
    if (table === 'migrations') params.length = 0;
    const bind = (value: any) => {
      params.push(value);
      return `?${params.length}`;
    };
    if (input.view === 'object') {
      requireFact(input.target, 'ATTRIBUTE_VALIDATION_FAILED', 'Object target is required.');
      const ownTable = input.target.kind === 'ITEM' ? 'items' : 'catalog_nodes';
      requireFact(
        query(c, `SELECT 1 FROM ${ownTable} WHERE household_id=?1 AND id=?2`, [
          ctx.household_id,
          input.target.id,
        ]).rows.length,
        'NOT_FOUND',
        'Object not found in this household.',
      );
      const id = bind(input.target.id),
        kind = "'" + input.target.kind + "'";
      const events = `SELECT e.operation_id FROM events e WHERE e.household_id=?1 AND e.target_id=${id} AND e.target_kind=${kind}`;
      switch (table) {
        case 'items':
        case 'catalog_nodes':
          requireFact(
            table === ownTable,
            'ATTRIBUTE_VALIDATION_FAILED',
            'Wrong core table for target.',
          );
          where += ` AND t.id=${id}`;
          break;
        case 'attribute_templates':
          where += ` AND EXISTS (SELECT 1 FROM ${ownTable} o JOIN json_each(o.attributes) a WHERE o.household_id=t.household_id AND o.id=${id} AND json_extract(a.value,'$.template_id')=t.id AND CAST(json_extract(a.value,'$.template_version') AS TEXT)=CAST(t.version AS TEXT))`;
          break;
        case 'notes':
        case 'attachments':
        case 'upload_sessions':
          where += ` AND t.target_id=${id} AND t.target_kind=${kind}`;
          break;
        case 'item_splits':
          requireFact(
            input.target.kind === 'ITEM',
            'ATTRIBUTE_VALIDATION_FAILED',
            'Splits belong to items.',
          );
          where += ` AND (t.source_item_id=${id} OR t.child_item_id=${id})`;
          break;
        case 'attribute_references':
          where += ` AND ((t.source_id=${id} AND t.source_kind=${kind}) OR (t.target_id=${id} AND t.target_kind=${kind}))`;
          break;
        case 'catalog_identity_keys':
          requireFact(
            input.target.kind === 'CATALOG_NODE',
            'ATTRIBUTE_VALIDATION_FAILED',
            'Identity keys belong to catalog nodes.',
          );
          where += ` AND t.catalog_node_id=${id}`;
          break;
        case 'events':
          where += ` AND t.target_id=${id} AND t.target_kind=${kind}`;
          break;
        case 'operations':
          where += ` AND t.operation_id IN (${events})`;
          break;
        case 'barcode_index':
          requireFact(
            input.target.kind === 'CATALOG_NODE',
            'ATTRIBUTE_VALIDATION_FAILED',
            'Barcode index belongs to catalog nodes.',
          );
          where += ` AND t.catalog_node_id=${id}`;
          break;
        default:
          throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Table is not an object relation.');
      }
    } else
      requireFact(
        !input.target,
        'ATTRIBUTE_VALIDATION_FAILED',
        'System view has no object target.',
      );
    if (input.id) {
      requireFact(
        ![
          'barcode_index',
          'installations',
          'migrations',
          'catalog_policy_versions',
          'catalog_identity_keys',
          'item_splits',
          'attribute_references',
        ].includes(table),
        'ATTRIBUTE_VALIDATION_FAILED',
        'This relation has no independent ID.',
      );
      where += ` AND ${table === 'operations' ? 't.operation_id' : 't.id'}=${bind(input.id)}`;
    }
    if (input.template_id) {
      requireFact(
        table === 'attribute_templates',
        'ATTRIBUTE_VALIDATION_FAILED',
        'Template filter requires templates.',
      );
      where += ` AND t.id=${bind(input.template_id)}`;
    }
    if (input.template_version !== undefined) {
      requireFact(
        table === 'attribute_templates',
        'ATTRIBUTE_VALIDATION_FAILED',
        'Template version requires templates.',
      );
      where += ` AND t.version=${bind(input.template_version)}`;
    }
    const { cursor, limit, ...filters } = input;
    const scope = createHash('sha256')
      .update(JSON.stringify([ctx.household_id, filters]))
      .digest('hex');
    let offset = 0;
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        requireFact(
          value.scope === scope && Number.isSafeInteger(value.offset) && value.offset >= 0,
          'INVALID_CURSOR',
          'Invalid inspector cursor.',
        );
        offset = value.offset;
      } catch {
        throw new DomainError('INVALID_CURSOR', 'Invalid inspector cursor.');
      }
    }
    const source =
      table === 'installations'
        ? '(SELECT household_id,container_catalog_id FROM household_settings)'
        : table === 'migrations'
          ? '(SELECT version AS id,version FROM cf_inventory_schema)'
          : table;
    const count = Number(
      query(c, `SELECT count(*) AS count FROM ${source} t WHERE ${where}`, params).rows[0].count,
    );
    const rows = query(
      c,
      `SELECT t.* FROM ${source} t WHERE ${where} ORDER BY ${table === 'installations' ? 't.household_id' : table === 'migrations' ? 't.version' : 't.rowid'} LIMIT ${bind(input.limit)} OFFSET ${bind(offset)}`,
      params,
    ).rows.map((r) => redactInspectorRecord(table, r));
    const columns = query(
      c,
      `PRAGMA table_info(${table === 'installations' ? 'household_settings' : table === 'migrations' ? 'cf_inventory_schema' : table})`,
    ).rows.map((r) => ({
      name: r.name,
      data_type: r.type,
      udt_name: r.type,
      is_nullable: r.notnull ? 'NO' : 'YES',
      column_default: r.dflt_value,
    }));
    const constraints = query(
      c,
      'SELECT name,sql AS raw_definition FROM sqlite_master WHERE tbl_name=?1 AND sql IS NOT NULL',
      [table],
    ).rows.map((r) => ({ name: r.name, definition: r.raw_definition, type: 'sqlite' }));
    return {
      table,
      columns,
      constraints,
      rows,
      total_count: count,
      next_cursor:
        offset + input.limit < count
          ? Buffer.from(JSON.stringify({ scope, offset: offset + input.limit })).toString(
              'base64url',
            )
          : null,
    };
  });
}

// Inspector is metadata-only. Opaque documents can contain old secrets without
// classification labels, so omit them in full; no inspector reveal capability.
export function redactInspectorRecord(table: string, record: Record<string, any>) {
  const omitted: Record<string, string[]> = {
    items: ['attributes', 'display_name'],
    catalog_nodes: ['attributes', 'name'],
    notes: ['body', 'title'],
    attachments: ['caption'],
    attachment_blobs: ['storage_key', 'thumbnail_key', 'sha256'],
    upload_sessions: ['ticket_hash', 'storage_key', 'expected_sha256'],
    catalog_policy_versions: ['rules', 'reason'],
    catalog_proposals: ['proposal', 'result', 'challenge_hash', 'challenge_scope'],
    catalog_identity_keys: ['identity_key'],
    events: ['changes', 'reason'],
    operations: ['result', 'result_payload', 'fingerprint'],
    migrations: ['error', 'checkpoint'],
  };
  return redactFor(
    'inspect',
    record,
    Object.fromEntries((omitted[table] ?? []).map((key) => [key, 'SECRET' as const])),
  );
}
