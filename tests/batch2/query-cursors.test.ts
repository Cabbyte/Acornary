import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  decodeQueryCursor,
  encodeQueryCursor,
  normalizeQuerySearch,
  execute,
  type BrowseCursor,
} from '../../apps/server/src/service.js';
import { currentChangeId } from '../../apps/server/src/change-watermark.js';
import { parseCommand } from '../../packages/contracts/src/index.js';
import { query } from '../../apps/server/src/db.js';
vi.mock('../../apps/server/src/db.js', () => ({
  query: vi.fn(),
  transaction: (fn: any) => fn({}),
}));
const household = 'household_' + randomUUID();
const ctx = { household_id: household, actor_id: 'actor_' + randomUUID(), source: 'TEST' };
const cursor: BrowseCursor = {
  version: 1,
  household,
  query_hash: 'a'.repeat(64),
  sort: { field: 'name', direction: 'asc' },
  last: { key: '牛奶', id: 'item_' + randomUUID() },
  as_of_change_id: '9007199254740993',
};
const mocked = vi.mocked(query);
beforeEach(() => {
  mocked.mockReset();
});
describe('browse cursor encoding', () => {
  it('round trips Unicode, nulls, bigint watermarks and exact timestamp microseconds', () => {
    for (const c of [
      cursor,
      { ...cursor, last: { ...cursor.last, key: null } },
      {
        ...cursor,
        sort: { field: 'updated_at', direction: 'desc' as const },
        last: { ...cursor.last, key: '2026-10-31 12:00:00.123456+00' },
      },
    ])
      expect(decodeQueryCursor(encodeQueryCursor(c), c)).toEqual(c);
  });
  it('rejects malformed, old offset, cross-household, mismatched query and sort cursors', () => {
    for (const value of [
      '',
      '%%%',
      'MA',
      'bnVsbA',
      encodeQueryCursor({ ...cursor, version: 2 } as any),
      encodeQueryCursor({ ...cursor, as_of_change_id: 3 } as any),
      encodeQueryCursor({ ...cursor, household: 'other' }),
      encodeQueryCursor({ ...cursor, query_hash: 'other' }),
      encodeQueryCursor({ ...cursor, sort: { ...cursor.sort, direction: 'desc' } }),
      encodeQueryCursor({ ...cursor, last: { key: {}, id: cursor.last.id } } as any),
    ])
      expect(() => decodeQueryCursor(value, cursor)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
  });
  it('rejects invalid date and timestamp keys before SQL casts', () => {
    for (const [field, key] of [
      ['created_at', 'garbage'],
      ['reminder_date', '2026-02-31'],
    ]) {
      const c = { ...cursor, sort: { ...cursor.sort, field }, last: { ...cursor.last, key } };
      expect(() => decodeQueryCursor(encodeQueryCursor(c), c)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    }
  });
  it('QUERY06 normalizes NFKC then Unicode lowercase then whitespace', () => {
    for (const [raw, expected] of [
      ['  ＭＩＬＫ\t 牛奶\n', 'milk 牛奶'],
      ['\uFEFF奶\u3000粉\u00a0', '奶 粉'],
      ['É\t\tΣ', 'é σ'],
      ['牛奶', '牛奶'],
      ['100%_\\', '100%_\\'],
    ])
      expect(normalizeQuerySearch(raw)).toBe(expected);
  });
  it('read schemas default sorting and accept opaque cursor lengths and history filters', () => {
    expect(parseCommand('query_items', {}).sort).toEqual({
      field: 'created_at',
      direction: 'desc',
    });
    expect(parseCommand('query_items', { cursor: encodeQueryCursor(cursor) }).cursor).toBeTruthy();
    expect(
      parseCommand('get_history', { event_type: 'CREATE', recorded_from: '2026-01-01T00:00:00Z' })
        .event_type,
    ).toBe('CREATE');
  });
});
describe('watermark compatibility', () => {
  it('returns zero without accessing an absent sync table', async () => {
    mocked.mockResolvedValueOnce({ rows: [{ present: false }], rowCount: 1 });
    expect(await currentChangeId({} as any, household)).toBe(0);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
  it('preserves bigint precision and scopes the sync-state lookup', async () => {
    mocked.mockResolvedValueOnce({ rows: [{ present: true }], rowCount: 1 });
    mocked.mockResolvedValueOnce({
      rows: [{ last_committed_change_id: '9007199254740993' }],
      rowCount: 1,
    });
    expect(await currentChangeId({} as any, household)).toBe('9007199254740993');
    expect(mocked.mock.calls[1][2]).toEqual([household]);
  });
});
describe('real read dispatch with a query transport stub (not DB evidence)', () => {
  let watermark = '5';
  const rows = [1, 2].map((i) => ({
    id: 'item_' + randomUUID(),
    attributes: [],
    __key: `2026-10-31 12:00:00.00000${i}+00`,
    __timezone: 'UTC',
  }));
  beforeEach(() => {
    watermark = '5';
    mocked.mockImplementation(async (_c, sql) => {
      if (sql.includes('to_regclass')) return { rows: [{ present: true }], rowCount: 1 };
      if (sql.includes('last_committed_change_id'))
        return { rows: [{ last_committed_change_id: watermark }], rowCount: 1 };
      if (sql.startsWith('WITH RECURSIVE'))
        return {
          rows: [
            {
              scope_exists: true,
              data: structuredClone(rows),
              summary: { matching_count: 9, current_count: 8 },
            },
          ],
          rowCount: 1,
        };
      return { rows: [{}], rowCount: 1 };
    });
  });
  it('QUERY02/03 keeps initial cursor watermark but binds summary to the current snapshot', async () => {
    const first = await execute(ctx, 'query_items', { limit: 1 });
    expect(first).toMatchObject({
      stale: false,
      matching_count: 9,
      summary: { as_of_change_id: '5' },
    });
    watermark = '6';
    const second = await execute(ctx, 'query_items', { limit: 1, cursor: first.next_cursor });
    expect(second).toMatchObject({
      stale: true,
      as_of_change_id: '5',
      summary: { as_of_change_id: '6' },
    });
    expect(
      decodeQueryCursor(
        second.next_cursor,
        JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString()),
      ).as_of_change_id,
    ).toBe('5');
    await expect(
      execute(ctx, 'query_items', { search: 'changed', cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('QUERY07/08 emits one same-element EXISTS per template and bounded SQL without registry reads', async () => {
    await execute(ctx, 'query_items', {
      limit: 1,
      search: '牛奶',
      include_path: true,
      attribute_filters: [
        { template_id: 'lifecycle', path: 'expiry.date_kind', op: 'eq', value: 'USE_BY' },
        { template_id: 'lifecycle', path: 'expiry.date', op: 'gte', value: '2026-01-01' },
      ],
    });
    const sqls = mocked.mock.calls.map((call) => call[1]);
    expect(sqls).toHaveLength(5); // SET, actor authorization, two watermark statements, main read.
    const sql = sqls.at(-1)!;
    expect(
      sql.match(/EXISTS\(SELECT 1 FROM jsonb_array_elements\(o.attributes\) a WHERE/g),
    ).toHaveLength(1);
    expect(sql).toContain('LIMIT $');
    expect(sql).toContain('current_items');
    expect(sql).toContain('ancestors');
    expect(sqls.join('\n')).not.toContain('attribute_templates');
    expect(sqls.join('\n')).not.toContain('OFFSET');
    expect(mocked.mock.calls.at(-1)![2]).toContain('%牛奶%');
  });
  it('history uses selective WHERE, timestamp/id order, and a SQL limit', async () => {
    mocked.mockImplementation(async (_c, sql) => ({
      rows: sql.includes('to_regclass')
        ? [{ present: false }]
        : sql.includes('FROM events e')
          ? []
          : [{}],
      rowCount: 1,
    }));
    await execute(ctx, 'get_history', {
      target: { kind: 'ITEM', id: rows[0].id },
      operation_id: 'operation_' + randomUUID(),
      event_type: 'CREATE',
      recorded_from: '2026-01-01T00:00:00Z',
      recorded_to: '2026-12-31T00:00:00Z',
      limit: 3,
    });
    const sql = mocked.mock.calls.at(-1)![1];
    for (const fragment of [
      'e.household_id=$1',
      'e.target_kind=',
      'e.target_id=',
      'e.operation_id=',
      'e.event_type=',
      'e.recorded_at >=',
      'e.recorded_at <=',
      'ORDER BY e.recorded_at DESC,e.id DESC LIMIT',
    ])
      expect(sql).toContain(fragment);
  });
});
