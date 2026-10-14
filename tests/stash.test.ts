import { describe, expect, it } from 'vitest';
import {
  householdToday,
  itemAttention,
  remainingPercent,
  stashDate,
  stashGroups,
} from '../apps/web/src/lib/stash.js';
import { workbenchItems } from '../apps/web/src/lib/workbench.js';
import type { InventoryData, ItemRecord } from '../packages/contracts/src/web.js';
const make = (
  id: string,
  lifecycle: Record<string, unknown> = {},
  contents?: Record<string, unknown>,
): ItemRecord => ({
  id,
  parent_id: null,
  catalog_node_id: 'sku',
  display_name: null,
  revision: 1,
  created_at: '2026-10-01',
  attributes: [
    { template_id: 'lifecycle', template_version: 1 as const, values: lifecycle },
    ...(contents
      ? [{ template_id: 'contents' as const, template_version: 1 as const, values: contents }]
      : []),
  ],
});
const data: InventoryData = {
  household: { id: 'home', name: '家', timezone: 'Asia/Shanghai' },
  container_catalog_id: 'container',
  catalog: [
    { id: 'sku', parent_id: null, kind: 'SKU', name: '牛奶 1L', revision: 1, attributes: [] },
  ],
  items: [],
  notes: [],
  cached_at: '',
};
describe('stash facts and grouping', () => {
  it('uses household calendar days and includes today through day 14 only', () => {
    expect(householdToday('Asia/Shanghai', new Date('2026-10-14T16:01:00Z'))).toBe('2026-10-15');
    expect(householdToday('America/Los_Angeles', new Date('2026-10-14T16:01:00Z'))).toBe(
      '2026-10-14',
    );
    for (const [date, expected] of [
      ['2026-10-13', 'past'],
      ['2026-10-14', 'soon'],
      ['2026-10-28', 'soon'],
      ['2026-10-29', ''],
    ] as const) {
      expect(itemAttention(make(date, { expiry: { date } }), data, '2026-10-14')).toEqual(
        expected ? [expected] : [],
      );
    }
    expect(
      itemAttention(make('old', { expiry: { date: '2000-01-01' } }), {
        ...data,
        household: { id: 'home', name: '家' },
      }),
    ).toEqual([]);
  });
  it('shares opening deadline derivation and preserves date meaning', () => {
    const item = make('milk', {
      opening: { opened_at: '2026-10-01T17:00:00Z' },
      expiry: { after_opening_days: 2, date: '2026-10-10', date_kind: 'BEST_BEFORE' },
    });
    expect(stashDate(item, data)).toMatchObject({ date: '2026-10-04', title: '开封后期限' });
    expect(
      stashDate(make('a', { expiry: { date: '2026-10-14', date_kind: 'BEST_BEFORE' } }), data)
        .title,
    ).toBe('最佳食用期');
  });
  it('requires explicit units and a recorded denominator, never inferring it from a name', () => {
    const item = make('milk', {}, { remaining: { value: '200', unit: 'mL' } });
    expect(remainingPercent(item, data)).toBeUndefined();
    const withNet = {
      ...data,
      catalog: [
        {
          ...data.catalog[0],
          attributes: [
            {
              template_id: 'product' as const,
              template_version: 1 as const,
              values: { net_content: { value: '1000', unit: 'mL' } },
            },
          ],
        },
      ],
    };
    expect(remainingPercent(item, withNet)).toBe(20);
    expect(itemAttention(item, withNet, '2026-10-14')).toEqual(['low']);
    expect(
      remainingPercent(make('wrong', {}, { remaining: { value: '200', unit: 'g' } }), withNet),
    ).toBeUndefined();
    expect(
      itemAttention(make('threshold', {}, { remaining: { value: '30', unit: 'percent' } }), data),
    ).toEqual([]);
    expect(
      itemAttention(
        make('done', { state: 'CONSUMED' }, { remaining: { value: '0', unit: 'percent' } }),
        data,
      ),
    ).toEqual([]);
  });
  it('keeps all physical identities and note matches before grouping and paging', () => {
    const items = Array.from({ length: 31 }, (_, i) => make(`id-${i}`));
    const fixture = {
      ...data,
      items,
      notes: [
        { id: 'note', item_id: 'id-30', title: '', body: '先用这一瓶', updated_at: '2026-10-14' },
      ],
    };
    expect(stashGroups(items, fixture, 'product')[0].items.map((i) => i.id)).toEqual(
      items.map((i) => i.id),
    );
    expect(
      workbenchItems(fixture, undefined, {
        query: '先用这一瓶',
        descendants: true,
        status: '',
        category: '',
        sort: 'name',
      }).map((i) => i.id),
    ).toEqual(['id-30']);
  });
});
