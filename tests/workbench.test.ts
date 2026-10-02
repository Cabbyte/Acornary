import { describe, it, expect } from 'vitest';
import type { InventoryData, ItemRecord } from '../packages/contracts/src/web.js';
import { workbenchItems, moveValidation, moveTargets } from '../apps/web/src/lib/workbench.js';
const item = (id: string, parent_id: string | null, container = false): ItemRecord => ({
  id,
  parent_id,
  catalog_node_id: 'sku',
  display_name: id,
  revision: 1,
  created_at: '2026-10-01',
  attributes: container
    ? [{ template_id: 'container', template_version: 1, values: { can_contain: true } }]
    : [],
});
const data: InventoryData = {
  household: { id: 'household', name: '家' },
  container_catalog_id: 'container',
  cached_at: '',
  notes: [],
  catalog: [{ id: 'sku', parent_id: null, kind: 'SKU', name: '线材', revision: 1, attributes: [] }],
  items: [
    item('书房', null, true),
    item('收纳箱', '书房', true),
    item('包', null, true),
    item('one', '书房'),
    item('two', '收纳箱'),
    item('three', '包'),
  ],
};
const filter = { query: '', descendants: false, status: '', category: '', sort: 'name' };
describe('workbench projections', () => {
  it('distinguishes direct children, descendants and full search before paging', () => {
    expect(workbenchItems(data, '书房', filter).map((i) => i.id)).toEqual(['one']);
    expect(workbenchItems(data, '书房', { ...filter, descendants: true }).map((i) => i.id)).toEqual(
      ['one', 'two'],
    );
    expect(workbenchItems(data, '书房', { ...filter, query: 'two' }).map((i) => i.id)).toEqual([
      'two',
    ]);
    expect(workbenchItems(data, undefined, filter)).toHaveLength(3);
  });
  it('preserves unknown state instead of inventing availability', () => {
    expect(workbenchItems(data, undefined, { ...filter, status: 'unknown' })).toHaveLength(3);
    expect(workbenchItems(data, undefined, { ...filter, status: 'AVAILABLE' })).toHaveLength(0);
  });
  it('rejects cyclic destinations and all-no-op selections while allowing mixed sources', () => {
    expect(moveTargets(data, [data.items[0]]).map((i) => i.id)).toEqual(['包']);
    expect(moveValidation(data, [data.items[0]], '收纳箱')).toBeTruthy();
    expect(moveValidation(data, [data.items[3]], '书房')).toBeTruthy();
    expect(moveValidation(data, [data.items[3], data.items[4]], '书房')).toBe('');
  });
});
