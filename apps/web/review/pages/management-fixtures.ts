// Isolated management adapter facts. No production page imports this module.
import type {
  AttributeBindingV2,
  TemplateDefinitionV2,
} from '../../../../packages/contracts/src/read-v2';
import type { ItemView } from '../../src/ui/patterns/types';
import type { ManagedCatalog, ManagedLocation } from '../../src/features/management/pages/models';
import { itemFacts } from './fixtures';
export const gid = (value: number) =>
  `catalog_node_00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const iid = (value: number) =>
  `item_00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const groups: ManagedCatalog[] = [
  [10, '食品饮料'],
  [20, '家庭用品'],
  [30, '容器与收纳'],
].map(([id, name]) => ({
  id: gid(Number(id)),
  parentId: null,
  kind: 'GROUP',
  name: String(name),
  revision: 1,
  profile: null,
  capabilities: null,
  effectiveCapabilities: [],
  oneOff: false,
  recordState: 'VALID',
  voidedAt: null,
  redactedPaths: [],
  attributes: [],
  path: [String(name)],
  itemCount: null,
  hidden: false,
  specification: '分类规则：按用途归类',
}));
export const containerCatalog: ManagedCatalog = {
  ...groups[2],
  id: gid(800),
  parentId: gid(30),
  kind: 'SKU',
  name: '通用收纳容器',
  profile: 'DURABLE',
  effectiveCapabilities: ['container'],
  path: ['容器与收纳', '通用收纳容器'],
  itemCount: 0,
  specification: '独立容器 · 允许容纳',
};
export function catalogFixtures(items: readonly ItemView[]): ManagedCatalog[] {
  const skus = [...new Set(items.map((item) => item.skuId))].map((id) => {
    const members = items.filter((item) => item.skuId === id);
    const item = members[0];
    const group = item.profile === 'CONSUMABLE' ? groups[0] : groups[1];
    return {
      ...group,
      id,
      parentId: group.id,
      kind: 'SKU' as const,
      name: item.name,
      profile: item.profile,
      effectiveCapabilities:
        item.profile === 'CONSUMABLE'
          ? ['lifecycle.expiry' as const, 'lifecycle.opening' as const, 'contents' as const]
          : ['lifecycle.expiry' as const],
      path: [group.name, item.name],
      itemCount: members.length,
      specification: item.subtitle || '规格未记录',
      revision: 2,
    };
  });
  return [
    ...groups,
    ...skus,
    containerCatalog,
    {
      ...containerCatalog,
      id: gid(801),
      name: '备用空盒商品',
      path: ['容器与收纳', '备用空盒商品'],
      hidden: true,
      itemCount: 0,
    },
    {
      ...containerCatalog,
      id: gid(802),
      name: '一次性包装资料',
      oneOff: true,
      path: ['容器与收纳', '一次性包装资料'],
    },
  ];
}
export function locationFixtures(items: readonly ItemView[]): ManagedLocation[] {
  const out: ManagedLocation[] = [];
  const seen = new Map<string, string>();
  const explicitIds = new Map(
    items
      .filter((item) => item.location.id)
      .map((item) => [item.location.path.join('/'), item.location.id!]),
  );
  let counter = 900;
  for (const item of items) {
    if (!item.location.id) continue;
    item.location.path.forEach((name, index) => {
      const path = item.location.path.slice(0, index + 1);
      const key = path.join('/');
      if (seen.has(key)) return;
      const id = explicitIds.get(key) || iid(counter++);
      seen.set(key, id);
      out.push({
        id,
        parentId: seen.get(path.slice(0, -1).join('/')) || null,
        name,
        path,
        revision: 1,
        canContain: true,
        recordState: 'VALID',
        contentCount: items.filter((row) => row.location.path.join('/').startsWith(key)).length,
        containerCatalogId: containerCatalog.id,
      });
    });
  }
  out.push({
    id: iid(950),
    parentId: null,
    name: '空收纳箱',
    path: ['空收纳箱'],
    revision: 1,
    canContain: true,
    recordState: 'VALID',
    contentCount: 0,
    containerCatalogId: containerCatalog.id,
  });
  return out;
}
export const lifecycleTemplate: TemplateDefinitionV2 = {
  id: 'lifecycle',
  version: 1,
  name: '生命周期资料',
  target_kind: 'ITEM',
  allowed_catalog_node_kinds: [],
  paths: [
    'acquisition.acquired_on',
    'expiry.date',
    'expiry.date_kind',
    'condition',
    'availability',
  ],
  fields: [
    {
      path: 'acquisition.acquired_on',
      label: '取得日期',
      type: 'date',
      section: 'dates',
      order: 0,
    },
    { path: 'expiry.date', label: '标注日期', type: 'date', section: 'dates', order: 1 },
    {
      path: 'expiry.date_kind',
      label: '日期含义',
      type: 'enum',
      section: 'dates',
      order: 2,
      options: [
        { value: 'BEST_BEFORE', label: '最佳食用期' },
        { value: 'USE_BY', label: '使用期限' },
        { value: 'ESTIMATED', label: '估计日期' },
      ],
    },
    {
      path: 'condition',
      label: '当前成色',
      type: 'enum',
      section: 'condition',
      order: 3,
      options: [
        { value: 'NEW', label: '全新' },
        { value: 'GOOD', label: '良好' },
        { value: 'WORN', label: '磨损' },
        { value: 'DAMAGED', label: '损坏' },
        { value: 'BROKEN', label: '故障' },
      ],
    },
  ],
};
export const lifecycleBinding: AttributeBindingV2 = {
  template_id: 'lifecycle',
  template_version: 1,
  status: 'KNOWN',
  values: {
    acquisition: { acquired_on: '2026-11-05' },
    opening: { state: 'OPENED', opened_at: '2026-11-06T06:32:00Z' },
    expiry: { date: '2026-11-12', date_kind: 'BEST_BEFORE' },
    availability: 'AVAILABLE',
  },
};
export const unknownBinding: AttributeBindingV2 = {
  template_id: 'legacy_care',
  template_version: 3,
  status: 'UNKNOWN',
  values: { care_instructions: '保持干燥，远离热源' },
};
export function largeSelectionItems(): ItemView[] {
  return Array.from({ length: 102 }, (_, index) => ({
    ...itemFacts[0].item,
    id: iid(10000 + index),
    name: `库存核对样例 ${index + 1}`,
    revision: 1,
  }));
}
