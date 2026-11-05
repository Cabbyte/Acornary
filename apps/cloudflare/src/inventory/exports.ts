import type { ExportOperation } from '../../../../packages/contracts/src/export.js';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  exportSchemas,
  exportOperations,
  type ExportMetadata,
} from '../../../../packages/contracts/src/export.js';
import { parseCommand } from '../../../../packages/contracts/src/index.js';
import { findTemplate, templateDefinition } from '../../../../packages/contracts/src/registry.js';
import { canonical, DomainError, requireFact } from '../../../../packages/domain/src/index.js';
import { query, transaction, type Client } from './db.js';
import { redactFor, type SensitivityPaths } from './redaction.js';
import type { Context } from './service.js';
export { exportOperations };

type QueryOperation = 'query_items' | 'query_catalog_nodes';
type QueryReader = (c: Client, ctx: Context, name: QueryOperation, input: any) => any;
const stale = (): never => {
  throw new DomainError('CURSOR_STALE', 'Restart the frozen export.');
};
function authorize(c: Client, ctx: Context) {
  requireFact(
    query(c, 'SELECT 1 FROM actors WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      ctx.actor_id,
    ]).rows.length,
    'FORBIDDEN',
    'Invalid household context.',
  );
}
function selection(input: any) {
  requireFact(
    !Object.hasOwn(input.query, 'cursor') && !Object.hasOwn(input.query, 'limit'),
    'ATTRIBUTE_VALIDATION_FAILED',
    'Export query must omit browse cursor and limit.',
  );
  const name: QueryOperation = input.kind === 'ITEM' ? 'query_items' : 'query_catalog_nodes';
  const { limit: _, ...conditions } = parseCommand(name, input.query);
  const disclosure_mode = input.include_sensitive ? 'SENSITIVE' : 'REDACTED';
  return {
    name,
    conditions,
    disclosure_mode,
    query_hash: createHash('sha256')
      .update(canonical({ kind: input.kind, conditions, disclosure_mode }))
      .digest('hex'),
  };
}
function metadata(row: any): ExportMetadata {
  return {
    export_id: row.id,
    generation: row.generation,
    query_hash: row.query_hash,
    disclosure_mode: row.disclosure_mode,
    as_of_change_id: String(row.as_of_change_id),
    matching_count: row.row_count,
    summary: row.summary,
    expires_at: new Date(row.expires_at).toISOString(),
  };
}
function cursor(row: any, ordinal: number) {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      export_id: row.id,
      ordinal,
      query_hash: row.query_hash,
      generation: row.generation,
      disclosure_mode: row.disclosure_mode,
    }),
  ).toString('base64url');
  return body + '.' + createHmac('sha256', row.cursor_secret).update(body).digest('base64url');
}
function position(row: any, token?: string): number {
  if (token === undefined) return 0;
  try {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) return stale();
    const expected = createHmac('sha256', row.cursor_secret).update(body).digest('base64url');
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return stale();
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      value.v !== 1 ||
      value.export_id !== row.id ||
      value.query_hash !== row.query_hash ||
      value.generation !== row.generation ||
      value.disclosure_mode !== row.disclosure_mode ||
      !Number.isSafeInteger(value.ordinal) ||
      value.ordinal < 0 ||
      value.ordinal >= row.row_count
    )
      return stale();
    return value.ordinal;
  } catch {
    return stale();
  }
}
function audit(c: Client, ctx: Context, id: string) {
  query(
    c,
    `INSERT INTO sensitive_access_audit(household_id,actor_id,target_kind,target_id,scope)
    VALUES(?1,?2,'EXPORT',?3,'export')`,
    [ctx.household_id, ctx.actor_id, id],
  );
}
function redactor(c: Client, ctx: Context) {
  const definitions = new Map<string, any>(
    query(c, 'SELECT id,version,definition FROM attribute_templates WHERE household_id=?1', [
      ctx.household_id,
    ]).rows.map((r) => [`${r.id}@${r.version}`, r.definition]),
  );
  return (row: any) => {
    const paths: SensitivityPaths = {};
    row.attributes.forEach((binding: any, index: number) => {
      const template = findTemplate(binding.template_id, binding.template_version);
      // Unknown/retired schemas cannot promise a complete sensitivity declaration.
      if (!template || template.retired) {
        paths[`attributes.${index}.values`] = 'SECRET';
        return;
      }
      const fields = [
        ...templateDefinition(template.id, template.version).fields,
        ...(definitions.get(`${template.id}@${template.version}`)?.fields ?? []),
      ];
      for (const field of fields)
        if (field.sensitivity === 'SENSITIVE' || field.sensitivity === 'SECRET')
          paths[`attributes.${index}.values.${field.path}`] = field.sensitivity;
    });
    return redactFor('export', row, paths);
  };
}

/** The callback is the unchanged browse query, run on this one MVCC snapshot. */
export function executeExport(ctx: Context, operation: string, raw: unknown, read: QueryReader) {
  const name = operation as keyof typeof exportSchemas;
  const parsed = exportSchemas[name].safeParse(raw);
  if (!parsed.success) {
    if (name === 'read_export') return stale();
    throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid export input.');
  }
  const input: any = parsed.data;
  let selected: ReturnType<typeof selection> | undefined;
  if (name !== 'cancel_export') {
    try {
      selected = selection(input);
    } catch (error) {
      if (name === 'read_export') return stale();
      throw error;
    }
  }
  return transaction(ctx.db, (c) => {
    authorize(c, ctx);
    if (name === 'cancel_export') {
      const removed = query(
        c,
        'DELETE FROM frozen_exports WHERE household_id=?1 AND actor_id=?2 AND id=?3',
        [ctx.household_id, ctx.actor_id, input.export_id],
      );
      return { export_id: input.export_id, cancelled: removed.rowCount === 1 };
    }
    if (name === 'begin_export') {
      // Establish a stable generation even for a household with no inventory writes yet.
      query(
        c,
        `INSERT INTO household_sync_state(household_id,last_committed_change_id,sync_generation)
        VALUES(?1,0,?2) ON CONFLICT DO NOTHING`,
        [ctx.household_id, randomUUID()],
      );
      const state = query(
        c,
        `SELECT sync_generation,last_committed_change_id AS watermark
        FROM household_sync_state WHERE household_id=?1`,
        [ctx.household_id],
      ).rows[0];
      const { name: queryName, conditions, query_hash, disclosure_mode } = selected!;
      const project = input.include_sensitive
        ? (r: any) => ({ ...r, redacted_paths: [] })
        : redactor(c, ctx);
      let page = read(c, ctx, queryName, { ...conditions, limit: 200 });
      const id = 'export_' + randomUUID();
      const header = query(
        c,
        `INSERT INTO frozen_exports
        (id,household_id,actor_id,generation,query_kind,query_hash,disclosure_mode,as_of_change_id,summary,row_count,cursor_secret)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) RETURNING *`,
        [
          id,
          ctx.household_id,
          ctx.actor_id,
          state.sync_generation,
          input.kind,
          query_hash,
          disclosure_mode,
          state.watermark,
          JSON.stringify(page.summary),
          page.matching_count,
          randomBytes(32).toString('hex'),
        ],
      ).rows[0];
      if (input.include_sensitive) audit(c, ctx, id);
      let ordinal = 0;
      for (;;) {
        query(
          c,
          `INSERT INTO frozen_export_rows(household_id,export_id,ordinal,data)
          SELECT ?1,?2,?3+CAST(r.key AS INTEGER),r.value FROM json_each(?4) AS r`,
          [ctx.household_id, id, ordinal, JSON.stringify(page.data.map(project))],
        );
        ordinal += page.data.length;
        if (!page.next_cursor) break;
        page = read(c, ctx, queryName, {
          ...conditions,
          limit: 200,
          cursor: page.next_cursor,
        });
      }
      requireFact(
        ordinal === header.row_count && page.summary.as_of_change_id === state.watermark,
        'STATE_CONFLICT',
        'Export snapshot did not match its summary.',
      );
      return metadata(header);
    }
    const row = query(
      c,
      `SELECT e.* FROM frozen_exports e
      JOIN household_sync_state s ON s.household_id=e.household_id AND s.sync_generation=e.generation
      WHERE e.household_id=?1 AND e.actor_id=?2 AND e.id=?3 AND e.expires_at>(SELECT now FROM cf_clock)`,
      [ctx.household_id, ctx.actor_id, input.export_id],
    ).rows[0];
    if (
      !row ||
      row.query_kind !== input.kind ||
      row.query_hash !== selected!.query_hash ||
      row.disclosure_mode !== selected!.disclosure_mode ||
      (input.generation !== undefined && input.generation !== row.generation) ||
      (input.query_hash !== undefined && input.query_hash !== row.query_hash)
    )
      return stale();
    const ordinal = position(row, input.cursor);
    const data = query(
      c,
      `SELECT data FROM frozen_export_rows
      WHERE household_id=?1 AND export_id=?2 AND ordinal >= ?3 ORDER BY ordinal LIMIT ?4`,
      [ctx.household_id, row.id, ordinal, input.limit],
    ).rows.map((r) => r.data);
    if (input.include_sensitive) audit(c, ctx, row.id);
    const next = ordinal + data.length;
    return { ...metadata(row), data, next_cursor: next < row.row_count ? cursor(row, next) : null };
  });
}

/** Explicit household maintenance; expiration is enforced even before physical cleanup. */
export function cleanupExports(ctx: Context): { removed: number } {
  return transaction(ctx.db, (c) => {
    authorize(c, ctx);
    const result = query(
      c,
      'DELETE FROM frozen_exports WHERE household_id=?1 AND expires_at<=(SELECT now FROM cf_clock)',
      [ctx.household_id],
    );
    return { removed: result.rowCount ?? 0 };
  });
}

/** Cloud membership is checked by the existing app hook; local exports require the PAT. */
