import { noteSummary } from './notes.js';
import { recordSyncChange } from './sync.js';
import { z } from 'zod';
import { query, transaction, type Client } from './db.js';
import type { Context } from './service.js';
import { DomainError } from '../../../../packages/domain/src/index.js';
import {
  syncChangesQuery,
  syncBootstrapQuery,
  syncFetchRequest,
  changeId,
  type SyncState,
  type SyncChanges,
  type SyncBootstrap,
  type SyncFetchResult,
} from '../../../../packages/contracts/src/sync.js';
import { readInventoryV2, readCatalogV2, readItemsV2, inventoryGroupsV2 } from './web.js';

const reset = (reason: string): never => {
  throw new DomainError('SYNC_RESET_REQUIRED', 'Restart household bootstrap.', { reason });
};
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new DomainError('INVALID_CURSOR', 'Invalid sync request.', result.error.issues);
  return result.data;
}
function state(c: Client, household: string): SyncState {
  const row = query(
    c,
    `SELECT sync_generation AS generation,last_committed_change_id AS last_change_id,
    pruned_through_change_id AS min_available_change_id FROM household_sync_state WHERE household_id=?1`,
    [household],
  ).rows[0];
  return { ...row, protocol: 2 };
}
/** Initialize a stable generation once, before opening the read-only MVCC snapshot. */
function readSync<T>(ctx: Context, read: (c: Client, state: SyncState) => T): T {
  transaction(ctx.db, (c) => {
    if (
      !query(c, 'SELECT 1 FROM actors WHERE household_id=?1 AND id=?2', [
        ctx.household_id,
        ctx.actor_id,
      ]).rows.length
    )
      throw new DomainError('FORBIDDEN', 'Invalid household context.');
    if (
      !query(c, 'SELECT 1 FROM household_sync_state WHERE household_id=?1', [ctx.household_id]).rows
        .length
    )
      query(
        c,
        'INSERT INTO household_sync_state(household_id,sync_generation) VALUES(?1,?2) ON CONFLICT DO NOTHING',
        [ctx.household_id, crypto.randomUUID()],
      );
  });
  return transaction(ctx.db, (c) => {
    return read(c, state(c, ctx.household_id));
  });
}
function validatePosition(s: SyncState, generation: string, cursor: string) {
  if (generation !== s.generation) reset('GENERATION_CHANGED');
  if (BigInt(cursor) < BigInt(s.min_available_change_id)) reset('CURSOR_PRUNED');
  if (BigInt(cursor) > BigInt(s.last_change_id)) reset('CURSOR_IN_FUTURE');
}
export const syncState = (ctx: Context) => readSync(ctx, (_c, s) => s);
export function syncChanges(ctx: Context, raw: unknown): SyncChanges {
  const input = parse(syncChangesQuery, raw);
  return readSync(ctx, (c, s) => {
    validatePosition(s, input.generation, input.cursor);
    const high = input.as_of_change_id ?? s.last_change_id;
    validatePosition(s, input.generation, high);
    if (BigInt(high) < BigInt(input.cursor)) reset('INVALID_CATCHUP_BOUNDARY');
    const rows = query(
      c,
      `SELECT change_id,object_kind,object_id,revision,change_kind FROM sync_changes
      WHERE household_id=?1 AND CAST(change_id AS INTEGER) > CAST(?2 AS INTEGER) AND CAST(change_id AS INTEGER) <= CAST(?3 AS INTEGER)
      ORDER BY length(sync_changes.change_id),sync_changes.change_id LIMIT ?4`,
      [ctx.household_id, input.cursor, high, input.limit + 1],
    ).rows;
    const more = rows.length > input.limit;
    const changes = rows.slice(0, input.limit);
    return {
      generation: s.generation,
      changes,
      next_cursor: more ? changes.at(-1)!.change_id : null,
      has_more: more,
      as_of_change_id: high,
    };
  });
}
const bootstrapCursor = z.strictObject({
  version: z.literal(2),
  household: z.string(),
  generation: z.uuid(),
  start: changeId,
  phase: z.enum(['catalog', 'items', 'groups']),
  id: z.string(),
});
export function syncBootstrap(ctx: Context, raw: unknown): SyncBootstrap {
  const input = parse(syncBootstrapQuery, raw);
  return readSync(ctx, (c, s) => {
    let cursor: z.infer<typeof bootstrapCursor> | undefined;
    if (input.cursor) {
      try {
        const bytes = Buffer.from(input.cursor, 'base64url');
        if (bytes.toString('base64url') !== input.cursor) throw new Error();
        cursor = parse(bootstrapCursor, JSON.parse(bytes.toString()));
      } catch {
        throw new DomainError('INVALID_CURSOR', 'Invalid bootstrap cursor.');
      }
      if (cursor.household !== ctx.household_id)
        throw new DomainError('INVALID_CURSOR', 'Cursor belongs to another household.');
      validatePosition(s, cursor.generation, cursor.start);
    }
    const start = cursor?.start ?? s.last_change_id;
    const keys = ['catalog', 'items', 'groups'] as const;
    type Entry = {
      phase: (typeof keys)[number];
      object:
        | SyncBootstrap['catalog'][number]
        | SyncBootstrap['items'][number]
        | SyncBootstrap['groups'][number];
    };
    const entries: Entry[] = [];
    for (const phase of keys) {
      if (cursor && keys.indexOf(phase) < keys.indexOf(cursor.phase)) continue;
      const after = cursor?.phase === phase ? cursor.id : '';
      const limit = input.limit + 1 - entries.length;
      const objects =
        phase === 'catalog'
          ? readCatalogV2(c, ctx.household_id, { after, limit })
          : phase === 'items'
            ? readItemsV2(c, ctx.household_id, { after, limit })
            : readInventoryV2(c, ctx.household_id)
                .groups.filter((g) => g.id > after)
                .slice(0, limit);
      entries.push(...objects.map((object) => ({ phase, object })));
      if (entries.length > input.limit) break;
    }
    const page = entries.slice(0, input.limit);
    const last = page.at(-1);
    const more = entries.length > input.limit;
    return {
      generation: s.generation,
      as_of_change_id: start,
      has_more: more,
      next_cursor:
        more && last
          ? Buffer.from(
              JSON.stringify({
                version: 2,
                household: ctx.household_id,
                generation: s.generation,
                start,
                phase: last.phase,
                id: last.object.id,
              }),
            ).toString('base64url')
          : null,
      catalog: page
        .filter((e) => e.phase === 'catalog')
        .map((e) => e.object) as SyncBootstrap['catalog'],
      items: page.filter((e) => e.phase === 'items').map((e) => e.object) as SyncBootstrap['items'],
      groups: page
        .filter((e) => e.phase === 'groups')
        .map((e) => e.object) as SyncBootstrap['groups'],
    };
  });
}
export function syncFetch(ctx: Context, raw: unknown): SyncFetchResult {
  const input = parse(syncFetchRequest, raw);
  return readSync(ctx, (c, s) => {
    if (input.generation !== s.generation) reset('GENERATION_CHANGED');
    const catalog = readCatalogV2(c, ctx.household_id, {
      ids: input.ids.filter((o) => o.kind === 'CATALOG_NODE').map((o) => o.id),
    });
    const items = readItemsV2(c, ctx.household_id, {
      ids: input.ids.filter((o) => o.kind === 'ITEM').map((o) => o.id),
    });
    const notes = query(
      c,
      `SELECT n.*,coalesce(v.last_change_id,'0') AS last_change_id FROM notes n
      LEFT JOIN sync_object_versions v ON v.household_id=n.household_id AND v.object_kind='NOTE' AND v.object_id=n.id
      WHERE n.household_id=?1 AND n.id IN (SELECT value FROM json_each(?2)) AND coalesce(v.change_kind,'UPSERT') <> 'TOMBSTONE'`,
      [ctx.household_id, input.ids.filter((i) => i.kind === 'NOTE').map((i) => i.id)],
    ).rows.map((row) => ({ ...noteSummary(row), last_change_id: row.last_change_id }));
    // Group refresh uses the complete current matching set, never just the fetched item subset.
    const skuIds = new Set([...catalog.map((o) => o.id), ...items.map((o) => o.catalog_node_id)]);
    const groupCatalog = readCatalogV2(c, ctx.household_id, { ids: [...skuIds] });
    const groupItems = readItemsV2(c, ctx.household_id, { skuIds: [...skuIds] });
    return {
      generation: s.generation,
      objects: [...catalog, ...items, ...notes],
      groups: inventoryGroupsV2(groupItems, groupCatalog),
    };
  });
}

/** Internal publication primitive for deletion/archive lanes. The owning source mutation,
 * event/receipt (when applicable), and this reference must share the caller's transaction. */
export function publishSyncTombstone(
  c: Client,
  household: string,
  kind: 'ITEM' | 'CATALOG_NODE' | 'NOTE' | 'ATTACHMENT',
  id: string,
  revision: number,
  operationId: string,
) {
  recordSyncChange(c, household, kind, id, revision, operationId, 'TOMBSTONE');
}
