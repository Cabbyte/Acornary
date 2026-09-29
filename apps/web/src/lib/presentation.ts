import { Decimal } from 'decimal.js';
import {
  attr,
  type CatalogRecord,
  type InventoryData,
  type ItemRecord,
  type ProductGroup,
} from '../../../../packages/contracts/src/web';
export const labels: Record<string, string> = {
  current: '当前库存',
  all: '全部记录',
  unknown: '开封未记录',
  terminal: '历史物品',
  ACTIVE: '在库',
  CONSUMED: '已用完',
  DISPOSED: '已丢弃',
  LOST: '已遗失',
  ARCHIVED: '已归档',
  SEALED: '未开封',
  OPENED: '已开封',
  AVAILABLE: '可用',
  IN_USE: '使用中',
  LOANED: '已借出',
  CLEANING: '清洗中',
  MAINTENANCE: '维护中',
  IN_TRANSIT: '运输中',
  NEW: '全新',
  GOOD: '良好',
  WORN: '磨损',
  DAMAGED: '损坏',
  BROKEN: '无法使用',
  ESTIMATED: '估计值',
  MEASURED: '实测值',
  AMBIENT: '常温',
  REFRIGERATED: '冷藏',
  FROZEN: '冷冻',
  BEST_BEFORE: '最佳食用期',
  USE_BY: '保质期',
  count: '份',
  percent: '%',
  mL: 'mL',
  g: 'g',
};
export const label = (value?: string | null) => (value ? (labels[value] ?? value) : '未记录');
export function amount(value: string, unit: string) {
  if (unit === 'mL' && new Decimal(value).gte(1000))
    return `${new Decimal(value).div(1000).toFixed()} L`;
  if (unit === 'g' && new Decimal(value).gte(1000))
    return `${new Decimal(value).div(1000).toFixed()} kg`;
  return `${value} ${labels[unit] ?? unit}`;
}
export function remaining(item: ItemRecord) {
  const c = attr(item, 'contents');
  return c?.remaining
    ? `${c.accuracy === 'ESTIMATED' ? '约 ' : ''}${amount(c.remaining.value, c.remaining.unit)}`
    : '未记录';
}
export function total(group: ProductGroup) {
  return group.totals.length
    ? group.totals
        .map(
          (t) =>
            `${t.estimated ? '约 ' : ''}${amount(t.value, t.unit)}${t.unknown_accuracy ? '（精度未记录）' : ''}`,
        )
        .join(' / ') + (group.unknown_quantity ? ` · ${group.unknown_quantity} 件无法汇总` : '')
    : '未记录可汇总的剩余量';
}
export const pieceUnit = (sku?: CatalogRecord) =>
  attr(sku ?? { attributes: [] }, 'product')?.specification?.match(
    /[/／]\s*(瓶|袋|盒|件|个|包|台)\s*$/,
  )?.[1] ?? '件';
export function itemTitle(item: ItemRecord, data: InventoryData) {
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  return (
    item.display_name ||
    `${sku?.name ?? '物品'} · 第 ${data.items.filter((i) => i.catalog_node_id === item.catalog_node_id).findIndex((i) => i.id === item.id) + 1} ${pieceUnit(sku)}`
  );
}
export const time = (date: string) =>
  new Date(date).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const eventNames: Record<string, string> = {
  CREATE: '创建记录',
  UPDATE: '编辑名称',
  MOVE: '移动',
  OPEN: '开封',
  CONSUME_ITEMS: '整件用完',
  CONSUME_CONTENT: '部分消耗',
  CORRECT: '纠正记录',
  NOTE_CREATE: '添加笔记',
  NOTE_UPDATE: '修改笔记',
  ATTRIBUTE_BIND: '记录资料',
  ATTRIBUTE_UPDATE: '修改资料',
  ATTRIBUTE_REMOVE: '移除资料',
};
