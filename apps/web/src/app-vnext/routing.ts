import type { UIMode } from '../ui/theme/provider';
/** Route registry shared by candidate navigation and isolated assembly. */
export const applicationRoutes = [
  '/items',
  '/search',
  '/tasks/$kind',
  '/daily/$section',
  '/manage/$section',
  '/settings',
  '/settings/$section',
  '/attention',
  '/activity',
  '/items/$itemId',
  '/products/$productId',
] as const;
export function safeApplicationPath(value: string | null): string | null {
  return value &&
    value.length < 4096 &&
    /^\/(?:items(?:\/item_[\w-]+)?|tasks\/(?:intake|new-product|consume|move)|daily\/(?:opening|dates|notes|attachments|scan|labels)|manage\/(?:items|catalog|locations|edit|bulk|history)|settings(?:\/(?:household|members|auth|printing|cache|inspector))?|attention|activity|search|products\/catalog_node_[\w-]+)(?:\?[^#]*)?$/.test(
      value,
    )
    ? value
    : null;
}
export function modeForPath(pathname: string, search = ''): UIMode {
  return pathname.startsWith('/manage/') ||
    (pathname.startsWith('/settings') && new URLSearchParams(search).get('mode') === 'management')
    ? 'management'
    : 'daily';
}
export function updateRouteQuery(
  pathname: string,
  search: string,
  changes: Record<string, string | null>,
) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `${pathname}${params.size ? `?${params}` : ''}`;
}
export interface ReturnContext {
  path: string;
  scrollTop: number;
  focusId?: string;
}
