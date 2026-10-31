import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { execute, type Context } from '../../apps/server/src/service.js';
import * as db from '../../apps/server/src/db.js';

// Read-only, opt-in, pre-seeded performance DB. This does not start/seed PostgreSQL.
const enabled = Boolean(process.env.DATABASE_URL && process.env.BATCH2_QUERY_PERF === '1');
let ctx: Context;
let target: string, operation: string, container: string;
const cases = [
  ['items_first_page', 'query_items', () => ({}), 300],
  [
    'items_deep_container',
    'query_items',
    () => ({ within_item_id: container, include_path: true }),
    300,
  ],
  [
    'items_attribute_filter',
    'query_items',
    () => ({
      attribute_filters: [{ template_id: 'lifecycle', path: 'state', op: 'eq', value: 'ACTIVE' }],
    }),
    300,
  ],
  ['history_household', 'get_history', () => ({}), 150],
  ['history_item', 'get_history', () => ({ target: { kind: 'ITEM', id: target } }), 150],
  ['history_operation', 'get_history', () => ({ operation_id: operation }), 150],
  ['search_chinese_one_character', 'query_items', () => ({ search: '奶' }), 200],
  ['search_chinese_two_characters', 'query_items', () => ({ search: '牛奶' }), 200],
  ['search_nfkc', 'query_items', () => ({ search: 'ＭＩＬＫ　牛奶' }), 200],
  ['search_note', 'query_items', () => ({ search: '保养' }), 200],
  ['catalog_groups', 'query_catalog_nodes', () => ({ kind: 'GROUP' }), 300],
] as const;
describe.skipIf(!enabled)('QUERY08 single-reader full-scale benchmark', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL!.includes('acornary_test'))
      throw new Error('Use an isolated acornary_test database.');
    if (!process.env.BATCH2_QUERY_HOUSEHOLD || !process.env.BATCH2_QUERY_ACTOR)
      throw new Error(
        'Set BATCH2_QUERY_HOUSEHOLD and BATCH2_QUERY_ACTOR to the seeded household and actor.',
      );
    ctx = {
      household_id: process.env.BATCH2_QUERY_HOUSEHOLD,
      actor_id: process.env.BATCH2_QUERY_ACTOR,
      source: 'TEST',
    };
    const counts = (
      await db.query(
        db.pool,
        `SELECT
      (SELECT count(*) FROM items) AS items,(SELECT count(*) FROM notes) AS notes,
      (SELECT count(*) FROM events) AS events,(SELECT count(*) FROM households) AS households`,
      )
    ).rows[0];
    expect(Number(counts.items)).toBeGreaterThanOrEqual(10000);
    expect(Number(counts.notes)).toBeGreaterThanOrEqual(10000);
    expect(Number(counts.events)).toBeGreaterThanOrEqual(100000);
    expect(Number(counts.households)).toBeGreaterThanOrEqual(2);
    const sample = (
      await db.query(
        db.pool,
        `SELECT target_id,operation_id FROM events
      WHERE household_id=$1 AND target_kind='ITEM' ORDER BY recorded_at DESC,id DESC LIMIT 1`,
        [ctx.household_id],
      )
    ).rows[0];
    target = sample.target_id;
    operation = sample.operation_id;
    container = (
      await db.query(
        db.pool,
        `WITH RECURSIVE tree AS (
      SELECT id,0 AS depth FROM items WHERE household_id=$1 AND parent_id IS NULL
      UNION ALL SELECT i.id,t.depth+1 FROM items i JOIN tree t ON i.parent_id=t.id WHERE i.household_id=$1)
      SELECT t.id,t.depth FROM tree t WHERE EXISTS(SELECT 1 FROM items i WHERE i.household_id=$1 AND i.parent_id=t.id)
      ORDER BY depth DESC,id LIMIT 1`,
        [ctx.household_id],
      )
    ).rows[0]?.id;
    expect(container).toBeTruthy();
    console.info(
      'QUERY08 environment',
      JSON.stringify({
        node: process.version,
        counts,
        postgres: (await db.query(db.pool, 'SELECT version()')).rows[0].version,
        household: ctx.household_id,
        concurrency: { readers: 1, writers: 0 },
      }),
    );
  });
  afterAll(async () => {
    if (enabled) await db.pool.end();
  });
  for (const [name, operationName, input, budget] of cases) {
    it(
      name,
      async () => {
        const args = { ...input(), limit: 50 };
        const run = () => execute(ctx, operationName, args);
        const spy = vi.spyOn(db, 'query');
        let statements: { sql: string; values: unknown[] | undefined }[];
        try {
          const result = await run();
          console.info('QUERY08 matching', name, result.matching_count ?? result.data.length);
          statements = spy.mock.calls.map(([, sql, values]) => ({ sql, values }));
        } finally {
          spy.mockRestore();
        }
        const business = statements.filter(
          (s) => !s.sql.startsWith('SET TRANSACTION') && !s.sql.startsWith('SELECT 1 FROM actors'),
        );
        expect(business.length).toBeLessThanOrEqual(5);
        const statement = statements.find(
          (s) => s.sql.startsWith('WITH RECURSIVE') || s.sql.includes('FROM events e'),
        )!;
        const explain = (
          await db.query(
            db.pool,
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement.sql,
            statement.values,
          )
        ).rows;
        console.info(
          'QUERY08 plan',
          JSON.stringify({
            name,
            business_sql: business.length,
            total_sql: statements.length + 2,
            sql: statement.sql,
            values: statement.values,
            explain,
          }),
        );
        for (let n = 0; n < 100; n++) await run();
        const p95s: number[] = [];
        for (let round = 1; round <= 3; round++) {
          const samples: number[] = [];
          for (let n = 0; n < 1000; n++) {
            const start = performance.now();
            await run();
            samples.push(performance.now() - start);
          }
          const sorted = [...samples].sort((a, b) => a - b);
          const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
          p95s.push(p95);
          console.info('QUERY08 samples', JSON.stringify({ name, round, p95, budget, samples }));
        }
        for (const p95 of p95s) expect(p95).toBeLessThanOrEqual(budget);
      },
      3600000,
    );
  }
});
