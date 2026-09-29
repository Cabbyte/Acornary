import { describe, expect, it } from 'vitest';
import {
  inventoryFilterSchema,
  productGroups,
  type InventoryData,
} from '../packages/contracts/src/web.js';
describe('Product read model', () => {
  it('keeps unknown states, percentages and mixed units distinct across location/category filtering', () => {
    const data: InventoryData = {
      household: { id: 'h', name: '家' },
      container_catalog_id: 'container',
      cached_at: 'now',
      notes: [],
      catalog: [
        { id: 'group', kind: 'GROUP', parent_id: null, name: '食品', revision: 1, attributes: [] },
        { id: 'sku', kind: 'SKU', parent_id: 'group', name: '牛奶', revision: 1, attributes: [] },
      ],
      items: [],
    };
    const item = (id: string, unit: string, value: string, state?: string) => ({
      id,
      parent_id: 'box',
      catalog_node_id: 'sku',
      display_name: null,
      revision: 1,
      created_at: 'now',
      attributes: [
        {
          template_id: 'contents' as const,
          template_version: 1 as const,
          values: { remaining: { unit, value }, accuracy: 'MEASURED' },
        },
        ...(state
          ? [{ template_id: 'lifecycle' as const, template_version: 1 as const, values: { state } }]
          : []),
      ],
    });
    data.items = [
      item('one', 'mL', '1000'),
      item('two', 'mL', '500'),
      item('three', 'g', '50'),
      item('four', 'percent', '50'),
      item('past', 'mL', '0', 'CONSUMED'),
      {
        id: 'box',
        parent_id: 'room',
        catalog_node_id: 'container',
        display_name: '箱',
        revision: 1,
        attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
        created_at: 'now',
      },
      {
        id: 'room',
        parent_id: null,
        catalog_node_id: 'container',
        display_name: '房间',
        revision: 1,
        attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
        created_at: 'now',
      },
    ];
    const [g] = productGroups(
      data,
      inventoryFilterSchema.parse({ location: 'room', category: 'group' }),
    );
    expect(g.count).toBe(4);
    expect(g.unknown_lifecycle).toBe(4);
    expect(g.unknown_quantity).toBe(1);
    expect(g.totals.map((t) => [t.unit, t.value])).toEqual([
      ['mL', '1500'],
      ['g', '50'],
    ]);
    expect(productGroups(data, inventoryFilterSchema.parse({ state: 'terminal' }))[0].count).toBe(
      1,
    );
    expect(productGroups(data, inventoryFilterSchema.parse({ location: 'elsewhere' }))).toEqual([]);
    expect(productGroups(data, inventoryFilterSchema.parse({ state: 'OPENED' }))).toEqual([]);
  });
});
