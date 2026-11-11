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
  {
    id: 'page-daily-attention',
    name: '页面 · 需要留意',
    path: '/attention',
    source: 'daily-attention',
    story: 'attention',
  },
  {
    id: 'page-daily-activity',
    name: '页面 · 最近变化',
    path: '/activity',
    source: 'daily-activity',
    story: 'activity',
  },
  ...(['intake', 'new-product', 'consume', 'move'] as const).map((kind, i) => ({
    id: `page-daily-${kind}`,
    name: `页面 · ${['已有商品入库', '新商品入库', '记录使用', '移动物品'][i]}`,
    path: `/tasks/${kind}`,
    source: 'daily-task',
    story: kind,
  })),
  {
    id: 'page-daily-opening',
    name: '页面 · 开封记录',
    path: '/daily/opening',
    source: '../../daily/pages/daily-extras',
    story: 'opening',
  },
  {
    id: 'page-daily-dates',
    name: '页面 · 日期事项',
    path: '/daily/dates',
    source: '../../daily/pages/daily-extras',
    story: 'dates',
  },
  {
    id: 'page-daily-notes',
    name: '页面 · 笔记',
    path: '/daily/notes',
    source: '../../daily/pages/daily-extras',
    story: 'notes',
  },
  {
    id: 'page-daily-attachments',
    name: '页面 · 附件',
    path: '/daily/attachments',
    source: '../../daily/pages/daily-extras',
    story: 'attachments',
  },
  {
    id: 'page-daily-scan',
    name: '页面 · 扫码',
    path: '/daily/scan',
    source: '../../daily/pages/daily-extras',
    story: 'scan',
  },
  {
    id: 'page-daily-labels',
    name: '页面 · 标签打印',
    path: '/daily/labels',
    source: '../../daily/pages/daily-extras',
    story: 'labels',
  },
  {
    id: 'page-manage-items',
    name: '页面 · 物品管理',
    path: '/manage/items',
    source: '../../management/pages/management-pages',
    story: 'manage-items',
  },
  {
    id: 'page-manage-catalog',
    name: '页面 · 商品目录',
    path: '/manage/catalog',
    source: '../../management/pages/management-pages',
    story: 'manage-catalog',
  },
  {
    id: 'page-manage-locations',
    name: '页面 · 位置与容器',
    path: '/manage/locations',
    source: '../../management/pages/management-pages',
    story: 'manage-locations',
  },
  {
    id: 'page-manage-edit',
    name: '页面 · 精确编辑',
    path: '/manage/edit',
    source: '../../management/pages/management-pages',
    story: 'manage-edit',
  },
  {
    id: 'page-manage-bulk',
    name: '页面 · 批量管理',
    path: '/manage/bulk',
    source: '../../management/pages/management-pages',
    story: 'manage-bulk',
  },
  {
    id: 'page-manage-history',
    name: '页面 · 历史与纠错',
    path: '/manage/history',
    source: '../../management/pages/management-pages',
    story: 'manage-history',
  },
  {
    id: 'page-settings',
    name: '页面 · 设置',
    path: '/settings',
    source: '../../settings/pages/settings-pages',
    story: 'settings',
  },
  {
    id: 'page-settings-household',
    name: '页面 · 账号与家庭',
    path: '/settings/household',
    source: '../../settings/pages/settings-pages',
    story: 'settings-household',
  },
  {
    id: 'page-settings-members',
    name: '页面 · 成员权限',
    path: '/settings/members',
    source: '../../settings/pages/settings-pages',
    story: 'settings-members',
  },
  {
    id: 'page-settings-auth',
    name: '页面 · 登录与授权',
    path: '/settings/auth',
    source: '../../settings/pages/settings-pages',
    story: 'settings-auth',
  },
  {
    id: 'page-settings-printing',
    name: '页面 · 打印设置',
    path: '/settings/printing',
    source: '../../settings/pages/settings-pages',
    story: 'settings-printing',
  },
  {
    id: 'page-settings-cache',
    name: '页面 · 缓存与离线',
    path: '/settings/cache',
    source: '../../settings/pages/settings-pages',
    story: 'settings-cache',
  },
  {
    id: 'page-settings-inspector',
    name: '页面 · 只读检查器',
    path: '/settings/inspector',
    source: '../../settings/pages/settings-pages',
    story: 'settings-inspector',
  },
] as const;
export function definitionForPath(path: string) {
  const task = pageDefinitions.find((p) => p.path === path);
  if (task) return task;
  return path.startsWith('/attention')
    ? pageDefinitions[4]
    : path.startsWith('/activity')
      ? pageDefinitions[5]
      : path.startsWith('/products/')
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
    /^\/(?:items(?:\/item_[\w-]+)?|tasks\/(?:intake|new-product|consume|move)|daily\/(?:opening|dates|notes|attachments|scan|labels)|manage\/(?:items|catalog|locations|edit|bulk|history)|settings(?:\/(?:household|members|auth|printing|cache|inspector))?|attention|activity|search|products\/catalog_node_[\w-]+)(?:\?|$)/.test(
      value,
    )
    ? value
    : null;
}
