import { Decimal } from 'decimal.js';
import {
  ancestors,
  attr,
  isContainer,
  isTerminal,
  itemName,
  locationName,
  type CatalogRecord,
  type InventoryData,
  type ItemRecord,
} from '../../../../packages/contracts/src/web';

export const PAGE_SIZE = 20;
export const specification = (sku?: CatalogRecord) => {
  if (!sku) return '';
  const product = attr(sku, 'product');
  const clothing = attr(sku, 'clothing');
  const device = attr(sku, 'device');
  return [
    ...new Set(
      [
        product?.specification,
        product?.model,
        clothing?.color,
        clothing?.size,
        device?.connector,
        device?.rated_power_w ? `${device.rated_power_w} W` : '',
      ].filter(Boolean),
    ),
  ].join(' · ');
};
export const visibleProducts = (data: InventoryData) =>
  data.catalog.filter(
    (c) =>
      c.kind === 'SKU' &&
      c.id !== data.container_catalog_id &&
      attr(c, 'catalog')?.visibility !== 'HIDDEN',
  );
export const fullPath = (id: string | null, data: InventoryData) =>
  ['全部位置', ...ancestors(id, data.items).map((i) => itemName(i, data))].join(' / ');
export const categoryPath = (sku: CatalogRecord, data: InventoryData) =>
  ancestors(sku.parent_id, data.catalog)
    .map((c) => c.name)
    .join(' / ') || '未分类';
export function searchInventory(
  data: InventoryData,
  query: string,
  scope = '',
  state = 'current',
  category = '',
) {
  const needle = query.trim().toLocaleLowerCase();
  return data.items.filter((item) => {
    if (scope && !ancestors(item.parent_id, data.items).some((p) => p.id === scope)) return false;
    if (category && !ancestors(item.catalog_node_id, data.catalog).some((c) => c.id === category))
      return false;
    if (state === 'current' && isTerminal(item)) return false;
    if (state === 'terminal' && !isTerminal(item)) return false;
    if (['OPENED', 'SEALED'].includes(state) && attr(item, 'lifecycle')?.opening?.state !== state)
      return false;
    if (state === 'unknown' && attr(item, 'lifecycle')?.opening?.state) return false;
    const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
    return (
      !needle ||
      [
        itemName(item, data),
        sku?.name,
        specification(sku),
        attr(sku ?? { attributes: [] }, 'product')?.brand,
        item.id,
        locationName(item, data),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
}
export const physicalItems = (items: ItemRecord[]) => items.filter((i) => !isContainer(i));
export function consumptionError(value: string, remaining?: { value: string; unit: string }) {
  if (!remaining) return '剩余量未记录，请先补充已知数量。';
  if (!value) return '请输入本次消耗量。';
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return '请输入有效的正数。';
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lte(0)) return '本次消耗量须大于 0。';
  if (amount.gt(remaining.value)) return '本次消耗量超过当前剩余量。';
  return '';
}
