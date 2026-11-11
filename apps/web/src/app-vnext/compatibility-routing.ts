import { entityId } from '../../../../packages/contracts/src/ids';
import { expandItemId } from '../lib/labels';
import type { UIMode } from '../ui/theme/provider';
import { safeApplicationPath } from './routing';

export type ApplicationLink =
  | { kind: 'route'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'legacy-task'; originalPath: string; reason: string }
  | { kind: 'invalid'; reason: string };
const invalid = (): ApplicationLink => ({
  kind: 'invalid',
  reason: '链接无法识别，请核对原标签或地址。',
});

/** Compatibility resolution never reads inventory or converts a link's backend.
 * An unresolved old task remains explicit; it is never silently dropped on redirect. */
export function resolveApplicationLink(
  input: string,
  options: { origin: string; preferredMode?: UIMode },
): ApplicationLink {
  if (!input || input.length >= 4096 || /[\u0000-\u0020\\]/.test(input)) return invalid();
  let url: URL;
  let origin: string;
  try {
    origin = new URL(options.origin).origin;
    if (!/^https?:\/\//.test(options.origin)) return invalid();
    // Protocol-relative URLs and arbitrary relative paths are not application paths.
    if (!input.startsWith('/') && !/^https?:\/\//.test(input)) return invalid();
    if (input.startsWith('//')) return invalid();
    url = new URL(input, origin);
    if (url.username || url.password) return invalid();
  } catch {
    return invalid();
  }
  if (url.origin !== origin) return { kind: 'external', url: url.href };
  const originalPath = url.pathname + url.search + url.hash;
  if (url.hash) return invalid();
  if (url.searchParams.has('dialog'))
    return {
      kind: 'legacy-task',
      originalPath,
      reason: '此链接包含旧版任务参数，需核对目标和原草稿后打开，未创建新请求。',
    };
  // Opaque server cursors are not portable navigation state.
  if (url.searchParams.has('cursor'))
    return {
      kind: 'legacy-task',
      originalPath,
      reason: '此链接含有服务端分页游标，需重新读取原查询范围。',
    };
  const params = new URLSearchParams(url.search);
  let path = url.pathname;
  const item = (value: string) => entityId('item').safeParse(value).success;
  const catalog = (value: string) => entityId('catalog_node').safeParse(value).success;
  const parts = path.split('/').filter(Boolean);
  if (path === '/') path = options.preferredMode === 'management' ? '/manage/items' : '/items';
  else if (parts[0] === 'i' && parts.length === 2) {
    const id = expandItemId(parts[1]);
    if (!id) return invalid();
    path = `/items/${id}`;
  } else if (parts[0] === 'items' && parts[1] === 'group' && parts.length === 3) {
    if (!catalog(parts[2])) return invalid();
    path = `/products/${parts[2]}`;
  } else if (parts[0] === 'items' && parts.length === 3) {
    if (!item(parts[1]) || !['details', 'notes', 'history'].includes(parts[2])) return invalid();
    path = `/items/${parts[1]}`;
    if (parts[2] !== 'details') params.set('tab', parts[2]);
  } else if (parts[0] === 'catalog') {
    if (
      parts.length > 3 ||
      (parts[1] && !catalog(parts[1])) ||
      (parts[2] && parts[2] !== 'history')
    )
      return invalid();
    path = '/manage/catalog';
    if (parts[1]) params.set('id', parts[1]);
    if (parts[2]) params.set('tab', 'history');
  } else if (parts[0] === 'places') {
    if (parts.length > 2 || (parts[1] && !item(parts[1]))) return invalid();
    path = '/manage/locations';
    if (parts[1]) params.set('id', parts[1]);
  } else if (path === '/settings/account') path = '/settings/auth';
  else if (path === '/settings/households') path = '/settings/household';
  else if (path === '/settings/printer') path = '/settings/printing';
  else if (path === '/inspect') path = '/settings/inspector';
  if (/^\/items\//.test(path) && !item(path.slice('/items/'.length))) return invalid();
  if (/^\/products\//.test(path) && !catalog(path.slice('/products/'.length))) return invalid();
  const resolved = `${path}${params.size ? `?${params}` : ''}`;
  return safeApplicationPath(resolved) ? { kind: 'route', path: resolved } : invalid();
}
