import type { CatalogView } from '../../inventory/model/types.js';
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const binding = (node: CatalogView, templateId: string) =>
  node.attributes.find((attribute) => attribute.template_id === templateId)?.values ?? {};

/** Brand, pack specification, clothing size, and connector are the practical scan keys. */
export function keySpec(node: CatalogView): string {
  const product = binding(node, 'product');
  const clothing = binding(node, 'clothing');
  const device = binding(node, 'device');
  return [
    text(product.brand),
    text(product.specification),
    text(clothing.size),
    text(device.connector),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

export function categoryPath(
  node: CatalogView,
  catalogById: ReadonlyMap<string, CatalogView>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor = node.parentId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = catalogById.get(cursor);
    if (!parent) break;
    names.unshift(parent.name);
    cursor = parent.parentId;
  }
  return names;
}
