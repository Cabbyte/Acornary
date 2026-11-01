import { describe, expect, it } from 'vitest';
import type { CatalogView, ItemView } from '../../apps/web/src/features/inventory/model/types.js';
import {
  attentionFor,
  categoryPath,
  enrichItem,
  groupByCategory,
  type EnrichedItem,
  physicalItems,
  sortEnriched,
  todayFor,
} from '../../apps/web/src/features/items/selectors/items.js';
import { categoryIcon } from '../../apps/web/src/ui/icons/category.js';

function item(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: 'item_1',
    skuId: 'sku_1',
    name: '牛奶 · 第 1 瓶',
    location: { id: 'space_fridge', path: ['厨房', '冰箱冷藏层'], label: '厨房 / 冰箱冷藏层' },
    profile: null,
    status: { label: '在库', tone: 'success' },
    facts: [
      { kind: 'expiry', label: '到期', value: '2026-10-02', priority: 10 },
      { kind: 'remaining', label: '剩余', value: '1000 mL', priority: 20 },
    ],
    attention: [],
    revision: 1,
    updatedAt: '2026-10-31T12:00:00+08:00',
    recordState: 'VALID',
    voidedAt: null,
    redactedPaths: [],
    noteCount: 0,
    attachmentCount: 0,
    ...overrides,
  };
}

const catalog = new Map<string, CatalogView>([
  [
    'group_food',
    {
      id: 'group_food',
      parentId: null,
      kind: 'GROUP',
      name: '食品与饮品',
      revision: 1,
      profile: null,
      capabilities: null,
      effectiveCapabilities: [],
      oneOff: false,
      recordState: 'VALID',
      voidedAt: null,
      redactedPaths: [],
      attributes: [],
    },
  ],
  [
    'sku_1',
    {
      id: 'sku_1',
      parentId: 'group_food',
      kind: 'SKU',
      name: '蒙牛鲜牛奶',
      revision: 1,
      profile: null,
      capabilities: null,
      effectiveCapabilities: [],
      oneOff: false,
      recordState: 'VALID',
      voidedAt: null,
      redactedPaths: [],
      attributes: [],
    },
  ],
]);

describe('item selectors', () => {
  it('uses the household timezone for today', () => {
    expect(todayFor('Asia/Shanghai')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('labels overdue, today and soon dates with days', () => {
    expect(attentionFor(item(), '2026-10-31')).toMatchObject({
      kind: 'expired',
      label: '已过期 29 天',
      tone: 'danger',
      days: -29,
    });
    expect(
      attentionFor(
        item({ facts: [{ kind: 'expiry', label: '到期', value: '2026-10-31', priority: 10 }] }),
        '2026-10-31',
      ),
    ).toMatchObject({ kind: 'today', label: '今天到期', tone: 'warning' });
    expect(
      attentionFor(
        item({ facts: [{ kind: 'expiry', label: '到期', value: '2026-11-03', priority: 10 }] }),
        '2026-10-31',
      ),
    ).toMatchObject({ kind: 'soon', label: '临期 3 天', tone: 'warning' });
  });

  it('keeps void records dangerous and normal records quiet', () => {
    expect(attentionFor(item({ recordState: 'VOID' }), '2026-10-31')).toMatchObject({
      kind: 'void',
      label: '已作废',
      tone: 'danger',
    });
    expect(attentionFor(item({ facts: [] }), '2026-10-31')).toBeNull();
  });

  it('derives the category path from catalog ancestors', () => {
    expect(categoryPath(item(), catalog)).toEqual(['食品与饮品']);
    expect(enrichItem(item(), catalog, '2026-10-31')).toMatchObject({
      category: '食品与饮品',
      product: '蒙牛鲜牛奶',
      tone: 'food',
    });
  });

  it('picks the cleaning icon before the clothing icon', () => {
    expect(categoryIcon('洗衣液', '洗衣液', '日用与清洁')).toBe('spray');
    expect(categoryIcon('棉质短袖 T 恤', '棉质短袖 T 恤', '衣物')).toBe('shirt');
    expect(categoryIcon('牛奶 · 第 1 瓶', '蒙牛鲜牛奶', '食品与饮品')).toBe('milk');
  });

  it('excludes containers and groups/sorts attention first', () => {
    const entries: EnrichedItem[] = [
      enrichItem(item({ id: 'a', name: 'B 物品', facts: [] }), catalog, '2026-10-31'),
      enrichItem(item({ id: 'b', name: 'A 物品' }), catalog, '2026-10-31'),
    ];
    expect(
      physicalItems([item({ id: 'a' }), item({ id: 'container' })], new Set(['container'])),
    ).toHaveLength(1);
    expect(groupByCategory(entries)).toHaveLength(1);
    expect(sortEnriched(entries, 'attention')[0]?.item.id).toBe('b');
    expect(sortEnriched(entries, 'name')[0]?.item.name).toBe('A 物品');
  });
});
