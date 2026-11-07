export const pageDefinitions = [
  {
    id: 'page-daily-home',
    name: '页面 · 我的物品',
    path: '/items',
    source: 'daily-home',
    story: 'home',
  },
  {
    id: 'page-daily-search',
    name: '页面 · 搜索结果',
    path: '/search?q=燕麦',
    source: 'daily-search',
    story: 'search',
  },
  {
    id: 'page-daily-product',
    name: '页面 · 商品资料',
    path: '/products/catalog_node_00000000-0000-4000-8000-000000000001',
    source: 'daily-product',
    story: 'product',
  },
  {
    id: 'page-daily-item',
    name: '页面 · 单件档案',
    path: '/items/item_00000000-0000-4000-8000-000000000001',
    source: 'daily-item-detail',
    story: 'item',
  },
] as const;
export function definitionForPath(path: string) {
  return path.startsWith('/products/')
    ? pageDefinitions[2]
    : path.startsWith('/items/')
      ? pageDefinitions[3]
      : path.startsWith('/search')
        ? pageDefinitions[1]
        : pageDefinitions[0];
}
export function safePagePath(value: string | null): string | null {
  return value &&
    value.length < 4096 &&
    /^\/(?:items(?:\/item_[\w-]+)?|search|products\/catalog_node_[\w-]+)(?:\?|$)/.test(value)
    ? value
    : null;
}
